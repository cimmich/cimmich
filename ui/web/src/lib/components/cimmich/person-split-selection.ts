const uncertainBatchFailure = /did not respond in time|abort|network|failed to fetch/i;

export const replaceSplitSelectionWithShown = (faceIds: string[], limit: number) =>
  [...new Set(faceIds)].slice(0, Math.max(0, limit));

export const splitSelectionAfterBatch = (remainingFaceIds: string[], failedFaceIds: string[]) => {
  const remaining = new Set(remainingFaceIds);
  return [...new Set(failedFaceIds)].filter((faceId) => remaining.has(faceId));
};

export const isUncertainSplitBatchFailure = (message: string) => uncertainBatchFailure.test(message);
