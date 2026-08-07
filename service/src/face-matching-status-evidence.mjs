export const readFaceMatchingStatusEvidence = async ({
  provider,
  sourceId,
  sql,
  visibleRank,
}) => {
  const load = (query) => query`
    WITH accepted AS MATERIALIZED (
      SELECT identity.face_id, identity.person_id, face.asset_id
      FROM current_face_identity identity
      JOIN face_observation face ON face.face_id = identity.face_id
        AND face.state = 'valid'
      WHERE identity.state = 'accepted'
    ), eligible AS (
      SELECT accepted.face_id
      FROM accepted
      JOIN person ON person.person_id = accepted.person_id
        AND person.status = 'active'
      JOIN asset ON asset.asset_id = accepted.asset_id
        AND asset.state = 'active'
      JOIN immich_asset_projection projection
        ON projection.cimmich_asset_id = accepted.asset_id
        AND projection.source_id = ${sourceId}
        AND projection.state = 'active'
      WHERE cimmich_visibility_asset_rank(accepted.asset_id) <= ${visibleRank}
        AND cimmich_visibility_subject_rank(
          person.subject_kind, accepted.person_id
        ) <= ${visibleRank}
    ), analysed AS MATERIALIZED (
      SELECT DISTINCT observation.face_id
      FROM eligible
      JOIN media_pipeline_run_observation observation
        ON observation.face_id = eligible.face_id
      JOIN media_pipeline_run pipeline
        ON pipeline.pipeline_run_id = observation.pipeline_run_id
        AND pipeline.recognizer_config_digest = ${provider.configDigest}
        AND pipeline.recognizer_provider_config_digest =
          ${provider.providerConfigDigest}
        AND pipeline.vector_space_id = ${provider.vectorSpaceId}
        AND pipeline.state = 'recognized'
      JOIN media_job recognition_job
        ON recognition_job.job_id = pipeline.recognition_job_id
        AND recognition_job.state = 'completed'
      JOIN current_asset_source_revision revision
        ON revision.revision_id = pipeline.source_revision_id
        AND revision.asset_id = pipeline.asset_id
        AND revision.input_revision = pipeline.input_revision
        AND revision.source_content_digest = pipeline.source_content_digest
    )
    SELECT (SELECT count(*)::int FROM accepted) AS accepted_faces,
      count(DISTINCT eligible.face_id)::int AS eligible_faces,
      count(DISTINCT eligible.face_id) FILTER (
        WHERE analysis.face_id IS NOT NULL
      )::int AS analysed_faces,
      count(DISTINCT eligible.face_id) FILTER (
        WHERE embedding.embedding_id IS NOT NULL
      )::int AS provider_embeddings
    FROM eligible
    LEFT JOIN face_embedding embedding ON embedding.face_id = eligible.face_id
      AND embedding.state = 'active'
      AND embedding.model_family = ${provider.modelFamily}
      AND embedding.model_version = ${provider.modelVersion}
      AND embedding.config_digest = ${provider.configDigest}
    LEFT JOIN analysed analysis ON analysis.face_id = eligible.face_id
  `;

  const [evidence] =
    typeof sql.begin === "function"
      ? await sql.begin(async (tx) => {
          await tx`
            SELECT set_config('statement_timeout', '8000', true)
          `;
          return load(tx);
        })
      : await load(sql);
  return evidence || {};
};
