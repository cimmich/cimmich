import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
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

test("raw API rejects an untrusted Host even when Origin is absent", async () => {
  await withServer({ health: async () => ({ status: "ok" }) }, async (root) => {
    const target = new URL(`${root}/health`);
    const rejected = await new Promise((resolve, reject) => {
      const request = httpRequest(
        {
          headers: { host: "evil.example.test" },
          hostname: target.hostname,
          method: "GET",
          path: target.pathname,
          port: target.port,
        },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () =>
            resolve({
              body: Buffer.concat(chunks).toString("utf8"),
              status: response.statusCode,
            }),
          );
        },
      );
      request.on("error", reject);
      request.end();
    });
    assert.equal(rejected.status, 421);
    assert.deepEqual(JSON.parse(rejected.body), {
      error: "Host is not allowed",
    });

    const accepted = await fetch(`${root}/health`);
    assert.equal(accepted.status, 200);
  });
});

test("canonical Local AI routes expose bounded jobs and verified binary review artifacts", async () => {
  const calls = [];
  const jobId = "95e571ab-79a1-4f45-8416-2a3f22ca7f7a";
  const token = "2af22c3c-e009-42a4-98e8-bb0f790bb25f:quick";
  const job = {
    artifactTokens: [token],
    jobId,
    operation: "quick",
    schemaVersion: "cimmich.local-ai-jobs.v1",
    state: "completed",
  };
  const localAi = {
    artifact: async (input) => {
      calls.push(["artifact", input]);
      return {
        bytes: Buffer.from("derived-review"),
        disposition: "inline",
        filename: "quick.png",
        mimeType: "image/png",
      };
    },
    cancel: (id) => {
      calls.push(["cancel", id]);
      return job;
    },
    get: (id) => {
      calls.push(["get", id]);
      return job;
    },
    start: async (input) => {
      calls.push(["start", input]);
      return job;
    },
    status: () => ({
      capabilities: { best: true, faces: true, quick: true },
      enabled: true,
      schemaVersion: "cimmich.local-ai-jobs.v1",
      state: "ready",
    }),
  };
  await withServer(
    {},
    async (root) => {
      const status = await fetch(`${root}/v1/local-ai`);
      assert.equal(status.status, 200);
      assert.equal((await status.json()).state, "ready");

      const started = await fetch(`${root}/v1/local-ai/jobs`, {
        body: JSON.stringify({
          operation: "quick",
          sourceAssetIds: [token.split(":")[0]],
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      assert.equal(started.status, 202);

      assert.equal(
        (await fetch(`${root}/v1/local-ai/jobs/${jobId}`)).status,
        200,
      );
      assert.equal(
        (await fetch(`${root}/v1/local-ai/jobs/${jobId}`, { method: "DELETE" }))
          .status,
        200,
      );

      const artifact = await fetch(
        `${root}/v1/local-ai/jobs/${jobId}/artifacts/${encodeURIComponent(token)}`,
      );
      assert.equal(artifact.status, 200);
      assert.equal(artifact.headers.get("content-type"), "image/png");
      assert.equal(await artifact.text(), "derived-review");
    },
    { localAi, surfacePolicy: "canonical" },
  );
  assert.deepEqual(calls, [
    ["start", { operation: "quick", sourceAssetIds: [token.split(":")[0]] }],
    ["get", jobId],
    ["cancel", jobId],
    ["artifact", { jobId, token }],
  ]);
});

test("canonical owner gateway headers bind routes to the verified principal", async () => {
  const calls = [];
  const principalId = "22222222-2222-4222-8222-222222222222";
  const origin = "http://owner.example.test";
  const immichOnboarding = {
    connect: async (input) => {
      calls.push(input);
      return { state: "connected" };
    },
    status: async () => ({ connection: { state: "not_configured" } }),
  };
  const immichOwnerSession = {
    authorize: async (headers) => {
      assert.equal(headers.cookie, "immich_access_token=owner");
      return { principalId, state: "owner" };
    },
  };
  await withServer(
    { summary: async () => ({ assets: 1 }) },
    async (root) => {
      const auth = await fetch(`${root}/_internal/owner-session`, {
        headers: { cookie: "immich_access_token=owner" },
      });
      assert.equal(auth.status, 204);
      assert.equal(
        auth.headers.get("x-cimmich-authenticated-principal"),
        principalId,
      );
      assert.equal(auth.headers.get("x-cimmich-owner-binding-state"), "owner");

      const missing = await fetch(`${root}/v1/summary`);
      assert.equal(missing.status, 403);
      assert.equal(
        (await missing.json()).code,
        "IMMICH_OWNER_SESSION_FORBIDDEN",
      );

      const summary = await fetch(`${root}/v1/summary`, {
        headers: {
          "x-cimmich-authenticated-principal": principalId,
          "x-cimmich-owner-binding-state": "owner",
        },
      });
      assert.equal(summary.status, 200);

      const missingOrigin = await fetch(
        `${root}/v1/onboarding/immich/connect`,
        {
          body: JSON.stringify({
            apiBaseUrl: "http://immich.test/api",
            commandId: "onboarding.owner-binding.test",
            credential: "synthetic-dedicated-key",
          }),
          headers: {
            "content-type": "application/json",
            "x-cimmich-authenticated-principal": principalId,
            "x-cimmich-owner-binding-state": "owner",
          },
          method: "POST",
        },
      );
      assert.equal(missingOrigin.status, 403);
      assert.equal(
        (await missingOrigin.json()).code,
        "IMMICH_OWNER_ORIGIN_REQUIRED",
      );

      const connected = await fetch(`${root}/v1/onboarding/immich/connect`, {
        body: JSON.stringify({
          apiBaseUrl: "http://immich.test/api",
          commandId: "onboarding.owner-binding.test",
          credential: "synthetic-dedicated-key",
        }),
        headers: {
          "content-type": "application/json",
          origin,
          "sec-fetch-site": "same-origin",
          "x-cimmich-actor": "owner-browser",
          "x-cimmich-authenticated-principal": principalId,
          "x-cimmich-owner-binding-state": "owner",
        },
        method: "POST",
      });
      assert.equal(connected.status, 200);
    },
    {
      allowedOrigins: new Set([origin]),
      immichOnboarding,
      immichOwnerSession,
      ownerGatewayRequired: true,
      surfacePolicy: "canonical",
    },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].authenticatedPrincipalId, principalId);
});

test("bootstrap owner sessions can reach setup only", async () => {
  const principalId = "33333333-3333-4333-8333-333333333333";
  await withServer(
    { summary: async () => ({ assets: 1 }) },
    async (root) => {
      const headers = {
        "x-cimmich-authenticated-principal": principalId,
        "x-cimmich-owner-binding-state": "bootstrap",
      };
      const setup = await fetch(`${root}/v1/onboarding/immich`, { headers });
      assert.equal(setup.status, 200);
      const ownerData = await fetch(`${root}/v1/summary`, { headers });
      assert.equal(ownerData.status, 403);
      assert.equal(
        (await ownerData.json()).code,
        "IMMICH_OWNER_SESSION_FORBIDDEN",
      );
    },
    {
      immichOnboarding: {
        status: async () => ({ connection: { state: "not_configured" } }),
      },
      immichOwnerSession: {
        authorize: async () => ({ principalId, state: "bootstrap" }),
      },
      ownerGatewayRequired: true,
      surfacePolicy: "canonical",
      visibility: {
        requireProjection: () => {},
        runRequest: (_request, _response, run) => run(),
      },
    },
  );
});

test("decision history is visibility-registered and bounded before projection", async () => {
  const calls = [];
  const repository = {
    decisionHistory: async (input) => {
      calls.push(["history", input]);
      return {
        items: [],
        projection: {
          scope: "current_viewing_mode",
          viewingMode: "standard",
        },
        schemaVersion: "cimmich.decision-history.v1",
      };
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
      const history = await response.json();
      assert.equal(history.schemaVersion, "cimmich.decision-history.v1");
      assert.deepEqual(history.projection, {
        scope: "current_viewing_mode",
        viewingMode: "standard",
      });
    },
    { visibility },
  );
  assert.deepEqual(calls, [
    ["visibility", "summary"],
    ["history", { limit: "25" }],
  ]);
});

test("Person connections are read before the generic Person route", async () => {
  const calls = [];
  const repository = {
    personConnections: async (input) => {
      calls.push(["connections", input]);
      return [{ targetId: "object-journal" }];
    },
  };
  const visibility = {
    requireProjection: (surface) => calls.push(["visibility", surface]),
    runRequest: (_request, _response, run) => run(),
  };
  await withServer(
    repository,
    async (root) => {
      const response = await fetch(`${root}/v1/people/person-maya/connections`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        items: [{ targetId: "object-journal" }],
        schemaVersion: "cimmich.person-connections.v1",
      });
    },
    { visibility },
  );
  assert.deepEqual(calls, [
    ["visibility", "people"],
    ["connections", { personId: "person-maya" }],
  ]);
});

test("Person evidence coverage is read before the generic Person route", async () => {
  const calls = [];
  const projection = {
    person: { displayName: "Maya", personId: "person-maya" },
    schemaVersion: "cimmich.person-evidence-coverage.v2",
  };
  const repository = {
    personEvidenceCoverage: async (input) => {
      calls.push(["evidence", input]);
      return projection;
    },
  };
  const visibility = {
    requireProjection: (surface) => calls.push(["visibility", surface]),
    runRequest: (_request, _response, run) => run(),
  };
  await withServer(
    repository,
    async (root) => {
      const response = await fetch(
        `${root}/v1/people/person-maya/evidence-coverage`,
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), projection);
    },
    { visibility },
  );
  assert.deepEqual(calls, [
    ["visibility", "people"],
    ["evidence", { personId: "person-maya" }],
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

test("Possible people reads a stored snapshot and starts work only on explicit Refresh", async () => {
  const calls = [];
  const repository = {
    possiblePeopleClassify: async (input) => {
      calls.push(["classify", input]);
      return {
        changed: true,
        run: { runId: "possible_run_1", state: "running" },
        schemaVersion: "cimmich.possible-people-snapshot.v1",
      };
    },
    possiblePeopleKnownSuggestions: async (input) => {
      calls.push(["known", input]);
      return {
        items: [],
        schemaVersion: "cimmich.known-person-cluster-suggestions.v2",
      };
    },
    possiblePeoplePreviews: async (input) => {
      calls.push(["previews", input]);
      return {
        items: input.clusterIds.map((clusterId) => ({
          clusterId,
          previews: [],
        })),
        runId: "possible_run_1",
        schemaVersion: "cimmich.possible-person-previews.v1",
      };
    },
    possiblePeopleRefresh: async (input) => {
      calls.push(["refresh", input]);
      return {
        changed: true,
        run: { runId: "possible_run_1", state: "queued" },
        schemaVersion: "cimmich.possible-people-snapshot.v1",
      };
    },
    possiblePeopleSnapshot: async () => {
      calls.push(["snapshot"]);
      return {
        activeRun: null,
        clusters: [],
        completedRun: null,
        schemaVersion: "cimmich.possible-people-snapshot.v1",
      };
    },
  };
  const visibility = {
    requireProjection: (surface) => calls.push(["visibility", surface]),
    runRequest: (_request, _response, run) => run(),
  };
  await withServer(
    repository,
    async (root) => {
      const snapshot = await fetch(`${root}/v1/possible-people`);
      assert.equal(snapshot.status, 200);
      assert.equal((await snapshot.json()).clusters.length, 0);
      assert.equal(
        calls.some(([kind]) => kind === "refresh"),
        false,
        "opening Possible people must not enqueue matching work",
      );

      const previews = await fetch(
        `${root}/v1/possible-people/previews?clusterId=cluster%2Fone&clusterId=cluster-two`,
      );
      assert.equal(previews.status, 200);
      assert.deepEqual(
        (await previews.json()).items.map((item) => item.clusterId),
        ["cluster/one", "cluster-two"],
      );

      const refreshed = await fetch(`${root}/v1/possible-people/refresh`, {
        body: JSON.stringify({ commandId: "possible-people-refresh-1" }),
        headers: {
          "content-type": "application/json",
          "x-cimmich-actor": "owner",
        },
        method: "POST",
      });
      assert.equal(refreshed.status, 202);

      const classified = await fetch(`${root}/v1/possible-people/classify`, {
        body: JSON.stringify({ commandId: "possible-people-classify-1" }),
        headers: {
          "content-type": "application/json",
          "x-cimmich-actor": "owner",
        },
        method: "POST",
      });
      assert.equal(classified.status, 202);

      const known = await fetch(
        `${root}/v1/people/person%2Fone/possible-clusters`,
      );
      assert.equal(known.status, 200);
      assert.deepEqual((await known.json()).items, []);
    },
    { visibility },
  );
  assert.deepEqual(calls, [
    ["visibility", "person_review"],
    ["snapshot"],
    ["visibility", "person_review"],
    ["previews", { clusterIds: ["cluster/one", "cluster-two"] }],
    ["visibility", "person_review"],
    ["refresh", { actorId: "owner", commandId: "possible-people-refresh-1" }],
    ["visibility", "person_review"],
    ["classify", { actorId: "owner", commandId: "possible-people-classify-1" }],
    ["visibility", "person_review"],
    ["known", { personId: "person/one" }],
  ]);
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
        assets: [
          {
            assetId: "asset-1",
            sourceAssetId: input.sourceAssetIds[0],
          },
        ],
        schemaVersion: "cimmich.visible-map-assets.v2",
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

test("shared photo presentation filtering keeps visibility ahead of media rendering", async () => {
  const calls = [];
  const visibility = {
    requireProjection: (surface) => calls.push(["visibility", surface]),
    runRequest: (_request, _response, run) => run(),
  };
  const repository = {
    filterPresentableAssetSourceIds: async (input) => {
      calls.push(["filter", input]);
      return {
        assets: [],
        schemaVersion: "cimmich.presentable-assets.v1",
        sourceAssetIds: [],
      };
    },
  };
  await withServer(
    repository,
    async (root) => {
      const sourceAssetIds = ["11111111-1111-4111-8111-111111111111"];
      const response = await fetch(`${root}/v1/visibility/assets/presentable`, {
        body: JSON.stringify({ sourceAssetIds }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        assets: [],
        schemaVersion: "cimmich.presentable-assets.v1",
        sourceAssetIds: [],
      });
    },
    { visibility },
  );
  assert.deepEqual(calls, [
    ["visibility", "map_assets"],
    ["filter", { sourceAssetIds: ["11111111-1111-4111-8111-111111111111"] }],
  ]);
});

test("satellite map tiles are same-origin, bounded and cacheable", async () => {
  const calls = [];
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const satelliteTileFetch = async (url, options) => {
    calls.push([url, Boolean(options?.signal), options?.redirect]);
    return new Response(bytes, {
      headers: { "content-type": "image/jpeg" },
      status: 200,
    });
  };
  await withServer(
    {},
    async (root) => {
      const response = await fetch(`${root}/v1/map/satellite/18/153563/242651`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "image/jpeg");
      assert.match(response.headers.get("cache-control"), /max-age=86400/);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);

      const invalid = await fetch(`${root}/v1/map/satellite/19/0/0`);
      assert.equal(invalid.status, 400);
      assert.equal(
        (await invalid.json()).code,
        "SATELLITE_TILE_COORDINATES_INVALID",
      );
    },
    { satelliteTileFetch },
  );
  assert.deepEqual(calls, [
    [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/18/153563/242651",
      true,
      "error",
    ],
  ]);
});

test("satellite map tiles remain timeout-bound while reading the response body", async () => {
  let requestSignal;
  const satelliteTileFetch = async (_url, options) => {
    requestSignal = options.signal;
    let bodyController;
    const body = new ReadableStream({
      start(controller) {
        bodyController = controller;
        controller.enqueue(new Uint8Array([0xff, 0xd8]));
      },
    });
    requestSignal.addEventListener(
      "abort",
      () => bodyController.error(new Error("provider body stalled")),
      { once: true },
    );
    return new Response(body, {
      headers: { "content-type": "image/jpeg" },
      status: 200,
    });
  };

  await withServer(
    {},
    async (root) => {
      const response = await fetch(`${root}/v1/map/satellite/1/0/0`);
      assert.equal(response.status, 502);
      assert.equal((await response.json()).code, "SATELLITE_TILE_UNAVAILABLE");
    },
    { satelliteTileFetch, satelliteTileTimeoutMs: 20 },
  );
  assert.equal(requestSignal.aborted, true);
});

test("satellite map tiles cancel an oversized chunked response before allocation", async () => {
  let cancelled = false;
  let chunk = 0;
  const satelliteTileFetch = async (_url, options) => {
    assert.equal(options.redirect, "error");
    return new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
        pull(controller) {
          chunk += 1;
          controller.enqueue(new Uint8Array(chunk <= 2 ? 1024 * 1024 : 1));
        },
      }),
      {
        headers: { "content-type": "image/png" },
        status: 200,
      },
    );
  };

  await withServer(
    {},
    async (root) => {
      const response = await fetch(`${root}/v1/map/satellite/1/0/0`);
      assert.equal(response.status, 502);
      assert.equal(
        (await response.json()).code,
        "SATELLITE_TILE_PAYLOAD_INVALID",
      );
    },
    { satelliteTileFetch },
  );
  assert.equal(cancelled, true);
});

test("zero-egress mode refuses address and satellite provider requests", async () => {
  const calls = [];
  await withServer(
    {},
    async (root) => {
      for (const path of [
        "/v1/geocoding/addresses?q=River%20Street&limit=5",
        "/v1/map/satellite/1/0/0",
      ]) {
        const response = await fetch(`${root}${path}`);
        assert.equal(response.status, 503);
        assert.equal((await response.json()).code, "OPTIONAL_EGRESS_DISABLED");
      }
    },
    {
      addressGeocoder: { search: async () => calls.push("address") },
      optionalEgressEnabled: false,
      satelliteTileFetch: async () => calls.push("satellite"),
    },
  );
  assert.deepEqual(calls, []);
});

test("stale GPS clients cannot create a Place before the mapping preflight", async () => {
  const calls = [];
  const repository = {
    createContextEntity: async (input) => {
      calls.push(input);
      return { status: "applied" };
    },
  };
  const body = {
    commandId: "context.gps-create.11111111-1111-4111-8111-111111111111",
    displayName: "Test GPS Place",
    geometry: { latitude: 1, longitude: 2 },
    placeRole: "location",
    typeKind: "point",
  };
  await withServer(repository, async (root) => {
    const stale = await fetch(`${root}/v1/places`, {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        "x-cimmich-actor": "context-reviewer",
      },
      method: "POST",
    });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).code, "GPS_CLIENT_REFRESH_REQUIRED");
    assert.equal(calls.length, 0);

    const current = await fetch(`${root}/v1/places`, {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        "x-cimmich-actor": "context-reviewer",
        "x-cimmich-gps-contract": "preflight-v2",
      },
      method: "POST",
    });
    assert.equal(current.status, 201);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].placeRole, "geography");
  });
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
        `${root}/v1/people/person-one/assets?pageSize=24&cursor=cursor-one&associationType=body&future=1`,
      );
      assert.deepEqual(await assets.json(), page);

      const neighbors = await fetch(
        `${root}/v1/people/person-one/assets?neighborOf=asset-one`,
      );
      assert.deepEqual(await neighbors.json(), { items: [] });

      const identity = await fetch(
        `${root}/v1/people/person-one/identity?pageSize=24&bucket=head`,
      );
      assert.deepEqual(await identity.json(), page);
    },
  );
  assert.deepEqual(calls, [
    [
      "assets",
      {
        associationType: null,
        cursor: "",
        limit: "5000",
        neighborOf: "",
        pageSize: null,
        personId: "person-one",
      },
    ],
    [
      "assets",
      {
        associationType: "body",
        cursor: "cursor-one",
        exploreFilters: {
          eventIds: [],
          futureDates: true,
          labelIds: [],
          placeIds: [],
          privacyTiers: [],
          thingIds: [],
        },
        limit: null,
        neighborOf: "",
        pageSize: "24",
        personId: "person-one",
      },
    ],
    [
      "assets",
      {
        associationType: null,
        cursor: "",
        limit: null,
        neighborOf: "asset-one",
        pageSize: null,
        personId: "person-one",
      },
    ],
    [
      "identity",
      {
        bucketKind: "head",
        cursor: "",
        limit: null,
        pageSize: "24",
        personId: "person-one",
      },
    ],
  ]);
});

