import assert from "node:assert/strict";
import test from "node:test";
import { createImmichAssetActivity } from "../src/immich-asset-activity.mjs";

const activeId = "40621a2e-bb9c-43f4-b42e-4c1890800c90";
const trashedId = "ebc501ab-efed-4a20-8152-e4a4b801db55";
const missingId = "dbe4efb0-9645-4c52-8cf6-70f6972a4fc7";
const unavailableId = "9c23ad47-370a-4746-bb85-1768c8fbd9a5";

test("exact Immich activity marks trash and absence but ignores source outages", async () => {
  const statements = [];
  const transaction = async (strings, ...values) => {
    statements.push({ statement: strings.join(" ? "), values });
    return [];
  };
  const sql = { begin: (callback) => callback(transaction) };
  const companion = {
    async getAsset({ assetId }) {
      if (assetId === trashedId) return { asset: { isTrashed: true } };
      if (assetId === missingId) {
        throw Object.assign(new Error("not found"), {
          code: "IMMICH_ASSET_NOT_FOUND",
        });
      }
      if (assetId === unavailableId) {
        throw Object.assign(new Error("offline"), {
          code: "IMMICH_COMPANION_UNAVAILABLE",
        });
      }
      return { asset: { isOffline: true, isTrashed: false } };
    },
  };
  const activity = createImmichAssetActivity({
    cacheTtlMs: 60_000,
    companion,
    sourceId: "immich-primary",
    sql,
  });

  const result = await activity.inspect([
    activeId,
    trashedId,
    missingId,
    unavailableId,
  ]);

  assert.equal(result.get(activeId), "active");
  assert.equal(result.get(trashedId), "trashed");
  assert.equal(result.get(missingId), "missing");
  assert.equal(result.has(unavailableId), false);
  assert.equal(statements.length, 3);
  assert.match(
    statements[1].statement,
    /FROM archive_missing_file_command retirement/,
  );
  assert.ok(
    statements[0].values.some(
      (value) => Array.isArray(value) && value.includes(trashedId),
    ),
  );
  assert.ok(
    statements.every(({ values }) =>
      values.every(
        (value) => !Array.isArray(value) || !value.includes(unavailableId),
      ),
    ),
  );
});

test("Person rows receive the current stored or live active-library state", async () => {
  const transaction = async () => [];
  const sql = Object.assign(
    async (strings) =>
      strings.join(" ? ").includes("SELECT immich_asset_id")
        ? [{ immich_asset_id: trashedId, is_trashed: true, state: "missing" }]
        : [],
    { begin: (callback) => callback(transaction) },
  );
  const activity = createImmichAssetActivity({
    companion: {
      getAsset: async () => ({ asset: { isTrashed: true } }),
    },
    sourceId: "immich-primary",
    sql,
  });

  const [decorated] = await activity.decorate([
    { filename: "trash.jpg", sourceAssetId: trashedId },
  ]);

  assert.equal(decorated.sourceState, "trashed");
});

test("Person rows retain a trashed projection after it leaves the active bridge", async () => {
  const sql = Object.assign(
    async () => [
      {
        cimmich_asset_id: "asset-trash",
        immich_asset_id: trashedId,
        is_trashed: true,
        original_file_name: "trash.jpg",
        state: "missing",
      },
    ],
    { begin: (callback) => callback(async () => []) },
  );
  const activity = createImmichAssetActivity({
    companion: {
      getAsset: async () => ({ asset: { isTrashed: true } }),
    },
    sourceId: "immich-primary",
    sql,
  });

  const [decorated] = await activity.decorate([
    { asset_id: "asset-trash", filename: "", sourceAssetId: "" },
  ]);

  assert.equal(decorated.filename, "trash.jpg");
  assert.equal(decorated.sourceAssetId, trashedId);
  assert.equal(decorated.sourceState, "trashed");
});
