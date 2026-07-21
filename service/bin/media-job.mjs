#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { createMediaJobLedger } from "../src/media-job-ledger.mjs";

const value = (name, fallback = "") => {
  const prefix = `--${name}=`;
  return (
    process.argv
      .find((argument) => argument.startsWith(prefix))
      ?.slice(prefix.length) || fallback
  );
};

const action = value("action", "status");
const databaseUrl =
  process.env.DATABASE_URL || "postgres://cimmich@postgres:5432/cimmich";
const sql = postgres(databaseUrl, { max: 2, prepare: true });
const ledger = createMediaJobLedger(sql);

try {
  let result;
  if (action === "enqueue") {
    result = await ledger.enqueue({
      assetId: value("asset-id"),
      configDigest: value("config-digest"),
      inputRevision: value("input-revision"),
      maxAttempts: Number(value("max-attempts", "3")),
      operation: value("operation"),
      toolVersion: value("tool-version"),
    });
  } else if (action === "claim") {
    result = await ledger.claim({
      batchSize: Number(value("batch-size", "1")),
      leaseSeconds: Number(value("lease-seconds", "300")),
      workerId: value("worker-id", `worker-${process.pid}`),
    });
  } else if (action === "checkpoint") {
    const checkpointFile = value("checkpoint-file");
    const payload = checkpointFile
      ? JSON.parse(await readFile(checkpointFile, "utf8"))
      : {};
    result = await ledger.checkpoint({
      jobId: value("job-id"),
      payload,
      stage: value("stage"),
      workerId: value("worker-id"),
    });
  } else if (action === "complete") {
    result = await ledger.complete({
      jobId: value("job-id"),
      resultDigest: value("result-digest"),
      resultReceiptId: value("result-receipt-id"),
      workerId: value("worker-id"),
    });
  } else if (action === "fail") {
    result = await ledger.fail({
      errorCode: value("error-code"),
      jobId: value("job-id"),
      workerId: value("worker-id"),
    });
  } else if (action === "get") {
    result = await ledger.get({ jobId: value("job-id") });
  } else if (action === "status") {
    result = await ledger.status();
  } else {
    throw new Error(`Unsupported media-job action: ${action}`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
