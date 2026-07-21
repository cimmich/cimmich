import {
  bodyDetectionDigest,
  projectValidatedBodyResultForRepository,
} from "./body-detector-contract.mjs";
import {
  createBodyObjectConflictReceipt,
  projectValidatedBodyObjectConflicts,
} from "./body-object-conflict-contract.mjs";
import {
  createBodyPoseReceipt,
  projectValidatedBodyPoseForRepository,
} from "./body-pose-provider-contract.mjs";

export const bodyEvidenceResolutionSchemaVersion =
  "cimmich.body-evidence-resolution.v1";
export const bodyEvidenceResolutionReceiptSchemaVersion =
  "cimmich.body-evidence-resolution-receipt.v1";

const resolutionEnvelopes = new WeakSet();
const resolutionProjections = new WeakMap();

const typedError = (message) =>
  Object.assign(new Error(message), {
    code: "BODY_EVIDENCE_RESOLUTION_INVALID",
    statusCode: 400,
  });

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

const exactObject = (value, keys, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw typedError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw typedError(`${label} fields are invalid`);
  }
};

const canonicalUnit = (value, label, { positive = false } = {}) => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1 ||
    (positive && value <= 0) ||
    Number(value.toFixed(6)) !== value
  ) {
    throw typedError(`${label} must be a canonical six-decimal unit value`);
  }
  return value;
};

const overlapCoverage = (body, object) => {
  const intersectionWidth = Math.max(
    0,
    Math.min(body.x + body.w, object.x + object.w) - Math.max(body.x, object.x),
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(body.y + body.h, object.y + object.h) - Math.max(body.y, object.y),
  );
  const bodyArea = body.w * body.h;
  return Number(
    ((intersectionWidth * intersectionHeight) / bodyArea).toFixed(6),
  );
};

const normalizedPolicy = (value) => {
  exactObject(
    value,
    [
      "objectConflictMinimumBodyCoverage",
      "objectConflictMinimumScore",
      "unposedConfirmationScore",
    ],
    "policy",
  );
  return deepFreeze({
    objectConflictMinimumBodyCoverage: canonicalUnit(
      value.objectConflictMinimumBodyCoverage,
      "policy.objectConflictMinimumBodyCoverage",
      { positive: true },
    ),
    objectConflictMinimumScore: canonicalUnit(
      value.objectConflictMinimumScore,
      "policy.objectConflictMinimumScore",
      { positive: true },
    ),
    unposedConfirmationScore: canonicalUnit(
      value.unposedConfirmationScore,
      "policy.unposedConfirmationScore",
      { positive: true },
    ),
  });
};