test("Smart split recommendations are a visibility-scoped read with no identity command", async () => {
  const calls = [];
  const visibility = {
    requireProjection: (surface) => calls.push(["visibility", surface]),
    runRequest: (_request, _response, run) => run(),
  };
  await withServer(
    {
      smartSplitRecommendations: async (input) => {
        calls.push(["recommend", input]);
        return {
          automaticIdentityAuthority: "none",
          available: true,
          groups: [
            {
              faceIds: ["face-one"],
              groupId: "smart-unclear",
              kind: "unclear",
            },
          ],
          personId: input.personId,
          schemaVersion: "cimmich.smart-split-recommendations.v1",
        };
      },
    },
    async (root) => {
      const response = await fetch(
        `${root}/v1/people/person%2Fmixed/identity/split-recommendations`,
      );
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.automaticIdentityAuthority, "none");
      assert.equal(result.personId, "person/mixed");
    },
    { visibility },
  );
  assert.deepEqual(calls, [
    ["visibility", "person_review"],
    ["recommend", { personId: "person/mixed" }],
  ]);
});

test("Cimmich tag asset search routes multi-family intersections to the repository", async () => {
  const calls = [];
  const result = {
    items: [{ captureTime: null, sourceAssetId: "asset-one" }],
    nextCursor: null,
    pageSize: 120,
    schemaVersion: "cimmich.tag-assets.v1",
    total: 1,
  };
  await withServer(
    {
      tagAssets: async (input) => {
        calls.push(input);
        return result;
      },
    },
    async (root) => {
      const response = await fetch(`${root}/v1/tag-assets/search`, {
        body: JSON.stringify({
          pageSize: 120,
          tags: [
            { entityId: "person-one", family: "people" },
            { entityId: "event-one", family: "events" },
          ],
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), result);
    },
  );
  assert.deepEqual(calls, [
    {
      cursor: undefined,
      pageSize: 120,
      tags: [
        { entityId: "person-one", family: "people" },
        { entityId: "event-one", family: "events" },
      ],
    },
  ]);
});

test("Asset display exposes Cimmich recovery mapping for stale photo links", async () => {
  const calls = [];
  await withServer(
    {
      assetDisplay: async (input) => {
        calls.push(input);
        return {
          assetId: "asset-current",
          filename: "photo.jpg",
          schemaVersion: "cimmich.asset-display.v1",
          sourceAssetId: "source-current",
        };
      },
    },
    async (root) => {
      const response = await fetch(
        `${root}/v1/assets/display?sourceAssetId=source-stale`,
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        assetId: "asset-current",
        filename: "photo.jpg",
        schemaVersion: "cimmich.asset-display.v1",
        sourceAssetId: "source-current",
      });
    },
  );
  assert.deepEqual(calls, [{ sourceAssetId: "source-stale" }]);
});

test("Head rescan route preserves Person scope and operator authority", async () => {
  const calls = [];
  const result = {
    evaluatedCount: 4,
    items: [],
    maintenancePending: false,
    movedCount: 0,
    retainedCount: 4,
    schemaVersion: "cimmich.head-rescan.v1",
    tierCounts: { lq: 0, prime: 0, secondary: 0 },
    totalCount: 4,
  };
  await withServer(
    {
      rescanHeadEvidence: async (input) => {
        calls.push(input);
        return result;
      },
    },
    async (root) => {
      const response = await fetch(
        `${root}/v1/people/person%2Fone/identity/head:rescan`,
        {
          headers: { "x-cimmich-actor": "head-reviewer" },
          method: "POST",
        },
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), result);
    },
  );
  assert.deepEqual(calls, [
    { actorId: "head-reviewer", personId: "person/one" },
  ]);
});

