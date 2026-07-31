#!/usr/bin/env node

import postgres from "postgres";
import { pruneInventoryPlaceholderJobs } from "../src/inventory-placeholder-job-prune.mjs";

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
  const result = await pruneInventoryPlaceholderJobs({
    actorId: value("actor-id", "inventory-placeholder-prune-operator"),
    apply: value("apply", "false") === "true",
    commandId: value("command-id"),
    confirm: value("confirm"),
    expectedJobCount: value("expected-job-count"),
    sql,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
