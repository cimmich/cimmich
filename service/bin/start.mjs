#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { migrate } from "../src/migration-runner.mjs";
import { loadRuntimeConfig } from "../src/runtime-config.mjs";

const { databaseUrl } = loadRuntimeConfig(process.env);
const serviceDirectory = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
);
const migrationsDirectory = path.resolve(
  process.env.CIMMICH_MIGRATIONS_DIRECTORY ||
    path.join(serviceDirectory, "../migrations"),
);
const adoptValue = process.env.CIMMICH_MIGRATION_ADOPT_EXISTING || "0";
if (adoptValue !== "0" && adoptValue !== "48") {
  throw new Error(
    "CIMMICH_MIGRATION_ADOPT_EXISTING supports only explicit value 48",
  );
}
const migrationSql = postgres(databaseUrl, { max: 1, prepare: true });
try {
  const receipt = await migrate({
    adoptExisting: adoptValue,
    migrationsDirectory,
    sql: migrationSql,
  });
  console.log(
    JSON.stringify({
      code: "CIMMICH_MIGRATIONS_READY",
      currentVersion: receipt.currentVersion,
      newlyAppliedCount: receipt.newlyApplied.length,
      newlyAppliedPatchCount: receipt.newlyAppliedPatches.length,
      patchCount: receipt.patchCount,
    }),
  );
} finally {
  await migrationSql.end({ timeout: 5 });
}
await import("../src/index.mjs");
