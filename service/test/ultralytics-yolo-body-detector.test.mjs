import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  bodyDetectionDigest,
  bodyDetectorSchemaVersion,
} from "../src/body-detector-contract.mjs";
import { createUltralyticsYoloBodyDetector } from "../src/ultralytics-yolo-body-detector.mjs";

const manifest = () => {
  const core = {
    detector: {
      artifactDigest: "0".repeat(64),
      modelId: "synthetic-yolo",
      modelVersionId: "v1",
      scoreThreshold: 0.3,
    },
    execution: {
      device: "cpu",
      network: "forbidden",
      runtimeId: "synthetic-runtime",
      threads: 1,
    },
    licensing: {
      code: "declared",
      model: "unknown",
      trainingData: "unknown",
    },
    preprocessing: {
      colorSpace: "rgb",
      coordinateSpace: "normalized_image",
      inputHeight: 640,
      inputWidth: 640,
      resizeMode: "letterbox",
    },
    privacy: {
      externalUpload: "none",
      sourceMedia: "local-read-only",
    },
    provider: {
      providerId: "synthetic-yolo-provider",
      versionId: "v1",
    },
    resources: {
      maxMemoryMiB: 4096,
      maxRuntimeMs: 120000,
    },
    schemaVersion: bodyDetectorSchemaVersion,
  };
  return {
    ...core,
    detectorConfigDigest: bodyDetectionDigest(core),
  };
};

test("YOLO body adapter retains one bounded process across replay runs", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cimmich-body-resident-"));
  const manifestPath = path.join(directory, "manifest.json");
  const configuredManifest = manifest();
  await writeFile(manifestPath, JSON.stringify(configuredManifest));
  const detector = createUltralyticsYoloBodyDetector({
    manifest: configuredManifest,
    manifestPath,
    modelPath: path.join(directory, "synthetic.pt"),
    pythonPath: process.execPath,
    scriptPath: fileURLToPath(
      new URL("./fixtures/fake-resident-body-detector.mjs", import.meta.url),
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
    const first = await detector.detect(request);
    const second = await detector.detect(request);
    assert.equal(first.processRequestCount, 1);
    assert.equal(second.processRequestCount, 2);
    assert.equal(first.sourceContentDigest, request.sourceContentDigest);
    assert.equal(second.assetToken, request.assetToken);
  } finally {
    await detector.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("YOLO body adapter rejects bytes that do not match source authority", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cimmich-body-resident-"));
  const manifestPath = path.join(directory, "manifest.json");
  const configuredManifest = manifest();
  await writeFile(manifestPath, JSON.stringify(configuredManifest));
  const detector = createUltralyticsYoloBodyDetector({
    manifest: configuredManifest,
    manifestPath,
    modelPath: path.join(directory, "synthetic.pt"),
    pythonPath: process.execPath,
    scriptPath: fileURLToPath(
      new URL("./fixtures/fake-resident-body-detector.mjs", import.meta.url),
    ),
  });
  try {
    await assert.rejects(
      detector.detect({
        assetToken: "2".repeat(64),
        bytes: Buffer.from("changed"),
        inputRevision: "3".repeat(64),
        sourceContentDigest: "4".repeat(64),
      }),
      (error) => error.code === "LOCAL_BODY_DETECTOR_INPUT_INVALID",
    );
  } finally {
    await detector.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("YOLO body adapter preserves an exact unreadable-source abstention", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cimmich-body-resident-"));
  const manifestPath = path.join(directory, "manifest.json");
  const configuredManifest = manifest();
  await writeFile(manifestPath, JSON.stringify(configuredManifest));
  const detector = createUltralyticsYoloBodyDetector({
    manifest: configuredManifest,
    manifestPath,
    modelPath: path.join(directory, "synthetic.pt"),
    pythonPath: process.execPath,
    scriptPath: fileURLToPath(
      new URL("./fixtures/fake-resident-body-detector.mjs", import.meta.url),
    ),
  });
  const bytes = Buffer.from("unreadable-image");
  const request = {
    assetToken: "2".repeat(64),
    bytes,
    inputRevision: "3".repeat(64),
    sourceContentDigest: createHash("sha256").update(bytes).digest("hex"),
  };
  try {
    const result = await detector.detect(request);
    assert.deepEqual(result.bodies, []);
    assert.equal(result.state, "source_unreadable");
    assert.equal(result.sourceContentDigest, request.sourceContentDigest);
    assert.equal(result.detectorConfigDigest, configuredManifest.detectorConfigDigest);
  } finally {
    await detector.close();
    await rm(directory, { force: true, recursive: true });
  }
});
