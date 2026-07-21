import assert from "node:assert/strict";
import test from "node:test";
import {
  applyInventoryProjectionBridgeEntries,
  createInventoryProjectionBridgeRefresher,
  mergeInventoryProjectionBridge,
  parseDisplayBridge,
  resolveCimmichAssetIdFromDisplayBridge,
} from "../src/bridge.mjs";

test("display bridge exposes only source id and filename by Cimmich asset id", () => {
  const bridge = parseDisplayBridge({
    schemaVersion: "cimmich.display-bridge.v1",
    assets: [
      {
        assetId: "asset_1",
        filename: "IMG_0001.JPG",
        sourceAssetId: "source_1",
      },
    ],
  });
  assert.deepEqual(bridge.get("asset_1"), {
    filename: "IMG_0001.JPG",
    sourceAssetId: "source_1",
  });
});

test("display bridge rejects an unknown schema", () => {
  assert.throws(
    () => parseDisplayBridge({ assets: [] }),
    /Invalid Cimmich display bridge/,
  );
});

test("display bridge rejects an unknown filename authority", () => {
  assert.throws(
    () =>
      parseDisplayBridge({
        assets: [],
        filenameAuthority: "caller_asserted",
        schemaVersion: "cimmich.display-bridge.v1",
      }),
    /filename authority/,
  );
});

test("display bridge resolves one exact seeded asset without manufacturing identity", () => {
  const bridge = new Map([
    ["asset-one", { filename: "one.jpg", sourceAssetId: "source-one" }],
  ]);
  assert.equal(
    resolveCimmichAssetIdFromDisplayBridge(bridge, "source-one"),
    "asset-one",
  );
  assert.equal(resolveCimmichAssetIdFromDisplayBridge(bridge, "missing"), null);
  bridge.set("asset-two", {
    filename: "two.jpg",
    sourceAssetId: "source-one",
  });
  assert.throws(
    () => resolveCimmichAssetIdFromDisplayBridge(bridge, "source-one"),
    /ambiguous/,
  );
});

test("durable inventory projection supplies current Immich UUID without a display file", async () => {
  const sql = async () => [
    {
      cimmich_asset_id: "asset_projected",
      immich_asset_id: "11111111-1111-4111-8111-111111111111",
      original_file_name: "durable-space-trip.png",
    },
  ];
  const projected = await mergeInventoryProjectionBridge(sql);
  assert.deepEqual(projected.get("asset_projected"), {
    filename: "durable-space-trip.png",
    sourceAssetId: "11111111-1111-4111-8111-111111111111",
  });
});

test("inventory UUID overrides stale bridge authority while retaining presentation filename", async () => {
  const sql = async () => [
    {
      cimmich_asset_id: "asset_1",
      immich_asset_id: "22222222-2222-4222-8222-222222222222",
      original_file_name: null,
    },
  ];
  const projected = await mergeInventoryProjectionBridge(
    sql,
    parseDisplayBridge({
      assets: [
        {
          assetId: "asset_1",
          filename: "safe-demo.png",
          sourceAssetId: "stale-source-id",
        },
      ],
      schemaVersion: "cimmich.display-bridge.v1",
    }),
  );
  assert.deepEqual(projected.get("asset_1"), {
    filename: "safe-demo.png",
    sourceAssetId: "22222222-2222-4222-8222-222222222222",
  });
});

test("explicit canonical source filename survives inventory projection without overriding current UUID", async () => {
  const sql = async () => [
    {
      cimmich_asset_id: "asset_1",
      immich_asset_id: "99999999-9999-4999-8999-999999999999",
      original_file_name: "pre-correction-upload-name.png",
    },
  ];
  const projected = await mergeInventoryProjectionBridge(
    sql,
    parseDisplayBridge({
      assets: [
        {
          assetId: "asset_1",
          filename: "canonical-reviewed-name.png",
          sourceAssetId: "stale-source-id",
        },
      ],
      filenameAuthority: "canonical_source",
      schemaVersion: "cimmich.display-bridge.v1",
    }),
  );
  assert.deepEqual(projected.get("asset_1"), {
    filename: "canonical-reviewed-name.png",
    sourceAssetId: "99999999-9999-4999-8999-999999999999",
  });
});

