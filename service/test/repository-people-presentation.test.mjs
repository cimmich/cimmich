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
  assert.match(
    statement,
    /presentation_face_asset\.asset_id AS presentation_face_asset_id/,
  );
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

test("people() replaces per-row asset visibility calls with one hidden-asset set", async () => {
  let statement = "";
  const sql = createFragmentAwareSql((text) => {
    statement = text;
  });
  const repository = createCimmichRepository(sql);

  await repository.people();

  assert.match(statement, /hidden_assets AS MATERIALIZED/);
  assert.match(statement, /cimmich_visibility_object/);
  // Interpolations inside SQL comments still bind protocol parameters, but
  // PostgreSQL cannot see their use and rejects the statement with 42P18.
  assert.doesNotMatch(statement, /--[^\n]*\?/);
  // No CTE may fall back to the per-row function; only the person-level rank
  // check and the shared presentation joins keep their function calls.
  assert.doesNotMatch(
    statement,
    /cimmich_visibility_asset_rank\(fo\.asset_id\)/,
  );
  assert.doesNotMatch(
    statement,
    /cimmich_visibility_asset_rank\(observation\.asset_id\)/,
  );
  assert.doesNotMatch(
    statement,
    /cimmich_visibility_asset_rank\(presence\.asset_id\)/,
  );
  assert.match(statement, /cimmich_visibility_subject_rank/);
  assert.match(statement, /\?::text <> ''/);
  assert.match(statement, /\?::text = ''/);
});

test("the unfiltered whole-grid People read is served from the hot snapshot until cleared", async () => {
  let queries = 0;
  const sql = createFragmentAwareSql(() => {
    queries += 1;
  });
  const repository = createCimmichRepository(sql);

  await repository.people({ limit: 500 });
  await repository.people({ limit: 500 });
  assert.equal(queries, 1);

  // Scoped, searched, and smaller variants never touch the snapshot.
  await repository.people({ limit: 500, query: "ann" });
  assert.equal(queries, 2);
  await repository.people({ limit: 100 });
  assert.equal(queries, 3);

  repository.clearPeopleHotSnapshot();
  await repository.people({ limit: 500 });
  assert.equal(queries, 4);
});
