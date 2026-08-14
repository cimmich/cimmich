import { parseVector } from "./prime-curator.mjs";

const embedding = (value) => [...parseVector(value)];

export const cleanIdentityAuditDetectorDigest = (value) => {
  const digest = String(value || "").trim();
  if (!digest) return "";
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw Object.assign(
      new Error("Identity audit detector configuration is invalid"),
      { code: "IDENTITY_AUDIT_DETECTOR_INVALID", statusCode: 400 },
    );
  }
  return digest;
};

export const requireIdentityAuditScoringRoute = (
  localScorer,
  databaseScoringEnabled,
) => {
  if (localScorer || databaseScoringEnabled) return;
  throw Object.assign(
    new Error(
      "Run the identity audit from the paired Mac worker; X1 database scoring is disabled",
    ),
    {
      code: "IDENTITY_AUDIT_LOCAL_WORKER_REQUIRED",
      statusCode: 409,
    },
  );
};

const scoreBatches = async (scorer, kind, rows, eligibleQueries) => {
  const scored = [];
  let comparableQueries = 0;
  for (let offset = 0; offset < rows.length; offset += 1_000) {
    const batch = rows.slice(offset, offset + 1_000).map((row) => ({
      assetId: row.asset_id,
      assignedPersonId: row.assigned_person_id || null,
      contextIds: row.context_ids,
      embedding: embedding(row.embedding),
      excludedPersonIds: row.excluded_person_ids,
      faceId: row.face_id,
    }));
    const result = await scorer.audit({ kind, queries: batch });
    comparableQueries += result.comparableQueries;
    scored.push(...result.results);
  }
  const projected = scored.map((row) => ({
    asset_id: row.assetId,
    assigned_person_id: row.assignedPersonId,
    comparison_score: row.comparisonScore,
    face_id: row.faceId,
    margin: row.margin,
    suggested_person_id: row.personId,
    suggested_reference_asset_id: row.referenceAssetId,
    suggested_score: row.score,
  }));
  if (projected.length === 0) {
    return {
      comparableQueries,
      rows: [{ eligible_queries: eligibleQueries }],
    };
  }
  projected[0].eligible_queries = eligibleQueries;
  return { comparableQueries, rows: projected };
};

