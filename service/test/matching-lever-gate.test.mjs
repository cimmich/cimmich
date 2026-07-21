import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  evaluateMatchingLever,
  matchingLeverEvaluationSchemaVersion,
  matchingLeverGateSchemaVersion,
} from "../src/matching-lever-gate.mjs";

const digest = (value) => value.repeat(64).slice(0, 64);
const providerConfigDigest = digest("c");
const vectorSpaceId = `vector_space_${digest("d")}`;
const serviceRoot = fileURLToPath(new URL("../", import.meta.url));

const qc = (overrides = {}) => ({
  ambiguousGroupTag: 1,
  confirmedModelRegression: 0,
  confirmedModelRescue: 3,
  historicalTagError: 1,
  metadataContextConflict: 0,
  unreviewed: 0,
  visuallyUnresolvable: 0,
  ...overrides,
});

const input = (overrides = {}) => ({
  authority: "human_review",
  baseline: {
    policyId: "prime_only",
    providerConfigDigest,
    vectorSpaceId,
  },
  calibration: {
    baselineCorrect: 330,
    candidateCorrect: 345,
    cohortDigest: digest("a"),
    queries: 400,
    truthVersionDigest: digest("b"),
  },
  candidate: {
    artifactDigest: digest("e"),
    policyId: "condition_route_v1",
    providerConfigDigest,
    vectorSpaceId,
  },
  experiment: {
    cohortDigest: digest("a"),
    experimentId: "condition_bucket_trial_v1",
    providerConfigDigest,
    truthVersionDigest: digest("b"),
    vectorSpaceId,
  },
  gate: {
    maximumConfirmedModelRegressions: 0,
    minimumConfirmedNetGain: 2,
    minimumHoldoutQueries: 100,
    requireCompleteQc: true,
  },
  holdout: {
    baselineCorrect: 160,
    candidateCorrect: 163,
    changedOutcomes: 5,
    cohortDigest: digest("a"),
    consequentialChanges: 5,
    qc: qc(),
    queries: 200,
    truthVersionDigest: digest("b"),
  },
  protocol: {
    calibrationFrozenBeforeHoldout: true,
    deterministicReplay: true,
    holdoutAccess: "selected_candidate_once",
    queryReferenceOverlap: 0,
  },
  schemaVersion: matchingLeverEvaluationSchemaVersion,
  ...overrides,
});

test("matching lever passes evidence only with complete QC and no model regression", () => {
  const receipt = evaluateMatchingLever(input());
  assert.equal(receipt.schemaVersion, matchingLeverGateSchemaVersion);
  assert.equal(receipt.decision.status, "evidence_gate_passed");
  assert.deepEqual(receipt.decision.reasons, []);
  assert.equal(receipt.holdout.confirmedNetGain, 3);
  assert.equal(receipt.holdout.qc.historicalTagError, 1);
  assert.equal(receipt.holdout.qc.ambiguousGroupTag, 1);
  assert.equal(receipt.authority.recommendation, "none");
  assert.equal(receipt.authority.activation, "none");
  assert.equal(receipt.authority.training, "none");
  assert.equal(receipt.authority.automaticIdentityAuthority, "none");
  assert.match(receipt.receiptDigest, /^[0-9a-f]{64}$/);
});

test("matching lever blocks an unreviewed consequential change", () => {
  const base = input();
  const receipt = evaluateMatchingLever({
    ...base,
    holdout: {
      ...base.holdout,
      qc: qc({ confirmedModelRescue: 2, unreviewed: 1 }),
    },
  });
  assert.equal(receipt.decision.status, "blocked");
  assert.deepEqual(receipt.decision.reasons, ["CONSEQUENTIAL_QC_INCOMPLETE"]);
});

test("matching lever blocks QC accounting that does not cover the frozen change set", () => {
  const base = input();
  const receipt = evaluateMatchingLever({
    ...base,
    holdout: {
      ...base.holdout,
      qc: qc({ confirmedModelRescue: 2 }),
    },
  });
  assert.equal(receipt.decision.status, "blocked");
  assert.deepEqual(receipt.decision.reasons, ["QC_ACCOUNTING_MISMATCH"]);
});

