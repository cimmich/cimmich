import {
  createCimmichIdentityCorrectionCommandId,
  rejectCimmichAcceptedIdentity,
  setCimmichFaceReviewDisposition,
} from '$lib/services/cimmich.service';
import type { CimmichPersonReviewItem } from './same-photo-collision-review';

export const markAcceptedMistagUnknown = async (item: CimmichPersonReviewItem) => {
  const identityClaimId = item.assignedPerson?.identityClaimId;
  if (!identityClaimId) {
    throw new Error('Reload this review before removing the accepted identity.');
  }
  await setCimmichFaceReviewDisposition(
    item.faceId,
    'unknown',
    createCimmichIdentityCorrectionCommandId('mistag-unknown-review'),
  );
  await rejectCimmichAcceptedIdentity(
    identityClaimId,
    createCimmichIdentityCorrectionCommandId('mistag-unknown-identity'),
  );
};
