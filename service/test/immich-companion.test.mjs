import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  IMMICH_COMPANION_SCHEMA_VERSION,
  createImmichCompanion,
  normalizeImmichApiBaseUrl,
  projectImmichAsset,
  projectImmichFace,
  projectImmichPerson,
} from "../src/immich-companion.mjs";

const asset = (overrides = {}) => ({
  checksum: "c3ludGhldGljLWNoZWNrc3Vt",
  createdAt: "2026-01-01T00:00:00.000Z",
  duration: null,
  exifInfo: { city: "Private upstream field" },
  fileCreatedAt: "2025-12-31T23:59:00.000Z",
  fileModifiedAt: "2026-01-01T00:00:00.000Z",
  height: 3000,
  id: "11111111-1111-4111-8111-111111111111",
  isArchived: false,
  isFavorite: true,
  isOffline: false,
  isTrashed: false,
  localDateTime: "2026-01-01T10:59:00.000Z",
  originalFileName: "synthetic.jpg",
  originalMimeType: "image/jpeg",
  originalPath: "/private/upstream/path/synthetic.jpg",
  owner: { email: "private@example.test", name: "Private" },
  ownerId: "22222222-2222-4222-8222-222222222222",
  people: [{ name: "Private Person" }],
  tags: [{ name: "Private Tag" }],
  type: "IMAGE",
  updatedAt: "2026-01-02T00:00:00.000Z",
  visibility: "timeline",
  width: 4000,
  ...overrides,
});

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const readyFetch =
  (calls, assets = [asset()]) =>
  async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/server/version")) {
      return jsonResponse({ major: 3, minor: 0, patch: 3, prerelease: null });
    }
    if (url.endsWith("/users/me")) {
      return jsonResponse({
        email: "private@example.test",
        id: "22222222-2222-4222-8222-222222222222",
        isAdmin: false,
        name: "Private User",
      });
    }
    if (url.endsWith("/search/metadata")) {
      return jsonResponse({
        albums: { items: [], total: 0 },
        assets: {
          count: assets.length,
          facets: [],
          items: assets,
          nextPage: "2",
          total: assets.length,
        },
      });
    }
    if (url.includes("/people?")) {
      return jsonResponse({
        hasNextPage: false,
        hidden: 0,
        people: [
          {
            birthDate: null,
            id: "33333333-3333-4333-8333-333333333333",
            isFavorite: false,
            isHidden: false,
            name: "Audit Fresh Person",
            updatedAt: "2026-07-19T00:00:00.000Z",
          },
        ],
        total: 1,
      });
    }
    if (url.includes("/faces?")) {
      return jsonResponse([
        {
          boundingBoxX1: 100,
          boundingBoxX2: 300,
          boundingBoxY1: 50,
          boundingBoxY2: 250,
          id: "face-source-1",
          imageHeight: 1000,
          imageWidth: 2000,
          person: {
            birthDate: null,
            id: "33333333-3333-4333-8333-333333333333",
            isFavorite: false,
            isHidden: false,
            name: "Audit Fresh Person",
            updatedAt: "2026-07-19T00:00:00.000Z",
          },
          sourceType: "machine-learning",
        },
      ]);
    }
    if (url.includes("/people/")) {
      return jsonResponse({
        birthDate: null,
        id: "33333333-3333-4333-8333-333333333333",
        isFavorite: false,
        isHidden: false,
        name: "Audit Fresh Person",
        thumbnailPath: "private/upstream/path",
        updatedAt: "2026-07-19T00:00:00.000Z",
      });
    }
    if (url.includes("/assets/")) return jsonResponse(assets[0]);
    return jsonResponse({}, 404);
  };

test("Immich API roots normalize without accepting embedded credentials or private paths", () => {
  assert.equal(
    normalizeImmichApiBaseUrl("http://immich:2283"),
    "http://immich:2283/api",
  );
  assert.equal(
    normalizeImmichApiBaseUrl("https://photos.example.test/api/"),
    "https://photos.example.test/api",
  );
  assert.throws(
    () => normalizeImmichApiBaseUrl("https://user:secret@example.test/api"),
    (error) => error.code === "IMMICH_COMPANION_CONFIG_INVALID",
  );
  assert.throws(
    () => normalizeImmichApiBaseUrl("https://example.test/private/api"),
    (error) => error.code === "IMMICH_COMPANION_CONFIG_INVALID",
  );
});

