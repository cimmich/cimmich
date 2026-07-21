import assert from "node:assert/strict";
import test from "node:test";

import {
  prepareProviderConditionConsensusEvidence,
  prepareProviderConditionEvidence,
  projectProviderConditionResult,
  providerConditionConsensusPolicyV1,
  providerConditionConsensusRouterSchemaVersion,
  providerConditionRouterSchemaVersion,
  providerConditionTopTwoPolicyV1,
  resolveProviderConditionConsensusEvidence,
  resolveProviderConditionEvidence,
} from "../src/provider-condition-router.mjs";
import {
  classifyFaceCondition,
  faceConditionClassifierSchemaVersion,
  waveOneFaceConditionPolicyV1,
} from "../src/face-condition-classifier.mjs";
import { recognitionDigest } from "../src/recognition-provider-contract.mjs";
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
  let call = 0;
  const sql = async (strings) => {
    call += 1;
    return call === 1 ||
      strings.join("").includes("SELECT DISTINCT face.face_id")
      ? [binding]
      : [
          { person_id: "person-internal-alpha", visual_score: 0.61 },
          { person_id: "person-internal-beta", visual_score: 0.6 },
          { person_id: "person-internal-gamma", visual_score: 0.59 },
        ];
  };
  return createVisualCandidateSetRepository(sql, {
    presentationRank: () => 1,
  }).load({
    faceId: binding.face_id,
    limit: 3,
    providerConfigDigest: binding.config_digest,
    visualFloor: 0.4,
  });
};

const input = async (overrides = {}) => {
  const candidate = await candidateEnvelope();
  const [leader, runnerUp] = candidate.candidates;
  const qualityClassification = classifyFaceCondition({
    observation: {
      detectionConfidence: 0.7,
      faceAreaRatio: 0.0008,
      frontalScore: 0.2,
      qualityScore: 0.35,
    },
    policy: waveOneFaceConditionPolicyV1,
    queryRevisionDigest: candidate.binding.queryRevisionDigest,
    schemaVersion: faceConditionClassifierSchemaVersion,
  });
  return {
    candidateEnvelope: candidate,
    conditionEvidence: [
      {
        candidateToken: leader.candidateToken,
        lowQualityEvidenceDigest: digest("a"),
        lowQualityScore: 0.45,
        secondaryEvidenceDigest: digest("b"),
        secondaryScore: 0.48,
      },
      {
        candidateToken: runnerUp.candidateToken,
        lowQualityEvidenceDigest: digest("d"),
        lowQualityScore: 0.78,
        secondaryEvidenceDigest: digest("e"),
        secondaryScore: 0.72,
      },
    ],
    policy: providerConditionTopTwoPolicyV1,
    qualityClassification,
    schemaVersion: providerConditionRouterSchemaVersion,
    ...overrides,
  };
};

const consensusInput = async (overrides = {}) => ({
  ...(await input()),
  policy: providerConditionConsensusPolicyV1,
  schemaVersion: providerConditionConsensusRouterSchemaVersion,
  ...overrides,
});

test("independent Secondary and LQ consensus proposes only Prime's runner-up", async () => {
  const prepared = prepareProviderConditionConsensusEvidence(
    await consensusInput(),
  );
  const result = resolveProviderConditionConsensusEvidence(prepared);
  assert.equal(result.changed, true);
  assert.equal(result.reason, "INDEPENDENT_CONDITION_CONSENSUS");
  assert.equal(result.numericEvidence.secondaryAdvantage, 0.24);
  assert.equal(result.numericEvidence.lowQualityAdvantage, 0.33);
  assert.equal(result.authority.recommendation, "review_suggestion_only");
  assert.equal(result.authority.automaticIdentityAuthority, "none");
  assert.equal(projectProviderConditionResult(result), result);
});

test("one-family, disagreeing and below-floor evidence preserve Prime", async () => {
  const cases = [
    (value) => {
      value.conditionEvidence[1].lowQualityScore = null;
      value.conditionEvidence[1].lowQualityEvidenceDigest = null;
    },
    (value) => {
      value.conditionEvidence[1].lowQualityScore = 0.4;
    },
    (value) => {
      value.conditionEvidence[1].lowQualityScore = 0.19;
      value.conditionEvidence[1].secondaryScore = 0.19;
    },
  ];
  for (const mutate of cases) {
    const value = await consensusInput();
    mutate(value);
    const result = resolveProviderConditionConsensusEvidence(
      prepareProviderConditionConsensusEvidence(value),
    );
    assert.equal(result.changed, false);
    assert.equal(
      result.proposedCandidateToken,
      value.candidateEnvelope.candidates[0].candidateToken,
    );
  }
});

test("condition consensus rejects policy copies and cross-resolver envelopes", async () => {
  const copied = await consensusInput({
    policy: { ...providerConditionConsensusPolicyV1 },
  });
  assert.throws(
    () => prepareProviderConditionConsensusEvidence(copied),
    /exact measured provider condition policy/,
  );
  const prepared = prepareProviderConditionConsensusEvidence(
    await consensusInput(),
  );
  assert.throws(
    () => resolveProviderConditionEvidence(prepared),
    /exact prepared condition evidence envelope/,
  );
});

test("measured condition policy proposes only the frozen Prime runner-up", async () => {
  const prepared = prepareProviderConditionEvidence(await input());
  const result = resolveProviderConditionEvidence(prepared);
  assert.equal(result.changed, true);
  assert.equal(result.reason, "CONDITIONED_TOP_TWO_PROPOSAL");
  assert.equal(result.routedFamilies.secondary, true);
  assert.equal(result.routedFamilies.lowQuality, true);
  assert.equal(result.authority.automaticIdentityAuthority, "none");
  assert.equal(result.authority.persistence, "none");
  assert.equal(projectProviderConditionResult(result), result);
});

