import { recognitionDigest } from "./recognition-provider-contract.mjs";

export const faceConditionClassifierSchemaVersion =
  "cimmich.face-condition-classifier.v1";

export const waveOneFaceConditionPolicyV1 = Object.freeze({
  coreAreaFloor: 0.002,
  coreFrontalFloor: 0.55,
  coreQualityFloor: 0.62,
  policyId: "wave1-face-condition-v1",
  rawAreaFloor: 0.00015,
  rawDetectionFloor: 0.24,
  usableQualityFloor: 0.45,
  variantAreaFloor: 0.001,
  variantFrontalFloor: 0.3,
});

const resultEnvelopes = new WeakSet();
const digestPattern = /^[0-9a-f]{64}$/;
const precision = 6;

const typedError = (message) =>
  Object.assign(new Error(message), {
    code: "FACE_CONDITION_CLASSIFIER_INVALID",
    statusCode: 400,
  });

const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

const exactObject = (value, label, keys) => {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw typedError(`${label} must be an object`);
  }
  const actual = Object.keys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => !keys.includes(key))
  ) {
    throw typedError(`${label} must use the exact contract fields`);
  }
};

const requiredDigest = (value, label) => {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    throw typedError(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
};

const unitScore = (value, label, { nullable = false } = {}) => {
  if (nullable && value == null) return null;
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1 ||
    Number(value.toFixed(precision)) !== value
  ) {
    throw typedError(`${label} must be a canonical unit-interval score`);
  }
  return value;
};

export const classifyFaceConditionObservation = ({ observation, policy }) => {
  if (policy !== waveOneFaceConditionPolicyV1) {
    throw typedError("The exact measured face-condition policy is required");
  }
  exactObject(observation, "observation", [
    "detectionConfidence",
    "faceAreaRatio",
    "frontalScore",
    "qualityScore",
  ]);
  const normalized = {
    detectionConfidence: unitScore(
      observation.detectionConfidence,
      "observation.detectionConfidence",
      { nullable: true },
    ),
    faceAreaRatio: unitScore(
      observation.faceAreaRatio,
      "observation.faceAreaRatio",
    ),
    frontalScore: unitScore(
      observation.frontalScore,
      "observation.frontalScore",
      { nullable: true },
    ),
    qualityScore: unitScore(
      observation.qualityScore,
      "observation.qualityScore",
      { nullable: true },
    ),
  };
  let qualityBucket = "unknown";
  let reason = "QUALITY_EVIDENCE_INCOMPLETE";
  if (normalized.detectionConfidence != null) {
    if (
      normalized.detectionConfidence < policy.rawDetectionFloor ||
      normalized.faceAreaRatio < policy.rawAreaFloor
    ) {
      qualityBucket = "reject_noise";
      reason = "RAW_FACE_FLOOR_NOT_MET";
    } else if (
      normalized.qualityScore != null &&
      normalized.frontalScore != null
    ) {
      if (
        normalized.qualityScore >= policy.coreQualityFloor &&
        normalized.frontalScore >= policy.coreFrontalFloor &&
        normalized.faceAreaRatio >= policy.coreAreaFloor
      ) {
        qualityBucket = "face_core";
        reason = "CORE_QUALITY_MET";
      } else if (
        normalized.qualityScore >= policy.usableQualityFloor &&
        normalized.frontalScore >= policy.variantFrontalFloor &&
        normalized.faceAreaRatio >= policy.variantAreaFloor
      ) {
        qualityBucket = "face_variant";
        reason = "VARIANT_QUALITY_MET";
      } else {
        qualityBucket = "face_hard";
        reason = "HARD_FACE_REVIEW_ONLY";
      }
    }
  }
  return deepFreeze({ observation: normalized, qualityBucket, reason });
};

export const classifyFaceCondition = (input) => {
  exactObject(input, "input", [
    "observation",
    "policy",
    "queryRevisionDigest",
    "schemaVersion",
  ]);
  if (input.schemaVersion !== faceConditionClassifierSchemaVersion) {
    throw typedError(
      `schemaVersion must be ${faceConditionClassifierSchemaVersion}`,
    );
  }
  const classified = classifyFaceConditionObservation({
    observation: input.observation,
    policy: input.policy,
  });
  const { observation, qualityBucket, reason } = classified;
  const queryRevisionDigest = requiredDigest(
    input.queryRevisionDigest,
    "queryRevisionDigest",
  );
  const classifierConfigDigest = recognitionDigest({
    policy: input.policy,
    schemaVersion: faceConditionClassifierSchemaVersion,
  });
  const core = {
    authority: {
      automaticIdentityAuthority: "none",
      humanFaceTruth: "none",
      persistence: "none",
      training: "none",
    },
    classifierConfigDigest,
    observationEvidenceDigest: recognitionDigest(observation),
    qualityBucket,
    queryRevisionDigest,
    reason,
    schemaVersion: faceConditionClassifierSchemaVersion,
  };
  const envelope = deepFreeze({
    ...core,
    classificationDigest: recognitionDigest(core),
  });
  resultEnvelopes.add(envelope);
  return envelope;
};

export const projectValidatedFaceConditionClassification = (result) => {
  if (!resultEnvelopes.has(result)) {
    throw typedError(
      "The exact face-condition classification envelope is required",
    );
  }
  return result;
};

export const faceConditionClassifierContractDigest = recognitionDigest({
  measuredPolicy: waveOneFaceConditionPolicyV1,
  schemaVersion: faceConditionClassifierSchemaVersion,
});
