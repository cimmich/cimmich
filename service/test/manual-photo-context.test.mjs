import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { cleanManualObjectRegion } from "../src/manual-photo-context.mjs";

test("manual object regions are exact bounded normalized rectangles", () => {
  assert.deepEqual(
    cleanManualObjectRegion({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }),
    { h: 0.4, w: 0.3, x: 0.1, y: 0.2 },
  );
  for (const value of [
    null,
    [],
    { x: 0, y: 0, w: 0, h: 0.2 },
    { x: 0.9, y: 0, w: 0.2, h: 0.2 },
    { x: 0, y: 0, w: 0.2, h: 0.2, label: "Moss" },
    { x: "0", y: 0, w: 0.2, h: 0.2 },
  ]) {
    assert.throws(
      () => cleanManualObjectRegion(value),
      (error) => error.code === "MANUAL_OBJECT_REGION_INVALID",
    );
  }
});

test("manual photo context is visibility-first and has zero matcher authority", async () => {
  const source = await readFile(
    new URL("../src/manual-photo-context.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /cimmich_visibility_asset_rank/);
  assert.match(source, /cimmich_visibility_context_entity_rank/);
  assert.match(source, /entity_kind = 'object'/);
  assert.match(
    source,
    /projection\.input_revision = observation\.asset_input_revision/,
  );
  assert.match(source, /await requireVisibleObject\(tx, scope\.entity_id/);
  assert.match(
    source,
    /scope\.asset_input_revision !== asset\.input_revision/g,
  );
  assert.match(
    source,
    /collision\.entity_id = previous\.entity_id[\s\S]*collision\.state = 'accepted'/,
  );
  assert.match(
    source,
    /coalesce\(max\(revision\), 0\)::bigint AS latest_revision[\s\S]*const nextRevision = Number\(history\.latest_revision\) \+ 1/,
  );
  assert.doesNotMatch(
    source,
    /face_embedding|identity_claim|source_pack|matching_gallery|provider|training/i,
  );
});

test("schema 71 keeps owner summaries and object regions in separate durable relations", async () => {
  const source = await readFile(
    new URL(
      "../../migrations/0071_manual_photo_context_v1.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /CREATE TABLE manual_context_observation/);
  assert.match(source, /CREATE TABLE manual_context_tag/);
  assert.match(
    source,
    /entity_kind text NOT NULL CHECK \(entity_kind = 'object'\)/,
  );
  assert.match(source, /origin text NOT NULL CHECK \(origin = 'manual_user'\)/);
  assert.match(source, /CREATE TABLE asset_owner_summary_revision/);
  assert.match(
    source,
    /provenance text NOT NULL CHECK \(provenance = 'manual_user'\)/,
  );
  assert.match(source, /CREATE TABLE manual_photo_context_operation/);
  assert.match(
    source,
    /REFERENCES manual_photo_context_command\(command_id\)[\s\S]*DEFERRABLE INITIALLY DEFERRED/,
  );
  assert.match(
    source,
    /producer_receipt_id text NOT NULL[\s\S]*REFERENCES producer_receipt/,
  );
  assert.doesNotMatch(source, /ALTER TABLE context_asset_link.*geometry/is);
});
