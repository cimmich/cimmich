import assert from "node:assert/strict";
import postgres from "postgres";
import { createMediaJobLedger } from "../src/media-job-ledger.mjs";
import { createMediaOperator } from "../src/media-operator.mjs";
import { inventoryOnlyMediaOperatorEnvelope } from "../src/media-operator-contract.mjs";

const databaseUrl =
  process.env.DATABASE_URL || "postgres://cimmich@postgres:5432/cimmich";
const sql = postgres(databaseUrl, { max: 2, prepare: true });
const ledger = createMediaJobLedger(sql);
let inventoryCalls = 0;
let inventoryOnlyCalls = 0;
let detectionCalls = 0;
let continuationCalls = 0;
let recognitionCalls = 0;

const operator = createMediaOperator({
  continueDetection: async (jobId) => {
    assert.equal(jobId, "synthetic-operator-detection");
    continuationCalls += 1;
  },
  detectionWorker: {
    async runNext() {
      detectionCalls += 1;
      return { jobId: "synthetic-operator-detection", status: "completed" };
    },
  },
  inventory: {
    async synchronize({ maxPages }) {
      assert.equal(maxPages, 1);
      inventoryCalls += 1;
      return {
        pagesProcessed: 1,
        run: { runId: "synthetic-run", state: "completed" },
      };
    },
  },
  recognitionWorker: {
    async runNext() {
      recognitionCalls += 1;
      return { jobId: "synthetic-operator-recognition", status: "completed" };
    },
  },
  repository: {
    async machineSuggestions({ limit }) {
      assert.equal(limit, 5);
      return [{ face_id: "synthetic-operator-candidate" }];
    },
  },
  sql,
  workerId: "synthetic-media-operator",
});

