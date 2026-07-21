import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  bodyDetectionResultSchemaVersion,
  bodyDetectorSchemaVersion,
  deriveBodyDetectorConfigDigest,
  projectValidatedBodyResultForRepository,
  validateBodyDetectionResult,
} from "../src/body-detector-contract.mjs";
import {
  bodyMaskDigest,
  bodyMaskPayloadDigest,
  bodyMaskEvaluationSchemaVersion,
  bodyMaskProviderSchemaVersion,
  bodyMaskResultSchemaVersion,
  createBodyMaskReceipt,
  deriveBodyMaskManifest,
  projectValidatedBodyMasks,
  validateBodyMaskEvidence,
} from "../src/body-mask-provider-contract.mjs";
import {
  consumeLocalBodyMaskValidation,
  createLocalBodyMaskWorkerReceipt,
  executeLocalBodyMaskJob,
  prepareLocalBodyMaskJob,
  projectLocalBodyMasks,
} from "../src/local-body-mask-worker.mjs";

const digest = (character) => character.repeat(64);
const assetId = "asset_mask_fixture";
const imageBytes = Buffer.from("encoded-body-mask-fixture");
const sourceContentDigest = createHash("sha256")
  .update(imageBytes)
  .digest("hex");

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

const bodyValidation = () => {
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

const maskManifest = () =>
  deriveBodyMaskManifest({
    execution: {
      device: "cpu",
      network: "forbidden",
      runtimeId: "sam2-1.0",
      threads: 1,
    },
    licensing: { code: "declared", model: "unknown", trainingData: "unknown" },
    mask: {
      artifactDigest: digest("d"),
      configId: "sam2.1-hiera-tiny",
      maxSide: 1600,
      modelId: "sam2-hiera-tiny",
      modelVersionId: "2.1",
      multiMaskCount: 3,
      selectionPolicyId: "sam2-bounded-box-v1",
      thresholds: {
        expandedFraction: 0.08,
        rejectMaxAreaRatio: 1.35,
        rejectMinAreaRatio: 0.05,
        rejectMinInside: 0.62,
        validMaxAreaRatio: 0.92,
        validMinInside: 0.78,
        validMinScore: 0.35,
      },
    },
    preprocessing: {
      colorSpace: "rgb",
      coordinateSpace: "normalized_image",
      orientation: "exif_transposed_top_left",
      promptKind: "body_box",
    },
    privacy: { externalUpload: "none", sourceMedia: "local-read-only" },
    provider: { providerId: "sam2-body-mask", versionId: "v1" },
    resources: {
      maxInputBytes: 1024 * 1024,
      maxMemoryMiB: 1024,
      maxOutputBytes: 1024 * 1024,
      maxRuntimeMs: 30_000,
    },
    schemaVersion: bodyMaskProviderSchemaVersion,
  });

const resultFor = (manifest, validation, { state = "geometry_valid" } = {}) => {
  const body = projectValidatedBodyResultForRepository(validation);
  const canvas = { height: 10, width: 10 };
  const maskCore = {
    box: { h: 0.8, w: 0.4, x: 0.1, y: 0.1 },
    height: 8,
    originX: 1,
    originY: 1,
    runs: [0, 13, 2, 2, 2, 13],
    width: 4,
  };
  const variants = {
    geometry_valid: {
      metrics: {
        insideExpandedRatio: 1,
        maskArea: 28,
        maskAreaRatioToPrompt: 0.875,
      },
      reason: "geometry_valid_semantics_unverified",
      score: 0.9,
      state: "geometry_valid",
    },
    review: {
      metrics: {
        insideExpandedRatio: 1,
        maskArea: 28,
        maskAreaRatioToPrompt: 0.875,
      },
      reason: "low_score_needs_visual_qc",
      score: 0.2,
      state: "review",
    },
  };
  return {
    assetToken: body.assetToken,
    bodyResultDigest: body.resultDigest,
    canvas,
    inputRevision: body.inputRevision,
    maskConfigDigest: manifest.maskConfigDigest,
    observations: [
      {
        bodyId: body.bodies[0].bodyId,
        mask: { ...maskCore, digest: bodyMaskPayloadDigest(maskCore) },
        ...variants[state],
      },
    ],
    schemaVersion: bodyMaskResultSchemaVersion,
    sourceContentDigest: body.sourceContentDigest,
    state: "masks_produced",
  };
};

const validationFor = ({ drift = false } = {}) => {
  const manifest = maskManifest();
  const body = bodyValidation();
  return validateBodyMaskEvidence({
    bodyValidation: body,
    manifest,
    runs: [
      { result: resultFor(manifest, body), runId: "run-one" },
      {
        result: resultFor(manifest, body, {
          state: drift ? "review" : "geometry_valid",
        }),
        runId: "run-two",
      },
    ],
    schemaVersion: bodyMaskEvaluationSchemaVersion,
  });
};

test("Body-mask manifest and exact replay project bounded anonymous silhouettes", () => {
  const validation = validationFor();
  const receipt = createBodyMaskReceipt(validation);
  const projection = projectValidatedBodyMasks(validation);
  assert.equal(validation.status, "validated");
  assert.deepEqual(validation.counts, {
    geometry_valid: 1,
    review: 0,
    abstained: 0,
  });
  assert.equal(projection.items.length, 1);
  assert.deepEqual(projection.items[0].mask.runs, [0, 13, 2, 2, 2, 13]);
  assert.equal(projection.authority.countAuthority, "none");
  assert.equal(receipt.authority.automaticIdentityAuthority, "none");
  assert.doesNotMatch(
    JSON.stringify(receipt),
    /bodyId|sourceContent|asset_mask/,
  );
});

test("copies, Body substitution, invalid RLE and caller dispositions fail closed", () => {
  const validation = validationFor();
  assert.throws(() => createBodyMaskReceipt(Object.freeze({ ...validation })));
  assert.throws(() =>
    projectValidatedBodyMasks(Object.freeze({ ...validation })),
  );
  const manifest = maskManifest();
  const body = bodyValidation();
  const invalid = resultFor(manifest, body);
  invalid.observations[0].mask.runs = [0, 3];
  assert.throws(() =>
    validateBodyMaskEvidence({
      bodyValidation: body,
      manifest,
      runs: [
        { result: invalid, runId: "run-one" },
        { result: invalid, runId: "run-two" },
      ],
      schemaVersion: bodyMaskEvaluationSchemaVersion,
    }),
  );
  const forged = resultFor(manifest, body);
  forged.observations[0].reason = "broad_mask_needs_visual_qc";
  assert.throws(() =>
    validateBodyMaskEvidence({
      bodyValidation: body,
      manifest,
      runs: [
        { result: forged, runId: "run-one" },
        { result: forged, runId: "run-two" },
      ],
      schemaVersion: bodyMaskEvaluationSchemaVersion,
    }),
  );
  const forgedMetrics = resultFor(manifest, body);
  forgedMetrics.observations[0].metrics.maskAreaRatioToPrompt = 0.8;
  assert.throws(() =>
    validateBodyMaskEvidence({
      bodyValidation: body,
      manifest,
      runs: [
        { result: forgedMetrics, runId: "run-one" },
        { result: forgedMetrics, runId: "run-two" },
      ],
      schemaVersion: bodyMaskEvaluationSchemaVersion,
    }),
  );
  const paddedCrop = resultFor(manifest, body);
  paddedCrop.observations[0].mask.runs = [0, 28, 4];
  paddedCrop.observations[0].mask.digest = bodyMaskPayloadDigest(
    paddedCrop.observations[0].mask,
  );
  assert.throws(() =>
    validateBodyMaskEvidence({
      bodyValidation: body,
      manifest,
      runs: [
        { result: paddedCrop, runId: "run-one" },
        { result: paddedCrop, runId: "run-two" },
      ],
      schemaVersion: bodyMaskEvaluationSchemaVersion,
    }),
  );
  const forgedOrigin = resultFor(manifest, body);
  forgedOrigin.observations[0].mask.originX = 2;
  forgedOrigin.observations[0].mask.digest = bodyMaskPayloadDigest(
    forgedOrigin.observations[0].mask,
  );
  assert.throws(() =>
    validateBodyMaskEvidence({
      bodyValidation: body,
      manifest,
      runs: [
        { result: forgedOrigin, runId: "run-one" },
        { result: forgedOrigin, runId: "run-two" },
      ],
      schemaVersion: bodyMaskEvaluationSchemaVersion,
    }),
  );
});

test("replay drift is receipted but cannot project mask evidence", () => {
  const validation = validationFor({ drift: true });
  assert.equal(validation.replayEvidence, "drift");
  assert.equal(createBodyMaskReceipt(validation).status, "replay_drift");
  assert.throws(() => projectValidatedBodyMasks(validation));
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
    sourceAccess: "operator-local-read-only",
  }),
});

