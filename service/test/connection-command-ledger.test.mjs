import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canonicalConnectionCommand,
  claimConnectionCommand,
  completeConnectionCommand,
} from "../src/connection-command-ledger.mjs";

const fakeLedgerTransaction = () => {
  const rows = new Map();
  const statements = [];
  const transaction = async (strings, ...values) => {
    const statement = strings.join("?");
    statements.push(statement);
    if (statement.includes("INSERT INTO connection_command_ledger")) {
      if (rows.has(values[0])) return [];
      rows.set(values[0], {
        actor_id: values[2],
        operation: values[1],
        request_digest: values[3],
        request_payload: values[4],
        response_body: null,
        state: "pending",
      });
      return [{ command_id: values[0] }];
    }
    if (statement.includes("FROM connection_command_ledger")) {
      return [rows.get(values[0])].filter(Boolean);
    }
    if (statement.includes("UPDATE connection_command_ledger")) {
      const row = rows.get(values[1]);
      if (!row || row.state !== "pending") return [];
      Object.assign(row, { response_body: values[0], state: "complete" });
      return [{ command_id: values[1] }];
    }
    throw new Error(`Unexpected ledger SQL: ${statement}`);
  };
  transaction.json = (value) => structuredClone(value);
  return { rows, statements, transaction };
};

test("connection command canonicalization is stable across object key order", () => {
  assert.equal(
    canonicalConnectionCommand({ target: "person_b", nested: { z: 1, a: 2 } })
      .digest,
    canonicalConnectionCommand({ nested: { a: 2, z: 1 }, target: "person_b" })
      .digest,
  );
});

test("identical connection command replay returns the exact durable response", async () => {
  const { statements, transaction } = fakeLedgerTransaction();
  const command = {
    actorId: "owner-a",
    commandId: "connection.record.0001",
    operation: "connection.record_fact",
    payload: { personId: "person_a", targetId: "person_b" },
  };
  assert.equal(
    (await claimConnectionCommand(transaction, command)).response,
    null,
  );
  const response = Object.freeze({
    fact: { factId: "connectionfact_1" },
    replayed: false,
    schemaVersion: "cimmich.connection-facts.v4",
  });
  await completeConnectionCommand(transaction, {
    commandId: command.commandId,
    response,
  });
  assert.deepEqual(
    (await claimConnectionCommand(transaction, command)).response,
    response,
  );
  assert.ok(statements.some((statement) => statement.includes("ON CONFLICT")));
  assert.ok(statements.some((statement) => statement.includes("FOR UPDATE")));
});

test("connection command replay rejects actor, operation and payload drift", async () => {
  for (const drift of [
    { actorId: "owner-b" },
    { operation: "connection.retract_fact" },
    { payload: { personId: "person_a", targetId: "person_c" } },
  ]) {
    const { transaction } = fakeLedgerTransaction();
    const command = {
      actorId: "owner-a",
      commandId: "connection.record.0002",
      operation: "connection.record_fact",
      payload: { personId: "person_a", targetId: "person_b" },
    };
    await claimConnectionCommand(transaction, command);
    await completeConnectionCommand(transaction, {
      commandId: command.commandId,
      response: { factId: "connectionfact_1" },
    });
    await assert.rejects(
      claimConnectionCommand(transaction, { ...command, ...drift }),
      (error) =>
        error.statusCode === 409 &&
        error.code === "CONNECTION_COMMAND_REPLAY_CONFLICT",
    );
  }
});

test("migration makes connection history append-only and serializes backup runs", async () => {
  const source = await readFile(
    new URL(
      "../../migrations/0156_connection_command_ledger_append_only_v1.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /CREATE TABLE connection_command_ledger/);
  assert.match(source, /state IN \('legacy','pending','complete'\)/);
  assert.match(source, /BEFORE UPDATE OR DELETE ON connection_fact_event/);
  assert.match(
    source,
    /BEFORE UPDATE OR DELETE ON connection_fact_context_event/,
  );
  assert.match(
    source,
    /BEFORE UPDATE OR DELETE ON connection_fact_event_modifier/,
  );
  assert.match(source, /WHERE state IN \('queued','running'\)/);
});
