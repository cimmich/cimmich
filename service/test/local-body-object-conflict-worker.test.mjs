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
  bodyObjectConflictProviderSchemaVersion,
  bodyObjectConflictResultSchemaVersion,
  deriveBodyObjectConflictManifest,
} from "../src/body-object-conflict-contract.mjs";
import {
  consumeLocalBodyObjectConflictValidation,
  createLocalBodyObjectConflictWorkerReceipt,
  executeLocalBodyObjectConflictJob,
  prepareLocalBodyObjectConflictJob,
  projectLocalBodyObjectConflicts,
} from "../src/local-body-object-conflict-worker.mjs";

const repeatDigest = (character) => character.repeat(64);
const assetId = "asset_object_conflict_fixture";
const imageBytes = Buffer.from("encoded-object-conflict-fixture");
const sourceContentDigest = createHash("sha256")
  .update(imageBytes)
  .digest("hex");

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

const createBodyValidation = () => {
  const manifest = detectorManifest();
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

const providerFor = (manifest, { drift = false, calls = [] } = {}) => ({
  detect: async (request) => {
    calls.push(request.runId);
    const noObject = drift && request.runId.startsWith("run-2-");
    return {
      result: {
        assetToken: request.assetToken,
        inputRevision: request.inputRevision,
        objectConfigDigest: manifest.objectConfigDigest,
        objects: noObject
          ? []
          : [
              {
                box: { h: 0.7, w: 0.4, x: 0.1, y: 0.2 },
                category: "cat",
                confidence: 0.91,
              },
            ],
        schemaVersion: bodyObjectConflictResultSchemaVersion,
        sourceContentDigest: request.sourceContentDigest,
        state: noObject ? "no_object" : "objects_detected",
      },
      runId: request.runId,
    };
  },
  manifest,
});

const companionFor = ({
  currentRevision = repeatDigest("b"),
  readRevision = repeatDigest("b"),
} = {}) => ({
  getAsset: async () => ({
    asset: { immichAssetId: assetId, inputRevision: currentRevision },
  }),
  readAssetImage: async () => ({
    asset: { immichAssetId: assetId, inputRevision: readRevision },
    bytes: imageBytes,
    contentDigest: sourceContentDigest,
    sourceAccess: "operator-local-read-only",
  }),
});

const prepare = (manifest = objectManifest()) =>
  prepareLocalBodyObjectConflictJob({
    assetId,
    bodyValidation: createBodyValidation(),
    manifest,
    projection: { assetId, inputRevision: repeatDigest("b") },
  });

test("worker performs two bound reads and exposes exact resolver evidence", async () => {
  const manifest = objectManifest();
  const calls = [];
  const execution = await executeLocalBodyObjectConflictJob({
    companion: companionFor(),
    prepared: prepare(manifest),
    provider: providerFor(manifest, { calls }),
  });
  const receipt = createLocalBodyObjectConflictWorkerReceipt(execution);
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0], calls[1]);
  assert.equal(receipt.disposition, "object_conflicts_validated");
  assert.equal(receipt.boundary.providerProcessInvocations, 2);
  assert.equal(receipt.boundary.mediaRead, "operator-local-read-only");
  assert.equal(receipt.authority.databaseWrite, "none");
  assert.equal(projectLocalBodyObjectConflicts(execution).objects.length, 1);
  assert.equal(
    createLocalBodyObjectConflictWorkerReceipt(execution).receiptDigest,
    receipt.receiptDigest,
  );
  assert.ok(consumeLocalBodyObjectConflictValidation(execution));
  assert.doesNotMatch(
    JSON.stringify(receipt),
    /asset_object|bodyId|sourceContent|filename|person/i,
  );
});

test("copied jobs/executions, stale revisions and source drift fail closed", async () => {
  const manifest = objectManifest();
  const prepared = prepare(manifest);
  await assert.rejects(() =>
    executeLocalBodyObjectConflictJob({
      companion: companionFor(),
      prepared: Object.freeze({ ...prepared }),
      provider: providerFor(manifest),
    }),
  );
  await assert.rejects(() =>
    executeLocalBodyObjectConflictJob({
      companion: companionFor({ readRevision: repeatDigest("c") }),
      prepared,
      provider: providerFor(manifest),
    }),
  );
  await assert.rejects(() =>
    executeLocalBodyObjectConflictJob({
      companion: companionFor({ currentRevision: repeatDigest("c") }),
      prepared,
      provider: providerFor(manifest),
    }),
  );
  const wrongBytes = companionFor();
  wrongBytes.readAssetImage = async () => ({
    asset: { immichAssetId: assetId, inputRevision: repeatDigest("b") },
    bytes: Buffer.from("other-image"),
    contentDigest: sourceContentDigest,
    sourceAccess: "operator-local-read-only",
  });
  await assert.rejects(() =>
    executeLocalBodyObjectConflictJob({
      companion: wrongBytes,
      prepared,
      provider: providerFor(manifest),
    }),
  );
  const execution = await executeLocalBodyObjectConflictJob({
    companion: companionFor(),
    prepared,
    provider: providerFor(manifest),
  });
  const copy = Object.freeze({ ...execution });
  assert.throws(() => createLocalBodyObjectConflictWorkerReceipt(copy));
  assert.throws(() => consumeLocalBodyObjectConflictValidation(copy));
});

test("replay drift remains receiptable but cannot feed repository or resolver", async () => {
  const manifest = objectManifest();
  const execution = await executeLocalBodyObjectConflictJob({
    companion: companionFor(),
    prepared: prepare(manifest),
    provider: providerFor(manifest, { drift: true }),
  });
  assert.equal(
    createLocalBodyObjectConflictWorkerReceipt(execution).disposition,
    "replay_drift",
  );
  assert.throws(() => projectLocalBodyObjectConflicts(execution));
  assert.ok(consumeLocalBodyObjectConflictValidation(execution));
});
