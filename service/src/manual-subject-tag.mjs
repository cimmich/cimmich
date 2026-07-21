import { createHash, randomUUID } from "node:crypto";

export const manualSubjectTagSchemaVersion =
  "cimmich.typed-manual-subject-tag.v2";

const receiptId = "receipt_cimmich_typed_manual_subject_tag_v2";
const subjectKinds = new Set(["person", "pet"]);
const tagTypes = new Set(["face", "body", "head", "presence"]);
const matchingStates = new Set([
  "pending_embedding",
  "pending_quality",
  "eligible_for_evaluation",
  "abstained",
]);
const matchingReasons = new Set([
  "no_compatible_provider",
  "invalid_face",
  "quality_failed",
  "embedding_unavailable",
  "asset_revision_changed",
  "source_content_changed",
  "provider_mismatch",
  "replay_failed",
  "crop_invalid",
  "quality_unmeasured",
]);
const evidenceTiers = new Set(["secondary", "specialty", "low_quality"]);

const typedError = (message, statusCode, code, details) =>
  Object.assign(new Error(message), {
    code,
    statusCode,
    ...(details ? { details } : {}),
  });

const exactObject = (value, label, keys) => {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw typedError(
      `${label} must be an object`,
      400,
      "MANUAL_SUBJECT_TAG_INPUT_INVALID",
    );
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw typedError(
      `${label} has unsupported or missing fields`,
      400,
      "MANUAL_SUBJECT_TAG_INPUT_INVALID",
    );
  }
};

const canonicalValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalValue(nested)]),
    );
  }
  return value;
};

const digestCommand = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex");

const cleanActor = (value) => {
  const actorId = String(value || "").trim();
  if (!actorId || actorId.length > 120) {
    throw typedError(
      "A bounded Cimmich actor is required",
      400,
      "MANUAL_SUBJECT_TAG_ACTOR_INVALID",
    );
  }
  return actorId;
};

const cleanCommandId = (value) => {
  const commandId = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$/.test(commandId)) {
    throw typedError(
      "A stable commandId of 8 to 120 safe characters is required",
      400,
      "MANUAL_SUBJECT_TAG_COMMAND_ID_INVALID",
    );
  }
  return commandId;
};

const cleanStableId = (value, label) => {
  const id = String(value || "").trim();
  if (!id || id.length > 200) {
    throw typedError(
      `${label} must be a stable Cimmich ID`,
      400,
      "MANUAL_SUBJECT_TAG_INPUT_INVALID",
    );
  }
  return id;
};

const cleanEnum = (value, label, allowed) => {
  const normalized = String(value || "").trim();
  if (!allowed.has(normalized)) {
    throw typedError(
      `${label} is invalid`,
      400,
      "MANUAL_SUBJECT_TAG_INPUT_INVALID",
    );
  }
  return normalized;
};

const cleanPublicId = (value, label, maximum = 96) => {
  const id = String(value || "").trim();
  if (!new RegExp(`^[a-z0-9][a-z0-9._-]{0,${maximum - 1}}$`).test(id)) {
    throw typedError(
      `${label} is invalid`,
      400,
      "MANUAL_FACE_MATCHING_INPUT_INVALID",
    );
  }
  return id;
};

const cleanDigest = (value, label) => {
  const digest = String(value || "").trim();
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw typedError(
      `${label} must be a SHA-256 digest`,
      400,
      "MANUAL_FACE_MATCHING_INPUT_INVALID",
    );
  }
  return digest;
};

const cleanCoordinate = (value, label, { positive = false } = {}) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw typedError(
      `${label} must be a finite normalized number`,
      400,
      "MANUAL_SUBJECT_TAG_REGION_INVALID",
    );
  }
  if (value < 0 || value > 1 || (positive && value === 0)) {
    throw typedError(
      `${label} is outside its normalized range`,
      400,
      "MANUAL_SUBJECT_TAG_REGION_INVALID",
    );
  }
  return Object.is(value, -0) ? 0 : value;
};

export const cleanManualSubjectTagRegion = (value) => {
  exactObject(value, "region", ["h", "w", "x", "y"]);
  const region = {
    h: cleanCoordinate(value.h, "region.h", { positive: true }),
    w: cleanCoordinate(value.w, "region.w", { positive: true }),
    x: cleanCoordinate(value.x, "region.x"),
    y: cleanCoordinate(value.y, "region.y"),
  };
  if (region.x + region.w > 1 || region.y + region.h > 1) {
    throw typedError(
      "region must remain inside the normalized image",
      400,
      "MANUAL_SUBJECT_TAG_REGION_INVALID",
    );
  }
  return region;
};

export const normalizeManualSubjectTagAttach = (input) => {
  exactObject(input, "input", [
    "actorId",
    "assetId",
    "commandId",
    "region",
    "subjectId",
    "subjectKind",
    "tagType",
  ]);
  return {
    actorId: cleanActor(input.actorId),
    assetId: cleanStableId(input.assetId, "assetId"),
    commandId: cleanCommandId(input.commandId),
    region: cleanManualSubjectTagRegion(input.region),
    subjectId: cleanStableId(input.subjectId, "subjectId"),
    subjectKind: cleanEnum(input.subjectKind, "subjectKind", subjectKinds),
    tagType: cleanEnum(input.tagType, "tagType", tagTypes),
  };
};

export const normalizeManualSubjectTagReplace = (input) => {
  exactObject(input, "input", [
    "actorId",
    "commandId",
    "expectedDecisionId",
    "region",
    "subjectId",
    "subjectKind",
    "tagId",
    "tagType",
  ]);
  return {
    actorId: cleanActor(input.actorId),
    commandId: cleanCommandId(input.commandId),
    expectedDecisionId: cleanStableId(
      input.expectedDecisionId,
      "expectedDecisionId",
    ),
    region: cleanManualSubjectTagRegion(input.region),
    subjectId: cleanStableId(input.subjectId, "subjectId"),
    subjectKind: cleanEnum(input.subjectKind, "subjectKind", subjectKinds),
    tagId: cleanStableId(input.tagId, "tagId"),
    tagType: cleanEnum(input.tagType, "tagType", tagTypes),
  };
};

const normalizeUndo = (input) => {
  exactObject(input, "input", ["actorId", "commandId", "decisionId"]);
  return {
    actorId: cleanActor(input.actorId),
    commandId: cleanCommandId(input.commandId),
    decisionId: cleanStableId(input.decisionId, "decisionId"),
  };
};

