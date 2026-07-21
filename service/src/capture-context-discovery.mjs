export const captureContextDiscoveryVersion =
  "cimmich-capture-context-discovery-v1";

const finite = (value, fallback = Number.POSITIVE_INFINITY) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

const clamp01 = (value) => Math.max(0, Math.min(1, finite(value, 0)));

/**
 * Classify a pair as a capture-context candidate from independent evidence.
 *
 * This function deliberately emits no identity or accepted context truth. The
 * caller may cluster candidate edges, but must preserve the feature receipt
 * and expose merge/split/remove controls before any matching-active use.
 */
export const classifyCaptureContextPair = (raw = {}) => {
  const timeDeltaSeconds = Math.abs(finite(raw.timeDeltaSeconds));
  const filenameSequenceDelta = Math.abs(finite(raw.filenameSequenceDelta));
  const perceptualSimilarity = clamp01(raw.perceptualSimilarity);
  const sameDevice = raw.sameDevice === true;
  const sameLocation = raw.sameLocation === true;
  const acceptedCoappearanceCount = Math.max(
    0,
    Math.trunc(finite(raw.acceptedCoappearanceCount, 0)),
  );
  const exactDuplicate = raw.exactDuplicate === true;

  if (exactDuplicate) {
    return {
      confidence: 1,
      contextKind: "sequence",
      evidence: {
        acceptedCoappearanceCount,
        exactDuplicate: true,
        filenameSequenceDelta:
          filenameSequenceDelta === Number.POSITIVE_INFINITY
            ? null
            : filenameSequenceDelta,
        perceptualSimilarity,
        sameDevice,
        sameLocation,
        timeDeltaSeconds:
          timeDeltaSeconds === Number.POSITIVE_INFINITY
            ? null
            : timeDeltaSeconds,
      },
      independenceDisposition: "same-source-observation",
      providerVersion: captureContextDiscoveryVersion,
    };
  }

  const filenameContinuous = filenameSequenceDelta <= 2;
  const filenameNearby = filenameSequenceDelta <= 12;
  const continuitySupport = filenameContinuous || sameDevice || sameLocation;

  if (
    timeDeltaSeconds <= 4 &&
    perceptualSimilarity >= 0.82 &&
    continuitySupport
  ) {
    return {
      confidence: Math.min(
        0.99,
        0.72 +
          0.16 * perceptualSimilarity +
          (filenameContinuous ? 0.06 : 0) +
          (sameDevice ? 0.03 : 0) +
          (sameLocation ? 0.02 : 0),
      ),
      contextKind: "rapid_burst",
      evidence: {
        acceptedCoappearanceCount,
        exactDuplicate: false,
        filenameSequenceDelta:
          filenameSequenceDelta === Number.POSITIVE_INFINITY
            ? null
            : filenameSequenceDelta,
        perceptualSimilarity,
        sameDevice,
        sameLocation,
        timeDeltaSeconds,
      },
      independenceDisposition: "shared-capture-context",
      providerVersion: captureContextDiscoveryVersion,
    };
  }

  if (
    timeDeltaSeconds <= 120 &&
    perceptualSimilarity >= 0.88 &&
    (filenameNearby || sameDevice || sameLocation)
  ) {
    return {
      confidence: Math.min(
        0.97,
        0.66 +
          0.2 * perceptualSimilarity +
          (filenameNearby ? 0.05 : 0) +
          (sameDevice ? 0.03 : 0) +
          (sameLocation ? 0.02 : 0) +
          Math.min(0.01, acceptedCoappearanceCount * 0.002),
      ),
      contextKind: "same_moment",
      evidence: {
        acceptedCoappearanceCount,
        exactDuplicate: false,
        filenameSequenceDelta:
          filenameSequenceDelta === Number.POSITIVE_INFINITY
            ? null
            : filenameSequenceDelta,
        perceptualSimilarity,
        sameDevice,
        sameLocation,
        timeDeltaSeconds,
      },
      independenceDisposition: "shared-capture-context",
      providerVersion: captureContextDiscoveryVersion,
    };
  }

  if (
    timeDeltaSeconds <= 900 &&
    perceptualSimilarity >= 0.92 &&
    filenameSequenceDelta <= 20 &&
    sameDevice
  ) {
    return {
      confidence: Math.min(
        0.95,
        0.62 +
          0.22 * perceptualSimilarity +
          (sameLocation ? 0.03 : 0) +
          Math.min(0.02, acceptedCoappearanceCount * 0.003),
      ),
      contextKind: "sequence",
      evidence: {
        acceptedCoappearanceCount,
        exactDuplicate: false,
        filenameSequenceDelta,
        perceptualSimilarity,
        sameDevice,
        sameLocation,
        timeDeltaSeconds,
      },
      independenceDisposition: "shared-capture-context",
      providerVersion: captureContextDiscoveryVersion,
    };
  }

  return null;
};
