#!/usr/bin/env node

import postgres from "postgres";
import { reconcileImmichArchiveToLegacyAssets } from "../src/archive-reconciliation.mjs";
import { createImmichCompanionManager } from "../src/immich-companion-manager.mjs";

const value = (name, fallback = "") => {
  const prefix = `--${name}=`;
  return (
    process.argv
      .find((argument) => argument.startsWith(prefix))
      ?.slice(prefix.length) || fallback
  );
};

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const companion = await createImmichCompanionManager({
  apiBaseUrl: process.env.IMMICH_API_URL || "",
  apiKey: process.env.IMMICH_API_KEY || "",
  credentialFile: process.env.CIMMICH_IMMICH_CREDENTIAL_FILE || "",
});
const sql = postgres(databaseUrl, { max: 3, prepare: true });

try {
  const result = await reconcileImmichArchiveToLegacyAssets({
    actorId: value("actor-id", "archive-reconciliation-operator"),
    apply: value("apply", "false") === "true",
    companion,
    fingerprintConcurrency: Number(value("fingerprint-concurrency", "2")),
    legacySourceId: value("legacy-source-id", "immich-primary"),
    maxPages: Number(value("max-pages", "25")),
    pageSize: Number(value("page-size", "250")),
    sql,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
