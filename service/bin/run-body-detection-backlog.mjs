#!/usr/bin/env node

import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import process from "node:process";
import postgres from "postgres";
import {
  createBodyDetectionJobClaimQueue,
  createBodyDetectionJobWorker,
  ensureBodyDetectionJobs,
  runBodyDetectionBacklog,
} from "../src/body-detection-backlog.mjs";
import { createImmichCompanionManager } from "../src/immich-companion-manager.mjs";
import { createUltralyticsYoloBodyDetector } from "../src/ultralytics-yolo-body-detector.mjs";

const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : null;
  return value && !value.startsWith("--") ? value : fallback;
};
const boundedInteger = (value, label, minimum, maximum) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be from ${minimum} to ${maximum}`);
  }
  return number;
};
const required = (value, label) => {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`Body detection backlog requires ${label}`);
  return normalized;
};

const databaseUrl = required(process.env.DATABASE_URL, "DATABASE_URL");
const manifestPath = required(
  argument("manifest", process.env.CIMMICH_BODY_MANIFEST_PATH),
  "a manifest path",
);
const modelPath = required(
  argument("model", process.env.CIMMICH_BODY_MODEL_PATH),
  "a model path",
);
const pythonPath = required(
  argument("python", process.env.CIMMICH_BODY_PYTHON_PATH),
  "a Python path",
);
const scriptPath = required(
  argument(
    "provider",
    process.env.CIMMICH_BODY_PROVIDER_PATH ||
      new URL(
        "../../providers/ultralytics-yolo-body/provider.py",
        import.meta.url,
      ).pathname,
  ),
  "a provider path",
);
const sourceId = required(
  process.env.CIMMICH_IMMICH_SOURCE_ID || "immich-primary",
  "sourceId",
);
const limitJobs = boundedInteger(
  argument("limit-jobs", "100"),
  "limit-jobs",
  1,
  1_000_000,
);
const workerCount = boundedInteger(argument("workers", "2"), "workers", 1, 8);
const timeoutMs = boundedInteger(
  argument("timeout-ms", "120000"),
  "timeout-ms",
  1_000,
  600_000,
);
for (const [path, mode, label] of [
  [pythonPath, constants.X_OK, "Python runtime"],
  [scriptPath, constants.R_OK, "provider script"],
  [modelPath, constants.R_OK, "model"],
  [manifestPath, constants.R_OK, "manifest"],
]) {
  try {
    await access(path, mode);
  } catch {
    throw new Error(`Body detection backlog ${label} is unavailable: ${path}`);
  }
}
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const sql = postgres(databaseUrl, {
  max: Math.max(4, workerCount + 2),
  prepare: true,
});
const companion = await createImmichCompanionManager({
  apiBaseUrl: process.env.IMMICH_API_URL || "",
  apiKey: process.env.IMMICH_API_KEY || "",
  credentialFile: process.env.CIMMICH_IMMICH_CREDENTIAL_FILE || "",
});
const claimQueue = createBodyDetectionJobClaimQueue({
  configDigest: manifest.detectorConfigDigest,
  sourceId,
  sql,
});
const workers = Array.from({ length: workerCount }, (_, index) => {
  const detector = createUltralyticsYoloBodyDetector({
    manifest,
    manifestPath,
    modelPath,
    pythonPath,
    scriptPath,
    timeoutMs,
  });
  return createBodyDetectionJobWorker({
    claimQueue,
    companion,
    detector,
    manifest: detector.manifest,
    sourceId,
    sql,
    workerId: `cimmich-body-detection-backlog-${process.pid}-${index + 1}`,
  });
});

try {
  const summary = await runBodyDetectionBacklog({
    ensureJobs: ({ limit }) =>
      ensureBodyDetectionJobs(sql, {
        configDigest: manifest.detectorConfigDigest,
        limit,
        sourceId,
      }),
    limitJobs,
    onProgress: (progress) => {
      process.stderr.write(
        `${JSON.stringify({
          attempts: progress.attempts,
          bodiesDetected: progress.bodiesDetected,
          completed: progress.completed,
          failed: progress.failed,
        })}\n`,
      );
    },
    timeoutMs,
    workers,
  });
  process.stdout.write(
    `${JSON.stringify({
      ...summary,
      automaticIdentityAuthority: "none",
      detectorConfigDigest: manifest.detectorConfigDigest,
      providerRunsPerAsset: 2,
    })}\n`,
  );
} finally {
  await Promise.allSettled(workers.map((worker) => worker.close()));
  await sql.end({ timeout: 5 });
}
