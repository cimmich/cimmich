import { recognitionDigest } from "./recognition-provider-contract.mjs";

export const providerReviewEvaluationSchemaVersion =
  "cimmich.provider-review-evaluation.v1";
export const providerReviewGateSchemaVersion =
  "cimmich.provider-review-gate.v1";

const digestPattern = /^[0-9a-f]{64}$/;
const publicIdentifierPattern = /^[a-z0-9](?:[a-z0-9._-]{0,63})$/;
const vectorSpacePattern = /^vector_space_[0-9a-f]{64}$/;

const typedError = (message, code) =>
  Object.assign(new Error(message), { code, statusCode: 400 });

const requiredText = (value, label) => {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw typedError(`${label} is required`, "PROVIDER_REVIEW_INPUT_INVALID");
  }
  return normalized;
};

const requiredPublicIdentifier = (value, label) => {
  const identifier = requiredText(value, label);
  if (!publicIdentifierPattern.test(identifier)) {
    throw typedError(
      `${label} must be a 1-64 character lowercase public identifier`,
      "PROVIDER_REVIEW_INPUT_INVALID",
    );
  }
  return identifier;
};

const requestedAuthority = (value) => {
  const authority = requiredPublicIdentifier(value, "authority");
  if (!["human_review", "automatic"].includes(authority)) {
    throw typedError(
      "authority must be human_review or automatic",
      "PROVIDER_REVIEW_INPUT_INVALID",
    );
  }
  return authority;
};

const requiredDigest = (value, label) => {
  const digest = requiredText(value, label);
  if (!digestPattern.test(digest)) {
    throw typedError(
      `${label} must be a lowercase SHA-256 digest`,
      "PROVIDER_REVIEW_INPUT_INVALID",
    );
  }
  return digest;
};

const requiredProbability = (value, label) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw typedError(
      `${label} must be between zero and one`,
      "PROVIDER_REVIEW_INPUT_INVALID",
    );
  }
  return number;
};

const optionalProbability = (value, label) =>
  value == null ? null : requiredProbability(value, label);

const optionalCount = (value, label) => {
  if (value == null) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw typedError(
      `${label} must be a non-negative integer`,
      "PROVIDER_REVIEW_INPUT_INVALID",
    );
  }
  return number;
};

const requiredVectorSpace = (value, label) => {
  const vectorSpaceId = requiredText(value, label);
  if (!vectorSpacePattern.test(vectorSpaceId)) {
    throw typedError(
      `${label} must be a derived recognition vector-space identifier`,
      "PROVIDER_REVIEW_INPUT_INVALID",
    );
  }
  return vectorSpaceId;
};

const candidateArtifactKind = (value, label) => {
  const kind = requiredText(value, label);
  if (!["evaluation_policy", "source_pack"].includes(kind)) {
    throw typedError(
      `${label} must be evaluation_policy or source_pack`,
      "PROVIDER_REVIEW_INPUT_INVALID",
    );
  }
  return kind;
};

const metricLane = (value, label, { candidateRequired = false } = {}) => ({
  anchoredPeopleCovered: optionalCount(
    value?.anchoredPeopleCovered,
    `${label}.anchoredPeopleCovered`,
  ),
  anchoredPeopleExpected: optionalCount(
    value?.anchoredPeopleExpected,
    `${label}.anchoredPeopleExpected`,
  ),
  correctKnownCoverage: requiredProbability(
    value?.correctKnownCoverage,
    `${label}.correctKnownCoverage`,
  ),
  decisionPrecision: optionalProbability(
    value?.decisionPrecision,
    `${label}.decisionPrecision`,
  ),
  deterministicReplay:
    value?.deterministicReplay == null
      ? null
      : value.deterministicReplay === true,
  forcedTop1: optionalProbability(value?.forcedTop1, `${label}.forcedTop1`),
  hardFalseFlips: optionalCount(
    value?.hardFalseFlips,
    `${label}.hardFalseFlips`,
  ),
  hardRescues: optionalCount(value?.hardRescues, `${label}.hardRescues`),
  label: requiredPublicIdentifier(value?.label, `${label}.label`),
  ordinaryFalseFlips: optionalCount(
    value?.ordinaryFalseFlips,
    `${label}.ordinaryFalseFlips`,
  ),
  artifactKind: candidateRequired
    ? candidateArtifactKind(value?.artifactKind, `${label}.artifactKind`)
    : null,
  candidateDigest: candidateRequired
    ? requiredDigest(value?.candidateDigest, `${label}.candidateDigest`)
    : null,
  unknownFar: optionalProbability(value?.unknownFar, `${label}.unknownFar`),
  vectorSpaceId: requiredVectorSpace(
    value?.vectorSpaceId,
    `${label}.vectorSpaceId`,
  ),
  verifiedUnknowns: optionalCount(
    value?.verifiedUnknowns,
    `${label}.verifiedUnknowns`,
  ),
});

