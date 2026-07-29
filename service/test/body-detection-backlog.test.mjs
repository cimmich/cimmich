import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createBodyDetectionJobClaimQueue,
  ensureBodyDetectionJobs,
  runBodyDetectionBacklog,
} from "../src/body-detection-backlog.mjs";

test("body operator preflights every local runtime input before database work", async () => {
  const source = await readFile(
    new URL("../bin/run-body-detection-backlog.mjs", import.meta.url),
    "utf8",
  );
  const preflight = source.indexOf("await access(path, mode)");
  assert.ok(preflight > 0);
  assert.ok(preflight < source.indexOf("const sql = postgres"));
  assert.match(source, /constants\.X_OK, "Python runtime"/);
  assert.match(source, /constants\.R_OK, "provider script"/);
  assert.match(source, /constants\.R_OK, "model"/);
  assert.match(source, /constants\.R_OK, "manifest"/);
});

test("body ingest persists observations without invoking identity linkage", async () => {
  const source = await readFile(
    new URL("../src/body-detection-backlog.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /face-body-linker-repository/);
  assert.doesNotMatch(source, /applyFaceBodyLinks/);
  assert.doesNotMatch(source, /buildFaceBodyLinks/);
  assert.match(source, /automaticIdentityWrites: 0/);
  assert.match(source, /matcherInvocations: 0/);
});

test("body scheduling is current-result aware and materializes live media triage once", async () => {
  const queries = [];
  const transaction = async (strings, ...values) => {
    queries.push({ text: strings.join("?"), values });
    return queries.length === 1
      ? [{ asset_id: "asset-person-linked", input_revision: "8".repeat(64) }]
      : [];
  };
  const sql = {
    begin: async (callback) => callback(transaction),
  };
  assert.deepEqual(
    await ensureBodyDetectionJobs(sql, {
      configDigest: "7".repeat(64),
      limit: 25,
      sourceId: "archive-source",
    }),
    { eligibleAssets: 1, ensuredJobs: 1 },
  );
  assert.match(
    queries[0].text,
    /triage_projection AS MATERIALIZED \(\s*SELECT \* FROM media_asset_triage/,
  );
  assert.match(queries[0].text, /JOIN triage_projection triage/);
  assert.match(queries[0].text, /ORDER BY triage\.priority_tier/);
  assert.match(queries[0].text, /DISTINCT ON \(projection\.cimmich_asset_id\)/);
  assert.doesNotMatch(
    queries[0].text,
    /DISTINCT ON \(\s*projection\.cimmich_asset_id,\s*projection\.input_revision/,
  );
  assert.match(
    queries[0].text,
    /projection\.last_seen_at DESC,\s*projection\.input_revision,\s*projection\.immich_asset_id/,
  );
  assert.match(queries[0].text, /current_asset_source_revision/);
  assert.match(queries[0].text, /job\.operation = 'detect_bodies'/);
  assert.match(queries[0].text, /job\.tool_version/);
  assert.doesNotMatch(
    queries[0].text,
    /job\.input_revision = projection\.input_revision/,
  );
  assert.deepEqual(queries[0].values, [
    "archive-source",
    "7".repeat(64),
    "cimmich-resident-body-detection-v2",
    "7".repeat(64),
    25,
  ]);
  assert.match(queries[1].text, /enqueue_media_job/);
  assert.deepEqual(queries[1].values, [
    "asset-person-linked",
    "cimmich-resident-body-detection-v2",
    "7".repeat(64),
    "8".repeat(64),
    3,
  ]);
});

test("body workers share one bounded materialized-triage claim window", async () => {
  const queries = [];
  let rankedReads = 0;
  const transaction = async (strings, ...values) => {
    const text = strings.join("?");
    queries.push({ text, values });
    if (
      text.includes("SELECT job.job_id") &&
      text.includes("triage_projection")
    ) {
      rankedReads += 1;
      return [{ job_id: "job-a" }, { job_id: "job-b" }];
    }
    if (text.includes("WITH claimed AS")) {
      return [
        {
          job_id: values.find((value) => String(value).startsWith("job-")),
          state: "processing",
        },
      ];
    }
    return [];
  };
  const sql = {
    begin: async (callback) => callback(transaction),
  };
  const queue = createBodyDetectionJobClaimQueue({
    configDigest: "7".repeat(64),
    sourceId: "archive-source",
    sql,
    windowSize: 64,
  });
  const [first, second] = await Promise.all([
    queue.claimNext({ workerId: "worker-a" }),
    queue.claimNext({ workerId: "worker-b" }),
  ]);
  assert.equal(rankedReads, 1);
  assert.deepEqual(
    new Set([first.job_id, second.job_id]),
    new Set(["job-a", "job-b"]),
  );
  assert.match(
    queries.find((query) => query.text.includes("triage_projection")).text,
    /triage_projection AS MATERIALIZED/,
  );
  assert.match(
    queries.find((query) => query.text.includes("triage_projection")).text,
    /ORDER BY triage\.priority_tier/,
  );
  assert.equal(
    queries.filter((query) => query.text.includes("WITH claimed AS")).length,
    2,
  );
});

test("body backlog is bounded, parallel, replay-run explicit, and closes workers", async () => {
  const calls = [0, 0];
  const closed = [false, false];
  const results = [
    [
      {
        bodyCount: 2,
        outcome: "bodies_detected",
        providerRuns: 2,
        state: "completed",
      },
      { state: "idle" },
    ],
    [
      {
        bodyCount: 0,
        outcome: "no_body",
        providerRuns: 2,
        state: "completed",
      },
      {
        bodyCount: 0,
        outcome: "source_unreadable",
        providerRuns: 2,
        state: "completed",
      },
      { state: "idle" },
    ],
  ];
  const workers = results.map((queue, index) => ({
    close: async () => {
      closed[index] = true;
    },
    runNext: async () => {
      calls[index] += 1;
      return queue.shift() || { state: "idle" };
    },
  }));
  const summary = await runBodyDetectionBacklog({
    ensureJobs: async ({ limit }) => ({ ensuredJobs: Math.min(2, limit) }),
    limitJobs: 5,
    workers,
  });
  assert.equal(summary.completed, 3);
  assert.equal(summary.bodiesDetected, 2);
  assert.equal(summary.imagesWithBodies, 1);
  assert.equal(summary.noBody, 1);
  assert.equal(summary.sourceUnreadable, 1);
  assert.equal(summary.providerProcesses, 2);
  assert.deepEqual(closed, [true, true]);
  assert.ok(calls.every((value) => value >= 1));
});
