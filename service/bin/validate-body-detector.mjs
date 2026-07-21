#!/usr/bin/env node
import {
  createBodyDetectionValidationReceipt,
  validateBodyDetectorPacket,
} from "../src/body-detector-contract.mjs";

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
      emitError("BODY_DETECTOR_INPUT_TOO_LARGE");
      return;
    }
    raw += chunk;
  }
  if (!raw.trim()) {
    emitError("BODY_DETECTOR_INPUT_REQUIRED");
    return;
  }
  try {
    const validation = validateBodyDetectorPacket(JSON.parse(raw));
    process.stdout.write(
      `${JSON.stringify(createBodyDetectionValidationReceipt(validation))}\n`,
    );
  } catch {
    emitError("BODY_DETECTOR_INPUT_INVALID");
  }
};

await main();
