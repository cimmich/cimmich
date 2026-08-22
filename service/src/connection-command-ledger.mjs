import { createHash } from "node:crypto";

const replayConflict = (message, details = {}) =>
  Object.assign(new Error(message), {
    code: "CONNECTION_COMMAND_REPLAY_CONFLICT",
    details,
    statusCode: 409,
  });

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
};

export const canonicalConnectionCommand = (payload) => {
  const request = canonicalize(payload);
  const encoded = JSON.stringify(request);
  return {
    digest: createHash("sha256").update(encoded).digest("hex"),
    request,
  };
};

export const claimConnectionCommand = async (
  transaction,
  { actorId, commandId, operation, payload },
) => {
  const canonical = canonicalConnectionCommand(payload);
  const inserted = await transaction`
    INSERT INTO connection_command_ledger (
      command_id, operation, actor_id, request_digest, request_payload, state
    ) VALUES (
      ${commandId}, ${operation}, ${actorId}, ${canonical.digest},
      ${transaction.json(canonical.request)}, 'pending'
    )
    ON CONFLICT (command_id) DO NOTHING
    RETURNING command_id
  `;
  const [row] = await transaction`
    SELECT operation, actor_id, request_digest, state, response_body
    FROM connection_command_ledger
    WHERE command_id = ${commandId}
    FOR UPDATE
  `;
  if (!row) {
    throw new Error("Connection command ledger did not retain its claim");
  }
  if (
    row.operation !== operation ||
    row.actor_id !== actorId ||
    row.request_digest !== canonical.digest
  ) {
    throw replayConflict(
      "commandId is already bound to a different connection command",
      { operation: row.operation, state: row.state },
    );
  }
  if (row.state === "complete") {
    if (!row.response_body || typeof row.response_body !== "object") {
      throw replayConflict(
        "Completed connection command has no replay response",
      );
    }
    return { response: row.response_body };
  }
  if (row.state !== "pending" || inserted.length === 0) {
    throw replayConflict("Connection command is not safely replayable", {
      operation: row.operation,
      state: row.state,
    });
  }
  return { response: null };
};

export const completeConnectionCommand = async (
  transaction,
  { commandId, response },
) => {
  const rows = await transaction`
    UPDATE connection_command_ledger
    SET state = 'complete', response_body = ${transaction.json(response)},
      completed_at = now()
    WHERE command_id = ${commandId} AND state = 'pending'
    RETURNING command_id
  `;
  if (rows.length !== 1) {
    throw new Error("Connection command ledger completion was not exclusive");
  }
  return response;
};
