import {
  candidateSurvivesSamePhotoPrior,
  samePhotoAcceptedCandidateFloor,
} from "./candidate-context-policy.mjs";
import { recognitionDigest } from "./recognition-provider-contract.mjs";

export const contextualCandidatePriorSchemaVersion =
  "cimmich.contextual-candidate-prior.v2";
export const contextualCandidatePriorResultSchemaVersion =
  "cimmich.contextual-candidate-prior-result.v2";

const digestPattern = /^[0-9a-f]{64}$/;
const vectorSpacePattern = /^vector_space_[0-9a-f]{64}$/;
const tokenPattern = /^[0-9a-f]{64}$/;
const scorePrecision = 6;

const captureKinds = Object.freeze([
  "duplicate",
  "none",
  "rapid_burst",
  "same_moment",
  "sequence",
]);
const supportStates = Object.freeze([
  "not_supporting",
  "supporting",
  "unavailable",
]);
const reliabilityStates = Object.freeze([
  "conflicted",
  "suspect",
  "unavailable",
  "verified",
]);
const ambiguityStates = Object.freeze([
  "body_assignment",
  "capture_context",
  "metadata_conflict",
  "multi_candidate",
  "none",
]);

const typedError = (
  message,
  code = "CONTEXTUAL_CANDIDATE_PRIOR_INPUT_INVALID",
) => Object.assign(new Error(message), { code, statusCode: 400 });

const exactObject = (value, label, keys) => {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw typedError(`${label} must be an object`);
  }
  const actualKeys = Object.keys(value);
  if (
    actualKeys.length !== keys.length ||
    actualKeys.some((key) => !keys.includes(key))
  ) {
    throw typedError(`${label} must use the exact contract fields`);
  }
  return value;
};

const requiredEnum = (value, label, allowed) => {
  if (!allowed.includes(value)) {
    throw typedError(`${label} must use a supported value`);
  }
  return value;
};

const requiredDigest = (value, label) => {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    throw typedError(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
};

const requiredVectorSpace = (value) => {
  if (typeof value !== "string" || !vectorSpacePattern.test(value)) {
    throw typedError(
      "vectorSpaceId must be a derived recognition vector-space identifier",
    );
  }
  return value;
};

const requiredToken = (value, label) => {
  if (typeof value !== "string" || !tokenPattern.test(value)) {
    throw typedError(`${label} must be an anonymous 64-hex token`);
  }
  return value;
};

const boundedNumber = (
  value,
  label,
  { minimum = 0, maximum = 1, positive = false } = {},
) => {
  if (
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum ||
    (positive && value <= 0) ||
    Number(value.toFixed(scorePrecision)) !== value
  ) {
    throw typedError(`${label} must be a bounded finite decimal`);
  }
  return value;
};

const boundedInteger = (value, label, maximum) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw typedError(`${label} must be a bounded non-negative integer`);
  }
  return value;
};

const roundScore = (value) => Number(value.toFixed(scorePrecision));

const normalizedSamePhoto = (value, label) => {
  exactObject(value, label, ["evidenceDigest", "state"]);
  return {
    evidenceDigest: requiredDigest(
      value.evidenceDigest,
      `${label}.evidenceDigest`,
    ),
    state: requiredEnum(value.state, `${label}.state`, [
      "accepted_present",
      "absent",
      "unknown",
    ]),
  };
};

const normalizedCaptureContext = (value, label) => {
  exactObject(value, label, [
    "coappearance",
    "confidence",
    "contextKind",
    "evidenceDigest",
    "reliability",
    "state",
    "time",
  ]);
  const result = {
    coappearance: requiredEnum(
      value.coappearance,
      `${label}.coappearance`,
      supportStates,
    ),
    confidence: boundedNumber(value.confidence, `${label}.confidence`),
    contextKind: requiredEnum(
      value.contextKind,
      `${label}.contextKind`,
      captureKinds,
    ),
    evidenceDigest: requiredDigest(
      value.evidenceDigest,
      `${label}.evidenceDigest`,
    ),
    reliability: requiredEnum(
      value.reliability,
      `${label}.reliability`,
      reliabilityStates,
    ),
    state: requiredEnum(value.state, `${label}.state`, [
      "supported",
      "unavailable",
      "unsupported",
    ]),
    time: requiredEnum(value.time, `${label}.time`, supportStates),
  };
  if (
    (result.state === "supported" && result.contextKind === "none") ||
    (result.state !== "supported" && result.contextKind !== "none")
  ) {
    throw typedError(`${label} state and contextKind are inconsistent`);
  }
  return result;
};

