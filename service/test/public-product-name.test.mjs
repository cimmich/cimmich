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
// Hyphen/underscore separators count: a kebab-case id once slipped through a
// space-only pattern into the shipped bundle.
const internalProductLabel = /\brui\b|booze[_ -]cruise/i;

// Only authored text sources are scanned: generated directories (local
// __pycache__, node_modules) and binary media would produce untracked-file
// noise and byte-run false positives.
const generatedDirectories = new Set(["__pycache__", "node_modules", ".venv"]);
const textExtensions = new Set([
  ".cjs",
  ".conf",
  ".css",
  ".csv",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".py",
  ".sh",
  ".sql",
  ".svelte",
  ".template",
  ".ts",
  ".txt",
  ".yaml",
  ".yml",
]);
const collectFiles = async (root) => {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (generatedDirectories.has(entry.name)) continue;
      files.push(...(await collectFiles(fullPath)));
    } else if (textExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }
  return files;
};

test("public product and machine surfaces use Cimmich as the canonical name", async () => {
  // service/test is deliberately not walked: it holds negative-assertion
  // guards (including this file) whose patterns would self-match. docs/ waits
  // on the parked X1-DOCS disposition.
  const roots = [
    path.join(serviceRoot, "src"),
    path.join(serviceRoot, "bin"),
    path.join(serviceRoot, "acceptance"),
    path.join(repositoryRoot, "tools"),
    path.join(repositoryRoot, "providers"),
    path.join(repositoryRoot, "migrations"),
    path.join(repositoryRoot, "demo"),
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
