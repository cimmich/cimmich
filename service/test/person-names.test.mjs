import assert from "node:assert/strict";
import test from "node:test";

import { createPersonNameStore } from "../src/person-names.mjs";

const createStore = ({ conflict = false, sameName = false } = {}) => {
  const calls = [];
  let receiptCount = 0;
  const tx = async (strings, ...values) => {
    const query = strings.join("?");
    calls.push({ query, values });
    if (query.includes("SELECT person_id, display_name FROM person")) {
      return [
        {
          display_name: sameName ? "Desired Name" : "Imported Label",
          person_id: "person.one",
        },
      ];
    }
    if (query.includes("FROM current_person candidate")) {
      return conflict
        ? [{ display_name: "Desired Name", person_id: "person.other" }]
        : [];
    }
    if (query.includes("SET state = 'superseded'")) {
      return [{ alias_id: "alias.promoted" }];
    }
    if (query.includes("SELECT alias_id FROM person_alias")) return [];
    return [];
  };
  const sql = { begin: async (run) => run(tx) };
  const store = createPersonNameStore({
    cleanActor: (value) => String(value || "").trim(),
    cleanAliasKind: (value) => value,
    cleanPersonName: (value) => String(value || "").trim(),
    ensureUserCommandReceipt: async () => {
      receiptCount += 1;
    },
    requireVisibleSubject: async () => undefined,
    sql,
    userCommandReceiptId: "receipt.user",
  });
  return { calls, receiptCount: () => receiptCount, store };
};

test("display-name change promotes the requested alias and retains the previous name", async () => {
  const harness = createStore();

  const result = await harness.store.setPersonDisplayName({
    actorId: "owner",
    displayName: "Desired Name",
    personId: "person.one",
  });

  assert.equal(result.changed, true);
  assert.equal(result.displayName, "Desired Name");
  assert.equal(result.previousDisplayName, "Imported Label");
  assert.equal(harness.receiptCount(), 1);
  assert.ok(
    harness.calls.some(
      ({ query, values }) =>
        query.includes("INSERT INTO person_alias") &&
        query.includes("'former_name'") &&
        values.includes("Imported Label"),
    ),
  );
  assert.ok(
    harness.calls.some(
      ({ query, values }) =>
        query.includes("SET state = 'superseded'") &&
        values.includes("Desired Name"),
    ),
  );
  assert.ok(
    harness.calls.some(
      ({ query, values }) =>
        query.includes("UPDATE person SET display_name") &&
        values.includes("Desired Name"),
    ),
  );
  assert.ok(
    harness.calls.some(({ query }) =>
      query.includes("identity_setup_display_name_update"),
    ),
  );
});

test("display-name change rejects another Person's display name or alias", async () => {
  const harness = createStore({ conflict: true });

  await assert.rejects(
    harness.store.setPersonDisplayName({
      actorId: "owner",
      displayName: "Desired Name",
      personId: "person.one",
    }),
    (error) =>
      error.code === "PERSON_NAME_CONFLICT" &&
      error.statusCode === 409 &&
      error.details.existingPeople[0].personId === "person.other",
  );

  assert.equal(harness.receiptCount(), 0);
  assert.equal(
    harness.calls.some(({ query }) => query.includes("UPDATE person SET")),
    false,
  );
});

test("display-name replay with equivalent casing performs no write", async () => {
  const harness = createStore({ sameName: true });

  const result = await harness.store.setPersonDisplayName({
    actorId: "owner",
    displayName: "desired name",
    personId: "person.one",
  });

  assert.equal(result.changed, false);
  assert.equal(result.displayName, "Desired Name");
  assert.equal(harness.receiptCount(), 0);
});
