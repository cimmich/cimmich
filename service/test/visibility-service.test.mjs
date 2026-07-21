import assert from "node:assert/strict";
import test from "node:test";
import {
  configurePrivateCredential,
  createVisibilityService,
  privateCredentialStatus,
  removePrivateCredential,
} from "../src/visibility.mjs";

const createSql = () => {
  const credentials = new Map();
  const audits = [];
  const sql = async (strings, ...values) => {
    const statement = strings.join("?").replace(/\s+/g, " ").trim();
    if (
      statement.includes("FROM person") &&
      statement.includes("subject_kind = 'pet'")
    ) {
      return values[0] === "pet-juniper"
        ? [{ default_tier: "standard", object_id: "pet-juniper" }]
        : [];
    }
    if (statement.includes("FROM cimmich_visibility_object")) return [];
    if (statement.includes("FROM cimmich_visibility_projection_surface"))
      return [];
    if (
      statement.startsWith(
        "SELECT principal_id FROM cimmich_visibility_private_credential",
      )
    ) {
      return [...credentials.keys()].map((principal_id) => ({ principal_id }));
    }
    if (
      statement.includes("SELECT config_digest") &&
      statement.includes("FOR UPDATE")
    ) {
      const credential = credentials.get(values[0]);
      return credential ? [{ config_digest: credential.config_digest }] : [];
    }
    if (
      statement.includes("SELECT config_digest") &&
      statement.includes("WHERE principal_id")
    ) {
      const credential = credentials.get(values[0]);
      return credential ? [{ config_digest: credential.config_digest }] : [];
    }
    if (
      statement.includes(
        "SELECT algorithm, salt_hex, verifier_hex, config_digest",
      )
    ) {
      const credential = credentials.get(values[0]);
      return credential ? [credential] : [];
    }
    if (statement.includes("SELECT algorithm, updated_at")) {
      const credential = credentials.get(values[0]);
      return credential ? [credential] : [];
    }
    if (
      statement.startsWith("INSERT INTO cimmich_visibility_private_credential")
    ) {
      credentials.set(values[0], {
        algorithm: "scrypt-v1",
        config_digest: values[3],
        salt_hex: values[1],
        updated_at: new Date("2026-07-17T00:00:00.000Z"),
        verifier_hex: values[2],
      });
      return [];
    }
    if (
      statement.startsWith("DELETE FROM cimmich_visibility_private_credential")
    ) {
      const existed = credentials.delete(values[0]);
      return existed ? [{ principal_id: values[0] }] : [];
    }
    if (statement.startsWith("INSERT INTO cimmich_visibility_audit")) {
      audits.push({ statement, values });
      return [];
    }
    throw new Error(`Unexpected SQL: ${statement}`);
  };
  sql.begin = (callback) => callback(sql);
  sql.json = (value) => value;
  return { audits, credentials, sql };
};

const request = ({ deviceId = "device-test", token = "" } = {}) => ({
  headers: {
    "x-cimmich-device-id": deviceId,
    "x-cimmich-principal-id": "local-primary",
    "x-cimmich-private-session": token,
    "x-cimmich-surface": "interactive",
  },
});

test("Pet visibility object read validates the Pet scope independently from Person", async () => {
  const fixture = createSql();
  const service = createVisibilityService({ sql: fixture.sql });
  await service.initialize();
  const result = await service.runRequest(request(), {}, () =>
    service.getObject({ objectId: "pet-juniper", objectScope: "pet" }),
  );
  assert.deepEqual(result, {
    decisionId: null,
    explicit: false,
    objectId: "pet-juniper",
    objectScope: "pet",
    revision: 0,
    schemaVersion: "cimmich.visibility.v1",
    visibilityTier: "standard",
  });
});

test("untrusted device headers cannot grow viewing-mode state without bound", async () => {
  const fixture = createSql();
  let currentTime = 1_000;
  const service = createVisibilityService({
    maxDeviceStates: 2,
    now: () => currentTime,
    sql: fixture.sql,
  });
  await service.initialize();
  await service.runRequest(request({ deviceId: "device-one" }), {}, () =>
    service.setMode({ actorId: "actor-test", viewingMode: "personal" }),
  );
  currentTime += 1;
  await service.runRequest(request({ deviceId: "device-two" }), {}, () =>
    service.status(),
  );
  currentTime += 1;
  await service.runRequest(request({ deviceId: "device-three" }), {}, () =>
    service.status(),
  );
  currentTime += 1;
  const evicted = await service.runRequest(
    request({ deviceId: "device-one" }),
    {},
    () => service.status(),
  );
  assert.equal(evicted.viewingMode, "standard");
});

