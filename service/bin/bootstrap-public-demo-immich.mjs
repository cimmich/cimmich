import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  captureTimeFor,
  parseCsv,
  publicDemoGpsForAsset,
  publicDemoImmichMapSchemaVersion,
} from "../src/public-demo-bootstrap.mjs";
import { IMMICH_READ_ONLY_COMPANION_PERMISSIONS } from "../src/immich-companion-permissions.mjs";

const apiRoot = String(process.env.IMMICH_API_URL || "").replace(/\/+$/, "");
const email = String(process.env.CIMMICH_DEMO_ADMIN_EMAIL || "").trim();
const password = String(process.env.CIMMICH_DEMO_ADMIN_PASSWORD || "");
const requiredPath = (name) => {
  const value = String(process.env[name] || "").trim();
  if (!value)
    throw new Error("Public demo Immich bootstrap configuration is incomplete");
  return path.resolve(value);
};
const archiveRoot = requiredPath("CIMMICH_DEMO_ARCHIVE_ROOT");
const mapPath = requiredPath("CIMMICH_DEMO_IMMICH_MAP_PATH");
const credentialPath = requiredPath("CIMMICH_DEMO_IMMICH_CREDENTIAL_PATH");

if (!apiRoot || !email || password.length < 12) {
  throw new Error("Public demo Immich bootstrap configuration is incomplete");
}

