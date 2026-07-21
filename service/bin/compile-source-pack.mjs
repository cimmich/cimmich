#!/usr/bin/env node
import postgres from "postgres";
import { compileAndPersistSourcePack } from "../src/source-pack-repository.mjs";

const args = process.argv.slice(2);
const execute = args.includes("--execute");
const value = (name, fallback = "") =>
  args
    .find((argument) => argument.startsWith(`--${name}=`))
    ?.slice(name.length + 3) || fallback;
const cutoff = value("cutoff");
if (!cutoff) {
  throw new Error(
    "Usage: compile-source-pack.mjs --cutoff=<ISO timestamp> [--model-version=<version>] [--execute]",
  );
}

const databaseUrl =
  process.env.DATABASE_URL || "postgres://cimmich@postgres:5432/cimmich";
const sql = postgres(databaseUrl, { max: 1, prepare: true });
try {
  const { pack, persistence } = await compileAndPersistSourcePack(
    sql,
    {
      configDigest: value("config-digest"),
      cutoff,
      modelFamily: value("model-family"),
      modelVersion: value("model-version", "cimmich-source-anchor-v1"),
      personId: value("person-id"),
      predecessorPackId: value("predecessor-pack-id") || null,
    },
    { execute },
  );
  process.stdout.write(
    `${JSON.stringify({
      ...persistence,
      evidenceCutoff: pack.evidenceCutoff,
      packDigest: pack.packDigest,
      policyVersion: pack.policyVersion,
      state: "proposed",
    })}\n`,
  );
} finally {
  await sql.end({ timeout: 5 });
}
