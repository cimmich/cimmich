#!/usr/bin/env node

import postgres from "postgres";
import {
  argumentValue as argument,
  boundedInteger,
} from "../src/bin-arguments.mjs";
import { createImmichCompanionManager } from "../src/immich-companion-manager.mjs";
import { createImmichInventorySynchronizer } from "../src/immich-inventory.mjs";
import { runFaceDetectionBacklog } from "../src/face-detection-backlog.mjs";
import { createLocalFaceDetectionWorker } from "../src/local-face-detection-worker.mjs";
import { loadLocalMediaProviderRuntime } from "../src/local-media-provider-runtime.mjs";

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
if (!databaseUrl) {
  throw new Error("Face detection backlog requires DATABASE_URL");
}
const limitJobs = boundedInteger(
  argument("limit-jobs", "100"),
  "limit-jobs",
  1,
  1_000_000,
);
const workerCount = boundedInteger(
  argument("workers", "4"),
  "workers",
  1,
  8,
);
const priorityTierMax = boundedInteger(
  argument("priority-tier-max", "1"),
  "priority-tier-max",
  0,
  2,
);
const timeoutMs = boundedInteger(
  argument("timeout-ms", "120000"),
  "timeout-ms",
  1_000,
  600_000,
);
const sourceId = String(
  process.env.CIMMICH_IMMICH_SOURCE_ID || "immich-primary",
).trim();
const sql = postgres(databaseUrl, {
  max: Math.max(4, workerCount + 2),
  prepare: true,
});
const companion = await createImmichCompanionManager({
  apiBaseUrl: process.env.IMMICH_API_URL || "",
  apiKey: process.env.IMMICH_API_KEY || "",
  credentialFile: process.env.CIMMICH_IMMICH_CREDENTIAL_FILE || "",
});
const runtimes = await Promise.all(
  Array.from({ length: workerCount }, () => loadLocalMediaProviderRuntime()),
);

try {
  if (runtimes.some((runtime) => !runtime.detectionEnabled)) {
    throw new Error("Face detection backlog requires an enabled local provider");
  }
  const providerDigest = runtimes[0].detectorManifest.detectorConfigDigest;
  if (
    runtimes.some(
      (runtime) =>
        runtime.detectorManifest.detectorConfigDigest !== providerDigest,
    )
  ) {
    throw new Error("Face detection backlog workers bind different detectors");
  }
  const [queueBoundary] = await sql`
    SELECT count(*)::int AS outside_tier_count
    FROM media_job job
    JOIN media_asset_triage triage ON triage.asset_id = job.asset_id
    WHERE job.operation = 'detect_faces'
      AND job.config_digest = ${providerDigest}
      AND job.state IN ('pending', 'processing')
      AND triage.priority_tier > ${priorityTierMax}
  `;
  if (Number(queueBoundary?.outside_tier_count || 0) > 0) {
    throw new Error(
      `Face detection queue contains ${queueBoundary.outside_tier_count} jobs outside priority tier ${priorityTierMax}`,
    );
  }
  const inventory = createImmichInventorySynchronizer({
    companion,
    job: runtimes[0].inventoryJob,
    sourceId,
    sql,
  });
  const workers = runtimes.map((runtime, index) => {
    const worker = createLocalFaceDetectionWorker({
      companion,
      detector: runtime.detector,
      manifest: runtime.detectorManifest,
      sql,
      workerId: `cimmich-face-detection-backlog-${process.pid}-${index + 1}`,
    });
    return {
      close: () => runtime.recognizer?.close?.(),
      runNext: (options) => worker.runNext(options),
    };
  });
  const summary = await runFaceDetectionBacklog({
    ensureJobs: (options) => inventory.ensureCurrentJobs(options),
    limitJobs,
    onProgress: (progress) => {
      process.stderr.write(
        `${JSON.stringify({
          attempts: progress.attempts,
          completed: progress.completed,
          failed: progress.failed,
          facesDetected: progress.facesDetected,
        })}\n`,
      );
    },
    priorityTierMax,
    timeoutMs,
    workers,
  });
  process.stdout.write(
    `${JSON.stringify({
      ...summary,
      activationAuthority: "none",
      detectorConfigDigest: providerDigest,
      recognitionJobsCreated: 0,
    })}\n`,
  );
} finally {
  await Promise.allSettled(
    runtimes.map((runtime) => runtime.recognizer?.close?.()),
  );
  await sql.end({ timeout: 5 });
}