const requestJson = async (
  requestPath,
  { body, method = "POST", token } = {},
) => {
  const response = await fetch(`${apiRoot}${requestPath}`, {
    method,
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

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const stableAssetProjection = async ({
  assetId,
  expectedHeight,
  expectedWidth,
  token,
}) => {
  let previousRevision = null;
  let stableObservations = 0;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const projected = await requestJson(`/assets/${assetId}`, {
      method: "GET",
      token,
    });
    const revision = JSON.stringify([
      projected.checksum,
      projected.updatedAt,
      projected.fileModifiedAt,
      projected.type,
      projected.width,
      projected.height,
    ]);
    const dimensionsReady =
      projected.width === expectedWidth && projected.height === expectedHeight;
    stableObservations =
      dimensionsReady && revision === previousRevision
        ? stableObservations + 1
        : dimensionsReady
          ? 1
          : 0;
    if (stableObservations >= 3) return projected;
    previousRevision = revision;
    await wait(500);
  }
  throw new Error(`Public demo Immich asset ${assetId} did not quiesce`);
};
const manifestPath = path.join(archiveRoot, "provenance", "manifest.csv");
const manifestSource = await readFile(manifestPath, "utf8");
const shotLedgerSource = await readFile(
  path.join(archiveRoot, "shot-ledger.csv"),
  "utf8",
);
const rightsSources = await Promise.all(
  ["LICENSE.md", "NOTICE.md", "ATTRIBUTION.md"].map(async (filename) => {
    const source = await readFile(path.join(archiveRoot, filename), "utf8");
    if (source.trim().length < 40) {
      throw new Error(`Public demo rights file is incomplete: ${filename}`);
    }
    return `${filename}\u001f${source}`;
  }),
);
const archiveDigest = sha256(
  [manifestSource, shotLedgerSource, ...rightsSources].join("\u001e"),
);
const manifestRows = parseCsv(manifestSource);
if (manifestRows.length !== 51)
  throw new Error("Public demo archive must contain 51 assets");

const version = await requestJson("/server/version", { method: "GET" });
const immichVersion = `${version.major}.${version.minor}.${version.patch}`;
if (version.major !== 3)
  throw new Error("Public demo requires supported Immich 3.x");

await requestJson("/auth/admin-sign-up", {
  body: { email, name: "Cimmich Cedar House Demo", password },
});
const login = await requestJson("/auth/login", { body: { email, password } });
assert.equal(typeof login.accessToken, "string");
const systemConfig = await requestJson("/system-config", {
  method: "GET",
  token: login.accessToken,
});
await requestJson("/system-config", {
  body: {
    ...systemConfig,
    map: { ...systemConfig.map, enabled: true },
    newVersionCheck: { ...systemConfig.newVersionCheck, enabled: false },
    reverseGeocoding: { ...systemConfig.reverseGeocoding, enabled: false },
  },
  method: "PUT",
  token: login.accessToken,
});
const key = await requestJson("/api-keys", {
  body: {
    name: "Cimmich Cedar House read-only companion",
    permissions: IMMICH_READ_ONLY_COMPANION_PERMISSIONS,
  },
  token: login.accessToken,
});
assert.equal(typeof key.secret, "string");

const assets = [];
for (const [index, row] of manifestRows.entries()) {
  const publicAssetId = row.asset_id;
  const filePath = path.join(archiveRoot, "media", row.filename);
  const bytes = await readFile(filePath);
  assert.equal(
    sha256(bytes),
    row.sha256,
    `${publicAssetId} archive hash drift`,
  );
  assert.equal(
    row.synthetic,
    "true",
    `${publicAssetId} is not declared synthetic`,
  );
  assert.equal(
    row.visual_qa,
    "accepted by human visual inspection",
    `${publicAssetId} is not visually accepted`,
  );

  const capturedAt = captureTimeFor(index + 1);
  const form = new FormData();
  form.append(
    "assetData",
    new Blob([bytes], { type: "image/png" }),
    row.filename,
  );
  form.append("deviceAssetId", `cimmich-demo-${publicAssetId}`);
  form.append("deviceId", "cimmich-cedar-house-v1");
  form.append("fileCreatedAt", capturedAt);
  form.append("fileModifiedAt", capturedAt);
  form.append("visibility", "timeline");
  const uploadResponse = await fetch(`${apiRoot}/assets`, {
    method: "POST",
    headers: { authorization: `Bearer ${login.accessToken}` },
    body: form,
  });
  const upload = await uploadResponse.json().catch(() => null);
  if (
    ![200, 201].includes(uploadResponse.status) ||
    typeof upload?.id !== "string"
  ) {
    throw new Error(`Public demo upload failed for ${publicAssetId}`);
  }
  const gps = publicDemoGpsForAsset(publicAssetId);
  if (gps) {
    await requestJson(`/assets/${upload.id}`, {
      body: gps,
      method: "PUT",
      token: login.accessToken,
    });
  }
  const expectedHeight = Number.parseInt(row.height, 10);
  const expectedWidth = Number.parseInt(row.width, 10);
  const projected = await stableAssetProjection({
    assetId: upload.id,
    expectedHeight,
    expectedWidth,
    token: login.accessToken,
  });
  const inputRevision = sha256(
    JSON.stringify([
      projected.checksum,
      projected.updatedAt,
      projected.fileModifiedAt,
      projected.type,
      projected.width,
      projected.height,
    ]),
  );
  assets.push({
    assetId: publicAssetId,
    checksum: row.sha256,
    height: expectedHeight,
    immichAssetId: upload.id,
    inputRevision,
    sourceUpdatedAt: projected.updatedAt,
    width: expectedWidth,
  });
}

const principalDigest = sha256(String(login.userId || login.user?.id || email));
const generatedAt = new Date().toISOString();
await writeFile(
  mapPath,
  `${JSON.stringify(
    {
      archiveDigest,
      assets,
      generatedAt,
      immichVersion,
      principalDigest,
      schemaVersion: publicDemoImmichMapSchemaVersion,
      source: "immich_api_upload",
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);
await chmod(mapPath, 0o600);
await writeFile(
  credentialPath,
  `${JSON.stringify({ apiKey: key.secret, apiKeyId: key.apiKey.id, email }, null, 2)}\n`,
  { mode: 0o600 },
);
await chmod(credentialPath, 0o600);

process.stdout.write(
  `${JSON.stringify({
    assetCount: assets.length,
    immichVersion,
    schemaVersion: publicDemoImmichMapSchemaVersion,
    status: "READY",
  })}\n`,
);
