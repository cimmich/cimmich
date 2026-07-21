import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { IMMICH_READ_ONLY_COMPANION_PERMISSIONS } from "../src/immich-companion-permissions.mjs";

const apiRoot = String(process.env.IMMICH_API_URL || "").replace(/\/+$/, "");
const email = String(process.env.CIMMICH_STOCK_ADMIN_EMAIL || "").trim();
const password = String(process.env.CIMMICH_STOCK_ADMIN_PASSWORD || "");
const fixturePath = String(
  process.env.CIMMICH_PUBLIC_FIXTURE_IMAGE || "",
).trim();
const expectedDigest = String(
  process.env.CIMMICH_PUBLIC_FIXTURE_SHA256 || "",
).trim();
const receiptPath = String(
  process.env.CIMMICH_STOCK_BOOTSTRAP_RECEIPT || "",
).trim();
const withOnboardingPeopleFixture =
  process.env.CIMMICH_STOCK_ONBOARDING_PEOPLE_FIXTURE === "1";

if (
  !apiRoot ||
  !email ||
  !password ||
  !fixturePath ||
  !/^[0-9a-f]{64}$/.test(expectedDigest) ||
  !receiptPath
) {
  throw new Error("Stock Immich bootstrap configuration is incomplete");
}

const requestJson = async (path, { body, token } = {}) => {
  const response = await fetch(`${apiRoot}${path}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Stock Immich ${path} failed with HTTP ${response.status}`);
  }
  return payload;
};

const versionResponse = await fetch(`${apiRoot}/server/version`);
assert.equal(versionResponse.ok, true);
const version = await versionResponse.json();
assert.deepEqual(
  { major: version.major, minor: version.minor, patch: version.patch },
  { major: 3, minor: 0, patch: 3 },
);

await requestJson("/auth/admin-sign-up", {
  body: { email, name: "Cimmich Public Fixture", password },
});
const login = await requestJson("/auth/login", {
  body: { email, password },
});
assert.equal(typeof login.accessToken, "string");

const key = await requestJson("/api-keys", {
  body: {
    name: "Cimmich disposable read-only",
    permissions: IMMICH_READ_ONLY_COMPANION_PERMISSIONS,
  },
  token: login.accessToken,
});
assert.equal(typeof key.secret, "string");

const fixture = await readFile(fixturePath);
const fixtureDigest = createHash("sha256").update(fixture).digest("hex");
assert.equal(fixtureDigest, expectedDigest);
const fixtureIsPng = fixturePath.toLowerCase().endsWith(".png");
const form = new FormData();
form.append(
  "assetData",
  new Blob([fixture], { type: fixtureIsPng ? "image/png" : "image/jpeg" }),
  fixtureIsPng ? "public-fixture.png" : "public-fixture.jpg",
);
form.append("fileCreatedAt", "2020-01-09T00:00:00.000Z");
form.append("fileModifiedAt", "2020-01-09T00:00:00.000Z");
form.append("visibility", "timeline");
const uploadResponse = await fetch(`${apiRoot}/assets`, {
  method: "POST",
  headers: { authorization: `Bearer ${login.accessToken}` },
  body: form,
});
const upload = await uploadResponse.json().catch(() => null);
assert.equal(uploadResponse.status, 201);
assert.equal(typeof upload?.id, "string");

let stableAssetRevision = "";
let stableObservations = 0;
let stableAsset = null;
for (let attempt = 0; attempt < 60; attempt += 1) {
  const assetResponse = await fetch(`${apiRoot}/assets/${upload.id}`, {
    headers: { authorization: `Bearer ${login.accessToken}` },
  });
  assert.equal(assetResponse.ok, true);
  const asset = await assetResponse.json();
  const revision = JSON.stringify([
    asset.checksum,
    asset.updatedAt,
    asset.fileModifiedAt,
    asset.type,
    asset.width,
    asset.height,
  ]);
  stableObservations =
    revision === stableAssetRevision ? stableObservations + 1 : 1;
  stableAssetRevision = revision;
  if (
    stableObservations >= 5 &&
    Number.isInteger(asset.width) &&
    asset.width > 0 &&
    Number.isInteger(asset.height) &&
    asset.height > 0
  ) {
    stableAsset = asset;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
assert.ok(
  stableObservations >= 5,
  "Stock Immich asset revision did not quiesce",
);

if (withOnboardingPeopleFixture) {
  assert.ok(stableAsset, "Stock Immich asset geometry is unavailable");
  const namedPerson = await requestJson("/people", {
    body: { name: "Named Stock Fixture" },
    token: login.accessToken,
  });
  const unnamedPerson = await requestJson("/people", {
    body: {},
    token: login.accessToken,
  });
  for (const [index, person] of [namedPerson, unnamedPerson].entries()) {
    assert.equal(typeof person?.id, "string");
    await requestJson("/faces", {
      body: {
        assetId: upload.id,
        height: Math.max(40, Math.floor(stableAsset.height * 0.18)),
        imageHeight: stableAsset.height,
        imageWidth: stableAsset.width,
        personId: person.id,
        width: Math.max(40, Math.floor(stableAsset.width * 0.14)),
        x: Math.floor(stableAsset.width * (0.12 + index * 0.35)),
        y: Math.floor(stableAsset.height * 0.18),
      },
      token: login.accessToken,
    });
  }
}

const limitedMutation = await fetch(`${apiRoot}/assets/${upload.id}`, {
  method: "PUT",
  headers: {
    "content-type": "application/json",
    "x-api-key": key.secret,
  },
  body: JSON.stringify({ isFavorite: true }),
});
assert.equal(limitedMutation.status, 403);

await writeFile(
  receiptPath,
  `${JSON.stringify({
    apiKey: key.secret,
    apiKeyId: key.apiKey.id,
    assetId: upload.id,
    fixtureBytes: fixture.length,
    fixtureSha256: fixtureDigest,
    immichVersion: "3.0.3",
    permissions: IMMICH_READ_ONLY_COMPANION_PERMISSIONS,
    peopleFixture: withOnboardingPeopleFixture
      ? { labelled: 1, unlabelled: 1 }
      : null,
    stableAssetRevision: createHash("sha256")
      .update(stableAssetRevision)
      .digest("hex"),
  })}\n`,
  { mode: 0o600 },
);
await chmod(receiptPath, 0o600);

process.stdout.write(
  `${JSON.stringify({
    assetId: upload.id,
    fixtureBytes: fixture.length,
    fixtureSha256: fixtureDigest,
    immichVersion: "3.0.3",
    limitedKeyMutationDenied: true,
    peopleFixture: withOnboardingPeopleFixture
      ? { labelled: 1, unlabelled: 1 }
      : null,
    permissions: IMMICH_READ_ONLY_COMPANION_PERMISSIONS,
    stableAssetObservations: stableObservations,
    status: "READY",
  })}\n`,
);