test("an unconfigured companion is healthy-but-disabled and fails asset reads closed", async () => {
  const companion = createImmichCompanion();
  assert.deepEqual(await companion.status(), {
    schemaVersion: IMMICH_COMPANION_SCHEMA_VERSION,
    supportedRange: "=3.0.3",
    readOnly: true,
    databaseIsolation: "separate",
    state: "not_configured",
    permissionVerification: "not_performed",
    capabilities: {
      assetRead: false,
      assetSearch: false,
      mediaRead: false,
      faceRead: false,
      personList: false,
      personRead: false,
    },
  });
  await assert.rejects(
    companion.getAsset({ assetId: "synthetic" }),
    (error) =>
      error.code === "IMMICH_COMPANION_NOT_CONFIGURED" &&
      error.statusCode === 503,
  );
});

test("exact Person reads expose only bounded identity projection and deterministic source revision", async () => {
  const calls = [];
  const companion = createImmichCompanion({
    apiBaseUrl: "http://immich.test",
    apiKey: "synthetic-secret-key",
    fetchImpl: readyFetch(calls),
  });
  const result = await companion.getPerson({
    personId: "33333333-3333-4333-8333-333333333333",
  });
  assert.equal(result.person.id, "33333333-3333-4333-8333-333333333333");
  assert.equal(result.person.name, "Audit Fresh Person");
  assert.match(result.person.sourceRevision, /^[0-9a-f]{64}$/);
  assert.equal("thumbnailPath" in result.person, false);
  assert.equal(JSON.stringify(result).includes("private/upstream"), false);
  assert.equal(
    result.person.sourceRevision,
    projectImmichPerson({
      birthDate: null,
      id: "33333333-3333-4333-8333-333333333333",
      isFavorite: false,
      isHidden: false,
      name: "Audit Fresh Person",
      thumbnailPath: "different/private/path",
      updatedAt: "2026-07-19T00:00:00.000Z",
    }).sourceRevision,
  );
  assert.match(calls.at(-1).url, /\/api\/people\/33333333/);
});

test("an upstream Person grouping without a label remains anonymous source topology", () => {
  const person = projectImmichPerson({
    id: "44444444-4444-4444-8444-444444444444",
    isHidden: false,
    name: "",
    updatedAt: "2026-07-19T00:00:00.000Z",
  });
  assert.equal(person.name, null);
  assert.match(person.sourceRevision, /^[0-9a-f]{64}$/);
});

test("People and assigned Face discovery is geometry-bounded and path-free", async () => {
  const calls = [];
  const companion = createImmichCompanion({
    apiBaseUrl: "http://immich.test",
    apiKey: "synthetic-secret-key",
    fetchImpl: readyFetch(calls),
  });
  const people = await companion.listPeople({ limit: 100 });
  const faces = await companion.listAssetFaces({ assetId: asset().id });
  assert.equal(people.total, 1);
  assert.equal(faces.items.length, 1);
  assert.deepEqual(faces.items[0].box, {
    h: 0.2,
    w: 0.1,
    x: 0.05,
    y: 0.05,
  });
  assert.equal(faces.items[0].person.name, "Audit Fresh Person");
  assert.match(faces.items[0].sourceRevision, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(faces).includes("thumbnailPath"), false);
  assert.throws(
    () =>
      projectImmichFace({
        boundingBoxX1: 100,
        boundingBoxX2: 99,
        boundingBoxY1: 0,
        boundingBoxY2: 10,
        id: "bad-face",
        imageHeight: 100,
        imageWidth: 100,
      }),
    (error) => error.code === "IMMICH_COMPANION_PROTOCOL_INVALID",
  );
});

test("status gates the exact release-certified version before sending the API key", async () => {
  const calls = [];
  const companion = createImmichCompanion({
    apiBaseUrl: "http://immich.test",
    apiKey: "synthetic-secret-key",
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return jsonResponse({ major: 3, minor: 0, patch: 2, prerelease: null });
    },
  });
  const status = await companion.status();
  assert.equal(status.state, "incompatible");
  assert.equal(status.code, "IMMICH_COMPANION_VERSION_UNSUPPORTED");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers["x-api-key"], undefined);
});

