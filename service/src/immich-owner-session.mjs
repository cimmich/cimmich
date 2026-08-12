import { readBoundedResponseBytes } from "./bounded-response.mjs";

const typedError = (code, message, statusCode) =>
  Object.assign(new Error(message), { code, statusCode });

const principalId = (value) => {
  const normalized = String(value || "").trim();
  if (
    !normalized ||
    normalized.length > 200 ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw typedError(
      "IMMICH_OWNER_SESSION_INVALID",
      "Immich owner session is invalid",
      401,
    );
  }
  return normalized;
};

const webOrigin = (value) => {
  const raw = String(value || "").trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw typedError(
      "IMMICH_OWNER_SESSION_CONFIG_INVALID",
      "Immich Web origin is invalid",
      500,
    );
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw typedError(
      "IMMICH_OWNER_SESSION_CONFIG_INVALID",
      "Immich Web origin must be an HTTP(S) origin without credentials or a path",
      500,
    );
  }
  return parsed.origin;
};

export const createImmichOwnerBinding = async ({
  fallbackPrincipalId = "",
  sql,
}) => {
  if (typeof sql !== "function") {
    throw new Error("Immich owner binding requires a database connection");
  }
  const [stored] = await sql`
    SELECT principal_id
    FROM immich_companion_owner
    WHERE singleton = true
  `;
  let boundPrincipalId = stored?.principal_id
    ? principalId(stored.principal_id)
    : "";
  if (!boundPrincipalId && fallbackPrincipalId) {
    const fallback = principalId(fallbackPrincipalId);
    await sql`
      INSERT INTO immich_companion_owner (principal_id)
      VALUES (${fallback})
      ON CONFLICT (singleton) DO NOTHING
    `;
    const [claimed] = await sql`
      SELECT principal_id
      FROM immich_companion_owner
      WHERE singleton = true
    `;
    boundPrincipalId = principalId(claimed?.principal_id);
    if (boundPrincipalId !== fallback) {
      throw typedError(
        "IMMICH_OWNER_BINDING_CONFLICT",
        "Cimmich is already bound to a different Immich owner",
        403,
      );
    }
  }

  return {
    async claim({ executor = sql, principalId: inputPrincipalId }) {
      const candidate = principalId(inputPrincipalId);
      await executor`
        INSERT INTO immich_companion_owner (principal_id)
        VALUES (${candidate})
        ON CONFLICT (singleton) DO NOTHING
      `;
      const [owner] = await executor`
        SELECT principal_id
        FROM immich_companion_owner
        WHERE singleton = true
        FOR UPDATE
      `;
      const actual = principalId(owner?.principal_id);
      if (actual !== candidate) {
        throw typedError(
          "IMMICH_OWNER_BINDING_CONFLICT",
          "Cimmich is already bound to a different Immich owner",
          403,
        );
      }
      return actual;
    },
    async refresh() {
      const [owner] = await sql`
        SELECT principal_id
        FROM immich_companion_owner
        WHERE singleton = true
      `;
      boundPrincipalId = owner?.principal_id
        ? principalId(owner.principal_id)
        : "";
      return boundPrincipalId;
    },
    status: () => ({
      principalId: boundPrincipalId,
      state: boundPrincipalId ? "owner" : "bootstrap",
    }),
  };
};

export const createImmichOwnerSessionAuthorizer = ({
  binding,
  fetchImpl = globalThis.fetch,
  immichWebOrigin,
  maximumBytes = 32 * 1024,
  timeoutMs = 5_000,
}) => {
  if (!binding?.status || typeof fetchImpl !== "function") {
    throw new Error("Immich owner session authorizer dependencies are invalid");
  }
  const origin = webOrigin(immichWebOrigin);
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1024 ||
    maximumBytes > 1024 * 1024 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 60_000
  ) {
    throw typedError(
      "IMMICH_OWNER_SESSION_CONFIG_INVALID",
      "Immich owner session limits are invalid",
      500,
    );
  }

  return Object.freeze({
    async authorize(headers = {}) {
      const forwarded = {
        ...(headers.authorization
          ? { authorization: String(headers.authorization) }
          : {}),
        ...(headers.cookie ? { cookie: String(headers.cookie) } : {}),
        ...(headers["x-api-key"]
          ? { "x-api-key": String(headers["x-api-key"]) }
          : {}),
      };
      if (!Object.keys(forwarded).length) {
        throw typedError(
          "IMMICH_OWNER_SESSION_REQUIRED",
          "An authenticated Immich owner session is required",
          401,
        );
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${origin}/api/users/me`, {
          headers: { accept: "application/json", ...forwarded },
          redirect: "error",
          signal: controller.signal,
        });
        if (response?.status === 401 || response?.status === 403) {
          throw typedError(
            "IMMICH_OWNER_SESSION_REQUIRED",
            "An authenticated Immich owner session is required",
            401,
          );
        }
        if (!response?.ok) {
          throw typedError(
            "IMMICH_OWNER_SESSION_UNAVAILABLE",
            "Immich owner session verification is unavailable",
            503,
          );
        }
        const bytes = await readBoundedResponseBytes(response, maximumBytes, {
          code: "IMMICH_OWNER_SESSION_INVALID",
          message: "Immich owner session is invalid",
          statusCode: 401,
        });
        let profile;
        try {
          profile = JSON.parse(bytes.toString("utf8"));
        } catch {
          throw typedError(
            "IMMICH_OWNER_SESSION_INVALID",
            "Immich owner session is invalid",
            401,
          );
        }
        const authenticatedPrincipalId = principalId(profile?.id);
        const current = binding.status();
        if (
          current.state === "owner" &&
          current.principalId !== authenticatedPrincipalId
        ) {
          throw typedError(
            "IMMICH_OWNER_SESSION_FORBIDDEN",
            "This Immich user is not the configured Cimmich owner",
            403,
          );
        }
        return {
          principalId: authenticatedPrincipalId,
          state: current.state,
        };
      } catch (error) {
        if (String(error?.code || "").startsWith("IMMICH_OWNER_")) throw error;
        throw typedError(
          "IMMICH_OWNER_SESSION_UNAVAILABLE",
          "Immich owner session verification is unavailable",
          503,
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  });
};
