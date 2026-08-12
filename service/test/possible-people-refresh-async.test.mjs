import assert from "node:assert/strict";
import test from "node:test";
import { createPossiblePeopleStore } from "../src/possible-people.mjs";

const createSqlStub = (handler = async () => []) => {
  const sql = async (strings, ...values) => handler(strings.join("?"), values);
  sql.begin = async (callback) => callback(sql);
  sql.json = (value) => value;
  return sql;
};

test("Possible people refresh acknowledges before physical reconciliation completes", async () => {
  const sql = createSqlStub(async (query) =>
    query.includes("SELECT state FROM possible_person_run")
      ? [{ state: "queued" }]
      : [],
  );
  let reconciliationStarted;
  const started = new Promise((resolve) => {
    reconciliationStarted = resolve;
  });
  let finishReconciliation;
  const reconciliation = new Promise((resolve) => {
    finishReconciliation = resolve;
  });
  const store = createPossiblePeopleStore(sql, {
    reconcilePhysicalFaces: () => {
      reconciliationStarted();
      return reconciliation;
    },
  });

  const result = await Promise.race([
    store.refresh({
      actorId: "owner",
      commandId: "possible-people.async-refresh",
    }),
    new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error("refresh waited for reconciliation")),
        100,
      );
    }),
  ]);

  await started;
  assert.equal(result.changed, true);
  assert.equal(result.run.state, "queued");
  assert.equal(result.run.processedSeeds, 0);
  finishReconciliation();
  await store.waitForIdle();
});

test("Possible people refresh acknowledges a locked queued run without waiting", async () => {
  const activeRun = {
    cluster_count: 0,
    completed_at: null,
    created_at: new Date().toISOString(),
    edge_count: 0,
    error_code: null,
    error_message: null,
    processed_seeds: 0,
    run_id: "possible_run_interrupted",
    started_at: null,
    state: "queued",
    total_seeds: 0,
  };
  let releaseLock;
  const locked = new Promise((resolve) => {
    releaseLock = () => resolve([]);
  });
  const sql = createSqlStub(async (query) => {
    if (query.includes("WHERE state IN ('queued','running')")) {
      if (query.includes("FOR UPDATE")) return locked;
      return [activeRun];
    }
    if (query.includes("WHERE run_id = ? FOR UPDATE")) return locked;
    return [];
  });
  const store = createPossiblePeopleStore(sql);

  const result = await Promise.race([
    store.refresh({
      actorId: "owner",
      commandId: "possible-people.locked-refresh",
    }),
    new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error("refresh waited for the run lock")),
        100,
      );
    }),
  ]);

  assert.equal(result.changed, false);
  assert.equal(result.run.runId, activeRun.run_id);
  assert.equal(result.run.state, "queued");
  releaseLock();
  await store.waitForIdle();
});
