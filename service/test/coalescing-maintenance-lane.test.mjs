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
