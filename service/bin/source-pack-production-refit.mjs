#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import {
  buildSourcePackProductionRefit,
  persistSourcePackProductionRefit,
} from "../src/source-pack-production-refit.mjs";

const args = process.argv.slice(2);
const value = (name, fallback = "") =>
  args
    .find((argument) => argument.startsWith(`--${name}=`))
    ?.slice(name.length + 3) || fallback;
const evaluationPackId = value("evaluation-pack-id");
const pythonPath = value("python");
if (!evaluationPackId || !pythonPath) {
  throw new Error(
    "Production refit requires --evaluation-pack-id and --python",
  );
}
const sql = postgres(
  process.env.DATABASE_URL || "postgres://cimmich@postgres:5432/cimmich",
  { max: 2, prepare: true },
);
try {
  const result = await buildSourcePackProductionRefit(sql, {
    evaluationPackId,
    negativePersonIds: args
      .filter((argument) => argument.startsWith("--negative-person-id="))
      .map((argument) => argument.slice("--negative-person-id=".length))
      .filter(Boolean),
    negativeSourcePackId: value("negative-source-pack-id"),
    pythonPath,
    scriptPath: fileURLToPath(
      new URL("../../providers/source-pack-numpy/score.py", import.meta.url),
    ),
  });
  const persistence = await persistSourcePackProductionRefit(sql, result, {
    execute: args.includes("--execute"),
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        automaticIdentityAuthority: "none",
        matcherPolicy: result.receipt.matcherPolicy,
        persistence,
        receipt: result.receipt,
        sourceMediaWrite: "none",
        summary: result.summary,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await sql.end({ timeout: 5 });
}
