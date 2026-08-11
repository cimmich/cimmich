import assert from "node:assert/strict";
import test from "node:test";
import { createPossiblePeopleStore } from "../src/possible-people.mjs";

const createSqlStub = () => {
  const sql = async () => [];
  sql.begin = async (callback) => callback(sql);
  sql.json = (value) => value;
  return sql;
};

test("Possible people refresh acknowledges before physical reconciliation completes", async () => {
  const sql = createSqlStub();
  let reconciliationStarted;
  const started = new Promise((resolve) => {
    reconciliationStarted = resolve;
  });
  const neverCompletes = new Promise(() => {});
  const store = createPossiblePeopleStore(sql, {
    reconcilePhysicalFaces: () => {
      reconciliationStarted();
      return neverCompletes;
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
});
