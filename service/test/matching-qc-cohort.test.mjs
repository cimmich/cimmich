import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createMatchingQcReceipt,
  createMatchingQcReviewPacket,
  matchingQcCandidateArtifactDigest,
  matchingQcCohortDigest,
  matchingQcCohortSchemaVersion,
  matchingQcCompletionSchemaVersion,
  matchingQcContractDigest,
  matchingQcReceiptSchemaVersion,
  matchingQcReviewPacketSchemaVersion,
  matchingQcTruthVersionDigest,
  validateMatchingQcCompletion,
} from "../src/matching-qc-cohort.mjs";
import { recognitionDigest } from "../src/recognition-provider-contract.mjs";

const serviceRoot = fileURLToPath(new URL("../", import.meta.url));
const token = (value) => recognitionDigest(value);
const providerConfigDigest = token("provider-config");
const vectorSpaceId = `vector_space_${token("vector-space")}`;

const decision = (key, candidateToken, overrides = {}) => ({
  candidateToken,
  firstResultDigest: token(`${key}:result`),
  secondResultDigest: token(`${key}:result`),
  ...overrides,
});

const row = ({
  baseline = "a",
  candidate = baseline,
  key,
  truth = baseline,
  truthState = "resolved",
}) => {
  const candidates = [token(`${key}:candidate:a`), token(`${key}:candidate:b`)];
  const candidateByLabel = { a: candidates[0], b: candidates[1], none: null };
  return {
    baseline: decision(`${key}:baseline`, candidateByLabel[baseline]),
    candidate: decision(`${key}:candidate`, candidateByLabel[candidate]),
    eligibleCandidateTokens: candidates,
    queryToken: token(`${key}:query`),
    truth: {
      candidateToken:
        truthState === "resolved" ? candidateByLabel[truth] : null,
      state: truthState,
    },
  };
};

const baseRows = () => ({
  calibrationRows: [
    row({
      baseline: "a",
      candidate: "b",
      key: "calibration-rescue",
      truth: "b",
    }),
    row({ key: "calibration-ordinary" }),
  ],
  holdoutRows: [
    row({ baseline: "a", candidate: "b", key: "holdout-rescue", truth: "b" }),
    row({
      baseline: "a",
      candidate: "b",
      key: "holdout-historical",
      truthState: "unresolved",
    }),
    row({ key: "holdout-ordinary" }),
    row({ key: "holdout-single-family" }),
  ],
});

const buildCohort = ({
  calibrationRows = baseRows().calibrationRows,
  holdoutRows = baseRows().holdoutRows,
  referenceTokens = [],
  protocol = {},
} = {}) => {
  const candidateCore = {
    policyId: "contextual_candidate_prior_v2",
    providerConfigDigest,
    vectorSpaceId,
  };
  const cohortDigest = matchingQcCohortDigest({
    calibrationRows,
    holdoutRows,
    referenceTokens,
  });
  const truthVersionDigest = matchingQcTruthVersionDigest({
    calibrationRows,
    holdoutRows,
  });
  return {
    authority: "human_review",
    baseline: {
      policyId: "prime_only_v1",
      providerConfigDigest,
      vectorSpaceId,
    },
    calibration: { rows: calibrationRows },
    candidate: {
      ...candidateCore,
      artifactDigest: matchingQcCandidateArtifactDigest({
        calibrationRows,
        candidate: candidateCore,
        holdoutRows,
      }),
    },
    experiment: {
      cohortDigest,
      experimentId: "contextual_prior_qc_v1",
      providerConfigDigest,
      truthVersionDigest,
      vectorSpaceId,
    },
    gate: {
      maximumConfirmedModelRegressions: 0,
      minimumConfirmedNetGain: 1,
      minimumHoldoutQueries: holdoutRows.length,
      requireCompleteQc: true,
    },
    holdout: { rows: holdoutRows },
    protocol: {
      calibrationFrozenBeforeHoldout: true,
      holdoutAccess: "selected_candidate_once",
      ...protocol,
    },
    referenceTokens,
    schemaVersion: matchingQcCohortSchemaVersion,
  };
};

const completionFor = (packet, { omit = [], override = new Map() } = {}) => ({
  items: packet.reviewItems
    .filter((item) => !omit.includes(item.queryToken))
    .map((item) => ({
      disposition:
        override.get(item.queryToken) ||
        (item.truthState === "resolved"
          ? "confirmed_model_rescue"
          : "historical_tag_error"),
      queryToken: item.queryToken,
      reviewItemDigest: item.reviewItemDigest,
    })),
  packetDigest: packet.packetDigest,
  schemaVersion: matchingQcCompletionSchemaVersion,
});

