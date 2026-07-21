import assert from "node:assert/strict";
import test from "node:test";
import {
  bodyDetectionResultSchemaVersion,
  bodyDetectorSchemaVersion,
  deriveBodyDetectorConfigDigest,
  projectValidatedBodyResultForRepository,
  validateBodyDetectionResult,
} from "../src/body-detector-contract.mjs";
import { createBodyPoseCurrentProjectionRepository } from "../src/body-pose-current-projection.mjs";
import {
  bodyPoseEvaluationSchemaVersion,
  bodyPoseProviderSchemaVersion,
  bodyPoseResultSchemaVersion,
  deriveBodyPoseManifest,
  projectValidatedBodyPoseForRepository,
  validateBodyPoseEvidence,
} from "../src/body-pose-provider-contract.mjs";
import {
  bodyPoseEvidenceRepositoryVersion,
  createBodyPoseEvidenceRepository,
} from "../src/body-pose-evidence-repository.mjs";
import { deriveRepositoryBodyAssetToken } from "../src/body-detection-result-repository.mjs";

const digest = (character) => character.repeat(64);
const assetId = "asset-pose-repository-fixture";
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
      artifactDigest: digest("a"),
      modelId: "body",
      modelVersionId: "v1",
      scoreThreshold: 0.3,
    },
    execution: {
      device: "cpu",
      network: "forbidden",
      runtimeId: "runtime",
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
    provider: { providerId: "body", versionId: "v1" },
    resources: { maxMemoryMiB: 1024, maxRuntimeMs: 30000 },
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
      runtimeId: "runtime",
      threads: 1,
    },
    licensing: { code: "declared", model: "unknown", trainingData: "unknown" },
    pose: {
      artifactDigest: digest("d"),
      jointSchema: "coco17",
      keypointThreshold: 0.2,
      modelId: "pose",
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
    resources: { maxMemoryMiB: 1024, maxRuntimeMs: 30000 },
    schemaVersion: bodyPoseProviderSchemaVersion,
  });

const fixture = () => {
  const detector = detectorManifest();
  const inputRevision = digest("b");
  const bodyResult = {
    assetToken: deriveRepositoryBodyAssetToken({
      assetId,
      detectorConfigDigest: detector.detectorConfigDigest,
      inputRevision,
    }),
    bodies: [
      { box: { h: 0.8, w: 0.4, x: 0.1, y: 0.1 }, confidence: 0.9, quality: {} },
    ],
    detectorConfigDigest: detector.detectorConfigDigest,
    inputRevision,
    schemaVersion: bodyDetectionResultSchemaVersion,
    sourceContentDigest: digest("c"),
    state: "bodies_detected",
  };
  const bodyValidation = validateBodyDetectionResult(bodyResult, detector);
  const bodyProjection =
    projectValidatedBodyResultForRepository(bodyValidation);
  const bodyId = bodyProjection.bodies[0].bodyId;
  const pose = poseManifest();
  const result = {
    assetToken: bodyResult.assetToken,
    detections: [
      {
        box: bodyResult.bodies[0].box,
        confidence: 0.9,
        keypoints: joints.map((joint, index) => ({
          confidence: 0.9,
          joint,
          x: Number((0.2 + index * 0.01).toFixed(6)),
          y: Number((0.2 + index * 0.01).toFixed(6)),
        })),
      },
    ],
    inputRevision,
    poseConfigDigest: pose.poseConfigDigest,
    schemaVersion: bodyPoseResultSchemaVersion,
    sourceContentDigest: digest("c"),
    state: "poses_detected",
  };
  return {
    bodyId,
    bodyProjection,
    bodyResult,
    bodyValidation,
    detector,
    inputRevision,
    pose,
    result,
  };
};

const database = ({ existing = [] } = {}) => {
  const state = fixture();
  const statements = [];
  const currentRow = {
    asset_id: assetId,
    asset_token: state.bodyResult.assetToken,
    body_count: 1,
    body_id: state.bodyId,
    box_h: 0.8,
    box_w: 0.4,
    box_x: 0.1,
    box_y: 0.1,
    current_proof: "current_at_last_validated_read",
    detection_result_id: "result",
    detector_config_digest: state.detector.detectorConfigDigest,
    detector_confidence: 0.9,
    head_box_h: null,
    head_box_w: null,
    head_box_x: null,
    head_box_y: null,
    input_revision: state.inputRevision,
    observation_key: state.bodyProjection.bodies[0].observationKey,
    observation_order: 0,
    quality_digest: state.bodyProjection.bodies[0].qualityDigest,
    quality_measurements: {},
    result_digest: state.bodyProjection.resultDigest,
    source_content_digest: digest("c"),
    source_kind: "operator_local_read_only",
  };
  const query = async (strings, ...values) => {
    const statement = strings.join("?");
    statements.push({ statement, values });
    if (
      statement.includes("FROM current_body_detection_result_observation") &&
      statement.includes("body.box_x")
    )
      return [currentRow];
    if (statement.includes("SELECT current_result.body_id"))
      return [{ body_id: state.bodyId }];
    if (statement.includes("FROM body_pose_evidence")) return existing;
    return [];
  };
  query.json = (value) => value;
  const sql = Object.assign(query, {
    begin: async (handler) => handler(query),
  });
  return { sql, state, statements };
};

