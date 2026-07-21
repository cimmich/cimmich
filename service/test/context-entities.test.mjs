import assert from "node:assert/strict";
import test from "node:test";

import {
  contextEntityContract,
  createContextEntityStore,
} from "../src/context-entities.mjs";

const eventRow = {
  aliases: [],
  asset_count: 8,
  cover_asset_id: "asset-cover",
  date_end: null,
  date_precision: "exact",
  date_start: "2026-01-01",
  description: null,
  display_name: "Test trip",
  entity_id: "event_00000000000000000000000000000000",
  entity_kind: "event",
  event_kind: "trip",
  effective_cover_asset_id: "asset-cover",
  geometry: null,
  parent_entity_id: null,
  place_kind: null,
  preview_asset_ids: [
    "asset-cover",
    "asset-main-b",
    "asset-main-a",
    "asset-main-c",
    "asset-over-limit",
  ],
  revision: 1,
  selected_cover_asset_id: "asset-cover",
  status: "active",
};

test("Event collection projection bounds visible Main previews in the list query", async () => {
  let query = "";
  const sql = async (strings) => {
    query = strings.join("?");
    return [eventRow];
  };
  const store = createContextEntityStore(sql, {
    bridgeFields: (assetId) => ({ sourceAssetId: `source-${assetId}` }),
    presentationRank: () => 2,
  });

  const items = await store.list({ entityKind: "event", limit: 20 });

  assert.deepEqual(items[0].previewAssetIds, [
    "source-asset-cover",
    "source-asset-main-b",
    "source-asset-main-a",
    "source-asset-main-c",
  ]);
  assert.equal(items[0].coverAssetId, "source-asset-cover");
  assert.equal(items[0].coverMode, "explicit");
  assert.match(query, /entity\.entity_kind = 'event'/);
  assert.match(query, /link\.association_kind IN \('direct', 'manual'\)/);
  assert.match(query, /cimmich_visibility_asset_rank\(link\.asset_id\) <=/);
  assert.match(
    query,
    /cimmich_visibility_context_entity_rank\(entity\.entity_id\) <=/,
  );
  assert.match(
    query,
    /cimmich_visibility_context_entity_rank\(entity\.parent_entity_id\) <=/,
  );
  assert.match(query, /visible_parent_entity_id/);
  assert.match(query, /entity\.status = 'archived'/);
  assert.match(query, /entity\.status = 'hidden'/);
  assert.doesNotMatch(query, /current_context_asset any_link/);
  assert.match(
    query,
    /CASE WHEN link\.asset_id = cover\.asset_id THEN 0 ELSE 1 END/,
  );
  assert.match(
    query,
    /CASE WHEN link\.asset_id = entity\.cover_asset_id THEN 0 ELSE 1 END/,
  );
  assert.match(
    query,
    /ORDER BY cover_priority, asset\.capture_time DESC NULLS LAST/,
  );
  assert.match(query, /LIMIT 4/);
  assert.deepEqual(items[0].visibility, {
    decisionId: null,
    explicit: false,
    objectId: eventRow.entity_id,
    objectScope: "context_entity",
    revision: 0,
    visibilityTier: "standard",
  });
});

test("Non-Event and detail projections do not gain the collection preview field", async () => {
  const sql = async () => [
    {
      ...eventRow,
      entity_id: "place_00000000000000000000000000000000",
      entity_kind: "place",
      event_kind: null,
      place_kind: "unlocated",
    },
  ];
  const store = createContextEntityStore(sql);
  const items = await store.list({ entityKind: "place" });
  assert.equal(Object.hasOwn(items[0], "previewAssetIds"), false);
});

test("Event cover authority has a dedicated versioned result contract", () => {
  assert.equal(
    contextEntityContract.eventCoverSchemaVersion,
    "cimmich.event-cover.v1",
  );
});