test("review packet binds every changed anonymous holdout transition", () => {
  const packet = createMatchingQcReviewPacket(buildCohort());
  assert.equal(packet.schemaVersion, matchingQcReviewPacketSchemaVersion);
  assert.equal(packet.binding.contractDigest, matchingQcContractDigest);
  assert.equal(packet.reviewItems.length, 2);
  assert.equal(packet.boundary.visualReviewExecutionProof, "none");
  assert.equal(packet.boundary.providerExecutionProof, "none");
  assert.equal(packet.boundary.producerResultValidation, "digest_bound_only");
  assert.equal(packet.boundary.calibrationFreezeTimingProof, "none");
  assert.equal(packet.boundary.holdoutAccessExecutionProof, "none");
  assert.equal(packet.authority.automaticIdentityAuthority, "none");
  assert.deepEqual(packet.reviewItems.map((item) => item.truthState).sort(), [
    "resolved",
    "unresolved",
  ]);
  const serialized = JSON.stringify(packet);
  assert.doesNotMatch(
    serialized,
    /filename|filepath|personId|personName|subjectId|credential|https?:\/\//i,
  );
});

test("completed row-level QC derives and reuses the existing matching gate", () => {
  const packet = createMatchingQcReviewPacket(buildCohort());
  const validation = validateMatchingQcCompletion({
    completion: completionFor(packet),
    packet,
  });
  const receipt = createMatchingQcReceipt(validation);
  assert.equal(receipt.schemaVersion, matchingQcReceiptSchemaVersion);
  assert.equal(receipt.decision.status, "evidence_gate_passed");
  assert.equal(receipt.metrics.holdout.baselineCorrect, 2);
  assert.equal(receipt.metrics.holdout.candidateCorrect, 3);
  assert.equal(receipt.metrics.holdout.confirmedNetGain, 1);
  assert.equal(receipt.metrics.holdout.qc.confirmedModelRescue, 1);
  assert.equal(receipt.metrics.holdout.qc.historicalTagError, 1);
  assert.equal(receipt.review.completedCount, 2);
  assert.equal(receipt.review.unreviewedCount, 0);
  assert.equal(receipt.authority.recommendation, "none");
  assert.equal(receipt.boundary.operationalUse, "none");
});

test("missing completion remains unreviewed and blocks the existing gate", () => {
  const packet = createMatchingQcReviewPacket(buildCohort());
  const missing = packet.reviewItems[0].queryToken;
  const receipt = createMatchingQcReceipt(
    validateMatchingQcCompletion({
      completion: completionFor(packet, { omit: [missing] }),
      packet,
    }),
  );
  assert.equal(receipt.decision.status, "blocked");
  assert.deepEqual(receipt.decision.reasons, ["CONSEQUENTIAL_QC_INCOMPLETE"]);
  assert.equal(receipt.review.unreviewedCount, 1);
});

test("resolved truth derives rescue/regression and unresolved truth stays conflict-only", () => {
  const packet = createMatchingQcReviewPacket(buildCohort());
  const resolved = packet.reviewItems.find(
    (item) => item.truthState === "resolved",
  );
  const unresolved = packet.reviewItems.find(
    (item) => item.truthState === "unresolved",
  );
  const adversarial = [
    completionFor(packet, {
      override: new Map([[resolved.queryToken, "historical_tag_error"]]),
    }),
    completionFor(packet, {
      override: new Map([[unresolved.queryToken, "confirmed_model_rescue"]]),
    }),
  ];
  for (const completion of adversarial) {
    assert.throws(
      () => validateMatchingQcCompletion({ completion, packet }),
      (error) => error.code === "MATCHING_QC_INPUT_INVALID",
    );
  }
});

test("a resolved wrong candidate transition is conservatively a regression", () => {
  const rows = baseRows();
  rows.holdoutRows[0] = row({
    baseline: "a",
    candidate: "b",
    key: "holdout-wrong-change",
    truth: "a",
  });
  const packet = createMatchingQcReviewPacket(buildCohort(rows));
  const resolved = packet.reviewItems.find(
    (item) => item.truthState === "resolved",
  );
  assert.deepEqual(resolved.allowedDispositions, [
    "confirmed_model_regression",
    "unreviewed",
  ]);
  const receipt = createMatchingQcReceipt(
    validateMatchingQcCompletion({
      completion: completionFor(packet, {
        override: new Map([
          [resolved.queryToken, "confirmed_model_regression"],
        ]),
      }),
      packet,
    }),
  );
  assert.equal(receipt.decision.status, "rejected");
  assert.equal(receipt.metrics.holdout.qc.confirmedModelRegression, 1);
});

test("cohort, truth, candidate artifact and review item substitutions fail closed", () => {
  const cohort = buildCohort();
  const invalidCohorts = [
    {
      ...cohort,
      experiment: { ...cohort.experiment, cohortDigest: token("forged") },
    },
    {
      ...cohort,
      experiment: {
        ...cohort.experiment,
        truthVersionDigest: token("forged"),
      },
    },
    {
      ...cohort,
      candidate: { ...cohort.candidate, artifactDigest: token("forged") },
    },
  ];
  for (const value of invalidCohorts) {
    assert.throws(
      () => createMatchingQcReviewPacket(value),
      (error) => error.code === "MATCHING_QC_INPUT_INVALID",
    );
  }

  const packet = createMatchingQcReviewPacket(cohort);
  const completion = completionFor(packet);
  completion.items[0].reviewItemDigest = token("forged");
  assert.throws(
    () => validateMatchingQcCompletion({ completion, packet }),
    (error) => error.code === "MATCHING_QC_INPUT_INVALID",
  );
});

