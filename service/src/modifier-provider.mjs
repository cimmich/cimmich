import { digestValue } from "./source-pack.mjs";

export const modifierVocabularyVersion = "cimmich-face-conditions-v1";

export const modifierVocabulary = Object.freeze({
  sunglasses: { label: "Sunglasses", modifierClass: "accessory_obstruction" },
  helmet: { label: "Helmet", modifierClass: "accessory_obstruction" },
  mask: { label: "Mask", modifierClass: "accessory_obstruction" },
  profile: { label: "Profile", modifierClass: "pose" },
  "low-light": { label: "Low light", modifierClass: "illumination" },
  occluded: { label: "Occluded", modifierClass: "visibility" },
});

const nonempty = (value, name) => {
  const text = String(value || "").trim();
  if (!text) throw new Error(`Modifier provider requires ${name}`);
  return text;
};

const boundedScore = (value) => {
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new Error("Modifier provider score must be between zero and one");
  }
  return score;
};

/**
 * Convert provider scores into deterministic candidate proposals.
 *
 * Missing/weak labels abstain. This function never creates an active modifier
 * or identity decision; persistence must append a `candidate` proposal event.
 */
export const compileModifierProposals = (
  packet,
  { thresholds = {}, vocabulary = modifierVocabulary } = {},
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
  const vocabularyVersion = nonempty(
    packet?.provider?.vocabularyVersion || modifierVocabularyVersion,
    "vocabulary version",
  );
  const observations = Array.isArray(packet?.observations)
    ? packet.observations
    : [];
  const proposals = [];
  for (const observation of observations) {
    const faceId = nonempty(observation.faceId, "face id");
    const cropDigest = nonempty(observation.cropDigest, "crop digest");
    const scores = observation.scores || {};
    for (const [modifierKey, rawScore] of Object.entries(scores).sort()) {
      const definition = vocabulary[modifierKey];
      if (!definition) {
        throw new Error(`Unknown modifier vocabulary key: ${modifierKey}`);
      }
      const score = boundedScore(rawScore);
      const threshold = Number(thresholds[modifierKey]);
      if (!Number.isFinite(threshold) || score < threshold) continue;
      const identity = {
        configDigest,
        cropDigest,
        faceId,
        modelName,
        modelVersion,
        modifierKey,
        providerName,
        vocabularyVersion,
      };
      proposals.push({
        calibratedConfidence: score,
        configDigest,
        cropDigest,
        evidence: {
          ...(observation.evidence || {}),
          providerScore: score,
          threshold,
        },
        faceId,
        modelName,
        modelVersion,
        modifierClass: definition.modifierClass,
        modifierKey,
        modifierLabel: definition.label,
        proposalId: `proposal_${digestValue(identity).slice(0, 32)}`,
        providerName,
        vocabularyVersion,
      });
    }
  }
  return proposals.sort(
    (left, right) =>
      left.faceId.localeCompare(right.faceId) ||
      left.modifierKey.localeCompare(right.modifierKey),
  );
};

/**
 * Strict target-local adapter for multi-crop providers.
 *
 * A contaminated crop is excluded, not averaged into a result. If no clean
 * target crop remains, the observation abstains. The combined crop digest is
 * derived here so proposal identity covers every crop actually used.
 */
export const compileTargetLocalModifierProposals = (packet, options = {}) => {
  const cropPolicyVersion = nonempty(
    packet?.provider?.cropPolicyVersion,
    "crop policy version",
  );
  const observations = [];
  for (const observation of Array.isArray(packet?.observations)
    ? packet.observations
    : []) {
    const targetLocal = observation?.targetLocal;
    if (!targetLocal || targetLocal.selectionState !== "selected") continue;
    const requestedCrops = Array.isArray(targetLocal.requestedCrops)
      ? [
          ...new Set(
            targetLocal.requestedCrops.map((value) =>
              nonempty(value, "requested crop"),
            ),
          ),
        ]
      : [];
    const usableCrops = Array.isArray(targetLocal.usableCrops)
      ? [
          ...new Set(
            targetLocal.usableCrops.map((value) =>
              nonempty(value, "usable crop"),
            ),
          ),
        ]
      : [];
    if (requestedCrops.length === 0 || usableCrops.length === 0) continue;
    if (usableCrops.some((crop) => !requestedCrops.includes(crop))) {
      throw new Error("Target-local usable crop was not requested");
    }
    const cropDigests = {};
    for (const crop of usableCrops.sort()) {
      if (targetLocal.contaminatedCrops?.[crop] === true) {
        throw new Error("Target-local usable crop cannot be contaminated");
      }
      cropDigests[crop] = nonempty(
        targetLocal.cropDigests?.[crop],
        `${crop} crop digest`,
      );
      if (cropDigests[crop].length < 16) {
        throw new Error("Target-local crop digest is not durable");
      }
    }
    observations.push({
      ...observation,
      cropDigest: digestValue({ cropDigests, cropPolicyVersion, usableCrops }),
      evidence: {
        ...(observation.evidence || {}),
        targetLocal: {
          cropDigests,
          cropPolicyVersion,
          requestedCrops,
          selectionState: "selected",
          usableCrops,
        },
      },
    });
  }
  return compileModifierProposals({ ...packet, observations }, options);
};
