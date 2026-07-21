#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compileFaceLocalMeasurements } from "../src/face-local-measurement.mjs";

const inputIndex = process.argv.indexOf("--input");
const outputIndex = process.argv.indexOf("--output");
if (inputIndex < 0 || !process.argv[inputIndex + 1]) {
  throw new Error(
    "Usage: compile-face-local-measurements.mjs --input packet.json [--output measurements.json]",
  );
}

const inputPath = resolve(process.argv[inputIndex + 1]);
const packet = JSON.parse(await readFile(inputPath, "utf8"));
const measurements = compileFaceLocalMeasurements(packet);
const receipt = {
  measurements,
  providerPacketSchemaVersion: packet.schemaVersion,
  safety: {
    identityWrites: false,
    modifierWrites: false,
    persistenceWrites: false,
  },
  schemaVersion: "cimmich.face-local-measurement-receipt.v1",
};
const body = `${JSON.stringify(receipt, null, 2)}\n`;
if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
  await writeFile(resolve(process.argv[outputIndex + 1]), body);
} else {
  process.stdout.write(body);
}
