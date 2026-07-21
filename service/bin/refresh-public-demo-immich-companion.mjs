import assert from "node:assert/strict";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { IMMICH_READ_ONLY_COMPANION_PERMISSIONS } from "../src/immich-companion-permissions.mjs";

const apiRoot = String(process.env.IMMICH_API_URL || "").replace(/\/+$/, "");
const email = String(process.env.CIMMICH_DEMO_ADMIN_EMAIL || "").trim();
const password = String(process.env.CIMMICH_DEMO_ADMIN_PASSWORD || "");
const credentialInput = String(
  process.env.CIMMICH_DEMO_IMMICH_CREDENTIAL_PATH || "",
).trim();
const credentialPath = credentialInput ? path.resolve(credentialInput) : "";

if (!apiRoot || !email || password.length < 12 || !credentialPath) {
  throw new Error("Public demo Immich companion refresh is not configured");
}

const requestJson = async (
  requestPath,
  { body, method = "POST", token } = {},
) => {
  const response = await fetch(`${apiRoot}${requestPath}`, {
    method,
    signal: AbortSignal.timeout(10_000),
    headers: {
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Public demo Immich ${requestPath} failed with HTTP ${response.status}`,
    );
  }
  return payload;
};

const existingBytes = await readFile(credentialPath);
if (existingBytes.byteLength < 2 || existingBytes.byteLength > 4096) {
  throw new Error("Public demo Immich credential state is invalid");
}
const existing = JSON.parse(existingBytes.toString("utf8"));
if (
  !existing ||
  typeof existing !== "object" ||
  typeof existing.apiKeyId !== "string" ||
  existing.apiKeyId.length < 1 ||
  existing.apiKeyId.length > 160
) {
  throw new Error("Public demo Immich credential state is invalid");
}

const login = await requestJson("/auth/login", {
  body: { email, password },
});
assert.equal(typeof login.accessToken, "string");
const replacement = await requestJson("/api-keys", {
  body: {
    name: "Cimmich public demo read-only companion",
    permissions: IMMICH_READ_ONLY_COMPANION_PERMISSIONS,
  },
  token: login.accessToken,
});
assert.equal(typeof replacement.secret, "string");
assert.equal(typeof replacement.apiKey?.id, "string");

const temporaryPath = path.join(
  path.dirname(credentialPath),
  `.${path.basename(credentialPath)}.next`,
);
await writeFile(
  temporaryPath,
  `${JSON.stringify(
    {
      apiKey: replacement.secret,
      apiKeyId: replacement.apiKey.id,
      email,
    },
    null,
    2,
  )}\n`,
  { mode: 0o600, flag: "wx" },
);
await chmod(temporaryPath, 0o600);
await rename(temporaryPath, credentialPath);
await chmod(credentialPath, 0o600);

await requestJson(`/api-keys/${encodeURIComponent(existing.apiKeyId)}`, {
  method: "DELETE",
  token: login.accessToken,
});

process.stdout.write(
  `${JSON.stringify({
    permissions: IMMICH_READ_ONLY_COMPANION_PERMISSIONS,
    secretTransport: "mode_0600_file",
    state: "READY",
  })}\n`,
);
