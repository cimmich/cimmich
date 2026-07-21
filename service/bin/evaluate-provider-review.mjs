#!/usr/bin/env node
import { evaluateProviderReview } from "../src/provider-review-gate.mjs";

let raw = "";
let bytes = 0;
for await (const chunk of process.stdin) {
  bytes += chunk.length;
  if (bytes > 1024 * 1024) {
    throw Object.assign(new Error("Provider review input is too large"), {
      code: "PROVIDER_REVIEW_INPUT_TOO_LARGE",
    });
  }
  raw += chunk;
}
if (!raw.trim()) {
  throw Object.assign(new Error("Provider review input is required on stdin"), {
    code: "PROVIDER_REVIEW_INPUT_REQUIRED",
  });
}

const receipt = evaluateProviderReview(JSON.parse(raw));
process.stdout.write(`${JSON.stringify(receipt)}\n`);
