import assert from "node:assert/strict";
import test from "node:test";
import { createConnectionFactRoutes } from "../src/connection-fact-routes.mjs";

const responseFor = async ({ body = {}, method, pathname, repository }) => {
  const calls = [];
  const route = createConnectionFactRoutes(
    repository,
    (surface) => calls.push(["projection", surface]),
    async () => body,
    (_response, status, payload) => calls.push(["json", status, payload]),
  );
  const handled = await route(
    { headers: { "x-cimmich-actor": "owner" }, method },
    {},
    new URL(`http://cimmich.local${pathname}`),
    "",
  );
  return { calls, handled };
};

test("connection fact routes expose Person facts and owner-authored types", async () => {
  const repository = {
    connectionModifiers: async () => [
      { behavior: "historical", label: "Former" },
    ],
    connectionTypes: async ({ targetKind }) => [
      { label: "Co-worker", targetKind },
    ],
    personConnectionFacts: async ({ personId }) => ({
      facts: [],
      personId,
      suggestions: [],
    }),
  };
  const types = await responseFor({
    method: "GET",
    pathname: "/v1/connection-types?targetKind=person",
    repository,
  });
  assert.equal(types.handled, true);
  assert.deepEqual(types.calls[0], ["projection", "people"]);
  assert.equal(types.calls[1][2].items[0].targetKind, "person");

  const modifiers = await responseFor({
    method: "GET",
    pathname: "/v1/connection-modifiers",
    repository,
  });
  assert.equal(modifiers.handled, true);
  assert.equal(modifiers.calls[1][2].items[0].label, "Former");
  assert.equal(
    modifiers.calls[1][2].schemaVersion,
    "cimmich.connection-facts.v4",
  );

  const facts = await responseFor({
    method: "GET",
    pathname: "/v1/people/person_123/connection-facts",
    repository,
  });
  assert.equal(facts.calls[1][2].personId, "person_123");
});

test("connection modifier creation is an explicit owner write", async () => {
  let received;
  const repository = {
    createConnectionModifier: async (input) => {
      received = input;
      return { modifier: { label: input.input.label } };
    },
  };
  const result = await responseFor({
    body: { commandId: "connection.modifier.school", label: "School" },
    method: "POST",
    pathname: "/v1/connection-modifiers",
    repository,
  });
  assert.equal(result.handled, true);
  assert.equal(received.actorId, "owner");
  assert.equal(received.input.label, "School");
});

test("connection fact routes keep confirmation and dismissal as explicit writes", async () => {
  const received = [];
  const repository = {
    dismissConnectionSuggestion: async (input) => {
      received.push(["dismiss", input]);
      return { suggestionKey: input.suggestion };
    },
    recordConnectionFact: async (input) => {
      received.push(["record", input]);
      return { fact: { factId: "connectionfact_1" } };
    },
  };
  await responseFor({
    body: {
      commandId: "connection.record.123",
      contextIds: ["place_cedar_house"],
      targetId: "place_123",
      targetKind: "place",
      typeId: "connectiontype_works_at",
      validity: "past",
    },
    method: "POST",
    pathname: "/v1/people/person_123/connection-facts",
    repository,
  });
  await responseFor({
    body: { commandId: "connection.dismiss.123" },
    method: "POST",
    pathname:
      "/v1/people/person_123/connection-suggestions/connection-suggestion%3Aabc:dismiss",
    repository,
  });
  assert.equal(received[0][0], "record");
  assert.equal(received[0][1].actorId, "owner");
  assert.equal(received[0][1].input.validity, "past");
  assert.deepEqual(received[0][1].input.contextIds, ["place_cedar_house"]);
  assert.equal(received[1][0], "dismiss");
  assert.equal(received[1][1].suggestion, "connection-suggestion:abc");
});

test("connection hub route passes one reviewed multi-person command", async () => {
  let received;
  const repository = {
    recordConnectionHub: async (input) => {
      received = input;
      return { members: input.input.members, replayed: false };
    },
  };
  const body = {
    commandId: "connection.hub.school-friends",
    displayName: "School friends",
    hubKind: "group",
    members: [
      { personId: "person_1", typeId: "connectiontype_member_of" },
      { personId: "person_2", typeId: "connectiontype_member_of" },
    ],
  };
  const result = await responseFor({
    body,
    method: "POST",
    pathname: "/v1/connection-hubs:record",
    repository,
  });
  assert.equal(result.handled, true);
  assert.equal(received.actorId, "owner");
  assert.equal(received.commandId, body.commandId);
  assert.deepEqual(received.input.members, body.members);
  assert.deepEqual(result.calls[1][2].members, body.members);
});