test("client visibility intent ordering preserves the latest invocation through reversed arrival 100/100", async () => {
  const fixture = createSql();
  const service = createVisibilityService({ sql: fixture.sql });
  await service.initialize();
  const requestContext = request({ deviceId: "intent-ordered-device" });
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const personalSequence = iteration * 2 + 1;
    const standardSequence = personalSequence + 1;
    // Simulate the later Standard intent reaching the server first over a
    // different pooled HTTP connection. The earlier Personal intent must be
    // recognized as stale when it subsequently arrives.
    const standard = await service.runRequest(requestContext, {}, () =>
      service.setMode({
        actorId: "operator-test",
        intentSequence: standardSequence,
        viewingMode: "standard",
      }),
    );
    const personal = await service.runRequest(requestContext, {}, () =>
      service.setMode({
        actorId: "operator-test",
        intentSequence: personalSequence,
        viewingMode: "personal",
      }),
    );
    const status = await service.runRequest(requestContext, {}, () =>
      service.status(),
    );
    assert.equal(standard.applied, true);
    assert.equal(standard.intentSequence, standardSequence);
    assert.equal(personal.applied, false);
    assert.equal(personal.intentSequence, personalSequence);
    assert.equal(personal.viewingMode, "standard");
    assert.equal(status.viewingMode, "standard");
  }

  await assert.rejects(
    service.runRequest(requestContext, {}, () =>
      service.setMode({
        actorId: "operator-test",
        intentSequence: 200,
        viewingMode: "personal",
      }),
    ),
    (error) => error.code === "VISIBILITY_INTENT_CONFLICT",
  );
  await assert.rejects(
    service.runRequest(requestContext, {}, () =>
      service.setMode({
        actorId: "operator-test",
        intentSequence: 0,
        viewingMode: "standard",
      }),
    ),
    (error) => error.code === "VISIBILITY_INTENT_SEQUENCE_INVALID",
  );
});

test("Private credential operations store only a verifier and support explicit removal", async () => {
  const fixture = createSql();
  const result = await configurePrivateCredential({
    actorId: "operator-test",
    password: "1",
    sql: fixture.sql,
  });
  assert.equal(result.operation, "configured");
  const stored = fixture.credentials.get("local-primary");
  assert.equal(stored.algorithm, "scrypt-v1");
  assert.notEqual(stored.verifier_hex, "1");
  assert.equal(JSON.stringify(stored).includes('"1"'), false);
  assert.equal(
    (await privateCredentialStatus({ sql: fixture.sql })).configured,
    true,
  );

  const removed = await removePrivateCredential({
    actorId: "operator-test",
    sql: fixture.sql,
  });
  assert.equal(removed.operation, "removed");
  assert.equal(
    (await privateCredentialStatus({ sql: fixture.sql })).configured,
    false,
  );
});

test("passwordless Private viewing is an explicit presentation choice", async () => {
  const fixture = createSql();
  const service = createVisibilityService({
    privateLockMode: "none",
    sql: fixture.sql,
  });
  await service.initialize();
  const initial = await service.runRequest(request(), {}, () =>
    service.status(),
  );
  assert.equal(initial.privateConfigured, true);
  assert.equal(initial.privateLockMode, "none");
  const privateMode = await service.runRequest(request(), {}, () =>
    service.setMode({ actorId: "operator-test", viewingMode: "private" }),
  );
  assert.equal(privateMode.privateAuthorized, true);
  assert.equal(privateMode.viewingMode, "private");
  const unlocked = await service.runRequest(request(), {}, () =>
    service.unlock({ actorId: "operator-test", password: "" }),
  );
  assert.equal(unlocked.privateSessionToken, null);
  assert.equal(unlocked.viewingMode, "private");
  assert.equal(fixture.credentials.size, 0);
});

test("acceptance-only password injection is refused by a production runtime", async () => {
  const fixture = createSql();
  const service = createVisibilityService({
    runtimeMode: "production",
    sql: fixture.sql,
    testMode: true,
    testPassword: "1",
  });
  await assert.rejects(
    service.initialize(),
    (error) => error.code === "VISIBILITY_TEST_MODE_FORBIDDEN",
  );
});

