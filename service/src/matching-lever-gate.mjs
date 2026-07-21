import { recognitionDigest } from "./recognition-provider-contract.mjs";

export const matchingLeverEvaluationSchemaVersion =
  "cimmich.matching-lever-evaluation.v1";
export const matchingLeverGateSchemaVersion = "cimmich.matching-lever-gate.v1";
export const matchingLeverEvaluationV2SchemaVersion =
  "cimmich.matching-lever-evaluation.v2";
export const matchingLeverGateV2SchemaVersion =
  "cimmich.matching-lever-gate.v2";

const digestPattern = /^[0-9a-f]{64}$/;
const publicIdentifierPattern = /^[a-z0-9](?:[a-z0-9._-]{0,63})$/;
const vectorSpacePattern = /^vector_space_[0-9a-f]{64}$/;

const qcKeys = Object.freeze([
  "ambiguousGroupTag",
  "confirmedModelRegression",
  "confirmedModelRescue",
  "historicalTagError",
  "metadataContextConflict",
  "unreviewed",
  "visuallyUnresolvable",
]);
const qcKeysV2 = Object.freeze([
  "ambiguousGroupTag",
  "confirmedModelNeutral",
  "confirmedModelRegression",
  "confirmedModelRescue",
  "historicalTagError",
  "metadataContextConflict",
  "unreviewed",
  "visuallyUnresolvable",
]);

const typedError = (message, code = "MATCHING_LEVER_INPUT_INVALID") =>
  Object.assign(new Error(message), { code, statusCode: 400 });

const exactObject = (value, label, allowedKeys, requiredKeys = allowedKeys) => {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw typedError(`${label} must be an object`);
  }
  const keys = Object.keys(value);
  if (keys.some((key) => !allowedKeys.includes(key))) {
    throw typedError(`${label} contains unsupported fields`);
  }
  if (requiredKeys.some((key) => !Object.hasOwn(value, key))) {
    throw typedError(`${label} is missing required fields`);
  }
  return value;
};

const requiredPublicIdentifier = (value, label) => {
  if (typeof value !== "string" || !publicIdentifierPattern.test(value)) {
    throw typedError(
      `${label} must be a 1-64 character lowercase public identifier`,
    );
  }
  return value;
};

const requiredDigest = (value, label) => {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    throw typedError(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
};

const requiredVectorSpace = (value, label) => {
  if (typeof value !== "string" || !vectorSpacePattern.test(value)) {
    throw typedError(
      `${label} must be a derived recognition vector-space identifier`,
    );
  }
  return value;
};

const requiredCount = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw typedError(`${label} must be a non-negative safe integer`);
  }
  return value;
};

const requestedAuthority = (value) => {
  const authority = requiredPublicIdentifier(value, "authority");
  if (!["automatic", "human_review"].includes(authority)) {
    throw typedError("authority must be automatic or human_review");
  }
  return authority;
};

const normalizedPolicy = (value, label, { candidate = false } = {}) => {
  exactObject(value, label, [
    ...(candidate ? ["artifactDigest"] : []),
    "policyId",
    "providerConfigDigest",
    "vectorSpaceId",
  ]);
  return {
    ...(candidate
      ? {
          artifactDigest: requiredDigest(
            value.artifactDigest,
            `${label}.artifactDigest`,
          ),
        }
      : {}),
    policyId: requiredPublicIdentifier(value.policyId, `${label}.policyId`),
    providerConfigDigest: requiredDigest(
      value.providerConfigDigest,
      `${label}.providerConfigDigest`,
    ),
    vectorSpaceId: requiredVectorSpace(
      value.vectorSpaceId,
      `${label}.vectorSpaceId`,
    ),
  };
};

const normalizedMetrics = (
  value,
  label,
  { holdout = false, qcKeySet = qcKeys } = {},
) => {
  const baseKeys = [
    "baselineCorrect",
    "candidateCorrect",
    "cohortDigest",
    "queries",
    "truthVersionDigest",
  ];
  exactObject(
    value,
    label,
    holdout
      ? [...baseKeys, "changedOutcomes", "consequentialChanges", "qc"]
      : baseKeys,
  );
  const result = {
    baselineCorrect: requiredCount(
      value.baselineCorrect,
      `${label}.baselineCorrect`,
    ),
    candidateCorrect: requiredCount(
      value.candidateCorrect,
      `${label}.candidateCorrect`,
    ),
    cohortDigest: requiredDigest(value.cohortDigest, `${label}.cohortDigest`),
    queries: requiredCount(value.queries, `${label}.queries`),
    truthVersionDigest: requiredDigest(
      value.truthVersionDigest,
      `${label}.truthVersionDigest`,
    ),
  };
  if (
    result.baselineCorrect > result.queries ||
    result.candidateCorrect > result.queries
  ) {
    throw typedError(`${label} correct counts cannot exceed queries`);
  }
  if (!holdout) return result;

  exactObject(value.qc, `${label}.qc`, qcKeySet);
  const qc = Object.fromEntries(
    qcKeySet.map((key) => [
      key,
      requiredCount(value.qc[key], `${label}.qc.${key}`),
    ]),
  );
  const changedOutcomes = requiredCount(
    value.changedOutcomes,
    `${label}.changedOutcomes`,
  );
  const consequentialChanges = requiredCount(
    value.consequentialChanges,
    `${label}.consequentialChanges`,
  );
  if (
    changedOutcomes > result.queries ||
    consequentialChanges > changedOutcomes
  ) {
    throw typedError(
      `${label} changed outcomes must be bounded by the query count`,
    );
  }
  if (
    changedOutcomes < Math.abs(result.candidateCorrect - result.baselineCorrect)
  ) {
    throw typedError(
      `${label} changed outcomes cannot be smaller than the correct-count delta`,
    );
  }
  return { ...result, changedOutcomes, consequentialChanges, qc };
};

