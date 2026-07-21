import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createImmichCompanion } from "../src/immich-companion.mjs";

const asset = {
  checksum: "c3ludGhldGljLWltbWljaA==",
  createdAt: "2026-01-01T00:00:00.000Z",
  duration: null,
  exifInfo: { city: "must-not-project" },
  fileCreatedAt: "2025-12-31T23:59:00.000Z",
  fileModifiedAt: "2026-01-01T00:00:00.000Z",
  height: 3000,
  id: "11111111-1111-4111-8111-111111111111",
  isArchived: false,
  isFavorite: false,
  isOffline: false,
  isTrashed: false,
  localDateTime: "2026-01-01T10:59:00.000Z",
  originalFileName: "synthetic.jpg",
  originalMimeType: "image/jpeg",
  originalPath: "/must/not/project/synthetic.jpg",
  ownerId: "22222222-2222-4222-8222-222222222222",
  people: [{ name: "must-not-project" }],
  tags: [{ name: "must-not-project" }],
  type: "IMAGE",
  updatedAt: "2026-01-02T00:00:00.000Z",
  visibility: "timeline",
  width: 4000,
};

const requests = [];
const upstream = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  requests.push({
    method: request.method,
    path: request.url,
    apiKey: request.headers["x-api-key"] || "",
    body: body ? JSON.parse(body) : null,
  });

  response.setHeader("content-type", "application/json");
  if (request.url === "/api/server/version") {
    response.end(
      JSON.stringify({ major: 3, minor: 0, patch: 3, prerelease: null }),
    );
    return;
  }
  if (request.headers["x-api-key"] !== "synthetic-companion-key") {
    response.statusCode = 401;
    response.end(JSON.stringify({ error: "private upstream auth detail" }));
    return;
  }
  if (request.url === "/api/users/me") {
    response.end(
      JSON.stringify({
        id: "22222222-2222-4222-8222-222222222222",
        isAdmin: false,
        email: "must-not-project@example.test",
      }),
    );
    return;
  }
  if (request.url === `/api/assets/${asset.id}`) {
    response.end(JSON.stringify(asset));
    return;
  }
  if (request.url === "/api/search/metadata") {
    response.end(
      JSON.stringify({
        albums: { items: [], total: 0 },
        assets: {
          count: 1,
          facets: [],
          items: [asset],
          nextPage: null,
          total: 1,
        },
      }),
    );
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: "not found" }));
});

await new Promise((resolve, reject) => {
  upstream.once("error", reject);
  upstream.listen(0, "127.0.0.1", resolve);
});

try {
  const address = upstream.address();
  const companion = createImmichCompanion({
    apiBaseUrl: `http://127.0.0.1:${address.port}`,
    apiKey: "synthetic-companion-key",
  });

  const status = await companion.status();
  assert.equal(status.state, "ready");
  assert.equal(status.immichVersion, "3.0.3");
  assert.equal(JSON.stringify(status).includes("@example.test"), false);

  const exact = await companion.getAsset({ assetId: asset.id });
  assert.equal(exact.asset.immichAssetId, asset.id);
  assert.equal(exact.asset.inputRevision.length, 64);
  assert.equal(JSON.stringify(exact).includes("/must/not/project"), false);
  assert.equal(JSON.stringify(exact).includes("must-not-project"), false);

  const page = await companion.listAssets({
    limit: 25,
    visibility: "timeline",
  });
  assert.equal(page.items.length, 1);
  assert.equal(page.nextCursor, null);

  const searchRequest = requests.find(
    (request) => request.path === "/api/search/metadata",
  );
  assert.deepEqual(searchRequest.body, {
    order: "asc",
    page: 1,
    size: 25,
    visibility: "timeline",
    withDeleted: false,
    withExif: false,
    withPeople: false,
    withStacked: false,
  });
  assert.equal(
    requests.find((request) => request.path === "/api/server/version").apiKey,
    "",
  );
  assert.equal(
    requests
      .filter((request) => request.path !== "/api/server/version")
      .every((request) => request.apiKey === "synthetic-companion-key"),
    true,
  );
} finally {
  await new Promise((resolve) => upstream.close(resolve));
}

console.log("Immich companion synthetic journey: PASS");
