import { recognitionDigest } from "./recognition-provider-contract.mjs";
import { projectValidatedFaceConditionClassification } from "./face-condition-classifier.mjs";
import { projectValidatedVisualCandidateSet } from "./visual-candidate-set.mjs";

export const providerConditionRouterSchemaVersion =
  "cimmich.provider-condition-router.v1";

export const providerConditionTopTwoPolicyV1 = Object.freeze({
  eligibleLowQualityBuckets: Object.freeze(["face_hard"]),
  eligibleSecondaryBuckets: Object.freeze(["face_hard", "face_variant"]),
  lowQualityWeight: 0.35,
  marginThreshold: 0.06,
  policyId: "provider-condition-top2-v1",
  secondaryWeight: 0.25,
});

export const providerConditionConsensusRouterSchemaVersion =
  "cimmich.provider-condition-consensus-router.v1";

export const providerConditionConsensusPolicyV1 = Object.freeze({
  eligibleQualityBucket: "face_hard",
  lowQualityAdvantage: 0.06,
  policyId: "provider-condition-consensus-v1",
  primeMarginCeiling: 0.02,
  secondaryAdvantage: 0.01,
  supportFloor: 0.2,
});

const evidenceEnvelopes = new WeakSet();
const consensusEvidenceEnvelopes = new WeakSet();
const resultEnvelopes = new WeakSet();
const digestPattern = /^[0-9a-f]{64}$/;
const scorePrecision = 6;

