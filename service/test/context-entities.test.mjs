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
  let query = "";
  const sql = async (strings) => {
    query = strings.join("?");
    return [
      {
        ...eventRow,
        entity_id: "place_00000000000000000000000000000000",
        entity_kind: "place",
        event_kind: null,
        place_kind: "unlocated",
        child_count: 2,
        direct_asset_count: 8,
        directory_visibility: "nested_only",
        subtree_asset_count: 15,
      },
    ];
  };
  const store = createContextEntityStore(sql);
  const items = await store.list({ entityKind: "place" });
  assert.equal(Object.hasOwn(items[0], "previewAssetIds"), false);
  assert.equal(items[0].assetCount, 8);
  assert.equal(items[0].childCount, 2);
  assert.equal(items[0].directoryVisibility, "nested_only");
  assert.equal(items[0].subtreeAssetCount, 15);
  assert.match(query, /WITH RECURSIVE descendants/);
  assert.match(query, /count\(DISTINCT link\.asset_id\)/);
});

test("Event cover authority has a dedicated versioned result contract", () => {
  assert.equal(
    contextEntityContract.eventCoverSchemaVersion,
    "cimmich.event-cover.v1",
  );
});

test("Place directory visibility is a closed contract", () => {
  assert.deepEqual(contextEntityContract.directoryVisibilities, [
    "listed",
    "nested_only",
  ]);
});

test("Place role is closed and projections keep the geography cross-link", async () => {
  assert.equal(contextEntityContract.defaultPlaceRole, "location");
  assert.deepEqual(contextEntityContract.placeRoles, [
    "geography",
    "location",
    "unclassified",
  ]);
  const sql = async () => [
    {
      ...eventRow,
      entity_id: "place_00000000000000000000000000000000",
      entity_kind: "place",
      event_kind: null,
      geography_entity_id: "place_11111111111111111111111111111111",
      place_kind: "point",
      place_role: "location",
    },
  ];
  const [location] = await createContextEntityStore(sql).list({
    entityKind: "place",
    placeRole: "location",
  });
  assert.equal(location.placeRole, "location");
  assert.equal(
    location.geographyEntityId,
    "place_11111111111111111111111111111111",
  );
});

test("Location Plans use a closed kind contract and normalized bounded geometry", async () => {
  assert.deepEqual(contextEntityContract.placePlanKinds, [
    "property",
    "floor",
    "outdoor",
    "other",
  ]);
  assert.deepEqual(contextEntityContract.placePlanBackgroundKinds, [
    "blank",
    "asset",
    "satellite",
  ]);
  const reachedPersistence = new Error("reached plan persistence");
  const sql = Object.assign(async () => [], {
    begin: async () => {
      throw reachedPersistence;
    },
  });
  const store = createContextEntityStore(sql);
  const input = {
    actorId: "local-operator",
    commandId: "context.location-plan-test.00000001",
    displayName: "Ground floor",
    entityId: "place_00000000000000000000000000000000",
    expectedRevision: 0,
    items: [
      {
        childEntityId: "place_11111111111111111111111111111111",
        geometry: { h: 0.2, kind: "rect", w: 0.3, x: 0.1, y: 0.1 },
      },
    ],
    planKind: "floor",
  };
  await assert.rejects(
    store.savePlacePlan(input),
    (error) => error === reachedPersistence,
  );
  await assert.rejects(
    store.savePlacePlan({ ...input, backgroundKind: "asset" }),
    (error) =>
      error.code === "PLACE_PLAN_BACKGROUND_INVALID" &&
      /needs exactly one background photo/.test(error.message),
  );
  await assert.rejects(
    store.savePlacePlan({
      ...input,
      backgroundKind: "satellite",
      backgroundViewport: {
        latitude: -29.489,
        longitude: 153.232,
        zoom: 17.25,
      },
    }),
    (error) => error === reachedPersistence,
  );
  await assert.rejects(
    store.savePlacePlan({
      ...input,
      backgroundKind: "satellite",
      backgroundViewport: { latitude: -91, longitude: 153.232, zoom: 23 },
    }),
    (error) =>
      error.code === "PLACE_PLAN_VIEWPORT_INVALID" &&
      /valid satellite centre and zoom/.test(error.message),
  );
  await assert.rejects(
    store.savePlacePlan({
      ...input,
      backgroundKind: "satellite",
      backgroundViewport: { latitude: -29.489, longitude: 153.232, zoom: 22 },
    }),
    (error) => error === reachedPersistence,
  );
  await assert.rejects(
    store.savePlacePlan({
      ...input,
      backgroundKind: "blank",
      backgroundViewport: { latitude: -29.489, longitude: 153.232, zoom: 17 },
    }),
    (error) => error.code === "PLACE_PLAN_VIEWPORT_INVALID",
  );
  await assert.rejects(
    store.savePlacePlan({
      ...input,
      items: [
        {
          ...input.items[0],
          geometry: { h: 0.4, kind: "rect", w: 0.4, x: 0.8, y: 0.8 },
        },
      ],
    }),
    (error) =>
      error.code === "PLACE_PLAN_GEOMETRY_INVALID" &&
      /remain inside the canvas/.test(error.message),
  );
});

test("Ordinary Place creation defaults to Location rather than migration state", async () => {
  const reachedInsert = new Error("reached context insert");
  let insertedValues = [];
  const tx = Object.assign(
    async (strings, ...values) => {
      if (strings.join("?").includes("INSERT INTO context_entity (")) {
        insertedValues = values;
        throw reachedInsert;
      }
      return [];
    },
    { json: (value) => value },
  );
  const sql = Object.assign(async () => [], {
    begin: async (callback) => callback(tx),
  });

  await assert.rejects(
    createContextEntityStore(sql).create({
      actorId: "local-operator",
      commandId: "context-create-default-location-test",
      displayName: "A named place",
      entityKind: "place",
      typeKind: "unlocated",
    }),
    (error) => error === reachedInsert,
  );
  assert.ok(insertedValues.includes("location"));
  assert.equal(insertedValues.includes("unclassified"), false);
});

test("Painted Place areas accept only 3 to 500 distinct canonical points", async () => {
  const reachedPersistence = new Error("reached persistence");
  const sql = Object.assign(async () => [], {
    begin: async () => {
      throw reachedPersistence;
    },
  });
  const store = createContextEntityStore(sql);
  const input = {
    actorId: "local-operator",
    commandId: "painted-area-test-0001",
    datePrecision: "unknown",
    displayName: "Office",
    entityKind: "place",
    geometry: {
      points: [
        { latitude: -29.45, longitude: 153.21 },
        { latitude: -29.45, longitude: 153.22 },
        { latitude: -29.46, longitude: 153.22 },
      ],
    },
    typeKind: "area",
  };

  await assert.rejects(
    store.create(input),
    (error) => error === reachedPersistence,
  );
  await assert.rejects(
    store.create({
      ...input,
      commandId: "painted-area-test-0002",
      geometry: { points: input.geometry.points.slice(0, 2) },
    }),
    (error) =>
      error.code === "CONTEXT_GEOMETRY_INVALID" &&
      /3 to 500 points/.test(error.message),
  );
  await assert.rejects(
    store.create({
      ...input,
      commandId: "painted-area-test-0003",
      geometry: {
        points: [
          input.geometry.points[0],
          input.geometry.points[0],
          input.geometry.points[1],
        ],
      },
    }),
    (error) =>
      error.code === "CONTEXT_GEOMETRY_INVALID" &&
      /three distinct points/.test(error.message),
  );
});
