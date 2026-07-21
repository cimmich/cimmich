#!/usr/bin/env node
import postgres from "postgres";
import {
  runSourcePackRebuildWorker,
  sourcePackRebuildQueueStatus,
} from "../src/source-pack-rebuild-worker.mjs";

const value = (name, fallback = "") => {
  const prefix = `--${name}=`;
  return (
    process.argv
      .find((argument) => argument.startsWith(prefix))
      ?.slice(prefix.length) || fallback
  );
};
const action = value("action", "run");
const databaseUrl =
  process.env.DATABASE_URL || "postgres://cimmich@postgres:5432/cimmich";
const sql = postgres(databaseUrl, { max: 2, prepare: true });
try {
  const result =
    action === "status"
      ? await sourcePackRebuildQueueStatus(sql)
      : await runSourcePackRebuildWorker(sql, {
          batchSize: Number(value("batch-size", "500")),
          configDigest: value("config-digest"),
          cutoff: value("cutoff", new Date().toISOString()),
          leaseSeconds: Number(value("lease-seconds", "300")),
          maxAttempts: Number(value("max-attempts", "3")),
          maxCycles: Number(value("max-cycles", "10")),
          modelFamily: value("model-family"),
          modelVersion: value("model-version"),
          workerId: value("worker-id", `worker-${process.pid}`),
        });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
