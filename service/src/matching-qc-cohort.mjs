import {
  evaluateMatchingLever,
  evaluateMatchingLeverV2,
} from "./matching-lever-gate.mjs";
import { recognitionDigest } from "./recognition-provider-contract.mjs";

export const matchingQcCohortSchemaVersion = "cimmich.matching-qc-cohort.v1";
export const matchingQcReviewPacketSchemaVersion =
  "cimmich.matching-qc-review-packet.v1";
export const matchingQcCompletionSchemaVersion =
  "cimmich.matching-qc-completion.v1";
export const matchingQcReceiptSchemaVersion = "cimmich.matching-qc-receipt.v1";
export const matchingQcCohortV2SchemaVersion = "cimmich.matching-qc-cohort.v2";
export const matchingQcReviewPacketV2SchemaVersion =
  "cimmich.matching-qc-review-packet.v2";
export const matchingQcCompletionV2SchemaVersion =
  "cimmich.matching-qc-completion.v2";
export const matchingQcReceiptV2SchemaVersion =
  "cimmich.matching-qc-receipt.v2";

const digestPattern = /^[0-9a-f]{64}$/;
const publicIdentifierPattern = /^[a-z0-9](?:[a-z0-9._-]{0,63})$/;
const vectorSpacePattern = /^vector_space_[0-9a-f]{64}$/;
const maximumRowsPerSplit = 4096;
const maximumReferenceTokens = 4096;
const maximumReferenceTokensV2 = 16384;
const validatedCompletionEnvelopes = new WeakSet();
const validatedCompletionV2Envelopes = new WeakSet();

const conflictDispositions = Object.freeze([
  "ambiguous_group_tag",
  "historical_tag_error",
  "metadata_context_conflict",
  "unreviewed",
  "visually_unresolvable",
]);
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
const qcKeyByDisposition = Object.freeze({
  ambiguous_group_tag: "ambiguousGroupTag",
  confirmed_model_neutral: "confirmedModelNeutral",
  confirmed_model_regression: "confirmedModelRegression",
  confirmed_model_rescue: "confirmedModelRescue",
  historical_tag_error: "historicalTagError",
  metadata_context_conflict: "metadataContextConflict",
  unreviewed: "unreviewed",
  visually_unresolvable: "visuallyUnresolvable",
});

const typedError = (message) =>
  Object.assign(new Error(message), {
    code: "MATCHING_QC_INPUT_INVALID",
    statusCode: 400,
  });

const exactObject = (value, label, allowedKeys) => {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw typedError(`${label} must be an object`);
  }
  const keys = Object.keys(value);
  if (
    keys.length !== allowedKeys.length ||
    keys.some((key) => !allowedKeys.includes(key))
  ) {
    throw typedError(`${label} fields are invalid`);
  }
  return value;
};

const requiredDigest = (value, label) => {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    throw typedError(`${label} must be a lowercase SHA-256 digest`);
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

const requiredVectorSpace = (value, label) => {
  if (typeof value !== "string" || !vectorSpacePattern.test(value)) {
    throw typedError(`${label} must be a derived vector-space identifier`);
  }
  return value;
};

const requiredCount = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw typedError(`${label} must be a non-negative safe integer`);
  }
  return value;
};

const requiredBoolean = (value, label) => {
  if (value !== true && value !== false) {
    throw typedError(`${label} must be boolean`);
  }
  return value;
};

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

const uniqueSortedDigests = (value, label, maximum, { empty = false } = {}) => {
  if (!Array.isArray(value) || (!empty && value.length === 0)) {
    throw typedError(`${label} must be a non-empty array`);
  }
  if (value.length > maximum) {
    throw typedError(`${label} exceeds its absolute limit`);
  }
  const normalized = value.map((item, index) =>
    requiredDigest(item, `${label}[${index}]`),
  );
  if (new Set(normalized).size !== normalized.length) {
    throw typedError(`${label} contains duplicates`);
  }
  return normalized.sort();
};

const normalizeReferenceTokens = (
  value,
  label,
  { maximum = maximumReferenceTokens, split = false } = {},
) => {
  if (!split) {
    return uniqueSortedDigests(value, label, maximum, { empty: true });
  }
  exactObject(value, label, ["calibration", "holdout"]);
  return {
    calibration: uniqueSortedDigests(
      value.calibration,
      `${label}.calibration`,
      maximum,
      { empty: true },
    ),
    holdout: uniqueSortedDigests(value.holdout, `${label}.holdout`, maximum, {
      empty: true,
    }),
  };
};