const providerFor = (manifest, { drift = false } = {}) => ({
  detect: async (request) => ({
    result: resultFor(manifest, bodyValidation(), {
      state:
        drift && request.runId.startsWith("run-2-")
          ? "review"
          : "geometry_valid",
    }),
    runId: request.runId,
  }),
  manifest,
});

const prepare = (manifest = maskManifest()) =>
  prepareLocalBodyMaskJob({
    assetId,
    bodyValidation: bodyValidation(),
    manifest,
    projection: { assetId, inputRevision: digest("b") },
  });

test("worker binds two runs to current source and exposes no count or identity authority", async () => {
  const manifest = maskManifest();
  const execution = await executeLocalBodyMaskJob({
    companion: companionFor(),
    prepared: prepare(manifest),
    provider: providerFor(manifest),
  });
  const receipt = createLocalBodyMaskWorkerReceipt(execution);
  assert.equal(receipt.boundary.providerProcessInvocations, 2);
  assert.equal(receipt.boundary.mediaRead, "operator-local-read-only");
  assert.equal(receipt.authority.countAuthority, "none");
  assert.equal(projectLocalBodyMasks(execution).items.length, 1);
  assert.ok(consumeLocalBodyMaskValidation(execution));
  assert.doesNotMatch(
    JSON.stringify(receipt),
    /bodyId|sourceContent|asset_mask/,
  );
});

test("worker copies, source/revision drift and replay drift fail closed", async () => {
  const manifest = maskManifest();
  const prepared = prepare(manifest);
  await assert.rejects(() =>
    executeLocalBodyMaskJob({
      companion: companionFor(),
      prepared: Object.freeze({ ...prepared }),
      provider: providerFor(manifest),
    }),
  );
  await assert.rejects(() =>
    executeLocalBodyMaskJob({
      companion: companionFor({ readRevision: digest("c") }),
      prepared,
      provider: providerFor(manifest),
    }),
  );
  await assert.rejects(() =>
    executeLocalBodyMaskJob({
      companion: companionFor({ currentRevision: digest("c") }),
      prepared,
      provider: providerFor(manifest),
    }),
  );
  const execution = await executeLocalBodyMaskJob({
    companion: companionFor(),
    prepared,
    provider: providerFor(manifest, { drift: true }),
  });
  assert.throws(() => projectLocalBodyMasks(execution));
  assert.throws(() =>
    createLocalBodyMaskWorkerReceipt(Object.freeze({ ...execution })),
  );
});
