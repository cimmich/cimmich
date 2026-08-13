import assert from "node:assert/strict";
import test from "node:test";
import {
  sourcePackProductionRefitSchemaVersion,
  validateSourcePackProductionRefitReceipt,
} from "../src/source-pack-lifecycle.mjs";
import {
  deriveProductionRefitPolicy,
  sourcePackProductionRefitThresholds,
} from "../src/source-pack-production-refit.mjs";

const receipt = () => ({
  authorityScope: "human-review",
  cohortDigest: "a".repeat(64),
  evaluationPackId: "sourcepack-evaluation",
  leakage: {
    passed: true,
    queryReferencePairOverlap: 0,
    sameAssetExcluded: true,
  },
  matcherPolicy: {
    fallbackMarginFloor: 0.39,
    fallbackScoreFloor: 0.6,
    marginFloor: 0.25,
    policyVersion: "cimmich-best-prime-v1",
    scoreFloor: 0.65,
    scorer: "best_individual_prime",
  },
  metrics: {
    automaticWeakPrimeReferences: 0,
    decisionPrecisionPercent: 99.1,
    knownCorrectCoveragePercent: 39,
    targetFalseAccepts: 0,
    unknownFalseAcceptRatePercent: 0,
    verifiedNegativePairs: 0,
    verifiedQueries: 3_448,
    verifiedUnknowns: 3_448,
  },
  packId: "sourcepack-production",
  parentGateDigest: "b".repeat(64),
  referenceDigest: "c".repeat(64),
  schemaVersion: sourcePackProductionRefitSchemaVersion,
  status: "passed",
  thresholds: sourcePackProductionRefitThresholds,
});

test("production refit gate accepts strict current-evidence proof", () => {
  const validated = validateSourcePackProductionRefitReceipt(
    receipt(),
    "sourcepack-production",
  );
  assert.equal(validated.status, "passed");
  assert.equal(validated.metrics.automaticWeakPrimeReferences, 0);
  assert.equal(validated.metrics.targetFalseAccepts, 0);
});

test("production refit gate fails closed on weak references and target regressions", () => {
  assert.throws(
    () =>
      validateSourcePackProductionRefitReceipt({
        ...receipt(),
        metrics: {
          ...receipt().metrics,
          automaticWeakPrimeReferences: 1,
        },
      }),
    /contradicts its frozen thresholds/,
  );
  assert.throws(
    () =>
      validateSourcePackProductionRefitReceipt({
        ...receipt(),
        metrics: {
          ...receipt().metrics,
          targetFalseAccepts: 101,
          unknownFalseAcceptRatePercent: 2.6,
        },
      }),
    /contradicts its frozen thresholds/,
  );
  assert.throws(
    () =>
      validateSourcePackProductionRefitReceipt({
        ...receipt(),
        leakage: {
          passed: true,
          queryReferencePairOverlap: 1,
          sameAssetExcluded: true,
        },
      }),
    /not same-asset leakage-safe/,
  );
});

test("production policy maximizes archive-wide verified precision without inferred labels", () => {
  const truth = new Map([
    ["face-a", "person-a"],
    ["face-b", "person-b"],
    ["face-c", "person-c"],
  ]);
  const accepted = [
    { faceId: "face-a", margin: 0.3, personId: "person-a", score: 0.7 },
    { faceId: "face-b", margin: 0.28, personId: "person-b", score: 0.68 },
    { faceId: "face-c", margin: 0.1, personId: "wrong", score: 0.61 },
  ];
  const policy = deriveProductionRefitPolicy(accepted, truth, {
    queryCount: 3,
  });
  assert.equal(policy.targetFalseAccepts, 0);
  assert.equal(policy.decisionPrecisionPercent, 100);
  assert.equal(policy.correct, 2);
});

test("production policy refuses an operating point that accepts an own-identity-withheld impostor", () => {
  const truth = new Map([
    ["face-a", "person-a"],
    ["face-b", "person-b"],
  ]);
  const accepted = [
    { faceId: "face-a", margin: 0.3, personId: "person-a", score: 0.7 },
    { faceId: "face-b", margin: 0.28, personId: "person-b", score: 0.68 },
  ];
  const policy = deriveProductionRefitPolicy(accepted, truth, {
    queryCount: 2,
    unknownScores: [
      { faceId: "face-a", margin: 0.29, personId: "person-b", score: 0.69 },
    ],
  });
  assert.equal(policy.targetFalseAccepts, 0);
  assert.ok(policy.scoreFloor >= 0.7 || policy.marginFloor >= 0.3);
});

test("production policy can add a stricter-margin recall fallback without weakening the gate", () => {
  const truth = new Map([
    ["face-a", "person-a"],
    ["face-b", "person-b"],
    ["face-c", "person-c"],
  ]);
  const policy = deriveProductionRefitPolicy(
    [
      { faceId: "face-a", margin: 0.4, personId: "person-a", score: 0.61 },
      { faceId: "face-b", margin: 0.32, personId: "person-b", score: 0.7 },
      { faceId: "face-c", margin: 0.2, personId: "wrong", score: 0.65 },
    ],
    truth,
    {
      queryCount: 3,
      unknownScores: [
        { faceId: "unknown", margin: 0.2, personId: "wrong", score: 0.65 },
      ],
    },
  );
  assert.ok(policy.fallbackScoreFloor <= policy.scoreFloor);
  assert.ok(policy.fallbackMarginFloor >= policy.marginFloor);
  assert.equal(policy.targetFalseAccepts, 0);
});

test("production refit source keeps explicit Person exclusions in the governed pack context", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL("../src/source-pack-production-refit.mjs", import.meta.url),
      "utf8",
    ),
  );
  assert.match(source, /excludedPersonIds: excluded/);
  assert.match(source, /!excludedSet\.has\(face\.personId\)/);
  assert.match(source, /!excludedSet\.has\(row\.person_id\)/);
});
