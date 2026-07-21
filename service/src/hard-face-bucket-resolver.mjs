import { recognitionDigest } from "./recognition-provider-contract.mjs";

export const hardFaceBucketResolverSchemaVersion =
  "cimmich.hard-face-bucket-resolver.v1";

export const measuredHardFaceBucketPolicyV1 = Object.freeze({
  policyId: "hard_face_top2_robust_v1",
  primeMarginCeiling: 0.05,
  supportAdvantage: 0.08,
  supportFloor: 0.4,
  topK: 2,
});

const preparedEnvelopes = new WeakSet();
const resultEnvelopes = new WeakSet();
const tokenPattern = /^[a-z0-9][a-z0-9_]{2,95}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const vectorSpacePattern = /^vector_space_[a-f0-9]{64}$/;
const qualityBuckets = new Set([
  "face_core",
  "face_hard",
  "face_variant",
  "reject_noise",
  "unknown",
]);

const typedError = (message) =>
  Object.assign(new Error(message), {
    code: "HARD_FACE_BUCKET_RESOLVER_INVALID",
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
  if (
    value == null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  ) {
    throw typedError(`${label} must contain only ${keys.join(", ")}`);
  }
};

const token = (value, label) => {
  if (typeof value !== "string" || !tokenPattern.test(value)) {
    throw typedError(`${label} must be a bounded anonymous token`);
  }
  return value;
};

const digest = (value, label) => {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    throw typedError(`${label} must be a SHA-256 digest`);
  }
  return value;
};

const score = (value, label) => {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw typedError(`${label} must be in [0,1]`);
  }
  if (Number(value.toFixed(6)) !== value) {
    throw typedError(`${label} must use canonical six-decimal precision`);
  }
  return value;
};

const positivePolicyScore = (value, label) => {
  const normalized = score(value, label);
  if (normalized <= 0) throw typedError(`${label} must be positive`);
  return normalized;
};

const normalizePolicy = (value) => {
  exactObject(
    value,
    [
      "policyId",
      "primeMarginCeiling",
      "supportAdvantage",
      "supportFloor",
      "topK",
    ],
    "policy",
  );
  if (!Number.isInteger(value.topK) || value.topK < 2 || value.topK > 3) {
    throw typedError("policy.topK must be 2 or 3");
  }
  return {
    policyId: token(value.policyId, "policy.policyId"),
    primeMarginCeiling: positivePolicyScore(
      value.primeMarginCeiling,
      "policy.primeMarginCeiling",
    ),
    supportAdvantage: positivePolicyScore(
      value.supportAdvantage,
      "policy.supportAdvantage",
    ),
    supportFloor: positivePolicyScore(
      value.supportFloor,
      "policy.supportFloor",
    ),
    topK: value.topK,
  };
};

const normalizeCandidate = (value, index, queryToken) => {
  exactObject(
    value,
    ["candidateToken", "primeScore", "supports"],
    `candidates[${index}]`,
  );
  const candidateToken = token(
    value.candidateToken,
    `candidates[${index}].candidateToken`,
  );
  if (candidateToken === queryToken) {
    throw typedError("A query cannot be its own candidate");
  }
  if (!Array.isArray(value.supports) || value.supports.length > 64) {
    throw typedError(`candidates[${index}].supports must contain 0-64 rows`);
  }
  const seen = new Set();
  const supports = value.supports.map((support, supportIndex) => {
    exactObject(
      support,
      ["evidenceContextDigest", "referenceToken", "similarity"],
      `candidates[${index}].supports[${supportIndex}]`,
    );
    const referenceToken = token(
      support.referenceToken,
      `candidates[${index}].supports[${supportIndex}].referenceToken`,
    );
    if (referenceToken === queryToken || seen.has(referenceToken)) {
      throw typedError("Support reference tokens must be unique and non-query");
    }
    seen.add(referenceToken);
    return {
      evidenceContextDigest: digest(
        support.evidenceContextDigest,
        `candidates[${index}].supports[${supportIndex}].evidenceContextDigest`,
      ),
      referenceToken,
      similarity: score(
        support.similarity,
        `candidates[${index}].supports[${supportIndex}].similarity`,
      ),
    };
  });
  supports.sort((left, right) =>
    left.referenceToken.localeCompare(right.referenceToken),
  );
  return {
    candidateToken,
    primeScore: score(value.primeScore, `candidates[${index}].primeScore`),
    supports,
  };
};

