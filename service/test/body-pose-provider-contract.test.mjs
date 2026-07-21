import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import {
  bodyDetectionResultSchemaVersion,
  bodyDetectorSchemaVersion,
  deriveBodyDetectorConfigDigest,
  validateBodyDetectionResult,
} from "../src/body-detector-contract.mjs";
import {
  bodyPoseEvaluationSchemaVersion,
  bodyPoseProviderSchemaVersion,
  bodyPoseResultSchemaVersion,
  createBodyPoseReceipt,
  deriveBodyPoseManifest,
  projectValidatedBodyPoseForRepository,
  validateBodyPoseEvidence,
} from "../src/body-pose-provider-contract.mjs";
import { createLocalYoloPoseProvider } from "../src/local-yolo-pose-provider.mjs";

const fakeScript = fileURLToPath(
  new URL("./fixtures/fake-yolo-pose-provider.mjs", import.meta.url),
);
const digest = (character) => character.repeat(64);
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

const bodyValidation = ({ bodies } = {}) => {
  const manifest = detectorManifest();
  return validateBodyDetectionResult(
    {
      assetToken: digest("a"),
      bodies: bodies || [
        {
          box: { h: 0.8, w: 0.4, x: 0.1, y: 0.1 },
          confidence: 0.9,
          quality: { visibility: 0.9 },
        },
      ],
      detectorConfigDigest: manifest.detectorConfigDigest,
      inputRevision: digest("b"),
      schemaVersion: bodyDetectionResultSchemaVersion,
      sourceContentDigest: digest("c"),
      state: "bodies_detected",
    },
    manifest,
  );
};

