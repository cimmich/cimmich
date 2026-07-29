import assert from "node:assert/strict";
import test from "node:test";
import { createCimmichRepository } from "../src/repository.mjs";
import { createFragmentAwareSql } from "./fixtures/fragment-aware-sql.mjs";

test("people() includes presentation-media joins by default", async () => {
  let statement = "";
  const sql = createFragmentAwareSql((text) => {
    statement = text;
  });
  const repository = createCimmichRepository(sql);

  await repository.people();

  assert.match(statement, /person_presentation_media presentation_face/);
  assert.match(statement, /person_presentation_media presentation_body/);
  assert.match(statement, /presentation_face_asset\.asset_id AS presentation_face_asset_id/);
});

test("people({ includePresentation: false }) omits the presentation joins but keeps the projection columns", async () => {
  let statement = "";
  const sql = createFragmentAwareSql((text) => {
    statement = text;
  });
  const repository = createCimmichRepository(sql);

  await repository.people({ includePresentation: false });

  assert.doesNotMatch(statement, /person_presentation_media/);
  assert.match(statement, /NULL AS presentation_face_asset_id/);
  assert.match(statement, /NULL AS presentation_body_asset_id/);
  // The representative and body-preview joins that cards rely on stay.
  assert.match(statement, /LEFT JOIN asset representative_asset/);
  assert.match(statement, /LEFT JOIN asset body_asset/);
});
