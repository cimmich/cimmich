#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import postgres from "postgres";
import { createGeneratedAssetSummaryStore } from "../src/generated-asset-summary.mjs";
import { planAppleSmartProposalImport } from "../src/generated-summary-proposal-import.mjs";

const value = (name, fallback = "") => {
  const prefix = `--${name}=`;
  return (
    process.argv
      .find((argument) => argument.startsWith(prefix))
      ?.slice(prefix.length) || fallback
  );
};

const sha256File = async (path) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
};

const readJsonLines = async (path) => {
  const rows = [];
  const input = path.endsWith(".gz")
    ? createReadStream(path).pipe(createGunzip())
    : createReadStream(path);
  const lines = createInterface({ crlfDelay: Infinity, input });
  for await (const line of lines) {
    if (!line.trim()) continue;
    if (line.length > 32_768 || rows.length >= 100_000)
      throw new Error("APPLE_SMART_IMPORT_RESULTS_INVALID");
    rows.push(JSON.parse(line));
  }
  return rows;
};

const chunks = (values, size) => {
  const result = [];
  for (let index = 0; index < values.length; index += size)
    result.push(values.slice(index, index + size));
  return result;
};

const mapCurrentAssets = async (sql, sourceAssetIds) => {
  const rows = [];
  for (const batch of chunks(sourceAssetIds, 500)) {
    rows.push(
      ...(await sql`
      SELECT projection.immich_asset_id AS source_asset_id,
        projection.cimmich_asset_id,
        array_remove(array_agg(DISTINCT fingerprint.content_digest), NULL)
          AS source_content_digests,
        current_summary.proposal_digest AS current_smart_proposal_digest
      FROM immich_asset_projection projection
      JOIN asset ON asset.asset_id = projection.cimmich_asset_id
        AND asset.state = 'active'
      LEFT JOIN asset_source_binding binding
        ON binding.asset_id = projection.cimmich_asset_id
        AND binding.source_kind = 'immich'
        AND binding.source_id = projection.source_id
        AND binding.external_asset_id = projection.immich_asset_id
        AND binding.state = 'active'
      LEFT JOIN media_content_fingerprint fingerprint
        ON fingerprint.content_id = binding.content_id
        AND fingerprint.hash_algorithm = 'sha256'
        AND fingerprint.verification = 'byte_verified'
      LEFT JOIN current_generated_asset_summary_analysis current_summary
        ON current_summary.asset_id = projection.cimmich_asset_id
        AND current_summary.tier = 'smart'
      WHERE projection.immich_asset_id IN ${sql(batch)}
        AND projection.state = 'active'
      GROUP BY projection.immich_asset_id, projection.cimmich_asset_id,
        current_summary.proposal_digest
    `),
    );
  }
  return rows.map((row) => ({
    cimmichAssetId: row.cimmich_asset_id,
    currentSmartProposalDigest: row.current_smart_proposal_digest,
    sourceAssetId: row.source_asset_id,
    sourceContentDigests: row.source_content_digests || [],
  }));
};

const runPool = async (items, concurrency, run) => {
  let index = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (index < items.length) {
        const item = items[index++];
        await run(item);
      }
    },
  );
  await Promise.all(workers);
};

const manifestPath = value("manifest");
const resultsPath = value("results");
const execute = process.argv.includes("--execute");
if (!manifestPath || !resultsPath)
  throw new Error("--manifest and --results are required");
for (const path of [manifestPath, resultsPath]) {
  const info = await stat(path);
  if (!info.isFile() || info.size < 1 || info.size > 128 * 1024 * 1024)
    throw new Error("APPLE_SMART_IMPORT_ARTIFACT_INVALID");
}

const [manifestDigest, resultsDigest, manifestBytes, resultRows] =
  await Promise.all([
    sha256File(manifestPath),
    sha256File(resultsPath),
    readFile(manifestPath, "utf8"),
    readJsonLines(resultsPath),
  ]);
const manifest = JSON.parse(manifestBytes);
const databaseUrl = String(process.env.DATABASE_URL || "").trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const sql = postgres(databaseUrl, { max: 10, prepare: true });

try {
  const currentAssets = await mapCurrentAssets(
    sql,
    manifest.assets.map((asset) => asset.immichAssetId),
  );
  const plan = planAppleSmartProposalImport({
    currentAssets,
    manifest,
    resultRows,
  });
  const expectedEligible = Number(value("expected-eligible", "-1"));
  if (execute) {
    if (
      value("expected-manifest-digest") !== manifestDigest ||
      value("expected-results-digest") !== resultsDigest ||
      expectedEligible !== plan.eligible.length
    )
      throw new Error("APPLE_SMART_IMPORT_EXECUTION_GUARD_FAILED");
  }

  const assetBySourceId = new Map(
    plan.eligible.map((item) => [item.sourceAssetId, item.cimmichAssetId]),
  );
  const store = createGeneratedAssetSummaryStore(sql, {
    resolveVisibleAssetDisplay: async (sourceAssetId) => {
      const assetId = assetBySourceId.get(sourceAssetId);
      if (!assetId) throw new Error("APPLE_SMART_IMPORT_ASSET_NOT_PLANNED");
      return { assetId };
    },
  });
  let changed = 0;
  let unchanged = 0;
  if (execute) {
    await runPool(plan.eligible, 8, async (item) => {
      const result = await store.commitFromLocalAi(item.commit);
      if (result.changed) changed += 1;
      else unchanged += 1;
    });
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        alreadyCurrent: plan.alreadyCurrent.length,
        artifactDigests: { manifest: manifestDigest, results: resultsDigest },
        changed,
        eligible: plan.eligible.length,
        executed: execute,
        reasonCounts: plan.reasonCounts,
        schemaVersion: "cimmich.apple-smart-proposal-import.v1",
        totalManifestAssets: plan.totalManifestAssets,
        unchanged,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await sql.end({ timeout: 5 });
}
