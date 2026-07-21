import { createHash } from "node:crypto";

export const mediaOperatorContractVersion = "cimmich.media-operator.v1";

const commandKinds = new Set(["pause", "resume", "run"]);
const commandIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const envelopeKeys = new Set([
  "candidateLimit",
  "leaseSeconds",
  "maxDetectionJobs",
  "maxDurationMs",
  "maxInventoryPages",
  "maxPendingJobs",
  "maxRecognitionJobs",
]);

export const mediaOperatorEnvelopeJsonSchema = {
  additionalProperties: false,
  properties: {
    candidateLimit: { maximum: 80, minimum: 0, type: "integer" },
    leaseSeconds: { maximum: 3_600, minimum: 30, type: "integer" },
    maxDetectionJobs: { maximum: 25, minimum: 0, type: "integer" },
    maxDurationMs: { maximum: 300_000, minimum: 100, type: "integer" },
    maxInventoryPages: { maximum: 25, minimum: 0, type: "integer" },
    maxPendingJobs: { maximum: 10_000, minimum: 1, type: "integer" },
    maxRecognitionJobs: { maximum: 25, minimum: 0, type: "integer" },
  },
  required: [...envelopeKeys],
  type: "object",
};

export const inventoryOnlyMediaOperatorEnvelope = {
  candidateLimit: 0,
  leaseSeconds: 300,
  maxDetectionJobs: 0,
  maxDurationMs: 30_000,
  maxInventoryPages: 1,
  maxPendingJobs: 100,
  maxRecognitionJobs: 0,
};

const boundedInteger = (value, label, minimum, maximum) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw Object.assign(
      new Error(`${label} must be an integer from ${minimum} to ${maximum}`),
      { code: "MEDIA_OPERATOR_ENVELOPE_INVALID", statusCode: 400 },
    );
  }
  return number;
};

const requiredText = (value, label, maximum = 128) => {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maximum) {
    throw Object.assign(new Error(`Media operator requires ${label}`), {
      code: "MEDIA_OPERATOR_COMMAND_INVALID",
      statusCode: 400,
    });
  }
  return normalized;
};

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
};

export const mediaOperatorDigest = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");

export const validateMediaOperatorEnvelope = (input = {}) => {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !envelopeKeys.has(key))
  ) {
    throw Object.assign(new Error("Media operator envelope must be exact"), {
      code: "MEDIA_OPERATOR_ENVELOPE_INVALID",
      statusCode: 400,
    });
  }
  return {
    candidateLimit: boundedInteger(
      input.candidateLimit ?? 24,
      "candidateLimit",
      0,
      80,
    ),
    leaseSeconds: boundedInteger(
      input.leaseSeconds ?? 300,
      "leaseSeconds",
      30,
      3600,
    ),
    maxDetectionJobs: boundedInteger(
      input.maxDetectionJobs ?? 1,
      "maxDetectionJobs",
      0,
      25,
    ),
    maxDurationMs: boundedInteger(
      input.maxDurationMs ?? 30_000,
      "maxDurationMs",
      100,
      300_000,
    ),
    maxInventoryPages: boundedInteger(
      input.maxInventoryPages ?? 1,
      "maxInventoryPages",
      0,
      25,
    ),
    maxPendingJobs: boundedInteger(
      input.maxPendingJobs ?? 100,
      "maxPendingJobs",
      1,
      10_000,
    ),
    maxRecognitionJobs: boundedInteger(
      input.maxRecognitionJobs ?? 1,
      "maxRecognitionJobs",
      0,
      25,
    ),
  };
};

export const validateMediaOperatorCommand = (input = {}) => {
  const commandId = requiredText(input.commandId, "commandId");
  if (!commandIdPattern.test(commandId)) {
    throw Object.assign(new Error("Media operator commandId is invalid"), {
      code: "MEDIA_OPERATOR_COMMAND_INVALID",
      statusCode: 400,
    });
  }
  const commandKind = requiredText(input.commandKind, "commandKind", 16);
  if (!commandKinds.has(commandKind)) {
    throw Object.assign(new Error("Media operator commandKind is invalid"), {
      code: "MEDIA_OPERATOR_COMMAND_INVALID",
      statusCode: 400,
    });
  }
  const actorId = requiredText(input.actorId, "actorId");
  const envelope = validateMediaOperatorEnvelope(input.envelope);
  const request = { actorId, commandId, commandKind, envelope };
  return { ...request, requestDigest: mediaOperatorDigest(request) };
};
