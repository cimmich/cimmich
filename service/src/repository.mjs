import { createHash, randomUUID } from "node:crypto";
import { samePhotoAcceptedCandidateFloor } from "./candidate-context-policy.mjs";
import {
  applyPrimeCurations,
  buildPrimeCurations,
  loadPrimeCuratorFaces,
} from "./prime-curator-repository.mjs";
import { projectAssetFaceBodyLinks } from "./face-body-linker.mjs";
import {
  applyFaceBodyLinks,
  buildFaceBodyLinks,
  loadFaceBodyLinkAssets,
} from "./face-body-linker-repository.mjs";
import { lowQualityReasons } from "./low-quality-policy.mjs";
import { createMediaJobLedger } from "./media-job-ledger.mjs";
import { createManualSubjectPresenceStore } from "./manual-subject-presence.mjs";
import { createManualSubjectTagStore } from "./manual-subject-tag.mjs";
import { createManualPhotoContextStore } from "./manual-photo-context.mjs";
import { projectBodyPose, stripBodyPoseStorage } from "./body-pose.mjs";
import { createPersonProfileStore } from "./person-profile.mjs";
import { createPersonDetailsDisplayStore } from "./person-details-display.mjs";
import { createPetDocumentStore } from "./pet-documents.mjs";
import { createContextEntityStore } from "./context-entities.mjs";
import { createBasicSmartSearch } from "./basic-smart-search.mjs";
import { createDocumentStore } from "./documents.mjs";
import { createDocumentLegacyPetStore } from "./document-legacy-pet.mjs";
import { createObservationCorrectionStore } from "./observation-correction.mjs";
import { createPersonCreateStore } from "./person-create.mjs";
import { createVisualCandidateSetRepository } from "./visual-candidate-set.mjs";
import {
  classifyFaceConditionObservation,
  waveOneFaceConditionPolicyV1,
} from "./face-condition-classifier.mjs";

const decisionReceiptId = "receipt_cimmich_local_review_service_v1";
const userCommandReceiptId = "receipt_cimmich_local_identity_commands_v1";
const petManualReceiptId = "receipt_cimmich_pet_manual_management_v1";
const machineMatcherPolicyVersion = "cimmich-best-prime-v1";
const sha256Pattern = /^[0-9a-f]{64}$/;
// One fixed scorer frontier backs Summary, People and Steward. It preserves the
// established 24-item review surface's 2x candidate budget while allowing every
// caller limit to be an output-only truncation.
const machineSuggestionQueryLimit = 48;
const machineSuggestionRuntimeQueryLimit = 16;
// Each routed Face is exactly four governed evidence statements (candidate
// binding/frontier plus current-quality/reference replay). One deterministic
// Face per snapshot is the hard SQL budget while this remains lab-only.
const allTrustedShortlistBatchLimit = 1;
const allTrustedShortlistConcurrency = 1;
const allTrustedShortlistStatementTimeoutMs = 4_000;
const allTrustedShortlistTransactionTimeoutMs = 12_000;
const normalizeMatchingProvider = (value) => {
  if (value == null) return null;
  const boundedId = (input, label, maximum = 160) => {
    const normalized = String(input || "").trim();
    if (
      !normalized ||
      normalized.length > maximum ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(normalized)
    ) {
      throw new Error(`Matching provider ${label} is invalid`);
    }
    return normalized;
  };
  const configDigest = String(value.configDigest || "").trim();
  if (!sha256Pattern.test(configDigest)) {
    throw new Error("Matching provider configDigest is invalid");
  }
  return Object.freeze({
    configDigest,
    modelFamily: boundedId(value.modelFamily, "modelFamily"),
    modelVersion: boundedId(value.modelVersion, "modelVersion"),
    providerId: boundedId(value.providerId, "providerId"),
    vectorSpaceId: boundedId(value.vectorSpaceId, "vectorSpaceId", 192),
  });
};
const cleanLimit = (value, fallback, maximum) =>
  Math.min(
    maximum,
    Math.max(1, Number.parseInt(String(value || fallback), 10) || fallback),
  );
const isFaceHardShortlistOpportunity = (suggestion) => {
  const quality = suggestion.quality_measurements || {};
  const nullableNumber = (value) => (value == null ? null : Number(value));
  const faceAreaRatio = Number(
    (Number(suggestion.box_w) * Number(suggestion.box_h)).toFixed(6),
  );
  try {
    return (
      classifyFaceConditionObservation({
        observation: {
          detectionConfidence: nullableNumber(suggestion.detection_confidence),
          faceAreaRatio,
          frontalScore: nullableNumber(quality.frontal_score),
          qualityScore: nullableNumber(quality.quality_score),
        },
        policy: waveOneFaceConditionPolicyV1,
      }).qualityBucket === "face_hard"
    );
  } catch {
    return false;
  }
};
const cleanActor = (value) =>
  String(value || "")
    .trim()
    .slice(0, 120);
const cleanPersonName = (value) => {
  const name = String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 160);
  if (!name)
    throw Object.assign(new Error("Person name is required"), {
      statusCode: 400,
    });
  return name;
};
const typedError = (message, statusCode, code, details) =>
  Object.assign(new Error(message), {
    code,
    statusCode,
    ...(details ? { details } : {}),
  });
const personPageSchemaVersion = "cimmich.person-projection-page.v1";
const cleanPageSize = (value, fallback = 120, maximum = 250) => {
  if (value === null || value === undefined || String(value).trim() === "") {
    return fallback;
  }
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw typedError(
      `pageSize must be an integer from 1 to ${maximum}`,
      400,
      "PERSON_PAGE_SIZE_INVALID",
    );
  }
  return parsed || fallback;
};
const encodePersonPageCursor = (payload) =>
  Buffer.from(JSON.stringify({ ...payload, v: 1 }), "utf8").toString(
    "base64url",
  );
const decodePersonPageCursor = (value, { kind, personId, visibleRank }) => {
  if (!value) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(String(value), "base64url").toString("utf8"),
    );
    if (
      payload?.v !== 1 ||
      payload?.kind !== kind ||
      payload?.personId !== personId ||
      payload?.visibleRank !== visibleRank
    ) {
      throw new Error("cursor scope mismatch");
    }
    const captureTimeValid =
      payload.captureTime === null ||
      (typeof payload.captureTime === "string" &&
        Number.isFinite(Date.parse(payload.captureTime)));
    const keyValid =
      kind === "assets"
        ? typeof payload.assetId === "string" && payload.assetId.length > 0
        : typeof payload.faceId === "string" &&
          payload.faceId.length > 0 &&
          (payload.quality === null || Number.isFinite(payload.quality));
    if (!captureTimeValid || !keyValid) {
      throw new Error("cursor key invalid");
    }
    return payload;
  } catch {
    throw typedError(
      "Person projection cursor is invalid for this Person or viewing mode",
      400,
      "PERSON_PAGE_CURSOR_INVALID",
    );
  }
};
const cleanCommandId = (value) => {
  const commandId = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$/.test(commandId)) {
    throw typedError(
      "A stable commandId of 8 to 120 safe characters is required",
      400,
      "PET_COMMAND_ID_INVALID",
    );
  }
  return commandId;
};
const cleanIdentityCommandId = (value) => {
  const commandId = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$/.test(commandId)) {
    throw typedError(
      "A stable identity commandId of 8 to 120 safe characters is required",
      400,
      "IDENTITY_CORRECTION_COMMAND_INVALID",
    );
  }
  return commandId;
};
const identityDecisionIdFor = (kind, commandId) =>
  `decision_identity_${createHash("sha256").update(`${kind}:${commandId}`).digest("hex")}`;
const cleanDescription = (value) =>
  String(value || "")
    .trim()
    .slice(0, 2000);
const cleanBreedLabel = (value) => {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === "") return null;
  const label = String(value).trim().replace(/\s+/g, " ");
  if (label.length > 120) {
    throw typedError(
      "Pet breedLabel must be 120 characters or fewer",
      400,
      "PET_BREED_INVALID",
    );
  }
  return label;
};
const petSpeciesKinds = new Set([
  "dog",
  "cat",
  "bird",
  "rabbit",
  "fish",
  "reptile",
  "small_mammal",
  "other",
]);
const cleanSpeciesKind = (value) => {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === "") return null;
  const kind = String(value).trim();
  if (!petSpeciesKinds.has(kind)) {
    throw typedError(
      "Pet speciesKind is not supported",
      400,
      "PET_SPECIES_INVALID",
    );
  }
  return kind;
};
const cleanSpeciesLabel = (value) => {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === "") return null;
  const label = String(value).trim().replace(/\s+/g, " ");
  if (label.length > 80) {
    throw typedError(
      "Pet speciesLabel must be 80 characters or fewer",
      400,
      "PET_SPECIES_INVALID",
    );
  }
  return label || null;
};
const validateSpeciesPair = (speciesKind, speciesLabel) => {
  if (speciesLabel && speciesKind !== "other") {
    throw typedError(
      "speciesLabel is only valid when speciesKind is other",
      400,
      "PET_SPECIES_INVALID",
    );
  }
  return {
    speciesKind: speciesKind ?? null,
    speciesLabel: speciesLabel ?? null,
  };
};
const cleanAliases = (values) => {
  if (values === undefined) return undefined;
  if (!Array.isArray(values) || values.length > 30) {
    throw typedError(
      "Pet aliases must be an array with at most 30 labels",
      400,
      "PET_ALIASES_INVALID",
    );
  }
  return [
    ...new Map(
      values.map((value) => {
        const label = cleanPersonName(value);
        return [label.toLocaleLowerCase(), label];
      }),
    ).values(),
  ];
};
const cleanAssetIds = (values) => {
  if (!Array.isArray(values) || values.length < 1 || values.length > 100) {
    throw typedError(
      "assetIds must contain 1 to 100 stable Cimmich asset IDs",
      400,
      "PET_ASSET_IDS_INVALID",
    );
  }
  const assetIds = [
    ...new Set(values.map((value) => String(value || "").trim())),
  ];
  if (assetIds.some((value) => !value)) {
    throw typedError(
      "assetIds cannot contain blank IDs",
      400,
      "PET_ASSET_IDS_INVALID",
    );
  }
  return assetIds;
};
const cleanCoverCrop = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const crop = Object.fromEntries(
    ["x", "y", "w", "h"].map((key) => [key, Number(value?.[key])]),
  );
  if (
    Object.values(crop).some((number) => !Number.isFinite(number)) ||
    crop.x < 0 ||
    crop.y < 0 ||
    crop.w <= 0 ||
    crop.h <= 0 ||
    crop.x + crop.w > 1.000001 ||
    crop.y + crop.h > 1.000001
  ) {
    throw typedError(
      "coverCrop must be a normalized x/y/w/h box",
      400,
      "PET_COVER_CROP_INVALID",
    );
  }
  return crop;
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
const commandDigest = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex");
const cleanSpecialtyName = (value) => {
  const name = String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 64);
  if (!name || !/^[\p{L}\p{N}][\p{L}\p{N} /&+_.-]*$/u.test(name)) {
    throw Object.assign(
      new Error("Specialty name must be a short readable condition"),
      { statusCode: 400 },
    );
  }
  return name;
};
const cleanModifierName = (value) => {
  const name = String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 64);
  if (!name || !/^[\p{L}\p{N}][\p{L}\p{N} /&+_.-]*$/u.test(name)) {
    throw Object.assign(
      new Error("Modifier name must be a short readable condition"),
      { statusCode: 400 },
    );
  }
  return name;
};
const modifierKeyFromName = (name) =>
  name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
const cleanAliasKind = (value) => {
  const kind = String(value || "nickname");
  if (!["former_name", "imported", "nickname"].includes(kind)) {
    throw Object.assign(
      new Error("Alias kind must be nickname, former name, or imported"),
      { statusCode: 400 },
    );
  }
  return kind;
};
const cleanSubjectKind = (value) => {
  const kind = String(value || "");
  if (!["person", "pet"].includes(kind)) {
    throw Object.assign(new Error("Identity type must be person or pet"), {
      statusCode: 400,
    });
  }
  return kind;
};
const cleanCaptureContextKind = (value) => {
  const kind = String(value || "");
  if (!["rapid_burst", "same_moment", "sequence"].includes(kind)) {
    throw Object.assign(
      new Error(
        "Capture context must be rapid burst, same moment, or sequence",
      ),
      { statusCode: 400 },
    );
  }
  return kind;
};

const ensureUserCommandReceipt = async (tx) => {
  const now = new Date();
  await tx`
    INSERT INTO producer_receipt (
      producer_receipt_id, producer_kind, producer_name, producer_version,
      started_at, completed_at, privacy_class
    ) VALUES (
      ${userCommandReceiptId}, 'user', 'cimmich-local-identity-commands', 'v1',
      ${now}, ${now}, 'private'
    ) ON CONFLICT (producer_receipt_id) DO UPDATE SET completed_at = excluded.completed_at
  `;
};

const beginPetCommand = async (
  tx,
  { actorId, commandId, commandKind, payload },
) => {
  const id = cleanCommandId(commandId);
  const digest = commandDigest({ commandKind, payload });
  const [existing] = await tx`
    SELECT command_kind, actor_id, request_digest, response
    FROM pet_command WHERE command_id = ${id}
  `;
  if (existing) {
    if (
      existing.command_kind !== commandKind ||
      existing.actor_id !== actorId ||
      existing.request_digest !== digest
    ) {
      throw typedError(
        "commandId was already used for a different Pet command",
        409,
        "PET_COMMAND_CONFLICT",
      );
    }
    return {
      commandId: id,
      digest,
      replay: { ...existing.response, replayed: true },
    };
  }
  return { commandId: id, digest, replay: null };
};

const completePetCommand = async (
  tx,
  { actorId, command, commandKind, decisionId, response },
) => {
  await tx`
    INSERT INTO pet_command (
      command_id, command_kind, actor_id, request_digest, decision_id,
      response, producer_receipt_id, privacy_class
    ) VALUES (
      ${command.commandId}, ${commandKind}, ${actorId}, ${command.digest},
      ${decisionId || null}, ${tx.json(response)}, ${petManualReceiptId}, 'private'
    )
  `;
  return response;
};

const cleanMergeCommandId = (value) => {
  const commandId = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$/.test(commandId)) {
    throw typedError(
      "A stable merge commandId of 8 to 120 safe characters is required",
      400,
      "PERSON_MERGE_COMMAND_ID_INVALID",
    );
  }
  return commandId;
};

