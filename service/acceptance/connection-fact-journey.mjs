import assert from "node:assert/strict";

const root = process.env.CIMMICH_ACCEPTANCE_ROOT || "http://127.0.0.1:3101";
const phase = process.env.CIMMICH_CONNECTION_FACT_PHASE || "all";
const profilePersonId = "person_profile_acceptance_fixture";
const coworkerPersonId = "person_service_fixture";
const groupName = "Synthetic school friends";
const headers = {
  "content-type": "application/json",
  "x-cimmich-actor": "synthetic-connection-editor",
};

const request = async (path, { body, method = "GET", status = 200 } = {}) => {
  const response = await fetch(`${root}${path}`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers,
    method,
  });
  const payload = await response.json();
  assert.equal(response.status, status, JSON.stringify(payload));
  return payload;
};

const workplace = async () => {
  const places = await request(
    `/v1/places?q=${encodeURIComponent("Synthetic Greek beach")}`,
  );
  const place = places.items.find(
    ({ displayName }) => displayName === "Synthetic Greek beach",
  );
  assert.ok(place);
  return place;
};

const assertPersisted = async () => {
  const place = await workplace();
  const objects = await request(
    `/v1/objects?q=${encodeURIComponent(groupName)}`,
  );
  const group = objects.items.find(
    ({ displayName }) => displayName === groupName,
  );
  assert.ok(group);
  const projection = await request(
    `/v1/people/${profilePersonId}/connection-facts`,
  );
  assert.equal(projection.schemaVersion, "cimmich.connection-facts.v4");
  assert.deepEqual(
    projection.facts.map(
      ({ contexts, displayLabel, modifiers, other, validity }) => ({
        contextLabels: contexts.map(({ displayName }) => displayName),
        displayLabel,
        modifierLabels: modifiers.map(({ label }) => label),
        otherId: other.id,
        validity,
      }),
    ),
    [
      {
        contextLabels: [],
        displayLabel: "Member (Childhood)",
        modifierLabels: ["Childhood"],
        otherId: group.entityId,
        validity: "current",
      },
      {
        contextLabels: ["Synthetic Greek beach"],
        displayLabel: "Co-worker (Childhood)",
        modifierLabels: ["Childhood"],
        otherId: coworkerPersonId,
        validity: "current",
      },
      {
        contextLabels: [],
        displayLabel: "Mentor (Former, Childhood)",
        modifierLabels: ["Former", "Childhood"],
        otherId: coworkerPersonId,
        validity: "past",
      },
      {
        contextLabels: [],
        displayLabel: "Worked here",
        modifierLabels: [],
        otherId: place.entityId,
        validity: "past",
      },
    ],
  );
  assert.deepEqual(projection.suggestions, []);
  const placeDetail = await request(`/v1/places/${place.entityId}`);
  assert.deepEqual(
    placeDetail.relations
      .filter(({ relationOrigin }) => relationOrigin === "relationship_context")
      .map(({ relationshipLabel, targetId }) => ({
        relationshipLabel,
        targetId,
      })),
    [
      {
        relationshipLabel:
          "Co-worker (Childhood) with Synthetic Profile Person",
        targetId: coworkerPersonId,
      },
      {
        relationshipLabel: "Co-worker (Childhood) with Synthetic Person",
        targetId: profilePersonId,
      },
    ],
  );
};