test("committed inventory pages update the shared display Map without restart", async () => {
  const bridge = new Map();
  const sameReference = bridge;
  applyInventoryProjectionBridgeEntries(bridge, [
    {
      active: true,
      assetId: "asset_new",
      filename: "space-trip-01.jpg",
      sourceAssetId: "33333333-3333-4333-8333-333333333333",
    },
  ]);
  assert.equal(bridge, sameReference);
  assert.deepEqual(bridge.get("asset_new"), {
    filename: "space-trip-01.jpg",
    sourceAssetId: "33333333-3333-4333-8333-333333333333",
  });

  applyInventoryProjectionBridgeEntries(bridge, [
    {
      active: false,
      assetId: "asset_new",
      filename: "",
      sourceAssetId: "33333333-3333-4333-8333-333333333333",
    },
  ]);
  assert.equal(bridge.has("asset_new"), false);
});

test("completed inventory reconciliation removes stale runtime rows and keeps legacy presentation", async () => {
  const legacyBridge = new Map([
    ["asset_legacy", { filename: "legacy.jpg", sourceAssetId: "legacy-id" }],
  ]);
  const bridge = new Map([
    ...legacyBridge,
    ["asset_stale", { filename: "stale.jpg", sourceAssetId: "stale-id" }],
  ]);
  const sql = async () => [
    {
      cimmich_asset_id: "asset_current",
      immich_asset_id: "44444444-4444-4444-8444-444444444444",
      original_file_name: "durable-current.jpg",
    },
  ];
  const refresh = createInventoryProjectionBridgeRefresher({
    bridge,
    legacyBridge,
    sql,
  });
  await refresh({
    entries: [
      {
        active: true,
        assetId: "asset_current",
        filename: "current.jpg",
        sourceAssetId: "44444444-4444-4444-8444-444444444444",
      },
    ],
    phase: "page_committed",
  });
  await refresh({ entries: [], phase: "run_completed" });

  assert.equal(bridge.has("asset_stale"), false);
  assert.deepEqual(bridge.get("asset_legacy"), {
    filename: "legacy.jpg",
    sourceAssetId: "legacy-id",
  });
  assert.deepEqual(bridge.get("asset_current"), {
    filename: "durable-current.jpg",
    sourceAssetId: "44444444-4444-4444-8444-444444444444",
  });
});

test("canonical source filename survives page refresh and completed reconciliation", async () => {
  const legacyBridge = parseDisplayBridge({
    assets: [
      {
        assetId: "asset_current",
        filename: "canonical-reviewed-name.png",
        sourceAssetId: "stale-source-id",
      },
    ],
    filenameAuthority: "canonical_source",
    schemaVersion: "cimmich.display-bridge.v1",
  });
  const bridge = await mergeInventoryProjectionBridge(
    async () => [
      {
        cimmich_asset_id: "asset_current",
        immich_asset_id: "55555555-5555-4555-8555-555555555555",
        original_file_name: "pre-correction-upload-name.png",
      },
    ],
    legacyBridge,
  );
  const refresh = createInventoryProjectionBridgeRefresher({
    bridge,
    legacyBridge,
    sql: async () => [
      {
        cimmich_asset_id: "asset_current",
        immich_asset_id: "55555555-5555-4555-8555-555555555555",
        original_file_name: "pre-correction-upload-name.png",
      },
    ],
  });
  await refresh({
    entries: [
      {
        active: true,
        assetId: "asset_current",
        filename: "pre-correction-upload-name.png",
        sourceAssetId: "55555555-5555-4555-8555-555555555555",
      },
    ],
    phase: "page_committed",
  });
  await refresh({ entries: [], phase: "run_completed" });
  assert.deepEqual(bridge.get("asset_current"), {
    filename: "canonical-reviewed-name.png",
    sourceAssetId: "55555555-5555-4555-8555-555555555555",
  });
});