export const normalizeManualFaceMatchingTransition = (input) => {
  exactObject(input, "input", [
    "actorId",
    "commandId",
    "configDigest",
    "embeddingId",
    "evidenceDigest",
    "evidenceTier",
    "modelFamily",
    "modelVersion",
    "operationId",
    "providerId",
    "reason",
    "state",
    "vectorDigest",
    "vectorSpaceId",
  ]);
  const state = cleanEnum(input.state, "state", matchingStates);
  const reason =
    input.reason == null
      ? null
      : cleanEnum(input.reason, "reason", matchingReasons);
  if ((state === "abstained") !== Boolean(reason)) {
    throw typedError(
      "reason is required only for abstained",
      400,
      "MANUAL_FACE_MATCHING_INPUT_INVALID",
    );
  }
  const eligible = state === "eligible_for_evaluation";
  if (eligible) {
    throw typedError(
      "Manual Face eligibility requires a validated recognition intake envelope",
      409,
      "MANUAL_FACE_RECOGNITION_EVIDENCE_REQUIRED",
    );
  }
  return {
    actorId: cleanActor(input.actorId),
    commandId: cleanCommandId(input.commandId),
    configDigest: cleanDigest(input.configDigest, "configDigest"),
    embeddingId:
      input.embeddingId == null
        ? null
        : cleanStableId(input.embeddingId, "embeddingId"),
    evidenceDigest:
      input.evidenceDigest == null
        ? null
        : cleanDigest(input.evidenceDigest, "evidenceDigest"),
    evidenceTier:
      input.evidenceTier == null
        ? null
        : cleanEnum(input.evidenceTier, "evidenceTier", evidenceTiers),
    modelFamily: cleanPublicId(input.modelFamily, "modelFamily", 64),
    modelVersion: cleanPublicId(input.modelVersion, "modelVersion", 64),
    operationId: cleanStableId(input.operationId, "operationId"),
    providerId: cleanPublicId(input.providerId, "providerId", 64),
    reason,
    state,
    vectorDigest:
      input.vectorDigest == null
        ? null
        : cleanDigest(input.vectorDigest, "vectorDigest"),
    vectorSpaceId: cleanPublicId(input.vectorSpaceId, "vectorSpaceId", 96),
  };
};

