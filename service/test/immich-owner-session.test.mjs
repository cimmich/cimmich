import assert from "node:assert/strict";
import test from "node:test";
import {
  createImmichOwnerBinding,
  createImmichOwnerSessionAuthorizer,
} from "../src/immich-owner-session.mjs";

const ownerId = "22222222-2222-4222-8222-222222222222";
const otherId = "33333333-3333-4333-8333-333333333333";

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });

const binding = (principalId = ownerId) => ({
  status: () => ({
    principalId,
    state: principalId ? "owner" : "bootstrap",
  }),
});

test("owner session verification is exact, bounded and credential-minimal", async () => {
  const calls = [];
  const authorizer = createImmichOwnerSessionAuthorizer({
    binding: binding(),
    immichWebOrigin: "http://immich.test:2283",
    fetchImpl: async (url, options) => {
      calls.push({ options, url });
      return jsonResponse({ email: "private@example.test", id: ownerId });
    },
  });

  assert.deepEqual(
    await authorizer.authorize({
      authorization: "Bearer synthetic",
      cookie: "immich_access_token=synthetic",
      origin: "https://ignored.example.test",
      "x-api-key": "synthetic-key",
      "x-forwarded-for": "ignored",
    }),
    { principalId: ownerId, state: "owner" },
  );
  assert.equal(calls[0].url, "http://immich.test:2283/api/users/me");
  assert.equal(calls[0].options.redirect, "error");
  assert.deepEqual(calls[0].options.headers, {
    accept: "application/json",
    authorization: "Bearer synthetic",
    cookie: "immich_access_token=synthetic",
    "x-api-key": "synthetic-key",
  });
});

test("a different valid Immich principal is forbidden", async () => {
  const authorizer = createImmichOwnerSessionAuthorizer({
    binding: binding(),
    immichWebOrigin: "https://immich.example.test",
    fetchImpl: async () => jsonResponse({ id: otherId }),
  });
  await assert.rejects(
    authorizer.authorize({ cookie: "immich_access_token=secondary" }),
    (error) =>
      error.code === "IMMICH_OWNER_SESSION_FORBIDDEN" &&
      error.statusCode === 403,
  );
});

test("bootstrap authenticates a principal without claiming ownership", async () => {
  const authorizer = createImmichOwnerSessionAuthorizer({
    binding: binding(""),
    immichWebOrigin: "http://immich.test",
    fetchImpl: async () => jsonResponse({ id: otherId }),
  });
  assert.deepEqual(
    await authorizer.authorize({ authorization: "Bearer setup" }),
    { principalId: otherId, state: "bootstrap" },
  );
  assert.equal(binding("").status().principalId, "");
});

test("anonymous, redirected, oversized and stalled verification fail closed", async () => {
  let fetchCalls = 0;
  const anonymous = createImmichOwnerSessionAuthorizer({
    binding: binding(),
    immichWebOrigin: "http://immich.test",
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({ id: ownerId });
    },
  });
  await assert.rejects(
    anonymous.authorize(),
    (error) => error.code === "IMMICH_OWNER_SESSION_REQUIRED",
  );
  assert.equal(fetchCalls, 0);

  const redirected = createImmichOwnerSessionAuthorizer({
    binding: binding(),
    immichWebOrigin: "http://immich.test",
    fetchImpl: async (_url, options) => {
      assert.equal(options.redirect, "error");
      throw new TypeError("redirect mode is set to error");
    },
  });
  await assert.rejects(
    redirected.authorize({ cookie: "synthetic" }),
    (error) => error.code === "IMMICH_OWNER_SESSION_UNAVAILABLE",
  );

  const oversized = createImmichOwnerSessionAuthorizer({
    binding: binding(),
    immichWebOrigin: "http://immich.test",
    maximumBytes: 1024,
    fetchImpl: async () =>
      new Response("x", { headers: { "content-length": "1025" } }),
  });
  await assert.rejects(
    oversized.authorize({ cookie: "synthetic" }),
    (error) => error.code === "IMMICH_OWNER_SESSION_INVALID",
  );

  const stalled = createImmichOwnerSessionAuthorizer({
    binding: binding(),
    immichWebOrigin: "http://immich.test",
    timeoutMs: 20,
    fetchImpl: async (_url, options) => {
      let bodyController;
      const body = new ReadableStream({
        start(controller) {
          bodyController = controller;
          controller.enqueue(new Uint8Array([123]));
        },
      });
      options.signal.addEventListener(
        "abort",
        () => bodyController.error(new Error("stalled")),
        { once: true },
      );
      return new Response(body);
    },
  });
  await assert.rejects(
    stalled.authorize({ cookie: "synthetic" }),
    (error) => error.code === "IMMICH_OWNER_SESSION_UNAVAILABLE",
  );
});

test("owner binding is singleton, replay-safe and conflict-closed", async () => {
  let stored = "";
  const sql = async (strings, ...values) => {
    const query = strings.join("?");
    if (query.includes("INSERT INTO immich_companion_owner")) {
      if (!stored) stored = values[0];
      return [];
    }
    if (query.includes("SELECT principal_id")) {
      return stored ? [{ principal_id: stored }] : [];
    }
    throw new Error(`unexpected query: ${query}`);
  };
  const ownerBinding = await createImmichOwnerBinding({ sql });
  assert.deepEqual(ownerBinding.status(), {
    principalId: "",
    state: "bootstrap",
  });
  assert.equal(await ownerBinding.claim({ principalId: ownerId }), ownerId);
  assert.deepEqual(ownerBinding.status(), {
    principalId: "",
    state: "bootstrap",
  });
  assert.equal(await ownerBinding.refresh(), ownerId);
  assert.deepEqual(ownerBinding.status(), {
    principalId: ownerId,
    state: "owner",
  });
  assert.equal(await ownerBinding.claim({ principalId: ownerId }), ownerId);
  await assert.rejects(
    ownerBinding.claim({ principalId: otherId }),
    (error) => error.code === "IMMICH_OWNER_BINDING_CONFLICT",
  );
});
