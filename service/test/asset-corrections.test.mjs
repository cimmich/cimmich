import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("asset corrections preserve the Cimmich and source-media boundary", async () => {
  const [store, routes] = await Promise.all([
    readFile(new URL("../src/asset-corrections.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/review-routes.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(store, /current_asset_correction/);
  assert.match(store, /cimmich_visibility_asset_rank/);
  assert.match(store, /cimmich_visibility_context_entity_rank/);
  assert.match(store, /state = 'superseded'/);
  assert.match(store, /state = 'reverted'/);
  assert.match(store, /likely_sideways_face/);
  assert.match(store, /future_capture_time/);
  assert.match(store, /multiple_current_places/);
  assert.doesNotMatch(store, /UPDATE\s+immich|writeFile|rename\(|copyFile/i);
  assert.match(routes, /\/v1\/assets\/corrections\/rotation/);
  assert.match(routes, /\/v1\/assets\/corrections\/rotation:set/);
  assert.match(routes, /setAssetRotations/);
  assert.match(routes, /\/v1\/review\/photo-details/);
  assert.match(routes, /undoAssetCorrections/);
});

test("rotation review supports bounded absolute save and confirmation batches", async () => {
  const [store, repository, routes] = await Promise.all([
    readFile(new URL("../src/asset-corrections.mjs", import.meta.url), "utf8"),
    readFile(
      new URL("../src/asset-correction-repository.mjs", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../src/review-routes.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(store, /cleanRotationChanges/);
  assert.match(store, /quarterTurns < 0/);
  assert.match(store, /quarterTurns > 3/);
  assert.match(store, /const setRotation = async/);
  assert.match(store, /quarterTurns: change\.quarterTurns/);
  assert.match(store, /commandKind: "rotate"/);
  assert.match(repository, /setAssetRotations: store\.setRotation/);
  assert.match(routes, /changes: body\.changes/);
});

test("asset correction review uses face roll only as a proposal", async () => {
  const store = await readFile(
    new URL("../src/asset-corrections.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    store,
    /abs\(\(measurement\.pose->>'rollDegrees'\)::float8\) BETWEEN 55 AND 125/,
  );
  assert.match(store, /measurement\.measurement_state = 'measured'/);
  assert.match(store, /correction\.correction_kind = 'rotation'/);
  assert.match(store, /correction\.correction_kind = 'place'/);
  assert.doesNotMatch(store, /rotate\(.*likely_sideways_face/s);
});
