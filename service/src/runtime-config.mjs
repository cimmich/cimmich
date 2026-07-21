import path from "node:path";

const configError = (message) =>
  Object.assign(new Error(message), { code: "CIMMICH_CONFIG_INVALID" });

const positiveInteger = (value, fallback, name, maximum) => {
  const raw = String(value || fallback);
  const parsed = Number(raw);
  if (
    !/^\d+$/.test(raw) ||
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > maximum
  ) {
    throw configError(`${name} is invalid`);
  }
  return parsed;
};

const parseOrigin = (value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw configError("Cimmich allowed origin is invalid");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.origin !== value
  ) {
    throw configError("Cimmich allowed origin must be an exact HTTP(S) origin");
  }
  return url.origin;
};

const optionalHttpBaseUrl = (value, name) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw configError(`${name} is invalid`);
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/api"
  ) {
    throw configError(`${name} must be an exact HTTP(S) /api base URL`);
  }
  return url.href.replace(/\/$/, "");
};

const optionalOrigin = (value) => {
  const raw = String(value || "").trim();
  return raw ? parseOrigin(raw) : "";
};

const exactBoolean = (value, fallback, name) => {
  const raw = String(value ?? fallback).trim();
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw configError(`${name} must be true or false`);
};

const optionalPublicId = (value, name) => {
  const raw = String(value || "").trim();
  if (raw && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(raw)) {
    throw configError(`${name} is invalid`);
  }
  return raw;
};

const optionalDigest = (value, name) => {
  const raw = String(value || "").trim();
  if (raw && !/^[0-9a-f]{64}$/.test(raw)) {
    throw configError(`${name} must be a lowercase SHA-256 digest`);
  }
  return raw;
};

