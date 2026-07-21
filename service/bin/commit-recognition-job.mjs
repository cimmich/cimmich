#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { commitRecognitionJobResult } from "../src/recognition-job-commit.mjs";

const value = (name) => {
  const prefix = `--${name}=`;
  return (
    process.argv
      .find((argument) => argument.startsWith(prefix))
      ?.slice(prefix.length) || ""
  );
};

const checkpointPath = value("checkpoint");
const manifestPath = value("manifest");
if (
  !checkpointPath ||
  !manifestPath ||
  !value("job-id") ||
  !value("worker-id")
) {
  throw new Error(
    "Usage: commit-recognition-job --job-id=ID --worker-id=ID --manifest=FILE --checkpoint=FILE",
  );
}
const [manifest, checkpoint] = await Promise.all([
  readFile(manifestPath, "utf8").then(JSON.parse),
  readFile(checkpointPath, "utf8").then(JSON.parse),
]);
const databaseUrl =
  process.env.DATABASE_URL || "postgres://cimmich@postgres:5432/cimmich";
const sql = postgres(databaseUrl, { max: 2, prepare: true });
try {
  const result = await commitRecognitionJobResult(sql, {
    checkpoint,
    jobId: value("job-id"),
    manifest,
    workerId: value("worker-id"),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
