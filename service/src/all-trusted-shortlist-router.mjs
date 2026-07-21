import { projectValidatedFaceConditionClassification } from "./face-condition-classifier.mjs";
import { recognitionDigest } from "./recognition-provider-contract.mjs";
import { projectValidatedVisualCandidateSet } from "./visual-candidate-set.mjs";
import { allTrustedShortlistPolicyV1 } from "./all-trusted-shortlist-policy.mjs";

export { allTrustedShortlistPolicyV1 } from "./all-trusted-shortlist-policy.mjs";

export const allTrustedShortlistRouterSchemaVersion =
  "cimmich.all-trusted-shortlist-router.v1";

const scorePrecision = 6;
const digestPattern = /^[0-9a-f]{64}$/;
const evidenceEnvelopes = new WeakSet();
const resultEnvelopes = new WeakSet();

const typedError = (message) =>
  Object.assign(new Error(message), {
    code: "ALL_TRUSTED_SHORTLIST_INVALID",
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

const validatedPolicy = (policy) => {
  if (policy !== allTrustedShortlistPolicyV1) {
    throw typedError(
      "The exact frozen all-trusted shortlist policy is required",
    );
  }
  return policy;
};

export const prepareAllTrustedShortlistEvidence = (input) => {
  exactObject(input, "input", [
    "candidateEnvelope",
    "policy",
    "qualityClassification",
    "schemaVersion",
    "scoutEvidence",
  ]);
  if (input.schemaVersion !== allTrustedShortlistRouterSchemaVersion) {
    throw typedError(
      `schemaVersion must be ${allTrustedShortlistRouterSchemaVersion}`,
    );
  }
  const candidateEnvelope = projectValidatedVisualCandidateSet(
    input.candidateEnvelope,
  );
  if (
    candidateEnvelope.state !== "available" ||
    candidateEnvelope.candidates.length < 3
  ) {
    throw typedError("Shortlist routing requires a frozen Prime top three");
  }
  const qualityClassification = projectValidatedFaceConditionClassification(
    input.qualityClassification,
  );
  if (
    qualityClassification.queryRevisionDigest !==
    candidateEnvelope.binding.queryRevisionDigest
  ) {
    throw typedError(
      "Quality evidence does not bind the current query revision",
    );
  }
  if (!Array.isArray(input.scoutEvidence) || input.scoutEvidence.length !== 2) {
    throw typedError(
      "Scout evidence must contain the exact top two candidates",
    );
  }
  const candidatesByToken = new Map(
    candidateEnvelope.candidates.map((candidate) => [
      candidate.candidateToken,
      candidate,
    ]),
  );
  const scoutEvidence = input.scoutEvidence.map((row, index) => {
    exactObject(row, `scoutEvidence[${index}]`, [
      "candidateToken",
      "evidenceDigest",
      "scoutScore",
    ]);
    if (
      row.candidateToken !== null &&
      !candidatesByToken.has(row.candidateToken)
    ) {
      throw typedError("Scout evidence may not manufacture a candidate");
    }
    return {
      candidateToken: row.candidateToken,
      evidenceDigest: requiredDigest(
        row.evidenceDigest,
        `scoutEvidence[${index}].evidenceDigest`,
      ),
      scoutScore: canonicalScore(
        row.scoutScore,
        `scoutEvidence[${index}].scoutScore`,
      ),
    };
  });
  if (new Set(scoutEvidence.map((row) => row.candidateToken)).size !== 2) {
    throw typedError("Scout top two must contain distinct candidates");
  }
  scoutEvidence.sort(
    (left, right) =>
      right.scoutScore - left.scoutScore ||
      String(left.candidateToken || "").localeCompare(
        String(right.candidateToken || ""),
      ),
  );
  if (scoutEvidence[0].candidateToken === null) {
    throw typedError("The scout leader must exist in the frozen candidate set");
  }
  if (
    scoutEvidence[1].candidateToken !== null &&
    scoutEvidence[1].candidateToken === scoutEvidence[0].candidateToken
  ) {
    throw typedError("Scout top two must contain distinct candidates");
  }
  const core = {
    binding: {
      candidateSetDigest: candidateEnvelope.candidateSetDigest,
      packDigest: candidateEnvelope.binding.packDigest,
      providerConfigDigest: candidateEnvelope.binding.providerConfigDigest,
      queryEvidenceDigest: candidateEnvelope.binding.queryEvidenceDigest,
      queryRevisionDigest: candidateEnvelope.binding.queryRevisionDigest,
      sourceRevisionDigest: candidateEnvelope.binding.sourceRevisionDigest,
      vectorSpaceId: candidateEnvelope.binding.vectorSpaceId,
      visualPolicyDigest: candidateEnvelope.binding.visualPolicyDigest,
    },
    policy: validatedPolicy(input.policy),
    primeCandidates: candidateEnvelope.candidates,
    qualityClassification,
    schemaVersion: allTrustedShortlistRouterSchemaVersion,
    scoutEvidence,
  };
  const envelope = deepFreeze({
    ...core,
    evidenceDigest: recognitionDigest(core),
  });
  evidenceEnvelopes.add(envelope);
  return envelope;
};

export const resolveAllTrustedShortlistEvidence = (envelope) => {
  if (!evidenceEnvelopes.has(envelope)) {
    throw typedError("The exact prepared all-trusted evidence is required");
  }
  const primeTopThree = envelope.primeCandidates.slice(0, 3);
  const primeLeader = primeTopThree[0];
  const scoutLeader = envelope.scoutEvidence[0];
  const scoutRunnerUp = envelope.scoutEvidence[1];
  const candidate = envelope.primeCandidates.find(
    (row) => row.candidateToken === scoutLeader.candidateToken,
  );
  const alreadyPrime = primeTopThree.some(
    (row) => row.candidateToken === scoutLeader.candidateToken,
  );
  const primeGap = Number(
    (primeLeader.visualScore - candidate.visualScore).toFixed(scorePrecision),
  );
  const scoutAdvantage = Number(
    (scoutLeader.scoutScore - scoutRunnerUp.scoutScore).toFixed(scorePrecision),
  );
  const qualityBucket = envelope.qualityClassification.qualityBucket;
  const changed =
    qualityBucket === envelope.policy.eligibleQualityBucket &&
    !alreadyPrime &&
    candidate.visualScore >= envelope.policy.primeSupportFloor &&
    primeGap <= envelope.policy.primeGapCeiling &&
    scoutLeader.scoutScore >= envelope.policy.scoutSupportFloor &&
    scoutAdvantage >= envelope.policy.scoutAdvantage;
  let reason = "QUALITY_FAMILY_NOT_ELIGIBLE";
  if (qualityBucket === "unknown") reason = "QUALITY_CLASSIFICATION_UNKNOWN";
  else if (alreadyPrime) reason = "SCOUT_ALREADY_IN_PRIME_TOP_THREE";
  else if (candidate.visualScore < envelope.policy.primeSupportFloor)
    reason = "PRIME_SUPPORT_BELOW_FLOOR";
  else if (primeGap > envelope.policy.primeGapCeiling)
    reason = "PRIME_GAP_TOO_WIDE";
  else if (scoutLeader.scoutScore < envelope.policy.scoutSupportFloor)
    reason = "SCOUT_SUPPORT_BELOW_FLOOR";
  else if (scoutAdvantage < envelope.policy.scoutAdvantage)
    reason = "SCOUT_AMBIGUOUS";
  else if (changed) reason = "ALL_TRUSTED_REVIEW_SHORTLIST_ADDITION";
  const core = {
    authority: {
      activation: "none",
      automaticIdentityAuthority: "none",
      persistence: "none",
      recommendation: "review_shortlist_only",
      training: "none",
    },
    binding: envelope.binding,
    changed,
    evidenceDigest: envelope.evidenceDigest,
    numericEvidence: {
      candidatePrimeScore: candidate.visualScore,
      primeGap,
      scoutAdvantage,
      scoutScore: scoutLeader.scoutScore,
    },
    proposedCandidateToken: changed ? scoutLeader.candidateToken : null,
    qualityBucket,
    reason,
    schemaVersion: allTrustedShortlistRouterSchemaVersion,
  };
  const result = deepFreeze({ ...core, resultDigest: recognitionDigest(core) });
  resultEnvelopes.add(result);
  return result;
};

export const projectAllTrustedShortlistResult = (result) => {
  if (!resultEnvelopes.has(result)) {
    throw typedError("The exact all-trusted shortlist result is required");
  }
  return result;
};

export const allTrustedShortlistRouterContractDigest = recognitionDigest({
  policy: allTrustedShortlistPolicyV1,
  schemaVersion: allTrustedShortlistRouterSchemaVersion,
});
