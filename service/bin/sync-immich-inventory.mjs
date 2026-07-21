#!/usr/bin/env node
import postgres from "postgres";
import { createImmichCompanion } from "../src/immich-companion.mjs";
import { createImmichInventorySynchronizer } from "../src/immich-inventory.mjs";

const value = (name, fallback = "") => {
  const prefix = `--${name}=`;
  return (
    process.argv
      .find((argument) => argument.startsWith(prefix))
      ?.slice(prefix.length) || fallback
  );
};

const databaseUrl =
  process.env.DATABASE_URL || "postgres://cimmich@postgres:5432/cimmich";
const sql = postgres(databaseUrl, { max: 2, prepare: true });
const synchronizer = createImmichInventorySynchronizer({
  companion: createImmichCompanion({
    apiBaseUrl: process.env.IMMICH_API_URL || "",
    apiKey: process.env.IMMICH_API_KEY || "",
  }),
  job: {
    configDigest: value("config-digest"),
    maxAttempts: Number(value("max-attempts", "3")),
    operation: value("operation", "detect_and_recognize"),
    toolVersion: value("tool-version"),
  },
  pageSize: Number(value("page-size", "250")),
  sourceId: value("source-id", "immich-primary"),
  sql,
});

try {
  const action = value("action", "sync");
  const result =
    action === "status"
      ? await synchronizer.status()
      : action === "sync"
        ? await synchronizer.synchronize({
            maxPages: value("max-pages")
              ? Number(value("max-pages"))
              : Number.POSITIVE_INFINITY,
          })
        : (() => {
            throw new Error(`Unsupported Immich inventory action: ${action}`);
          })();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