const normalizeInput = (
  input,
  {
    evaluationSchemaVersion = matchingLeverEvaluationSchemaVersion,
    qcKeySet = qcKeys,
  } = {},
) => {
  exactObject(input, "input", [
    "authority",
    "baseline",
    "calibration",
    "candidate",
    "experiment",
    "gate",
    "holdout",
    "protocol",
    "schemaVersion",
  ]);
  if (input.schemaVersion !== evaluationSchemaVersion) {
    throw typedError(
      `Matching lever input must use ${evaluationSchemaVersion}`,
      "MATCHING_LEVER_SCHEMA_UNSUPPORTED",
    );
  }
  exactObject(input.experiment, "experiment", [
    "cohortDigest",
    "experimentId",
    "providerConfigDigest",
    "truthVersionDigest",
    "vectorSpaceId",
  ]);
  exactObject(input.protocol, "protocol", [
    "calibrationFrozenBeforeHoldout",
    "deterministicReplay",
    "holdoutAccess",
    "queryReferenceOverlap",
  ]);
  exactObject(input.gate, "gate", [
    "maximumConfirmedModelRegressions",
    "minimumConfirmedNetGain",
    "minimumHoldoutQueries",
    "requireCompleteQc",
  ]);
  if (input.gate.requireCompleteQc !== true) {
    throw typedError("Matching lever gate requires complete QC");
  }
  const holdoutAccess = requiredPublicIdentifier(
    input.protocol.holdoutAccess,
    "protocol.holdoutAccess",
  );
  if (holdoutAccess !== "selected_candidate_once") {
    throw typedError("protocol.holdoutAccess must be selected_candidate_once");
  }
  return {
    authority: requestedAuthority(input.authority),
    baseline: normalizedPolicy(input.baseline, "baseline"),
    calibration: normalizedMetrics(input.calibration, "calibration"),
    candidate: normalizedPolicy(input.candidate, "candidate", {
      candidate: true,
    }),
    experiment: {
      cohortDigest: requiredDigest(
        input.experiment.cohortDigest,
        "experiment.cohortDigest",
      ),
      experimentId: requiredPublicIdentifier(
        input.experiment.experimentId,
        "experiment.experimentId",
      ),
      providerConfigDigest: requiredDigest(
        input.experiment.providerConfigDigest,
        "experiment.providerConfigDigest",
      ),
      truthVersionDigest: requiredDigest(
        input.experiment.truthVersionDigest,
        "experiment.truthVersionDigest",
      ),
      vectorSpaceId: requiredVectorSpace(
        input.experiment.vectorSpaceId,
        "experiment.vectorSpaceId",
      ),
    },
    gate: {
      maximumConfirmedModelRegressions: requiredCount(
        input.gate.maximumConfirmedModelRegressions,
        "gate.maximumConfirmedModelRegressions",
      ),
      minimumConfirmedNetGain: requiredCount(
        input.gate.minimumConfirmedNetGain,
        "gate.minimumConfirmedNetGain",
      ),
      minimumHoldoutQueries: requiredCount(
        input.gate.minimumHoldoutQueries,
        "gate.minimumHoldoutQueries",
      ),
      requireCompleteQc: true,
    },
    holdout: normalizedMetrics(input.holdout, "holdout", {
      holdout: true,
      qcKeySet,
    }),
    protocol: {
      calibrationFrozenBeforeHoldout:
        input.protocol.calibrationFrozenBeforeHoldout === true,
      deterministicReplay: input.protocol.deterministicReplay === true,
      holdoutAccess,
      queryReferenceOverlap: requiredCount(
        input.protocol.queryReferenceOverlap,
        "protocol.queryReferenceOverlap",
      ),
    },
  };
};

