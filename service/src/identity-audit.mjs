import { createHash, randomUUID } from "node:crypto";
import { createIdentityAuditDecisions } from "./identity-audit-decisions.mjs";
import { createIdentityAuditLeads } from "./identity-audit-leads.mjs";
import { identityAuditConfidenceBand } from "./identity-audit-projection.mjs";
export const identityAuditSchemaVersion = "cimmich.identity-audit.v2";
export const identityAuditPolicyVersion = "cimmich-best-prime-v1";
export const identityAuditIndependenceScoreFloor = 0.75;
// Provider similarity is a 0..1 score. Replayed comparisons of the same byte
// pair may differ in the last float bits across runs, so agreement and the
// same-photo decision both tolerate scale-appropriate noise instead of using
// exact float equality (which failed whole audit runs on last-bit replays).
export const identityAuditSimilarityEpsilon = 1e-6;
// The full audit scores every eligible query Face against the whole prime
// gallery in one statement, which is unbounded O(queries x gallery). The
// query side is therefore capped the same way repository.mjs bounds
// machineSuggestions: one deterministic ranked frontier. The default sits far
// above any realistic library so it is behavior-preserving; when a library
// does exceed it, the truncation is reported (never silent) via a structured
// IDENTITY_AUDIT_QUERY_FRONTIER_TRUNCATED warning.
export const identityAuditQueryFrontierLimit = 50_000;
// Independent-evidence verification runs two provider comparisons per
// candidate. The historical behavior (no candidate bound, two concurrent
// verification lanes) stays the default; both are configurable knobs now.
export const identityAuditIndependenceConcurrency = 2;
export const identityAuditIndependenceComparisonLimit =
  Number.POSITIVE_INFINITY;
// Both audit transactions run under these bounds. The reconcile sweep's
// interrupt threshold must exceed the longest stretch a healthy run can go
// without touching its own run row - one full audit transaction - or the
// sweep fails legitimate long runs and their completion UPDATE (gated on
// state = 'running') silently discards the finished output. Phase boundaries
// and the provider loop heartbeat last_progress_at, so the worst healthy gap
// is one transaction bound; the margin covers clock skew and scheduling.
export const identityAuditStatementTimeoutMs = 1_800_000;
export const identityAuditTransactionTimeoutMs = 1_860_000;
export const identityAuditInterruptThresholdMs =
  identityAuditTransactionTimeoutMs + 4 * 60_000;
export const identityAuditHeartbeatIntervalMs = 60_000;
const cleanFrontierLimit = (value, fallback) => {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
};
const cleanComparisonLimit = (value, fallback) => {
  const parsed = Number(value ?? fallback);
  return parsed === Number.POSITIVE_INFINITY ||
    (Number.isInteger(parsed) && parsed >= 1)
    ? parsed
    : fallback;
};
const cleanConcurrency = (value, fallback) => {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 16
    ? parsed
    : fallback;
};
const cleanLimit = (value) =>
  Math.min(50, Math.max(1, Number.parseInt(String(value || 20), 10) || 20));
const cleanOffset = (value) =>
  Math.max(0, Number.parseInt(String(value || 0), 10) || 0);
const cleanKind = (value) =>
  value === "accepted_contradiction"
    ? "accepted_contradiction"
    : "untagged_match";