export const prepareHardFaceBucketEvidence = (input) => {
  exactObject(
    input,
    [
      "baselineCandidateToken",
      "candidates",
      "policy",
      "providerConfigDigest",
      "qualityBucket",
      "queryRevisionDigest",
      "queryToken",
      "schemaVersion",
      "vectorSpaceId",
    ],
    "input",
  );
  if (input.schemaVersion !== hardFaceBucketResolverSchemaVersion) {
    throw typedError(
      `schemaVersion must be ${hardFaceBucketResolverSchemaVersion}`,
    );
  }
  const queryToken = token(input.queryToken, "queryToken");
  if (!qualityBuckets.has(input.qualityBucket)) {
    throw typedError("qualityBucket is not supported");
  }
  if (
    typeof input.vectorSpaceId !== "string" ||
    !vectorSpacePattern.test(input.vectorSpaceId)
  ) {
    throw typedError("vectorSpaceId must be a derived recognition space");
  }
  if (!Array.isArray(input.candidates) || input.candidates.length !== 2) {
    throw typedError(
      "Exactly the frozen Prime top two candidates are required",
    );
  }
  const candidates = input.candidates.map((candidate, index) =>
    normalizeCandidate(candidate, index, queryToken),
  );
  if (candidates[0].candidateToken === candidates[1].candidateToken) {
    throw typedError("Candidate tokens must be unique");
  }
  const baselineCandidateToken = token(
    input.baselineCandidateToken,
    "baselineCandidateToken",
  );
  const expectedBaseline = [...candidates].sort(
    (left, right) =>
      right.primeScore - left.primeScore ||
      left.candidateToken.localeCompare(right.candidateToken),
  )[0].candidateToken;
  if (baselineCandidateToken !== expectedBaseline) {
    throw typedError(
      "baselineCandidateToken must be the deterministic Prime leader",
    );
  }
  const sharedReferences = new Set(
    candidates[0].supports.map((row) => row.referenceToken),
  );
  if (
    candidates[1].supports.some((row) =>
      sharedReferences.has(row.referenceToken),
    )
  ) {
    throw typedError("A condition reference cannot support two candidates");
  }
  candidates.sort((left, right) =>
    left.candidateToken.localeCompare(right.candidateToken),
  );
  const core = {
    baselineCandidateToken,
    candidates,
    policy: normalizePolicy(input.policy),
    providerConfigDigest: digest(
      input.providerConfigDigest,
      "providerConfigDigest",
    ),
    qualityBucket: input.qualityBucket,
    queryRevisionDigest: digest(
      input.queryRevisionDigest,
      "queryRevisionDigest",
    ),
    queryToken,
    schemaVersion: hardFaceBucketResolverSchemaVersion,
    vectorSpaceId: input.vectorSpaceId,
  };
  const envelope = deepFreeze({
    ...core,
    evidenceDigest: recognitionDigest(core),
  });
  preparedEnvelopes.add(envelope);
  return envelope;
};

const topKMean = (supports, topK) => {
  if (supports.length < topK) return null;
  const values = supports
    .map(({ similarity }) => similarity)
    .sort((left, right) => right - left)
    .slice(0, topK);
  return Number(
    (values.reduce((total, value) => total + value, 0) / topK).toFixed(6),
  );
};

export const resolveHardFaceBucketEvidence = (envelope) => {
  if (!preparedEnvelopes.has(envelope)) {
    throw typedError("Resolver requires the exact prepared evidence envelope");
  }
  const baseline = envelope.candidates.find(
    ({ candidateToken }) => candidateToken === envelope.baselineCandidateToken,
  );
  const challenger = envelope.candidates.find(
    ({ candidateToken }) => candidateToken !== envelope.baselineCandidateToken,
  );
  const margin = Number(
    (baseline.primeScore - challenger.primeScore).toFixed(6),
  );
  const baselineSupport = topKMean(baseline.supports, envelope.policy.topK);
  const challengerSupport = topKMean(challenger.supports, envelope.policy.topK);
  let proposedCandidateToken = envelope.baselineCandidateToken;
  let reason = "NOT_HARD_QUERY";
  if (envelope.qualityBucket === "face_hard") {
    if (margin > envelope.policy.primeMarginCeiling) {
      reason = "PRIME_SEPARATED";
    } else if (baselineSupport == null || challengerSupport == null) {
      reason = "INSUFFICIENT_INDEPENDENT_SUPPORT";
    } else if (challengerSupport < envelope.policy.supportFloor) {
      reason = "SUPPORT_FLOOR_NOT_MET";
    } else if (
      Number((challengerSupport - baselineSupport).toFixed(6)) <
      envelope.policy.supportAdvantage
    ) {
      reason = "SUPPORT_ADVANTAGE_NOT_MET";
    } else {
      proposedCandidateToken = challenger.candidateToken;
      reason = "ROBUST_BUCKET_RESCUE_PROPOSED";
    }
  }
  const core = {
    authority: {
      activation: "none",
      automaticIdentityAuthority: "none",
      persistence: "none",
      recommendation: "proposal_only",
      training: "none",
    },
    baselineCandidateToken: envelope.baselineCandidateToken,
    changed: proposedCandidateToken !== envelope.baselineCandidateToken,
    evidenceDigest: envelope.evidenceDigest,
    numericEvidence: {
      baselineSupport,
      challengerSupport,
      primeMargin: margin,
    },
    proposedCandidateToken,
    reason,
    schemaVersion: hardFaceBucketResolverSchemaVersion,
  };
  const result = deepFreeze({ ...core, resultDigest: recognitionDigest(core) });
  resultEnvelopes.add(result);
  return result;
};

export const projectHardFaceBucketResult = (result) => {
  if (!resultEnvelopes.has(result)) {
    throw typedError("Projection requires the exact resolver result envelope");
  }
  return result;
};

export const hardFaceBucketResolverContractDigest = recognitionDigest({
  measuredPolicy: measuredHardFaceBucketPolicyV1,
  schemaVersion: hardFaceBucketResolverSchemaVersion,
});
