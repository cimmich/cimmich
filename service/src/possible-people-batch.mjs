import {
  dropPossiblePeopleCandidateScope,
  preparePossiblePeopleCandidateScope,
} from "./possible-people-seed.mjs";

const batchSize = 250;
const batchStatementTimeoutMs = 10 * 60 * 1_000;
const batchWorkerCount = 4;
const neighbourLimit = 12;
const similarityFloor = 0.55;

const processBatch = async (sql, run, start) => {
  const end = Math.min(Number(run.total_seeds), start + batchSize - 1);
  await sql.begin(async (tx) => {
    await tx`
      SELECT set_config(
        'statement_timeout', ${String(batchStatementTimeoutMs)}, true
      )
    `;
    await tx`SET LOCAL ivfflat.probes = 16`;
    await tx`
      INSERT INTO possible_person_edge (
        run_id, left_face_id, right_face_id, similarity, support_count
      )
      SELECT ${run.run_id}, edge.left_face_id, edge.right_face_id,
        max(edge.similarity), least(2, count(*))::int
      FROM (
        SELECT least(seed.face_id, neighbour.face_id) AS left_face_id,
          greatest(seed.face_id, neighbour.face_id) AS right_face_id,
          neighbour.similarity
        FROM possible_person_seed selected_seed
        JOIN face_embedding seed ON seed.face_id = selected_seed.face_id
          AND seed.state = 'active' AND seed.dimension = 512
          AND seed.model_family = ${run.model_family}
          AND seed.model_version = ${run.model_version}
          AND seed.config_digest = ${run.config_digest}
        JOIN current_matchable_physical_face seed_face
          ON seed_face.face_id = seed.face_id
        CROSS JOIN LATERAL (
          SELECT candidate.face_id,
            (1 - (candidate.embedding::vector(512) <=> seed.embedding::vector(512)))::float8
              AS similarity
          FROM face_embedding candidate
          WHERE candidate.state = 'active' AND candidate.dimension = 512
            AND candidate.model_family = ${run.model_family}
            AND candidate.model_version = ${run.model_version}
            AND candidate.config_digest = ${run.config_digest}
            AND candidate.face_id <> seed.face_id
            AND EXISTS (
              SELECT 1 FROM possible_people_candidate_scope scope
              WHERE scope.face_id = candidate.face_id
                AND scope.asset_id <> seed_face.asset_id
            )
          ORDER BY candidate.embedding::vector(512) <=> seed.embedding::vector(512)
          LIMIT ${neighbourLimit}
        ) neighbour
        WHERE selected_seed.run_id = ${run.run_id}
          AND selected_seed.seed_rank BETWEEN ${start} AND ${end}
          AND neighbour.similarity >= ${similarityFloor}
      ) edge
      GROUP BY edge.left_face_id, edge.right_face_id
      ON CONFLICT (run_id, left_face_id, right_face_id) DO UPDATE
      SET similarity = greatest(possible_person_edge.similarity, excluded.similarity),
        support_count = least(2, possible_person_edge.support_count + excluded.support_count)
    `;
    await tx`
      UPDATE possible_person_run
      SET processed_seeds = least(
        total_seeds, processed_seeds + ${end - start + 1}
      )
      WHERE run_id = ${run.run_id} AND state = 'running'
    `;
  });
};

export const processPossiblePeopleBatches = async ({
  sql,
  coordinatorSql,
  run,
  space,
  presentationRank,
}) => {
  if (Number(run.total_seeds) === 0) return;
  const connections = [coordinatorSql];
  const extraConnections = [];
  try {
    if (typeof sql.reserve === "function") {
      for (let index = 1; index < batchWorkerCount; index += 1) {
        extraConnections.push(await sql.reserve());
      }
      await Promise.all(
        extraConnections.map((connection) =>
          preparePossiblePeopleCandidateScope({
            sql: connection,
            space,
            presentationRank,
          }),
        ),
      );
      connections.push(...extraConnections);
    }

    let nextSeed = Number(run.processed_seeds) + 1;
    let failure = null;
    const consume = async (connection) => {
      while (!failure) {
        const start = nextSeed;
        if (start > Number(run.total_seeds)) return;
        nextSeed += batchSize;
        try {
          await processBatch(connection, run, start);
        } catch (error) {
          failure ||= error;
          throw error;
        }
        await new Promise((resolve) => setImmediate(resolve));
      }
    };
    await Promise.allSettled(connections.map(consume));
    if (failure) throw failure;
  } finally {
    await Promise.all(
      extraConnections.map(async (connection) => {
        await dropPossiblePeopleCandidateScope(connection).catch(() => {});
        await connection.release().catch(() => {});
      }),
    );
  }
};
