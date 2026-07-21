import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateProviderReview,
  providerReviewEvaluationSchemaVersion,
  providerReviewGateSchemaVersion,
} from "../src/provider-review-gate.mjs";

const digest = (value) => value.repeat(64).slice(0, 64);
const vectorSpaceId = `vector_space_${digest("a")}`;

const input = (overrides = {}) => ({
  authority: "human_review",
  baseline: {
    correctKnownCoverage: 0.72,
    forcedTop1: 0.95,
    label: "all_trusted",
    vectorSpaceId,
  },
  candidate: {
    artifactKind: "source_pack",
    anchoredPeopleCovered: 353,
    anchoredPeopleExpected: 353,
    correctKnownCoverage: 0.8,
    decisionPrecision: 0.989,
    deterministicReplay: true,
    forcedTop1: 0.93,
    hardFalseFlips: 0,
    hardRescues: 5,
    label: "provider_specific_prime",
    ordinaryFalseFlips: 0,
    candidateDigest: digest("b"),
    unknownFar: 0.015,
    vectorSpaceId,
    verifiedUnknowns: 192,
  },
  gate: {
    maximumUnknownFar: 0.025,
    minimumCoverageGain: 0,
    minimumDecisionPrecision: 0.98,
    minimumVerifiedUnknowns: 100,
  },
  provider: {
    providerConfigDigest: digest("c"),
    providerName: "local-provider",
    vectorSpaceId,
  },
  schemaVersion: providerReviewEvaluationSchemaVersion,
  ...overrides,
});

test("provider review passes only a complete same-space human-review improvement", () => {
  const receipt = evaluateProviderReview(input());
  assert.equal(receipt.schemaVersion, providerReviewGateSchemaVersion);
  assert.equal(receipt.decision.status, "passed_for_operator_review");
  assert.deepEqual(receipt.decision.reasons, []);
  assert.equal(receipt.authority.activation, "none");
  assert.equal(receipt.authority.automaticIdentityAuthority, "none");
  assert.equal(receipt.boundary.databaseWrites, "none");
  assert.match(receipt.receiptDigest, /^[0-9a-f]{64}$/);
});

test("provider review rejects a provider-specific policy that trails its own baseline", () => {
  const receipt = evaluateProviderReview(
    input({
      baseline: {
        correctKnownCoverage: 0.60647,
        forcedTop1: 0.85003,
        label: "sface_all_trusted",
        vectorSpaceId,
      },
      candidate: {
        artifactKind: "evaluation_policy",
        candidateDigest: digest("d"),
        correctKnownCoverage: 0.54706,
        forcedTop1: 0.75576,
        label: "sface_provider_specific_prime",
        unknownFar: 0.00532,
        vectorSpaceId,
      },
    }),
  );
  assert.equal(receipt.decision.status, "rejected");
  assert.deepEqual(receipt.decision.reasons, [
    "CORRECT_KNOWN_COVERAGE_NOT_IMPROVED",
  ]);
  assert.equal(receipt.comparison.correctKnownCoverageGain, -0.05941);
});

test("provider review blocks comparison across recognition spaces", () => {
  const receipt = evaluateProviderReview(
    input({
      candidate: {
        ...input().candidate,
        vectorSpaceId: `vector_space_${digest("e")}`,
      },
    }),
  );
  assert.equal(receipt.decision.status, "blocked");
  assert.deepEqual(receipt.decision.reasons, ["VECTOR_SPACE_MISMATCH"]);
  assert.equal(receipt.comparison.comparable, false);
});

test("provider review refuses automatic identity authority", () => {
  const receipt = evaluateProviderReview(input({ authority: "automatic" }));
  assert.equal(receipt.decision.status, "blocked");
  assert.deepEqual(receipt.decision.reasons, ["AUTOMATIC_AUTHORITY_FORBIDDEN"]);
});

test("provider review rejects unsafe public receipt identifiers before emission", () => {
  const adversarialInputs = [
    input({
      provider: { ...input().provider, providerName: "../../private/provider" },
    }),
    input({
      provider: {
        ...input().provider,
        providerName: "https://provider.invalid",
      },
    }),
    input({
      baseline: { ...input().baseline, label: "Person Name" },
    }),
    input({
      candidate: { ...input().candidate, label: "policy\nprivate" },
    }),
    input({ authority: "human review" }),
    input({
      candidate: { ...input().candidate, label: "x".repeat(65) },
    }),
  ];

  for (const adversarial of adversarialInputs) {
    let receipt;
    assert.throws(
      () => {
        receipt = evaluateProviderReview(adversarial);
      },
      (error) => error.code === "PROVIDER_REVIEW_INPUT_INVALID",
    );
    assert.equal(receipt, undefined);
  }
});

test("provider review blocks a positive result without complete promotion proof", () => {
  const candidate = { ...input().candidate };
  delete candidate.decisionPrecision;
  candidate.verifiedUnknowns = 20;
  candidate.ordinaryFalseFlips = 1;
  const receipt = evaluateProviderReview(input({ candidate }));
  assert.equal(receipt.decision.status, "blocked");
  assert.deepEqual(receipt.decision.reasons, [
    "DECISION_PRECISION_GATE_FAILED",
    "ORDINARY_FALSE_FLIP_GATE_FAILED",
    "VERIFIED_UNKNOWN_COHORT_INSUFFICIENT",
  ]);
});
