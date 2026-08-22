import { createHash } from "node:crypto";

const typedError = (message, statusCode, code) =>
  Object.assign(new Error(message), { code, statusCode });

const canonicalValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalValue(nested)]),
    );
  }
  return value;
};

export const contextCommandDigest = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex");

export const cleanContextActor = (value) => {
  const actor = String(value || "").trim();
  if (!actor || actor.length > 120) {
    throw typedError(
      "A Cimmich actor of 1 to 120 characters is required",
      400,
      "CONTEXT_ACTOR_REQUIRED",
    );
  }
  return actor;
};

export const cleanContextCommandId = (value) => {
  const commandId = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$/.test(commandId)) {
    throw typedError(
      "A stable commandId of 8 to 120 safe characters is required",
      400,
      "CONTEXT_COMMAND_ID_INVALID",
    );
  }
  return commandId;
};
