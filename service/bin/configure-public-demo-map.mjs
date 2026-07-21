#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  publicDemoGpsForAsset,
  publicDemoImmichMapSchemaVersion,
} from "../src/public-demo-bootstrap.mjs";

const apiRoot = String(process.env.IMMICH_API_URL || "").replace(/\/+$/, "");
const email = String(process.env.CIMMICH_DEMO_ADMIN_EMAIL || "").trim();
const password = String(process.env.CIMMICH_DEMO_ADMIN_PASSWORD || "");
const mapPath = path.resolve(
  String(process.env.CIMMICH_DEMO_IMMICH_MAP_PATH || "").trim(),
);
if (!apiRoot || !email || password.length < 12 || !mapPath) {
  throw new Error("Public demo map configuration is incomplete");
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
    throw Object.assign(new Error("Public demo Immich map request failed"), {
      code: "PUBLIC_DEMO_MAP_REQUEST_FAILED",
      statusCode: response.status,
    });
  }
  return payload;
};

const immichMap = JSON.parse(await readFile(mapPath, "utf8"));
assert.equal(immichMap.schemaVersion, publicDemoImmichMapSchemaVersion);
assert.equal(immichMap.source, "immich_api_upload");
assert.equal(immichMap.assets.length, 50);
assert.equal(new Set(immichMap.assets.map((asset) => asset.assetId)).size, 50);

const login = await requestJson("/auth/login", { body: { email, password } });
assert.equal(typeof login.accessToken, "string");
const systemConfig = await requestJson("/system-config", {
  method: "GET",
  token: login.accessToken,
});
const configured = await requestJson("/system-config", {
  body: {
    ...systemConfig,
    map: { ...systemConfig.map, enabled: true },
    newVersionCheck: { ...systemConfig.newVersionCheck, enabled: false },
    reverseGeocoding: { ...systemConfig.reverseGeocoding, enabled: false },
  },
  method: "PUT",
  token: login.accessToken,
});

let changedAssetCount = 0;
let gpsAssetCount = 0;
for (const asset of immichMap.assets) {
  const gps = publicDemoGpsForAsset(asset.assetId);
  if (!gps) continue;
  gpsAssetCount += 1;
  const current = await requestJson(`/assets/${asset.immichAssetId}`, {
    method: "GET",
    token: login.accessToken,
  });
  if (
    current.exifInfo?.latitude !== gps.latitude ||
    current.exifInfo?.longitude !== gps.longitude
  ) {
    await requestJson(`/assets/${asset.immichAssetId}`, {
      body: gps,
      method: "PUT",
      token: login.accessToken,
    });
    changedAssetCount += 1;
  }
  const projected = await requestJson(`/assets/${asset.immichAssetId}`, {
    method: "GET",
    token: login.accessToken,
  });
  assert.equal(projected.exifInfo?.latitude, gps.latitude);
  assert.equal(projected.exifInfo?.longitude, gps.longitude);
}

assert.equal(gpsAssetCount, 45);
assert.equal(configured.map.enabled, true);
assert.equal(configured.reverseGeocoding.enabled, false);
process.stdout.write(
  `${JSON.stringify({
    changedAssetCount,
    gpsAssetCount,
    mapEnabled: true,
    reverseGeocodingEnabled: false,
    schemaVersion: "cimmich.public-demo-map-configuration.v1",
    status: "READY",
  })}\n`,
);