test("matching lever cannot exclude a changed outcome from consequential QC", () => {
  const base = input();
  const receipt = evaluateMatchingLever({
    ...base,
    holdout: {
      ...base.holdout,
      consequentialChanges: 4,
      qc: qc({ confirmedModelRescue: 2 }),
    },
  });
  assert.equal(receipt.decision.status, "blocked");
  assert.deepEqual(receipt.decision.reasons, [
    "CONSEQUENTIAL_CHANGE_SCOPE_MISMATCH",
  ]);
});

test("matching lever rejects confirmed regressions and insufficient net gain", () => {
  const base = input();
  const receipt = evaluateMatchingLever({
    ...base,
    holdout: {
      ...base.holdout,
      qc: qc({
        confirmedModelRegression: 1,
        confirmedModelRescue: 2,
      }),
    },
  });
  assert.equal(receipt.decision.status, "rejected");
  assert.deepEqual(receipt.decision.reasons, [
    "CONFIRMED_MODEL_REGRESSION_GATE_FAILED",
    "CONFIRMED_NET_GAIN_GATE_FAILED",
  ]);
});

test("matching lever blocks cross-space, provider and frozen-truth drift", () => {
  const base = input();
  const receipt = evaluateMatchingLever({
    ...base,
    candidate: {
      ...base.candidate,
      providerConfigDigest: digest("f"),
      vectorSpaceId: `vector_space_${digest("e")}`,
    },
    holdout: { ...base.holdout, truthVersionDigest: digest("f") },
  });
  assert.equal(receipt.decision.status, "blocked");
  assert.deepEqual(receipt.decision.reasons, [
    "PROVIDER_CONFIG_MISMATCH",
    "TRUTH_VERSION_MISMATCH",
    "VECTOR_SPACE_MISMATCH",
  ]);
});

test("matching lever blocks leakage, unfrozen calibration and replay drift", () => {
  const base = input();
  const receipt = evaluateMatchingLever({
    ...base,
    protocol: {
      ...base.protocol,
      calibrationFrozenBeforeHoldout: false,
      deterministicReplay: false,
      queryReferenceOverlap: 1,
    },
  });
  assert.equal(receipt.decision.status, "blocked");
  assert.deepEqual(receipt.decision.reasons, [
    "CALIBRATION_NOT_FROZEN",
    "DETERMINISTIC_REPLAY_UNPROVEN",
    "QUERY_REFERENCE_LEAKAGE",
  ]);
});

test("matching lever represents automatic authority only as a blocked receipt", () => {
  const receipt = evaluateMatchingLever(input({ authority: "automatic" }));
  assert.equal(receipt.decision.status, "blocked");
  assert.deepEqual(receipt.decision.reasons, ["AUTOMATIC_AUTHORITY_FORBIDDEN"]);
  assert.equal(receipt.authority.automaticIdentityAuthority, "none");
});

test("matching lever rejects unsafe public identifiers before receipt emission", () => {
  const base = input();
  const adversarial = [
    {
      ...base,
      experiment: { ...base.experiment, experimentId: "../../private" },
    },
    {
      ...base,
      baseline: { ...base.baseline, policyId: "https://policy.invalid" },
    },
    { ...base, candidate: { ...base.candidate, policyId: "Person Name" } },
    { ...base, candidate: { ...base.candidate, policyId: "policy\nprivate" } },
    { ...base, candidate: { ...base.candidate, policyId: "x".repeat(65) } },
  ];
  for (const value of adversarial) {
    let receipt;
    assert.throws(
      () => {
        receipt = evaluateMatchingLever(value);
      },
      (error) => error.code === "MATCHING_LEVER_INPUT_INVALID",
    );
    assert.equal(receipt, undefined);
  }
});

test("matching lever CLI emits the same deterministic minimized receipt", () => {
  const expected = evaluateMatchingLever(input());
  const run = () =>
    spawnSync(process.execPath, ["bin/evaluate-matching-lever.mjs"], {
      cwd: serviceRoot,
      encoding: "utf8",
      input: JSON.stringify(input()),
    });
  const first = run();
  const second = run();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(JSON.parse(first.stdout), expected);
  assert.equal(first.stdout, second.stdout);
  assert.equal(first.stdout.includes("private"), false);
  assert.equal(first.stdout.includes("Person Name"), false);
});