if (phase === "write" || phase === "all") {
  const place = await workplace();
  const personTypes = await request("/v1/connection-types?targetKind=person");
  const placeTypes = await request("/v1/connection-types?targetKind=place");
  const objectTypes = await request("/v1/connection-types?targetKind=object");
  const coworkerType = personTypes.items.find(
    ({ semanticKind }) => semanticKind === "coworker",
  );
  const workplaceType = placeTypes.items.find(
    ({ semanticKind }) => semanticKind === "works_at",
  );
  const memberType = objectTypes.items.find(
    ({ semanticKind }) => semanticKind === "member_of",
  );
  assert.ok(coworkerType && workplaceType && memberType);
  assert.equal(
    personTypes.items.some(({ typeId }) => typeId === "connectiontype_ex"),
    false,
  );
  assert.equal(coworkerType.temporalMode, "current_or_past");
  assert.equal(coworkerType.pastLabel, "Co-worker (Former)");

  const customType = await request("/v1/connection-types", {
    body: {
      commandId: "connection.type.mentor-0001",
      inverseLabel: "Mentee",
      label: "Mentor",
      targetKind: "person",
      temporalMode: "none",
    },
    method: "POST",
  });
  assert.equal(customType.type.temporalMode, "current_or_past");
  assert.equal(customType.type.pastLabel, "Mentor (Former)");
  assert.equal(customType.type.inversePastLabel, "Mentee (Former)");

  const childhoodModifier = await request("/v1/connection-modifiers", {
    body: {
      commandId: "connection.modifier.childhood-0001",
      label: "Childhood",
    },
    method: "POST",
  });
  assert.equal(childhoodModifier.schemaVersion, "cimmich.connection-facts.v4");
  assert.equal(childhoodModifier.modifier.behavior, "qualifier");
  assert.equal(childhoodModifier.modifier.ownerCreated, true);
  const modifiers = await request("/v1/connection-modifiers");
  assert.equal(modifiers.items[0].label, "Former");
  assert.ok(modifiers.items.some(({ label }) => label === "Childhood"));
  const formerModifier = modifiers.items.find(
    ({ label }) => label === "Former",
  );
  assert.ok(formerModifier);

  const coworkerBody = {
    commandId: "connection.fact.coworker-0001",
    contextIds: [place.entityId],
    targetId: coworkerPersonId,
    targetKind: "person",
    typeId: coworkerType.typeId,
    modifierIds: [childhoodModifier.modifier.modifierId],
  };
  const coworker = await request(
    `/v1/people/${profilePersonId}/connection-facts`,
    { body: coworkerBody, method: "POST" },
  );
  assert.equal(coworker.replayed, false);
  const coworkerReplay = await request(
    `/v1/people/${profilePersonId}/connection-facts`,
    { body: coworkerBody, method: "POST" },
  );
  assert.equal(coworkerReplay.replayed, true);
  const coworkerFromOtherSide = await request(
    `/v1/people/${coworkerPersonId}/connection-facts`,
    {
      body: {
        ...coworkerBody,
        commandId: "connection.fact.coworker-reverse-0001",
        targetId: profilePersonId,
      },
      method: "POST",
    },
  );
  assert.equal(coworkerFromOtherSide.replayed, false);
  assert.equal(coworkerFromOtherSide.fact.factId, coworker.fact.factId);
  const coworkerProjection = await request(
    `/v1/people/${profilePersonId}/connection-facts`,
  );
  assert.equal(
    coworkerProjection.facts.filter(
      ({ other, semanticKind }) =>
        other.id === coworkerPersonId && semanticKind === "coworker",
    ).length,
    1,
  );

  const formerMentor = await request(
    `/v1/people/${profilePersonId}/connection-facts`,
    {
      body: {
        commandId: "connection.fact.mentor-former-0001",
        dateEnd: "2015-12-31",
        dateStart: "2010-01-01",
        modifierIds: [
          formerModifier.modifierId,
          childhoodModifier.modifier.modifierId,
        ],
        targetId: coworkerPersonId,
        targetKind: "person",
        typeId: customType.type.typeId,
      },
      method: "POST",
    },
  );
  assert.equal(formerMentor.fact.displayLabel, "Mentor (Former, Childhood)");
  assert.equal(formerMentor.fact.validity, "past");
  assert.deepEqual(
    formerMentor.fact.modifiers.map(({ label }) => label),
    ["Former", "Childhood"],
  );

  await request(`/v1/people/${coworkerPersonId}/connection-facts`, {
    body: {
      commandId: "connection.fact.workplace-0001",
      dateEnd: "2020-12-31",
      dateStart: "2020-01-01",
      targetId: place.entityId,
      targetKind: "place",
      typeId: workplaceType.typeId,
      validity: "past",
    },
    method: "POST",
  });

  const suggested = await request(
    `/v1/people/${profilePersonId}/connection-facts`,
  );
  assert.equal(suggested.suggestions.length, 1);
  const [lead] = suggested.suggestions;
  assert.equal(lead.target.id, place.entityId);
  assert.match(lead.explanation, /lead, not a recorded fact/i);
  assert.equal(
    suggested.facts.some(
      ({ other, semanticKind }) =>
        other.id === place.entityId && semanticKind === "works_at",
    ),
    false,
  );

  const confirmBody = {
    ...lead.candidate,
    commandId: "connection.fact.confirm-0001",
    suggestionKey: lead.suggestionKey,
  };
  const confirmed = await request(
    `/v1/people/${profilePersonId}/connection-facts`,
    { body: confirmBody, method: "POST" },
  );
  assert.equal(confirmed.fact.displayLabel, "Worked here");
  assert.equal(confirmed.fact.validity, "past");

  const rejectedHubName = "Synthetic rejected connection hub";
  const rejectedHub = await request("/v1/connection-hubs:record", {
    body: {
      commandId: "connection.hub.rejected-atomic-0001",
      displayName: rejectedHubName,
      hubKind: "group",
      members: [
        {
          personId: profilePersonId,
          typeId: memberType.typeId,
          validity: "current",
        },
        {
          personId: coworkerPersonId,
          typeId: coworkerType.typeId,
          validity: "current",
        },
      ],
    },
    method: "POST",
    status: 400,
  });
  assert.equal(rejectedHub.code, "CONNECTION_TYPE_INVALID");
  const rejectedObjects = await request(
    `/v1/objects?q=${encodeURIComponent(rejectedHubName)}`,
  );
  assert.equal(
    rejectedObjects.items.some(
      ({ displayName }) => displayName === rejectedHubName,
    ),
    false,
  );

  const hubBody = {
    commandId: "connection.hub.school-friends-0001",
    displayName: groupName,
    hubKind: "group",
    members: [
      {
        modifierIds: [childhoodModifier.modifier.modifierId],
        personId: profilePersonId,
        typeId: memberType.typeId,
        validity: "current",
      },
      {
        dateEnd: "2012-12-31",
        dateStart: "2008-01-01",
        personId: coworkerPersonId,
        typeId: memberType.typeId,
        validity: "past",
      },
    ],
  };
  const hub = await request("/v1/connection-hubs:record", {
    body: hubBody,
    method: "POST",
  });
  assert.equal(hub.schemaVersion, "cimmich.connection-facts.v4");
  assert.equal(hub.createdHub, true);
  assert.equal(hub.members.length, 2);
  const hubReplay = await request("/v1/connection-hubs:record", {
    body: hubBody,
    method: "POST",
  });
  assert.equal(hubReplay.replayed, true);
  assert.equal(hubReplay.hub.entityId, hub.hub.entityId);
  await assertPersisted();

  const graph = await request("/v1/discover/memory-graph?edgeLimit=120");
  assert.ok(
    graph.edges.some(
      ({ relationKinds }) =>
        relationKinds.includes(
          "Co-worker (Childhood) @ Synthetic Greek beach",
        ) ||
        relationKinds.includes("Mentor (Former, Childhood)") ||
        relationKinds.includes("Worked here") ||
        relationKinds.includes("Member (Childhood)"),
    ),
  );
}

if (phase === "readback" || phase === "all") {
  await assertPersisted();
}

console.log(`Cimmich typed connection fact journey (${phase}): PASS`);
