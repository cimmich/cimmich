import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createImmichCompanionManager } from "../src/immich-companion-manager.mjs";

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status,
  });

const readyFetch = async (url) => {
  if (url.endsWith("/server/version")) {
    return json({ major: 3, minor: 0, patch: 3, prerelease: null });
  }
  if (url.endsWith("/users/me")) {
    return json({ id: "owner-fixture", isAdmin: true });
  }
  if (url.includes("/people?")) {
    return json({ hasNextPage: false, hidden: 0, people: [], total: 0 });
  }
  if (url.endsWith("/search/metadata")) {
    return json({ assets: { items: [], nextPage: null } });
  }
  return json({}, 404);
};

test("setup-managed credentials survive a provider-style API restart without rotation or permission loss", async () => {
  const root = await mkdtemp(join(tmpdir(), "cimmich-companion-manager-"));
  const filename = join(root, "immich-credential.json");
  const manager = await createImmichCompanionManager({
    credentialFile: filename,
    fetchImpl: readyFetch,
  });
  assert.equal((await manager.status()).state, "not_configured");
  const connected = await manager.connect({
    apiBaseUrl: "http://immich.test",
    apiKey: "fixture-secret-key-123456",
  });
  assert.equal(connected.state, "ready");
  assert.equal(JSON.stringify(connected).includes("fixture-secret"), false);
  assert.equal((await stat(filename)).mode & 0o077, 0);
  assert.equal(
    JSON.parse(await readFile(filename, "utf8")).apiBaseUrl,
    "http://immich.test/api",
  );
  const storedBeforeRestart = await readFile(filename, "utf8");
  const restored = await createImmichCompanionManager({
    credentialFile: filename,
    fetchImpl: readyFetch,
  });
  assert.equal((await restored.status()).state, "ready");
  const verifiedAfterRestart = await restored.verifyOnboardingPermissions();
  assert.equal(
    verifiedAfterRestart.permissionVerification,
    "verified_empty_library",
  );
  assert.equal(verifiedAfterRestart.permissions.peopleRead, "verified");
  assert.equal(await readFile(filename, "utf8"), storedBeforeRestart);
});

test("a principal-valid but under-scoped key is rejected before persistence", async () => {
  const root = await mkdtemp(join(tmpdir(), "cimmich-companion-manager-"));
  const filename = join(root, "immich-credential.json");
  const manager = await createImmichCompanionManager({
    credentialFile: filename,
    fetchImpl: async (url) => {
      if (url.endsWith("/server/version")) {
        return json({ major: 3, minor: 0, patch: 3, prerelease: null });
      }
      if (url.endsWith("/users/me")) {
        return json({ id: "owner-fixture", isAdmin: true });
      }
      if (url.includes("/people?")) {
        return json({ message: "Missing required permission" }, 403);
      }
      return json({}, 404);
    },
  });
  await assert.rejects(
    manager.connect({
      apiBaseUrl: "http://immich.test",
      apiKey: "fixture-secret-key-123456",
    }),
    (error) => error.code === "IMMICH_COMPANION_AUTH_FAILED",
  );
  await assert.rejects(readFile(filename), (error) => error.code === "ENOENT");
});

test("failed validation cannot create the credential store", async () => {
  const root = await mkdtemp(join(tmpdir(), "cimmich-companion-manager-"));
  const filename = join(root, "immich-credential.json");
  const manager = await createImmichCompanionManager({
    credentialFile: filename,
    fetchImpl: async (url) =>
      url.endsWith("/server/version")
        ? json({ major: 3, minor: 0, patch: 3, prerelease: null })
        : json({}, 401),
  });
  await assert.rejects(
    manager.connect({
      apiBaseUrl: "http://immich.test",
      apiKey: "fixture-secret-key-123456",
    }),
    (error) => error.code === "IMMICH_COMPANION_AUTH_FAILED",
  );
  await assert.rejects(readFile(filename), (error) => error.code === "ENOENT");
});
