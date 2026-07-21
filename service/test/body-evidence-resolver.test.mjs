import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  bodyDetectionResultSchemaVersion,
  bodyDetectorSchemaVersion,
  deriveBodyDetectorConfigDigest,
  validateBodyDetectionResult,
} from "../src/body-detector-contract.mjs";
import {
  bodyEvidenceResolutionSchemaVersion,
  createBodyEvidenceResolutionReceipt,
  projectValidatedBodyEvidenceResolution,
  resolveBodyEvidence,
} from "../src/body-evidence-resolver.mjs";
import {
  bodyObjectConflictEvaluationSchemaVersion,
  bodyObjectConflictProviderSchemaVersion,
  bodyObjectConflictResultSchemaVersion,
  deriveBodyObjectConflictManifest,
  validateBodyObjectConflictEvidence,
} from "../src/body-object-conflict-contract.mjs";
import {
  bodyPoseEvaluationSchemaVersion,
  bodyPoseProviderSchemaVersion,
  bodyPoseResultSchemaVersion,
  deriveBodyPoseManifest,
  validateBodyPoseEvidence,
} from "../src/body-pose-provider-contract.mjs";

const repeatDigest = (character) => character.repeat(64);
const sourceContentDigest = createHash("sha256")
  .update("resolver-fixture")
  .digest("hex");
const joints = [
  "nose",
  "left_eye",
  "right_eye",
  "left_ear",
  "right_ear",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
];
const bodyBoxes = [
  { h: 0.8, w: 0.15, x: 0.05, y: 0.1 },
  { h: 0.8, w: 0.15, x: 0.3, y: 0.1 },
  { h: 0.8, w: 0.15, x: 0.55, y: 0.1 },
  { h: 0.8, w: 0.15, x: 0.8, y: 0.1 },
];

const detectorManifest = () => {
  const core = {
    detector: {
      artifactDigest: repeatDigest("1"),
      modelId: "synthetic-body",
      modelVersionId: "v1",
      scoreThreshold: 0.3,
    },
    execution: {
      device: "cpu",
      network: "forbidden",
      runtimeId: "synthetic-runtime",
      threads: 1,
    },
    licensing: { code: "declared", model: "unknown", trainingData: "unknown" },
    preprocessing: {
      colorSpace: "rgb",
      coordinateSpace: "normalized_image",
      inputHeight: 640,
      inputWidth: 640,
      resizeMode: "letterbox",
    },
    privacy: { externalUpload: "none", sourceMedia: "local-read-only" },
    provider: { providerId: "synthetic-body", versionId: "v1" },
    resources: { maxMemoryMiB: 1024, maxRuntimeMs: 30_000 },
    schemaVersion: bodyDetectorSchemaVersion,
  };
  return {
    ...core,
    detectorConfigDigest: deriveBodyDetectorConfigDigest(core),
  };
};

const bodyValidation = ({ source = sourceContentDigest } = {}) => {
  const manifest = detectorManifest();
  return validateBodyDetectionResult(
    {
      assetToken: repeatDigest("a"),
      bodies: bodyBoxes.map((box, index) => ({
        box,
        confidence: [0.9, 0.8, 0.95, 0.5][index],
        quality: { visibility: 0.9 },
      })),
      detectorConfigDigest: manifest.detectorConfigDigest,
      inputRevision: repeatDigest("b"),
      schemaVersion: bodyDetectionResultSchemaVersion,
      sourceContentDigest: source,
      state: "bodies_detected",
    },
    manifest,
  );
};

const poseManifest = () =>
  deriveBodyPoseManifest({
    execution: {
      device: "cpu",
      network: "forbidden",
      runtimeId: "synthetic-runtime",
      threads: 1,
    },
    licensing: { code: "declared", model: "unknown", trainingData: "unknown" },
    pose: {
      artifactDigest: repeatDigest("f"),
      jointSchema: "coco17",
      keypointThreshold: 0.2,
      modelId: "synthetic-pose",
      modelVersionId: "v1",
      scoreThreshold: 0.2,
      topologyId: "coco17.v1",
    },
    preprocessing: {
      colorSpace: "rgb",
      coordinateSpace: "normalized_image",
      inputHeight: 640,
      inputWidth: 640,
      resizeMode: "letterbox",
    },
    privacy: { externalUpload: "none", sourceMedia: "local-read-only" },
    provider: { providerId: "synthetic-pose", versionId: "v1" },
    resources: { maxMemoryMiB: 1024, maxRuntimeMs: 30_000 },
    schemaVersion: bodyPoseProviderSchemaVersion,
  });

