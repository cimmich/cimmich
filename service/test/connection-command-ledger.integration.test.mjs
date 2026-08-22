import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { createConnectionFactStore } from "../src/connection-facts.mjs";

const databaseUrl = process.env.CIMMICH_TEST_DATABASE_URL || "";
const databaseTest = databaseUrl ? test : test.skip;

databaseTest(
  "connection command ledger serializes exact concurrent replay and rejects drift",
  async () => {
    const sql = postgres(databaseUrl, { max: 4, prepare: true });
    const store = createConnectionFactStore({
      presentationRank: () => 3,
      sql,
    });
    const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
    const commandId = `connection.type.concurrent.${suffix}`;
    const request = {
      actorId: "integration-owner-a",
      commandId,
      input: {
        inverseLabel: `Test relation ${suffix}`,
        label: `Test relation ${suffix}`,
        symmetric: true,
        targetKind: "person",
      },
    };
    try {
      const sourceId = `person_${randomUUID().replaceAll("-", "")}`;
      const targetId = `person_${randomUUID().replaceAll("-", "")}`;
      await sql`
        INSERT INTO person (person_id, display_name, status, created_by_receipt_id)
        VALUES
          (${sourceId}, ${`Source ${suffix}`}, 'active', 'receipt_cimmich_context_entity_v1'),
          (${targetId}, ${`Target ${suffix}`}, 'active', 'receipt_cimmich_context_entity_v1')
      `;
      const [first, concurrentReplay] = await Promise.all([
        store.createType(request),
        store.createType(request),
      ]);
      assert.deepEqual(concurrentReplay, first);
      assert.equal(first.type.label, request.input.label);

      const exactReplay = await store.createType(request);
      assert.deepEqual(exactReplay, first);
      await assert.rejects(
        store.createType({ ...request, actorId: "integration-owner-b" }),
        (error) => error.statusCode === 409,
      );
      await assert.rejects(
        store.createType({
          ...request,
          input: {
            ...request.input,
            inverseLabel: `${request.input.label} drift`,
            label: `${request.input.label} drift`,
          },
        }),
        (error) => error.statusCode === 409,
      );
      await assert.rejects(
        store.createModifier({
          actorId: request.actorId,
          commandId,
          input: { label: "Operation drift" },
        }),
        (error) => error.statusCode === 409,
      );

      const recordRequest = {
        actorId: request.actorId,
        commandId: `connection.fact.concurrent.${suffix}`,
        input: {
          modifierIds: [],
          targetId,
          targetKind: "person",
          typeId: "connectiontype_friend",
        },
        personId: sourceId,
      };
      const [recorded, recordReplay] = await Promise.all([
        store.record(recordRequest),
        store.record(recordRequest),
      ]);
      assert.deepEqual(recordReplay, recorded);
      assert.ok(recorded.fact?.factId);
      await assert.rejects(
        store.record({ ...recordRequest, actorId: "integration-owner-b" }),
        (error) => error.statusCode === 409,
      );
      await assert.rejects(
        sql`UPDATE connection_fact_event SET note = 'tampered'
            WHERE fact_id = ${recorded.fact.factId}`,
        (error) => error.code === "55000",
      );

      const retractRequest = {
        actorId: request.actorId,
        commandId: `connection.retract.concurrent.${suffix}`,
        factId: recorded.fact.factId,
        personId: sourceId,
      };
      const [retracted, retractReplay] = await Promise.all([
        store.retract(retractRequest),
        store.retract(retractRequest),
      ]);
      assert.deepEqual(retractReplay, retracted);

      const dismissRequest = {
        actorId: request.actorId,
        commandId: `connection.dismiss.concurrent.${suffix}`,
        personId: sourceId,
        suggestion: `connection-suggestion:${suffix}`,
      };
      const [dismissed, dismissReplay] = await Promise.all([
        store.dismissSuggestion(dismissRequest),
        store.dismissSuggestion(dismissRequest),
      ]);
      assert.deepEqual(dismissReplay, dismissed);

      await assert.rejects(
        sql`UPDATE connection_command_ledger SET actor_id = 'tampered'
            WHERE command_id = ${commandId}`,
        (error) => error.code === "55000",
      );
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
);
