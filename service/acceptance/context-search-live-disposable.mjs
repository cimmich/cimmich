import assert from "node:assert/strict";

const root = process.env.CIMMICH_ACCEPTANCE_ROOT || "http://127.0.0.1:3101";
const phase = process.env.CIMMICH_CONTEXT_LIVE_PHASE || "write";
const actor = "synthetic-live-context";
const headers = {
  "content-type": "application/json",
  "x-cimmich-actor": actor,
  "x-cimmich-device-id": "synthetic-live-context-device",
  "x-cimmich-principal-id": "local-primary",
};
const commandPrefix = `livecontext.${Date.now()}`;

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

const find = async (family, name) => {
  const payload = await request(`/v1/${family}?q=${encodeURIComponent(name)}`);
  return payload.items.find((item) => item.displayName === name);
};

const names = {
  event: "Cimmich Live Disposable Event",
  object: "Cimmich Live Disposable Object",
  place: "Cimmich Live Disposable Place",
};

const assertReadback = async () => {
  const place = await find("places", names.place);
  const object = await find("objects", names.object);
  const event = await find("events", names.event);
  assert.ok(place);
  assert.ok(object);
  assert.ok(event);
  assert.equal(place.assetCount, 2);
  assert.equal(object.assetCount, 1);
  assert.equal(event.assetCount, 2);
  const eventDetail = await request(`/v1/events/${event.entityId}`);
  assert.deepEqual(
    eventDetail.relations.map((relation) => relation.relationKind).sort(),
    ["location", "object"],
  );
  const search = await request(
    "/v1/search/smart?q=Cimmich%20Live%20Disposable%20Place%20in%202024",
  );
  assert.equal(search.schemaVersion, "cimmich.smart-search-basic.v2");
  assert.deepEqual(search.items.map((item) => item.assetId).sort(), [
    "asset_context_live_fixture_a",
    "asset_context_live_fixture_b",
  ]);
};

if (phase === "write") {
  const create = async (family, suffix, body) =>
    request(`/v1/${family}`, {
      body: { commandId: `${commandPrefix}.${suffix}`, ...body },
      method: "POST",
      status: 201,
    });
  const place = (
    await create("places", "place", {
      aliases: ["Disposable test place"],
      displayName: names.place,
      geometry: { latitude: -33.86, longitude: 151.21 },
      typeKind: "point",
    })
  ).detail.entity;
  const object = (
    await create("objects", "object", {
      displayName: names.object,
      typeKind: "vehicle",
    })
  ).detail.entity;
  const event = (
    await create("events", "event", {
      dateEnd: "2024-12-31",
      datePrecision: "year",
      dateStart: "2024-01-01",
      displayName: names.event,
      typeKind: "trip",
    })
  ).detail.entity;
  const placeAttach = {
    assets: [
      {
        assetId: "asset_context_live_fixture_a",
        associationKind: "captured_at",
      },
      { assetId: "asset_context_live_fixture_b", associationKind: "depicts" },
    ],
    commandId: `${commandPrefix}.placeassets`,
  };
  const attached = await request(`/v1/places/${place.entityId}/assets:attach`, {
    body: placeAttach,
    method: "POST",
  });
  assert.equal(attached.status, "applied");
  assert.equal(
    (
      await request(`/v1/places/${place.entityId}/assets:attach`, {
        body: placeAttach,
        method: "POST",
      })
    ).replayed,
    true,
  );
  assert.equal(
    (
      await request(`/v1/places/${place.entityId}/assets:attach`, {
        body: { ...placeAttach, assets: placeAttach.assets.slice(0, 1) },
        method: "POST",
        status: 409,
      })
    ).code,
    "CONTEXT_COMMAND_CONFLICT",
  );
  await request(`/v1/objects/${object.entityId}/assets:attach`, {
    body: {
      assets: [
        { assetId: "asset_context_live_fixture_a", associationKind: "depicts" },
      ],
      commandId: `${commandPrefix}.objectassets`,
    },
    method: "POST",
  });
  await request(`/v1/events/${event.entityId}/assets:attach`, {
    body: {
      assets: [
        { assetId: "asset_context_live_fixture_a", associationKind: "direct" },
        { assetId: "asset_context_live_fixture_b", associationKind: "context" },
      ],
      commandId: `${commandPrefix}.eventassets`,
    },
    method: "POST",
  });
  const relations = await request(
    `/v1/events/${event.entityId}/relations:attach`,
    {
      body: {
        commandId: `${commandPrefix}.relations`,
        relations: [
          {
            relationKind: "location",
            targetId: place.entityId,
            targetKind: "place",
          },
          {
            relationKind: "object",
            targetId: object.entityId,
            targetKind: "object",
          },
        ],
      },
      method: "POST",
    },
  );
  const detached = await request(
    `/v1/events/${event.entityId}/relations:detach`,
    {
      body: {
        commandId: `${commandPrefix}.detach`,
        relationIds: [relations.changedRelationIds[0]],
      },
      method: "POST",
    },
  );
  assert.equal(detached.undo.eligible, true);
  assert.equal(
    (
      await request(`/v1/context/decisions/${detached.decisionId}/undo`, {
        body: { commandId: `${commandPrefix}.undo` },
        method: "POST",
      })
    ).status,
    "reverted",
  );
  await assertReadback();
  console.log("Cimmich live disposable context/search write: PASS");
} else if (phase === "readback") {
  await assertReadback();
  console.log("Cimmich live disposable context/search restart readback: PASS");
} else {
  throw new Error(`Unsupported CIMMICH_CONTEXT_LIVE_PHASE: ${phase}`);
}