test("Person presentation routes preserve slot, evidence and framing", async () => {
  const calls = [];
  const presentation = {
    body: null,
    face: {
      assetId: "asset-one",
      crop: { h: 0.5, w: 0.5, x: 0.25, y: 0.2 },
      observationId: "face-one",
      observationKind: "face",
      slotKind: "face",
    },
    hero: null,
    personId: "person-one",
    schemaVersion: "cimmich.person-presentation-media.v1",
  };
  await withServer(
    {
      personPresentation: async (input) => {
        calls.push(["get", input]);
        return presentation;
      },
      setPersonPresentation: async (input) => {
        calls.push(["set", input]);
        return presentation;
      },
    },
    async (root) => {
      const current = await fetch(`${root}/v1/people/person-one/presentation`);
      assert.equal(current.status, 200);
      assert.deepEqual(await current.json(), presentation);

      const updated = await fetch(
        `${root}/v1/people/person-one/presentation/face`,
        {
          body: JSON.stringify({
            assetId: "asset-one",
            crop: { h: 0.5, w: 0.5, x: 0.25, y: 0.2 },
            observationId: "face-one",
            observationKind: "face",
          }),
          headers: {
            "content-type": "application/json",
            "x-cimmich-actor": "tester",
          },
          method: "POST",
        },
      );
      assert.equal(updated.status, 200);
      assert.deepEqual(await updated.json(), presentation);
    },
  );
  assert.deepEqual(calls, [
    ["get", { personId: "person-one" }],
    [
      "set",
      {
        actorId: "tester",
        assetId: "asset-one",
        crop: { h: 0.5, w: 0.5, x: 0.25, y: 0.2 },
        observationId: "face-one",
        observationKind: "face",
        personId: "person-one",
        slotKind: "face",
      },
    ],
  ]);
});

