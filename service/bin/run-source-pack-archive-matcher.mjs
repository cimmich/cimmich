#!/usr/bin/env node
import postgres from "postgres";
import { fileURLToPath } from "node:url";
import { runLocalSourcePackArchiveMatcher } from "../src/source-pack-local-archive-matcher.mjs";
import { runSourcePackArchiveMatcher } from "../src/source-pack-archive-matcher.mjs";

const value = (name, fallback = "") => {
  const prefix = `--${name}=`;
  return (
    process.argv
      .find((argument) => argument.startsWith(prefix))
      ?.slice(prefix.length) || fallback
  );
};

const sql = postgres(
  process.env.DATABASE_URL || "postgres://cimmich@postgres:5432/cimmich",
  { max: 2, prepare: true },
);
try {
  const options = {
    batchSize: value("batch-size", "1000"),
    execute: process.argv.includes("--execute"),
    laneCount: value("lane-count", "1"),
    laneIndex: value("lane-index", "0"),
    limitFaces: value("limit-faces", "0"),
    packId: value("pack-id"),
    possibleRunId: value("possible-run-id"),
    referenceMode: process.argv.includes("--current-all-diagnostic")
      ? "current_all"
      : process.argv.includes("--current-prime-diagnostic")
        ? "current_prime"
        : "source_pack",
    pythonPath: value("python"),
    scriptPath: fileURLToPath(
      new URL("../../providers/source-pack-numpy/score.py", import.meta.url),
    ),
  };
  const result = options.pythonPath
    ? await runLocalSourcePackArchiveMatcher(sql, options)
    : await runSourcePackArchiveMatcher(sql, options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
