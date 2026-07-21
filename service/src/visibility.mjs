import { AsyncLocalStorage } from "node:async_hooks";
import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const schemaVersion = "cimmich.visibility.v1";
const projectionSchemaVersion = "cimmich.visibility-projection.v1";
const tiers = new Set(["standard", "personal", "private"]);
const modes = new Set(tiers);
const availableScopes = new Set([
  "asset",
  "context_entity",
  "document",
  "pet",
  "person",
]);
const reservedScopes = new Set(["album", "collection"]);
const entityScopes = new Set(["profile"]);
const ambientSurfaces = new Set([
  "ambient",
  "casting",
  "notification",
  "slideshow",
  "frame",
  "background",
  "share",
  "export",
  "guided_v1",
]);
const lockReasons = new Set([
  "explicit",
  "background",
  "device_lock",
  "account_lock",
]);
const rankByTier = { private: 2, personal: 1, standard: 0 };
const omitted = Symbol("visibility-omitted");

const typedError = (message, statusCode, code, details) =>
  Object.assign(new Error(message), {
    code,
    statusCode,
    ...(details ? { details } : {}),
  });

const canonicalValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalValue(nested)]),
    );
  }
  return value;
};

const digest = (value) =>
  createHash("sha256")
    .update(
      typeof value === "string" ? value : JSON.stringify(canonicalValue(value)),
    )
    .digest("hex");

const cleanId = (value, field) => {
  const id = String(value || "").trim();
  if (!id || id.length > 120) {
    throw typedError(
      `${field} is required`,
      400,
      "VISIBILITY_PRINCIPAL_REQUIRED",
      { field },
    );
  }
  return id;
};

const cleanActor = (value) => {
  const actor = String(value || "").trim();
  if (!actor || actor.length > 120) {
    throw typedError(
      "A Cimmich actor is required",
      400,
      "VISIBILITY_PRINCIPAL_REQUIRED",
      { field: "actorId" },
    );
  }
  return actor;
};

const cleanCommandId = (value) => {
  const commandId = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$/.test(commandId)) {
    throw typedError(
      "A stable commandId of 8 to 120 safe characters is required",
      400,
      "VISIBILITY_COMMAND_ID_INVALID",
    );
  }
  return commandId;
};

const cleanTier = (value) => {
  const tier = String(value || "").trim();
  if (!tiers.has(tier)) {
    throw typedError(
      "visibilityTier is not supported",
      400,
      "VISIBILITY_TIER_INVALID",
    );
  }
  return tier;
};

const cleanMode = (value) => {
  const mode = String(value || "").trim();
  if (!modes.has(mode)) {
    throw typedError(
      "viewingMode is not supported",
      400,
      "VISIBILITY_TIER_INVALID",
    );
  }
  return mode;
};

const cleanScope = (value) => {
  const scope = String(value || "").trim();
  if (scope.startsWith("immich")) {
    throw typedError(
      "Native Immich objects are outside Cimmich visibility",
      409,
      "VISIBILITY_IMMICH_SCOPE_FORBIDDEN",
    );
  }
  if (entityScopes.has(scope)) {
    throw typedError(
      "Entity profile visibility is outside V1",
      409,
      "VISIBILITY_ENTITY_SCOPE_UNSUPPORTED",
    );
  }
  if (reservedScopes.has(scope)) {
    throw typedError(
      "This container scope has no stable Cimmich registry yet",
      409,
      "VISIBILITY_SCOPE_UNAVAILABLE",
      { scope },
    );
  }
  if (!availableScopes.has(scope)) {
    throw typedError(
      "Visibility object scope is not supported",
      400,
      "VISIBILITY_SCOPE_INVALID",
      { scope },
    );
  }
  return scope;
};

const cleanObject = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw typedError(
      "A typed visibility object is required",
      400,
      "VISIBILITY_BULK_INVALID",
    );
  }
  const objectScope = cleanScope(value.objectScope ?? value.scope);
  const objectId = String(value.objectId || "").trim();
  if (!objectId || objectId.length > 200) {
    throw typedError(
      "A stable objectId is required",
      400,
      "VISIBILITY_BULK_INVALID",
    );
  }
  return {
    objectId,
    objectScope,
    visibilityTier: cleanTier(value.visibilityTier),
  };
};

const cleanObjects = (values) => {
  if (!Array.isArray(values) || values.length < 1 || values.length > 100) {
    throw typedError(
      "objects must contain 1 to 100 stable Cimmich objects",
      400,
      "VISIBILITY_BULK_INVALID",
    );
  }
  const objects = values.map(cleanObject);
  const keys = new Set();
  for (const object of objects) {
    const key = `${object.objectScope}:${object.objectId}`;
    if (keys.has(key)) {
      throw typedError(
        "A bulk command cannot repeat an object",
        400,
        "VISIBILITY_BULK_INVALID",
        { objectId: object.objectId, objectScope: object.objectScope },
      );
    }
    keys.add(key);
  }
  return objects.sort((left, right) =>
    `${left.objectScope}:${left.objectId}`.localeCompare(
      `${right.objectScope}:${right.objectId}`,
    ),
  );
};

const sessionTokenDigest = (token) => digest(`session\u001f${token}`);
const deviceKey = (principalId, deviceId) => `${principalId}\u001f${deviceId}`;

const parsePositiveSeconds = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Math.min(
    maximum,
    Math.max(minimum, Number.isFinite(parsed) ? parsed : fallback),
  );
};

const primaryAssetId = (value) =>
  value && typeof value === "object"
    ? String(value.asset_id || value.assetId || "").trim()
    : "";

const cleanCredentialPassword = (value, minimumLength = 1) => {
  if (typeof value !== "string" || value.length < minimumLength) {
    throw typedError(
      `Private password must contain at least ${minimumLength} characters`,
      400,
      "VISIBILITY_PRIVATE_PASSWORD_WEAK",
    );
  }
  if (Buffer.byteLength(value, "utf8") > 1024) {
    throw typedError(
      "Private password is too long",
      400,
      "VISIBILITY_PRIVATE_PASSWORD_INVALID",
    );
  }
  return value;
};

