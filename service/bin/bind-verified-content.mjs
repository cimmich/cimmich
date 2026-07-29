#!/usr/bin/env node

import process from "node:process";
import postgres from "postgres";
import { bindVerifiedContent } from "../src/archive-mobility.mjs";

const readCommand = async () => {
  if (process.stdin.isTTY) {
    throw new Error("pipe one verified content binding command as JSON");
  }
  const chunks = [];
  let byteLength = 0;
  for await (const chunk of process.stdin) {
    byteLength += chunk.length;
    if (byteLength > 16 * 1024) {
      throw new Error("verified content binding command is too large");
    }
    chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("verified content binding command must be one JSON object");
  }
  const allowed = new Set([
    "actorId",
    "byteLength",
    "commandId",
    "contentDigest",
    "externalAssetId",
    "hashAlgorithm",
    "schemaVersion",
    "sourceId",
    "sourceKind",
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new Error("verified content binding command has unknown fields");
  }
  return input;
};

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
if (!databaseUrl) {
  console.error(
    JSON.stringify({
      code: "ARCHIVE_VERIFIED_BINDING_CONFIG_INVALID",
      error: "DATABASE_URL is required",
    }),
  );
  process.exitCode = 2;
} else {
  const sql = postgres(databaseUrl, { max: 1, prepare: true });
  try {
    const result = await bindVerifiedContent({
      ...(await readCommand()),
      sql,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    console.error(
      JSON.stringify({
        code: error?.code || "ARCHIVE_VERIFIED_BINDING_FAILED",
        error: error?.message || "Verified content binding failed",
      }),
    );
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
