import assert from "node:assert/strict";
import test from "node:test";
import {
  bodyDetectionResultSchemaVersion,
  bodyDetectorSchemaVersion,
  deriveBodyDetectorConfigDigest,
  projectValidatedBodyResultForRepository,
} from "../src/body-detector-contract.mjs";
import { deriveRepositoryBodyAssetToken } from "../src/body-detection-result-repository.mjs";
import {
  assembleLocalBodyDetectionResult,
  localBodyDetectionWorkerVersion,
  prepareLocalBodyDetectionJob,
  prepareLocalBodyDetectionJobFromSourceRead,
} from "../src/local-body-detection-worker.mjs";
import {
  completeAssetSourceRead,
  createAssetSourceRevisionRepository,
} from "../src/asset-source-revision.mjs";

const digest = (character) => character.repeat(64);

const manifest = () => {
  const core = {
    detector: {
      artifactDigest: digest("a"),
      modelId: "synthetic-body-detector",
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
    provider: { providerId: "synthetic-provider", versionId: "v1" },
    resources: { maxMemoryMiB: 1024, maxRuntimeMs: 30_000 },
    schemaVersion: bodyDetectorSchemaVersion,
  };
  return {
    ...core,
    detectorConfigDigest: deriveBodyDetectorConfigDigest(core),
  };
};

const preparedJob = () =>
  prepareLocalBodyDetectionJob({
    assetId: "asset-test",
    manifest: manifest(),
    projection: { assetId: "asset-test", inputRevision: digest("b") },
  });

const result = (prepared, overrides = {}) => ({
  assetToken: prepared.assetToken,
  bodies: [
    {
      box: { h: 0.8, w: 0.4, x: 0.1, y: 0.1 },
      confidence: 0.9,
      quality: { visibility: 0.95 },
    },
  ],
  detectorConfigDigest: prepared.detectorConfigDigest,
  inputRevision: prepared.inputRevision,
  schemaVersion: bodyDetectionResultSchemaVersion,
  sourceContentDigest: digest("c"),
  state: "bodies_detected",
  ...overrides,
});

const runs = (prepared, secondOverrides = {}) => [
  { result: result(prepared), runId: "run-a" },
  { result: result(prepared, secondOverrides), runId: "run-b" },
];

test("prepared replay-consistent output becomes an exact repository validation", () => {
  const prepared = preparedJob();
  assert.equal(prepared.schemaVersion, localBodyDetectionWorkerVersion);
  assert.equal(
    prepared.assetToken,
    deriveRepositoryBodyAssetToken({
      assetId: prepared.assetId,
      detectorConfigDigest: prepared.detectorConfigDigest,
      inputRevision: prepared.inputRevision,
    }),
  );
  const validation = assembleLocalBodyDetectionResult({
    prepared,
    runs: runs(prepared),
    sourceContentDigest: digest("c"),
  });
  const projected = projectValidatedBodyResultForRepository(validation);
  assert.equal(projected.assetToken, prepared.assetToken);
  assert.equal(projected.bodies.length, 1);
  assert.equal(prepared.authority.providerExecution, "not_executed");
  assert.equal(prepared.authority.identity, "none");
});

test("copies, cross-asset projections and replay drift fail closed", () => {
  assert.throws(
    () =>
      prepareLocalBodyDetectionJob({
        assetId: "asset-test",
        manifest: manifest(),
        projection: { assetId: "asset-other", inputRevision: digest("b") },
      }),
    (error) => error.code === "LOCAL_BODY_DETECTION_WORKER_INPUT_INVALID",
  );
  const prepared = preparedJob();
  assert.throws(
    () =>
      assembleLocalBodyDetectionResult({
        prepared: Object.freeze({ ...prepared }),
        runs: runs(prepared),
        sourceContentDigest: digest("c"),
      }),
    (error) => error.code === "LOCAL_BODY_DETECTION_WORKER_INPUT_INVALID",
  );
  assert.throws(
    () =>
      assembleLocalBodyDetectionResult({
        prepared,
        runs: runs(prepared, {
          bodies: [
            {
              box: { h: 0.7, w: 0.4, x: 0.1, y: 0.1 },
              confidence: 0.9,
            },
          ],
        }),
        sourceContentDigest: digest("c"),
      }),
    (error) => error.code === "BODY_PROVIDER_CONFORMANCE_INPUT_INVALID",
  );
});

test("revision, config, source and anonymous asset substitutions fail closed", () => {
  const prepared = preparedJob();
  const substitutions = [
    { inputRevision: digest("d") },
    { detectorConfigDigest: digest("d") },
    { sourceContentDigest: digest("d") },
    { assetToken: digest("d") },
  ];
  for (const substitution of substitutions) {
    assert.throws(() =>
      assembleLocalBodyDetectionResult({
        prepared,
        runs: [
          { result: result(prepared, substitution), runId: "run-a" },
          { result: result(prepared, substitution), runId: "run-b" },
        ],
        sourceContentDigest: digest("c"),
      }),
    );
  }
});

test("exact validated source read binds preparation and rejects caller source forgery", async () => {
  const repository = createAssetSourceRevisionRepository(
    async () => [{ asset_id: "asset-test", revision_id: null }],
    { presentationRank: () => 1 },
  );
  const sourceRead = completeAssetSourceRead({
    bytes: Buffer.from("validated source"),
    prepared: await repository.prepare({
      assetId: "asset-test",
      sourceAccess: "operator_local_read_only",
      sourceBindingDigest: digest("e"),
    }),
  });
  const prepared = prepareLocalBodyDetectionJobFromSourceRead({
    manifest: manifest(),
    sourceRead,
  });
  const exactRuns = [
    {
      result: result(prepared, {
        sourceContentDigest: sourceRead.sourceContentDigest,
      }),
      runId: "run-a",
    },
    {
      result: result(prepared, {
        sourceContentDigest: sourceRead.sourceContentDigest,
      }),
      runId: "run-b",
    },
  ];
  const validation = assembleLocalBodyDetectionResult({
    prepared,
    runs: exactRuns,
    sourceContentDigest: sourceRead.sourceContentDigest,
  });
  assert.equal(
    projectValidatedBodyResultForRepository(validation).inputRevision,
    sourceRead.inputRevision,
  );
  assert.throws(
    () =>
      prepareLocalBodyDetectionJobFromSourceRead({
        manifest: manifest(),
        sourceRead: Object.freeze({ ...sourceRead }),
      }),
    (error) => error.code === "ASSET_SOURCE_REVISION_ENVELOPE_INVALID",
  );
  assert.throws(
    () =>
      assembleLocalBodyDetectionResult({
        prepared,
        runs: exactRuns,
        sourceContentDigest: digest("f"),
      }),
    (error) => error.code === "LOCAL_BODY_DETECTION_WORKER_INPUT_INVALID",
  );
});
