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
  bodyPoseCurrentProjectionSchemaVersion,
  createBodyPoseCurrentProjectionReceipt,
  createBodyPoseCurrentProjectionRepository,
} from "../src/body-pose-current-projection.mjs";
import { deriveRepositoryBodyAssetToken } from "../src/body-detection-result-repository.mjs";
import {
  bodyPoseProviderSchemaVersion,
  deriveBodyPoseManifest,
} from "../src/body-pose-provider-contract.mjs";
import { prepareLocalBodyPoseJobFromCurrent } from "../src/local-body-pose-worker.mjs";

const digest = (character) => character.repeat(64);
const assetId = "asset-current-pose-fixture";

const detectorManifest = () => {
  const core = {
    detector: {
      artifactDigest: digest("a"),
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

const fixture = () => {
  const manifest = detectorManifest();
  const inputRevision = digest("b");
  const validation = validateBodyDetectionResult(
    {
      assetToken: deriveRepositoryBodyAssetToken({
        assetId,
        detectorConfigDigest: manifest.detectorConfigDigest,
        inputRevision,
      }),
      bodies: [
        {
          box: { h: 0.8, w: 0.4, x: 0.1, y: 0.1 },
          confidence: 0.9,
          headBox: { h: 0.2, w: 0.2, x: 0.2, y: 0.1 },
          quality: { visibility: 0.9 },
        },
      ],
      detectorConfigDigest: manifest.detectorConfigDigest,
      inputRevision,
      schemaVersion: bodyDetectionResultSchemaVersion,
      sourceContentDigest: digest("c"),
      state: "bodies_detected",
    },
    manifest,
  );
  const projected = projectValidatedBodyResultForRepository(validation);
  return {
    manifest,
    row: {
      asset_id: assetId,
      asset_token: projected.assetToken,
      body_count: 1,
      body_id: projected.bodies[0].bodyId,
      box_h: projected.bodies[0].box.h,
      box_w: projected.bodies[0].box.w,
      box_x: projected.bodies[0].box.x,
      box_y: projected.bodies[0].box.y,
      detection_result_id: "body_detection_current_fixture",
      detector_config_digest: projected.detectorConfigDigest,
      detector_confidence: projected.bodies[0].confidence,
      current_proof: "current_at_last_validated_read",
      head_box_h: projected.bodies[0].headBox.h,
      head_box_w: projected.bodies[0].headBox.w,
      head_box_x: projected.bodies[0].headBox.x,
      head_box_y: projected.bodies[0].headBox.y,
      input_revision: projected.inputRevision,
      observation_key: projected.bodies[0].observationKey,
      observation_order: 0,
      quality_digest: projected.bodies[0].qualityDigest,
      quality_measurements: projected.bodies[0].quality,
      result_digest: projected.resultDigest,
      source_kind: "operator_local_read_only",
      source_content_digest: projected.sourceContentDigest,
    },
  };
};

const repositoryFor = (rows, rank = 1) => {
  const statements = [];
  const sql = async (strings, ...values) => {
    statements.push({ statement: strings.join("?"), values });
    return rows;
  };
  return {
    repository: createBodyPoseCurrentProjectionRepository(sql, {
      presentationRank: () => rank,
    }),
    statements,
  };
};

test("loads an exact visible current Body envelope for pose preparation", async () => {
  const { manifest, row } = fixture();
  const { repository, statements } = repositoryFor([row]);
  const current = await repository.load({
    assetId,
    detectorManifest: manifest,
  });
  const receipt = createBodyPoseCurrentProjectionReceipt(current);
  const prepared = prepareLocalBodyPoseJobFromCurrent({
    current,
    manifest: poseManifest(),
  });
  assert.equal(current.schemaVersion, bodyPoseCurrentProjectionSchemaVersion);
  assert.equal(current.proof, "current_at_last_validated_read");
  assert.equal(current.sourceKind, "operator_local_read_only");
  assert.equal(receipt.authority.databaseWrite, "none");
  assert.equal(current.inputRevision, digest("b"));
  assert.equal(prepared.bodyResultDigest, row.result_digest);
  assert.match(statements[0].statement, /cimmich_visibility_asset_rank/);
  assert.doesNotMatch(JSON.stringify(receipt), /asset-current|source_content/);
});

test("copied envelopes and asset/config/digest substitutions fail closed", async () => {
  const { manifest, row } = fixture();
  const current = await repositoryFor([row]).repository.load({
    assetId,
    detectorManifest: manifest,
  });
  assert.throws(() =>
    prepareLocalBodyPoseJobFromCurrent({
      current: Object.freeze({ ...current }),
      manifest: poseManifest(),
    }),
  );
  await assert.rejects(
    repositoryFor([{ ...row, asset_token: digest("f") }]).repository.load({
      assetId,
      detectorManifest: manifest,
    }),
    (error) => error.code === "BODY_POSE_CURRENT_DRIFT",
  );
  await assert.rejects(
    repositoryFor([{ ...row, result_digest: digest("e") }]).repository.load({
      assetId,
      detectorManifest: manifest,
    }),
    (error) => error.code === "BODY_POSE_CURRENT_DRIFT",
  );
  await assert.rejects(
    repositoryFor([row]).repository.load({
      assetId,
      detectorManifest: {
        ...manifest,
        detectorConfigDigest: digest("d"),
      },
    }),
  );
});

test("missing, invisible and structurally drifted current rows abstain before pose", async () => {
  const { manifest, row } = fixture();
  await assert.rejects(
    repositoryFor([]).repository.load({ assetId, detectorManifest: manifest }),
    (error) => error.code === "BODY_POSE_CURRENT_UNAVAILABLE",
  );
  await assert.rejects(
    repositoryFor([row], 4).repository.load({
      assetId,
      detectorManifest: manifest,
    }),
    (error) => error.code === "BODY_POSE_CURRENT_INPUT_INVALID",
  );
  await assert.rejects(
    repositoryFor([{ ...row, body_count: 2 }]).repository.load({
      assetId,
      detectorManifest: manifest,
    }),
    (error) => error.code === "BODY_POSE_CURRENT_DRIFT",
  );
  await assert.rejects(
    repositoryFor([{ ...row, head_box_w: null }]).repository.load({
      assetId,
      detectorManifest: manifest,
    }),
    (error) => error.code === "BODY_POSE_CURRENT_DRIFT",
  );
});
