import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const serviceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const writeNames = new Set([
  "appendFile",
  "chmod",
  "copyFile",
  "createWriteStream",
  "mkdir",
  "rename",
  "rm",
  "unlink",
  "utimes",
  "writeFile",
]);

const reviewedWriters = [
  "bin/bootstrap-public-demo-immich.mjs",
  "bin/bootstrap-public-demo.mjs",
  "bin/compare-photo-isolated-packs.mjs",
  "bin/compile-face-local-measurements.mjs",
  "bin/configure-local-face-provider.mjs",
  "bin/document-lifecycle.mjs",
  "bin/evaluate-local-body-mask-development.mjs",
  "bin/evaluate-photo-isolated.mjs",
  "bin/prepare-public-demo-external-library.mjs",
  "bin/refresh-public-demo-immich-companion.mjs",
  "bin/validate-recognition-provider.mjs",
  "src/database-backup-health.mjs",
  "src/documents.mjs",
  "src/immich-companion-manager.mjs",
  "src/local-ai-service.mjs",
];

const productionModules = async (directory) => {
  const entries = await readdir(path.join(serviceRoot, directory), {
    withFileTypes: true,
  });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"))
    .map((entry) => `${directory}/${entry.name}`);
};

const importedFsNames = (source) => {
  const names = new Set();
  for (const match of source.matchAll(
    /import\s*\{([^}]+)\}\s*from\s*["']node:fs(?:\/promises)?["']/g,
  )) {
    for (const item of match[1].split(",")) {
      names.add(item.trim().split(/\s+as\s+/)[0]);
    }
  }
  return names;
};

test("every production filesystem writer has a reviewed Cimmich-owned destination", async () => {
  const modules = [
    ...(await productionModules("src")),
    ...(await productionModules("bin")),
  ];
  const actual = [];
  for (const module of modules) {
    const source = await readFile(path.join(serviceRoot, module), "utf8");
    if ([...importedFsNames(source)].some((name) => writeNames.has(name))) {
      actual.push(module);
    }
  }
  assert.deepEqual(actual.sort(), reviewedWriters.sort());
});

test("source adapters remain filesystem read-only and the XMP lane exposes no write switch", async () => {
  const bridge = await readFile(
    path.join(serviceRoot, "src/bridge.mjs"),
    "utf8",
  );
  const xmp = await readFile(
    path.join(serviceRoot, "src/xmp-sidecar-import.mjs"),
    "utf8",
  );
  assert.deepEqual([...importedFsNames(bridge)], ["readFile"]);
  assert.equal(
    [...importedFsNames(xmp)].some((name) => writeNames.has(name)),
    false,
  );
  assert.doesNotMatch(xmp, /-overwrite_original|-TagsFromFile|-XMP[^\s"']*=/i);
});
