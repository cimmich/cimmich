#!/usr/bin/env node
import { statfs } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { evaluateStorageBudget } from "../service/src/storage-budget.mjs";

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(2);
};

const optionValue = (name) => {
  const prefix = `${name}=`;
  const value = process.argv
    .slice(2)
    .find((argument) => argument.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
};

const targetPath = optionValue("--path");
const requiredWorkingBytes = optionValue("--required-working-bytes");
const reserveBytes = optionValue("--reserve-bytes");
if (!targetPath || !path.isAbsolute(targetPath)) {
  fail("--path must name an existing absolute storage path");
}
if (!/^\d+$/.test(requiredWorkingBytes || "")) {
  fail("--required-working-bytes must be a non-negative integer");
}
if (!/^\d+$/.test(reserveBytes || "")) {
  fail("--reserve-bytes must be a non-negative integer");
}

const stats = await statfs(targetPath, { bigint: true });
const result = evaluateStorageBudget({
  availableBytes: stats.bavail * stats.bsize,
  requiredWorkingBytes,
  reserveBytes,
});
process.stdout.write(
  `${JSON.stringify({ ...result, path: targetPath }, null, 2)}\n`,
);
if (!result.ready) {
  process.exitCode = 1;
}