const normalizedBodyContinuity = (value, label) => {
  exactObject(value, label, ["evidenceDigest", "margin", "score", "state"]);
  const result = {
    evidenceDigest: requiredDigest(
      value.evidenceDigest,
      `${label}.evidenceDigest`,
    ),
    margin: boundedNumber(value.margin, `${label}.margin`),
    score: boundedNumber(value.score, `${label}.score`),
    state: requiredEnum(value.state, `${label}.state`, [
      "ambiguous",
      "supported",
      "unavailable",
      "unsupported",
    ]),
  };
  if (
    result.state !== "supported" &&
    (result.score !== 0 || result.margin !== 0)
  ) {
    throw typedError(`${label} non-supporting states require zero evidence`);
  }
  return result;
};

const normalizedMetadata = (value, label) => {
  exactObject(value, label, ["errorSeconds", "evidenceDigest", "reliability"]);
  return {
    errorSeconds: boundedInteger(
      value.errorSeconds,
      `${label}.errorSeconds`,
      315_360_000,
    ),
    evidenceDigest: requiredDigest(
      value.evidenceDigest,
      `${label}.evidenceDigest`,
    ),
    reliability: requiredEnum(
      value.reliability,
      `${label}.reliability`,
      reliabilityStates,
    ),
  };
};

const normalizedAmbiguity = (value, label) => {
  exactObject(value, label, ["evidenceDigest", "state"]);
  return {
    evidenceDigest: requiredDigest(
      value.evidenceDigest,
      `${label}.evidenceDigest`,
    ),
    state: requiredEnum(value.state, `${label}.state`, ambiguityStates),
  };
};

const normalizedCandidate = (value, index) => {
  const label = `candidates[${index}]`;
  exactObject(value, label, [
    "ambiguity",
    "bodyContinuity",
    "candidateToken",
    "captureContext",
    "metadata",
    "samePhoto",
    "visualScore",
  ]);
  return {
    ambiguity: normalizedAmbiguity(value.ambiguity, `${label}.ambiguity`),
    bodyContinuity: normalizedBodyContinuity(
      value.bodyContinuity,
      `${label}.bodyContinuity`,
    ),
    candidateToken: requiredToken(
      value.candidateToken,
      `${label}.candidateToken`,
    ),
    captureContext: normalizedCaptureContext(
      value.captureContext,
      `${label}.captureContext`,
    ),
    metadata: normalizedMetadata(value.metadata, `${label}.metadata`),
    samePhoto: normalizedSamePhoto(value.samePhoto, `${label}.samePhoto`),
    visualScore: boundedNumber(value.visualScore, `${label}.visualScore`),
  };
};

const normalizedPolicy = (value) => {
  exactObject(value, "policy", [
    "bodyAdjustment",
    "captureAdjustment",
    "maximumMetadataErrorSeconds",
    "maximumTotalAdjustment",
    "minimumBodyMargin",
    "minimumBodyScore",
    "minimumCaptureConfidence",
    "tieWindow",
    "visualFloor",
  ]);
  const result = {
    bodyAdjustment: boundedNumber(
      value.bodyAdjustment,
      "policy.bodyAdjustment",
      {
        maximum: 0.01,
        positive: true,
      },
    ),
    captureAdjustment: boundedNumber(
      value.captureAdjustment,
      "policy.captureAdjustment",
      { maximum: 0.01, positive: true },
    ),
    maximumMetadataErrorSeconds: boundedInteger(
      value.maximumMetadataErrorSeconds,
      "policy.maximumMetadataErrorSeconds",
      315_360_000,
    ),
    maximumTotalAdjustment: boundedNumber(
      value.maximumTotalAdjustment,
      "policy.maximumTotalAdjustment",
      { maximum: 0.03, positive: true },
    ),
    minimumBodyMargin: boundedNumber(
      value.minimumBodyMargin,
      "policy.minimumBodyMargin",
    ),
    minimumBodyScore: boundedNumber(
      value.minimumBodyScore,
      "policy.minimumBodyScore",
    ),
    minimumCaptureConfidence: boundedNumber(
      value.minimumCaptureConfidence,
      "policy.minimumCaptureConfidence",
    ),
    tieWindow: boundedNumber(value.tieWindow, "policy.tieWindow", {
      maximum: 0.03,
      positive: true,
    }),
    visualFloor: boundedNumber(value.visualFloor, "policy.visualFloor"),
  };
  if (
    roundScore(result.bodyAdjustment + result.captureAdjustment) >
    result.maximumTotalAdjustment
  ) {
    throw typedError("policy family adjustments exceed the total cap");
  }
  return result;
};

