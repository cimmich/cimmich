import assert from "node:assert/strict";
import { readFile, unlink, writeFile } from "node:fs/promises";

const root = process.env.CIMMICH_ACCEPTANCE_ROOT || "http://127.0.0.1:3101";
const phase = process.env.CIMMICH_VISIBILITY_PHASE || "write";
const tokenPath = "/tmp/cimmich-visibility-acceptance-token";
const actor = "synthetic-visibility-editor";
const principalId = "local-primary";
const deviceId = "synthetic-browser";

const request = async (
  path,
  {
    body,
    extraHeaders = {},
    method = "GET",
    status = 200,
    withIdentity = true,
  } = {},
) => {
  const response = await fetch(`${root}${path}`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": actor,
      ...(withIdentity
        ? {
            "x-cimmich-device-id": deviceId,
            "x-cimmich-principal-id": principalId,
          }
        : {}),
      ...extraHeaders,
    },
    method,
  });
  const payload = await response.json();
  assert.equal(response.status, status, JSON.stringify(payload));
  assert.equal(response.headers.get("cache-control"), "no-store");
  return payload;
};

const privateHeaders = (token, surface = "interactive") => ({
  "x-cimmich-private-session": token,
  "x-cimmich-surface": surface,
});

if (phase === "write") {
  const initialStatus = await request("/v1/visibility/status");
  assert.equal(initialStatus.schemaVersion, "cimmich.visibility.v1");
  assert.equal(initialStatus.viewingMode, "standard");
  assert.equal(initialStatus.privateAuthorized, false);
  assert.equal(initialStatus.capabilities.asset, true);
  assert.equal(initialStatus.capabilities.album, false);
  assert.equal(initialStatus.capabilities.contextEntity, true);
  assert.equal(initialStatus.capabilities.entityProfile, true);

  const projectionStatus = await request("/v1/visibility/projections");
  assert.equal(
    projectionStatus.schemaVersion,
    "cimmich.visibility-projection.v1",
  );
  assert.equal(projectionStatus.allRegisteredSurfacesEnforced, true);
  assert.deepEqual(
    projectionStatus.items
      .filter((item) => item.coverageState === "blocked")
      .map((item) => item.surfaceKey),
    [],
  );

  const unbound = await request("/v1/visibility/mode", {
    body: { viewingMode: "personal" },
    method: "POST",
    status: 400,
    withIdentity: false,
  });
  assert.equal(unbound.code, "VISIBILITY_PRINCIPAL_REQUIRED");

  const privateWriteWithoutSession = await request(
    "/v1/visibility/objects/asset/asset_service_fixture",
    {
      body: {
        commandId: "visibility-private-without-session",
        visibilityTier: "private",
      },
      method: "PATCH",
      status: 401,
    },
  );
  assert.equal(
    privateWriteWithoutSession.code,
    "VISIBILITY_PRIVATE_SESSION_REQUIRED",
  );

  const invalidPassword = await request("/v1/visibility/unlock", {
    body: { password: "not-the-test-password" },
    method: "POST",
    status: 401,
  });
  assert.equal(invalidPassword.code, "VISIBILITY_PRIVATE_PASSWORD_INVALID");

  let unlocked = await request("/v1/visibility/unlock", {
    body: { password: "1" },
    method: "POST",
  });
  assert.equal(unlocked.schemaVersion, "cimmich.visibility.v1");
  assert.equal(unlocked.viewingMode, "private");
  assert.ok(unlocked.privateSessionToken.length >= 40);
  assert.match(unlocked.expiresAt, /^\d{4}-\d{2}-\d{2}T/);
  const expiredToken = unlocked.privateSessionToken;
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const expired = await request("/v1/visibility/status", {
    extraHeaders: privateHeaders(expiredToken),
  });
  assert.equal(expired.privateAuthorized, false);
  assert.equal(expired.viewingMode, "standard");

  unlocked = await request("/v1/visibility/unlock", {
    body: { password: "1" },
    method: "POST",
  });
  const token = unlocked.privateSessionToken;

  const unavailable = await request(
    "/v1/visibility/objects/album/native-immich-album",
    {
      body: {
        commandId: "visibility-unavailable-album",
        visibilityTier: "personal",
      },
      extraHeaders: privateHeaders(token),
      method: "PATCH",
      status: 409,
    },
  );
  assert.equal(unavailable.code, "VISIBILITY_SCOPE_UNAVAILABLE");

  const baselineSummary = await request("/v1/summary", {
    extraHeaders: privateHeaders(token),
  });
  const baselinePersonAssets = await request(
    "/v1/people/person_service_fixture/assets?limit=5000",
    { extraHeaders: privateHeaders(token) },
  );
  const baselinePersonAssetIds = new Set(
    baselinePersonAssets.items.map((item) => item.asset_id),
  );
  assert.ok(baselinePersonAssetIds.has("asset_identity_fixture"));
  const pets = await request("/v1/pets", {
    extraHeaders: privateHeaders(token),
  });
  const miso = pets.items.find((pet) => pet.displayName === "Miso");
  assert.ok(miso);
  const baselinePetCount = miso.confirmedMediaCount;
  assert.equal(baselinePetCount, 2);
  assert.equal(miso.documentCount, 2);
  assert.equal(
    (
      await request(`/v1/pets/${miso.petId}/documents`, {
        extraHeaders: privateHeaders(token),
      })
    ).items.length,
    2,
  );

  const changed = await request("/v1/visibility/objects", {
    body: {
      commandId: "visibility-bulk-personal-private-a",
      objects: [
        {
          objectId: "asset_service_fixture",
          objectScope: "asset",
          visibilityTier: "personal",
        },
        {
          objectId: "asset_identity_fixture",
          objectScope: "asset",
          visibilityTier: "private",
        },
      ],
    },
    extraHeaders: privateHeaders(token),
    method: "PATCH",
  });
  assert.equal(changed.objects.length, 2);
  assert.equal(changed.replayed, false);

  const replay = await request("/v1/visibility/objects", {
    body: {
      commandId: "visibility-bulk-personal-private-a",
      objects: [
        {
          objectId: "asset_service_fixture",
          objectScope: "asset",
          visibilityTier: "personal",
        },
        {
          objectId: "asset_identity_fixture",
          objectScope: "asset",
          visibilityTier: "private",
        },
      ],
    },
    extraHeaders: privateHeaders(token),
    method: "PATCH",
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.decisionId, changed.decisionId);

  const contextPlaceId = (
    await request("/v1/places?q=Synthetic%20Greek%20beach", {
      extraHeaders: privateHeaders(token),
    })
  ).items[0].entityId;
  const contextObjectId = (
    await request("/v1/objects?q=Synthetic%20blue%20roadster", {
      extraHeaders: privateHeaders(token),
    })
  ).items[0].entityId;
  const contextEventId = (
    await request("/v1/events?q=Synthetic%20Greek%20holiday%202020", {
      extraHeaders: privateHeaders(token),
    })
  ).items[0].entityId;
  const contextParentId = (
    await request(`/v1/places/${contextPlaceId}`, {
      extraHeaders: privateHeaders(token),
    })
  ).entity.parentEntityId;
  assert.ok(contextParentId);
  for (const entityId of [contextPlaceId, contextObjectId, contextEventId]) {
    const entityVisibility = await request(
      `/v1/visibility/objects/context_entity/${entityId}`,
      { extraHeaders: privateHeaders(token) },
    );
    assert.equal(entityVisibility.objectScope, "context_entity");
    assert.equal(entityVisibility.visibilityTier, "standard");
    assert.equal(entityVisibility.revision, 0);
  }
  const initialPetVisibility = await request(
    `/v1/visibility/objects/pet/${miso.petId}`,
    { extraHeaders: privateHeaders(token) },
  );
  assert.equal(initialPetVisibility.objectScope, "pet");
  assert.equal(initialPetVisibility.visibilityTier, "standard");
  assert.equal(initialPetVisibility.revision, 0);
  assert.ok(
    (
      await request(`/v1/pets/${miso.petId}`, {
        extraHeaders: privateHeaders(token),
      })
    ).connections.some(
      (connection) =>
        connection.targetId === contextEventId &&
        connection.targetKind === "event" &&
        connection.direction === "incoming",
    ),
  );
  const hiddenParentChange = await request(
    `/v1/visibility/objects/context_entity/${contextParentId}`,
    {
      body: {
        commandId: "visibility-context-parent-private-a",
        visibilityTier: "private",
      },
      extraHeaders: privateHeaders(token),
      method: "PATCH",
    },
  );
  assert.equal(hiddenParentChange.objects[0].visibilityTier, "private");

  const conflict = await request("/v1/visibility/objects", {
    body: {
      commandId: "visibility-bulk-personal-private-a",
      objects: [
        {
          objectId: "asset_service_fixture",
          objectScope: "asset",
          visibilityTier: "private",
        },
      ],
    },
    extraHeaders: privateHeaders(token),
    method: "PATCH",
    status: 409,
  });
  assert.equal(conflict.code, "VISIBILITY_COMMAND_CONFLICT");

  await request("/v1/visibility/mode", {
    body: { viewingMode: "standard" },
    extraHeaders: privateHeaders(token),
    method: "POST",
  });
  const standardSummary = await request("/v1/summary");
  assert.equal(standardSummary.assets, baselineSummary.assets - 2);
  const standardPet = (await request("/v1/pets")).items.find(
    (pet) => pet.petId === miso.petId,
  );
  assert.equal(standardPet.confirmedMediaCount, 0);
  assert.equal(standardPet.documentCount, 0);
  assert.equal(standardPet.cover, null);
  const standardSearch = await request(`/v1/search/media?petId=${miso.petId}`);
  assert.equal(standardSearch.items.length, 0);
  assert.equal(
    (await request(`/v1/pets/${miso.petId}/documents`)).items.length,
    0,
  );
  const standardPersonAssets = await request(
    "/v1/people/person_service_fixture/assets?limit=5000",
  );
  assert.equal(
    standardPersonAssets.items.some((item) =>
      ["asset_identity_fixture"].includes(item.asset_id),
    ),
    false,
  );
  const standardPeople = await request("/v1/people?limit=500");
  const standardPerson = standardPeople.items.find(
    (person) => person.person_id === "person_service_fixture",
  );
  assert.ok(standardPerson);
  assert.ok(standardPerson.asset_count <= baselinePersonAssetIds.size - 1);
  const standardSuggestions = await request(
    "/v1/review/machine-suggestions?limit=80",
  );
  assert.equal(
    standardSuggestions.items.some((item) =>
      ["asset_service_fixture", "asset_identity_fixture"].includes(
        item.asset_id,
      ),
    ),
    false,
  );
  const hiddenDirect = await request(
    "/v1/assets/asset_identity_fixture/subjects",
    { status: 404 },
  );
  assert.equal(hiddenDirect.code, "VISIBILITY_OBJECT_NOT_VISIBLE");
  const standardVisiblePlace = (
    await request("/v1/places?q=Synthetic%20Greek%20beach")
  ).items[0];
  assert.equal(standardVisiblePlace.parentEntityId, null);
  const standardVisibleObject = (
    await request("/v1/objects?q=Synthetic%20blue%20roadster")
  ).items[0];
  const standardVisibleEvent = (
    await request("/v1/events?q=Synthetic%20Greek%20holiday%202020")
  ).items[0];
  for (const entity of [
    standardVisiblePlace,
    standardVisibleObject,
    standardVisibleEvent,
  ]) {
    assert.ok(entity);
    assert.equal(entity.assetCount, 0);
    assert.equal(entity.visibility.visibilityTier, "standard");
    assert.equal(entity.visibility.objectScope, "context_entity");
  }
  assert.equal(
    (await request("/v1/search/smart?q=Greek%20beach")).items.length,
    0,
  );
  const standardContextReplay = await request(
    `/v1/places/${contextPlaceId}/assets:attach`,
    {
      body: {
        assets: [
          { assetId: "asset_service_fixture", associationKind: "captured_at" },
          { assetId: "asset_identity_fixture", associationKind: "depicts" },
        ],
        commandId: "context.assets.beach-0001",
      },
      extraHeaders: { "x-cimmich-actor": "synthetic-context-editor" },
      method: "POST",
    },
  );
  assert.equal(standardContextReplay.replayed, true);
  assert.equal(standardContextReplay.detail.entity.assetCount, 0);

  const contextVisibilityChanged = await request("/v1/visibility/objects", {
    body: {
      commandId: "visibility-context-entity-tiers-a",
      objects: [
        {
          objectId: contextPlaceId,
          objectScope: "context_entity",
          visibilityTier: "private",
        },
        {
          objectId: contextObjectId,
          objectScope: "context_entity",
          visibilityTier: "personal",
        },
        {
          objectId: contextEventId,
          objectScope: "context_entity",
          visibilityTier: "private",
        },
      ],
    },
    extraHeaders: privateHeaders(token),
    method: "PATCH",
  });
  assert.equal(contextVisibilityChanged.objects.length, 3);
  assert.equal(
    (await request("/v1/places?q=Synthetic%20Greek%20beach")).items.length,
    0,
  );
  assert.equal(
    (await request("/v1/objects?q=Synthetic%20blue%20roadster")).items.length,
    0,
  );
  assert.equal(
    (await request("/v1/events?q=Synthetic%20Greek%20holiday%202020")).items
      .length,
    0,
  );
  const hiddenContextDetail = await request(`/v1/places/${contextPlaceId}`, {
    status: 404,
  });
  assert.equal(hiddenContextDetail.code, "CONTEXT_NOT_FOUND");
  const hiddenContextVisibility = await request(
    `/v1/visibility/objects/context_entity/${contextPlaceId}`,
    { status: 404 },
  );
  assert.equal(hiddenContextVisibility.code, "VISIBILITY_OBJECT_NOT_VISIBLE");

  await request("/v1/visibility/mode", {
    body: { viewingMode: "personal" },
    method: "POST",
  });
  const personalSearch = await request(`/v1/search/media?petId=${miso.petId}`);
  assert.deepEqual(
    personalSearch.items.map((item) => item.asset_id),
    ["asset_service_fixture"],
  );
  const personalContextReplay = await request(
    `/v1/places/${contextPlaceId}/assets:attach`,
    {
      body: {
        assets: [
          { assetId: "asset_service_fixture", associationKind: "captured_at" },
          { assetId: "asset_identity_fixture", associationKind: "depicts" },
        ],
        commandId: "context.assets.beach-0001",
      },
      extraHeaders: { "x-cimmich-actor": "synthetic-context-editor" },
      method: "POST",
    },
  );
  assert.equal(personalContextReplay.detail, null);
  assert.equal(personalContextReplay.projectionUnavailable, true);
  assert.deepEqual(
    (await request(`/v1/pets/${miso.petId}/documents`)).items.map(
      (item) => item.assetId,
    ),
    ["asset_service_fixture"],
  );
  const personalPersonAssets = await request(
    "/v1/people/person_service_fixture/assets?limit=5000",
  );
  assert.equal(
    personalPersonAssets.items.some(
      (item) => item.asset_id === "asset_identity_fixture",
    ),
    false,
  );
  const privateHidden = await request(
    "/v1/visibility/objects/asset/asset_identity_fixture",
    { status: 404 },
  );
  assert.equal(privateHidden.code, "VISIBILITY_OBJECT_NOT_VISIBLE");
  assert.equal(
    (await request("/v1/places?q=Synthetic%20Greek%20beach")).items.length,
    0,
  );
  const personalObject = (
    await request("/v1/objects?q=Synthetic%20blue%20roadster")
  ).items[0];
  assert.equal(personalObject.assetCount, 1);
  assert.equal(personalObject.visibility.visibilityTier, "personal");
  assert.equal(
    (await request("/v1/events?q=Synthetic%20Greek%20holiday%202020")).items
      .length,
    0,
  );
  assert.deepEqual(
    (await request("/v1/search/smart?q=Greek%20beach")).items.map(
      (item) => item.assetId,
    ),
    [],
  );

  await request("/v1/visibility/mode", {
    body: { viewingMode: "private" },
    extraHeaders: privateHeaders(token),
    method: "POST",
  });
  const privateSearch = await request(`/v1/search/media?petId=${miso.petId}`, {
    extraHeaders: privateHeaders(token),
  });
  assert.equal(privateSearch.items.length, 2);
  assert.equal(
    (
      await request(`/v1/pets/${miso.petId}/documents`, {
        extraHeaders: privateHeaders(token),
      })
    ).items.length,
    2,
  );
  const privatePersonAssets = await request(
    "/v1/people/person_service_fixture/assets?limit=5000",
    { extraHeaders: privateHeaders(token) },
  );
  assert.equal(
    privatePersonAssets.items.some(
      (item) => item.asset_id === "asset_identity_fixture",
    ),
    true,
  );
  const subjects = await request("/v1/assets/asset_identity_fixture/subjects", {
    extraHeaders: privateHeaders(token),
  });
  assert.ok(subjects.items.some((subject) => subject.subjectKind === "pet"));
  const privatePlace = (
    await request("/v1/places?q=Synthetic%20Greek%20beach", {
      extraHeaders: privateHeaders(token),
    })
  ).items[0];
  assert.equal(privatePlace.assetCount, 2);
  assert.equal(privatePlace.visibility.visibilityTier, "private");
  const privateObject = (
    await request("/v1/objects?q=Synthetic%20blue%20roadster", {
      extraHeaders: privateHeaders(token),
    })
  ).items[0];
  assert.equal(privateObject.assetCount, 2);
  assert.equal(privateObject.visibility.visibilityTier, "personal");
  const privateObjectDetail = await request(`/v1/objects/${contextObjectId}`, {
    extraHeaders: privateHeaders(token),
  });
  assert.deepEqual(
    privateObjectDetail.assets.map((asset) => asset.sourceAssetId).sort(),
    ["source-identity-fixture", "source-service-fixture"],
  );
  const privateEventDetail = await request(`/v1/events/${contextEventId}`, {
    extraHeaders: privateHeaders(token),
  });
  assert.equal(privateEventDetail.entity.visibility.visibilityTier, "private");
  assert.ok(
    privateEventDetail.relations.some(
      (relation) => relation.targetId === contextPlaceId,
    ),
  );
  assert.equal(
    (
      await request(`/v1/places/${contextPlaceId}`, {
        extraHeaders: privateHeaders(token),
      })
    ).entity.parentEntityId,
    contextParentId,
  );
  const hiddenParentUndo = await request(
    `/v1/visibility/decisions/${hiddenParentChange.decisionId}/undo`,
    {
      body: { commandId: "visibility-context-parent-private-undo-a" },
      extraHeaders: privateHeaders(token),
      method: "POST",
    },
  );
  assert.equal(hiddenParentUndo.objects[0].visibilityTier, "standard");
  assert.ok(
    privateEventDetail.relations.some(
      (relation) => relation.targetId === contextObjectId,
    ),
  );
  assert.equal(
    (
      await request("/v1/search/smart?q=Greek%20beach", {
        extraHeaders: privateHeaders(token),
      })
    ).items.length,
    2,
  );

  const ambient = await request(`/v1/search/media?petId=${miso.petId}`, {
    extraHeaders: privateHeaders(token, "casting"),
  });
  assert.equal(ambient.items.length, 0);

  await request("/v1/visibility/lock", {
    body: { reason: "background" },
    extraHeaders: privateHeaders(token),
    method: "POST",
  });
  const locked = await request("/v1/visibility/status", {
    extraHeaders: privateHeaders(token),
  });
  assert.equal(locked.privateAuthorized, false);
  assert.equal(locked.viewingMode, "personal");

  const token2 = (
    await request("/v1/visibility/unlock", {
      body: { password: "1" },
      method: "POST",
    })
  ).privateSessionToken;
  await request(`/v1/visibility/decisions/${changed.decisionId}/undo`, {
    body: { commandId: "visibility-undo-bulk-a" },
    extraHeaders: privateHeaders(token2),
    method: "POST",
  });
  const contextVisibilityUndo = await request(
    `/v1/visibility/decisions/${contextVisibilityChanged.decisionId}/undo`,
    {
      body: { commandId: "visibility-context-entity-undo-a" },
      extraHeaders: privateHeaders(token2),
      method: "POST",
    },
  );
  assert.equal(contextVisibilityUndo.objects.length, 3);
  assert.ok(
    contextVisibilityUndo.objects.every(
      (item) => item.visibilityTier === "standard" && item.revision === 0,
    ),
  );

  const privatePetChange = await request(
    `/v1/visibility/objects/pet/${miso.petId}`,
    {
      body: {
        commandId: "visibility-pet-private-a",
        visibilityTier: "private",
      },
      extraHeaders: privateHeaders(token2),
      method: "PATCH",
    },
  );
  assert.equal(privatePetChange.objects[0].objectScope, "pet");
  await request("/v1/visibility/mode", {
    body: { viewingMode: "standard" },
    extraHeaders: privateHeaders(token2),
    method: "POST",
  });
  assert.equal(
    (await request("/v1/pets")).items.some((item) => item.petId === miso.petId),
    false,
  );
  assert.equal(
    (await request(`/v1/pets/${miso.petId}`, { status: 404 })).code,
    "PET_NOT_FOUND",
  );
  assert.equal(
    (await request(`/v1/events/${contextEventId}`)).relations.some(
      (relation) => relation.targetId === miso.petId,
    ),
    false,
  );
  assert.equal(
    (await request("/v1/assets/asset_service_fixture/subjects")).items.some(
      (subject) => subject.subjectId === miso.petId,
    ),
    false,
  );
  await request("/v1/visibility/mode", {
    body: { viewingMode: "personal" },
    extraHeaders: privateHeaders(token2),
    method: "POST",
  });
  assert.equal(
    (await request("/v1/pets")).items.some((item) => item.petId === miso.petId),
    false,
  );
  await request("/v1/visibility/mode", {
    body: { viewingMode: "private" },
    extraHeaders: privateHeaders(token2),
    method: "POST",
  });
  const privatePet = await request(`/v1/pets/${miso.petId}`, {
    extraHeaders: privateHeaders(token2),
  });
  assert.equal(privatePet.visibility.visibilityTier, "private");
  assert.ok(
    privatePet.connections.some(
      (connection) => connection.targetId === contextEventId,
    ),
  );
  await request(
    `/v1/visibility/decisions/${privatePetChange.decisionId}/undo`,
    {
      body: { commandId: "visibility-pet-private-undo-a" },
      extraHeaders: privateHeaders(token2),
      method: "POST",
    },
  );
  await request("/v1/visibility/mode", {
    body: { viewingMode: "standard" },
    extraHeaders: privateHeaders(token2),
    method: "POST",
  });
  assert.equal(
    (await request(`/v1/pets/${miso.petId}`)).visibility.visibilityTier,
    "standard",
  );
  assert.ok(
    (await request(`/v1/events/${contextEventId}`)).relations.some(
      (relation) => relation.targetId === miso.petId,
    ),
  );
  await request(`/v1/visibility/objects/pet/${miso.petId}`, {
    body: {
      commandId: "visibility-pet-restart-persist-a",
      visibilityTier: "personal",
    },
    extraHeaders: privateHeaders(token2),
    method: "PATCH",
  });
  await request("/v1/visibility/mode", {
    body: { viewingMode: "private" },
    extraHeaders: privateHeaders(token2),
    method: "POST",
  });

  const first = await request(
    "/v1/visibility/objects/asset/asset_service_fixture",
    {
      body: {
        commandId: "visibility-stale-first-a",
        visibilityTier: "personal",
      },
      extraHeaders: privateHeaders(token2),
      method: "PATCH",
    },
  );
  await request("/v1/visibility/objects/asset/asset_service_fixture", {
    body: {
      commandId: "visibility-stale-second-a",
      visibilityTier: "private",
    },
    extraHeaders: privateHeaders(token2),
    method: "PATCH",
  });
  const stale = await request(
    `/v1/visibility/decisions/${first.decisionId}/undo`,
    {
      body: { commandId: "visibility-stale-undo-a" },
      extraHeaders: privateHeaders(token2),
      method: "POST",
      status: 409,
    },
  );
  assert.equal(stale.code, "VISIBILITY_UNDO_STALE");
  await request("/v1/visibility/objects/asset/asset_service_fixture", {
    body: {
      commandId: "visibility-clean-service-a",
      visibilityTier: "standard",
    },
    extraHeaders: privateHeaders(token2),
    method: "PATCH",
  });
  await request("/v1/visibility/objects/asset/asset_body_link_clear_fixture", {
    body: {
      commandId: "visibility-restart-persist-a",
      visibilityTier: "personal",
    },
    extraHeaders: privateHeaders(token2),
    method: "PATCH",
  });
  await request(`/v1/visibility/objects/context_entity/${contextEventId}`, {
    body: {
      commandId: "visibility-context-restart-persist-a",
      visibilityTier: "personal",
    },
    extraHeaders: privateHeaders(token2),
    method: "PATCH",
  });
  await writeFile(
    tokenPath,
    JSON.stringify({ contextEventId, petId: miso.petId, token: token2 }),
    { mode: 0o600 },
  );
  console.log("Cimmich Visibility write journey acceptance: PASS");
} else if (phase === "readback") {
  const persistedState = JSON.parse(await readFile(tokenPath, "utf8"));
  const priorToken = persistedState.token;
  const restarted = await request("/v1/visibility/status", {
    extraHeaders: privateHeaders(priorToken),
  });
  assert.equal(restarted.viewingMode, "standard");
  assert.equal(restarted.privateAuthorized, false);
  assert.equal(
    (await request("/v1/pets")).items.some(
      (item) => item.petId === persistedState.petId,
    ),
    false,
  );

  const hidden = await request(
    "/v1/visibility/objects/asset/asset_body_link_clear_fixture",
    { status: 404 },
  );
  assert.equal(hidden.code, "VISIBILITY_OBJECT_NOT_VISIBLE");
  assert.equal(
    (await request("/v1/events?q=Synthetic%20Greek%20holiday%202020")).items
      .length,
    0,
  );
  await request("/v1/visibility/mode", {
    body: { viewingMode: "personal" },
    method: "POST",
  });
  const persisted = await request(
    "/v1/visibility/objects/asset/asset_body_link_clear_fixture",
  );
  assert.equal(persisted.visibilityTier, "personal");
  const persistedContext = await request(
    `/v1/visibility/objects/context_entity/${persistedState.contextEventId}`,
  );
  assert.equal(persistedContext.visibilityTier, "personal");
  assert.equal(
    (await request("/v1/events?q=Synthetic%20Greek%20holiday%202020")).items[0]
      .entityId,
    persistedState.contextEventId,
  );
  const persistedPet = await request(`/v1/pets/${persistedState.petId}`);
  assert.equal(persistedPet.visibility.visibilityTier, "personal");
  await request("/v1/visibility/objects/asset/asset_body_link_clear_fixture", {
    body: {
      commandId: "visibility-restart-clean-a",
      visibilityTier: "standard",
    },
    method: "PATCH",
  });
  await request(
    `/v1/visibility/objects/context_entity/${persistedState.contextEventId}`,
    {
      body: {
        commandId: "visibility-context-restart-clean-a",
        visibilityTier: "standard",
      },
      method: "PATCH",
    },
  );
  await request(`/v1/visibility/objects/pet/${persistedState.petId}`, {
    body: {
      commandId: "visibility-pet-restart-clean-a",
      visibilityTier: "standard",
    },
    method: "PATCH",
  });
  await unlink(tokenPath);
  console.log("Cimmich Visibility restart/readback acceptance: PASS");
} else {
  throw new Error(`Unsupported CIMMICH_VISIBILITY_PHASE: ${phase}`);
}
