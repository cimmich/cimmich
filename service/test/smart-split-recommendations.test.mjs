import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSmartSplitRecommendations,
  smartSplitRecommendationPolicy,
} from "../src/smart-split-recommendations.mjs";

const node = (id, assetId, embedded = true) => ({
  assetId,
  embedded,
  faceIds: [`face-${id}`],
  physicalFaceId: id,
});
const edge = (left, right, similarity, sameAsset = false) => ({
  leftPhysicalFaceId: left,
  rightPhysicalFaceId: right,
  sameAsset,
  similarity,
});

test("Smart split recommends separated groups and keeps outliers in Unclear", () => {
  const result = buildSmartSplitRecommendations({
    personId: "mixed-person",
    nodes: [
      node("a1", "shared-1"),
      node("a2", "shared-2"),
      node("a3", "asset-a3"),
      node("b1", "shared-1"),
      node("b2", "shared-2"),
      node("b3", "asset-b3"),
      node("x", "asset-x", false),
    ],
    edges: [
      edge("a1", "a2", 0.81),
      edge("a2", "a3", 0.78),
      edge("b1", "b2", 0.79),
      edge("b2", "b3", 0.76),
      edge("a1", "b1", 0.61, true),
      edge("a2", "b2", 0.58, true),
    ],
  });
  assert.equal(result.automaticIdentityAuthority, "none");
  assert.equal(result.summary.clearGroupCount, 2);
  assert.deepEqual(
    result.groups.map((group) => [group.kind, group.faceIds.length]),
    [
      ["clear", 3],
      ["clear", 3],
      ["unclear", 1],
    ],
  );
  assert.equal(result.groups[0].reason, "same_photo_separation");
  assert.deepEqual(result.groups.at(-1).faceIds, ["face-x"]);
});

test("same-photo constraints prevent a high-similarity bridge from fusing people", () => {
  const result = buildSmartSplitRecommendations({
    personId: "lookalikes",
    nodes: [
      node("a1", "shared"),
      node("a2", "shared-2"),
      node("a3", "asset-a3"),
      node("b1", "shared"),
      node("b2", "shared-2"),
      node("b3", "asset-b3"),
    ],
    edges: [
      edge("a1", "a2", 0.8),
      edge("a2", "a3", 0.77),
      edge("b1", "b2", 0.78),
      edge("b2", "b3", 0.76),
      edge("a1", "b1", 0.75, true),
      edge("a2", "b2", 0.7, true),
    ],
  });
  assert.equal(result.summary.clearGroupCount, 2);
  assert.equal(result.groups[0].samePhotoSeparations > 0, true);
  assert.equal(result.groups[1].samePhotoSeparations > 0, true);
});

test("one coherent component is not presented as a split recommendation", () => {
  const result = buildSmartSplitRecommendations({
    personId: "one-person",
    nodes: [node("a", "a"), node("b", "b"), node("c", "c")],
    edges: [edge("a", "b", 0.82), edge("b", "c", 0.8), edge("a", "c", 0.76)],
  });
  assert.equal(result.summary.clearGroupCount, 0);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].kind, "unclear");
  assert.deepEqual(result.groups[0].faceIds, ["face-a", "face-b", "face-c"]);
});

test("distance-only recommendations require conservative cohesion and separation", () => {
  const result = buildSmartSplitRecommendations({
    personId: "separated",
    nodes: [
      node("a1", "a1"),
      node("a2", "a2"),
      node("a3", "a3"),
      node("b1", "b1"),
      node("b2", "b2"),
      node("b3", "b3"),
    ],
    edges: [
      edge("a1", "a2", 0.76),
      edge("a2", "a3", 0.73),
      edge("b1", "b2", 0.74),
      edge("b2", "b3", 0.71),
      edge("a1", "b1", 0.44),
    ],
  });
  assert.equal(result.summary.clearGroupCount, 2);
  assert.equal(result.groups[0].reason, "embedding_separation");
  assert.equal(
    result.policy.strongLinkFloor,
    smartSplitRecommendationPolicy.strongLinkFloor,
  );
});