const beginCommand = async (
  tx,
  { actorId, commandId, commandKind, payload },
) => {
  const requestDigest = digestCommand({ commandKind, payload });
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${commandId}, 0))`;
  const [existing] = await tx`
    SELECT command_kind, actor_id, request_digest, response
    FROM manual_subject_tag_command WHERE command_id = ${commandId}
  `;
  if (existing) {
    if (
      existing.command_kind !== commandKind ||
      existing.actor_id !== actorId ||
      existing.request_digest !== requestDigest
    ) {
      throw typedError(
        "commandId was already used for a different typed manual tag command",
        409,
        "MANUAL_SUBJECT_TAG_COMMAND_CONFLICT",
      );
    }
    return { replay: { ...existing.response, replayed: true } };
  }
  return { commandId, replay: null, requestDigest };
};

const completeCommand = async (
  tx,
  { actorId, command, commandKind, decisionId, response },
) => {
  await tx`
    INSERT INTO manual_subject_tag_command (
      command_id, command_kind, actor_id, request_digest, decision_id,
      response, producer_receipt_id, privacy_class
    ) VALUES (
      ${command.commandId}, ${commandKind}, ${actorId},
      ${command.requestDigest}, ${decisionId || null}, ${tx.json(response)},
      ${receiptId}, 'private'
    )
  `;
  return response;
};

const sameRegion = (left, right) =>
  JSON.stringify(canonicalValue(left)) ===
  JSON.stringify(canonicalValue(right));

const reasonForKind = (subjectKind) =>
  subjectKind === "pet" ? "manual_pet" : "manual_person";

const quietMatchingStatus = (state) =>
  state === "eligible_for_evaluation"
    ? "eligible_for_review"
    : state === "abstained"
      ? "abstained"
      : state === "cancelled"
        ? "inactive"
        : state === "pending_provider"
          ? "waiting_for_provider"
          : "processing";

const responseTag = ({
  decisionId,
  displayName,
  observationId,
  region,
  subjectId,
  subjectKind,
  tagId,
  tagType,
  undoEligible = true,
  matchingStatus = null,
  matchingReason = null,
}) => ({
  decision: { decisionId, state: undoEligible ? "active" : "reverted" },
  geometry: region,
  observationId,
  provenance: "manual_user",
  subject: { displayName: displayName || "", subjectId, subjectKind },
  tagId,
  tagType,
  ...(tagType === "face"
    ? {
        identityStatus: undoEligible ? "accepted" : "inactive",
        matchingStatus: undoEligible
          ? matchingStatus || "waiting_for_provider"
          : "inactive",
        ...(matchingReason ? { matchingReason } : {}),
      }
    : {}),
  undo: {
    decisionId: undoEligible ? decisionId : null,
    eligible: undoEligible,
  },
});

export const createManualSubjectTagStore = (
  sql,
  { presentationRank = () => 0 } = {},
) => {
  const requireVisibleAsset = async (
    executor,
    assetId,
    { lock = false } = {},
  ) => {
    const rows = await executor`
      SELECT asset_id FROM asset
      WHERE asset_id = ${assetId} AND state = 'active'
        AND cimmich_visibility_asset_rank(asset_id) <= ${presentationRank()}
      ${lock ? executor`FOR UPDATE` : executor``}
    `;
    if (!rows[0]) {
      throw typedError(
        "Active asset was not found in the current viewing mode",
        404,
        "MANUAL_SUBJECT_TAG_ASSET_NOT_VISIBLE",
      );
    }
  };

  const requireSubject = async (executor, subjectId, subjectKind) => {
    const [subject] = await executor`
      SELECT person_id, display_name, subject_kind, status
      FROM person WHERE person_id = ${subjectId} AND status = 'active'
        AND cimmich_visibility_subject_rank(subject_kind, person_id)
          <= ${presentationRank()}
      FOR UPDATE
    `;
    if (!subject) {
      throw typedError(
        "Active subject was not found",
        404,
        "MANUAL_SUBJECT_TAG_SUBJECT_NOT_FOUND",
      );
    }
    if (subject.subject_kind !== subjectKind) {
      throw typedError(
        "subjectKind does not match the stable subject",
        409,
        "MANUAL_SUBJECT_TAG_SUBJECT_KIND_MISMATCH",
      );
    }
    return subject;
  };

  const createTypedEvidence = async (
    tx,
    {
      assetId,
      decisionId,
      presencePrevious = null,
      region,
      subjectId,
      subjectKind,
      tagType,
    },
  ) => {
    let observationId = null;
    let tagId;
    if (tagType === "face") {
      observationId = `face_manual_${randomUUID().replaceAll("-", "")}`;
      tagId = `claim_manual_${randomUUID().replaceAll("-", "")}`;
      await tx`
        INSERT INTO face_observation (
          face_id, asset_id, box_x, box_y, box_w, box_h,
          detection_confidence, quality_measurements, state,
          producer_receipt_id, privacy_class, observation_origin
        ) VALUES (
          ${observationId}, ${assetId}, ${region.x}, ${region.y}, ${region.w},
          ${region.h}, NULL, ${tx.json({ manualSubjectTag: true })}, 'valid',
          ${receiptId}, 'sensitive-biometric', 'manual_user'
        )
      `;
      await tx`
        INSERT INTO identity_claim (
          identity_claim_id, face_id, person_id, origin, state,
          evidence_refs, decision_id, producer_receipt_id, privacy_class
        ) VALUES (
          ${tagId}, ${observationId}, ${subjectId}, 'user', 'accepted',
          ${tx.json([{ type: "manual_subject_tag", tagType: "face" }])},
          ${decisionId}, ${receiptId}, 'sensitive-biometric'
        )
      `;
    } else if (tagType === "body") {
      observationId = `body_manual_${randomUUID().replaceAll("-", "")}`;
      tagId = `body_tag_manual_${randomUUID().replaceAll("-", "")}`;
      await tx`
        INSERT INTO body_observation (
          body_id, asset_id, box_x, box_y, box_w, box_h,
          quality_measurements, state, producer_receipt_id, privacy_class
        ) VALUES (
          ${observationId}, ${assetId}, ${region.x}, ${region.y}, ${region.w},
          ${region.h}, NULL, 'valid', ${receiptId}, 'private'
        )
      `;
      await tx`
        INSERT INTO body_tag (
          body_tag_id, person_id, body_id, origin, state, confidence,
          decision_id, producer_receipt_id, privacy_class
        ) VALUES (
          ${tagId}, ${subjectId}, ${observationId}, 'user', 'accepted', NULL,
          ${decisionId}, ${receiptId}, 'private'
        )
      `;
    } else if (tagType === "head") {
      observationId = `head_manual_${randomUUID().replaceAll("-", "")}`;
      tagId = `head_tag_manual_${randomUUID().replaceAll("-", "")}`;
      await tx`
        INSERT INTO manual_head_observation (
          head_id, asset_id, box_x, box_y, box_w, box_h,
          observation_origin, state, producer_receipt_id, privacy_class
        ) VALUES (
          ${observationId}, ${assetId}, ${region.x}, ${region.y}, ${region.w},
          ${region.h}, 'manual_user', 'valid', ${receiptId}, 'private'
        )
      `;
      await tx`
        INSERT INTO manual_head_tag (
          head_tag_id, head_id, subject_id, subject_kind, origin, state,
          decision_id, producer_receipt_id, privacy_class
        ) VALUES (
          ${tagId}, ${observationId}, ${subjectId}, ${subjectKind}, 'user',
          'accepted', ${decisionId}, ${receiptId}, 'private'
        )
      `;
    } else {
      if (presencePrevious) {
        await tx`
          UPDATE presence_tag SET state = 'superseded'
          WHERE presence_tag_id = ${presencePrevious.presence_tag_id}
        `;
      }
      tagId = `presence_tag_manual_${randomUUID().replaceAll("-", "")}`;
      await tx`
        INSERT INTO presence_tag (
          presence_tag_id, person_id, asset_id, origin, reason_code, note,
          state, confidence, decision_id, supersedes_presence_tag_id,
          producer_receipt_id, privacy_class, manual_geometry
        ) VALUES (
          ${tagId}, ${subjectId}, ${assetId}, 'user',
          ${reasonForKind(subjectKind)}, '', 'accepted', 1, ${decisionId},
          ${presencePrevious?.presence_tag_id || null}, ${receiptId}, 'private',
          ${tx.json({ kind: "region", ...region })}
        )
      `;
    }
    return { observationId, tagId };
  };

  const cancelFaceMatching = async (tx, operation) => {
    await tx`
      UPDATE source_pack_rebuild_request request
      SET state = 'failed', completed_at = now(),
        last_error = 'manual_face_undo_cancelled'
      FROM current_manual_face_matching_lifecycle lifecycle
      WHERE lifecycle.operation_id = ${operation.operation_id}
        AND lifecycle.rebuild_request_id = request.rebuild_request_id
        AND request.state = 'pending'
    `;
    await tx`
      INSERT INTO manual_face_matching_lifecycle (
        lifecycle_id, operation_id, identity_claim_id, face_id, scope_key,
        state, provider_id, model_family, model_version, config_digest,
        vector_space_id, embedding_id, vector_digest, evidence_digest,
        evidence_tier, reason, supersedes_lifecycle_id,
        producer_receipt_id, privacy_class
      )
      SELECT 'manualmatch_' || replace(gen_random_uuid()::text, '-', ''),
        lifecycle.operation_id, lifecycle.identity_claim_id, lifecycle.face_id,
        lifecycle.scope_key, 'cancelled', lifecycle.provider_id,
        lifecycle.model_family, lifecycle.model_version, lifecycle.config_digest,
        lifecycle.vector_space_id, lifecycle.embedding_id, lifecycle.vector_digest,
        lifecycle.evidence_digest, lifecycle.evidence_tier, NULL,
        lifecycle.lifecycle_id, ${receiptId}, 'sensitive-biometric'
      FROM current_manual_face_matching_lifecycle lifecycle
      WHERE lifecycle.operation_id = ${operation.operation_id}
        AND lifecycle.state <> 'cancelled'
    `;
  };

  const deactivateTypedEvidence = async (
    tx,
    operation,
    { cancelMatching = false } = {},
  ) => {
    if (operation.tag_type === "face") {
      if (cancelMatching) await cancelFaceMatching(tx, operation);
      await tx`
        UPDATE identity_claim SET state = 'superseded'
        WHERE identity_claim_id = ${operation.tag_id} AND state = 'accepted'
      `;
      await tx`
        UPDATE face_observation SET state = 'rejected'
        WHERE face_id = ${operation.observation_id} AND state = 'valid'
      `;
    } else if (operation.tag_type === "body") {
      await tx`
        UPDATE body_tag SET state = 'superseded'
        WHERE body_tag_id = ${operation.tag_id} AND state = 'accepted'
      `;
      await tx`
        UPDATE body_observation SET state = 'rejected'
        WHERE body_id = ${operation.observation_id} AND state = 'valid'
      `;
    } else if (operation.tag_type === "head") {
      await tx`
        UPDATE manual_head_tag SET state = 'superseded'
        WHERE head_tag_id = ${operation.tag_id} AND state = 'accepted'
      `;
      await tx`
        UPDATE manual_head_observation SET state = 'rejected'
        WHERE head_id = ${operation.observation_id} AND state = 'valid'
      `;
    } else {
      await tx`
        UPDATE presence_tag SET state = 'superseded'
        WHERE presence_tag_id = ${operation.tag_id} AND state = 'accepted'
      `;
    }
  };

  const restoreTypedEvidence = async (tx, operation) => {
    if (operation.tag_type === "face") {
      await tx`
        UPDATE face_observation SET state = 'valid'
        WHERE face_id = ${operation.observation_id} AND state = 'rejected'
      `;
      await tx`
        UPDATE identity_claim SET state = 'accepted'
        WHERE identity_claim_id = ${operation.tag_id} AND state = 'superseded'
      `;
    } else if (operation.tag_type === "body") {
      await tx`
        UPDATE body_observation SET state = 'valid'
        WHERE body_id = ${operation.observation_id} AND state = 'rejected'
      `;
      await tx`
        UPDATE body_tag SET state = 'accepted'
        WHERE body_tag_id = ${operation.tag_id} AND state = 'superseded'
      `;
    } else if (operation.tag_type === "head") {
      await tx`
        UPDATE manual_head_observation SET state = 'valid'
        WHERE head_id = ${operation.observation_id} AND state = 'rejected'
      `;
      await tx`
        UPDATE manual_head_tag SET state = 'accepted'
        WHERE head_tag_id = ${operation.tag_id} AND state = 'superseded'
      `;
    } else {
      await tx`
        UPDATE presence_tag SET state = 'accepted'
        WHERE presence_tag_id = ${operation.tag_id} AND state = 'superseded'
      `;
    }
  };

  const list = async ({ assetId }) => {
    const stableAssetId = cleanStableId(assetId, "assetId");
    await requireVisibleAsset(sql, stableAssetId);
    const rows = await sql`
      SELECT operation.tag_type, operation.tag_id, operation.observation_id,
        operation.decision_id, operation.subject_id, operation.subject_kind,
        command.response, subject.display_name, matching.state AS matching_state,
        matching.reason AS matching_reason
      FROM manual_subject_tag_operation operation
      JOIN manual_subject_tag_command command
        ON command.command_id = operation.command_id
      JOIN person subject ON subject.person_id = operation.subject_id
        AND subject.status = 'active'
      LEFT JOIN LATERAL (
        SELECT lifecycle.state, lifecycle.reason
        FROM current_manual_face_matching_lifecycle lifecycle
        WHERE lifecycle.operation_id = operation.operation_id
          AND (
            lifecycle.state <> 'eligible_for_evaluation'
            OR EXISTS (
              SELECT 1 FROM current_manual_face_matching_evidence evidence
              WHERE evidence.lifecycle_id = lifecycle.lifecycle_id
            )
          )
        ORDER BY CASE lifecycle.state
          WHEN 'eligible_for_evaluation' THEN 0 WHEN 'abstained' THEN 1
          WHEN 'pending_quality' THEN 2 WHEN 'pending_embedding' THEN 3
          WHEN 'pending_provider' THEN 4 ELSE 5 END,
          lifecycle.created_at DESC, lifecycle.lifecycle_id DESC
        LIMIT 1
      ) matching ON operation.tag_type = 'face'
      WHERE operation.asset_id = ${stableAssetId}
        AND operation.state = 'active'
        AND cimmich_visibility_subject_rank(
          subject.subject_kind, subject.person_id
        ) <= ${presentationRank()}
        AND (
          (operation.tag_type = 'face' AND EXISTS (
            SELECT 1 FROM identity_claim claim
            JOIN face_observation face ON face.face_id = claim.face_id
            WHERE claim.identity_claim_id = operation.tag_id
              AND face.face_id = operation.observation_id
              AND claim.state = 'accepted' AND claim.origin = 'user'
              AND face.state = 'valid' AND face.observation_origin = 'manual_user'
          ))
          OR (operation.tag_type = 'body' AND EXISTS (
            SELECT 1 FROM body_tag tag
            JOIN body_observation body ON body.body_id = tag.body_id
            WHERE tag.body_tag_id = operation.tag_id
              AND body.body_id = operation.observation_id
              AND tag.state = 'accepted' AND tag.origin = 'user'
              AND body.state = 'valid'
          ))
          OR (operation.tag_type = 'head' AND EXISTS (
            SELECT 1 FROM manual_head_tag tag
            JOIN manual_head_observation head ON head.head_id = tag.head_id
            WHERE tag.head_tag_id = operation.tag_id
              AND head.head_id = operation.observation_id
              AND tag.state = 'accepted' AND tag.origin = 'user'
              AND head.state = 'valid'
              AND head.observation_origin = 'manual_user'
          ))
          OR (operation.tag_type = 'presence' AND EXISTS (
            SELECT 1 FROM presence_tag tag
            WHERE tag.presence_tag_id = operation.tag_id
              AND tag.state = 'accepted'
          ))
        )
      ORDER BY operation.tag_type, operation.tag_id
    `;
    return {
      assetId: stableAssetId,
      items: rows.map((row) => ({
        ...row.response.tag,
        ...(row.tag_type === "face"
          ? {
              identityStatus: "accepted",
              matchingStatus: quietMatchingStatus(row.matching_state),
              ...(row.matching_reason
                ? { matchingReason: row.matching_reason }
                : {}),
            }
          : {}),
        subject: {
          displayName: row.display_name || "",
          subjectId: row.subject_id,
          subjectKind: row.subject_kind,
        },
      })),
      schemaVersion: manualSubjectTagSchemaVersion,
    };
  };

  const attach = async (input) => {
    const request = normalizeManualSubjectTagAttach(input);
    const payload = {
      assetId: request.assetId,
      region: request.region,
      subjectId: request.subjectId,
      subjectKind: request.subjectKind,
      tagType: request.tagType,
    };
    return sql.begin(async (tx) => {
      const command = await beginCommand(tx, {
        actorId: request.actorId,
        commandId: request.commandId,
        commandKind: "attach",
        payload,
      });
      if (command.replay) return command.replay;
      await requireVisibleAsset(tx, request.assetId, { lock: true });
      const subject = await requireSubject(
        tx,
        request.subjectId,
        request.subjectKind,
      );
      const sameRows = await tx`
        SELECT operation.decision_id, command.response
        FROM manual_subject_tag_operation operation
        JOIN manual_subject_tag_command command
          ON command.command_id = operation.command_id
        WHERE operation.asset_id = ${request.assetId}
          AND operation.subject_id = ${request.subjectId}
          AND operation.subject_kind = ${request.subjectKind}
          AND operation.tag_type = ${request.tagType}
          AND operation.state = 'active'
          AND (
            (operation.tag_type = 'face' AND EXISTS (
              SELECT 1 FROM identity_claim claim
              JOIN face_observation face ON face.face_id = claim.face_id
              WHERE claim.identity_claim_id = operation.tag_id
                AND face.face_id = operation.observation_id
                AND claim.state = 'accepted' AND face.state = 'valid'
            ))
            OR (operation.tag_type = 'body' AND EXISTS (
              SELECT 1 FROM body_tag tag
              JOIN body_observation body ON body.body_id = tag.body_id
              WHERE tag.body_tag_id = operation.tag_id
                AND body.body_id = operation.observation_id
                AND tag.state = 'accepted' AND body.state = 'valid'
            ))
            OR (operation.tag_type = 'head' AND EXISTS (
              SELECT 1 FROM manual_head_tag tag
              JOIN manual_head_observation head ON head.head_id = tag.head_id
              WHERE tag.head_tag_id = operation.tag_id
                AND head.head_id = operation.observation_id
                AND tag.state = 'accepted' AND head.state = 'valid'
            ))
            OR (operation.tag_type = 'presence' AND EXISTS (
              SELECT 1 FROM presence_tag tag
              WHERE tag.presence_tag_id = operation.tag_id AND tag.state = 'accepted'
            ))
          )
        ORDER BY operation.created_at DESC, operation.operation_id DESC
      `;
      const same = sameRows.find((row) =>
        sameRegion(row.response?.tag?.geometry, request.region),
      );
      if (same && sameRegion(same.response?.tag?.geometry, request.region)) {
        const response = {
          assetId: request.assetId,
          changed: false,
          replayed: false,
          schemaVersion: manualSubjectTagSchemaVersion,
          status: "no_change",
          tag: {
            ...same.response.tag,
            subject: {
              displayName: subject.display_name || "",
              subjectId: subject.person_id,
              subjectKind: subject.subject_kind,
            },
          },
        };
        return completeCommand(tx, {
          actorId: request.actorId,
          command,
          commandKind: "attach",
          decisionId: null,
          response,
        });
      }

      let previous = null;
      if (request.tagType === "presence") {
        [previous] = await tx`
          SELECT tag.presence_tag_id, tag.origin, tag.reason_code, tag.note,
            tag.state, tag.confidence, tag.manual_geometry
          FROM current_presence_tag tag
          WHERE tag.person_id = ${request.subjectId}
            AND tag.asset_id = ${request.assetId}
          ORDER BY tag.created_at DESC, tag.presence_tag_id DESC
          LIMIT 1 FOR UPDATE
        `;
        if (
          previous?.state === "accepted" &&
          !new Set([
            "manual_person",
            "manual_pet",
            "manual_presence",
            "manual_pet_undo",
          ]).has(previous.reason_code)
        ) {
          throw typedError(
            "Existing Presence has different authority and was not changed",
            409,
            "MANUAL_SUBJECT_TAG_AUTHORITY_CONFLICT",
          );
        }
      }

      const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
      await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'manual_subject_tag',
          ${`${request.tagType}:${request.subjectKind}:${request.subjectId}:${request.assetId}`},
          'attach', 'user', ${request.actorId}, 'typed_manual_subject_tag_attach',
          ${`Attach manual ${request.tagType} tag`}, ${receiptId}, 'private'
        )
      `;

      const operationId = `manualtagop_${randomUUID().replaceAll("-", "")}`;
      const { observationId, tagId } = await createTypedEvidence(tx, {
        assetId: request.assetId,
        decisionId,
        presencePrevious: previous,
        region: request.region,
        subjectId: request.subjectId,
        subjectKind: request.subjectKind,
        tagType: request.tagType,
      });

      const tag = responseTag({
        decisionId,
        displayName: subject.display_name,
        observationId,
        region: request.region,
        subjectId: subject.person_id,
        subjectKind: subject.subject_kind,
        tagId,
        tagType: request.tagType,
      });
      const response = {
        assetId: request.assetId,
        changed: true,
        replayed: false,
        schemaVersion: manualSubjectTagSchemaVersion,
        status: "applied",
        tag,
      };
      await completeCommand(tx, {
        actorId: request.actorId,
        command,
        commandKind: "attach",
        decisionId,
        response,
      });
      await tx`
        INSERT INTO manual_subject_tag_operation (
          operation_id, command_id, subject_id, subject_kind, asset_id,
          tag_type, tag_id, observation_id, decision_id, previous_tag_id,
          snapshot, state, producer_receipt_id, privacy_class
        ) VALUES (
          ${operationId},
          ${request.commandId}, ${request.subjectId}, ${request.subjectKind},
          ${request.assetId}, ${request.tagType}, ${tagId}, ${observationId},
          ${decisionId}, ${previous?.presence_tag_id || null},
          ${tx.json({
            previous: previous
              ? {
                  confidence:
                    previous.confidence == null
                      ? null
                      : Number(previous.confidence),
                  geometry: previous.manual_geometry || null,
                  note: previous.note || "",
                  origin: previous.origin,
                  reasonCode: previous.reason_code,
                  state: previous.state,
                  tagId: previous.presence_tag_id,
                }
              : null,
          })},
          'active', ${receiptId}, 'private'
        )
      `;
      if (request.tagType === "face") {
        await tx`
          INSERT INTO manual_face_matching_lifecycle (
            lifecycle_id, operation_id, identity_claim_id, face_id, scope_key,
            state, producer_receipt_id, privacy_class
          ) VALUES (
            ${`manualmatch_${randomUUID().replaceAll("-", "")}`}, ${operationId},
            ${tagId}, ${observationId}, 'provider_neutral', 'pending_provider',
            ${receiptId}, 'sensitive-biometric'
          )
        `;
      }
      await tx`
        UPDATE person SET current_revision = current_revision + 1
        WHERE person_id = ${request.subjectId}
      `;
      return response;
    });
  };

  const replace = async (input) => {
    const request = normalizeManualSubjectTagReplace(input);
    const payload = {
      expectedDecisionId: request.expectedDecisionId,
      region: request.region,
      subjectId: request.subjectId,
      subjectKind: request.subjectKind,
      tagId: request.tagId,
      tagType: request.tagType,
    };
    return sql.begin(async (tx) => {
      const command = await beginCommand(tx, {
        actorId: request.actorId,
        commandId: request.commandId,
        commandKind: "replace",
        payload,
      });
      if (command.replay) return command.replay;

      const [current] = await tx`
        SELECT operation.operation_id, operation.command_id,
          operation.subject_id, operation.subject_kind, operation.asset_id,
          operation.tag_type, operation.tag_id, operation.observation_id,
          operation.decision_id, operation.snapshot, operation.state,
          command.response
        FROM manual_subject_tag_operation operation
        JOIN manual_subject_tag_command command
          ON command.command_id = operation.command_id
        JOIN asset ON asset.asset_id = operation.asset_id AND asset.state = 'active'
        WHERE operation.tag_id = ${request.tagId}
          AND operation.state = 'active'
          AND cimmich_visibility_asset_rank(operation.asset_id)
            <= ${presentationRank()}
          AND (
            (operation.tag_type = 'face' AND EXISTS (
              SELECT 1 FROM identity_claim claim
              JOIN face_observation face ON face.face_id = claim.face_id
              WHERE claim.identity_claim_id = operation.tag_id
                AND face.face_id = operation.observation_id
                AND claim.state = 'accepted' AND claim.origin = 'user'
                AND face.state = 'valid'
                AND face.observation_origin = 'manual_user'
            ))
            OR (operation.tag_type = 'body' AND EXISTS (
              SELECT 1 FROM body_tag tag
              JOIN body_observation body ON body.body_id = tag.body_id
              WHERE tag.body_tag_id = operation.tag_id
                AND body.body_id = operation.observation_id
                AND tag.state = 'accepted' AND tag.origin = 'user'
                AND body.state = 'valid'
            ))
            OR (operation.tag_type = 'head' AND EXISTS (
              SELECT 1 FROM manual_head_tag tag
              JOIN manual_head_observation head ON head.head_id = tag.head_id
              WHERE tag.head_tag_id = operation.tag_id
                AND head.head_id = operation.observation_id
                AND tag.state = 'accepted' AND tag.origin = 'user'
                AND head.state = 'valid'
            ))
            OR (operation.tag_type = 'presence' AND EXISTS (
              SELECT 1 FROM presence_tag tag
              WHERE tag.presence_tag_id = operation.tag_id
                AND tag.state = 'accepted'
            ))
          )
        FOR UPDATE OF operation, asset
      `;
      if (!current) {
        throw typedError(
          "Typed manual tag is not current or visible",
          409,
          "MANUAL_SUBJECT_TAG_REPLACE_NOT_CURRENT",
        );
      }
      if (current.decision_id !== request.expectedDecisionId) {
        throw typedError(
          "Typed manual tag decision changed before replacement",
          409,
          "MANUAL_SUBJECT_TAG_REPLACE_STALE",
        );
      }
      const subject = await requireSubject(
        tx,
        request.subjectId,
        request.subjectKind,
      );
      const currentRegion = current.response?.tag?.geometry;
      if (
        current.subject_id === request.subjectId &&
        current.subject_kind === request.subjectKind &&
        current.tag_type === request.tagType &&
        sameRegion(currentRegion, request.region)
      ) {
        const response = {
          assetId: current.asset_id,
          changed: false,
          replayed: false,
          schemaVersion: manualSubjectTagSchemaVersion,
          status: "no_change",
          tag: {
            ...current.response.tag,
            subject: {
              displayName: subject.display_name || "",
              subjectId: subject.person_id,
              subjectKind: subject.subject_kind,
            },
          },
        };
        return completeCommand(tx, {
          actorId: request.actorId,
          command,
          commandKind: "replace",
          decisionId: null,
          response,
        });
      }

      const [typedCollision] = await tx`
        SELECT operation.operation_id
        FROM manual_subject_tag_operation operation
        JOIN manual_subject_tag_command command
          ON command.command_id = operation.command_id
        WHERE operation.asset_id = ${current.asset_id}
          AND operation.subject_id = ${request.subjectId}
          AND operation.subject_kind = ${request.subjectKind}
          AND operation.tag_type = ${request.tagType}
          AND operation.state = 'active'
          AND operation.operation_id <> ${current.operation_id}
          AND (
            operation.tag_type = 'presence'
            OR command.response->'tag'->'geometry' = ${tx.json(request.region)}
          )
        LIMIT 1 FOR UPDATE OF operation
      `;
      const [presenceCollision] =
        request.tagType === "presence"
          ? await tx`
              SELECT tag.presence_tag_id
              FROM current_presence_tag tag
              WHERE tag.person_id = ${request.subjectId}
                AND tag.asset_id = ${current.asset_id}
                AND tag.state = 'accepted'
                AND tag.presence_tag_id <> ${
                  current.tag_type === "presence" ? current.tag_id : ""
                }
              LIMIT 1 FOR UPDATE OF tag
            `
          : [];
      if (typedCollision || presenceCollision) {
        throw typedError(
          "Replacement target is already represented by another active tag",
          409,
          "MANUAL_SUBJECT_TAG_REPLACE_TARGET_CONFLICT",
        );
      }

      const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
      await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, supersedes_decision_id, producer_receipt_id,
          privacy_class
        ) VALUES (
          ${decisionId}, 'manual_subject_tag',
          ${`${request.tagType}:${request.subjectKind}:${request.subjectId}:${current.asset_id}`},
          'update', 'user', ${request.actorId},
          'typed_manual_subject_tag_replace',
          ${`Replace manual ${current.tag_type} tag with ${request.tagType}`},
          ${current.decision_id}, ${receiptId}, 'private'
        )
      `;

      await deactivateTypedEvidence(tx, current);
      await tx`
        UPDATE manual_subject_tag_operation SET state = 'superseded'
        WHERE operation_id = ${current.operation_id} AND state = 'active'
      `;
      const { observationId, tagId } = await createTypedEvidence(tx, {
        assetId: current.asset_id,
        decisionId,
        region: request.region,
        subjectId: request.subjectId,
        subjectKind: request.subjectKind,
        tagType: request.tagType,
      });
      const operationId = `manualtagop_${randomUUID().replaceAll("-", "")}`;
      const tag = responseTag({
        decisionId,
        displayName: subject.display_name,
        observationId,
        region: request.region,
        subjectId: subject.person_id,
        subjectKind: subject.subject_kind,
        tagId,
        tagType: request.tagType,
      });
      const response = {
        assetId: current.asset_id,
        changed: true,
        replayed: false,
        schemaVersion: manualSubjectTagSchemaVersion,
        status: "replaced",
        supersedesDecisionId: current.decision_id,
        tag,
      };
      await completeCommand(tx, {
        actorId: request.actorId,
        command,
        commandKind: "replace",
        decisionId,
        response,
      });
      await tx`
        INSERT INTO manual_subject_tag_operation (
          operation_id, command_id, subject_id, subject_kind, asset_id,
          tag_type, tag_id, observation_id, decision_id, previous_tag_id,
          snapshot, state, replaces_operation_id, expected_decision_id,
          producer_receipt_id, privacy_class
        ) VALUES (
          ${operationId}, ${request.commandId}, ${request.subjectId},
          ${request.subjectKind}, ${current.asset_id}, ${request.tagType},
          ${tagId}, ${observationId}, ${decisionId}, NULL,
          ${tx.json({
            prior: {
              decisionId: current.decision_id,
              operationId: current.operation_id,
              response: current.response,
            },
          })},
          'active', ${current.operation_id}, ${current.decision_id},
          ${receiptId}, 'private'
        )
      `;
      if (request.tagType === "face") {
        await tx`
          INSERT INTO manual_face_matching_lifecycle (
            lifecycle_id, operation_id, identity_claim_id, face_id, scope_key,
            state, producer_receipt_id, privacy_class
          ) VALUES (
            ${`manualmatch_${randomUUID().replaceAll("-", "")}`}, ${operationId},
            ${tagId}, ${observationId}, 'provider_neutral', 'pending_provider',
            ${receiptId}, 'sensitive-biometric'
          )
        `;
      }
      await tx`
        UPDATE person SET current_revision = current_revision + 1
        WHERE person_id = ${current.subject_id}
      `;
      if (current.subject_id !== request.subjectId) {
        await tx`
          UPDATE person SET current_revision = current_revision + 1
          WHERE person_id = ${request.subjectId}
        `;
      }
      return response;
    });
  };

  const undo = async (input) => {
    const request = normalizeUndo(input);
    return sql.begin(async (tx) => {
      const command = await beginCommand(tx, {
        actorId: request.actorId,
        commandId: request.commandId,
        commandKind: "undo",
        payload: { decisionId: request.decisionId },
      });
      if (command.replay) return command.replay;
      const [operation] = await tx`
        SELECT operation.operation_id, operation.asset_id, operation.subject_id,
          operation.subject_kind, operation.asset_id, operation.tag_type,
          operation.tag_id, operation.observation_id, operation.decision_id,
          operation.snapshot, operation.state, operation.replaces_operation_id,
          operation.expected_decision_id
        FROM manual_subject_tag_operation operation
        JOIN asset ON asset.asset_id = operation.asset_id AND asset.state = 'active'
        WHERE operation.decision_id = ${request.decisionId}
          AND cimmich_visibility_asset_rank(operation.asset_id)
            <= ${presentationRank()}
        FOR UPDATE OF operation, asset
      `;
      if (!operation || operation.state !== "active") {
        throw typedError(
          "Typed manual tag decision is not available for Undo",
          409,
          "MANUAL_SUBJECT_TAG_UNDO_NOT_AVAILABLE",
        );
      }
      await requireVisibleAsset(tx, operation.asset_id, { lock: true });
      const subject = await requireSubject(
        tx,
        operation.subject_id,
        operation.subject_kind,
      );

      let current;
      if (operation.tag_type === "face") {
        [current] = await tx`
          SELECT claim.identity_claim_id AS tag_id, face.face_id AS observation_id
          FROM identity_claim claim
          JOIN face_observation face ON face.face_id = claim.face_id
          WHERE claim.identity_claim_id = ${operation.tag_id}
            AND claim.face_id = ${operation.observation_id}
            AND claim.state = 'accepted'
            AND face.state = 'valid'
            AND face.observation_origin = 'manual_user'
            AND NOT EXISTS (
              SELECT 1 FROM identity_claim later
              WHERE later.supersedes_claim_id = claim.identity_claim_id
                OR (later.face_id = claim.face_id
                  AND later.identity_claim_id <> claim.identity_claim_id
                  AND later.state = 'accepted')
            )
            AND NOT EXISTS (
              SELECT 1 FROM current_body_tag body
              WHERE body.identity_claim_id = claim.identity_claim_id
                AND body.state = 'accepted'
            )
          FOR UPDATE OF claim, face
        `;
      } else if (operation.tag_type === "body") {
        [current] = await tx`
          SELECT tag.body_tag_id AS tag_id, body.body_id AS observation_id
          FROM body_tag tag
          JOIN body_observation body ON body.body_id = tag.body_id
          WHERE tag.body_tag_id = ${operation.tag_id}
            AND tag.body_id = ${operation.observation_id}
            AND tag.state = 'accepted' AND tag.origin = 'user'
            AND body.state = 'valid'
            AND NOT EXISTS (
              SELECT 1 FROM body_tag later
              WHERE later.supersedes_body_tag_id = tag.body_tag_id
                OR (later.body_id = tag.body_id
                  AND later.body_tag_id <> tag.body_tag_id
                  AND later.state = 'accepted')
            )
          FOR UPDATE OF tag, body
        `;
      } else if (operation.tag_type === "head") {
        [current] = await tx`
          SELECT tag.head_tag_id AS tag_id, head.head_id AS observation_id
          FROM manual_head_tag tag
          JOIN manual_head_observation head ON head.head_id = tag.head_id
          WHERE tag.head_tag_id = ${operation.tag_id}
            AND head.head_id = ${operation.observation_id}
            AND tag.state = 'accepted' AND tag.origin = 'user'
            AND head.state = 'valid'
          FOR UPDATE OF tag, head
        `;
      } else {
        [current] = await tx`
          SELECT tag.presence_tag_id AS tag_id
          FROM presence_tag tag
          WHERE tag.presence_tag_id = ${operation.tag_id}
            AND tag.state = 'accepted'
            AND NOT EXISTS (
              SELECT 1 FROM presence_tag later
              WHERE later.supersedes_presence_tag_id = tag.presence_tag_id
            )
          FOR UPDATE OF tag
        `;
      }
      if (!current) {
        throw typedError(
          "Typed manual tag changed after this decision",
          409,
          "MANUAL_SUBJECT_TAG_UNDO_STALE",
        );
      }

      const undoDecisionId = `decision_${randomUUID().replaceAll("-", "")}`;
      await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, supersedes_decision_id, producer_receipt_id,
          privacy_class
        ) VALUES (
          ${undoDecisionId}, 'manual_subject_tag',
          ${`${operation.tag_type}:${operation.tag_id}`}, 'undo', 'user',
          ${request.actorId}, 'typed_manual_subject_tag_undo',
          ${`Undo manual ${operation.tag_type} tag`}, ${operation.decision_id},
          ${receiptId}, 'private'
        )
      `;
      if (operation.replaces_operation_id) {
        const [prior] = await tx`
          SELECT prior.operation_id, prior.subject_id, prior.subject_kind,
            prior.asset_id, prior.tag_type, prior.tag_id, prior.observation_id,
            prior.decision_id, prior.snapshot, prior.state,
            command.response
          FROM manual_subject_tag_operation prior
          JOIN manual_subject_tag_command command
            ON command.command_id = prior.command_id
          WHERE prior.operation_id = ${operation.replaces_operation_id}
            AND prior.state = 'superseded'
            AND prior.decision_id = ${operation.expected_decision_id}
            AND NOT EXISTS (
              SELECT 1 FROM manual_subject_tag_operation later
              WHERE later.replaces_operation_id = ${operation.operation_id}
                AND later.state <> 'reverted'
            )
          FOR UPDATE OF prior
        `;
        if (!prior) {
          throw typedError(
            "Replacement prior state changed after this decision",
            409,
            "MANUAL_SUBJECT_TAG_UNDO_STALE",
          );
        }
        const priorSubject = await requireSubject(
          tx,
          prior.subject_id,
          prior.subject_kind,
        );
        await deactivateTypedEvidence(tx, operation, {
          cancelMatching: operation.tag_type === "face",
        });
        await tx`
          UPDATE manual_subject_tag_operation
          SET state = 'reverted', undo_decision_id = ${undoDecisionId},
            reverted_at = now()
          WHERE operation_id = ${operation.operation_id} AND state = 'active'
        `;
        await restoreTypedEvidence(tx, prior);
        await tx`
          UPDATE manual_subject_tag_operation SET state = 'active'
          WHERE operation_id = ${prior.operation_id} AND state = 'superseded'
        `;
        await tx`
          UPDATE person SET current_revision = current_revision + 1
          WHERE person_id = ${operation.subject_id}
        `;
        if (operation.subject_id !== prior.subject_id) {
          await tx`
            UPDATE person SET current_revision = current_revision + 1
            WHERE person_id = ${prior.subject_id}
          `;
        }
        const restoredTag = responseTag({
          decisionId: prior.decision_id,
          displayName: priorSubject.display_name,
          observationId: prior.observation_id,
          region: prior.response?.tag?.geometry,
          subjectId: priorSubject.person_id,
          subjectKind: priorSubject.subject_kind,
          tagId: prior.tag_id,
          tagType: prior.tag_type,
        });
        const response = {
          assetId: prior.asset_id,
          changed: true,
          replayed: false,
          schemaVersion: manualSubjectTagSchemaVersion,
          status: "restored",
          supersedesDecisionId: operation.decision_id,
          tag: restoredTag,
        };
        return completeCommand(tx, {
          actorId: request.actorId,
          command,
          commandKind: "undo",
          decisionId: undoDecisionId,
          response,
        });
      }
      if (operation.tag_type === "face") {
        await deactivateTypedEvidence(tx, operation, { cancelMatching: true });
      } else if (operation.tag_type === "body") {
        await deactivateTypedEvidence(tx, operation);
      } else if (operation.tag_type === "head") {
        await deactivateTypedEvidence(tx, operation);
      } else {
        await tx`
          UPDATE presence_tag SET state = 'superseded'
          WHERE presence_tag_id = ${operation.tag_id} AND state = 'accepted'
        `;
        const previous = operation.snapshot?.previous || null;
        if (previous) {
          await tx`
            INSERT INTO presence_tag (
              presence_tag_id, person_id, asset_id, origin, reason_code, note,
              state, confidence, decision_id, supersedes_presence_tag_id,
              producer_receipt_id, privacy_class, manual_geometry
            ) VALUES (
              ${`presence_tag_manual_${randomUUID().replaceAll("-", "")}`},
              ${operation.subject_id}, ${operation.asset_id}, ${previous.origin},
              ${previous.reasonCode}, ${previous.note}, ${previous.state},
              ${previous.confidence}, ${undoDecisionId}, ${operation.tag_id},
              ${receiptId}, 'private',
              ${previous.geometry ? tx.json(previous.geometry) : null}
            )
          `;
        }
      }
      await tx`
        UPDATE manual_subject_tag_operation
        SET state = 'reverted', undo_decision_id = ${undoDecisionId},
          reverted_at = now()
        WHERE operation_id = ${operation.operation_id}
      `;
      await tx`
        UPDATE person SET current_revision = current_revision + 1
        WHERE person_id = ${operation.subject_id}
      `;
      const originalRegion = operation.snapshot?.region || null;
      const [originalCommand] = await tx`
        SELECT response FROM manual_subject_tag_command
        WHERE decision_id = ${operation.decision_id}
      `;
      const tag = responseTag({
        decisionId: undoDecisionId,
        displayName: subject.display_name,
        observationId: operation.observation_id,
        region: originalRegion || originalCommand?.response?.tag?.geometry,
        subjectId: subject.person_id,
        subjectKind: subject.subject_kind,
        tagId: operation.tag_id,
        tagType: operation.tag_type,
        undoEligible: false,
      });
      const response = {
        assetId: operation.asset_id,
        changed: true,
        replayed: false,
        schemaVersion: manualSubjectTagSchemaVersion,
        status: "reverted",
        supersedesDecisionId: operation.decision_id,
        tag,
      };
      return completeCommand(tx, {
        actorId: request.actorId,
        command,
        commandKind: "undo",
        decisionId: undoDecisionId,
        response,
      });
    });
  };

  const transitionMatching = async (input) => {
    const request = normalizeManualFaceMatchingTransition(input);
    const scopeKey = digestCommand({
      configDigest: request.configDigest,
      modelFamily: request.modelFamily,
      modelVersion: request.modelVersion,
      providerId: request.providerId,
      vectorSpaceId: request.vectorSpaceId,
    });
    const payload = { ...request, actorId: undefined, commandId: undefined };
    delete payload.actorId;
    delete payload.commandId;
    return sql.begin(async (tx) => {
      const command = await beginCommand(tx, {
        actorId: request.actorId,
        commandId: request.commandId,
        commandKind: "matching_transition",
        payload,
      });
      if (command.replay) return command.replay;
      const [operation] = await tx`
        SELECT operation.operation_id, operation.asset_id, operation.subject_id,
          operation.tag_id AS identity_claim_id,
          operation.observation_id AS face_id, operation.state
        FROM manual_subject_tag_operation operation
        JOIN identity_claim claim ON claim.identity_claim_id = operation.tag_id
          AND claim.face_id = operation.observation_id AND claim.origin = 'user'
          AND claim.state = 'accepted'
        JOIN face_observation face ON face.face_id = operation.observation_id
          AND face.observation_origin = 'manual_user' AND face.state = 'valid'
        WHERE operation.operation_id = ${request.operationId}
          AND operation.tag_type = 'face' AND operation.state = 'active'
        FOR UPDATE OF operation, claim, face
      `;
      if (!operation) {
        throw typedError(
          "Manual Face operation is not current",
          409,
          "MANUAL_FACE_MATCHING_OPERATION_STALE",
        );
      }
      await requireVisibleAsset(tx, operation.asset_id, { lock: true });
      const [current] = await tx`
        SELECT lifecycle_id, state
        FROM current_manual_face_matching_lifecycle
        WHERE operation_id = ${operation.operation_id} AND scope_key = ${scopeKey}
        FOR UPDATE
      `;
      if (current?.state === "cancelled") {
        throw typedError(
          "Manual Face matching scope is cancelled",
          409,
          "MANUAL_FACE_MATCHING_OPERATION_STALE",
        );
      }
      const lifecycleId = `manualmatch_${randomUUID().replaceAll("-", "")}`;
      const rebuildRequestId = null;
      await tx`
        INSERT INTO manual_face_matching_lifecycle (
          lifecycle_id, operation_id, identity_claim_id, face_id, scope_key,
          state, reason, provider_id, model_family, model_version, config_digest,
          vector_space_id, embedding_id, vector_digest, evidence_digest,
          evidence_tier, rebuild_request_id, supersedes_lifecycle_id,
          producer_receipt_id, privacy_class
        ) VALUES (
          ${lifecycleId}, ${operation.operation_id}, ${operation.identity_claim_id},
          ${operation.face_id}, ${scopeKey}, ${request.state}, ${request.reason},
          ${request.providerId}, ${request.modelFamily}, ${request.modelVersion},
          ${request.configDigest}, ${request.vectorSpaceId}, ${request.embeddingId},
          ${request.vectorDigest}, ${request.evidenceDigest}, ${request.evidenceTier},
          ${rebuildRequestId}, ${current?.lifecycle_id || null}, ${receiptId},
          'sensitive-biometric'
        )
      `;
      const response = {
        changed: true,
        identityStatus: "accepted",
        matchingStatus: quietMatchingStatus(request.state),
        ...(request.reason ? { matchingReason: request.reason } : {}),
        operationId: operation.operation_id,
        rebuildStatus: rebuildRequestId ? "queued" : "not_queued",
        replayed: false,
        schemaVersion: manualSubjectTagSchemaVersion,
      };
      return completeCommand(tx, {
        actorId: request.actorId,
        command,
        commandKind: "matching_transition",
        decisionId: null,
        response,
      });
    });
  };

  return { attach, list, replace, transitionMatching, undo };
};
