#!/usr/bin/env node
import {
  createMatchingQcReceipt,
  createMatchingQcReceiptV2,
  createMatchingQcReviewPacket,
  createMatchingQcReviewPacketV2,
  matchingQcCohortV2SchemaVersion,
  matchingQcReviewPacketV2SchemaVersion,
  validateMatchingQcCompletion,
  validateMatchingQcCompletionV2,
} from "../src/matching-qc-cohort.mjs";

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
      emitError("MATCHING_QC_INPUT_TOO_LARGE");
      return;
    }
    raw += chunk;
  }
  if (!raw.trim()) {
    emitError("MATCHING_QC_INPUT_REQUIRED");
    return;
  }
  try {
    const value = JSON.parse(raw);
    if (value?.action === "prepare") {
      if (Object.keys(value).length !== 2 || !Object.hasOwn(value, "cohort")) {
        throw new Error("invalid prepare input");
      }
      const prepare =
        value.cohort?.schemaVersion === matchingQcCohortV2SchemaVersion
          ? createMatchingQcReviewPacketV2
          : createMatchingQcReviewPacket;
      process.stdout.write(`${JSON.stringify(prepare(value.cohort))}\n`);
      return;
    }
    if (value?.action === "evaluate") {
      if (
        Object.keys(value).length !== 3 ||
        !Object.hasOwn(value, "completion") ||
        !Object.hasOwn(value, "packet")
      ) {
        throw new Error("invalid evaluate input");
      }
      const v2 =
        value.packet?.schemaVersion === matchingQcReviewPacketV2SchemaVersion;
      const validation = (
        v2 ? validateMatchingQcCompletionV2 : validateMatchingQcCompletion
      )({
        completion: value.completion,
        packet: value.packet,
      });
      process.stdout.write(
        `${JSON.stringify(
          v2
            ? createMatchingQcReceiptV2(validation)
            : createMatchingQcReceipt(validation),
        )}\n`,
      );
      return;
    }
    throw new Error("unsupported action");
  } catch {
    emitError("MATCHING_QC_INPUT_INVALID");
  }
};

await main();