test("the Immich adapter permits only its exact read-only route and method allowlist", async () => {
  const calls = [];
  const companion = createImmichCompanion({
    apiBaseUrl: "http://immich.test",
    apiKey: "synthetic-secret-key",
    fetchImpl: readyFetch(calls),
  });
  await companion.status();
  await companion.listAssets({ visibility: "timeline" });
  assert.deepEqual(
    calls.map(({ options, url }) => [options.method, new URL(url).pathname]),
    [
      ["GET", "/api/server/version"],
      ["GET", "/api/users/me"],
      ["GET", "/api/server/version"],
      ["GET", "/api/users/me"],
      ["POST", "/api/search/metadata"],
    ],
  );
  assert.equal(
    calls.some(({ options }) =>
      ["PATCH", "PUT", "DELETE"].includes(options.method),
    ),
    false,
  );
});

test("ready status binds only the stable principal ID and redacts profile fields", async () => {
  const calls = [];
  const companion = createImmichCompanion({
    apiBaseUrl: "http://immich.test/api",
    apiKey: "synthetic-secret-key",
    fetchImpl: readyFetch(calls),
  });
  const status = await companion.status();
  assert.equal(status.state, "ready");
  assert.equal(status.immichVersion, "3.0.3");
  assert.deepEqual(status.principal, {
    userId: "22222222-2222-4222-8222-222222222222",
    isAdmin: false,
  });
  assert.equal(status.permissionVerification, "not_performed");
  assert.equal(Object.values(status.capabilities).some(Boolean), false);
  assert.equal(JSON.stringify(status).includes("private@example.test"), false);
  assert.equal(calls[0].options.headers["x-api-key"], undefined);
  assert.equal(calls[1].options.headers["x-api-key"], "synthetic-secret-key");
});

test("onboarding permission verification is bounded and does not inflate generic health", async () => {
  const calls = [];
  const companion = createImmichCompanion({
    apiBaseUrl: "http://immich.test",
    apiKey: "synthetic-secret-key",
    fetchImpl: readyFetch(calls),
  });
  const generic = await companion.status();
  assert.equal(generic.state, "ready");
  assert.equal(generic.permissionVerification, "not_performed");
  assert.equal(calls.length, 2);

  const verified = await companion.verifyOnboardingPermissions();
  assert.equal(verified.permissionVerification, "verified");
  assert.deepEqual(verified.capabilities, {
    assetRead: true,
    assetSearch: true,
    faceRead: true,
    mediaRead: false,
    personList: true,
    personRead: true,
  });
  assert.equal(calls.filter(({ url }) => url.includes("/people?")).length, 1);
  assert.equal(
    calls.filter(({ url }) => url.endsWith("/search/metadata")).length,
    1,
  );
  assert.equal(calls.filter(({ url }) => url.includes("/faces?")).length, 1);
});

test("empty libraries are ready without claiming an untested Face permission", async () => {
  const calls = [];
  const companion = createImmichCompanion({
    apiBaseUrl: "http://immich.test",
    apiKey: "synthetic-secret-key",
    fetchImpl: readyFetch(calls, []),
  });
  const verified = await companion.verifyOnboardingPermissions();
  assert.equal(verified.permissionVerification, "verified_empty_library");
  assert.equal(verified.permissions.faceRead, "not_tested_empty_image_library");
  assert.equal(verified.capabilities.faceRead, false);
  assert.equal(
    calls.some(({ url }) => url.includes("/faces?")),
    false,
  );
});

test("an under-scoped key fails the People probe after basic principal health", async () => {
  const companion = createImmichCompanion({
    apiBaseUrl: "http://immich.test",
    apiKey: "synthetic-secret-key",
    fetchImpl: async (url) => {
      if (url.endsWith("/server/version")) {
        return jsonResponse({ major: 3, minor: 0, patch: 3, prerelease: null });
      }
      if (url.endsWith("/users/me")) {
        return jsonResponse({ id: "owner-fixture", isAdmin: true });
      }
      if (url.includes("/people?")) {
        return jsonResponse({ message: "Missing required permission" }, 403);
      }
      throw new Error(
        "permission verification exceeded its first failed probe",
      );
    },
  });
  const generic = await companion.status();
  assert.equal(generic.state, "ready");
  assert.equal(Object.values(generic.capabilities).some(Boolean), false);
  await assert.rejects(
    companion.verifyOnboardingPermissions(),
    (error) => error.code === "IMMICH_COMPANION_AUTH_FAILED",
  );
});