test("query/reference overlap and replay drift are derived rather than asserted", () => {
  const rows = baseRows();
  const overlappedPacket = createMatchingQcReviewPacket(
    buildCohort({ ...rows, referenceTokens: [rows.holdoutRows[0].queryToken] }),
  );
  const overlapReceipt = createMatchingQcReceipt(
    validateMatchingQcCompletion({
      completion: completionFor(overlappedPacket),
      packet: overlappedPacket,
    }),
  );
  assert.equal(overlapReceipt.decision.status, "blocked");
  assert.deepEqual(overlapReceipt.decision.reasons, [
    "QUERY_REFERENCE_LEAKAGE",
  ]);

  const driftRows = baseRows();
  driftRows.holdoutRows[0] = {
    ...driftRows.holdoutRows[0],
    candidate: {
      ...driftRows.holdoutRows[0].candidate,
      secondResultDigest: token("drift"),
    },
  };
  const driftPacket = createMatchingQcReviewPacket(buildCohort(driftRows));
  const driftReceipt = createMatchingQcReceipt(
    validateMatchingQcCompletion({
      completion: completionFor(driftPacket),
      packet: driftPacket,
    }),
  );
  assert.equal(driftReceipt.decision.status, "blocked");
  assert.deepEqual(driftReceipt.decision.reasons, [
    "DETERMINISTIC_REPLAY_UNPROVEN",
  ]);
});

test("row order is canonical and copied completion envelopes cannot receipt", () => {
  const rows = baseRows();
  const first = createMatchingQcReviewPacket(buildCohort(rows));
  const second = createMatchingQcReviewPacket(
    buildCohort({
      calibrationRows: [...rows.calibrationRows].reverse(),
      holdoutRows: [...rows.holdoutRows].reverse(),
    }),
  );
  assert.deepEqual(first, second);
  const exact = validateMatchingQcCompletion({
    completion: completionFor(first),
    packet: first,
  });
  assert.throws(
    () => createMatchingQcReceipt(Object.freeze({ ...exact })),
    (error) => error.code === "MATCHING_QC_INPUT_INVALID",
  );
});

test("unsafe fields, tokens, duplicate rows and unknown completion items reject", () => {
  const cohort = buildCohort();
  const duplicateRows = [...cohort.holdout.rows, cohort.holdout.rows[0]];
  const adversarial = [
    { ...cohort, callbackUrl: "https://private.invalid" },
    { ...cohort, authority: "automatic" },
    {
      ...cohort,
      experiment: { ...cohort.experiment, experimentId: "Person Name" },
    },
    {
      ...cohort,
      holdout: { rows: duplicateRows },
    },
  ];
  for (const value of adversarial) {
    assert.throws(
      () => createMatchingQcReviewPacket(value),
      (error) => error.code === "MATCHING_QC_INPUT_INVALID",
    );
  }

  const packet = createMatchingQcReviewPacket(cohort);
  const completion = completionFor(packet);
  completion.items.push({
    disposition: "historical_tag_error",
    queryToken: token("unknown-query"),
    reviewItemDigest: token("unknown-review"),
  });
  assert.throws(
    () => validateMatchingQcCompletion({ completion, packet }),
    (error) => error.code === "MATCHING_QC_INPUT_INVALID",
  );
});

test("CLI prepares and evaluates deterministic bounded non-echo packets", () => {
  const run = (input) =>
    spawnSync(process.execPath, ["bin/evaluate-matching-qc-cohort.mjs"], {
      cwd: serviceRoot,
      encoding: "utf8",
      input,
      maxBuffer: 4 * 1024 * 1024,
    });
  const cohort = buildCohort();
  const prepared = run(JSON.stringify({ action: "prepare", cohort }));
  assert.equal(prepared.status, 0, prepared.stderr);
  const packet = JSON.parse(prepared.stdout);
  const evaluated = run(
    JSON.stringify({
      action: "evaluate",
      completion: completionFor(packet),
      packet,
    }),
  );
  assert.equal(evaluated.status, 0, evaluated.stderr);
  const receipt = JSON.parse(evaluated.stdout);
  assert.equal(receipt.decision.status, "evidence_gate_passed");
  assert.equal(receipt.schemaVersion, matchingQcReceiptSchemaVersion);

  const sentinel = "../../private/person-name.jpg?credential=secret";
  const invalid = run(
    JSON.stringify({
      action: "prepare",
      cohort: { ...cohort, privatePath: sentinel },
    }),
  );
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stderr.includes(sentinel), false);
  assert.deepEqual(JSON.parse(invalid.stderr), {
    error: { code: "MATCHING_QC_INPUT_INVALID" },
  });
  const tooLarge = run("x".repeat(1024 * 1024 + 1));
  assert.equal(tooLarge.status, 1);
  assert.deepEqual(JSON.parse(tooLarge.stderr), {
    error: { code: "MATCHING_QC_INPUT_TOO_LARGE" },
  });
});