test("face core and reject noise never route condition evidence", async () => {
  const observations = [
    {
      detectionConfidence: 0.9,
      faceAreaRatio: 0.003,
      frontalScore: 0.8,
      qualityScore: 0.8,
    },
    {
      detectionConfidence: 0.2,
      faceAreaRatio: 0.003,
      frontalScore: 0.8,
      qualityScore: 0.8,
    },
  ];
  for (const observation of observations) {
    const value = await input();
    value.qualityClassification = classifyFaceCondition({
      observation,
      policy: waveOneFaceConditionPolicyV1,
      queryRevisionDigest: value.candidateEnvelope.binding.queryRevisionDigest,
      schemaVersion: faceConditionClassifierSchemaVersion,
    });
    const result = resolveProviderConditionEvidence(
      prepareProviderConditionEvidence(value),
    );
    assert.equal(result.changed, false);
    assert.equal(result.reason, "QUALITY_FAMILY_NOT_ELIGIBLE");
    assert.deepEqual(result.routedFamilies, {
      lowQuality: false,
      secondary: false,
    });
  }
});

test("face variant routes Secondary but not LQ", async () => {
  const value = await input();
  value.qualityClassification = classifyFaceCondition({
    observation: {
      detectionConfidence: 0.8,
      faceAreaRatio: 0.0015,
      frontalScore: 0.4,
      qualityScore: 0.55,
    },
    policy: waveOneFaceConditionPolicyV1,
    queryRevisionDigest: value.candidateEnvelope.binding.queryRevisionDigest,
    schemaVersion: faceConditionClassifierSchemaVersion,
  });
  value.conditionEvidence[1].secondaryScore = 0.72;
  const result = resolveProviderConditionEvidence(
    prepareProviderConditionEvidence(value),
  );
  assert.equal(result.changed, true);
  assert.deepEqual(result.routedFamilies, {
    lowQuality: false,
    secondary: true,
  });
});

test("a separated Prime leader cannot be displaced", async () => {
  const value = await input();
  const sql = async (strings) =>
    strings.join("").includes("SELECT DISTINCT face.face_id")
      ? [binding]
      : [
          { person_id: "person-internal-alpha", visual_score: 0.72 },
          { person_id: "person-internal-beta", visual_score: 0.6 },
        ];
  value.candidateEnvelope = await createVisualCandidateSetRepository(sql, {
    presentationRank: () => 1,
  }).load({
    faceId: binding.face_id,
    limit: 2,
    providerConfigDigest: binding.config_digest,
    visualFloor: 0.4,
  });
  value.qualityClassification = classifyFaceCondition({
    observation: {
      detectionConfidence: 0.7,
      faceAreaRatio: 0.0008,
      frontalScore: 0.2,
      qualityScore: 0.35,
    },
    policy: waveOneFaceConditionPolicyV1,
    queryRevisionDigest: value.candidateEnvelope.binding.queryRevisionDigest,
    schemaVersion: faceConditionClassifierSchemaVersion,
  });
  const [leader, runnerUp] = value.candidateEnvelope.candidates;
  value.conditionEvidence[0].candidateToken = leader.candidateToken;
  value.conditionEvidence[1].candidateToken = runnerUp.candidateToken;
  const result = resolveProviderConditionEvidence(
    prepareProviderConditionEvidence(value),
  );
  assert.equal(result.changed, false);
  assert.equal(result.reason, "PRIME_SEPARATED");
});

test("candidate manufacture, copied envelopes and stale classifications fail closed", async () => {
  const manufactured = await input();
  manufactured.conditionEvidence[1].candidateToken =
    recognitionDigest("absent");
  assert.throws(
    () => prepareProviderConditionEvidence(manufactured),
    /frozen Prime top two/,
  );

  const copied = await input();
  copied.candidateEnvelope = Object.freeze({ ...copied.candidateEnvelope });
  assert.throws(
    () => prepareProviderConditionEvidence(copied),
    /exact repository-issued candidate envelope/,
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
    () => prepareProviderConditionEvidence(stale),
    /does not bind the current query revision/,
  );
});

test("cross-policy, incomplete evidence and floating drift fail closed", async () => {
  const policyCopy = await input({
    policy: { ...providerConditionTopTwoPolicyV1 },
  });
  assert.throws(
    () => prepareProviderConditionEvidence(policyCopy),
    /exact measured provider condition policy/,
  );

  const incomplete = await input();
  incomplete.conditionEvidence.pop();
  assert.throws(
    () => prepareProviderConditionEvidence(incomplete),
    /exactly the frozen Prime top two/,
  );

  const drift = await input();
  drift.conditionEvidence[0].secondaryScore = 0.4800001;
  assert.throws(
    () => prepareProviderConditionEvidence(drift),
    /canonical cosine score/,
  );
});

test("caller-forged quality classifications fail before routing", async () => {
  const value = await input();
  value.qualityClassification = Object.freeze({
    ...value.qualityClassification,
    qualityBucket: "face_core",
  });
  assert.throws(
    () => prepareProviderConditionEvidence(value),
    /exact face-condition classification envelope/,
  );
});

test("condition evidence is canonical and result copies cannot project", async () => {
  const firstInput = await input();
  const first = prepareProviderConditionEvidence(firstInput);
  const reversedInput = await input();
  reversedInput.conditionEvidence.reverse();
  const reversed = prepareProviderConditionEvidence(reversedInput);
  assert.equal(first.evidenceDigest, reversed.evidenceDigest);
  const result = resolveProviderConditionEvidence(first);
  assert.throws(
    () => projectProviderConditionResult(Object.freeze({ ...result })),
    /exact condition result envelope/,
  );
});