export const configurePrivateCredential = async ({
  actorId = "local-operator",
  minimumLength = 1,
  password,
  principalId = "local-primary",
  source = "operator_cli",
  sql,
} = {}) => {
  const principal = cleanId(principalId, "principalId");
  const actor = cleanActor(actorId);
  const secret = cleanCredentialPassword(password, minimumLength);
  const salt = randomBytes(16);
  const verifier = await scrypt(secret, salt, 64);
  const saltHex = salt.toString("hex");
  const verifierHex = Buffer.from(verifier).toString("hex");
  const configDigest = digest(`scrypt-v1\u001f${saltHex}\u001f${verifierHex}`);
  return sql.begin(async (tx) => {
    const [existing] = await tx`
      SELECT config_digest
      FROM cimmich_visibility_private_credential
      WHERE principal_id = ${principal}
      FOR UPDATE
    `;
    await tx`
      INSERT INTO cimmich_visibility_private_credential (
        principal_id, algorithm, salt_hex, verifier_hex, config_digest
      ) VALUES (${principal}, 'scrypt-v1', ${saltHex}, ${verifierHex}, ${configDigest})
      ON CONFLICT (principal_id) DO UPDATE SET
        algorithm = EXCLUDED.algorithm,
        salt_hex = EXCLUDED.salt_hex,
        verifier_hex = EXCLUDED.verifier_hex,
        config_digest = EXCLUDED.config_digest,
        updated_at = now()
    `;
    await tx`
      INSERT INTO cimmich_visibility_audit (
        audit_id, event_kind, actor_id, principal_id, device_id, details
      ) VALUES (
        ${`visibility_audit_${randomUUID().replaceAll("-", "")}`},
        'credential_configured',
        ${actor}, ${principal}, 'operator',
        ${tx.json({
          algorithm: "scrypt-v1",
          operation: existing ? "rotated" : "configured",
          source: String(source).slice(0, 80),
        })}
      )
    `;
    return {
      configured: true,
      operation: existing ? "rotated" : "configured",
      principalId: principal,
      schemaVersion,
    };
  });
};

export const removePrivateCredential = async ({
  actorId = "local-operator",
  principalId = "local-primary",
  sql,
} = {}) => {
  const principal = cleanId(principalId, "principalId");
  const actor = cleanActor(actorId);
  return sql.begin(async (tx) => {
    const rows = await tx`
      DELETE FROM cimmich_visibility_private_credential
      WHERE principal_id = ${principal}
      RETURNING principal_id
    `;
    await tx`
      INSERT INTO cimmich_visibility_audit (
        audit_id, event_kind, actor_id, principal_id, device_id, details
      ) VALUES (
        ${`visibility_audit_${randomUUID().replaceAll("-", "")}`},
        'credential_configured', ${actor}, ${principal}, 'operator',
        ${tx.json({ existed: rows.length > 0, operation: "removed" })}
      )
    `;
    return {
      configured: false,
      operation: rows.length ? "removed" : "already_absent",
      principalId: principal,
      schemaVersion,
    };
  });
};