const validated = (state) =>
  validateBodyPoseEvidence({
    bodyValidation: state.bodyValidation,
    manifest: state.pose,
    policy: { alternativeMargin: 0.05, minimumIou: 0.5 },
    runs: [
      { result: state.result, runId: "run-a" },
      { result: state.result, runId: "run-b" },
    ],
    schemaVersion: bodyPoseEvaluationSchemaVersion,
  });

test("exact current pose evidence persists once and replays without writes", async () => {
  const first = database();
  const current = await createBodyPoseCurrentProjectionRepository(first.sql, {
    presentationRank: () => 1,
  }).load({ assetId, detectorManifest: first.state.detector });
  const receipt = await createBodyPoseEvidenceRepository(first.sql, {
    presentationRank: () => 1,
  }).commit({ current, validation: validated(first.state) });
  assert.equal(receipt.schemaVersion, bodyPoseEvidenceRepositoryVersion);
  assert.equal(receipt.persistedPoseCount, 1);
  assert.equal(receipt.changed, true);
  assert.equal(receipt.automaticIdentityAuthority, "none");
  assert.equal(
    first.statements.some(({ statement }) =>
      statement.includes("INSERT INTO body_pose_evidence"),
    ),
    true,
  );

  const validation = validated(first.state);
  const item = projectValidatedBodyPoseForRepository(validation).items[0];
  const replay = database({
    existing: [
      {
        body_id: item.bodyId,
        coordinate_space: item.coordinateSpace,
        joint_schema: item.jointSchema,
        keypoints: item.keypoints.map(({ confidence, joint, x, y }) => ({
          x,
          y,
          joint,
          confidence,
        })),
        model_digest: item.modelDigest,
        model_family: item.modelFamily,
        model_name: item.modelName,
        model_version: item.modelVersion,
        provider: item.provider,
        source_artifact_digest: item.sourceArtifactDigest,
        source_schema_version: item.sourceSchemaVersion,
        state: item.state,
        topology_id: item.topologyId,
      },
    ],
  });
  const replayCurrent = await createBodyPoseCurrentProjectionRepository(
    replay.sql,
    { presentationRank: () => 1 },
  ).load({ assetId, detectorManifest: replay.state.detector });
  const replayReceipt = await createBodyPoseEvidenceRepository(replay.sql, {
    presentationRank: () => 1,
  }).commit({ current: replayCurrent, validation: validated(replay.state) });
  assert.equal(replayReceipt.changed, false);
  assert.equal(replayReceipt.replayedPoseCount, 1);
});

test("copied current envelopes and stale Body lineage fail before pose writes", async () => {
  const db = database();
  const current = await createBodyPoseCurrentProjectionRepository(db.sql, {
    presentationRank: () => 1,
  }).load({ assetId, detectorManifest: db.state.detector });
  await assert.rejects(() =>
    createBodyPoseEvidenceRepository(db.sql, {
      presentationRank: () => 1,
    }).commit({ current: { ...current }, validation: validated(db.state) }),
  );
  const staleSql = Object.assign(
    async (strings, ...values) => {
      const statement = strings.join("?");
      if (statement.includes("body.box_x")) return db.sql(strings, ...values);
      if (statement.includes("SELECT current_result.body_id")) return [];
      return [];
    },
    { begin: async (handler) => handler(staleSql), json: (value) => value },
  );
  const fresh = await createBodyPoseCurrentProjectionRepository(db.sql, {
    presentationRank: () => 1,
  }).load({ assetId, detectorManifest: db.state.detector });
  await assert.rejects(
    () =>
      createBodyPoseEvidenceRepository(staleSql, {
        presentationRank: () => 1,
      }).commit({ current: fresh, validation: validated(db.state) }),
    (error) => error.code === "BODY_POSE_EVIDENCE_STALE",
  );
});
