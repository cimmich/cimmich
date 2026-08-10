const batchError = (message) =>
  Object.assign(new Error(message), {
    code: "FACE_REVIEW_BATCH_INVALID",
    statusCode: 400,
  });

export const runFaceReviewComparisonBatch = async ({
  faceIds,
  limitPerFace = 5,
  loadComparisons,
}) => {
  if (!Array.isArray(faceIds) || faceIds.length < 1 || faceIds.length > 24) {
    throw batchError("faceIds must contain from 1 to 24 stable Face IDs");
  }
  const normalizedFaceIds = faceIds.map((faceId) =>
    String(faceId || "").trim(),
  );
  if (
    normalizedFaceIds.some((faceId) => !faceId || faceId.length > 160) ||
    new Set(normalizedFaceIds).size !== normalizedFaceIds.length
  ) {
    throw batchError("faceIds must be unique non-empty stable Face IDs");
  }
  const parsedLimit = Number.parseInt(String(limitPerFace), 10);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 5) {
    throw batchError("limitPerFace must be an integer from 1 to 5");
  }

  const items = [];
  for (let offset = 0; offset < normalizedFaceIds.length; offset += 4) {
    const chunk = normalizedFaceIds.slice(offset, offset + 4);
    const comparisons = await Promise.all(
      chunk.map((faceId) => loadComparisons({ faceId, limit: parsedLimit })),
    );
    items.push(
      ...chunk.map((faceId, index) => ({
        faceId,
        matches: comparisons[index].items,
      })),
    );
  }
  return {
    automaticIdentityAuthority: "none",
    bulkAutomationAuthority: "none",
    items,
    limitPerFace: parsedLimit,
    recommendationAuthority: "none",
    requestedCount: normalizedFaceIds.length,
    reviewOnly: true,
    schemaVersion: "cimmich.face-owner-review-comparisons-batch.v1",
  };
};
