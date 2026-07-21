import assert from "node:assert/strict";
import test from "node:test";

import {
  allTrustedShortlistPolicyV1,
  allTrustedShortlistRouterSchemaVersion,
  prepareAllTrustedShortlistEvidence,
  projectAllTrustedShortlistResult,
  resolveAllTrustedShortlistEvidence,
} from "../src/all-trusted-shortlist-router.mjs";
import {
  classifyFaceCondition,
  faceConditionClassifierSchemaVersion,
  waveOneFaceConditionPolicyV1,
} from "../src/face-condition-classifier.mjs";
import { createVisualCandidateSetRepository } from "../src/visual-candidate-set.mjs";

const digest = (character) => character.repeat(64);
const binding = {
  asset_id: "asset-internal-query",
  config_digest: digest("c"),
  current_person_id: null,
  dimension: 4,
  embedding_id: "embedding-internal-query",
  face_id: "face-internal-query",
  input_revision: digest("1"),
  model_family: "synthetic-model",
  model_version: "v1",
  pack_digest: digest("2"),
  pack_id: "sourcepack-internal-active",
  policy_version: "cimmich-source-pack-v8-evidence-modifiers",
  source_content_digest: digest("3"),
  source_revision_digest: digest("4"),
  vector_digest: digest("5"),
  vector_space_id: `vector_space_${digest("6")}`,
};

const candidateEnvelope = async () => {
  const sql = async (strings) =>
    strings.join("").includes("SELECT DISTINCT face.face_id")
      ? [binding]
      : [
          { person_id: "person-alpha", visual_score: 0.61 },
          { person_id: "person-beta", visual_score: 0.6 },
          { person_id: "person-gamma", visual_score: 0.59 },
          { person_id: "person-scout", visual_score: 0.55 },
          { person_id: "person-other", visual_score: 0.5 },
        ];
  return createVisualCandidateSetRepository(sql, {
    presentationRank: () => 1,
  }).load({
    faceId: binding.face_id,
    limit: 64,
    providerConfigDigest: binding.config_digest,
    visualFloor: 0,
  });
};

const input = async (overrides = {}) => {
  const candidates = await candidateEnvelope();
  const qualityClassification = classifyFaceCondition({
    observation: {
      detectionConfidence: 0.7,
      faceAreaRatio: 0.0008,
      frontalScore: 0.2,
      qualityScore: 0.35,
    },
    policy: waveOneFaceConditionPolicyV1,
    queryRevisionDigest: candidates.binding.queryRevisionDigest,
    schemaVersion: faceConditionClassifierSchemaVersion,
  });
  return {
    candidateEnvelope: candidates,
    policy: allTrustedShortlistPolicyV1,
    qualityClassification,
    schemaVersion: allTrustedShortlistRouterSchemaVersion,
    scoutEvidence: [
      {
        candidateToken: candidates.candidates[3].candidateToken,
        evidenceDigest: digest("a"),
        scoutScore: 0.72,
      },
      {
        candidateToken: candidates.candidates[4].candidateToken,
        evidenceDigest: digest("b"),
        scoutScore: 0.66,
      },
    ],
    ...overrides,
  };
};

test("face-hard all-trusted evidence appends one review-only rank-four option", async () => {
  const prepared = prepareAllTrustedShortlistEvidence(await input());
  const result = resolveAllTrustedShortlistEvidence(prepared);
  assert.equal(result.changed, true);
  assert.equal(result.reason, "ALL_TRUSTED_REVIEW_SHORTLIST_ADDITION");
  assert.deepEqual(result.numericEvidence, {
    candidatePrimeScore: 0.55,
    primeGap: 0.06,
    scoutAdvantage: 0.06,
    scoutScore: 0.72,
  });
  assert.equal(result.authority.recommendation, "review_shortlist_only");
  assert.equal(result.authority.automaticIdentityAuthority, "none");
  assert.equal(result.authority.activation, "none");
  assert.equal(result.authority.training, "none");
  assert.equal(projectAllTrustedShortlistResult(result), result);
});

