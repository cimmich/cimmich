import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanAssetLabelKind,
  normalizeAssetLabelName,
} from "../src/asset-labels.mjs";

test("asset label names collapse whitespace and compare case-insensitively", () => {
  assert.equal(
    normalizeAssetLabelName("  Restricted   Family  "),
    "restricted family",
  );
});

test("asset label names reject empty and overlong input", () => {
  assert.throws(() => normalizeAssetLabelName("   "), {
    code: "ASSET_LABEL_DISPLAY_NAME_INVALID",
  });
  assert.throws(() => normalizeAssetLabelName("x".repeat(121)), {
    code: "ASSET_LABEL_DISPLAY_NAME_INVALID",
  });
});

test("asset organisation kinds allow labels, collections and fixed system states", () => {
  assert.equal(cleanAssetLabelKind("collection"), "collection");
  assert.equal(cleanAssetLabelKind("favorite"), "favorite");
  assert.equal(
    cleanAssetLabelKind("collection", { creatable: true }),
    "collection",
  );
  assert.throws(() => cleanAssetLabelKind("favorite", { creatable: true }), {
    code: "ASSET_LABEL_KIND_INVALID",
  });
});