test("asset projection is path-minimal and produces a deterministic non-path revision", () => {
  const first = projectImmichAsset(asset());
  const second = projectImmichAsset(
    asset({ originalPath: "/different/private/path/synthetic.jpg" }),
  );
  assert.equal(first.inputRevision, second.inputRevision);
  assert.equal(first.inputRevision.length, 64);
  assert.equal(first.immichAssetId, "11111111-1111-4111-8111-111111111111");
  assert.equal(first.assetType, "image");
  assert.equal(first.originalFileName, "synthetic.jpg");
  assert.equal("originalPath" in first, false);
  assert.equal("owner" in first, false);
  assert.equal("people" in first, false);
  assert.equal("tags" in first, false);
  assert.equal("exifInfo" in first, false);
});

test("exact asset reads return only the versioned Cimmich projection", async () => {
  const calls = [];
  const companion = createImmichCompanion({
    apiBaseUrl: "http://immich.test",
    apiKey: "synthetic-secret-key",
    fetchImpl: readyFetch(calls),
  });
  const result = await companion.getAsset({
    assetId: "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(result.schemaVersion, IMMICH_COMPANION_SCHEMA_VERSION);
  assert.equal(result.immichVersion, "3.0.3");
  assert.equal(result.asset.originalFileName, "synthetic.jpg");
  assert.equal(JSON.stringify(result).includes("/private/upstream"), false);
  assert.equal(calls.length, 3);
  assert.match(calls[2].url, /\/api\/assets\/11111111/);
});

test("original image reads are bounded, read-only and return no upstream path", async () => {
  const calls = [];
  const bytes = Buffer.from("synthetic-image-bytes");
  const companion = createImmichCompanion({
    apiBaseUrl: "http://immich.test",
    apiKey: "synthetic-secret-key",
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.endsWith("/server/version")) {
        return jsonResponse({ major: 3, minor: 0, patch: 3, prerelease: null });
      }
      if (url.endsWith("/users/me")) {
        return jsonResponse({
          id: "22222222-2222-4222-8222-222222222222",
          isAdmin: false,
        });
      }
      if (url.endsWith("/original")) {
        return new Response(bytes, {
          headers: {
            "content-length": String(bytes.length),
            "content-type": "image/jpeg",
          },
        });
      }
      return jsonResponse(asset());
    },
  });
  const media = await companion.readAssetImage({
    assetId: "11111111-1111-4111-8111-111111111111",
  });
  assert.deepEqual(media.bytes, bytes);
  assert.equal(media.byteLength, bytes.length);
  assert.equal(media.contentDigest.length, 64);
  assert.equal(media.sourceAccess, "immich-api-read-only");
  assert.equal(
    JSON.stringify({ ...media, bytes: undefined }).includes("originalPath"),
    false,
  );
  const originalCall = calls.find((call) => call.url.endsWith("/original"));
  assert.equal(originalCall.options.method, undefined);
  assert.equal(
    originalCall.options.headers["x-api-key"],
    "synthetic-secret-key",
  );
});

test("media reads reject non-images and declared oversized bodies before buffering", async () => {
  const videoCompanion = createImmichCompanion({
    apiBaseUrl: "http://immich.test",
    apiKey: "synthetic-secret-key",
    fetchImpl: readyFetch(
      [],
      [asset({ type: "VIDEO", originalMimeType: "video/mp4" })],
    ),
  });
  await assert.rejects(
    videoCompanion.readAssetImage({ assetId: asset().id }),
    (error) => error.code === "IMMICH_COMPANION_MEDIA_UNSUPPORTED",
  );

  const oversizedCompanion = createImmichCompanion({
    apiBaseUrl: "http://immich.test",
    apiKey: "synthetic-secret-key",
    maxImageBytes: 1024 * 1024,
    fetchImpl: async (url) => {
      if (url.endsWith("/server/version")) {
        return jsonResponse({ major: 3, minor: 0, patch: 3, prerelease: null });
      }
      if (url.endsWith("/users/me"))
        return jsonResponse({ id: asset().ownerId });
      if (url.endsWith("/original")) {
        return new Response(Buffer.from("small"), {
          headers: { "content-length": String(2 * 1024 * 1024) },
        });
      }
      return jsonResponse(asset());
    },
  });
  await assert.rejects(
    oversizedCompanion.readAssetImage({ assetId: asset().id }),
    (error) => error.code === "IMMICH_COMPANION_MEDIA_TOO_LARGE",
  );
});

