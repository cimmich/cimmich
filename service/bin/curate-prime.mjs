#!/usr/bin/env node
import postgres from "postgres";
import {
  applyPrimeCurations,
  buildPrimeCurations,
  loadPrimeCuratorFaces,
  primeCuratorPolicyVersion,
} from "../src/prime-curator-repository.mjs";

const args = new Set(process.argv.slice(2));
const execute = args.has("--execute");
const personArgument = process.argv.find((value) =>
  value.startsWith("--person-id="),
);
const personId = personArgument
  ? personArgument.slice("--person-id=".length)
  : "";
const databaseUrl =
  process.env.DATABASE_URL || "postgres://cimmich@postgres:5432/cimmich";
const sql = postgres(databaseUrl, { max: 1, prepare: true });

try {
  const faces = await loadPrimeCuratorFaces(sql, personId);
  const curations = buildPrimeCurations(faces);
  const summary = await applyPrimeCurations(sql, curations, { execute });
  process.stdout.write(
    `${JSON.stringify({ execute, policyVersion: primeCuratorPolicyVersion, sourceFaces: faces.length, ...summary })}\n`,
  );
} finally {
  await sql.end({ timeout: 5 });
}