export const scoreIdentityAuditLocally = async (
  sql,
  { frontierLimit, packId, presentationRank, scorer },
) => {
  const gallery = await sql`
    SELECT DISTINCT ON (reference.person_id, physical.physical_face_id)
      reference.person_id, reference.face_id, face.asset_id,
      reference.embedding::text AS embedding,
      coalesce(context.context_ids, ARRAY[]::text[]) AS context_ids
    FROM source_pack_matching_gallery reference
    JOIN current_face_physical_member physical
      ON physical.face_id = reference.face_id
    JOIN current_person person
      ON person.person_id = reference.person_id
      AND person.status = 'active'
      AND person.subject_kind = 'person'
      AND cimmich_visibility_person_rank(person.person_id) <= ${presentationRank}
    JOIN face_observation face
      ON face.face_id = reference.face_id AND face.state = 'valid'
    LEFT JOIN LATERAL (
      SELECT array_agg(capture.context_id ORDER BY capture.context_id)
        AS context_ids
      FROM current_face_capture_context capture
      WHERE capture.face_id = reference.face_id
    ) context ON true
    WHERE reference.pack_id = ${packId}
      AND reference.bucket_kind = 'prime'
      AND reference.reference_kind = 'face'
      AND NOT EXISTS (
        SELECT 1 FROM current_person_category category
        WHERE category.person_id = person.person_id
          AND category.slug IN ('sort', 'holding')
      )
    ORDER BY reference.person_id, physical.physical_face_id,
      reference.face_id
  `;
  await scorer.initialize(
    gallery.map((row) => ({
      assetId: row.asset_id,
      contextIds: row.context_ids,
      embedding: embedding(row.embedding),
      faceId: row.face_id,
      personId: row.person_id,
    })),
  );

  const untagged = await sql`
    WITH candidate_claims AS MATERIALIZED (
      SELECT claim.*
      FROM identity_claim claim
      WHERE claim.state = 'candidate'
        AND claim.origin = 'prime_match'
        AND claim.evidence_refs->>'assignment_decision' =
          'source_pack_prime_match'
        AND claim.evidence_refs->>'source_pack_id' = ${packId}
    ), latest_face_reviews AS MATERIALIZED (
      SELECT DISTINCT ON (review.subject_id)
        review.subject_id AS face_id, review.reason_code
      FROM decision review
      JOIN candidate_claims candidate ON candidate.face_id = review.subject_id
      WHERE review.subject_type = 'face_review'
      ORDER BY review.subject_id, review.created_at DESC, review.decision_id DESC
    ), eligible AS MATERIALIZED (
      SELECT canonical.face_id, canonical.asset_id,
        claim.person_id AS suggested_person_id,
        claim.calibrated_confidence::float8 AS suggested_score,
        nullif(claim.evidence_refs->>'second_best_score', '')::float8
          AS comparison_score,
        nullif(claim.evidence_refs->>'margin', '')::float8 AS margin,
        claim.evidence_refs->>'reference_asset_id'
          AS suggested_reference_asset_id
      FROM candidate_claims claim
      JOIN source_pack pack
        ON pack.pack_id = claim.evidence_refs->>'source_pack_id'
        AND pack.pack_id = ${packId}
        AND pack.state = 'active'
        AND pack.evaluation_status = 'passed'
        AND pack.evaluation_summary->'matcherPolicy'->>'policyVersion' =
          claim.evidence_refs->>'policy_version'
      JOIN current_person person ON person.person_id = claim.person_id
        AND person.status = 'active' AND person.subject_kind = 'person'
        AND cimmich_visibility_person_rank(person.person_id) <= ${presentationRank}
      JOIN current_face_physical_member physical ON physical.face_id = claim.face_id
        AND physical.reconciliation_state <> 'conflict'
      JOIN face_observation canonical
        ON canonical.face_id = physical.canonical_face_id
        AND canonical.state = 'valid'
      JOIN asset ON asset.asset_id = canonical.asset_id
        AND asset.state = 'active'
        AND cimmich_visibility_asset_rank(asset.asset_id) <= ${presentationRank}
      LEFT JOIN latest_face_reviews review ON review.face_id = canonical.face_id
      WHERE claim.state = 'candidate'
        AND claim.origin = 'prime_match'
        AND claim.evidence_refs->>'assignment_decision' =
          'source_pack_prime_match'
        AND cimmich_face_match_eligible(
          canonical.detection_confidence, canonical.box_w, canonical.box_h
        )
        AND coalesce(review.reason_code, '') NOT IN (
          'face_review_unknown', 'face_review_later', 'face_review_geometry'
        )
        AND NOT EXISTS (
          SELECT 1 FROM current_physical_face_identity accepted
          WHERE accepted.physical_face_id = physical.physical_face_id
            AND accepted.state = 'accepted'
        )
        AND cimmich_person_candidate_reviewable(
          claim.origin, claim.evidence_refs, pack.pack_id
        )
      ORDER BY claim.calibrated_confidence DESC, claim.identity_claim_id
      LIMIT ${frontierLimit}
    )
    SELECT count(*) OVER ()::int AS eligible_queries, eligible.*
    FROM eligible
  `;
  if (untagged.length === 0) untagged.push({ eligible_queries: 0 });

  const contradictionRows = await sql`
    WITH face_contexts AS MATERIALIZED (
      SELECT face_id, array_agg(context_id ORDER BY context_id) AS context_ids
      FROM current_face_capture_context
      GROUP BY face_id
    ), accepted_physical AS MATERIALIZED (
      SELECT DISTINCT ON (member.physical_face_id, claim.person_id)
        member.physical_face_id, member.canonical_face_id,
        claim.person_id
      FROM identity_claim claim
      JOIN current_face_physical_member member ON member.face_id = claim.face_id
      WHERE claim.state = 'accepted'
        AND member.reconciliation_state <> 'conflict'
      ORDER BY member.physical_face_id, claim.person_id,
        claim.identity_claim_id
    ), eligible_queries AS MATERIALIZED (
      SELECT face.face_id, face.asset_id,
        claim.person_id AS assigned_person_id,
        embedding.embedding::text AS embedding,
        face.detection_confidence::float8,
        coalesce((face.quality_measurements->>'quality_score')::float8, 0)
          AS quality_score,
        coalesce(context.context_ids, ARRAY[]::text[]) AS context_ids
      FROM accepted_physical claim
      JOIN face_observation face
        ON face.face_id = claim.canonical_face_id
        AND face.state = 'valid'
      JOIN source_pack pack ON pack.pack_id = ${packId}
      JOIN face_embedding embedding
        ON embedding.face_id = face.face_id
        AND embedding.state = 'active'
        AND embedding.model_family = pack.model_family
        AND embedding.model_version = pack.model_version
        AND embedding.config_digest = pack.config_digest
      JOIN asset ON asset.asset_id = face.asset_id
        AND asset.state = 'active'
        AND cimmich_visibility_asset_rank(asset.asset_id) <= ${presentationRank}
      LEFT JOIN face_contexts context ON context.face_id = face.face_id
    ), accepted_people_by_asset AS MATERIALIZED (
      SELECT asset_id,
        array_agg(DISTINCT assigned_person_id ORDER BY assigned_person_id)
          AS person_ids
      FROM eligible_queries
      GROUP BY asset_id
    ), frontier AS MATERIALIZED (
      SELECT eligible.*
      FROM eligible_queries eligible
      ORDER BY eligible.quality_score DESC,
        eligible.detection_confidence DESC, eligible.face_id
      LIMIT ${frontierLimit}
    )
    SELECT frontier.face_id, frontier.asset_id,
      frontier.assigned_person_id, frontier.embedding,
      frontier.context_ids,
      coalesce(same_photo.person_ids, ARRAY[]::text[])
        AS excluded_person_ids,
      (SELECT count(*)::int FROM eligible_queries) AS eligible_queries
    FROM frontier
    LEFT JOIN accepted_people_by_asset same_photo_all
      ON same_photo_all.asset_id = frontier.asset_id
    LEFT JOIN LATERAL (
      SELECT array_agg(person_id ORDER BY person_id) AS person_ids
      FROM unnest(coalesce(same_photo_all.person_ids, ARRAY[]::text[])) person_id
      WHERE person_id <> frontier.assigned_person_id
    ) same_photo ON true
    ORDER BY frontier.quality_score DESC,
      frontier.detection_confidence DESC, frontier.face_id
  `;
  const contradictionEligible = Number(
    contradictionRows[0]?.eligible_queries || 0,
  );
  const contradiction = await scoreBatches(
    scorer,
    "accepted_contradiction",
    contradictionRows,
    contradictionEligible,
  );
  return {
    contradiction: contradiction.rows,
    contradictionComparable: contradiction.comparableQueries,
    contradictionEligible,
    untagged,
    untaggedEligible: Number(untagged[0]?.eligible_queries || 0),
  };
};
