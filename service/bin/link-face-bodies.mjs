#!/usr/bin/env node
import postgres from "postgres";
import {
  applyFaceBodyLinks,
  buildFaceBodyLinks,
  faceBodyLinkPolicyVersion,
  loadFaceBodyLinkAssets,
} from "../src/face-body-linker-repository.mjs";

const args = new Set(process.argv.slice(2));
const execute = args.has("--execute");
const argument = (name) =>
  process.argv
    .find((value) => value.startsWith(`--${name}=`))
    ?.slice(name.length + 3);
const assetId = argument("asset-id") || "";
const maxCost = Number.parseFloat(argument("max-cost") || "0.65");
const minMargin = Number.parseFloat(argument("min-margin") || "0.12");
if (!Number.isFinite(maxCost) || maxCost <= 0)
  throw new Error("--max-cost must be a positive finite number");
if (!Number.isFinite(minMargin) || minMargin < 0)
  throw new Error("--min-margin must be a non-negative finite number");
const databaseUrl =
  process.env.DATABASE_URL || "postgres://cimmich@postgres:5432/cimmich";
const sql = postgres(databaseUrl, { max: 1, prepare: true });

try {
  const assets = await loadFaceBodyLinkAssets(sql, assetId);
  const proposal = buildFaceBodyLinks(assets, { maxCost, minMargin });
  const summary = await applyFaceBodyLinks(sql, proposal, { execute });
  process.stdout.write(
    `${JSON.stringify({
      assetId: assetId || null,
      execute,
      policyVersion: faceBodyLinkPolicyVersion,
      sourceAssets: assets.length,
      ...summary,
    })}\n`,
  );
} finally {
  await sql.end({ timeout: 5 });
}
