import assert from "node:assert/strict";
import test from "node:test";
import { createCimmichRepository } from "../src/repository.mjs";
import { createFragmentAwareSql } from "./fixtures/fragment-aware-sql.mjs";

test("Cimmich tag assets intersect every selected family in one set-based query", async () => {
  let statement = "";
  const sql = createFragmentAwareSql(
    (text) => {
      statement = text;
    },
    [
      {
        asset_id: "asset-one",
        capture_time: "2026-08-03T00:00:00.000Z",
        total_count: 1,
      },
    ],
  );
  const repository = createCimmichRepository(
    sql,
    new Map([["asset-one", { sourceAssetId: "immich-one" }]]),
  );

  const result = await repository.tagAssets({
    tags: [
      { entityId: "person-one", family: "people" },
      { entityId: "event-one", family: "events" },
    ],
  });

  assert.deepEqual(result, {
    items: [
      {
        captureTime: "2026-08-03T00:00:00.000Z",
        sourceAssetId: "immich-one",
      },
    ],
    nextCursor: null,
    pageSize: 120,
    schemaVersion: "cimmich.tag-assets.v1",
    total: 1,
  });
  assert.match(statement, /WITH RECURSIVE selected_tags/);
  assert.match(statement, /JOIN person_assets association/);
  assert.match(statement, /JOIN current_face_identity identity/);
  assert.match(statement, /JOIN current_context_asset association/);
  assert.match(statement, /scope\.family IN \('places', 'events'\)/);
  assert.match(statement, /HAVING count\(DISTINCT membership\.tag_key\)/);
  assert.match(statement, /asset\.asset_id = ANY/);
  assert.match(statement, /LIMIT/);
});

test("Cimmich tag assets page without silently truncating the true result set", async () => {
  const sql = createFragmentAwareSql(() => {}, [
    {
      asset_id: "asset-one",
      capture_time: "2026-08-03T00:00:00.000Z",
      total_count: 3,
    },
    {
      asset_id: "asset-two",
      capture_time: "2026-08-02T00:00:00.000Z",
      total_count: 3,
    },
  ]);
  const repository = createCimmichRepository(
    sql,
    new Map([
      ["asset-one", { sourceAssetId: "immich-one" }],
      ["asset-two", { sourceAssetId: "immich-two" }],
    ]),
  );

  const result = await repository.tagAssets({
    pageSize: 1,
    tags: [{ entityId: "event-one", family: "events" }],
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.pageSize, 1);
  assert.equal(result.total, 3);
  assert.equal(typeof result.nextCursor, "string");
});

test("Cimmich tag assets reject invalid or excessive selections before SQL", async () => {
  const repository = createCimmichRepository(async () => {
    throw new Error("SQL must not run");
  });

  await assert.rejects(
    repository.tagAssets({ tags: [] }),
    (error) => error.code === "TAG_ASSET_SELECTION_INVALID",
  );
  await assert.rejects(
    repository.tagAssets({ tags: [{ entityId: "one", family: "albums" }] }),
    (error) => error.code === "TAG_ASSET_SELECTION_INVALID",
  );
});
