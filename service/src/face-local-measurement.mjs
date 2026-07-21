import { digestValue } from "./source-pack.mjs";

export const faceLocalMeasurementVersion = "cimmich-face-local-measurement-v3";

export const defaultFaceLocalMeasurementPolicy = Object.freeze({
  maxContaminationOverlap: 0.12,
  maxPrimeAbsPitchDegrees: 25,
  maxPrimeAbsYawDegrees: 35,
  minCompleteRegionVisibility: 0.65,
  minCompleteVisibility: 0.82,
  minPrimeFacePixels: 64,
  version: "cimmich-face-local-policy-v1",
});

const nonempty = (value, name) => {
  const text = String(value || "").trim();
  if (!text) throw new Error(`Face-local measurement requires ${name}`);
  return text;
};

const finite = (value, name) => {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Face-local measurement requires finite ${name}`);
  }
  return number;
};

const bounded = (value, name) => {
  const number = finite(value, name);
  if (number < 0 || number > 1) {
    throw new Error(
      `Face-local measurement ${name} must be between zero and one`,
    );
  }
  return number;
};

const optionalBounded = (value, name) =>
  value == null ? null : bounded(value, name);

const cleanCropDigests = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Face-local measurement requires crop digests");
  }
  const entries = Object.entries(value)
    .filter(([, digest]) => digest != null)
    .map(([key, digest]) => [
      nonempty(key, "crop name"),
      nonempty(digest, "crop digest"),
    ])
    .sort(([left], [right]) => left.localeCompare(right));
  if (
    entries.length === 0 ||
    entries.some(([, digest]) => digest.length < 16)
  ) {
    throw new Error(
      "Face-local measurement crop digests must contain a durable digest",
    );
  }
  return Object.fromEntries(entries);
};

const cleanTargetSelection = (value = {}) => {
  const state = nonempty(value.state, "target selection state");
  if (!["provided", "selected", "ambiguous", "missing"].includes(state)) {
    throw new Error(`Unsupported target selection state: ${state}`);
  }
  return {
    confidence: optionalBounded(
      value.confidence,
      "target selection confidence",
    ),
    expectedLandmarkCount:
      value.expectedLandmarkCount == null
        ? null
        : Math.max(
            0,
            Math.trunc(
              finite(value.expectedLandmarkCount, "expected landmark count"),
            ),
          ),
    landmarkCount:
      value.landmarkCount == null
        ? null
        : Math.max(
            0,
            Math.trunc(finite(value.landmarkCount, "landmark count")),
          ),
    landmarkConfidence: optionalBounded(
      value.landmarkConfidence,
      "landmark confidence",
    ),
    landmarkState:
      value.landmarkState == null
        ? null
        : nonempty(value.landmarkState, "landmark state"),
    method:
      value.method == null
        ? null
        : nonempty(value.method, "target selection method"),
    state,
  };
};

const cleanContaminationEvidence = (value = {}) => ({
  centerIntrusion: Boolean(value.centerIntrusion),
  maximumOverlap: bounded(
    value.maximumOverlap ?? 0,
    "maximum contamination overlap",
  ),
  nearbyFaceCount: Math.max(
    0,
    Math.trunc(finite(value.nearbyFaceCount ?? 0, "nearby face count")),
  ),
});

const cleanContamination = (value = {}) => ({
  ...cleanContaminationEvidence(value),
  regions: Object.fromEntries(
    ["eyes", "forehead", "jaw", "mouth", "nose"]
      .filter((region) => value.regions?.[region] != null)
      .map((region) => [
        region,
        cleanContaminationEvidence(value.regions[region]),
      ]),
  ),
});

const cleanGeometry = (value = {}) => ({
  boundaryTruncated: Boolean(value.boundaryTruncated),
  facePixelHeight: Math.max(
    0,
    finite(value.facePixelHeight, "face pixel height"),
  ),
  facePixelWidth: Math.max(0, finite(value.facePixelWidth, "face pixel width")),
});

const cleanPose = (value) =>
  value == null
    ? null
    : {
        calibrated: value.calibrated === true,
        pitchDegrees: finite(value.pitchDegrees, "pose pitch"),
        rollDegrees: finite(value.rollDegrees, "pose roll"),
        yawDegrees: finite(value.yawDegrees, "pose yaw"),
      };

const cleanPhotometrics = (value) =>
  value == null
    ? null
    : {
        dynamicRange: optionalBounded(
          value.dynamicRange,
          "photometric dynamic range",
        ),
        lumaHigh: optionalBounded(value.lumaHigh, "high luma percentile"),
        lumaLow: optionalBounded(value.lumaLow, "low luma percentile"),
        lumaMedian: optionalBounded(value.lumaMedian, "median luma"),
        sharpness: optionalBounded(value.sharpness, "calibrated sharpness"),
      };

const cleanVisibility = (value = {}) => {
  const state = nonempty(value.state || "unmeasured", "visibility state");
  if (!["measured", "partially_measured", "unmeasured"].includes(state)) {
    throw new Error(`Unsupported visibility state: ${state}`);
  }
  const regions = {};
  for (const key of ["eyes", "forehead", "jaw", "mouth", "nose"]) {
    if (value.regions?.[key] != null) {
      regions[key] = bounded(value.regions[key], `${key} visibility`);
    }
  }
  if (state === "measured" && Object.keys(regions).length !== 5) {
    throw new Error("Measured visibility requires all five face regions");
  }
  if (
    state === "partially_measured" &&
    (Object.keys(regions).length === 0 || Object.keys(regions).length === 5)
  ) {
    throw new Error(
      "Partially measured visibility requires between one and four face regions",
    );
  }
  if (state === "unmeasured" && Object.keys(regions).length > 0) {
    throw new Error("Unmeasured visibility cannot carry region scores");
  }
  return { regions, state };
};

const cleanQuality = (value) => {
  if (value == null) return null;
  return {
    calibrated: value.calibrated === true,
    score: bounded(value.score, "quality score"),
    threshold: bounded(value.threshold, "quality threshold"),
  };
};

const deriveMeasurement = (
  { contamination, geometry, pose, quality, targetSelection, visibility },
  policy,
) => {
  if (!["provided", "selected"].includes(targetSelection.state)) {
    return {
      abstentionReason: `target_${targetSelection.state}`,
      completeness: "unknown",
      primeEligibility: "unknown",
      state: "abstained",
      visibleIdentityFraction: null,
    };
  }
  const visibilityRegions = Object.keys(visibility.regions);
  const scopedContaminated =
    visibilityRegions.length > 0
      ? visibilityRegions.some((region) => {
          const evidence = contamination.regions[region] ?? contamination;
          return (
            evidence.centerIntrusion ||
            evidence.maximumOverlap > policy.maxContaminationOverlap
          );
        })
      : contamination.centerIntrusion ||
        contamination.maximumOverlap > policy.maxContaminationOverlap;
  if (scopedContaminated) {
    return {
      abstentionReason: "target_contaminated",
      completeness: "unknown",
      primeEligibility: "unknown",
      state: "abstained",
      visibleIdentityFraction: null,
    };
  }

  if (geometry.boundaryTruncated) {
    return {
      abstentionReason: null,
      completeness: "incomplete",
      primeEligibility: "unqualifying",
      state: "measured",
      visibleIdentityFraction: null,
    };
  }

  if (visibility.state === "unmeasured") {
    return {
      abstentionReason: null,
      completeness: "unknown",
      primeEligibility: "unknown",
      state: "measured",
      visibleIdentityFraction: null,
    };
  }

  const regionScores = Object.values(visibility.regions);
  const knownIncomplete = regionScores.some(
    (score) => score < policy.minCompleteRegionVisibility,
  );
  if (knownIncomplete) {
    return {
      abstentionReason: null,
      completeness: "incomplete",
      primeEligibility: "unqualifying",
      state: "measured",
      visibleIdentityFraction:
        visibility.state === "measured"
          ? regionScores.reduce((total, score) => total + score, 0) /
            regionScores.length
          : null,
    };
  }
  if (visibility.state === "partially_measured") {
    return {
      abstentionReason: null,
      completeness: "unknown",
      primeEligibility: "unknown",
      state: "measured",
      visibleIdentityFraction: null,
    };
  }
  const visibleIdentityFraction =
    regionScores.reduce((total, score) => total + score, 0) /
    regionScores.length;
  const completeEnough =
    visibleIdentityFraction >= policy.minCompleteVisibility &&
    regionScores.every((score) => score >= policy.minCompleteRegionVisibility);
  if (!completeEnough) {
    return {
      abstentionReason: null,
      completeness: "incomplete",
      primeEligibility: "unqualifying",
      state: "measured",
      visibleIdentityFraction,
    };
  }

  const enoughPixels =
    Math.min(geometry.facePixelHeight, geometry.facePixelWidth) >=
    policy.minPrimeFacePixels;
  const primePose =
    pose?.calibrated === true &&
    Math.abs(pose.yawDegrees) <= policy.maxPrimeAbsYawDegrees &&
    Math.abs(pose.pitchDegrees) <= policy.maxPrimeAbsPitchDegrees;
  const calibratedPose = pose?.calibrated === true;
  const calibratedQuality = quality?.calibrated === true;
  const qualityPass = calibratedQuality && quality.score >= quality.threshold;
  const primeEligibility =
    !enoughPixels || (calibratedQuality && !qualityPass)
      ? "unqualifying"
      : !calibratedPose || !calibratedQuality
        ? "unknown"
        : primePose
          ? "qualifying"
          : "unqualifying";

  return {
    abstentionReason: null,
    completeness: "complete_enough",
    primeEligibility,
    state: "measured",
    visibleIdentityFraction,
  };
};

/**
 * Compile provider evidence into immutable face-local measurement records.
 *
 * Landmark existence selects a target but never proves face completeness.
 * Visibility must be independently measured; otherwise completeness and Prime
 * eligibility remain unknown. No identity or gallery mutation is emitted.
 */
export const compileFaceLocalMeasurements = (
  packet,
  { policy: suppliedPolicy = {} } = {},
) => {
  const providerName = nonempty(packet?.provider?.name, "provider name");
  const modelName = nonempty(packet?.provider?.model, "model name");
  const modelVersion = nonempty(
    packet?.provider?.modelVersion,
    "model version",
  );
  const configDigest = nonempty(
    packet?.provider?.configDigest,
    "config digest",
  );
  const measurementVersion = nonempty(
    packet?.provider?.measurementVersion || faceLocalMeasurementVersion,
    "measurement version",
  );
  const cropPolicyVersion = nonempty(
    packet?.provider?.cropPolicyVersion,
    "crop policy version",
  );
  const policy = { ...defaultFaceLocalMeasurementPolicy, ...suppliedPolicy };
  const observations = Array.isArray(packet?.observations)
    ? packet.observations
    : [];

  return observations
    .map((observation) => {
      const faceId = nonempty(observation.faceId, "face id");
      const evidence = {
        contamination: cleanContamination(observation.contamination),
        cropDigests: cleanCropDigests(observation.cropDigests),
        geometry: cleanGeometry(observation.geometry),
        photometrics: cleanPhotometrics(observation.photometrics),
        pose: cleanPose(observation.pose),
        quality: cleanQuality(observation.quality),
        targetSelection: cleanTargetSelection(observation.targetSelection),
        visibility: cleanVisibility(observation.visibility),
      };
      const derived = deriveMeasurement(evidence, policy);
      const identity = {
        configDigest,
        cropDigests: evidence.cropDigests,
        cropPolicyVersion,
        faceId,
        measurementVersion,
        modelName,
        modelVersion,
        providerName,
      };
      return {
        ...evidence,
        ...derived,
        configDigest,
        cropPolicyVersion,
        faceId,
        measurementId: `face_measurement_${digestValue(identity).slice(0, 32)}`,
        measurementVersion,
        modelName,
        modelVersion,
        policyVersion: nonempty(policy.version, "policy version"),
        providerName,
      };
    })
    .sort((left, right) => left.faceId.localeCompare(right.faceId));
};
