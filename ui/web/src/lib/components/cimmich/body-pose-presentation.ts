import type { CimmichBodyPose } from '$lib/services/cimmich.service';

export type BodyPoseOverlayProjection = {
  keypointScores: number[];
  keypointSkeleton: Array<[number, number]>;
  keypoints: Array<[number, number] | null>;
  keypointSource: string;
  poseReasonCode?: string;
  poseState: 'available' | 'unavailable';
};

export const isRenderableBodyPoseOverlay = (pose: {
  keypoints?: Array<[number, number] | null>;
  poseState?: 'available' | 'unavailable';
}) => pose.poseState === 'available' && Boolean(pose.keypoints?.some((keypoint) => keypoint !== null));

export const projectCimmichBodyPose = (
  pose: CimmichBodyPose | undefined,
  image: { height: number; width: number },
): BodyPoseOverlayProjection => {
  if (!pose || pose.state === 'unavailable') {
    return {
      keypointScores: [],
      keypointSkeleton: [],
      keypoints: [],
      keypointSource: '',
      poseReasonCode: pose?.reasonCode ?? 'POSE_NOT_RETAINED',
      poseState: 'unavailable',
    };
  }

  return {
    keypointScores: pose.keypoints.map((keypoint) => keypoint.confidence),
    keypointSkeleton: pose.skeleton,
    keypoints: pose.keypoints.map((keypoint) =>
      keypoint.position ? [keypoint.position.x * image.width, keypoint.position.y * image.height] : null,
    ),
    keypointSource: `${pose.provenance.modelName} · ${pose.jointSchema.toUpperCase()}`,
    poseState: 'available',
  };
};
