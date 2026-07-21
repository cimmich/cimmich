#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import postgres from "postgres";
import { runPhotoIsolatedEvaluation } from "../src/source-pack-photo-holdout-repository.mjs";

const args = process.argv.slice(2);
const execute = args.includes("--execute");
const value = (name, fallback = "") =>
  args
    .find((argument) => argument.startsWith(`--${name}=`))
    ?.slice(name.length + 3) || fallback;
const cutoff = value("cutoff");
if (!cutoff) {
  throw new Error(
    "Usage: evaluate-photo-isolated.mjs --cutoff=<ISO timestamp> [--seed=<seed>] [--execute]",
  );
}

const queryConditionsPath = value("query-conditions");
const queryConditions = {};
if (queryConditionsPath) {
  const manifest = JSON.parse(await readFile(queryConditionsPath, "utf8"));
  for (const item of manifest.items || []) {
    queryConditions[item.faceId] = Object.entries(item.conditions || {})
      .filter(([, state]) => state === "present")
      .map(([modifierKey]) => modifierKey);
  }
}

const sql = postgres(
  process.env.DATABASE_URL || "postgres://cimmich@postgres:5432/cimmich",
  { max: 1, prepare: true },
);
try {
  const result = await runPhotoIsolatedEvaluation(
    sql,
    {
      configDigest: value("config-digest"),
      cutoff,
      modelFamily: value("model-family"),
      modelVersion: value("model-version", "cimmich-source-anchor-v1"),
      primeOptions: {
        maxPrime: Number(value("max-prime", "12")),
        minPrime: Number(value("min-prime", "1")),
        minCoverageGain: Number(value("min-coverage-gain", "0.002")),
      },
      primeModeOptions: {
        maxModes: Number(value("max-prime-modes", "0")),
      },
      secondaryLimit: Number(value("secondary-limit", "24")),
      seed: value("seed", "cimmich-context-isolated-v2"),
    },
    { execute, queryConditions },
  );
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  const outputPath = value("output");
  if (outputPath) await writeFile(outputPath, serialized);
  process.stdout.write(serialized);
} finally {
  await sql.end({ timeout: 5 });
}