const evaluateNormalizedMatchingLever = (
  normalized,
  { gateSchemaVersion = matchingLeverGateSchemaVersion } = {},
) => {
  const {
    authority,
    baseline,
    calibration,
    candidate,
    experiment,
    gate,
    holdout,
    protocol,
  } = normalized;
  const qcTotal = Object.values(holdout.qc).reduce(
    (sum, value) => sum + value,
    0,
  );
  const confirmedNetGain =
    holdout.qc.confirmedModelRescue - holdout.qc.confirmedModelRegression;
  const blockingReasons = [];
  if (authority !== "human_review") {
    blockingReasons.push("AUTOMATIC_AUTHORITY_FORBIDDEN");
  }
  if (
    baseline.providerConfigDigest !== experiment.providerConfigDigest ||
    candidate.providerConfigDigest !== experiment.providerConfigDigest
  ) {
    blockingReasons.push("PROVIDER_CONFIG_MISMATCH");
  }
  if (
    baseline.vectorSpaceId !== experiment.vectorSpaceId ||
    candidate.vectorSpaceId !== experiment.vectorSpaceId
  ) {
    blockingReasons.push("VECTOR_SPACE_MISMATCH");
  }
  if (
    calibration.cohortDigest !== experiment.cohortDigest ||
    holdout.cohortDigest !== experiment.cohortDigest
  ) {
    blockingReasons.push("COHORT_BINDING_MISMATCH");
  }
  if (
    calibration.truthVersionDigest !== experiment.truthVersionDigest ||
    holdout.truthVersionDigest !== experiment.truthVersionDigest
  ) {
    blockingReasons.push("TRUTH_VERSION_MISMATCH");
  }
  if (!protocol.calibrationFrozenBeforeHoldout) {
    blockingReasons.push("CALIBRATION_NOT_FROZEN");
  }
  if (!protocol.deterministicReplay) {
    blockingReasons.push("DETERMINISTIC_REPLAY_UNPROVEN");
  }
  if (protocol.queryReferenceOverlap !== 0) {
    blockingReasons.push("QUERY_REFERENCE_LEAKAGE");
  }
  if (holdout.queries < gate.minimumHoldoutQueries) {
    blockingReasons.push("HOLDOUT_COHORT_INSUFFICIENT");
  }
  if (qcTotal !== holdout.consequentialChanges) {
    blockingReasons.push("QC_ACCOUNTING_MISMATCH");
  }
  if (holdout.consequentialChanges !== holdout.changedOutcomes) {
    blockingReasons.push("CONSEQUENTIAL_CHANGE_SCOPE_MISMATCH");
  }
  if (holdout.qc.unreviewed > 0) {
    blockingReasons.push("CONSEQUENTIAL_QC_INCOMPLETE");
  }

  const rejectionReasons = [];
  if (
    holdout.qc.confirmedModelRegression > gate.maximumConfirmedModelRegressions
  ) {
    rejectionReasons.push("CONFIRMED_MODEL_REGRESSION_GATE_FAILED");
  }
  if (confirmedNetGain < gate.minimumConfirmedNetGain) {
    rejectionReasons.push("CONFIRMED_NET_GAIN_GATE_FAILED");
  }

  const decision =
    blockingReasons.length > 0
      ? { reasons: [...blockingReasons].sort(), status: "blocked" }
      : rejectionReasons.length > 0
        ? { reasons: [...rejectionReasons].sort(), status: "rejected" }
        : { reasons: [], status: "evidence_gate_passed" };
  const receipt = {
    authority: {
      activation: "none",
      automaticIdentityAuthority: "none",
      recommendation: "none",
      requested: authority,
      training: "none",
    },
    binding: {
      baselinePolicyId: baseline.policyId,
      candidateArtifactDigest: candidate.artifactDigest,
      candidatePolicyId: candidate.policyId,
      cohortDigest: experiment.cohortDigest,
      experimentId: experiment.experimentId,
      providerConfigDigest: experiment.providerConfigDigest,
      truthVersionDigest: experiment.truthVersionDigest,
      vectorSpaceId: experiment.vectorSpaceId,
    },
    boundary: {
      databaseWrites: "none",
      externalNetwork: "none",
      identityWrites: "none",
      persistence: "none",
      sourceMediaReads: "none",
      sourceMediaWrites: "none",
    },
    calibration: {
      baselineCorrect: calibration.baselineCorrect,
      candidateCorrect: calibration.candidateCorrect,
      correctDelta: calibration.candidateCorrect - calibration.baselineCorrect,
      queries: calibration.queries,
    },
    decision,
    gate,
    holdout: {
      baselineCorrect: holdout.baselineCorrect,
      candidateCorrect: holdout.candidateCorrect,
      changedOutcomes: holdout.changedOutcomes,
      confirmedNetGain,
      consequentialChanges: holdout.consequentialChanges,
      correctDelta: holdout.candidateCorrect - holdout.baselineCorrect,
      qc: holdout.qc,
      qcAccounted: qcTotal,
      queries: holdout.queries,
    },
    protocol,
    schemaVersion: gateSchemaVersion,
  };
  return { ...receipt, receiptDigest: recognitionDigest(receipt) };
};

export const evaluateMatchingLever = (input) =>
  evaluateNormalizedMatchingLever(normalizeInput(input));

export const evaluateMatchingLeverV2 = (input) =>
  evaluateNormalizedMatchingLever(
    normalizeInput(input, {
      evaluationSchemaVersion: matchingLeverEvaluationV2SchemaVersion,
      qcKeySet: qcKeysV2,
    }),
    { gateSchemaVersion: matchingLeverGateV2SchemaVersion },
  );