const typedError = (message) =>
  Object.assign(new Error(message), {
    code: "PROVIDER_CONDITION_ROUTER_INVALID",
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

const canonicalScore = (value, label) => {
  if (value == null) return null;
  if (
    !Number.isFinite(value) ||
    value < -1 ||
    value > 1 ||
    Number(value.toFixed(scorePrecision)) !== value
  ) {
    throw typedError(`${label} must be a canonical cosine score`);
  }
  return value;
};

const canonicalWeightedScore = (prime, condition, weight) =>
  condition == null
    ? prime
    : Math.max(
        prime,
        Number(((1 - weight) * prime + weight * condition).toFixed(6)),
      );

const validatedPolicy = (policy, expectedPolicy) => {
  if (policy !== expectedPolicy) {
    throw typedError(
      "The exact measured provider condition policy is required",
    );
  }
  return policy;
};

const normalizeConditionEvidence = (value, index, candidateTokens) => {
  exactObject(value, `conditionEvidence[${index}]`, [
    "candidateToken",
    "lowQualityEvidenceDigest",
    "lowQualityScore",
    "secondaryEvidenceDigest",
    "secondaryScore",
  ]);
  if (!candidateTokens.has(value.candidateToken)) {
    throw typedError(
      "Condition evidence may reference only the frozen Prime top two",
    );
  }
  const secondaryScore = canonicalScore(
    value.secondaryScore,
    `conditionEvidence[${index}].secondaryScore`,
  );
  const lowQualityScore = canonicalScore(
    value.lowQualityScore,
    `conditionEvidence[${index}].lowQualityScore`,
  );
  const secondaryEvidenceDigest =
    secondaryScore == null
      ? value.secondaryEvidenceDigest === null
        ? null
        : (() => {
            throw typedError(
              "Absent Secondary scores require a null evidence digest",
            );
          })()
      : requiredDigest(
          value.secondaryEvidenceDigest,
          `conditionEvidence[${index}].secondaryEvidenceDigest`,
        );
  const lowQualityEvidenceDigest =
    lowQualityScore == null
      ? value.lowQualityEvidenceDigest === null
        ? null
        : (() => {
            throw typedError("Absent LQ scores require a null evidence digest");
          })()
      : requiredDigest(
          value.lowQualityEvidenceDigest,
          `conditionEvidence[${index}].lowQualityEvidenceDigest`,
        );
  return {
    candidateToken: value.candidateToken,
    lowQualityEvidenceDigest,
    lowQualityScore,
    secondaryEvidenceDigest,
    secondaryScore,
  };
};

const prepareConditionEvidence = (
  input,
  { expectedPolicy, registry, schemaVersion },
) => {
  exactObject(input, "input", [
    "candidateEnvelope",
    "conditionEvidence",
    "policy",
    "qualityClassification",
    "schemaVersion",
  ]);
  if (input.schemaVersion !== schemaVersion) {
    throw typedError(`schemaVersion must be ${schemaVersion}`);
  }
  const candidateEnvelope = projectValidatedVisualCandidateSet(
    input.candidateEnvelope,
  );
  if (
    candidateEnvelope.state !== "available" ||
    candidateEnvelope.candidates.length < 2
  ) {
    throw typedError("Condition routing requires an available Prime top two");
  }
  const qualityClassification = projectValidatedFaceConditionClassification(
    input.qualityClassification,
  );
  const qualityBucket = qualityClassification.qualityBucket;
  if (
    qualityClassification.queryRevisionDigest !==
    candidateEnvelope.binding.queryRevisionDigest
  ) {
    throw typedError(
      "Quality classification does not bind the current query revision",
    );
  }
  const topTwo = candidateEnvelope.candidates.slice(0, 2);
  const candidateTokens = new Set(
    topTwo.map(({ candidateToken }) => candidateToken),
  );
  if (
    !Array.isArray(input.conditionEvidence) ||
    input.conditionEvidence.length !== 2
  ) {
    throw typedError(
      "Condition evidence must cover exactly the frozen Prime top two",
    );
  }
  const conditionEvidence = input.conditionEvidence.map((value, index) =>
    normalizeConditionEvidence(value, index, candidateTokens),
  );
  if (
    new Set(conditionEvidence.map(({ candidateToken }) => candidateToken))
      .size !== 2
  ) {
    throw typedError(
      "Condition evidence must cover each Prime candidate exactly once",
    );
  }
  conditionEvidence.sort((left, right) =>
    left.candidateToken.localeCompare(right.candidateToken),
  );
  const core = {
    binding: {
      candidateSetDigest: candidateEnvelope.candidateSetDigest,
      packDigest: candidateEnvelope.binding.packDigest,
      providerConfigDigest: candidateEnvelope.binding.providerConfigDigest,
      queryEvidenceDigest: candidateEnvelope.binding.queryEvidenceDigest,
      queryRevisionDigest: candidateEnvelope.binding.queryRevisionDigest,
      vectorSpaceId: candidateEnvelope.binding.vectorSpaceId,
      visualPolicyDigest: candidateEnvelope.binding.visualPolicyDigest,
    },
    conditionEvidence,
    policy: validatedPolicy(input.policy, expectedPolicy),
    qualityClassification,
    schemaVersion,
    topTwo,
  };
  const envelope = deepFreeze({
    ...core,
    evidenceDigest: recognitionDigest(core),
  });
  registry.add(envelope);
  return envelope;
};

export const prepareProviderConditionEvidence = (input) =>
  prepareConditionEvidence(input, {
    expectedPolicy: providerConditionTopTwoPolicyV1,
    registry: evidenceEnvelopes,
    schemaVersion: providerConditionRouterSchemaVersion,
  });

export const prepareProviderConditionConsensusEvidence = (input) =>
  prepareConditionEvidence(input, {
    expectedPolicy: providerConditionConsensusPolicyV1,
    registry: consensusEvidenceEnvelopes,
    schemaVersion: providerConditionConsensusRouterSchemaVersion,
  });

export const resolveProviderConditionEvidence = (envelope) => {
  if (!evidenceEnvelopes.has(envelope)) {
    throw typedError(
      "The exact prepared condition evidence envelope is required",
    );
  }
  const [leader, runnerUp] = envelope.topTwo;
  const margin = Number((leader.visualScore - runnerUp.visualScore).toFixed(6));
  const qualityBucket = envelope.qualityClassification.qualityBucket;
  const routeSecondary =
    margin < envelope.policy.marginThreshold &&
    envelope.policy.eligibleSecondaryBuckets.includes(qualityBucket);
  const routeLowQuality =
    margin < envelope.policy.marginThreshold &&
    envelope.policy.eligibleLowQualityBuckets.includes(qualityBucket);
  const evidenceByCandidate = new Map(
    envelope.conditionEvidence.map((row) => [row.candidateToken, row]),
  );
  const scored = envelope.topTwo.map((candidate) => {
    const evidence = evidenceByCandidate.get(candidate.candidateToken);
    const secondaryScore = routeSecondary
      ? canonicalWeightedScore(
          candidate.visualScore,
          evidence.secondaryScore,
          envelope.policy.secondaryWeight,
        )
      : candidate.visualScore;
    const lowQualityScore = routeLowQuality
      ? canonicalWeightedScore(
          candidate.visualScore,
          evidence.lowQualityScore,
          envelope.policy.lowQualityWeight,
        )
      : candidate.visualScore;
    return {
      candidateToken: candidate.candidateToken,
      conditionScore: Math.max(
        candidate.visualScore,
        secondaryScore,
        lowQualityScore,
      ),
      primeScore: candidate.visualScore,
    };
  });
  scored.sort(
    (left, right) =>
      right.conditionScore - left.conditionScore ||
      left.candidateToken.localeCompare(right.candidateToken),
  );
  const proposedCandidateToken = scored[0].candidateToken;
  let reason = "QUALITY_FAMILY_NOT_ELIGIBLE";
  if (qualityBucket === "unknown") reason = "QUALITY_CLASSIFICATION_UNKNOWN";
  else if (margin >= envelope.policy.marginThreshold)
    reason = "PRIME_SEPARATED";
  else if (routeSecondary || routeLowQuality) {
    const hasConditionEvidence = envelope.conditionEvidence.some(
      (row) =>
        (routeSecondary && row.secondaryScore != null) ||
        (routeLowQuality && row.lowQualityScore != null),
    );
    reason = hasConditionEvidence
      ? proposedCandidateToken === leader.candidateToken
        ? "PRIME_LEADER_RETAINED"
        : "CONDITIONED_TOP_TWO_PROPOSAL"
      : "CONDITION_EVIDENCE_UNAVAILABLE";
  }
  const core = {
    authority: {
      activation: "none",
      automaticIdentityAuthority: "none",
      persistence: "none",
      recommendation: "proposal_only",
      training: "none",
    },
    baselineCandidateToken: leader.candidateToken,
    binding: envelope.binding,
    changed: proposedCandidateToken !== leader.candidateToken,
    evidenceDigest: envelope.evidenceDigest,
    numericEvidence: {
      conditionedLeaderScore: scored[0].conditionScore,
      conditionedRunnerUpScore: scored[1].conditionScore,
      primeMargin: margin,
    },
    proposedCandidateToken,
    qualityBucket,
    reason,
    routedFamilies: {
      lowQuality: routeLowQuality,
      secondary: routeSecondary,
    },
    schemaVersion: providerConditionRouterSchemaVersion,
  };
  const result = deepFreeze({ ...core, resultDigest: recognitionDigest(core) });
  resultEnvelopes.add(result);
  return result;
};

export const resolveProviderConditionConsensusEvidence = (envelope) => {
  if (!consensusEvidenceEnvelopes.has(envelope)) {
    throw typedError(
      "The exact prepared condition-consensus evidence envelope is required",
    );
  }
  const [leader, runnerUp] = envelope.topTwo;
  const margin = Number((leader.visualScore - runnerUp.visualScore).toFixed(6));
  const qualityBucket = envelope.qualityClassification.qualityBucket;
  const evidenceByCandidate = new Map(
    envelope.conditionEvidence.map((row) => [row.candidateToken, row]),
  );
  const leaderEvidence = evidenceByCandidate.get(leader.candidateToken);
  const runnerUpEvidence = evidenceByCandidate.get(runnerUp.candidateToken);
  const complete = [
    leaderEvidence.secondaryScore,
    leaderEvidence.lowQualityScore,
    runnerUpEvidence.secondaryScore,
    runnerUpEvidence.lowQualityScore,
  ].every((value) => value != null);
  const secondaryAdvantage = complete
    ? Number(
        (
          runnerUpEvidence.secondaryScore - leaderEvidence.secondaryScore
        ).toFixed(6),
      )
    : null;
  const lowQualityAdvantage = complete
    ? Number(
        (
          runnerUpEvidence.lowQualityScore - leaderEvidence.lowQualityScore
        ).toFixed(6),
      )
    : null;
  const eligible = qualityBucket === envelope.policy.eligibleQualityBucket;
  const consensus =
    eligible &&
    margin <= envelope.policy.primeMarginCeiling &&
    complete &&
    runnerUpEvidence.secondaryScore >= envelope.policy.supportFloor &&
    runnerUpEvidence.lowQualityScore >= envelope.policy.supportFloor &&
    secondaryAdvantage >= envelope.policy.secondaryAdvantage &&
    lowQualityAdvantage >= envelope.policy.lowQualityAdvantage;
  let reason = "QUALITY_FAMILY_NOT_ELIGIBLE";
  if (qualityBucket === "unknown") reason = "QUALITY_CLASSIFICATION_UNKNOWN";
  else if (margin > envelope.policy.primeMarginCeiling)
    reason = "PRIME_SEPARATED";
  else if (!complete) reason = "CONDITION_CONSENSUS_UNAVAILABLE";
  else if (consensus) reason = "INDEPENDENT_CONDITION_CONSENSUS";
  else reason = "CONDITION_CONSENSUS_NOT_MET";
  const proposedCandidateToken = consensus
    ? runnerUp.candidateToken
    : leader.candidateToken;
  const core = {
    authority: {
      activation: "none",
      automaticIdentityAuthority: "none",
      persistence: "none",
      recommendation: "review_suggestion_only",
      training: "none",
    },
    baselineCandidateToken: leader.candidateToken,
    binding: envelope.binding,
    changed: consensus,
    evidenceDigest: envelope.evidenceDigest,
    numericEvidence: {
      lowQualityAdvantage,
      primeMargin: margin,
      secondaryAdvantage,
    },
    proposedCandidateToken,
    qualityBucket,
    reason,
    routedFamilies: {
      lowQuality: consensus,
      secondary: consensus,
    },
    schemaVersion: providerConditionConsensusRouterSchemaVersion,
  };
  const result = deepFreeze({ ...core, resultDigest: recognitionDigest(core) });
  resultEnvelopes.add(result);
  return result;
};

export const projectProviderConditionResult = (result) => {
  if (!resultEnvelopes.has(result)) {
    throw typedError("The exact condition result envelope is required");
  }
  return result;
};

export const providerConditionRouterContractDigest = recognitionDigest({
  consensusPolicy: providerConditionConsensusPolicyV1,
  consensusSchemaVersion: providerConditionConsensusRouterSchemaVersion,
  measuredPolicy: providerConditionTopTwoPolicyV1,
  schemaVersion: providerConditionRouterSchemaVersion,
});