const candidateSetProjection = (candidates) =>
  [...candidates]
    .map(({ candidateToken, visualScore }) => ({
      candidateToken,
      visualScore,
    }))
    .sort((left, right) =>
      left.candidateToken.localeCompare(right.candidateToken),
    );

const evidenceProjection = (candidates) =>
  [...candidates]
    .map(
      ({
        ambiguity,
        bodyContinuity,
        candidateToken,
        captureContext,
        metadata,
        samePhoto,
      }) => ({
        ambiguity,
        bodyContinuity,
        candidateToken,
        captureContext,
        metadata,
        samePhoto,
      }),
    )
    .sort((left, right) =>
      left.candidateToken.localeCompare(right.candidateToken),
    );

export const contextualCandidateSetDigest = (candidates) =>
  recognitionDigest(candidateSetProjection(candidates));

export const contextualEvidenceDigest = (candidates) =>
  recognitionDigest(evidenceProjection(candidates));

export const contextualPolicyDigest = (policy) =>
  recognitionDigest(normalizedPolicy(policy));

const normalizedInput = (input) => {
  exactObject(input, "input", [
    "baseline",
    "bodyContinuitySource",
    "candidateSetDigest",
    "candidates",
    "cohortDigest",
    "contextPolicyDigest",
    "evidenceDigest",
    "nonRepresentative",
    "operationalUse",
    "policy",
    "providerConfigDigest",
    "queryToken",
    "schemaVersion",
    "truthVersionDigest",
    "vectorSpaceId",
    "visualPolicyDigest",
  ]);
  if (input.schemaVersion !== contextualCandidatePriorSchemaVersion) {
    throw typedError(
      `Contextual candidate prior input must use ${contextualCandidatePriorSchemaVersion}`,
      "CONTEXTUAL_CANDIDATE_PRIOR_SCHEMA_UNSUPPORTED",
    );
  }
  if (input.nonRepresentative !== true || input.operationalUse !== "none") {
    throw typedError(
      "Contextual candidate prior V2 is non-representative and has no operational use",
    );
  }
  if (input.bodyContinuitySource !== "synthetic_fixture") {
    throw typedError(
      "Cross-photo body continuity is limited to synthetic_fixture evidence",
    );
  }
  if (!Array.isArray(input.candidates)) {
    throw typedError("candidates must be an array");
  }
  if (input.candidates.length < 1 || input.candidates.length > 64) {
    throw typedError("candidates must contain 1-64 entries");
  }
  const policy = normalizedPolicy(input.policy);
  const candidates = input.candidates.map(normalizedCandidate);
  const candidateTokens = new Set(candidates.map((row) => row.candidateToken));
  if (candidateTokens.size !== candidates.length) {
    throw typedError("candidate tokens must be unique");
  }
  const queryToken = requiredToken(input.queryToken, "queryToken");
  if (candidateTokens.has(queryToken)) {
    throw typedError("queryToken must be distinct from every candidate token");
  }
  if (candidates.some((row) => row.visualScore < policy.visualFloor)) {
    throw typedError("every candidate must satisfy the frozen visual floor");
  }

  exactObject(input.baseline, "baseline", [
    "candidateToken",
    "margin",
    "visualScore",
  ]);
  const baseline = {
    candidateToken: requiredToken(
      input.baseline.candidateToken,
      "baseline.candidateToken",
    ),
    margin: boundedNumber(input.baseline.margin, "baseline.margin"),
    visualScore: boundedNumber(
      input.baseline.visualScore,
      "baseline.visualScore",
    ),
  };
  const visuallyRanked = [...candidates].sort(
    (left, right) =>
      right.visualScore - left.visualScore ||
      left.candidateToken.localeCompare(right.candidateToken),
  );
  if (
    visuallyRanked[0].candidateToken !== baseline.candidateToken ||
    visuallyRanked[0].visualScore !== baseline.visualScore
  ) {
    throw typedError("baseline winner must match the strongest candidate");
  }
  if (
    visuallyRanked.length > 1 &&
    visuallyRanked[0].visualScore === visuallyRanked[1].visualScore
  ) {
    throw typedError("baseline winner must be visually unique");
  }
  const expectedMargin =
    visuallyRanked.length === 1
      ? 1
      : roundScore(
          visuallyRanked[0].visualScore - visuallyRanked[1].visualScore,
        );
  if (baseline.margin !== expectedMargin) {
    throw typedError("baseline margin is inconsistent with the candidate set");
  }

  const candidateSetDigest = requiredDigest(
    input.candidateSetDigest,
    "candidateSetDigest",
  );
  if (candidateSetDigest !== contextualCandidateSetDigest(candidates)) {
    throw typedError("candidateSetDigest does not match the candidate set");
  }
  const evidenceDigest = requiredDigest(input.evidenceDigest, "evidenceDigest");
  if (evidenceDigest !== contextualEvidenceDigest(candidates)) {
    throw typedError("evidenceDigest does not match candidate evidence");
  }
  const contextPolicyDigest = requiredDigest(
    input.contextPolicyDigest,
    "contextPolicyDigest",
  );
  if (contextPolicyDigest !== recognitionDigest(policy)) {
    throw typedError("contextPolicyDigest does not match policy");
  }

  return {
    baseline,
    bodyContinuitySource: "synthetic_fixture",
    candidateSetDigest,
    candidates: [...candidates].sort((left, right) =>
      left.candidateToken.localeCompare(right.candidateToken),
    ),
    cohortDigest: requiredDigest(input.cohortDigest, "cohortDigest"),
    contextPolicyDigest,
    evidenceDigest,
    nonRepresentative: true,
    operationalUse: "none",
    policy,
    providerConfigDigest: requiredDigest(
      input.providerConfigDigest,
      "providerConfigDigest",
    ),
    queryToken,
    schemaVersion: contextualCandidatePriorSchemaVersion,
    truthVersionDigest: requiredDigest(
      input.truthVersionDigest,
      "truthVersionDigest",
    ),
    vectorSpaceId: requiredVectorSpace(input.vectorSpaceId),
    visualPolicyDigest: requiredDigest(
      input.visualPolicyDigest,
      "visualPolicyDigest",
    ),
  };
};