const keypoints = () =>
  joints.map((joint, index) => ({
    confidence: 0.8,
    joint,
    x: Number((0.06 + index * 0.005).toFixed(6)),
    y: Number((0.15 + index * 0.02).toFixed(6)),
  }));

const poseValidation = (body = bodyValidation()) => {
  const manifest = poseManifest();
  const result = {
    assetToken: repeatDigest("a"),
    detections: [
      {
        box: bodyBoxes[0],
        confidence: 0.9,
        keypoints: keypoints(),
      },
    ],
    inputRevision: repeatDigest("b"),
    poseConfigDigest: manifest.poseConfigDigest,
    schemaVersion: bodyPoseResultSchemaVersion,
    sourceContentDigest,
    state: "poses_detected",
  };
  return validateBodyPoseEvidence({
    bodyValidation: body,
    manifest,
    policy: { alternativeMargin: 0.1, minimumIou: 0.5 },
    runs: [
      { result, runId: "pose-a" },
      { result, runId: "pose-b" },
    ],
    schemaVersion: bodyPoseEvaluationSchemaVersion,
  });
};

const objectManifest = () =>
  deriveBodyObjectConflictManifest({
    detector: {
      artifactDigest: repeatDigest("d"),
      classes: ["cat", "dog"],
      modelId: "synthetic-objects",
      modelVersionId: "v1",
      scoreThreshold: 0.25,
    },
    execution: {
      device: "cpu",
      network: "forbidden",
      runtimeId: "synthetic-runtime",
      threads: 1,
    },
    licensing: { code: "declared", model: "unknown", trainingData: "unknown" },
    preprocessing: {
      colorSpace: "rgb",
      coordinateSpace: "normalized_image",
      inputHeight: 640,
      inputWidth: 640,
      resizeMode: "letterbox",
    },
    privacy: { externalUpload: "none", sourceMedia: "local-read-only" },
    provider: { providerId: "synthetic-objects", versionId: "v1" },
    resources: { maxMemoryMiB: 1024, maxRuntimeMs: 30_000 },
    schemaVersion: bodyObjectConflictProviderSchemaVersion,
  });

const conflictValidation = ({
  body = bodyValidation(),
  box = bodyBoxes[1],
  drift = false,
} = {}) => {
  const manifest = objectManifest();
  const detected = {
    assetToken: repeatDigest("a"),
    inputRevision: repeatDigest("b"),
    objectConfigDigest: manifest.objectConfigDigest,
    objects: [{ box, category: "cat", confidence: 0.91 }],
    schemaVersion: bodyObjectConflictResultSchemaVersion,
    sourceContentDigest,
    state: "objects_detected",
  };
  const absent = { ...detected, objects: [], state: "no_object" };
  return validateBodyObjectConflictEvidence({
    bodyValidation: body,
    manifest,
    runs: [
      { result: detected, runId: "object-a" },
      { result: drift ? absent : detected, runId: "object-b" },
    ],
    schemaVersion: bodyObjectConflictEvaluationSchemaVersion,
  });
};

const noObjectConflictValidation = (body = bodyValidation()) => {
  const manifest = objectManifest();
  const result = {
    assetToken: repeatDigest("a"),
    inputRevision: repeatDigest("b"),
    objectConfigDigest: manifest.objectConfigDigest,
    objects: [],
    schemaVersion: bodyObjectConflictResultSchemaVersion,
    sourceContentDigest,
    state: "no_object",
  };
  return validateBodyObjectConflictEvidence({
    bodyValidation: body,
    manifest,
    runs: [
      { result, runId: "object-a" },
      { result, runId: "object-b" },
    ],
    schemaVersion: bodyObjectConflictEvaluationSchemaVersion,
  });
};

const policy = {
  objectConflictMinimumBodyCoverage: 0.8,
  objectConflictMinimumScore: 0.25,
  unposedConfirmationScore: 0.9,
};

const resolve = ({
  body = bodyValidation(),
  conflict,
  pose,
  selectedPolicy = policy,
} = {}) =>
  resolveBodyEvidence({
    bodyValidation: body,
    conflictValidation:
      conflict === undefined ? conflictValidation({ body }) : conflict,
    policy: selectedPolicy,
    poseValidation: pose === undefined ? poseValidation(body) : pose,
    schemaVersion: bodyEvidenceResolutionSchemaVersion,
  });

