import assert from "node:assert/strict";
import test from "node:test";

import { createCimmichRepository } from "../src/repository.mjs";

test("map source-ID filtering returns only current assets admitted at the request visibility rank", async () => {
  const calls = [];
  const sql = async (strings, ...values) => {
    calls.push({ statement: strings.join("?"), values });
    return [{ source_asset_id: "11111111-1111-4111-8111-111111111111" }];
  };
  const repository = createCimmichRepository(sql, new Map(), {
    currentRank: () => 1,
  });
  const result = await repository.filterVisibleMapAssetSourceIds({
    sourceAssetIds: [
      "22222222-2222-4222-8222-222222222222",
      "11111111-1111-4111-8111-111111111111",
    ],
  });
  assert.deepEqual(result, {
    schemaVersion: "cimmich.visible-map-assets.v1",
    sourceAssetIds: ["11111111-1111-4111-8111-111111111111"],
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].statement, /projection\.state = 'active'/);
  assert.match(calls[0].statement, /asset\.state = 'active'/);
  assert.match(
    calls[0].statement,
    /cimmich_visibility_asset_rank\(asset\.asset_id\) <=/,
  );
  assert.equal(calls[0].values.at(-1), 1);
});

test("map filtering rejects malformed, duplicate and unbounded source-ID sets before SQL", async () => {
  let dispatches = 0;
  const repository = createCimmichRepository(
    async () => {
      dispatches += 1;
      return [];
    },
    new Map(),
    { currentRank: () => 0 },
  );
  await assert.rejects(
    () => repository.filterVisibleMapAssetSourceIds({ sourceAssetIds: [] }),
    { code: "MAP_ASSET_IDS_INVALID" },
  );
  await assert.rejects(
    () =>
      repository.filterVisibleMapAssetSourceIds({
        sourceAssetIds: ["not-a-uuid"],
      }),
    { code: "MAP_ASSET_IDS_INVALID" },
  );
  await assert.rejects(
    () =>
      repository.filterVisibleMapAssetSourceIds({
        sourceAssetIds: Array.from(
          { length: 501 },
          (_, index) =>
            `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        ),
      }),
    { code: "MAP_ASSET_IDS_INVALID" },
  );
  assert.equal(dispatches, 0);
});