const cleanDetectorConfigDigest = (value) => {
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
export const carryForwardIdentityAuditDismissals = async (
  sql,
  { kind, runId } = {},
) => {
  const auditKind = cleanKind(kind);
  await sql`
    WITH previous AS (
      SELECT DISTINCT ON (current.face_id)
        current.face_id, prior.reviewed_at, prior.reviewed_by
      FROM identity_audit_item current
      JOIN identity_audit_item prior
        ON prior.audit_run_id <> current.audit_run_id
        AND prior.audit_kind = current.audit_kind
        AND prior.face_id = current.face_id
        AND prior.suggested_person_id = current.suggested_person_id
        AND prior.assigned_person_id IS NOT DISTINCT FROM
          current.assigned_person_id
        AND prior.review_state = 'dismissed'
      JOIN identity_audit_run prior_run
        ON prior_run.audit_run_id = prior.audit_run_id
        AND prior_run.state = 'completed'
      WHERE current.audit_run_id = ${runId}
        AND current.audit_kind = ${auditKind}
        AND current.review_state = 'open'
      ORDER BY current.face_id, prior.reviewed_at DESC, prior.audit_run_id DESC
    )
    UPDATE identity_audit_item current
    SET review_state = 'dismissed',
      reviewed_at = previous.reviewed_at,
      reviewed_by = previous.reviewed_by
    FROM previous
    WHERE current.audit_run_id = ${runId}
      AND current.audit_kind = ${auditKind}
      AND current.face_id = previous.face_id
      AND current.review_state = 'open'
  `;
};
const projectRun = (row, currentPackId = null) =>
  row
    ? {
        acceptedComparableFaces: Number(row.accepted_comparable_faces || 0),
        acceptedEmbeddedFaces: Number(row.accepted_embedded_faces || 0),
        auditRunId: row.audit_run_id,
        completedAt: row.completed_at || null,
        contradictionCandidates: Number(row.contradiction_candidates || 0),
        derivativeCandidatesSuppressed: Number(
          row.derivative_candidates_suppressed || 0,
        ),
        errorCode: row.error_code || null,
        independenceProviderConfigDigest:
          row.independence_provider_config_digest || null,
        independenceScoreFloor: Number(
          row.independence_score_floor ?? identityAuditIndependenceScoreFloor,
        ),
        marginFloor: Number(row.margin_floor),
        packId: row.pack_id,
        policyVersion: row.policy_version,
        schemaVersion: identityAuditSchemaVersion,
        stale: row.state === "completed" && currentPackId !== row.pack_id,
        startedAt: row.started_at,
        state: row.state,
        scoreFloor: Number(row.score_floor),
        untaggedCandidates: Number(row.untagged_candidates || 0),
        untaggedEmbeddedFaces: Number(row.untagged_embedded_faces || 0),
      }
    : null;

const auditSql = async (
  sql,
  runId,
  packId,
  presentationRank,
  scoreFloor,
  marginFloor,
  { baseRunId = "", incrementalFaceIds = [], queryFrontierLimit } = {},
) => {
  const incremental = incrementalFaceIds.length > 0;
  const frontierLimit = cleanFrontierLimit(
    queryFrontierLimit,
    identityAuditQueryFrontierLimit,
  );
  const reportFrontierTruncation = (auditKind, eligibleQueries) => {
    if (eligibleQueries <= frontierLimit) return;
    console.warn(
      JSON.stringify({
        auditKind,
        code: "IDENTITY_AUDIT_QUERY_FRONTIER_TRUNCATED",
        eligibleQueries,
        queryFrontierLimit: frontierLimit,
        runId,
      }),
    );
  };
  // One definition of the visible prime reference gallery shared across both
  // transactions used by the untagged and accepted-contradiction audits.
  const primeReferenceGallery = (executor) => executor`
      SELECT DISTINCT ON (reference.person_id, physical.physical_face_id)
        reference.person_id, reference.face_id,
        face.asset_id, reference.embedding,
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
      LEFT JOIN face_contexts context ON context.face_id = reference.face_id
      WHERE reference.pack_id = ${packId}
        AND reference.bucket_kind = 'prime'
        AND reference.reference_kind = 'face'
        AND NOT EXISTS (
          SELECT 1 FROM current_person_category category
          WHERE category.person_id = person.person_id
            AND category.slug IN ('sort', 'holding')
        )
      ORDER BY reference.person_id, physical.physical_face_id,
        reference.face_id`;
  await sql.begin(async (tx) => {
    await tx`
      SELECT set_config('statement_timeout',
          ${String(identityAuditStatementTimeoutMs)}, true),
        set_config('transaction_timeout',
          ${String(identityAuditTransactionTimeoutMs)}, true)
    `;
    if (incremental) {
      await tx`
        INSERT INTO identity_audit_item (
          audit_run_id, audit_kind, face_id, asset_id, assigned_person_id,
          suggested_person_id, suggested_score, comparison_score, margin,
          review_state, reviewed_at, reviewed_by, created_at, privacy_class,
          suggested_reference_asset_id
        )
        SELECT ${runId}, prior.audit_kind, prior.face_id, prior.asset_id,
          prior.assigned_person_id, prior.suggested_person_id,
          prior.suggested_score, prior.comparison_score, prior.margin,
          prior.review_state, prior.reviewed_at, prior.reviewed_by,
          prior.created_at, prior.privacy_class,
          prior.suggested_reference_asset_id
        FROM identity_audit_item prior
        JOIN identity_audit_run prior_run
          ON prior_run.audit_run_id = prior.audit_run_id
          AND prior_run.state = 'completed'
          AND prior_run.pack_id = ${packId}
          AND prior_run.policy_version = ${identityAuditPolicyVersion}
        JOIN face_observation face
          ON face.face_id = prior.face_id AND face.state = 'valid'
        WHERE prior.audit_run_id = ${baseRunId}
          AND prior.face_id <> ALL(${incrementalFaceIds})
          AND (prior.audit_kind <> 'untagged_match' OR cimmich_face_match_eligible(face.detection_confidence, face.box_w, face.box_h))
          AND NOT EXISTS (
            SELECT 1
            FROM current_face_identity same_photo_identity JOIN face_observation same_photo_face
              ON same_photo_face.face_id = same_photo_identity.face_id
              AND same_photo_face.state = 'valid'
            WHERE same_photo_identity.state = 'accepted'
              AND same_photo_identity.person_id = prior.suggested_person_id
              AND same_photo_face.asset_id = prior.asset_id
              AND same_photo_face.face_id <> prior.face_id
          )
          AND (
            (prior.audit_kind = 'untagged_match' AND NOT EXISTS (
              SELECT 1 FROM current_face_identity current
              WHERE current.face_id = prior.face_id
                AND current.state = 'accepted'
            ))
            OR
            (prior.audit_kind = 'accepted_contradiction' AND EXISTS (
              SELECT 1 FROM current_face_identity current
              WHERE current.face_id = prior.face_id
                AND current.state = 'accepted'
                AND current.person_id = prior.assigned_person_id
            ))
          )
      `;
    }
    const [untaggedFrontier] = await tx`
      WITH face_contexts AS MATERIALIZED (
        SELECT face_id, array_agg(context_id ORDER BY context_id) AS context_ids
        FROM current_face_capture_context
        GROUP BY face_id
      ), accepted_people_by_asset AS MATERIALIZED (
        SELECT DISTINCT face.asset_id, claim.person_id
        FROM current_physical_face_identity claim
        JOIN current_matchable_physical_face face
          ON face.physical_face_id = claim.physical_face_id
          AND face.state = 'valid'
        WHERE claim.state = 'accepted'
      ), query_candidates AS MATERIALIZED (
        SELECT face.face_id, face.physical_face_id, face.asset_id,
          embedding.embedding,
          face.box_x::float8, face.box_y::float8,
          face.box_w::float8, face.box_h::float8,
          face.detection_confidence::float8,
          coalesce(
            (face.quality_measurements->>'quality_score')::float8, 0
          ) AS quality_score,
          coalesce(context.context_ids, ARRAY[]::text[]) AS context_ids
        FROM current_matchable_physical_face face
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
        WHERE face.state = 'valid'
          AND cimmich_face_match_eligible(face.detection_confidence, face.box_w, face.box_h)
          AND coalesce((SELECT review.reason_code FROM decision review WHERE review.subject_type = 'face_review' AND review.subject_id = face.face_id ORDER BY review.created_at DESC, review.decision_id DESC LIMIT 1), '') NOT IN ('face_review_unknown', 'face_review_later', 'face_review_geometry')
          AND (
            ${!incremental}
            OR EXISTS (
              SELECT 1
              FROM current_face_physical_member changed
              WHERE changed.face_id = ANY(${incrementalFaceIds})
                AND changed.physical_face_id = face.physical_face_id
            )
          )
          AND NOT EXISTS (
            SELECT 1 FROM current_physical_face_identity accepted
            WHERE accepted.physical_face_id = face.physical_face_id
              AND accepted.state = 'accepted'
          )
      ), eligible_queries AS MATERIALIZED (
        SELECT candidate.face_id, candidate.physical_face_id,
          candidate.asset_id, candidate.embedding,
          candidate.detection_confidence, candidate.quality_score,
          candidate.context_ids
        FROM query_candidates candidate
        WHERE NOT EXISTS (
          SELECT 1
          FROM query_candidates stronger
          CROSS JOIN LATERAL (
            SELECT
              greatest(
                0::float8,
                least(
                  candidate.box_x + candidate.box_w,
                  stronger.box_x + stronger.box_w
                ) - greatest(candidate.box_x, stronger.box_x)
              ) * greatest(
                0::float8,
                least(
                  candidate.box_y + candidate.box_h,
                  stronger.box_y + stronger.box_h
                ) - greatest(candidate.box_y, stronger.box_y)
              ) AS intersection
          ) overlap
          WHERE stronger.asset_id = candidate.asset_id
            AND stronger.face_id <> candidate.face_id
            AND (
              coalesce(stronger.detection_confidence, 0) >
                coalesce(candidate.detection_confidence, 0)
              OR (
                coalesce(stronger.detection_confidence, 0) =
                  coalesce(candidate.detection_confidence, 0)
                AND stronger.face_id < candidate.face_id
              )
            )
            AND candidate.box_w > 0 AND candidate.box_h > 0
            AND stronger.box_w > 0 AND stronger.box_h > 0
            AND (
              overlap.intersection / greatest(
                0.000001::float8,
                candidate.box_w * candidate.box_h +
                  stronger.box_w * stronger.box_h -
                  overlap.intersection
              ) >= 0.62
              OR (
                overlap.intersection / greatest(
                  0.000001::float8,
                  least(
                    candidate.box_w * candidate.box_h,
                    stronger.box_w * stronger.box_h
                  )
                ) >= 0.5
                AND abs(
                  candidate.box_x + candidate.box_w / 2 -
                    stronger.box_x - stronger.box_w / 2
                ) / greatest(
                  0.000001::float8,
                  least(candidate.box_w, stronger.box_w)
                ) <= 0.45
                AND abs(
                  candidate.box_y + candidate.box_h / 2 -
                    stronger.box_y - stronger.box_h / 2
                ) / greatest(
                  0.000001::float8,
                  least(candidate.box_h, stronger.box_h)
                ) <= 0.25
              )
            )
        )
      ), queries AS MATERIALIZED (
        -- Bounded comparison frontier: deterministic quality-first ranking,
        -- mirroring the machineSuggestions frontier policy in repository.mjs.
        SELECT eligible.face_id, eligible.physical_face_id,
          eligible.asset_id, eligible.embedding,
          eligible.context_ids
        FROM eligible_queries eligible
        ORDER BY eligible.quality_score DESC,
          eligible.detection_confidence DESC, eligible.face_id
        LIMIT ${frontierLimit}
      ), gallery AS MATERIALIZED (
        ${primeReferenceGallery(tx)}
      ), person_scores AS MATERIALIZED (
        SELECT query.face_id, query.asset_id, gallery.person_id,
          max((1 - (gallery.embedding <=> query.embedding))::float8) AS score,
          (array_agg(
            gallery.asset_id
            ORDER BY gallery.embedding <=> query.embedding, gallery.face_id
          ))[1] AS reference_asset_id
        FROM queries query
        JOIN gallery
          ON gallery.face_id <> query.face_id
          AND gallery.asset_id <> query.asset_id
          AND NOT (gallery.context_ids && query.context_ids)
        LEFT JOIN accepted_people_by_asset same_photo_person
          ON same_photo_person.asset_id = query.asset_id
          AND same_photo_person.person_id = gallery.person_id
        WHERE same_photo_person.person_id IS NULL
        GROUP BY query.face_id, query.asset_id, gallery.person_id
      ), ranked AS MATERIALIZED (
        SELECT score.*,
          row_number() OVER (
            PARTITION BY score.face_id
            ORDER BY score.score DESC, score.person_id
          ) AS candidate_rank,
          lead(score.score) OVER (
            PARTITION BY score.face_id
            ORDER BY score.score DESC, score.person_id
          ) AS next_score
        FROM person_scores score
      ), inserted AS (
        INSERT INTO identity_audit_item (
          audit_run_id, audit_kind, face_id, asset_id, suggested_person_id,
          suggested_score, comparison_score, margin,
          suggested_reference_asset_id
        )
        -- margin mirrors matcherPolicyMargin (source-pack-evaluator.mjs), the
        -- definition the SourcePack marginFloor gates were tuned against.
        SELECT ${runId}, 'untagged_match', face_id, asset_id, person_id,
          score, next_score,
          greatest(0, score - coalesce(next_score, -1)),
          reference_asset_id
        FROM ranked
        WHERE candidate_rank = 1
          AND score >= ${scoreFloor}
          AND greatest(0, score - coalesce(next_score, -1)) >= ${marginFloor}
          AND NOT cimmich_probable_same_photo_derivative(
            ${packId}, asset_id, reference_asset_id
          )
        RETURNING face_id
      )
      SELECT (SELECT count(*) FROM eligible_queries)::int AS eligible_queries,
        (SELECT count(*) FROM inserted)::int AS inserted_items
    `;
    reportFrontierTruncation(
      "untagged_match",
      Number(untaggedFrontier?.eligible_queries || 0),
    );
    await carryForwardIdentityAuditDismissals(tx, {
      kind: "untagged_match",
      runId,
    });
    const [coverage] = await tx`
      SELECT count(*)::int AS embedded_faces
      FROM face_observation face
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
      WHERE face.state = 'valid'
        AND cimmich_face_match_eligible(face.detection_confidence, face.box_w, face.box_h)
        AND NOT EXISTS (
          SELECT 1 FROM current_face_identity accepted
          WHERE accepted.face_id = face.face_id AND accepted.state = 'accepted'
        )
    `;
    await tx`
      UPDATE identity_audit_run
      SET last_progress_at = now(),
        untagged_embedded_faces = ${Number(coverage?.embedded_faces || 0)},
        untagged_candidates = (
          SELECT count(*)::int FROM identity_audit_item
          WHERE audit_run_id = ${runId}
            AND audit_kind = 'untagged_match'
            AND review_state = 'open'
        )
      WHERE audit_run_id = ${runId}
    `;
  });

  if (incremental) {
    await sql`
      UPDATE identity_audit_run current
      SET last_progress_at = now(),
        accepted_embedded_faces = base.accepted_embedded_faces,
        accepted_comparable_faces = base.accepted_comparable_faces,
        contradiction_candidates = (
          SELECT count(*)::int FROM identity_audit_item
          WHERE audit_run_id = ${runId}
            AND audit_kind = 'accepted_contradiction'
            AND review_state = 'open'
        )
      FROM identity_audit_run base
      WHERE current.audit_run_id = ${runId}
        AND base.audit_run_id = ${baseRunId}
        AND base.state = 'completed'
        AND base.pack_id = current.pack_id
        AND base.policy_version = current.policy_version
    `;
    return;
  }

  await sql.begin(async (tx) => {
    await tx`
      SELECT set_config('statement_timeout',
          ${String(identityAuditStatementTimeoutMs)}, true),
        set_config('transaction_timeout',
          ${String(identityAuditTransactionTimeoutMs)}, true)
    `;
    const [contradictionFrontier] = await tx`
      WITH face_contexts AS MATERIALIZED (
        SELECT face_id, array_agg(context_id ORDER BY context_id) AS context_ids
        FROM current_face_capture_context
        GROUP BY face_id
      ), accepted_people_by_asset AS MATERIALIZED (
        SELECT DISTINCT face.asset_id, claim.person_id
        FROM current_face_identity claim
        JOIN face_observation face
          ON face.face_id = claim.face_id AND face.state = 'valid'
        WHERE claim.state = 'accepted'
      ), eligible_queries AS MATERIALIZED (
        SELECT face.face_id, face.asset_id,
          claim.person_id AS assigned_person_id, embedding.embedding,
          face.detection_confidence::float8,
          coalesce(
            (face.quality_measurements->>'quality_score')::float8, 0
          ) AS quality_score,
          coalesce(context.context_ids, ARRAY[]::text[]) AS context_ids
        FROM current_face_identity claim
        JOIN face_observation face
          ON face.face_id = claim.face_id AND face.state = 'valid'
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
        WHERE claim.state = 'accepted'
      ), queries AS MATERIALIZED (
        -- Bounded comparison frontier: deterministic quality-first ranking,
        -- mirroring the machineSuggestions frontier policy in repository.mjs.
        SELECT eligible.face_id, eligible.asset_id,
          eligible.assigned_person_id, eligible.embedding,
          eligible.context_ids
        FROM eligible_queries eligible
        ORDER BY eligible.quality_score DESC,
          eligible.detection_confidence DESC, eligible.face_id
        LIMIT ${frontierLimit}
      ), gallery AS MATERIALIZED (
        ${primeReferenceGallery(tx)}
      ), person_scores AS MATERIALIZED (
        SELECT query.face_id, query.asset_id, query.assigned_person_id,
          gallery.person_id,
          max((1 - (gallery.embedding <=> query.embedding))::float8) AS score,
          (array_agg(
            gallery.asset_id
            ORDER BY gallery.embedding <=> query.embedding, gallery.face_id
          ))[1] AS reference_asset_id
        FROM queries query
        JOIN gallery
          ON gallery.face_id <> query.face_id
          AND gallery.asset_id <> query.asset_id
          AND NOT (gallery.context_ids && query.context_ids)
        LEFT JOIN accepted_people_by_asset same_photo_person
          ON same_photo_person.asset_id = query.asset_id
          AND same_photo_person.person_id = gallery.person_id
          AND gallery.person_id <> query.assigned_person_id
        WHERE same_photo_person.person_id IS NULL
        GROUP BY query.face_id, query.asset_id, query.assigned_person_id,
          gallery.person_id
      ), assigned AS MATERIALIZED (
        SELECT face_id, asset_id, assigned_person_id,
          score AS assigned_score,
          reference_asset_id AS assigned_reference_asset_id
        FROM person_scores
        WHERE person_id = assigned_person_id
      ), alternatives AS MATERIALIZED (
        SELECT face_id, person_id AS alternative_person_id,
          score AS alternative_score,
          reference_asset_id AS alternative_reference_asset_id
        FROM (
          SELECT face_id, assigned_person_id, person_id, score,
            reference_asset_id,
            row_number() OVER (
              PARTITION BY face_id ORDER BY score DESC, person_id
            ) AS alternative_rank
          FROM person_scores
          WHERE person_id <> assigned_person_id
        ) candidate
        WHERE alternative_rank = 1
      ), inserted AS (
        INSERT INTO identity_audit_item (
          audit_run_id, audit_kind, face_id, asset_id, assigned_person_id,
          suggested_person_id, suggested_score, comparison_score, margin,
          suggested_reference_asset_id
        )
        SELECT ${runId}, 'accepted_contradiction', assigned.face_id,
          assigned.asset_id, assigned.assigned_person_id,
          alternatives.alternative_person_id, alternatives.alternative_score,
          assigned.assigned_score,
          alternatives.alternative_score - assigned.assigned_score,
          alternatives.alternative_reference_asset_id
        FROM assigned
        JOIN alternatives USING (face_id)
        WHERE alternatives.alternative_score >= 0.35
          AND alternatives.alternative_score - assigned.assigned_score >= 0.21
          AND NOT cimmich_probable_same_photo_derivative(
            ${packId}, assigned.asset_id,
            alternatives.alternative_reference_asset_id
          )
        RETURNING face_id
      )
      SELECT (SELECT count(*) FROM eligible_queries)::int AS eligible_queries,
        (SELECT count(*) FROM inserted)::int AS inserted_items
    `;
    reportFrontierTruncation(
      "accepted_contradiction",
      Number(contradictionFrontier?.eligible_queries || 0),
    );
    await carryForwardIdentityAuditDismissals(tx, {
      kind: "accepted_contradiction",
      runId,
    });
    const [coverage] = await tx`
      SELECT
        count(*)::int AS embedded_faces,
        count(*) FILTER (WHERE EXISTS (
          SELECT 1
          FROM source_pack_matching_gallery gallery
          JOIN current_person gallery_person
            ON gallery_person.person_id = gallery.person_id
            AND gallery_person.status = 'active'
            AND gallery_person.subject_kind = 'person'
            AND cimmich_visibility_person_rank(gallery_person.person_id)
              <= ${presentationRank}
          JOIN face_observation reference
            ON reference.face_id = gallery.face_id
            AND reference.state = 'valid'
            AND reference.asset_id <> face.asset_id
          WHERE gallery.pack_id = ${packId}
            AND gallery.bucket_kind = 'prime'
            AND gallery.reference_kind = 'face'
            AND gallery.person_id = claim.person_id
            AND NOT EXISTS (
              SELECT 1 FROM current_person_category category
              WHERE category.person_id = gallery.person_id
                AND category.slug IN ('sort', 'holding')
            )
            AND NOT EXISTS (
              SELECT 1
              FROM current_face_capture_context query_context
              JOIN current_face_capture_context reference_context
                ON reference_context.context_id = query_context.context_id
              WHERE query_context.face_id = face.face_id
                AND reference_context.face_id = gallery.face_id
            )
        ))::int AS comparable_faces
      FROM current_physical_face_identity claim
      JOIN current_matchable_physical_face face
        ON face.physical_face_id = claim.physical_face_id
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
      WHERE claim.state = 'accepted'
    `;
    await tx`
      UPDATE identity_audit_run
      SET last_progress_at = now(),
        accepted_embedded_faces = ${Number(coverage?.embedded_faces || 0)},
        accepted_comparable_faces = ${Number(coverage?.comparable_faces || 0)},
        contradiction_candidates = (
          SELECT count(*)::int FROM identity_audit_item
          WHERE audit_run_id = ${runId}
            AND audit_kind = 'accepted_contradiction'
            AND review_state = 'open'
        )
      WHERE audit_run_id = ${runId}
    `;
  });
};

const anonymousAssetBinding = (value, suffix) => {
  const digest = (part) =>
    createHash("sha256").update(`${suffix}:${part}`).digest("hex");
  return {
    assetToken: digest(value.asset_id),
    inputRevision: digest(value.input_revision),
    sourceContentDigest: digest(value.checksum),
  };
};

const anonymousRunId = (runId, faceId, direction) =>
  `audit-${direction}-${createHash("sha256")
    .update(`${runId}:${faceId}:${direction}`)
    .digest("hex")
    .slice(0, 40)}`;

export const suppressSamePhotoDerivatives = async (
  sql,
  {
    companion,
    comparisonConcurrency = identityAuditIndependenceConcurrency,
    comparisonLimit = identityAuditIndependenceComparisonLimit,
    provider,
    runId,
    scoreFloor = identityAuditIndependenceScoreFloor,
    sourceId = "",
    faceIds = [],
  },
) => {
  if (
    typeof companion?.readAssetImage !== "function" ||
    typeof provider?.compare !== "function" ||
    !provider?.manifest?.providerConfigDigest
  ) {
    throw Object.assign(
      new Error(
        "Identity audit independent-evidence verification is unavailable",
      ),
      { code: "IDENTITY_AUDIT_INDEPENDENCE_UNAVAILABLE" },
    );
  }
  const exactSourceId = String(sourceId || "").trim();
  const exactFaceIds = [
    ...new Set(
      faceIds.map((faceId) => String(faceId || "").trim()).filter(Boolean),
    ),
  ];
  const candidates = await sql`
    SELECT item.audit_kind, item.face_id, item.asset_id,
      item.suggested_reference_asset_id AS reference_asset_id,
      query_projection.immich_asset_id AS query_source_asset_id,
      query_projection.input_revision AS query_input_revision,
      query_projection.checksum AS query_checksum,
      reference_projection.immich_asset_id AS reference_source_asset_id,
      reference_projection.input_revision AS reference_input_revision,
      reference_projection.checksum AS reference_checksum
    FROM identity_audit_item item
    JOIN immich_asset_projection query_projection
      ON query_projection.cimmich_asset_id = item.asset_id
      AND query_projection.state = 'active'
      AND (${exactSourceId} = '' OR query_projection.source_id = ${exactSourceId})
    JOIN immich_asset_projection reference_projection
      ON reference_projection.cimmich_asset_id =
        item.suggested_reference_asset_id
      AND reference_projection.state = 'active'
      AND (${exactSourceId} = '' OR reference_projection.source_id = ${exactSourceId})
    WHERE item.audit_run_id = ${runId}
      AND item.review_state = 'open'
      AND (${exactFaceIds.length === 0} OR item.face_id = ANY(${exactFaceIds}))
      AND (
        item.audit_kind = 'accepted_contradiction'
        OR item.suggested_score >= ${scoreFloor}
      )
      AND item.suggested_reference_asset_id IS NOT NULL
    ORDER BY item.suggested_score DESC, item.margin DESC, item.face_id
  `;
  // Both knobs default to the historical behavior (no bound, two lanes). A
  // finite bound trims the already strongest-first candidate ranking, and the
  // truncation is reported rather than silent.
  const boundedComparisonLimit = cleanComparisonLimit(
    comparisonLimit,
    identityAuditIndependenceComparisonLimit,
  );
  const concurrency = cleanConcurrency(
    comparisonConcurrency,
    identityAuditIndependenceConcurrency,
  );
  const verifiable = Number.isFinite(boundedComparisonLimit)
    ? candidates.slice(0, boundedComparisonLimit)
    : candidates;
  if (verifiable.length < candidates.length) {
    console.warn(
      JSON.stringify({
        code: "IDENTITY_AUDIT_INDEPENDENCE_COMPARISONS_TRUNCATED",
        comparisonLimit: boundedComparisonLimit,
        eligibleCandidates: candidates.length,
        runId,
      }),
    );
  }
  const suppressed = [];
  let cursor = 0;
  // The provider phase has no statement timeout bounding it, so it carries
  // its own liveness signal: a throttled last_progress_at heartbeat keeps the
  // reconcile sweep from failing a run that is still verifying candidates.
  let heartbeatDueAt = Date.now() + identityAuditHeartbeatIntervalMs;
  const heartbeat = async () => {
    if (Date.now() < heartbeatDueAt) return;
    heartbeatDueAt = Date.now() + identityAuditHeartbeatIntervalMs;
    await sql`
      UPDATE identity_audit_run
      SET last_progress_at = now()
      WHERE audit_run_id = ${runId} AND state = 'running'
    `;
  };
  const verifyNext = async () => {
    while (cursor < verifiable.length) {
      // Claim the candidate before any await: another lane may advance the
      // shared cursor while this one is suspended.
      const candidate = verifiable[cursor];
      cursor += 1;
      await heartbeat();
      const [queryMedia, referenceMedia] = await Promise.all([
        companion.readAssetImage({
          assetId: candidate.query_source_asset_id,
        }),
        companion.readAssetImage({
          assetId: candidate.reference_source_asset_id,
        }),
      ]);
      const queryBinding = anonymousAssetBinding(
        {
          asset_id: candidate.asset_id,
          checksum: candidate.query_checksum,
          input_revision: candidate.query_input_revision,
        },
        "query",
      );
      const referenceBinding = anonymousAssetBinding(
        {
          asset_id: candidate.reference_asset_id,
          checksum: candidate.reference_checksum,
          input_revision: candidate.reference_input_revision,
        },
        "reference",
      );
      const first = await provider.compare({
        assets: [queryBinding, referenceBinding],
        leftBytes: queryMedia.bytes,
        rightBytes: referenceMedia.bytes,
        runId: anonymousRunId(runId, candidate.face_id, "forward"),
      });
      const replay = await provider.compare({
        assets: [referenceBinding, queryBinding],
        leftBytes: referenceMedia.bytes,
        rightBytes: queryMedia.bytes,
        runId: anonymousRunId(runId, candidate.face_id, "reverse"),
      });
      if (
        Math.abs(first.similarity - replay.similarity) >
        identityAuditSimilarityEpsilon
      ) {
        throw Object.assign(
          new Error("Identity audit independent-evidence replay did not agree"),
          { code: "IDENTITY_AUDIT_INDEPENDENCE_REPLAY_FAILED" },
        );
      }
      if (first.similarity >= 1 - identityAuditSimilarityEpsilon) {
        suppressed.push({
          auditKind: candidate.audit_kind,
          faceId: candidate.face_id,
        });
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => verifyNext()));
  await sql.begin(async (tx) => {
    for (const item of suppressed) {
      await tx`
        DELETE FROM identity_audit_item
        WHERE audit_run_id = ${runId}
          AND audit_kind = ${item.auditKind}
          AND face_id = ${item.faceId}
      `;
    }
    await tx`
      UPDATE identity_audit_run
      SET derivative_candidates_suppressed = ${suppressed.length},
        independence_provider_config_digest =
          ${provider.manifest.providerConfigDigest},
        independence_score_floor = ${scoreFloor},
        untagged_candidates = (
          SELECT count(*)::int FROM identity_audit_item
          WHERE audit_run_id = ${runId}
            AND audit_kind = 'untagged_match'
            AND review_state = 'open'
        ),
        contradiction_candidates = (
          SELECT count(*)::int FROM identity_audit_item
          WHERE audit_run_id = ${runId}
            AND audit_kind = 'accepted_contradiction'
            AND review_state = 'open'
        ),
        state = 'completed', completed_at = now()
      WHERE audit_run_id = ${runId} AND state = 'running'
    `;
  });
};

export const createIdentityAudit = (
  sql,
  {
    bridgeFields = () => ({}),
    companion,
    derivativeProvider,
    independenceComparisonLimit = identityAuditIndependenceComparisonLimit,
    independenceConcurrency = identityAuditIndependenceConcurrency,
    presentationRank = () => 0,
    queryFrontierLimit = identityAuditQueryFrontierLimit,
    sourceId = "",
  } = {},
) => {
  let runningPromise = null;
  let reconcileInterruptedRunPromise = null;
  let reconcileInterruptedRunAt = 0;
  const reconcileRearmMs = 15 * 60 * 1000;
  const reconcileInterruptedRun = async () => {
    // Stale-gated so one replica's cold start cannot fail a run another
    // replica is still driving. The sweep re-arms periodically: a
    // crash-and-fast-restart used to memoize a single too-early sweep
    // forever, leaving the wedged run unreconciled until the next restart.
    if (
      reconcileInterruptedRunPromise &&
      Date.now() - reconcileInterruptedRunAt >= reconcileRearmMs
    ) {
      reconcileInterruptedRunPromise = null;
    }
    reconcileInterruptedRunAt = reconcileInterruptedRunPromise
      ? reconcileInterruptedRunAt
      : Date.now();
    // Staleness is judged on the run's last recorded progress, not its start:
    // each audit transaction is bounded by identityAuditTransactionTimeoutMs
    // and the provider phase heartbeats, so only a run that has gone longer
    // than one transaction bound without progress is actually dead. A fixed
    // threshold below that bound failed legitimate long runs and discarded
    // their completed output.
    reconcileInterruptedRunPromise ||= sql`
      UPDATE identity_audit_run
      SET state = 'failed', completed_at = now(),
        error_code = 'IDENTITY_AUDIT_INTERRUPTED'
      WHERE state = 'running'
        AND coalesce(last_progress_at, started_at)
          < now() - make_interval(
              secs => ${identityAuditInterruptThresholdMs / 1000}
            )
    `;
    try {
      await reconcileInterruptedRunPromise;
    } catch (error) {
      reconcileInterruptedRunPromise = null;
      throw error;
    }
  };

  const latest = async () => {
    await reconcileInterruptedRun();
    const [currentPack] = await sql`
      SELECT pack_id
      FROM current_source_pack
      WHERE evaluation_status = 'passed'
      ORDER BY created_at DESC, pack_id DESC
      LIMIT 1
    `;
    const [row] = await sql`
      SELECT * FROM identity_audit_run
      ORDER BY started_at DESC, audit_run_id DESC
      LIMIT 1
    `;
    return projectRun(row, currentPack?.pack_id || null);
  };

  const start = async ({ detectorConfigDigest } = {}) => {
    await reconcileInterruptedRun();
    const existing = await latest();
    if (existing?.state === "running") return existing;
    const exactDetectorConfigDigest =
      cleanDetectorConfigDigest(detectorConfigDigest);
    const [pack] = await sql`
      SELECT pack_id,
        evaluation_summary->'matcherPolicy'->>'policyVersion' AS policy_version,
        (evaluation_summary->'matcherPolicy'->>'scoreFloor')::float8 AS score_floor,
        (evaluation_summary->'matcherPolicy'->>'marginFloor')::float8 AS margin_floor
      FROM current_source_pack
      WHERE evaluation_status = 'passed'
        AND evaluation_summary->'matcherPolicy'->>'policyVersion'
          = ${identityAuditPolicyVersion}
        AND evaluation_summary->'matcherPolicy'->>'scorer'
          = 'best_individual_prime'
        AND jsonb_typeof(evaluation_summary->'matcherPolicy'->'scoreFloor')
          = 'number'
        AND jsonb_typeof(evaluation_summary->'matcherPolicy'->'marginFloor')
          = 'number'
      ORDER BY created_at DESC, pack_id DESC
      LIMIT 1
    `;
    if (!pack) {
      throw Object.assign(
        new Error(
          "Activate a passed SourcePack before running an identity audit",
        ),
        { code: "IDENTITY_AUDIT_SOURCE_PACK_UNAVAILABLE", statusCode: 409 },
      );
    }
    let baseRunId = "";
    let incrementalFaceIds = [];
    if (exactDetectorConfigDigest) {
      const [base] = await sql`
        SELECT *
        FROM identity_audit_run
        WHERE state = 'completed'
          AND pack_id = ${pack.pack_id}
          AND policy_version = ${identityAuditPolicyVersion}
          AND score_floor = ${Number(pack.score_floor)}
          AND margin_floor = ${Number(pack.margin_floor)}
        ORDER BY started_at DESC, audit_run_id DESC
        LIMIT 1
      `;
      if (!base) {
        throw Object.assign(
          new Error(
            "Incremental identity audit requires a completed compatible base",
          ),
          {
            code: "IDENTITY_AUDIT_INCREMENTAL_BASE_UNAVAILABLE",
            statusCode: 409,
          },
        );
      }
      // The base run's comparison snapshot is taken when its first statement
      // starts, not when the run completes - claims accepted during the base
      // run were never audited by it, so the staleness frontier must be
      // started_at. An existence probe is enough; counting the full
      // append-only claim history forces a table scan.
      const [identityChange] = await sql`
        SELECT 1 AS present
        FROM identity_claim
        WHERE created_at >= ${base.started_at}
        LIMIT 1
      `;
      if (identityChange?.present) {
        throw Object.assign(
          new Error(
            "Identity authority changed after the incremental audit base",
          ),
          { code: "IDENTITY_AUDIT_INCREMENTAL_BASE_STALE", statusCode: 409 },
        );
      }
      const rows = await sql`
        SELECT DISTINCT observation.face_id
        FROM face_detection_result result
        JOIN face_detection_result_observation observation
          ON observation.detection_result_id = result.detection_result_id
        JOIN face_observation face
          ON face.face_id = observation.face_id AND face.state = 'valid'
        JOIN source_pack current_pack
          ON current_pack.pack_id = ${pack.pack_id}
        JOIN face_embedding embedding
          ON embedding.face_id = face.face_id
          AND embedding.state = 'active'
          AND embedding.model_family = current_pack.model_family
          AND embedding.model_version = current_pack.model_version
          AND embedding.config_digest = current_pack.config_digest
        WHERE result.detector_config_digest = ${exactDetectorConfigDigest}
          AND cimmich_face_match_eligible(face.detection_confidence, face.box_w, face.box_h)
          AND NOT EXISTS (
            SELECT 1 FROM current_face_identity accepted
            WHERE accepted.face_id = face.face_id
              AND accepted.state = 'accepted'
          )
        ORDER BY observation.face_id
      `;
      incrementalFaceIds = rows.map((row) => row.face_id);
      if (incrementalFaceIds.length === 0) {
        throw Object.assign(
          new Error(
            "Incremental identity audit detector has no compatible new Faces",
          ),
          { code: "IDENTITY_AUDIT_INCREMENTAL_EMPTY", statusCode: 409 },
        );
      }
      baseRunId = base.audit_run_id;
    }
    const runId = `identity-audit.${randomUUID()}`;
    try {
      await sql`
        INSERT INTO identity_audit_run (
          audit_run_id, pack_id, policy_version, score_floor, margin_floor, state
        ) VALUES (
          ${runId}, ${pack.pack_id}, ${pack.policy_version},
          ${Number(pack.score_floor)}, ${Number(pack.margin_floor)}, 'running'
        )
      `;
    } catch (error) {
      // Two near-simultaneous starts both pass the running-run check; the
      // identity_audit_one_running unique index rejects the loser. That is
      // the concurrent-start race, not a failure - return the winning run.
      if (error?.code === "23505") return latest();
      throw error;
    }
    runningPromise = auditSql(
      sql,
      runId,
      pack.pack_id,
      presentationRank(),
      Number(pack.score_floor),
      Number(pack.margin_floor),
      { baseRunId, incrementalFaceIds, queryFrontierLimit },
    )
      .then(() =>
        suppressSamePhotoDerivatives(sql, {
          companion,
          comparisonConcurrency: independenceConcurrency,
          comparisonLimit: independenceComparisonLimit,
          provider: derivativeProvider,
          runId,
          sourceId,
          faceIds: incrementalFaceIds,
        }),
      )
      .catch(async (error) => {
        // The stored error_code is the only durable trace of the failure, so
        // log the full error here; raw driver codes (SQLSTATE) are kept in the
        // log but stored under a stable label. The recovery UPDATE gets its
        // own guard - if the database is unreachable (the likely cause of the
        // failure itself), an unhandled rejection here would escape through
        // the discarded runningPromise and crash the process.
        console.error("Cimmich identity audit run failed", {
          code: error?.code,
          message: error instanceof Error ? error.message : String(error),
          runId,
        });
        const storedCode = String(error?.code || "").startsWith(
          "IDENTITY_AUDIT_",
        )
          ? String(error.code)
          : "IDENTITY_AUDIT_FAILED";
        try {
          await sql`
            UPDATE identity_audit_run
            SET state = 'failed', completed_at = now(),
              error_code = ${storedCode.slice(0, 160)}
            WHERE audit_run_id = ${runId} AND state = 'running'
          `;
        } catch (recoveryError) {
          console.error("Cimmich identity audit failure recovery failed", {
            message:
              recoveryError instanceof Error
                ? recoveryError.message
                : String(recoveryError),
            runId,
          });
        }
      })
      .finally(() => {
        runningPromise = null;
      });
    void runningPromise;
    return latest();
  };

  const items = async ({ kind, limit, offset, personId } = {}) => {
    await reconcileInterruptedRun();
    const auditKind = cleanKind(kind);
    const boundedLimit = cleanLimit(limit);
    const boundedOffset = cleanOffset(offset);
    const exactPersonId = String(personId || "")
      .trim()
      .slice(0, 160);
    const [run] = await sql`
      SELECT * FROM identity_audit_run
      WHERE state = 'completed'
      ORDER BY started_at DESC, audit_run_id DESC
      LIMIT 1
    `;
    if (!run) {
      return {
        hasMore: false,
        items: [],
        kind: auditKind,
        limit: boundedLimit,
        offset: boundedOffset,
        run: await latest(),
        schemaVersion: identityAuditSchemaVersion,
        total: 0,
      };
    }
    // The count must share the row query's guarded predicate exactly: a wider
    // count both leaks the existence of hidden or invalidated items and keeps
    // hasMore true forever once the guarded rows run out ("load more" loops).
    const [count] = await sql`
      SELECT count(*)::int AS total
      FROM current_physical_identity_audit_item item
      JOIN identity_audit_run item_run
        ON item_run.audit_run_id = item.audit_run_id
      JOIN face_observation face ON face.face_id = item.face_id
      JOIN asset ON asset.asset_id = item.asset_id
      JOIN source_pack item_pack ON item_pack.pack_id = item_run.pack_id
      JOIN face_embedding query_embedding
        ON query_embedding.face_id = item.face_id
        AND query_embedding.state = 'active'
        AND query_embedding.model_family = item_pack.model_family
        AND query_embedding.model_version = item_pack.model_version
        AND query_embedding.config_digest = item_pack.config_digest
      JOIN current_person suggested
        ON suggested.person_id = item.suggested_person_id
      WHERE item.audit_run_id = ${run.audit_run_id}
        AND item.audit_kind = ${auditKind}
        AND item.review_state = 'open'
        AND (
          ${exactPersonId} = ''
          OR item.suggested_person_id = ${exactPersonId}
          OR item.assigned_person_id = ${exactPersonId}
        )
        AND face.state = 'valid'
        AND asset.state = 'active'
        AND cimmich_visibility_asset_rank(asset.asset_id) <= ${presentationRank()}
        AND (
          item.audit_kind <> 'untagged_match' OR
          cimmich_face_match_eligible(face.detection_confidence, face.box_w, face.box_h)
        )
        AND (item.audit_kind <> 'untagged_match' OR coalesce((SELECT review.reason_code FROM decision review WHERE review.subject_type = 'face_review' AND review.subject_id = face.face_id ORDER BY review.created_at DESC, review.decision_id DESC LIMIT 1), '') NOT IN ('face_review_unknown', 'face_review_later', 'face_review_geometry'))
        AND NOT EXISTS (
          SELECT 1
          FROM current_face_identity same_photo_identity
          JOIN current_face_physical_member same_photo_member
            ON same_photo_member.face_id = same_photo_identity.face_id
          JOIN face_observation same_photo_face
            ON same_photo_face.face_id = same_photo_identity.face_id
            AND same_photo_face.state = 'valid'
          WHERE same_photo_identity.state = 'accepted'
            AND same_photo_identity.person_id = item.suggested_person_id
            AND same_photo_face.asset_id = item.asset_id
            AND same_photo_member.physical_face_id <> item.physical_face_id
        )
        AND (
          (item.audit_kind = 'untagged_match' AND NOT EXISTS (
            SELECT 1 FROM current_physical_face_identity current
            WHERE current.physical_face_id = item.physical_face_id
              AND current.state = 'accepted'
          ))
          OR
          (item.audit_kind = 'accepted_contradiction' AND EXISTS (
            SELECT 1 FROM current_physical_face_identity current
            WHERE current.physical_face_id = item.physical_face_id
              AND current.state = 'accepted'
              AND current.person_id = item.assigned_person_id
          ))
        )
    `;
    const rows = await sql`
      SELECT item.*, face.box_x, face.box_y, face.box_w, face.box_h,
        face.detection_confidence, face.quality_measurements,
        face.current_revision, face.current_decision_id,
        asset.capture_time, asset.media_kind, asset.width, asset.height,
        assigned.display_name AS assigned_display_name,
        suggested.display_name AS suggested_display_name,
        assigned_reference.face_id AS assigned_reference_face_id,
        assigned_reference.asset_id AS assigned_reference_asset_id,
        assigned_reference.box_x AS assigned_reference_box_x,
        assigned_reference.box_y AS assigned_reference_box_y,
        assigned_reference.box_w AS assigned_reference_box_w,
        assigned_reference.box_h AS assigned_reference_box_h,
        assigned_reference.width AS assigned_reference_width,
        assigned_reference.height AS assigned_reference_height,
        assigned_reference.score AS assigned_reference_score,
        suggested_reference.face_id AS suggested_reference_face_id,
        suggested_reference.asset_id AS suggested_reference_asset_id,
        suggested_reference.box_x AS suggested_reference_box_x,
        suggested_reference.box_y AS suggested_reference_box_y,
        suggested_reference.box_w AS suggested_reference_box_w,
        suggested_reference.box_h AS suggested_reference_box_h,
        suggested_reference.width AS suggested_reference_width,
        suggested_reference.height AS suggested_reference_height,
        suggested_reference.score AS suggested_reference_score,
        suggested_support.reference_count AS suggested_reference_count,
        suggested_support.top3_average_score AS suggested_top3_average_score
      FROM current_physical_identity_audit_item item
      JOIN identity_audit_run item_run
        ON item_run.audit_run_id = item.audit_run_id
      JOIN face_observation face ON face.face_id = item.face_id
      JOIN asset ON asset.asset_id = item.asset_id
      JOIN source_pack item_pack ON item_pack.pack_id = item_run.pack_id
      JOIN face_embedding query_embedding
        ON query_embedding.face_id = item.face_id
        AND query_embedding.state = 'active'
        AND query_embedding.model_family = item_pack.model_family
        AND query_embedding.model_version = item_pack.model_version
        AND query_embedding.config_digest = item_pack.config_digest
      LEFT JOIN current_person assigned
        ON assigned.person_id = item.assigned_person_id
      JOIN current_person suggested
        ON suggested.person_id = item.suggested_person_id
      LEFT JOIN LATERAL (
        SELECT reference.face_id, reference_face.asset_id,
          reference_face.box_x, reference_face.box_y,
          reference_face.box_w, reference_face.box_h,
          reference_asset.width, reference_asset.height,
          (1 - (reference.embedding <=> query_embedding.embedding))::float8 AS score
        FROM source_pack_matching_gallery reference
        JOIN face_observation reference_face
          ON reference_face.face_id = reference.face_id
          AND reference_face.state = 'valid'
          AND reference_face.asset_id <> item.asset_id
        JOIN asset reference_asset
          ON reference_asset.asset_id = reference_face.asset_id
          AND reference_asset.state = 'active'
          AND cimmich_visibility_asset_rank(reference_asset.asset_id)
            <= ${presentationRank()}
        WHERE reference.pack_id = item_run.pack_id
          AND reference.person_id = item.assigned_person_id
          AND reference.bucket_kind = 'prime'
          AND reference.reference_kind = 'face'
          AND reference.face_id <> item.face_id
          AND NOT EXISTS (
            SELECT 1
            FROM current_face_capture_context query_context
            JOIN current_face_capture_context reference_context
              ON reference_context.context_id = query_context.context_id
            WHERE query_context.face_id = item.face_id
              AND reference_context.face_id = reference.face_id
          )
        ORDER BY score DESC, reference.face_id
        LIMIT 1
      ) assigned_reference ON item.assigned_person_id IS NOT NULL
      LEFT JOIN LATERAL (
        SELECT reference.face_id, reference_face.asset_id,
          reference_face.box_x, reference_face.box_y,
          reference_face.box_w, reference_face.box_h,
          reference_asset.width, reference_asset.height,
          (1 - (reference.embedding <=> query_embedding.embedding))::float8 AS score
        FROM source_pack_matching_gallery reference
        JOIN face_observation reference_face
          ON reference_face.face_id = reference.face_id
          AND reference_face.state = 'valid'
          AND reference_face.asset_id <> item.asset_id
        JOIN asset reference_asset
          ON reference_asset.asset_id = reference_face.asset_id
          AND reference_asset.state = 'active'
          AND cimmich_visibility_asset_rank(reference_asset.asset_id)
            <= ${presentationRank()}
        WHERE reference.pack_id = item_run.pack_id
          AND reference.person_id = item.suggested_person_id
          AND reference.bucket_kind = 'prime'
          AND reference.reference_kind = 'face'
          AND reference.face_id <> item.face_id
          AND (
            item.suggested_reference_asset_id IS NULL
            OR reference_face.asset_id =
              item.suggested_reference_asset_id
          )
          AND NOT EXISTS (
            SELECT 1
            FROM current_face_capture_context query_context
            JOIN current_face_capture_context reference_context
              ON reference_context.context_id = query_context.context_id
            WHERE query_context.face_id = item.face_id
              AND reference_context.face_id = reference.face_id
          )
        ORDER BY score DESC, reference.face_id
        LIMIT 1
      ) suggested_reference ON true
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS reference_count,
          avg(ranked.score) FILTER (
            WHERE ranked.evidence_rank <= 3
          )::float8 AS top3_average_score
        FROM (
          SELECT evidence.score,
            row_number() OVER (
              ORDER BY evidence.score DESC, evidence.evidence_unit
            ) AS evidence_rank
          FROM (
            SELECT coalesce(
                'context:' || reference_context.evidence_context,
                'asset:' || reference_face.asset_id
              ) AS evidence_unit,
              max(
                (1 - (
                  reference.embedding <=> query_embedding.embedding
                ))::float8
              ) AS score
            FROM source_pack_matching_gallery reference
            JOIN face_observation reference_face
              ON reference_face.face_id = reference.face_id
              AND reference_face.state = 'valid'
              AND reference_face.asset_id <> item.asset_id
            JOIN asset reference_asset
              ON reference_asset.asset_id = reference_face.asset_id
              AND reference_asset.state = 'active'
              AND cimmich_visibility_asset_rank(reference_asset.asset_id)
                <= ${presentationRank()}
            LEFT JOIN LATERAL (
              SELECT min(context.context_id) AS evidence_context
              FROM current_face_capture_context context
              WHERE context.face_id = reference.face_id
            ) reference_context ON true
            WHERE reference.pack_id = item_run.pack_id
              AND reference.person_id = item.suggested_person_id
              AND reference.bucket_kind = 'prime'
              AND reference.reference_kind = 'face'
              AND reference.face_id <> item.face_id
              AND NOT EXISTS (
                SELECT 1
                FROM current_face_capture_context query_context
                JOIN current_face_capture_context shared_context
                  ON shared_context.context_id = query_context.context_id
                WHERE query_context.face_id = item.face_id
                  AND shared_context.face_id = reference.face_id
              )
            GROUP BY coalesce(
              'context:' || reference_context.evidence_context,
              'asset:' || reference_face.asset_id
            )
          ) evidence
        ) ranked
      ) suggested_support ON true
      WHERE item.audit_run_id = ${run.audit_run_id}
        AND item.audit_kind = ${auditKind}
        AND item.review_state = 'open'
        AND (
          ${exactPersonId} = ''
          OR item.suggested_person_id = ${exactPersonId}
          OR item.assigned_person_id = ${exactPersonId}
        )
        AND face.state = 'valid'
        AND asset.state = 'active'
        AND cimmich_visibility_asset_rank(asset.asset_id) <= ${presentationRank()}
        AND (
          item.audit_kind <> 'untagged_match'
          OR cimmich_face_match_eligible(face.detection_confidence, face.box_w, face.box_h)
        )
        AND (item.audit_kind <> 'untagged_match' OR coalesce((SELECT review.reason_code FROM decision review WHERE review.subject_type = 'face_review' AND review.subject_id = face.face_id ORDER BY review.created_at DESC, review.decision_id DESC LIMIT 1), '') NOT IN ('face_review_unknown', 'face_review_later', 'face_review_geometry'))
        AND NOT EXISTS (
          SELECT 1
          FROM current_face_identity same_photo_identity
          JOIN current_face_physical_member same_photo_member
            ON same_photo_member.face_id = same_photo_identity.face_id
          JOIN face_observation same_photo_face
            ON same_photo_face.face_id = same_photo_identity.face_id
            AND same_photo_face.state = 'valid'
          WHERE same_photo_identity.state = 'accepted'
            AND same_photo_identity.person_id = item.suggested_person_id
            AND same_photo_face.asset_id = item.asset_id
            AND same_photo_member.physical_face_id <> item.physical_face_id
        )
        AND (
          (item.audit_kind = 'untagged_match' AND NOT EXISTS (
            SELECT 1 FROM current_physical_face_identity current
            WHERE current.physical_face_id = item.physical_face_id
              AND current.state = 'accepted'
          ))
          OR
          (item.audit_kind = 'accepted_contradiction' AND EXISTS (
            SELECT 1 FROM current_physical_face_identity current
            WHERE current.physical_face_id = item.physical_face_id
              AND current.state = 'accepted'
              AND current.person_id = item.assigned_person_id
          ))
        )
      ORDER BY item.suggested_score DESC, item.margin DESC, item.face_id
      LIMIT ${boundedLimit} OFFSET ${boundedOffset}
    `;
    const total = Number(count?.total || 0);
    const projectReference = (row, prefix) => {
      const assetId = row[`${prefix}_reference_asset_id`];
      const faceId = row[`${prefix}_reference_face_id`];
      if (!assetId || !faceId) return null;
      const display = bridgeFields(assetId);
      if (!display?.sourceAssetId) return null;
      return {
        assetId,
        box: {
          h: Number(row[`${prefix}_reference_box_h`]),
          w: Number(row[`${prefix}_reference_box_w`]),
          x: Number(row[`${prefix}_reference_box_x`]),
          y: Number(row[`${prefix}_reference_box_y`]),
        },
        faceId,
        height: Number(row[`${prefix}_reference_height`]),
        score: Number(row[`${prefix}_reference_score`]),
        sourceAssetId: display.sourceAssetId,
        width: Number(row[`${prefix}_reference_width`]),
      };
    };
    return {
      hasMore: boundedOffset + rows.length < total,
      items: rows.map((row) => ({
        ...bridgeFields(row.asset_id),
        assetId: row.asset_id,
        assignedPerson:
          row.assigned_person_id == null
            ? null
            : {
                displayName: row.assigned_display_name,
                personId: row.assigned_person_id,
                reference: projectReference(row, "assigned"),
                score: Number(row.comparison_score),
              },
        box: {
          h: Number(row.box_h),
          w: Number(row.box_w),
          x: Number(row.box_x),
          y: Number(row.box_y),
        },
        captureTime: row.capture_time,
        currentDecisionId: row.current_decision_id,
        currentRevision: Number(row.current_revision),
        detectionConfidence: Number(row.detection_confidence),
        faceId: row.face_id,
        physicalFaceId: row.physical_face_id,
        height: row.height,
        kind: row.audit_kind,
        margin: Number(row.margin),
        mediaKind: row.media_kind,
        qualityMeasurements: row.quality_measurements || {},
        suggestedPerson: {
          confidenceBand: identityAuditConfidenceBand(row.suggested_score),
          displayName: row.suggested_display_name,
          personId: row.suggested_person_id,
          reference: projectReference(row, "suggested"),
          reviewEvidence: {
            independentReferenceCount: Number(
              row.suggested_reference_count || 0,
            ),
            top3AverageScore:
              row.suggested_top3_average_score == null
                ? null
                : Number(row.suggested_top3_average_score),
          },
          score: Number(row.suggested_score),
        },
        width: row.width,
      })),
      kind: auditKind,
      limit: boundedLimit,
      offset: boundedOffset,
      run: projectRun(run, run.pack_id),
      schemaVersion: identityAuditSchemaVersion,
      total,
    };
  };

  const leads = createIdentityAuditLeads({
    latest,
    presentationRank,
    projectRun,
    reconcileInterruptedRun,
    schemaVersion: identityAuditSchemaVersion,
    sql,
  });

  const { dismiss, dismissBatch } = createIdentityAuditDecisions({
    cleanKind,
    reconcileInterruptedRun,
    schemaVersion: identityAuditSchemaVersion,
    sql,
  });

  return { dismiss, dismissBatch, items, latest, leads, start };
};
