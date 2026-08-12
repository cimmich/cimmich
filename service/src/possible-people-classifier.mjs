export const possiblePeopleClassificationContract = Object.freeze({
  classificationVersion: "cimmich-possible-people-known-person-v2-consensus",
  clusterConsensusFloor: 0.5,
  clusterMinimumVotes: 2,
  clusterSampleLimit: 12,
  knownPersonMarginFloor: 0.1,
  knownPersonScoreFloor: 0.55,
  referenceNeighbourLimit: 64,
});

const typedError = (message, statusCode, code) =>
  Object.assign(new Error(message), { code, statusCode });

export const classifyPossiblePeopleRun = async (sql, runId) => {
  const {
    classificationVersion,
    clusterConsensusFloor,
    clusterMinimumVotes,
    clusterSampleLimit,
    knownPersonMarginFloor,
    knownPersonScoreFloor,
    referenceNeighbourLimit,
  } = possiblePeopleClassificationContract;
  await sql.begin(async (tx) => {
    const [run] = await tx`
      SELECT run_id, classification_state, classification_version
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
    if (
      run.classification_state === "completed" &&
      run.classification_version === classificationVersion
    )
      return;
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
      SELECT DISTINCT ON (gallery.person_id, physical.physical_face_id)
        gallery.person_id, person.display_name, physical.canonical_face_id AS face_id,
        embedding.embedding::vector(512)
      FROM current_reference_gallery gallery
      JOIN current_person person ON person.person_id = gallery.person_id
        AND person.status = 'active'
      JOIN current_face_physical_member physical
        ON physical.face_id = gallery.face_id
        AND physical.reconciliation_state <> 'conflict'
      JOIN face_embedding embedding ON embedding.face_id = physical.canonical_face_id
        AND embedding.state = 'active' AND embedding.dimension = 512
      WHERE gallery.membership_state = 'active'
        AND gallery.bucket_kind = ANY (
          ARRAY['prime','secondary','lq','head']::text[]
        )
      ORDER BY gallery.person_id, physical.physical_face_id,
        CASE gallery.bucket_kind
          WHEN 'prime' THEN 0 WHEN 'secondary' THEN 1
          WHEN 'lq' THEN 2 ELSE 3
        END,
        gallery.face_id
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
        WITH tiled_members AS MATERIALIZED (
          SELECT cluster.cluster_id, cluster.representative_face_id,
            member.face_id, member.rank,
            ntile(${clusterSampleLimit}) OVER (
              PARTITION BY cluster.cluster_id ORDER BY member.rank
            ) AS sample_tile
          FROM face_cluster cluster
          JOIN face_cluster_member member ON member.cluster_id = cluster.cluster_id
          WHERE cluster.possible_person_run_id = ${runId}
            AND cluster.status = 'open'
        ), sampled_members AS MATERIALIZED (
          SELECT DISTINCT ON (cluster_id, sample_tile)
            cluster_id, face_id, rank
          FROM tiled_members
          ORDER BY cluster_id, sample_tile,
            (face_id = representative_face_id) DESC, rank, face_id
        ), queries AS MATERIALIZED (
          SELECT sample.cluster_id, sample.face_id,
            embedding.embedding::vector(512) AS embedding
          FROM sampled_members sample
          JOIN face_embedding embedding
            ON embedding.face_id = sample.face_id
            AND embedding.state = 'active' AND embedding.dimension = 512
        ), nearest AS MATERIALIZED (
          SELECT query.cluster_id, query.face_id, reference.person_id,
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
          GROUP BY query.cluster_id, query.face_id, reference.person_id
        ), ranked AS MATERIALIZED (
          SELECT nearest.*,
            row_number() OVER (
              PARTITION BY nearest.cluster_id, nearest.face_id
              ORDER BY nearest.best_score DESC, nearest.person_id
            )::int AS person_rank
          FROM nearest
        ), classified_faces AS MATERIALIZED (
          SELECT cluster_id, face_id,
            max(person_id) FILTER (WHERE person_rank = 1) AS lead_person_id,
            max(best_score) FILTER (WHERE person_rank = 1) AS lead_score,
            max(reference_face_id) FILTER (WHERE person_rank = 1) AS reference_face_id,
            max(person_id) FILTER (WHERE person_rank = 2) AS runner_person_id,
            max(best_score) FILTER (WHERE person_rank = 2) AS runner_score
          FROM ranked
          WHERE person_rank <= 2
          GROUP BY cluster_id, face_id
        ), eligible_faces AS MATERIALIZED (
          SELECT classified.*,
            classified.lead_score - coalesce(classified.runner_score, -1)::float8
              AS lead_margin
          FROM classified_faces classified
          JOIN face_cluster cluster ON cluster.cluster_id = classified.cluster_id
          WHERE classified.lead_score >= ${knownPersonScoreFloor}
            AND (
              classified.runner_score IS NULL
              OR classified.lead_score - classified.runner_score >= ${knownPersonMarginFloor}
            )
            AND NOT coalesce(
              cluster.suggestion_evidence->'rejectedPersonIds', '[]'::jsonb
            ) ? classified.lead_person_id
        ), sample_counts AS MATERIALIZED (
          SELECT cluster_id, count(*)::int AS sampled_face_count
          FROM queries GROUP BY cluster_id
        ), votes AS MATERIALIZED (
          SELECT eligible.cluster_id, eligible.lead_person_id,
            count(*)::int AS matched_face_count,
            avg(eligible.lead_score)::float8 AS average_score,
            max(eligible.lead_score)::float8 AS best_score,
            avg(eligible.lead_margin)::float8 AS average_margin,
            (array_agg(
              eligible.reference_face_id
              ORDER BY eligible.lead_score DESC, eligible.reference_face_id
            ))[1] AS reference_face_id
          FROM eligible_faces eligible
          GROUP BY eligible.cluster_id, eligible.lead_person_id
        ), ranked_votes AS MATERIALIZED (
          SELECT votes.*,
            row_number() OVER (
              PARTITION BY votes.cluster_id
              ORDER BY votes.matched_face_count DESC, votes.best_score DESC,
                votes.lead_person_id
            )::int AS vote_rank,
            count(*) OVER (PARTITION BY votes.cluster_id)::int AS eligible_people
          FROM votes
        ), eligible AS (
          SELECT vote.*, sample.sampled_face_count,
            vote.matched_face_count::float8 / sample.sampled_face_count
              AS match_fraction
          FROM ranked_votes vote
          JOIN sample_counts sample ON sample.cluster_id = vote.cluster_id
          WHERE vote.vote_rank = 1
            AND vote.eligible_people = 1
            AND vote.matched_face_count >= ${clusterMinimumVotes}
            AND vote.matched_face_count::float8 / sample.sampled_face_count
              >= ${clusterConsensusFloor}
        )
        UPDATE face_cluster cluster
        SET suggested_person_id = eligible.lead_person_id,
          suggestion_evidence = cluster.suggestion_evidence || jsonb_build_object(
            'classificationVersion', ${classificationVersion}::text,
            'leadScore', eligible.average_score,
            'bestScore', eligible.best_score,
            'margin', eligible.average_margin,
            'referenceFaceId', eligible.reference_face_id,
            'referenceNeighbourLimit', ${referenceNeighbourLimit}::int,
            'runnerPersonId', NULL,
            'runnerScore', NULL,
            'scoreFloor', ${knownPersonScoreFloor}::float8,
            'marginFloor', ${knownPersonMarginFloor}::float8,
            'matchedFaceCount', eligible.matched_face_count,
            'sampledFaceCount', eligible.sampled_face_count,
            'matchFraction', eligible.match_fraction,
            'clusterConsensusFloor', ${clusterConsensusFloor}::float8,
            'clusterMinimumVotes', ${clusterMinimumVotes}::int,
            'clusterSampleLimit', ${clusterSampleLimit}::int,
            'classificationMode', 'distributed_member_consensus'
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
