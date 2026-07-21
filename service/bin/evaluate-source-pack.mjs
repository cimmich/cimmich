#!/usr/bin/env node
import postgres from "postgres";
import {
  evaluateSourcePack,
  persistSourcePackEvaluation,
} from "../src/source-pack-evaluator.mjs";

const args = process.argv.slice(2);
const execute = args.includes("--execute");
const value = (name, fallback = "") =>
  args
    .find((argument) => argument.startsWith(`--${name}=`))
    ?.slice(name.length + 3) || fallback;
const packId = value("pack-id");
const calibrationEnd = value("calibration-end");
if (!packId || !calibrationEnd) {
  throw new Error(
    "Usage: evaluate-source-pack.mjs --pack-id=<id> --calibration-end=<ISO timestamp> [--execute]",
  );
}
const sql = postgres(
  process.env.DATABASE_URL || "postgres://cimmich@postgres:5432/cimmich",
  { max: 1, prepare: true },
);
try {
  const evaluation = await evaluateSourcePack(sql, {
    calibrationEnd,
    includeUnmeasuredSecondary: args.includes("--include-unmeasured-secondary"),
    maxQueriesPerPerson: Number(value("max-queries-per-person", "5")),
    packId,
  });
  const persistence = await persistSourcePackEvaluation(
    sql,
    packId,
    evaluation,
    { execute },
  );
  process.stdout.write(`${JSON.stringify({ evaluation, persistence })}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
