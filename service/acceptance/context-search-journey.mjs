import assert from "node:assert/strict";
import { currentSchemaVersion } from "./current-schema.mjs";

const root = process.env.CIMMICH_ACCEPTANCE_ROOT || "http://127.0.0.1:3101";
const phase = process.env.CIMMICH_CONTEXT_PHASE || "all";
const headers = {
  "content-type": "application/json",
  "x-cimmich-actor": "synthetic-context-editor",
  "x-cimmich-device-id": "synthetic-context-device",
  "x-cimmich-principal-id": "local-primary",
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

const byName = async (family, displayName) => {
  const result = await request(
    `/v1/${family}?q=${encodeURIComponent(displayName)}`,
  );
  return result.items.find((item) => item.displayName === displayName);
};

const assertPersisted = async () => {
  const beach = await byName("places", "Synthetic Greek beach");
  const car = await byName("objects", "Synthetic blue roadster");
  const trip = await byName("events", "Synthetic Greek holiday 2020");
  assert.ok(beach);
  assert.ok(car);
  assert.ok(trip);
  assert.deepEqual(trip.previewAssetIds, ["source-service-fixture"]);
  assert.equal(trip.coverAssetId, "source-service-fixture");
  assert.equal(trip.coverMode, "explicit");
  assert.equal(beach.typeKind, "point");
  assert.deepEqual(beach.aliases, ["Greek beach"]);
  assert.equal(beach.assetCount, 2);
  assert.equal(beach.coverAssetId, "source-identity-fixture");
  assert.equal(beach.coverMode, "explicit");
  const beachDetail = await request(`/v1/places/${beach.entityId}`);
  assert.equal(beachDetail.entity.coverAssetId, "source-identity-fixture");
  assert.equal(beachDetail.entity.coverMode, "explicit");
  assert.equal(car.assetCount, 2);
  assert.equal(car.coverAssetId, "source-identity-fixture");
  assert.equal(car.coverMode, "explicit");
  const carDetail = await request(`/v1/objects/${car.entityId}`);
  assert.equal(carDetail.entity.coverAssetId, "source-identity-fixture");
  assert.equal(carDetail.entity.coverMode, "explicit");
  const detail = await request(`/v1/events/${trip.entityId}`);
  assert.equal(detail.schemaVersion, "cimmich.context-entity.v1");
  assert.equal(detail.assets.length, 2);
  assert.deepEqual(
    detail.relations.map((relation) => relation.relationKind).sort(),
    ["companion", "location", "object", "participant"],
  );
  const search = await request(
    "/v1/search/smart?q=photo%20with%20Synthetic%20Person%20at%20Greek%20beach%20in%202020&limit=20",
  );
  assert.equal(search.schemaVersion, "cimmich.smart-search-basic.v2");
  assert.equal(search.interpretation.mode, "basic");
  assert.ok(
    search.interpretation.selectors.some(
      (selector) => selector.entityKind === "person",
    ),
  );
  assert.ok(
    search.interpretation.selectors.some(
      (selector) => selector.entityKind === "place",
    ),
  );
  assert.deepEqual(search.items.map((item) => item.assetId).sort(), [
    "asset_identity_fixture",
  ]);
};

if (phase === "write" || phase === "all") {
  const health = await request("/health");
  assert.equal(health.schemaVersion, await currentSchemaVersion());
  const projections = await request("/v1/visibility/projections");
  assert.equal(projections.allRegisteredSurfacesEnforced, true);
  assert.equal(
    projections.items.filter((item) => item.coverageState !== "enforced")
      .length,
    0,
  );

  const pets = await request("/v1/pets?q=Miso");
  const miso = pets.items.find((pet) => pet.displayName === "Miso");
  assert.ok(miso);

  const create = async (family, commandId, body) =>
    request(`/v1/${family}`, {
      body: { commandId, ...body },
      method: "POST",
      status: 201,
    });

  await create("places", "context.create.country-001", {
    aliases: ["Hellas"],
    displayName: "Synthetic Greece",
    typeKind: "unlocated",
  });
  const country = await byName("places", "Synthetic Greece");
  const beachCreated = await create("places", "context.create.beach-0001", {
    aliases: ["Greek beach"],
    description: "Synthetic beach where mojitos were served",
    displayName: "Synthetic Greek beach",
    geometry: { latitude: -33.86, longitude: 151.21 },
    parentEntityId: country.entityId,
    typeKind: "point",
  });
  const beach = beachCreated.detail.entity;
  await create("places", "context.create.area-00001", {
    displayName: "Synthetic island area",
    geometry: { east: 151.3, north: -33.7, south: -34, west: 151 },
    parentEntityId: country.entityId,
    typeKind: "area",
  });
  await create("places", "context.create.route-0001", {
    displayName: "Synthetic island route",
    geometry: {
      points: [
        { latitude: -33.86, longitude: 151.21 },
        { latitude: -33.8, longitude: 151.25 },
      ],
    },
    typeKind: "route",
  });
  const carCreated = await create("objects", "context.create.car-000001", {
    aliases: ["Holiday car"],
    displayName: "Synthetic blue roadster",
    typeKind: "vehicle",
  });
  const car = carCreated.detail.entity;
  await create("objects", "context.create.house-0001", {
    displayName: "Synthetic holiday house",
    typeKind: "property",
  });
  const tripCreated = await create("events", "context.create.trip-000001", {
    aliases: ["Greek holiday"],
    dateEnd: "2020-12-31",
    datePrecision: "exact",
    dateStart: "2020-01-01",
    displayName: "Synthetic Greek holiday 2020",
    typeKind: "trip",
  });
  const trip = tripCreated.detail.entity;
  await create("events", "context.create.activity-01", {
    datePrecision: "month",
    dateStart: "2020-06-01",
    displayName: "Synthetic beach tour",
    parentEntityId: trip.entityId,
    typeKind: "activity",
  });
  await create("events", "context.create.lifeperiod1", {
    datePrecision: "year",
    dateStart: "2020-01-01",
    displayName: "Synthetic overseas employment",
    typeKind: "life_period",
  });

  const assetBody = {
    assets: [
      { assetId: "asset_service_fixture", associationKind: "captured_at" },
      { assetId: "asset_identity_fixture", associationKind: "depicts" },
    ],
    commandId: "context.assets.beach-0001",
  };
  const attached = await request(`/v1/places/${beach.entityId}/assets:attach`, {
    body: assetBody,
    method: "POST",
  });
  assert.equal(attached.status, "applied");
  const replay = await request(`/v1/places/${beach.entityId}/assets:attach`, {
    body: assetBody,
    method: "POST",
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.decisionId, attached.decisionId);
  const conflict = await request(`/v1/places/${beach.entityId}/assets:attach`, {
    body: { ...assetBody, assets: assetBody.assets.slice(0, 1) },
    method: "POST",
    status: 409,
  });
  assert.equal(conflict.code, "CONTEXT_COMMAND_CONFLICT");

  const attachedDetail = await request(`/v1/places/${beach.entityId}`);
  const coverBody = {
    commandId: "context.cover.beach-0001",
    expectedRevision: attachedDetail.entity.revision,
    sourceAssetId: "source-identity-fixture",
  };
  const coverSet = await request(`/v1/places/${beach.entityId}/cover`, {
    body: coverBody,
    method: "POST",
  });
  assert.equal(coverSet.schemaVersion, "cimmich.place-cover.v1");
  assert.equal(coverSet.changed, true);
  assert.equal(coverSet.detail.entity.coverAssetId, "source-identity-fixture");
  assert.equal(coverSet.detail.entity.coverMode, "explicit");
  assert.equal(coverSet.undo.eligible, true);
  const coverReplay = await request(`/v1/places/${beach.entityId}/cover`, {
    body: coverBody,
    method: "POST",
  });
  assert.equal(coverReplay.replayed, true);
  assert.equal(coverReplay.decisionId, coverSet.decisionId);
  const coverConflict = await request(`/v1/places/${beach.entityId}/cover`, {
    body: { ...coverBody, sourceAssetId: "source-service-fixture" },
    method: "POST",
    status: 409,
  });
  assert.equal(coverConflict.code, "CONTEXT_COMMAND_CONFLICT");
  const coverStale = await request(`/v1/places/${beach.entityId}/cover`, {
    body: {
      commandId: "context.cover.beach-stale1",
      expectedRevision: attachedDetail.entity.revision,
      sourceAssetId: "source-service-fixture",
    },
    method: "POST",
    status: 409,
  });
  assert.equal(coverStale.code, "CONTEXT_COVER_STALE");
  const coverUnavailable = await request(`/v1/places/${beach.entityId}/cover`, {
    body: {
      commandId: "context.cover.beach-missing",
      expectedRevision: coverSet.detail.entity.revision,
      sourceAssetId: "source-missing-fixture",
    },
    method: "POST",
    status: 404,
  });
  assert.equal(coverUnavailable.code, "CONTEXT_COVER_ASSET_UNAVAILABLE");
  const coverNoChange = await request(`/v1/places/${beach.entityId}/cover`, {
    body: {
      commandId: "context.cover.beach-nochange",
      expectedRevision: coverSet.detail.entity.revision,
      sourceAssetId: "source-identity-fixture",
    },
    method: "POST",
  });
  assert.equal(coverNoChange.changed, false);
  assert.equal(coverNoChange.decisionId, null);
  assert.equal(coverNoChange.status, "no_change");
  const coverCleared = await request(`/v1/places/${beach.entityId}/cover`, {
    body: {
      commandId: "context.cover.beach-clear01",
      expectedRevision: coverSet.detail.entity.revision,
      sourceAssetId: null,
    },
    method: "POST",
  });
  assert.equal(coverCleared.detail.entity.coverMode, "automatic");
  const clearUndone = await request(
    `/v1/context/decisions/${coverCleared.decisionId}/undo`,
    {
      body: { commandId: "context.cover.beach-undoclear" },
      method: "POST",
    },
  );
  assert.equal(
    clearUndone.detail.entity.coverAssetId,
    "source-identity-fixture",
  );
  assert.equal(clearUndone.detail.entity.coverMode, "explicit");
  const coverDetached = await request(
    `/v1/places/${beach.entityId}/assets:detach`,
    {
      body: {
        assetIds: ["asset_identity_fixture"],
        commandId: "context.cover.beach-detach01",
      },
      method: "POST",
    },
  );
  assert.equal(coverDetached.detail.entity.coverMode, "automatic");
  assert.equal(
    coverDetached.detail.entity.coverAssetId,
    "source-service-fixture",
  );
  const detachUndone = await request(
    `/v1/context/decisions/${coverDetached.decisionId}/undo`,
    {
      body: { commandId: "context.cover.beach-undodetach" },
      method: "POST",
    },
  );
  assert.equal(
    detachUndone.detail.entity.coverAssetId,
    "source-identity-fixture",
  );
  assert.equal(detachUndone.detail.entity.coverMode, "explicit");

  await request(`/v1/objects/${car.entityId}/assets:attach`, {
    body: {
      assets: [
        { assetId: "asset_service_fixture", associationKind: "depicts" },
        { assetId: "asset_identity_fixture", associationKind: "manual" },
      ],
      commandId: "context.assets.car-000001",
    },
    method: "POST",
  });
  const carAttachedDetail = await request(`/v1/objects/${car.entityId}`);
  const carCoverBody = {
    commandId: "context.cover.car-000001",
    expectedRevision: carAttachedDetail.entity.revision,
    sourceAssetId: "source-identity-fixture",
  };
  const carCoverSet = await request(`/v1/objects/${car.entityId}/cover`, {
    body: carCoverBody,
    method: "POST",
  });
  assert.equal(carCoverSet.schemaVersion, "cimmich.object-cover.v1");
  assert.equal(carCoverSet.changed, true);
  assert.equal(
    carCoverSet.detail.entity.coverAssetId,
    "source-identity-fixture",
  );
  assert.equal(carCoverSet.detail.entity.coverMode, "explicit");
  assert.equal(carCoverSet.undo.eligible, true);
  assert.equal(
    (
      await request(`/v1/objects/${car.entityId}/cover`, {
        body: carCoverBody,
        method: "POST",
      })
    ).replayed,
    true,
  );
  assert.equal(
    (
      await request(`/v1/objects/${car.entityId}/cover`, {
        body: { ...carCoverBody, sourceAssetId: "source-service-fixture" },
        method: "POST",
        status: 409,
      })
    ).code,
    "CONTEXT_COMMAND_CONFLICT",
  );
  const carCoverNoChange = await request(`/v1/objects/${car.entityId}/cover`, {
    body: {
      commandId: "context.cover.car-nochange",
      expectedRevision: carCoverSet.detail.entity.revision,
      sourceAssetId: "source-identity-fixture",
    },
    method: "POST",
  });
  assert.equal(carCoverNoChange.changed, false);
  assert.equal(carCoverNoChange.decisionId, null);
  const carCoverCleared = await request(`/v1/objects/${car.entityId}/cover`, {
    body: {
      commandId: "context.cover.car-clear001",
      expectedRevision: carCoverSet.detail.entity.revision,
      sourceAssetId: null,
    },
    method: "POST",
  });
  assert.equal(carCoverCleared.detail.entity.coverMode, "automatic");
  const carCoverRestored = await request(
    `/v1/context/decisions/${carCoverCleared.decisionId}/undo`,
    {
      body: { commandId: "context.cover.car-undoclear" },
      method: "POST",
    },
  );
  assert.equal(carCoverRestored.detail.entity.coverMode, "explicit");
  assert.equal(
    carCoverRestored.detail.entity.coverAssetId,
    "source-identity-fixture",
  );
  await request(`/v1/events/${trip.entityId}/assets:attach`, {
    body: {
      assets: [
        { assetId: "asset_service_fixture", associationKind: "direct" },
        { assetId: "asset_identity_fixture", associationKind: "context" },
      ],
      commandId: "context.assets.trip-00001",
    },
    method: "POST",
  });
  const tripAttachedDetail = await request(`/v1/events/${trip.entityId}`);
  const tripCoverBody = {
    commandId: "context.cover.trip-000001",
    expectedRevision: tripAttachedDetail.entity.revision,
    sourceAssetId: "source-service-fixture",
  };
  const tripCoverSet = await request(`/v1/events/${trip.entityId}/cover`, {
    body: tripCoverBody,
    method: "POST",
  });
  assert.equal(tripCoverSet.schemaVersion, "cimmich.event-cover.v1");
  assert.equal(tripCoverSet.changed, true);
  assert.equal(tripCoverSet.detail.entity.coverMode, "explicit");
  assert.equal(
    tripCoverSet.detail.entity.coverAssetId,
    "source-service-fixture",
  );
  assert.equal(
    (
      await request(`/v1/events/${trip.entityId}/cover`, {
        body: tripCoverBody,
        method: "POST",
      })
    ).replayed,
    true,
  );
  const tripCoverCleared = await request(`/v1/events/${trip.entityId}/cover`, {
    body: {
      commandId: "context.cover.trip-clear01",
      expectedRevision: tripCoverSet.detail.entity.revision,
      sourceAssetId: null,
    },
    method: "POST",
  });
  assert.equal(tripCoverCleared.detail.entity.coverMode, "automatic");
  const tripCoverRestored = await request(
    `/v1/context/decisions/${tripCoverCleared.decisionId}/undo`,
    {
      body: { commandId: "context.cover.trip-undoclear" },
      method: "POST",
    },
  );
  assert.equal(tripCoverRestored.detail.entity.coverMode, "explicit");
  assert.equal(
    tripCoverRestored.detail.entity.coverAssetId,
    "source-service-fixture",
  );

  const relationBody = {
    commandId: "context.relations.trip-01",
    relations: [
      {
        relationKind: "participant",
        targetId: "person_service_fixture",
        targetKind: "person",
      },
      {
        relationKind: "companion",
        targetId: miso.petId,
        targetKind: "pet",
      },
      {
        relationKind: "location",
        targetId: beach.entityId,
        targetKind: "place",
      },
      { relationKind: "object", targetId: car.entityId, targetKind: "object" },
    ],
  };
  const relations = await request(
    `/v1/events/${trip.entityId}/relations:attach`,
    { body: relationBody, method: "POST" },
  );
  assert.equal(relations.changedRelationIds.length, 4);

  const invalidRole = await request(
    `/v1/events/${trip.entityId}/relations:attach`,
    {
      body: {
        commandId: "context.relations.invalid1",
        relations: [
          {
            relationKind: "participant",
            targetId: miso.petId,
            targetKind: "pet",
          },
        ],
      },
      method: "POST",
      status: 400,
    },
  );
  assert.equal(invalidRole.code, "CONTEXT_RELATIONS_INVALID");

  const missingTarget = await request(
    `/v1/events/${trip.entityId}/relations:attach`,
    {
      body: {
        commandId: "context.relations.missing1",
        relations: [
          {
            relationKind: "participant",
            targetId: "person_missing_fixture",
            targetKind: "person",
          },
        ],
      },
      method: "POST",
      status: 404,
    },
  );
  assert.equal(missingTarget.code, "CONTEXT_RELATION_TARGET_NOT_FOUND");

  const oneRelationId = relations.changedRelationIds[0];
  const detached = await request(
    `/v1/events/${trip.entityId}/relations:detach`,
    {
      body: {
        commandId: "context.relations.detach1",
        relationIds: [oneRelationId],
      },
      method: "POST",
    },
  );
  assert.equal(detached.undo.eligible, true);
  const undone = await request(
    `/v1/context/decisions/${detached.decisionId}/undo`,
    {
      body: { commandId: "context.relations.undo001" },
      method: "POST",
    },
  );
  assert.equal(undone.status, "reverted");
  const stale = await request(
    `/v1/context/decisions/${detached.decisionId}/undo`,
    {
      body: { commandId: "context.relations.undo002" },
      method: "POST",
      status: 409,
    },
  );
  assert.equal(stale.code, "CONTEXT_UNDO_NOT_AVAILABLE");

  const disposable = await create("objects", "context.create.archive01", {
    displayName: "Synthetic disposable object",
    typeKind: "other",
  });
  const archived = await request(
    `/v1/objects/${disposable.detail.entity.entityId}`,
    {
      body: { commandId: "context.update.archive01", status: "archived" },
      method: "PATCH",
    },
  );
  assert.equal(archived.detail.entity.status, "archived");
  const absent = await request(
    `/v1/objects/${disposable.detail.entity.entityId}`,
    { status: 404 },
  );
  assert.equal(absent.code, "CONTEXT_NOT_FOUND");
  const archivedCollection = await request(
    `/v1/objects?includeArchived=true&q=${encodeURIComponent("Synthetic disposable object")}`,
  );
  assert.equal(archivedCollection.items.length, 1);
  assert.equal(archivedCollection.items[0].status, "archived");
  const archivedDetail = await request(
    `/v1/objects/${disposable.detail.entity.entityId}?includeArchived=true`,
  );
  assert.equal(archivedDetail.entity.status, "archived");
  const restored = await request(
    `/v1/objects/${disposable.detail.entity.entityId}`,
    {
      body: { commandId: "context.update.restore01", status: "active" },
      method: "PATCH",
    },
  );
  assert.equal(restored.detail.entity.status, "active");

  const parentArchive = await request(`/v1/places/${country.entityId}`, {
    body: { commandId: "context.update.parentarchive", status: "archived" },
    method: "PATCH",
    status: 409,
  });
  assert.equal(parentArchive.code, "CONTEXT_ARCHIVE_HAS_CHILDREN");

  const cycle = await request(`/v1/places/${country.entityId}`, {
    body: {
      commandId: "context.update.parentcycle01",
      parentEntityId: beach.entityId,
    },
    method: "PATCH",
    status: 409,
  });
  assert.equal(cycle.code, "CONTEXT_PARENT_CYCLE");

  const invalidDate = await request(
    "/v1/search/smart?q=photos%20in%202025-99-99",
    {
      status: 400,
    },
  );
  assert.equal(invalidDate.code, "SMART_SEARCH_DATE_INVALID");

  const malformedJson = await fetch(`${root}/v1/places`, {
    body: "{not-json",
    headers,
    method: "POST",
  });
  assert.equal(malformedJson.status, 400);
  assert.equal((await malformedJson.json()).code, "REQUEST_JSON_INVALID");

  const retainedCreated = await create("places", "context.create.deletekeep1", {
    displayName: "Synthetic retained-tag tombstone",
    typeKind: "unlocated",
  });
  const retainedPlace = retainedCreated.detail.entity;
  const retainedChild = await create("places", "context.create.deletechild1", {
    displayName: "Synthetic detached child",
    parentEntityId: retainedPlace.entityId,
    typeKind: "unlocated",
  });
  await request(`/v1/places/${retainedPlace.entityId}/assets:attach`, {
    body: {
      assets: [{ assetId: "asset_service_fixture", associationKind: "manual" }],
      commandId: "context.assets.deletekeep1",
    },
    method: "POST",
  });
  await request(`/v1/events/${trip.entityId}/relations:attach`, {
    body: {
      commandId: "context.relations.deletekeep1",
      relations: [
        {
          relationKind: "location",
          targetId: retainedPlace.entityId,
          targetKind: "place",
        },
      ],
    },
    method: "POST",
  });
  const keepBody = {
    commandId: "context.delete.keep.0001",
    deleteTags: false,
    expectedRevision: 2,
  };
  const kept = await request(`/v1/places/${retainedPlace.entityId}/delete`, {
    body: keepBody,
    method: "POST",
  });
  assert.equal(kept.schemaVersion, "cimmich.place-delete.v1");
  assert.equal(kept.retainedTagCount, 1);
  assert.equal(kept.deletedTagCount, 0);
  assert.equal(kept.affectedChildren, 1);
  assert.equal(kept.affectedRelations, 1);
  assert.deepEqual(kept.undo, {
    eligible: false,
    reason: "permanent_delete",
  });
  assert.equal(kept.rawMediaChanged, false);
  assert.equal(kept.immichDatabaseChanged, false);
  assert.equal(
    (await request(`/v1/places/${retainedChild.detail.entity.entityId}`)).entity
      .parentEntityId,
    null,
  );
  assert.equal(
    (
      await request(`/v1/places/${retainedPlace.entityId}/delete`, {
        body: keepBody,
        method: "POST",
      })
    ).replayed,
    true,
  );
  assert.equal(
    (
      await request(`/v1/places/${retainedPlace.entityId}/delete`, {
        body: { ...keepBody, deleteTags: true },
        method: "POST",
        status: 409,
      })
    ).code,
    "CONTEXT_COMMAND_CONFLICT",
  );
  assert.equal(
    (await request(`/v1/places/${retainedPlace.entityId}`, { status: 404 }))
      .code,
    "CONTEXT_NOT_FOUND",
  );
  const oldCreateReplay = await create("places", "context.create.deletekeep1", {
    displayName: "Synthetic retained-tag tombstone",
    typeKind: "unlocated",
  });
  assert.equal(oldCreateReplay.projectionUnavailable, true);

  const purgedCreated = await create("places", "context.create.deletepurge", {
    displayName: "Synthetic purged-tag tombstone",
    typeKind: "unlocated",
  });
  await request(
    `/v1/places/${purgedCreated.detail.entity.entityId}/assets:attach`,
    {
      body: {
        assets: [
          { assetId: "asset_identity_fixture", associationKind: "manual" },
        ],
        commandId: "context.assets.deletepurge",
      },
      method: "POST",
    },
  );
  const purged = await request(
    `/v1/places/${purgedCreated.detail.entity.entityId}/delete`,
    {
      body: {
        commandId: "context.delete.purge.001",
        deleteTags: true,
        expectedRevision: 2,
      },
      method: "POST",
    },
  );
  assert.equal(purged.deletedTagCount, 1);
  assert.equal(purged.retainedTagCount, 0);

  const retainedObjectCreated = await create(
    "objects",
    "context.create.objectkeep1",
    {
      displayName: "Synthetic retained Thing tombstone",
      typeKind: "equipment",
    },
  );
  const retainedObject = retainedObjectCreated.detail.entity;
  await request(`/v1/objects/${retainedObject.entityId}/assets:attach`, {
    body: {
      assets: [{ assetId: "asset_service_fixture", associationKind: "manual" }],
      commandId: "context.assets.objectkeep1",
    },
    method: "POST",
  });
  await request(`/v1/events/${trip.entityId}/relations:attach`, {
    body: {
      commandId: "context.relations.objectkeep1",
      relations: [
        {
          relationKind: "object",
          targetId: retainedObject.entityId,
          targetKind: "object",
        },
      ],
    },
    method: "POST",
  });
  const objectKeepBody = {
    commandId: "context.delete.objectkeep1",
    deleteTags: false,
    expectedRevision: 2,
  };
  const objectKept = await request(
    `/v1/objects/${retainedObject.entityId}/delete`,
    { body: objectKeepBody, method: "POST" },
  );
  assert.equal(objectKept.schemaVersion, "cimmich.object-delete.v1");
  assert.equal(objectKept.retainedTagCount, 1);
  assert.equal(objectKept.deletedTagCount, 0);
  assert.equal(objectKept.affectedChildren, 0);
  assert.equal(objectKept.affectedRelations, 1);
  assert.equal(objectKept.rawMediaChanged, false);
  assert.equal(objectKept.immichDatabaseChanged, false);
  assert.deepEqual(objectKept.undo, {
    eligible: false,
    reason: "permanent_delete",
  });
  assert.equal(
    (
      await request(`/v1/objects/${retainedObject.entityId}/delete`, {
        body: objectKeepBody,
        method: "POST",
      })
    ).replayed,
    true,
  );
  assert.equal(
    (
      await request(`/v1/objects/${retainedObject.entityId}/delete`, {
        body: { ...objectKeepBody, deleteTags: true },
        method: "POST",
        status: 409,
      })
    ).code,
    "CONTEXT_COMMAND_CONFLICT",
  );
  assert.equal(
    (await request(`/v1/objects/${retainedObject.entityId}`, { status: 404 }))
      .code,
    "CONTEXT_NOT_FOUND",
  );

  const purgedObjectCreated = await create(
    "objects",
    "context.create.objectpurge",
    {
      displayName: "Synthetic purged Thing tombstone",
      typeKind: "equipment",
    },
  );
  await request(
    `/v1/objects/${purgedObjectCreated.detail.entity.entityId}/assets:attach`,
    {
      body: {
        assets: [
          { assetId: "asset_identity_fixture", associationKind: "manual" },
        ],
        commandId: "context.assets.objectpurge",
      },
      method: "POST",
    },
  );
  const objectPurged = await request(
    `/v1/objects/${purgedObjectCreated.detail.entity.entityId}/delete`,
    {
      body: {
        commandId: "context.delete.objectpurge",
        deleteTags: true,
        expectedRevision: 2,
      },
      method: "POST",
    },
  );
  assert.equal(objectPurged.deletedTagCount, 1);
  assert.equal(objectPurged.retainedTagCount, 0);

  await assertPersisted();
}

if (phase === "readback" || phase === "all") await assertPersisted();

console.log(`Cimmich context/search journey (${phase}): PASS`);
