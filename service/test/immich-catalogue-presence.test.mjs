import assert from "node:assert/strict";
import test from "node:test";
import { recordImmichCataloguePresencePage } from "../src/immich-catalogue-presence.mjs";
import { normalizeInventoryPage } from "../src/immich-inventory.mjs";

test("catalogue presence records known database rows without media reads or admission", async () => {
  const queries = [];
  const transaction = async (strings, ...values) => {
    const query = strings.join("?");
    queries.push({ query, values });
    if (query.includes("SELECT page_digest")) return [];
    if (query.includes("FROM immich_inventory_run")) {
      return [{ catalogue_includes_deleted: true, state: "processing" }];
    }
    if (
      query.includes("FROM immich_inventory_lane") &&
      query.includes("FOR UPDATE")
    ) {
      return [{ cursor: "", state: "pending" }];
    }
    if (query.includes("SELECT immich_asset_id")) return [];
    if (query.includes("UPDATE immich_inventory_lane SET")) {
      return [
        {
          cursor: "",
          observed_item_count: 1,
          page_count: 1,
          state: "completed",
          visibility: "timeline",
        },
      ];
    }
    return [];
  };
  const sql = { begin: async (callback) => callback(transaction) };
  const normalized = normalizeInventoryPage({
    cursor: "",
    page: {
      items: [
        {
          assetType: "image",
          captureTime: "2026-01-01T00:00:00Z",
          checksum: "catalogue-checksum",
          height: 800,
          immichAssetId: "40621a2e-bb9c-43f4-b42e-4c1890800c90",
          inputRevision: "a".repeat(64),
          isArchived: false,
          isFavorite: false,
          isOffline: true,
          isTrashed: true,
          originalFileName: "trashed-but-present.jpg",
          originalMimeType: "image/jpeg",
          ownerId: "owner",
          updatedAt: "2026-01-02T00:00:00Z",
          visibility: "timeline",
          width: 1200,
        },
      ],
      nextCursor: null,
      visibility: "timeline",
    },
    visibility: "timeline",
  });

  const result = await recordImmichCataloguePresencePage(sql, {
    normalized,
    runId: "run-1",
    sourceId: "source-1",
  });

  assert.equal(result.replayed, false);
  assert.deepEqual(result.admittedAssetMappings, []);
  assert.deepEqual(result.bridgeEntries, []);
  assert.equal(result.lane.state, "completed");
  assert.ok(
    queries.some(({ query }) =>
      query.includes("UPDATE immich_asset_projection"),
    ),
  );
  assert.ok(
    queries.some(({ query }) => query.includes("UPDATE asset_source_binding")),
  );
  assert.ok(
    queries.some(
      ({ query }) =>
        query.includes("UPDATE asset_source_binding") &&
        query.includes("FROM archive_missing_file_command retirement"),
    ),
  );
  assert.ok(queries.every(({ query }) => !query.includes("media_content")));
  assert.ok(queries.every(({ query }) => !query.includes("enqueue_media_job")));
});
