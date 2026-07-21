import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyFaceCondition,
  faceConditionClassifierSchemaVersion,
  projectValidatedFaceConditionClassification,
  waveOneFaceConditionPolicyV1,
} from "../src/face-condition-classifier.mjs";

const digest = (character) => character.repeat(64);
const input = (observation, overrides = {}) => ({
  observation,
  policy: waveOneFaceConditionPolicyV1,
  queryRevisionDigest: digest("a"),
  schemaVersion: faceConditionClassifierSchemaVersion,
  ...overrides,
});

test("measured quality policy separates core, variant, hard and noise", () => {
  const fixtures = [
    [
      {
        detectionConfidence: 0.9,
        faceAreaRatio: 0.004,
        frontalScore: 0.8,
        qualityScore: 0.82,
      },
      "face_core",
    ],
    [
      {
        detectionConfidence: 0.8,
        faceAreaRatio: 0.0015,
        frontalScore: 0.4,
        qualityScore: 0.55,
      },
      "face_variant",
    ],
    [
      {
        detectionConfidence: 0.7,
        faceAreaRatio: 0.0008,
        frontalScore: 0.2,
        qualityScore: 0.35,
      },
      "face_hard",
    ],
    [
      {
        detectionConfidence: 0.2,
        faceAreaRatio: 0.003,
        frontalScore: 0.9,
        qualityScore: 0.9,
      },
      "reject_noise",
    ],
  ];
  for (const [observation, expected] of fixtures) {
    const result = classifyFaceCondition(input(observation));
    assert.equal(result.qualityBucket, expected);
    assert.equal(result.authority.automaticIdentityAuthority, "none");
    assert.equal(projectValidatedFaceConditionClassification(result), result);
  }
});

test("missing quality evidence is unknown rather than caller-guessed", () => {
  const result = classifyFaceCondition(
    input({
      detectionConfidence: null,
      faceAreaRatio: 0.003,
      frontalScore: null,
      qualityScore: null,
    }),
  );
  assert.equal(result.qualityBucket, "unknown");
  assert.equal(result.reason, "QUALITY_EVIDENCE_INCOMPLETE");
});

test("policy copies, floating drift and copied results fail closed", () => {
  const observation = {
    detectionConfidence: 0.9,
    faceAreaRatio: 0.003,
    frontalScore: 0.8,
    qualityScore: 0.8,
  };
  assert.throws(
    () =>
      classifyFaceCondition(
        input(observation, { policy: { ...waveOneFaceConditionPolicyV1 } }),
      ),
    /exact measured face-condition policy/,
  );
  assert.throws(
    () =>
      classifyFaceCondition(input({ ...observation, frontalScore: 0.8000001 })),
    /canonical unit-interval score/,
  );
  const result = classifyFaceCondition(input(observation));
  assert.throws(
    () =>
      projectValidatedFaceConditionClassification(Object.freeze({ ...result })),
    /exact face-condition classification envelope/,
  );
});
