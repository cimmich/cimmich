import assert from "node:assert/strict";
import test from "node:test";

import { loadFaceReviewComparisonBatch } from "../src/face-review-comparison-repository.mjs";

test("Face review comparison materializes one shared reference pool for a bounded batch", async () => {
  let calls = 0;
  let parameters = [];
  let statement = "";
  const sql = async (strings, ...values) => {
    calls += 1;
    statement = strings.join("?");
    parameters = values;
    return [
      {
        accepted_example_count: 2,
        current_identity: false,
        display_name: "Alex",
        person_id: "person-alex",
        prime_score: 0.91,
        query_face_id: "face-2",
        rank: 1,
        score_kind: "cosine_similarity",
        similarity: 0.91,
        unavailable_reason: null,
      },
    ];
  };

  const result = await loadFaceReviewComparisonBatch(sql, {
    faceIds: ["face-1", "face-2"],
    limitPerFace: 5,
    visibleRank: 1,
  });

  assert.equal(calls, 1);
  assert.deepEqual(result[0], { faceId: "face-1", matches: [] });
  assert.equal(result[1].faceId, "face-2");
  assert.equal(result[1].matches[0].display_name, "Alex");
  assert.equal("query_face_id" in result[1].matches[0], false);
  assert.deepEqual(parameters, [1, 1, ["face-1", "face-2"], 5]);
  assert.match(statement, /reference_pool AS MATERIALIZED/);
  assert.match(statement, /face\.face_id = ANY\(\?\)/);
  assert.match(statement, /PARTITION BY candidate\.query_face_id/);
  assert.match(statement, /PARTITION BY query_face_id/);
  assert.match(statement, /WHERE rank <= \?/);
  assert.doesNotMatch(statement, /cimmich_visibility_asset_rank\(/);
});