const normalizePolicy = (value, label, { artifact = false } = {}) => {
  exactObject(value, label, [
    ...(artifact ? ["artifactDigest"] : []),
    "policyId",
    "providerConfigDigest",
    "vectorSpaceId",
  ]);
  return {
    ...(artifact
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

const normalizeDecision = (value, label, eligibleCandidateTokens) => {
  exactObject(value, label, [
    "candidateToken",
    "firstResultDigest",
    "secondResultDigest",
  ]);
  const candidateToken =
    value.candidateToken == null
      ? null
      : requiredDigest(value.candidateToken, `${label}.candidateToken`);
  if (candidateToken && !eligibleCandidateTokens.includes(candidateToken)) {
    throw typedError(`${label}.candidateToken is not visually eligible`);
  }
  return {
    candidateToken,
    firstResultDigest: requiredDigest(
      value.firstResultDigest,
      `${label}.firstResultDigest`,
    ),
    secondResultDigest: requiredDigest(
      value.secondResultDigest,
      `${label}.secondResultDigest`,
    ),
  };
};

const normalizeTruth = (
  value,
  label,
  eligibleCandidateTokens,
  { allowOutsideCandidateTruth = false } = {},
) => {
  exactObject(value, label, ["candidateToken", "state"]);
  const supportedStates = allowOutsideCandidateTruth
    ? ["resolved", "resolved_outside_candidate_set", "unresolved"]
    : ["resolved", "unresolved"];
  if (!supportedStates.includes(value.state)) {
    throw typedError(`${label}.state is unsupported`);
  }
  const candidateToken =
    value.candidateToken == null
      ? null
      : requiredDigest(value.candidateToken, `${label}.candidateToken`);
  if (value.state === "resolved") {
    if (!candidateToken || !eligibleCandidateTokens.includes(candidateToken)) {
      throw typedError(`${label} resolved truth must be visually eligible`);
    }
  } else if (value.state === "resolved_outside_candidate_set") {
    if (!candidateToken || eligibleCandidateTokens.includes(candidateToken)) {
      throw typedError(
        `${label} outside-candidate truth must name a non-candidate token`,
      );
    }
  } else if (candidateToken !== null) {
    throw typedError(`${label} unresolved truth cannot name a candidate`);
  }
  return { candidateToken, state: value.state };
};

const normalizeRow = (
  value,
  label,
  { allowOutsideCandidateTruth = false } = {},
) => {
  exactObject(value, label, [
    "baseline",
    "candidate",
    "eligibleCandidateTokens",
    "queryToken",
    "truth",
  ]);
  const eligibleCandidateTokens = uniqueSortedDigests(
    value.eligibleCandidateTokens,
    `${label}.eligibleCandidateTokens`,
    64,
  );
  const queryToken = requiredDigest(value.queryToken, `${label}.queryToken`);
  if (eligibleCandidateTokens.includes(queryToken)) {
    throw typedError(`${label}.queryToken must be distinct from candidates`);
  }
  return {
    baseline: normalizeDecision(
      value.baseline,
      `${label}.baseline`,
      eligibleCandidateTokens,
    ),
    candidate: normalizeDecision(
      value.candidate,
      `${label}.candidate`,
      eligibleCandidateTokens,
    ),
    eligibleCandidateTokens,
    queryToken,
    truth: normalizeTruth(
      value.truth,
      `${label}.truth`,
      eligibleCandidateTokens,
      { allowOutsideCandidateTruth },
    ),
  };
};

const normalizeRows = (
  value,
  label,
  { allowOutsideCandidateTruth = false } = {},
) => {
  if (!Array.isArray(value) || value.length === 0) {
    throw typedError(`${label} must be a non-empty array`);
  }
  if (value.length > maximumRowsPerSplit) {
    throw typedError(`${label} exceeds ${maximumRowsPerSplit} rows`);
  }
  const rows = value
    .map((row, index) =>
      normalizeRow(row, `${label}[${index}]`, {
        allowOutsideCandidateTruth,
      }),
    )
    .sort((left, right) => left.queryToken.localeCompare(right.queryToken));
  if (new Set(rows.map((row) => row.queryToken)).size !== rows.length) {
    throw typedError(`${label} contains duplicate query tokens`);
  }
  return rows;
};

const structuralRow = (row) => ({
  baseline: row.baseline,
  candidate: row.candidate,
  eligibleCandidateTokens: row.eligibleCandidateTokens,
  queryToken: row.queryToken,
});

const truthRow = (row) => ({ queryToken: row.queryToken, truth: row.truth });

const candidateRow = (row) => ({
  candidate: row.candidate,
  eligibleCandidateTokens: row.eligibleCandidateTokens,
  queryToken: row.queryToken,
});

export const matchingQcCohortDigest = ({
  calibrationRows,
  holdoutRows,
  referenceTokens,
}) =>
  recognitionDigest({
    calibration: normalizeRows(calibrationRows, "calibrationRows").map(
      structuralRow,
    ),
    holdout: normalizeRows(holdoutRows, "holdoutRows").map(structuralRow),
    referenceTokens: normalizeReferenceTokens(
      referenceTokens,
      "referenceTokens",
    ),
  });

export const matchingQcCohortV2Digest = ({
  calibrationRows,
  holdoutRows,
  referenceTokens,
}) =>
  recognitionDigest({
    calibration: normalizeRows(calibrationRows, "calibrationRows", {
      allowOutsideCandidateTruth: true,
    }).map(structuralRow),
    holdout: normalizeRows(holdoutRows, "holdoutRows", {
      allowOutsideCandidateTruth: true,
    }).map(structuralRow),
    referenceTokens: normalizeReferenceTokens(
      referenceTokens,
      "referenceTokens",
      { maximum: maximumReferenceTokensV2, split: true },
    ),
  });

export const matchingQcTruthVersionDigest = ({
  calibrationRows,
  holdoutRows,
}) =>
  recognitionDigest({
    calibration: normalizeRows(calibrationRows, "calibrationRows").map(
      truthRow,
    ),
    holdout: normalizeRows(holdoutRows, "holdoutRows").map(truthRow),
  });

export const matchingQcTruthVersionV2Digest = ({
  calibrationRows,
  holdoutRows,
}) =>
  recognitionDigest({
    calibration: normalizeRows(calibrationRows, "calibrationRows", {
      allowOutsideCandidateTruth: true,
    }).map(truthRow),
    holdout: normalizeRows(holdoutRows, "holdoutRows", {
      allowOutsideCandidateTruth: true,
    }).map(truthRow),
  });

export const matchingQcCandidateArtifactDigest = ({
  calibrationRows,
  candidate,
  holdoutRows,
}) => {
  exactObject(candidate, "candidate", [
    "policyId",
    "providerConfigDigest",
    "vectorSpaceId",
  ]);
  const normalizedCandidate = normalizePolicy(candidate, "candidate");
  return recognitionDigest({
    calibration: normalizeRows(calibrationRows, "calibrationRows").map(
      candidateRow,
    ),
    candidate: normalizedCandidate,
    holdout: normalizeRows(holdoutRows, "holdoutRows").map(candidateRow),
  });
};

export const matchingQcCandidateArtifactV2Digest = ({
  calibrationRows,
  candidate,
  holdoutRows,
}) => {
  exactObject(candidate, "candidate", [
    "policyId",
    "providerConfigDigest",
    "vectorSpaceId",
  ]);
  const normalizedCandidate = normalizePolicy(candidate, "candidate");
  return recognitionDigest({
    calibration: normalizeRows(calibrationRows, "calibrationRows", {
      allowOutsideCandidateTruth: true,
    }).map(candidateRow),
    candidate: normalizedCandidate,
    holdout: normalizeRows(holdoutRows, "holdoutRows", {
      allowOutsideCandidateTruth: true,
    }).map(candidateRow),
  });
};

const normalizeCohort = (
  value,
  {
    allowOutsideCandidateTruth = false,
    cohortSchemaVersion = matchingQcCohortSchemaVersion,
    referenceTokenLimit = maximumReferenceTokens,
    splitReferenceTokens = false,
  } = {},
) => {
  exactObject(value, "cohort", [
    "authority",
    "baseline",
    "calibration",
    "candidate",
    "experiment",
    "gate",
    "holdout",
    "protocol",
    "referenceTokens",
    "schemaVersion",
  ]);
  if (value.schemaVersion !== cohortSchemaVersion) {
    throw typedError(`Cohort must use ${cohortSchemaVersion}`);
  }
  if (value.authority !== "human_review") {
    throw typedError("Cohort authority must be human_review");
  }
  exactObject(value.calibration, "cohort.calibration", ["rows"]);
  exactObject(value.holdout, "cohort.holdout", ["rows"]);
  const calibrationRows = normalizeRows(
    value.calibration.rows,
    "cohort.calibration.rows",
    { allowOutsideCandidateTruth },
  );
  const holdoutRows = normalizeRows(value.holdout.rows, "cohort.holdout.rows", {
    allowOutsideCandidateTruth,
  });
  const queryTokens = [...calibrationRows, ...holdoutRows].map(
    (row) => row.queryToken,
  );
  if (new Set(queryTokens).size !== queryTokens.length) {
    throw typedError("Calibration and holdout query tokens must be disjoint");
  }
  const referenceTokens = normalizeReferenceTokens(
    value.referenceTokens,
    "cohort.referenceTokens",
    { maximum: referenceTokenLimit, split: splitReferenceTokens },
  );
  const baseline = normalizePolicy(value.baseline, "cohort.baseline");
  const candidate = normalizePolicy(value.candidate, "cohort.candidate", {
    artifact: true,
  });
  exactObject(value.experiment, "cohort.experiment", [
    "cohortDigest",
    "experimentId",
    "providerConfigDigest",
    "truthVersionDigest",
    "vectorSpaceId",
  ]);
  const experiment = {
    cohortDigest: requiredDigest(
      value.experiment.cohortDigest,
      "cohort.experiment.cohortDigest",
    ),
    experimentId: requiredPublicIdentifier(
      value.experiment.experimentId,
      "cohort.experiment.experimentId",
    ),
    providerConfigDigest: requiredDigest(
      value.experiment.providerConfigDigest,
      "cohort.experiment.providerConfigDigest",
    ),
    truthVersionDigest: requiredDigest(
      value.experiment.truthVersionDigest,
      "cohort.experiment.truthVersionDigest",
    ),
    vectorSpaceId: requiredVectorSpace(
      value.experiment.vectorSpaceId,
      "cohort.experiment.vectorSpaceId",
    ),
  };
  exactObject(value.gate, "cohort.gate", [
    "maximumConfirmedModelRegressions",
    "minimumConfirmedNetGain",
    "minimumHoldoutQueries",
    "requireCompleteQc",
  ]);
  const gate = {
    maximumConfirmedModelRegressions: requiredCount(
      value.gate.maximumConfirmedModelRegressions,
      "cohort.gate.maximumConfirmedModelRegressions",
    ),
    minimumConfirmedNetGain: requiredCount(
      value.gate.minimumConfirmedNetGain,
      "cohort.gate.minimumConfirmedNetGain",
    ),
    minimumHoldoutQueries: requiredCount(
      value.gate.minimumHoldoutQueries,
      "cohort.gate.minimumHoldoutQueries",
    ),
    requireCompleteQc: value.gate.requireCompleteQc,
  };
  if (gate.requireCompleteQc !== true) {
    throw typedError("Cohort gate must require complete QC");
  }
  exactObject(value.protocol, "cohort.protocol", [
    "calibrationFrozenBeforeHoldout",
    "holdoutAccess",
  ]);
  const protocol = {
    calibrationFrozenBeforeHoldout: requiredBoolean(
      value.protocol.calibrationFrozenBeforeHoldout,
      "cohort.protocol.calibrationFrozenBeforeHoldout",
    ),
    holdoutAccess: requiredPublicIdentifier(
      value.protocol.holdoutAccess,
      "cohort.protocol.holdoutAccess",
    ),
  };
  if (protocol.holdoutAccess !== "selected_candidate_once") {
    throw typedError("Cohort holdout access policy is unsupported");
  }

  const expectedCohortDigest = recognitionDigest({
    calibration: calibrationRows.map(structuralRow),
    holdout: holdoutRows.map(structuralRow),
    referenceTokens,
  });
  const expectedTruthVersionDigest = recognitionDigest({
    calibration: calibrationRows.map(truthRow),
    holdout: holdoutRows.map(truthRow),
  });
  const expectedArtifactDigest = recognitionDigest({
    calibration: calibrationRows.map(candidateRow),
    candidate: {
      policyId: candidate.policyId,
      providerConfigDigest: candidate.providerConfigDigest,
      vectorSpaceId: candidate.vectorSpaceId,
    },
    holdout: holdoutRows.map(candidateRow),
  });
  if (experiment.cohortDigest !== expectedCohortDigest) {
    throw typedError("Cohort digest does not match its frozen rows");
  }
  if (experiment.truthVersionDigest !== expectedTruthVersionDigest) {
    throw typedError("Truth-version digest does not match its frozen rows");
  }
  if (candidate.artifactDigest !== expectedArtifactDigest) {
    throw typedError("Candidate artifact digest does not match its decisions");
  }

  return {
    authority: "human_review",
    baseline,
    calibration: { rows: calibrationRows },
    candidate,
    experiment,
    gate,
    holdout: { rows: holdoutRows },
    protocol,
    referenceTokens,
  };
};

const changed = (row) =>
  row.baseline.candidateToken !== row.candidate.candidateToken;

const expectedResolvedDisposition = (row) =>
  row.candidate.candidateToken === row.truth.candidateToken &&
  row.baseline.candidateToken !== row.truth.candidateToken
    ? "confirmed_model_rescue"
    : "confirmed_model_regression";

const expectedResolvedDispositionV2 = (row) => {
  if (
    row.candidate.candidateToken === row.truth.candidateToken &&
    row.baseline.candidateToken !== row.truth.candidateToken
  ) {
    return "confirmed_model_rescue";
  }
  if (
    row.baseline.candidateToken === row.truth.candidateToken &&
    row.candidate.candidateToken !== row.truth.candidateToken
  ) {
    return "confirmed_model_regression";
  }
  return "confirmed_model_neutral";
};

const reviewItem = (row) => {
  const allowedDispositions =
    row.truth.state === "resolved"
      ? [expectedResolvedDisposition(row), "unreviewed"]
      : conflictDispositions;
  const core = {
    allowedDispositions,
    queryToken: row.queryToken,
    truthState: row.truth.state,
    transitionDigest: recognitionDigest({
      baseline: row.baseline,
      candidate: row.candidate,
      eligibleCandidateTokens: row.eligibleCandidateTokens,
      queryToken: row.queryToken,
      truth: row.truth,
    }),
  };
  return { ...core, reviewItemDigest: recognitionDigest(core) };
};

const reviewItemV2 = (row) => {
  const allowedDispositions =
    row.truth.state === "unresolved"
      ? conflictDispositions
      : [expectedResolvedDispositionV2(row), ...conflictDispositions];
  const core = {
    allowedDispositions,
    queryToken: row.queryToken,
    truthState: row.truth.state,
    transitionDigest: recognitionDigest({
      baseline: row.baseline,
      candidate: row.candidate,
      eligibleCandidateTokens: row.eligibleCandidateTokens,
      queryToken: row.queryToken,
      truth: row.truth,
    }),
  };
  return { ...core, reviewItemDigest: recognitionDigest(core) };
};

export const matchingQcContractDigest = recognitionDigest({
  cohortSchemaVersion: matchingQcCohortSchemaVersion,
  completionSchemaVersion: matchingQcCompletionSchemaVersion,
  maximumReferenceTokens,
  maximumRowsPerSplit,
  qcKeys,
  receiptSchemaVersion: matchingQcReceiptSchemaVersion,
  reviewPacketSchemaVersion: matchingQcReviewPacketSchemaVersion,
});

export const matchingQcContractV2Digest = recognitionDigest({
  cohortSchemaVersion: matchingQcCohortV2SchemaVersion,
  completionSchemaVersion: matchingQcCompletionV2SchemaVersion,
  maximumReferenceTokens: maximumReferenceTokensV2,
  maximumRowsPerSplit,
  qcKeys: qcKeysV2,
  referenceBinding: "per_split",
  receiptSchemaVersion: matchingQcReceiptV2SchemaVersion,
  reviewEvidenceBinding: "required_digest",
  resolvedTruthConflictOverride: "human_review_only",
  reviewPacketSchemaVersion: matchingQcReviewPacketV2SchemaVersion,
});

const createReviewPacket = (
  value,
  {
    allowOutsideCandidateTruth = false,
    cohortSchemaVersion = matchingQcCohortSchemaVersion,
    contractDigest = matchingQcContractDigest,
    packetSchemaVersion = matchingQcReviewPacketSchemaVersion,
    referenceTokenLimit = maximumReferenceTokens,
    reviewItemFactory = reviewItem,
    splitReferenceTokens = false,
  } = {},
) => {
  const cohort = normalizeCohort(value, {
    allowOutsideCandidateTruth,
    cohortSchemaVersion,
    referenceTokenLimit,
    splitReferenceTokens,
  });
  const reviewItems = cohort.holdout.rows
    .filter(changed)
    .map(reviewItemFactory);
  const packet = {
    authority: {
      activation: "none",
      automaticIdentityAuthority: "none",
      recommendation: "none",
      training: "none",
    },
    baseline: cohort.baseline,
    binding: {
      contractDigest,
      cohortDigest: cohort.experiment.cohortDigest,
      truthVersionDigest: cohort.experiment.truthVersionDigest,
    },
    boundary: {
      calibrationFreezeTimingProof: "none",
      databaseWrites: "none",
      holdoutAccessExecutionProof: "none",
      identityWrites: "none",
      mediaPayload: "none",
      producerResultValidation: "digest_bound_only",
      providerExecutionProof: "none",
      sourceMediaReads: "none",
      sourceMediaWrites: "none",
      visualReviewExecutionProof: "none",
    },
    calibration: cohort.calibration,
    candidate: cohort.candidate,
    experiment: cohort.experiment,
    gate: cohort.gate,
    holdout: cohort.holdout,
    protocol: cohort.protocol,
    referenceTokens: cohort.referenceTokens,
    reviewItems,
    schemaVersion: packetSchemaVersion,
  };
  return deepFreeze({ ...packet, packetDigest: recognitionDigest(packet) });
};

export const createMatchingQcReviewPacket = (value) =>
  createReviewPacket(value);

export const createMatchingQcReviewPacketV2 = (value) =>
  createReviewPacket(value, {
    allowOutsideCandidateTruth: true,
    cohortSchemaVersion: matchingQcCohortV2SchemaVersion,
    contractDigest: matchingQcContractV2Digest,
    packetSchemaVersion: matchingQcReviewPacketV2SchemaVersion,
    referenceTokenLimit: maximumReferenceTokensV2,
    reviewItemFactory: reviewItemV2,
    splitReferenceTokens: true,
  });

const validateReviewPacket = (
  value,
  {
    cohortSchemaVersion = matchingQcCohortSchemaVersion,
    packetFactory = createMatchingQcReviewPacket,
    packetSchemaVersion = matchingQcReviewPacketSchemaVersion,
  } = {},
) => {
  exactObject(value, "packet", [
    "authority",
    "baseline",
    "binding",
    "boundary",
    "calibration",
    "candidate",
    "experiment",
    "gate",
    "holdout",
    "packetDigest",
    "protocol",
    "referenceTokens",
    "reviewItems",
    "schemaVersion",
  ]);
  if (value.schemaVersion !== packetSchemaVersion) {
    throw typedError(`Packet must use ${packetSchemaVersion}`);
  }
  const rebuilt = packetFactory({
    authority: "human_review",
    baseline: value.baseline,
    calibration: value.calibration,
    candidate: value.candidate,
    experiment: value.experiment,
    gate: value.gate,
    holdout: value.holdout,
    protocol: value.protocol,
    referenceTokens: value.referenceTokens,
    schemaVersion: cohortSchemaVersion,
  });
  if (
    value.packetDigest !== rebuilt.packetDigest ||
    recognitionDigest(value) !== recognitionDigest(rebuilt)
  ) {
    throw typedError("Review packet digest or contents are invalid");
  }
  return rebuilt;
};

const normalizeCompletion = (
  value,
  packet,
  {
    completionSchemaVersion = matchingQcCompletionSchemaVersion,
    requireReviewEvidenceDigest = false,
  } = {},
) => {
  exactObject(value, "completion", ["items", "packetDigest", "schemaVersion"]);
  if (value.schemaVersion !== completionSchemaVersion) {
    throw typedError(`Completion must use ${completionSchemaVersion}`);
  }
  if (
    requiredDigest(value.packetDigest, "completion.packetDigest") !==
    packet.packetDigest
  ) {
    throw typedError("Completion is bound to another review packet");
  }
  if (
    !Array.isArray(value.items) ||
    value.items.length > packet.reviewItems.length
  ) {
    throw typedError("Completion items are invalid");
  }
  const reviewByQuery = new Map(
    packet.reviewItems.map((item) => [item.queryToken, item]),
  );
  const items = value.items.map((item, index) => {
    const label = `completion.items[${index}]`;
    exactObject(item, label, [
      "disposition",
      "queryToken",
      ...(requireReviewEvidenceDigest ? ["reviewEvidenceDigest"] : []),
      "reviewItemDigest",
    ]);
    const queryToken = requiredDigest(item.queryToken, `${label}.queryToken`);
    const expected = reviewByQuery.get(queryToken);
    if (!expected) throw typedError(`${label} is not a review item`);
    if (
      requiredDigest(item.reviewItemDigest, `${label}.reviewItemDigest`) !==
      expected.reviewItemDigest
    ) {
      throw typedError(`${label} is bound to another transition`);
    }
    const disposition = requiredPublicIdentifier(
      item.disposition,
      `${label}.disposition`,
    );
    if (!expected.allowedDispositions.includes(disposition)) {
      throw typedError(`${label}.disposition contradicts frozen truth`);
    }
    return {
      disposition,
      queryToken,
      ...(requireReviewEvidenceDigest
        ? {
            reviewEvidenceDigest: requiredDigest(
              item.reviewEvidenceDigest,
              `${label}.reviewEvidenceDigest`,
            ),
          }
        : {}),
      reviewItemDigest: expected.reviewItemDigest,
    };
  });
  if (new Set(items.map((item) => item.queryToken)).size !== items.length) {
    throw typedError("Completion contains duplicate query tokens");
  }
  return items.sort((left, right) =>
    left.queryToken.localeCompare(right.queryToken),
  );
};

const correctCount = (rows, lane) =>
  rows.filter(
    (row) =>
      row.truth.state !== "unresolved" &&
      row[lane].candidateToken === row.truth.candidateToken,
  ).length;

const deterministicReplay = (rows) =>
  rows.every(
    (row) =>
      row.baseline.firstResultDigest === row.baseline.secondResultDigest &&
      row.candidate.firstResultDigest === row.candidate.secondResultDigest,
  );

const validateCompletion = (
  { completion, packet: input },
  {
    cohortSchemaVersion = matchingQcCohortSchemaVersion,
    completionSchemaVersion = matchingQcCompletionSchemaVersion,
    evaluationSchemaVersion = "cimmich.matching-lever-evaluation.v1",
    gateEvaluator = evaluateMatchingLever,
    packetFactory = createMatchingQcReviewPacket,
    packetSchemaVersion = matchingQcReviewPacketSchemaVersion,
    qcKeySet = qcKeys,
    requireReviewEvidenceDigest = false,
    splitReferenceTokens = false,
    validatedEnvelopes = validatedCompletionEnvelopes,
  } = {},
) => {
  const packet = validateReviewPacket(input, {
    cohortSchemaVersion,
    packetFactory,
    packetSchemaVersion,
  });
  const completionItems = normalizeCompletion(completion, packet, {
    completionSchemaVersion,
    requireReviewEvidenceDigest,
  });
  const completionByQuery = new Map(
    completionItems.map((item) => [item.queryToken, item]),
  );
  const dispositions = packet.reviewItems.map(
    (item) =>
      completionByQuery.get(item.queryToken)?.disposition || "unreviewed",
  );
  const qc = Object.fromEntries(qcKeySet.map((key) => [key, 0]));
  for (const disposition of dispositions) {
    qc[qcKeyByDisposition[disposition]] += 1;
  }
  const allRows = [...packet.calibration.rows, ...packet.holdout.rows];
  const queryReferenceOverlap = splitReferenceTokens
    ? packet.calibration.rows.filter((row) =>
        packet.referenceTokens.calibration.includes(row.queryToken),
      ).length +
      packet.holdout.rows.filter((row) =>
        packet.referenceTokens.holdout.includes(row.queryToken),
      ).length
    : allRows.filter((row) => packet.referenceTokens.includes(row.queryToken))
        .length;
  const gateReceipt = gateEvaluator({
    authority: "human_review",
    baseline: packet.baseline,
    calibration: {
      baselineCorrect: correctCount(packet.calibration.rows, "baseline"),
      candidateCorrect: correctCount(packet.calibration.rows, "candidate"),
      cohortDigest: packet.experiment.cohortDigest,
      queries: packet.calibration.rows.length,
      truthVersionDigest: packet.experiment.truthVersionDigest,
    },
    candidate: packet.candidate,
    experiment: packet.experiment,
    gate: packet.gate,
    holdout: {
      baselineCorrect: correctCount(packet.holdout.rows, "baseline"),
      candidateCorrect: correctCount(packet.holdout.rows, "candidate"),
      changedOutcomes: packet.reviewItems.length,
      cohortDigest: packet.experiment.cohortDigest,
      consequentialChanges: packet.reviewItems.length,
      qc,
      queries: packet.holdout.rows.length,
      truthVersionDigest: packet.experiment.truthVersionDigest,
    },
    protocol: {
      calibrationFrozenBeforeHoldout:
        packet.protocol.calibrationFrozenBeforeHoldout,
      deterministicReplay: deterministicReplay(allRows),
      holdoutAccess: packet.protocol.holdoutAccess,
      queryReferenceOverlap,
    },
    schemaVersion: evaluationSchemaVersion,
  });
  const envelope = deepFreeze({
    completionDigest: recognitionDigest(completionItems),
    completedReviewCount: completionItems.length,
    gateReceipt,
    packetDigest: packet.packetDigest,
    requiredReviewCount: packet.reviewItems.length,
  });
  validatedEnvelopes.add(envelope);
  return envelope;
};

export const validateMatchingQcCompletion = (value) =>
  validateCompletion(value);

export const validateMatchingQcCompletionV2 = (value) =>
  validateCompletion(value, {
    cohortSchemaVersion: matchingQcCohortV2SchemaVersion,
    completionSchemaVersion: matchingQcCompletionV2SchemaVersion,
    evaluationSchemaVersion: "cimmich.matching-lever-evaluation.v2",
    gateEvaluator: evaluateMatchingLeverV2,
    packetFactory: createMatchingQcReviewPacketV2,
    packetSchemaVersion: matchingQcReviewPacketV2SchemaVersion,
    qcKeySet: qcKeysV2,
    requireReviewEvidenceDigest: true,
    splitReferenceTokens: true,
    validatedEnvelopes: validatedCompletionV2Envelopes,
  });

const createReceipt = (
  value,
  {
    contractDigest = matchingQcContractDigest,
    receiptSchemaVersion = matchingQcReceiptSchemaVersion,
    reviewEvidenceBinding = false,
    validatedEnvelopes = validatedCompletionEnvelopes,
  } = {},
) => {
  if (
    value == null ||
    typeof value !== "object" ||
    !validatedEnvelopes.has(value)
  ) {
    throw typedError("An exact validated QC completion envelope is required");
  }
  const gate = value.gateReceipt;
  const receipt = {
    authority: gate.authority,
    binding: {
      candidateArtifactDigest: gate.binding.candidateArtifactDigest,
      cohortDigest: gate.binding.cohortDigest,
      completionDigest: value.completionDigest,
      contractDigest,
      matchingLeverReceiptDigest: gate.receiptDigest,
      packetDigest: value.packetDigest,
      truthVersionDigest: gate.binding.truthVersionDigest,
    },
    boundary: {
      calibrationFreezeTimingProof: "none",
      databaseWrites: "none",
      holdoutAccessExecutionProof: "none",
      identityWrites: "none",
      mediaPayload: "none",
      operationalUse: "none",
      producerResultValidation: "digest_bound_only",
      providerExecutionProof: "none",
      sourceMediaReads: "none",
      sourceMediaWrites: "none",
      ...(reviewEvidenceBinding
        ? { visualReviewEvidenceBinding: "digest_bound" }
        : {}),
      visualReviewExecutionProof: "none",
    },
    decision: gate.decision,
    metrics: {
      calibration: gate.calibration,
      holdout: gate.holdout,
    },
    review: {
      completedCount: value.completedReviewCount,
      requiredCount: value.requiredReviewCount,
      unreviewedCount: gate.holdout.qc.unreviewed,
    },
    schemaVersion: receiptSchemaVersion,
  };
  return deepFreeze({ ...receipt, receiptDigest: recognitionDigest(receipt) });
};

export const createMatchingQcReceipt = (value) => createReceipt(value);

export const createMatchingQcReceiptV2 = (value) =>
  createReceipt(value, {
    contractDigest: matchingQcContractV2Digest,
    receiptSchemaVersion: matchingQcReceiptV2SchemaVersion,
    reviewEvidenceBinding: true,
    validatedEnvelopes: validatedCompletionV2Envelopes,
  });
