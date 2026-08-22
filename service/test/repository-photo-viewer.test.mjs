import assert from "node:assert/strict";
import test from "node:test";

import { createCimmichRepository } from "../src/repository.mjs";

test("photo viewer admits privacy-visible active and confirmed-trash projections only", async () => {
  const calls = [];
  const sql = async (strings, ...values) => {
    calls.push({ statement: strings.join("?"), values });
    return [
      {
        asset_id: "asset-active",
        source_asset_id: "11111111-1111-4111-8111-111111111111",
      },
      {
        asset_id: "asset-trash",
        source_asset_id: "22222222-2222-4222-8222-222222222222",
      },
    ];
  };
  const repository = createCimmichRepository(sql, new Map(), {
    currentRank: () => 2,
  });
  const result = await repository.filterViewableAssetSourceIds({
    sourceAssetIds: [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
    ],
  });

  assert.deepEqual(result, {
    assets: [
      {
        assetId: "asset-active",
        sourceAssetId: "11111111-1111-4111-8111-111111111111",
      },
      {
        assetId: "asset-trash",
        sourceAssetId: "22222222-2222-4222-8222-222222222222",
      },
    ],
    schemaVersion: "cimmich.viewable-assets.v1",
    sourceAssetIds: [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ],
  });
  assert.equal(calls.length, 1);
  assert.match(
    calls[0].statement,
    /projection\.state = 'active' AND asset\.state = 'active'/,
  );
  assert.match(
    calls[0].statement,
    /projection\.state = 'missing' AND projection\.is_trashed = true/,
  );
  assert.match(
    calls[0].statement,
    /cimmich_visibility_asset_rank\(asset\.asset_id\) <=/,
  );
  assert.equal(calls[0].values.at(-1), 2);
});

test("photo viewer rejects malformed source IDs with its own route contract", async () => {
  let dispatches = 0;
  const repository = createCimmichRepository(
    async () => {
      dispatches += 1;
      return [];
    },
    new Map(),
    { currentRank: () => 2 },
  );

  await assert.rejects(
    () =>
      repository.filterViewableAssetSourceIds({
        sourceAssetIds: ["not-a-uuid"],
      }),
    { code: "VIEWABLE_ASSET_IDS_INVALID" },
  );
  assert.equal(dispatches, 0);
});
