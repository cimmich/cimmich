import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const serviceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const packRoot = path.resolve(serviceRoot, "../demo/space-trip-v1");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const pngDimensions = (bytes) => {
  assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(bytes.subarray(12, 16).toString("ascii"), "IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
};

const parseManifest = (text) => {
  const [headerLine, ...rows] = text.trim().split("\n");
  const headers = headerLine.split(",");
  return rows.map((row) =>
    Object.fromEntries(
      row.split(",").map((value, index) => [headers[index], value]),
    ),
  );
};

test("Space Trip V1 is a complete six-asset rights-bound extension", async () => {
  const manifest = parseManifest(
    await readFile(path.join(packRoot, "manifest.csv"), "utf8"),
  );
  const mediaFiles = (await readdir(path.join(packRoot, "media")))
    .filter((name) => name.endsWith(".png"))
    .sort();

  assert.equal(manifest.length, 6);
  assert.deepEqual(
    manifest.map(({ id }) => id),
    ["ST-001", "ST-002", "ST-003", "ST-004", "ST-005", "ST-006"],
  );
  assert.deepEqual(mediaFiles, manifest.map(({ filename }) => filename).sort());

  for (const row of manifest) {
    assert.equal(row.synthetic, "true");
    assert.equal(row.generator_route, "Codex built-in OpenAI image generation");
    assert.equal(row.status, "review-ready");
    const bytes = await readFile(path.join(packRoot, "media", row.filename));
    assert.equal(sha256(bytes), row.sha256, `${row.id} checksum drifted`);
    assert.deepEqual(pngDimensions(bytes), {
      width: Number(row.width),
      height: Number(row.height),
    });
  }

  for (const relativePath of [
    "README.md",
    "LICENSE.md",
    "NOTICE.md",
    "ATTRIBUTION.md",
    "prompts.md",
    "provenance/README.md",
    "qa/space-trip-contact-sheet-v1.jpg",
  ]) {
    assert.ok(
      (await stat(path.join(packRoot, relativePath))).isFile(),
      `${relativePath} is missing`,
    );
  }

  await assert.rejects(stat(path.join(packRoot, "reference")), {
    code: "ENOENT",
  });
});
