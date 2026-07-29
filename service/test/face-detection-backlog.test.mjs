import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runFaceDetectionBacklog } from "../src/face-detection-backlog.mjs";

test("discovery stages one binding per asset and workers read that exact revision", async () => {
  const [operator, worker] = await Promise.all([
    readFile(
      new URL("../bin/run-face-discovery-pilot.mjs", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/local-face-detection-worker.mjs", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(operator, /DISTINCT ON \(projection\.cimmich_asset_id\)/);
  assert.doesNotMatch(
    operator,
    /DISTINCT ON \(\s*projection\.cimmich_asset_id,\s*projection\.input_revision/,
  );
  assert.match(
    operator,
    /projection\.last_seen_at DESC,\s*projection\.input_revision,\s*projection\.immich_asset_id/,
  );
  assert.match(worker, /AND input_revision = \$\{job\.inputRevision\}/);
  assert.match(
    worker,
    /ORDER BY \(state = 'active'\) DESC, last_seen_at DESC, immich_asset_id/,
  );
});

test("detection backlog runs bounded concurrent workers without recognition", async () => {
  const queue = Array.from({ length: 12 }, (_, index) => ({
    faces: index % 3,
    id: index + 1,
  }));
  let active = 0;
  let peak = 0;
  let closed = 0;
  const workers = Array.from({ length: 4 }, () => ({
    async close() {
      closed += 1;
    },
    async runNext() {
      const item = queue.shift();
      if (!item) return { state: "idle" };
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return {
        observations: { inserted: item.faces, reused: 0 },
        outcome: item.faces ? "faces_detected" : "no_face",
        status: "completed",
      };
    },
  }));
  const scheduledOptions = [];
  const result = await runFaceDetectionBacklog({
    ensureJobs: async (options) => {
      scheduledOptions.push(options);
      return { ensuredJobs: 12 };
    },
    limitJobs: 12,
    priorityTierMax: 1,
    workers,
  });

  assert.equal(result.attempts, 12);
  assert.equal(result.completed, 12);
  assert.equal(result.failed, 0);
  assert.equal(result.facesDetected, 12);
  assert.equal(result.imagesWithFaces, 8);
  assert.equal(result.noFace, 4);
  assert.equal(result.providerProcesses, 4);
  assert.equal(result.scheduled, 12);
  assert.equal(result.sourceMediaWrite, "none");
  assert.equal(result.state, "bounded_run_complete");
  assert.deepEqual(scheduledOptions, [{ limit: 12, priorityTierMax: 1 }]);
  assert.equal(result.priorityTierMax, 1);
  assert.equal(peak, 4);
  assert.equal(closed, 4);
});

test("detection worker claim does not rescan archive triage for every asset", async () => {
  const source = await readFile(
    new URL("../src/local-face-detection-worker.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /triage AS MATERIALIZED/);
  assert.doesNotMatch(source, /JOIN media_asset_triage triage/);
  assert.match(source, /ORDER BY job\.requested_at, job\.job_id/);
});

test("detection backlog closes workers and reports a paused operator", async () => {
  let closed = 0;
  const result = await runFaceDetectionBacklog({
    ensureJobs: async () => ({ ensuredJobs: 0 }),
    limitJobs: 5,
    workers: [
      {
        async close() {
          closed += 1;
        },
        async runNext() {
          return { state: "paused" };
        },
      },
    ],
  });
  assert.equal(result.state, "paused");
  assert.equal(result.attempts, 0);
  assert.equal(closed, 1);
});
