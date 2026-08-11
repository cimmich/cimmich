const seedLimit = 100_000;
const seedStatementTimeoutMs = 10 * 60 * 1_000;

const prepareCandidateScope = async (tx, space, presentationRank) => {
  await tx`DROP TABLE IF EXISTS pg_temp.possible_people_candidate_scope`;
  await tx`
    CREATE TEMP TABLE possible_people_candidate_scope (
      face_id text PRIMARY KEY,
      asset_id text NOT NULL,
      detection_confidence double precision,
      face_area double precision NOT NULL,
      capture_time timestamptz
    ) ON COMMIT PRESERVE ROWS
  `;
  await tx`
    WITH claimed_physical AS MATERIALIZED (
      SELECT DISTINCT claimed_member.physical_face_id
      FROM current_face_physical_member claimed_member
      JOIN identity_claim claim ON claim.face_id = claimed_member.face_id
        AND claim.state IN ('accepted', 'candidate')
    ), latest_face_review AS MATERIALIZED (
      SELECT DISTINCT ON (review.subject_id)
        review.subject_id, review.reason_code
      FROM decision review
      WHERE review.subject_type = 'face_review'
      ORDER BY review.subject_id, review.created_at DESC, review.decision_id DESC
    )
    INSERT INTO possible_people_candidate_scope (
      face_id, asset_id, detection_confidence, face_area, capture_time
    )
    SELECT embedding.face_id, face.asset_id, face.detection_confidence,
      (face.box_w * face.box_h)::float8, asset.capture_time
    FROM face_embedding embedding
    JOIN current_matchable_physical_face face
      ON face.face_id = embedding.face_id AND face.state = 'valid'
    JOIN asset ON asset.asset_id = face.asset_id AND asset.state = 'active'
    LEFT JOIN claimed_physical claimed
      ON claimed.physical_face_id = face.physical_face_id
    LEFT JOIN latest_face_review review ON review.subject_id = face.face_id
    WHERE embedding.state = 'active' AND embedding.dimension = 512
      AND embedding.model_family = ${space.model_family}
      AND embedding.model_version = ${space.model_version}
      AND embedding.config_digest = ${space.config_digest}
      AND cimmich_face_match_eligible(
        face.detection_confidence, face.box_w, face.box_h
      )
      AND cimmich_visibility_asset_rank(asset.asset_id) <= ${presentationRank()}
      AND claimed.physical_face_id IS NULL
      AND coalesce(review.reason_code, '') <> 'face_review_geometry'
  `;
  await tx`ANALYZE possible_people_candidate_scope`;
};

export const preparePossiblePeopleCandidateScope = async ({
  sql,
  space,
  presentationRank,
}) =>
  sql.begin(async (tx) => {
    await tx`
      SELECT set_config(
        'statement_timeout', ${String(seedStatementTimeoutMs)}, true
      )
    `;
    await prepareCandidateScope(tx, space, presentationRank);
  });

export const dropPossiblePeopleCandidateScope = (sql) =>
  sql`DROP TABLE IF EXISTS pg_temp.possible_people_candidate_scope`;

export const seedPossiblePeopleRun = async ({
  sql,
  runId,
  presentationRank,
}) => {
  const [space] = await sql`
    SELECT embedding.model_family, embedding.model_version,
      embedding.config_digest, embedding.dimension, count(*)::int AS face_count
    FROM face_embedding embedding
    JOIN current_matchable_physical_face face
      ON face.face_id = embedding.face_id AND face.state = 'valid'
    JOIN asset ON asset.asset_id = face.asset_id AND asset.state = 'active'
    WHERE embedding.state = 'active' AND embedding.dimension = 512
      AND cimmich_face_match_eligible(face.detection_confidence, face.box_w, face.box_h)
      AND cimmich_visibility_asset_rank(asset.asset_id) <= ${presentationRank()}
    GROUP BY embedding.model_family, embedding.model_version,
      embedding.config_digest, embedding.dimension
    ORDER BY face_count DESC, embedding.model_family, embedding.model_version,
      embedding.config_digest
    LIMIT 1
  `;
  if (!space) return null;

  await sql.begin(async (tx) => {
    await tx`
      SELECT set_config(
        'statement_timeout', ${String(seedStatementTimeoutMs)}, true
      )
    `;
    await tx`
      UPDATE possible_person_run
      SET state = 'running', started_at = now(), model_family = ${space.model_family},
        model_version = ${space.model_version}, config_digest = ${space.config_digest},
        dimension = ${Number(space.dimension)}
      WHERE run_id = ${runId} AND state = 'queued'
    `;
    await prepareCandidateScope(tx, space, presentationRank);
    await tx`
      WITH ranked AS MATERIALIZED (
        SELECT scope.face_id, scope.detection_confidence,
          scope.face_area, scope.capture_time,
          row_number() OVER (
            PARTITION BY scope.asset_id
            ORDER BY scope.detection_confidence DESC NULLS LAST,
              scope.face_area DESC, scope.face_id
          ) AS asset_face_rank
        FROM possible_people_candidate_scope scope
      )
      INSERT INTO possible_person_seed (run_id, seed_rank, face_id)
      SELECT ${runId}, row_number() OVER (
          ORDER BY ranked.detection_confidence DESC NULLS LAST,
            ranked.face_area DESC, ranked.capture_time DESC NULLS LAST, ranked.face_id
        )::int,
        ranked.face_id
      FROM ranked
      WHERE ranked.asset_face_rank <= 4
      ORDER BY ranked.detection_confidence DESC NULLS LAST,
        ranked.face_area DESC, ranked.capture_time DESC NULLS LAST, ranked.face_id
      LIMIT ${seedLimit}
    `;
    await tx`
      UPDATE possible_person_run
      SET total_seeds = (
        SELECT count(*)::int FROM possible_person_seed WHERE run_id = ${runId}
      )
      WHERE run_id = ${runId}
    `;
  });
  return space;
};
