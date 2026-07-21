import assert from "node:assert/strict";
import test from "node:test";
import {
  sourcePackGateSchemaVersion,
  validateSourcePackConditionRejection,
  validateSourcePackGateReceipt,
} from "../src/source-pack-lifecycle.mjs";

const receipt = {
  authorityScope: "human-review",
  cohortDigest: "a".repeat(64),
  leakage: { passed: true, queryReferenceOverlap: 0 },
  metrics: {
    decisionPrecisionPercent: 98.8,
    knownCorrectCoveragePercent: 76.6,
    unknownFalseAcceptRatePercent: 2.1,
    verifiedUnknowns: 192,
  },
  matcherPolicy: {
    marginFloor: 0.08,
    policyVersion: "cimmich-best-prime-v1",
    scoreFloor: 0.52,
    scorer: "best_individual_prime",
  },
  packId: "sourcepack-fixture",
  schemaVersion: sourcePackGateSchemaVersion,
  status: "passed",
  thresholds: {
    maximumUnknownFalseAcceptRatePercent: 2.5,
    minimumDecisionPrecisionPercent: 98,
    minimumVerifiedUnknowns: 100,
  },
};

test("SourcePack human-review gate accepts internally consistent open-set proof", () => {
  const validated = validateSourcePackGateReceipt(
    receipt,
    "sourcepack-fixture",
  );
  assert.equal(validated.status, "passed");
  assert.equal(validated.metrics.verifiedUnknowns, 192);
  assert.equal(validated.matcherPolicy.scoreFloor, 0.52);
});

test("SourcePack gate refuses autoauthority, leakage, and threshold spin", () => {
  assert.throws(
    () =>
      validateSourcePackGateReceipt({
        ...receipt,
        authorityScope: "automatic-identity",
      }),
    /Automatic identity authority/,
  );
  assert.throws(
    () =>
      validateSourcePackGateReceipt({ ...receipt, leakage: { passed: false } }),
    /not leakage-safe/,
  );
  assert.throws(
    () => validateSourcePackGateReceipt({ ...receipt, status: "failed" }),
    /contradicts its frozen thresholds/,
  );
  assert.throws(
    () =>
      validateSourcePackGateReceipt({
        ...receipt,
        metrics: { ...receipt.metrics, unknownFalseAcceptRatePercent: -1 },
      }),
    /between 0 and 100/,
  );
  assert.throws(
    () =>
      validateSourcePackGateReceipt({
        ...receipt,
        metrics: { ...receipt.metrics, verifiedUnknowns: 191.5 },
      }),
    /must be an integer/,
  );
  assert.throws(
    () => validateSourcePackGateReceipt({ ...receipt, status: "complete" }),
    /must be passed or failed/,
  );
  assert.throws(
    () =>
      validateSourcePackGateReceipt({ ...receipt, matcherPolicy: undefined }),
    /requires the supported matcher policy/,
  );
  assert.throws(
    () =>
      validateSourcePackGateReceipt({
        ...receipt,
        matcherPolicy: { ...receipt.matcherPolicy, scoreFloor: 2 },
      }),
    /must be in \[0, 1\]/,
  );
});

const rejectedCondition = () => {
  const core = {
    authority: {
      activation: "none",
      automaticIdentityAuthority: "none",
      persistence: "none",
      recommendation: "none",
      training: "none",
    },
    calibration: {
      falseFlips: 0,
      independentPairs: 1,
      rescues: 1,
    },
    candidatePolicyCount: 0,
    frozenBaselinePolicyId: "sourcepack-" + "b".repeat(16),
    frozenPolicyReceiptDigest: "c".repeat(64),
    gate: "rejected",
    leakage: { passed: true, queryReferenceOverlap: 0 },
    opportunityCohortDigest: "d".repeat(64),
    policy: { policyId: "provider-condition-consensus-v1" },
    schemaVersion: "cimmich.provider-condition-consensus-evaluation.v1",
    selection: {
      policySelection: "frozen_receipt_replay_without_retuning",
    },
    sourcePackId: "sourcepack_fixture",
    untouchedHoldout: {
      changedWinners: 0,
      falseFlips: 0,
      netGain: 0,
    },
  };
  return { ...core, receiptDigest: digestForTest(core) };
};

const digestForTest = (value) => {
  const canonical = (current) =>
    Array.isArray(current)
      ? current.map(canonical)
      : current && typeof current === "object"
        ? Object.fromEntries(
            Object.entries(current)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([key, child]) => [key, canonical(child)]),
          )
        : current;
  return import("node:crypto").then(({ createHash }) =>
    createHash("sha256")
      .update(JSON.stringify(canonical(value)))
      .digest("hex"),
  );
};

test("a frozen no-opportunity consensus replay is a valid governed rejection", async () => {
  const receipt = rejectedCondition();
  receipt.receiptDigest = await receipt.receiptDigest;
  const validated = validateSourcePackConditionRejection(receipt);
  assert.equal(validated.sourcePackId, "sourcepack_fixture");
  assert.equal(validated.untouchedHoldout.changedWinners, 0);

  assert.throws(
    () =>
      validateSourcePackConditionRejection({
        ...receipt,
        candidatePolicyCount: 1,
      }),
    /digest does not match|frozen no-retune/,
  );
});
