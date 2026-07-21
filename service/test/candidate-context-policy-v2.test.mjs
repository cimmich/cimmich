import assert from "node:assert/strict";
import test from "node:test";
import {
  contextualCandidatePriorResultSchemaVersion,
  contextualCandidatePriorSchemaVersion,
  contextualCandidateSetDigest,
  contextualEvidenceDigest,
  contextualPolicyDigest,
  evaluateContextualCandidatePrior,
} from "../src/candidate-context-policy-v2.mjs";

const token = (character) => character.repeat(64).slice(0, 64);
const digest = token;
const queryToken = token("f");
const providerConfigDigest = digest("c");
const vectorSpaceId = `vector_space_${digest("d")}`;

const policy = (overrides = {}) => ({
  bodyAdjustment: 0.01,
  captureAdjustment: 0.01,
  maximumMetadataErrorSeconds: 120,
  maximumTotalAdjustment: 0.02,
  minimumBodyMargin: 0.005,
  minimumBodyScore: 0.8,
  minimumCaptureConfidence: 0.8,
  tieWindow: 0.02,
  visualFloor: 0.7,
  ...overrides,
});

const candidate = (
  candidateToken,
  visualScore,
  { body = false, capture = false, ...overrides } = {},
) => ({
  ambiguity: { evidenceDigest: digest("1"), state: "none" },
  bodyContinuity: body
    ? {
        evidenceDigest: digest("2"),
        margin: 0.02,
        score: 0.95,
        state: "supported",
      }
    : {
        evidenceDigest: digest("2"),
        margin: 0,
        score: 0,
        state: "unavailable",
      },
  candidateToken,
  captureContext: capture
    ? {
        coappearance: "supporting",
        confidence: 0.95,
        contextKind: "same_moment",
        evidenceDigest: digest("3"),
        reliability: "verified",
        state: "supported",
        time: "supporting",
      }
    : {
        coappearance: "unavailable",
        confidence: 0,
        contextKind: "none",
        evidenceDigest: digest("3"),
        reliability: "unavailable",
        state: "unavailable",
        time: "unavailable",
      },
  metadata: {
    errorSeconds: 0,
    evidenceDigest: digest("4"),
    reliability: "verified",
  },
  samePhoto: { evidenceDigest: digest("5"), state: "absent" },
  visualScore,
  ...overrides,
});

const contextualInput = ({
  candidates = [
    candidate(token("a"), 0.82),
    candidate(token("b"), 0.805, { body: true, capture: true }),
  ],
  policy: selectedPolicy = policy(),
  ...overrides
} = {}) => {
  const ranked = [...candidates].sort(
    (left, right) =>
      right.visualScore - left.visualScore ||
      left.candidateToken.localeCompare(right.candidateToken),
  );
  const baselineMargin =
    ranked.length === 1
      ? 1
      : Number((ranked[0].visualScore - ranked[1].visualScore).toFixed(6));
  return {
    baseline: {
      candidateToken: ranked[0].candidateToken,
      margin: baselineMargin,
      visualScore: ranked[0].visualScore,
    },
    bodyContinuitySource: "synthetic_fixture",
    candidateSetDigest: contextualCandidateSetDigest(candidates),
    candidates,
    cohortDigest: digest("6"),
    contextPolicyDigest: contextualPolicyDigest(selectedPolicy),
    evidenceDigest: contextualEvidenceDigest(candidates),
    nonRepresentative: true,
    operationalUse: "none",
    policy: selectedPolicy,
    providerConfigDigest,
    queryToken,
    schemaVersion: contextualCandidatePriorSchemaVersion,
    truthVersionDigest: digest("7"),
    vectorSpaceId,
    visualPolicyDigest: digest("8"),
    ...overrides,
  };
};

