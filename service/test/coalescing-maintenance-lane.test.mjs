import assert from "node:assert/strict";
import test from "node:test";

import { createCoalescingMaintenanceLane } from "../src/coalescing-maintenance-lane.mjs";

test("maintenance lane coalesces queued work and reruns a dirty active key once", async () => {
  const runs = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const lane = createCoalescingMaintenanceLane({
    concurrency: 1,
    name: "test",
    worker: async (key) => {
      runs.push(key);
      if (runs.length === 1) await firstGate;
    },
  });

  lane.schedule("person-one");
  lane.schedule("person-one");
  await new Promise((resolve) => setImmediate(resolve));
  lane.schedule("person-one");
  assert.deepEqual(runs, ["person-one"]);
  releaseFirst();
  await lane.whenIdle();

  assert.deepEqual(runs, ["person-one", "person-one"]);
  assert.equal(lane.snapshot().coalesced, 2);
  assert.equal(lane.snapshot().completed, 2);
});

test("maintenance lane bounds concurrency and honours queued priority", async () => {
  const order = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const lane = createCoalescingMaintenanceLane({
    concurrency: 1,
    name: "priority",
    worker: async (key) => {
      order.push(key);
      if (key === "first") await firstGate;
    },
  });

  lane.schedule("first", { priority: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  lane.schedule("background", { priority: 1 });
  lane.schedule("interactive-derived", { priority: 20 });
  releaseFirst();
  await lane.whenIdle();

  assert.deepEqual(order, ["first", "interactive-derived", "background"]);
});

test("maintenance lane retries bounded failures and completes the tracked job", async () => {
  const events = [];
  let attempts = 0;
  const lane = createCoalescingMaintenanceLane({
    maxAttempts: 3,
    name: "retry",
    onEvent: (event) => events.push(event),
    worker: async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("temporary rebuild failure");
    },
  });

  lane.schedule("person-retry");
  await lane.whenIdle();

  assert.equal(attempts, 3);
  assert.deepEqual(
    events.map(({ kind }) => kind),
    ["retrying", "retrying", "completed"],
  );
  assert.deepEqual(lane.snapshot(), {
    active: 0,
    coalesced: 0,
    completed: 1,
    failed: 0,
    name: "retry",
    pending: 0,
    retried: 2,
    tracked: 0,
  });
});

test("maintenance lane surfaces terminal failure after exhausting its retry budget", async () => {
  const events = [];
  const lane = createCoalescingMaintenanceLane({
    maxAttempts: 2,
    name: "exhausted",
    onEvent: (event) => events.push(event),
    worker: async () => {
      throw new Error("persistent rebuild failure");
    },
  });

  lane.schedule("person-exhausted");
  await lane.whenIdle();

  assert.deepEqual(
    events.map(({ attempt, kind, maxAttempts }) => ({
      attempt,
      kind,
      maxAttempts,
    })),
    [
      { attempt: 1, kind: "retrying", maxAttempts: 2 },
      { attempt: 2, kind: "failed", maxAttempts: 2 },
    ],
  );
  assert.equal(lane.snapshot().failed, 1);
  assert.equal(lane.snapshot().tracked, 0);
});
