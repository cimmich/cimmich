import assert from "node:assert/strict";
import test from "node:test";

import {
  bodyPoseSchemaVersion,
  coco17Joints,
  projectBodyPose,
  stripBodyPoseStorage,
} from "../src/body-pose.mjs";

test("body pose projects native normalized COCO17 evidence and provenance", () => {
  const pose = projectBodyPose({
    pose_body_id: "body_fixture",
    pose_coordinate_space: "normalized_image",
    pose_joint_schema: "coco17",
    pose_keypoints: coco17Joints.map((joint, index) => ({
      confidence: index === 3 ? 0.01 : 0.9,
      joint,
      x: index === 3 ? null : 0.1 + index / 100,
      y: index === 3 ? null : 0.2 + index / 100,
    })),
    pose_model_digest: `sha256:${"a".repeat(64)}`,
    pose_model_family: "synthetic-pose",
    pose_model_name: "synthetic-coco17",
    pose_model_version: "v1",
    pose_provider: "synthetic",
    pose_source_schema_version: "synthetic.pose.v1",
    pose_state: "valid",
    pose_topology_id: "coco17.v1",
  });

  assert.equal(pose.schemaVersion, bodyPoseSchemaVersion);
  assert.equal(pose.state, "available");
  assert.equal(pose.keypoints.length, 17);
  assert.deepEqual(pose.keypoints[3], {
    confidence: 0.01,
    index: 3,
    joint: "left_ear",
    position: null,
  });
  assert.equal(pose.skeleton.length, 18);
  assert.equal(pose.provenance.provider, "synthetic");
});

test("body pose reports typed absence instead of synthesizing from a box", () => {
  assert.deepEqual(projectBodyPose({}), {
    reasonCode: "POSE_NOT_RETAINED",
    schemaVersion: bodyPoseSchemaVersion,
    state: "unavailable",
  });
  assert.deepEqual(
    projectBodyPose({
      pose_body_id: "body_fixture",
      pose_state: "invalidated",
    }),
    {
      reasonCode: "POSE_INVALIDATED",
      schemaVersion: bodyPoseSchemaVersion,
      state: "unavailable",
    },
  );
});

test("body pose storage aliases do not leak beside the public union", () => {
  assert.deepEqual(
    stripBodyPoseStorage({
      body_id: "body_fixture",
      box_x: 0.1,
      pose_body_id: "body_fixture",
      pose_keypoints: [{ confidence: 0.9 }],
      pose_provider: "synthetic",
    }),
    { body_id: "body_fixture", box_x: 0.1 },
  );
});