const beginMergeCommand = async (
  tx,
  { actorId, commandId, commandKind, payload },
) => {
  const id = cleanMergeCommandId(commandId);
  const requestDigest = commandDigest({ commandKind, payload });
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 60))`;
  const [existing] = await tx`
    SELECT actor_id, command_kind, request_digest, response_body, state
    FROM person_merge_command
    WHERE command_id = ${id}
    FOR UPDATE
  `;
  if (existing) {
    if (
      existing.actor_id !== actorId ||
      existing.command_kind !== commandKind ||
      existing.request_digest !== requestDigest
    ) {
      throw typedError(
        "commandId was already used for a different merge command",
        409,
        "PERSON_MERGE_COMMAND_CONFLICT",
      );
    }
    if (existing.state === "completed") {
      return { replay: { ...existing.response_body, replayed: true } };
    }
    throw typedError(
      "Merge command is already in progress",
      409,
      "PERSON_MERGE_COMMAND_CONFLICT",
    );
  }
  await tx`
    INSERT INTO person_merge_command (
      command_id, actor_id, command_kind, request_digest, state
    ) VALUES (
      ${id}, ${actorId}, ${commandKind}, ${requestDigest}, 'started'
    )
  `;
  return { commandId: id, replay: null };
};

const completeMergeCommand = async (
  tx,
  { commandId, mergeOperationId, response },
) => {
  await tx`
    UPDATE person_merge_command
    SET merge_operation_id = ${mergeOperationId},
      response_body = ${tx.json(response)}, state = 'completed',
      completed_at = now()
    WHERE command_id = ${commandId}
  `;
  return response;
};

const bridgeFields = (bridge, assetId) => {
  const linked = bridge.get(assetId);
  return linked
    ? { filename: linked.filename, sourceAssetId: linked.sourceAssetId }
    : { filename: "", sourceAssetId: "" };
};

const projectPersonPresentation = (bridge, row) => {
  const {
    body_preview_asset_id: bodyAssetId,
    body_preview_body_id: bodyId,
    body_preview_box_x: bodyBoxX,
    body_preview_box_y: bodyBoxY,
    body_preview_box_w: bodyBoxW,
    body_preview_box_h: bodyBoxH,
    body_preview_height: bodyHeight,
    body_preview_width: bodyWidth,
    presentation_body_asset_id: presentationBodyAssetId,
    presentation_body_crop: presentationBodyCrop,
    presentation_body_height: presentationBodyHeight,
    presentation_body_observation_id: presentationBodyObservationId,
    presentation_body_observation_kind: presentationBodyObservationKind,
    presentation_body_updated_at: presentationBodyUpdatedAt,
    presentation_body_width: presentationBodyWidth,
    presentation_face_asset_id: presentationFaceAssetId,
    presentation_face_crop: presentationFaceCrop,
    presentation_face_height: presentationFaceHeight,
    presentation_face_observation_id: presentationFaceObservationId,
    presentation_face_observation_kind: presentationFaceObservationKind,
    presentation_face_updated_at: presentationFaceUpdatedAt,
    presentation_face_width: presentationFaceWidth,
    ...person
  } = row;
  const bodyDisplay = bodyAssetId ? bridgeFields(bridge, bodyAssetId) : null;
  const presentationBodyDisplay = presentationBodyAssetId
    ? bridgeFields(bridge, presentationBodyAssetId)
    : null;
  const presentationFaceDisplay = presentationFaceAssetId
    ? bridgeFields(bridge, presentationFaceAssetId)
    : null;
  return {
    ...person,
    ...bridgeFields(bridge, row.representative_asset_id),
    bodyPreview:
      bodyId && bodyDisplay?.sourceAssetId
        ? {
            assetId: bodyAssetId,
            bodyId,
            box_h: bodyBoxH,
            box_w: bodyBoxW,
            box_x: bodyBoxX,
            box_y: bodyBoxY,
            height: bodyHeight,
            schemaVersion: "cimmich.person-body-preview.v1",
            sourceAssetId: bodyDisplay.sourceAssetId,
            width: bodyWidth,
          }
        : null,
    presentationBody:
      presentationBodyAssetId && presentationBodyDisplay?.sourceAssetId
        ? {
            assetId: presentationBodyAssetId,
            crop: presentationBodyCrop ?? null,
            filename: presentationBodyDisplay.filename,
            height: presentationBodyHeight,
            observationId: presentationBodyObservationId ?? null,
            observationKind: presentationBodyObservationKind ?? "body",
            selectionMode: "explicit",
            slotKind: "body",
            sourceAssetId: presentationBodyDisplay.sourceAssetId,
            updatedAt: presentationBodyUpdatedAt ?? null,
            width: presentationBodyWidth,
          }
        : null,
    presentationFace:
      presentationFaceAssetId && presentationFaceDisplay?.sourceAssetId
        ? {
            assetId: presentationFaceAssetId,
            crop: presentationFaceCrop ?? null,
            filename: presentationFaceDisplay.filename,
            height: presentationFaceHeight,
            observationId: presentationFaceObservationId ?? null,
            observationKind: presentationFaceObservationKind ?? "face",
            selectionMode: "explicit",
            slotKind: "face",
            sourceAssetId: presentationFaceDisplay.sourceAssetId,
            updatedAt: presentationFaceUpdatedAt ?? null,
            width: presentationFaceWidth,
          }
        : null,
  };
};

const bridgeAssetBySourceId = (bridge, sourceAssetId) => {
  for (const [assetId, linked] of bridge) {
    if (linked.sourceAssetId === sourceAssetId) return { assetId, ...linked };
  }
};

const isHoldingPerson = async (sql, personId) => {
  const [row] = await sql`
    SELECT EXISTS (
      SELECT 1 FROM current_person_category
      WHERE person_id = ${String(personId || "")} AND slug = 'holding'
    ) AS holding
  `;
  return row?.holding === true;
};

// Identity transactions are authoritative and enqueue a durable SourcePack
// rebuild in the database. Prime projection is an immediate convenience pass;
// it must never make a successfully committed user correction look like it
// failed. A maintenancePending response tells the UI/operator the projection
// can be retried without repeating the identity command.
const refreshPrimeAfterCommand = async (sql, personId) => {
  if (!personId) return false;
  try {
    if (await isHoldingPerson(sql, personId)) {
      await sql`
        WITH retired_buckets AS (
          UPDATE reference_bucket SET state = 'retired'
          WHERE person_id = ${personId} AND state IN ('active','candidate')
          RETURNING bucket_id
        )
        UPDATE reference_prototype SET state = 'retired'
        WHERE person_id = ${personId} AND state = 'active'
      `;
      return false;
    }
    const faces = await loadPrimeCuratorFaces(sql, personId);
    const curations = buildPrimeCurations(faces);
    if (curations.length > 0) {
      await applyPrimeCurations(sql, curations, { execute: true });
    } else {
      await sql`UPDATE reference_prototype SET state = 'retired' WHERE person_id = ${personId} AND state = 'active'`;
    }
    return false;
  } catch (error) {
    console.error(
      "Cimmich Prime maintenance deferred after committed identity command",
      {
        error: error instanceof Error ? error.message : String(error),
        personId,
      },
    );
    return true;
  }
};

const refreshPrimeForPeople = async (sql, personIds) => {
  let maintenancePending = false;
  for (const personId of [...new Set(personIds.filter(Boolean))]) {
    maintenancePending =
      (await refreshPrimeAfterCommand(sql, personId)) || maintenancePending;
  }
  return maintenancePending;
};

const refreshBodyLinksAfterCommand = async (sql, assetId) => {
  if (!assetId) return { maintenancePending: false };
  try {
    const assets = await loadFaceBodyLinkAssets(sql, assetId);
    const proposal = buildFaceBodyLinks(assets);
    const summary = await applyFaceBodyLinks(sql, proposal, { execute: true });
    return { ...summary, maintenancePending: false };
  } catch (error) {
    console.error(
      "Cimmich Body linkage maintenance deferred after committed identity command",
      {
        assetId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return { maintenancePending: true };
  }
};

const boxOverlap = (left, right) => {
  const x1 = Math.max(Number(left.box_x), Number(right.box_x));
  const y1 = Math.max(Number(left.box_y), Number(right.box_y));
  const x2 = Math.min(
    Number(left.box_x) + Number(left.box_w),
    Number(right.box_x) + Number(right.box_w),
  );
  const y2 = Math.min(
    Number(left.box_y) + Number(left.box_h),
    Number(right.box_y) + Number(right.box_h),
  );
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const leftArea = Number(left.box_w) * Number(left.box_h);
  const rightArea = Number(right.box_w) * Number(right.box_h);
  const leftCenterX = Number(left.box_x) + Number(left.box_w) / 2;
  const leftCenterY = Number(left.box_y) + Number(left.box_h) / 2;
  const rightCenterX = Number(right.box_x) + Number(right.box_w) / 2;
  const rightCenterY = Number(right.box_y) + Number(right.box_h) / 2;
  return {
    centerDx:
      Math.abs(leftCenterX - rightCenterX) /
      Math.max(0.000001, Math.min(Number(left.box_w), Number(right.box_w))),
    centerDy:
      Math.abs(leftCenterY - rightCenterY) /
      Math.max(0.000001, Math.min(Number(left.box_h), Number(right.box_h))),
    containment:
      intersection / Math.max(0.000001, Math.min(leftArea, rightArea)),
    iou: intersection / Math.max(0.000001, leftArea + rightArea - intersection),
  };
};

const samePhysicalFaceGeometry = (left, right) => {
  const overlap = boxOverlap(left, right);
  return (
    overlap.iou >= 0.62 ||
    (overlap.containment >= 0.85 &&
      overlap.centerDx <= 0.25 &&
      overlap.centerDy <= 0.25)
  );
};

export const dedupeAssetFaces = (rows) => {
  const ranked = [...rows].sort(
    (left, right) =>
      Number(Boolean(right.identity_claim_id)) -
        Number(Boolean(left.identity_claim_id)) ||
      (Number(right.detection_confidence) || 0) -
        (Number(left.detection_confidence) || 0) ||
      String(left.face_id).localeCompare(String(right.face_id)),
  );
  const selected = [];
  for (const row of ranked) {
    const duplicate = selected.find(
      (kept) =>
        samePhysicalFaceGeometry(row, kept) &&
        !(
          row.identity_claim_id &&
          kept.identity_claim_id &&
          row.person_id &&
          kept.person_id &&
          row.person_id !== kept.person_id
        ),
    );
    if (!duplicate) selected.push(row);
  }
  return selected.sort(
    (left, right) =>
      Number(left.box_x) - Number(right.box_x) ||
      String(left.face_id).localeCompare(String(right.face_id)),
  );
};

export const identityQcFields = (row) => {
  const facePixelWidth = Math.max(
    0,
    Math.round(Number(row.face_pixel_width) || 0),
  );
  const facePixelHeight = Math.max(
    0,
    Math.round(Number(row.face_pixel_height) || 0),
  );
  const nearbyFaceCount = Math.max(
    0,
    Number.parseInt(String(row.nearby_face_count || 0), 10) || 0,
  );
  const sourceInstanceSuffix = String(row.source_instance_suffix || "").trim();
  const qualityScore = Number(row.quality_measurements?.quality_score);
  const flags = [];
  if (
    lowQualityReasons({
      detection: row.detection_confidence,
      facePixelHeight,
      facePixelWidth,
      quality: qualityScore,
    }).includes("tiny_face")
  )
    flags.push("tiny_face");
  if (
    row.detection_confidence !== null &&
    row.detection_confidence !== undefined &&
    (Number(row.detection_confidence) || 0) < 0.75
  )
    flags.push("low_detection_confidence");
  if (Number.isFinite(qualityScore) && qualityScore < 0.68)
    flags.push("low_quality");
  if (nearbyFaceCount > 0) flags.push("nearby_face");
  if (
    sourceInstanceSuffix &&
    !["blank", "1", "2"].includes(sourceInstanceSuffix)
  )
    flags.push("ambiguous_import_suffix");
  return {
    face_pixel_height: facePixelHeight,
    face_pixel_width: facePixelWidth,
    nearby_face_count: nearbyFaceCount,
    qc_flags: flags,
    source_instance_suffix: sourceInstanceSuffix,
  };
};

export const createCimmichRepository = (
  sql,
  bridge = new Map(),
  visibility = null,
  options = {},
) => {
  const mediaJobs = createMediaJobLedger(sql);
  const matchingProvider = normalizeMatchingProvider(options.matchingProvider);
  const machineReviewConfigured = matchingProvider !== null;
  const enhancedComponent = options.enhancedComponent || null;
  const expectedSchemaVersion = Number(options.expectedSchemaVersion || 0);
  const expectedSchemaPatchCount = Number(
    options.expectedSchemaPatchCount ?? -1,
  );
  const presentationRank = () => visibility?.currentRank() ?? 0;
  const requireVisibleSubject = async (personId) => {
    const id = String(personId || "").trim();
    const [subject] = await sql`
      SELECT person_id, subject_kind FROM current_person
      WHERE person_id = ${id} AND status = 'active'
        AND cimmich_visibility_subject_rank(subject_kind, person_id)
          <= ${presentationRank()}
      LIMIT 1
    `;
    if (!subject) {
      throw typedError("Cimmich identity not found", 404, "PERSON_NOT_FOUND");
    }
    return subject;
  };
  const conditionConsensusReviewEnabled =
    options.conditionConsensusReviewEnabled === true;
  const allTrustedShortlistReviewEnabled =
    options.allTrustedShortlistReviewEnabled === true;
  const resolveVisibleAssetDisplay = async (value) => {
    const requestedId = String(value || "").trim();
    if (!requestedId || requestedId.length > 240) {
      throw typedError(
        "A stable Cimmich or Immich asset ID is required",
        400,
        "ASSET_DISPLAY_ID_INVALID",
      );
    }
    const [projection] = await sql`
      SELECT projection.cimmich_asset_id AS asset_id,
        projection.immich_asset_id AS source_asset_id
      FROM immich_asset_projection projection
      JOIN asset ON asset.asset_id = projection.cimmich_asset_id
        AND asset.state = 'active'
      WHERE projection.state = 'active'
        AND (projection.cimmich_asset_id = ${requestedId}
          OR projection.immich_asset_id = ${requestedId})
        AND cimmich_visibility_asset_rank(asset.asset_id) <= ${presentationRank()}
      ORDER BY CASE WHEN projection.immich_asset_id = ${requestedId} THEN 0 ELSE 1 END,
        projection.source_id
      LIMIT 1
    `;
    const legacy = projection
      ? null
      : bridgeAssetBySourceId(bridge, requestedId) ||
        (bridge.has(requestedId)
          ? { assetId: requestedId, ...bridge.get(requestedId) }
          : null);
    const assetId = projection?.asset_id || legacy?.assetId;
    if (!assetId) {
      throw typedError(
        "Cimmich asset display mapping not found",
        404,
        "ASSET_DISPLAY_NOT_FOUND",
      );
    }
    if (!projection) {
      const [visible] = await sql`
        SELECT asset_id FROM asset
        WHERE asset_id = ${assetId} AND state = 'active'
          AND cimmich_visibility_asset_rank(asset_id) <= ${presentationRank()}
      `;
      if (!visible) {
        throw typedError(
          "Cimmich asset display mapping not found",
          404,
          "ASSET_DISPLAY_NOT_FOUND",
        );
      }
    }
    const fields = bridgeFields(bridge, assetId);
    return {
      assetId,
      filename: fields.filename,
      schemaVersion: "cimmich.asset-display.v1",
      sourceAssetId:
        projection?.source_asset_id || legacy?.sourceAssetId || requestedId,
    };
  };
  const manualSubjectPresences = createManualSubjectPresenceStore(sql, {
    presentationRank,
  });
  const manualSubjectTags = createManualSubjectTagStore(sql, {
    presentationRank,
  });
  const manualPhotoContext = createManualPhotoContextStore(sql, {
    presentationRank,
    resolveVisibleAssetDisplay,
  });
  const observationCorrections = createObservationCorrectionStore(sql, {
    presentationRank,
  });
  const personProfiles = createPersonProfileStore(sql, { presentationRank });
  const personDetailsDisplay = createPersonDetailsDisplayStore(sql, {
    presentationRank,
  });
  const personCreates = createPersonCreateStore(sql, {
    companion: options.immichCompanion,
    immichSourceId: options.immichSourceId,
  });
  const petDocuments = createPetDocumentStore(sql, {
    bridgeFields: (assetId) => bridgeFields(bridge, assetId),
    presentationRank,
  });
  const contextEntities = createContextEntityStore(sql, {
    assetIdBySourceId: (sourceAssetId) =>
      bridgeAssetBySourceId(bridge, sourceAssetId)?.assetId || null,
    bridgeFields: (assetId) => bridgeFields(bridge, assetId),
    presentationRank,
  });
  const basicSmartSearch = createBasicSmartSearch(sql, {
    bridgeFields: (assetId) => bridgeFields(bridge, assetId),
    presentationRank,
  });
  const documents = createDocumentStore(sql, {
    maxFileBytes: options.documentMaxFileBytes,
    maxStoreBytes: options.documentMaxStoreBytes,
    presentationRank,
    storeRoot: options.documentStoreRoot,
  });
  const documentLegacyPets = createDocumentLegacyPetStore(sql, {
    presentationRank,
  });
  let machineSuggestionCache = null;
  const invalidateMachineSuggestions = () => {
    machineSuggestionCache = null;
  };
  const projectPetRow = (row) => ({
    aliases: row.aliases || [],
    breedLabel: row.breed_label || null,
    confirmedMediaCount: Number(row.confirmed_media_count || 0),
    documentCount: Number(row.document_count || 0),
    cover: row.cover_asset_id
      ? {
          assetId: row.cover_asset_id,
          crop: row.cover_crop || null,
          ...bridgeFields(bridge, row.cover_asset_id),
        }
      : null,
    description: row.description || "",
    displayName: row.display_name || "",
    petId: row.person_id,
    projection: {
      revision: Number(row.current_revision),
      state: "current",
    },
    speciesKind: row.species_kind || null,
    speciesLabel: row.species_label || null,
    status: row.status,
    visibility: {
      decisionId: row.visibility_decision_id || null,
      explicit: Boolean(row.visibility_explicit),
      objectId: row.person_id,
      objectScope: "pet",
      revision: Number(row.visibility_revision || 0),
      visibilityTier: row.visibility_tier || "standard",
    },
  });
  const loadPetConnections = async (executor, petIds) => {
    if (!petIds.length) return new Map();
    const rows = await executor`
      WITH visible_connections AS (
        SELECT link.target_id AS pet_id, source.entity_id AS target_id,
          source.entity_kind AS target_kind, source.display_name,
          CASE source.entity_kind
            WHEN 'place' THEN source.place_kind
            WHEN 'object' THEN source.object_kind
            WHEN 'event' THEN source.event_kind
          END AS type_kind,
          link.relation_kind,
          cover.asset_id AS cover_asset_id,
          row_number() OVER (
            PARTITION BY link.target_id
            ORDER BY source.entity_kind, lower(source.display_name),
              source.entity_id, link.relation_kind
          ) AS position
        FROM current_context_relation link
        JOIN context_entity source ON source.entity_id = link.entity_id
          AND source.status = 'active'
        LEFT JOIN LATERAL (
          SELECT association.asset_id
          FROM current_context_asset association
          JOIN asset ON asset.asset_id = association.asset_id
            AND asset.state = 'active'
          WHERE association.entity_id = source.entity_id
            AND cimmich_visibility_asset_rank(association.asset_id)
              <= ${presentationRank()}
          ORDER BY (association.asset_id = source.cover_asset_id) DESC,
            asset.capture_time DESC NULLS LAST, association.asset_id
          LIMIT 1
        ) cover ON true
        WHERE link.target_kind = 'pet' AND link.target_id = ANY(${petIds})
          AND cimmich_visibility_context_entity_rank(source.entity_id)
            <= ${presentationRank()}
      )
      SELECT pet_id, target_id, target_kind, display_name, type_kind,
        relation_kind, cover_asset_id
      FROM visible_connections
      WHERE position <= 100
      ORDER BY pet_id, target_kind, lower(display_name), target_id, relation_kind
    `;
    const connections = new Map(petIds.map((petId) => [petId, []]));
    for (const row of rows) {
      const cover = row.cover_asset_id
        ? bridgeFields(bridge, row.cover_asset_id).sourceAssetId || null
        : null;
      connections.get(row.pet_id)?.push({
        coverAssetId: cover,
        direction: "incoming",
        displayName: row.display_name || "",
        relationType: row.relation_kind,
        targetId: row.target_id,
        targetKind: row.target_kind,
        typeKind: row.type_kind || null,
      });
    }
    return connections;
  };
  const loadPetRows = async (
    executor,
    { includeHidden = false, limit = 100, petId = "", query = "" } = {},
  ) => {
    const id = String(petId || "").trim();
    const normalizedQuery = String(query || "").trim();
    const search = `%${normalizedQuery}%`;
    const rows = await executor`
      SELECT pet.person_id, pet.display_name, pet.status, pet.current_revision,
        pet.aliases, pet.description, pet.cover_asset_id, pet.cover_crop,
        pet.species_kind, pet.species_label, pet.breed_label,
        coalesce(visibility.visibility_tier, 'standard') AS visibility_tier,
        coalesce(visibility.revision, 0)::int AS visibility_revision,
        visibility.decision_id AS visibility_decision_id,
        (visibility.object_id IS NOT NULL) AS visibility_explicit,
        coalesce((
          SELECT count(DISTINCT association.asset_id)::int
          FROM person_assets association
          WHERE association.person_id = pet.person_id
            AND association.authority_state = 'accepted'
            AND cimmich_visibility_asset_rank(association.asset_id) <= ${presentationRank()}
        ), 0)::int AS confirmed_media_count,
        coalesce((
          SELECT count(*)::int
          FROM current_pet_document document
          WHERE document.pet_id = pet.person_id
            AND cimmich_visibility_asset_rank(document.asset_id) <= ${presentationRank()}
        ), 0)::int AS document_count
      FROM current_person pet
      LEFT JOIN cimmich_visibility_object visibility
        ON visibility.object_scope = 'pet' AND visibility.object_id = pet.person_id
      WHERE pet.subject_kind = 'pet'
        AND cimmich_visibility_pet_rank(pet.person_id) <= ${presentationRank()}
        AND (${id} = '' OR pet.person_id = ${id})
        AND (${Boolean(includeHidden)} OR pet.status = 'active')
        AND (
          ${normalizedQuery} = '' OR pet.display_name ILIKE ${search}
          OR EXISTS (
            SELECT 1 FROM unnest(pet.aliases) alias WHERE alias ILIKE ${search}
          )
        )
      ORDER BY coalesce(pet.display_name, pet.person_id), pet.person_id
      LIMIT ${cleanLimit(limit, 100, 500)}
    `;
    const connections = await loadPetConnections(
      executor,
      rows.map((row) => row.person_id),
    );
    return rows.map((row) => ({
      ...projectPetRow(row),
      connections: connections.get(row.person_id) || [],
    }));
  };
  const requirePet = async (executor, petId, { allowHidden = false } = {}) => {
    const [pet] = await executor`
      SELECT person_id, display_name, subject_kind, status, current_revision,
        description, cover_asset_id, cover_crop, species_kind, species_label,
        breed_label
      FROM person
      WHERE person_id = ${String(petId || "")}
        AND cimmich_visibility_pet_rank(person_id) <= ${presentationRank()}
      ${
        allowHidden
          ? executor`AND status IN ('active','hidden')`
          : executor`AND status = 'active'`
      }
      FOR UPDATE
    `;
    if (!pet || pet.subject_kind !== "pet") {
      throw typedError("Active Pet not found", 404, "PET_NOT_FOUND");
    }
    return pet;
  };
  const requireActiveAssets = async (executor, assetIds) => {
    const rows = await executor`
      SELECT asset_id FROM asset
      WHERE asset_id = ANY(${assetIds}) AND state = 'active'
      ORDER BY asset_id
      FOR UPDATE
    `;
    const found = new Set(rows.map((row) => row.asset_id));
    const missing = assetIds.filter((assetId) => !found.has(assetId));
    if (missing.length) {
      throw typedError(
        "One or more active Cimmich assets were not found",
        404,
        "PET_ASSET_NOT_FOUND",
        { missingAssetIds: missing },
      );
    }
  };
  const repository = {
    async filterVisibleMapAssetSourceIds({ sourceAssetIds }) {
      if (
        !Array.isArray(sourceAssetIds) ||
        sourceAssetIds.length < 1 ||
        sourceAssetIds.length > 500
      ) {
        throw typedError(
          "Map visibility filtering requires between 1 and 500 source asset IDs",
          400,
          "MAP_ASSET_IDS_INVALID",
        );
      }
      const normalized = sourceAssetIds.map((value) =>
        String(value || "").trim(),
      );
      if (
        normalized.some(
          (value) =>
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
              value,
            ),
        ) ||
        new Set(normalized).size !== normalized.length
      ) {
        throw typedError(
          "Map source asset IDs must be unique UUIDs",
          400,
          "MAP_ASSET_IDS_INVALID",
        );
      }
      const rows = await sql`
        SELECT projection.immich_asset_id AS source_asset_id
        FROM immich_asset_projection projection
        JOIN asset ON asset.asset_id = projection.cimmich_asset_id
          AND asset.state = 'active'
        WHERE projection.state = 'active'
          AND projection.immich_asset_id = ANY(${normalized})
          AND cimmich_visibility_asset_rank(asset.asset_id) <= ${presentationRank()}
        ORDER BY projection.immich_asset_id
      `;
      return {
        schemaVersion: "cimmich.visible-map-assets.v1",
        sourceAssetIds: rows.map((row) => row.source_asset_id),
      };
    },
    async health() {
      const [row] = await sql`
      SELECT
        to_regclass('person') IS NOT NULL AS has_person,
        to_regclass('source_pack') IS NOT NULL AS has_source_pack,
        to_regclass('person_category') IS NOT NULL AS has_person_category,
        to_regprocedure('sync_face_body_linkage_with_identity_claim()') IS NOT NULL AS has_identity_lifecycle,
        to_regprocedure('enforce_source_pack_activation_gate()') IS NOT NULL AS has_source_pack_guard,
        EXISTS (SELECT 1 FROM person_category WHERE slug = 'holding' AND state = 'active') AS has_holding,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_evidence_projection_semantics_v1'
        ) AS has_evidence_projection,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_low_quality_matching_lane_v1'
        ) AS has_low_quality_lane,
        EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'identity_claim_candidate_not_source_reconciliation'
            AND conrelid = 'identity_claim'::regclass
        ) AS has_source_reconciliation_guard,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_capture_context_rebuild_queue_v1'
        ) AS has_evidence_modifiers,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_face_modifier_proposal_v1'
        ) AS has_modifier_proposals,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_face_local_measurement_v1'
        ) AS has_face_local_measurements,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_partial_region_visibility_v2'
        ) AS has_partial_region_visibility,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_scoped_region_contamination_v3'
        ) AS has_scoped_region_contamination,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_review_query_performance_v1'
        ) AS has_review_query_performance,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_source_pack_rebuild_worker_v1'
        ) AS has_source_pack_rebuild_worker,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_pet_manual_management_v1'
        ) AS has_pet_manual_management,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_resumable_media_job_v1'
        ) AS has_resumable_media_jobs,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_pet_species_v1'
        ) AS has_pet_species,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_immich_inventory_checkpoint_v1'
        ) AS has_immich_inventory,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_media_operator_control_v1'
        ) AS has_media_operator,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_person_profile_v1'
        ) AS has_person_profile,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_visibility_v1'
        ) AS has_visibility,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_visibility_projection_guard_v1'
        ) AS has_visibility_projection_guard,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_person_projection_performance_v1'
        ) AS has_person_projection_performance,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_manual_subject_presence_v1'
        ) AS has_manual_subject_presence,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_body_pose_evidence_v1'
        ) AS has_body_pose_evidence,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_person_details_display_v1'
        ) AS has_person_details_display,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_pet_profile_document_v1'
        ) AS has_pet_profile_document,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_context_entity_v1'
        ) AS has_context_entity,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_context_search_projection_v1'
        ) AS has_context_search_projection,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_context_search_hardening_v1'
        ) AS has_context_search_hardening,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_document_v1'
        ) AS has_document_v1,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_document_lifecycle_compatibility_v1'
        ) AS has_document_lifecycle_compatibility,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_typed_manual_subject_tag_v1'
        ) AS has_typed_manual_subject_tag,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_manual_recognition_intake_v1'
        ) AS has_manual_recognition_intake,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_typed_manual_subject_tag_v2'
        ) AS has_typed_manual_subject_tag_v2,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_body_detection_result_v1'
        ) AS has_body_detection_result,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_detailed_observation_correction_v1'
        ) AS has_detailed_observation_correction,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_place_delete_v1'
        ) AS has_place_delete,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_asset_source_revision_v1'
        ) AS has_asset_source_revision,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_body_result_source_binding_v1'
        ) AS has_body_result_source_binding,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_context_entity_visibility_v1'
        ) AS has_context_entity_visibility,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_person_visibility_v1'
        ) AS has_person_visibility,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_place_cover_v1'
        ) AS has_place_cover,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_object_cover_v1'
        ) AS has_object_cover,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_object_delete_v1'
        ) AS has_object_delete,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_event_cover_v1'
        ) AS has_event_cover,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_visibility_filtered_map_assets_v1'
        ) AS has_map_assets,
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_immich_onboarding_identity_import_v1'
        ) AS has_immich_onboarding,
        (SELECT coalesce(max(version), 0)::int FROM cimmich_schema_migration)
          AS applied_schema_version,
        NOT EXISTS (
          SELECT 1
          FROM generate_series(1, ${expectedSchemaVersion}) expected(version)
          LEFT JOIN cimmich_schema_migration applied USING (version)
          WHERE applied.version IS NULL
        ) AS has_complete_migration_ledger,
        (SELECT count(*)::int FROM cimmich_schema_patch
          WHERE base_version = 48) AS applied_schema_patch_count
    `;
      if (
        !row?.has_person ||
        !row?.has_source_pack ||
        !row?.has_person_category ||
        !row?.has_identity_lifecycle ||
        !row?.has_source_pack_guard ||
        !row?.has_holding ||
        !row?.has_evidence_projection ||
        !row?.has_low_quality_lane ||
        !row?.has_source_reconciliation_guard ||
        !row?.has_evidence_modifiers ||
        !row?.has_modifier_proposals ||
        !row?.has_face_local_measurements ||
        !row?.has_partial_region_visibility ||
        !row?.has_scoped_region_contamination ||
        !row?.has_review_query_performance ||
        !row?.has_source_pack_rebuild_worker ||
        !row?.has_pet_manual_management ||
        !row?.has_resumable_media_jobs ||
        !row?.has_pet_species ||
        !row?.has_immich_inventory ||
        !row?.has_media_operator ||
        !row?.has_person_profile ||
        !row?.has_visibility ||
        !row?.has_visibility_projection_guard ||
        !row?.has_person_projection_performance ||
        !row?.has_manual_subject_presence ||
        !row?.has_body_pose_evidence ||
        !row?.has_person_details_display ||
        !row?.has_pet_profile_document ||
        !row?.has_context_entity ||
        !row?.has_context_search_projection ||
        !row?.has_context_search_hardening ||
        !row?.has_document_v1 ||
        !row?.has_document_lifecycle_compatibility ||
        !row?.has_typed_manual_subject_tag ||
        !row?.has_manual_recognition_intake ||
        !row?.has_typed_manual_subject_tag_v2 ||
        !row?.has_body_detection_result ||
        !row?.has_detailed_observation_correction ||
        !row?.has_place_delete ||
        !row?.has_asset_source_revision ||
        !row?.has_body_result_source_binding ||
        !row?.has_context_entity_visibility ||
        !row?.has_person_visibility ||
        !row?.has_place_cover ||
        !row?.has_object_cover ||
        !row?.has_object_delete ||
        !row?.has_event_cover ||
        !row?.has_map_assets ||
        !row?.has_immich_onboarding ||
        !row?.has_complete_migration_ledger ||
        expectedSchemaVersion < 1 ||
        expectedSchemaPatchCount < 0 ||
        Number(row?.applied_schema_version) !== expectedSchemaVersion ||
        Number(row?.applied_schema_patch_count) !== expectedSchemaPatchCount
      ) {
        throw Object.assign(
          new Error("Cimmich database schema is incomplete"),
          {
            statusCode: 503,
          },
        );
      }
      const [documentStore, faceMatching] = await Promise.all([
        documents.status(),
        repository.faceMatchingStatus(),
      ]);
      return {
        database: "ready",
        machineReview: {
          configured: machineReviewConfigured,
          enabled: faceMatching.review.enabled,
          marginFloor: faceMatching.review.marginFloor,
          modelVersion: matchingProvider?.modelVersion || null,
          policyVersion: machineMatcherPolicyVersion,
          providerId: matchingProvider?.providerId || null,
          scorer: "best_individual_prime",
          scoreFloor: faceMatching.review.scoreFloor,
          state: faceMatching.state,
        },
        documentStore,
        schemaVersion: Number(row.applied_schema_version),
        schemaPatchLevel: Number(row.applied_schema_patch_count),
        service: "cimmich-local-service",
        status: "ok",
      };
    },
    async decisionHistory({ limit = 50 } = {}) {
      const boundedLimit = cleanLimit(limit, 50, 100);
      const visibleRank = presentationRank();
      const rows = await sql`
        WITH visible_history AS (
          SELECT operation.decision_id, operation.created_at,
            'manual_subject_tag'::text AS decision_kind,
            operation.tag_type::text AS subject_kind,
            operation.tag_id::text AS subject_id,
            operation.state::text AS operation_state,
            '/v1/manual-subject-tags/decisions/' || operation.decision_id || '/undo'
              AS undo_link
          FROM manual_subject_tag_operation operation
          WHERE cimmich_visibility_asset_rank(operation.asset_id) <= ${visibleRank}
            AND cimmich_visibility_subject_rank(
              operation.subject_kind, operation.subject_id
            ) <= ${visibleRank}
          UNION ALL
          SELECT operation.decision_id, operation.created_at,
            'manual_presence', operation.subject_kind, operation.subject_id,
            operation.state,
            '/v1/manual-presences/decisions/' || operation.decision_id || '/undo'
          FROM manual_subject_presence_operation operation
          WHERE cimmich_visibility_asset_rank(operation.asset_id) <= ${visibleRank}
            AND cimmich_visibility_subject_rank(
              operation.subject_kind, operation.subject_id
            ) <= ${visibleRank}
          UNION ALL
          SELECT operation.decision_id, operation.created_at,
            'observation_correction', operation.observation_kind,
            operation.observation_id, operation.state,
            '/v1/observation-corrections/decisions/' || operation.decision_id || '/undo'
          FROM observation_correction_operation operation
          WHERE cimmich_visibility_asset_rank(operation.asset_id) <= ${visibleRank}
          UNION ALL
          SELECT operation.decision_id, operation.created_at,
            'photo_context', operation.operation_scope, operation.asset_id,
            operation.state,
            '/v1/manual-photo-context/decisions/' || operation.decision_id || '/undo'
          FROM manual_photo_context_operation operation
          WHERE cimmich_visibility_asset_rank(operation.asset_id) <= ${visibleRank}
          UNION ALL
          SELECT operation.decision_id, operation.created_at,
            'context', operation.operation_scope, operation.entity_id,
            operation.state,
            '/v1/context/decisions/' || operation.decision_id || '/undo'
          FROM context_operation operation
          WHERE cimmich_visibility_context_entity_rank(operation.entity_id)
            <= ${visibleRank}
          UNION ALL
          SELECT operation.decision_id, operation.created_at,
            'document', operation.operation_kind, operation.document_id,
            operation.state,
            '/v1/document-decisions/' || operation.decision_id || '/undo'
          FROM cimmich_document_operation operation
          WHERE cimmich_visibility_document_rank(operation.document_id)
            <= ${visibleRank}
          UNION ALL
          SELECT operation.merge_decision_id, operation.created_at,
            'person_merge', source.subject_kind, operation.merge_operation_id,
            operation.state,
            CASE source.subject_kind
              WHEN 'pet' THEN '/v1/pets/merges/'
              ELSE '/v1/people/merges/'
            END || operation.merge_operation_id || '/unmerge'
          FROM person_merge_operation operation
          JOIN person source ON source.person_id = operation.source_person_id
          JOIN person target ON target.person_id = operation.target_person_id
          WHERE cimmich_visibility_subject_rank(
              source.subject_kind, source.person_id
            ) <= ${visibleRank}
            AND cimmich_visibility_subject_rank(
              target.subject_kind, target.person_id
            ) <= ${visibleRank}
        )
        SELECT decision_id, created_at, decision_kind, subject_kind, subject_id,
          operation_state, undo_link
        FROM visible_history
        ORDER BY created_at DESC, decision_id DESC
        LIMIT ${boundedLimit}
      `;
      return {
        items: rows.map((row) => ({
          createdAt: row.created_at,
          decisionId: row.decision_id,
          decisionKind: row.decision_kind,
          state: row.operation_state,
          subjectId: row.subject_id,
          subjectKind: row.subject_kind,
          undo: {
            eligible: row.operation_state === "active",
            link: row.undo_link,
          },
        })),
        schemaVersion: "cimmich.decision-history.v1",
      };
    },

    async summary() {
      const visibleRank = presentationRank();
      const [row] = await sql`
      SELECT
        (SELECT count(*)::int FROM asset WHERE state = 'active'
          AND cimmich_visibility_asset_rank(asset_id) <= ${visibleRank}) AS assets,
        (SELECT count(*)::int FROM current_person
          WHERE status = 'active' AND subject_kind = 'person'
            AND cimmich_visibility_person_rank(person_id) <= ${visibleRank}) AS people,
        (SELECT count(*)::int FROM face_observation WHERE state = 'valid'
          AND cimmich_visibility_asset_rank(asset_id) <= ${visibleRank}) AS face_observations,
        (SELECT count(*)::int FROM body_observation WHERE state = 'valid'
          AND cimmich_visibility_asset_rank(asset_id) <= ${visibleRank}) AS body_observations,
        (SELECT count(*)::int FROM current_presence_tag WHERE state = 'accepted'
          AND cimmich_visibility_asset_rank(asset_id) <= ${visibleRank}) AS accepted_presence,
        (SELECT count(*)::int FROM identity_claim claim
          JOIN face_observation face ON face.face_id = claim.face_id
          WHERE claim.state = 'candidate'
            AND cimmich_visibility_asset_rank(face.asset_id) <= ${visibleRank}) AS candidate_signals,
        (SELECT count(*)::int FROM decision WHERE actor_kind = 'user') AS user_decisions
    `;
      const suggestions = await repository.machineSuggestions({ limit: 80 });
      return { ...row, suggestions_ready: suggestions.length };
    },

    async integrationStatus() {
      const visibleRank = presentationRank();
      const [row] = await sql`
        WITH visible_assets AS MATERIALIZED (
          SELECT asset.asset_id
          FROM asset
          WHERE asset.state = 'active' AND asset.media_kind = 'image'
            AND cimmich_visibility_asset_rank(asset.asset_id) <= ${visibleRank}
        ), latest_results AS MATERIALIZED (
          SELECT DISTINCT ON (result.asset_id)
            result.asset_id, result.body_count, result.detector_config_digest,
            result.outcome
          FROM body_detection_result result
          JOIN current_asset_source_revision revision
            ON revision.revision_id = result.source_revision_id
            AND revision.asset_id = result.asset_id
          JOIN visible_assets visible ON visible.asset_id = result.asset_id
          ORDER BY result.asset_id, result.created_at DESC,
            result.detection_result_id DESC
        ), linked AS MATERIALIZED (
          SELECT DISTINCT tag.body_id
          FROM current_body_tag tag
          JOIN body_observation body ON body.body_id = tag.body_id
          JOIN visible_assets visible ON visible.asset_id = body.asset_id
          WHERE tag.state = 'accepted'
        )
        SELECT
          (SELECT count(*)::int FROM visible_assets) AS assets,
          (SELECT count(*)::int FROM latest_results) AS analyzed_assets,
          (SELECT coalesce(sum(body_count), 0)::int FROM latest_results)
            AS body_observations,
          (SELECT count(*)::int FROM latest_results
            WHERE outcome = 'bodies_detected') AS detected_assets,
          (SELECT count(*)::int FROM latest_results
            WHERE outcome = 'no_body') AS no_body_assets,
          (SELECT count(*)::int FROM linked) AS linked_bodies,
          (SELECT count(DISTINCT detector_config_digest)::int
            FROM latest_results) AS active_configurations
      `;
      return {
        activeConfigurations: Number(row.active_configurations),
        analyzedAssets: Number(row.analyzed_assets),
        assets: Number(row.assets),
        bodyObservations: Number(row.body_observations),
        detectedAssets: Number(row.detected_assets),
        linkedBodies: Number(row.linked_bodies),
        noBodyAssets: Number(row.no_body_assets),
        state:
          Number(row.assets) > 0 &&
          Number(row.assets) === Number(row.analyzed_assets)
            ? "complete"
            : Number(row.analyzed_assets) > 0
              ? "partial"
              : "not_started",
      };
    },

    async faceMatchingStatus() {
      const enhanced = enhancedComponent
        ? await enhancedComponent.status()
        : {
            coreAvailable: true,
            enabled: true,
            state: "legacy_enabled",
          };
      const base = {
        automaticIdentityAuthority: "none",
        basicIdentityTruthRetainedWhenDisabled: true,
        enhanced,
        provider: matchingProvider
          ? {
              configured: true,
              modelFamily: matchingProvider.modelFamily,
              modelVersion: matchingProvider.modelVersion,
              providerId: matchingProvider.providerId,
            }
          : { configured: false },
        review: {
          humanAcceptanceRequired: true,
          marginFloor: null,
          policyVersion: machineMatcherPolicyVersion,
          scoreFloor: null,
        },
        schemaVersion: "cimmich.face-matching-status.v1",
      };
      if (!matchingProvider) {
        return {
          ...base,
          review: { ...base.review, enabled: false },
          sourcePack: { activePassed: 0, awaitingReview: 0 },
          state: "provider_disabled",
        };
      }
      const [row] = await sql`
        SELECT
          count(*) FILTER (
            WHERE state = 'active' AND evaluation_status = 'passed'
          )::int AS active_passed,
          count(*) FILTER (
            WHERE state = 'active' AND evaluation_status = 'passed'
              AND evaluation_summary->'matcherPolicy'->>'policyVersion'
                = ${machineMatcherPolicyVersion}
              AND evaluation_summary->'matcherPolicy'->>'scorer'
                = 'best_individual_prime'
              AND jsonb_typeof(evaluation_summary->'matcherPolicy'->'scoreFloor')
                = 'number'
              AND jsonb_typeof(evaluation_summary->'matcherPolicy'->'marginFloor')
                = 'number'
              AND CASE WHEN jsonb_typeof(
                evaluation_summary->'matcherPolicy'->'scoreFloor'
              ) = 'number' THEN
                (evaluation_summary->'matcherPolicy'->>'scoreFloor')::float8
                  BETWEEN 0 AND 1
              ELSE false END
              AND CASE WHEN jsonb_typeof(
                evaluation_summary->'matcherPolicy'->'marginFloor'
              ) = 'number' THEN
                (evaluation_summary->'matcherPolicy'->>'marginFloor')::float8
                  BETWEEN 0 AND 1
              ELSE false END
          )::int AS active_ready,
          max(CASE WHEN state = 'active' AND evaluation_status = 'passed'
            AND jsonb_typeof(evaluation_summary->'matcherPolicy'->'scoreFloor')
              = 'number' THEN
            (evaluation_summary->'matcherPolicy'->>'scoreFloor')::float8
          END) AS score_floor,
          max(CASE WHEN state = 'active' AND evaluation_status = 'passed'
            AND jsonb_typeof(evaluation_summary->'matcherPolicy'->'marginFloor')
              = 'number' THEN
            (evaluation_summary->'matcherPolicy'->>'marginFloor')::float8
          END) AS margin_floor,
          count(*) FILTER (
            WHERE state IN ('proposed', 'shadow')
              AND evaluation_status IN ('untested', 'incomplete', 'passed')
          )::int AS awaiting_review
        FROM source_pack
        WHERE model_family = ${matchingProvider.modelFamily}
          AND model_version = ${matchingProvider.modelVersion}
          AND config_digest = ${matchingProvider.configDigest}
      `;
      const activePassed = Number(row?.active_passed || 0);
      const activeReady = Number(row?.active_ready || 0);
      const awaitingReview = Number(row?.awaiting_review || 0);
      return {
        ...base,
        review: {
          ...base.review,
          enabled: activeReady === 1,
          marginFloor:
            row?.margin_floor == null ? null : Number(row.margin_floor),
          scoreFloor: row?.score_floor == null ? null : Number(row.score_floor),
        },
        sourcePack: { activePassed, awaitingReview },
        state:
          activePassed > 0 && activeReady !== 1
            ? "needs_review_policy"
            : activeReady === 1
              ? "ready"
              : awaitingReview > 0
                ? "needs_operator_review"
                : "needs_source_pack",
      };
    },

    async guidedEvidenceBacklog() {
      const visibleRank = presentationRank();
      const [row] = await sql`
      WITH visible_faces AS MATERIALIZED (
        SELECT face.face_id, face.asset_id,
          EXISTS (
            SELECT 1 FROM current_face_identity identity
            WHERE identity.face_id = face.face_id
              AND identity.state = 'accepted'
          ) AS identified
        FROM face_observation face
        WHERE face.state = 'valid'
          AND cimmich_visibility_asset_rank(face.asset_id) <= ${visibleRank}
      ), visible_bodies AS MATERIALIZED (
        SELECT body.body_id
        FROM body_observation body
        WHERE body.state = 'valid'
          AND cimmich_visibility_asset_rank(body.asset_id) <= ${visibleRank}
      ), linked_bodies AS MATERIALIZED (
        SELECT DISTINCT tag.body_id
        FROM current_body_tag tag
        JOIN visible_bodies body ON body.body_id = tag.body_id
        WHERE tag.state = 'accepted'
      ), manual_matching AS MATERIALIZED (
        SELECT lifecycle.state
        FROM current_manual_face_matching_lifecycle lifecycle
        JOIN face_observation face ON face.face_id = lifecycle.face_id
        WHERE face.state = 'valid'
          AND face.observation_origin = 'manual_user'
          AND cimmich_visibility_asset_rank(face.asset_id) <= ${visibleRank}
      )
      SELECT
        (SELECT count(*)::int FROM visible_faces WHERE identified) AS identified_faces,
        (SELECT count(*)::int FROM visible_faces WHERE NOT identified) AS unresolved_faces,
        (SELECT count(DISTINCT asset_id)::int FROM visible_faces WHERE NOT identified)
          AS assets_with_unresolved_faces,
        (SELECT count(*)::int FROM visible_bodies) AS valid_bodies,
        (SELECT count(*)::int FROM linked_bodies) AS linked_bodies,
        (SELECT count(*)::int FROM visible_bodies body
          WHERE NOT EXISTS (
            SELECT 1 FROM linked_bodies linked WHERE linked.body_id = body.body_id
          )) AS unlinked_bodies,
        (SELECT count(*)::int FROM manual_matching
          WHERE state = 'pending_provider') AS manual_waiting_for_provider,
        (SELECT count(*)::int FROM manual_matching
          WHERE state IN ('pending_embedding', 'pending_quality')) AS manual_processing,
        (SELECT count(*)::int FROM manual_matching
          WHERE state = 'eligible_for_evaluation') AS manual_eligible_for_review,
        (SELECT count(*)::int FROM manual_matching
          WHERE state = 'abstained') AS manual_abstained
    `;
      return row;
    },

    async guidedLocalIntelligenceQueue({ limit }) {
      const visibleRank = presentationRank();
      return sql`
        WITH visible_assets AS MATERIALIZED (
          SELECT asset.asset_id, projection.input_revision,
            CASE WHEN projection.cimmich_asset_id IS NULL
              THEN 'missing' ELSE 'ready' END AS asset_projection_state
          FROM asset
          LEFT JOIN immich_asset_projection projection
            ON projection.cimmich_asset_id = asset.asset_id
            AND projection.state = 'active'
          WHERE asset.state = 'active'
            AND cimmich_visibility_asset_rank(asset.asset_id) <= ${visibleRank}
        ), evidence AS MATERIALIZED (
          SELECT visible.asset_id,
            count(DISTINCT face.face_id) FILTER (
              WHERE face.state = 'valid' AND identity.face_id IS NULL
            )::int AS unresolved_faces,
            count(DISTINCT body.body_id) FILTER (
              WHERE body.state = 'valid' AND body_tag.body_id IS NULL
            )::int AS unlinked_bodies,
            count(DISTINCT lifecycle.operation_id) FILTER (
              WHERE lifecycle.state = 'pending_provider'
            )::int AS manual_faces_waiting_for_provider,
            CASE
              WHEN visible.asset_projection_state = 'missing' THEN 'unavailable'
              WHEN current_result.detection_result_id IS NULL THEN 'missing'
              ELSE 'current'
            END AS body_analysis_state,
            visible.asset_projection_state
          FROM visible_assets visible
          LEFT JOIN face_observation face ON face.asset_id = visible.asset_id
          LEFT JOIN current_face_identity identity
            ON identity.face_id = face.face_id AND identity.state = 'accepted'
          LEFT JOIN body_observation body ON body.asset_id = visible.asset_id
          LEFT JOIN current_body_tag body_tag
            ON body_tag.body_id = body.body_id AND body_tag.state = 'accepted'
          LEFT JOIN current_manual_face_matching_lifecycle lifecycle
            ON lifecycle.face_id = face.face_id
          LEFT JOIN LATERAL (
            SELECT result.detection_result_id
            FROM body_detection_result result
            WHERE result.asset_id = visible.asset_id
              AND result.input_revision = visible.input_revision
            ORDER BY result.created_at DESC, result.detection_result_id DESC
            LIMIT 1
          ) current_result ON true
          GROUP BY visible.asset_id, visible.asset_projection_state,
            current_result.detection_result_id
        )
        SELECT asset_id, asset_projection_state, body_analysis_state,
          manual_faces_waiting_for_provider, unlinked_bodies, unresolved_faces,
          array_remove(ARRAY[
            CASE WHEN manual_faces_waiting_for_provider > 0
              THEN 'manual_face_waiting_for_provider' END,
            CASE WHEN unresolved_faces > 0 THEN 'unresolved_faces' END,
            CASE WHEN asset_projection_state = 'missing'
              THEN 'asset_projection_missing' END,
            CASE WHEN body_analysis_state = 'missing'
              THEN 'body_analysis_missing' END,
            CASE WHEN unlinked_bodies > 0 THEN 'unlinked_bodies' END
          ]::text[], NULL) AS reasons
        FROM evidence
        WHERE manual_faces_waiting_for_provider > 0
          OR unresolved_faces > 0
          OR asset_projection_state = 'missing'
          OR body_analysis_state = 'missing'
          OR unlinked_bodies > 0
        ORDER BY manual_faces_waiting_for_provider DESC,
          unresolved_faces DESC,
          (body_analysis_state = 'missing') DESC,
          unlinked_bodies DESC, asset_id
        LIMIT ${limit}
      `;
    },

    mediaJob: mediaJobs.get,
    mediaJobEnqueue: mediaJobs.enqueue,
    mediaJobStatus: mediaJobs.status,
    manualSubjectPresences: manualSubjectPresences.list,
    modifyManualSubjectPresence: manualSubjectPresences.modify,
    undoManualSubjectPresence: manualSubjectPresences.undo,
    manualSubjectTags: manualSubjectTags.list,
    attachManualSubjectTag: manualSubjectTags.attach,
    replaceManualSubjectTag: manualSubjectTags.replace,
    transitionManualFaceMatching: manualSubjectTags.transitionMatching,
    undoManualSubjectTag: manualSubjectTags.undo,

    getPersonProfile: personProfiles.getPersonProfile,
    patchPersonProfile: personProfiles.patchPersonProfile,
    getPersonProfileDisplayDefaults:
      personProfiles.getPersonProfileDisplayDefaults,
    patchPersonProfileDisplayDefaults:
      personProfiles.patchPersonProfileDisplayDefaults,
    getPersonProfileDisplay: personProfiles.getPersonProfileDisplay,
    patchPersonProfileDisplay: personProfiles.patchPersonProfileDisplay,
    getPersonDetailsDisplayDefaults: personDetailsDisplay.getDefaults,
    patchPersonDetailsDisplayDefaults: personDetailsDisplay.patchDefaults,
    getPersonDetailsDisplay: personDetailsDisplay.getPersonDisplay,
    patchPersonDetailsDisplay: personDetailsDisplay.patchPersonDisplay,
    petDocuments: petDocuments.list,
    attachPetDocuments: petDocuments.attach,
    detachPetDocuments: petDocuments.detach,
    undoPetDocumentDecision: petDocuments.undo,
    contextEntities: contextEntities.list,
    contextEntity: contextEntities.get,
    createContextEntity: contextEntities.create,
    updateContextEntity: contextEntities.update,
    setEventCover: contextEntities.setEventCover,
    setPlaceCover: contextEntities.setPlaceCover,
    setObjectCover: contextEntities.setObjectCover,
    deletePlace: contextEntities.deletePlace,
    deleteObject: contextEntities.deleteObject,
    attachContextAssets: contextEntities.attachAssets,
    detachContextAssets: contextEntities.detachAssets,
    attachContextRelations: contextEntities.attachRelations,
    detachContextRelations: contextEntities.detachRelations,
    undoContextDecision: contextEntities.undo,
    attachManualObjectRegion: manualPhotoContext.attachObject,
    replaceManualObjectRegion: manualPhotoContext.replaceObject,
    rejectManualObjectRegion: manualPhotoContext.rejectObject,
    setAssetOwnerSummary: manualPhotoContext.setSummary,
    undoManualPhotoContextDecision: manualPhotoContext.undo,
    smartSearch: basicSmartSearch.search,
    createPerson: personCreates.create,
    documents: documents.list,
    document: documents.get,
    referenceDocument: documents.reference,
    importDocument: documents.importFile,
    updateDocument: documents.update,
    attachDocumentLinks: documents.attachLinks,
    detachDocumentLinks: documents.detachLinks,
    undoDocumentDecision: documents.undo,
    documentContent: documents.content,
    legacyPetDocumentCandidates: documentLegacyPets.list,
    adoptLegacyPetDocument: documentLegacyPets.adopt,
    undoLegacyPetDocumentAdoption: documentLegacyPets.undo,

    async pets({ includeHidden = false, limit = 100, query = "" } = {}) {
      return loadPetRows(sql, { includeHidden, limit, query });
    },

    async pet({ petId }) {
      const [pet] = await loadPetRows(sql, {
        includeHidden: true,
        limit: 1,
        petId,
      });
      if (!pet) throw typedError("Pet not found", 404, "PET_NOT_FOUND");
      return pet;
    },

    async createPet({
      actorId,
      aliases,
      breedLabel,
      commandId,
      coverAssetId,
      coverCrop,
      description,
      displayName,
      speciesKind,
      speciesLabel,
    }) {
      const actor = cleanActor(actorId);
      if (!actor)
        throw typedError("Missing Cimmich actor", 400, "ACTOR_REQUIRED");
      const name = cleanPersonName(displayName);
      const cleanAliasLabels = cleanAliases(aliases) || [];
      const cleanBreed = cleanBreedLabel(breedLabel) ?? null;
      const cleanCrop = cleanCoverCrop(coverCrop);
      const species = validateSpeciesPair(
        cleanSpeciesKind(speciesKind),
        cleanSpeciesLabel(speciesLabel),
      );
      const coverId =
        coverAssetId == null ? null : String(coverAssetId).trim() || null;
      if (cleanCrop && !coverId) {
        throw typedError(
          "coverCrop requires coverAssetId",
          400,
          "PET_COVER_ASSET_REQUIRED",
        );
      }
      const payload = {
        aliases: cleanAliasLabels,
        breedLabel: cleanBreed,
        coverAssetId: coverId,
        coverCrop: cleanCrop || null,
        description: cleanDescription(description),
        displayName: name,
        ...species,
      };
      return sql.begin(async (tx) => {
        const command = await beginPetCommand(tx, {
          actorId: actor,
          commandId,
          commandKind: "create",
          payload,
        });
        if (command.replay) return command.replay;
        await ensureUserCommandReceipt(tx);
        if (coverId) await requireActiveAssets(tx, [coverId]);
        const petId = `pet_${randomUUID().replaceAll("-", "")}`;
        const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
        await tx`
        INSERT INTO person (
          person_id, display_name, status, subject_kind, description,
          cover_asset_id, cover_crop, species_kind, species_label, breed_label,
          created_by_receipt_id, privacy_class
        ) VALUES (
          ${petId}, ${name}, 'active', 'pet', ${payload.description},
          ${coverId}, ${cleanCrop ? tx.json(cleanCrop) : null},
          ${species.speciesKind}, ${species.speciesLabel}, ${cleanBreed},
          ${userCommandReceiptId}, 'private'
        )
      `;
        const seen = new Set([name.toLocaleLowerCase()]);
        for (const label of cleanAliasLabels) {
          const normalized = label.toLocaleLowerCase();
          if (seen.has(normalized)) continue;
          seen.add(normalized);
          await tx`
          INSERT INTO person_alias (
            alias_id, person_id, label, alias_kind, state,
            producer_receipt_id, privacy_class
          ) VALUES (
            ${`alias_${randomUUID().replaceAll("-", "")}`}, ${petId},
            ${label}, 'nickname', 'active', ${userCommandReceiptId}, 'private'
          )
        `;
        }
        await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'pet', ${petId}, 'create', 'user', ${actor},
          'pet_manual_create', 'Create Pet', ${userCommandReceiptId}, 'private'
        )
      `;
        const [pet] = await loadPetRows(tx, {
          includeHidden: true,
          limit: 1,
          petId,
        });
        const response = {
          decisionId,
          pet,
          replayed: false,
          schemaVersion: "cimmich.pet-manual.v2",
          status: "applied",
        };
        return completePetCommand(tx, {
          actorId: actor,
          command,
          commandKind: "create",
          decisionId,
          response,
        });
      });
    },

    async updatePet({
      actorId,
      aliases,
      breedLabel,
      commandId,
      coverAssetId,
      coverCrop,
      description,
      displayName,
      petId,
      speciesKind,
      speciesLabel,
      status,
    }) {
      const actor = cleanActor(actorId);
      if (!actor)
        throw typedError("Missing Cimmich actor", 400, "ACTOR_REQUIRED");
      const requested = {
        ...(aliases !== undefined ? { aliases: cleanAliases(aliases) } : {}),
        ...(breedLabel !== undefined
          ? { breedLabel: cleanBreedLabel(breedLabel) }
          : {}),
        ...(coverAssetId !== undefined
          ? {
              coverAssetId:
                coverAssetId == null
                  ? null
                  : String(coverAssetId).trim() || null,
            }
          : {}),
        ...(coverCrop !== undefined
          ? { coverCrop: cleanCoverCrop(coverCrop) }
          : {}),
        ...(description !== undefined
          ? { description: cleanDescription(description) }
          : {}),
        ...(displayName !== undefined
          ? { displayName: cleanPersonName(displayName) }
          : {}),
        ...(speciesKind !== undefined
          ? { speciesKind: cleanSpeciesKind(speciesKind) }
          : {}),
        ...(speciesLabel !== undefined
          ? { speciesLabel: cleanSpeciesLabel(speciesLabel) }
          : {}),
        ...(status !== undefined ? { status: String(status) } : {}),
      };
      if (!Object.keys(requested).length) {
        throw typedError(
          "No Pet fields were supplied",
          400,
          "PET_UPDATE_EMPTY",
        );
      }
      if (
        requested.status &&
        !["active", "hidden"].includes(requested.status)
      ) {
        throw typedError(
          "Pet status must be active or hidden",
          400,
          "PET_STATUS_INVALID",
        );
      }
      return sql.begin(async (tx) => {
        const command = await beginPetCommand(tx, {
          actorId: actor,
          commandId,
          commandKind: "update",
          payload: { petId, ...requested },
        });
        if (command.replay) return command.replay;
        const current = await requirePet(tx, petId, { allowHidden: true });
        const nextCoverAssetId = Object.hasOwn(requested, "coverAssetId")
          ? requested.coverAssetId
          : current.cover_asset_id;
        const nextCoverCrop = Object.hasOwn(requested, "coverCrop")
          ? requested.coverCrop
          : current.cover_crop;
        const nextSpeciesKind = Object.hasOwn(requested, "speciesKind")
          ? requested.speciesKind
          : current.species_kind;
        if (
          Object.hasOwn(requested, "speciesLabel") &&
          requested.speciesLabel &&
          nextSpeciesKind !== "other"
        ) {
          validateSpeciesPair(nextSpeciesKind, requested.speciesLabel);
        }
        const nextSpeciesLabel =
          nextSpeciesKind !== "other"
            ? null
            : Object.hasOwn(requested, "speciesLabel")
              ? requested.speciesLabel
              : current.species_kind === "other"
                ? current.species_label
                : null;
        validateSpeciesPair(nextSpeciesKind, nextSpeciesLabel);
        if (nextCoverCrop && !nextCoverAssetId) {
          throw typedError(
            "coverCrop requires coverAssetId",
            400,
            "PET_COVER_ASSET_REQUIRED",
          );
        }
        if (nextCoverAssetId) await requireActiveAssets(tx, [nextCoverAssetId]);
        await ensureUserCommandReceipt(tx);
        const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
        await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'pet', ${current.person_id},
          ${requested.status === "hidden" ? "archive" : "update"}, 'user', ${actor},
          'pet_manual_update', 'Update Pet', ${userCommandReceiptId}, 'private'
        )
      `;
        await tx`
        UPDATE person SET
          display_name = ${requested.displayName ?? current.display_name},
          description = ${requested.description ?? current.description},
          cover_asset_id = ${nextCoverAssetId},
          cover_crop = ${nextCoverCrop ? tx.json(nextCoverCrop) : null},
          species_kind = ${nextSpeciesKind},
          species_label = ${nextSpeciesLabel},
          breed_label = ${Object.hasOwn(requested, "breedLabel") ? requested.breedLabel : current.breed_label},
          status = ${requested.status ?? current.status},
          current_revision = current_revision + 1
        WHERE person_id = ${current.person_id}
      `;
        if (requested.aliases) {
          const desired = new Map(
            requested.aliases.map((label) => [
              label.toLocaleLowerCase(),
              label,
            ]),
          );
          const existing = await tx`
          SELECT alias_id, label FROM person_alias
          WHERE person_id = ${current.person_id} AND state = 'active'
          ORDER BY created_at, alias_id
        `;
          for (const alias of existing) {
            if (!desired.has(alias.label.toLocaleLowerCase())) {
              await tx`UPDATE person_alias SET state = 'removed' WHERE alias_id = ${alias.alias_id}`;
            } else {
              desired.delete(alias.label.toLocaleLowerCase());
            }
          }
          for (const label of desired.values()) {
            if (
              label.toLocaleLowerCase() ===
              String(
                requested.displayName ?? current.display_name,
              ).toLocaleLowerCase()
            )
              continue;
            await tx`
            INSERT INTO person_alias (
              alias_id, person_id, label, alias_kind, state,
              producer_receipt_id, privacy_class
            ) VALUES (
              ${`alias_${randomUUID().replaceAll("-", "")}`}, ${current.person_id},
              ${label}, 'nickname', 'active', ${userCommandReceiptId}, 'private'
            )
          `;
          }
        }
        const [pet] = await loadPetRows(tx, {
          includeHidden: true,
          limit: 1,
          petId: current.person_id,
        });
        const response = {
          decisionId,
          pet,
          replayed: false,
          schemaVersion: "cimmich.pet-manual.v2",
          status: "applied",
        };
        return completePetCommand(tx, {
          actorId: actor,
          command,
          commandKind: "update",
          decisionId,
          response,
        });
      });
    },

    async modifyPetMedia({ actorId, assetIds, commandId, petId, selected }) {
      const actor = cleanActor(actorId);
      if (!actor)
        throw typedError("Missing Cimmich actor", 400, "ACTOR_REQUIRED");
      const ids = cleanAssetIds(assetIds);
      const commandKind = selected ? "attach" : "detach";
      return sql.begin(async (tx) => {
        const command = await beginPetCommand(tx, {
          actorId: actor,
          commandId,
          commandKind,
          payload: { assetIds: ids, petId },
        });
        if (command.replay) return command.replay;
        const pet = await requirePet(tx, petId);
        await requireActiveAssets(tx, ids);
        await ensureUserCommandReceipt(tx);
        const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
        await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'pet_media', ${pet.person_id}, ${commandKind}, 'user', ${actor},
          ${`pet_manual_${commandKind}`},
          ${`${selected ? "Attach" : "Detach"} Pet on ${ids.length} media item(s)`},
          ${userCommandReceiptId}, 'private'
        )
      `;
        const currentRows = await tx`
        SELECT DISTINCT ON (asset_id)
          presence_tag_id, asset_id, state, created_at
        FROM current_presence_tag
        WHERE person_id = ${pet.person_id} AND asset_id = ANY(${ids})
        ORDER BY asset_id, (state = 'accepted') DESC, created_at DESC, presence_tag_id DESC
      `;
        const currentByAsset = new Map(
          currentRows.map((row) => [row.asset_id, row]),
        );
        const snapshot = [];
        const unchangedAssetIds = [];
        for (const assetId of ids) {
          const current = currentByAsset.get(assetId);
          if (
            (selected && current?.state === "accepted") ||
            (!selected && current?.state !== "accepted")
          ) {
            unchangedAssetIds.push(assetId);
            continue;
          }
          if (current) {
            await tx`UPDATE presence_tag SET state = 'superseded' WHERE presence_tag_id = ${current.presence_tag_id}`;
          }
          const presenceTagId = `presence_tag_${randomUUID().replaceAll("-", "")}`;
          await tx`
          INSERT INTO presence_tag (
            presence_tag_id, person_id, asset_id, origin, reason_code, note,
            state, confidence, decision_id, supersedes_presence_tag_id,
            producer_receipt_id, privacy_class
          ) VALUES (
            ${presenceTagId}, ${pet.person_id}, ${assetId}, 'user', 'manual_pet',
            '', ${selected ? "accepted" : "rejected"}, 1, ${decisionId},
            ${current?.presence_tag_id || null}, ${userCommandReceiptId}, 'private'
          )
        `;
          snapshot.push({
            assetId,
            createdPresenceTagId: presenceTagId,
            previousPresenceTagId: current?.presence_tag_id || null,
            previousState: current?.state || null,
          });
        }
        if (snapshot.length) {
          await tx`UPDATE person SET current_revision = current_revision + 1 WHERE person_id = ${pet.person_id}`;
        }
        const operationId = snapshot.length
          ? `petop_${randomUUID().replaceAll("-", "")}`
          : null;
        const [projection] = await loadPetRows(tx, {
          includeHidden: true,
          limit: 1,
          petId: pet.person_id,
        });
        const response = {
          changedAssetIds: snapshot.map((item) => item.assetId),
          decisionId,
          pet: projection,
          replayed: false,
          schemaVersion: "cimmich.pet-manual.v2",
          status: snapshot.length ? "applied" : "no_change",
          unchangedAssetIds,
          undo: {
            eligible: Boolean(operationId),
            token: operationId ? decisionId : null,
          },
        };
        await completePetCommand(tx, {
          actorId: actor,
          command,
          commandKind,
          decisionId,
          response,
        });
        if (operationId) {
          await tx`
          INSERT INTO pet_association_operation (
            operation_id, command_id, pet_id, action, decision_id, state,
            snapshot, producer_receipt_id, privacy_class
          ) VALUES (
            ${operationId}, ${command.commandId}, ${pet.person_id}, ${commandKind},
            ${decisionId}, 'active', ${tx.json(snapshot)}, ${petManualReceiptId}, 'private'
          )
        `;
        }
        return response;
      });
    },

    async undoPetDecision({ actorId, commandId, decisionId }) {
      const actor = cleanActor(actorId);
      if (!actor)
        throw typedError("Missing Cimmich actor", 400, "ACTOR_REQUIRED");
      const originalDecisionId = String(decisionId || "");
      return sql.begin(async (tx) => {
        const command = await beginPetCommand(tx, {
          actorId: actor,
          commandId,
          commandKind: "undo",
          payload: { decisionId: originalDecisionId },
        });
        if (command.replay) return command.replay;
        const [operation] = await tx`
        SELECT operation_id, pet_id, action, decision_id, state, snapshot
        FROM pet_association_operation
        WHERE decision_id = ${originalDecisionId}
        FOR UPDATE
      `;
        if (!operation || operation.state !== "active") {
          throw typedError(
            "This Pet decision is superseded or not reversible",
            409,
            "PET_UNDO_NOT_AVAILABLE",
          );
        }
        const pet = await requirePet(tx, operation.pet_id, {
          allowHidden: true,
        });
        for (const item of operation.snapshot || []) {
          const [created] = await tx`
          SELECT presence_tag_id, state FROM presence_tag
          WHERE presence_tag_id = ${item.createdPresenceTagId}
            AND person_id = ${pet.person_id}
            AND state <> 'superseded'
            AND NOT EXISTS (
              SELECT 1 FROM presence_tag newer
              WHERE newer.supersedes_presence_tag_id = presence_tag.presence_tag_id
            )
          FOR UPDATE
        `;
          if (!created) {
            throw typedError(
              "Pet media projection changed after this decision",
              409,
              "PET_UNDO_SUPERSEDED",
              { assetId: item.assetId },
            );
          }
        }
        await ensureUserCommandReceipt(tx);
        const undoDecisionId = `decision_${randomUUID().replaceAll("-", "")}`;
        await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, supersedes_decision_id, producer_receipt_id,
          privacy_class
        ) VALUES (
          ${undoDecisionId}, 'pet_media', ${pet.person_id}, 'undo', 'user', ${actor},
          'pet_manual_undo', 'Undo Pet media association', ${operation.decision_id},
          ${userCommandReceiptId}, 'private'
        )
      `;
        const restoredAssetIds = [];
        for (const item of operation.snapshot || []) {
          await tx`UPDATE presence_tag SET state = 'superseded' WHERE presence_tag_id = ${item.createdPresenceTagId}`;
          const restoredState =
            item.previousState === "accepted" ? "accepted" : "rejected";
          await tx`
          INSERT INTO presence_tag (
            presence_tag_id, person_id, asset_id, origin, reason_code, note,
            state, confidence, decision_id, supersedes_presence_tag_id,
            producer_receipt_id, privacy_class
          ) VALUES (
            ${`presence_tag_${randomUUID().replaceAll("-", "")}`}, ${pet.person_id},
            ${item.assetId}, 'user', 'manual_pet_undo', '', ${restoredState}, 1,
            ${undoDecisionId}, ${item.createdPresenceTagId},
            ${userCommandReceiptId}, 'private'
          )
        `;
          restoredAssetIds.push(item.assetId);
        }
        await tx`
        UPDATE pet_association_operation
        SET state = 'reverted', undo_decision_id = ${undoDecisionId}, reverted_at = now()
        WHERE operation_id = ${operation.operation_id}
      `;
        await tx`UPDATE person SET current_revision = current_revision + 1 WHERE person_id = ${pet.person_id}`;
        const [projection] = await loadPetRows(tx, {
          includeHidden: true,
          limit: 1,
          petId: pet.person_id,
        });
        const response = {
          decisionId: undoDecisionId,
          pet: projection,
          replayed: false,
          restoredAssetIds,
          schemaVersion: "cimmich.pet-manual.v2",
          status: "reverted",
          supersedesDecisionId: operation.decision_id,
        };
        return completePetCommand(tx, {
          actorId: actor,
          command,
          commandKind: "undo",
          decisionId: undoDecisionId,
          response,
        });
      });
    },

    async petMedia({ limit = 100, petId }) {
      await this.pet({ petId });
      const rows = await sql`
      SELECT asset.asset_id, asset.media_kind, asset.width, asset.height,
        asset.capture_time,
        array_agg(DISTINCT association.association_type ORDER BY association.association_type) AS association_types
      FROM person_assets association
      JOIN asset ON asset.asset_id = association.asset_id AND asset.state = 'active'
      WHERE association.person_id = ${String(petId || "")}
        AND association.authority_state = 'accepted'
        AND cimmich_visibility_asset_rank(asset.asset_id) <= ${presentationRank()}
      GROUP BY asset.asset_id
      ORDER BY asset.capture_time DESC NULLS LAST, asset.asset_id
      LIMIT ${cleanLimit(limit, 100, 500)}
    `;
      return rows.map((row) => ({
        ...row,
        ...bridgeFields(bridge, row.asset_id),
      }));
    },

    async assetSubjects({ assetId }) {
      const id = String(assetId || "");
      const [asset] =
        await sql`SELECT asset_id FROM asset WHERE asset_id = ${id} AND state = 'active'`;
      if (!asset)
        throw typedError("Asset not found", 404, "PET_ASSET_NOT_FOUND");
      const rows = await sql`
      SELECT subject.person_id, subject.display_name, subject.subject_kind,
        array_agg(DISTINCT association.association_type ORDER BY association.association_type) AS association_types
      FROM person_assets association
      JOIN current_person subject ON subject.person_id = association.person_id
      WHERE association.asset_id = ${id} AND association.authority_state = 'accepted'
        AND cimmich_visibility_subject_rank(
          subject.subject_kind, subject.person_id
        ) <= ${presentationRank()}
      GROUP BY subject.person_id, subject.display_name, subject.subject_kind
      ORDER BY subject.subject_kind, coalesce(subject.display_name, subject.person_id), subject.person_id
    `;
      return rows.map((row) => ({
        associationTypes: row.association_types,
        displayName: row.display_name || "",
        subjectId: row.person_id,
        subjectKind: row.subject_kind,
      }));
    },

    async previewPetMerge({ sourcePetId, targetPetId }) {
      await requireVisibleSubject(sourcePetId);
      await requireVisibleSubject(targetPetId);
      const subjects = await sql`
      SELECT person_id, subject_kind, status FROM person
      WHERE person_id IN (${String(sourcePetId || "")}, ${String(targetPetId || "")})
      ORDER BY person_id
    `;
      if (
        subjects.length !== 2 ||
        subjects.some(
          (subject) =>
            subject.subject_kind !== "pet" || subject.status !== "active",
        )
      ) {
        throw typedError(
          "Only two active Pets can use the Pet merge route",
          409,
          "PET_PERSON_ISOLATION",
        );
      }
      const preview = await this.previewPersonMerge({
        sourcePersonId: sourcePetId,
        targetPersonId: targetPetId,
      });
      return preview;
    },

    async mergePets({ actorId, commandId, sourcePetId, targetPetId }) {
      return this.mergePeople({
        actorId,
        commandId,
        sourcePersonId: sourcePetId,
        targetPersonId: targetPetId,
      });
    },

    async unmergePets({ actorId, commandId, mergeOperationId }) {
      const [operation] = await sql`
      SELECT merge.merge_operation_id, source.subject_kind AS source_kind,
        target.subject_kind AS target_kind
      FROM person_merge_operation merge
      JOIN person source ON source.person_id = merge.source_person_id
      JOIN person target ON target.person_id = merge.target_person_id
      WHERE merge.merge_operation_id = ${String(mergeOperationId || "")}
        AND cimmich_visibility_subject_rank(
          source.subject_kind, source.person_id
        ) <= ${presentationRank()}
        AND cimmich_visibility_subject_rank(
          target.subject_kind, target.person_id
        ) <= ${presentationRank()}
    `;
      if (
        !operation ||
        operation.source_kind !== "pet" ||
        operation.target_kind !== "pet"
      ) {
        throw typedError("Pet merge not found", 404, "PET_MERGE_NOT_FOUND");
      }
      return this.unmergePeople({ actorId, commandId, mergeOperationId });
    },

    async machineSuggestions({ limit = 24 } = {}) {
      if (enhancedComponent && !(await enhancedComponent.isEnabled())) {
        return [];
      }
      const boundedLimit = cleanLimit(limit, 24, 80);
      const visibleRank = presentationRank();
      const createReviewCandidateSets = (query) =>
        createVisualCandidateSetRepository(query, {
          allTrustedShortlistEvaluationReceiptDigest:
            options.allTrustedShortlistEvaluationReceiptDigest,
          allTrustedShortlistFrozenSourcePackId:
            options.allTrustedShortlistFrozenSourcePackId,
          presentationRank: () => visibleRank,
        });
      const reviewCandidateSets =
        options.visualCandidateSets || createReviewCandidateSets(sql);
      const routeAllTrustedShortlist = async (suggestion) => {
        const route = async (candidateSets) => {
          const candidateEnvelope = await candidateSets.load({
            faceId: suggestion.face_id,
            limit: 64,
            providerConfigDigest: suggestion.provider_config_digest,
            visualFloor: 0,
          });
          if (candidateEnvelope.state !== "available") return null;
          const result = await candidateSets.routeAllTrustedShortlist({
            candidateEnvelope,
          });
          if (!result?.changed) return null;
          return {
            projection:
              candidateSets.projectAllTrustedShortlistSuggestion(result),
            result,
          };
        };
        if (options.visualCandidateSets) {
          return route(options.visualCandidateSets);
        }
        return sql.begin(async (tx) => {
          await tx`
            SELECT set_config(
              'statement_timeout',
              ${String(allTrustedShortlistStatementTimeoutMs)},
              true
            ), set_config(
              'transaction_timeout',
              ${String(allTrustedShortlistTransactionTimeoutMs)},
              true
            )
          `;
          return route(createReviewCandidateSets(tx));
        });
      };
      if (!machineReviewConfigured) {
        return [];
      }
      if (
        machineSuggestionCache?.expiresAt > Date.now() &&
        machineSuggestionCache.visibleRank === visibleRank
      ) {
        return (await machineSuggestionCache.promise).slice(0, boundedLimit);
      }
      const promise = (async () => {
        // Score one stable bounded front for every consumer. The caller's output
        // limit truncates this ranked snapshot only; it never changes eligibility
        // or the upstream vector-search frontier.
        const queryLimit = machineSuggestionQueryLimit;
        const rows = await sql`
      WITH face_contexts AS MATERIALIZED (
        SELECT face_id, min(context_id) AS evidence_context,
          array_agg(context_id ORDER BY context_id) AS context_ids
        FROM current_face_capture_context
        GROUP BY face_id
      ), visible_active_assets AS MATERIALIZED (
        SELECT asset_id, capture_time, media_kind, width, height
        FROM asset
        WHERE state = 'active'
          AND cimmich_visibility_asset_rank(asset_id) <= ${visibleRank}
      ), accepted_people_by_asset AS MATERIALIZED (
        SELECT DISTINCT accepted_face.asset_id, accepted.person_id
        FROM identity_claim accepted
        JOIN face_observation accepted_face
          ON accepted_face.face_id = accepted.face_id
          AND accepted_face.state = 'valid'
        WHERE accepted.state = 'accepted'
      ), query_inventory AS MATERIALIZED (
        SELECT fo.face_id, fo.asset_id, fo.box_x, fo.box_y, fo.box_w, fo.box_h,
          fo.detection_confidence::float8, fo.quality_measurements,
          asset.capture_time, asset.media_kind, asset.width, asset.height,
          embedding.embedding_id,
          embedding.model_family, embedding.model_version, embedding.config_digest,
          embedding.dimension, pack.pack_id,
          CASE WHEN jsonb_typeof(
            pack.evaluation_summary->'matcherPolicy'->'marginFloor'
          ) = 'number' THEN
            (pack.evaluation_summary->'matcherPolicy'->>'marginFloor')::float8
          END AS policy_margin_floor,
          CASE WHEN jsonb_typeof(
            pack.evaluation_summary->'matcherPolicy'->'scoreFloor'
          ) = 'number' THEN
            (pack.evaluation_summary->'matcherPolicy'->>'scoreFloor')::float8
          END AS policy_score_floor,
          runtime.runtime_recognized_at,
          coalesce(query_context.context_ids, ARRAY[]::text[]) AS query_context_ids,
          coalesce(nullif(fo.quality_measurements->>'quality_score', '')::float8, 0) AS quality_score
        FROM face_observation fo
        JOIN current_source_pack pack
          ON pack.evaluation_status = 'passed'
          AND pack.model_family = ${matchingProvider.modelFamily}
          AND pack.model_version = ${matchingProvider.modelVersion}
          AND pack.config_digest = ${matchingProvider.configDigest}
          AND pack.evaluation_summary->'matcherPolicy'->>'policyVersion'
            = ${machineMatcherPolicyVersion}
          AND pack.evaluation_summary->'matcherPolicy'->>'scorer'
            = 'best_individual_prime'
          AND jsonb_typeof(pack.evaluation_summary->'matcherPolicy'->'scoreFloor')
            = 'number'
          AND jsonb_typeof(pack.evaluation_summary->'matcherPolicy'->'marginFloor')
            = 'number'
          AND CASE WHEN jsonb_typeof(
            pack.evaluation_summary->'matcherPolicy'->'scoreFloor'
          ) = 'number' THEN
            (pack.evaluation_summary->'matcherPolicy'->>'scoreFloor')::float8
              BETWEEN 0 AND 1
          ELSE false END
          AND CASE WHEN jsonb_typeof(
            pack.evaluation_summary->'matcherPolicy'->'marginFloor'
          ) = 'number' THEN
            (pack.evaluation_summary->'matcherPolicy'->>'marginFloor')::float8
              BETWEEN 0 AND 1
          ELSE false END
        JOIN face_embedding embedding
          ON embedding.face_id = fo.face_id
          AND embedding.state = 'active'
          AND embedding.model_family = pack.model_family
          AND embedding.model_version = pack.model_version
          AND embedding.config_digest = pack.config_digest
        JOIN visible_active_assets asset ON asset.asset_id = fo.asset_id
        LEFT JOIN face_contexts query_context ON query_context.face_id = fo.face_id
        LEFT JOIN LATERAL (
          SELECT max(pipeline.recognized_at) AS runtime_recognized_at
          FROM media_pipeline_run pipeline
          JOIN media_job job ON job.job_id = pipeline.recognition_job_id
            AND job.state = 'completed'
            AND job.result_receipt_id = embedding.producer_receipt_id
          JOIN current_asset_source_revision revision
            ON revision.revision_id = pipeline.source_revision_id
            AND revision.asset_id = pipeline.asset_id
            AND revision.input_revision = pipeline.input_revision
            AND revision.source_content_digest = pipeline.source_content_digest
          WHERE pipeline.asset_id = fo.asset_id
            AND pipeline.recognizer_config_digest = embedding.config_digest
            AND pipeline.state = 'recognized'
        ) runtime ON true
        WHERE fo.state = 'valid'
          AND NOT EXISTS (
            SELECT 1 FROM identity_claim accepted
            WHERE accepted.face_id = fo.face_id AND accepted.state = 'accepted'
          )
          AND coalesce((
            SELECT dismissed.action
            FROM decision dismissed
            WHERE dismissed.subject_type = 'machine_suggestion'
              AND dismissed.subject_id = fo.face_id || ':' || embedding.model_version || ':' || embedding.config_digest || ':' || ${machineMatcherPolicyVersion}
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
              AND accepted_face.asset_id = fo.asset_id
            CROSS JOIN LATERAL (
              SELECT greatest(0, least(fo.box_x + fo.box_w, accepted_face.box_x + accepted_face.box_w)
                - greatest(fo.box_x, accepted_face.box_x))
                * greatest(0, least(fo.box_y + fo.box_h, accepted_face.box_y + accepted_face.box_h)
                - greatest(fo.box_y, accepted_face.box_y)) AS intersection
            ) overlap
            WHERE accepted.state = 'accepted'
              AND overlap.intersection / greatest(
                0.0000001,
                fo.box_w * fo.box_h + accepted_face.box_w * accepted_face.box_h - overlap.intersection
              ) >= 0.45
          )
      ), ranked_queries AS MATERIALIZED (
        SELECT query_inventory.*,
          row_number() OVER (
            PARTITION BY (runtime_recognized_at IS NOT NULL)
            ORDER BY runtime_recognized_at DESC NULLS LAST,
              quality_score DESC, detection_confidence DESC, face_id
          ) AS lane_rank
        FROM query_inventory
      ), query_frontier AS MATERIALIZED (
        SELECT * FROM ranked_queries
        WHERE (
          runtime_recognized_at IS NOT NULL
          AND lane_rank <= ${machineSuggestionRuntimeQueryLimit}
        ) OR (
          runtime_recognized_at IS NULL
          AND lane_rank <= ${queryLimit}
        )
      ), queries AS MATERIALIZED (
        SELECT frontier.*, embedding.embedding
        FROM query_frontier frontier
        CROSS JOIN LATERAL (
          SELECT current_embedding.embedding
          FROM face_embedding current_embedding
          WHERE current_embedding.embedding_id = frontier.embedding_id
            AND current_embedding.state = 'active'
          OFFSET 0
        ) embedding
      ), scored_people AS MATERIALIZED (
        SELECT person.person_id, person.display_name,
          NOT EXISTS (
            SELECT 1 FROM current_person_category category
            WHERE category.person_id = person.person_id
              AND category.slug IN ('sort', 'holding')
          ) AS can_suggest
        FROM current_person person
        WHERE person.status = 'active'
          AND person.subject_kind = 'person'
          AND cimmich_visibility_person_rank(person.person_id) <= ${visibleRank}
      ), prime_face_evidence_raw AS MATERIALIZED (
        SELECT query.face_id, query.asset_id, gallery.person_id,
          coalesce('context:' || reference_context.evidence_context,
            'asset:' || reference_face.asset_id) AS evidence_unit,
          (1 - (gallery.embedding <=> query.embedding))::float8 AS score
        FROM queries query
        JOIN source_pack_matching_gallery gallery
          ON gallery.pack_id = query.pack_id
          AND gallery.bucket_kind = 'prime'
          AND gallery.reference_kind = 'face'
        JOIN scored_people person ON person.person_id = gallery.person_id
        JOIN face_observation reference_face
          ON reference_face.face_id = gallery.face_id
          AND reference_face.state = 'valid'
          AND reference_face.asset_id <> query.asset_id
        LEFT JOIN face_contexts reference_context
          ON reference_context.face_id = gallery.face_id
        LEFT JOIN accepted_people_by_asset same_photo_person
          ON same_photo_person.asset_id = query.asset_id
          AND same_photo_person.person_id = gallery.person_id
        WHERE same_photo_person.person_id IS NULL
          AND NOT (
            coalesce(reference_context.context_ids, ARRAY[]::text[])
              && query.query_context_ids
          )
      ), prime_face_evidence AS (
        SELECT face_id, asset_id, person_id, evidence_unit, max(score)::float8 AS score
        FROM prime_face_evidence_raw
        GROUP BY face_id, asset_id, person_id, evidence_unit
      ), prime_face_ranked AS (
        SELECT *, row_number() OVER (
          PARTITION BY face_id, person_id ORDER BY score DESC, evidence_unit
        ) AS evidence_rank
        FROM prime_face_evidence
      ), prime_face_scores AS (
        SELECT face_id, asset_id, person_id,
          max(score)::float8 AS individual_max,
          avg(score) FILTER (WHERE evidence_rank <= 3)::float8 AS individual_top3
        FROM prime_face_ranked
        GROUP BY face_id, asset_id, person_id
      ), prime_scores AS MATERIALIZED (
        SELECT individual.face_id, individual.asset_id, individual.person_id,
          individual.individual_max::float8 AS raw_prime_score,
          individual.individual_max::float8 AS prime_score,
          individual.individual_top3
        FROM prime_face_scores individual
      ), person_scores AS MATERIALIZED (
        SELECT query.face_id, query.asset_id, query.box_x, query.box_y, query.box_w, query.box_h,
          query.detection_confidence, query.quality_measurements, query.quality_score,
          query.capture_time, query.media_kind, query.width, query.height,
          query.config_digest, query.policy_margin_floor, query.policy_score_floor,
          prime.person_id, person.display_name, person.can_suggest,
          prime.raw_prime_score, prime.prime_score,
          prime.individual_top3,
          NULL::float8 AS prototype_score,
          NULL::float8 AS secondary_score
        FROM prime_scores prime
        JOIN queries query ON query.face_id = prime.face_id
        JOIN scored_people person ON person.person_id = prime.person_id
      ), ranked AS (
        SELECT person_scores.*,
          row_number() OVER (
            PARTITION BY face_id
            ORDER BY prime_score DESC NULLS LAST, raw_prime_score DESC NULLS LAST,
              individual_top3 DESC NULLS LAST, person_id
          )::int AS candidate_rank,
          first_value(can_suggest) OVER (
            PARTITION BY face_id
            ORDER BY prime_score DESC NULLS LAST, raw_prime_score DESC NULLS LAST,
              individual_top3 DESC NULLS LAST, person_id
          ) AS lead_can_suggest,
          (prime_score - lead(prime_score) OVER (
            PARTITION BY face_id
            ORDER BY prime_score DESC NULLS LAST, raw_prime_score DESC NULLS LAST,
              individual_top3 DESC NULLS LAST, person_id
          ))::float8 AS lead_margin
        FROM person_scores
        WHERE prime_score IS NOT NULL
      )
      SELECT *
      FROM ranked
      WHERE candidate_rank <= 3 AND can_suggest AND lead_can_suggest
        AND EXISTS (
          SELECT 1
          FROM ranked lead
          WHERE lead.face_id = ranked.face_id AND lead.candidate_rank = 1
            AND lead.can_suggest
            AND lead.prime_score >= lead.policy_score_floor
            AND coalesce(lead.lead_margin, 1) >= lead.policy_margin_floor
        )
      ORDER BY quality_score DESC, detection_confidence DESC, face_id, candidate_rank
    `;

        const byFace = new Map();
        for (const row of rows) {
          let suggestion = byFace.get(row.face_id);
          if (!suggestion) {
            suggestion = {
              asset_id: row.asset_id,
              box_h: Number(row.box_h),
              box_w: Number(row.box_w),
              box_x: Number(row.box_x),
              box_y: Number(row.box_y),
              candidates: [],
              capture_time: row.capture_time,
              detection_confidence: Number(row.detection_confidence),
              face_id: row.face_id,
              height: row.height,
              media_kind: row.media_kind,
              provider_config_digest: row.config_digest,
              policy_score_floor:
                row.policy_score_floor == null
                  ? 0
                  : Number(row.policy_score_floor),
              quality_measurements: row.quality_measurements || {},
              quality_score: Number(row.quality_score),
              margin: row.lead_margin == null ? null : Number(row.lead_margin),
              width: row.width,
              ...bridgeFields(bridge, row.asset_id),
            };
            byFace.set(row.face_id, suggestion);
          }
          suggestion.candidates.push({
            display_name: row.display_name,
            person_id: row.person_id,
            prime_score: Number(row.prime_score),
            prime_top3_score:
              row.individual_top3 == null ? null : Number(row.individual_top3),
            prototype_score:
              row.prototype_score == null ? null : Number(row.prototype_score),
            raw_prime_score: Number(row.raw_prime_score),
            rank: row.candidate_rank,
            secondary_score:
              row.secondary_score == null ? null : Number(row.secondary_score),
          });
        }

        const baseline = [...byFace.values()].slice(0, 80).map((suggestion) => {
          return {
            ...suggestion,
            review_reason:
              suggestion.margin != null && suggestion.margin < 0.08
                ? "close_alternatives"
                : suggestion.quality_score < 0.55
                  ? "weak_face"
                  : "strong_lead",
          };
        });
        if (
          !conditionConsensusReviewEnabled &&
          !allTrustedShortlistReviewEnabled
        ) {
          for (const suggestion of baseline) {
            delete suggestion.provider_config_digest;
            delete suggestion.policy_score_floor;
          }
          return baseline;
        }

        // The frozen shortlist policy may append one review-only rank-four
        // option. Prime ranks one through three stay byte-stable, and the
        // repository requires current same-space provider/source provenance
        // for both the query and the all-trusted scout evidence.
        if (allTrustedShortlistReviewEnabled) {
          const eligible = baseline
            .filter(
              (suggestion) =>
                suggestion.candidates.length === 3 &&
                isFaceHardShortlistOpportunity(suggestion),
            )
            .slice(0, allTrustedShortlistBatchLimit);
          for (
            let offset = 0;
            offset < eligible.length;
            offset += allTrustedShortlistConcurrency
          ) {
            await Promise.all(
              eligible
                .slice(offset, offset + allTrustedShortlistConcurrency)
                .map(async (suggestion) => {
                  try {
                    const routed = await routeAllTrustedShortlist(suggestion);
                    if (!routed) return;
                    const { projection, result } = routed;
                    if (
                      projection.faceId !== suggestion.face_id ||
                      suggestion.candidates.some(
                        ({ person_id: personId }) =>
                          personId === projection.personId,
                      )
                    ) {
                      return;
                    }
                    suggestion.candidates.push({
                      display_name: projection.displayName,
                      person_id: projection.personId,
                      prime_score: projection.candidatePrimeScore,
                      prime_top3_score: null,
                      prototype_score: null,
                      rank: 4,
                      raw_prime_score: projection.candidatePrimeScore,
                      scout_score: projection.scoutScore,
                      score_kind: "all_trusted_same_space_max",
                      secondary_score: null,
                    });
                    suggestion.all_trusted_shortlist = {
                      applied: true,
                      authority: "review_only",
                      reason: result.reason,
                      schema_version: result.schemaVersion,
                    };
                    suggestion.review_reason = "all_trusted_rank_four";
                  } catch {
                    // Current-lineage, visibility, ambiguity or bounded-frontier
                    // failure is a per-face abstention and never hides Prime review.
                  }
                }),
            );
          }
        }

        // The legacy Prime scorer remains the stable broad review front. A
        // measured condition policy may alter only its frozen top-two order,
        // and only through an exact repository-issued active/passed SourcePack
        // envelope. Failure to establish that lineage leaves the baseline
        // suggestion untouched.
        for (const suggestion of baseline) {
          if (suggestion.all_trusted_shortlist?.applied) continue;
          if (
            suggestion.candidates.length < 2 ||
            suggestion.margin == null ||
            suggestion.margin > 0.08
          ) {
            continue;
          }
          try {
            const candidateEnvelope = await reviewCandidateSets.load({
              faceId: suggestion.face_id,
              limit: 3,
              providerConfigDigest: suggestion.provider_config_digest,
              visualFloor: suggestion.policy_score_floor,
            });
            if (candidateEnvelope.state !== "available") continue;
            const result =
              await reviewCandidateSets.routeProviderConditionConsensus({
                candidateEnvelope,
              });
            if (!result.changed) continue;
            const projection =
              reviewCandidateSets.projectConditionReviewSuggestion(result);
            if (projection.faceId !== suggestion.face_id) continue;
            const selectedIndex = suggestion.candidates.findIndex(
              ({ person_id: personId }) => personId === projection.personId,
            );
            if (selectedIndex < 1) continue;
            const [selected] = suggestion.candidates.splice(selectedIndex, 1);
            suggestion.candidates.unshift(selected);
            suggestion.candidates.forEach((candidate, index) => {
              candidate.rank = index + 1;
            });
            suggestion.condition_consensus = {
              applied: true,
              reason: result.reason,
              result_digest: result.resultDigest,
              schema_version: result.schemaVersion,
            };
            suggestion.review_reason = "independent_condition_consensus";
          } catch {
            // Per-face stale or unavailable evidence abstains. It must not
            // suppress unrelated review work or expose internal lineage.
          }
        }
        for (const suggestion of baseline) {
          delete suggestion.provider_config_digest;
          delete suggestion.policy_score_floor;
        }
        return baseline;
      })();
      machineSuggestionCache = {
        // Keep one scorer snapshot shared while it is in flight. Start the
        // short reuse window only after PostgreSQL has finished; otherwise a
        // cold query longer than the TTL is already stale when it resolves.
        expiresAt: Number.POSITIVE_INFINITY,
        promise,
        visibleRank,
      };
      try {
        const result = await promise;
        if (machineSuggestionCache?.promise === promise) {
          machineSuggestionCache.expiresAt = Date.now() + 5000;
        }
        return result.slice(0, boundedLimit);
      } catch (error) {
        if (machineSuggestionCache?.promise === promise) {
          machineSuggestionCache = null;
        }
        throw error;
      }
    },

    async people({ limit = 100, personId = "", query = "" } = {}) {
      const boundedLimit = cleanLimit(limit, 100, 500);
      const visibleRank = presentationRank();
      const exactPersonId = String(personId || "");
      const nameQuery = `%${String(query || "").trim()}%`;
      const rows = await sql`
      WITH identity_rows AS MATERIALIZED (
        SELECT current.person_id, current.face_id, current.state,
          current.identity_claim_id, claim.evidence_refs, claim.calibrated_confidence,
          fo.asset_id, fo.box_x, fo.box_y, fo.box_w, fo.box_h,
          fo.quality_measurements, fo.state AS face_state
        FROM current_face_identity current
        JOIN identity_claim claim ON claim.identity_claim_id = current.identity_claim_id
        JOIN face_observation fo ON fo.face_id = current.face_id
        WHERE cimmich_visibility_asset_rank(fo.asset_id) <= ${visibleRank}
      ), accepted_photo_person AS MATERIALIZED (
        SELECT DISTINCT person_id, asset_id
        FROM identity_rows
        WHERE state = 'accepted' AND face_state = 'valid'
      ), person_categories AS MATERIALIZED (
        SELECT current.person_id,
          jsonb_agg(
            jsonb_build_object(
              'category_id', current.category_id,
              'slug', current.slug,
              'name', current.name,
              'category_kind', current.category_kind,
              'sort_order', current.sort_order
            ) ORDER BY current.sort_order, current.name
          ) AS categories,
          bool_or(current.slug = 'sort') AS needs_sort,
          bool_or(current.slug = 'holding') AS needs_holding
        FROM current_person_category current
        GROUP BY current.person_id
      ), gallery_rows AS MATERIALIZED (
        SELECT gallery.person_id, gallery.bucket_kind, gallery.face_id,
          gallery.membership_state
        FROM current_reference_gallery gallery
        JOIN face_observation face ON face.face_id = gallery.face_id
        WHERE cimmich_visibility_asset_rank(face.asset_id) <= ${visibleRank}
      ), accepted_asset_people AS MATERIALIZED (
        SELECT identity.person_id, identity.asset_id,
          CASE WHEN head.face_id IS NULL THEN 'face' ELSE 'head' END AS association_type
        FROM identity_rows identity
        LEFT JOIN (
          SELECT DISTINCT person_id, face_id
          FROM gallery_rows
          WHERE bucket_kind = 'head' AND membership_state = 'active'
        ) head ON head.person_id = identity.person_id AND head.face_id = identity.face_id
        WHERE identity.state = 'accepted'
        UNION ALL
        SELECT tag.person_id, observation.asset_id,
          CASE
            WHEN tag.origin = 'face_body_linkage' AND tag.supporting_face_id IS NOT NULL THEN 'body_link'
            ELSE 'body'
          END AS association_type
        FROM current_body_tag tag
        JOIN body_observation observation ON observation.body_id = tag.body_id
        WHERE tag.state = 'accepted'
          AND cimmich_visibility_asset_rank(observation.asset_id) <= ${visibleRank}
        UNION ALL
        SELECT presence.person_id, presence.asset_id,
          CASE WHEN presence.reason_code = 'head_evidence' THEN 'head' ELSE 'presence' END AS association_type
        FROM current_presence_tag presence
        WHERE presence.state = 'accepted'
          AND cimmich_visibility_asset_rank(presence.asset_id) <= ${visibleRank}
        UNION ALL
        SELECT tag.subject_id, head.asset_id, 'head' AS association_type
        FROM current_manual_head_tag tag
        JOIN manual_head_observation head ON head.head_id = tag.head_id
        WHERE cimmich_visibility_asset_rank(head.asset_id) <= ${visibleRank}
      ), claim_counts AS (
        SELECT current.person_id,
          count(*) FILTER (WHERE current.state = 'accepted')::int AS accepted_faces,
          count(*) FILTER (
            WHERE current.state = 'candidate'
              AND coalesce(current.evidence_refs->>'assignment_decision', '') <> 'accepted_matched_digikam_sidecar_face'
              AND (
                coalesce(nullif(current.evidence_refs->>'best_score', '')::float8, current.calibrated_confidence::float8, -1)
                  >= ${samePhotoAcceptedCandidateFloor}
                OR accepted_photo.person_id IS NULL
              )
          )::int AS candidate_faces
        FROM identity_rows current
        LEFT JOIN accepted_photo_person accepted_photo
          ON accepted_photo.person_id = current.person_id
          AND accepted_photo.asset_id = current.asset_id
        WHERE current.face_state = 'valid'
        GROUP BY current.person_id
      ), asset_counts AS (
        SELECT person_id, count(DISTINCT asset_id)::int AS asset_count
        FROM accepted_asset_people
        GROUP BY person_id
      ), gallery_counts AS (
        SELECT person_id,
          count(*) FILTER (WHERE bucket_kind = 'prime' AND membership_state = 'active')::int AS prime_faces,
          count(*) FILTER (WHERE bucket_kind = 'secondary' AND membership_state = 'active')::int AS secondary_faces
        FROM gallery_rows
        GROUP BY person_id
      ), head_counts AS (
        SELECT person_id, count(DISTINCT asset_id)::int AS head_faces
        FROM accepted_asset_people
        WHERE association_type = 'head'
        GROUP BY person_id
      ), representative_candidates AS MATERIALIZED (
        SELECT gallery.person_id, fo.asset_id, fo.face_id,
          fo.box_x, fo.box_y, fo.box_w, fo.box_h, fo.quality_measurements,
          NULL::float8 AS match_score,
          CASE gallery.bucket_kind WHEN 'prime' THEN 0 WHEN 'secondary' THEN 1 ELSE 2 END AS display_priority
        FROM gallery_rows gallery
        JOIN face_observation fo ON fo.face_id = gallery.face_id
        WHERE gallery.membership_state = 'active'
        UNION ALL
        SELECT identity.person_id, identity.asset_id, identity.face_id,
          identity.box_x, identity.box_y, identity.box_w, identity.box_h,
          identity.quality_measurements, NULL::float8 AS match_score,
          3 AS display_priority
        FROM identity_rows identity
        WHERE identity.state = 'accepted' AND identity.face_state = 'valid'
        UNION ALL
        SELECT identity.person_id, identity.asset_id, identity.face_id,
          identity.box_x, identity.box_y, identity.box_w, identity.box_h,
          identity.quality_measurements,
          coalesce(nullif(identity.evidence_refs->>'best_score', '')::float8, identity.calibrated_confidence::float8) AS match_score,
          4 AS display_priority
        FROM identity_rows identity
        LEFT JOIN accepted_photo_person accepted_photo
          ON accepted_photo.person_id = identity.person_id
          AND accepted_photo.asset_id = identity.asset_id
        WHERE identity.state = 'candidate' AND identity.face_state = 'valid'
          AND coalesce(identity.evidence_refs->>'assignment_decision', '') <> 'accepted_matched_digikam_sidecar_face'
          AND (
            coalesce(nullif(identity.evidence_refs->>'best_score', '')::float8, identity.calibrated_confidence::float8, -1)
              >= ${samePhotoAcceptedCandidateFloor}
            OR accepted_photo.person_id IS NULL
          )
      ), representatives AS (
        SELECT DISTINCT ON (person_id)
          person_id, asset_id, face_id, box_x, box_y, box_w, box_h
        FROM representative_candidates
        ORDER BY person_id, display_priority,
          match_score DESC NULLS LAST,
          (quality_measurements->>'quality_score')::float8 DESC NULLS LAST,
          face_id
      ), body_representatives AS MATERIALIZED (
        SELECT DISTINCT ON (tag.person_id)
          tag.person_id, observation.asset_id, observation.body_id,
          observation.box_x, observation.box_y, observation.box_w, observation.box_h
        FROM current_body_tag tag
        JOIN body_observation observation ON observation.body_id = tag.body_id
        WHERE tag.state = 'accepted' AND observation.state = 'valid'
          AND cimmich_visibility_asset_rank(observation.asset_id) <= ${visibleRank}
        ORDER BY tag.person_id,
          (observation.quality_measurements->>'quality_score')::float8 DESC NULLS LAST,
          (observation.box_w * observation.box_h) DESC,
          observation.body_id
      )
      SELECT p.person_id, p.display_name, p.status, p.aliases, p.subject_kind,
        coalesce(cc.accepted_faces, 0)::int AS accepted_faces,
        coalesce(cc.candidate_faces, 0)::int AS candidate_faces,
        coalesce(ac.asset_count, 0)::int AS asset_count,
        coalesce(gc.prime_faces, 0)::int AS prime_faces,
        coalesce(gc.secondary_faces, 0)::int AS secondary_faces,
        coalesce(hc.head_faces, 0)::int AS head_faces,
        coalesce(category.categories, '[]'::jsonb) AS categories,
        coalesce(category.needs_sort, false) AS needs_sort,
        coalesce(category.needs_holding, false) AS needs_holding,
        representative.asset_id AS representative_asset_id,
        representative.face_id AS representative_face_id,
        representative.box_x::float8 AS box_x,
        representative.box_y::float8 AS box_y,
        representative.box_w::float8 AS box_w,
        representative.box_h::float8 AS box_h,
        representative_asset.width::int AS width,
        representative_asset.height::int AS height,
        body.asset_id AS body_preview_asset_id,
        body.body_id AS body_preview_body_id,
        body.box_x::float8 AS body_preview_box_x,
        body.box_y::float8 AS body_preview_box_y,
        body.box_w::float8 AS body_preview_box_w,
        body.box_h::float8 AS body_preview_box_h,
        body_asset.width::int AS body_preview_width,
        body_asset.height::int AS body_preview_height,
        presentation_body_asset.asset_id AS presentation_body_asset_id,
        presentation_body.crop AS presentation_body_crop,
        presentation_body.observation_id AS presentation_body_observation_id,
        presentation_body.observation_kind AS presentation_body_observation_kind,
        presentation_body.updated_at AS presentation_body_updated_at,
        presentation_body_asset.width::int AS presentation_body_width,
        presentation_body_asset.height::int AS presentation_body_height,
        presentation_face_asset.asset_id AS presentation_face_asset_id,
        presentation_face.crop AS presentation_face_crop,
        presentation_face.observation_id AS presentation_face_observation_id,
        presentation_face.observation_kind AS presentation_face_observation_kind,
        presentation_face.updated_at AS presentation_face_updated_at,
        presentation_face_asset.width::int AS presentation_face_width,
        presentation_face_asset.height::int AS presentation_face_height
      FROM current_person p
      LEFT JOIN claim_counts cc ON cc.person_id = p.person_id
      LEFT JOIN asset_counts ac ON ac.person_id = p.person_id
      LEFT JOIN gallery_counts gc ON gc.person_id = p.person_id
      LEFT JOIN head_counts hc ON hc.person_id = p.person_id
      LEFT JOIN person_categories category ON category.person_id = p.person_id
      LEFT JOIN representatives representative ON representative.person_id = p.person_id
      LEFT JOIN asset representative_asset ON representative_asset.asset_id = representative.asset_id
      LEFT JOIN body_representatives body ON body.person_id = p.person_id
      LEFT JOIN asset body_asset ON body_asset.asset_id = body.asset_id
      LEFT JOIN person_presentation_media presentation_body
        ON presentation_body.person_id = p.person_id
        AND presentation_body.slot_kind = 'body'
      LEFT JOIN asset presentation_body_asset
        ON presentation_body_asset.asset_id = presentation_body.asset_id
        AND presentation_body_asset.state = 'active'
        AND cimmich_visibility_asset_rank(presentation_body_asset.asset_id) <= ${visibleRank}
      LEFT JOIN person_presentation_media presentation_face
        ON presentation_face.person_id = p.person_id
        AND presentation_face.slot_kind = 'face'
      LEFT JOIN asset presentation_face_asset
        ON presentation_face_asset.asset_id = presentation_face.asset_id
        AND presentation_face_asset.state = 'active'
        AND cimmich_visibility_asset_rank(presentation_face_asset.asset_id) <= ${visibleRank}
      WHERE p.status = 'active'
        AND (p.subject_kind <> 'person'
          OR cimmich_visibility_person_rank(p.person_id) <= ${visibleRank})
        AND (
          (${exactPersonId} <> '' AND p.person_id = ${exactPersonId})
          OR (
            ${exactPersonId} = '' AND (
              coalesce(p.display_name, '') ILIKE ${nameQuery}
              OR EXISTS (SELECT 1 FROM unnest(p.aliases) alias WHERE alias ILIKE ${nameQuery})
            )
          )
        )
      ORDER BY coalesce(p.display_name, p.person_id), p.person_id
      LIMIT ${boundedLimit}
    `;

      return rows.map((row) => projectPersonPresentation(bridge, row));
    },

    async person({ personId }) {
      const id = String(personId || "");
      const visibleRank = presentationRank();
      const [row] = await sql`
      WITH target_person AS MATERIALIZED (
        SELECT person_id, display_name, status, aliases, subject_kind
        FROM current_person
        WHERE person_id = ${id} AND status = 'active'
          AND (subject_kind <> 'person'
            OR cimmich_visibility_person_rank(person_id) <= ${visibleRank})
      ), accepted_faces AS MATERIALIZED (
        SELECT identity.face_id, identity.person_id, face.asset_id, face.state,
          face.box_x, face.box_y, face.box_w, face.box_h,
          face.quality_measurements
        FROM current_face_identity identity
        JOIN target_person person ON person.person_id = identity.person_id
        JOIN face_observation face ON face.face_id = identity.face_id
        WHERE identity.state = 'accepted'
          AND cimmich_visibility_asset_rank(face.asset_id) <= ${visibleRank}
      ), person_buckets AS MATERIALIZED (
        SELECT bucket_id, person_id, bucket_kind, name AS bucket_name
        FROM reference_bucket
        WHERE person_id = ${id} AND state IN ('candidate', 'active')
      ), gallery_latest AS MATERIALIZED (
        SELECT DISTINCT ON (event.bucket_id, event.face_id)
          bucket.person_id, bucket.bucket_id, bucket.bucket_kind,
          bucket.bucket_name, event.face_id, event.action
        FROM person_buckets bucket
        JOIN bucket_membership_event event ON event.bucket_id = bucket.bucket_id
        ORDER BY event.bucket_id, event.face_id, event.created_at DESC,
          event.membership_event_id DESC
      ), active_gallery AS MATERIALIZED (
        SELECT * FROM gallery_latest
        WHERE action IN ('activate', 'pin', 'unpin')
      ), visible_gallery AS MATERIALIZED (
        SELECT gallery.*
        FROM active_gallery gallery
        JOIN face_observation face ON face.face_id = gallery.face_id
        WHERE cimmich_visibility_asset_rank(face.asset_id) <= ${visibleRank}
      ), accepted_assets AS MATERIALIZED (
        SELECT asset_id FROM accepted_faces
        UNION
        SELECT body.asset_id
        FROM current_body_tag tag
        JOIN body_observation body ON body.body_id = tag.body_id
        WHERE tag.person_id = ${id} AND tag.state = 'accepted'
          AND cimmich_visibility_asset_rank(body.asset_id) <= ${visibleRank}
        UNION
        SELECT tag.asset_id
        FROM current_presence_tag tag
        WHERE tag.person_id = ${id} AND tag.state = 'accepted'
          AND cimmich_visibility_asset_rank(tag.asset_id) <= ${visibleRank}
        UNION
        SELECT head.asset_id
        FROM current_manual_head_tag tag
        JOIN manual_head_observation head ON head.head_id = tag.head_id
        WHERE tag.subject_id = ${id}
          AND cimmich_visibility_asset_rank(head.asset_id) <= ${visibleRank}
      ), photo_history AS MATERIALIZED (
        SELECT
          min(asset.capture_time) FILTER (
            WHERE asset.capture_time IS NOT NULL AND asset.capture_time <= now()
          ) AS min_capture_time,
          max(asset.capture_time) FILTER (
            WHERE asset.capture_time IS NOT NULL AND asset.capture_time <= now()
          ) AS max_capture_time,
          count(*) FILTER (
            WHERE asset.capture_time IS NOT NULL AND asset.capture_time > now()
          )::int AS future_capture_date_count
        FROM accepted_assets confirmed
        JOIN asset ON asset.asset_id = confirmed.asset_id
          AND asset.state = 'active' AND asset.media_kind = 'image'
      ), head_assets AS MATERIALIZED (
        SELECT face.asset_id
        FROM accepted_faces face
        JOIN active_gallery gallery ON gallery.person_id = face.person_id
          AND gallery.face_id = face.face_id AND gallery.bucket_kind = 'head'
        UNION
        SELECT tag.asset_id
        FROM current_presence_tag tag
        WHERE tag.person_id = ${id} AND tag.state = 'accepted'
          AND tag.reason_code = 'head_evidence'
          AND cimmich_visibility_asset_rank(tag.asset_id) <= ${visibleRank}
        UNION
        SELECT head.asset_id
        FROM current_manual_head_tag tag
        JOIN manual_head_observation head ON head.head_id = tag.head_id
        WHERE tag.subject_id = ${id}
          AND cimmich_visibility_asset_rank(head.asset_id) <= ${visibleRank}
      ), person_categories AS MATERIALIZED (
        SELECT jsonb_agg(
          jsonb_build_object(
            'category_id', current.category_id,
            'slug', current.slug,
            'name', current.name,
            'category_kind', current.category_kind,
            'sort_order', current.sort_order
          ) ORDER BY current.sort_order, current.name
        ) AS categories,
        bool_or(current.slug = 'sort') AS needs_sort,
        bool_or(current.slug = 'holding') AS needs_holding
        FROM (
          SELECT DISTINCT ON (event.category_id)
            event.action, category.category_id, category.slug, category.name,
            category.category_kind, category.sort_order
          FROM person_category_membership_event event
          JOIN person_category category ON category.category_id = event.category_id
            AND category.state = 'active'
          WHERE event.person_id = ${id}
          ORDER BY event.category_id, event.created_at DESC,
            event.membership_event_id DESC
        ) current
        WHERE current.action = 'add'
      ), representative AS MATERIALIZED (
        SELECT face.asset_id, face.face_id, face.box_x, face.box_y,
          face.box_w, face.box_h
        FROM accepted_faces face
        LEFT JOIN active_gallery gallery ON gallery.person_id = face.person_id
          AND gallery.face_id = face.face_id
        WHERE face.state = 'valid'
        ORDER BY CASE gallery.bucket_kind WHEN 'prime' THEN 0 WHEN 'secondary' THEN 1 ELSE 2 END,
          (face.quality_measurements->>'quality_score')::float8 DESC NULLS LAST,
          face.face_id
        LIMIT 1
      ), body_representative AS MATERIALIZED (
        SELECT body.asset_id, body.body_id, body.box_x, body.box_y,
          body.box_w, body.box_h
        FROM current_body_tag tag
        JOIN body_observation body ON body.body_id = tag.body_id
        WHERE tag.person_id = ${id} AND tag.state = 'accepted'
          AND body.state = 'valid'
          AND cimmich_visibility_asset_rank(body.asset_id) <= ${visibleRank}
        ORDER BY (body.quality_measurements->>'quality_score')::float8 DESC NULLS LAST,
          (body.box_w * body.box_h) DESC,
          body.body_id
        LIMIT 1
      )
      SELECT p.person_id, p.display_name, p.status, p.aliases, p.subject_kind,
        coalesce((SELECT count(*) FROM accepted_faces), 0)::int AS accepted_faces,
        coalesce((
          SELECT count(*) FROM current_face_identity identity
          JOIN identity_claim claim ON claim.identity_claim_id = identity.identity_claim_id
          JOIN face_observation claim_face ON claim_face.face_id = claim.face_id AND claim_face.state = 'valid'
          WHERE identity.person_id = p.person_id AND identity.state = 'candidate'
            AND cimmich_visibility_asset_rank(claim_face.asset_id) <= ${visibleRank}
            AND coalesce(claim.evidence_refs->>'assignment_decision', '') <> 'accepted_matched_digikam_sidecar_face'
            AND (
              coalesce(nullif(claim.evidence_refs->>'best_score', '')::float8, claim.calibrated_confidence::float8, -1)
                >= ${samePhotoAcceptedCandidateFloor}
              OR NOT EXISTS (
                SELECT 1
                FROM identity_claim same_photo_claim
                JOIN face_observation same_photo_face
                  ON same_photo_face.face_id = same_photo_claim.face_id
                  AND same_photo_face.state = 'valid'
                WHERE same_photo_claim.person_id = claim.person_id
                  AND same_photo_claim.state = 'accepted'
                  AND same_photo_face.asset_id = claim_face.asset_id
                  AND same_photo_face.face_id <> claim_face.face_id
              )
            )
        ), 0)::int AS candidate_faces,
        coalesce((SELECT count(*) FROM accepted_assets), 0)::int AS asset_count,
        coalesce((SELECT count(*) FROM visible_gallery WHERE bucket_kind = 'prime'), 0)::int AS prime_faces,
        coalesce((SELECT count(*) FROM visible_gallery WHERE bucket_kind = 'secondary'), 0)::int AS secondary_faces,
        coalesce((SELECT count(*) FROM head_assets), 0)::int AS head_faces,
        jsonb_build_object(
          'schemaVersion', 'cimmich.person-photo-history.v1',
          'minCaptureTime', photo.min_capture_time,
          'maxCaptureTime', photo.max_capture_time,
          'futureCaptureDateCount', coalesce(photo.future_capture_date_count, 0)
        ) AS photo_history,
        coalesce(category.categories, '[]'::jsonb) AS categories,
        coalesce(category.needs_sort, false) AS needs_sort,
        coalesce(category.needs_holding, false) AS needs_holding,
        representative.asset_id AS representative_asset_id,
        representative.face_id AS representative_face_id,
        representative.box_x::float8 AS box_x,
        representative.box_y::float8 AS box_y,
        representative.box_w::float8 AS box_w,
        representative.box_h::float8 AS box_h,
        representative_asset.width::int AS width,
        representative_asset.height::int AS height,
        body.asset_id AS body_preview_asset_id,
        body.body_id AS body_preview_body_id,
        body.box_x::float8 AS body_preview_box_x,
        body.box_y::float8 AS body_preview_box_y,
        body.box_w::float8 AS body_preview_box_w,
        body.box_h::float8 AS body_preview_box_h,
        body_asset.width::int AS body_preview_width,
        body_asset.height::int AS body_preview_height,
        presentation_body_asset.asset_id AS presentation_body_asset_id,
        presentation_body.crop AS presentation_body_crop,
        presentation_body.observation_id AS presentation_body_observation_id,
        presentation_body.observation_kind AS presentation_body_observation_kind,
        presentation_body.updated_at AS presentation_body_updated_at,
        presentation_body_asset.width::int AS presentation_body_width,
        presentation_body_asset.height::int AS presentation_body_height,
        presentation_face_asset.asset_id AS presentation_face_asset_id,
        presentation_face.crop AS presentation_face_crop,
        presentation_face.observation_id AS presentation_face_observation_id,
        presentation_face.observation_kind AS presentation_face_observation_kind,
        presentation_face.updated_at AS presentation_face_updated_at,
        presentation_face_asset.width::int AS presentation_face_width,
        presentation_face_asset.height::int AS presentation_face_height
      FROM target_person p
      CROSS JOIN person_categories category
      CROSS JOIN photo_history photo
      LEFT JOIN representative ON true
      LEFT JOIN asset representative_asset ON representative_asset.asset_id = representative.asset_id
      LEFT JOIN body_representative body ON true
      LEFT JOIN asset body_asset ON body_asset.asset_id = body.asset_id
      LEFT JOIN person_presentation_media presentation_body
        ON presentation_body.person_id = p.person_id
        AND presentation_body.slot_kind = 'body'
      LEFT JOIN asset presentation_body_asset
        ON presentation_body_asset.asset_id = presentation_body.asset_id
        AND presentation_body_asset.state = 'active'
        AND cimmich_visibility_asset_rank(presentation_body_asset.asset_id) <= ${visibleRank}
      LEFT JOIN person_presentation_media presentation_face
        ON presentation_face.person_id = p.person_id
        AND presentation_face.slot_kind = 'face'
      LEFT JOIN asset presentation_face_asset
        ON presentation_face_asset.asset_id = presentation_face.asset_id
        AND presentation_face_asset.state = 'active'
        AND cimmich_visibility_asset_rank(presentation_face_asset.asset_id) <= ${visibleRank}
    `;
      if (!row) {
        throw Object.assign(new Error("Cimmich identity not found"), {
          statusCode: 404,
        });
      }
      return projectPersonPresentation(bridge, row);
    },

    async personSetup({ personId }) {
      await requireVisibleSubject(personId);
      const [person] = await sql`
      SELECT person_id, display_name, status, aliases, subject_kind, current_revision
      FROM current_person
      WHERE person_id = ${String(personId || "")}
      LIMIT 1
    `;
      if (!person)
        throw Object.assign(new Error("Cimmich identity not found"), {
          statusCode: 404,
        });
      const aliases = await sql`
      SELECT alias_id, label, alias_kind, source_system, source_subject_id, created_at
      FROM person_alias
      WHERE person_id = ${person.person_id} AND state = 'active'
      ORDER BY created_at, alias_id
    `;
      const merges = await sql`
      SELECT operation.merge_operation_id, operation.source_person_id,
        source.display_name AS source_display_name, operation.created_at
      FROM person_merge_operation operation
      JOIN person source ON source.person_id = operation.source_person_id
      WHERE operation.target_person_id = ${person.person_id} AND operation.state = 'active'
      ORDER BY operation.created_at DESC, operation.merge_operation_id DESC
    `;
      const categories = await sql`
      SELECT category_id, slug, name, category_kind, sort_order
      FROM current_person_category
      WHERE person_id = ${person.person_id}
      ORDER BY sort_order, name
    `;
      const categoryCatalog = await sql`
      SELECT category_id, slug, name, category_kind, sort_order
      FROM person_category
      WHERE state = 'active'
      ORDER BY sort_order, name
    `;
      return {
        ...person,
        alias_items: aliases,
        categories,
        category_catalog: categoryCatalog,
        merges,
      };
    },

    async setPersonCategory({ actorId, categoryId, personId, selected }) {
      await requireVisibleSubject(personId);
      const actor = cleanActor(actorId);
      if (!actor)
        throw Object.assign(new Error("Missing Cimmich actor"), {
          statusCode: 400,
        });
      const result = await sql.begin(async (tx) => {
        const [person] = await tx`
        SELECT person_id, subject_kind FROM person
        WHERE person_id = ${String(personId || "")} AND status = 'active'
        FOR UPDATE
      `;
        if (!person)
          throw Object.assign(new Error("Active Cimmich identity not found"), {
            statusCode: 404,
          });
        const [category] = await tx`
        SELECT category_id, slug, name, category_kind, sort_order
        FROM person_category
        WHERE category_id = ${String(categoryId || "")} AND state = 'active'
      `;
        if (!category)
          throw Object.assign(new Error("Active Person category not found"), {
            statusCode: 404,
          });
        if (category.slug === "holding" && person.subject_kind !== "person") {
          throw Object.assign(
            new Error("Only a human identity can be placed in Holding"),
            {
              statusCode: 409,
            },
          );
        }
        const [current] = await tx`
        SELECT category_id FROM current_person_category
        WHERE person_id = ${person.person_id} AND category_id = ${category.category_id}
      `;
        const shouldSelect = selected === true;
        if (category.slug === "sort" && !shouldSelect) {
          const [holding] = await tx`
          SELECT category_id FROM current_person_category
          WHERE person_id = ${person.person_id} AND slug = 'holding'
          LIMIT 1
        `;
          if (holding) {
            throw Object.assign(
              new Error("Remove Holding before removing Sort"),
              {
                statusCode: 409,
              },
            );
          }
        }
        if (Boolean(current) === shouldSelect) {
          return {
            category,
            changed: false,
            personId: person.person_id,
            selected: shouldSelect,
          };
        }
        await ensureUserCommandReceipt(tx);
        const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
        const membershipEventId = `categoryevent_${randomUUID().replaceAll("-", "")}`;
        await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'person_category', ${membershipEventId}, ${shouldSelect ? "pin" : "demote"},
          'user', ${actor}, ${
            category.slug === "holding"
              ? "identity_holding_workflow"
              : category.slug === "sort"
                ? "identity_sort_trust"
                : "identity_relationship_category"
          },
          ${`${shouldSelect ? "Add" : "Remove"} ${category.name} category`},
          ${userCommandReceiptId}, 'private'
        )
      `;
        await tx`
        INSERT INTO person_category_membership_event (
          membership_event_id, person_id, category_id, action, actor_kind, actor_id,
          decision_id, producer_receipt_id, privacy_class
        ) VALUES (
          ${membershipEventId}, ${person.person_id}, ${category.category_id},
          ${shouldSelect ? "add" : "remove"}, 'user', ${actor}, ${decisionId},
          ${userCommandReceiptId}, 'private'
        )
      `;
        await tx`UPDATE person SET current_revision = current_revision + 1 WHERE person_id = ${person.person_id}`;
        return {
          category,
          changed: true,
          decisionId,
          personId: person.person_id,
          selected: shouldSelect,
        };
      });
      const maintenancePending =
        result.changed && result.category.slug === "holding" && !result.selected
          ? await refreshPrimeAfterCommand(sql, result.personId)
          : false;
      return { ...result, maintenancePending };
    },

    async addPersonAlias({
      actorId,
      aliasKind,
      label,
      personId,
      sourceSubjectId = "",
      sourceSystem = "",
    }) {
      const actor = cleanActor(actorId);
      if (!actor)
        throw Object.assign(new Error("Missing Cimmich actor"), {
          statusCode: 400,
        });
      const cleanLabel = cleanPersonName(label);
      const kind = cleanAliasKind(aliasKind);
      return sql.begin(async (tx) => {
        const [person] = await tx`
        SELECT person_id, display_name FROM person
        WHERE person_id = ${String(personId || "")} AND status = 'active'
        FOR UPDATE
      `;
        if (!person)
          throw Object.assign(new Error("Active Cimmich identity not found"), {
            statusCode: 404,
          });
        const [existing] = await tx`
        SELECT alias_id, label, alias_kind
        FROM person_alias
        WHERE person_id = ${person.person_id} AND state = 'active' AND lower(label) = lower(${cleanLabel})
        LIMIT 1
      `;
        if (
          existing ||
          String(person.display_name || "").toLowerCase() ===
            cleanLabel.toLowerCase()
        ) {
          return {
            alias: existing || null,
            changed: false,
            personId: person.person_id,
          };
        }
        await ensureUserCommandReceipt(tx);
        const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
        const aliasId = `alias_${randomUUID().replaceAll("-", "")}`;
        await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'person_alias', ${aliasId}, 'rename', 'user', ${actor},
          'identity_setup_alias_add', ${`Add ${kind} alias ${cleanLabel}`},
          ${userCommandReceiptId}, 'private'
        )
      `;
        const [alias] = await tx`
        INSERT INTO person_alias (
          alias_id, person_id, label, alias_kind, state, source_system,
          source_subject_id, producer_receipt_id, privacy_class
        ) VALUES (
          ${aliasId}, ${person.person_id}, ${cleanLabel}, ${kind}, 'active',
          ${String(sourceSystem || "").trim() || null}, ${String(sourceSubjectId || "").trim() || null},
          ${userCommandReceiptId}, 'private'
        )
        RETURNING alias_id, label, alias_kind, source_system, source_subject_id, created_at
      `;
        await tx`UPDATE person SET current_revision = current_revision + 1 WHERE person_id = ${person.person_id}`;
        return { alias, changed: true, decisionId, personId: person.person_id };
      });
    },

    async removePersonAlias({ actorId, aliasId, personId }) {
      const actor = cleanActor(actorId);
      if (!actor)
        throw Object.assign(new Error("Missing Cimmich actor"), {
          statusCode: 400,
        });
      return sql.begin(async (tx) => {
        const [alias] = await tx`
        SELECT alias_id, label FROM person_alias
        WHERE alias_id = ${String(aliasId || "")} AND person_id = ${String(personId || "")} AND state = 'active'
        FOR UPDATE
      `;
        if (!alias) return { aliasId, changed: false, personId };
        const [person] =
          await tx`SELECT person_id FROM person WHERE person_id = ${personId} AND status = 'active' FOR UPDATE`;
        if (!person)
          throw Object.assign(new Error("Active Cimmich identity not found"), {
            statusCode: 404,
          });
        await ensureUserCommandReceipt(tx);
        const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
        await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'person_alias', ${alias.alias_id}, 'rename', 'user', ${actor},
          'identity_setup_alias_remove', ${`Remove alias ${alias.label}`},
          ${userCommandReceiptId}, 'private'
        )
      `;
        await tx`UPDATE person_alias SET state = 'removed' WHERE alias_id = ${alias.alias_id}`;
        await tx`UPDATE person SET current_revision = current_revision + 1 WHERE person_id = ${person.person_id}`;
        return {
          aliasId: alias.alias_id,
          changed: true,
          decisionId,
          personId: person.person_id,
        };
      });
    },

    async setPersonSubjectKind({ actorId, personId, subjectKind }) {
      const actor = cleanActor(actorId);
      if (!actor)
        throw Object.assign(new Error("Missing Cimmich actor"), {
          statusCode: 400,
        });
      const kind = cleanSubjectKind(subjectKind);
      const result = await sql.begin(async (tx) => {
        const [person] = await tx`
        SELECT person_id, subject_kind FROM person
        WHERE person_id = ${String(personId || "")} AND status = 'active'
        FOR UPDATE
      `;
        if (!person)
          throw Object.assign(new Error("Active Cimmich identity not found"), {
            statusCode: 404,
          });
        if (person.subject_kind === kind)
          return {
            changed: false,
            personId: person.person_id,
            subjectKind: kind,
          };
        await ensureUserCommandReceipt(tx);
        const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
        await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'identity_subject', ${person.person_id}, 'classify', 'user', ${actor},
          'identity_setup_subject_kind', ${`Mark identity as ${kind}`},
          ${userCommandReceiptId}, 'private'
        )
      `;
        await tx`
        UPDATE person SET subject_kind = ${kind}, current_revision = current_revision + 1
        WHERE person_id = ${person.person_id}
      `;
        if (kind === "pet") {
          await tx`UPDATE reference_bucket SET state = 'retired' WHERE person_id = ${person.person_id} AND state IN ('active','candidate')`;
          await tx`UPDATE reference_prototype SET state = 'retired' WHERE person_id = ${person.person_id} AND state = 'active'`;
        } else {
          await tx`UPDATE reference_bucket SET state = 'active' WHERE person_id = ${person.person_id} AND state = 'retired'`;
        }
        await tx`SELECT enqueue_source_pack_rebuild(${person.person_id}, 'subject_kind_changed', 'person', ${person.person_id})`;
        return {
          changed: true,
          decisionId,
          personId: person.person_id,
          subjectKind: kind,
        };
      });
      const maintenancePending =
        result.changed && result.subjectKind === "person"
          ? await refreshPrimeAfterCommand(sql, result.personId)
          : false;
      return { ...result, maintenancePending };
    },

    async previewPersonMerge({ sourcePersonId, targetPersonId }) {
      if (
        !sourcePersonId ||
        !targetPersonId ||
        sourcePersonId === targetPersonId
      ) {
        throw Object.assign(new Error("Choose two different identities"), {
          statusCode: 400,
        });
      }
      const people = await sql`
      SELECT p.person_id, p.display_name, p.subject_kind, p.status,
        (SELECT count(*)::int FROM person_alias pa WHERE pa.person_id = p.person_id AND pa.state = 'active') AS aliases,
        (SELECT count(*)::int FROM current_face_identity cfi WHERE cfi.person_id = p.person_id AND cfi.state = 'accepted') AS accepted_faces,
        (SELECT count(DISTINCT asset_id)::int FROM person_assets assets WHERE assets.person_id = p.person_id AND assets.authority_state = 'accepted') AS assets
      FROM person p
      WHERE p.person_id IN (${sourcePersonId}, ${targetPersonId})
      ORDER BY p.person_id
    `;
      const source = people.find(
        (person) => person.person_id === sourcePersonId,
      );
      const target = people.find(
        (person) => person.person_id === targetPersonId,
      );
      if (
        !source ||
        !target ||
        source.status !== "active" ||
        target.status !== "active"
      ) {
        throw Object.assign(new Error("Both identities must be active"), {
          statusCode: 409,
        });
      }
      if (source.subject_kind !== target.subject_kind) {
        throw Object.assign(
          new Error("People and pets cannot be merged together"),
          { statusCode: 409 },
        );
      }
      const [conflicts] = await sql`
      SELECT
        (SELECT count(DISTINCT left_assets.asset_id)::int
         FROM person_assets left_assets
         JOIN person_assets right_assets ON right_assets.asset_id = left_assets.asset_id
         WHERE left_assets.person_id = ${sourcePersonId} AND right_assets.person_id = ${targetPersonId}
           AND left_assets.authority_state = 'accepted' AND right_assets.authority_state = 'accepted') AS shared_assets,
        (SELECT count(*)::int
         FROM current_presence_tag source_presence
         JOIN current_presence_tag target_presence ON target_presence.asset_id = source_presence.asset_id
         WHERE source_presence.person_id = ${sourcePersonId} AND target_presence.person_id = ${targetPersonId}
           AND source_presence.state = 'accepted' AND target_presence.state = 'accepted') AS duplicate_presence
    `;
      return { conflicts, source, target };
    },

    async mergePeople({ actorId, commandId, sourcePersonId, targetPersonId }) {
      const actor = cleanActor(actorId);
      if (!actor)
        throw Object.assign(new Error("Missing Cimmich actor"), {
          statusCode: 400,
        });
      const sourceId = String(sourcePersonId || "").trim();
      const targetId = String(targetPersonId || "").trim();
      if (!sourceId || !targetId || sourceId === targetId) {
        throw typedError(
          "Choose two different identities",
          400,
          "PERSON_MERGE_SELECTION_INVALID",
        );
      }
      const result = await sql.begin(async (tx) => {
        const command = await beginMergeCommand(tx, {
          actorId: actor,
          commandId,
          commandKind: "merge",
          payload: { sourcePersonId: sourceId, targetPersonId: targetId },
        });
        if (command.replay) return command.replay;
        const [source] = await tx`
          SELECT * FROM person WHERE person_id = ${sourceId}
            AND cimmich_visibility_subject_rank(subject_kind, person_id)
              <= ${presentationRank()}
          FOR UPDATE
        `;
        const [target] = await tx`
          SELECT * FROM person WHERE person_id = ${targetId}
            AND cimmich_visibility_subject_rank(subject_kind, person_id)
              <= ${presentationRank()}
          FOR UPDATE
        `;
        if (
          !source ||
          !target ||
          source.status !== "active" ||
          target.status !== "active"
        ) {
          throw Object.assign(
            new Error("Both identities must still be active"),
            {
              statusCode: 409,
            },
          );
        }
        if (source.subject_kind !== target.subject_kind) {
          throw Object.assign(
            new Error("People and pets cannot be merged together"),
            { statusCode: 409 },
          );
        }
        await ensureUserCommandReceipt(tx);
        const identityClaims =
          await tx`SELECT identity_claim_id FROM identity_claim WHERE person_id = ${source.person_id} ORDER BY identity_claim_id`;
        const bodyTags =
          await tx`SELECT body_tag_id FROM body_tag WHERE person_id = ${source.person_id} ORDER BY body_tag_id`;
        const presenceTags =
          await tx`SELECT presence_tag_id, state FROM presence_tag WHERE person_id = ${source.person_id} ORDER BY presence_tag_id`;
        const clusters =
          await tx`SELECT cluster_id FROM face_cluster WHERE linked_person_id = ${source.person_id} ORDER BY cluster_id`;
        const buckets =
          await tx`SELECT bucket_id, state FROM reference_bucket WHERE person_id = ${source.person_id} ORDER BY bucket_id`;
        const documentLinks = await tx`
          SELECT source_link.link_id, source_link.document_id,
            source_link.relation_kind, source_link.state,
            target_link.link_id AS duplicate_target_link_id
          FROM cimmich_document_link source_link
          LEFT JOIN cimmich_document_link target_link
            ON target_link.document_id = source_link.document_id
            AND target_link.subject_kind = source_link.subject_kind
            AND target_link.subject_id = ${target.person_id}
            AND target_link.relation_kind = source_link.relation_kind
            AND target_link.state = 'current'
          WHERE source_link.subject_kind = ${source.subject_kind}
            AND source_link.subject_id = ${source.person_id}
            AND source_link.state = 'current'
          ORDER BY source_link.link_id
          FOR UPDATE OF source_link
        `;
        const legacyPetDocuments =
          source.subject_kind === "pet"
            ? await tx`
              SELECT source_link.link_id, source_link.asset_id,
                source_link.state,
                target_link.link_id AS duplicate_target_link_id
              FROM pet_document_link source_link
              LEFT JOIN pet_document_link target_link
                ON target_link.asset_id = source_link.asset_id
                AND target_link.pet_id = ${target.person_id}
                AND target_link.state IN ('accepted','rejected')
              WHERE source_link.pet_id = ${source.person_id}
                AND source_link.state IN ('accepted','rejected')
              ORDER BY source_link.link_id
              FOR UPDATE OF source_link
            `
            : [];
        const sourceCategories = await tx`
        SELECT category_id FROM current_person_category WHERE person_id = ${source.person_id} ORDER BY category_id
      `;
        const targetCategoryIds = new Set(
          (
            await tx`SELECT category_id FROM current_person_category WHERE person_id = ${target.person_id}`
          ).map((row) => row.category_id),
        );
        const duplicatePresence = await tx`
        SELECT source_presence.presence_tag_id, source_presence.state
        FROM presence_tag source_presence
        JOIN presence_tag target_presence ON target_presence.asset_id = source_presence.asset_id
        WHERE source_presence.person_id = ${source.person_id} AND target_presence.person_id = ${target.person_id}
          AND source_presence.state = 'accepted' AND target_presence.state = 'accepted'
        FOR UPDATE OF source_presence
      `;
        if (duplicatePresence.length > 0) {
          await tx`
          UPDATE presence_tag SET state = 'superseded'
          WHERE presence_tag_id = ANY(${duplicatePresence.map((row) => row.presence_tag_id)})
        `;
        }
        if (identityClaims.length > 0)
          await tx`UPDATE identity_claim SET person_id = ${target.person_id} WHERE person_id = ${source.person_id}`;
        if (bodyTags.length > 0)
          await tx`UPDATE body_tag SET person_id = ${target.person_id} WHERE person_id = ${source.person_id}`;
        if (presenceTags.length > 0)
          await tx`UPDATE presence_tag SET person_id = ${target.person_id} WHERE person_id = ${source.person_id}`;
        if (clusters.length > 0)
          await tx`UPDATE face_cluster SET linked_person_id = ${target.person_id} WHERE linked_person_id = ${source.person_id}`;
        for (const link of documentLinks) {
          if (link.duplicate_target_link_id) {
            await tx`
              UPDATE cimmich_document_link SET state = 'superseded'
              WHERE link_id = ${link.link_id}
            `;
          } else {
            await tx`
              UPDATE cimmich_document_link SET subject_id = ${target.person_id}
              WHERE link_id = ${link.link_id}
            `;
          }
        }
        for (const link of legacyPetDocuments) {
          if (link.duplicate_target_link_id) {
            await tx`
              UPDATE pet_document_link SET state = 'superseded'
              WHERE link_id = ${link.link_id}
            `;
          } else {
            await tx`
              UPDATE pet_document_link SET pet_id = ${target.person_id}
              WHERE link_id = ${link.link_id}
            `;
          }
        }
        await tx`UPDATE reference_bucket SET state = 'retired' WHERE person_id = ${source.person_id} AND state <> 'retired'`;
        await tx`UPDATE reference_prototype SET state = 'retired' WHERE person_id = ${source.person_id} AND state = 'active'`;

        const existingLabels = new Set(
          (
            await tx`
          SELECT lower(label) AS label FROM person_alias WHERE person_id = ${target.person_id} AND state = 'active'
        `
          ).map((row) => row.label),
        );
        existingLabels.add(String(target.display_name || "").toLowerCase());
        const sourceLabels = [
          ...(source.display_name
            ? [{ label: source.display_name, alias_kind: "former_name" }]
            : []),
          ...(await tx`SELECT label, alias_kind FROM person_alias WHERE person_id = ${source.person_id} AND state = 'active' ORDER BY created_at`),
        ];
        const createdAliasIds = [];
        for (const sourceLabel of sourceLabels) {
          const normalized = String(sourceLabel.label || "").toLowerCase();
          if (!normalized || existingLabels.has(normalized)) continue;
          existingLabels.add(normalized);
          const aliasId = `alias_${randomUUID().replaceAll("-", "")}`;
          createdAliasIds.push(aliasId);
          await tx`
          INSERT INTO person_alias (
            alias_id, person_id, label, alias_kind, state, source_system,
            source_subject_id, producer_receipt_id, privacy_class
          ) VALUES (
            ${aliasId}, ${target.person_id}, ${sourceLabel.label}, ${sourceLabel.alias_kind === "display" ? "former_name" : sourceLabel.alias_kind},
            'active', 'cimmich-merge', ${source.person_id}, ${userCommandReceiptId}, 'private'
          )
        `;
        }
        const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
        await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'person_merge', ${`${source.person_id}:${target.person_id}`}, 'merge', 'user', ${actor},
          'identity_setup_merge', ${`Merge ${source.display_name || source.person_id} into ${target.display_name || target.person_id}`},
          ${userCommandReceiptId}, 'private'
        )
      `;
        const transferredCategories = [];
        for (const category of sourceCategories) {
          if (targetCategoryIds.has(category.category_id)) continue;
          const membershipEventId = `categoryevent_${randomUUID().replaceAll("-", "")}`;
          transferredCategories.push({
            categoryId: category.category_id,
            membershipEventId,
          });
          await tx`
          INSERT INTO person_category_membership_event (
            membership_event_id, person_id, category_id, action, actor_kind, actor_id,
            decision_id, producer_receipt_id, privacy_class
          ) VALUES (
            ${membershipEventId}, ${target.person_id}, ${category.category_id}, 'add', 'user', ${actor},
            ${decisionId}, ${userCommandReceiptId}, 'private'
          )
        `;
        }
        const mergeOperationId = `merge_${randomUUID().replaceAll("-", "")}`;
        const snapshot = {
          bodyTagIds: bodyTags.map((row) => row.body_tag_id),
          bucketStates: buckets.map((row) => ({
            bucketId: row.bucket_id,
            state: row.state,
          })),
          clusterIds: clusters.map((row) => row.cluster_id),
          createdAliasIds,
          duplicatePresenceStates: duplicatePresence.map((row) => ({
            presenceTagId: row.presence_tag_id,
            state: row.state,
          })),
          identityClaimIds: identityClaims.map((row) => row.identity_claim_id),
          documentLinks: documentLinks.map((row) => ({
            duplicateTargetLinkId: row.duplicate_target_link_id,
            linkId: row.link_id,
            state: row.state,
          })),
          legacyPetDocumentLinks: legacyPetDocuments.map((row) => ({
            duplicateTargetLinkId: row.duplicate_target_link_id,
            linkId: row.link_id,
            state: row.state,
          })),
          presenceTagIds: presenceTags.map((row) => row.presence_tag_id),
          transferredCategories,
        };
        await tx`
        INSERT INTO person_merge_operation (
          merge_operation_id, source_person_id, target_person_id, state, snapshot,
          merge_decision_id, producer_receipt_id, privacy_class
        ) VALUES (
          ${mergeOperationId}, ${source.person_id}, ${target.person_id}, 'active', ${tx.json(snapshot)},
          ${decisionId}, ${userCommandReceiptId}, 'private'
        )
      `;
        await tx`
        UPDATE person SET status = 'merged', merged_into_person_id = ${target.person_id}, current_revision = current_revision + 1
        WHERE person_id = ${source.person_id}
      `;
        await tx`UPDATE person SET current_revision = current_revision + 1 WHERE person_id = ${target.person_id}`;
        await tx`SELECT enqueue_source_pack_rebuild(${source.person_id}, 'person_merged', 'person_merge', ${mergeOperationId})`;
        await tx`SELECT enqueue_source_pack_rebuild(${target.person_id}, 'person_merged', 'person_merge', ${mergeOperationId})`;
        const response = {
          changed: true,
          commandId: command.commandId,
          mergeOperationId,
          replayed: false,
          schemaVersion: "cimmich.person-merge.v2",
          sourcePersonId: source.person_id,
          targetPersonId: target.person_id,
        };
        return completeMergeCommand(tx, {
          commandId: command.commandId,
          mergeOperationId,
          response,
        });
      });
      if (!result.replayed) await refreshPrimeAfterCommand(sql, targetId);
      invalidateMachineSuggestions();
      return result;
    },

    async unmergePeople({ actorId, commandId, mergeOperationId }) {
      const actor = cleanActor(actorId);
      if (!actor)
        throw Object.assign(new Error("Missing Cimmich actor"), {
          statusCode: 400,
        });
      const result = await sql.begin(async (tx) => {
        const operationId = String(mergeOperationId || "").trim();
        const command = await beginMergeCommand(tx, {
          actorId: actor,
          commandId,
          commandKind: "unmerge",
          payload: { mergeOperationId: operationId },
        });
        if (command.replay) return command.replay;
        const [operation] = await tx`
        SELECT * FROM person_merge_operation
        WHERE merge_operation_id = ${operationId}
        FOR UPDATE
      `;
        if (!operation)
          throw Object.assign(new Error("Merge operation not found"), {
            statusCode: 404,
          });
        if (operation.state !== "active") {
          throw typedError(
            "Merge operation was already reverted",
            409,
            "PERSON_MERGE_ALREADY_REVERTED",
          );
        }
        const [source] =
          await tx`SELECT * FROM person WHERE person_id = ${operation.source_person_id} FOR UPDATE`;
        const [target] =
          await tx`SELECT * FROM person WHERE person_id = ${operation.target_person_id} FOR UPDATE`;
        if (
          !source ||
          !target ||
          source.status !== "merged" ||
          source.merged_into_person_id !== target.person_id
        ) {
          throw Object.assign(
            new Error(
              "Merge projection has changed and cannot be undone automatically",
            ),
            { statusCode: 409 },
          );
        }
        const snapshot = operation.snapshot || {};
        await ensureUserCommandReceipt(tx);
        // Restore the source projection before moving guarded manual evidence
        // back to it. Manual Presence and Document triggers intentionally reject
        // associations to a merged subject.
        await tx`
          UPDATE person SET status = 'active', merged_into_person_id = NULL,
            current_revision = current_revision + 1
          WHERE person_id = ${source.person_id}
        `;
        if (snapshot.identityClaimIds?.length) {
          await tx`UPDATE identity_claim SET person_id = ${source.person_id} WHERE identity_claim_id = ANY(${snapshot.identityClaimIds})`;
        }
        if (snapshot.bodyTagIds?.length) {
          await tx`UPDATE body_tag SET person_id = ${source.person_id} WHERE body_tag_id = ANY(${snapshot.bodyTagIds})`;
        }
        if (snapshot.presenceTagIds?.length) {
          await tx`UPDATE presence_tag SET person_id = ${source.person_id} WHERE presence_tag_id = ANY(${snapshot.presenceTagIds})`;
        }
        if (snapshot.clusterIds?.length) {
          await tx`UPDATE face_cluster SET linked_person_id = ${source.person_id} WHERE cluster_id = ANY(${snapshot.clusterIds})`;
        }
        for (const row of snapshot.documentLinks || []) {
          if (row.duplicateTargetLinkId) {
            await tx`
              UPDATE cimmich_document_link SET state = ${row.state}
              WHERE link_id = ${row.linkId}
            `;
          } else {
            await tx`
              UPDATE cimmich_document_link SET subject_id = ${source.person_id}
              WHERE link_id = ${row.linkId}
            `;
          }
        }
        for (const row of snapshot.legacyPetDocumentLinks || []) {
          if (row.duplicateTargetLinkId) {
            await tx`
              UPDATE pet_document_link SET state = ${row.state}
              WHERE link_id = ${row.linkId}
            `;
          } else {
            await tx`
              UPDATE pet_document_link SET pet_id = ${source.person_id}
              WHERE link_id = ${row.linkId}
            `;
          }
        }
        for (const row of snapshot.duplicatePresenceStates || []) {
          await tx`UPDATE presence_tag SET state = ${row.state} WHERE presence_tag_id = ${row.presenceTagId}`;
        }
        for (const row of snapshot.bucketStates || []) {
          await tx`UPDATE reference_bucket SET state = ${row.state} WHERE bucket_id = ${row.bucketId}`;
        }
        if (snapshot.createdAliasIds?.length) {
          await tx`UPDATE person_alias SET state = 'removed' WHERE alias_id = ANY(${snapshot.createdAliasIds})`;
        }
        const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
        await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'person_merge', ${operation.merge_operation_id}, 'split', 'user', ${actor},
          'identity_setup_unmerge', ${`Undo merge into ${target.display_name || target.person_id}`},
          ${userCommandReceiptId}, 'private'
        )
      `;
        for (const row of snapshot.transferredCategories || []) {
          const [latest] = await tx`
          SELECT membership_event_id, action
          FROM person_category_membership_event
          WHERE person_id = ${target.person_id} AND category_id = ${row.categoryId}
          ORDER BY created_at DESC, membership_event_id DESC
          LIMIT 1
        `;
          if (
            !latest ||
            latest.membership_event_id !== row.membershipEventId ||
            latest.action !== "add"
          )
            continue;
          await tx`
          INSERT INTO person_category_membership_event (
            membership_event_id, person_id, category_id, action, actor_kind, actor_id,
            decision_id, producer_receipt_id, privacy_class
          ) VALUES (
            ${`categoryevent_${randomUUID().replaceAll("-", "")}`}, ${target.person_id}, ${row.categoryId},
            'remove', 'user', ${actor}, ${decisionId}, ${userCommandReceiptId}, 'private'
          )
        `;
        }
        await tx`UPDATE person SET current_revision = current_revision + 1 WHERE person_id = ${target.person_id}`;
        await tx`
        UPDATE person_merge_operation
        SET state = 'reverted', unmerge_decision_id = ${decisionId}, reverted_at = now()
        WHERE merge_operation_id = ${operation.merge_operation_id}
      `;
        await tx`SELECT enqueue_source_pack_rebuild(${source.person_id}, 'person_unmerged', 'person_merge', ${operation.merge_operation_id})`;
        await tx`SELECT enqueue_source_pack_rebuild(${target.person_id}, 'person_unmerged', 'person_merge', ${operation.merge_operation_id})`;
        const response = {
          changed: true,
          commandId: command.commandId,
          mergeOperationId: operation.merge_operation_id,
          replayed: false,
          schemaVersion: "cimmich.person-merge.v2",
          sourcePersonId: source.person_id,
          targetPersonId: target.person_id,
        };
        return completeMergeCommand(tx, {
          commandId: command.commandId,
          mergeOperationId: operation.merge_operation_id,
          response,
        });
      });
      if (!result.replayed) {
        await refreshPrimeForPeople(sql, [
          result.sourcePersonId,
          result.targetPersonId,
        ]);
      }
      invalidateMachineSuggestions();
      return result;
    },

    async identityCandidates({ limit = 5, personId = "" } = {}) {
      if (personId) await requireVisibleSubject(personId);
      const boundedLimit = cleanLimit(limit, 5, 100);
      const rows = await sql`
      SELECT ic.identity_claim_id, ic.face_id, ic.person_id, p.display_name,
        ic.calibrated_confidence::float8,
        nullif(ic.evidence_refs->>'best_score', '')::float8 AS source_score,
        nullif(ic.evidence_refs->>'margin', '')::float8 AS source_margin,
        a.asset_id, a.media_kind, a.width, a.height, a.capture_time,
        fo.box_x::float8, fo.box_y::float8, fo.box_w::float8, fo.box_h::float8,
        fo.detection_confidence::float8,
        fo.quality_measurements
      FROM identity_claim ic
      JOIN person p ON p.person_id = ic.person_id
      JOIN face_observation fo ON fo.face_id = ic.face_id
      JOIN asset a ON a.asset_id = fo.asset_id
      WHERE ic.state = 'candidate'
        AND p.status = 'active'
        AND p.subject_kind = 'person'
        AND cimmich_visibility_person_rank(p.person_id) <= ${presentationRank()}
        AND ic.evidence_refs->>'automatic_acceptance' = 'true'
        AND coalesce(ic.evidence_refs->>'assignment_decision', '') <> 'accepted_matched_digikam_sidecar_face'
        AND (
          coalesce(nullif(ic.evidence_refs->>'best_score', '')::float8, ic.calibrated_confidence::float8, -1)
            >= ${samePhotoAcceptedCandidateFloor}
          OR NOT EXISTS (
            SELECT 1
            FROM identity_claim same_photo_claim
            JOIN face_observation same_photo_face
              ON same_photo_face.face_id = same_photo_claim.face_id
              AND same_photo_face.state = 'valid'
            WHERE same_photo_claim.person_id = ic.person_id
              AND same_photo_claim.state = 'accepted'
              AND same_photo_face.asset_id = fo.asset_id
              AND same_photo_face.face_id <> fo.face_id
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM current_person_category category
          WHERE category.person_id = ic.person_id AND category.slug = 'sort'
        )
        AND (${String(personId || "")} = '' OR ic.person_id = ${String(personId || "")})
      ORDER BY coalesce(ic.calibrated_confidence, nullif(ic.evidence_refs->>'best_score', '')::numeric) DESC NULLS LAST,
        ic.created_at, ic.identity_claim_id
      LIMIT ${boundedLimit}
    `;

      return rows.map((row) => ({
        ...row,
        ...bridgeFields(bridge, row.asset_id),
      }));
    },

    async personCandidates({ limit = 500, personId }) {
      await requireVisibleSubject(personId);
      const boundedLimit = cleanLimit(limit, 500, 5000);
      const rows = await sql`
      SELECT claim.identity_claim_id, claim.face_id, claim.person_id, person.display_name,
        claim.calibrated_confidence::float8,
        nullif(claim.evidence_refs->>'best_score', '')::float8 AS source_score,
        nullif(claim.evidence_refs->>'margin', '')::float8 AS source_margin,
        coalesce(
          nullif(claim.evidence_refs->>'best_score', '')::float8,
          claim.calibrated_confidence::float8
        ) AS match_score,
        CASE
          WHEN nullif(claim.evidence_refs->>'margin', '')::float8 > 0
            THEN 'differentiated'
          WHEN nullif(claim.evidence_refs->>'margin', '') IS NULL
            THEN 'unscored'
          ELSE 'zero_margin'
        END AS review_priority,
        CASE
          WHEN nullif(claim.evidence_refs->>'margin', '')::float8 > 0
            THEN 'positive_candidate_margin'
          WHEN nullif(claim.evidence_refs->>'margin', '') IS NULL
            THEN 'margin_unavailable'
          ELSE 'no_candidate_separation'
        END AS review_reason,
        CASE
          WHEN nullif(claim.evidence_refs->>'best_score', '') IS NOT NULL
            THEN 'source_similarity'
          WHEN claim.calibrated_confidence IS NOT NULL
            THEN 'legacy_calibrated_confidence'
          ELSE 'unscored'
        END AS score_kind,
        asset.asset_id, asset.media_kind, asset.width, asset.height, asset.capture_time,
        face.box_x::float8, face.box_y::float8, face.box_w::float8, face.box_h::float8,
        face.detection_confidence::float8, face.quality_measurements,
        accepted.identity_claim_id AS current_claim_id,
        accepted.person_id AS current_person_id,
        current_person.display_name AS current_person_name
      FROM identity_claim claim
      JOIN person ON person.person_id = claim.person_id
        AND person.status = 'active' AND person.subject_kind = 'person'
        AND cimmich_visibility_person_rank(person.person_id) <= ${presentationRank()}
      JOIN face_observation face ON face.face_id = claim.face_id AND face.state = 'valid'
      JOIN asset ON asset.asset_id = face.asset_id AND asset.state = 'active'
      LEFT JOIN LATERAL (
        SELECT current.identity_claim_id, current.person_id
        FROM identity_claim current
        JOIN person accepted_person ON accepted_person.person_id = current.person_id
          AND accepted_person.status = 'active'
          AND cimmich_visibility_subject_rank(
            accepted_person.subject_kind, accepted_person.person_id
          ) <= ${presentationRank()}
        WHERE current.face_id = claim.face_id AND current.state = 'accepted'
        ORDER BY current.created_at DESC, current.identity_claim_id DESC
        LIMIT 1
      ) accepted ON true
      LEFT JOIN person current_person ON current_person.person_id = accepted.person_id
      WHERE claim.person_id = ${String(personId || "")} AND claim.state = 'candidate'
        AND coalesce(claim.evidence_refs->>'assignment_decision', '') <> 'accepted_matched_digikam_sidecar_face'
        AND (
          coalesce(nullif(claim.evidence_refs->>'best_score', '')::float8, claim.calibrated_confidence::float8, -1)
            >= ${samePhotoAcceptedCandidateFloor}
          OR NOT EXISTS (
            SELECT 1
            FROM identity_claim same_photo_claim
            JOIN face_observation same_photo_face
              ON same_photo_face.face_id = same_photo_claim.face_id
              AND same_photo_face.state = 'valid'
            WHERE same_photo_claim.person_id = claim.person_id
              AND same_photo_claim.state = 'accepted'
              AND same_photo_face.asset_id = face.asset_id
              AND same_photo_face.face_id <> face.face_id
          )
        )
      ORDER BY CASE
          WHEN nullif(claim.evidence_refs->>'margin', '')::float8 > 0 THEN 0
          WHEN nullif(claim.evidence_refs->>'margin', '') IS NULL THEN 1
          ELSE 2
        END,
        coalesce(
          nullif(claim.evidence_refs->>'best_score', '')::float8,
          claim.calibrated_confidence::float8
        ) DESC NULLS LAST,
        nullif(claim.evidence_refs->>'margin', '')::float8 DESC NULLS LAST,
        face.detection_confidence DESC,
        claim.identity_claim_id
      LIMIT ${boundedLimit}
    `;

      return rows.map((row) => ({
        ...row,
        ...bridgeFields(bridge, row.asset_id),
      }));
    },

    async bulkAcceptPersonCandidates({ actorId, claimIds, personId }) {
      const actor = cleanActor(actorId);
      if (!actor)
        throw Object.assign(new Error("Missing Cimmich actor"), {
          statusCode: 400,
        });
      if (!Array.isArray(claimIds)) {
        throw Object.assign(new Error("claimIds must be an array"), {
          statusCode: 400,
        });
      }
      const selectedIds = [
        ...new Set(
          claimIds.map((value) => String(value || "").trim()).filter(Boolean),
        ),
      ];
      if (selectedIds.length === 0) {
        throw Object.assign(new Error("Select at least one candidate"), {
          statusCode: 400,
        });
      }
      if (selectedIds.length > 100) {
        throw Object.assign(
          new Error("Accept no more than 100 candidates at once"),
          { statusCode: 400 },
        );
      }

      const result = await sql.begin(async (tx) => {
        const [target] = await tx`
        SELECT person_id, display_name
        FROM person
        WHERE person_id = ${String(personId || "")}
          AND status = 'active' AND subject_kind = 'person'
        FOR UPDATE
      `;
        if (!target)
          throw Object.assign(new Error("Active Person not found"), {
            statusCode: 404,
          });
        await ensureUserCommandReceipt(tx);

        const claims = [];
        const faceIds = new Set();
        for (const claimId of selectedIds) {
          const [claim] = await tx`
          SELECT identity_claim_id, face_id, person_id, state, evidence_refs
          FROM identity_claim
          WHERE identity_claim_id = ${claimId}
          FOR UPDATE
        `;
          if (
            !claim ||
            claim.person_id !== target.person_id ||
            claim.state !== "candidate"
          ) {
            throw Object.assign(
              new Error("Candidate selection is stale; refresh and try again"),
              {
                details: { claimId },
                statusCode: 409,
              },
            );
          }
          if (
            claim.evidence_refs?.assignment_decision ===
            "accepted_matched_digikam_sidecar_face"
          ) {
            throw Object.assign(
              new Error(
                "Import reconciliation evidence is not an accept-ready machine match",
              ),
              {
                details: { claimId },
                statusCode: 409,
              },
            );
          }
          if (faceIds.has(claim.face_id)) {
            throw Object.assign(
              new Error(
                "Selection contains more than one candidate for the same face",
              ),
              {
                details: { faceId: claim.face_id },
                statusCode: 409,
              },
            );
          }
          faceIds.add(claim.face_id);
          claims.push(claim);
        }

        const affectedPersonIds = new Set([target.person_id]);
        const accepted = [];
        for (const claim of claims) {
          const [current] = await tx`
          SELECT identity_claim_id, person_id
          FROM identity_claim
          WHERE face_id = ${claim.face_id} AND state = 'accepted'
          ORDER BY created_at DESC, identity_claim_id DESC
          LIMIT 1
          FOR UPDATE
        `;
          if (current?.person_id === target.person_id) {
            throw Object.assign(
              new Error(
                "Candidate selection is stale; this face is already accepted for the Person",
              ),
              {
                details: {
                  claimId: claim.identity_claim_id,
                  faceId: claim.face_id,
                },
                statusCode: 409,
              },
            );
          }

          const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
          await tx`
          INSERT INTO decision (
            decision_id, subject_type, subject_id, action, actor_kind, actor_id,
            reason_code, note, producer_receipt_id, privacy_class
          ) VALUES (
            ${decisionId}, 'identity_claim', ${claim.identity_claim_id}, 'accept', 'user', ${actor},
            'person_candidate_bulk_accept', ${`Accepted from ranked candidates for ${target.display_name}`},
            ${userCommandReceiptId}, 'sensitive-biometric'
          )
        `;

          if (current) {
            affectedPersonIds.add(current.person_id);
            const memberships = await tx`
            SELECT bucket_id
            FROM current_reference_gallery
            WHERE person_id = ${current.person_id} AND face_id = ${claim.face_id}
              AND membership_state = 'active'
          `;
            for (const membership of memberships) {
              await tx`
              INSERT INTO bucket_membership_event (
                membership_event_id, bucket_id, face_id, action, actor_kind,
                reason_code, reason_text, producer_receipt_id, privacy_class
              ) VALUES (
                ${`membership_${randomUUID().replaceAll("-", "")}`}, ${membership.bucket_id}, ${claim.face_id},
                'remove', 'user', 'candidate_bulk_reassignment',
                'Removed after accepting a candidate for another Person',
                ${userCommandReceiptId}, 'sensitive-biometric'
              )
            `;
            }
            await tx`
            UPDATE identity_claim
            SET state = 'superseded'
            WHERE identity_claim_id = ${current.identity_claim_id} AND state = 'accepted'
          `;
          }

          const [updated] = await tx`
          UPDATE identity_claim
          SET state = 'accepted', decision_id = ${decisionId},
            supersedes_claim_id = coalesce(${current?.identity_claim_id || null}, supersedes_claim_id)
          WHERE identity_claim_id = ${claim.identity_claim_id} AND state = 'candidate'
          RETURNING identity_claim_id, face_id, person_id, state
        `;
          if (!updated) {
            throw Object.assign(
              new Error(
                "Candidate selection changed while accepting; refresh and try again",
              ),
              {
                details: { claimId: claim.identity_claim_id },
                statusCode: 409,
              },
            );
          }
          accepted.push({
            claimId: updated.identity_claim_id,
            decisionId,
            faceId: updated.face_id,
            previousPersonId: current?.person_id || null,
          });
        }

        return {
          accepted,
          affectedPersonIds: [...affectedPersonIds],
          changed: true,
          personId: target.person_id,
        };
      });

      const maintenancePending = await refreshPrimeForPeople(
        sql,
        result.affectedPersonIds,
      );
      invalidateMachineSuggestions();
      return {
        accepted: result.accepted,
        acceptedCount: result.accepted.length,
        changed: result.changed,
        maintenancePending,
        personId: result.personId,
      };
    },

    async personPresentation({ personId }) {
      await requireVisibleSubject(personId);
      const id = String(personId || "");
      const rows = await sql`
        SELECT media.slot_kind, media.asset_id, media.observation_kind,
          media.observation_id, media.crop, media.updated_at,
          source.width, source.height
        FROM person_presentation_media media
        JOIN asset source ON source.asset_id = media.asset_id AND source.state = 'active'
        WHERE media.person_id = ${id}
          AND cimmich_visibility_asset_rank(media.asset_id) <= ${presentationRank()}
        ORDER BY media.slot_kind
      `;
      const slots = { body: null, face: null, hero: null };
      for (const row of rows) {
        slots[row.slot_kind] = {
          assetId: row.asset_id,
          crop: row.crop || null,
          observationId: row.observation_id || null,
          observationKind: row.observation_kind,
          selectionMode: "explicit",
          slotKind: row.slot_kind,
          updatedAt: new Date(row.updated_at).toISOString(),
          width: row.width,
          height: row.height,
          ...bridgeFields(bridge, row.asset_id),
        };
      }
      if (Object.values(slots).some((slot) => slot === null)) {
        const person = await this.person({ personId: id });
        const cropFromBox = ({ h, padding, w, x, y }) => {
          if (![h, w, x, y].every(Number.isFinite)) return null;
          const cropW = Math.min(1, Math.max(w * padding, 0.01));
          const cropH = Math.min(1, Math.max(h * padding, 0.01));
          const centerX = x + w / 2;
          const centerY = y + h / 2;
          return {
            h: cropH,
            w: cropW,
            x: Math.max(0, Math.min(1 - cropW, centerX - cropW / 2)),
            y: Math.max(0, Math.min(1 - cropH, centerY - cropH / 2)),
          };
        };
        const automaticMedia = ({
          assetId,
          crop,
          observationId,
          observationKind,
          slotKind,
          width,
          height,
        }) => {
          if (!assetId || !observationId) return null;
          const display = bridgeFields(bridge, assetId);
          if (!display.sourceAssetId) return null;
          return {
            assetId,
            crop,
            observationId,
            observationKind,
            selectionMode: "automatic",
            slotKind,
            updatedAt: null,
            width,
            height,
            ...display,
          };
        };
        const representative = {
          assetId: person.representative_asset_id,
          height: person.height,
          observationId: person.representative_face_id,
          observationKind: "face",
          width: person.width,
        };
        slots.face ??= automaticMedia({
          ...representative,
          crop: cropFromBox({
            h: person.box_h,
            padding: 2.4,
            w: person.box_w,
            x: person.box_x,
            y: person.box_y,
          }),
          slotKind: "face",
        });
        slots.hero ??= automaticMedia({
          ...representative,
          crop: null,
          slotKind: "hero",
        });
        slots.body ??= automaticMedia({
          assetId: person.bodyPreview?.assetId,
          crop: cropFromBox({
            h: person.bodyPreview?.box_h,
            padding: 1.12,
            w: person.bodyPreview?.box_w,
            x: person.bodyPreview?.box_x,
            y: person.bodyPreview?.box_y,
          }),
          observationId: person.bodyPreview?.bodyId,
          observationKind: "body",
          slotKind: "body",
          width: person.bodyPreview?.width,
          height: person.bodyPreview?.height,
        });
      }
      return {
        personId: id,
        schemaVersion: "cimmich.person-presentation-media.v1",
        ...slots,
      };
    },

    async setPersonPresentation({
      actorId,
      assetId,
      crop,
      observationId,
      observationKind,
      personId,
      slotKind,
    }) {
      await requireVisibleSubject(personId);
      const id = String(personId || "");
      const slot = String(slotKind || "");
      if (!["face", "body", "hero"].includes(slot)) {
        throw Object.assign(new Error("Presentation slot is invalid"), {
          statusCode: 400,
        });
      }
      const actor = cleanActor(actorId);
      if (!actor) {
        throw Object.assign(new Error("Missing Cimmich actor"), {
          statusCode: 400,
        });
      }
      if (assetId == null) {
        await sql`
          DELETE FROM person_presentation_media
          WHERE person_id = ${id} AND slot_kind = ${slot}
        `;
        return this.personPresentation({ personId: id });
      }
      const asset = String(assetId || "");
      const kind = String(observationKind || "");
      const observation = observationId == null ? null : String(observationId);
      if (!["face", "body", "presence"].includes(kind)) {
        throw Object.assign(
          new Error("Presentation evidence kind is invalid"),
          {
            statusCode: 400,
          },
        );
      }
      if (
        (slot === "face" && kind !== "face") ||
        (slot === "body" && kind !== "body")
      ) {
        throw Object.assign(
          new Error(`${slot} presentation requires ${slot} evidence`),
          {
            statusCode: 400,
          },
        );
      }
      let valid = false;
      if (kind === "face" && observation) {
        const [row] = await sql`
          SELECT 1
          FROM current_face_identity identity
          JOIN face_observation face ON face.face_id = identity.face_id
          WHERE identity.person_id = ${id} AND identity.state = 'accepted'
            AND face.face_id = ${observation} AND face.asset_id = ${asset}
            AND face.state = 'valid'
        `;
        valid = Boolean(row);
      } else if (kind === "body" && observation) {
        const [row] = await sql`
          SELECT 1
          FROM current_body_tag tag
          JOIN body_observation body ON body.body_id = tag.body_id
          WHERE tag.person_id = ${id} AND tag.state = 'accepted'
            AND body.body_id = ${observation} AND body.asset_id = ${asset}
            AND body.state = 'valid'
        `;
        valid = Boolean(row);
      } else if (kind === "presence") {
        const [row] = await sql`
          SELECT 1 FROM current_presence_tag
          WHERE person_id = ${id} AND state = 'accepted' AND asset_id = ${asset}
        `;
        valid = Boolean(row);
      }
      if (!valid) {
        throw Object.assign(
          new Error(
            "Presentation photo is not confirmed evidence for this person",
          ),
          {
            statusCode: 409,
          },
        );
      }
      const cleanCrop = cleanCoverCrop(crop);
      await sql`
        INSERT INTO person_presentation_media (
          person_id, slot_kind, asset_id, observation_kind, observation_id,
          crop, actor_id, updated_at
        ) VALUES (
          ${id}, ${slot}, ${asset}, ${kind}, ${observation},
          ${cleanCrop ? sql.json(cleanCrop) : null}, ${actor}, now()
        )
        ON CONFLICT (person_id, slot_kind) DO UPDATE SET
          asset_id = excluded.asset_id,
          observation_kind = excluded.observation_kind,
          observation_id = excluded.observation_id,
          crop = excluded.crop,
          actor_id = excluded.actor_id,
          updated_at = excluded.updated_at
      `;
      return this.personPresentation({ personId: id });
    },

    async personAssets({
      cursor = "",
      limit = 1000,
      pageSize = null,
      personId,
    }) {
      await requireVisibleSubject(personId);
      const paged = pageSize !== null || Boolean(cursor);
      const boundedLimit = paged
        ? cleanPageSize(pageSize)
        : cleanLimit(limit, 1000, 5000);
      const id = String(personId || "");
      const visibleRank = presentationRank();
      const decodedCursor = decodePersonPageCursor(cursor, {
        kind: "assets",
        personId: id,
        visibleRank,
      });
      const cursorCaptureTime = decodedCursor?.captureTime
        ? new Date(decodedCursor.captureTime)
        : null;
      const cursorAssetId = String(decodedCursor?.assetId || "");
      const rows = await sql`
      WITH person_buckets AS MATERIALIZED (
        SELECT bucket_id, person_id, bucket_kind
        FROM reference_bucket
        WHERE person_id = ${id} AND state IN ('candidate', 'active')
      ), gallery_latest AS MATERIALIZED (
        SELECT DISTINCT ON (event.bucket_id, event.face_id)
          bucket.person_id, bucket.bucket_kind, event.face_id, event.action
        FROM person_buckets bucket
        JOIN bucket_membership_event event ON event.bucket_id = bucket.bucket_id
        ORDER BY event.bucket_id, event.face_id, event.created_at DESC,
          event.membership_event_id DESC
      ), active_heads AS MATERIALIZED (
        SELECT person_id, face_id
        FROM gallery_latest
        WHERE bucket_kind = 'head' AND action IN ('activate', 'pin', 'unpin')
      ), associations AS MATERIALIZED (
        SELECT face.asset_id, identity.person_id,
          CASE WHEN head.face_id IS NULL THEN 'face'::text ELSE 'head'::text END AS association_type,
          face.face_id AS geometry_id
        FROM current_face_identity identity
        JOIN face_observation face ON face.face_id = identity.face_id
        LEFT JOIN active_heads head ON head.person_id = identity.person_id
          AND head.face_id = identity.face_id
        WHERE identity.person_id = ${id} AND identity.state = 'accepted'
        UNION ALL
        SELECT body.asset_id, tag.person_id,
          CASE
            WHEN tag.origin = 'face_body_linkage' AND tag.supporting_face_id IS NOT NULL
              THEN 'body_link'::text
            ELSE 'body'::text
          END,
          body.body_id
        FROM current_body_tag tag
        JOIN body_observation body ON body.body_id = tag.body_id
        WHERE tag.person_id = ${id} AND tag.state = 'accepted'
        UNION ALL
        SELECT tag.asset_id, tag.person_id,
          CASE WHEN tag.reason_code = 'head_evidence' THEN 'head'::text ELSE 'presence'::text END,
          NULL::text
        FROM current_presence_tag tag
        WHERE tag.person_id = ${id} AND tag.state = 'accepted'
        UNION ALL
        SELECT head.asset_id, tag.subject_id, 'head'::text, head.head_id
        FROM current_manual_head_tag tag
        JOIN manual_head_observation head ON head.head_id = tag.head_id
        WHERE tag.subject_id = ${id}
      )
      SELECT a.asset_id, a.media_kind, a.mime_type, a.width, a.height, a.capture_time,
        bool_or(association.association_type = 'face') AS has_face,
        bool_or(association.association_type = 'head') AS has_head,
        bool_or(association.association_type = 'body') AS has_body,
        bool_or(association.association_type = 'body_link') AS has_linked_body,
        bool_or(association.association_type = 'presence') AS has_presence,
        bool_or(association.association_type = 'head' AND association.geometry_id IS NULL) AS asset_head_evidence,
        bool_or(association.association_type = 'presence') AS presence_evidence,
        coalesce((
          SELECT jsonb_agg(
            jsonb_build_object(
              'entityId', entity.entity_id,
              'entityKind', entity.entity_kind,
              'typeKind', CASE entity.entity_kind
                WHEN 'place' THEN entity.place_kind
                WHEN 'object' THEN entity.object_kind
                WHEN 'event' THEN entity.event_kind
              END,
              'displayName', entity.display_name
            )
            ORDER BY entity.entity_kind, lower(entity.display_name), entity.entity_id
          )
          FROM current_context_asset context_link
          JOIN context_entity entity ON entity.entity_id = context_link.entity_id
          WHERE context_link.asset_id = a.asset_id
            AND entity.status = 'active'
            AND cimmich_visibility_context_entity_rank(entity.entity_id) <= ${visibleRank}
        ), '[]'::jsonb) AS contexts
      FROM associations association
      JOIN asset a ON a.asset_id = association.asset_id
      WHERE association.person_id = ${id}
        AND a.state = 'active'
        AND cimmich_visibility_asset_rank(a.asset_id) <= ${visibleRank}
        AND (
          ${decodedCursor === null}
          OR (
            ${cursorCaptureTime !== null}
            AND (
              a.capture_time IS NULL
              OR a.capture_time < ${cursorCaptureTime}
              OR (a.capture_time = ${cursorCaptureTime} AND a.asset_id > ${cursorAssetId})
            )
          )
          OR (
            ${cursorCaptureTime === null}
            AND a.capture_time IS NULL
            AND a.asset_id > ${cursorAssetId}
          )
        )
      GROUP BY a.asset_id, a.media_kind, a.mime_type, a.width, a.height, a.capture_time
      ORDER BY a.capture_time DESC NULLS LAST, a.asset_id
      LIMIT ${boundedLimit + (paged ? 1 : 0)}
    `;

      const hasMore = paged && rows.length > boundedLimit;
      const pageRows = hasMore ? rows.slice(0, boundedLimit) : rows;
      const items = pageRows.map((row) => ({
        ...row,
        association_types: [
          ...(row.has_face ? ["face"] : []),
          ...(row.has_head ? ["head"] : []),
          ...(row.has_body && !row.has_face && !row.has_head ? ["body"] : []),
          ...(row.has_presence &&
          !row.has_face &&
          !row.has_head &&
          !row.has_body
            ? ["presence"]
            : []),
        ],
        contexts: Array.isArray(row.contexts) ? row.contexts : [],
        ...bridgeFields(bridge, row.asset_id),
      }));
      if (!paged) return items;
      const last = pageRows.at(-1);
      return {
        items,
        nextCursor:
          hasMore && last
            ? encodePersonPageCursor({
                assetId: last.asset_id,
                captureTime: last.capture_time
                  ? new Date(last.capture_time).toISOString()
                  : null,
                kind: "assets",
                personId: id,
                visibleRank,
              })
            : null,
        pageSize: boundedLimit,
        schemaVersion: personPageSchemaVersion,
      };
    },

    async faceMatches({ faceId, limit = 5 }) {
      const boundedLimit = cleanLimit(limit, 5, 12);
      const rows = await sql`
      WITH query AS (
        SELECT fo.face_id, fo.asset_id, fe.model_family, fe.model_version,
          fe.config_digest, fe.dimension, fe.embedding,
          coalesce((
            SELECT array_agg(context.context_id ORDER BY context.context_id)
            FROM current_face_capture_context context
            WHERE context.face_id = fo.face_id
          ), ARRAY[]::text[]) AS query_context_ids,
          accepted.person_id AS current_person_id
        FROM face_observation fo
        JOIN asset query_asset ON query_asset.asset_id = fo.asset_id
          AND query_asset.state = 'active'
        JOIN LATERAL (
          SELECT current.*
          FROM face_embedding current
          WHERE current.face_id = fo.face_id AND current.state = 'active'
          ORDER BY (
            SELECT count(*)
            FROM matching_gallery gallery
            WHERE gallery.model_family = current.model_family
              AND gallery.model_version = current.model_version
              AND gallery.config_digest = current.config_digest
              AND gallery.dimension = current.dimension
          ) DESC, current.created_at DESC, current.embedding_id
          LIMIT 1
        ) fe ON true
        LEFT JOIN LATERAL (
          SELECT identity.person_id
          FROM current_face_identity identity
          WHERE identity.face_id = fo.face_id AND identity.state = 'accepted'
          LIMIT 1
        ) accepted ON true
        WHERE fo.face_id = ${String(faceId || "")} AND fo.state = 'valid'
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
          )::int AS rank
        FROM prime_scores
      )
      SELECT ranked.rank, ranked.person_id, person.display_name,
        ranked.prime_score, ranked.raw_prime_score,
        ranked.individual_top3 AS prime_top3_score, ranked.prototype_score,
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
    },

    async faceReviewComparisons({ faceId, limit = 5 }) {
      const boundedLimit = cleanLimit(limit, 6, 12);
      const visibleRank = presentationRank();
      const rows = await sql`
        WITH query AS MATERIALIZED (
          SELECT face.face_id, face.asset_id, embedding.model_family,
            embedding.model_version, embedding.config_digest,
            embedding.dimension, embedding.embedding,
            accepted.person_id AS current_person_id
          FROM face_observation face
          JOIN asset query_asset ON query_asset.asset_id = face.asset_id
            AND query_asset.state = 'active'
          JOIN LATERAL (
            SELECT candidate.*
            FROM face_embedding candidate
            WHERE candidate.face_id = face.face_id
              AND candidate.state = 'active'
            ORDER BY (
              SELECT count(DISTINCT identity.person_id)
              FROM face_embedding reference
              JOIN face_observation reference_face
                ON reference_face.face_id = reference.face_id
                AND reference_face.state = 'valid'
              JOIN asset reference_asset
                ON reference_asset.asset_id = reference_face.asset_id
                AND reference_asset.state = 'active'
              JOIN current_face_identity identity
                ON identity.face_id = reference.face_id
                AND identity.state = 'accepted'
              JOIN current_person person ON person.person_id = identity.person_id
                AND person.status = 'active' AND person.subject_kind = 'person'
              WHERE reference.state = 'active'
                AND reference.model_family = candidate.model_family
                AND reference.model_version = candidate.model_version
                AND reference.config_digest = candidate.config_digest
                AND reference.dimension = candidate.dimension
                AND reference.face_id <> face.face_id
                AND reference_face.asset_id <> face.asset_id
                AND cimmich_visibility_asset_rank(reference_asset.asset_id)
                  <= ${visibleRank}
                AND cimmich_visibility_person_rank(person.person_id)
                  <= ${visibleRank}
                AND NOT EXISTS (
                  SELECT 1
                  FROM current_face_capture_context reference_context
                  JOIN current_face_capture_context query_context
                    ON query_context.face_id = face.face_id
                    AND query_context.context_id = reference_context.context_id
                  WHERE reference_context.face_id = reference.face_id
                )
            ) DESC, candidate.created_at DESC, candidate.embedding_id
            LIMIT 1
          ) embedding ON true
          LEFT JOIN LATERAL (
            SELECT identity.person_id
            FROM current_face_identity identity
            JOIN current_person person ON person.person_id = identity.person_id
              AND person.status = 'active' AND person.subject_kind = 'person'
              AND cimmich_visibility_person_rank(person.person_id)
                <= ${visibleRank}
            WHERE identity.face_id = face.face_id
              AND identity.state = 'accepted'
            ORDER BY identity.identity_claim_id
            LIMIT 1
          ) accepted ON true
          WHERE face.face_id = ${String(faceId || "")}
            AND face.state = 'valid'
            AND cimmich_visibility_asset_rank(query_asset.asset_id)
              <= ${visibleRank}
        ), reference_scores AS MATERIALIZED (
          SELECT identity.person_id, person.display_name,
            reference.face_id AS reference_face_id,
            (1 - (reference.embedding <=> query.embedding))::float8 AS similarity
          FROM query
          JOIN face_embedding reference
            ON reference.state = 'active'
            AND reference.model_family = query.model_family
            AND reference.model_version = query.model_version
            AND reference.config_digest = query.config_digest
            AND reference.dimension = query.dimension
            AND reference.face_id <> query.face_id
          JOIN face_observation reference_face
            ON reference_face.face_id = reference.face_id
            AND reference_face.state = 'valid'
            AND reference_face.asset_id <> query.asset_id
          JOIN asset reference_asset
            ON reference_asset.asset_id = reference_face.asset_id
            AND reference_asset.state = 'active'
          JOIN current_face_identity identity
            ON identity.face_id = reference.face_id
            AND identity.state = 'accepted'
          JOIN current_person person ON person.person_id = identity.person_id
            AND person.status = 'active' AND person.subject_kind = 'person'
          WHERE cimmich_visibility_asset_rank(reference_asset.asset_id)
              <= ${visibleRank}
            AND cimmich_visibility_person_rank(person.person_id)
              <= ${visibleRank}
            AND NOT EXISTS (
              SELECT 1
              FROM current_face_capture_context reference_context
              JOIN current_face_capture_context query_context
                ON query_context.face_id = query.face_id
                AND query_context.context_id = reference_context.context_id
              WHERE reference_context.face_id = reference.face_id
            )
        ), best_per_person AS MATERIALIZED (
          SELECT DISTINCT ON (person_id) person_id, display_name,
            reference_face_id, similarity,
            count(*) OVER (PARTITION BY person_id)::int AS accepted_example_count
          FROM reference_scores
          ORDER BY person_id, similarity DESC, reference_face_id
        ), visible_people AS MATERIALIZED (
          SELECT person.person_id, person.display_name
          FROM query
          JOIN current_person person ON person.status = 'active'
            AND person.subject_kind = 'person'
            AND cimmich_visibility_person_rank(person.person_id)
              <= ${visibleRank}
        ), selected AS MATERIALIZED (
          SELECT person.person_id, person.display_name,
            best.reference_face_id, best.similarity,
            coalesce(best.accepted_example_count, 0)::int AS accepted_example_count,
            coalesce(
              person.person_id = query.current_person_id,
              false
            ) AS current_identity,
            CASE WHEN best.person_id IS NULL
              THEN 'no_independent_compatible_reference_face'
              ELSE NULL
            END AS unavailable_reason
          FROM visible_people person
          CROSS JOIN query
          LEFT JOIN best_per_person best ON best.person_id = person.person_id
        )
        SELECT row_number() OVER (
            ORDER BY similarity DESC NULLS LAST,
              lower(display_name), person_id, reference_face_id
          )::int AS rank,
          person_id, display_name, similarity,
          similarity AS prime_score,
          CASE WHEN similarity IS NULL
            THEN NULL
            ELSE 'cosine_similarity'::text
          END AS score_kind,
          current_identity, accepted_example_count, unavailable_reason
        FROM selected
        ORDER BY rank
        LIMIT greatest(
          ${boundedLimit},
          (SELECT count(*) FROM visible_people)
        )
      `;
      return {
        automaticIdentityAuthority: "none",
        bulkAutomationAuthority: "none",
        emptyReason:
          rows.length === 0 ? "no_compatible_accepted_reference_faces" : null,
        evidenceKind: "accepted_owner_faces",
        items: rows,
        matchingLibrary: "accepted_reference_faces",
        recommendationAuthority: "none",
        reviewOnly: true,
        schemaVersion: "cimmich.face-owner-review-comparisons.v1",
      };
    },

    async faceMatchesBatch({ faceIds, limitPerFace = 1, personId }) {
      const id = String(personId || "");
      if (!(await isHoldingPerson(sql, id))) {
        throw typedError(
          "Batch face matching is limited to a Holding Person",
          409,
          "PERSON_HOLDING_REQUIRED",
        );
      }
      if (
        !Array.isArray(faceIds) ||
        faceIds.length < 1 ||
        faceIds.length > 24
      ) {
        throw typedError(
          "faceIds must contain from 1 to 24 stable face IDs",
          400,
          "PERSON_FACE_BATCH_INVALID",
        );
      }
      const normalizedFaceIds = faceIds.map((faceId) =>
        String(faceId || "").trim(),
      );
      if (
        normalizedFaceIds.some((faceId) => !faceId || faceId.length > 160) ||
        new Set(normalizedFaceIds).size !== normalizedFaceIds.length
      ) {
        throw typedError(
          "faceIds must be unique non-empty stable face IDs",
          400,
          "PERSON_FACE_BATCH_INVALID",
        );
      }
      const parsedLimit = Number.parseInt(String(limitPerFace), 10);
      if (
        !Number.isInteger(parsedLimit) ||
        parsedLimit < 1 ||
        parsedLimit > 3
      ) {
        throw typedError(
          "limitPerFace must be an integer from 1 to 3",
          400,
          "PERSON_FACE_BATCH_INVALID",
        );
      }
      const visibleRank = presentationRank();
      const visibleFaces = await sql`
        SELECT identity.face_id
        FROM current_face_identity identity
        JOIN face_observation face ON face.face_id = identity.face_id
          AND face.state = 'valid'
        JOIN asset ON asset.asset_id = face.asset_id AND asset.state = 'active'
        WHERE identity.person_id = ${id} AND identity.state = 'accepted'
          AND identity.face_id = ANY(${normalizedFaceIds})
          AND cimmich_visibility_asset_rank(asset.asset_id) <= ${visibleRank}
      `;
      const visibleFaceIds = new Set(visibleFaces.map((row) => row.face_id));
      if (normalizedFaceIds.some((faceId) => !visibleFaceIds.has(faceId))) {
        throw typedError(
          "One or more requested faces are not visible for this Holding Person",
          404,
          "PERSON_IDENTITY_FACE_NOT_VISIBLE",
        );
      }

      const items = [];
      for (let offset = 0; offset < normalizedFaceIds.length; offset += 4) {
        const chunk = normalizedFaceIds.slice(offset, offset + 4);
        const matches = await Promise.all(
          chunk.map((faceId) =>
            repository.faceMatches({ faceId, limit: parsedLimit }),
          ),
        );
        items.push(
          ...chunk.map((faceId, index) => ({
            faceId,
            matches: matches[index],
          })),
        );
      }
      return {
        items,
        limitPerFace: parsedLimit,
        personId: id,
        requestedCount: normalizedFaceIds.length,
        schemaVersion: "cimmich.person-holding-match-batch.v1",
      };
    },

    async assetEvidence({ sourceAssetId }) {
      const linked = await resolveVisibleAssetDisplay(sourceAssetId);
      const [asset] = await sql`
      SELECT asset_id, capture_time, height, media_kind, mime_type, width
      FROM asset
      WHERE asset_id = ${linked.assetId} AND state = 'active'
        AND cimmich_visibility_asset_rank(asset_id) <= ${presentationRank()}
    `;
      if (!asset)
        throw Object.assign(new Error("Cimmich asset not found"), {
          statusCode: 404,
        });

      const [
        faceRows,
        headRows,
        bodyRows,
        presenceRows,
        peopleRows,
        contextRows,
        manualContext,
      ] = await Promise.all([
        sql`
        SELECT fo.face_id, fo.box_x::float8, fo.box_y::float8, fo.box_w::float8, fo.box_h::float8,
          fo.current_revision, fo.current_decision_id,
          fo.detection_confidence::float8, fo.quality_measurements,
          EXISTS (SELECT 1 FROM face_embedding active_embedding
            WHERE active_embedding.face_id = fo.face_id AND active_embedding.state = 'active') AS has_active_embedding,
          accepted.identity_claim_id, accepted.person_id, accepted.display_name,
          candidate.identity_claim_id AS candidate_identity_claim_id,
          candidate.person_id AS candidate_person_id, candidate.display_name AS candidate_display_name,
          candidate.calibrated_confidence::float8 AS candidate_confidence,
          rejected.identity_claim_id AS rejected_identity_claim_id,
          rejected.person_id AS rejected_person_id, rejected.display_name AS rejected_display_name,
          CASE
            WHEN review.reason_code = 'face_review_later' AND review.action = 'ignore' THEN 'later'
            WHEN review.reason_code = 'face_review_unknown' AND review.action = 'ignore' THEN 'unknown'
            ELSE 'active'
          END AS review_disposition,
          review.decision_id AS review_decision_id,
          coalesce(gallery.buckets, ARRAY[]::text[]) AS buckets
        FROM face_observation fo
        LEFT JOIN LATERAL (
          SELECT ic.identity_claim_id, ic.person_id, p.display_name
          FROM identity_claim ic
          JOIN person p ON p.person_id = ic.person_id
          WHERE ic.face_id = fo.face_id AND ic.state = 'accepted'
            AND cimmich_visibility_subject_rank(p.subject_kind, p.person_id)
              <= ${presentationRank()}
          ORDER BY ic.created_at DESC, ic.identity_claim_id DESC
          LIMIT 1
        ) accepted ON true
        LEFT JOIN LATERAL (
          SELECT ic.identity_claim_id, ic.person_id, p.display_name,
            coalesce(nullif(ic.evidence_refs->>'best_score', '')::numeric, ic.calibrated_confidence) AS calibrated_confidence
          FROM identity_claim ic
          JOIN person p ON p.person_id = ic.person_id
          WHERE ic.face_id = fo.face_id AND ic.state = 'candidate'
            AND cimmich_visibility_subject_rank(p.subject_kind, p.person_id)
              <= ${presentationRank()}
            AND (
              coalesce(nullif(ic.evidence_refs->>'best_score', '')::float8, ic.calibrated_confidence::float8, -1)
                >= ${samePhotoAcceptedCandidateFloor}
              OR NOT EXISTS (
                SELECT 1
                FROM identity_claim same_photo_claim
                JOIN face_observation same_photo_face
                  ON same_photo_face.face_id = same_photo_claim.face_id
                  AND same_photo_face.state = 'valid'
                WHERE same_photo_claim.person_id = ic.person_id
                  AND same_photo_claim.state = 'accepted'
                  AND same_photo_face.asset_id = fo.asset_id
                  AND same_photo_face.face_id <> fo.face_id
              )
            )
          ORDER BY coalesce(nullif(ic.evidence_refs->>'best_score', '')::numeric, ic.calibrated_confidence) DESC NULLS LAST,
            ic.created_at DESC, ic.identity_claim_id DESC
          LIMIT 1
        ) candidate ON true
        LEFT JOIN LATERAL (
          SELECT ic.identity_claim_id, ic.person_id, p.display_name
          FROM identity_claim ic
          JOIN person p ON p.person_id = ic.person_id
          WHERE ic.face_id = fo.face_id AND ic.state = 'rejected'
            AND cimmich_visibility_subject_rank(p.subject_kind, p.person_id)
              <= ${presentationRank()}
          ORDER BY ic.created_at DESC, ic.identity_claim_id DESC
          LIMIT 1
        ) rejected ON true
        LEFT JOIN LATERAL (
          SELECT decision_id, action, reason_code
          FROM decision
          WHERE subject_type = 'face_review' AND subject_id = fo.face_id
          ORDER BY created_at DESC, decision_id DESC
          LIMIT 1
        ) review ON true
        LEFT JOIN LATERAL (
          SELECT array_agg(g.bucket_kind || coalesce(':' || g.bucket_name, '') ORDER BY g.bucket_kind, g.bucket_name) AS buckets
          FROM current_reference_gallery g
          WHERE g.face_id = fo.face_id AND g.membership_state = 'active'
        ) gallery ON true
        WHERE fo.asset_id = ${linked.assetId} AND fo.state = 'valid'
        ORDER BY fo.face_id
      `,
        sql`
        SELECT head.head_id, head.box_x::float8, head.box_y::float8,
          head.box_w::float8, head.box_h::float8,
          tag.subject_id AS person_id, person.display_name, tag.subject_kind
        FROM manual_head_observation head
        JOIN current_manual_head_tag tag ON tag.head_id = head.head_id
        JOIN person ON person.person_id = tag.subject_id
        WHERE head.asset_id = ${linked.assetId} AND head.state = 'valid'
          AND cimmich_visibility_subject_rank(
            person.subject_kind, person.person_id
          ) <= ${presentationRank()}
        ORDER BY head.head_id
      `,
        sql`
        SELECT bo.body_id, bo.box_x::float8, bo.box_y::float8, bo.box_w::float8, bo.box_h::float8,
          bo.current_revision, bo.current_decision_id,
          bo.head_box_x::float8, bo.head_box_y::float8, bo.head_box_w::float8, bo.head_box_h::float8,
          bo.quality_measurements, tag.person_id, tag.display_name, tag.supporting_face_id,
          tag.origin AS body_link_origin, tag.decision_id AS body_link_decision_id,
          pose.body_id AS pose_body_id, pose.coordinate_space AS pose_coordinate_space,
          pose.joint_schema AS pose_joint_schema, pose.topology_id AS pose_topology_id,
          pose.keypoints AS pose_keypoints, pose.provider AS pose_provider,
          pose.model_family AS pose_model_family, pose.model_name AS pose_model_name,
          pose.model_version AS pose_model_version, pose.model_digest AS pose_model_digest,
          pose.source_schema_version AS pose_source_schema_version, pose.state AS pose_state
        FROM body_observation bo
        LEFT JOIN LATERAL (
          SELECT bt.person_id, p.display_name, bt.supporting_face_id,
            bt.origin, bt.decision_id
          FROM current_body_tag bt
          JOIN person p ON p.person_id = bt.person_id
          WHERE bt.body_id = bo.body_id AND bt.state = 'accepted'
            AND cimmich_visibility_subject_rank(p.subject_kind, p.person_id)
              <= ${presentationRank()}
          ORDER BY bt.created_at DESC, bt.body_tag_id DESC
          LIMIT 1
        ) tag ON true
        LEFT JOIN body_pose_evidence pose ON pose.body_id = bo.body_id
        WHERE bo.asset_id = ${linked.assetId} AND bo.state = 'valid'
        ORDER BY bo.body_id
      `,
        sql`
        SELECT pt.person_id, p.display_name, pt.reason_code,
          pt.manual_geometry
        FROM current_presence_tag pt
        JOIN person p ON p.person_id = pt.person_id
        WHERE pt.asset_id = ${linked.assetId} AND pt.state = 'accepted'
          AND cimmich_visibility_subject_rank(p.subject_kind, p.person_id)
            <= ${presentationRank()}
        ORDER BY p.display_name, pt.person_id
      `,
        sql`
        SELECT person.person_id, person.display_name,
          EXISTS (
            SELECT 1 FROM current_person_category category
            WHERE category.person_id = person.person_id AND category.slug = 'holding'
          ) AS needs_holding
        FROM current_person person
        WHERE person.status = 'active' AND nullif(person.display_name, '') IS NOT NULL
          AND cimmich_visibility_subject_rank(
            person.subject_kind, person.person_id
          ) <= ${presentationRank()}
          AND EXISTS (
            SELECT 1 FROM person_assets association
            WHERE association.person_id = person.person_id
              AND association.authority_state = 'accepted'
              AND cimmich_visibility_asset_rank(association.asset_id) <= ${presentationRank()}
          )
        ORDER BY display_name, person_id
      `,
        sql`
        SELECT link.association_kind, entity.entity_id, entity.entity_kind,
          entity.display_name,
          CASE entity.entity_kind
            WHEN 'place' THEN entity.place_kind
            WHEN 'object' THEN entity.object_kind
            WHEN 'event' THEN entity.event_kind
          END AS type_kind
        FROM current_context_asset link
        JOIN context_entity entity ON entity.entity_id = link.entity_id
        WHERE link.asset_id = ${linked.assetId}
          AND entity.status = 'active'
          AND cimmich_visibility_context_entity_rank(entity.entity_id) <= ${presentationRank()}
        ORDER BY entity.entity_kind, lower(entity.display_name), entity.entity_id
      `,
        manualPhotoContext.projectCurrentAsset({ assetId: linked.assetId }),
      ]);

      const displayFaces = dedupeAssetFaces(faceRows);
      const candidateLists = await Promise.all(
        displayFaces.map((face) =>
          face.person_id
            ? Promise.resolve([])
            : repository.faceMatches({ faceId: face.face_id, limit: 5 }),
        ),
      );
      const detailedFaces = displayFaces.map((face, index) => {
        const matches = candidateLists[index]
          .filter((match) => Number.isFinite(Number(match.prime_score)))
          .map((match) => ({
            displayEligible: true,
            personId: match.person_id,
            personName: match.display_name,
            rank: Number(match.rank),
            rawScore: Number(match.prime_score),
            scoreKind: "cosine_similarity",
            scoreMeaning:
              "Higher means closer in the same recognition space; this is not a probability.",
          }));
        const best = matches[0] || null;
        const persistedCandidate = face.candidate_identity_claim_id
          ? {
              claimId: face.candidate_identity_claim_id,
              confidence:
                face.candidate_confidence == null
                  ? null
                  : Number(face.candidate_confidence),
              personId: face.candidate_person_id,
              personName: face.candidate_display_name,
            }
          : null;
        return {
          ...face,
          candidate_abstain_reason: face.person_id
            ? "accepted_identity"
            : persistedCandidate
              ? null
              : !face.has_active_embedding
                ? "no_active_embedding"
                : best
                  ? null
                  : "no_same_space_candidate",
          candidate_confidence:
            persistedCandidate?.confidence ?? best?.rawScore ?? null,
          candidate_display_name:
            persistedCandidate?.personName ?? best?.personName ?? null,
          candidate_identity_claim_id: persistedCandidate?.claimId ?? null,
          candidate_matches: matches,
          candidate_person_id:
            persistedCandidate?.personId ?? best?.personId ?? null,
          current_decision_id: face.current_decision_id || null,
          current_revision: Number(face.current_revision),
        };
      });
      const projectedBodies = projectAssetFaceBodyLinks({
        assetId: linked.assetId,
        bodies: bodyRows.map((body) => ({
          bodyId: body.body_id,
          boxH: body.box_h,
          boxW: body.box_w,
          boxX: body.box_x,
          boxY: body.box_y,
          headBox:
            body.head_box_x == null
              ? null
              : {
                  boxH: body.head_box_h,
                  boxW: body.head_box_w,
                  boxX: body.head_box_x,
                  boxY: body.head_box_y,
                },
          personId: body.person_id,
          supportingFaceId: body.supporting_face_id,
        })),
        faces: detailedFaces.map((face) => ({
          boxH: face.box_h,
          boxW: face.box_w,
          boxX: face.box_x,
          boxY: face.box_y,
          faceId: face.face_id,
        })),
      });
      const projectedBodyById = new Map(
        projectedBodies.map((body) => [body.bodyId, body]),
      );

      return {
        ...asset,
        filename: linked.filename,
        schemaVersion: "cimmich.asset-detailed-evidence.v3",
        sourceAssetId: linked.sourceAssetId,
        bodies: bodyRows.map((body) => {
          const projection = projectedBodyById.get(body.body_id);
          const bodyEvidence = stripBodyPoseStorage(body);
          return {
            ...bodyEvidence,
            current_decision_id: body.current_decision_id || null,
            current_revision: Number(body.current_revision),
            face_link_decision_id: body.body_link_decision_id || null,
            face_link_confidence: projection?.faceLinkConfidence ?? null,
            face_link_id: projection?.faceLinkId ?? null,
            face_link_source:
              body.body_link_origin ||
              (projection?.faceLinkState === "geometry"
                ? "geometry_policy"
                : null),
            face_link_state: projection?.faceLinkState ?? null,
            pose: projectBodyPose(body),
          };
        }),
        faces: detailedFaces,
        heads: headRows,
        known_people: peopleRows,
        presence: presenceRows,
        contexts: contextRows,
        ownerSummary: manualContext.ownerSummary,
        thingRegions: manualContext.thingRegions,
      };
    },

    async identityFaces({
      cursor = "",
      limit = 5000,
      pageSize = null,
      personId,
    }) {
      await requireVisibleSubject(personId);
      const paged = pageSize !== null || Boolean(cursor);
      const boundedLimit = paged
        ? cleanPageSize(pageSize, 24, 120)
        : cleanLimit(limit, 1000, 5000);
      const id = String(personId || "");
      const visibleRank = presentationRank();
      const decodedCursor = decodePersonPageCursor(cursor, {
        kind: "identity",
        personId: id,
        visibleRank,
      });
      const cursorCaptureTime = decodedCursor?.captureTime
        ? new Date(decodedCursor.captureTime)
        : null;
      const cursorQuality =
        decodedCursor?.quality === null || decodedCursor === null
          ? null
          : Number(decodedCursor.quality);
      const cursorFaceId = String(decodedCursor?.faceId || "");
      const rows = await sql`
      WITH page_faces AS MATERIALIZED (
        SELECT cfi.identity_claim_id, cfi.person_id, fo.face_id, fo.asset_id,
          fo.box_x, fo.box_y, fo.box_w, fo.box_h, fo.detection_confidence,
          fo.quality_measurements, a.capture_time, a.media_kind, a.width, a.height,
          (fo.quality_measurements->>'quality_score')::float8 AS quality_sort
        FROM current_face_identity cfi
        JOIN face_observation fo ON fo.face_id = cfi.face_id AND fo.state = 'valid'
        JOIN asset a ON a.asset_id = fo.asset_id AND a.state = 'active'
        WHERE cfi.person_id = ${id} AND cfi.state = 'accepted'
          AND cimmich_visibility_asset_rank(a.asset_id) <= ${visibleRank}
          AND (
            ${decodedCursor === null}
            OR (
              ${cursorCaptureTime !== null}
              AND (
                a.capture_time IS NULL
                OR a.capture_time < ${cursorCaptureTime}
                OR (
                  a.capture_time = ${cursorCaptureTime}
                  AND (
                    (
                      ${cursorQuality !== null}
                      AND (
                        (fo.quality_measurements->>'quality_score')::float8 IS NULL
                        OR (fo.quality_measurements->>'quality_score')::float8 < ${cursorQuality}
                        OR (
                          (fo.quality_measurements->>'quality_score')::float8 = ${cursorQuality}
                          AND fo.face_id > ${cursorFaceId}
                        )
                      )
                    )
                    OR (
                      ${cursorQuality === null}
                      AND (fo.quality_measurements->>'quality_score')::float8 IS NULL
                      AND fo.face_id > ${cursorFaceId}
                    )
                  )
                )
              )
            )
            OR (
              ${cursorCaptureTime === null}
              AND a.capture_time IS NULL
              AND (
                (
                  ${cursorQuality !== null}
                  AND (
                    (fo.quality_measurements->>'quality_score')::float8 IS NULL
                    OR (fo.quality_measurements->>'quality_score')::float8 < ${cursorQuality}
                    OR (
                      (fo.quality_measurements->>'quality_score')::float8 = ${cursorQuality}
                      AND fo.face_id > ${cursorFaceId}
                    )
                  )
                )
                OR (
                  ${cursorQuality === null}
                  AND (fo.quality_measurements->>'quality_score')::float8 IS NULL
                  AND fo.face_id > ${cursorFaceId}
                )
              )
            )
          )
        ORDER BY a.capture_time DESC NULLS LAST,
          (fo.quality_measurements->>'quality_score')::float8 DESC NULLS LAST,
          fo.face_id
        LIMIT ${boundedLimit + (paged ? 1 : 0)}
      )
      SELECT pf.identity_claim_id, pf.face_id, pf.asset_id,
        pf.box_x::float8, pf.box_y::float8, pf.box_w::float8, pf.box_h::float8,
        pf.detection_confidence::float8, pf.quality_measurements,
        pf.capture_time, pf.media_kind, pf.width, pf.height,
        round(pf.width * pf.box_w)::int AS face_pixel_width,
        round(pf.height * pf.box_h)::int AS face_pixel_height,
        coalesce(pf.quality_measurements->>'source_instance_suffix', '') AS source_instance_suffix,
        coalesce(nearby.nearby_face_count, 0)::int AS nearby_face_count,
        coalesce(gallery.buckets, '[]'::jsonb) AS buckets,
        coalesce(modifiers.items, '[]'::jsonb) AS modifiers,
        coalesce(proposals.items, '[]'::jsonb) AS modifier_proposals,
        coalesce(contexts.items, '[]'::jsonb) AS capture_contexts,
        body.body_id,
        body.box_x::float8 AS body_box_x,
        body.box_y::float8 AS body_box_y,
        body.box_w::float8 AS body_box_w,
        body.box_h::float8 AS body_box_h,
        body.quality_measurements AS body_quality_measurements,
        body.assigned_person_id AS body_assigned_person_id,
        body.link_origin AS body_link_origin,
        body.supporting_face_id AS body_supporting_face_id,
        coalesce(
          body.assigned_person_id = ${String(personId || "")} AND NOT (
          body.link_origin = 'face_body_linkage' AND body.supporting_face_id = pf.face_id
          ),
          false
        ) AS body_selected,
        coalesce(
          body.assigned_person_id = ${String(personId || "")} AND
          body.link_origin = 'face_body_linkage' AND body.supporting_face_id = pf.face_id,
          false
        ) AS body_linked
      FROM page_faces pf
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS nearby_face_count
        FROM face_observation other
        WHERE other.asset_id = pf.asset_id
          AND other.face_id <> pf.face_id
          AND other.state = 'valid'
          AND (
            abs(other.box_x - pf.box_x) > 0.002 OR
            abs(other.box_y - pf.box_y) > 0.002 OR
            abs(other.box_w - pf.box_w) > 0.002 OR
            abs(other.box_h - pf.box_h) > 0.002
          )
          AND (other.box_x + other.box_w / 2) BETWEEN
            greatest(0, pf.box_x + pf.box_w / 2 - 1.2 * pf.box_w) AND
            least(1, pf.box_x + pf.box_w / 2 + 1.2 * pf.box_w)
          AND (other.box_y + other.box_h / 2) BETWEEN
            greatest(0, pf.box_y + pf.box_h / 2 - 1.2 * pf.box_h) AND
            least(1, pf.box_y + pf.box_h / 2 + 1.2 * pf.box_h)
      ) nearby ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'bucket_id', g.bucket_id,
            'bucket_kind', g.bucket_kind,
            'bucket_name', g.bucket_name,
            'latest_action', g.latest_action
          )
          ORDER BY CASE g.bucket_kind WHEN 'prime' THEN 0 WHEN 'secondary' THEN 1 ELSE 2 END, g.bucket_name
        ) AS buckets
        FROM current_reference_gallery g
        WHERE g.person_id = pf.person_id
          AND g.face_id = pf.face_id
          AND g.membership_state = 'active'
      ) gallery ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'modifierKey', modifier.modifier_key,
            'modifierLabel', modifier.modifier_label,
            'modifierClass', modifier.modifier_class,
            'actorKind', modifier.actor_kind,
            'confidence', modifier.confidence,
            'metadata', modifier.metadata
          ) ORDER BY modifier.modifier_label, modifier.modifier_key
        ) AS items
        FROM current_face_modifier modifier
        WHERE modifier.face_id = pf.face_id
      ) modifiers ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'proposalId', proposal.proposal_id,
            'modifierKey', proposal.modifier_key,
            'modifierLabel', proposal.modifier_label,
            'modifierClass', proposal.modifier_class,
            'confidence', proposal.calibrated_confidence,
            'providerName', proposal.provider_name,
            'modelName', proposal.model_name,
            'modelVersion', proposal.model_version,
            'vocabularyVersion', proposal.vocabulary_version,
            'evidence', proposal.evidence,
            'state', proposal.state,
            'proposedAt', proposal.proposed_at
          ) ORDER BY proposal.calibrated_confidence DESC, proposal.modifier_label,
            proposal.proposal_id
        ) AS items
        FROM current_face_modifier_proposal proposal
        WHERE proposal.face_id = pf.face_id AND proposal.state = 'candidate'
      ) proposals ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'contextId', context.context_id,
            'contextKind', context.context_kind,
            'label', context.label,
            'memberCount', context.member_count,
            'memberIndex', context.member_index,
            'confidence', context.context_confidence,
            'groupingFeatures', context.grouping_features
          ) ORDER BY context.context_kind, context.context_id
        ) AS items
        FROM current_face_capture_context context
        WHERE context.face_id = pf.face_id
      ) contexts ON true
      LEFT JOIN LATERAL (
        SELECT bo.body_id, bo.box_x, bo.box_y, bo.box_w, bo.box_h, bo.quality_measurements,
          current_tag.person_id AS assigned_person_id,
          current_tag.origin AS link_origin,
          current_tag.supporting_face_id
        FROM body_observation bo
        LEFT JOIN LATERAL (
          SELECT bt.person_id, bt.origin, bt.supporting_face_id
          FROM current_body_tag bt
          WHERE bt.body_id = bo.body_id AND bt.state = 'accepted'
          ORDER BY bt.created_at DESC, bt.body_tag_id DESC
          LIMIT 1
        ) current_tag ON true
        WHERE bo.asset_id = pf.asset_id
          AND bo.state = 'valid'
          AND (pf.box_x + pf.box_w / 2) BETWEEN bo.box_x AND bo.box_x + bo.box_w
          AND (pf.box_y + pf.box_h / 2) BETWEEN bo.box_y AND bo.box_y + bo.box_h
        ORDER BY (current_tag.origin = 'face_body_linkage' AND current_tag.supporting_face_id = pf.face_id) DESC NULLS LAST,
          (current_tag.person_id = pf.person_id) DESC NULLS LAST,
          (bo.box_w * bo.box_h) ASC,
          (bo.quality_measurements->>'quality_score')::float8 DESC NULLS LAST,
          bo.body_id
        LIMIT 1
      ) body ON true
      ORDER BY pf.capture_time DESC NULLS LAST, pf.quality_sort DESC NULLS LAST,
        pf.face_id
    `;

      const hasMore = paged && rows.length > boundedLimit;
      const pageRows = hasMore ? rows.slice(0, boundedLimit) : rows;
      const items = pageRows.map((row) => {
        const mainBucket = row.buckets.find((bucket) =>
          ["head", "lq", "prime", "secondary"].includes(bucket.bucket_kind),
        );
        return {
          ...row,
          main_evidence_tier: mainBucket?.bucket_kind || "face_only",
          ...identityQcFields(row),
          ...bridgeFields(bridge, row.asset_id),
        };
      });
      if (!paged) return items;
      const last = pageRows.at(-1);
      const lastQuality = Number(last?.quality_measurements?.quality_score);
      return {
        items,
        nextCursor:
          hasMore && last
            ? encodePersonPageCursor({
                captureTime: last.capture_time
                  ? new Date(last.capture_time).toISOString()
                  : null,
                faceId: last.face_id,
                kind: "identity",
                personId: id,
                quality: Number.isFinite(lastQuality) ? lastQuality : null,
                visibleRank,
              })
            : null,
        pageSize: boundedLimit,
        schemaVersion: personPageSchemaVersion,
      };
    },

    async setFaceBucket({ actorId, bucketKind, faceId, personId }) {
      if (![null, "prime", "secondary", "lq", "head"].includes(bucketKind)) {
        throw Object.assign(
          new Error(
            "Face evidence must be prime, secondary, LQ, head, or face only",
          ),
          { statusCode: 400 },
        );
      }
      const actor = cleanActor(actorId);
      if (!actor) {
        throw Object.assign(new Error("Missing Cimmich actor"), {
          statusCode: 400,
        });
      }
      if (await isHoldingPerson(sql, personId)) {
        throw Object.assign(
          new Error(
            "Holding faces must move to a real Person before entering matching buckets",
          ),
          { statusCode: 409 },
        );
      }

      const result = await sql.begin(async (tx) => {
        const [identity] = await tx`
        SELECT ic.identity_claim_id
        FROM identity_claim ic
        JOIN person subject ON subject.person_id = ic.person_id
          AND subject.status = 'active' AND subject.subject_kind = 'person'
        WHERE ic.face_id = ${faceId} AND ic.person_id = ${personId} AND ic.state = 'accepted'
        LIMIT 1
        FOR UPDATE
      `;
        if (!identity) {
          throw Object.assign(new Error("Accepted face identity not found"), {
            statusCode: 404,
          });
        }

        const current = await tx`
        SELECT g.bucket_id, g.bucket_kind
        FROM current_reference_gallery g
        WHERE g.person_id = ${personId}
          AND g.face_id = ${faceId}
          AND g.bucket_kind IN ('prime', 'secondary', 'lq', 'head')
          AND g.membership_state = 'active'
        ORDER BY g.bucket_kind
      `;
        if (
          current.length === (bucketKind ? 1 : 0) &&
          (!bucketKind || current[0]?.bucket_kind === bucketKind)
        ) {
          return { bucketKind, changed: false, faceId, personId };
        }

        const now = new Date();
        await tx`
        INSERT INTO producer_receipt (
          producer_receipt_id, producer_kind, producer_name, producer_version,
          started_at, completed_at, privacy_class
        ) VALUES (
          ${userCommandReceiptId}, 'user', 'cimmich-local-identity-commands', 'v1',
          ${now}, ${now}, 'private'
        ) ON CONFLICT (producer_receipt_id) DO NOTHING
      `;
        const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
        await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'face_bucket_membership', ${`${personId}:${faceId}`},
          ${bucketKind === "prime" ? "promote" : "demote"}, 'user', ${actor},
          'identity_workspace', ${
            bucketKind === "head"
              ? "Set head identity evidence"
              : bucketKind === "lq"
                ? "Set condition-routed low-quality face reference"
                : bucketKind
                  ? `Set ${bucketKind} face reference`
                  : "Remove face reference bucket"
          },
          ${userCommandReceiptId}, 'sensitive-biometric'
        )
      `;

        if (bucketKind === "head") {
          const specialty = await tx`
          SELECT g.bucket_id
          FROM current_reference_gallery g
          WHERE g.person_id = ${personId} AND g.face_id = ${faceId}
            AND g.bucket_kind = 'specialty' AND g.membership_state = 'active'
        `;
          for (const row of specialty) {
            await tx`
            INSERT INTO bucket_membership_event (
              membership_event_id, bucket_id, face_id, action, actor_kind,
              reason_code, reason_text, producer_receipt_id, privacy_class
            ) VALUES (
              ${`membership_${randomUUID().replaceAll("-", "")}`}, ${row.bucket_id}, ${faceId},
              'remove', 'user', 'identity_workspace_head', 'Head evidence cannot train Specialty matching',
              ${userCommandReceiptId}, 'sensitive-biometric'
            )
          `;
          }
        }

        for (const row of current) {
          if (row.bucket_kind === bucketKind) {
            continue;
          }
          await tx`
          INSERT INTO bucket_membership_event (
            membership_event_id, bucket_id, face_id, action, actor_kind,
            reason_code, reason_text, producer_receipt_id, privacy_class
          ) VALUES (
            ${`membership_${randomUUID().replaceAll("-", "")}`}, ${row.bucket_id}, ${faceId},
            'remove', 'user', 'identity_workspace', 'Moved or removed by user',
            ${userCommandReceiptId}, 'sensitive-biometric'
          )
        `;
        }

        if (
          bucketKind &&
          !current.some((row) => row.bucket_kind === bucketKind)
        ) {
          let [target] = await tx`
          SELECT bucket_id
          FROM reference_bucket
          WHERE person_id = ${personId} AND bucket_kind = ${bucketKind} AND state = 'active'
          LIMIT 1
        `;
          if (!target && (bucketKind === "head" || bucketKind === "lq")) {
            await tx`
            INSERT INTO reference_bucket (
              bucket_id, person_id, bucket_kind, name, activation_hints,
              created_by, policy_version, state, producer_receipt_id, privacy_class
            ) SELECT
              ${`bucket_${randomUUID().replaceAll("-", "")}`}, ${personId}, ${bucketKind}, NULL, NULL,
              'user', ${bucketKind === "head" ? "cimmich-head-evidence-v1" : "cimmich-low-quality-condition-v1"},
              'active', ${userCommandReceiptId}, 'sensitive-biometric'
            WHERE NOT EXISTS (
              SELECT 1 FROM reference_bucket
              WHERE person_id = ${personId} AND bucket_kind = ${bucketKind} AND state = 'active'
            )
            ON CONFLICT DO NOTHING
          `;
            [target] = await tx`
            SELECT bucket_id
            FROM reference_bucket
            WHERE person_id = ${personId} AND bucket_kind = ${bucketKind} AND state = 'active'
            LIMIT 1
          `;
          }
          if (!target) {
            throw Object.assign(new Error("Reference bucket not found"), {
              statusCode: 404,
            });
          }
          await tx`
          INSERT INTO bucket_membership_event (
            membership_event_id, bucket_id, face_id, action, actor_kind,
            reason_code, reason_text, producer_receipt_id, privacy_class
          ) VALUES (
            ${`membership_${randomUUID().replaceAll("-", "")}`}, ${target.bucket_id}, ${faceId},
            'pin', 'user', 'identity_workspace', 'Selected by user',
            ${userCommandReceiptId}, 'sensitive-biometric'
          )
        `;
        }

        return { bucketKind, changed: true, decisionId, faceId, personId };
      });
      const maintenancePending = result.changed
        ? await refreshPrimeAfterCommand(sql, personId)
        : false;
      if (result.changed) {
        invalidateMachineSuggestions();
      }
      return { ...result, maintenancePending };
    },

    async setFaceModifier({
      actorId,
      faceId,
      modifierName,
      personId,
      selected,
    }) {
      const actor = cleanActor(actorId);
      if (!actor) {
        throw Object.assign(new Error("Missing Cimmich actor"), {
          statusCode: 400,
        });
      }
      if (typeof selected !== "boolean") {
        throw Object.assign(
          new Error("Modifier selection must be true or false"),
          { statusCode: 400 },
        );
      }
      const modifierLabel = cleanModifierName(modifierName);
      const modifierKey = modifierKeyFromName(modifierLabel);
      if (!modifierKey) {
        throw Object.assign(new Error("Modifier name is not usable"), {
          statusCode: 400,
        });
      }
      return sql.begin(async (tx) => {
        const [identity] = await tx`
        SELECT identity_claim_id
        FROM identity_claim
        WHERE face_id = ${faceId} AND person_id = ${personId} AND state = 'accepted'
        LIMIT 1
        FOR UPDATE
      `;
        if (!identity) {
          throw Object.assign(new Error("Accepted face identity not found"), {
            statusCode: 404,
          });
        }
        const [current] = await tx`
        SELECT modifier_event_id, modifier_label
        FROM current_face_modifier
        WHERE face_id = ${faceId} AND modifier_key = ${modifierKey}
        LIMIT 1
      `;
        if ((selected && current) || (!selected && !current)) {
          return {
            changed: false,
            faceId,
            modifierKey,
            modifierName: current?.modifier_label || modifierLabel,
            specialtyName: current?.modifier_label || modifierLabel,
            personId,
            selected,
          };
        }

        await ensureUserCommandReceipt(tx);
        const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
        const modifierEventId = `modifier_${randomUUID().replaceAll("-", "")}`;
        await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'face_modifier', ${`${personId}:${faceId}:${modifierKey}`},
          ${selected ? "pin" : "demote"}, 'user', ${actor},
          'identity_workspace_modifier',
          ${selected ? `Add modifier — ${modifierLabel}` : `Remove modifier — ${current?.modifier_label || modifierLabel}`},
          ${userCommandReceiptId}, 'private'
        )
      `;
        await tx`
        INSERT INTO face_modifier_event (
          modifier_event_id, face_id, modifier_key, modifier_label,
          modifier_class, action, actor_kind, actor_id, confidence, metadata,
          decision_id, supersedes_event_id, producer_receipt_id, privacy_class
        ) VALUES (
          ${modifierEventId}, ${faceId}, ${modifierKey},
          ${current?.modifier_label || modifierLabel}, 'condition',
          ${selected ? "add" : "remove"}, 'user', ${actor}, 1,
          ${tx.json({ personId, source: "identity_workspace" })},
          ${decisionId}, ${current?.modifier_event_id || null},
          ${userCommandReceiptId}, 'sensitive-biometric'
        )
      `;
        return {
          changed: true,
          decisionId,
          faceId,
          modifierEventId,
          modifierKey,
          modifierName: current?.modifier_label || modifierLabel,
          specialtyName: current?.modifier_label || modifierLabel,
          personId,
          selected,
        };
      });
    },

    async decideFaceModifierProposal({
      action,
      actorId,
      personId,
      proposalId,
    }) {
      const actor = cleanActor(actorId);
      if (!actor) {
        throw Object.assign(new Error("Missing Cimmich actor"), {
          statusCode: 400,
        });
      }
      if (!["accept", "reject"].includes(action)) {
        throw Object.assign(
          new Error("Modifier proposal decision must be accept or reject"),
          { statusCode: 400 },
        );
      }
      return sql.begin(async (tx) => {
        const [proposal] = await tx`
        SELECT current.proposal_id, current.face_id, current.modifier_key,
          current.modifier_label, current.modifier_class,
          current.provider_name, current.model_name, current.model_version,
          current.config_digest, current.vocabulary_version,
          current.calibrated_confidence::float8, current.evidence,
          current.state, current.proposal_event_id
        FROM face_modifier_proposal source
        JOIN current_face_modifier_proposal current
          ON current.proposal_id = source.proposal_id
        JOIN current_face_identity identity
          ON identity.face_id = current.face_id
          AND identity.person_id = ${String(personId || "")}
          AND identity.state = 'accepted'
        WHERE source.proposal_id = ${String(proposalId || "")}
        FOR UPDATE OF source
      `;
        if (!proposal) {
          throw Object.assign(new Error("Modifier proposal not found"), {
            statusCode: 404,
          });
        }
        if (proposal.state !== "candidate") {
          throw Object.assign(
            new Error("Modifier proposal has already been decided"),
            { statusCode: 409 },
          );
        }

        await ensureUserCommandReceipt(tx);
        const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
        const proposalEventId = `modifier_proposal_event_${randomUUID().replaceAll("-", "")}`;
        await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'face_modifier_proposal', ${proposal.proposal_id},
          ${action}, 'user', ${actor}, 'modifier_proposal_review',
          ${`${action === "accept" ? "Accept" : "Reject"} ${proposal.modifier_label} proposal from ${proposal.provider_name}/${proposal.model_name}`},
          ${userCommandReceiptId}, 'private'
        )
      `;

        let modifierEventId = null;
        if (action === "accept") {
          const [currentModifier] = await tx`
          SELECT modifier_event_id
          FROM current_face_modifier
          WHERE face_id = ${proposal.face_id}
            AND modifier_key = ${proposal.modifier_key}
          LIMIT 1
        `;
          if (!currentModifier) {
            modifierEventId = `modifier_${randomUUID().replaceAll("-", "")}`;
            await tx`
            INSERT INTO face_modifier_event (
              modifier_event_id, face_id, modifier_key, modifier_label,
              modifier_class, action, actor_kind, actor_id, confidence,
              metadata, decision_id, producer_receipt_id, privacy_class
            ) VALUES (
              ${modifierEventId}, ${proposal.face_id}, ${proposal.modifier_key},
              ${proposal.modifier_label}, 'condition', 'add', 'user', ${actor}, 1,
              ${tx.json({
                configDigest: proposal.config_digest,
                modelName: proposal.model_name,
                modelVersion: proposal.model_version,
                proposalConfidence: proposal.calibrated_confidence,
                proposalId: proposal.proposal_id,
                providerName: proposal.provider_name,
                source: "accepted_modifier_proposal",
                vocabularyVersion: proposal.vocabulary_version,
              })},
              ${decisionId}, ${userCommandReceiptId}, 'sensitive-biometric'
            )
          `;
          }
        }

        await tx`
        INSERT INTO face_modifier_proposal_event (
          proposal_event_id, proposal_id, action, actor_kind, actor_id,
          note, metadata, decision_id, supersedes_event_id,
          producer_receipt_id, privacy_class
        ) VALUES (
          ${proposalEventId}, ${proposal.proposal_id}, ${action}, 'user', ${actor},
          ${action === "accept" ? "Accepted modifier proposal" : "Rejected modifier proposal"},
          ${tx.json({ modifierEventId })}, ${decisionId},
          ${proposal.proposal_event_id}, ${userCommandReceiptId},
          'sensitive-biometric'
        )
      `;
        return {
          action,
          changed: true,
          decisionId,
          faceId: proposal.face_id,
          modifierEventId,
          modifierKey: proposal.modifier_key,
          modifierName: proposal.modifier_label,
          personId,
          proposalEventId,
          proposalId: proposal.proposal_id,
          state: action,
        };
      });
    },

    async createCaptureContext({ actorId, assetIds, contextKind, label = "" }) {
      const actor = cleanActor(actorId);
      if (!actor) {
        throw Object.assign(new Error("Missing Cimmich actor"), {
          statusCode: 400,
        });
      }
      const kind = cleanCaptureContextKind(contextKind);
      const members = [
        ...new Set(
          (Array.isArray(assetIds) ? assetIds : [])
            .map((value) => String(value || "").trim())
            .filter(Boolean),
        ),
      ];
      if (members.length < 2 || members.length > 200) {
        throw Object.assign(
          new Error("Capture context requires 2 to 200 unique assets"),
          { statusCode: 400 },
        );
      }
      const contextLabel = String(label || "")
        .trim()
        .slice(0, 160);
      return sql.begin(async (tx) => {
        const assets = await tx`
        SELECT asset_id, capture_time
        FROM asset
        WHERE asset_id = ANY(${members}) AND state = 'active'
        FOR SHARE
      `;
        if (assets.length !== members.length) {
          throw Object.assign(
            new Error("One or more capture assets were not found"),
            {
              statusCode: 404,
            },
          );
        }
        await ensureUserCommandReceipt(tx);
        const contextId = `context_${randomUUID().replaceAll("-", "")}`;
        const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
        const times = assets
          .map((asset) => asset.capture_time)
          .filter(Boolean)
          .map((value) => new Date(value));
        const startTime = times.length
          ? new Date(Math.min(...times.map((value) => value.getTime())))
          : null;
        const endTime = times.length
          ? new Date(Math.max(...times.map((value) => value.getTime())))
          : null;
        await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'capture_context', ${contextId}, 'pin', 'user', ${actor},
          'capture_context_group',
          ${contextLabel || `${kind.replaceAll("_", " ")} · ${members.length} assets`},
          ${userCommandReceiptId}, 'private'
        )
      `;
        await tx`
        INSERT INTO capture_context (
          context_id, context_kind, label, state, start_time, end_time,
          confidence, grouping_features, created_by, actor_id, decision_id,
          producer_receipt_id, privacy_class
        ) VALUES (
          ${contextId}, ${kind}, ${contextLabel}, 'active', ${startTime}, ${endTime},
          1, ${tx.json({ explicitUserGrouping: true, memberCount: members.length })},
          'user', ${actor}, ${decisionId}, ${userCommandReceiptId}, 'private'
        )
      `;
        for (const [memberIndex, assetId] of members.entries()) {
          await tx`
          INSERT INTO capture_context_member_event (
            membership_event_id, context_id, asset_id, action, member_index,
            actor_kind, actor_id, confidence, reason_code, metadata,
            producer_receipt_id, privacy_class
          ) VALUES (
            ${`context_member_${randomUUID().replaceAll("-", "")}`},
            ${contextId}, ${assetId}, 'add', ${memberIndex}, 'user', ${actor}, 1,
            'explicit_capture_context', ${tx.json({ decisionId })},
            ${userCommandReceiptId}, 'private'
          )
        `;
        }
        return {
          assetIds: members,
          changed: true,
          contextId,
          contextKind: kind,
          decisionId,
          label: contextLabel,
          memberCount: members.length,
        };
      });
    },

    async captureContextPresenceCandidates({ contextId }) {
      return sql`
      SELECT context_id, person_id, asset_id, supporting_asset_count,
        confidence::float8, evidence_refs
      FROM capture_context_presence_candidate
      WHERE context_id = ${String(contextId || "")}
      ORDER BY person_id, asset_id
    `;
    },

    async setFaceSpecialty({
      actorId,
      faceId,
      personId,
      selected,
      specialtyName,
    }) {
      const actor = cleanActor(actorId);
      if (!actor) {
        throw Object.assign(new Error("Missing Cimmich actor"), {
          statusCode: 400,
        });
      }
      if (await isHoldingPerson(sql, personId)) {
        throw Object.assign(
          new Error(
            "Holding faces must move to a real Person before entering Specialty",
          ),
          { statusCode: 409 },
        );
      }
      if (typeof selected !== "boolean") {
        throw Object.assign(
          new Error("Specialty selection must be true or false"),
          { statusCode: 400 },
        );
      }
      const name = cleanSpecialtyName(specialtyName);
      return sql.begin(async (tx) => {
        const [identity] = await tx`
        SELECT identity_claim_id
        FROM identity_claim
        WHERE face_id = ${faceId} AND person_id = ${personId} AND state = 'accepted'
        LIMIT 1
        FOR UPDATE
      `;
        if (!identity) {
          throw Object.assign(new Error("Accepted face identity not found"), {
            statusCode: 404,
          });
        }

        if (selected) {
          const [head] = await tx`
          SELECT bucket_id
          FROM current_reference_gallery
          WHERE person_id = ${personId} AND face_id = ${faceId}
            AND bucket_kind = 'head' AND membership_state = 'active'
          LIMIT 1
        `;
          if (head) {
            throw Object.assign(
              new Error("Head evidence cannot be used as a matching Specialty"),
              { statusCode: 409 },
            );
          }
        }

        let [bucket] = await tx`
        SELECT bucket_id
        FROM reference_bucket
        WHERE person_id = ${personId} AND bucket_kind = 'specialty'
          AND lower(name) = lower(${name}) AND state IN ('candidate', 'active')
        LIMIT 1
        FOR UPDATE
      `;
        const [current] = bucket
          ? await tx`
            SELECT bucket_id
            FROM current_reference_gallery
            WHERE bucket_id = ${bucket.bucket_id} AND face_id = ${faceId} AND membership_state = 'active'
            LIMIT 1
          `
          : [];
        if ((selected && current) || (!selected && !current)) {
          return {
            changed: false,
            faceId,
            personId,
            selected,
            specialtyName: name,
          };
        }

        const now = new Date();
        await tx`
        INSERT INTO producer_receipt (
          producer_receipt_id, producer_kind, producer_name, producer_version,
          started_at, completed_at, privacy_class
        ) VALUES (
          ${userCommandReceiptId}, 'user', 'cimmich-local-identity-commands', 'v1',
          ${now}, ${now}, 'private'
        ) ON CONFLICT (producer_receipt_id) DO UPDATE SET completed_at = excluded.completed_at
      `;
        if (selected && !bucket) {
          const bucketId = `bucket_${randomUUID().replaceAll("-", "")}`;
          [bucket] = await tx`
          INSERT INTO reference_bucket (
            bucket_id, person_id, bucket_kind, name, activation_hints,
            created_by, policy_version, state, producer_receipt_id, privacy_class
          ) VALUES (
            ${bucketId}, ${personId}, 'specialty', ${name},
            ${tx.json({
              condition: name
                .toLowerCase()
                .replace(/[^\p{L}\p{N}]+/gu, "_")
                .replace(/^_+|_+$/g, ""),
            })},
            'user', 'cimmich-user-specialty-v1', 'active',
            ${userCommandReceiptId}, 'sensitive-biometric'
          )
          RETURNING bucket_id
        `;
        }

        const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
        await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'face_bucket_membership', ${`${personId}:${faceId}:specialty:${name}`},
          ${selected ? "pin" : "demote"}, 'user', ${actor},
          'identity_workspace_specialty', ${selected ? `Add Specialty — ${name}` : `Remove Specialty — ${name}`},
          ${userCommandReceiptId}, 'sensitive-biometric'
        )
      `;
        await tx`
        INSERT INTO bucket_membership_event (
          membership_event_id, bucket_id, face_id, action, actor_kind,
          reason_code, reason_text, producer_receipt_id, privacy_class
        ) VALUES (
          ${`membership_${randomUUID().replaceAll("-", "")}`}, ${bucket.bucket_id}, ${faceId},
          ${selected ? "pin" : "remove"}, 'user', 'identity_workspace_specialty',
          ${selected ? `Observed Specialty — ${name}` : `Removed Specialty — ${name}`},
          ${userCommandReceiptId}, 'sensitive-biometric'
        )
      `;
        return {
          changed: true,
          decisionId,
          faceId,
          personId,
          selected,
          specialtyName: name,
        };
      });
    },

    async setBodySelection({ actorId, bodyId, personId, selected }) {
      await requireVisibleSubject(personId);
      const actor = cleanActor(actorId);
      if (!actor) {
        throw Object.assign(new Error("Missing Cimmich actor"), {
          statusCode: 400,
        });
      }
      if (typeof selected !== "boolean") {
        throw Object.assign(new Error("Body selection must be true or false"), {
          statusCode: 400,
        });
      }

      return sql.begin(async (tx) => {
        const [subject] = await tx`
        SELECT person_id
        FROM person
        WHERE person_id = ${personId} AND status = 'active' AND subject_kind = 'person'
        FOR UPDATE
      `;
        if (!subject) {
          throw Object.assign(new Error("Active Person not found"), {
            statusCode: 404,
          });
        }
        const [body] =
          await tx`SELECT body_id FROM body_observation WHERE body_id = ${bodyId} AND state = 'valid' FOR UPDATE`;
        if (!body) {
          throw Object.assign(new Error("Body observation not found"), {
            statusCode: 404,
          });
        }
        const [current] = await tx`
        SELECT body_tag_id, person_id, state
        FROM current_body_tag
        WHERE body_id = ${bodyId}
        ORDER BY created_at DESC, body_tag_id DESC
        LIMIT 1
      `;
        if (
          selected &&
          current?.state === "accepted" &&
          current.person_id !== personId
        ) {
          throw Object.assign(
            new Error("Body is already assigned to another person"),
            { statusCode: 409 },
          );
        }
        if (
          !selected &&
          current?.state === "accepted" &&
          current.person_id !== personId
        ) {
          throw Object.assign(
            new Error(
              "Body belongs to another Person and cannot be removed here",
            ),
            { statusCode: 409 },
          );
        }
        if (
          (selected &&
            current?.state === "accepted" &&
            current.person_id === personId) ||
          (!selected && current?.state !== "accepted")
        ) {
          return { bodyId, changed: false, personId, selected };
        }

        const now = new Date();
        await tx`
        INSERT INTO producer_receipt (
          producer_receipt_id, producer_kind, producer_name, producer_version,
          started_at, completed_at, privacy_class
        ) VALUES (
          ${userCommandReceiptId}, 'user', 'cimmich-local-identity-commands', 'v1',
          ${now}, ${now}, 'private'
        ) ON CONFLICT (producer_receipt_id) DO NOTHING
      `;
        const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
        await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'body_observation', ${bodyId}, ${selected ? "accept" : "reject"},
          'user', ${actor}, 'identity_workspace', ${selected ? "Selected as body reference" : "Removed as body reference"},
          ${userCommandReceiptId}, 'private'
        )
      `;
        if (current) {
          await tx`UPDATE body_tag SET state = 'superseded' WHERE body_tag_id = ${current.body_tag_id}`;
        }
        const bodyTagId = `body_tag_${randomUUID().replaceAll("-", "")}`;
        await tx`
        INSERT INTO body_tag (
          body_tag_id, person_id, body_id, origin, state, decision_id,
          supersedes_body_tag_id, producer_receipt_id, privacy_class
        ) VALUES (
          ${bodyTagId}, ${personId}, ${bodyId}, 'user', ${selected ? "accepted" : "rejected"}, ${decisionId},
          ${current?.body_tag_id || null}, ${userCommandReceiptId}, 'private'
        )
      `;
        return {
          bodyId,
          bodyTagId,
          changed: true,
          decisionId,
          personId,
          selected,
        };
      });
    },

    async setAssetHeadEvidence({ actorId, assetId, personId, selected }) {
      await requireVisibleSubject(personId);
      const actor = cleanActor(actorId);
      if (!actor) {
        throw Object.assign(new Error("Missing Cimmich actor"), {
          statusCode: 400,
        });
      }
      if (typeof selected !== "boolean") {
        throw Object.assign(
          new Error("Head evidence selection must be true or false"),
          { statusCode: 400 },
        );
      }

      return sql.begin(async (tx) => {
        const [current] = await tx`
        SELECT pt.presence_tag_id, pt.reason_code
        FROM presence_tag pt
        JOIN person p ON p.person_id = pt.person_id
          AND p.status = 'active' AND p.subject_kind = 'person'
        JOIN asset a ON a.asset_id = pt.asset_id AND a.state = 'active'
        WHERE pt.person_id = ${personId} AND pt.asset_id = ${assetId} AND pt.state = 'accepted'
        LIMIT 1
        FOR UPDATE OF pt
      `;
        if (!current) {
          throw Object.assign(
            new Error("Accepted asset presence evidence not found"),
            { statusCode: 404 },
          );
        }
        const nextReason = selected ? "head_evidence" : "manual_presence";
        if (current.reason_code === nextReason) {
          return { assetId, changed: false, personId, selected };
        }

        const now = new Date();
        await tx`
        INSERT INTO producer_receipt (
          producer_receipt_id, producer_kind, producer_name, producer_version,
          started_at, completed_at, privacy_class
        ) VALUES (
          ${userCommandReceiptId}, 'user', 'cimmich-local-identity-commands', 'v1',
          ${now}, ${now}, 'private'
        ) ON CONFLICT (producer_receipt_id) DO NOTHING
      `;
        const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
        await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'asset_person_evidence', ${`${personId}:${assetId}`}, 'classify',
          'user', ${actor}, 'identity_workspace',
          ${selected ? "Classified as visible head evidence" : "Returned to presence-only evidence"},
          ${userCommandReceiptId}, 'private'
        )
      `;
        await tx`UPDATE presence_tag SET state = 'superseded' WHERE presence_tag_id = ${current.presence_tag_id}`;
        const presenceTagId = `presence_tag_${randomUUID().replaceAll("-", "")}`;
        await tx`
        INSERT INTO presence_tag (
          presence_tag_id, person_id, asset_id, origin, reason_code, note, state,
          decision_id, supersedes_presence_tag_id, producer_receipt_id, privacy_class
        ) VALUES (
          ${presenceTagId}, ${personId}, ${assetId}, 'user', ${nextReason},
          ${selected ? "Head is visible but no reliable face observation exists" : "Person is present without usable head evidence"},
          'accepted', ${decisionId}, ${current.presence_tag_id}, ${userCommandReceiptId}, 'private'
        )
      `;
        return {
          assetId,
          changed: true,
          decisionId,
          personId,
          presenceTagId,
          selected,
        };
      });
    },

    async decideIdentityClaim({ action, actorId, claimId, note = "" }) {
      if (!["accept", "reject", "restore"].includes(action)) {
        throw Object.assign(
          new Error("Decision must be accept, reject or restore"),
          {
            statusCode: 400,
          },
        );
      }
      const actor = cleanActor(actorId);
      if (!actor) {
        throw Object.assign(new Error("Missing Cimmich actor"), {
          statusCode: 400,
        });
      }

      const result = await sql.begin(async (tx) => {
        const [claim] = await tx`
        SELECT identity_claim_id, face_id, person_id, state, decision_id
        FROM identity_claim
        WHERE identity_claim_id = ${claimId}
        FOR UPDATE
      `;
        if (!claim) {
          throw Object.assign(new Error("Identity claim not found"), {
            statusCode: 404,
          });
        }
        const requiredState = action === "restore" ? "rejected" : "candidate";
        if (claim.state !== requiredState) {
          return {
            changed: false,
            claimId,
            decisionId: claim.decision_id,
            state: claim.state,
          };
        }

        if (action === "accept" || action === "restore") {
          const [conflict] = await tx`
          SELECT identity_claim_id, person_id
          FROM identity_claim
          WHERE face_id = ${claim.face_id} AND state = 'accepted'
          LIMIT 1
        `;
          if (conflict) {
            throw Object.assign(
              new Error("Face already has an accepted identity"),
              {
                details: {
                  acceptedClaimId: conflict.identity_claim_id,
                  acceptedPersonId: conflict.person_id,
                },
                statusCode: 409,
              },
            );
          }
        }

        const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
        const now = new Date();
        await tx`
        INSERT INTO producer_receipt (
          producer_receipt_id, producer_kind, producer_name, producer_version,
          started_at, completed_at, privacy_class
        ) VALUES (
          ${decisionReceiptId}, 'user', 'cimmich-local-review-service', 'v1',
          ${now}, ${now}, 'private'
        ) ON CONFLICT (producer_receipt_id) DO NOTHING
      `;
        await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'identity_claim', ${claimId}, ${action}, 'user', ${actor},
          ${action === "restore" ? "operator_review_restore" : "operator_review"},
          ${String(note || "").slice(0, 1000)}, ${decisionReceiptId}, 'private'
        )
      `;
        const [updated] = await tx`
        UPDATE identity_claim
        SET state = ${action === "accept" ? "accepted" : action === "restore" ? "candidate" : "rejected"},
          decision_id = ${action === "restore" ? null : decisionId}
        WHERE identity_claim_id = ${claimId} AND state = ${requiredState}
        RETURNING identity_claim_id, face_id, person_id, state, decision_id
      `;
        if (action === "accept") {
          const competingDecisionId = `decision_${randomUUID().replaceAll("-", "")}`;
          await tx`
          INSERT INTO decision (
            decision_id, subject_type, subject_id, action, actor_kind, actor_id,
            reason_code, note, producer_receipt_id, privacy_class
          ) VALUES (
            ${competingDecisionId}, 'face_identity', ${updated.face_id}, 'reject', 'user', ${actor},
            'competing_identity_superseded', 'Supersede competing candidates after one identity was accepted',
            ${decisionReceiptId}, 'sensitive-biometric'
          )
        `;
          await tx`
          UPDATE identity_claim
          SET state = 'superseded', decision_id = ${competingDecisionId}
          WHERE face_id = ${updated.face_id}
            AND identity_claim_id <> ${updated.identity_claim_id}
            AND state = 'candidate'
        `;
        }
        return {
          changed: true,
          claimId,
          decisionId,
          faceId: updated.face_id,
          personId: updated.person_id,
          state: updated.state,
        };
      });
      const maintenancePending =
        result.changed && result.state === "accepted"
          ? await refreshPrimeAfterCommand(sql, result.personId)
          : false;
      invalidateMachineSuggestions();
      return { ...result, maintenancePending };
    },

    async setFaceReviewDisposition({
      actorId,
      commandId,
      disposition,
      faceId,
    }) {
      const actor = cleanActor(actorId);
      if (!actor) {
        throw typedError(
          "Missing Cimmich actor",
          400,
          "FACE_REVIEW_ACTOR_REQUIRED",
        );
      }
      if (!["active", "later", "unknown"].includes(disposition)) {
        throw typedError(
          "Face review disposition must be active, later or unknown",
          400,
          "FACE_REVIEW_DISPOSITION_INVALID",
        );
      }
      const stableCommandId = cleanIdentityCommandId(commandId);
      const stableDecisionId = identityDecisionIdFor(
        `face_review_${disposition}`,
        stableCommandId,
      );
      return sql.begin(async (tx) => {
        const [face] = await tx`
          SELECT face.face_id
          FROM face_observation face
          JOIN asset ON asset.asset_id = face.asset_id AND asset.state = 'active'
          WHERE face.face_id = ${faceId} AND face.state = 'valid'
            AND cimmich_visibility_asset_rank(asset.asset_id) <= ${presentationRank()}
          FOR UPDATE OF face
        `;
        if (!face) {
          throw typedError(
            "Visible Face not found",
            404,
            "FACE_REVIEW_NOT_FOUND",
          );
        }
        const [replay] = await tx`
          SELECT decision_id, actor_id, reason_code
          FROM decision
          WHERE decision_id = ${stableDecisionId}
        `;
        const reasonCode =
          disposition === "later"
            ? "face_review_later"
            : disposition === "unknown"
              ? "face_review_unknown"
              : "face_review_resumed";
        if (replay) {
          if (replay.actor_id !== actor || replay.reason_code !== reasonCode) {
            throw typedError(
              "commandId was already used for a different Face review action",
              409,
              "FACE_REVIEW_COMMAND_CONFLICT",
            );
          }
          return {
            changed: false,
            decisionId: replay.decision_id,
            disposition,
            faceId,
            replayed: true,
            schemaVersion: "cimmich.face-review-disposition.v1",
          };
        }
        const [current] = await tx`
          SELECT decision_id,
            CASE
              WHEN reason_code = 'face_review_later' AND action = 'ignore' THEN 'later'
              WHEN reason_code = 'face_review_unknown' AND action = 'ignore' THEN 'unknown'
              ELSE 'active'
            END AS disposition
          FROM decision
          WHERE subject_type = 'face_review' AND subject_id = ${faceId}
          ORDER BY created_at DESC, decision_id DESC
          LIMIT 1
        `;
        if ((current?.disposition || "active") === disposition) {
          return {
            changed: false,
            decisionId: current?.decision_id || null,
            disposition,
            faceId,
            replayed: false,
            schemaVersion: "cimmich.face-review-disposition.v1",
          };
        }
        const now = new Date();
        await tx`
          INSERT INTO producer_receipt (
            producer_receipt_id, producer_kind, producer_name, producer_version,
            started_at, completed_at, privacy_class
          ) VALUES (
            ${decisionReceiptId}, 'user', 'cimmich-local-review-service', 'v1',
            ${now}, ${now}, 'private'
          ) ON CONFLICT (producer_receipt_id) DO NOTHING
        `;
        await tx`
          INSERT INTO decision (
            decision_id, subject_type, subject_id, action, actor_kind, actor_id,
            reason_code, note, supersedes_decision_id, producer_receipt_id, privacy_class
          ) VALUES (
            ${stableDecisionId}, 'face_review', ${faceId},
            ${disposition === "active" ? "restore" : "ignore"}, 'user', ${actor},
            ${reasonCode}, '', ${current?.decision_id || null}, ${decisionReceiptId}, 'private'
          )
        `;
        return {
          changed: true,
          decisionId: stableDecisionId,
          disposition,
          faceId,
          replayed: false,
          schemaVersion: "cimmich.face-review-disposition.v1",
        };
      });
    },

    async rejectAcceptedIdentity({ actorId, claimId, commandId, note = "" }) {
      const actor = cleanActor(actorId);
      if (!actor) {
        throw Object.assign(new Error("Missing Cimmich actor"), {
          statusCode: 400,
        });
      }
      const stableCommandId = cleanIdentityCommandId(
        commandId || `identity.reject.${randomUUID().replaceAll("-", "")}`,
      );
      const normalizedNote = String(note || "")
        .trim()
        .slice(0, 1000);
      const stableDecisionId = identityDecisionIdFor(
        "not_this_person",
        stableCommandId,
      );
      const result = await sql.begin(async (tx) => {
        const [existingDecision] = await tx`
          SELECT decision.subject_id, decision.actor_id, decision.note,
            rejected.identity_claim_id AS rejected_claim_id,
            rejected.face_id, rejected.person_id
          FROM decision
          JOIN identity_claim rejected
            ON rejected.decision_id = decision.decision_id
              AND rejected.state IN ('rejected','superseded')
          JOIN face_observation replay_face
            ON replay_face.face_id = rejected.face_id
              AND replay_face.state = 'valid'
          JOIN asset replay_asset
            ON replay_asset.asset_id = replay_face.asset_id
              AND replay_asset.state = 'active'
          WHERE decision.decision_id = ${stableDecisionId}
            AND cimmich_visibility_asset_rank(replay_asset.asset_id) <= ${presentationRank()}
        `;
        if (existingDecision) {
          if (
            existingDecision.subject_id !== claimId ||
            existingDecision.actor_id !== actor ||
            (existingDecision.note || "") !== normalizedNote
          ) {
            throw typedError(
              "commandId was already used for a different identity correction",
              409,
              "IDENTITY_CORRECTION_COMMAND_CONFLICT",
            );
          }
          return {
            changed: true,
            claimId,
            commandId: stableCommandId,
            decisionId: stableDecisionId,
            faceId: existingDecision.face_id,
            personId: existingDecision.person_id,
            rejectedClaimId: existingDecision.rejected_claim_id,
            replayed: true,
            state: "rejected",
            undo: { decisionId: stableDecisionId, eligible: true },
          };
        }
        const [occupiedDecision] = await tx`
          SELECT 1 AS occupied FROM decision
          WHERE decision_id = ${stableDecisionId}
        `;
        if (occupiedDecision) {
          throw typedError(
            "Identity correction command is not available in the current visibility projection",
            404,
            "IDENTITY_CORRECTION_NOT_VISIBLE",
          );
        }
        const [claim] = await tx`
        SELECT claim.identity_claim_id, claim.face_id, claim.person_id,
          claim.origin, claim.state, claim.decision_id
        FROM identity_claim claim
        JOIN face_observation face ON face.face_id = claim.face_id
          AND face.state = 'valid'
        JOIN asset ON asset.asset_id = face.asset_id AND asset.state = 'active'
        WHERE claim.identity_claim_id = ${claimId}
          AND cimmich_visibility_asset_rank(asset.asset_id) <= ${presentationRank()}
        FOR UPDATE OF claim, face
      `;
        if (!claim) {
          throw typedError(
            "Identity claim not found in the current visibility projection",
            404,
            "IDENTITY_CORRECTION_NOT_VISIBLE",
          );
        }
        if (claim.state !== "accepted") {
          return {
            changed: false,
            claimId,
            commandId: stableCommandId,
            faceId: claim.face_id,
            personId: claim.person_id,
            replayed: false,
            state: claim.state,
            undo: { decisionId: null, eligible: false },
          };
        }

        const now = new Date();
        await tx`
        INSERT INTO producer_receipt (
          producer_receipt_id, producer_kind, producer_name, producer_version,
          started_at, completed_at, privacy_class
        ) VALUES (
          ${userCommandReceiptId}, 'user', 'cimmich-local-identity-commands', 'v1',
          ${now}, ${now}, 'private'
        ) ON CONFLICT (producer_receipt_id) DO UPDATE SET completed_at = excluded.completed_at
      `;
        await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, producer_receipt_id, privacy_class
        ) VALUES (
          ${stableDecisionId}, 'identity_claim', ${claimId}, 'reject', 'user', ${actor},
          'not_this_person', ${normalizedNote}, ${userCommandReceiptId}, 'sensitive-biometric'
        )
      `;
        await tx`
        UPDATE identity_claim
        SET state = 'superseded'
        WHERE identity_claim_id = ${claimId} AND state = 'accepted'
      `;
        const memberships = await tx`
          SELECT bucket_id
          FROM current_reference_gallery
          WHERE person_id = ${claim.person_id}
            AND face_id = ${claim.face_id}
            AND membership_state = 'active'
          ORDER BY bucket_id
        `;
        const rejectedClaimId = `claim_${randomUUID().replaceAll("-", "")}`;
        await tx`
        INSERT INTO identity_claim (
          identity_claim_id, face_id, person_id, origin, state, evidence_refs,
          decision_id, supersedes_claim_id, producer_receipt_id, privacy_class
        ) VALUES (
          ${rejectedClaimId}, ${claim.face_id}, ${claim.person_id}, 'user', 'rejected',
          ${tx.json([
            {
              commandId: stableCommandId,
              removedBucketIds: memberships.map((item) => item.bucket_id),
              supersededClaimId: claimId,
              type: "not_this_person",
            },
          ])},
          ${stableDecisionId}, ${claimId}, ${userCommandReceiptId}, 'sensitive-biometric'
        )
      `;
        for (const membership of memberships) {
          await tx`
          INSERT INTO bucket_membership_event (
            membership_event_id, bucket_id, face_id, action, actor_kind,
            reason_code, reason_text, producer_receipt_id, privacy_class
          ) VALUES (
            ${`membership_${randomUUID().replaceAll("-", "")}`}, ${membership.bucket_id}, ${claim.face_id},
            'remove', 'user', 'not_this_person', 'Removed by accepted identity correction',
            ${userCommandReceiptId}, 'sensitive-biometric'
          )
        `;
        }
        return {
          changed: true,
          claimId,
          commandId: stableCommandId,
          decisionId: stableDecisionId,
          faceId: claim.face_id,
          personId: claim.person_id,
          rejectedClaimId,
          replayed: false,
          state: "rejected",
          undo: { decisionId: stableDecisionId, eligible: true },
        };
      });
      const maintenancePending =
        result.changed && !result.replayed
          ? await refreshPrimeAfterCommand(sql, result.personId)
          : false;
      invalidateMachineSuggestions();
      return { ...result, maintenancePending };
    },

    async identityCorrectionHistory({ claimId }) {
      const id = String(claimId || "").trim();
      const [anchor] = await sql`
        SELECT claim.face_id, claim.person_id
        FROM identity_claim claim
        JOIN face_observation face ON face.face_id = claim.face_id
          AND face.state = 'valid'
        JOIN asset ON asset.asset_id = face.asset_id AND asset.state = 'active'
        WHERE claim.identity_claim_id = ${id}
          AND cimmich_visibility_asset_rank(asset.asset_id) <= ${presentationRank()}
      `;
      if (!anchor) {
        throw typedError(
          "Identity claim history was not found in the current visibility projection",
          404,
          "IDENTITY_CORRECTION_NOT_VISIBLE",
        );
      }
      const rows = await sql`
        SELECT claim.identity_claim_id, claim.state, claim.supersedes_claim_id,
          claim.created_at, decision.decision_id, decision.action,
          decision.reason_code, decision.supersedes_decision_id,
          decision.created_at AS decided_at,
          EXISTS (
            SELECT 1 FROM identity_claim successor
            WHERE successor.supersedes_claim_id = claim.supersedes_claim_id
              AND successor.decision_id = decision.decision_id
              AND successor.state = 'rejected'
          ) AS undo_eligible
        FROM identity_claim claim
        LEFT JOIN decision ON decision.decision_id = claim.decision_id
        WHERE claim.face_id = ${anchor.face_id}
          AND claim.person_id = ${anchor.person_id}
        ORDER BY claim.created_at, claim.identity_claim_id
      `;
      return {
        claimId: id,
        faceId: anchor.face_id,
        items: rows.map((row) => ({
          action: row.action || null,
          claimId: row.identity_claim_id,
          createdAt:
            row.created_at instanceof Date
              ? row.created_at.toISOString()
              : row.created_at,
          decidedAt:
            row.decided_at instanceof Date
              ? row.decided_at.toISOString()
              : row.decided_at || null,
          decisionId: row.decision_id || null,
          reasonCode: row.reason_code || null,
          state: row.state,
          supersedesClaimId: row.supersedes_claim_id || null,
          supersedesDecisionId: row.supersedes_decision_id || null,
          undo:
            row.reason_code === "not_this_person"
              ? {
                  decisionId: row.decision_id,
                  eligible: row.undo_eligible === true,
                }
              : { decisionId: null, eligible: false },
        })),
        personId: anchor.person_id,
        schemaVersion: "cimmich.identity-correction-history.v1",
      };
    },

    async discoverIdentityCorrections({
      limit = 24,
      personId = "",
      sourceAssetId = "",
      undoEligible = false,
    }) {
      const requestedPersonId = String(personId || "").trim();
      const requestedSourceAssetId = String(sourceAssetId || "").trim();
      if (Boolean(requestedPersonId) === Boolean(requestedSourceAssetId)) {
        throw typedError(
          "Choose exactly one identity correction scope: sourceAssetId or personId",
          400,
          "IDENTITY_CORRECTION_SCOPE_INVALID",
        );
      }
      if (requestedPersonId) await requireVisibleSubject(requestedPersonId);
      const boundedLimit = cleanLimit(limit, 24, 100);
      const visibleAsset = requestedSourceAssetId
        ? await resolveVisibleAssetDisplay(requestedSourceAssetId)
        : null;
      const onlyUndoEligible = undoEligible === true;
      const rows = await sql`
        SELECT correction.decision_id, correction.created_at AS decided_at,
          correction.supersedes_decision_id,
          rejected.identity_claim_id AS claim_id,
          rejected.created_at, rejected.supersedes_claim_id,
          original.face_id, original.person_id, rejected.state,
          person.display_name AS person_name,
          projection.immich_asset_id AS source_asset_id,
          NOT EXISTS (
            SELECT 1 FROM identity_claim competing
            WHERE competing.face_id = original.face_id
              AND competing.identity_claim_id <> original.identity_claim_id
              AND competing.state = 'accepted'
          ) AND original.state = 'superseded'
            AND rejected.state = 'rejected' AS undo_eligible
        FROM decision correction
        JOIN identity_claim original
          ON original.identity_claim_id = correction.subject_id
        JOIN identity_claim rejected
          ON rejected.supersedes_claim_id = original.identity_claim_id
            AND rejected.decision_id = correction.decision_id
        JOIN face_observation face ON face.face_id = original.face_id
          AND face.state = 'valid'
        JOIN asset ON asset.asset_id = face.asset_id AND asset.state = 'active'
        JOIN person ON person.person_id = original.person_id
          AND person.status = 'active'
        LEFT JOIN LATERAL (
          SELECT current_projection.immich_asset_id
          FROM immich_asset_projection current_projection
          WHERE current_projection.cimmich_asset_id = asset.asset_id
            AND current_projection.state = 'active'
          ORDER BY current_projection.source_id
          LIMIT 1
        ) projection ON true
        WHERE correction.action = 'reject'
          AND correction.reason_code = 'not_this_person'
          AND cimmich_visibility_asset_rank(asset.asset_id) <= ${presentationRank()}
          AND (${visibleAsset?.assetId || null}::text IS NULL
            OR asset.asset_id = ${visibleAsset?.assetId || null})
          AND (${requestedPersonId || null}::text IS NULL
            OR original.person_id = ${requestedPersonId || null})
          AND (${onlyUndoEligible} = false OR (
            original.state = 'superseded'
            AND rejected.state = 'rejected'
            AND NOT EXISTS (
              SELECT 1 FROM identity_claim competing
              WHERE competing.face_id = original.face_id
                AND competing.identity_claim_id <> original.identity_claim_id
                AND competing.state = 'accepted'
            )
          ))
        ORDER BY correction.created_at DESC, correction.decision_id DESC
        LIMIT ${boundedLimit}
      `;
      return {
        items: rows.map((row) => ({
          action: "reject",
          claimId: row.claim_id,
          createdAt:
            row.created_at instanceof Date
              ? row.created_at.toISOString()
              : row.created_at,
          decidedAt:
            row.decided_at instanceof Date
              ? row.decided_at.toISOString()
              : row.decided_at,
          decisionId: row.decision_id,
          faceId: row.face_id,
          personId: row.person_id,
          personName: row.person_name,
          reasonCode: "not_this_person",
          sourceAssetId: row.source_asset_id || null,
          state: row.state,
          supersedesClaimId: row.supersedes_claim_id,
          supersedesDecisionId: row.supersedes_decision_id || null,
          undo: {
            decisionId: row.decision_id,
            eligible: row.undo_eligible === true,
          },
        })),
        schemaVersion: "cimmich.identity-correction-history.v1",
        scope: visibleAsset
          ? {
              kind: "asset",
              sourceAssetId: visibleAsset.sourceAssetId,
            }
          : { kind: "person", personId: requestedPersonId },
      };
    },

    async undoIdentityCorrection({ actorId, commandId, decisionId }) {
      const actor = cleanActor(actorId);
      if (!actor) {
        throw typedError(
          "Missing Cimmich actor",
          400,
          "IDENTITY_CORRECTION_ACTOR_REQUIRED",
        );
      }
      const stableCommandId = cleanIdentityCommandId(commandId);
      const originalDecisionId = String(decisionId || "").trim();
      const undoDecisionId = identityDecisionIdFor(
        "undo_not_this_person",
        stableCommandId,
      );
      const result = await sql.begin(async (tx) => {
        const [existingUndo] = await tx`
          SELECT decision.subject_id, decision.actor_id,
            decision.supersedes_decision_id, original.face_id,
            original.person_id, restored.identity_claim_id AS restored_claim_id
          FROM decision
          JOIN identity_claim original
            ON original.identity_claim_id = decision.subject_id
          JOIN identity_claim restored
            ON restored.decision_id = decision.decision_id
          JOIN person original_person ON original_person.person_id = original.person_id
            AND original_person.status = 'active'
            AND cimmich_visibility_person_rank(original_person.person_id) <= ${presentationRank()}
          JOIN face_observation replay_face
            ON replay_face.face_id = original.face_id
              AND replay_face.state = 'valid'
          JOIN asset replay_asset
            ON replay_asset.asset_id = replay_face.asset_id
              AND replay_asset.state = 'active'
          WHERE decision.decision_id = ${undoDecisionId}
            AND cimmich_visibility_asset_rank(replay_asset.asset_id) <= ${presentationRank()}
        `;
        if (existingUndo) {
          if (
            existingUndo.supersedes_decision_id !== originalDecisionId ||
            existingUndo.actor_id !== actor
          ) {
            throw typedError(
              "commandId was already used for a different identity correction undo",
              409,
              "IDENTITY_CORRECTION_COMMAND_CONFLICT",
            );
          }
          return {
            changed: true,
            claimId: existingUndo.restored_claim_id,
            commandId: stableCommandId,
            decisionId: undoDecisionId,
            faceId: existingUndo.face_id,
            personId: existingUndo.person_id,
            replayed: true,
            state: "accepted",
            undoneDecisionId: originalDecisionId,
          };
        }
        const [occupiedUndo] = await tx`
          SELECT 1 AS occupied FROM decision
          WHERE decision_id = ${undoDecisionId}
        `;
        if (occupiedUndo) {
          throw typedError(
            "Identity correction undo command is not available in the current visibility projection",
            404,
            "IDENTITY_CORRECTION_NOT_VISIBLE",
          );
        }
        const [correction] = await tx`
          SELECT original.identity_claim_id AS claim_id, original.face_id,
            original.person_id, original.state AS original_state,
            rejected.identity_claim_id AS rejected_claim_id,
            rejected.state AS rejected_state, rejected.evidence_refs
          FROM decision correction
          JOIN identity_claim original
            ON original.identity_claim_id = correction.subject_id
          JOIN identity_claim rejected
            ON rejected.supersedes_claim_id = original.identity_claim_id
              AND rejected.decision_id = correction.decision_id
          JOIN person original_person ON original_person.person_id = original.person_id
            AND original_person.status = 'active'
            AND cimmich_visibility_person_rank(original_person.person_id) <= ${presentationRank()}
          JOIN face_observation face ON face.face_id = original.face_id
            AND face.state = 'valid'
          JOIN asset ON asset.asset_id = face.asset_id AND asset.state = 'active'
          WHERE correction.decision_id = ${originalDecisionId}
            AND correction.action = 'reject'
            AND correction.reason_code = 'not_this_person'
            AND cimmich_visibility_asset_rank(asset.asset_id) <= ${presentationRank()}
          FOR UPDATE OF original, rejected, face
        `;
        if (!correction) {
          throw typedError(
            "Identity correction was not found in the current visibility projection",
            404,
            "IDENTITY_CORRECTION_NOT_VISIBLE",
          );
        }
        if (
          correction.original_state !== "superseded" ||
          correction.rejected_state !== "rejected"
        ) {
          throw typedError(
            "Identity correction can no longer be undone safely",
            409,
            "IDENTITY_CORRECTION_UNDO_NOT_AVAILABLE",
          );
        }
        const [competing] = await tx`
          SELECT identity_claim_id FROM identity_claim
          WHERE face_id = ${correction.face_id}
            AND identity_claim_id <> ${correction.claim_id}
            AND state = 'accepted'
          LIMIT 1
        `;
        if (competing) {
          throw typedError(
            "Face identity changed after this correction",
            409,
            "IDENTITY_CORRECTION_UNDO_STALE",
          );
        }
        await ensureUserCommandReceipt(tx);
        await tx`
          INSERT INTO decision (
            decision_id, subject_type, subject_id, action, actor_kind, actor_id,
            reason_code, note, supersedes_decision_id, producer_receipt_id,
            privacy_class
          ) VALUES (
            ${undoDecisionId}, 'identity_claim', ${correction.claim_id}, 'undo',
            'user', ${actor}, 'not_this_person_undo',
            'Restore accepted identity after Not this person',
            ${originalDecisionId}, ${userCommandReceiptId}, 'sensitive-biometric'
          )
        `;
        await tx`
          UPDATE identity_claim SET state = 'superseded'
          WHERE identity_claim_id = ${correction.rejected_claim_id}
            AND state = 'rejected'
        `;
        const restoredClaimId = `claim_${randomUUID().replaceAll("-", "")}`;
        await tx`
          INSERT INTO identity_claim (
            identity_claim_id, face_id, person_id, origin, state, evidence_refs,
            decision_id, supersedes_claim_id, producer_receipt_id, privacy_class
          ) VALUES (
            ${restoredClaimId}, ${correction.face_id}, ${correction.person_id},
            'user', 'accepted',
            ${tx.json([
              {
                restoredDecisionId: originalDecisionId,
                type: "not_this_person_undo",
              },
            ])},
            ${undoDecisionId}, ${correction.rejected_claim_id},
            ${userCommandReceiptId}, 'sensitive-biometric'
          )
        `;
        const evidence = Array.isArray(correction.evidence_refs)
          ? correction.evidence_refs[0]
          : null;
        const bucketIds = Array.isArray(evidence?.removedBucketIds)
          ? [...new Set(evidence.removedBucketIds.map(String))]
          : [];
        for (const bucketId of bucketIds) {
          const [bucket] = await tx`
            SELECT bucket_id FROM reference_bucket
            WHERE bucket_id = ${bucketId}
              AND person_id = ${correction.person_id}
              AND state IN ('active','candidate')
          `;
          if (!bucket) continue;
          await tx`
            INSERT INTO bucket_membership_event (
              membership_event_id, bucket_id, face_id, action, actor_kind,
              reason_code, reason_text, producer_receipt_id, privacy_class
            ) VALUES (
              ${`membership_${randomUUID().replaceAll("-", "")}`}, ${bucketId},
              ${correction.face_id}, 'pin', 'user', 'not_this_person_undo',
              'Restored by accepted identity correction undo',
              ${userCommandReceiptId}, 'sensitive-biometric'
            )
          `;
        }
        return {
          changed: true,
          claimId: restoredClaimId,
          commandId: stableCommandId,
          decisionId: undoDecisionId,
          faceId: correction.face_id,
          personId: correction.person_id,
          replayed: false,
          state: "accepted",
          undoneDecisionId: originalDecisionId,
        };
      });
      const maintenancePending = result.replayed
        ? false
        : await refreshPrimeAfterCommand(sql, result.personId);
      invalidateMachineSuggestions();
      return { ...result, maintenancePending };
    },

    async movePersonFace({
      actorId,
      bodyId = "",
      faceId,
      moveBody = false,
      newPersonName = "",
      sourcePersonId,
      targetPersonId = "",
    }) {
      await requireVisibleSubject(sourcePersonId);
      if (String(targetPersonId || "").trim()) {
        await requireVisibleSubject(targetPersonId);
      }
      const actor = cleanActor(actorId);
      if (!actor)
        throw Object.assign(new Error("Missing Cimmich actor"), {
          statusCode: 400,
        });
      const createNew = Boolean(String(newPersonName || "").trim());
      const existingTargetId = String(targetPersonId || "").trim();
      if (createNew === Boolean(existingTargetId)) {
        throw Object.assign(
          new Error("Choose either an existing Person or a new Person name"),
          { statusCode: 400 },
        );
      }
      const requestedName = createNew ? cleanPersonName(newPersonName) : "";
      const result = await sql.begin(async (tx) => {
        const [current] = await tx`
        SELECT claim.identity_claim_id, claim.face_id, claim.person_id,
          face.asset_id
        FROM identity_claim claim
        JOIN face_observation face ON face.face_id = claim.face_id AND face.state = 'valid'
        JOIN person source ON source.person_id = claim.person_id
          AND source.status = 'active' AND source.subject_kind = 'person'
        WHERE claim.face_id = ${String(faceId || "")}
          AND claim.person_id = ${String(sourcePersonId || "")}
          AND claim.state = 'accepted'
        ORDER BY claim.created_at DESC, claim.identity_claim_id DESC
        LIMIT 1
        FOR UPDATE OF claim, face, source
      `;
        if (!current)
          throw Object.assign(
            new Error("Accepted source face identity not found"),
            { statusCode: 404 },
          );
        await ensureUserCommandReceipt(tx);

        let target;
        let createdPerson = false;
        if (createNew) {
          const duplicates = await tx`
          SELECT person_id, display_name
          FROM current_person person
          WHERE person.status = 'active' AND (
            lower(person.display_name) = lower(${requestedName})
            OR EXISTS (SELECT 1 FROM unnest(person.aliases) alias WHERE lower(alias) = lower(${requestedName}))
          )
          ORDER BY person_id
          LIMIT 2
        `;
          if (duplicates.length > 0) {
            throw Object.assign(
              new Error(
                `A Cimmich Person named ${requestedName} already exists; move to that Person instead`,
              ),
              {
                statusCode: 409,
              },
            );
          }
          const personId = `person_${randomUUID().replaceAll("-", "")}`;
          [target] = await tx`
          INSERT INTO person (
            person_id, display_name, status, subject_kind, created_by_receipt_id, privacy_class
          ) VALUES (
            ${personId}, ${requestedName}, 'active', 'person', ${userCommandReceiptId}, 'sensitive-biometric'
          )
          RETURNING person_id, display_name
        `;
          createdPerson = true;
        } else {
          [target] = await tx`
          SELECT person_id, display_name
          FROM person
          WHERE person_id = ${existingTargetId} AND status = 'active' AND subject_kind = 'person'
          FOR UPDATE
        `;
          if (!target)
            throw Object.assign(
              new Error("Active destination Person not found"),
              { statusCode: 404 },
            );
        }
        if (target.person_id === current.person_id) {
          return {
            changed: false,
            createdPerson,
            faceId: current.face_id,
            movedBody: false,
            personId: target.person_id,
            personName: target.display_name,
            previousPersonId: current.person_id,
          };
        }

        const transferableBuckets = await tx`
        SELECT gallery.bucket_kind, gallery.bucket_name, bucket.activation_hints
        FROM current_reference_gallery gallery
        JOIN reference_bucket bucket ON bucket.bucket_id = gallery.bucket_id
        WHERE gallery.person_id = ${current.person_id}
          AND gallery.face_id = ${current.face_id}
          AND gallery.membership_state = 'active'
          AND gallery.bucket_kind IN ('head','lq','secondary','specialty')
        ORDER BY gallery.bucket_kind, gallery.bucket_name
      `;
        const currentMemberships = await tx`
        SELECT bucket_id
        FROM current_reference_gallery
        WHERE person_id = ${current.person_id} AND face_id = ${current.face_id}
          AND membership_state = 'active'
      `;
        const [body] = moveBody
          ? await tx`
            SELECT observation.body_id, tag.body_tag_id, tag.origin
            FROM face_observation face
            JOIN body_observation observation ON observation.asset_id = face.asset_id
              AND observation.body_id = ${String(bodyId || "")}
              AND observation.state = 'valid'
            JOIN current_body_tag tag ON tag.body_id = observation.body_id
              AND tag.person_id = ${current.person_id} AND tag.state = 'accepted'
            WHERE face.face_id = ${current.face_id}
            LIMIT 1
            FOR UPDATE OF tag
          `
          : [];

        const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
        await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'face_identity', ${current.face_id}, ${createdPerson ? "split" : "rename"}, 'user', ${actor},
          ${createdPerson ? "identity_workspace_split" : "identity_workspace_move"},
          ${createdPerson ? `Split face into new Person ${target.display_name}` : `Move face to ${target.display_name}`},
          ${userCommandReceiptId}, 'sensitive-biometric'
        )
      `;
        await tx`
        UPDATE identity_claim SET state = 'superseded'
        WHERE identity_claim_id = ${current.identity_claim_id} AND state = 'accepted'
      `;
        for (const membership of currentMemberships) {
          await tx`
          INSERT INTO bucket_membership_event (
            membership_event_id, bucket_id, face_id, action, actor_kind,
            reason_code, reason_text, producer_receipt_id, privacy_class
          ) VALUES (
            ${`membership_${randomUUID().replaceAll("-", "")}`}, ${membership.bucket_id}, ${current.face_id},
            'remove', 'user', 'identity_moved', 'Removed after accepted identity move',
            ${userCommandReceiptId}, 'sensitive-biometric'
          )
        `;
        }
        const claimId = `claim_${randomUUID().replaceAll("-", "")}`;
        await tx`
        INSERT INTO identity_claim (
          identity_claim_id, face_id, person_id, origin, state, evidence_refs,
          decision_id, supersedes_claim_id, producer_receipt_id, privacy_class
        ) VALUES (
          ${claimId}, ${current.face_id}, ${target.person_id}, 'user', 'accepted',
          ${tx.json([
            {
              createdPerson,
              moveBody: Boolean(body),
              previousPersonId: current.person_id,
              type: createdPerson ? "user_face_split" : "user_face_move",
            },
          ])},
          ${decisionId}, ${current.identity_claim_id}, ${userCommandReceiptId}, 'sensitive-biometric'
        )
      `;

        for (const sourceBucket of transferableBuckets) {
          const bucketName = sourceBucket.bucket_name || null;
          let [targetBucket] = await tx`
          SELECT bucket_id
          FROM reference_bucket
          WHERE person_id = ${target.person_id}
            AND bucket_kind = ${sourceBucket.bucket_kind}
            AND state IN ('active','candidate')
            AND (
              ${sourceBucket.bucket_kind} <> 'specialty'
              OR lower(name) = lower(${bucketName})
            )
          ORDER BY CASE state WHEN 'active' THEN 0 ELSE 1 END, bucket_id
          LIMIT 1
        `;
          if (!targetBucket) {
            [targetBucket] = await tx`
            INSERT INTO reference_bucket (
              bucket_id, person_id, bucket_kind, name, activation_hints,
              created_by, policy_version, state, producer_receipt_id, privacy_class
            ) VALUES (
              ${`bucket_${randomUUID().replaceAll("-", "")}`}, ${target.person_id}, ${sourceBucket.bucket_kind},
              ${bucketName}, ${sourceBucket.bucket_kind === "specialty" ? tx.json(sourceBucket.activation_hints || {}) : null},
              'user', 'cimmich-identity-move-v1', 'active', ${userCommandReceiptId}, 'sensitive-biometric'
            )
            RETURNING bucket_id
          `;
          }
          await tx`
          INSERT INTO bucket_membership_event (
            membership_event_id, bucket_id, face_id, action, actor_kind,
            reason_code, reason_text, producer_receipt_id, privacy_class
          ) VALUES (
            ${`membership_${randomUUID().replaceAll("-", "")}`}, ${targetBucket.bucket_id}, ${current.face_id},
            'pin', 'user', 'identity_moved_preserve_tier',
            ${`Preserved ${sourceBucket.bucket_kind}${bucketName ? ` — ${bucketName}` : ""} after identity move`},
            ${userCommandReceiptId}, 'sensitive-biometric'
          )
        `;
        }

        if (body && body.origin !== "face_body_linkage") {
          await tx`UPDATE body_tag SET state = 'superseded' WHERE body_tag_id = ${body.body_tag_id}`;
          await tx`
          INSERT INTO body_tag (
            body_tag_id, person_id, body_id, origin, state, decision_id,
            supersedes_body_tag_id, producer_receipt_id, privacy_class
          ) VALUES (
            ${`body_tag_${randomUUID().replaceAll("-", "")}`}, ${target.person_id}, ${body.body_id}, 'user',
            'accepted', ${decisionId}, ${body.body_tag_id}, ${userCommandReceiptId}, 'private'
          )
        `;
        }

        if (createdPerson) {
          const [sortCategory] = await tx`
          SELECT category_id FROM person_category WHERE slug = 'sort' AND state = 'active' LIMIT 1
        `;
          if (sortCategory) {
            await tx`
            INSERT INTO person_category_membership_event (
              membership_event_id, person_id, category_id, action, actor_kind, actor_id,
              decision_id, producer_receipt_id, privacy_class
            ) VALUES (
              ${`categoryevent_${randomUUID().replaceAll("-", "")}`}, ${target.person_id}, ${sortCategory.category_id},
              'add', 'user', ${actor}, ${decisionId}, ${userCommandReceiptId}, 'private'
            )
          `;
          }
        }
        await tx`UPDATE person SET current_revision = current_revision + 1 WHERE person_id IN (${current.person_id}, ${target.person_id})`;
        return {
          changed: true,
          claimId,
          createdPerson,
          decisionId,
          faceId: current.face_id,
          movedBody: Boolean(body),
          personId: target.person_id,
          personName: target.display_name,
          previousPersonId: current.person_id,
          state: "accepted",
        };
      });

      const maintenancePending = result.changed
        ? await refreshPrimeForPeople(sql, [
            result.previousPersonId,
            result.personId,
          ])
        : false;
      invalidateMachineSuggestions();
      return { ...result, maintenancePending };
    },

    async dismissMachineSuggestion({ actorId, faceId }) {
      const actor = cleanActor(actorId);
      if (!actor) {
        throw Object.assign(new Error("Missing Cimmich actor"), {
          statusCode: 400,
        });
      }
      const cleanFaceId = String(faceId || "").trim();
      if (!machineReviewConfigured) {
        throw typedError(
          "Machine review is not configured",
          409,
          "MACHINE_REVIEW_NOT_CONFIGURED",
        );
      }
      const result = await sql.begin(async (tx) => {
        const [face] = await tx`
        SELECT observation.face_id, embedding.model_version, embedding.config_digest
        FROM face_observation observation
        JOIN LATERAL (
          SELECT current.model_version, current.config_digest
          FROM face_embedding current
          WHERE current.face_id = observation.face_id
            AND current.state = 'active'
            AND current.model_family = ${matchingProvider.modelFamily}
            AND current.model_version = ${matchingProvider.modelVersion}
            AND current.config_digest = ${matchingProvider.configDigest}
          ORDER BY current.created_at DESC, current.embedding_id
          LIMIT 1
        ) embedding ON true
        WHERE observation.face_id = ${cleanFaceId} AND observation.state = 'valid'
        FOR UPDATE OF observation
      `;
        if (!face) {
          throw Object.assign(new Error("Face observation not found"), {
            statusCode: 404,
          });
        }
        const subjectId = `${face.face_id}:${face.model_version}:${face.config_digest}:${machineMatcherPolicyVersion}`;
        const [latest] = await tx`
        SELECT decision_id, action
        FROM decision
        WHERE subject_type = 'machine_suggestion'
          AND subject_id = ${subjectId}
          AND actor_kind = 'user'
        ORDER BY created_at DESC, decision_id DESC
        LIMIT 1
      `;
        if (latest?.action === "ignore") {
          return {
            changed: false,
            decisionId: latest.decision_id,
            faceId: face.face_id,
            configDigest: face.config_digest,
            modelVersion: face.model_version,
            policyVersion: machineMatcherPolicyVersion,
            state: "ignored",
          };
        }
        await ensureUserCommandReceipt(tx);
        const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
        await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'machine_suggestion', ${subjectId}, 'ignore', 'user', ${actor},
          'machine_suggestion_unknown',
          'No identity confirmed for this matcher version',
          ${userCommandReceiptId}, 'sensitive-biometric'
        )
      `;
        return {
          changed: true,
          decisionId,
          faceId: face.face_id,
          configDigest: face.config_digest,
          modelVersion: face.model_version,
          policyVersion: machineMatcherPolicyVersion,
          state: "ignored",
        };
      });
      invalidateMachineSuggestions();
      return result;
    },

    async restoreMachineSuggestion({ actorId, faceId }) {
      const actor = cleanActor(actorId);
      if (!actor) {
        throw Object.assign(new Error("Missing Cimmich actor"), {
          statusCode: 400,
        });
      }
      const cleanFaceId = String(faceId || "").trim();
      if (!machineReviewConfigured) {
        throw typedError(
          "Machine review is not configured",
          409,
          "MACHINE_REVIEW_NOT_CONFIGURED",
        );
      }
      const result = await sql.begin(async (tx) => {
        const [face] = await tx`
        SELECT observation.face_id, embedding.model_version, embedding.config_digest
        FROM face_observation observation
        JOIN LATERAL (
          SELECT current.model_version, current.config_digest
          FROM face_embedding current
          WHERE current.face_id = observation.face_id
            AND current.state = 'active'
            AND current.model_family = ${matchingProvider.modelFamily}
            AND current.model_version = ${matchingProvider.modelVersion}
            AND current.config_digest = ${matchingProvider.configDigest}
          ORDER BY current.created_at DESC, current.embedding_id
          LIMIT 1
        ) embedding ON true
        WHERE observation.face_id = ${cleanFaceId} AND observation.state = 'valid'
        FOR UPDATE OF observation
      `;
        if (!face) {
          throw Object.assign(new Error("Face observation not found"), {
            statusCode: 404,
          });
        }
        const subjectId = `${face.face_id}:${face.model_version}:${face.config_digest}:${machineMatcherPolicyVersion}`;
        const [latest] = await tx`
        SELECT decision_id, action
        FROM decision
        WHERE subject_type = 'machine_suggestion'
          AND subject_id = ${subjectId}
          AND actor_kind = 'user'
        ORDER BY created_at DESC, decision_id DESC
        LIMIT 1
      `;
        if (!latest || latest.action !== "ignore") {
          return {
            changed: false,
            decisionId: latest?.decision_id || null,
            faceId: face.face_id,
            configDigest: face.config_digest,
            modelVersion: face.model_version,
            policyVersion: machineMatcherPolicyVersion,
            state: "active",
          };
        }
        await ensureUserCommandReceipt(tx);
        const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
        await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'machine_suggestion', ${subjectId}, 'restore', 'user', ${actor},
          'machine_suggestion_unknown_undo', 'Restore machine suggestion after user undo',
          ${userCommandReceiptId}, 'sensitive-biometric'
        )
      `;
        return {
          changed: true,
          decisionId,
          faceId: face.face_id,
          configDigest: face.config_digest,
          modelVersion: face.model_version,
          policyVersion: machineMatcherPolicyVersion,
          state: "active",
        };
      });
      invalidateMachineSuggestions();
      return result;
    },

    async reassignFaceIdentity(input) {
      const { actorId, faceId, newPersonName, personId, personName } = input;
      const actor = cleanActor(actorId);
      if (!actor)
        throw Object.assign(new Error("Missing Cimmich actor"), {
          statusCode: 400,
        });
      const selectors = ["personId", "personName", "newPersonName"].filter(
        (key) => Object.hasOwn(input, key),
      );
      if (selectors.length !== 1) {
        throw typedError(
          "Choose exactly one existing Person selector or one new Person name",
          400,
          "FACE_IDENTITY_SELECTOR_INVALID",
        );
      }
      const selector = selectors[0];
      const createPerson = selector === "newPersonName";
      const targetPersonId =
        selector === "personId" ? String(personId || "").trim() : "";
      if (selector === "personId" && !targetPersonId) {
        throw typedError(
          "Cimmich Person ID is required",
          400,
          "FACE_IDENTITY_SELECTOR_INVALID",
        );
      }
      const targetName =
        selector === "personName"
          ? cleanPersonName(personName)
          : createPerson
            ? cleanPersonName(newPersonName)
            : "";
      const result = await sql.begin(async (tx) => {
        const [face] = await tx`
        SELECT face_id, asset_id
        FROM face_observation
        WHERE face_id = ${String(faceId || "")} AND state = 'valid'
          AND cimmich_visibility_asset_rank(asset_id) <= ${presentationRank()}
        FOR UPDATE
      `;
        if (!face)
          throw typedError(
            "Visible current Face observation not found",
            404,
            "FACE_OBSERVATION_NOT_FOUND",
          );
        const [current] = await tx`
        SELECT identity_claim_id, person_id
        FROM identity_claim
        WHERE face_id = ${face.face_id} AND state = 'accepted'
        ORDER BY created_at DESC, identity_claim_id DESC
        LIMIT 1
        FOR UPDATE
      `;
        let target;
        let createdPerson = false;
        if (createPerson) {
          await ensureUserCommandReceipt(tx);
          // Serialize Person-name creation against the existing Person/alias
          // mutation surfaces so this transaction cannot knowingly create a
          // duplicate display name or alias.
          await tx`LOCK TABLE person IN SHARE ROW EXCLUSIVE MODE`;
          await tx`LOCK TABLE person_alias IN SHARE ROW EXCLUSIVE MODE`;
          const duplicates = await tx`
            SELECT person_id, display_name
            FROM current_person person
            WHERE person.status = 'active' AND person.subject_kind = 'person'
              AND (
                lower(person.display_name) = lower(${targetName})
                OR EXISTS (
                  SELECT 1 FROM unnest(person.aliases) alias
                  WHERE lower(alias) = lower(${targetName})
                )
              )
            ORDER BY person_id
            LIMIT 2
          `;
          if (duplicates.length > 0) {
            throw typedError(
              "A Cimmich Person already uses this display name or alias",
              409,
              "PERSON_NAME_CONFLICT",
              {
                existingPeople: duplicates.map((person) => ({
                  personId: person.person_id,
                  personName: person.display_name,
                })),
              },
            );
          }
          const createdPersonId = `person_${randomUUID().replaceAll("-", "")}`;
          [target] = await tx`
            INSERT INTO person (
              person_id, display_name, status, subject_kind,
              created_by_receipt_id, privacy_class
            ) VALUES (
              ${createdPersonId}, ${targetName}, 'active', 'person',
              ${userCommandReceiptId}, 'sensitive-biometric'
            )
            RETURNING person_id, display_name
          `;
          createdPerson = true;
        } else {
          const people = targetPersonId
            ? await tx`
              SELECT person_id, display_name
              FROM person
              WHERE status = 'active' AND subject_kind = 'person'
                AND person_id = ${targetPersonId}
                AND cimmich_visibility_person_rank(person_id) <= ${presentationRank()}
              LIMIT 1
              FOR UPDATE
            `
            : await tx`
              SELECT person_id, display_name
              FROM current_person person
              WHERE status = 'active' AND subject_kind = 'person' AND (
                lower(display_name) = lower(${targetName})
                OR EXISTS (
                  SELECT 1 FROM unnest(person.aliases) alias
                  WHERE lower(alias) = lower(${targetName})
                )
              )
                AND cimmich_visibility_person_rank(person.person_id) <= ${presentationRank()}
              ORDER BY person_id
              LIMIT 2
            `;
          if (people.length === 0) {
            throw typedError(
              targetPersonId
                ? "Cimmich Person not found"
                : `No existing Cimmich Person named ${targetName}`,
              404,
              "PERSON_NOT_FOUND",
            );
          }
          if (people.length > 1) {
            throw typedError(
              `More than one Cimmich Person uses ${targetName}`,
              409,
              "PERSON_NAME_AMBIGUOUS",
              {
                existingPeople: people.map((person) => ({
                  personId: person.person_id,
                  personName: person.display_name,
                })),
              },
            );
          }
          [target] = people;
          const [lockedTarget] = targetPersonId
            ? [target]
            : await tx`
                SELECT person_id, display_name
                FROM person
                WHERE person_id = ${target.person_id}
                  AND status = 'active' AND subject_kind = 'person'
                  AND cimmich_visibility_person_rank(person_id) <= ${presentationRank()}
                FOR UPDATE
              `;
          if (!lockedTarget) {
            throw typedError(
              "Cimmich Person changed while the Face was being assigned",
              409,
              "PERSON_STALE",
            );
          }
          target = lockedTarget;
        }
        if (current?.person_id === target.person_id) {
          return {
            changed: false,
            assetId: face.asset_id,
            claimId: current.identity_claim_id,
            createdPerson: false,
            faceId: face.face_id,
            personId: target.person_id,
            personName: target.display_name,
            previousPersonId: current.person_id,
            state: "accepted",
          };
        }

        await ensureUserCommandReceipt(tx);
        const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
        await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'face_identity', ${face.face_id}, ${createdPerson ? "accept" : "rename"}, 'user', ${actor},
          ${createdPerson ? "new_person_from_face" : "identity_workspace_reassignment"},
          ${createdPerson ? "Create Person and accept selected Face" : `Assign face to ${target.display_name}`},
          ${userCommandReceiptId}, 'sensitive-biometric'
        )
      `;
        if (current) {
          await tx`
          UPDATE identity_claim
          SET state = 'superseded'
          WHERE identity_claim_id = ${current.identity_claim_id} AND state = 'accepted'
        `;
          const memberships = await tx`
          SELECT bucket_id
          FROM current_reference_gallery
          WHERE person_id = ${current.person_id} AND face_id = ${face.face_id} AND membership_state = 'active'
        `;
          for (const membership of memberships) {
            await tx`
            INSERT INTO bucket_membership_event (
              membership_event_id, bucket_id, face_id, action, actor_kind,
              reason_code, reason_text, producer_receipt_id, privacy_class
            ) VALUES (
              ${`membership_${randomUUID().replaceAll("-", "")}`}, ${membership.bucket_id}, ${face.face_id},
              'remove', 'user', 'identity_reassigned', 'Removed after accepted identity reassignment',
              ${userCommandReceiptId}, 'sensitive-biometric'
            )
          `;
          }
        }
        await tx`
        UPDATE identity_claim
        SET state = 'superseded', decision_id = ${decisionId}
        WHERE face_id = ${face.face_id} AND state = 'candidate'
      `;
        const claimId = `claim_${randomUUID().replaceAll("-", "")}`;
        await tx`
        INSERT INTO identity_claim (
          identity_claim_id, face_id, person_id, origin, state, evidence_refs,
          decision_id, supersedes_claim_id, producer_receipt_id, privacy_class
        ) VALUES (
          ${claimId}, ${face.face_id}, ${target.person_id}, 'user', 'accepted',
          ${tx.json([
            {
              createdPerson,
              previousPersonId: current?.person_id || null,
              type: createdPerson
                ? "user_face_new_person"
                : "user_face_reassignment",
            },
          ])},
          ${decisionId}, ${current?.identity_claim_id || null}, ${userCommandReceiptId}, 'sensitive-biometric'
        )
      `;
        if (createdPerson) {
          const [sortCategory] = await tx`
            SELECT category_id
            FROM person_category
            WHERE slug = 'sort' AND state = 'active'
            LIMIT 1
            FOR SHARE
          `;
          if (!sortCategory) {
            throw typedError(
              "The required Sort workflow category is unavailable",
              503,
              "PERSON_SORT_CATEGORY_UNAVAILABLE",
            );
          }
          await tx`
            INSERT INTO person_category_membership_event (
              membership_event_id, person_id, category_id, action, actor_kind,
              actor_id, decision_id, producer_receipt_id, privacy_class
            ) VALUES (
              ${`categoryevent_${randomUUID().replaceAll("-", "")}`},
              ${target.person_id}, ${sortCategory.category_id}, 'add', 'user',
              ${actor}, ${decisionId}, ${userCommandReceiptId}, 'private'
            )
          `;
        }
        return {
          changed: true,
          assetId: face.asset_id,
          claimId,
          createdPerson,
          decisionId,
          faceId: face.face_id,
          personId: target.person_id,
          personName: target.display_name,
          previousPersonId: current?.person_id || null,
          state: "accepted",
        };
      });

      const primeMaintenancePending = result.changed
        ? await refreshPrimeForPeople(sql, [
            result.previousPersonId,
            result.personId,
          ])
        : false;
      const bodyLinkage = result.changed
        ? await refreshBodyLinksAfterCommand(sql, result.assetId)
        : { maintenancePending: false };
      invalidateMachineSuggestions();
      return {
        ...result,
        bodyLinkage,
        maintenancePending:
          primeMaintenancePending || bodyLinkage.maintenancePending,
      };
    },
  };
  Object.assign(repository, observationCorrections);
  return repository;
};