test("pose, pet conflict and unresolved object evidence produce a conservative tri-state result", () => {
  const envelope = resolve();
  const projection = projectValidatedBodyEvidenceResolution(envelope);
  const byScore = new Map(
    projection.items.map((item) => [item.detectorConfidence, item]),
  );
  assert.deepEqual(
    [byScore.get(0.9).status, byScore.get(0.9).reason],
    ["confirmed", "POSE_SUPPORTED"],
  );
  assert.deepEqual(
    [byScore.get(0.8).status, byScore.get(0.8).reason],
    ["suppressed", "PET_OBJECT_CONFLICT"],
  );
  assert.deepEqual(
    [byScore.get(0.95).status, byScore.get(0.95).reason],
    ["candidate", "OBJECT_CONFLICT_UNRESOLVED"],
  );
  assert.deepEqual(
    [byScore.get(0.5).status, byScore.get(0.5).reason],
    ["candidate", "OBJECT_CONFLICT_UNRESOLVED"],
  );
  const receipt = createBodyEvidenceResolutionReceipt(envelope);
  assert.deepEqual(receipt.counts, {
    candidate: 2,
    confirmed: 1,
    suppressed: 1,
    total: 4,
  });
  assert.equal(receipt.authority.automaticIdentityAuthority, "none");
  assert.equal(receipt.boundary.persistence, "none");
  assert.doesNotMatch(
    JSON.stringify(receipt),
    /bodyId|assetToken|person|filename/i,
  );
});

test("high-confidence unposed Body confirms only after replay-consistent no-object evidence", () => {
  const body = bodyValidation();
  const envelope = resolve({
    body,
    conflict: noObjectConflictValidation(body),
    pose: null,
  });
  const byScore = new Map(
    projectValidatedBodyEvidenceResolution(envelope).items.map((item) => [
      item.detectorConfidence,
      item,
    ]),
  );
  assert.deepEqual(
    [byScore.get(0.95).status, byScore.get(0.95).reason],
    ["confirmed", "HIGH_CONFIDENCE_NO_OBJECT_CONFLICT"],
  );
  assert.deepEqual(
    [byScore.get(0.8).status, byScore.get(0.8).reason],
    ["candidate", "DETECTOR_ONLY"],
  );
});

test("missing or drifting object evidence cannot suppress or confirm an unposed body", () => {
  for (const conflict of [null, conflictValidation({ drift: true })]) {
    const envelope = resolve({ conflict });
    const items = projectValidatedBodyEvidenceResolution(envelope).items;
    for (const score of [0.8, 0.95, 0.5]) {
      const item = items.find(
        (candidate) => candidate.detectorConfidence === score,
      );
      assert.equal(item.status, "candidate");
      assert.equal(item.reason, "OBJECT_CONFLICT_EVIDENCE_UNAVAILABLE");
    }
  }
});

test("contradictory pose and pet evidence abstains instead of manufacturing truth", () => {
  const body = bodyValidation();
  const envelope = resolve({
    body,
    conflict: conflictValidation({ body, box: bodyBoxes[0] }),
    pose: poseValidation(body),
  });
  const item = projectValidatedBodyEvidenceResolution(envelope).items.find(
    (candidate) => candidate.detectorConfidence === 0.9,
  );
  assert.deepEqual(
    [item.status, item.reason],
    ["candidate", "POSE_OBJECT_CONFLICT"],
  );
});

test("cross-input evidence, copied envelopes and policy drift fail closed", () => {
  const envelope = resolve();
  assert.throws(() =>
    createBodyEvidenceResolutionReceipt(Object.freeze({ ...envelope })),
  );
  assert.throws(() =>
    projectValidatedBodyEvidenceResolution(Object.freeze({ ...envelope })),
  );
  const body = bodyValidation();
  const otherBody = bodyValidation({ source: repeatDigest("e") });
  assert.throws(() =>
    resolve({ body, conflict: conflictValidation({ body: otherBody }) }),
  );
  for (const selectedPolicy of [
    { ...policy, extra: true },
    { ...policy, unposedConfirmationScore: 0.9000001 },
    { ...policy, objectConflictMinimumScore: 0 },
  ]) {
    assert.throws(() => resolve({ selectedPolicy }));
  }
});
