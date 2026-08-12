import { randomUUID } from "node:crypto";

export const sourcePackArchiveMatcherContract = Object.freeze({
  matcherPolicyVersion: "cimmich-best-prime-v1",
  schemaVersion: "cimmich.source-pack-archive-matcher.v2",
  scorer: "best_individual_prime",
});

const boundedInteger = (value, fallback, minimum, maximum, label) => {
  const parsed = value == null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be from ${minimum} to ${maximum}`);
  }
  return parsed;
};

const cleanPackId = (value) => {
  const normalized = String(value || "").trim();
  if (normalized.length > 200 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new Error("Archive matcher SourcePack ID is invalid");
  }
  return normalized;
};

export const normalizeSourcePackArchiveMatcherOptions = (input = {}) => {
  const laneCount = boundedInteger(input.laneCount, 1, 1, 8, "laneCount");
  return Object.freeze({
    execute: input.execute === true,
    laneCount,
    laneIndex: boundedInteger(
      input.laneIndex,
      0,
      0,
      laneCount - 1,
      "laneIndex",
    ),
    limitFaces: boundedInteger(input.limitFaces, 0, 0, 1_000_000, "limitFaces"),
    packId: cleanPackId(input.packId),
  });
};

const selectPack = async (tx, { execute, packId }) => {
  const { matcherPolicyVersion, scorer } = sourcePackArchiveMatcherContract;
  const packs = await tx`
    SELECT pack.pack_id, pack.state, pack.evaluation_status,
      pack.model_family, pack.model_version, pack.config_digest,
      (pack.evaluation_summary->'matcherPolicy'->>'scoreFloor')::float8
        AS score_floor,
      (pack.evaluation_summary->'matcherPolicy'->>'marginFloor')::float8
        AS margin_floor,
      pack.evaluation_summary->'matcherPolicy'->>'policyVersion'
        AS policy_version,
      pack.evaluation_summary->'matcherPolicy'->>'scorer' AS scorer
    FROM source_pack pack
    WHERE (${packId}::text = '' OR pack.pack_id = ${packId})
      AND (${packId}::text <> '' OR pack.state = 'active')
      AND pack.evaluation_status = 'passed'
      AND pack.evaluation_summary->'matcherPolicy'->>'policyVersion'
        = ${matcherPolicyVersion}
      AND pack.evaluation_summary->'matcherPolicy'->>'scorer' = ${scorer}
      AND jsonb_typeof(
        pack.evaluation_summary->'matcherPolicy'->'scoreFloor'
      ) = 'number'
      AND jsonb_typeof(
        pack.evaluation_summary->'matcherPolicy'->'marginFloor'
      ) = 'number'
    ORDER BY pack.pack_id
    ${execute ? tx`FOR SHARE` : tx``}
  `;
  if (packs.length !== 1) {
    throw new Error(
      `Archive matcher requires exactly one ${packId ? "selected" : "active"} passed SourcePack; found ${packs.length}`,
    );
  }
  const pack = packs[0];
  if (execute && pack.state !== "active") {
    throw new Error(
      "Archive matcher can only persist proposals from the active SourcePack",
    );
  }
  if (
    Number(pack.score_floor) < 0 ||
    Number(pack.score_floor) > 1 ||
    Number(pack.margin_floor) < 0 ||
    Number(pack.margin_floor) > 1
  ) {
    throw new Error("Archive matcher SourcePack policy floors are invalid");
  }
  return pack;
};

export const runSourcePackArchiveMatcher = async (sql, input = {}) => {
  if (typeof sql !== "function") {
    throw new TypeError("Archive matcher requires a database connection");
  }
  const options = normalizeSourcePackArchiveMatcherOptions(input);
  const { execute, laneCount, laneIndex, limitFaces } = options;
  const { schemaVersion } = sourcePackArchiveMatcherContract;

  return sql.begin(async (tx) => {
    await tx`
      SELECT set_config('statement_timeout', '3600000', true),
        set_config('transaction_timeout', '3660000', true)
    `;
    const pack = await selectPack(tx, options);
    const receiptId = `receipt_sourcepack_archive_match_${randomUUID().replaceAll("-", "")}`;

    const [before] = execute
      ? await tx`
          SELECT
            count(*) FILTER (WHERE state = 'accepted')::int
              AS accepted_identities,
            count(*) FILTER (
              WHERE state = 'candidate' AND origin = 'prime_match'
                AND evidence_refs->>'source_pack_id' = ${pack.pack_id}
                AND evidence_refs->>'policy_version' = ${pack.policy_version}
            )::int AS current_pack_candidates
          FROM identity_claim
        `
      : [{ accepted_identities: 0, current_pack_candidates: 0 }];

    await tx`
      CREATE TEMP TABLE cimmich_archive_match_result
      ON COMMIT DROP AS
      WITH face_contexts AS MATERIALIZED (
        SELECT face_id, array_agg(context_id ORDER BY context_id) AS context_ids
        FROM current_face_capture_context
        GROUP BY face_id
      ), accepted_people_by_asset AS MATERIALIZED (
        SELECT DISTINCT face.asset_id, identity.person_id
        FROM current_physical_face_identity identity
        JOIN current_matchable_physical_face face
          ON face.physical_face_id = identity.physical_face_id
        WHERE identity.state = 'accepted'
      ), query_inventory AS MATERIALIZED (
        SELECT face.face_id, face.physical_face_id, face.asset_id,
          embedding.embedding, face.box_x::float8, face.box_y::float8,
          face.box_w::float8, face.box_h::float8,
          face.detection_confidence::float8,
          coalesce(context.context_ids, ARRAY[]::text[]) AS context_ids,
          row_number() OVER (
            ORDER BY coalesce(
              nullif(face.quality_measurements->>'quality_score', '')::float8,
              0
            ) DESC, face.detection_confidence DESC, face.face_id
          ) AS query_rank
        FROM current_matchable_physical_face face
        JOIN face_embedding embedding
          ON embedding.face_id = face.face_id
          AND embedding.state = 'active'
          AND embedding.model_family = ${pack.model_family}
          AND embedding.model_version = ${pack.model_version}
          AND embedding.config_digest = ${pack.config_digest}
        JOIN asset ON asset.asset_id = face.asset_id
          AND asset.state = 'active' AND asset.media_kind = 'image'
        LEFT JOIN face_contexts context ON context.face_id = face.face_id
        WHERE cimmich_face_match_eligible(
            face.detection_confidence, face.box_w, face.box_h
          )
          AND NOT EXISTS (
            SELECT 1 FROM current_physical_face_identity accepted
            WHERE accepted.physical_face_id = face.physical_face_id
              AND accepted.state = 'accepted'
          )
          AND coalesce((
            SELECT review.reason_code
            FROM decision review
            WHERE review.subject_type = 'face_review'
              AND review.subject_id = face.face_id
            ORDER BY review.created_at DESC, review.decision_id DESC
            LIMIT 1
          ), '') NOT IN (
            'face_review_unknown', 'face_review_later', 'face_review_geometry'
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
      ), queries AS MATERIALIZED (
        SELECT * FROM query_inventory
        WHERE (${limitFaces} = 0 OR query_rank <= ${limitFaces})
          AND mod(query_rank - 1, ${laneCount}) = ${laneIndex}
      ), gallery AS MATERIALIZED (
        SELECT reference.person_id, reference.face_id,
          reference_face.asset_id, reference.embedding,
          coalesce(context.context_ids, ARRAY[]::text[]) AS context_ids
        FROM source_pack_reference reference
        JOIN current_person person ON person.person_id = reference.person_id
          AND person.status = 'active' AND person.subject_kind = 'person'
        JOIN face_observation reference_face
          ON reference_face.face_id = reference.face_id
          AND reference_face.state = 'valid'
        LEFT JOIN face_contexts context ON context.face_id = reference.face_id
        WHERE reference.pack_id = ${pack.pack_id}
          AND reference.bucket_kind = 'prime'
          AND reference.reference_kind = 'face'
          AND reference.routing_state = 'eligible'
          AND NOT EXISTS (
            SELECT 1 FROM current_person_category category
            WHERE category.person_id = person.person_id
              AND category.slug IN ('sort', 'holding')
          )
      ), person_scores AS MATERIALIZED (
        SELECT query.face_id, query.physical_face_id, query.asset_id,
          gallery.person_id,
          max(1 - (gallery.embedding <=> query.embedding))::float8 AS score,
          (array_agg(
            gallery.face_id
            ORDER BY gallery.embedding <=> query.embedding, gallery.face_id
          ))[1] AS reference_face_id,
          (array_agg(
            gallery.asset_id
            ORDER BY gallery.embedding <=> query.embedding, gallery.face_id
          ))[1] AS reference_asset_id
        FROM queries query
        JOIN gallery ON gallery.face_id <> query.face_id
          AND gallery.asset_id <> query.asset_id
          AND NOT (gallery.context_ids && query.context_ids)
        LEFT JOIN accepted_people_by_asset same_photo_person
          ON same_photo_person.asset_id = query.asset_id
          AND same_photo_person.person_id = gallery.person_id
        WHERE same_photo_person.person_id IS NULL
        GROUP BY query.face_id, query.physical_face_id, query.asset_id,
          gallery.person_id
      ), ranked AS MATERIALIZED (
        SELECT score.*,
          row_number() OVER (
            PARTITION BY score.face_id
            ORDER BY score.score DESC, score.person_id
          ) AS candidate_rank,
          lead(score.score) OVER (
            PARTITION BY score.face_id
            ORDER BY score.score DESC, score.person_id
          )::float8 AS next_score
        FROM person_scores score
      )
      SELECT face_id, physical_face_id, asset_id, person_id, score,
        next_score, score - coalesce(next_score, -1)::float8 AS margin,
        reference_face_id, reference_asset_id
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
        count(DISTINCT physical_face_id)::int AS qualified_physical_faces,
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
        laneCount,
        laneIndex,
        matcher: {
          marginFloor: Number(pack.margin_floor),
          packId: pack.pack_id,
          packState: pack.state,
          policyVersion: pack.policy_version,
          scoreFloor: Number(pack.score_floor),
          scorer: pack.scorer,
        },
        nextStep:
          "activate_successor_then_persist_before_possible_people_refresh",
        queryLimit: limitFaces || null,
        schemaVersion,
        scored,
        sourceMediaWrite: "none",
        state: "dry_run_complete",
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
          'algorithm', ${sourcePackArchiveMatcherContract.scorer}::text,
          'assignment_decision', 'source_pack_prime_match',
          'authority', 'human_review_only',
          'automatic_acceptance', false,
          'automatic_identity_acceptance', false,
          'best_score', result.score,
          'margin', result.margin,
          'physical_face_id', result.physical_face_id,
          'policy_version', ${pack.policy_version}::text,
          'reference_asset_id', result.reference_asset_id,
          'reference_face_id', result.reference_face_id,
          'second_best_score', result.next_score,
          'source_pack_id', ${pack.pack_id}::text
        ),
        ${receiptId}, 'sensitive-biometric'
      FROM cimmich_archive_match_result result
      ON CONFLICT (identity_claim_id) DO NOTHING
      RETURNING identity_claim_id
    `;
    const [after] = await tx`
      SELECT
        count(*) FILTER (WHERE state = 'accepted')::int
          AS accepted_identities,
        count(*) FILTER (
          WHERE state = 'candidate' AND origin = 'prime_match'
            AND evidence_refs->>'source_pack_id' = ${pack.pack_id}
            AND evidence_refs->>'policy_version' = ${pack.policy_version}
        )::int AS current_pack_candidates
      FROM identity_claim
    `;
    const acceptedIdentityDelta =
      Number(after.accepted_identities) - Number(before.accepted_identities);
    if (acceptedIdentityDelta !== 0) {
      throw new Error("Archive matcher changed accepted identity truth");
    }
    await tx`
      UPDATE producer_receipt
      SET result_digest = encode(digest(
        ${pack.pack_id}::text || ':' || ${pack.policy_version}::text || ':' ||
          ${String(scored.qualified_faces || 0)}::text || ':' ||
          ${String(inserted.length)}::text,
        'sha256'
      ), 'hex')
      WHERE producer_receipt_id = ${receiptId}
    `;
    return {
      acceptedIdentityDelta,
      automaticIdentityWrites: 0,
      candidatesInserted: inserted.length,
      currentPackCandidates: Number(after.current_pack_candidates),
      execute: true,
      laneCount,
      laneIndex,
      matcher: {
        marginFloor: Number(pack.margin_floor),
        packId: pack.pack_id,
        packState: pack.state,
        policyVersion: pack.policy_version,
        scoreFloor: Number(pack.score_floor),
        scorer: pack.scorer,
      },
      nextStep: "refresh_possible_people_after_all_match_lanes_complete",
      producerReceiptId: receiptId,
      queryLimit: limitFaces || null,
      schemaVersion,
      scored,
      sourceMediaWrite: "none",
      state: "archive_match_complete",
    };
  });
};
