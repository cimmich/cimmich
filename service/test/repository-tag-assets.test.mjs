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
    schemaVersion: "cimmich.tag-assets.v1",
    total: 1,
  });
  assert.match(statement, /WITH RECURSIVE selected_tags/);
  assert.match(statement, /JOIN person_assets association/);
  assert.match(statement, /JOIN current_face_identity identity/);
  assert.match(statement, /JOIN current_context_asset association/);
  assert.match(statement, /scope\.family = 'places'/);
  assert.match(statement, /HAVING count\(DISTINCT membership\.tag_key\)/);
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
