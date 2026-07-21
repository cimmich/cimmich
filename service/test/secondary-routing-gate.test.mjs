import assert from "node:assert/strict";
import test from "node:test";
import { validateSecondaryRoutingGateReceipt } from "../src/secondary-routing-gate.mjs";

const receipt = {
  authorityScope: "human-review",
  cohortDigest: "a".repeat(64),
  leakage: { passed: true, queryReferenceOverlap: 0 },
  metrics: {
    baselineCorrect: 70,
    changedWinners: 5,
    conditionedCorrect: 72,
    falseFlips: 1,
    ordinaryBaselineCorrect: 40,
    ordinaryConditionedCorrect: 40,
    ordinaryQueries: 50,
    queries: 100,
    rescues: 3,
    secondaryRouted: 12,
  },
  packId: "pack_a",
  policy: {
    policyVersion: "guarded-secondary-v1",
    threshold: 0.04,
    weight: 0.15,
  },
  schemaVersion: "cimmich.secondary-routing-gate.v1",
  split: { calibration: "a", holdout: "b" },
  status: "passed",
  thresholds: {
    maximumFalseFlipRatePercent: 1,
    maximumOrdinaryAccuracyDropPoints: 0,
    minimumNetGain: 1,
    minimumQueries: 100,
  },
};

test("Secondary gate accepts bounded blind gain without ordinary regression", () => {
  const validated = validateSecondaryRoutingGateReceipt(receipt, "pack_a");
  assert.equal(validated.metrics.netGain, 2);
  assert.equal(validated.metrics.falseFlipRatePercent, 1);
  assert.equal(validated.authorityScope, "human-review");
});

test("Secondary gate rejects threshold spin and automatic authority", () => {
  assert.throws(
    () =>
      validateSecondaryRoutingGateReceipt({
        ...receipt,
        metrics: { ...receipt.metrics, falseFlips: 3, rescues: 5 },
      }),
    /status contradicts/,
  );
  assert.throws(
    () =>
      validateSecondaryRoutingGateReceipt({
        ...receipt,
        authorityScope: "autoaccept",
      }),
    /automatic identity authority/,
  );
});
