import { createHash } from "node:crypto";
import {
  recognitionDigest,
  validateRecognitionObservation,
  validateRecognitionProviderManifest,
} from "./recognition-provider-contract.mjs";

export const manualRecognitionIntakeVersion =
  "cimmich.manual-recognition-intake.v1";
export const manualRecognitionQualityVersion =
  "cimmich.manual-recognition-quality.v1";
export const manualRecognitionReceiptVersion =
  "cimmich.manual-recognition-intake-receipt.v1";

const validatedEnvelopes = new WeakSet();
const sha256Pattern = /^[0-9a-f]{64}$/;
const publicIdPattern = /^[a-z0-9][a-z0-9._-]{0,95}$/;
const operationIdPattern = /^manualtagop_[0-9a-f]{32}$/;
const claimIdPattern = /^claim_manual_[0-9a-f]{32}$/;
const faceIdPattern = /^face_manual_[0-9a-f]{32}$/;
const runIdPattern = /^manualrun_[a-z0-9][a-z0-9_-]{7,55}$/;
const allowedTopLevel = new Set([
  "schemaVersion",
  "operation",
  "projection",
  "manifest",
  "runs",
  "quality",
]);
const allowedOperation = new Set([
  "operationId",
  "identityClaimId",
  "faceId",
  "assetId",
  "region",
]);
const allowedProjection = new Set([
  "sourceId",
  "immichAssetId",
  "assetId",
  "inputRevision",
  "sourceContentDigest",
]);
const allowedRegion = new Set(["x", "y", "w", "h"]);
const allowedRun = new Set(["runId", "observation"]);
const allowedQuality = new Set([
  "schemaVersion",
  "measurementDigest",
  "policyVersion",
  "policyDigest",
  "score",
  "usableThreshold",
  "lowQualityThreshold",
  "allowLowQuality",
]);

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
};

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

const fail = (message, code = "MANUAL_RECOGNITION_INPUT_INVALID") => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

const exactObject = (value, allowed, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) fail(`${label} contains unsupported fields`);
  return value;
};

const requiredText = (value, label, pattern = publicIdPattern) => {
  if (typeof value !== "string" || !pattern.test(value)) {
    fail(`${label} is invalid`);
  }
  return value;
};

const requiredDigest = (value, label) =>
  requiredText(value, label, sha256Pattern);