export const privateCredentialStatus = async ({
  principalId = "local-primary",
  sql,
} = {}) => {
  const principal = cleanId(principalId, "principalId");
  const [row] = await sql`
    SELECT algorithm, updated_at
    FROM cimmich_visibility_private_credential
    WHERE principal_id = ${principal}
  `;
  return {
    algorithm: row?.algorithm || null,
    configured: Boolean(row),
    principalId: principal,
    schemaVersion,
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
};

export const createVisibilityService = ({
  absoluteSeconds = 900,
  inactivitySeconds = 300,
  maxDeviceStates = 512,
  now = () => Date.now(),
  privateLockMode = "password",
  runtimeMode = "production",
  sql,
  testMode = false,
  testPassword = "",
  unlockBackoffSeconds = 1,
  unlockFailureLimit = 5,
  unlockMaxConcurrent = 2,
  unlockMaximumBackoffSeconds = 60,
} = {}) => {
  const storage = new AsyncLocalStorage();
  const sessions = new Map();
  const devices = new Map();
  const configuredPrincipals = new Set();
  const unlockFailures = new Map();
  const assetTiers = new Map();
  const projectionSurfaces = new Map();
  const lockMode = String(privateLockMode || "password").trim();
  if (!new Set(["none", "password"]).has(lockMode)) {
    throw typedError(
      "Private view lock mode must be none or password",
      500,
      "VISIBILITY_PRIVATE_LOCK_MODE_INVALID",
    );
  }
  let activeUnlocks = 0;
  const absoluteMs =
    parsePositiveSeconds(absoluteSeconds, 900, testMode ? 1 : 60, 86_400) *
    1000;
  const inactivityMs =
    parsePositiveSeconds(inactivitySeconds, 300, testMode ? 1 : 30, 3600) *
    1000;
  const failureLimit = Math.min(
    20,
    Math.max(2, Number.parseInt(String(unlockFailureLimit), 10) || 5),
  );
  const backoffMs = parsePositiveSeconds(unlockBackoffSeconds, 1, 1, 60) * 1000;
  const maximumBackoffMs =
    parsePositiveSeconds(unlockMaximumBackoffSeconds, 60, 1, 3600) * 1000;
  const maximumConcurrentUnlocks = Math.min(
    16,
    Math.max(1, Number.parseInt(String(unlockMaxConcurrent), 10) || 2),
  );
  const deviceStateLimit = Math.min(
    10_000,
    Math.max(2, Number.parseInt(String(maxDeviceStates), 10) || 512),
  );

  const removeDeviceState = (key) => {
    devices.delete(key);
    for (const [tokenDigest, session] of sessions) {
      if (deviceKey(session.principalId, session.deviceId) === key) {
        sessions.delete(tokenDigest);
      }
    }
  };

  const deviceState = (principalId, deviceId) => {
    const key = deviceKey(principalId, deviceId);
    const currentTime = now();
    const existing = devices.get(key);
    if (existing) {
      existing.lastSeenAt = currentTime;
      return { device: existing, key };
    }
    if (devices.size >= deviceStateLimit) {
      const oldest = [...devices.entries()].sort(
        ([leftKey, left], [rightKey, right]) =>
          left.lastSeenAt - right.lastSeenAt || leftKey.localeCompare(rightKey),
      )[0];
      if (oldest) removeDeviceState(oldest[0]);
    }
    const device = {
      currentMode: "standard",
      lastIntentMode: "standard",
      lastIntentSequence: 0,
      lastSeenAt: currentTime,
      saferMode: "standard",
    };
    devices.set(key, device);
    return { device, key };
  };

  const audit = async ({
    actorId,
    decisionId = null,
    details = {},
    deviceId,
    eventKind,
    principalId,
  }) => {
    await sql`
      INSERT INTO cimmich_visibility_audit (
        audit_id, event_kind, actor_id, principal_id, device_id,
        decision_id, details
      ) VALUES (
        ${`visibility_audit_${randomUUID().replaceAll("-", "")}`},
        ${eventKind}, ${actorId}, ${principalId}, ${deviceId},
        ${decisionId}, ${sql.json(details)}
      )
    `;
  };

  const refreshAssetTiers = async () => {
    const rows = await sql`
      SELECT object_id, visibility_tier
      FROM cimmich_visibility_object
      WHERE object_scope = 'asset' AND visibility_tier <> 'standard'
    `;
    assetTiers.clear();
    for (const row of rows) assetTiers.set(row.object_id, row.visibility_tier);
  };

  const refreshProjectionSurfaces = async () => {
    const rows = await sql`
      SELECT surface_key, coverage_state, asset_derived, route_family, reason_code
      FROM cimmich_visibility_projection_surface
      ORDER BY surface_key
    `;
    projectionSurfaces.clear();
    for (const row of rows) {
      projectionSurfaces.set(row.surface_key, {
        assetDerived: Boolean(row.asset_derived),
        coverageState: row.coverage_state,
        reasonCode: row.reason_code || null,
        routeFamily: row.route_family,
        surfaceKey: row.surface_key,
      });
    }
  };

  const refreshConfiguredPrincipal = async (principalId) => {
    if (!principalId) return;
    const [row] = await sql`
      SELECT principal_id
      FROM cimmich_visibility_private_credential
      WHERE principal_id = ${principalId}
    `;
    if (row) configuredPrincipals.add(principalId);
    else configuredPrincipals.delete(principalId);
  };

  const initialize = async () => {
    await Promise.all([refreshAssetTiers(), refreshProjectionSurfaces()]);
    if (testMode) {
      if (runtimeMode !== "acceptance") {
        throw typedError(
          "Visibility test credentials are acceptance-only",
          500,
          "VISIBILITY_TEST_MODE_FORBIDDEN",
        );
      }
      if (testPassword) {
        await configurePrivateCredential({
          actorId: "system",
          minimumLength: 1,
          password: testPassword,
          principalId: "local-primary",
          source: "local_acceptance_configuration",
          sql,
        });
      }
    }
    const rows = await sql`
      SELECT principal_id FROM cimmich_visibility_private_credential
    `;
    configuredPrincipals.clear();
    for (const row of rows) configuredPrincipals.add(row.principal_id);
  };

  const resolveContext = async (request) => {
    const principalId = String(
      request.headers["x-cimmich-principal-id"] || "",
    ).trim();
    const deviceId = String(
      request.headers["x-cimmich-device-id"] || "",
    ).trim();
    const surface = String(
      request.headers["x-cimmich-surface"] || "interactive",
    )
      .trim()
      .toLowerCase();
    const token = String(
      request.headers["x-cimmich-private-session"] || "",
    ).trim();
    if (String(request.url || "").startsWith("/v1/visibility/status")) {
      await refreshConfiguredPrincipal(principalId || "local-primary");
    }
    if (!principalId || !deviceId || ambientSurfaces.has(surface)) {
      return {
        deviceId,
        forcedStandard: ambientSurfaces.has(surface),
        maxRank: 0,
        principalId,
        privateAuthorized: false,
        privateSessionError: null,
        surface,
        viewingMode: "standard",
      };
    }
    const { device } = deviceState(principalId, deviceId);
    let privateAuthorized = lockMode === "none";
    let privateSessionError = null;
    if (token && lockMode === "password") {
      const tokenDigest = sessionTokenDigest(token);
      const session = sessions.get(tokenDigest);
      const currentTime = now();
      if (
        !session ||
        session.principalId !== principalId ||
        session.deviceId !== deviceId
      ) {
        privateSessionError = "VISIBILITY_PRIVATE_SESSION_REQUIRED";
      } else if (
        currentTime >= session.absoluteExpiresAt ||
        currentTime - session.lastActivityAt >= inactivityMs
      ) {
        sessions.delete(tokenDigest);
        privateSessionError = "VISIBILITY_PRIVATE_SESSION_EXPIRED";
      } else {
        const [credential] = await sql`
          SELECT config_digest
          FROM cimmich_visibility_private_credential
          WHERE principal_id = ${principalId}
        `;
        if (
          !credential ||
          credential.config_digest !== session.credentialDigest
        ) {
          sessions.delete(tokenDigest);
          privateSessionError = "VISIBILITY_PRIVATE_SESSION_EXPIRED";
        } else {
          privateAuthorized = true;
          session.lastActivityAt = currentTime;
        }
      }
    }
    if (device.currentMode === "private" && !privateAuthorized) {
      device.currentMode = device.saferMode;
    }
    return {
      deviceId,
      forcedStandard: false,
      maxRank: rankByTier[device.currentMode],
      principalId,
      privateAuthorized,
      privateSessionError,
      surface,
      viewingMode: device.currentMode,
    };
  };

  const currentContext = () =>
    storage.getStore() || {
      deviceId: "",
      forcedStandard: false,
      maxRank: 0,
      principalId: "",
      privateAuthorized: false,
      privateSessionError: null,
      surface: "interactive",
      viewingMode: "standard",
    };

  const requireBoundContext = () => {
    const context = currentContext();
    cleanId(context.principalId, "principalId");
    cleanId(context.deviceId, "deviceId");
    return context;
  };

  const requirePrivate = () => {
    const context = requireBoundContext();
    if (!context.privateAuthorized) {
      throw typedError(
        "A current Private viewing session is required",
        401,
        context.privateSessionError || "VISIBILITY_PRIVATE_SESSION_REQUIRED",
      );
    }
    return context;
  };

  const status = () => {
    const context = currentContext();
    const bound = Boolean(context.principalId && context.deviceId);
    return {
      capabilities: {
        album: false,
        asset: true,
        collection: false,
        contextEntity: true,
        document: true,
        entityProfile: true,
      },
      forcedStandard: context.forcedStandard,
      inactivitySeconds: inactivityMs / 1000,
      maxPrivateSessionSeconds: absoluteMs / 1000,
      principalBound: bound,
      principalId: context.principalId || "local-primary",
      privateAuthorized: context.privateAuthorized,
      privateConfigured:
        configuredPrincipals.has(context.principalId || "local-primary") ||
        lockMode === "none",
      privateLockMode: lockMode,
      schemaVersion,
      surface: context.surface,
      viewingMode: context.viewingMode,
    };
  };

  const projectionStatus = () => {
    const items = [...projectionSurfaces.values()].sort((left, right) =>
      left.surfaceKey.localeCompare(right.surfaceKey),
    );
    return {
      allRegisteredSurfacesEnforced:
        items.length > 0 &&
        items.every((item) => item.coverageState === "enforced"),
      items,
      schemaVersion: projectionSchemaVersion,
    };
  };

  const requireProjection = (surfaceKey) => {
    const key = String(surfaceKey || "").trim();
    const projection = projectionSurfaces.get(key);
    if (!projection) {
      throw typedError(
        "Cimmich visibility projection is not registered",
        503,
        "VISIBILITY_PROJECTION_UNREGISTERED",
        { surfaceKey: key || null },
      );
    }
    if (projection.coverageState !== "enforced") {
      throw typedError(
        "Cimmich visibility projection is not available",
        503,
        "VISIBILITY_PROJECTION_UNAVAILABLE",
        {
          reasonCode: projection.reasonCode,
          surfaceKey: projection.surfaceKey,
        },
      );
    }
    return projection;
  };

  const setMode = async ({ actorId, intentSequence, viewingMode }) => {
    const context = requireBoundContext();
    const mode = cleanMode(viewingMode);
    const suppliedSequence =
      intentSequence === undefined || intentSequence === null
        ? null
        : Number(intentSequence);
    if (
      suppliedSequence !== null &&
      (!Number.isSafeInteger(suppliedSequence) || suppliedSequence < 1)
    ) {
      throw typedError(
        "Visibility intentSequence must be a positive safe integer",
        400,
        "VISIBILITY_INTENT_SEQUENCE_INVALID",
      );
    }
    if (context.forcedStandard && mode !== "standard") {
      throw typedError(
        "This output surface is forced to Standard",
        409,
        "VISIBILITY_ISOLATION_FAILURE",
      );
    }
    const { device, key } = deviceState(context.principalId, context.deviceId);
    const sequence = suppliedSequence ?? device.lastIntentSequence + 1;
    if (sequence < device.lastIntentSequence) {
      context.viewingMode = device.currentMode;
      context.maxRank = rankByTier[device.currentMode];
      return {
        ...status(),
        applied: false,
        intentSequence: sequence,
        viewingMode: device.currentMode,
      };
    }
    if (sequence === device.lastIntentSequence) {
      if (mode !== device.lastIntentMode) {
        throw typedError(
          "intentSequence was already used for a different viewing mode",
          409,
          "VISIBILITY_INTENT_CONFLICT",
        );
      }
      context.viewingMode = device.currentMode;
      context.maxRank = rankByTier[device.currentMode];
      return {
        ...status(),
        applied: false,
        intentSequence: sequence,
        viewingMode: device.currentMode,
      };
    }
    if (mode === "private" && lockMode === "password") requirePrivate();
    if (mode !== "private") device.saferMode = mode;
    device.currentMode = mode;
    device.lastIntentMode = mode;
    device.lastIntentSequence = sequence;
    devices.set(key, device);
    context.viewingMode = mode;
    context.maxRank = rankByTier[mode];
    await audit({
      actorId: cleanActor(actorId || context.principalId),
      details: { viewingMode: mode },
      deviceId: context.deviceId,
      eventKind: "mode_changed",
      principalId: context.principalId,
    });
    return {
      ...status(),
      applied: true,
      intentSequence: sequence,
      viewingMode: mode,
    };
  };

  const unlock = async ({ actorId, password }) => {
    const context = requireBoundContext();
    const actor = cleanActor(actorId || context.principalId);
    if (lockMode === "none") {
      const { device, key } = deviceState(
        context.principalId,
        context.deviceId,
      );
      if (device.currentMode !== "private")
        device.saferMode = device.currentMode;
      device.currentMode = "private";
      devices.set(key, device);
      await audit({
        actorId: actor,
        details: { result: "not_required" },
        deviceId: context.deviceId,
        eventKind: "unlock_succeeded",
        principalId: context.principalId,
      });
      return {
        ...status(),
        privateSessionToken: null,
        viewingMode: "private",
      };
    }
    const failureKey = context.principalId;
    const currentTime = now();
    const currentFailure = unlockFailures.get(failureKey);
    if (currentFailure?.blockedUntil > currentTime) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((currentFailure.blockedUntil - currentTime) / 1000),
      );
      throw typedError(
        "Private unlock is temporarily rate limited",
        429,
        "VISIBILITY_PRIVATE_RATE_LIMITED",
        { retryAfterSeconds },
      );
    }
    const [credential] = await sql`
      SELECT algorithm, salt_hex, verifier_hex, config_digest
      FROM cimmich_visibility_private_credential
      WHERE principal_id = ${context.principalId}
    `;
    if (!credential) {
      configuredPrincipals.delete(context.principalId);
      throw typedError(
        "Private viewing is not configured",
        503,
        "VISIBILITY_PRIVATE_NOT_CONFIGURED",
      );
    }
    configuredPrincipals.add(context.principalId);
    if (activeUnlocks >= maximumConcurrentUnlocks) {
      throw typedError(
        "Private unlock is temporarily rate limited",
        429,
        "VISIBILITY_PRIVATE_RATE_LIMITED",
        { retryAfterSeconds: 1 },
      );
    }
    activeUnlocks += 1;
    let supplied;
    try {
      supplied = await scrypt(
        String(password ?? ""),
        Buffer.from(credential.salt_hex, "hex"),
        64,
      );
    } finally {
      activeUnlocks -= 1;
    }
    const expected = Buffer.from(credential.verifier_hex, "hex");
    if (
      expected.length !== Buffer.from(supplied).length ||
      !timingSafeEqual(expected, Buffer.from(supplied))
    ) {
      await audit({
        actorId: actor,
        details: { result: "invalid" },
        deviceId: context.deviceId,
        eventKind: "unlock_failed",
        principalId: context.principalId,
      });
      const failureCount = (currentFailure?.count || 0) + 1;
      const delay =
        failureCount < failureLimit
          ? 0
          : Math.min(
              maximumBackoffMs,
              backoffMs * 2 ** (failureCount - failureLimit),
            );
      unlockFailures.set(failureKey, {
        blockedUntil: currentTime + delay,
        count: failureCount,
      });
      throw typedError(
        "Private password was not accepted",
        401,
        "VISIBILITY_PRIVATE_PASSWORD_INVALID",
      );
    }
    unlockFailures.delete(failureKey);
    const token = randomBytes(32).toString("base64url");
    const issuedAt = now();
    const tokenDigest = sessionTokenDigest(token);
    for (const [existingDigest, session] of sessions) {
      if (
        session.principalId === context.principalId &&
        session.deviceId === context.deviceId
      ) {
        sessions.delete(existingDigest);
      }
    }
    sessions.set(tokenDigest, {
      absoluteExpiresAt: issuedAt + absoluteMs,
      credentialDigest: credential.config_digest,
      deviceId: context.deviceId,
      lastActivityAt: issuedAt,
      principalId: context.principalId,
    });
    const { device, key } = deviceState(context.principalId, context.deviceId);
    if (device.currentMode !== "private") device.saferMode = device.currentMode;
    device.currentMode = "private";
    devices.set(key, device);
    await audit({
      actorId: actor,
      details: { result: "accepted" },
      deviceId: context.deviceId,
      eventKind: "unlock_succeeded",
      principalId: context.principalId,
    });
    return {
      expiresAt: new Date(issuedAt + absoluteMs).toISOString(),
      privateSessionToken: token,
      schemaVersion,
      viewingMode: "private",
    };
  };

  const lock = async ({ actorId, reason = "explicit" }) => {
    const context = requireBoundContext();
    const cleanReason = String(reason || "explicit").trim();
    if (!lockReasons.has(cleanReason)) {
      throw typedError(
        "Lock reason is not supported",
        400,
        "VISIBILITY_TIER_INVALID",
      );
    }
    for (const [tokenDigest, session] of sessions) {
      if (
        session.principalId === context.principalId &&
        session.deviceId === context.deviceId
      ) {
        sessions.delete(tokenDigest);
      }
    }
    const { device, key } = deviceState(context.principalId, context.deviceId);
    device.currentMode = device.saferMode;
    devices.set(key, device);
    await audit({
      actorId: cleanActor(actorId || context.principalId),
      details: { reason: cleanReason, viewingMode: device.currentMode },
      deviceId: context.deviceId,
      eventKind: "locked",
      principalId: context.principalId,
    });
    return {
      ...status(),
      privateAuthorized: false,
      viewingMode: device.currentMode,
    };
  };

  const beginCommand = async (
    tx,
    { actorId, commandId, commandKind, context, payload },
  ) => {
    const cleanIdValue = cleanCommandId(commandId);
    const requestDigest = digest({ commandKind, payload });
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${cleanIdValue}, 37))`;
    const [existing] = await tx`
      SELECT command_kind, request_digest, response_body, state
      FROM cimmich_visibility_command
      WHERE command_id = ${cleanIdValue}
      FOR UPDATE
    `;
    if (existing) {
      if (
        existing.command_kind !== commandKind ||
        existing.request_digest !== requestDigest
      ) {
        throw typedError(
          "commandId was already used for a different visibility command",
          409,
          "VISIBILITY_COMMAND_CONFLICT",
        );
      }
      if (existing.state === "completed")
        return { replay: existing.response_body };
      throw typedError(
        "Visibility command is already in progress",
        409,
        "VISIBILITY_COMMAND_CONFLICT",
      );
    }
    await tx`
      INSERT INTO cimmich_visibility_command (
        command_id, actor_id, principal_id, device_id, command_kind,
        request_digest, state
      ) VALUES (
        ${cleanIdValue}, ${actorId}, ${context.principalId}, ${context.deviceId},
        ${commandKind}, ${requestDigest}, 'started'
      )
    `;
    return { commandId: cleanIdValue };
  };

  const completeCommand = async (tx, { commandId, decisionId, response }) => {
    await tx`
      UPDATE cimmich_visibility_command
      SET decision_id = ${decisionId}, response_body = ${tx.json(response)},
        state = 'completed', completed_at = now()
      WHERE command_id = ${commandId}
    `;
    return response;
  };

  const requireObjects = async (tx, objects) => {
    const assetIds = objects
      .filter((object) => object.objectScope === "asset")
      .map((object) => object.objectId);
    const documentIds = objects
      .filter((object) => object.objectScope === "document")
      .map((object) => object.objectId);
    const contextEntityIds = objects
      .filter((object) => object.objectScope === "context_entity")
      .map((object) => object.objectId);
    const personIds = objects
      .filter((object) => object.objectScope === "person")
      .map((object) => object.objectId);
    const petIds = objects
      .filter((object) => object.objectScope === "pet")
      .map((object) => object.objectId);
    const assetRows = assetIds.length
      ? await tx`
      SELECT asset_id FROM asset
      WHERE asset_id = ANY(${assetIds}) AND state = 'active'
      ORDER BY asset_id
      FOR UPDATE
    `
      : [];
    const documentRows = documentIds.length
      ? await tx`
      SELECT document_id FROM cimmich_document
      WHERE document_id = ANY(${documentIds}) AND status IN ('active','archived')
      ORDER BY document_id
      FOR UPDATE
      `
      : [];
    const contextEntityRows = contextEntityIds.length
      ? await tx`
      SELECT entity_id FROM context_entity
      WHERE entity_id = ANY(${contextEntityIds}) AND status <> 'deleted'
      ORDER BY entity_id
      FOR UPDATE
    `
      : [];
    const personRows = personIds.length
      ? await tx`
      SELECT person_id FROM person
      WHERE person_id = ANY(${personIds}) AND subject_kind = 'person'
        AND status IN ('active','hidden')
      ORDER BY person_id
      FOR UPDATE
      `
      : [];
    const petRows = petIds.length
      ? await tx`
      SELECT person_id FROM person
      WHERE person_id = ANY(${petIds}) AND subject_kind = 'pet'
        AND status IN ('active','hidden')
      ORDER BY person_id
      FOR UPDATE
    `
      : [];
    const found = new Set([
      ...assetRows.map((row) => `asset:${row.asset_id}`),
      ...contextEntityRows.map((row) => `context_entity:${row.entity_id}`),
      ...documentRows.map((row) => `document:${row.document_id}`),
      ...petRows.map((row) => `pet:${row.person_id}`),
      ...personRows.map((row) => `person:${row.person_id}`),
    ]);
    const missing = objects
      .filter(
        (object) => !found.has(`${object.objectScope}:${object.objectId}`),
      )
      .map((object) => object.objectId);
    if (missing.length) {
      throw typedError(
        "One or more Cimmich visibility objects were not found",
        404,
        "VISIBILITY_OBJECT_NOT_FOUND",
        { missingObjectIds: missing },
      );
    }
  };

  const getObjectsForUpdate = async (tx, objects) => {
    const objectIds = objects.map((object) => object.objectId);
    const objectScopes = [
      ...new Set(objects.map((object) => object.objectScope)),
    ];
    const rows = await tx`
      SELECT object_scope, object_id, visibility_tier, revision, decision_id
      FROM cimmich_visibility_object
      WHERE object_scope = ANY(${objectScopes}) AND object_id = ANY(${objectIds})
      ORDER BY object_scope, object_id
      FOR UPDATE
    `;
    const documentIds = objects
      .filter((object) => object.objectScope === "document")
      .map((object) => object.objectId);
    const defaults = documentIds.length
      ? await tx`
          SELECT document_id, visibility_tier FROM cimmich_document
          WHERE document_id = ANY(${documentIds})
        `
      : [];
    const documentDefaults = new Map(
      defaults.map((row) => [row.document_id, row.visibility_tier]),
    );
    const current = new Map(
      rows.map((row) => [`${row.object_scope}:${row.object_id}`, row]),
    );
    return objects.map((object) => {
      const row = current.get(`${object.objectScope}:${object.objectId}`);
      return {
        decisionId: row?.decision_id || null,
        explicit: Boolean(row),
        objectId: object.objectId,
        objectScope: object.objectScope,
        revision: Number(row?.revision || 0),
        visibilityTier:
          row?.visibility_tier ||
          (object.objectScope === "document"
            ? documentDefaults.get(object.objectId)
            : null) ||
          "standard",
      };
    });
  };

  const requireMutationVisibility = (objects, context) => {
    const hidden = objects.find(
      (item) => rankByTier[item.visibilityTier] > context.maxRank,
    );
    if (!hidden) return;
    if (hidden.visibilityTier === "private") {
      throw typedError(
        "A Private session is required to change a Private object",
        401,
        context.privateSessionError || "VISIBILITY_PRIVATE_SESSION_REQUIRED",
      );
    }
    throw typedError(
      "Cimmich visibility object is not visible in this mode",
      404,
      "VISIBILITY_OBJECT_NOT_VISIBLE",
    );
  };

  const requireMutationTargetAuthority = (objects, context) => {
    const privateTarget = objects.some(
      (item) => item.visibilityTier === "private",
    );
    if (!privateTarget || context.privateAuthorized) return;
    throw typedError(
      "A Private session is required to make an object Private",
      401,
      context.privateSessionError || "VISIBILITY_PRIVATE_SESSION_REQUIRED",
    );
  };

  const setObjects = async ({ actorId, commandId, objects }) => {
    const context = requireBoundContext();
    const actor = cleanActor(actorId || context.principalId);
    const cleaned = cleanObjects(objects);
    const commandKind = cleaned.length === 1 ? "set" : "bulk_set";
    const result = await sql.begin(async (tx) => {
      const command = await beginCommand(tx, {
        actorId: actor,
        commandId,
        commandKind,
        context,
        payload: { objects: cleaned },
      });
      if (command.replay) {
        requireMutationVisibility(command.replay.objects || [], context);
        return { response: { ...command.replay, replayed: true } };
      }
      await requireObjects(tx, cleaned);
      const before = await getObjectsForUpdate(tx, cleaned);
      requireMutationVisibility(before, context);
      requireMutationTargetAuthority(cleaned, context);
      const decisionId = `visibility_decision_${randomUUID().replaceAll("-", "")}`;
      const after = cleaned.map((object) => {
        const prior = before.find(
          (item) =>
            item.objectScope === object.objectScope &&
            item.objectId === object.objectId,
        );
        return {
          explicit: true,
          objectId: object.objectId,
          objectScope: object.objectScope,
          revision: prior.revision + 1,
          visibilityTier: object.visibilityTier,
        };
      });
      await tx`
        INSERT INTO cimmich_visibility_decision (
          decision_id, actor_id, principal_id, device_id, decision_kind,
          before_state, after_state, state
        ) VALUES (
          ${decisionId}, ${actor}, ${context.principalId}, ${context.deviceId},
          ${commandKind}, ${tx.json(before)}, ${tx.json(after)}, 'active'
        )
      `;
      for (const item of after) {
        await tx`
          INSERT INTO cimmich_visibility_object (
            object_scope, object_id, visibility_tier, revision, decision_id
          ) VALUES (
            ${item.objectScope}, ${item.objectId}, ${item.visibilityTier},
            ${item.revision}, ${decisionId}
          )
          ON CONFLICT (object_scope, object_id) DO UPDATE SET
            visibility_tier = EXCLUDED.visibility_tier,
            revision = EXCLUDED.revision,
            decision_id = EXCLUDED.decision_id,
            updated_at = now()
        `;
      }
      await tx`
        INSERT INTO cimmich_visibility_audit (
          audit_id, event_kind, actor_id, principal_id, device_id,
          decision_id, details
        ) VALUES (
          ${`visibility_audit_${randomUUID().replaceAll("-", "")}`},
          'object_tier_changed', ${actor}, ${context.principalId},
          ${context.deviceId}, ${decisionId},
          ${tx.json({ objectCount: after.length })}
        )
      `;
      const response = {
        decisionId,
        objects: after,
        replayed: false,
        schemaVersion,
      };
      return {
        response: await completeCommand(tx, {
          commandId: command.commandId,
          decisionId,
          response,
        }),
      };
    });
    await refreshAssetTiers();
    return result.response;
  };

  const getObject = async ({ objectId, objectScope }) => {
    const scope = cleanScope(objectScope);
    const id = String(objectId || "").trim();
    let object;
    if (scope === "asset") {
      [object] = await sql`
            SELECT asset_id AS object_id, 'standard'::text AS default_tier
            FROM asset WHERE asset_id = ${id} AND state = 'active'
          `;
    } else if (scope === "context_entity") {
      [object] = await sql`
            SELECT entity_id AS object_id, 'standard'::text AS default_tier
            FROM context_entity
            WHERE entity_id = ${id} AND status <> 'deleted'
          `;
    } else if (scope === "document") {
      [object] = await sql`
            SELECT document_id AS object_id, visibility_tier AS default_tier
            FROM cimmich_document
            WHERE document_id = ${id} AND status IN ('active','archived')
          `;
    } else if (scope === "person") {
      [object] = await sql`
            SELECT person_id AS object_id, 'standard'::text AS default_tier
            FROM person
            WHERE person_id = ${id} AND subject_kind = 'person'
              AND status IN ('active','hidden')
          `;
    } else {
      [object] = await sql`
            SELECT person_id AS object_id, 'standard'::text AS default_tier
            FROM person
            WHERE person_id = ${id} AND subject_kind = 'pet'
              AND status IN ('active','hidden')
          `;
    }
    if (!object) {
      throw typedError(
        "Cimmich visibility object was not found",
        404,
        "VISIBILITY_OBJECT_NOT_FOUND",
      );
    }
    const [row] = await sql`
      SELECT visibility_tier, revision, decision_id
      FROM cimmich_visibility_object
      WHERE object_scope = ${scope} AND object_id = ${id}
    `;
    const tier = row?.visibility_tier || object.default_tier || "standard";
    if (rankByTier[tier] > currentContext().maxRank) {
      throw typedError(
        "Cimmich visibility object is not visible in this mode",
        404,
        "VISIBILITY_OBJECT_NOT_VISIBLE",
      );
    }
    return {
      decisionId: row?.decision_id || null,
      explicit: Boolean(row),
      objectId: id,
      objectScope: scope,
      revision: Number(row?.revision || 0),
      schemaVersion,
      visibilityTier: tier,
    };
  };

  const undo = async ({ actorId, commandId, decisionId }) => {
    const context = requireBoundContext();
    const actor = cleanActor(actorId || context.principalId);
    const originalId = String(decisionId || "").trim();
    const result = await sql.begin(async (tx) => {
      const command = await beginCommand(tx, {
        actorId: actor,
        commandId,
        commandKind: "undo",
        context,
        payload: { decisionId: originalId },
      });
      if (command.replay) {
        requireMutationVisibility(command.replay.objects || [], context);
        return { response: { ...command.replay, replayed: true } };
      }
      const [decision] = await tx`
        SELECT decision_id, before_state, after_state, state
        FROM cimmich_visibility_decision
        WHERE decision_id = ${originalId}
        FOR UPDATE
      `;
      if (!decision) {
        throw typedError(
          "Visibility decision was not found",
          404,
          "VISIBILITY_UNDO_NOT_FOUND",
        );
      }
      if (decision.state === "undone") {
        throw typedError(
          "Visibility decision was already undone",
          409,
          "VISIBILITY_UNDO_ALREADY_USED",
        );
      }
      const before = decision.before_state;
      const after = decision.after_state;
      const current = await getObjectsForUpdate(
        tx,
        after.map((item) => ({
          objectId: item.objectId,
          objectScope: item.objectScope,
          visibilityTier: item.visibilityTier,
        })),
      );
      requireMutationVisibility(current, context);
      const stale = after.some((expected) => {
        const item = current.find(
          (candidate) =>
            candidate.objectScope === expected.objectScope &&
            candidate.objectId === expected.objectId,
        );
        return (
          !item ||
          item.revision !== Number(expected.revision) ||
          item.visibilityTier !== expected.visibilityTier
        );
      });
      if (stale) {
        throw typedError(
          "Visibility decision can no longer be undone safely",
          409,
          "VISIBILITY_UNDO_STALE",
        );
      }
      const undoDecisionId = `visibility_decision_${randomUUID().replaceAll("-", "")}`;
      const restored = before.map((prior) => {
        if (!prior.explicit) {
          return { ...prior, revision: 0 };
        }
        const expected = after.find(
          (item) =>
            item.objectScope === prior.objectScope &&
            item.objectId === prior.objectId,
        );
        return { ...prior, revision: Number(expected.revision) + 1 };
      });
      await tx`
        INSERT INTO cimmich_visibility_decision (
          decision_id, actor_id, principal_id, device_id, decision_kind,
          before_state, after_state, state, supersedes_decision_id
        ) VALUES (
          ${undoDecisionId}, ${actor}, ${context.principalId}, ${context.deviceId},
          'undo', ${tx.json(after)}, ${tx.json(restored)}, 'active', ${originalId}
        )
      `;
      for (const prior of restored) {
        if (!prior.explicit) {
          await tx`
            DELETE FROM cimmich_visibility_object
            WHERE object_scope = ${prior.objectScope} AND object_id = ${prior.objectId}
          `;
        } else {
          await tx`
            UPDATE cimmich_visibility_object
            SET visibility_tier = ${prior.visibilityTier}, revision = ${prior.revision},
              decision_id = ${undoDecisionId}, updated_at = now()
            WHERE object_scope = ${prior.objectScope} AND object_id = ${prior.objectId}
          `;
        }
      }
      await tx`
        UPDATE cimmich_visibility_decision SET state = 'undone'
        WHERE decision_id = ${originalId}
      `;
      await tx`
        INSERT INTO cimmich_visibility_audit (
          audit_id, event_kind, actor_id, principal_id, device_id,
          decision_id, details
        ) VALUES (
          ${`visibility_audit_${randomUUID().replaceAll("-", "")}`},
          'decision_undone', ${actor}, ${context.principalId}, ${context.deviceId},
          ${undoDecisionId}, ${tx.json({ supersedesDecisionId: originalId })}
        )
      `;
      const response = {
        decisionId: undoDecisionId,
        objects: restored,
        replayed: false,
        schemaVersion,
        supersedesDecisionId: originalId,
      };
      return {
        response: await completeCommand(tx, {
          commandId: command.commandId,
          decisionId: undoDecisionId,
          response,
        }),
      };
    });
    await refreshAssetTiers();
    return result.response;
  };

  const assetVisible = (assetId, rank = currentContext().maxRank) =>
    rankByTier[assetTiers.get(String(assetId || "")) || "standard"] <= rank;

  const requireVisibleAsset = async (assetId) => {
    const id = String(assetId || "").trim();
    const [asset] = await sql`
      SELECT asset_id FROM asset WHERE asset_id = ${id} AND state = 'active'
    `;
    if (!asset) {
      throw typedError(
        "Cimmich asset was not found",
        404,
        "VISIBILITY_OBJECT_NOT_FOUND",
      );
    }
    if (!assetVisible(id)) {
      throw typedError(
        "Cimmich asset is not visible in this mode",
        404,
        "VISIBILITY_OBJECT_NOT_VISIBLE",
      );
    }
  };

  const projectPayload = (body) => {
    const transform = (value, { root = false } = {}) => {
      if (Array.isArray(value)) {
        return value
          .map((item) => transform(item))
          .filter((item) => item !== omitted);
      }
      if (!value || typeof value !== "object" || value instanceof Date) {
        return value;
      }
      const directAssetId = primaryAssetId(value);
      if (directAssetId && !assetVisible(directAssetId)) {
        if (root) {
          throw typedError(
            "Cimmich object is not visible in this mode",
            404,
            "VISIBILITY_OBJECT_NOT_VISIBLE",
          );
        }
        return omitted;
      }
      const result = {};
      const representativeAssetId = String(
        value.representative_asset_id || value.representativeAssetId || "",
      ).trim();
      const hiddenRepresentative =
        representativeAssetId && !assetVisible(representativeAssetId);
      const coverAssetId = String(
        value.cover_asset_id || value.coverAssetId || "",
      ).trim();
      const hiddenCover = coverAssetId && !assetVisible(coverAssetId);
      for (const [key, nested] of Object.entries(value)) {
        if (
          hiddenCover &&
          [
            "cover_asset_id",
            "coverAssetId",
            "cover_crop",
            "coverCrop",
          ].includes(key)
        ) {
          result[key] = null;
          continue;
        }
        if (
          hiddenRepresentative &&
          [
            "representative_asset_id",
            "representativeAssetId",
            "representative_face_id",
            "representativeFaceId",
            "box_x",
            "box_y",
            "box_w",
            "box_h",
            "sourceAssetId",
            "filename",
          ].includes(key)
        ) {
          result[key] =
            key === "filename" || key === "sourceAssetId" ? "" : null;
          continue;
        }
        const projected = transform(nested);
        result[key] = projected === omitted ? null : projected;
      }
      return result;
    };
    return transform(body, { root: true });
  };

  const runRequest = (request, response, handler) => {
    return resolveContext(request).then((context) => {
      response.cimmichVisibilityProject = projectPayload;
      return storage.run(context, handler);
    });
  };

  const runForcedStandard = (surface, handler) => {
    const normalizedSurface = String(surface || "ambient")
      .trim()
      .toLowerCase();
    if (!ambientSurfaces.has(normalizedSurface)) {
      throw typedError(
        "Forced-Standard surface is not registered",
        500,
        "VISIBILITY_ISOLATION_FAILURE",
      );
    }
    return storage.run(
      {
        deviceId: "",
        forcedStandard: true,
        maxRank: 0,
        principalId: "",
        privateAuthorized: false,
        privateSessionError: null,
        surface: normalizedSurface,
        viewingMode: "standard",
      },
      handler,
    );
  };

  return {
    assetVisible,
    currentContext,
    currentRank: () => currentContext().maxRank,
    getObject,
    initialize,
    lock,
    projectionStatus,
    projectPayload,
    refreshAssetTiers,
    refreshProjectionSurfaces,
    requirePrivate,
    requireProjection,
    requireVisibleAsset,
    runForcedStandard,
    runRequest,
    schemaVersion,
    setMode,
    setObjects,
    status,
    undo,
    unlock,
  };
};