export const resolveBodyEvidence = (value) => {
  exactObject(
    value,
    [
      "bodyValidation",
      "conflictValidation",
      "policy",
      "poseValidation",
      "schemaVersion",
    ],
    "resolution",
  );
  if (value.schemaVersion !== bodyEvidenceResolutionSchemaVersion) {
    throw typedError("resolution schemaVersion is invalid");
  }
  const body = projectValidatedBodyResultForRepository(value.bodyValidation);
  const policy = normalizedPolicy(value.policy);

  let pose = null;
  let poseReceipt = null;
  if (value.poseValidation !== null) {
    poseReceipt = createBodyPoseReceipt(value.poseValidation);
    pose = projectValidatedBodyPoseForRepository(value.poseValidation);
    if (poseReceipt.binding.bodyResultDigest !== body.resultDigest) {
      throw typedError("pose evidence belongs to another Body result");
    }
  }

  let conflict = null;
  let conflictReceipt = null;
  if (value.conflictValidation !== null) {
    conflictReceipt = createBodyObjectConflictReceipt(value.conflictValidation);
    conflict = projectValidatedBodyObjectConflicts(value.conflictValidation);
    if (conflict.bodyResultDigest !== body.resultDigest) {
      throw typedError("object evidence belongs to another Body result");
    }
  }

  const poseSupported = new Set(pose?.items.map((item) => item.bodyId) || []);
  const objectEvidenceReady = conflict?.replayEvidence === "consistent";
  const hasObjectEvidence = objectEvidenceReady && conflict.objects.length > 0;
  const items = body.bodies.map((item) => {
    const conflicts = objectEvidenceReady
      ? conflict.objects
          .map((object) => ({
            bodyCoverage: overlapCoverage(item.box, object.box),
            category: object.category,
            confidence: object.confidence,
          }))
          .filter(
            (object) =>
              object.confidence >= policy.objectConflictMinimumScore &&
              object.bodyCoverage >= policy.objectConflictMinimumBodyCoverage,
          )
          .sort(
            (left, right) =>
              right.bodyCoverage - left.bodyCoverage ||
              right.confidence - left.confidence ||
              left.category.localeCompare(right.category),
          )
      : [];
    const hasPose = poseSupported.has(item.bodyId);
    const conflictItem = conflicts[0] || null;
    if (hasPose && conflictItem) {
      return deepFreeze({
        bodyId: item.bodyId,
        detectorConfidence: item.confidence,
        reason: "POSE_OBJECT_CONFLICT",
        status: "candidate",
      });
    }
    if (hasPose) {
      return deepFreeze({
        bodyId: item.bodyId,
        detectorConfidence: item.confidence,
        reason: "POSE_SUPPORTED",
        status: "confirmed",
      });
    }
    if (conflictItem) {
      return deepFreeze({
        bodyId: item.bodyId,
        detectorConfidence: item.confidence,
        reason: "PET_OBJECT_CONFLICT",
        status: "suppressed",
      });
    }
    if (hasObjectEvidence) {
      return deepFreeze({
        bodyId: item.bodyId,
        detectorConfidence: item.confidence,
        reason: "OBJECT_CONFLICT_UNRESOLVED",
        status: "candidate",
      });
    }
    if (
      objectEvidenceReady &&
      item.confidence >= policy.unposedConfirmationScore
    ) {
      return deepFreeze({
        bodyId: item.bodyId,
        detectorConfidence: item.confidence,
        reason: "HIGH_CONFIDENCE_NO_OBJECT_CONFLICT",
        status: "confirmed",
      });
    }
    return deepFreeze({
      bodyId: item.bodyId,
      detectorConfidence: item.confidence,
      reason: objectEvidenceReady
        ? "DETECTOR_ONLY"
        : "OBJECT_CONFLICT_EVIDENCE_UNAVAILABLE",
      status: "candidate",
    });
  });
  const counts = Object.freeze({
    candidate: items.filter((item) => item.status === "candidate").length,
    confirmed: items.filter((item) => item.status === "confirmed").length,
    suppressed: items.filter((item) => item.status === "suppressed").length,
    total: items.length,
  });
  const binding = deepFreeze({
    bodyResultDigest: body.resultDigest,
    conflictReceiptDigest: conflictReceipt?.receiptDigest || null,
    policyDigest: bodyDetectionDigest(policy),
    poseReceiptDigest: poseReceipt?.receiptDigest || null,
  });
  const envelope = deepFreeze({
    binding,
    counts,
    schemaVersion: bodyEvidenceResolutionSchemaVersion,
  });
  resolutionEnvelopes.add(envelope);
  resolutionProjections.set(
    envelope,
    deepFreeze({
      items,
      schemaVersion: bodyEvidenceResolutionSchemaVersion,
    }),
  );
  return envelope;
};

const requireEnvelope = (value) => {
  if (!value || typeof value !== "object" || !resolutionEnvelopes.has(value)) {
    throw typedError("An exact Body evidence resolution envelope is required");
  }
  return value;
};

export const createBodyEvidenceResolutionReceipt = (value) => {
  const envelope = requireEnvelope(value);
  const core = {
    authority: {
      activation: "none",
      automaticIdentityAuthority: "none",
      recommendation: "none",
      training: "none",
    },
    binding: envelope.binding,
    boundary: {
      databaseWrites: "none",
      identityWrites: "none",
      observationDeletion: "none",
      persistence: "none",
      providerExecutionProof: "none",
      sourceMediaWrites: "none",
    },
    counts: envelope.counts,
    schemaVersion: bodyEvidenceResolutionReceiptSchemaVersion,
  };
  return deepFreeze({ ...core, receiptDigest: bodyDetectionDigest(core) });
};

export const projectValidatedBodyEvidenceResolution = (value) => {
  requireEnvelope(value);
  return resolutionProjections.get(value);
};