test("two independent reliable families can propose one bounded anonymous tie-break", () => {
  const input = contextualInput();
  const first = evaluateContextualCandidatePrior(input);
  const second = evaluateContextualCandidatePrior({
    ...input,
    candidates: [...input.candidates].reverse(),
  });
  assert.deepEqual(first, second);
  assert.equal(
    first.schemaVersion,
    contextualCandidatePriorResultSchemaVersion,
  );
  assert.equal(first.decision.status, "tie_break_proposed");
  assert.equal(first.decision.proposedCandidateToken, token("b"));
  assert.deepEqual(first.decision.reasons, [
    "COMBINED_INDEPENDENT_CONTEXT_TIE_BREAK",
  ]);
  assert.deepEqual(
    first.candidates.find((row) => row.candidateToken === token("b"))
      .adjustment,
    { bodyContinuity: 0.01, captureContext: 0.01, total: 0.02 },
  );
  assert.equal(first.nonRepresentative, true);
  assert.equal(first.operationalUse, "none");
  assert.equal(first.boundary.bodyContinuitySource, "synthetic_fixture");
  assert.deepEqual(first.authority, {
    activation: "none",
    automaticIdentityAuthority: "none",
    persistence: "none",
    recommendation: "none",
    training: "none",
  });
  assert.match(first.receiptDigest, /^[0-9a-f]{64}$/);
});

test("time and coappearance remain one family and cannot select identity alone", () => {
  const captureOnly = contextualInput({
    candidates: [
      candidate(token("a"), 0.82),
      candidate(token("b"), 0.805, { capture: true }),
    ],
  });
  const receipt = evaluateContextualCandidatePrior(captureOnly);
  assert.equal(receipt.decision.status, "unchanged");
  assert.equal(receipt.decision.proposedCandidateToken, null);
  assert.deepEqual(receipt.decision.reasons, [
    "COMBINED_CONTEXT_LEFT_BASELINE_UNCHANGED",
  ]);
});

test("anonymous body continuity cannot select identity alone", () => {
  const bodyOnly = contextualInput({
    candidates: [
      candidate(token("a"), 0.82),
      candidate(token("b"), 0.805, { body: true }),
    ],
  });
  const receipt = evaluateContextualCandidatePrior(bodyOnly);
  assert.equal(receipt.decision.status, "unchanged");
  assert.equal(receipt.decision.proposedCandidateToken, null);
});

test("a family that changes the visual winner alone forces counterfactual abstention", () => {
  const receipt = evaluateContextualCandidatePrior(
    contextualInput({
      candidates: [
        candidate(token("a"), 0.82),
        candidate(token("b"), 0.812, { body: true, capture: true }),
      ],
    }),
  );
  assert.equal(receipt.decision.status, "abstained");
  assert.equal(receipt.decision.proposedCandidateToken, null);
  assert.deepEqual(receipt.decision.reasons, [
    "CAPTURE_COUNTERFACTUAL_CHANGED_BASELINE",
  ]);
});

test("unresolved ambiguity abstains and metadata reliability cannot score", () => {
  const ambiguousCandidates = [
    candidate(token("a"), 0.82),
    candidate(token("b"), 0.805, {
      body: true,
      capture: true,
      ambiguity: {
        evidenceDigest: digest("1"),
        state: "body_assignment",
      },
    }),
  ];
  const ambiguous = evaluateContextualCandidatePrior(
    contextualInput({ candidates: ambiguousCandidates }),
  );
  assert.equal(ambiguous.decision.status, "abstained");
  assert.deepEqual(ambiguous.decision.reasons, [
    "UNRESOLVED_CONTEXT_AMBIGUITY",
  ]);
  assert.equal(
    ambiguous.candidates.every((row) => row.adjustment.total === 0),
    true,
  );

  const unreliableCandidates = [
    candidate(token("a"), 0.82),
    candidate(token("b"), 0.805, {
      body: true,
      capture: true,
      metadata: {
        errorSeconds: 0,
        evidenceDigest: digest("4"),
        reliability: "conflicted",
      },
    }),
  ];
  const unreliable = evaluateContextualCandidatePrior(
    contextualInput({ candidates: unreliableCandidates }),
  );
  assert.equal(unreliable.decision.status, "abstained");
  assert.deepEqual(unreliable.decision.reasons, [
    "METADATA_RELIABILITY_INSUFFICIENT",
  ]);
});

test("same-photo evidence is suppress-only and output remains a subset", () => {
  const candidates = [
    candidate(token("a"), 0.79, {
      samePhoto: {
        evidenceDigest: digest("5"),
        state: "accepted_present",
      },
    }),
    candidate(token("b"), 0.78),
  ];
  const receipt = evaluateContextualCandidatePrior(
    contextualInput({ candidates }),
  );
  assert.equal(receipt.decision.status, "candidate_suppressed");
  assert.equal(receipt.decision.proposedCandidateToken, null);
  assert.deepEqual(
    receipt.candidates.map((row) => row.candidateToken),
    [token("b")],
  );
});

