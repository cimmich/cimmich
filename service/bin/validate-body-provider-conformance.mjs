#!/usr/bin/env node
import {
  createBodyProviderConformanceReceipt,
  validateBodyProviderConformance,
} from "../src/body-provider-conformance.mjs";

const maximumInputBytes = 1024 * 1024;

const emitError = (code) => {
  process.stderr.write(`${JSON.stringify({ error: { code } })}\n`);
  process.exitCode = 1;
};

const main = async () => {
  let raw = "";
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > maximumInputBytes) {
      emitError("BODY_PROVIDER_CONFORMANCE_INPUT_TOO_LARGE");
      return;
    }
    raw += chunk;
  }
  if (!raw.trim()) {
    emitError("BODY_PROVIDER_CONFORMANCE_INPUT_REQUIRED");
    return;
  }
  try {
    const validation = validateBodyProviderConformance(JSON.parse(raw));
    process.stdout.write(
      `${JSON.stringify(createBodyProviderConformanceReceipt(validation))}\n`,
    );
  } catch {
    emitError("BODY_PROVIDER_CONFORMANCE_INPUT_INVALID");
  }
};

await main();
