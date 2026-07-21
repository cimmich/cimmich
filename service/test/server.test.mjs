import assert from "node:assert/strict";
import test from "node:test";
import { createGuidedAccess } from "../src/guided-access.mjs";
import { createCimmichServer } from "../src/server.mjs";

const withServer = async (repository, run, dependencies = {}) => {
  const server = createCimmichServer({
    allowedOrigins: new Set(),
    repository,
    ...dependencies,
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};

test("decision history is visibility-registered and bounded before projection", async () => {
  const calls = [];
  const repository = {
    decisionHistory: async (input) => {
      calls.push(["history", input]);
      return { items: [], schemaVersion: "cimmich.decision-history.v1" };
    },
  };
  const visibility = {
    requireProjection: (surface) => calls.push(["visibility", surface]),
    runRequest: (_request, _response, run) => run(),
  };
  await withServer(
    repository,
    async (root) => {
      const response = await fetch(`${root}/v1/decisions?limit=25`);
      assert.equal(response.status, 200);
      assert.equal(
        (await response.json()).schemaVersion,
        "cimmich.decision-history.v1",
      );
    },
    { visibility },
  );
  assert.deepEqual(calls, [
    ["visibility", "summary"],
    ["history", { limit: "25" }],
  ]);
});

test("companion routes expose status, explicit visibility pages and exact assets", async () => {
  const calls = [];
  const immichCompanion = {
    status: async () => ({
      schemaVersion: "cimmich.immich-companion.v1",
      state: "ready",
    }),
    listAssets: async (input) => {
      calls.push(["list", input]);
      return { items: [], nextCursor: null, visibility: input.visibility };
    },
    getAsset: async (input) => {
      calls.push(["asset", input]);
      return { asset: { immichAssetId: input.assetId } };
    },
  };
  const immichInventory = {
    status: async () => ({
      schemaVersion: "cimmich.immich-inventory.v1",
      source: { activeAssets: 3, sourceId: "synthetic-primary" },
    }),
  };
  await withServer(
    {},
    async (root) => {
      const status = await fetch(`${root}/v1/companion/status`);
      assert.equal(status.status, 200);
      assert.equal((await status.json()).state, "ready");

      const inventory = await fetch(`${root}/v1/companion/inventory`);
      assert.equal(inventory.status, 200);
      assert.equal((await inventory.json()).source.activeAssets, 3);

      const page = await fetch(
        `${root}/v1/companion/assets?visibility=archive&cursor=2&limit=40&updatedAfter=2026-01-01T00%3A00%3A00Z`,
      );
      assert.equal(page.status, 200);
      assert.equal((await page.json()).visibility, "archive");

      const exact = await fetch(
        `${root}/v1/companion/assets/asset%2Fsynthetic`,
      );
      assert.equal(exact.status, 200);
      assert.equal((await exact.json()).asset.immichAssetId, "asset/synthetic");
    },
    { immichCompanion, immichInventory },
  );
  assert.deepEqual(calls, [
    [
      "list",
      {
        cursor: "2",
        limit: "40",
        updatedAfter: "2026-01-01T00:00:00Z",
        visibility: "archive",
      },
    ],
    ["asset", { assetId: "asset/synthetic" }],
  ]);
});

test("Immich onboarding routes keep credentials write-only and visibility ahead of preview/import", async () => {
  const calls = [];
  const immichOnboarding = {
    connect: async (input) => {
      calls.push(["connect", input]);
      return {
        schemaVersion: "cimmich.immich-onboarding.v1",
        state: "connected",
      };
    },
    importCurrent: async (input) => {
      calls.push(["import", input]);
      return {
        schemaVersion: "cimmich.immich-onboarding.v1",
        state: "completed",
      };
    },
    preview: async (input) => {
      calls.push(["preview", input]);
      return {
        schemaVersion: "cimmich.immich-onboarding.v1",
        previewDigest: "a".repeat(64),
      };
    },
    status: async () => ({
      schemaVersion: "cimmich.immich-onboarding.v1",
      next: "connect",
    }),
  };
  const visibility = {
    requireProjection: (surface) => calls.push(["visibility", surface]),
    runRequest: (_request, _response, run) => run(),
    status: () => ({ viewingMode: "Standard" }),
  };
  await withServer(
    {},
    async (root) => {
      assert.equal((await fetch(`${root}/v1/onboarding/immich`)).status, 200);
      const connected = await fetch(`${root}/v1/onboarding/immich/connect`, {
        body: JSON.stringify({
          apiBaseUrl: "http://immich.test",
          credential: "never-return-this-secret",
          commandId: "onboarding-connect-1",
        }),
        headers: {
          "content-type": "application/json",
          "x-cimmich-actor": "owner",
        },
        method: "POST",
      });
      assert.equal(connected.status, 200);
      assert.equal(
        (await connected.text()).includes("never-return-this-secret"),
        false,
      );
      assert.equal(
        (
          await fetch(`${root}/v1/onboarding/immich/preview`, {
            body: JSON.stringify({ scope: { visibilities: ["timeline"] } }),
            headers: { "content-type": "application/json" },
            method: "POST",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await fetch(`${root}/v1/onboarding/immich/import`, {
            body: JSON.stringify({
              commandId: "onboarding-import-1",
              previewDigest: "a".repeat(64),
              scope: { visibilities: ["timeline"] },
            }),
            headers: {
              "content-type": "application/json",
              "x-cimmich-actor": "owner",
            },
            method: "POST",
          })
        ).status,
        200,
      );
    },
    { immichOnboarding, visibility },
  );
  assert.deepEqual(
    calls.filter(([kind]) => kind === "visibility"),
    [
      ["visibility", "immich_onboarding"],
      ["visibility", "immich_onboarding"],
      ["visibility", "immich_onboarding"],
    ],
  );
});

test("Immich unnamed-cluster routes preserve exact owner decisions and visibility before dispatch", async () => {
  const calls = [];
  const immichOnboarding = {
    personClusters: async (input) => {
      calls.push(["clusters", input]);
      return {
        clusters: [],
        schemaVersion: "cimmich.immich-person-resolution.v1",
      };
    },
    resolvePersonCluster: async (input) => {
      calls.push(["resolve", input]);
      return {
        changed: true,
        schemaVersion: "cimmich.immich-person-resolution.v1",
      };
    },
    undoPersonClusterResolution: async (input) => {
      calls.push(["undo", input]);
      return {
        changed: true,
        schemaVersion: "cimmich.immich-person-resolution.v1",
      };
    },
  };
  const visibility = {
    requireProjection: (surface) => calls.push(["visibility", surface]),
    runRequest: (_request, _response, run) => run(),
    status: () => ({ viewingMode: "Personal" }),
  };
  const scope = {
    importPeople: true,
    includeHiddenPeople: false,
    mediaKinds: ["image"],
    providerMode: "deferred",
    visibilities: ["timeline"],
  };
  await withServer(
    {},
    async (root) => {
      const preview = await fetch(
        `${root}/v1/onboarding/immich/person-clusters:preview`,
        {
          body: JSON.stringify({ scope }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      assert.equal(preview.status, 200);
      const resolved = await fetch(
        `${root}/v1/onboarding/immich/person-clusters/source-person-1/resolve`,
        {
          body: JSON.stringify({
            action: "existing_person",
            commandId: "cluster-resolve-1",
            expectedSourceRevision: "a".repeat(64),
            personId: "person-1",
            scope,
            snapshotDigest: "b".repeat(64),
          }),
          headers: {
            "content-type": "application/json",
            "x-cimmich-actor": "owner",
          },
          method: "POST",
        },
      );
      assert.equal(resolved.status, 200);
      const undone = await fetch(
        `${root}/v1/onboarding/immich/person-clusters/decisions/decision-1/undo`,
        {
          body: JSON.stringify({ commandId: "cluster-undo-1", scope }),
          headers: {
            "content-type": "application/json",
            "x-cimmich-actor": "owner",
          },
          method: "POST",
        },
      );
      assert.equal(undone.status, 200);
    },
    { immichOnboarding, visibility },
  );
  assert.deepEqual(
    calls.filter(([kind]) => kind === "visibility"),
    [
      ["visibility", "immich_onboarding"],
      ["visibility", "immich_onboarding"],
      ["visibility", "immich_onboarding"],
    ],
  );
  assert.equal(
    calls.find(([kind]) => kind === "resolve")[1].personId,
    "person-1",
  );
  assert.equal(
    calls.find(([kind]) => kind === "undo")[1].decisionId,
    "decision-1",
  );
});

test("map asset filtering keeps visibility ahead of a bounded exact source-ID projection", async () => {
  const calls = [];
  const visibility = {
    requireProjection: (surface) => calls.push(["visibility", surface]),
    runRequest: (_request, _response, run) => run(),
  };
  const repository = {
    filterVisibleMapAssetSourceIds: async (input) => {
      calls.push(["filter", input]);
      return {
        schemaVersion: "cimmich.visible-map-assets.v1",
        sourceAssetIds: [input.sourceAssetIds[0]],
      };
    },
  };
  await withServer(
    repository,
    async (root) => {
      const sourceAssetIds = [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
      ];
      const response = await fetch(`${root}/v1/map/visible-assets`, {
        body: JSON.stringify({ sourceAssetIds }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).sourceAssetIds, [
        sourceAssetIds[0],
      ]);
      const invalid = await fetch(`${root}/v1/map/visible-assets`, {
        body: JSON.stringify({ extra: true, sourceAssetIds }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      assert.equal(invalid.status, 400);
      assert.equal((await invalid.json()).code, "MAP_ASSET_IDS_INVALID");
    },
    { visibility },
  );
  assert.deepEqual(calls, [
    ["visibility", "map_assets"],
    [
      "filter",
      {
        sourceAssetIds: [
          "11111111-1111-4111-8111-111111111111",
          "22222222-2222-4222-8222-222222222222",
        ],
      },
    ],
    ["visibility", "map_assets"],
  ]);
});

test("server preserves a handled service status and JSON error body", async () => {
  await withServer(
    {
      summary: async () => {
        throw Object.assign(new Error("Synthetic conflict"), {
          statusCode: 409,
        });
      },
    },
    async (root) => {
      const response = await fetch(`${root}/v1/summary`);
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { error: "Synthetic conflict" });
    },
  );
});

test("integration routes expose visible pipeline status and a model-free settings pack", async () => {
  const projectionCalls = [];
  const repository = {
    faceMatchingStatus: async () => ({
      review: { enabled: false },
      schemaVersion: "cimmich.face-matching-status.v1",
      state: "provider_disabled",
    }),
    integrationStatus: async () => ({
      analyzedAssets: 50,
      assets: 50,
      bodyObservations: 81,
      linkedBodies: 9,
      state: "complete",
    }),
  };
  const guidedAccess = {
    setup: () => ({
      configured: true,
      enabled: true,
      schemaVersion: "cimmich.guided-setup.v1",
    }),
  };
  const visibility = {
    requireProjection: (surface) => projectionCalls.push(surface),
    runRequest: (_request, _response, run) => run(),
  };
  await withServer(
    repository,
    async (root) => {
      const status = await fetch(`${root}/v1/integrations/status`);
      assert.equal(status.status, 200);
      const statusBody = await status.json();
      assert.equal(statusBody.bodyDetection.state, "complete");
      assert.equal(statusBody.faceMatching.state, "provider_disabled");
      assert.equal(statusBody.guided.enabled, true);

      const settings = await fetch(
        `${root}/v1/integrations/provider-settings-pack`,
      );
      assert.equal(settings.status, 200);
      const settingsBody = await settings.json();
      assert.equal(settingsBody.policy.modelArtifactsInRepository, false);
      assert.equal(
        settingsBody.bodyDetection.evidenceIntake.replayRunsRequired,
        2,
      );
    },
    { guidedAccess, visibility },
  );
  assert.deepEqual(projectionCalls, ["summary"]);
});

test("authenticated address route forwards only bounded query inputs", async () => {
  const calls = [];
  const addressGeocoder = {
    search: async (input) => {
      calls.push(input);
      return {
        attribution: {
          label: "© OpenStreetMap contributors",
          url: "https://www.openstreetmap.org/copyright",
        },
        items: [],
        provider: { id: "photon" },
        schemaVersion: "cimmich.address-geocoding.v1",
      };
    },
  };
  await withServer(
    {},
    async (root) => {
      const response = await fetch(
        `${root}/v1/geocoding/addresses?q=12%20River%20Street&limit=5`,
      );
      assert.equal(response.status, 200);
      assert.equal(
        (await response.json()).schemaVersion,
        "cimmich.address-geocoding.v1",
      );
    },
    { addressGeocoder },
  );
  assert.deepEqual(calls, [{ limit: "5", query: "12 River Street" }]);
});

test("Place delete route is exact and keeps visibility ahead of repository dispatch", async () => {
  const calls = [];
  const visibility = {
    requireProjection: (surface) => calls.push(["visibility", surface]),
    runRequest: (_request, _response, run) => run(),
  };
  const repository = {
    deletePlace: async (input) => {
      calls.push(["delete", input]);
      return {
        changed: true,
        entityId: input.entityId,
        schemaVersion: "cimmich.place-delete.v1",
      };
    },
  };
  await withServer(
    repository,
    async (root) => {
      const response = await fetch(`${root}/v1/places/place_one/delete`, {
        body: JSON.stringify({
          commandId: "place.delete.0001",
          deleteTags: false,
          expectedRevision: 7,
        }),
        headers: {
          "content-type": "application/json",
          "x-cimmich-actor": "user",
        },
        method: "POST",
      });
      assert.equal(response.status, 200);
      assert.equal(
        (await response.json()).schemaVersion,
        "cimmich.place-delete.v1",
      );
    },
    { visibility },
  );
  assert.deepEqual(calls, [
    ["visibility", "places"],
    [
      "delete",
      {
        actorId: "user",
        commandId: "place.delete.0001",
        deleteTags: false,
        entityId: "place_one",
        expectedRevision: 7,
      },
    ],
  ]);
});

test("Thing delete route is exact and keeps visibility ahead of repository dispatch", async () => {
  const calls = [];
  const visibility = {
    requireProjection: (surface) => calls.push(["visibility", surface]),
    runRequest: (_request, _response, run) => run(),
  };
  const repository = {
    deleteObject: async (input) => {
      calls.push(["delete", input]);
      return {
        changed: true,
        entityId: input.entityId,
        schemaVersion: "cimmich.object-delete.v1",
      };
    },
  };
  await withServer(
    repository,
    async (root) => {
      const response = await fetch(`${root}/v1/objects/object_one/delete`, {
        body: JSON.stringify({
          commandId: "object.delete.0001",
          deleteTags: true,
          expectedRevision: 4,
        }),
        headers: {
          "content-type": "application/json",
          "x-cimmich-actor": "user",
        },
        method: "POST",
      });
      assert.equal(response.status, 200);
      assert.equal(
        (await response.json()).schemaVersion,
        "cimmich.object-delete.v1",
      );
    },
    { visibility },
  );
  assert.deepEqual(calls, [
    ["visibility", "places"],
    [
      "delete",
      {
        actorId: "user",
        commandId: "object.delete.0001",
        deleteTags: true,
        entityId: "object_one",
        expectedRevision: 4,
      },
    ],
  ]);
});

test("Document routes preserve stable IDs, typed links and decision undo", async () => {
  const calls = [];
  const repository = {
    attachDocumentLinks: async (input) => {
      calls.push(["attach", input]);
      return {
        changed: true,
        decisionId: "decision-link",
        schemaVersion: "cimmich.document.v1",
      };
    },
    detachDocumentLinks: async (input) => {
      calls.push(["detach", input]);
      return {
        changed: true,
        decisionId: "decision-detach",
        schemaVersion: "cimmich.document.v1",
      };
    },
    document: async (input) => {
      calls.push(["get", input]);
      return {
        documentId: input.documentId,
        schemaVersion: "cimmich.document.v1",
      };
    },
    documents: async (input) => {
      calls.push(["list", input]);
      return { items: [], schemaVersion: "cimmich.document.v1" };
    },
    referenceDocument: async (input) => {
      calls.push(["reference", input]);
      return {
        documentId: "document_00000000000000000000000000000001",
        schemaVersion: "cimmich.document.v1",
      };
    },
    undoDocumentDecision: async (input) => {
      calls.push(["undo", input]);
      return { changed: true, schemaVersion: "cimmich.document.v1" };
    },
    updateDocument: async (input) => {
      calls.push(["update", input]);
      return { changed: true, schemaVersion: "cimmich.document.v1" };
    },
  };
  await withServer(repository, async (root) => {
    const listed = await fetch(
      `${root}/v1/documents?q=lease&documentKind=lease&subjectKind=place&subjectId=place-one&limit=30`,
    );
    assert.equal(listed.status, 200);

    const referenced = await fetch(`${root}/v1/documents/reference`, {
      body: JSON.stringify({
        assetId: "asset-one",
        commandId: "document.reference.001",
        displayTitle: "Lease",
        documentKind: "lease",
        supersedesDocumentId: "document_00000000000000000000000000000000",
      }),
      headers: {
        "content-type": "application/json",
        "x-cimmich-actor": "tester",
      },
      method: "POST",
    });
    assert.equal(referenced.status, 201);

    const id = "document_00000000000000000000000000000001";
    assert.equal((await fetch(`${root}/v1/documents/${id}`)).status, 200);
    assert.equal(
      (
        await fetch(`${root}/v1/documents/${id}`, {
          body: JSON.stringify({
            commandId: "document.update.001",
            displayTitle: "Home lease",
          }),
          headers: {
            "content-type": "application/json",
            "x-cimmich-actor": "tester",
          },
          method: "PATCH",
        })
      ).status,
      200,
    );
    for (const action of ["attach", "detach"]) {
      const response = await fetch(
        `${root}/v1/documents/${id}/links:${action}`,
        {
          body: JSON.stringify({
            commandId: `document.link.${action}.001`,
            links: [
              {
                relationKind: "applies_to",
                subjectId: "place-one",
                subjectKind: "place",
              },
            ],
          }),
          headers: {
            "content-type": "application/json",
            "x-cimmich-actor": "tester",
          },
          method: "POST",
        },
      );
      assert.equal(response.status, 200);
    }
    const undone = await fetch(
      `${root}/v1/document-decisions/decision-link/undo`,
      {
        body: JSON.stringify({ commandId: "document.undo.001" }),
        headers: {
          "content-type": "application/json",
          "x-cimmich-actor": "tester",
        },
        method: "POST",
      },
    );
    assert.equal(undone.status, 200);
  });
  assert.equal(
    calls.map(([kind]) => kind).join(","),
    "list,reference,get,update,attach,detach,undo",
  );
  assert.equal(
    calls.find(([kind]) => kind === "reference")[1].supersedesDocumentId,
    "document_00000000000000000000000000000000",
  );
});

test("Document import uses bounded raw content and content responses are nosniff", async () => {
  const calls = [];
  const metadata = {
    commandId: "document.import.001",
    displayTitle: "Synthetic certificate",
    documentKind: "certificate",
    sourceFilename: "certificate.txt",
    supersedesDocumentId: "document_00000000000000000000000000000000",
  };
  const repository = {
    documentContent: async (input) => {
      calls.push(["content", input]);
      return {
        bytes: Buffer.from("safe document"),
        filename: "certificate.txt",
        mimeType: "text/plain",
        previewDisposition: "inline",
      };
    },
    importDocument: async (input) => {
      calls.push(["import", { ...input, bytes: input.bytes.toString("utf8") }]);
      return {
        documentId: "document_00000000000000000000000000000002",
        schemaVersion: "cimmich.document.v1",
      };
    },
  };
  await withServer(repository, async (root) => {
    const imported = await fetch(`${root}/v1/documents/import`, {
      body: Buffer.from("safe document"),
      headers: {
        "content-type": "text/plain",
        "x-cimmich-actor": "tester",
        "x-cimmich-document-metadata": Buffer.from(
          JSON.stringify(metadata),
        ).toString("base64url"),
      },
      method: "POST",
    });
    assert.equal(imported.status, 201);

    const content = await fetch(
      `${root}/v1/documents/document_00000000000000000000000000000002/content`,
    );
    assert.equal(content.status, 200);
    assert.equal(content.headers.get("x-content-type-options"), "nosniff");
    assert.match(content.headers.get("content-disposition"), /^inline;/);
    assert.equal(await content.text(), "safe document");
  });
  assert.equal(calls[0][1].bytes, "safe document");
  assert.equal(
    calls[0][1].supersedesDocumentId,
    "document_00000000000000000000000000000000",
  );
  assert.deepEqual(calls[1], [
    "content",
    { documentId: "document_00000000000000000000000000000002" },
  ]);
});

test("legacy Pet document compatibility routes require explicit adopt and scoped undo", async () => {
  const calls = [];
  const repository = {
    legacyPetDocumentCandidates: async (input) => {
      calls.push(["list", input]);
      return { items: [], schemaVersion: "cimmich.document-legacy-pet.v1" };
    },
    adoptLegacyPetDocument: async (input) => {
      calls.push(["adopt", input]);
      return {
        decisionId: "decision_00000000000000000000000000000001",
        documentId: "document_00000000000000000000000000000001",
        schemaVersion: "cimmich.document-legacy-pet.v1",
      };
    },
    undoLegacyPetDocumentAdoption: async (input) => {
      calls.push(["undo", input]);
      return { changed: true, schemaVersion: "cimmich.document-legacy-pet.v1" };
    },
  };
  await withServer(repository, async (root) => {
    const listed = await fetch(
      `${root}/v1/documents/legacy-pet-links?petId=pet-one&includeAdopted=true`,
    );
    assert.equal(listed.status, 200);
    const adopted = await fetch(
      `${root}/v1/documents/legacy-pet-links/petdoc_00000000000000000000000000000001:adopt`,
      {
        body: JSON.stringify({
          commandId: "document.legacy.adopt.001",
          displayTitle: "Vaccination certificate",
          visibilityTier: "personal",
        }),
        headers: {
          "content-type": "application/json",
          "x-cimmich-actor": "tester",
        },
        method: "POST",
      },
    );
    assert.equal(adopted.status, 201);
    const undone = await fetch(
      `${root}/v1/document-legacy-pet-decisions/decision_00000000000000000000000000000001/undo`,
      {
        body: JSON.stringify({ commandId: "document.legacy.undo.001" }),
        headers: {
          "content-type": "application/json",
          "x-cimmich-actor": "tester",
        },
        method: "POST",
      },
    );
    assert.equal(undone.status, 200);
  });
  assert.deepEqual(calls, [
    ["list", { includeAdopted: true, petId: "pet-one" }],
    [
      "adopt",
      {
        actorId: "tester",
        commandId: "document.legacy.adopt.001",
        displayTitle: "Vaccination certificate",
        legacyAssociationId: "petdoc_00000000000000000000000000000001",
        sourceFilename: undefined,
        visibilityTier: "personal",
      },
    ],
    [
      "undo",
      {
        actorId: "tester",
        commandId: "document.legacy.undo.001",
        decisionId: "decision_00000000000000000000000000000001",
      },
    ],
  ]);
});

test("Person projection pages are additive to legacy limit responses", async () => {
  const calls = [];
  const page = {
    items: [{ asset_id: "asset-one" }],
    nextCursor: "opaque-next",
    pageSize: 24,
    schemaVersion: "cimmich.person-projection-page.v1",
  };
  await withServer(
    {
      identityFaces: async (input) => {
        calls.push(["identity", input]);
        return page;
      },
      personAssets: async (input) => {
        calls.push(["assets", input]);
        return input.pageSize === null ? [] : page;
      },
    },
    async (root) => {
      const legacy = await fetch(
        `${root}/v1/people/person-one/assets?limit=5000`,
      );
      assert.deepEqual(await legacy.json(), { items: [] });

      const assets = await fetch(
        `${root}/v1/people/person-one/assets?pageSize=24&cursor=cursor-one`,
      );
      assert.deepEqual(await assets.json(), page);

      const identity = await fetch(
        `${root}/v1/people/person-one/identity?pageSize=24`,
      );
      assert.deepEqual(await identity.json(), page);
    },
  );
  assert.deepEqual(calls, [
    [
      "assets",
      { cursor: "", limit: "5000", pageSize: null, personId: "person-one" },
    ],
    [
      "assets",
      {
        cursor: "cursor-one",
        limit: null,
        pageSize: "24",
        personId: "person-one",
      },
    ],
    [
      "identity",
      { cursor: "", limit: null, pageSize: "24", personId: "person-one" },
    ],
  ]);
});

test("Holding match batch route preserves Person and bounded request shape", async () => {
  const calls = [];
  const result = {
    items: [{ faceId: "face-one", matches: [] }],
    limitPerFace: 1,
    personId: "person-holding",
    requestedCount: 1,
    schemaVersion: "cimmich.person-holding-match-batch.v1",
  };
  await withServer(
    {
      faceMatchesBatch: async (input) => {
        calls.push(input);
        return result;
      },
    },
    async (root) => {
      const response = await fetch(
        `${root}/v1/people/person-holding/identity/matches:batch`,
        {
          body: JSON.stringify({ faceIds: ["face-one"], limitPerFace: 1 }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), result);
    },
  );
  assert.deepEqual(calls, [
    {
      faceIds: ["face-one"],
      limitPerFace: 1,
      personId: "person-holding",
    },
  ]);
});

test("Face matches route exposes owner-review comparisons rather than governed suggestions", async () => {
  const calls = [];
  const result = {
    automaticIdentityAuthority: "none",
    bulkAutomationAuthority: "none",
    emptyReason: null,
    evidenceKind: "accepted_owner_faces",
    items: [
      {
        current_identity: true,
        display_name: "Current owner label",
        person_id: "person-one",
        rank: 1,
        score_kind: "cosine_similarity",
        similarity: 0.9,
      },
    ],
    matchingLibrary: "accepted_reference_faces",
    recommendationAuthority: "none",
    reviewOnly: true,
    schemaVersion: "cimmich.face-owner-review-comparisons.v1",
  };
  await withServer(
    {
      faceReviewComparisons: async (input) => {
        calls.push(input);
        return result;
      },
    },
    async (root) => {
      const response = await fetch(
        `${root}/v1/faces/face%2Fone/matches?limit=5`,
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), result);
    },
  );
  assert.deepEqual(calls, [{ faceId: "face/one", limit: "5" }]);
});

test("Detailed observation routes bind geometry, rejection and scoped Undo behind visibility", async () => {
  const calls = [];
  const projections = [];
  const repository = {
    correctGeometry: async (...input) => {
      calls.push(["geometry", ...input]);
      return { changed: true, decisionId: "decision-geometry" };
    },
    rejectObservation: async (...input) => {
      calls.push(["reject", ...input]);
      return { changed: true, decisionId: "decision-reject" };
    },
    undo: async (...input) => {
      calls.push(["undo", ...input]);
      return { changed: true, decisionId: "decision-undo" };
    },
  };
  await withServer(
    repository,
    async (root) => {
      const request = async (path, body) => {
        const response = await fetch(`${root}${path}`, {
          body: JSON.stringify(body),
          headers: {
            "content-type": "application/json",
            "x-cimmich-actor": "operator-one",
          },
          method: "POST",
        });
        assert.equal(response.status, 200);
      };
      await request("/v1/faces/face%2Fone/geometry", {
        commandId: "correction.geometry.0001",
        expectedDecisionId: null,
        expectedRevision: 1,
        region: { h: 0.3, w: 0.2, x: 0.1, y: 0.2 },
      });
      await request("/v1/bodies/body%2Fone/not-body", {
        commandId: "correction.reject.0001",
        expectedDecisionId: "decision-before",
        expectedRevision: 2,
      });
      await request(
        "/v1/observation-corrections/decisions/decision%2Freject/undo",
        { commandId: "correction.undo.0001" },
      );
    },
    {
      visibility: {
        requireProjection: (surface) => projections.push(surface),
        runRequest: (_request, _response, run) => run(),
      },
    },
  );
  assert.deepEqual(projections, [
    "asset_evidence",
    "asset_evidence",
    "asset_evidence",
  ]);
  assert.deepEqual(calls[0], [
    "geometry",
    {
      actorId: "operator-one",
      commandId: "correction.geometry.0001",
      expectedDecisionId: null,
      expectedRevision: 1,
      region: { h: 0.3, w: 0.2, x: 0.1, y: 0.2 },
    },
    "face",
    "face/one",
  ]);
  assert.equal(calls[1][2], "body");
  assert.equal(calls[2][2], "decision/reject");
});

test("accepted identity correction exposes replay-safe history and decision Undo behind visibility", async () => {
  const calls = [];
  const projections = [];
  const repository = {
    discoverIdentityCorrections: async (input) => {
      calls.push(["discover", input]);
      return {
        items: [],
        schemaVersion: "cimmich.identity-correction-history.v1",
      };
    },
    identityCorrectionHistory: async (input) => {
      calls.push(["history", input]);
      return {
        items: [],
        schemaVersion: "cimmich.identity-correction-history.v1",
      };
    },
    rejectAcceptedIdentity: async (input) => {
      calls.push(["reject", input]);
      return { decisionId: "decision/reject", undo: { eligible: true } };
    },
    undoIdentityCorrection: async (input) => {
      calls.push(["undo", input]);
      return { decisionId: "decision/undo", state: "accepted" };
    },
  };
  await withServer(
    repository,
    async (root) => {
      const rejected = await fetch(
        `${root}/v1/identity-claims/claim%2Fone/not-this-person`,
        {
          body: JSON.stringify({
            commandId: "identity.reject.0001",
            note: "Wrong person",
          }),
          headers: {
            "content-type": "application/json",
            "x-cimmich-actor": "operator-one",
          },
          method: "POST",
        },
      );
      assert.equal(rejected.status, 200);
      const history = await fetch(
        `${root}/v1/identity-claims/claim%2Fone/history`,
      );
      assert.equal(history.status, 200);
      const discovered = await fetch(
        `${root}/v1/identity-corrections?sourceAssetId=immich%2Fasset&undoEligible=true&limit=7`,
      );
      assert.equal(discovered.status, 200);
      const undone = await fetch(
        `${root}/v1/identity-claims/decisions/decision%2Freject/undo`,
        {
          body: JSON.stringify({ commandId: "identity.undo.0001" }),
          headers: {
            "content-type": "application/json",
            "x-cimmich-actor": "operator-one",
          },
          method: "POST",
        },
      );
      assert.equal(undone.status, 200);
    },
    {
      visibility: {
        requireProjection: (surface) => projections.push(surface),
        runRequest: (_request, _response, run) => run(),
      },
    },
  );
  assert.deepEqual(projections, [
    "asset_evidence",
    "asset_evidence",
    "asset_evidence",
    "asset_evidence",
  ]);
  assert.deepEqual(calls, [
    [
      "reject",
      {
        actorId: "operator-one",
        claimId: "claim/one",
        commandId: "identity.reject.0001",
        note: "Wrong person",
      },
    ],
    ["history", { claimId: "claim/one" }],
    [
      "discover",
      {
        limit: "7",
        personId: null,
        sourceAssetId: "immich/asset",
        undoEligible: true,
      },
    ],
    [
      "undo",
      {
        actorId: "operator-one",
        commandId: "identity.undo.0001",
        decisionId: "decision/reject",
      },
    ],
  ]);
});

test("manual Presence routes preserve subject command shape and visibility guards", async () => {
  const calls = [];
  const association = {
    associationId: "presence-one",
    assetId: "asset/one",
    geometry: { kind: "point", x: 0.4, y: 0.6 },
    subjectId: "person-one",
    subjectKind: "person",
  };
  const visibility = {
    requireProjection: (surfaceKey) => calls.push(["projection", surfaceKey]),
    requireVisibleAsset: async (assetId) => calls.push(["visible", assetId]),
    runRequest: (_request, _response, next) => next(),
  };
  await withServer(
    {
      manualSubjectPresences: async (input) => {
        calls.push(["list", input]);
        return { assetId: input.assetId, items: [association] };
      },
      modifyManualSubjectPresence: async (input) => {
        calls.push(["modify", input]);
        return { association, status: "applied" };
      },
      undoManualSubjectPresence: async (input) => {
        calls.push(["undo", input]);
        return { status: "reverted" };
      },
    },
    async (root) => {
      const listed = await fetch(
        `${root}/v1/assets/asset%2Fone/manual-presences`,
      );
      assert.equal(listed.status, 200);
      assert.equal((await listed.json()).items.length, 1);

      const changed = await fetch(
        `${root}/v1/assets/asset%2Fone/manual-presences`,
        {
          body: JSON.stringify({
            action: "attach",
            commandId: "manual-presence-command-a",
            geometry: { kind: "point", x: 0.4, y: 0.6 },
            subjectId: "person-one",
            subjectKind: "person",
          }),
          headers: {
            "content-type": "application/json",
            "x-cimmich-actor": "manual-editor",
          },
          method: "POST",
        },
      );
      assert.equal(changed.status, 200);
      assert.equal((await changed.json()).status, "applied");

      const undone = await fetch(
        `${root}/v1/manual-presences/decisions/decision-one/undo`,
        {
          body: JSON.stringify({ commandId: "manual-presence-command-undo" }),
          headers: {
            "content-type": "application/json",
            "x-cimmich-actor": "manual-editor",
          },
          method: "POST",
        },
      );
      assert.equal(undone.status, 200);
      assert.equal((await undone.json()).status, "reverted");
    },
    { visibility },
  );
  assert.deepEqual(calls, [
    ["projection", "asset_detail"],
    ["visible", "asset/one"],
    ["list", { assetId: "asset/one" }],
    ["projection", "asset_detail"],
    ["visible", "asset/one"],
    [
      "modify",
      {
        action: "attach",
        actorId: "manual-editor",
        assetId: "asset/one",
        commandId: "manual-presence-command-a",
        geometry: { kind: "point", x: 0.4, y: 0.6 },
        subjectId: "person-one",
        subjectKind: "person",
      },
    ],
    [
      "undo",
      {
        actorId: "manual-editor",
        commandId: "manual-presence-command-undo",
        decisionId: "decision-one",
      },
    ],
  ]);
});

test("typed manual subject tag routes use their registered visibility surface", async () => {
  const calls = [];
  const visibility = {
    requireProjection: (surfaceKey) => calls.push(["projection", surfaceKey]),
    requireVisibleAsset: async (assetId) => calls.push(["visible", assetId]),
    runRequest: (_request, _response, next) => next(),
  };
  await withServer(
    {
      attachManualSubjectTag: async (input) => {
        calls.push(["attach", input]);
        return { changed: true, identityStatus: "accepted" };
      },
      manualSubjectTags: async (input) => {
        calls.push(["list", input]);
        return { assetId: input.assetId, items: [] };
      },
      replaceManualSubjectTag: async (input) => {
        calls.push(["replace", input]);
        return { changed: true, status: "replaced" };
      },
      undoManualSubjectTag: async (input) => {
        calls.push(["undo", input]);
        return { changed: true, status: "reverted" };
      },
    },
    async (root) => {
      assert.equal(
        (await fetch(`${root}/v1/assets/asset%2Fone/manual-subject-tags`))
          .status,
        200,
      );
      assert.equal(
        (
          await fetch(`${root}/v1/assets/asset%2Fone/manual-subject-tags`, {
            body: JSON.stringify({
              commandId: "manual.face.0001",
              region: { h: 0.4, w: 0.3, x: 0.1, y: 0.2 },
              subjectId: "person-one",
              subjectKind: "person",
              tagType: "face",
            }),
            headers: {
              "content-type": "application/json",
              "x-cimmich-actor": "editor",
            },
            method: "POST",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await fetch(`${root}/v1/manual-subject-tags/tag%2Fone/replace`, {
            body: JSON.stringify({
              commandId: "manual.replace.0001",
              expectedDecisionId: "decision-one",
              region: { h: 0.2, w: 0.2, x: 0.2, y: 0.2 },
              subjectId: "pet-one",
              subjectKind: "pet",
              tagType: "head",
            }),
            headers: {
              "content-type": "application/json",
              "x-cimmich-actor": "editor",
            },
            method: "POST",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await fetch(
            `${root}/v1/manual-subject-tags/decisions/decision-one/undo`,
            {
              body: JSON.stringify({ commandId: "manual.undo.0001" }),
              headers: {
                "content-type": "application/json",
                "x-cimmich-actor": "editor",
              },
              method: "POST",
            },
          )
        ).status,
        200,
      );
    },
    { visibility },
  );
  assert.deepEqual(
    calls.filter(([kind]) => kind === "projection"),
    [
      ["projection", "manual_subject_tags"],
      ["projection", "manual_subject_tags"],
      ["projection", "manual_subject_tags"],
      ["projection", "manual_subject_tags"],
    ],
  );
  assert.deepEqual(calls.find(([kind]) => kind === "attach")[1], {
    actorId: "editor",
    assetId: "asset/one",
    commandId: "manual.face.0001",
    region: { h: 0.4, w: 0.3, x: 0.1, y: 0.2 },
    subjectId: "person-one",
    subjectKind: "person",
    tagType: "face",
  });
  assert.deepEqual(calls.find(([kind]) => kind === "replace")[1], {
    actorId: "editor",
    commandId: "manual.replace.0001",
    expectedDecisionId: "decision-one",
    region: { h: 0.2, w: 0.2, x: 0.2, y: 0.2 },
    subjectId: "pet-one",
    subjectKind: "pet",
    tagId: "tag/one",
    tagType: "head",
  });
});

test("server hides internal failures behind a stable JSON error", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await withServer(
      {
        summary: async () => {
          throw new Error("private database detail");
        },
      },
      async (root) => {
        const response = await fetch(`${root}/v1/summary`);
        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), {
          error: "Cimmich service request failed",
        });
      },
    );
  } finally {
    console.error = originalConsoleError;
  }
});

test("media job routes expose enqueue, status and one resumable receipt", async () => {
  const calls = [];
  await withServer(
    {
      mediaJob: async (input) => {
        calls.push(["get", input]);
        return { jobId: input.jobId, state: "processing" };
      },
      mediaJobEnqueue: async (input) => {
        calls.push(["enqueue", input]);
        return { jobId: "media-job-one", state: "pending" };
      },
      mediaJobStatus: async () => {
        calls.push(["status"]);
        return { summary: { pending: 1 } };
      },
    },
    async (root) => {
      const enqueue = await fetch(`${root}/v1/media-jobs`, {
        body: JSON.stringify({
          assetId: "asset-one",
          configDigest: "a".repeat(64),
          inputRevision: "b".repeat(64),
          maxAttempts: 4,
          operation: "recognize_faces",
          toolVersion: "provider-v1",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      assert.equal(enqueue.status, 202);
      assert.equal((await enqueue.json()).jobId, "media-job-one");
      assert.equal((await fetch(`${root}/v1/media-jobs`)).status, 200);
      assert.equal(
        (await fetch(`${root}/v1/media-jobs/media-job%2Fone`)).status,
        200,
      );
      assert.deepEqual(calls, [
        [
          "enqueue",
          {
            assetId: "asset-one",
            configDigest: "a".repeat(64),
            inputRevision: "b".repeat(64),
            maxAttempts: 4,
            operation: "recognize_faces",
            toolVersion: "provider-v1",
          },
        ],
        ["status"],
        ["get", { jobId: "media-job/one" }],
      ]);
    },
  );
});

test("media operator route preserves actor, command id and bounded envelope", async () => {
  const calls = [];
  const mediaOperator = {
    execute: async (input) => {
      calls.push(input);
      return { commandId: input.commandId, state: "completed" };
    },
    status: async () => ({ control: { state: "running" } }),
  };
  await withServer(
    {},
    async (root) => {
      const status = await fetch(`${root}/v1/operator/media-pipeline`);
      assert.equal(status.status, 200);
      assert.equal((await status.json()).control.state, "running");
      const run = await fetch(`${root}/v1/operator/media-pipeline`, {
        body: JSON.stringify({
          commandId: "command-browser-0001",
          commandKind: "run",
          envelope: { maxDetectionJobs: 1, maxRecognitionJobs: 1 },
        }),
        headers: {
          "content-type": "application/json",
          "x-cimmich-actor": "browser-operator",
        },
        method: "POST",
      });
      assert.equal(run.status, 200);
      assert.equal((await run.json()).state, "completed");
    },
    { mediaOperator },
  );
  assert.deepEqual(calls, [
    {
      actorId: "browser-operator",
      commandId: "command-browser-0001",
      commandKind: "run",
      envelope: { maxDetectionJobs: 1, maxRecognitionJobs: 1 },
    },
  ]);
});

test("face matching operator routes preserve canonical heads and provider-derived recognition", async () => {
  const calls = [];
  const faceMatchingOperator = {
    activate: async (input) => (
      calls.push(["activate", input]),
      { changed: true }
    ),
    compile: async () => (calls.push(["compile"]), { changed: true }),
    evaluate: async (input) => (
      calls.push(["evaluate", input]),
      { changed: true }
    ),
    readPack: async (input) => (calls.push(["read", input]), { pack: input }),
    recordReview: async (input) => (
      calls.push(["review", input]),
      { changed: true }
    ),
    rollback: async (input) => (
      calls.push(["rollback", input]),
      { changed: true }
    ),
    runRecognition: async (input) => (
      calls.push(["recognition", input]),
      { commandId: input.commandId }
    ),
    status: async () => ({ state: "needs_source_pack" }),
  };
  await withServer(
    {},
    async (root) => {
      assert.equal(
        (await fetch(`${root}/v1/operator/face-matching`)).status,
        200,
      );
      await fetch(`${root}/v1/operator/face-matching/recognition`, {
        body: JSON.stringify({
          commandId: "owner-recognition-0001",
          workLimit: 7,
        }),
        headers: {
          "content-type": "application/json",
          "x-cimmich-actor": "owner-operator",
        },
        method: "POST",
      });
      await fetch(`${root}/v1/operator/face-matching/source-packs`, {
        body: "{}",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      assert.equal(
        (
          await fetch(
            `${root}/v1/operator/face-matching/source-packs/sourcepack-one`,
          )
        ).status,
        200,
      );
      for (const [action, body] of [
        ["evaluate", {}],
        ["review", { gateReceipt: { schemaVersion: "gate-v1" } }],
        [
          "activate",
          {
            expectedCurrentPackId: null,
            expectedEvaluationId: "evaluation-one",
          },
        ],
        ["rollback", { expectedPredecessorPackId: "sourcepack-zero" }],
      ]) {
        assert.equal(
          (
            await fetch(
              `${root}/v1/operator/face-matching/source-packs/sourcepack-one/${action}`,
              {
                body: JSON.stringify(body),
                headers: { "content-type": "application/json" },
                method: "POST",
              },
            )
          ).status,
          200,
        );
      }
    },
    { faceMatchingOperator },
  );
  assert.deepEqual(calls, [
    [
      "recognition",
      {
        actorId: "owner-operator",
        commandId: "owner-recognition-0001",
        workLimit: 7,
      },
    ],
    ["compile"],
    ["read", { packId: "sourcepack-one" }],
    ["evaluate", { packId: "sourcepack-one" }],
    [
      "review",
      {
        gateReceipt: { schemaVersion: "gate-v1" },
        packId: "sourcepack-one",
      },
    ],
    [
      "activate",
      {
        expectedCurrentPackId: null,
        expectedEvaluationId: "evaluation-one",
        packId: "sourcepack-one",
      },
    ],
    [
      "rollback",
      {
        expectedPredecessorPackId: "sourcepack-zero",
        packId: "sourcepack-one",
      },
    ],
  ]);
});

test("named People routes take precedence over the generic Person read route", async () => {
  const calls = [];
  await withServer(
    {
      person: async ({ personId }) => {
        calls.push(["person", personId]);
        return { person_id: personId };
      },
      previewPersonMerge: async ({ sourcePersonId, targetPersonId }) => {
        calls.push(["merge", sourcePersonId, targetPersonId]);
        return {
          source: { person_id: sourcePersonId },
          target: { person_id: targetPersonId },
        };
      },
    },
    async (root) => {
      const preview = await fetch(
        `${root}/v1/people/merge-preview?sourcePersonId=source&targetPersonId=target`,
      );
      assert.equal(preview.status, 200);
      assert.deepEqual(calls, [["merge", "source", "target"]]);

      const person = await fetch(`${root}/v1/people/person-1`);
      assert.equal(person.status, 200);
      assert.equal((await person.json()).person_id, "person-1");
      assert.deepEqual(calls[1], ["person", "person-1"]);
    },
  );
});

test("People collection preserves the bounded Body presentation projection after visibility", async () => {
  const calls = [];
  const bodyPreview = {
    bodyId: "body-one",
    box_h: 0.7,
    box_w: 0.4,
    box_x: 0.1,
    box_y: 0.2,
    schemaVersion: "cimmich.person-body-preview.v1",
    sourceAssetId: "source-body",
  };
  await withServer(
    {
      people: async (input) => {
        calls.push(["people", input]);
        return [{ bodyPreview, person_id: "person-one" }];
      },
    },
    async (root) => {
      const response = await fetch(`${root}/v1/people?limit=20&q=Person`);
      assert.equal(response.status, 200);
      assert.deepEqual(
        (await response.json()).items[0].bodyPreview,
        bodyPreview,
      );
    },
    {
      visibility: {
        requireProjection: (surface) => calls.push(["visibility", surface]),
        runRequest: (_request, _response, run) => run(),
      },
    },
  );
  assert.deepEqual(calls, [
    ["visibility", "people"],
    ["people", { limit: "20", query: "Person" }],
  ]);
});

test("Person creation preserves exact selector and visibility-before-write", async () => {
  const calls = [];
  const visibility = {
    requireProjection: (surface) => calls.push(["visibility", surface]),
    runRequest: (_request, _response, run) => run(),
  };
  await withServer(
    {
      createPerson: async (input) => {
        calls.push(["create", input]);
        return {
          createdPerson: true,
          schemaVersion: "cimmich.person-create.v1",
        };
      },
    },
    async (root) => {
      const response = await fetch(`${root}/v1/people`, {
        body: JSON.stringify({
          commandId: "person-create-browser-001",
          newPersonName: "Fresh Person",
        }),
        headers: {
          "content-type": "application/json",
          "x-cimmich-actor": "person-editor",
        },
        method: "POST",
      });
      assert.equal(response.status, 201);
      assert.equal(
        (await response.json()).schemaVersion,
        "cimmich.person-create.v1",
      );
    },
    { visibility },
  );
  assert.deepEqual(calls, [
    ["visibility", "people"],
    [
      "create",
      {
        actorId: "person-editor",
        commandId: "person-create-browser-001",
        newPersonName: "Fresh Person",
      },
    ],
  ]);
});

test("Pet V1 routes preserve typed scope, command IDs and named-route precedence", async () => {
  const calls = [];
  await withServer(
    {
      createPet: async (input) => {
        calls.push(["create", input]);
        return { status: "applied" };
      },
      modifyPetMedia: async (input) => {
        calls.push(["media", input]);
        return { status: "applied" };
      },
      pet: async (input) => {
        calls.push(["pet", input]);
        return { petId: input.petId };
      },
      previewPetMerge: async (input) => {
        calls.push(["merge", input]);
        return { source: input.sourcePetId, target: input.targetPetId };
      },
      mergePets: async (input) => {
        calls.push(["merge-command", input]);
        return { status: "applied" };
      },
      unmergePets: async (input) => {
        calls.push(["unmerge-command", input]);
        return { status: "reverted" };
      },
      undoPetDecision: async (input) => {
        calls.push(["undo", input]);
        return { status: "reverted" };
      },
      updatePet: async (input) => {
        calls.push(["update", input]);
        return { status: "applied" };
      },
    },
    async (root) => {
      const headers = {
        "content-type": "application/json",
        "x-cimmich-actor": "pet-editor",
      };
      assert.equal(
        (
          await fetch(
            `${root}/v1/pets/merge-preview?sourcePetId=pet-a&targetPetId=pet-b`,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await fetch(`${root}/v1/pets/merge`, {
            body: JSON.stringify({
              commandId: "command-pet-merge-001",
              sourcePetId: "pet-a",
              targetPetId: "pet-b",
            }),
            headers,
            method: "POST",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await fetch(`${root}/v1/pets/merges/merge%2Fone/unmerge`, {
            body: JSON.stringify({ commandId: "command-pet-unmerge-001" }),
            headers,
            method: "POST",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await fetch(`${root}/v1/pets/pet%2Fone/media:attach`, {
            body: JSON.stringify({
              assetIds: ["asset-a", "asset-b"],
              commandId: "command-attach-1",
            }),
            headers,
            method: "POST",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await fetch(`${root}/v1/pets/pet%2Fone`, {
            body: JSON.stringify({
              commandId: "command-update-1",
              description: "Ginger",
            }),
            headers,
            method: "PATCH",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await fetch(`${root}/v1/decisions/decision%2Fone/undo`, {
            body: JSON.stringify({ commandId: "command-undo-001" }),
            headers,
            method: "POST",
          })
        ).status,
        200,
      );
      assert.equal((await fetch(`${root}/v1/pets/pet%2Fone`)).status, 200);

      assert.deepEqual(calls, [
        ["merge", { sourcePetId: "pet-a", targetPetId: "pet-b" }],
        [
          "merge-command",
          {
            actorId: "pet-editor",
            commandId: "command-pet-merge-001",
            sourcePetId: "pet-a",
            targetPetId: "pet-b",
          },
        ],
        [
          "unmerge-command",
          {
            actorId: "pet-editor",
            commandId: "command-pet-unmerge-001",
            mergeOperationId: "merge/one",
          },
        ],
        [
          "media",
          {
            actorId: "pet-editor",
            assetIds: ["asset-a", "asset-b"],
            commandId: "command-attach-1",
            petId: "pet/one",
            selected: true,
          },
        ],
        [
          "update",
          {
            actorId: "pet-editor",
            aliases: undefined,
            breedLabel: undefined,
            commandId: "command-update-1",
            coverAssetId: undefined,
            coverCrop: undefined,
            description: "Ginger",
            displayName: undefined,
            petId: "pet/one",
            speciesKind: undefined,
            speciesLabel: undefined,
            status: undefined,
          },
        ],
        [
          "undo",
          {
            actorId: "pet-editor",
            commandId: "command-undo-001",
            decisionId: "decision/one",
          },
        ],
        ["pet", { petId: "pet/one" }],
      ]);
    },
  );
});

test("Pet document routes preserve typed links and dedicated undo", async () => {
  const calls = [];
  await withServer(
    {
      petDocuments: async (input) => {
        calls.push(["list", input]);
        return { items: [], petId: input.petId };
      },
      attachPetDocuments: async (input) => {
        calls.push(["attach", input]);
        return { status: "applied" };
      },
      detachPetDocuments: async (input) => {
        calls.push(["detach", input]);
        return { status: "applied" };
      },
      undoPetDocumentDecision: async (input) => {
        calls.push(["undo", input]);
        return { status: "reverted" };
      },
    },
    async (root) => {
      const headers = {
        "content-type": "application/json",
        "x-cimmich-actor": "pet-document-editor",
      };
      assert.equal(
        (await fetch(`${root}/v1/pets/pet%2Fone/documents`)).status,
        200,
      );
      assert.equal(
        (
          await fetch(`${root}/v1/pets/pet%2Fone/documents:attach`, {
            body: JSON.stringify({
              commandId: "pet-document-attach-1",
              documents: [
                {
                  assetId: "asset-one",
                  documentKind: "vaccination",
                  documentLabel: "Annual",
                },
              ],
            }),
            headers,
            method: "POST",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await fetch(`${root}/v1/pets/pet%2Fone/documents:detach`, {
            body: JSON.stringify({
              assetIds: ["asset-one"],
              commandId: "pet-document-detach-1",
            }),
            headers,
            method: "POST",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await fetch(
            `${root}/v1/pet-documents/decisions/decision%2Fone/undo`,
            {
              body: JSON.stringify({ commandId: "pet-document-undo-001" }),
              headers,
              method: "POST",
            },
          )
        ).status,
        200,
      );
    },
  );
  assert.deepEqual(calls, [
    ["list", { petId: "pet/one" }],
    [
      "attach",
      {
        actorId: "pet-document-editor",
        commandId: "pet-document-attach-1",
        documents: [
          {
            assetId: "asset-one",
            documentKind: "vaccination",
            documentLabel: "Annual",
          },
        ],
        petId: "pet/one",
      },
    ],
    [
      "detach",
      {
        actorId: "pet-document-editor",
        assetIds: ["asset-one"],
        commandId: "pet-document-detach-1",
        petId: "pet/one",
      },
    ],
    [
      "undo",
      {
        actorId: "pet-document-editor",
        commandId: "pet-document-undo-001",
        decisionId: "decision/one",
      },
    ],
  ]);
});

test("Person Profile V1 routes preserve private aggregate and display command boundaries", async () => {
  const calls = [];
  await withServer(
    {
      getPersonProfile: async (input) => {
        calls.push(["get-profile", input]);
        return { person: { personId: input.personId } };
      },
      patchPersonProfile: async (input) => {
        calls.push(["patch-profile", input]);
        return { status: "applied" };
      },
      getPersonProfileDisplayDefaults: async () => {
        calls.push(["get-defaults"]);
        return { fields: [] };
      },
      patchPersonProfileDisplayDefaults: async (input) => {
        calls.push(["patch-defaults", input]);
        return { status: "applied" };
      },
      getPersonProfileDisplay: async (input) => {
        calls.push(["get-display", input]);
        return { personId: input.personId };
      },
      patchPersonProfileDisplay: async (input) => {
        calls.push(["patch-display", input]);
        return { status: "applied" };
      },
    },
    async (root) => {
      const headers = {
        "content-type": "application/json",
        "x-cimmich-actor": "profile-editor",
      };
      assert.equal(
        (await fetch(`${root}/v1/people/profile-display-defaults`)).status,
        200,
      );
      assert.equal(
        (
          await fetch(`${root}/v1/people/profile-display-defaults`, {
            body: JSON.stringify({
              commandId: "profile-defaults-0001",
              fields: [{ fieldKey: "about", order: 0, visible: true }],
            }),
            headers,
            method: "PATCH",
          })
        ).status,
        200,
      );
      assert.equal(
        (await fetch(`${root}/v1/people/person%2Fone/profile`)).status,
        200,
      );
      assert.equal(
        (
          await fetch(`${root}/v1/people/person%2Fone/profile`, {
            body: JSON.stringify({
              about: "Private About",
              commandId: "profile-person-0001",
            }),
            headers,
            method: "PATCH",
          })
        ).status,
        200,
      );
      assert.equal(
        (await fetch(`${root}/v1/people/person%2Fone/profile-display`)).status,
        200,
      );
      assert.equal(
        (
          await fetch(`${root}/v1/people/person%2Fone/profile-display`, {
            body: JSON.stringify({
              commandId: "profile-display-0001",
              overrides: [{ fieldKey: "about", visibility: "hide" }],
            }),
            headers,
            method: "PATCH",
          })
        ).status,
        200,
      );
    },
  );
  assert.deepEqual(calls, [
    ["get-defaults"],
    [
      "patch-defaults",
      {
        actorId: "profile-editor",
        commandId: "profile-defaults-0001",
        fields: [{ fieldKey: "about", order: 0, visible: true }],
      },
    ],
    ["get-profile", { personId: "person/one" }],
    [
      "patch-profile",
      {
        about: "Private About",
        actorId: "profile-editor",
        commandId: "profile-person-0001",
        genderIdentityKind: undefined,
        genderIdentityLabel: undefined,
        itemCommands: undefined,
        personId: "person/one",
        privateNotes: undefined,
        pronounsLabel: undefined,
        relationshipCategoryIds: undefined,
      },
    ],
    ["get-display", { personId: "person/one" }],
    [
      "patch-display",
      {
        actorId: "profile-editor",
        commandId: "profile-display-0001",
        overrides: [{ fieldKey: "about", visibility: "hide" }],
        personId: "person/one",
      },
    ],
  ]);
});

test("Person Details display routes remain separate from Hero and profile truth", async () => {
  const calls = [];
  await withServer(
    {
      getPersonDetailsDisplayDefaults: async () => {
        calls.push(["get-details-defaults"]);
        return { sections: [] };
      },
      patchPersonDetailsDisplayDefaults: async (input) => {
        calls.push(["patch-details-defaults", input]);
        return { status: "applied" };
      },
      getPersonDetailsDisplay: async (input) => {
        calls.push(["get-person-details", input]);
        return { personId: input.personId };
      },
      patchPersonDetailsDisplay: async (input) => {
        calls.push(["patch-person-details", input]);
        return { status: "applied" };
      },
    },
    async (root) => {
      const headers = {
        "content-type": "application/json",
        "x-cimmich-actor": "details-editor",
      };
      assert.equal(
        (await fetch(`${root}/v1/people/profile-details-display-defaults`))
          .status,
        200,
      );
      assert.equal(
        (
          await fetch(`${root}/v1/people/profile-details-display-defaults`, {
            body: JSON.stringify({
              commandId: "details-defaults-0001",
              sections: [{ order: 0, sectionKey: "about", visible: true }],
            }),
            headers,
            method: "PATCH",
          })
        ).status,
        200,
      );
      assert.equal(
        (await fetch(`${root}/v1/people/person%2Fone/profile-details-display`))
          .status,
        200,
      );
      assert.equal(
        (
          await fetch(
            `${root}/v1/people/person%2Fone/profile-details-display`,
            {
              body: JSON.stringify({
                commandId: "details-person-0001",
                overrides: [{ sectionKey: "about", visibility: "hide" }],
              }),
              headers,
              method: "PATCH",
            },
          )
        ).status,
        200,
      );
    },
  );
  assert.deepEqual(calls, [
    ["get-details-defaults"],
    [
      "patch-details-defaults",
      {
        actorId: "details-editor",
        commandId: "details-defaults-0001",
        sections: [{ order: 0, sectionKey: "about", visible: true }],
      },
    ],
    ["get-person-details", { personId: "person/one" }],
    [
      "patch-person-details",
      {
        actorId: "details-editor",
        commandId: "details-person-0001",
        overrides: [{ sectionKey: "about", visibility: "hide" }],
        personId: "person/one",
      },
    ],
  ]);
});

test("Visibility V1 routes preserve principal, device, token and stable command boundaries", async () => {
  const calls = [];
  const visibility = {
    runRequest: (request, response, handler) => {
      calls.push([
        "request",
        request.headers["x-cimmich-principal-id"],
        request.headers["x-cimmich-device-id"],
        request.headers["x-cimmich-private-session"],
      ]);
      response.cimmichVisibilityProject = (body) => body;
      return handler();
    },
    status: () => ({
      privateAuthorized: false,
      schemaVersion: "cimmich.visibility.v1",
      viewingMode: "standard",
    }),
    setMode: async (input) => {
      calls.push(["mode", input]);
      return { viewingMode: input.viewingMode };
    },
    unlock: async (input) => {
      calls.push(["unlock", input]);
      return {
        expiresAt: "2026-07-16T12:00:00.000Z",
        privateSessionToken: "opaque-session-token",
        schemaVersion: "cimmich.visibility.v1",
        viewingMode: "private",
      };
    },
    lock: async (input) => {
      calls.push(["lock", input]);
      return { privateAuthorized: false, viewingMode: "personal" };
    },
    getObject: async (input) => {
      calls.push(["get-object", input]);
      return { ...input, visibilityTier: "standard" };
    },
    setObjects: async (input) => {
      calls.push(["set-objects", input]);
      return { decisionId: "visibility-decision", objects: input.objects };
    },
    undo: async (input) => {
      calls.push(["undo", input]);
      return { supersedesDecisionId: input.decisionId };
    },
  };
  await withServer(
    {},
    async (root) => {
      const headers = {
        "content-type": "application/json",
        "x-cimmich-actor": "visibility-editor",
        "x-cimmich-device-id": "browser-one",
        "x-cimmich-principal-id": "local-primary",
        "x-cimmich-private-session": "opaque-session-token",
      };
      assert.equal(
        (await fetch(`${root}/v1/visibility/status`, { headers })).status,
        200,
      );
      assert.equal(
        (
          await fetch(`${root}/v1/visibility/mode`, {
            body: JSON.stringify({
              intentSequence: 1_750_000_000_001,
              viewingMode: "personal",
            }),
            headers,
            method: "POST",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await fetch(`${root}/v1/visibility/unlock`, {
            body: JSON.stringify({ password: "test-only" }),
            headers,
            method: "POST",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await fetch(`${root}/v1/visibility/objects/pet/pet%2Fone`, {
            headers,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await fetch(`${root}/v1/visibility/objects/pet/pet%2Fone`, {
            body: JSON.stringify({
              commandId: "visibility-command-0001",
              visibilityTier: "personal",
            }),
            headers,
            method: "PATCH",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await fetch(`${root}/v1/visibility/decisions/decision%2Fone/undo`, {
            body: JSON.stringify({ commandId: "visibility-command-0002" }),
            headers,
            method: "POST",
          })
        ).status,
        200,
      );
    },
    { visibility },
  );
  assert.ok(
    calls.some(
      (call) =>
        call[0] === "mode" &&
        call[1].intentSequence === 1_750_000_000_001 &&
        call[1].viewingMode === "personal",
    ),
  );
  assert.ok(
    calls.some(
      (call) =>
        call[0] === "request" &&
        call[1] === "local-primary" &&
        call[2] === "browser-one" &&
        call[3] === "opaque-session-token",
    ),
  );
  assert.ok(
    calls.some(
      (call) =>
        call[0] === "set-objects" &&
        call[1].objects[0].objectId === "pet/one" &&
        call[1].objects[0].objectScope === "pet" &&
        call[1].commandId === "visibility-command-0001",
    ),
  );
  assert.ok(
    calls.some(
      (call) =>
        call[0] === "get-object" &&
        call[1].objectId === "pet/one" &&
        call[1].objectScope === "pet",
    ),
  );
  assert.ok(
    calls.some(
      (call) => call[0] === "undo" && call[1].decisionId === "decision/one",
    ),
  );
});

test("visibility projection registry exposes enforced coverage and blocks legacy Product V1 routes", async () => {
  const calls = [];
  const items = [
    {
      assetDerived: true,
      coverageState: "blocked",
      reasonCode: "LEGACY_STATIC_PROJECTION",
      routeFamily: "/v1/events",
      surfaceKey: "events",
    },
    {
      assetDerived: true,
      coverageState: "enforced",
      reasonCode: null,
      routeFamily: "/v1/summary",
      surfaceKey: "summary",
    },
  ];
  const visibility = {
    projectionStatus: () => ({
      items,
      allRegisteredSurfacesEnforced: false,
      schemaVersion: "cimmich.visibility-projection.v1",
    }),
    requireProjection: (surfaceKey) => {
      calls.push(surfaceKey);
      if (["events", "places", "smart_search"].includes(surfaceKey)) {
        throw Object.assign(
          new Error("Cimmich visibility projection is not available"),
          {
            code: "VISIBILITY_PROJECTION_UNAVAILABLE",
            details: {
              reasonCode: "LEGACY_STATIC_PROJECTION",
              surfaceKey,
            },
            statusCode: 503,
          },
        );
      }
    },
    runRequest: (_request, response, handler) => {
      response.cimmichVisibilityProject = (body) => body;
      return handler();
    },
  };
  await withServer(
    {},
    async (root) => {
      const status = await fetch(`${root}/v1/visibility/projections`);
      assert.equal(status.status, 200);
      assert.deepEqual(await status.json(), {
        items,
        allRegisteredSurfacesEnforced: false,
        schemaVersion: "cimmich.visibility-projection.v1",
      });

      for (const [path, surfaceKey] of [
        ["/v1/events", "events"],
        ["/v1/places", "places"],
        ["/v1/search/smart", "smart_search"],
      ]) {
        const response = await fetch(`${root}${path}`);
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), {
          code: "VISIBILITY_PROJECTION_UNAVAILABLE",
          details: {
            reasonCode: "LEGACY_STATIC_PROJECTION",
            surfaceKey,
          },
          error: "Cimmich visibility projection is not available",
        });
      }
    },
    { visibility },
  );
  assert.deepEqual(calls, ["events", "places", "smart_search"]);
});

test("context routes preserve typed family scope, bounded inputs and command identity", async () => {
  const calls = [];
  const repository = {
    attachContextAssets: async (input) => {
      calls.push(["attach-assets", input]);
      return { status: "applied" };
    },
    attachContextRelations: async (input) => {
      calls.push(["attach-relations", input]);
      return { status: "applied" };
    },
    contextEntities: async (input) => {
      calls.push(["list", input]);
      return [];
    },
    contextEntity: async (input) => {
      calls.push(["get", input]);
      return { entity: { entityId: input.entityId } };
    },
    createContextEntity: async (input) => {
      calls.push(["create", input]);
      return { status: "applied" };
    },
    detachContextAssets: async (input) => {
      calls.push(["detach-assets", input]);
      return { status: "applied" };
    },
    detachContextRelations: async (input) => {
      calls.push(["detach-relations", input]);
      return { status: "applied" };
    },
    setPlaceCover: async (input) => {
      calls.push(["set-cover", input]);
      return { status: "applied" };
    },
    setEventCover: async (input) => {
      calls.push(["set-event-cover", input]);
      return { status: "applied" };
    },
    setObjectCover: async (input) => {
      calls.push(["set-object-cover", input]);
      return { status: "applied" };
    },
    undoContextDecision: async (input) => {
      calls.push(["undo", input]);
      return { status: "reverted" };
    },
    updateContextEntity: async (input) => {
      calls.push(["update", input]);
      return { status: "applied" };
    },
  };
  await withServer(repository, async (root) => {
    const headers = {
      "content-type": "application/json",
      "x-cimmich-actor": "context-reviewer",
    };
    assert.equal(
      (
        await fetch(
          `${root}/v1/places?q=beach&limit=20&includeHidden=true&includeArchived=true`,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(`${root}/v1/places/place%2Fone/cover`, {
          body: JSON.stringify({
            commandId: "context.cover.place-one",
            expectedRevision: 7,
            sourceAssetId: "source-one",
          }),
          headers,
          method: "POST",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(`${root}/v1/places/place-one/cover`, {
          body: JSON.stringify({
            commandId: "context.cover.invalid-one",
            expectedRevision: 7,
          }),
          headers,
          method: "POST",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(`${root}/v1/objects/object%2Fone/cover`, {
          body: JSON.stringify({
            commandId: "context.cover.object-one",
            expectedRevision: 5,
            sourceAssetId: "source-two",
          }),
          headers,
          method: "POST",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(`${root}/v1/events`, {
          body: JSON.stringify({
            commandId: "context.create.event-one",
            datePrecision: "year",
            dateStart: "2025-01-01",
            displayName: "Test trip",
            typeKind: "trip",
          }),
          headers,
          method: "POST",
        })
      ).status,
      201,
    );
    assert.equal(
      (await fetch(`${root}/v1/objects/object%2Fone?includeArchived=true`))
        .status,
      200,
    );
    assert.equal(
      (
        await fetch(`${root}/v1/objects/object%2Fone`, {
          body: JSON.stringify({
            commandId: "context.update.object-one",
            displayName: "Updated car",
            expectedRevision: 7,
          }),
          headers,
          method: "PATCH",
        })
      ).status,
      200,
    );
    for (const [path, body] of [
      [
        "/v1/places/place-one/assets:attach",
        {
          assets: [{ assetId: "asset-one", associationKind: "captured_at" }],
          commandId: "context.assets.attach-one",
        },
      ],
      [
        "/v1/places/place-one/assets:detach",
        { assetIds: ["asset-one"], commandId: "context.assets.detach-one" },
      ],
      [
        "/v1/events/event-one/relations:attach",
        {
          commandId: "context.relations.attach-one",
          relations: [
            {
              relationKind: "location",
              targetId: "place-one",
              targetKind: "place",
            },
          ],
        },
      ],
      [
        "/v1/events/event-one/relations:detach",
        {
          commandId: "context.relations.detach-one",
          relationIds: ["relation-one"],
        },
      ],
      [
        "/v1/context/decisions/decision%2Fone/undo",
        { commandId: "context.undo.decision-one" },
      ],
    ]) {
      assert.equal(
        (
          await fetch(`${root}${path}`, {
            body: JSON.stringify(body),
            headers,
            method: "POST",
          })
        ).status,
        200,
      );
    }
    assert.equal(
      (
        await fetch(`${root}/v1/events/event%2Fone/cover`, {
          body: JSON.stringify({
            commandId: "context.cover.event-one",
            expectedRevision: 9,
            sourceAssetId: "source-three",
          }),
          headers,
          method: "POST",
        })
      ).status,
      200,
    );
  });
  assert.deepEqual(calls[0], [
    "list",
    {
      entityKind: "place",
      includeArchived: true,
      includeHidden: true,
      limit: "20",
      query: "beach",
    },
  ]);
  assert.deepEqual(calls[1], [
    "set-cover",
    {
      actorId: "context-reviewer",
      commandId: "context.cover.place-one",
      entityId: "place/one",
      expectedRevision: 7,
      sourceAssetId: "source-one",
    },
  ]);
  assert.deepEqual(calls[2], [
    "set-object-cover",
    {
      actorId: "context-reviewer",
      commandId: "context.cover.object-one",
      entityId: "object/one",
      expectedRevision: 5,
      sourceAssetId: "source-two",
    },
  ]);
  assert.equal(calls[3][0], "create");
  assert.equal(calls[3][1].entityKind, "event");
  assert.equal(calls[3][1].actorId, "context-reviewer");
  assert.deepEqual(calls[4], [
    "get",
    { entityId: "object/one", entityKind: "object", includeArchived: true },
  ]);
  assert.equal(calls[5][0], "update");
  assert.equal(calls[5][1].entityId, "object/one");
  assert.equal(calls[5][1].expectedRevision, 7);
  assert.equal(calls[6][0], "attach-assets");
  assert.equal(calls[7][0], "detach-assets");
  assert.equal(calls[8][0], "attach-relations");
  assert.equal(calls[9][0], "detach-relations");
  assert.deepEqual(calls[10], [
    "undo",
    {
      actorId: "context-reviewer",
      commandId: "context.undo.decision-one",
      decisionId: "decision/one",
    },
  ]);
  assert.deepEqual(calls[11], [
    "set-event-cover",
    {
      actorId: "context-reviewer",
      commandId: "context.cover.event-one",
      entityId: "event/one",
      expectedRevision: 9,
      sourceAssetId: "source-three",
    },
  ]);
});

test("manual photo-context routes preserve asset, Thing, region, revision and decision boundaries", async () => {
  const calls = [];
  const repository = {
    attachManualObjectRegion: async (input) => {
      calls.push(["attach", input]);
      return { schemaVersion: "cimmich.manual-object-region.v1" };
    },
    replaceManualObjectRegion: async (input) => {
      calls.push(["replace", input]);
      return { schemaVersion: "cimmich.manual-object-region.v1" };
    },
    rejectManualObjectRegion: async (input) => {
      calls.push(["reject", input]);
      return { schemaVersion: "cimmich.manual-object-region.v1" };
    },
    setAssetOwnerSummary: async (input) => {
      calls.push(["summary", input]);
      return { schemaVersion: "cimmich.asset-owner-summary.v1" };
    },
    undoManualPhotoContextDecision: async (input) => {
      calls.push(["undo", input]);
      return { schemaVersion: "cimmich.manual-photo-context-undo.v1" };
    },
  };
  await withServer(repository, async (root) => {
    const headers = {
      "content-type": "application/json",
      "x-cimmich-actor": "owner-one",
    };
    const post = async (path, body) =>
      fetch(`${root}${path}`, {
        body: JSON.stringify(body),
        headers,
        method: "POST",
      });
    assert.equal(
      (
        await post("/v1/assets/asset%2Fone/manual-context-tags", {
          commandId: "context.attach.001",
          entityId: "object-one",
          region: { h: 0.4, w: 0.3, x: 0.1, y: 0.2 },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await post("/v1/manual-context-tags/tag%2Fone/replace", {
          commandId: "context.replace.001",
          entityId: "object-two",
          expectedDecisionId: "decision-old",
          region: { h: 0.3, w: 0.2, x: 0.2, y: 0.1 },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await post("/v1/manual-context-tags/tag%2Ftwo/reject", {
          commandId: "context.reject.001",
          expectedDecisionId: "decision-current",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await post("/v1/assets/asset%2Fone/owner-summary", {
          commandId: "context.summary.001",
          expectedRevision: 2,
          summaryText: "Owner summary",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await post("/v1/manual-photo-context/decisions/decision%2Fone/undo", {
          commandId: "context.undo.0001",
        })
      ).status,
      200,
    );
  });
  assert.deepEqual(calls, [
    [
      "attach",
      {
        actorId: "owner-one",
        assetId: "asset/one",
        commandId: "context.attach.001",
        entityId: "object-one",
        region: { h: 0.4, w: 0.3, x: 0.1, y: 0.2 },
      },
    ],
    [
      "replace",
      {
        actorId: "owner-one",
        commandId: "context.replace.001",
        entityId: "object-two",
        expectedDecisionId: "decision-old",
        region: { h: 0.3, w: 0.2, x: 0.2, y: 0.1 },
        tagId: "tag/one",
      },
    ],
    [
      "reject",
      {
        actorId: "owner-one",
        commandId: "context.reject.001",
        expectedDecisionId: "decision-current",
        tagId: "tag/two",
      },
    ],
    [
      "summary",
      {
        actorId: "owner-one",
        assetId: "asset/one",
        commandId: "context.summary.001",
        expectedRevision: 2,
        summaryText: "Owner summary",
      },
    ],
    [
      "undo",
      {
        actorId: "owner-one",
        commandId: "context.undo.0001",
        decisionId: "decision/one",
      },
    ],
  ]);
});

test("Basic Smart Search route preserves query and bounded result limit", async () => {
  const calls = [];
  await withServer(
    {
      smartSearch: async (input) => {
        calls.push(input);
        return {
          items: [],
          query: input.query,
          schemaVersion: "cimmich.smart-search-basic.v2",
        };
      },
    },
    async (root) => {
      const response = await fetch(
        `${root}/v1/search/smart?q=Jane%20at%20Greek%20beach&limit=40`,
      );
      assert.equal(response.status, 200);
      assert.equal(
        (await response.json()).schemaVersion,
        "cimmich.smart-search-basic.v2",
      );
    },
  );
  assert.deepEqual(calls, [{ limit: "40", query: "Jane at Greek beach" }]);
});

test("modifier proposal review binds Person, proposal, action and actor", async () => {
  const calls = [];
  await withServer(
    {
      decideFaceModifierProposal: async (input) => {
        calls.push(input);
        return { changed: true, ...input };
      },
    },
    async (root) => {
      const response = await fetch(
        `${root}/v1/people/person%20one/identity/modifier-proposals/proposal%2Fone/decision`,
        {
          body: JSON.stringify({ action: "reject" }),
          headers: {
            "content-type": "application/json",
            "x-cimmich-actor": "synthetic-reviewer",
          },
          method: "POST",
        },
      );
      assert.equal(response.status, 200);
      assert.deepEqual(calls, [
        {
          action: "reject",
          actorId: "synthetic-reviewer",
          personId: "person one",
          proposalId: "proposal/one",
        },
      ]);
    },
  );
});

test("machine review and Memory Steward routes preserve their distinct authority", async () => {
  const calls = [];
  await withServer(
    {
      machineSuggestions: async ({ limit }) => {
        calls.push(["machine", limit]);
        return [{ face_id: "face-one" }];
      },
    },
    async (root) => {
      // The shared test helper intentionally creates the server without a Steward.
      const suggestions = await fetch(
        `${root}/v1/review/machine-suggestions?limit=7`,
      );
      assert.equal(suggestions.status, 200);
      assert.deepEqual(await suggestions.json(), {
        items: [{ face_id: "face-one" }],
      });
      assert.deepEqual(calls, [["machine", "7"]]);

      const steward = await fetch(`${root}/v1/steward/plan`, {
        body: JSON.stringify({ goal: "Help" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      assert.equal(steward.status, 503);
      assert.deepEqual(await steward.json(), {
        error: "Memory Steward is not configured",
      });
    },
  );
});

test("Guided V1 routes authenticate discovery and keep access read/propose-only", async () => {
  const calls = [];
  const guidedAccess = {
    access: async (input, dependencies) => {
      calls.push(["access", input]);
      dependencies.requireProjection("machine_suggestions");
      return {
        action: input.action,
        schemaVersion: "cimmich.guided-access.v1",
      };
    },
    authorize: (header) => {
      calls.push(["authorize", header]);
      if (header !== "Bearer guided-token") {
        throw Object.assign(new Error("Guided access authentication failed"), {
          code: "GUIDED_UNAUTHORIZED",
          statusCode: 401,
        });
      }
    },
    capabilities: () => ({ schemaVersion: "cimmich.guided-access.v1" }),
    instructions: () => ({ schemaVersion: "cimmich.guided-instructions.v1" }),
  };
  const projectionCalls = [];
  const visibility = {
    requireProjection: (surface) => projectionCalls.push(surface),
    runForcedStandard: (surface, run) => {
      calls.push(["forced-standard", surface]);
      return run();
    },
    runRequest: (_request, _response, run) => run(),
  };
  await withServer(
    {},
    async (root) => {
      const queryToken = await fetch(
        `${root}/v1/guided/v1/capabilities?token=guided-token`,
      );
      assert.equal(queryToken.status, 400);
      assert.equal(
        (await queryToken.json()).code,
        "GUIDED_TOKEN_TRANSPORT_FORBIDDEN",
      );

      const unauthorized = await fetch(`${root}/v1/guided/v1/capabilities`);
      assert.equal(unauthorized.status, 401);
      assert.equal((await unauthorized.json()).code, "GUIDED_UNAUTHORIZED");

      const headers = { authorization: "Bearer guided-token" };
      const capability = await fetch(`${root}/v1/guided/v1/capabilities`, {
        headers,
      });
      assert.equal(capability.status, 200);
      assert.equal(
        (await capability.json()).schemaVersion,
        "cimmich.guided-access.v1",
      );

      const instruction = await fetch(`${root}/v1/guided/v1/instructions`, {
        headers,
      });
      assert.equal(instruction.status, 200);
      assert.equal(
        (await instruction.json()).schemaVersion,
        "cimmich.guided-instructions.v1",
      );

      const access = await fetch(`${root}/v1/guided/v1/access`, {
        body: JSON.stringify({
          action: "propose.review_plan",
          input: { limit: 3 },
        }),
        headers: { ...headers, "content-type": "application/json" },
        method: "POST",
      });
      assert.equal(access.status, 200);
      assert.equal((await access.json()).action, "propose.review_plan");

      const bodyToken = await fetch(`${root}/v1/guided/v1/access`, {
        body: JSON.stringify({
          action: "propose.review_plan",
          input: {},
          token: "guided-token",
        }),
        headers: { ...headers, "content-type": "application/json" },
        method: "POST",
      });
      assert.equal(bodyToken.status, 400);
      assert.equal(
        (await bodyToken.json()).code,
        "GUIDED_TOKEN_TRANSPORT_FORBIDDEN",
      );
    },
    { guidedAccess, visibility },
  );
  assert.deepEqual(projectionCalls, ["machine_suggestions"]);
  assert.deepEqual(calls, [
    ["forced-standard", "guided_v1"],
    ["authorize", undefined],
    ["forced-standard", "guided_v1"],
    ["authorize", "Bearer guided-token"],
    ["forced-standard", "guided_v1"],
    ["authorize", "Bearer guided-token"],
    ["forced-standard", "guided_v1"],
    ["authorize", "Bearer guided-token"],
    ["access", { action: "propose.review_plan", input: { limit: 3 } }],
    ["forced-standard", "guided_v1"],
    ["authorize", "Bearer guided-token"],
  ]);
});

test("Guided server preserves invalid inputs and mutation shapes without repository dispatch", async () => {
  const accessToken = "guided-server-token-0123456789abcdef";
  let repositoryDispatches = 0;
  const repository = {
    machineSuggestions: async () => {
      repositoryDispatches += 1;
      return [];
    },
    person: async () => {
      repositoryDispatches += 1;
      return {};
    },
    summary: async () => {
      repositoryDispatches += 1;
      return {};
    },
  };
  const guidedAccess = createGuidedAccess({
    accessToken,
    enabled: true,
    repository,
  });
  const visibility = {
    requireProjection: () => {},
    runForcedStandard: (_surface, run) => run(),
    runRequest: (_request, _response, run) => run(),
  };
  const requestAccess = (root, body) =>
    fetch(`${root}/v1/guided/v1/access`, {
      body: JSON.stringify(body),
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      method: "POST",
    });

  await withServer(
    repository,
    async (root) => {
      for (const input of [null, false, "scalar", 0, []]) {
        const response = await requestAccess(root, {
          action: "read.library_overview",
          input,
        });
        assert.equal(response.status, 400);
        assert.equal((await response.json()).code, "GUIDED_INPUT_INVALID");
      }

      for (const action of ["read./internal", `read.${"x".repeat(65)}`]) {
        const response = await requestAccess(root, { action, input: {} });
        assert.equal(response.status, 400);
        const payload = await response.json();
        assert.equal(payload.code, "GUIDED_INPUT_INVALID");
        assert.equal(JSON.stringify(payload).includes(action), false);
      }

      for (const action of ["write.identity", "delete.identity"]) {
        const response = await requestAccess(root, { action, input: {} });
        assert.equal(response.status, 403);
        assert.equal(
          (await response.json()).code,
          "GUIDED_MUTATION_APPROVAL_REQUIRED",
        );
      }
    },
    { guidedAccess, visibility },
  );
  assert.equal(repositoryDispatches, 0);
});

test("Guided V2 bootstraps and delegates canonical operations without forced Standard or caller actor trust", async () => {
  const accessToken = "guided-v2-server-token-0123456789abcdef";
  const calls = [];
  const repository = {
    createContextEntity: async (input) => {
      calls.push(input);
      return {
        changed: true,
        decisionId: "decision-guided-v2",
        entityId: "event-guided-v2",
        replayed: false,
      };
    },
    summary: async () => ({ assets: 6, people: 1 }),
  };
  const guidedAccess = createGuidedAccess({
    accessToken,
    authority: "operate",
    enabled: true,
    immichPublicBaseUrl: "http://127.0.0.1:2283/api",
    publicBaseUrl: "http://127.0.0.1:3301",
    repository,
    uiPublicBaseUrl: "http://127.0.0.1:3303",
    visibilityCeiling: "private",
  });
  const visibility = {
    requireProjection: () => {},
    runRequest: (_request, _response, run) => run(),
    status: () => ({
      forcedStandard: false,
      privateAuthorized: false,
      surface: "guided",
      viewingMode: "personal",
    }),
  };
  const headers = {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
    "x-cimmich-actor": "caller-must-not-control-actor",
    "x-cimmich-device-id": "guided-device",
    "x-cimmich-principal-id": "guided-principal",
    "x-cimmich-surface": "guided",
  };

  await withServer(
    repository,
    async (root) => {
      const bootstrap = await fetch(`${root}/v1/guided/v2/bootstrap`, {
        headers,
      });
      assert.equal(bootstrap.status, 200);
      const discovery = await bootstrap.json();
      assert.equal(discovery.schemaVersion, "cimmich.guided-bootstrap.v2");
      assert.equal(discovery.visibility.viewingMode, "personal");
      assert.equal(discovery.visibility.forcedStandard, false);

      const summary = await fetch(`${root}/v1/summary`, { headers });
      assert.equal(summary.status, 200);
      assert.equal((await summary.json()).assets, 6);

      const create = await fetch(`${root}/v1/events`, {
        body: JSON.stringify({
          commandId: "guided-space-trip-event",
          displayName: "Space Trip",
        }),
        headers,
        method: "POST",
      });
      assert.equal(create.status, 201);

      const hidden = await fetch(`${root}/v1/media-jobs`, { headers });
      assert.equal(hidden.status, 403);
      assert.equal((await hidden.json()).code, "GUIDED_ROUTE_NOT_EXPOSED");
    },
    { guidedAccess, visibility },
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0].actorId, /^guided_[0-9a-f]{24}$/);
  assert.equal(calls[0].displayName, "Space Trip");
});

test("machine review decisions bind a face to a stable Person ID or matcher-contract dismissal", async () => {
  const calls = [];
  await withServer(
    {
      dismissMachineSuggestion: async (input) => {
        calls.push(["unknown", input]);
        return { changed: true, state: "ignored", ...input };
      },
      reassignFaceIdentity: async (input) => {
        calls.push(["accept", input]);
        return { changed: true, state: "accepted", ...input };
      },
      restoreMachineSuggestion: async (input) => {
        calls.push(["restore", input]);
        return { changed: true, state: "active", ...input };
      },
    },
    async (root) => {
      const accept = await fetch(
        `${root}/v1/review/machine-suggestions/face%2Fone/accept`,
        {
          body: JSON.stringify({ personId: "person-one" }),
          headers: {
            "content-type": "application/json",
            "x-cimmich-actor": "reviewer",
          },
          method: "POST",
        },
      );
      assert.equal(accept.status, 200);

      const unknown = await fetch(
        `${root}/v1/review/machine-suggestions/face%2Ftwo/unknown`,
        {
          body: "{}",
          headers: {
            "content-type": "application/json",
            "x-cimmich-actor": "reviewer",
          },
          method: "POST",
        },
      );
      assert.equal(unknown.status, 200);

      const restore = await fetch(
        `${root}/v1/review/machine-suggestions/face%2Ftwo/restore`,
        {
          body: "{}",
          headers: {
            "content-type": "application/json",
            "x-cimmich-actor": "reviewer",
          },
          method: "POST",
        },
      );
      assert.equal(restore.status, 200);
      assert.deepEqual(calls, [
        [
          "accept",
          { actorId: "reviewer", faceId: "face/one", personId: "person-one" },
        ],
        ["unknown", { actorId: "reviewer", faceId: "face/two" }],
        ["restore", { actorId: "reviewer", faceId: "face/two" }],
      ]);
    },
  );
});

test("Face review exposes durable Later, Unknown and rejected-suggestion Restore behind visibility", async () => {
  const calls = [];
  const surfaces = [];
  const visibility = {
    requireProjection: (surface) => surfaces.push(surface),
    runRequest: (_request, _response, run) => run(),
  };
  await withServer(
    {
      decideIdentityClaim: async (input) => {
        calls.push(["claim", input]);
        return { changed: true, state: "candidate", ...input };
      },
      setFaceReviewDisposition: async (input) => {
        calls.push(["review", input]);
        return {
          changed: true,
          decisionId: "decision-review",
          replayed: false,
          schemaVersion: "cimmich.face-review-disposition.v1",
          ...input,
        };
      },
    },
    async (root) => {
      const later = await fetch(
        `${root}/v1/faces/face%2Freview/review-disposition`,
        {
          body: JSON.stringify({
            commandId: "face-review.later.1",
            disposition: "later",
          }),
          headers: {
            "content-type": "application/json",
            "x-cimmich-actor": "reviewer",
          },
          method: "POST",
        },
      );
      assert.equal(later.status, 200);
      assert.equal((await later.json()).disposition, "later");

      const restored = await fetch(
        `${root}/v1/review/identity-claims/claim%2Frejected/decision`,
        {
          body: JSON.stringify({ action: "restore" }),
          headers: {
            "content-type": "application/json",
            "x-cimmich-actor": "reviewer",
          },
          method: "POST",
        },
      );
      assert.equal(restored.status, 200);
      assert.equal((await restored.json()).state, "candidate");
    },
    { visibility },
  );
  assert.deepEqual(calls, [
    [
      "review",
      {
        actorId: "reviewer",
        commandId: "face-review.later.1",
        disposition: "later",
        faceId: "face/review",
      },
    ],
    [
      "claim",
      {
        action: "restore",
        actorId: "reviewer",
        claimId: "claim/rejected",
        note: undefined,
      },
    ],
  ]);
  assert.deepEqual(surfaces, ["asset_evidence", "asset_evidence"]);
});

test("Face identity save accepts exactly one existing-or-new Person selector", async () => {
  const calls = [];
  const surfaces = [];
  const visibility = {
    requireProjection: (surface) => surfaces.push(surface),
    runRequest: (_request, _response, run) => run(),
  };
  await withServer(
    {
      reassignFaceIdentity: async (input) => {
        calls.push(input);
        return {
          changed: true,
          claimId: "claim-created",
          createdPerson: true,
          decisionId: "decision-created",
          faceId: input.faceId,
          personId: "person-created",
          personName: input.newPersonName,
          previousPersonId: null,
          state: "accepted",
        };
      },
    },
    async (root) => {
      const created = await fetch(`${root}/v1/faces/face%2Fnew/identity`, {
        body: JSON.stringify({ newPersonName: "New Person" }),
        headers: {
          "content-type": "application/json",
          "x-cimmich-actor": "reviewer",
        },
        method: "POST",
      });
      assert.equal(created.status, 200);
      assert.equal((await created.json()).createdPerson, true);

      for (const body of [
        {},
        { personId: "person-one", personName: "Person One" },
        { newPersonName: "Person Two", unexpected: true },
        null,
      ]) {
        const invalid = await fetch(`${root}/v1/faces/face-one/identity`, {
          body: JSON.stringify(body),
          headers: {
            "content-type": "application/json",
            "x-cimmich-actor": "reviewer",
          },
          method: "POST",
        });
        assert.equal(invalid.status, 400);
        assert.equal(
          (await invalid.json()).code,
          "FACE_IDENTITY_SELECTOR_INVALID",
        );
      }
    },
    { visibility },
  );
  assert.deepEqual(calls, [
    {
      actorId: "reviewer",
      faceId: "face/new",
      newPersonName: "New Person",
    },
  ]);
  assert.deepEqual(surfaces, Array(5).fill("asset_detail"));
});
