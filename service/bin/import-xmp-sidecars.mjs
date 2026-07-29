#!/usr/bin/env node

import process from "node:process";
import postgres from "postgres";
import { runXmpSidecarImport } from "../src/xmp-sidecar-import.mjs";

const argument = (name, fallback = "") => {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : null;
  return value && !value.startsWith("--") ? value : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);
const required = (value, label) => {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`XMP sidecar import requires ${label}`);
  return normalized;
};
const boundedInteger = (value, label, minimum, maximum) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be from ${minimum} to ${maximum}`);
  }
  return number;
};

const execute = flag("execute");
const databaseUrl = required(process.env.DATABASE_URL, "DATABASE_URL");
const root = required(
  argument("root", process.env.CIMMICH_XMP_SIDECAR_ROOT),
  "a read-only source root",
);
const limitAssets = boundedInteger(
  argument("limit-assets", "1000"),
  "limit-assets",
  1,
  100000,
);
const commandId = execute
  ? required(argument("command-id"), "--command-id when executing")
  : null;
const providerPath = required(
  argument(
    "provider",
    new URL("../../providers/xmp-sidecar-reader/provider.py", import.meta.url)
      .pathname,
  ),
  "a provider path",
);
const pythonPath = required(
  argument("python", process.env.CIMMICH_XMP_PYTHON_PATH || "/usr/bin/python3"),
  "a Python path",
);
const sql = postgres(databaseUrl, { max: 3, prepare: true });

try {
  const result = await runXmpSidecarImport(sql, {
    actorId: argument("actor-id", "cimmich-xmp-sidecar-operator"),
    commandId,
    execute,
    limitAssets,
    providerPath,
    pythonPath,
    root,
    sourceId: argument("source-id", "x1-archive-xmp"),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
