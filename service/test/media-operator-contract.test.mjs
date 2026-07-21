import assert from "node:assert/strict";
import test from "node:test";
import {
  inventoryOnlyMediaOperatorEnvelope,
  mediaOperatorDigest,
  mediaOperatorEnvelopeJsonSchema,
  validateMediaOperatorCommand,
  validateMediaOperatorEnvelope,
} from "../src/media-operator-contract.mjs";

test("media operator envelope freezes a small declared resource budget", () => {
  assert.deepEqual(validateMediaOperatorEnvelope({}), {
    candidateLimit: 24,
    leaseSeconds: 300,
    maxDetectionJobs: 1,
    maxDurationMs: 30_000,
    maxInventoryPages: 1,
    maxPendingJobs: 100,
    maxRecognitionJobs: 1,
  });
  assert.throws(
    () => validateMediaOperatorEnvelope({ maxRecognitionJobs: 26 }),
    (error) => error.code === "MEDIA_OPERATOR_ENVELOPE_INVALID",
  );
});

test("inventory-only operation is exact, provider-free and machine-described", () => {
  assert.deepEqual(
    validateMediaOperatorEnvelope(inventoryOnlyMediaOperatorEnvelope),
    inventoryOnlyMediaOperatorEnvelope,
  );
  assert.deepEqual([...mediaOperatorEnvelopeJsonSchema.required].sort(), [
    "candidateLimit",
    "leaseSeconds",
    "maxDetectionJobs",
    "maxDurationMs",
    "maxInventoryPages",
    "maxPendingJobs",
    "maxRecognitionJobs",
  ]);
  for (const invalid of [
    JSON.stringify(inventoryOnlyMediaOperatorEnvelope),
    [],
    null,
    { ...inventoryOnlyMediaOperatorEnvelope, hiddenStage: 1 },
  ]) {
    assert.throws(
      () => validateMediaOperatorEnvelope(invalid),
      (error) => error.code === "MEDIA_OPERATOR_ENVELOPE_INVALID",
    );
  }
});

test("media operator commands bind actor, action, id and exact envelope", () => {
  const command = validateMediaOperatorCommand({
    actorId: "synthetic-operator",
    commandId: "command-synthetic-0001",
    commandKind: "run",
    envelope: { maxDetectionJobs: 2 },
  });
  assert.equal(command.requestDigest.length, 64);
  assert.equal(command.envelope.maxDetectionJobs, 2);
  assert.equal(
    command.requestDigest,
    mediaOperatorDigest({
      actorId: command.actorId,
      commandId: command.commandId,
      commandKind: command.commandKind,
      envelope: command.envelope,
    }),
  );
});

test("media operator rejects ambiguous or unbounded commands", () => {
  assert.throws(
    () =>
      validateMediaOperatorCommand({
        actorId: "operator",
        commandId: "short",
        commandKind: "run",
      }),
    (error) => error.code === "MEDIA_OPERATOR_COMMAND_INVALID",
  );
  assert.throws(
    () =>
      validateMediaOperatorCommand({
        actorId: "operator",
        commandId: "command-synthetic-0002",
        commandKind: "start-everything",
      }),
    (error) => error.code === "MEDIA_OPERATOR_COMMAND_INVALID",
  );
});
