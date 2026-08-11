import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = () =>
  readFile(new URL("../src/possible-people-seed.mjs", import.meta.url), "utf8");

test("Possible people builds claimed and review projections once before seeding", async () => {
  const source = await readSource();
  assert.match(source, /WITH claimed_physical AS MATERIALIZED/);
  assert.match(source, /claim\.state IN \('accepted', 'candidate'\)/);
  assert.match(source, /latest_face_review AS MATERIALIZED/);
  assert.match(source, /ranked AS MATERIALIZED/);
  assert.match(
    source,
    /LEFT JOIN claimed_physical claimed\s+ON claimed\.physical_face_id = face\.physical_face_id/,
  );
  assert.match(source, /claimed\.physical_face_id IS NULL/);
  assert.doesNotMatch(source, /JOIN identity_claim accepted/);
  assert.doesNotMatch(source, /JOIN identity_claim candidate/);
});

test("Possible people seed work fails closed at the bounded transaction timeout", async () => {
  const [source, storeSource] = await Promise.all([
    readSource(),
    readFile(new URL("../src/possible-people.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(source, /const seedStatementTimeoutMs = 10 \* 60 \* 1_000/);
  assert.match(
    source,
    /set_config\(\s*'statement_timeout', \$\{String\(seedStatementTimeoutMs\)\}, true\s*\)/,
  );
  assert.match(
    storeSource,
    /WHERE run_id = \$\{runId\} AND state IN \('queued','running'\)/,
  );
});
