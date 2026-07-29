#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import postgres from "postgres";

const argument = (name, fallback = "") => {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : "";
  return value && !value.startsWith("--") ? value : fallback;
};
const hasFlag = (name) => process.argv.includes(`--${name}`);
const boundedInteger = (value, label, minimum, maximum) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be from ${minimum} to ${maximum}`);
  }
  return number;
};
const required = (value, label) => {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`Archive matcher requires ${label}`);
  return normalized;
};

const databaseUrl = required(process.env.DATABASE_URL, "DATABASE_URL");
const execute = hasFlag("execute");
const priorityTierMax = boundedInteger(
  argument("priority-tier-max", "1"),
  "priority-tier-max",
  0,
  1,
);
const limitFaces = boundedInteger(
  argument("limit-faces", "0"),
  "limit-faces",
  0,
  1_000_000,
);
const laneCount = boundedInteger(
  argument("lane-count", "1"),
  "lane-count",
  1,
  8,
);
const laneIndex = boundedInteger(
  argument("lane-index", "0"),
  "lane-index",
  0,
  laneCount - 1,
);
const sql = postgres(databaseUrl, { max: 2, prepare: true });
const receiptId = `receipt_sourcepack_archive_match_${randomUUID().replaceAll("-", "")}`;

try {
  const receipt = await sql.begin(async (tx) => {
    await tx`
      SELECT set_config('statement_timeout', '3600000', true),
        set_config('transaction_timeout', '3660000', true)
    `;
    const packs = await tx`
      SELECT pack.pack_id, pack.model_family, pack.model_version,
        pack.config_digest,
        (pack.evaluation_summary->'matcherPolicy'->>'scoreFloor')::float8
          AS score_floor,
        (pack.evaluation_summary->'matcherPolicy'->>'marginFloor')::float8
          AS margin_floor,
        pack.evaluation_summary->'matcherPolicy'->>'policyVersion'
          AS policy_version,
        pack.evaluation_summary->'matcherPolicy'->>'scorer' AS scorer
      FROM current_source_pack pack
      WHERE pack.evaluation_status = 'passed'
        AND pack.evaluation_summary->'matcherPolicy'->>'policyVersion'
          = 'cimmich-best-prime-v1'
        AND pack.evaluation_summary->'matcherPolicy'->>'scorer'
          = 'best_individual_prime'
        AND jsonb_typeof(
          pack.evaluation_summary->'matcherPolicy'->'scoreFloor'
        ) = 'number'
        AND jsonb_typeof(
          pack.evaluation_summary->'matcherPolicy'->'marginFloor'
        ) = 'number'
      ORDER BY pack.pack_id
    `;
    if (packs.length !== 1) {
      throw new Error(
        `Archive matcher requires exactly one active passed SourcePack; found ${packs.length}`,
      );
    }
    const pack = packs[0];
    if (
      Number(pack.score_floor) < 0 ||
      Number(pack.score_floor) > 1 ||
      Number(pack.margin_floor) < 0 ||
      Number(pack.margin_floor) > 1
    ) {
      throw new Error("Archive matcher SourcePack policy floors are invalid");
    }

    const [before] = await tx`
      SELECT
        count(*) FILTER (
          WHERE claim.state = 'accepted'
        )::int AS accepted_identities,
        count(*) FILTER (
          WHERE claim.state = 'candidate'
            AND triage.priority_tier > ${priorityTierMax}
        )::int AS outside_scope_candidates,
        count(*) FILTER (
          WHERE claim.state = 'candidate'
            AND claim.origin = 'prime_match'
            AND claim.evidence_refs->>'source_pack_id' = ${pack.pack_id}
            AND claim.evidence_refs->>'policy_version' = ${pack.policy_version}
        )::int AS current_pack_candidates
      FROM identity_claim claim
      JOIN face_observation face ON face.face_id = claim.face_id
      JOIN media_asset_triage triage ON triage.asset_id = face.asset_id
    `;

    await tx`
      CREATE TEMP TABLE cimmich_archive_match_result
      ON COMMIT DROP AS
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
      ), query_inventory AS MATERIALIZED (
        SELECT face.face_id, face.asset_id, embedding.embedding,
          face.box_x::float8, face.box_y::float8,
          face.box_w::float8, face.box_h::float8,
          face.detection_confidence::float8,
          coalesce(context.context_ids, ARRAY[]::text[]) AS context_ids,
          row_number() OVER (
            ORDER BY triage.priority_tier, face.asset_id, face.face_id
          ) AS query_rank
        FROM face_observation face
        JOIN face_embedding embedding
          ON embedding.face_id = face.face_id
          AND embedding.state = 'active'
          AND embedding.model_family = ${pack.model_family}
          AND embedding.model_version = ${pack.model_version}
          AND embedding.config_digest = ${pack.config_digest}
        JOIN asset
          ON asset.asset_id = face.asset_id
          AND asset.state = 'active'
          AND asset.media_kind = 'image'
        JOIN media_asset_triage triage
          ON triage.asset_id = face.asset_id
          AND triage.priority_tier <= ${priorityTierMax}
        LEFT JOIN face_contexts context ON context.face_id = face.face_id
        WHERE face.state = 'valid'
          AND NOT EXISTS (
            SELECT 1 FROM current_face_identity accepted
            WHERE accepted.face_id = face.face_id
              AND accepted.state = 'accepted'
          )
          AND coalesce((
            SELECT dismissed.action
            FROM decision dismissed
            WHERE dismissed.subject_type = 'machine_suggestion'
              AND dismissed.subject_id =
                face.face_id || ':' || ${pack.model_version} || ':' ||
                ${pack.config_digest} || ':' || ${pack.policy_version}
              AND dismissed.actor_kind = 'user'
            ORDER BY dismissed.created_at DESC, dismissed.decision_id DESC
            LIMIT 1
          ), '') <> 'ignore'
          AND NOT EXISTS (
            SELECT 1
            FROM identity_claim accepted
            JOIN face_observation accepted_face
              ON accepted_face.face_id = accepted.face_id
              AND accepted_face.state = 'valid'
              AND accepted_face.asset_id = face.asset_id
            CROSS JOIN LATERAL (
              SELECT greatest(
                0,
                least(
                  face.box_x + face.box_w,
                  accepted_face.box_x + accepted_face.box_w
                ) - greatest(face.box_x, accepted_face.box_x)
              ) * greatest(
                0,
                least(
                  face.box_y + face.box_h,
                  accepted_face.box_y + accepted_face.box_h
                ) - greatest(face.box_y, accepted_face.box_y)
              ) AS intersection
            ) overlap
            WHERE accepted.state = 'accepted'
              AND overlap.intersection / greatest(
                0.0000001,
                face.box_w * face.box_h +
                  accepted_face.box_w * accepted_face.box_h -
                  overlap.intersection
              ) >= 0.45
          )
      ), query_candidates AS MATERIALIZED (
        SELECT *
        FROM query_inventory
        WHERE ${limitFaces} = 0 OR query_rank <= ${limitFaces}
      ), lane_queries AS MATERIALIZED (
        SELECT *
        FROM query_candidates
        WHERE mod(query_rank - 1, ${laneCount}) = ${laneIndex}
      ), queries AS MATERIALIZED (
        SELECT candidate.face_id, candidate.asset_id, candidate.embedding,
          candidate.context_ids
        FROM lane_queries candidate
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
      ), gallery AS MATERIALIZED (
        SELECT reference.person_id, reference.face_id,
          face.asset_id, reference.embedding,
          coalesce(context.context_ids, ARRAY[]::text[]) AS context_ids
        FROM source_pack_matching_gallery reference
        JOIN current_person person
          ON person.person_id = reference.person_id
          AND person.status = 'active'
          AND person.subject_kind = 'person'
        JOIN face_observation face
          ON face.face_id = reference.face_id AND face.state = 'valid'
        LEFT JOIN face_contexts context ON context.face_id = reference.face_id
        WHERE reference.pack_id = ${pack.pack_id}
          AND reference.bucket_kind = 'prime'
          AND reference.reference_kind = 'face'
          AND NOT EXISTS (
            SELECT 1 FROM current_person_category category
            WHERE category.person_id = person.person_id
              AND category.slug IN ('sort', 'holding')
          )
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
      )
      SELECT face_id, asset_id, person_id, score,
        next_score, score - coalesce(next_score, -1) AS margin,
        reference_asset_id
      FROM ranked
      WHERE candidate_rank = 1
        AND score >= ${Number(pack.score_floor)}
        AND score - coalesce(next_score, -1) >= ${Number(pack.margin_floor)}
        AND NOT cimmich_probable_same_photo_derivative(
          ${pack.pack_id}, asset_id, reference_asset_id
        )
    `;

    const [scored] = await tx`
      SELECT count(*)::int AS qualified_faces,
        count(DISTINCT asset_id)::int AS qualified_assets,
        count(DISTINCT person_id)::int AS suggested_people,
        min(score)::float8 AS minimum_score,
        max(score)::float8 AS maximum_score,
        avg(score)::float8 AS average_score,
        min(margin)::float8 AS minimum_margin,
        max(margin)::float8 AS maximum_margin
      FROM cimmich_archive_match_result
    `;
    if (!execute) {
      return {
        acceptedIdentityDelta: 0,
        automaticIdentityWrites: 0,
        candidatesInserted: 0,
        execute: false,
        matcher: {
          marginFloor: Number(pack.margin_floor),
          packId: pack.pack_id,
          policyVersion: pack.policy_version,
          scoreFloor: Number(pack.score_floor),
          scorer: pack.scorer,
        },
        laneCount,
        laneIndex,
        priorityTierMax,
        queryLimit: limitFaces || null,
        scored,
        sourceMediaWrite: "none",
        state: "dry_run_complete",
        tier2CandidateDelta: 0,
      };
    }

    await tx`
      INSERT INTO producer_receipt (
        producer_receipt_id, producer_kind, producer_name, producer_version,
        config_digest, started_at, completed_at, privacy_class
      ) VALUES (
        ${receiptId}, 'model', 'cimmich-sourcepack-archive-matcher',
        ${pack.policy_version}, ${pack.config_digest}, now(), now(),
        'sensitive-biometric'
      )
    `;
    const inserted = await tx`
      INSERT INTO identity_claim (
        identity_claim_id, face_id, person_id, origin, state,
        calibrated_confidence, evidence_refs, producer_receipt_id,
        privacy_class
      )
      SELECT
        'claim_spmatch_' || encode(digest(
          ${pack.pack_id}::text || ':' || result.face_id || ':' ||
            result.person_id || ':' || ${pack.policy_version}::text,
          'sha256'
        ), 'hex'),
        result.face_id, result.person_id, 'prime_match', 'candidate',
        result.score,
        jsonb_build_object(
          'algorithm', 'best_individual_prime',
          'assignment_decision', 'source_pack_prime_match',
          'authority', 'human_review_only',
          'automatic_acceptance', true,
          'automatic_identity_acceptance', false,
          'best_score', result.score,
          'margin', result.margin,
          'policy_version', ${pack.policy_version}::text,
          'reference_asset_id', result.reference_asset_id,
          'second_best_score', result.next_score,
          'source_pack_id', ${pack.pack_id}::text
        ),
        ${receiptId}, 'sensitive-biometric'
      FROM cimmich_archive_match_result result
      ON CONFLICT (identity_claim_id) DO NOTHING
      RETURNING identity_claim_id
    `;
    await tx`
      UPDATE producer_receipt
      SET completed_at = now(),
        result_digest = encode(digest(
          ${pack.pack_id}::text || ':' || ${pack.policy_version}::text || ':' ||
            ${String(scored.qualified_faces || 0)}::text || ':' ||
            ${String(inserted.length)}::text,
          'sha256'
        ), 'hex')
      WHERE producer_receipt_id = ${receiptId}
    `;

    const [after] = await tx`
      SELECT
        count(*) FILTER (
          WHERE claim.state = 'accepted'
        )::int AS accepted_identities,
        count(*) FILTER (
          WHERE claim.state = 'candidate'
            AND triage.priority_tier > ${priorityTierMax}
        )::int AS outside_scope_candidates,
        count(*) FILTER (
          WHERE claim.state = 'candidate'
            AND claim.origin = 'prime_match'
            AND claim.evidence_refs->>'source_pack_id' = ${pack.pack_id}
            AND claim.evidence_refs->>'policy_version' = ${pack.policy_version}
        )::int AS current_pack_candidates
      FROM identity_claim claim
      JOIN face_observation face ON face.face_id = claim.face_id
      JOIN media_asset_triage triage ON triage.asset_id = face.asset_id
    `;
    const acceptedIdentityDelta =
      Number(after.accepted_identities) - Number(before.accepted_identities);
    const tier2CandidateDelta =
      Number(after.outside_scope_candidates) -
      Number(before.outside_scope_candidates);
    if (acceptedIdentityDelta !== 0 || tier2CandidateDelta !== 0) {
      throw new Error(
        "Archive matcher violated its accepted-identity or Tier-2 write boundary",
      );
    }
    return {
      acceptedIdentityDelta,
      automaticIdentityWrites: 0,
      candidatesInserted: inserted.length,
      currentPackCandidates: Number(after.current_pack_candidates),
      execute: true,
      matcher: {
        marginFloor: Number(pack.margin_floor),
        packId: pack.pack_id,
        policyVersion: pack.policy_version,
        scoreFloor: Number(pack.score_floor),
        scorer: pack.scorer,
      },
      laneCount,
      laneIndex,
      priorityTierMax,
      producerReceiptId: receiptId,
      queryLimit: limitFaces || null,
      scored,
      sourceMediaWrite: "none",
      state: "archive_match_complete",
      tier2CandidateDelta,
    };
  });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
} finally {
  await sql.end();
}
