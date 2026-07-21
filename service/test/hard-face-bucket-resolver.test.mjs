import assert from "node:assert/strict";
import test from "node:test";

import {
  hardFaceBucketResolverSchemaVersion,
  measuredHardFaceBucketPolicyV1,
  prepareHardFaceBucketEvidence,
  projectHardFaceBucketResult,
  resolveHardFaceBucketEvidence,
} from "../src/hard-face-bucket-resolver.mjs";

const digest = (character) => character.repeat(64);
const vectorSpaceId = `vector_space_${digest("a")}`;

const input = (overrides = {}) => ({
  baselineCandidateToken: "candidate_alpha",
  candidates: [
    {
      candidateToken: "candidate_alpha",
      primeScore: 0.615665,
      supports: [
        {
          evidenceContextDigest: digest("b"),
          referenceToken: "reference_alpha_1",
          similarity: 0.51,
        },
        {
          evidenceContextDigest: digest("c"),
          referenceToken: "reference_alpha_2",
          similarity: 0.49,
        },
      ],
    },
    {
      candidateToken: "candidate_beta",
      primeScore: 0.61,
      supports: [
        {
          evidenceContextDigest: digest("d"),
          referenceToken: "reference_beta_1",
          similarity: 0.74,
        },
        {
          evidenceContextDigest: digest("e"),
          referenceToken: "reference_beta_2",
          similarity: 0.72,
        },
      ],
    },
  ],
  policy: measuredHardFaceBucketPolicyV1,
  providerConfigDigest: digest("f"),
  qualityBucket: "face_hard",
  queryRevisionDigest: digest("1"),
  queryToken: "query_holdout_1",
  schemaVersion: hardFaceBucketResolverSchemaVersion,
  vectorSpaceId,
  ...overrides,
});

test("measured hard-face policy proposes only the frozen Prime runner-up", () => {
  const prepared = prepareHardFaceBucketEvidence(input());
  const result = resolveHardFaceBucketEvidence(prepared);
  assert.equal(result.changed, true);
  assert.equal(result.proposedCandidateToken, "candidate_beta");
  assert.equal(result.reason, "ROBUST_BUCKET_RESCUE_PROPOSED");
  assert.deepEqual(result.numericEvidence, {
    baselineSupport: 0.5,
    challengerSupport: 0.73,
    primeMargin: 0.005665,
  });
  assert.equal(result.authority.automaticIdentityAuthority, "none");
  assert.equal(projectHardFaceBucketResult(result), result);
});

test("ordinary and separated Prime queries remain unchanged", () => {
  const ordinary = resolveHardFaceBucketEvidence(
    prepareHardFaceBucketEvidence(input({ qualityBucket: "face_core" })),
  );
  assert.equal(ordinary.changed, false);
  assert.equal(ordinary.reason, "NOT_HARD_QUERY");

  const separatedInput = input();
  separatedInput.candidates[0].primeScore = 0.72;
  const separated = resolveHardFaceBucketEvidence(
    prepareHardFaceBucketEvidence(separatedInput),
  );
  assert.equal(separated.changed, false);
  assert.equal(separated.reason, "PRIME_SEPARATED");
});

test("weak, ambiguous and incomplete bucket evidence abstains", () => {
  const weakInput = input();
  weakInput.candidates[1].supports[0].similarity = 0.42;
  weakInput.candidates[1].supports[1].similarity = 0.4;
  const weak = resolveHardFaceBucketEvidence(
    prepareHardFaceBucketEvidence(weakInput),
  );
  assert.equal(weak.changed, false);
  assert.equal(weak.reason, "SUPPORT_ADVANTAGE_NOT_MET");

  const incompleteInput = input();
  incompleteInput.candidates[1].supports.pop();
  const incomplete = resolveHardFaceBucketEvidence(
    prepareHardFaceBucketEvidence(incompleteInput),
  );
  assert.equal(incomplete.changed, false);
  assert.equal(incomplete.reason, "INSUFFICIENT_INDEPENDENT_SUPPORT");
});

test("input order is canonical and copied envelopes cannot resolve or project", () => {
  const ordered = prepareHardFaceBucketEvidence(input());
  const reversedInput = input();
  reversedInput.candidates.reverse();
  reversedInput.candidates[0].supports.reverse();
  const reversed = prepareHardFaceBucketEvidence(reversedInput);
  assert.equal(ordered.evidenceDigest, reversed.evidenceDigest);

  assert.throws(
    () => resolveHardFaceBucketEvidence(Object.freeze({ ...ordered })),
    /exact prepared evidence envelope/,
  );
  const result = resolveHardFaceBucketEvidence(ordered);
  assert.throws(
    () => projectHardFaceBucketResult(Object.freeze({ ...result })),
    /exact resolver result envelope/,
  );
});

test("candidate manufacture, cross-candidate references and float drift fail closed", () => {
  assert.throws(
    () =>
      prepareHardFaceBucketEvidence({
        ...input(),
        candidates: [...input().candidates, input().candidates[0]],
      }),
    /Exactly the frozen Prime top two/,
  );

  const overlap = input();
  overlap.candidates[1].supports[0].referenceToken = "reference_alpha_1";
  assert.throws(
    () => prepareHardFaceBucketEvidence(overlap),
    /cannot support two candidates/,
  );

  const drift = input();
  drift.candidates[0].primeScore = 0.6156651;
  assert.throws(
    () => prepareHardFaceBucketEvidence(drift),
    /canonical six-decimal precision/,
  );
});

test("names, paths, URLs and arbitrary vector spaces are rejected", () => {
  for (const badToken of ["Person Name", "../face", "https://example.com"]) {
    const value = input({ queryToken: badToken });
    assert.throws(
      () => prepareHardFaceBucketEvidence(value),
      /bounded anonymous token/,
    );
  }
  assert.throws(
    () =>
      prepareHardFaceBucketEvidence(input({ vectorSpaceId: "caller_space" })),
    /derived recognition space/,
  );
});
