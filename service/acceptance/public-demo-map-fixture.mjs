import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  digest,
  parseCsv,
  publicDemoImmichMapSchemaVersion,
} from "../src/public-demo-bootstrap.mjs";

const archiveRoot = path.resolve(
  String(process.env.CIMMICH_DEMO_ARCHIVE_ROOT || "").trim(),
);
const outputPath = path.resolve(
  String(process.env.CIMMICH_DEMO_IMMICH_MAP_PATH || "").trim(),
);
if (!archiveRoot || !outputPath) {
  throw new Error("Public demo fixture configuration is incomplete");
}
const manifestSource = await readFile(
  path.join(archiveRoot, "provenance", "manifest.csv"),
  "utf8",
);
const shotLedgerSource = await readFile(
  path.join(archiveRoot, "shot-ledger.csv"),
  "utf8",
);
const rightsSources = await Promise.all(
  ["LICENSE.md", "NOTICE.md", "ATTRIBUTION.md"].map(
    async (filename) =>
      `${filename}\u001f${await readFile(path.join(archiveRoot, filename), "utf8")}`,
  ),
);
const rows = parseCsv(manifestSource);
await writeFile(
  outputPath,
  `${JSON.stringify(
    {
      archiveDigest: digest(
        [manifestSource, shotLedgerSource, ...rightsSources].join("\u001e"),
      ),
      assets: rows.map((row, index) => ({
        assetId: row.asset_id,
        checksum: row.sha256,
        height: Number.parseInt(row.height, 10),
        immichAssetId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        inputRevision: digest(`cedar-house-fixture:${row.sha256}`),
        sourceUpdatedAt: "2026-07-19T00:00:00.000Z",
        width: Number.parseInt(row.width, 10),
      })),
      generatedAt: "2026-07-19T00:00:00.000Z",
      immichVersion: "3.0.3",
      principalDigest: digest("cedar-house-disposable-fixture"),
      schemaVersion: publicDemoImmichMapSchemaVersion,
      source: "immich_api_upload",
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);