test("JSON responses are timeout-bound and size-bound while streaming", async () => {
  const calls = [];
  const companion = createImmichCompanion({
    apiBaseUrl: "http://immich.test",
    apiKey: "synthetic-secret-key",
    maxJsonBytes: 64 * 1024,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.endsWith("/server/version")) {
        return jsonResponse({ major: 3, minor: 0, patch: 3 });
      }
      if (url.endsWith("/users/me")) {
        return jsonResponse({ id: asset().ownerId, isAdmin: false });
      }
      return new Response(`{"padding":"${"x".repeat(64 * 1024)}"}`);
    },
  });
  await assert.rejects(
    companion.getAsset({ assetId: asset().id }),
    (error) => error.code === "IMMICH_COMPANION_PROTOCOL_INVALID",
  );
  assert.equal(calls.length, 3);
});

test("asset search requires an explicit visibility and preserves stable pagination", async () => {
  const calls = [];
  const companion = createImmichCompanion({
    apiBaseUrl: "http://immich.test",
    apiKey: "synthetic-secret-key",
    fetchImpl: readyFetch(calls),
  });
  await assert.rejects(
    companion.listAssets({}),
    (error) => error.code === "IMMICH_COMPANION_VISIBILITY_REQUIRED",
  );
  const result = await companion.listAssets({
    cursor: "3",
    limit: 40,
    updatedAfter: "2026-01-01T00:00:00Z",
    visibility: "archive",
  });
  assert.equal(result.visibility, "archive");
  assert.equal(result.nextCursor, "2");
  assert.equal(result.items.length, 1);
  const request = calls.find((call) => call.url.endsWith("/search/metadata"));
  assert.deepEqual(JSON.parse(request.options.body), {
    order: "asc",
    page: 3,
    size: 40,
    visibility: "archive",
    withDeleted: false,
    withExif: false,
    withPeople: false,
    withStacked: false,
    updatedAfter: "2026-01-01T00:00:00.000Z",
  });
});

test("locked inventory reports its interactive elevation boundary without blocking API-key inventory", async () => {
  const calls = [];
  const companion = createImmichCompanion({
    apiBaseUrl: "http://immich.test",
    apiKey: "synthetic-secret-key",
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.endsWith("/server/version")) {
        return jsonResponse({ major: 3, minor: 0, patch: 3, prerelease: null });
      }
      if (url.endsWith("/users/me")) {
        return jsonResponse({
          id: "22222222-2222-4222-8222-222222222222",
          isAdmin: true,
        });
      }
      if (url.endsWith("/search/metadata")) {
        return jsonResponse(
          {
            error: "Unauthorized",
            message: "Elevated permission is required",
          },
          401,
        );
      }
      throw new Error("unexpected route");
    },
  });

  const result = await companion.listAssets({
    limit: 100,
    visibility: "locked",
  });
  assert.deepEqual(result, {
    schemaVersion: IMMICH_COMPANION_SCHEMA_VERSION,
    immichVersion: "3.0.3",
    visibility: "locked",
    accessState: "elevated_session_required",
    items: [],
    nextCursor: null,
  });
  assert.equal(JSON.stringify(result).includes("Unauthorized"), false);
  assert.equal(
    calls.filter((call) => call.url.endsWith("/search/metadata")).length,
    1,
  );
});

test("authentication, upstream bodies and invalid payloads fail with stable redacted codes", async () => {
  const unauthorized = createImmichCompanion({
    apiBaseUrl: "http://immich.test",
    apiKey: "synthetic-secret-key",
    fetchImpl: async (url) =>
      url.endsWith("/server/version")
        ? jsonResponse({ major: 3, minor: 0, patch: 3, prerelease: null })
        : jsonResponse({ error: "private upstream detail" }, 401),
  });
  const unauthorizedStatus = await unauthorized.status();
  assert.equal(unauthorizedStatus.state, "unauthorized");
  assert.equal(unauthorizedStatus.code, "IMMICH_COMPANION_AUTH_FAILED");
  assert.equal(
    JSON.stringify(unauthorizedStatus).includes("private upstream"),
    false,
  );

  const invalid = createImmichCompanion({
    apiBaseUrl: "http://immich.test",
    apiKey: "synthetic-secret-key",
    fetchImpl: async () => jsonResponse({ major: "three" }),
  });
  const invalidStatus = await invalid.status();
  assert.equal(invalidStatus.state, "invalid_response");
  assert.equal(invalidStatus.code, "IMMICH_COMPANION_PROTOCOL_INVALID");
});

