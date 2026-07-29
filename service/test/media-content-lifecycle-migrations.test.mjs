import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("same-photo derivative guard is explicit false for an empty pair", async () => {
  const source = await readFile(
    new URL(
      "../../migrations/0099_same_photo_derivative_guard_v2.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    source,
    /CREATE OR REPLACE FUNCTION cimmich_probable_same_photo_derivative/,
  );
  // The whole verdict is a scalar subquery wrapped in coalesce(..., false):
  // an empty asset pair yields false instead of a NULL row that NOT-guarded
  // callers silently drop.
  assert.match(source, /SELECT coalesce\(\s*\(\s*SELECT/);
  assert.match(
    source,
    /FROM asset_pair pair\s+CROSS JOIN face_counts count\s+CROSS JOIN matched_summary summary\s+\),\s+false\s+\)/,
  );
  assert.match(source, /false, never NULL/);
});

test("media_content rows carry producer attribution for scoped cleanups", async () => {
  const migration = await readFile(
    new URL(
      "../../migrations/0100_media_content_producer_v1.sql",
      import.meta.url,
    ),
    "utf8",
  );
  // Migration 0086's unguarded orphan DELETE is immutable; the caveat is
  // documented and every media_content row now records its producer so
  // future cleanups must scope destructive deletes.
  assert.match(migration, /Caveat on migration 0086/);
  assert.match(migration, /ALTER TABLE media_content/);
  assert.match(migration, /ADD COLUMN producer_receipt_id/);
  assert.match(migration, /REFERENCES producer_receipt\(producer_receipt_id\)/);
  assert.match(migration, /content\.producer_receipt_id IS NULL/);

  for (const filename of [
    "../src/archive-mobility.mjs",
    "../src/immich-inventory.mjs",
  ]) {
    const writer = await readFile(new URL(filename, import.meta.url), "utf8");
    assert.match(
      writer,
      /INSERT INTO media_content \(\s*content_id, byte_length, producer_receipt_id\s*\)/,
      filename,
    );
    assert.match(
      writer,
      /producer_receipt_id = coalesce\(\s*media_content\.producer_receipt_id,\s*excluded\.producer_receipt_id\s*\)/,
      filename,
    );
  }
});

test("derivative guard survives assets with several active Immich projections", async () => {
  const source = await readFile(
    new URL(
      "../../migrations/0104_same_photo_derivative_guard_multi_projection_v1.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    source,
    /CREATE OR REPLACE FUNCTION cimmich_probable_same_photo_derivative/,
  );
  // Each side selects exactly one deterministic projection row; a plain join
  // multiplied asset_pair on multi-projection assets and the scalar verdict
  // raised "more than one row", failing every guarded audit statement closed.
  assert.equal(
    (source.match(/LEFT JOIN LATERAL \(/g) || []).length,
    2,
  );
  assert.equal(
    (
      source.match(
        /ORDER BY projection\.source_id, projection\.immich_asset_id\s+LIMIT 1/g,
      ) || []
    ).length,
    2,
  );
  assert.doesNotMatch(source, /LEFT JOIN immich_asset_projection/);
  // The empty-pair false contract from 0099 is preserved.
  assert.match(
    source,
    /FROM asset_pair pair\s+CROSS JOIN face_counts count\s+CROSS JOIN matched_summary summary\s+\),\s+false\s+\)/,
  );
});
