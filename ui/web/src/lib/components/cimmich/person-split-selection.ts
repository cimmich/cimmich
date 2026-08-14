import type { CimmichSmartSplitRecommendations } from '$lib/services/cimmich-smart-split.types';

const uncertainBatchFailure = /did not respond in time|abort|network|failed to fetch/i;

export const replaceSplitSelectionWithShown = (faceIds: string[], limit: number) =>
  [...new Set(faceIds)].slice(0, Math.max(0, limit));

export const splitSelectionAfterBatch = (remainingFaceIds: string[], failedFaceIds: string[]) => {
  const remaining = new Set(remainingFaceIds);
  return [...new Set(failedFaceIds)].filter((faceId) => remaining.has(faceId));
};

export const smartSplitRecommendationsAfterBatch = (
  recommendations: CimmichSmartSplitRecommendations,
  assignedFaceIds: string[],
) => {
  const assigned = new Set(assignedFaceIds);
  const removed = new Set<string>();
  const groups = recommendations.groups
    .map((group) => {
      const faceIds = group.faceIds.filter((faceId) => {
        if (!assigned.has(faceId)) {
          return true;
        }
        removed.add(faceId);
        return false;
      });
      return {
        ...group,
        faceIds,
        physicalFaceCount: Math.max(0, group.physicalFaceCount - (group.faceIds.length - faceIds.length)),
        representativeFaceId: faceIds.includes(group.representativeFaceId ?? '')
          ? group.representativeFaceId
          : (faceIds[0] ?? null),
      };
    })
    .filter((group) => group.kind === 'unclear' || group.faceIds.length > 0);

  return {
    ...recommendations,
    groups,
    summary: {
      ...recommendations.summary,
      clearGroupCount: groups.filter(({ kind }) => kind === 'clear').length,
      physicalFaceCount: Math.max(0, recommendations.summary.physicalFaceCount - removed.size),
      unclearFaceCount: groups.find(({ kind }) => kind === 'unclear')?.faceIds.length ?? 0,
    },
  };
};

export const isUncertainSplitBatchFailure = (message: string) => uncertainBatchFailure.test(message);