test("Pet presentation routes preserve independent profile and hero slots", async () => {
  const calls = [];
  const presentation = {
    body: null,
    face: null,
    hero: {
      assetId: "asset-pet",
      crop: { h: 0.4, w: 1, x: 0, y: 0.3 },
      observationId: "face-pet",
      observationKind: "face",
      slotKind: "hero",
    },
    personId: "pet-one",
    schemaVersion: "cimmich.person-presentation-media.v1",
  };
  await withServer(
    {
      petPresentation: async (input) => {
        calls.push(["get", input]);
        return presentation;
      },
      setPetPresentation: async (input) => {
        calls.push(["set", input]);
        return presentation;
      },
    },
    async (root) => {
      const current = await fetch(`${root}/v1/pets/pet-one/presentation`);
      assert.equal(current.status, 200);
      assert.deepEqual(await current.json(), presentation);

      const updated = await fetch(`${root}/v1/pets/pet-one/presentation/hero`, {
        body: JSON.stringify({
          assetId: "asset-pet",
          crop: { h: 0.4, w: 1, x: 0, y: 0.3 },
          observationId: "face-pet",
          observationKind: "face",
        }),
        headers: {
          "content-type": "application/json",
          "x-cimmich-actor": "tester",
        },
        method: "POST",
      });
      assert.equal(updated.status, 200);
      assert.deepEqual(await updated.json(), presentation);
    },
  );
  assert.deepEqual(calls, [
    ["get", { petId: "pet-one" }],
    [
      "set",
      {
        actorId: "tester",
        assetId: "asset-pet",
        crop: { h: 0.4, w: 1, x: 0, y: 0.3 },
        observationId: "face-pet",
        observationKind: "face",
        petId: "pet-one",
        slotKind: "hero",
      },
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

test("Face match batch route compares competing regions without identity authority", async () => {
  const calls = [];
  const result = {
    automaticIdentityAuthority: "none",
    bulkAutomationAuthority: "none",
    items: [
      {
        faceId: "face-one",
        matches: [{ display_name: "Aga", person_id: "aga", similarity: 0.6 }],
      },
      {
        faceId: "face-two",
        matches: [
          { display_name: "Pete", person_id: "pete", similarity: 0.55 },
        ],
      },
    ],
    limitPerFace: 5,
    recommendationAuthority: "none",
    requestedCount: 2,
    reviewOnly: true,
    schemaVersion: "cimmich.face-owner-review-comparisons-batch.v1",
  };
  await withServer(
    {
      faceReviewComparisonsBatch: async (input) => {
        calls.push(input);
        return result;
      },
    },
    async (root) => {
      const response = await fetch(`${root}/v1/faces/matches:batch`, {
        body: JSON.stringify({
          faceIds: ["face-one", "face-two"],
          limitPerFace: 5,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), result);
    },
  );
  assert.deepEqual(calls, [
    { faceIds: ["face-one", "face-two"], limitPerFace: 5 },
  ]);
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
  const projections = [];
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
    {
      visibility: {
        requireProjection: (surface) => projections.push(surface),
        runRequest: (_request, _response, run) => run(),
      },
    },
  );
  assert.deepEqual(projections, ["people"]);
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
    ["people", { includePresentation: true, limit: "20", query: "Person" }],
  ]);
});

test("People collection lets list consumers opt out of presentation media", async () => {
  const calls = [];
  await withServer(
    {
      people: async (input) => {
        calls.push(["people", input]);
        return [];
      },
    },
    async (root) => {
      const response = await fetch(`${root}/v1/people?limit=20&presentation=0`);
      assert.equal(response.status, 200);
    },
    {
      visibility: {
        requireProjection: () => {},
        runRequest: (_request, _response, run) => run(),
      },
    },
  );
  assert.deepEqual(calls, [
    ["people", { includePresentation: false, limit: "20", query: null }],
  ]);
});

test("Explore facets preserve exact typed filters and visibility scope", async () => {
  const calls = [];
  const projection = {
    facets: { events: [], labels: [], places: [], privacy: [], things: [] },
    people: [],
    schemaVersion: "cimmich.explore-facets.v1",
    totalAssets: 0,
  };
  await withServer(
    {
      exploreFacets: async (input) => {
        calls.push(["explore", input]);
        return projection;
      },
    },
    async (root) => {
      const response = await fetch(`${root}/v1/explore/facets`, {
        body: JSON.stringify({
          filters: {
            eventIds: ["event-one"],
            labelIds: ["label-one"],
            privacyTiers: ["private"],
          },
          scope: { kind: "person", personId: "person-one" },
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), projection);
    },
    {
      visibility: {
        requireProjection: (surface) => calls.push(["visibility", surface]),
        runRequest: (_request, _response, run) => run(),
      },
    },
  );
  assert.deepEqual(calls, [
    ["visibility", "person_assets"],
    [
      "explore",
      {
        filters: {
          eventIds: ["event-one"],
          labelIds: ["label-one"],
          privacyTiers: ["private"],
        },
        scope: { kind: "person", personId: "person-one" },
      },
    ],
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

test("XMP name review lists and resolves only behind People visibility", async () => {
  const calls = [];
  const visibility = {
    requireProjection: (surface) => calls.push(["visibility", surface]),
    runRequest: (_request, _response, run) => run(),
  };
  await withServer(
    {
      resolveXmpUnresolvedName: async (input) => {
        calls.push(["resolve", input]);
        return {
          resolvedFaceCount: 12,
          schemaVersion: "cimmich.xmp-sidecar-name-review.v1",
        };
      },
      xmpUnresolvedNames: async (input) => {
        calls.push(["list", input]);
        return {
          items: [],
          remainingGroupCount: 224,
          schemaVersion: "cimmich.xmp-sidecar-name-review.v1",
        };
      },
    },
    async (root) => {
      const list = await fetch(
        `${root}/v1/xmp-sidecar/unresolved-names?limit=24`,
      );
      assert.equal(list.status, 200);
      assert.equal((await list.json()).remainingGroupCount, 224);

      const resolve = await fetch(
        `${root}/v1/xmp-sidecar/unresolved-names/xmp_name_${"a".repeat(64)}/resolve`,
        {
          body: JSON.stringify({
            commandId: "xmp-owner-resolution-browser-001",
            personId: "person_target",
          }),
          headers: {
            "content-type": "application/json",
            "x-cimmich-actor": "person-editor",
          },
          method: "POST",
        },
      );
      assert.equal(resolve.status, 200);
      assert.equal((await resolve.json()).resolvedFaceCount, 12);
    },
    { visibility },
  );
  assert.deepEqual(calls, [
    ["visibility", "people"],
    ["list", { limit: "24" }],
    ["visibility", "people"],
    [
      "resolve",
      {
        actorId: "person-editor",
        commandId: "xmp-owner-resolution-browser-001",
        groupId: `xmp_name_${"a".repeat(64)}`,
        personId: "person_target",
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
            displayName: "Weekly walk",
            recurrence: { frequency: "weekly", interval: 1, weekdays: [1] },
            typeKind: "activity",
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
              sortOrder: 0,
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
  assert.deepEqual(calls[3][1].recurrence, {
    frequency: "weekly",
    interval: 1,
    weekdays: [1],
  });
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
  assert.equal(calls[8][1].relations[0].sortOrder, 0);
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
      machineSuggestions: async ({ leadPersonId, limit }) => {
        calls.push(["machine", limit, leadPersonId]);
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
      assert.deepEqual(calls, [["machine", "7", null]]);

      const personSuggestions = await fetch(
        `${root}/v1/review/machine-suggestions?limit=9&leadPersonId=person%2Fone`,
      );
      assert.equal(personSuggestions.status, 200);
      assert.deepEqual(await personSuggestions.json(), {
        items: [{ face_id: "face-one" }],
      });
      assert.deepEqual(calls, [
        ["machine", "7", null],
        ["machine", "9", "person/one"],
      ]);

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

test("Archive integrity exposes only bounded read-only exact duplicate groups", async () => {
  const calls = [];
  const result = {
    groups: [],
    limit: 12,
    nextOffset: null,
    offset: 24,
    schemaVersion: "cimmich.archive-integrity.v1",
    summary: {
      copiesInGroups: 131,
      duplicateGroups: 65,
      reclaimableBytes: 1024,
      redundantCopies: 66,
    },
  };
  await withServer(
    {
      exactDuplicates: async (input) => {
        calls.push(input);
        return result;
      },
    },
    async (root) => {
      const response = await fetch(
        `${root}/v1/archive-integrity/exact-duplicates?limit=12&offset=24`,
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), result);
    },
  );
  assert.deepEqual(calls, [{ limit: "12", offset: "24" }]);
});

test("Archive integrity reads bounded source evidence without mutation", async () => {
  const calls = [];
  const result = {
    items: [],
    schemaVersion: "cimmich.archive-integrity.v1",
  };
  await withServer(
    {
      archiveIntegritySourceEvidence: async (input) => {
        calls.push(input);
        return result;
      },
    },
    async (root) => {
      const response = await fetch(
        `${root}/v1/archive-integrity/source-evidence?sourceAssetIds=one%2Ctwo`,
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), result);
    },
  );
  assert.deepEqual(calls, [{ sourceAssetIds: "one,two" }]);
});

test("Archive integrity exposes read-only independent-backup readiness", async () => {
  const calls = [];
  const result = {
    items: [],
    schemaVersion: "cimmich.archive-backup-proof.v1",
    summary: { independentlyProtectedItems: 0, unprovenItems: 119860 },
  };
  await withServer(
    {
      archiveIntegrityBackupProof: async (input) => {
        calls.push(input);
        return result;
      },
    },
    async (root) => {
      const response = await fetch(
        `${root}/v1/archive-integrity/backup-proof?sourceAssetIds=one%2Ctwo`,
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), result);
    },
  );
  assert.deepEqual(calls, [{ sourceAssetIds: "one,two" }]);
});

test("full identity audit routes expose background status, bounded queues and explicit dismissal", async () => {
  const calls = [];
  const run = {
    auditRunId: "audit-one",
    schemaVersion: "cimmich.identity-audit.v2",
    state: "completed",
  };
  await withServer(
    {
      dismissIdentityAuditItem: async (input) => {
        calls.push(["dismiss", input]);
        return {
          changed: true,
          faceId: input.faceId,
          kind: input.kind,
          schemaVersion: "cimmich.identity-audit.v2",
          state: "dismissed",
        };
      },
      identityAuditItems: async (input) => {
        calls.push(["items", input]);
        return {
          hasMore: false,
          items: [{ faceId: "face/one" }],
          kind: input.kind,
          limit: 20,
          offset: 40,
          run,
          schemaVersion: "cimmich.identity-audit.v2",
          total: 1,
        };
      },
      identityAuditLeads: async () => {
        calls.push(["leads"]);
        return {
          items: [
            {
              displayName: "Maya Chen",
              personId: "person.maya",
              suggestionCount: 4,
            },
          ],
          run,
          schemaVersion: "cimmich.identity-audit.v2",
          total: 1,
        };
      },
      identityAuditLatest: async () => {
        calls.push(["latest"]);
        return run;
      },
      startIdentityAudit: async (input) => {
        calls.push(["start", input]);
        return { ...run, state: "running" };
      },
    },
    async (root) => {
      const status = await fetch(`${root}/v1/review/identity-audit`);
      assert.equal(status.status, 200);
      assert.deepEqual(await status.json(), { run });

      const started = await fetch(`${root}/v1/review/identity-audit`, {
        headers: { "x-cimmich-actor": "synthetic-owner" },
        method: "POST",
      });
      assert.equal(started.status, 202);
      assert.equal((await started.json()).run.state, "running");

      const leads = await fetch(`${root}/v1/review/identity-audit/leads`);
      assert.equal(leads.status, 200);
      assert.deepEqual((await leads.json()).items, [
        {
          displayName: "Maya Chen",
          personId: "person.maya",
          suggestionCount: 4,
        },
      ]);

      const page = await fetch(
        `${root}/v1/review/identity-audit/items?kind=accepted_contradiction&limit=20&offset=40&personId=person.one`,
      );
      assert.equal(page.status, 200);
      assert.equal((await page.json()).items[0].faceId, "face/one");

      const dismissed = await fetch(
        `${root}/v1/review/identity-audit/items/accepted_contradiction/face%2Fone/dismiss`,
        {
          headers: { "x-cimmich-actor": "synthetic-owner" },
          method: "POST",
        },
      );
      assert.equal(dismissed.status, 200);
      assert.equal((await dismissed.json()).state, "dismissed");
    },
  );
  assert.deepEqual(calls, [
    ["latest"],
    ["start", { actorId: "synthetic-owner" }],
    ["leads"],
    [
      "items",
      {
        kind: "accepted_contradiction",
        limit: "20",
        offset: "40",
        personId: "person.one",
      },
    ],
    [
      "dismiss",
      {
        actorId: "synthetic-owner",
        faceId: "face/one",
        kind: "accepted_contradiction",
      },
    ],
  ]);
});

test("People candidate summary exposes evaluated SourcePack review claims without identity-audit routing", async () => {
  const calls = [];
  const summary = {
    items: [
      {
        assetCount: 3,
        bestMargin: 0.42,
        bestScore: 0.81,
        displayName: "Maya Chen",
        personId: "person.maya",
        suggestionCount: 4,
      },
    ],
    schemaVersion: "cimmich.person-candidate-summary.v2",
    totalCandidates: 4,
    totalPeople: 1,
  };
  await withServer(
    {
      personCandidateSummary: async () => {
        calls.push("summary");
        return summary;
      },
    },
    async (root) => {
      const response = await fetch(`${root}/v1/people/candidate-summary`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), summary);
    },
  );
  assert.deepEqual(calls, ["summary"]);
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

test("the Guided listener cannot shed authority by omitting its surface header", async () => {
  const accessToken = "guided-listener-token-0123456789abcdef";
  const repository = {
    summary: async () => ({ assets: 6, people: 1 }),
  };
  const guidedAccess = createGuidedAccess({
    accessToken,
    authority: "read",
    enabled: true,
    repository,
    visibilityCeiling: "standard",
  });
  const visibility = {
    requireProjection: () => {},
    runRequest: (_request, _response, run) => run(),
    status: () => ({ viewingMode: "standard" }),
  };
  await withServer(
    repository,
    async (root) => {
      const escaped = await fetch(`${root}/v1/summary`);
      assert.equal(escaped.status, 403);
      assert.equal((await escaped.json()).code, "GUIDED_SURFACE_REQUIRED");

      const bounded = await fetch(`${root}/v1/summary`, {
        headers: {
          authorization: `Bearer ${accessToken}`,
          "x-cimmich-surface": "guided",
        },
      });
      assert.equal(bounded.status, 200);
    },
    { guidedAccess, surfacePolicy: "guided", visibility },
  );
});

test("the owner listener does not expose Guided routes", async () => {
  const accessToken = "guided-owner-separation-0123456789abcdef";
  const guidedAccess = createGuidedAccess({
    accessToken,
    authority: "read",
    enabled: true,
    repository: {},
    visibilityCeiling: "standard",
  });
  await withServer(
    {},
    async (root) => {
      const response = await fetch(`${root}/v1/guided/v1/capabilities`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      assert.equal(response.status, 404);
      assert.equal((await response.json()).code, "GUIDED_LISTENER_REQUIRED");
    },
    { guidedAccess, surfacePolicy: "canonical" },
  );
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
      deferredFaceReviews: async (input) => {
        calls.push(["deferred", input]);
        return {
          items: [],
          limit: 100,
          schemaVersion: "cimmich.deferred-face-review.v1",
          total: 0,
        };
      },
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
            reviewReason: "geometry",
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

      const deferred = await fetch(
        `${root}/v1/review/faces/deferred?limit=100`,
      );
      assert.equal(deferred.status, 200);
      assert.equal(
        (await deferred.json()).schemaVersion,
        "cimmich.deferred-face-review.v1",
      );

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
        reviewReason: "geometry",
      },
    ],
    ["deferred", { limit: "100" }],
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
  assert.deepEqual(surfaces, [
    "asset_evidence",
    "asset_evidence",
    "asset_evidence",
  ]);
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

test("browser preflight permits every method the UI actually uses", async () => {
  // Regression guard: turning the Private filter off is a DELETE. curl does not
  // preflight, so a missing method here fails only in a real browser, where the
  // rejected preflight surfaces as an opaque "service is unavailable".
  const origin = "http://127.0.0.1:3000";
  await withServer(
    {},
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/visibility/credential`, {
        headers: {
          "access-control-request-method": "DELETE",
          origin,
        },
        method: "OPTIONS",
      });
      assert.equal(response.status, 204);
      const allowed = new Set(
        (response.headers.get("access-control-allow-methods") || "")
          .split(",")
          .map((value) => value.trim()),
      );
      for (const method of ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]) {
        assert.ok(allowed.has(method), `${method} must survive preflight`);
      }
    },
    { allowedOrigins: new Set([origin]) },
  );
});

test("Pet matching routes require the enforced Pets visibility projection", async () => {
  const calls = [];
  const repository = {
    petMatchUnknown: async (input) => {
      calls.push(["unknown", input]);
      return { items: [], schemaVersion: "cimmich.pet-matching.v1" };
    },
  };
  const visibility = {
    requireProjection: (surface) => calls.push(["visibility", surface]),
    runRequest: (_request, _response, run) => run(),
  };
  await withServer(
    repository,
    async (root) => {
      const response = await fetch(`${root}/v1/pets/matching/unknown?limit=10`);
      assert.equal(response.status, 200);
      assert.equal(
        (await response.json()).schemaVersion,
        "cimmich.pet-matching.v1",
      );
    },
    { visibility },
  );
  assert.deepEqual(calls, [
    ["visibility", "pets"],
    ["unknown", { limit: "10" }],
  ]);
});

test("mutations clear People and Explore snapshots; reads and failures keep them", async () => {
  let peopleClears = 0;
  let exploreClears = 0;
  const repository = {
    clearPeopleHotSnapshot: () => {
      peopleClears += 1;
    },
    clearExploreFacetSnapshot: () => {
      exploreClears += 1;
    },
    createPerson: async (input) => {
      if (!input.newPersonName) {
        throw Object.assign(new Error("Person name is required"), {
          statusCode: 400,
        });
      }
      return { personId: "person-new" };
    },
    people: async () => [],
    exploreFacets: async () => ({
      facets: { events: [], labels: [], places: [], privacy: [], things: [] },
      filters: {},
      people: [],
      schemaVersion: "cimmich.explore-facets.v1",
      scope: { kind: "people" },
      totalAssets: 0,
    }),
  };
  const visibility = {
    requireProjection: () => {},
    runRequest: (_request, _response, run) => run(),
  };
  await withServer(
    repository,
    async (root) => {
      const read = await fetch(`${root}/v1/people`);
      assert.equal(read.status, 200);
      assert.equal(peopleClears, 0);
      assert.equal(exploreClears, 0);

      const exploreRead = await fetch(`${root}/v1/explore/facets`, {
        body: JSON.stringify({ scope: { kind: "people" } }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      assert.equal(exploreRead.status, 200);
      assert.equal(peopleClears, 0);
      assert.equal(exploreClears, 0);

      const failed = await fetch(`${root}/v1/people`, {
        body: JSON.stringify({ commandId: "cmd-1" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      assert.equal(failed.status, 400);
      assert.equal(peopleClears, 0);
      assert.equal(exploreClears, 0);

      const created = await fetch(`${root}/v1/people`, {
        body: JSON.stringify({ commandId: "cmd-2", newPersonName: "Ann" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      assert.equal(created.status, 201);
      // The finish event fires after the response is fully flushed.
      for (let attempt = 0; attempt < 100 && peopleClears === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      assert.equal(peopleClears, 1);
      assert.equal(exploreClears, 1);
    },
    { visibility },
  );
});
