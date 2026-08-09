import { describe, expect, it } from 'vitest';
import { samePhotoCollisionReview, type CimmichPersonReviewItem } from './same-photo-collision-review';

const reviewItem = (faceId: string, assetId = 'asset-1'): CimmichPersonReviewItem => ({
  assetId,
  assignedPerson: null,
  box: { h: 0.2, w: 0.2, x: 0.1, y: 0.1 },
  captureTime: null,
  detectionConfidence: 0.9,
  faceId,
  physicalFaceId: faceId,
  filename: 'photo.jpg',
  height: 1000,
  kind: 'untagged_match',
  margin: 0.1,
  mediaKind: 'image',
  qualityMeasurements: {},
  sourceAssetId: 'source-asset-1',
  suggestedPerson: {
    displayName: 'Chloe',
    personId: 'person-chloe',
    reference: null,
    score: faceId === 'face-1' ? 0.59 : 0.54,
  },
  width: 1000,
});

describe('samePhotoCollisionReview', () => {
  it('keeps the remaining sibling in the collision lane after the first decision', () => {
    const initial = samePhotoCollisionReview([reviewItem('face-1'), reviewItem('face-2')]);
    expect(initial.groups).toHaveLength(1);
    expect(initial.groups[0]?.items.map(({ faceId }) => faceId)).toEqual(['face-1', 'face-2']);

    const retained = samePhotoCollisionReview([reviewItem('face-2')], new Set(['asset-1']));
    expect(retained.groups).toHaveLength(1);
    expect(retained.groups[0]?.items.map(({ faceId }) => faceId)).toEqual(['face-2']);

    expect(samePhotoCollisionReview([], new Set(['asset-1'])).groups).toEqual([]);
  });

  it('keeps a server-confirmed same-photo sibling without client retention', () => {
    const sibling = { ...reviewItem('face-2'), samePhotoAcceptedCount: 1 };
    expect(samePhotoCollisionReview([sibling]).groups[0]?.items).toEqual([sibling]);
  });

  it('never presents two evidence observations for one physical Face as competitors', () => {
    const detector = reviewItem('face-detector');
    const sidecar = { ...reviewItem('face-sidecar'), physicalFaceId: 'face-detector' };

    expect(samePhotoCollisionReview([detector, sidecar]).groups).toEqual([]);
  });
});
