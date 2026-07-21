#!/usr/bin/env node
import { evaluateMatchingLever } from "../src/matching-lever-gate.mjs";

let raw = "";
let bytes = 0;
for await (const chunk of process.stdin) {
  bytes += chunk.length;
  if (bytes > 1024 * 1024) {
    throw Object.assign(new Error("Matching lever input is too large"), {
      code: "MATCHING_LEVER_INPUT_TOO_LARGE",
    });
  }
  raw += chunk;
}
if (!raw.trim()) {
  throw Object.assign(new Error("Matching lever input is required on stdin"), {
    code: "MATCHING_LEVER_INPUT_REQUIRED",
  });
}

const receipt = evaluateMatchingLever(JSON.parse(raw));
process.stdout.write(`${JSON.stringify(receipt)}\n`);