test("an ordinary separated Prime winner is byte-stable and receives zero context", () => {
  const receipt = evaluateContextualCandidatePrior(
    contextualInput({
      candidates: [
        candidate(token("a"), 0.92),
        candidate(token("b"), 0.81, { body: true, capture: true }),
      ],
    }),
  );
  assert.equal(receipt.decision.status, "unchanged");
  assert.deepEqual(receipt.decision.reasons, ["SEPARATED_VISUAL_WINNER"]);
  assert.equal(receipt.decision.proposedCandidateToken, null);
  for (const row of receipt.candidates) {
    assert.equal(row.adjustedScore, row.visualScore);
    assert.deepEqual(row.adjustment, {
      bodyContinuity: 0,
      captureContext: 0,
      total: 0,
    });
  }
});

test("one visually eligible candidate remains valid but cannot invoke context", () => {
  const onlyCandidate = candidate(token("a"), 0.82, {
    body: true,
    capture: true,
  });
  const receipt = evaluateContextualCandidatePrior(
    contextualInput({ candidates: [onlyCandidate] }),
  );
  assert.equal(receipt.decision.status, "unchanged");
  assert.deepEqual(receipt.decision.reasons, ["SINGLE_CANDIDATE"]);
  assert.equal(receipt.candidates.length, 1);
  assert.equal(receipt.candidates[0].adjustment.total, 0);
});

test("contract rejects production authority, unsafe fields and malformed bindings before receipt emission", () => {
  const base = contextualInput();
  const excessiveCandidates = Array.from({ length: 65 }, (_, index) =>
    candidate(index.toString(16).padStart(64, "0"), 0.8),
  );
  const adversarial = [
    { ...base, bodyContinuitySource: "production" },
    { ...base, bodyProducerAuthority: "synthetic_fixture" },
    { ...base, nonRepresentative: false },
    { ...base, operationalUse: "identity" },
    { ...base, candidates: [] },
    { ...base, candidates: excessiveCandidates },
    { ...base, candidateSetDigest: digest("9") },
    { ...base, evidenceDigest: digest("9") },
    { ...base, contextPolicyDigest: digest("9") },
    { ...base, queryToken: token("a") },
    {
      ...base,
      candidates: [base.candidates[0], { ...base.candidates[0] }],
    },
    {
      ...base,
      candidates: base.candidates.map((row, index) =>
        index === 1 ? { ...row, visualScore: 0.69 } : row,
      ),
    },
    {
      ...base,
      baseline: { ...base.baseline, margin: 0.01 },
    },
    {
      ...base,
      baseline: { ...base.baseline, candidateToken: token("b") },
    },
    {
      ...base,
      policy: { ...base.policy, bodyAdjustment: 0.011 },
    },
    {
      ...base,
      policy: { ...base.policy, tieWindow: 0.019 },
    },
    {
      ...base,
      candidates: base.candidates.map((row, index) =>
        index === 1 ? { ...row, visualScore: Number.NaN } : row,
      ),
    },
    {
      ...base,
      candidates: base.candidates.map((row, index) =>
        index === 0 ? { ...row, personId: "private-person" } : row,
      ),
    },
    {
      ...base,
      candidates: base.candidates.map((row, index) =>
        index === 0
          ? {
              ...row,
              metadata: { ...row.metadata, path: "/private/library" },
            }
          : row,
      ),
    },
  ];
  for (const value of adversarial) {
    let receipt;
    assert.throws(
      () => {
        receipt = evaluateContextualCandidatePrior(value);
      },
      (error) => error.code === "CONTEXTUAL_CANDIDATE_PRIOR_INPUT_INVALID",
    );
    assert.equal(receipt, undefined);
  }
});

test("result is anonymous, minimized and contains no operational or identity payload", () => {
  const receipt = evaluateContextualCandidatePrior(contextualInput());
  const serialized = JSON.stringify(receipt);
  for (const forbidden of [
    "personId",
    "displayName",
    "filename",
    "path",
    "url",
    "embedding",
    "timestamp",
    "mediaBytes",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.equal(
    receipt.candidates.every((row) =>
      [token("a"), token("b")].includes(row.candidateToken),
    ),
    true,
  );
});