const normalizeInput = (input) => {
  if (input?.schemaVersion !== providerReviewEvaluationSchemaVersion) {
    throw typedError(
      `Provider review input must use ${providerReviewEvaluationSchemaVersion}`,
      "PROVIDER_REVIEW_SCHEMA_UNSUPPORTED",
    );
  }
  const authority = requestedAuthority(input.authority);
  const provider = {
    providerConfigDigest: requiredDigest(
      input?.provider?.providerConfigDigest,
      "provider.providerConfigDigest",
    ),
    providerName: requiredPublicIdentifier(
      input?.provider?.providerName,
      "provider.providerName",
    ),
    vectorSpaceId: requiredVectorSpace(
      input?.provider?.vectorSpaceId,
      "provider.vectorSpaceId",
    ),
  };
  const gate = {
    maximumUnknownFar: optionalProbability(
      input?.gate?.maximumUnknownFar ?? 0.025,
      "gate.maximumUnknownFar",
    ),
    minimumCoverageGain: optionalProbability(
      input?.gate?.minimumCoverageGain ?? 0,
      "gate.minimumCoverageGain",
    ),
    minimumDecisionPrecision: optionalProbability(
      input?.gate?.minimumDecisionPrecision ?? 0.98,
      "gate.minimumDecisionPrecision",
    ),
    minimumVerifiedUnknowns: optionalCount(
      input?.gate?.minimumVerifiedUnknowns ?? 100,
      "gate.minimumVerifiedUnknowns",
    ),
  };
  return {
    authority,
    baseline: metricLane(input.baseline, "baseline"),
    candidate: metricLane(input.candidate, "candidate", {
      candidateRequired: true,
    }),
    gate,
    provider,
  };
};

const promotionProofReasons = ({ candidate, gate }) => {
  const reasons = [];
  if (candidate.artifactKind !== "source_pack")
    reasons.push("SOURCE_PACK_PROOF_REQUIRED");
  if (candidate.deterministicReplay !== true)
    reasons.push("DETERMINISTIC_REPLAY_UNPROVEN");
  if (
    candidate.anchoredPeopleExpected == null ||
    candidate.anchoredPeopleCovered == null ||
    candidate.anchoredPeopleCovered !== candidate.anchoredPeopleExpected
  ) {
    reasons.push("ANCHORED_PERSON_COVERAGE_INCOMPLETE");
  }
  if (
    candidate.decisionPrecision == null ||
    candidate.decisionPrecision < gate.minimumDecisionPrecision
  ) {
    reasons.push("DECISION_PRECISION_GATE_FAILED");
  }
  if (
    candidate.unknownFar == null ||
    candidate.unknownFar > gate.maximumUnknownFar
  ) {
    reasons.push("UNKNOWN_FAR_GATE_FAILED");
  }
  if (
    candidate.verifiedUnknowns == null ||
    candidate.verifiedUnknowns < gate.minimumVerifiedUnknowns
  ) {
    reasons.push("VERIFIED_UNKNOWN_COHORT_INSUFFICIENT");
  }
  if (
    candidate.ordinaryFalseFlips == null ||
    candidate.ordinaryFalseFlips > 0
  ) {
    reasons.push("ORDINARY_FALSE_FLIP_GATE_FAILED");
  }
  if (
    candidate.hardRescues == null ||
    candidate.hardFalseFlips == null ||
    candidate.hardRescues < candidate.hardFalseFlips
  ) {
    reasons.push("HARD_CONDITION_NET_GAIN_UNPROVEN");
  }
  return reasons;
};

export const evaluateProviderReview = (input) => {
  const normalized = normalizeInput(input);
  const { authority, baseline, candidate, gate, provider } = normalized;
  const comparable =
    provider.vectorSpaceId === baseline.vectorSpaceId &&
    provider.vectorSpaceId === candidate.vectorSpaceId;
  const coverageGain = Number(
    (candidate.correctKnownCoverage - baseline.correctKnownCoverage).toFixed(
      12,
    ),
  );
  const structuralReasons = [];
  if (authority !== "human_review")
    structuralReasons.push("AUTOMATIC_AUTHORITY_FORBIDDEN");
  if (!comparable) structuralReasons.push("VECTOR_SPACE_MISMATCH");

  let status;
  let reasons;
  if (structuralReasons.length > 0) {
    status = "blocked";
    reasons = structuralReasons;
  } else if (coverageGain <= gate.minimumCoverageGain) {
    status = "rejected";
    reasons = ["CORRECT_KNOWN_COVERAGE_NOT_IMPROVED"];
  } else {
    reasons = promotionProofReasons({ candidate, gate });
    status = reasons.length > 0 ? "blocked" : "passed_for_operator_review";
  }

  const receipt = {
    authority: {
      activation: "none",
      automaticIdentityAuthority: "none",
      requested: authority,
      trainingFromIdentityAcceptance: false,
    },
    boundary: {
      databaseWrites: "none",
      externalNetwork: "none",
      identityWrites: "none",
      persistence: "none",
      sourceMediaReads: "none",
      sourceMediaWrites: "none",
    },
    comparison: {
      baseline: {
        correctKnownCoverage: baseline.correctKnownCoverage,
        forcedTop1: baseline.forcedTop1,
        label: baseline.label,
      },
      candidate: {
        artifactKind: candidate.artifactKind,
        candidateDigest: candidate.candidateDigest,
        correctKnownCoverage: candidate.correctKnownCoverage,
        decisionPrecision: candidate.decisionPrecision,
        forcedTop1: candidate.forcedTop1,
        label: candidate.label,
        unknownFar: candidate.unknownFar,
        verifiedUnknowns: candidate.verifiedUnknowns,
      },
      comparable,
      correctKnownCoverageGain: coverageGain,
      vectorSpaceId: comparable ? provider.vectorSpaceId : null,
    },
    decision: {
      reasons: [...reasons].sort(),
      status,
    },
    gate,
    provider: {
      providerConfigDigest: provider.providerConfigDigest,
      providerName: provider.providerName,
      vectorSpaceId: provider.vectorSpaceId,
    },
    schemaVersion: providerReviewGateSchemaVersion,
  };
  return {
    ...receipt,
    receiptDigest: recognitionDigest(receipt),
  };
};