test("companion operator config is data-only and UI builds exclude local env files", async () => {
  const root = resolve(import.meta.dirname, "../..");
  const operator = join(root, "tools/companion.sh");
  const dockerignore = await readFile(
    join(root, "tools/cimmich_ui.Dockerfile.dockerignore"),
    "utf8",
  );
  assert.match(dockerignore, /^\*\*$/m);
  assert.match(dockerignore, /^!ui\/web\/\*\*$/m);
  assert.match(dockerignore, /^\*\*\/\.env\.\*$/m);

  const stage = await mkdtemp(join(tmpdir(), "cimmich-companion-config-"));
  const stateRoot = join(stage, "state");
  const keyPath = join(stage, "api-key");
  const marker = join(stage, "must-not-exist");
  await writeFile(keyPath, "synthetic_read_only_key\n", { mode: 0o600 });
  try {
    const invalid = spawnSync(
      operator,
      [
        "configure",
        `http://host.docker.internal:2283\$(touch\$IFS${marker})`,
        keyPath,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          CIMMICH_COMPANION_PROJECT: "cimmich-config-adversarial",
          CIMMICH_COMPANION_STATE_ROOT: stateRoot,
        },
      },
    );
    assert.notEqual(invalid.status, 0);
    await assert.rejects(readFile(marker), { code: "ENOENT" });

    const configured = spawnSync(
      operator,
      ["configure", "http://host.docker.internal:2283", keyPath],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          CIMMICH_COMPANION_PROJECT: "cimmich-config-adversarial",
          CIMMICH_COMPANION_STATE_ROOT: stateRoot,
        },
      },
    );
    assert.equal(configured.status, 0, configured.stderr);
    const envPath = join(stateRoot, "runtime.env");
    const runtime = await readFile(envPath, "utf8");
    assert.match(runtime, /^CIMMICH_VISIBILITY_PRIVATE_LOCK_MODE=none$/m);
    assert.equal(runtime.includes("synthetic_read_only_key"), true);
    assert.equal(
      runtime.includes("CIMMICH_VISIBILITY_PRIVATE_LOCK_MODE=password"),
      false,
    );
    await writeFile(
      envPath,
      runtime.replace(
        "CIMMICH_COMPANION_API_PORT=3411",
        `CIMMICH_COMPANION_API_PORT=\$(touch\$IFS${marker})`,
      ),
      { mode: 0o600 },
    );
    const status = spawnSync(operator, ["status"], {
      encoding: "utf8",
      env: {
        ...process.env,
        CIMMICH_COMPANION_PROJECT: "cimmich-config-adversarial",
        CIMMICH_COMPANION_STATE_ROOT: stateRoot,
      },
    });
    assert.notEqual(status.status, 0);
    await assert.rejects(readFile(marker), { code: "ENOENT" });
  } finally {
    await rm(stage, { force: true, recursive: true });
  }
});

test("companion operator records only a closed Private lock mode", async () => {
  const root = resolve(import.meta.dirname, "../..");
  const operator = join(root, "tools/companion.sh");
  const stage = await mkdtemp(join(tmpdir(), "cimmich-companion-lock-mode-"));
  try {
    const invalidState = join(stage, "invalid");
    const invalid = spawnSync(
      operator,
      ["configure", "http://host.docker.internal:2283"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          CIMMICH_COMPANION_PRIVATE_LOCK_MODE: "private-ish",
          CIMMICH_COMPANION_PROJECT: "cimmich-lock-invalid",
          CIMMICH_COMPANION_STATE_ROOT: invalidState,
        },
      },
    );
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /private lock mode must be none or password/);
    await assert.rejects(readFile(join(invalidState, "runtime.env")), {
      code: "ENOENT",
    });

    const passwordState = join(stage, "password");
    const configured = spawnSync(
      operator,
      ["configure", "http://host.docker.internal:2283"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          CIMMICH_COMPANION_PRIVATE_LOCK_MODE: "password",
          CIMMICH_COMPANION_PROJECT: "cimmich-lock-password",
          CIMMICH_COMPANION_STATE_ROOT: passwordState,
        },
      },
    );
    assert.equal(configured.status, 0, configured.stderr);
    const runtime = await readFile(join(passwordState, "runtime.env"), "utf8");
    assert.match(runtime, /^CIMMICH_VISIBILITY_PRIVATE_LOCK_MODE=password$/m);
  } finally {
    await rm(stage, { force: true, recursive: true });
  }
});
