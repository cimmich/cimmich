export type CimmichFaceReviewReason = 'general' | 'geometry';

export type CimmichFaceReviewDispositionResult = {
  changed: boolean;
  decisionId: string | null;
  disposition: 'active' | 'later' | 'unknown';
  faceId: string;
  reviewReason: CimmichFaceReviewReason;
  replayed: boolean;
  schemaVersion: 'cimmich.face-review-disposition.v1';
};

export type CimmichDeferredFaceReview = {
  assetId: string;
  box: { h: number; w: number; x: number; y: number };
  candidate: null | { displayName: string; personId: string; score: number | null };
  captureTime: string | null;
  createdAt: string;
  decisionId: string;
  detectionConfidence: number;
  faceId: string;
  filename: string;
  height: number;
  mediaKind: 'image' | 'video';
  reason: CimmichFaceReviewReason;
  sourceAssetId: string;
  width: number;
};

export type CimmichDeferredFaceReviewPage = {
  items: CimmichDeferredFaceReview[];
  limit: number;
  schemaVersion: 'cimmich.deferred-face-review.v1';
  total: number;
};

export const cimmichFaceReviewMessage = (
  disposition: 'active' | 'later' | 'unknown',
  reason: CimmichFaceReviewReason,
) =>
  disposition === 'later'
    ? reason === 'geometry'
      ? 'Saved in Box fixes. This Face will not be lost when matching changes.'
      : 'Saved for later review.'
    : disposition === 'unknown'
      ? 'Marked as an unknown person. The Face remains available to review.'
      : 'Returned to active review.';

export const deferredFaceReviewPath = (limit: number) =>
  `/v1/review/faces/deferred?limit=${Math.max(1, Math.min(200, limit))}`;

export const cimmichFaceReviewOverlayState = (face: {
  review_decision_id: string | null;
  review_disposition: 'active' | 'later' | 'unknown';
  review_reason: CimmichFaceReviewReason;
}) => ({
  reviewDecisionId: face.review_decision_id ?? undefined,
  reviewDisposition: face.review_disposition,
  reviewReason: face.review_reason,
});
