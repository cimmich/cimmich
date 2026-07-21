import { describe, expect, it } from 'vitest';
import type { CimmichBodyPose } from '$lib/services/cimmich.service';
import { isRenderableBodyPoseOverlay, projectCimmichBodyPose } from './body-pose-presentation';

const availablePose: CimmichBodyPose = {
  coordinateSpace: 'normalized_image',
  jointSchema: 'coco17',
  keypoints: [
    { confidence: 0.9, index: 0, joint: 'nose', position: { x: 0.25, y: 0.5 } },
    { confidence: 0.1, index: 1, joint: 'left_eye', position: null },
  ],
  provenance: {
    modelDigest: `sha256:${'a'.repeat(64)}`,
    modelFamily: 'synthetic-pose',
    modelName: 'Synthetic pose model',
    modelVersion: 'v1',
    provider: 'synthetic',
    sourceSchemaVersion: 'synthetic.pose.v1',
  },
  schemaVersion: 'cimmich.body-pose.v1',
  skeleton: [[0, 1]],
  state: 'available',
  topologyId: 'coco17.v1',
};

describe('Cimmich Body pose presentation', () => {
  it('projects exact normalized model points into displayed-image coordinates', () => {
    expect(projectCimmichBodyPose(availablePose, { height: 500, width: 1000 })).toEqual({
      keypointScores: [0.9, 0.1],
      keypointSkeleton: [[0, 1]],
      keypoints: [[250, 250], null],
      keypointSource: 'Synthetic pose model · COCO17',
      poseState: 'available',
    });
  });

  it('keeps typed absence instead of drawing a box-derived skeleton', () => {
    const projection = projectCimmichBodyPose(undefined, { height: 500, width: 1000 });
    expect(projection).toEqual({
      keypointScores: [],
      keypointSkeleton: [],
      keypoints: [],
      keypointSource: '',
      poseReasonCode: 'POSE_NOT_RETAINED',
      poseState: 'unavailable',
    });
    expect(isRenderableBodyPoseOverlay(projection)).toBe(false);
  });

  it('admits only a real articulated pose to the owner-facing spatial layer', () => {
    expect(isRenderableBodyPoseOverlay(projectCimmichBodyPose(availablePose, { height: 500, width: 1000 }))).toBe(true);
  });
});
