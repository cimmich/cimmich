import type { CimmichIdentityAuditItem } from '$lib/services/cimmich.service';

export type CimmichPersonReviewItem = CimmichIdentityAuditItem & {
  candidateClaimId?: string;
  candidateEvidence?: {
    detectorConfidence: number;
    matchScore: number | null;
    margin: number | null;
    secondBestScore: number | null;
  };
  samePhotoAcceptedCount?: number;
};

export type CimmichSamePhotoCollisionGroup = {
  assetId: string;
  items: CimmichPersonReviewItem[];
};

export const samePhotoCollisionReview = (items: CimmichPersonReviewItem[]) => {
  const byAsset = new Map<string, CimmichPersonReviewItem[]>();
  for (const item of items) {
    byAsset.set(item.assetId, [...(byAsset.get(item.assetId) ?? []), item]);
  }
  const groups = [...byAsset.entries()]
    .filter(
      ([, assetItems]) =>
        assetItems.length > 1 || assetItems.some(({ samePhotoAcceptedCount }) => (samePhotoAcceptedCount ?? 0) > 0),
    )
    .map(([assetId, assetItems]) => ({
      assetId,
      items: [...assetItems].sort((left, right) => right.suggestedPerson.score - left.suggestedPerson.score),
    }))
    .sort(
      (left, right) =>
        right.items.length - left.items.length ||
        (right.items[0]?.suggestedPerson.score ?? 0) - (left.items[0]?.suggestedPerson.score ?? 0),
    );
  return {
    faceIds: new Set(groups.flatMap(({ items: groupItems }) => groupItems.map(({ faceId }) => faceId))),
    groups,
  };
};

export const personIdentityAuditGroups = ({
  auditTotals,
  candidateOnlyItems,
  collisionFaceIds,
  personName,
  reviewItems,
}: {
  auditTotals: Record<'accepted_contradiction' | 'untagged_match', number>;
  candidateOnlyItems: CimmichPersonReviewItem[];
  collisionFaceIds: Set<string>;
  personName: string;
  reviewItems: CimmichPersonReviewItem[];
}) =>
  (['untagged_match', 'accepted_contradiction'] as const).map((kind) => {
    const isNewMatch = kind === 'untagged_match';
    const collisionCount = reviewItems.filter((item) => item.kind === kind && collisionFaceIds.has(item.faceId)).length;
    return {
      description: isNewMatch
        ? `Previously untagged faces the matcher thinks may be ${personName}.`
        : 'Existing identity tags the matcher disputes because it sees a stronger match to a different person.',
      id: isNewMatch ? 'new-matches' : 'possible-mistags',
      items: reviewItems.filter((item) => item.kind === kind && !collisionFaceIds.has(item.faceId)),
      kind,
      title: isNewMatch ? 'New matches' : 'Possible mistags',
      total: Math.max(
        0,
        auditTotals[kind] + candidateOnlyItems.filter((item) => item.kind === kind).length - collisionCount,
      ),
    };
  });

export const personAwaitingCounts = (
  auditTotals: Record<'accepted_contradiction' | 'untagged_match', number>,
  candidateOnlyItems: CimmichPersonReviewItem[],
  machineSuggestionCount: number,
) => {
  const candidates = (kind: CimmichPersonReviewItem['kind']) =>
    candidateOnlyItems.filter((item) => item.kind === kind).length;
  const newMatches = auditTotals.untagged_match + candidates('untagged_match') + machineSuggestionCount;
  const possibleMistags = auditTotals.accepted_contradiction + candidates('accepted_contradiction');
  return { newMatches, possibleMistags, total: newMatches + possibleMistags };
};