test("an anonymous runner-up may prove margin but can never become a candidate", async () => {
  const value = await input();
  value.scoutEvidence[1].candidateToken = null;
  const result = resolveAllTrustedShortlistEvidence(
    prepareAllTrustedShortlistEvidence(value),
  );
  assert.equal(result.changed, true);
  assert.equal(
    result.proposedCandidateToken,
    value.scoutEvidence[0].candidateToken,
  );

  const absentLeader = await input();
  absentLeader.scoutEvidence[0].candidateToken = null;
  assert.throws(
    () => prepareAllTrustedShortlistEvidence(absentLeader),
    /scout leader must exist in the frozen candidate set/,
  );
});

test("Prime membership, weak support, wide gap and scout ambiguity abstain", async () => {
  const cases = [
    (value) => {
      value.scoutEvidence[0].candidateToken =
        value.candidateEnvelope.candidates[2].candidateToken;
    },
    (value) => {
      value.scoutEvidence[0].scoutScore = 0.14;
      value.scoutEvidence[1].scoutScore = 0.1;
    },
    (value) => {
      value.scoutEvidence[0].candidateToken =
        value.candidateEnvelope.candidates[4].candidateToken;
      value.scoutEvidence[1].candidateToken =
        value.candidateEnvelope.candidates[3].candidateToken;
      value.scoutEvidence[0].scoutScore = 0.72;
      value.scoutEvidence[1].scoutScore = 0.66;
      value.candidateEnvelope = value.candidateEnvelope;
    },
    (value) => {
      value.scoutEvidence[1].scoutScore = 0.69;
    },
  ];
  const reasons = [
    "SCOUT_ALREADY_IN_PRIME_TOP_THREE",
    "SCOUT_SUPPORT_BELOW_FLOOR",
    "PRIME_GAP_TOO_WIDE",
    "SCOUT_AMBIGUOUS",
  ];
  for (const [index, mutate] of cases.entries()) {
    const value = await input();
    mutate(value);
    const result = resolveAllTrustedShortlistEvidence(
      prepareAllTrustedShortlistEvidence(value),
    );
    assert.equal(result.changed, false);
    assert.equal(result.reason, reasons[index]);
    assert.equal(result.proposedCandidateToken, null);
  }
});

test("copied policy, copied envelopes, absent candidates and stale quality fail closed", async () => {
  const copiedPolicy = await input({
    policy: { ...allTrustedShortlistPolicyV1 },
  });
  assert.throws(
    () => prepareAllTrustedShortlistEvidence(copiedPolicy),
    /exact frozen all-trusted shortlist policy/,
  );

  const absent = await input();
  absent.scoutEvidence[0].candidateToken = digest("f");
  assert.throws(
    () => prepareAllTrustedShortlistEvidence(absent),
    /may not manufacture a candidate/,
  );

  const stale = await input();
  stale.qualityClassification = classifyFaceCondition({
    observation: {
      detectionConfidence: 0.7,
      faceAreaRatio: 0.0008,
      frontalScore: 0.2,
      qualityScore: 0.35,
    },
    policy: waveOneFaceConditionPolicyV1,
    queryRevisionDigest: digest("9"),
    schemaVersion: faceConditionClassifierSchemaVersion,
  });
  assert.throws(
    () => prepareAllTrustedShortlistEvidence(stale),
    /does not bind the current query revision/,
  );

  const prepared = prepareAllTrustedShortlistEvidence(await input());
  assert.throws(
    () => resolveAllTrustedShortlistEvidence({ ...prepared }),
    /exact prepared all-trusted evidence/,
  );
  const result = resolveAllTrustedShortlistEvidence(prepared);
  assert.throws(
    () => projectAllTrustedShortlistResult({ ...result }),
    /exact all-trusted shortlist result/,
  );
});
