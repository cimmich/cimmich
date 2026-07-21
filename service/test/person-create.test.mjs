import assert from "node:assert/strict";
import test from "node:test";
import { createPersonCreateStore } from "../src/person-create.mjs";

const createSql = ({ duplicatePeople = [] } = {}) => {
  const calls = [];
  const commands = new Map();
  const people = [];
  const projections = [];
  const sql = async (strings, ...values) => {
    const statement = strings.join("?").replace(/\s+/g, " ").trim();
    calls.push({ statement, values });
    if (statement.includes("FROM person_create_command")) {
      const row = commands.get(values[0]);
      return row ? [row] : [];
    }
    if (statement.startsWith("SELECT pg_advisory_xact_lock")) return [];
    if (statement.startsWith("INSERT INTO person_create_command")) {
      commands.set(values[0], {
        actor_id: values[1],
        command_kind: values[2],
        request_digest: values[3],
        response_body: null,
        state: "started",
      });
      return [];
    }
    if (statement.startsWith("UPDATE person_create_command")) {
      const command = commands.get(values[3]);
      Object.assign(command, {
        person_id: values[0],
        decision_id: values[1],
        response_body: values[2],
        state: "completed",
      });
      return [];
    }
    if (statement.startsWith("SELECT projection.person_id")) {
      const projection = projections.find(
        (row) =>
          row.source_id === values[0] && row.immich_person_id === values[1],
      );
      if (!projection) return [];
      const person = people.find(
        (row) => row.person_id === projection.person_id,
      );
      return [
        { display_name: person.display_name, person_id: person.person_id },
      ];
    }
    if (statement.startsWith("LOCK TABLE")) return [];
    if (statement.startsWith("SELECT person.person_id")) return duplicatePeople;
    if (statement.startsWith("SELECT category_id FROM person_category")) {
      return [{ category_id: "category_sort" }];
    }
    if (statement.startsWith("INSERT INTO person (")) {
      people.push({ display_name: values[1], person_id: values[0] });
      return [];
    }
    if (
      statement.startsWith("INSERT INTO decision") ||
      statement.startsWith("INSERT INTO person_category_membership_event")
    ) {
      return [];
    }
    if (statement.startsWith("INSERT INTO immich_person_projection")) {
      projections.push({
        immich_person_id: values[1],
        person_id: values[2],
        source_id: values[0],
      });
      return [];
    }
    throw new Error(`Unexpected SQL: ${statement}`);
  };
  sql.begin = (callback) => callback(sql);
  sql.json = (value) => value;
  return { calls, commands, people, projections, sql };
};

test("Person creation is replay-safe, Sort-bound and does not duplicate Face identity semantics", async () => {
  const fixture = createSql();
  const store = createPersonCreateStore(fixture.sql);
  const first = await store.create({
    actorId: "person-editor",
    commandId: "person-create-native-0001",
    newPersonName: "  Audit   Fresh Person  ",
  });
  assert.equal(first.changed, true);
  assert.equal(first.createdPerson, true);
  assert.equal(first.personName, "Audit Fresh Person");
  assert.equal(first.source.kind, "cimmich_native");
  assert.equal(first.subjectKind, "person");
  assert.equal(first.schemaVersion, "cimmich.person-create.v1");
  assert.equal(fixture.people.length, 1);
  assert.ok(
    fixture.calls.some((call) =>
      call.statement.startsWith("INSERT INTO person_category_membership_event"),
    ),
  );

  const replay = await store.create({
    actorId: "person-editor",
    commandId: "person-create-native-0001",
    newPersonName: "Audit Fresh Person",
  });
  assert.equal(replay.personId, first.personId);
  assert.equal(replay.replayed, true);
  assert.equal(fixture.people.length, 1);
  await assert.rejects(
    store.create({
      actorId: "person-editor",
      commandId: "person-create-native-0001",
      newPersonName: "Different Person",
    }),
    (error) => error.code === "PERSON_CREATE_COMMAND_CONFLICT",
  );
  await assert.rejects(
    store.create({
      actorId: "different-person-editor",
      commandId: "person-create-native-0001",
      newPersonName: "Audit Fresh Person",
    }),
    (error) =>
      error.code === "PERSON_CREATE_COMMAND_CONFLICT" &&
      error.statusCode === 409 &&
      error.details === undefined &&
      !error.message.includes(first.personId),
  );
  await assert.rejects(
    store.create({
      actorId: "person-editor",
      commandId: "person-create-selector-0002",
      immichPersonId: "immich-person-one",
      newPersonName: "Not both",
    }),
    (error) => error.code === "PERSON_CREATE_SELECTOR_INVALID",
  );
});

test("Immich Person reconciliation consumes a minimized read projection and replays without a second upstream read", async () => {
  const fixture = createSql();
  let reads = 0;
  const store = createPersonCreateStore(fixture.sql, {
    companion: {
      getPerson: async ({ personId }) => {
        reads += 1;
        return {
          person: {
            id: personId,
            name: "Audit Immich Person",
            sourceRevision: "a".repeat(64),
          },
        };
      },
    },
    immichSourceId: "immich-test",
  });
  const first = await store.create({
    actorId: "person-editor",
    commandId: "person-create-immich-0001",
    immichPersonId: "immich-person-one",
  });
  assert.equal(first.source.kind, "immich_person");
  assert.equal(first.source.sourcePersonId, "immich-person-one");
  assert.equal(fixture.projections.length, 1);
  assert.equal(reads, 1);
  const replay = await store.create({
    actorId: "person-editor",
    commandId: "person-create-immich-0001",
    immichPersonId: "immich-person-one",
  });
  assert.equal(replay.replayed, true);
  assert.equal(reads, 1);
});

test("Person creation fails closed on display-name or alias collision", async () => {
  const fixture = createSql({
    duplicatePeople: [
      { display_name: "Existing Person", person_id: "person-existing" },
    ],
  });
  const store = createPersonCreateStore(fixture.sql);
  await assert.rejects(
    store.create({
      actorId: "person-editor",
      commandId: "person-create-conflict-0001",
      newPersonName: "Existing Person",
    }),
    (error) =>
      error.code === "PERSON_NAME_CONFLICT" &&
      error.details.existingPeople[0].personId === "person-existing",
  );
  assert.equal(fixture.people.length, 0);
});

test("Immich Person reconciliation fails closed on projection identity or revision drift", async () => {
  for (const person of [
    { id: "different-person", name: "Drift", sourceRevision: "a".repeat(64) },
    { id: "immich-person-one", name: "Drift", sourceRevision: "not-a-digest" },
  ]) {
    const fixture = createSql();
    const store = createPersonCreateStore(fixture.sql, {
      companion: { getPerson: async () => ({ person }) },
      immichSourceId: "immich-test",
    });
    await assert.rejects(
      store.create({
        actorId: "person-editor",
        commandId: `person-create-drift-${person.id}`,
        immichPersonId: "immich-person-one",
      }),
      (error) =>
        error.code === "IMMICH_PERSON_PROJECTION_MISMATCH" ||
        error.code === "IMMICH_PERSON_PROJECTION_INVALID",
    );
    assert.equal(fixture.people.length, 0);
  }
});
