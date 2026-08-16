import assert from "node:assert/strict";
import test from "node:test";
import { planAppleSmartProposalImport } from "../src/generated-summary-proposal-import.mjs";

const digest = (character) => character.repeat(64);
const manifestAsset = (overrides = {}) => ({
  cimmichAssetId: "asset-1",
  contentHash: `sha256:${digest("a")}`,
  immichAssetId: "source-1",
  sourceAvailable: true,
  ...overrides,
});
const resultRow = (overrides = {}) => ({
  cimmichAssetId: "asset-1",
  immichAssetId: "source-1",
  result: {
    activationAuthority: "none",
    configDigest: digest("b"),
    model: { digest: digest("c"), name: "Apple Vision" },
    operation: "scene-text",
    proposal: {
      activities: [],
      objects: ["boat"],
      peopleCountEstimate: 1,
      qualityFlags: [],
      scene: "harbour",
      summary: "One person is visible near a boat.",
      visibleText: [],
    },
    proposalDigest: digest("d"),
    providerId: "apple-vision-native-summary",
    state: "proposed",
  },
  ...overrides,
});
const currentAsset = (overrides = {}) => ({
  cimmichAssetId: "asset-1",
  currentSmartProposalDigest: null,
  sourceAssetId: "source-1",
  sourceContentDigests: [digest("a")],
  ...overrides,
});
const manifest = (assets) => ({
  assets,
  schemaVersion: "cimmich.apple-vision-benji-full-manifest.v1",
});

test("plans only exact current source and asset matches", () => {
  const plan = planAppleSmartProposalImport({
    currentAssets: [currentAsset()],
    manifest: manifest([manifestAsset()]),
    resultRows: [resultRow()],
  });
  assert.equal(plan.eligible.length, 1);
  assert.equal(plan.eligible[0].commit.tier, "smart");
  assert.equal(plan.eligible[0].commit.sourceContentDigest, digest("a"));
  assert.deepEqual(plan.reasonCounts, {});
});

test("separates identical, conflicting, changed and unavailable proposals", () => {
  const assets = [
    manifestAsset(),
    manifestAsset({ cimmichAssetId: "asset-2", immichAssetId: "source-2" }),
    manifestAsset({ cimmichAssetId: "asset-3", immichAssetId: "source-3" }),
    manifestAsset({
      cimmichAssetId: "asset-4",
      immichAssetId: "source-4",
      sourceAvailable: false,
    }),
  ];
  const rows = assets.map((asset) =>
    resultRow({
      cimmichAssetId: asset.cimmichAssetId,
      immichAssetId: asset.immichAssetId,
      ...(asset.sourceAvailable
        ? {}
        : { result: { operation: "scene-text", state: "unavailable" } }),
    }),
  );
  const plan = planAppleSmartProposalImport({
    currentAssets: [
      currentAsset({ currentSmartProposalDigest: digest("d") }),
      currentAsset({
        cimmichAssetId: "asset-2",
        currentSmartProposalDigest: digest("e"),
        sourceAssetId: "source-2",
      }),
      currentAsset({
        cimmichAssetId: "asset-3",
        sourceAssetId: "source-3",
        sourceContentDigests: [digest("f")],
      }),
    ],
    manifest: manifest(assets),
    resultRows: rows,
  });
  assert.equal(plan.eligible.length, 0);
  assert.deepEqual(plan.alreadyCurrent, ["source-1"]);
  assert.deepEqual(plan.reasonCounts, {
    content_changed: 1,
    current_smart_conflict: 1,
    source_unavailable: 1,
  });
});

test("rejects a result set that substitutes an unmanifested asset", () => {
  assert.throws(
    () =>
      planAppleSmartProposalImport({
        currentAssets: [currentAsset()],
        manifest: manifest([manifestAsset()]),
        resultRows: [
          resultRow({ cimmichAssetId: "asset-2", immichAssetId: "source-2" }),
        ],
      }),
    /APPLE_SMART_IMPORT_RESULT_SET_MISMATCH/,
  );
});

test("rejects duplicate current source mappings", () => {
  assert.throws(
    () =>
      planAppleSmartProposalImport({
        currentAssets: [currentAsset(), currentAsset()],
        manifest: manifest([manifestAsset()]),
        resultRows: [resultRow()],
      }),
    /APPLE_SMART_IMPORT_CURRENT_ASSET_DUPLICATE/,
  );
});
