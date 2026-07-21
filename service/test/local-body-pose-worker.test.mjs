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
  bodyPoseProviderSchemaVersion,
  bodyPoseResultSchemaVersion,
  deriveBodyPoseManifest,
} from "../src/body-pose-provider-contract.mjs";
import {
  consumeLocalBodyPoseValidation,
  createLocalBodyPoseWorkerReceipt,
  executeLocalBodyPoseJob,
  prepareLocalBodyPoseJob,
  projectLocalBodyPoseForRepository,
} from "../src/local-body-pose-worker.mjs";

const digest = (character) => character.repeat(64);
const assetId = "asset_pose_fixture";
const imageBytes = Buffer.from("encoded-body-pose-fixture");
const sourceContentDigest = createHash("sha256")
  .update(imageBytes)
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

const detectorManifest = () => {
  const core = {
    detector: {
      artifactDigest: digest("1"),
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

const createBodyValidation = () => {
  const manifest = detectorManifest();
  return validateBodyDetectionResult(
    {
      assetToken: digest("a"),
      bodies: [
        {
          box: { h: 0.8, w: 0.4, x: 0.1, y: 0.1 },
          confidence: 0.9,
          quality: { visibility: 0.9 },
        },
      ],
      detectorConfigDigest: manifest.detectorConfigDigest,
      inputRevision: digest("b"),
      schemaVersion: bodyDetectionResultSchemaVersion,
      sourceContentDigest,
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
      artifactDigest: digest("d"),
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
    x: Number((0.2 + index * 0.01).toFixed(6)),
    y: Number((0.2 + index * 0.01).toFixed(6)),
  }));

const providerFor = (manifest, { drift = false } = {}) => ({
  detect: async (request) => ({
    result: {
      assetToken: request.assetToken,
      detections:
        drift && request.runId.startsWith("run-2-")
          ? []
          : [
              {
                box: { h: 0.8, w: 0.4, x: 0.1, y: 0.1 },
                confidence: 0.9,
                keypoints: keypoints(),
              },
            ],
      inputRevision: request.inputRevision,
      poseConfigDigest: manifest.poseConfigDigest,
      schemaVersion: bodyPoseResultSchemaVersion,
      sourceContentDigest: request.sourceContentDigest,
      state:
        drift && request.runId.startsWith("run-2-")
          ? "no_pose"
          : "poses_detected",
    },
    runId: request.runId,
  }),
  manifest,
});

const companionFor = ({
  currentRevision = digest("b"),
  readRevision = digest("b"),
} = {}) => ({
  getAsset: async () => ({
    asset: { immichAssetId: assetId, inputRevision: currentRevision },
  }),
  readAssetImage: async () => ({
    asset: { immichAssetId: assetId, inputRevision: readRevision },
    bytes: imageBytes,
    contentDigest: sourceContentDigest,
    sourceAccess: "immich-api-read-only",
  }),
});

const prepare = (manifest = poseManifest()) =>
  prepareLocalBodyPoseJob({
    assetId,
    bodyValidation: createBodyValidation(),
    manifest,
    projection: { assetId, inputRevision: digest("b") },
  });

test("worker executes two bound runs and exposes an exact no-write projection", async () => {
  const manifest = poseManifest();
  const execution = await executeLocalBodyPoseJob({
    companion: companionFor(),
    policy: { alternativeMargin: 0.1, minimumIou: 0.5 },
    prepared: prepare(manifest),
    provider: providerFor(manifest),
  });
  const receipt = createLocalBodyPoseWorkerReceipt(execution);
  const projection = projectLocalBodyPoseForRepository(execution);
  assert.equal(receipt.disposition, "pose_evidence_validated");
  assert.equal(receipt.boundary.providerProcessInvocations, 2);
  assert.equal(receipt.boundary.mediaRead, "immich-api-read-only");
  assert.equal(receipt.authority.databaseWrite, "none");
  assert.equal(projection.items.length, 1);
  assert.equal(projection.items[0].keypoints.length, 17);
  assert.ok(consumeLocalBodyPoseValidation(execution));
  assert.doesNotMatch(
    JSON.stringify(receipt),
    /asset_pose|bodyId|sourceContent/,
  );
});

test("copied jobs/executions, stale revisions and source drift fail closed", async () => {
  const manifest = poseManifest();
  const prepared = prepare(manifest);
  await assert.rejects(() =>
    executeLocalBodyPoseJob({
      companion: companionFor(),
      policy: { alternativeMargin: 0.1, minimumIou: 0.5 },
      prepared: Object.freeze({ ...prepared }),
      provider: providerFor(manifest),
    }),
  );
  await assert.rejects(() =>
    executeLocalBodyPoseJob({
      companion: companionFor({ readRevision: digest("c") }),
      policy: { alternativeMargin: 0.1, minimumIou: 0.5 },
      prepared,
      provider: providerFor(manifest),
    }),
  );
  await assert.rejects(() =>
    executeLocalBodyPoseJob({
      companion: companionFor({ currentRevision: digest("c") }),
      policy: { alternativeMargin: 0.1, minimumIou: 0.5 },
      prepared,
      provider: providerFor(manifest),
    }),
  );
  const wrongBytesCompanion = companionFor();
  wrongBytesCompanion.readAssetImage = async () => ({
    asset: { immichAssetId: assetId, inputRevision: digest("b") },
    bytes: Buffer.from("other-image"),
    contentDigest: sourceContentDigest,
    sourceAccess: "immich-api-read-only",
  });
  await assert.rejects(() =>
    executeLocalBodyPoseJob({
      companion: wrongBytesCompanion,
      policy: { alternativeMargin: 0.1, minimumIou: 0.5 },
      prepared,
      provider: providerFor(manifest),
    }),
  );
  const execution = await executeLocalBodyPoseJob({
    companion: companionFor(),
    policy: { alternativeMargin: 0.1, minimumIou: 0.5 },
    prepared,
    provider: providerFor(manifest),
  });
  assert.throws(() =>
    createLocalBodyPoseWorkerReceipt(Object.freeze({ ...execution })),
  );
  assert.throws(() =>
    consumeLocalBodyPoseValidation(Object.freeze({ ...execution })),
  );
});

test("replay drift yields a receipt but cannot project repository evidence", async () => {
  const manifest = poseManifest();
  const execution = await executeLocalBodyPoseJob({
    companion: companionFor(),
    policy: { alternativeMargin: 0.1, minimumIou: 0.5 },
    prepared: prepare(manifest),
    provider: providerFor(manifest, { drift: true }),
  });
  assert.equal(
    createLocalBodyPoseWorkerReceipt(execution).disposition,
    "pose_replay_drift",
  );
  assert.throws(() => projectLocalBodyPoseForRepository(execution));
});
