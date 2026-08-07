export const createFaceMatches =
  ({ cleanLimit, matcherPolicyVersion, presentationRank, sql }) =>
  async ({ faceId, limit = 5 }) => {
    const boundedLimit = cleanLimit(limit, 5, 12);
    const rows = await sql`
  WITH pack AS MATERIALIZED (
    SELECT pack.model_family, pack.model_version, pack.config_digest,
      (pack.evaluation_summary->'matcherPolicy'->>'scoreFloor')::float8
        AS score_floor,
      (pack.evaluation_summary->'matcherPolicy'->>'marginFloor')::float8
        AS margin_floor
    FROM current_source_pack pack
    WHERE pack.evaluation_status = 'passed'
      AND pack.evaluation_summary->'matcherPolicy'->>'policyVersion'
        = ${matcherPolicyVersion}
      AND pack.evaluation_summary->'matcherPolicy'->>'scorer'
        = 'best_individual_prime'
      AND jsonb_typeof(
        pack.evaluation_summary->'matcherPolicy'->'scoreFloor'
      ) = 'number'
      AND jsonb_typeof(
        pack.evaluation_summary->'matcherPolicy'->'marginFloor'
      ) = 'number'
    LIMIT 1
  ), query AS (
    SELECT fo.face_id, fo.asset_id, fe.model_family, fe.model_version,
      fe.config_digest, fe.dimension, fe.embedding,
      pack.score_floor, pack.margin_floor,
      coalesce((
        SELECT array_agg(context.context_id ORDER BY context.context_id)
        FROM current_face_capture_context context
        WHERE context.face_id = fo.face_id
      ), ARRAY[]::text[]) AS query_context_ids,
      accepted.person_id AS current_person_id
    FROM face_observation fo
    JOIN asset query_asset ON query_asset.asset_id = fo.asset_id
      AND query_asset.state = 'active'
    CROSS JOIN pack
    JOIN LATERAL (
      SELECT current.*
      FROM face_embedding current
      WHERE current.face_id = fo.face_id AND current.state = 'active'
        AND current.model_family = pack.model_family
        AND current.model_version = pack.model_version
        AND current.config_digest = pack.config_digest
      ORDER BY current.created_at DESC, current.embedding_id
      LIMIT 1
    ) fe ON true
    LEFT JOIN LATERAL (
      SELECT identity.person_id
      FROM current_face_identity identity
      WHERE identity.face_id = fo.face_id AND identity.state = 'accepted'
      LIMIT 1
    ) accepted ON true
    WHERE fo.face_id = ${String(faceId || "")} AND fo.state = 'valid'
      AND cimmich_face_match_eligible(
        fo.detection_confidence, fo.box_w, fo.box_h
      )
      AND cimmich_visibility_asset_rank(query_asset.asset_id) <= ${presentationRank()}
  ), prime_face_evidence_raw AS (
    SELECT gallery.person_id,
      coalesce((
        SELECT 'context:' || min(context.context_id)
        FROM current_face_capture_context context
        WHERE context.face_id = gallery.face_id
      ), 'asset:' || reference_face.asset_id) AS evidence_unit,
      (1 - (gallery.embedding <=> query.embedding))::float8 AS score
    FROM query
    JOIN matching_gallery gallery
      ON gallery.model_family = query.model_family
      AND gallery.model_version = query.model_version
      AND gallery.config_digest = query.config_digest
      AND gallery.dimension = query.dimension
      AND gallery.bucket_kind = 'prime'
    JOIN face_observation reference_face
      ON reference_face.face_id = gallery.face_id AND reference_face.state = 'valid'
    WHERE reference_face.asset_id <> query.asset_id
      AND cimmich_visibility_asset_rank(reference_face.asset_id) <= ${presentationRank()}
      AND gallery.person_id IS DISTINCT FROM query.current_person_id
      AND NOT EXISTS (
        SELECT 1
        FROM current_face_capture_context reference_context
        WHERE reference_context.face_id = gallery.face_id
          AND reference_context.context_id = ANY(query.query_context_ids)
      )
  ), prime_face_evidence AS (
    SELECT person_id, evidence_unit, max(score)::float8 AS score
    FROM prime_face_evidence_raw
    GROUP BY person_id, evidence_unit
  ), prime_face_ranked AS (
    SELECT *, row_number() OVER (
      PARTITION BY person_id ORDER BY score DESC, evidence_unit
    ) AS evidence_rank
    FROM prime_face_evidence
  ), individual_scores AS (
    SELECT person_id, max(score)::float8 AS individual_max,
      avg(score) FILTER (WHERE evidence_rank <= 3)::float8 AS individual_top3
    FROM prime_face_ranked
    GROUP BY person_id
  ), prototype_scores AS (
    SELECT prototype.person_id,
      max(1 - (prototype.embedding <=> query.embedding))::float8 AS prototype_score
    FROM query
    JOIN current_reference_prototype prototype
      ON prototype.model_family = query.model_family
      AND prototype.model_version = query.model_version
      AND prototype.config_digest = query.config_digest
      AND prototype.dimension = query.dimension
    JOIN reference_bucket bucket
      ON bucket.bucket_id = prototype.bucket_id AND bucket.bucket_kind = 'prime'
    WHERE prototype.person_id IS DISTINCT FROM query.current_person_id
      AND cardinality(query.query_context_ids) = 0
      AND EXISTS (
        SELECT 1
        FROM current_face_identity visible_identity
        JOIN face_observation visible_face
          ON visible_face.face_id = visible_identity.face_id
          AND visible_face.state = 'valid'
        WHERE visible_identity.person_id = prototype.person_id
          AND visible_identity.state = 'accepted'
          AND cimmich_visibility_asset_rank(visible_face.asset_id) <= ${presentationRank()}
      )
    GROUP BY prototype.person_id
  ), prime_scores AS (
    SELECT individual.person_id,
      individual.individual_max::float8 AS raw_prime_score,
      individual.individual_max::float8 AS prime_score,
      individual.individual_top3,
      prototype.prototype_score
    FROM individual_scores individual
    LEFT JOIN prototype_scores prototype USING (person_id)
  ), ranked AS (
    SELECT person_id, raw_prime_score, prime_score, individual_top3, prototype_score,
      row_number() OVER (
        ORDER BY prime_score DESC, individual_top3 DESC NULLS LAST,
          prototype_score DESC NULLS LAST, person_id
      )::int AS rank,
      lead(prime_score) OVER (
        ORDER BY prime_score DESC, individual_top3 DESC NULLS LAST,
          prototype_score DESC NULLS LAST, person_id
      )::float8 AS runner_up_score
    FROM prime_scores
  )
  SELECT ranked.rank, ranked.person_id, person.display_name,
    ranked.prime_score, ranked.raw_prime_score,
    ranked.individual_top3 AS prime_top3_score, ranked.prototype_score,
    greatest(
      0, ranked.prime_score - coalesce(ranked.runner_up_score, -1)
    )::float8 AS lead_margin,
    query.score_floor, query.margin_floor,
    (
      ranked.rank = 1
      AND ranked.prime_score >= query.score_floor
      AND greatest(
        0, ranked.prime_score - coalesce(ranked.runner_up_score, -1)
      ) >= query.margin_floor
    ) AS governed_candidate,
    secondary.secondary_score
  FROM ranked
  JOIN current_person person ON person.person_id = ranked.person_id
    AND person.status = 'active' AND person.subject_kind = 'person'
    AND cimmich_visibility_person_rank(person.person_id) <= ${presentationRank()}
    AND EXISTS (
      SELECT 1
      FROM current_face_identity visible_identity
      JOIN face_observation visible_face
        ON visible_face.face_id = visible_identity.face_id
        AND visible_face.state = 'valid'
      WHERE visible_identity.person_id = ranked.person_id
        AND visible_identity.state = 'accepted'
        AND cimmich_visibility_asset_rank(visible_face.asset_id) <= ${presentationRank()}
    )
  CROSS JOIN query
  LEFT JOIN LATERAL (
    SELECT max(1 - (gallery.embedding <=> query.embedding))::float8 AS secondary_score
    FROM matching_gallery gallery
    JOIN face_observation reference_face
      ON reference_face.face_id = gallery.face_id AND reference_face.state = 'valid'
    WHERE gallery.person_id = ranked.person_id
      AND gallery.bucket_kind = 'secondary'
      AND gallery.model_family = query.model_family
      AND gallery.model_version = query.model_version
      AND gallery.config_digest = query.config_digest
      AND gallery.dimension = query.dimension
      AND reference_face.asset_id <> query.asset_id
      AND cimmich_visibility_asset_rank(reference_face.asset_id) <= ${presentationRank()}
      AND NOT EXISTS (
        SELECT 1
        FROM current_face_capture_context reference_context
        WHERE reference_context.face_id = gallery.face_id
          AND reference_context.context_id = ANY(query.query_context_ids)
      )
  ) secondary ON true
  ORDER BY ranked.rank
  LIMIT ${boundedLimit}
`;
    return rows;
  };