test("Private unlock is rate limited and credential rotation revokes live sessions", async () => {
  const fixture = createSql();
  await configurePrivateCredential({
    password: "correct horse battery staple",
    sql: fixture.sql,
  });
  let currentTime = 1_000;
  const service = createVisibilityService({
    absoluteSeconds: 900,
    inactivitySeconds: 300,
    now: () => currentTime,
    sql: fixture.sql,
    unlockBackoffSeconds: 1,
    unlockFailureLimit: 2,
  });
  await service.initialize();
  assert.equal(
    await service
      .runRequest(request(), {}, () => service.status())
      .then((value) => value.privateConfigured),
    true,
  );

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      service.runRequest(request(), {}, () =>
        service.unlock({ actorId: "operator-test", password: "wrong" }),
      ),
      (error) => error.code === "VISIBILITY_PRIVATE_PASSWORD_INVALID",
    );
  }
  await assert.rejects(
    service.runRequest(request({ deviceId: "rotated-device" }), {}, () =>
      service.unlock({ actorId: "operator-test", password: "wrong" }),
    ),
    (error) =>
      error.code === "VISIBILITY_PRIVATE_RATE_LIMITED" &&
      error.statusCode === 429,
  );
  await assert.rejects(
    service.runRequest(request(), {}, () =>
      service.unlock({ actorId: "operator-test", password: "wrong" }),
    ),
    (error) =>
      error.code === "VISIBILITY_PRIVATE_RATE_LIMITED" &&
      error.statusCode === 429 &&
      error.details.retryAfterSeconds === 1,
  );

  currentTime += 1_001;
  const unlocked = await service.runRequest(request(), {}, () =>
    service.unlock({
      actorId: "operator-test",
      password: "correct horse battery staple",
    }),
  );
  assert.ok(unlocked.privateSessionToken);

  await configurePrivateCredential({
    actorId: "operator-test",
    password: "a newly rotated private password",
    sql: fixture.sql,
  });
  await assert.rejects(
    service.runRequest(
      request({ token: unlocked.privateSessionToken }),
      {},
      () => service.requirePrivate(),
    ),
    (error) => error.code === "VISIBILITY_PRIVATE_SESSION_EXPIRED",
  );
});

test("Guided forced-Standard context ignores Personal and Private caller state", async () => {
  const fixture = createSql();
  await configurePrivateCredential({
    password: "correct horse battery staple",
    sql: fixture.sql,
  });
  const service = createVisibilityService({ sql: fixture.sql });
  await service.initialize();

  await service.runRequest(request(), {}, () =>
    service.setMode({ actorId: "operator-test", viewingMode: "personal" }),
  );
  const personal = await service.runRequest(request(), {}, async () => {
    const interactive = service.status();
    const guided = service.runForcedStandard("guided_v1", () => ({
      rank: service.currentRank(),
      status: service.status(),
    }));
    return { guided, interactive, interactiveRank: service.currentRank() };
  });
  assert.equal(personal.interactive.viewingMode, "personal");
  assert.equal(personal.interactiveRank, 1);
  assert.equal(personal.guided.rank, 0);
  assert.equal(personal.guided.status.viewingMode, "standard");
  assert.equal(personal.guided.status.forcedStandard, true);
  assert.equal(personal.guided.status.privateAuthorized, false);
  assert.equal(personal.guided.status.principalBound, false);

  const unlocked = await service.runRequest(request(), {}, () =>
    service.unlock({
      actorId: "operator-test",
      password: "correct horse battery staple",
    }),
  );
  await service.runRequest(
    request({ token: unlocked.privateSessionToken }),
    {},
    () => service.setMode({ actorId: "operator-test", viewingMode: "private" }),
  );
  const privateResult = await service.runRequest(
    request({ token: unlocked.privateSessionToken }),
    {},
    async () => {
      const interactive = service.status();
      const guided = service.runForcedStandard("guided_v1", () => ({
        rank: service.currentRank(),
        status: service.status(),
      }));
      return { guided, interactive, interactiveRank: service.currentRank() };
    },
  );
  assert.equal(privateResult.interactive.viewingMode, "private");
  assert.equal(privateResult.interactive.privateAuthorized, true);
  assert.equal(privateResult.interactiveRank, 2);
  assert.equal(privateResult.guided.rank, 0);
  assert.equal(privateResult.guided.status.viewingMode, "standard");
  assert.equal(privateResult.guided.status.privateAuthorized, false);
});
