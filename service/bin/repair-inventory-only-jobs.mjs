#!/usr/bin/env node

import postgres from "postgres";
import { repairInventoryOnlyJobs } from "../src/inventory-only-job-repair.mjs";

const value = (name, fallback = "") => {
  const prefix = `--${name}=`;
  return (
    process.argv
      .find((argument) => argument.startsWith(prefix))
      ?.slice(prefix.length) || fallback
  );
};

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const sql = postgres(databaseUrl, { max: 2, prepare: true });
try {
  const result = await repairInventoryOnlyJobs({
    apply: value("apply", "false") === "true",
    sourceId: value(
      "source-id",
      process.env.CIMMICH_IMMICH_SOURCE_ID || "immich-primary",
    ),
    sql,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