try {
  const queued = await ledger.enqueue({
    assetId: "asset_service_fixture",
    configDigest: "e".repeat(64),
    inputRevision: "d".repeat(64),
    operation: "detect_faces",
    toolVersion: "synthetic-operator-pause-v1",
  });
  const paused = await operator.execute({
    actorId: "synthetic-operator",
    commandId: "operator-pause-0001",
    commandKind: "pause",
  });
  assert.equal(paused.state, "paused");
  assert.ok(paused.paused >= 1);
  assert.equal((await ledger.get({ jobId: queued.jobId })).state, "paused");
  const pauseReplay = await operator.execute({
    actorId: "synthetic-operator",
    commandId: "operator-pause-0001",
    commandKind: "pause",
  });
  assert.equal(pauseReplay.replayed, true);

  const stoppedRun = await operator.execute({
    actorId: "synthetic-operator",
    commandId: "operator-run-paused-0001",
    commandKind: "run",
    envelope: { candidateLimit: 5 },
  });
  assert.equal(stoppedRun.state, "paused");
  assert.deepEqual(stoppedRun.work, {
    candidates: 0,
    detections: 0,
    inventoryPages: 0,
    recognitions: 0,
  });

  const resumed = await operator.execute({
    actorId: "synthetic-operator",
    commandId: "operator-resume-0001",
    commandKind: "resume",
  });
  assert.equal(resumed.state, "running");
  assert.equal(resumed.resumed, paused.paused);
  assert.equal((await ledger.get({ jobId: queued.jobId })).state, "pending");
  await sql`DELETE FROM media_job WHERE job_id = ${queued.jobId}`;

  const completed = await operator.execute({
    actorId: "synthetic-operator",
    commandId: "operator-run-0001",
    commandKind: "run",
    envelope: {
      candidateLimit: 5,
      maxDetectionJobs: 1,
      maxDurationMs: 10_000,
      maxInventoryPages: 1,
      maxPendingJobs: 10,
      maxRecognitionJobs: 1,
    },
  });
  assert.equal(completed.state, "completed");
  assert.deepEqual(completed.work, {
    candidates: 1,
    detections: 1,
    inventoryPages: 1,
    recognitions: 1,
  });
  assert.equal(completed.activationAuthority, "none");
  assert.deepEqual(
    { continuationCalls, detectionCalls, inventoryCalls, recognitionCalls },
    {
      continuationCalls: 1,
      detectionCalls: 1,
      inventoryCalls: 1,
      recognitionCalls: 1,
    },
  );
  const replay = await operator.execute({
    actorId: "synthetic-operator",
    commandId: "operator-run-0001",
    commandKind: "run",
    envelope: {
      candidateLimit: 5,
      maxDetectionJobs: 1,
      maxDurationMs: 10_000,
      maxInventoryPages: 1,
      maxPendingJobs: 10,
      maxRecognitionJobs: 1,
    },
  });
  assert.equal(replay.replayed, true);
  assert.deepEqual(
    { continuationCalls, detectionCalls, inventoryCalls, recognitionCalls },
    {
      continuationCalls: 1,
      detectionCalls: 1,
      inventoryCalls: 1,
      recognitionCalls: 1,
    },
  );
  const inventoryOnly = createMediaOperator({
    inventory: {
      async synchronize({ maxPages }) {
        assert.equal(maxPages, 1);
        inventoryOnlyCalls += 1;
        return {
          admittedAssetCount: 1,
          admittedAssets: [
            {
              assetId: "asset-synthetic-inventory-only",
              sourceAssetId: "source-synthetic-inventory-only",
            },
          ],
          admittedAssetsTruncated: false,
          pagesProcessed: 1,
          run: { runId: "synthetic-inventory-only", state: "completed" },
        };
      },
    },
    repository: {
      async machineSuggestions() {
        throw new Error("inventory-only operation queried suggestions");
      },
    },
    sql,
    workerId: "synthetic-inventory-only-operator",
  });
  const inventoryOnlyResult = await inventoryOnly.execute({
    actorId: "synthetic-operator",
    commandId: "operator-inventory-only-0001",
    commandKind: "run",
    envelope: inventoryOnlyMediaOperatorEnvelope,
  });
  assert.equal(inventoryOnlyResult.state, "completed");
  assert.deepEqual(inventoryOnlyResult.work, {
    candidates: 0,
    detections: 0,
    inventoryPages: 1,
    recognitions: 0,
  });
  assert.deepEqual(inventoryOnlyResult.inventory.admittedAssets, [
    {
      assetId: "asset-synthetic-inventory-only",
      sourceAssetId: "source-synthetic-inventory-only",
    },
  ]);
  assert.equal(inventoryOnlyCalls, 1);
  const backlog = await ledger.enqueue({
    assetId: "asset_service_fixture",
    configDigest: "c".repeat(64),
    inputRevision: "b".repeat(64),
    operation: "detect_faces",
    toolVersion: "synthetic-operator-backpressure-v1",
  });
  const backpressured = await operator.execute({
    actorId: "synthetic-operator",
    commandId: "operator-backpressure-0001",
    commandKind: "run",
    envelope: {
      candidateLimit: 5,
      maxDetectionJobs: 0,
      maxDurationMs: 10_000,
      maxInventoryPages: 1,
      maxPendingJobs: 1,
      maxRecognitionJobs: 0,
    },
  });
  assert.equal(backpressured.state, "backpressure");
  assert.equal(backpressured.work.inventoryPages, 0);
  assert.equal(inventoryCalls, 1);
  await sql`DELETE FROM media_job WHERE job_id = ${backlog.jobId}`;
  await assert.rejects(
    () =>
      operator.execute({
        actorId: "synthetic-operator",
        commandId: "operator-run-0001",
        commandKind: "run",
        envelope: { candidateLimit: 6 },
      }),
    (error) => error.code === "MEDIA_OPERATOR_COMMAND_CONFLICT",
  );

  process.stdout.write(
    `${JSON.stringify({
      activationAuthority: completed.activationAuthority,
      backpressureDeferredInventory: backpressured.work.inventoryPages === 0,
      commandReplayStable: replay.replayed,
      pauseReplayStable: pauseReplay.replayed,
      pausedJobs: paused.paused,
      resumedJobs: resumed.resumed,
      schemaVersion: completed.schemaVersion,
      state: completed.state,
      status: "PASS",
      work: completed.work,
    })}\n`,
  );
} finally {
  await sql.end({ timeout: 5 });
}
