import assert from "node:assert/strict";
import test from "node:test";
import { deferPrimeAfterCommand } from "../src/repository.mjs";

test("deferred Prime maintenance serializes rebuilds per Person", async () => {
  let runs = 0;
  let active = 0;
  let maxActive = 0;
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const sql = async (strings) => {
    const statement = strings.join("?");
    if (statement.includes("slug = 'holding'")) {
      runs += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (runs === 1) await firstGate;
      active -= 1;
      return [{ holding: true }];
    }
    if (statement.includes("retired_buckets")) return [];
    throw new Error(
      `Unexpected Prime maintenance query: ${statement.slice(0, 80)}`,
    );
  };

  assert.equal(deferPrimeAfterCommand(sql, "person-serialized"), true);
  assert.equal(deferPrimeAfterCommand(sql, "person-serialized"), true);
  await new Promise((resolve) => setImmediate(resolve));
  // The second rebuild for the same Person queues behind the first instead of
  // racing it.
  assert.equal(runs, 1);
  releaseFirst();
  for (let attempt = 0; attempt < 20 && runs < 2; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(runs, 2);
  assert.equal(maxActive, 1);
});
