#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { persistSecondaryRoutingGateReceipt } from "../src/secondary-routing-gate.mjs";

const value = (name) => {
  const prefix = `--${name}=`;
  return (
    process.argv
      .find((argument) => argument.startsWith(prefix))
      ?.slice(prefix.length) || ""
  );
};
const receiptPath = value("receipt");
if (!receiptPath) {
  throw new Error(
    "Usage: secondary-routing-gate.mjs --receipt=FILE [--execute]",
  );
}
const execute = process.argv.includes("--execute");
const databaseUrl =
  process.env.DATABASE_URL || "postgres://cimmich@postgres:5432/cimmich";
const sql = postgres(databaseUrl, { max: 1, prepare: true });
try {
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  process.stdout.write(
    `${JSON.stringify(await persistSecondaryRoutingGateReceipt(sql, receipt, { execute }), null, 2)}\n`,
  );
} finally {
  await sql.end({ timeout: 5 });
}