export const loadRuntimeConfig = (environment = {}) => {
  const runtimeMode = String(
    environment.CIMMICH_RUNTIME_MODE || "production",
  ).trim();
  if (!["acceptance", "isolated_lab", "production"].includes(runtimeMode)) {
    throw configError("Cimmich runtime mode is invalid");
  }
  const host = String(environment.HOST || "127.0.0.1").trim();
  if (!host || /[\s/]/.test(host)) throw configError("Cimmich host is invalid");

  const rawPort = String(environment.PORT || "3101");
  const port = Number(rawPort);
  if (
    !/^\d+$/.test(rawPort) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    throw configError("Cimmich port must be an integer between 1 and 65535");
  }

  const databaseUrl = String(
    environment.DATABASE_URL || "postgres://cimmich@postgres:5432/cimmich",
  ).trim();
  let parsedDatabaseUrl;
  try {
    parsedDatabaseUrl = new URL(databaseUrl);
  } catch {
    throw configError("Cimmich database URL is invalid");
  }
  if (!["postgres:", "postgresql:"].includes(parsedDatabaseUrl.protocol)) {
    throw configError("Cimmich database URL must use PostgreSQL");
  }

  const origins = String(
    environment.CIMMICH_ALLOWED_ORIGINS ||
      "http://127.0.0.1:3000,http://localhost:3000",
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!origins.length)
    throw configError("At least one Cimmich origin is required");
  const allowedOrigins = new Set(origins.map(parseOrigin));
  if (allowedOrigins.size !== origins.length) {
    throw configError("Cimmich allowed origins must be unique");
  }

  const documentStoreRoot = String(
    environment.CIMMICH_DOCUMENT_STORE_ROOT || "",
  ).trim();
  if (documentStoreRoot && !path.isAbsolute(documentStoreRoot)) {
    throw configError("Cimmich document store root must be absolute");
  }
  const immichCredentialFile = String(
    environment.CIMMICH_IMMICH_CREDENTIAL_FILE || "",
  ).trim();
  if (immichCredentialFile && !path.isAbsolute(immichCredentialFile)) {
    throw configError("Cimmich Immich credential file must be absolute");
  }

  const documentMaxFileBytes = positiveInteger(
    environment.CIMMICH_DOCUMENT_MAX_FILE_BYTES,
    25 * 1024 * 1024,
    "Cimmich document file limit",
    1024 * 1024 * 1024,
  );
  const documentMaxStoreBytes = positiveInteger(
    environment.CIMMICH_DOCUMENT_MAX_STORE_BYTES,
    10 * 1024 * 1024 * 1024,
    "Cimmich document store limit",
    10 * 1024 * 1024 * 1024 * 1024,
  );
  if (documentMaxStoreBytes < documentMaxFileBytes) {
    throw configError(
      "Cimmich document store limit cannot be smaller than one file",
    );
  }

  const guidedEnabled = exactBoolean(
    environment.CIMMICH_GUIDED_ENABLED,
    "false",
    "Cimmich Guided enabled",
  );
  const guidedAccessToken = String(
    environment.CIMMICH_GUIDED_ACCESS_TOKEN || "",
  ).trim();
  if (
    guidedAccessToken &&
    !/^[A-Za-z0-9._~-]{32,256}$/.test(guidedAccessToken)
  ) {
    throw configError(
      "Cimmich Guided access token must be 32-256 URL-safe characters",
    );
  }
  if (guidedEnabled && !guidedAccessToken) {
    throw configError(
      "Cimmich Guided access requires a dedicated local access token",
    );
  }
  const guidedAuthority = String(
    environment.CIMMICH_GUIDED_AUTHORITY || "read",
  ).trim();
  if (!["read", "operate"].includes(guidedAuthority)) {
    throw configError("Cimmich Guided authority must be read or operate");
  }
  const guidedImmichPublicUrl = optionalHttpBaseUrl(
    environment.CIMMICH_GUIDED_IMMICH_PUBLIC_URL,
    "Cimmich Guided Immich public URL",
  );
  const guidedPublicUrl = optionalOrigin(environment.CIMMICH_GUIDED_PUBLIC_URL);
  const guidedUiPublicUrl = optionalOrigin(
    environment.CIMMICH_GUIDED_UI_PUBLIC_URL,
  );
  const guidedVisibilityCeiling = String(
    environment.CIMMICH_GUIDED_VISIBILITY_CEILING || "standard",
  ).trim();
  if (!["standard", "personal", "private"].includes(guidedVisibilityCeiling)) {
    throw configError(
      "Cimmich Guided visibility ceiling must be standard, personal or private",
    );
  }

  const allTrustedShortlistEnabled = exactBoolean(
    environment.CIMMICH_ALL_TRUSTED_SHORTLIST_ENABLED,
    "false",
    "Cimmich all-trusted shortlist enabled",
  );
  const allTrustedShortlistPackId = optionalPublicId(
    environment.CIMMICH_ALL_TRUSTED_SHORTLIST_PACK_ID,
    "Cimmich all-trusted shortlist pack ID",
  );
  const allTrustedShortlistEvaluationReceiptDigest = optionalDigest(
    environment.CIMMICH_ALL_TRUSTED_SHORTLIST_EVALUATION_RECEIPT_DIGEST,
    "Cimmich all-trusted shortlist evaluation receipt digest",
  );
  if (
    allTrustedShortlistEnabled &&
    (!allTrustedShortlistPackId || !allTrustedShortlistEvaluationReceiptDigest)
  ) {
    throw configError(
      "Cimmich all-trusted shortlist requires an exact pack and evaluation receipt",
    );
  }
  if (allTrustedShortlistEnabled && runtimeMode !== "isolated_lab") {
    throw configError(
      "Cimmich all-trusted shortlist is restricted to the isolated lab",
    );
  }

  return {
    allTrustedShortlistEnabled,
    allTrustedShortlistEvaluationReceiptDigest,
    allTrustedShortlistPackId,
    allowedOrigins,
    databaseUrl,
    documentMaxFileBytes,
    documentMaxStoreBytes,
    documentStoreRoot,
    guidedAccessToken,
    guidedAuthority,
    guidedEnabled,
    guidedImmichPublicUrl,
    guidedPublicUrl,
    guidedUiPublicUrl,
    guidedVisibilityCeiling,
    host,
    immichCredentialFile,
    port,
    runtimeMode,
  };
};
