#!/usr/bin/env node

import process from "node:process";
import postgres from "postgres";
import {
  argumentValue as argument,
  booleanFlag as flag,
  boundedInteger,
  requiredText,
} from "../src/bin-arguments.mjs";
import { runXmpSidecarImport } from "../src/xmp-sidecar-import.mjs";

const required = (value, label) =>
  requiredText(value, label, "XMP sidecar import");

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
    sourceId: required(
      argument("source-id", process.env.CIMMICH_XMP_SOURCE_ID),
      "--source-id (the stable evidence source key for this archive)",
    ),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
