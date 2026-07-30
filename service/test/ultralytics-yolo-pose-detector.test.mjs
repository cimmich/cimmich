import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  bodyPoseProviderSchemaVersion,
  deriveBodyPoseManifest,
} from "../src/body-pose-provider-contract.mjs";
import { createUltralyticsYoloPoseDetector } from "../src/ultralytics-yolo-pose-detector.mjs";

const manifestFor = (artifactDigest) =>
  deriveBodyPoseManifest({
    execution: {
      device: "cpu",
      network: "forbidden",
      runtimeId: "synthetic-runtime",
      threads: 1,
    },
    licensing: { code: "declared", model: "unknown", trainingData: "unknown" },
    pose: {
      artifactDigest,
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
    provider: { providerId: "ultralytics-yolo-pose", versionId: "v1" },
    resources: { maxMemoryMiB: 4096, maxRuntimeMs: 120_000 },
    schemaVersion: bodyPoseProviderSchemaVersion,
  });

test("YOLO pose adapter retains one bounded process across replay runs", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "cimmich-pose-resident-"),
  );
  const modelPath = path.join(directory, "synthetic.pt");
  const manifestPath = path.join(directory, "manifest.json");
  await writeFile(modelPath, "synthetic-pose-model");
  const artifactDigest = createHash("sha256")
    .update("synthetic-pose-model")
    .digest("hex");
  const manifest = manifestFor(artifactDigest);
  await writeFile(manifestPath, JSON.stringify(manifest));
  const detector = createUltralyticsYoloPoseDetector({
    manifest,
    manifestPath,
    modelPath,
    pythonPath: process.execPath,
    scriptPath: fileURLToPath(
      new URL("./fixtures/fake-resident-pose-detector.mjs", import.meta.url),
    ),
  });
  const bytes = Buffer.from("synthetic-image");
  const request = {
    assetToken: "2".repeat(64),
    bytes,
    inputRevision: "3".repeat(64),
    sourceContentDigest: createHash("sha256").update(bytes).digest("hex"),
  };
  try {
    const first = await detector.detect({ ...request, runId: "pose-a" });
    const second = await detector.detect({ ...request, runId: "pose-b" });
    assert.equal(first.result.processRequestCount, 1);
    assert.equal(second.result.processRequestCount, 2);
    assert.equal(first.runId, "pose-a");
    assert.equal(second.result.poseConfigDigest, manifest.poseConfigDigest);
  } finally {
    await detector.close();
    await rm(directory, { force: true, recursive: true });
  }
});
