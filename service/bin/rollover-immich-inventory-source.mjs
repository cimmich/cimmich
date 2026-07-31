#!/usr/bin/env node

import postgres from "postgres";
import { rolloverImmichInventorySource } from "../src/immich-source-rollover.mjs";

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
  const result = await rolloverImmichInventorySource({
    actorId: value("actor-id", "immich-source-rollover-operator"),
    apply: value("apply", "false") === "true",
    commandId: value("command-id"),
    confirm: value("confirm"),
    predecessorSourceId: value("predecessor-source-id"),
    successorSourceId: value(
      "successor-source-id",
      process.env.CIMMICH_IMMICH_SOURCE_ID || "immich-primary",
    ),
    sql,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
