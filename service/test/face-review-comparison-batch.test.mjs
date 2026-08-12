import assert from "node:assert/strict";
import test from "node:test";
import { runFaceReviewComparisonBatch } from "../src/face-review-comparison-batch.mjs";

test("same-photo Face comparison batches preserve every region and bound concurrency", async () => {
  let active = 0;
  let maximumActive = 0;
  const faceIds = Array.from({ length: 6 }, (_, index) => `face-${index + 1}`);
  const result = await runFaceReviewComparisonBatch({
    faceIds,
    limitPerFace: 5,
    loadComparisons: async ({ faceId, limit }) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return { items: [{ display_name: `Person for ${faceId}`, limit }] };
    },
  });

  assert.equal(maximumActive, 4);
  assert.equal(result.requestedCount, 6);
  assert.equal(result.reviewOnly, true);
  assert.equal(result.automaticIdentityAuthority, "none");
  assert.deepEqual(
    result.items.map(({ faceId }) => faceId),
    faceIds,
  );
});

test("same-photo Face comparison batches reject unsafe shapes", async () => {
  const loadComparisons = async () => ({ items: [] });
  await assert.rejects(
    runFaceReviewComparisonBatch({
      faceIds: ["face-1", "face-1"],
      loadComparisons,
    }),
    (error) => error.code === "FACE_REVIEW_BATCH_INVALID",
  );
  await assert.rejects(
    runFaceReviewComparisonBatch({
      faceIds: ["face-1"],
      limitPerFace: 6,
      loadComparisons,
    }),
    (error) => error.code === "FACE_REVIEW_BATCH_INVALID",
  );
});

test("same-photo Face comparison batch uses one database-side loader", async () => {
  const calls = [];
  const result = await runFaceReviewComparisonBatch({
    faceIds: ["face-1", "face-2"],
    limitPerFace: 3,
    loadBatch: async (request) => {
      calls.push(request);
      return request.faceIds.map((faceId) => ({ faceId, matches: [] }));
    },
    loadComparisons: async () => {
      throw new Error("per-face loader must not run");
    },
  });

  assert.deepEqual(calls, [{ faceIds: ["face-1", "face-2"], limitPerFace: 3 }]);
  assert.deepEqual(
    result.items.map(({ faceId }) => faceId),
    ["face-1", "face-2"],
  );
});
