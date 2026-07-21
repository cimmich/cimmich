import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
  bodyObjectConflictEvaluationSchemaVersion,
  bodyObjectConflictResultSchemaVersion,
  bodyObjectConflictProviderSchemaVersion,
  createBodyObjectConflictReceipt,
  deriveBodyObjectConflictManifest,
  projectValidatedBodyObjectConflicts,
  validateBodyObjectConflictEvidence,
  validateBodyObjectConflictManifest,
} from "../src/body-object-conflict-contract.mjs";
import { createLocalYoloObjectConflictProvider } from "../src/local-yolo-object-conflict-provider.mjs";

const fakeScript = fileURLToPath(
  new URL("./fixtures/fake-yolo-object-conflict-provider.mjs", import.meta.url),
);
const repeatDigest = (character) => character.repeat(64);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const imageBytes = Buffer.from("synthetic-object-conflict-image");
const sourceContentDigest = hash(imageBytes);

const bodyManifest = () => {
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

const bodyValidation = () => {
  const manifest = bodyManifest();
  return validateBodyDetectionResult(
    {
      assetToken: repeatDigest("a"),
      bodies: [
        {
          box: { h: 0.7, w: 0.4, x: 0.1, y: 0.2 },
          confidence: 0.91,
          quality: { visibility: 0.9 },
        },
      ],
      detectorConfigDigest: manifest.detectorConfigDigest,
      inputRevision: repeatDigest("b"),
      schemaVersion: bodyDetectionResultSchemaVersion,
      sourceContentDigest,
      state: "bodies_detected",
    },
    manifest,
  );
};

const objectManifest = (artifactDigest = repeatDigest("d")) =>
  deriveBodyObjectConflictManifest({
    detector: {
      artifactDigest,
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

const result = (manifest, overrides = {}) => ({
  assetToken: repeatDigest("a"),
  inputRevision: repeatDigest("b"),
  objectConfigDigest: manifest.objectConfigDigest,
  objects: [
    {
      box: { h: 0.7, w: 0.4, x: 0.1, y: 0.2 },
      category: "cat",
      confidence: 0.91,
    },
  ],
  schemaVersion: bodyObjectConflictResultSchemaVersion,
  sourceContentDigest,
  state: "objects_detected",
  ...overrides,
});

const evaluate = ({
  body = bodyValidation(),
  first,
  manifest = objectManifest(),
  second,
} = {}) =>
  validateBodyObjectConflictEvidence({
    bodyValidation: body,
    manifest,
    runs: [
      { result: first || result(manifest), runId: "run-a" },
      { result: second || result(manifest), runId: "run-b" },
    ],
    schemaVersion: bodyObjectConflictEvaluationSchemaVersion,
  });

test("exact cat/dog replay produces a minimized no-authority conflict receipt", () => {
  const envelope = evaluate();
  const receipt = createBodyObjectConflictReceipt(envelope);
  const projection = projectValidatedBodyObjectConflicts(envelope);
  assert.equal(receipt.replayEvidence, "consistent");
  assert.equal(receipt.counts.objectCount, 1);
  assert.equal(receipt.authority.activation, "none");
  assert.equal(receipt.authority.automaticIdentityAuthority, "none");
  assert.equal(receipt.boundary.databaseWrites, "none");
  assert.deepEqual(projection.objects[0], {
    box: { h: 0.7, w: 0.4, x: 0.1, y: 0.2 },
    category: "cat",
    confidence: 0.91,
  });
  assert.doesNotMatch(
    JSON.stringify(receipt),
    /assetToken|sourceContentDigest|bodyId|path|filename|person/i,
  );
});

test("replay drift abstains from object evidence and remains deterministic", () => {
  const manifest = objectManifest();
  const envelope = evaluate({
    manifest,
    second: result(manifest, { objects: [], state: "no_object" }),
  });
  const receipt = createBodyObjectConflictReceipt(envelope);
  assert.equal(receipt.replayEvidence, "drift");
  assert.equal(receipt.counts.objectCount, 0);
  assert.deepEqual(projectValidatedBodyObjectConflicts(envelope).objects, []);
});

test("copies, substitutions, unsafe fields, threshold bypass and drift fail closed", () => {
  const envelope = evaluate();
  assert.throws(() =>
    createBodyObjectConflictReceipt(Object.freeze({ ...envelope })),
  );
  assert.throws(() =>
    projectValidatedBodyObjectConflicts(Object.freeze({ ...envelope })),
  );
  const manifest = objectManifest();
  for (const substitution of [
    { assetToken: repeatDigest("e") },
    { inputRevision: repeatDigest("e") },
    { sourceContentDigest: repeatDigest("e") },
    { objectConfigDigest: repeatDigest("e") },
  ]) {
    assert.throws(() =>
      evaluate({
        first: result(manifest, substitution),
        manifest,
        second: result(manifest, substitution),
      }),
    );
  }
  assert.throws(() =>
    evaluate({
      first: result(manifest, { path: "/private/source.jpg" }),
      manifest,
    }),
  );
  assert.throws(() =>
    evaluate({
      first: result(manifest, {
        objects: [
          {
            box: { h: 0.7, w: 0.4, x: 0.1, y: 0.2 },
            category: "person",
            confidence: 0.91,
          },
        ],
      }),
      manifest,
    }),
  );
  assert.throws(() =>
    evaluate({
      first: result(manifest, {
        objects: [
          {
            box: { h: 0.7, w: 0.4, x: 0.1, y: 0.2 },
            category: "cat",
            confidence: 0.24,
          },
        ],
      }),
      manifest,
    }),
  );
  assert.throws(() =>
    validateBodyObjectConflictManifest({
      ...manifest,
      providerUrl: "https://example.com",
    }),
  );
});

test("the local adapter binds manifest/checkpoint/image and emits a contract packet", async () => {
  const root = await mkdtemp(`${tmpdir()}/cimmich-object-adapter-`);
  try {
    const modelPath = `${root}/model.bin`;
    const manifestPath = `${root}/manifest.json`;
    await writeFile(modelPath, Buffer.from("synthetic-object-model"));
    const manifest = objectManifest(
      hash(Buffer.from("synthetic-object-model")),
    );
    await writeFile(manifestPath, JSON.stringify(manifest));
    const provider = createLocalYoloObjectConflictProvider({
      manifest,
      manifestPath,
      modelPath,
      pythonPath: process.execPath,
      scriptPath: fakeScript,
      timeoutMs: 10_000,
    });
    const packet = await provider.detect({
      assetToken: repeatDigest("a"),
      bytes: imageBytes,
      inputRevision: repeatDigest("b"),
      runId: "run-a",
      sourceContentDigest,
    });
    assert.equal(packet.runId, "run-a");
    assert.equal(packet.result.objects[0].category, "cat");
    await assert.rejects(() =>
      provider.detect({
        assetToken: repeatDigest("a"),
        bytes: Buffer.from("changed"),
        inputRevision: repeatDigest("b"),
        runId: "run-b",
        sourceContentDigest,
      }),
    );
    await writeFile(modelPath, Buffer.from("changed-model"));
    await assert.rejects(() =>
      provider.detect({
        assetToken: repeatDigest("a"),
        bytes: imageBytes,
        inputRevision: repeatDigest("b"),
        runId: "run-c",
        sourceContentDigest,
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
