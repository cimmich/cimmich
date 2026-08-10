import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAssetLabelName } from "../src/asset-labels.mjs";

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
