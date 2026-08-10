import assert from "node:assert/strict";
import test from "node:test";
import { deferPrimeAfterCommand } from "../src/repository.mjs";

test("deferred Prime maintenance coalesces queued rebuilds per Person", async () => {
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
  // The second request is absorbed by the queued job instead of duplicating
  // the same full gallery rebuild before any work has started.
  assert.equal(runs, 1);
  releaseFirst();
  for (let attempt = 0; attempt < 20 && active > 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(runs, 1);
  assert.equal(maxActive, 1);
});

test("interactive identity commands schedule derived work on the maintenance pool", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../src/repository.mjs", import.meta.url), "utf8"),
  );
  const reassignment = source.slice(
    source.indexOf("async reassignFaceIdentity"),
    source.indexOf("async bulkReassignFaceIdentities"),
  );
  const move = source.slice(
    source.indexOf("async movePersonFace"),
    source.indexOf("async dismissMachineSuggestion"),
  );

  for (const method of [reassignment, move]) {
    assert.match(method, /deferPrimeForPeople\(maintenanceSql/);
    assert.doesNotMatch(method, /await refreshPrimeForPeople/);
  }
  assert.match(reassignment, /deferBodyLinksAfterCommand\(maintenanceSql/);
  assert.doesNotMatch(reassignment, /await refreshBodyLinksAfterCommand/);
});

test("deferred Prime maintenance retries a failed repository rebuild", async (t) => {
  t.mock.method(console, "error", () => {});
  let attempts = 0;
  const sql = async (strings) => {
    const statement = strings.join("?");
    if (statement.includes("retired_buckets")) {
      return [];
    }
    if (statement.includes("slug = 'holding'")) {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary repository failure");
      return [{ holding: true }];
    }
    throw new Error(
      `Unexpected Prime maintenance query: ${statement.slice(0, 80)}`,
    );
  };

  assert.equal(deferPrimeAfterCommand(sql, "person-retry"), true);
  for (let turn = 0; turn < 20 && attempts < 2; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(attempts, 2);
});
