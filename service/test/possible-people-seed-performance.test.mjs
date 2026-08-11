import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { processPossiblePeopleBatches } from "../src/possible-people-batch.mjs";
import {
  releaseReservedConnection,
  withReservedTransaction,
} from "../src/postgres-reserved.mjs";

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

test("Possible people batches reuse one session-local eligible candidate scope", async () => {
  const [scopeSource, storeSource, batchSource] = await Promise.all([
    readSource(),
    readFile(new URL("../src/possible-people.mjs", import.meta.url), "utf8"),
    readFile(
      new URL("../src/possible-people-batch.mjs", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(
    scopeSource,
    /CREATE TEMP TABLE possible_people_candidate_scope/,
  );
  assert.match(scopeSource, /ON COMMIT PRESERVE ROWS/);
  assert.match(scopeSource, /ANALYZE possible_people_candidate_scope/);
  assert.match(
    batchSource,
    /EXISTS \(\s*SELECT 1 FROM possible_people_candidate_scope scope/,
  );
  assert.doesNotMatch(
    batchSource,
    /JOIN current_matchable_physical_face candidate_face/,
  );
  assert.doesNotMatch(batchSource, /JOIN identity_claim accepted/);
  assert.match(storeSource, /workSql = await sql\.reserve\(\)/);
  assert.match(storeSource, /dropPossiblePeopleCandidateScope\(workSql\)/);
  assert.match(batchSource, /const batchWorkerCount = 4/);
  assert.match(
    batchSource,
    /Promise\.allSettled\(connections\.map\(consume\)\)/,
  );
});

test("Possible people batches fail closed at a bounded transaction timeout", async () => {
  const source = await readFile(
    new URL("../src/possible-people-batch.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /const batchStatementTimeoutMs = 10 \* 60 \* 1_000/);
  assert.match(
    source,
    /set_config\(\s*'statement_timeout', \$\{String\(batchStatementTimeoutMs\)\}, true\s*\)/,
  );
});

test("Possible people dispatches four bounded batches and releases temporary scopes", async () => {
  let activeBatches = 0;
  let completedBatches = 0;
  let maxActiveBatches = 0;
  let releasedConnections = 0;
  const createConnection = ({ reserved = false } = {}) => {
    const connection = async (strings) => {
      const query = strings.join("?");
      if (query.includes("INSERT INTO possible_person_edge")) {
        activeBatches += 1;
        maxActiveBatches = Math.max(maxActiveBatches, activeBatches);
        await new Promise((resolve) => setImmediate(resolve));
        activeBatches -= 1;
        completedBatches += 1;
      }
      return [];
    };
    if (!reserved) connection.begin = async (callback) => callback(connection);
    if (reserved)
      connection.release = () => {
        releasedConnections += 1;
      };
    return connection;
  };
  const coordinatorSql = createConnection({ reserved: true });
  const sql = createConnection();
  sql.reserve = async () => createConnection({ reserved: true });

  await processPossiblePeopleBatches({
    coordinatorSql,
    presentationRank: () => 2,
    run: {
      config_digest: "a".repeat(64),
      model_family: "private-test",
      model_version: "v1",
      processed_seeds: 0,
      run_id: "possible_run_parallel_test",
      total_seeds: 1_000,
    },
    space: {
      config_digest: "a".repeat(64),
      model_family: "private-test",
      model_version: "v1",
    },
    sql,
  });

  assert.equal(completedBatches, 4);
  assert.equal(maxActiveBatches, 4);
  assert.equal(releasedConnections, 3);
});

test("reserved PostgreSQL connections transact manually and release synchronously", async () => {
  const statements = [];
  const connection = async (strings) => {
    statements.push(strings.join("?"));
    return [];
  };
  connection.release = () => {};

  const result = await withReservedTransaction(connection, async (tx) => {
    await tx`SELECT 1`;
    return "committed";
  });
  await releaseReservedConnection(connection);

  assert.equal(result, "committed");
  assert.deepEqual(statements, ["BEGIN", "SELECT 1", "COMMIT"]);
});

test("reserved PostgreSQL transactions roll back and preserve the original error", async () => {
  const statements = [];
  const connection = async (strings) => {
    statements.push(strings.join("?"));
    return [];
  };
  const failure = new Error("expected failure");

  await assert.rejects(
    withReservedTransaction(connection, async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.deepEqual(statements, ["BEGIN", "ROLLBACK"]);
});
