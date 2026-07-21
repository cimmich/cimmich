import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const serviceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repositoryRoot = path.resolve(serviceRoot, "..");
const formerForkName = ["rim", "mich"].join("");
const legacyProductName = new RegExp(
  `${formerForkName[0].toUpperCase()}${formerForkName.slice(1)}|${formerForkName.toUpperCase()}|\\b${formerForkName}\\b|[_./-]${formerForkName}`,
);
const internalProductLabel = /\brui\b|booze cruise/i;

const collectFiles = async (root) => {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
    } else {
      files.push(fullPath);
    }
  }
  return files;
};

test("public product and machine surfaces use Cimmich as the canonical name", async () => {
  const roots = [
    path.join(serviceRoot, "src"),
    path.join(repositoryRoot, "tools"),
    path.join(repositoryRoot, "ui", "web", "src"),
  ];
  const files = (await Promise.all(roots.map(collectFiles))).flat();
  for (const file of files) {
    const relative = path.relative(repositoryRoot, file);
    assert.doesNotMatch(
      relative,
      legacyProductName,
      `legacy product name in path: ${relative}`,
    );
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(
      source,
      legacyProductName,
      `legacy product name in source: ${relative}`,
    );
    assert.doesNotMatch(
      source,
      internalProductLabel,
      `internal product label in source: ${relative}`,
    );
  }
});
