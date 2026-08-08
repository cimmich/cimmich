export const possiblePeopleClassificationContract = Object.freeze({
  classificationVersion: "cimmich-possible-people-known-person-v1",
  knownPersonMarginFloor: 0.1,
  knownPersonScoreFloor: 0.55,
  referenceNeighbourLimit: 64,
});

const typedError = (message, statusCode, code) =>
  Object.assign(new Error(message), { code, statusCode });

export const classifyPossiblePeopleRun = async (sql, runId) => {
  const {
    classificationVersion,
    knownPersonMarginFloor,
    knownPersonScoreFloor,
    referenceNeighbourLimit,
  } = possiblePeopleClassificationContract;
  await sql.begin(async (tx) => {
    const [run] = await tx`
      SELECT run_id, classification_state
      FROM possible_person_run
      WHERE run_id = ${runId} FOR UPDATE
    `;
    if (!run) {
      throw typedError(
        "Possible people run not found",
        404,
        "POSSIBLE_PEOPLE_RUN_NOT_FOUND",
      );
    }
    if (run.classification_state === "completed") return;
    await tx`
      UPDATE possible_person_run
      SET classification_state = 'running',
        classification_version = ${classificationVersion},
        classification_started_at = now(),
        classification_completed_at = NULL,
        classification_error_code = NULL,
        classification_error_message = NULL
      WHERE run_id = ${runId}
    `;
    await tx`
      CREATE TEMP TABLE possible_person_reference_match (
        person_id text NOT NULL,
        display_name text NOT NULL,
        face_id text NOT NULL,
        embedding vector(512) NOT NULL
      ) ON COMMIT DROP
    `;
    await tx`
      INSERT INTO possible_person_reference_match (
        person_id, display_name, face_id, embedding
      )
      SELECT DISTINCT gallery.person_id, person.display_name, gallery.face_id,
        embedding.embedding::vector(512)
      FROM current_reference_gallery gallery
      JOIN current_person person ON person.person_id = gallery.person_id
        AND person.status = 'active'
      JOIN face_embedding embedding ON embedding.face_id = gallery.face_id
        AND embedding.state = 'active' AND embedding.dimension = 512
      WHERE gallery.membership_state = 'active'
        AND gallery.bucket_kind = ANY (
          ARRAY['prime','secondary','lq','head']::text[]
        )
    `;
    const [{ reference_count: referenceCount }] =
      await tx`SELECT count(*)::int AS reference_count FROM possible_person_reference_match`;
    await tx`
      UPDATE face_cluster
      SET suggested_person_id = NULL,
        suggestion_evidence = jsonb_build_object(
          'rejectedPersonIds',
          coalesce(suggestion_evidence->'rejectedPersonIds', '[]'::jsonb)
        ),
        classification_version = ${classificationVersion}, classified_at = now()
      WHERE possible_person_run_id = ${runId} AND status = 'open'
    `;
    if (Number(referenceCount) > 0) {
      await tx`
        CREATE INDEX possible_person_reference_match_vector
        ON possible_person_reference_match
        USING ivfflat (embedding vector_cosine_ops) WITH (lists = 128)
      `;
      await tx`ANALYZE possible_person_reference_match`;
      await tx`SET LOCAL ivfflat.probes = 32`;
      await tx`
        WITH queries AS MATERIALIZED (
          SELECT cluster.cluster_id, embedding.embedding::vector(512) AS embedding
          FROM face_cluster cluster
          JOIN face_embedding embedding
            ON embedding.face_id = cluster.representative_face_id
            AND embedding.state = 'active' AND embedding.dimension = 512
          WHERE cluster.possible_person_run_id = ${runId}
            AND cluster.status = 'open'
        ), nearest AS MATERIALIZED (
          SELECT query.cluster_id, reference.person_id,
            max(reference.similarity)::float8 AS best_score,
            (array_agg(reference.face_id ORDER BY reference.similarity DESC, reference.face_id))[1]
              AS reference_face_id
          FROM queries query
          CROSS JOIN LATERAL (
            SELECT candidate.person_id, candidate.face_id,
              1 - (candidate.embedding <=> query.embedding) AS similarity
            FROM possible_person_reference_match candidate
            ORDER BY candidate.embedding <=> query.embedding
            LIMIT ${referenceNeighbourLimit}
          ) reference
          GROUP BY query.cluster_id, reference.person_id
        ), ranked AS MATERIALIZED (
          SELECT nearest.*,
            row_number() OVER (
              PARTITION BY nearest.cluster_id
              ORDER BY nearest.best_score DESC, nearest.person_id
            )::int AS person_rank
          FROM nearest
        ), classified AS MATERIALIZED (
          SELECT cluster_id,
            max(person_id) FILTER (WHERE person_rank = 1) AS lead_person_id,
            max(best_score) FILTER (WHERE person_rank = 1) AS lead_score,
            max(reference_face_id) FILTER (WHERE person_rank = 1) AS reference_face_id,
            max(person_id) FILTER (WHERE person_rank = 2) AS runner_person_id,
            max(best_score) FILTER (WHERE person_rank = 2) AS runner_score
          FROM ranked
          WHERE person_rank <= 2
          GROUP BY cluster_id
        ), eligible AS (
          SELECT classified.*
          FROM classified
          JOIN face_cluster cluster ON cluster.cluster_id = classified.cluster_id
          WHERE classified.lead_score >= ${knownPersonScoreFloor}
            AND (
              classified.runner_score IS NULL
              OR classified.lead_score - classified.runner_score >= ${knownPersonMarginFloor}
            )
            AND NOT coalesce(
              cluster.suggestion_evidence->'rejectedPersonIds', '[]'::jsonb
            ) ? classified.lead_person_id
        )
        UPDATE face_cluster cluster
        SET suggested_person_id = eligible.lead_person_id,
          suggestion_evidence = cluster.suggestion_evidence || jsonb_build_object(
            'classificationVersion', ${classificationVersion},
            'leadScore', eligible.lead_score,
            'margin', CASE WHEN eligible.runner_score IS NULL
              THEN NULL ELSE eligible.lead_score - eligible.runner_score END,
            'referenceFaceId', eligible.reference_face_id,
            'referenceNeighbourLimit', ${referenceNeighbourLimit},
            'runnerPersonId', eligible.runner_person_id,
            'runnerScore', eligible.runner_score,
            'scoreFloor', ${knownPersonScoreFloor},
            'marginFloor', ${knownPersonMarginFloor}
          ),
          classification_version = ${classificationVersion}, classified_at = now()
        FROM eligible
        WHERE cluster.cluster_id = eligible.cluster_id
      `;
    }
    const [{ classified_count: classifiedCount }] = await tx`
      SELECT count(*)::int AS classified_count
      FROM face_cluster
      WHERE possible_person_run_id = ${runId}
        AND status = 'open' AND suggested_person_id IS NOT NULL
    `;
    await tx`
      UPDATE possible_person_run
      SET classification_state = 'completed',
        classified_cluster_count = ${Number(classifiedCount)},
        classification_completed_at = now()
      WHERE run_id = ${runId}
    `;
  });
};