const fixedUnit = (value, label) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${label} must be a finite number`);
  }
  if (value < 0 || value > 1 || Number(value.toFixed(6)) !== value) {
    fail(`${label} must be canonical to six decimal places in [0,1]`);
  }
  return value;
};

const normalizeRegion = (input) => {
  const region = exactObject(input, allowedRegion, "operation.region");
  const normalized = {
    h: fixedUnit(region.h, "operation.region.h"),
    w: fixedUnit(region.w, "operation.region.w"),
    x: fixedUnit(region.x, "operation.region.x"),
    y: fixedUnit(region.y, "operation.region.y"),
  };
  if (
    normalized.w <= 0 ||
    normalized.h <= 0 ||
    normalized.x + normalized.w > 1.000001 ||
    normalized.y + normalized.h > 1.000001
  ) {
    fail("operation.region must have positive in-image area");
  }
  return normalized;
};

const deriveTier = (quality) => {
  const score = fixedUnit(quality.score, "quality.score");
  const usableThreshold = fixedUnit(
    quality.usableThreshold,
    "quality.usableThreshold",
  );
  const lowQualityThreshold = fixedUnit(
    quality.lowQualityThreshold,
    "quality.lowQualityThreshold",
  );
  if (lowQualityThreshold > usableThreshold) {
    fail("quality thresholds are not ordered");
  }
  if (score >= usableThreshold) return "secondary";
  if (quality.allowLowQuality === true && score >= lowQualityThreshold) {
    return "low_quality";
  }
  fail(
    "calibrated quality does not permit matching evaluation",
    "MANUAL_RECOGNITION_QUALITY_FAILED",
  );
};

export const manualRecognitionDigest = (value) =>
  createHash("sha256")
    .update(
      typeof value === "string" ? value : JSON.stringify(canonicalize(value)),
    )
    .digest("hex");

export const validateManualRecognitionIntake = (input) => {
  exactObject(input, allowedTopLevel, "manual recognition intake");
  if (input.schemaVersion !== manualRecognitionIntakeVersion) {
    fail(`schemaVersion must be ${manualRecognitionIntakeVersion}`);
  }
  const operationInput = exactObject(
    input.operation,
    allowedOperation,
    "operation",
  );
  const operation = {
    assetId: requiredText(operationInput.assetId, "operation.assetId"),
    faceId: requiredText(
      operationInput.faceId,
      "operation.faceId",
      faceIdPattern,
    ),
    identityClaimId: requiredText(
      operationInput.identityClaimId,
      "operation.identityClaimId",
      claimIdPattern,
    ),
    operationId: requiredText(
      operationInput.operationId,
      "operation.operationId",
      operationIdPattern,
    ),
    region: normalizeRegion(operationInput.region),
  };
  const projectionInput = exactObject(
    input.projection,
    allowedProjection,
    "projection",
  );
  const projection = {
    assetId: requiredText(projectionInput.assetId, "projection.assetId"),
    immichAssetId: requiredText(
      projectionInput.immichAssetId,
      "projection.immichAssetId",
    ),
    inputRevision: requiredDigest(
      projectionInput.inputRevision,
      "projection.inputRevision",
    ),
    sourceContentDigest: requiredDigest(
      projectionInput.sourceContentDigest,
      "projection.sourceContentDigest",
    ),
    sourceId: requiredText(projectionInput.sourceId, "projection.sourceId"),
  };
  if (projection.assetId !== operation.assetId) {
    fail("projection crosses the manual operation asset boundary");
  }

  let manifest;
  try {
    manifest = validateRecognitionProviderManifest(input.manifest);
  } catch {
    fail("recognition provider manifest is invalid");
  }
  if (!Array.isArray(input.runs) || input.runs.length !== 2) {
    fail(
      "manual recognition requires exactly two executions",
      "MANUAL_RECOGNITION_REPLAY_REQUIRED",
    );
  }
  const runs = input.runs.map((runInput) => {
    const run = exactObject(runInput, allowedRun, "run");
    const runId = requiredText(run.runId, "run.runId", runIdPattern);
    let observation;
    try {
      observation = validateRecognitionObservation(run.observation, manifest);
    } catch {
      fail("recognition run observation is invalid");
    }
    if (
      observation.observationId !== operation.faceId ||
      observation.assetToken !== operation.assetId ||
      observation.state !== "embedded"
    ) {
      fail("recognition run crosses its exact manual Face request");
    }
    return { observation, runId };
  });
  if (runs[0].runId === runs[1].runId) {
    fail(
      "manual recognition replay executions require distinct run IDs",
      "MANUAL_RECOGNITION_REPLAY_REQUIRED",
    );
  }
  const runResultDigest = recognitionDigest(runs[0].observation);
  if (recognitionDigest(runs[1].observation) !== runResultDigest) {
    fail(
      "manual recognition replay results diverged",
      "MANUAL_RECOGNITION_REPLAY_DIVERGED",
    );
  }

  const qualityInput = exactObject(input.quality, allowedQuality, "quality");
  if (qualityInput.schemaVersion !== manualRecognitionQualityVersion) {
    fail(`quality.schemaVersion must be ${manualRecognitionQualityVersion}`);
  }
  if (
    qualityInput.allowLowQuality !== true &&
    qualityInput.allowLowQuality !== false
  ) {
    fail("quality.allowLowQuality must be boolean");
  }
  const quality = {
    allowLowQuality: qualityInput.allowLowQuality,
    lowQualityThreshold: fixedUnit(
      qualityInput.lowQualityThreshold,
      "quality.lowQualityThreshold",
    ),
    measurementDigest: requiredDigest(
      qualityInput.measurementDigest,
      "quality.measurementDigest",
    ),
    policyDigest: requiredDigest(
      qualityInput.policyDigest,
      "quality.policyDigest",
    ),
    policyVersion: requiredText(
      qualityInput.policyVersion,
      "quality.policyVersion",
    ),
    schemaVersion: manualRecognitionQualityVersion,
    score: fixedUnit(qualityInput.score, "quality.score"),
    usableThreshold: fixedUnit(
      qualityInput.usableThreshold,
      "quality.usableThreshold",
    ),
  };
  const expectedPolicyDigest = manualRecognitionDigest({
    allowLowQuality: quality.allowLowQuality,
    lowQualityThreshold: quality.lowQualityThreshold,
    policyVersion: quality.policyVersion,
    usableThreshold: quality.usableThreshold,
  });
  if (quality.policyDigest !== expectedPolicyDigest) {
    fail("quality policyDigest does not match its closed policy");
  }
  const evidenceTier = deriveTier(quality);
  const regionDigest = manualRecognitionDigest(operation.region);
  const scopeKey = manualRecognitionDigest({
    configDigest: manifest.providerConfigDigest,
    modelFamily: manifest.recognizer.model,
    modelVersion: manifest.recognizer.modelVersion,
    providerId: manifest.provider.name,
    vectorSpaceId: manifest.vectorSpaceId,
  });
  const request = {
    assetId: operation.assetId,
    faceId: operation.faceId,
    identityClaimId: operation.identityClaimId,
    immichAssetId: projection.immichAssetId,
    inputRevision: projection.inputRevision,
    operationId: operation.operationId,
    providerConfigDigest: manifest.providerConfigDigest,
    regionDigest,
    sourceId: projection.sourceId,
    vectorSpaceId: manifest.vectorSpaceId,
  };
  const requestDigest = manualRecognitionDigest(request);
  const replayDigest = manualRecognitionDigest({
    requestDigest,
    resultDigest: runResultDigest,
    runIds: runs.map((run) => run.runId).sort(),
  });
  const evidenceDigest = manualRecognitionDigest({
    evidenceTier,
    measurementDigest: quality.measurementDigest,
    policyDigest: quality.policyDigest,
    replayDigest,
    requestDigest,
    sourceContentDigest: projection.sourceContentDigest,
    vectorDigest: runs[0].observation.vectorDigest,
  });
  const envelope = deepFreeze({
    authority: {
      activation: "none",
      automaticIdentity: "none",
      prime: "none",
      training: "none",
    },
    evidenceDigest,
    evidenceTier,
    manifest,
    operation,
    projection,
    quality,
    regionDigest,
    replayDigest,
    replayEvidence: "consistent",
    requestDigest,
    runResultDigest,
    runs,
    schemaVersion: manualRecognitionIntakeVersion,
    scopeKey,
    vector: runs[0].observation.vector,
    vectorDigest: runs[0].observation.vectorDigest,
  });
  validatedEnvelopes.add(envelope);
  return envelope;
};

const requireValidatedEnvelope = (envelope) => {
  if (!validatedEnvelopes.has(envelope)) {
    fail(
      "manual recognition envelope is not the exact validated instance",
      "MANUAL_RECOGNITION_ENVELOPE_INVALID",
    );
  }
  return envelope;
};

export const projectValidatedManualRecognitionCommit = (envelopeInput) => {
  const envelope = requireValidatedEnvelope(envelopeInput);
  return deepFreeze({
    assetId: envelope.operation.assetId,
    dimension: envelope.manifest.embedding.dimension,
    evidenceDigest: envelope.evidenceDigest,
    evidenceTier: envelope.evidenceTier,
    faceId: envelope.operation.faceId,
    identityClaimId: envelope.operation.identityClaimId,
    inputRevision: envelope.projection.inputRevision,
    manifest: envelope.manifest,
    measurementDigest: envelope.quality.measurementDigest,
    operationId: envelope.operation.operationId,
    policyDigest: envelope.quality.policyDigest,
    policyVersion: envelope.quality.policyVersion,
    projection: envelope.projection,
    qualityScore: envelope.quality.score,
    qualityAllowLowQuality: envelope.quality.allowLowQuality,
    qualityLowThreshold: envelope.quality.lowQualityThreshold,
    qualityUsableThreshold: envelope.quality.usableThreshold,
    region: envelope.operation.region,
    regionDigest: envelope.regionDigest,
    replayDigest: envelope.replayDigest,
    requestDigest: envelope.requestDigest,
    runIds: envelope.runs.map((run) => run.runId),
    runResultDigest: envelope.runResultDigest,
    scopeKey: envelope.scopeKey,
    sourceContentDigest: envelope.projection.sourceContentDigest,
    vector: envelope.vector,
    vectorDigest: envelope.vectorDigest,
  });
};

export const createManualRecognitionIntakeReceipt = (envelopeInput) => {
  const envelope = requireValidatedEnvelope(envelopeInput);
  return deepFreeze({
    authority: envelope.authority,
    evidenceDigest: envelope.evidenceDigest,
    evidenceTier: envelope.evidenceTier,
    providerConfigDigest: envelope.manifest.providerConfigDigest,
    replayEvidence: envelope.replayEvidence,
    requestDigest: envelope.requestDigest,
    resultDigest: envelope.runResultDigest,
    schemaVersion: manualRecognitionReceiptVersion,
    vectorSpaceId: envelope.manifest.vectorSpaceId,
  });
};
