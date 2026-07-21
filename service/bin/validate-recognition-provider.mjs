#!/usr/bin/env node
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import {
  mergeRecognitionCheckpoint,
  recognitionCheckpointSchemaVersion,
} from "../src/recognition-provider-contract.mjs";

const valueAfter = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};

const manifestPath = valueAfter("--manifest");
const packetsPath = valueAfter("--packets");
const checkpointPath = valueAfter("--checkpoint");
const receiptPath = valueAfter("--receipt");
const execute = process.argv.includes("--execute");
if (!manifestPath || !packetsPath || !checkpointPath || !receiptPath) {
  throw new Error(
    "Usage: validate-recognition-provider --manifest FILE --packets FILE --checkpoint FILE --receipt FILE [--execute]",
  );
}

const readJson = async (path) =>
  JSON.parse(await readFile(resolve(path), "utf8"));
const readOptionalJson = async (path) => {
  try {
    return await readJson(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
};
const packetText = await readFile(resolve(packetsPath), "utf8");
const packets = packetText
  .split(/\r?\n/)
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line));
const result = mergeRecognitionCheckpoint(
  await readJson(manifestPath),
  packets,
  await readOptionalJson(checkpointPath),
);

const atomicJson = async (path, value) => {
  const destination = resolve(path);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, destination);
};
if (execute) {
  if (result.checkpoint.schemaVersion !== recognitionCheckpointSchemaVersion) {
    throw new Error("Refusing to write an incompatible recognition checkpoint");
  }
  await atomicJson(checkpointPath, result.checkpoint);
  await atomicJson(receiptPath, result.receipt);
}
console.log(
  JSON.stringify(
    {
      execute,
      manifest: {
        providerConfigDigest: result.manifest.providerConfigDigest,
        vectorSpaceId: result.manifest.vectorSpaceId,
      },
      receipt: result.receipt,
    },
    null,
    2,
  ),
);
