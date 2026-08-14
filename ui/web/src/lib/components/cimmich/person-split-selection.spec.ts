import { describe, expect, it } from 'vitest';
import {
  isUncertainSplitBatchFailure,
  replaceSplitSelectionWithShown,
  smartSplitRecommendationsAfterBatch,
  splitSelectionAfterBatch,
} from './person-split-selection';

describe('Person Split selection safety', () => {
  it('replaces a previous hidden group when Select shown is used', () => {
    expect(replaceSplitSelectionWithShown(['face-b', 'face-c', 'face-c'], 100)).toEqual(['face-b', 'face-c']);
    expect(
      replaceSplitSelectionWithShown(
        Array.from({ length: 103 }, (_, index) => `face-${index}`),
        100,
      ),
    ).toHaveLength(100);
  });

  it('retains only explicit failures that are still in the source Person', () => {
    expect(splitSelectionAfterBatch(['face-b', 'face-c'], ['face-a', 'face-c', 'face-c'])).toEqual(['face-c']);
  });

  it('keeps the next Smart Split group visible after a successful move', () => {
    const recommendations = {
      automaticIdentityAuthority: 'none' as const,
      available: true,
      groups: [
        {
          cohesionFloor: 0.78,
          cohesionMedian: 0.8,
          faceIds: ['face-a1', 'face-a2'],
          groupId: 'smart-clear-1',
          kind: 'clear' as const,
          label: 'Suggested group 1',
          nearestOtherSimilarity: 0.6,
          physicalFaceCount: 2,
          reason: 'same_photo_separation' as const,
          representativeFaceId: 'face-a1',
          samePhotoSeparations: 2,
          separationMargin: 0.18,
        },
        {
          cohesionFloor: 0.76,
          cohesionMedian: 0.79,
          faceIds: ['face-b1', 'face-b2'],
          groupId: 'smart-clear-2',
          kind: 'clear' as const,
          label: 'Suggested group 2',
          nearestOtherSimilarity: 0.6,
          physicalFaceCount: 2,
          reason: 'same_photo_separation' as const,
          representativeFaceId: 'face-b1',
          samePhotoSeparations: 2,
          separationMargin: 0.16,
        },
        {
          cohesionFloor: null,
          cohesionMedian: null,
          faceIds: ['face-x'],
          groupId: 'smart-unclear',
          kind: 'unclear' as const,
          label: 'Unclear',
          nearestOtherSimilarity: null,
          physicalFaceCount: 1,
          reason: 'conservative_abstention' as const,
          representativeFaceId: 'face-x',
          samePhotoSeparations: 0,
          separationMargin: null,
        },
      ],
      personId: 'mixed-person',
      policy: {
        clearDistanceCeiling: 0.52,
        clearDistanceMargin: 0.12,
        edgeEvidenceFloor: 0.44,
        minimumGroupSize: 3,
        minimumSamePhotoSeparations: 2,
        pairGroupCohesionFloor: 0.74,
        samePhotoSeparationRatio: 0.25,
        strongInternalMedianFloor: 0.8,
        strongLinkFloor: 0.68,
      },
      schemaVersion: 'cimmich.smart-split-recommendations.v1' as const,
      summary: {
        clearGroupCount: 2,
        embeddedPhysicalFaceCount: 5,
        physicalFaceCount: 5,
        unclearFaceCount: 1,
      },
      unavailableReason: null,
    };

    const result = smartSplitRecommendationsAfterBatch(recommendations, ['face-a1', 'face-a2']);
    expect(result.groups.map(({ groupId }) => groupId)).toEqual(['smart-clear-2', 'smart-unclear']);
    expect(result.summary.clearGroupCount).toBe(1);
    expect(result.summary.physicalFaceCount).toBe(3);
  });

  it('treats transport failures as unknown outcomes instead of safe retries', () => {
    expect(isUncertainSplitBatchFailure('Cimmich service did not respond in time')).toBe(true);
    expect(isUncertainSplitBatchFailure('Failed to fetch')).toBe(true);
    expect(isUncertainSplitBatchFailure('A Cimmich Person already uses this display name')).toBe(false);
  });
});
