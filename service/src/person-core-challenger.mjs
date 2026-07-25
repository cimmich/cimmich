import { digestValue } from "./source-pack.mjs";

export const personCoreChallengerPolicyVersion =
  "cimmich-person-core-challenger-v1";
export const personCoreChallengerSchemaVersion =
  "cimmich.person-core-challenger.v1";

const sha256Pattern = /^[0-9a-f]{64}$/;

const requiredText = (value, label) => {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`Person Core challenger requires ${label}`);
  return normalized;
};

const finite = (value, label) => {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Person Core challenger requires finite ${label}`);
  }
  return number;
};

const uniqueSorted = (values, label) => {
  const rows = (values || []).map((value) => requiredText(value, label));
  if (rows.length === 0 || new Set(rows).size !== rows.length) {
    throw new Error(
      `Person Core challenger requires unique non-empty ${label}`,
    );
  }
  return rows.sort();
};

const normalizeOutcome = (row, label) => {
  const queryFaceId = requiredText(row?.queryFaceId, `${label}.queryFaceId`);
  const truthPersonId = requiredText(
    row?.truthPersonId,
    `${label}.truthPersonId`,
  );
  const winnerPersonId = requiredText(
    row?.robustWinnerPersonId,
    `${label}.robustWinnerPersonId`,
  );
  const correct = winnerPersonId === truthPersonId;
  if (
    typeof row?.robustCorrect === "boolean" &&
    row.robustCorrect !== correct
  ) {
    throw new Error(
      `Person Core challenger ${label} correctness contradicts its winner`,
    );
  }
  return {
    correct,
    primeMargin: finite(row?.primeMargin, `${label}.primeMargin`),
    queryFaceId,
    truthPersonId,
    truthRobustScore: finite(
      row?.truthRobustScore,
      `${label}.truthRobustScore`,
    ),
    winnerPersonId,
  };
};

const normalizeRows = (rows, label) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`Person Core challenger requires non-empty ${label}`);
  }
  const normalized = rows
    .map((row, index) => normalizeOutcome(row, `${label}[${index}]`))
    .sort((left, right) => left.queryFaceId.localeCompare(right.queryFaceId));
  if (
    new Set(normalized.map((row) => row.queryFaceId)).size !== normalized.length
  ) {
    throw new Error(`Person Core challenger ${label} repeats a query`);
  }
  return normalized;
};

const pairedMetrics = (
  baselineInput,
  candidateInput,
  targetPersonId,
  split,
) => {
  const baseline = normalizeRows(baselineInput, `${split}.baseline`);
  const candidate = normalizeRows(candidateInput, `${split}.candidate`);
  if (baseline.length !== candidate.length) {
    throw new Error(`Person Core challenger ${split} cohorts differ`);
  }
  const targetMarginDeltas = [];
  const targetTruthScoreDeltas = [];
  const metrics = {
    baselineCorrect: 0,
    candidateCorrect: 0,
    changedWinners: 0,
    correctDelta: 0,
    falseFlips: 0,
    queries: baseline.length,
    rescues: 0,
    targetQueries: 0,
    targetRegressions: 0,
    targetRescues: 0,
  };
  for (let index = 0; index < baseline.length; index += 1) {
    const before = baseline[index];
    const after = candidate[index];
    if (
      before.queryFaceId !== after.queryFaceId ||
      before.truthPersonId !== after.truthPersonId
    ) {
      throw new Error(`Person Core challenger ${split} cohorts differ`);
    }
    if (before.correct) metrics.baselineCorrect += 1;
    if (after.correct) metrics.candidateCorrect += 1;
    if (before.winnerPersonId !== after.winnerPersonId)
      metrics.changedWinners += 1;
    if (!before.correct && after.correct) metrics.rescues += 1;
    if (before.correct && !after.correct) metrics.falseFlips += 1;
    if (before.truthPersonId === targetPersonId) {
      metrics.targetQueries += 1;
      targetMarginDeltas.push(after.primeMargin - before.primeMargin);
      targetTruthScoreDeltas.push(
        after.truthRobustScore - before.truthRobustScore,
      );
      if (!before.correct && after.correct) metrics.targetRescues += 1;
      if (before.correct && !after.correct) metrics.targetRegressions += 1;
    }
  }
  if (metrics.targetQueries === 0) {
    throw new Error(
      `Person Core challenger ${split} has no target Person queries`,
    );
  }
  const summarizeDeltas = (values) => ({
    mean: Number(
      (
        values.reduce((total, value) => total + value, 0) / values.length
      ).toFixed(9),
    ),
    minimum: Number(Math.min(...values).toFixed(9)),
  });
  metrics.correctDelta = metrics.candidateCorrect - metrics.baselineCorrect;
  return {
    ...metrics,
    targetMarginDelta: summarizeDeltas(targetMarginDeltas),
    targetTruthScoreDelta: summarizeDeltas(targetTruthScoreDeltas),
  };
};

const authority = Object.freeze({
  activation: "none",
  automaticIdentityAuthority: "none",
  persistence: "none",
});

const receipt = (value) => ({
  ...value,
  receiptDigest: digestValue(value),
});

const validateCommon = (input) => {
  const cohortDigest = requiredText(input?.cohortDigest, "cohortDigest");
  if (!sha256Pattern.test(cohortDigest)) {
    throw new Error("Person Core challenger requires a SHA-256 cohortDigest");
  }
  const baselineCoreFaceIds = uniqueSorted(
    input?.baselineCoreFaceIds,
    "baselineCoreFaceIds",
  );
  const candidateCoreFaceIds = uniqueSorted(
    input?.candidateCoreFaceIds,
    "candidateCoreFaceIds",
  );
  if (
    baselineCoreFaceIds.length !== candidateCoreFaceIds.length ||
    baselineCoreFaceIds.every(
      (faceId, index) => faceId === candidateCoreFaceIds[index],
    )
  ) {
    throw new Error(
      "Person Core challenger requires a distinct same-size Core",
    );
  }
  return {
    baselineCoreFaceIds,
    baselinePackId: requiredText(input?.baselinePackId, "baselinePackId"),
    candidateCoreFaceIds,
    candidatePackId: requiredText(input?.candidatePackId, "candidatePackId"),
    cohortDigest,
    targetPersonId: requiredText(input?.targetPersonId, "targetPersonId"),
  };
};

export const selectPersonCoreChallenger = (input) => {
  const common = validateCommon(input);
  const calibration = pairedMetrics(
    input.baselineRows,
    input.candidateRows,
    common.targetPersonId,
    "calibration",
  );
  const marginOpportunity =
    calibration.targetMarginDelta.mean >= 0.005 &&
    calibration.targetMarginDelta.minimum >= -0.002;
  const selected =
    calibration.falseFlips === 0 &&
    calibration.targetRegressions === 0 &&
    calibration.correctDelta >= 0 &&
    (calibration.rescues > 0 || marginOpportunity);
  return receipt({
    ...common,
    authority,
    calibration,
    policyVersion: personCoreChallengerPolicyVersion,
    schemaVersion: personCoreChallengerSchemaVersion,
    selection: selected ? "selected_for_holdout" : "retain_baseline",
    stage: "calibration",
  });
};

const validateSelection = (selection) => {
  if (
    selection?.schemaVersion !== personCoreChallengerSchemaVersion ||
    selection?.policyVersion !== personCoreChallengerPolicyVersion ||
    selection?.stage !== "calibration"
  ) {
    throw new Error("Person Core challenger selection is incompatible");
  }
  const { receiptDigest, ...core } = selection;
  if (!sha256Pattern.test(String(receiptDigest || ""))) {
    throw new Error("Person Core challenger selection has no receipt digest");
  }
  if (digestValue(core) !== receiptDigest) {
    throw new Error("Person Core challenger selection digest does not match");
  }
  if (
    selection?.authority?.activation !== "none" ||
    selection?.authority?.automaticIdentityAuthority !== "none" ||
    selection?.authority?.persistence !== "none"
  ) {
    throw new Error("Person Core challenger selection carries authority");
  }
  if (selection.selection !== "selected_for_holdout") {
    throw new Error(
      "Person Core challenger holdout requires a calibration-selected candidate",
    );
  }
  return selection;
};

export const evaluatePersonCoreChallengerHoldout = (
  selectionInput,
  { baselineRows, candidateRows },
) => {
  const selection = validateSelection(selectionInput);
  const holdout = pairedMetrics(
    baselineRows,
    candidateRows,
    selection.targetPersonId,
    "holdout",
  );
  const measuredGain =
    holdout.rescues > 0 ||
    (holdout.targetMarginDelta.mean >= 0.002 &&
      holdout.targetMarginDelta.minimum >= -0.002);
  const passed =
    holdout.falseFlips === 0 &&
    holdout.targetRegressions === 0 &&
    holdout.correctDelta >= 0 &&
    measuredGain;
  return receipt({
    authority,
    baselineCoreFaceIds: selection.baselineCoreFaceIds,
    baselinePackId: selection.baselinePackId,
    calibrationReceiptDigest: selection.receiptDigest,
    candidateCoreFaceIds: selection.candidateCoreFaceIds,
    candidatePackId: selection.candidatePackId,
    cohortDigest: selection.cohortDigest,
    holdout,
    policyVersion: personCoreChallengerPolicyVersion,
    recommendation: passed ? "eligible_for_human_review" : "retain_baseline",
    schemaVersion: personCoreChallengerSchemaVersion,
    stage: "holdout",
    status: passed ? "passed" : "failed",
    targetPersonId: selection.targetPersonId,
  });
};