const poseManifest = (artifactDigest = digest("d")) =>
  deriveBodyPoseManifest({
    execution: {
      device: "cpu",
      network: "forbidden",
      runtimeId: "ultralytics-8.4.92",
      threads: 1,
    },
    licensing: { code: "declared", model: "unknown", trainingData: "unknown" },
    pose: {
      artifactDigest,
      jointSchema: "coco17",
      keypointThreshold: 0.2,
      modelId: "yolo11x-pose",
      modelVersionId: "operator-supplied",
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
    provider: { providerId: "ultralytics-yolo-pose", versionId: "v1" },
    resources: { maxMemoryMiB: 16_384, maxRuntimeMs: 120_000 },
    schemaVersion: bodyPoseProviderSchemaVersion,
  });

const keypoints = () =>
  joints.map((joint, index) => ({
    confidence: 0.8,
    joint,
    x: Number((0.2 + index * 0.01).toFixed(6)),
    y: Number((0.2 + index * 0.01).toFixed(6)),
  }));

const poseResult = (manifest, overrides = {}) => ({
  assetToken: digest("a"),
  detections: [
    {
      box: { h: 0.8, w: 0.4, x: 0.1, y: 0.1 },
      confidence: 0.9,
      keypoints: keypoints(),
    },
  ],
  inputRevision: digest("b"),
  poseConfigDigest: manifest.poseConfigDigest,
  schemaVersion: bodyPoseResultSchemaVersion,
  sourceContentDigest: digest("c"),
  state: "poses_detected",
  ...overrides,
});

const evaluate = ({
  body = bodyValidation(),
  first,
  manifest = poseManifest(),
  second,
} = {}) =>
  validateBodyPoseEvidence({
    bodyValidation: body,
    manifest,
    policy: { alternativeMargin: 0.1, minimumIou: 0.5 },
    runs: [
      { result: first || poseResult(manifest), runId: "run-a" },
      { result: second || poseResult(manifest), runId: "run-b" },
    ],
    schemaVersion: bodyPoseEvaluationSchemaVersion,
  });

test("replay-consistent pose uniquely enriches an already-validated Body", () => {
  const envelope = evaluate();
  const receipt = createBodyPoseReceipt(envelope);
  const projection = projectValidatedBodyPoseForRepository(envelope);
  assert.equal(receipt.decision.status, "pose_evidence_validated");
  assert.equal(receipt.counts.supportedPoseCount, 1);
  assert.equal(projection.items.length, 1);
  assert.equal(projection.items[0].keypoints.length, 17);
  assert.equal(projection.items[0].state, "valid");
  assert.equal(receipt.authority.automaticIdentityAuthority, "none");
  assert.equal(receipt.boundary.databaseWrites, "none");
  assert.doesNotMatch(
    JSON.stringify(receipt),
    /assetToken|bodyId|sourceContent/,
  );
});

test("weak, symmetric and replay-drift pose evidence abstains", () => {
  const manifest = poseManifest();
  const sparseKeypoints = keypoints().map((item, index) => ({
    ...item,
    confidence: index < 6 ? item.confidence : 0.1,
  }));
  const sparseResult = poseResult(manifest, {
    detections: [
      {
        box: { h: 0.8, w: 0.4, x: 0.1, y: 0.1 },
        confidence: 0.9,
        keypoints: sparseKeypoints,
      },
    ],
  });
  const sparse = evaluate({
    first: sparseResult,
    manifest,
    second: sparseResult,
  });
  assert.equal(createBodyPoseReceipt(sparse).counts.supportedPoseCount, 0);
  assert.equal(
    createBodyPoseReceipt(sparse).counts.qualityRejectedPoseCount,
    1,
  );

  const weak = evaluate({
    first: poseResult(manifest, {
      detections: [
        {
          box: { h: 0.1, w: 0.1, x: 0.8, y: 0.8 },
          confidence: 0.9,
          keypoints: keypoints(),
        },
      ],
    }),
    manifest,
    second: poseResult(manifest, {
      detections: [
        {
          box: { h: 0.1, w: 0.1, x: 0.8, y: 0.8 },
          confidence: 0.9,
          keypoints: keypoints(),
        },
      ],
    }),
  });
  assert.equal(createBodyPoseReceipt(weak).counts.supportedPoseCount, 0);

  const symmetricBody = bodyValidation({
    bodies: [
      {
        box: { h: 0.8, w: 0.4, x: 0.1, y: 0.1 },
        confidence: 0.9,
        quality: { visibility: 0.9 },
      },
      {
        box: { h: 0.8, w: 0.4, x: 0.3, y: 0.1 },
        confidence: 0.9,
        quality: { visibility: 0.9 },
      },
    ],
  });
  const symmetricResult = poseResult(manifest, {
    detections: [
      {
        box: { h: 0.8, w: 0.4, x: 0.2, y: 0.1 },
        confidence: 0.9,
        keypoints: keypoints(),
      },
    ],
  });
  const symmetric = evaluate({
    body: symmetricBody,
    first: symmetricResult,
    manifest,
    second: symmetricResult,
  });
  assert.equal(createBodyPoseReceipt(symmetric).counts.supportedPoseCount, 0);

  const drift = evaluate({
    manifest,
    second: poseResult(manifest, { detections: [], state: "no_pose" }),
  });
  assert.equal(
    createBodyPoseReceipt(drift).decision.status,
    "pose_replay_drift",
  );
  assert.throws(() => projectValidatedBodyPoseForRepository(drift));
});

test("copy, cross-input, unknown fields and non-canonical precision fail closed", () => {
  const envelope = evaluate();
  assert.throws(() => createBodyPoseReceipt(Object.freeze({ ...envelope })));
  const manifest = poseManifest();
  for (const substitution of [
    { assetToken: digest("e") },
    { inputRevision: digest("e") },
    { sourceContentDigest: digest("e") },
  ]) {
    assert.throws(() =>
      evaluate({
        first: poseResult(manifest, substitution),
        manifest,
        second: poseResult(manifest, substitution),
      }),
    );
  }
  assert.throws(() =>
    evaluate({
      first: { ...poseResult(manifest), imagePath: "/private/media.jpg" },
      manifest,
    }),
  );
  assert.throws(() =>
    evaluate({
      first: poseResult(manifest, {
        detections: [
          {
            box: { h: 0.8, w: 0.4, x: 0.1000001, y: 0.1 },
            confidence: 0.9,
            keypoints: keypoints(),
          },
        ],
      }),
      manifest,
    }),
  );
});

test("local process adapter transfers media in memory and preserves bindings", async () => {
  const directory = await mkdtemp(`${tmpdir()}/cimmich-pose-provider-`);
  try {
    const modelPath = `${directory}/pose.pt`;
    const manifestPath = `${directory}/manifest.json`;
    await writeFile(modelPath, "synthetic-pose-model");
    const artifactDigest = createHash("sha256")
      .update(await readFile(modelPath))
      .digest("hex");
    const manifest = poseManifest(artifactDigest);
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
    const provider = createLocalYoloPoseProvider({
      manifest,
      manifestPath,
      modelPath,
      pythonPath: process.execPath,
      scriptPath: fakeScript,
      timeoutMs: 5000,
    });
    const bytes = Buffer.from("encoded-image");
    const sourceContentDigest = createHash("sha256")
      .update(bytes)
      .digest("hex");
    const run = await provider.detect({
      assetToken: digest("a"),
      bytes,
      inputRevision: digest("b"),
      runId: "run-a",
      sourceContentDigest,
    });
    assert.equal(run.runId, "run-a");
    assert.equal(run.result.sourceContentDigest, sourceContentDigest);
    assert.equal(run.result.detections.length, 1);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
