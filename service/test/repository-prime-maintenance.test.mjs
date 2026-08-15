import assert from "node:assert/strict";
import test from "node:test";
import {
  createCimmichRepository,
  deferPrimeAfterCommand,
} from "../src/repository.mjs";

test("repository exposes the extracted maintenance idle barrier", async () => {
  const repository = createCimmichRepository(async () => [], new Map(), {
    currentRank: () => 0,
  });
  await repository.whenMaintenanceIdle();
});

test("Prime maintenance prices the outside-Person competitor only for imported body evidence", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL("../src/prime-curator-repository.mjs", import.meta.url),
      "utf8",
    ),
  );
  const competitor = source.slice(
    source.indexOf("LEFT JOIN LATERAL (\n      SELECT max(1 -"),
    source.indexOf("LEFT JOIN LATERAL (\n      SELECT g.bucket_kind"),
  );
  assert.match(competitor, /source_instance_suffix/);
  assert.match(competitor, /\) = '2'\s+AND other\.person_id/);
});

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
    if (statement.includes("FROM current_face_identity cfi")) {
      runs += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (runs === 1) await firstGate;
      active -= 1;
      return [];
    }
    if (statement.includes("UPDATE reference_prototype")) return [];
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

test("deferred Prime maintenance retries a failed repository rebuild with the original error", async (t) => {
  t.mock.method(console, "error", () => {});
  const warnings = [];
  t.mock.method(console, "warn", (message) => warnings.push(message));
  let attempts = 0;
  const sql = async (strings) => {
    const statement = strings.join("?");
    if (statement.includes("FROM current_face_identity cfi")) {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary repository failure");
      return [];
    }
    if (statement.includes("UPDATE reference_prototype")) return [];
    throw new Error(
      `Unexpected Prime maintenance query: ${statement.slice(0, 80)}`,
    );
  };

  assert.equal(deferPrimeAfterCommand(sql, "person-retry"), true);
  for (let turn = 0; turn < 40 && attempts < 2; turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(attempts, 2);
  assert.equal(warnings.length, 1);
  const event = JSON.parse(warnings[0]);
  assert.equal(event.code, "CIMMICH_MAINTENANCE_RETRYING");
  assert.equal(event.error, "temporary repository failure");
  assert.equal(event.retryDelayMs, 250);
});

test("deferred Body linkage retries instead of silently completing a failed projection", async (t) => {
  const warnings = [];
  t.mock.method(console, "warn", (message) =>
    warnings.push(JSON.parse(message)),
  );
  let attempts = 0;
  const sql = async (strings) => {
    const statement = strings.join("?");
    if (statement.includes("FROM face_observation fo")) {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary body linkage failure");
      return [];
    }
    if (statement.includes("CREATE TEMP TABLE")) return [];
    return [];
  };

  const { deferBodyLinksAfterCommand, waitForMaintenanceIdle } =
    await import("../src/repository.mjs");
  assert.equal(deferBodyLinksAfterCommand(sql, "asset-retry"), true);
  await waitForMaintenanceIdle(sql);

  assert.equal(attempts, 2);
  assert.equal(warnings[0].code, "CIMMICH_MAINTENANCE_RETRYING");
  assert.equal(warnings[0].error, "temporary body linkage failure");
});
