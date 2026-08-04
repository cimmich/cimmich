import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  stat,
  utimes,
} from "node:fs/promises";
import path from "node:path";
import {
  captureTimeFor,
  parseCsv,
  publicDemoExternalFolderForAsset,
} from "../src/public-demo-bootstrap.mjs";

const requiredPath = (name) => {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error("Public demo External Library configuration is incomplete");
  }
  return path.resolve(value);
};

const archiveRoot = requiredPath("CIMMICH_DEMO_ARCHIVE_ROOT");
const targetRoot = requiredPath("CIMMICH_DEMO_EXTERNAL_LIBRARY_ROOT");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

await stat(targetRoot)
  .then(() => {
    throw new Error("Public demo External Library target already exists");
  })
  .catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });

const manifestRows = parseCsv(
  await readFile(path.join(archiveRoot, "provenance", "manifest.csv"), "utf8"),
);
assert.equal(manifestRows.length, 51);
await mkdir(targetRoot, { recursive: false, mode: 0o755 });

for (const [index, row] of manifestRows.entries()) {
  const source = path.join(archiveRoot, "media", row.filename);
  const bytes = await readFile(source);
  assert.equal(sha256(bytes), row.sha256, `${row.asset_id} archive hash drift`);
  assert.equal(row.synthetic, "true", `${row.asset_id} is not synthetic`);
  const folder = path.join(
    targetRoot,
    publicDemoExternalFolderForAsset(row.asset_id),
  );
  await mkdir(folder, { recursive: true, mode: 0o755 });
  const target = path.join(folder, row.filename);
  await copyFile(source, target);
  await chmod(target, 0o644);
  const capturedAt = new Date(captureTimeFor(index + 1));
  await utimes(target, capturedAt, capturedAt);
}

process.stdout.write(
  `${JSON.stringify({ assetCount: manifestRows.length, root: targetRoot, status: "READY" })}\n`,
);
