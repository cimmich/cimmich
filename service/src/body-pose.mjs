export const bodyPoseSchemaVersion = "cimmich.body-pose.v1";

export const coco17Joints = Object.freeze([
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
]);

export const coco17Skeleton = Object.freeze([
  [0, 1],
  [0, 2],
  [1, 3],
  [2, 4],
  [0, 5],
  [0, 6],
  [5, 6],
  [5, 7],
  [7, 9],
  [6, 8],
  [8, 10],
  [5, 11],
  [6, 12],
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
]);

const unavailable = (reasonCode) => ({
  reasonCode,
  schemaVersion: bodyPoseSchemaVersion,
  state: "unavailable",
});

export const projectBodyPose = (row = {}) => {
  if (!row.pose_body_id) {
    return unavailable("POSE_NOT_RETAINED");
  }
  if (row.pose_state !== "valid") {
    return unavailable("POSE_INVALIDATED");
  }
  const stored = Array.isArray(row.pose_keypoints) ? row.pose_keypoints : [];
  if (
    stored.length !== coco17Joints.length ||
    row.pose_joint_schema !== "coco17" ||
    row.pose_topology_id !== "coco17.v1"
  ) {
    return unavailable("POSE_PROJECTION_INVALID");
  }

  return {
    coordinateSpace: row.pose_coordinate_space,
    jointSchema: row.pose_joint_schema,
    keypoints: stored.map((keypoint, index) => ({
      confidence: Number(keypoint.confidence),
      index,
      joint: coco17Joints[index],
      position:
        keypoint.x == null || keypoint.y == null
          ? null
          : { x: Number(keypoint.x), y: Number(keypoint.y) },
    })),
    provenance: {
      modelDigest: row.pose_model_digest,
      modelFamily: row.pose_model_family,
      modelName: row.pose_model_name,
      modelVersion: row.pose_model_version,
      provider: row.pose_provider,
      sourceSchemaVersion: row.pose_source_schema_version,
    },
    schemaVersion: bodyPoseSchemaVersion,
    skeleton: coco17Skeleton,
    state: "available",
    topologyId: row.pose_topology_id,
  };
};

export const stripBodyPoseStorage = (row = {}) =>
  Object.fromEntries(
    Object.entries(row).filter(([key]) => !key.startsWith("pose_")),
  );