const uniqueWinner = (candidates, adjustmentFor) => {
  const ranked = candidates
    .map((candidate) => ({
      candidateToken: candidate.candidateToken,
      score: roundScore(
        Math.min(1, candidate.visualScore + adjustmentFor(candidate)),
      ),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.candidateToken.localeCompare(right.candidateToken),
    );
  if (ranked.length > 1 && ranked[0].score === ranked[1].score) return null;
  return ranked[0]?.candidateToken ?? null;
};

const emptyAdjustment = Object.freeze({
  bodyContinuity: 0,
  captureContext: 0,
  total: 0,
});

const resultCandidate = (candidate, adjustment = emptyAdjustment) => ({
  adjustedScore: roundScore(
    Math.min(1, candidate.visualScore + adjustment.total),
  ),
  adjustment,
  candidateToken: candidate.candidateToken,
  visualScore: candidate.visualScore,
});

export const evaluateContextualCandidatePrior = (input) => {
  const normalized = normalizedInput(input);
  const { baseline, candidates, policy } = normalized;
  const surviving = candidates.filter((candidate) =>
    candidateSurvivesSamePhotoPrior({
      samePhotoAccepted: candidate.samePhoto.state === "accepted_present",
      score: candidate.visualScore,
    }),
  );
  const baselineSurvives = surviving.some(
    (candidate) => candidate.candidateToken === baseline.candidateToken,
  );

  let status = "unchanged";
  let reasons = [];
  let proposedCandidateToken = null;
  let adjustments = new Map();

  if (!baselineSurvives) {
    status = "candidate_suppressed";
    reasons = ["BASELINE_SUPPRESSED_BY_SAME_PHOTO_ACCEPTED"];
  } else if (surviving.length === 1) {
    reasons = ["SINGLE_CANDIDATE"];
  } else if (baseline.margin > policy.tieWindow) {
    reasons = ["SEPARATED_VISUAL_WINNER"];
  } else if (
    surviving.some(
      (candidate) =>
        candidate.ambiguity.state !== "none" ||
        candidate.bodyContinuity.state === "ambiguous",
    )
  ) {
    status = "abstained";
    reasons = ["UNRESOLVED_CONTEXT_AMBIGUITY"];
  } else if (
    surviving.some(
      (candidate) =>
        candidate.captureContext.state === "supported" &&
        (candidate.captureContext.reliability !== "verified" ||
          candidate.metadata.reliability !== "verified" ||
          candidate.metadata.errorSeconds > policy.maximumMetadataErrorSeconds),
    )
  ) {
    status = "abstained";
    reasons = ["METADATA_RELIABILITY_INSUFFICIENT"];
  } else {
    const familyAdjustment = (candidate) => {
      const captureReliable =
        candidate.captureContext.state === "supported" &&
        candidate.captureContext.contextKind !== "duplicate" &&
        candidate.captureContext.reliability === "verified" &&
        candidate.captureContext.confidence >=
          policy.minimumCaptureConfidence &&
        candidate.metadata.reliability === "verified" &&
        candidate.metadata.errorSeconds <= policy.maximumMetadataErrorSeconds;
      const bodyReliable =
        candidate.bodyContinuity.state === "supported" &&
        candidate.bodyContinuity.score >= policy.minimumBodyScore &&
        candidate.bodyContinuity.margin >= policy.minimumBodyMargin;
      const captureContext = captureReliable ? policy.captureAdjustment : 0;
      const bodyContinuity = bodyReliable ? policy.bodyAdjustment : 0;
      return {
        bodyContinuity,
        captureContext,
        total: roundScore(bodyContinuity + captureContext),
      };
    };
    adjustments = new Map(
      surviving.map((candidate) => [
        candidate.candidateToken,
        familyAdjustment(candidate),
      ]),
    );
    const captureWinner = uniqueWinner(
      surviving,
      (candidate) => adjustments.get(candidate.candidateToken).captureContext,
    );
    const bodyWinner = uniqueWinner(
      surviving,
      (candidate) => adjustments.get(candidate.candidateToken).bodyContinuity,
    );
    const combinedWinner = uniqueWinner(
      surviving,
      (candidate) => adjustments.get(candidate.candidateToken).total,
    );
    const combinedAdjustment = combinedWinner
      ? adjustments.get(combinedWinner)
      : null;

    if (captureWinner !== baseline.candidateToken) {
      status = "abstained";
      reasons = ["CAPTURE_COUNTERFACTUAL_CHANGED_BASELINE"];
    } else if (bodyWinner !== baseline.candidateToken) {
      status = "abstained";
      reasons = ["BODY_COUNTERFACTUAL_CHANGED_BASELINE"];
    } else if (combinedWinner == null) {
      status = "abstained";
      reasons = ["COMBINED_CONTEXT_UNRESOLVED"];
    } else if (combinedWinner === baseline.candidateToken) {
      reasons = ["COMBINED_CONTEXT_LEFT_BASELINE_UNCHANGED"];
    } else if (
      combinedAdjustment.captureContext === 0 ||
      combinedAdjustment.bodyContinuity === 0
    ) {
      status = "abstained";
      reasons = ["TWO_INDEPENDENT_FAMILIES_REQUIRED"];
    } else {
      status = "tie_break_proposed";
      reasons = ["COMBINED_INDEPENDENT_CONTEXT_TIE_BREAK"];
      proposedCandidateToken = combinedWinner;
    }
  }

  const outputCandidates = surviving.map((candidate) =>
    resultCandidate(
      candidate,
      adjustments.get(candidate.candidateToken) || emptyAdjustment,
    ),
  );
  const receipt = {
    authority: {
      activation: "none",
      automaticIdentityAuthority: "none",
      persistence: "none",
      recommendation: "none",
      training: "none",
    },
    binding: {
      candidateSetDigest: normalized.candidateSetDigest,
      cohortDigest: normalized.cohortDigest,
      contextPolicyDigest: normalized.contextPolicyDigest,
      evidenceDigest: normalized.evidenceDigest,
      providerConfigDigest: normalized.providerConfigDigest,
      truthVersionDigest: normalized.truthVersionDigest,
      vectorSpaceId: normalized.vectorSpaceId,
      visualPolicyDigest: normalized.visualPolicyDigest,
    },
    boundary: {
      bodyContinuitySource: "synthetic_fixture",
      identityDecision: "none",
      operationalUse: "none",
    },
    candidates: outputCandidates,
    decision: {
      baselineCandidateToken: baseline.candidateToken,
      proposedCandidateToken,
      reasons,
      status,
    },
    nonRepresentative: true,
    operationalUse: "none",
    queryToken: normalized.queryToken,
    schemaVersion: contextualCandidatePriorResultSchemaVersion,
    visualBoundary: {
      samePhotoAcceptedCandidateFloor,
      tieWindow: policy.tieWindow,
      visualFloor: policy.visualFloor,
    },
  };
  return { ...receipt, receiptDigest: recognitionDigest(receipt) };
};
