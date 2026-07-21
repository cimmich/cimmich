import assert from "node:assert/strict";
import { currentSchemaVersion } from "./current-schema.mjs";

const root = process.env.CIMMICH_ACCEPTANCE_URL || "http://127.0.0.1:3101";
const personId = "person_projection_perf_fixture";

const timedJson = async (path) => {
  const started = performance.now();
  const response = await fetch(`${root}${path}`);
  const elapsedMs = performance.now() - started;
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  return { elapsedMs, payload };
};

const health = await timedJson("/health");
assert.equal(health.payload.schemaVersion, await currentSchemaVersion());

const photoHistoryRead = await timedJson(
  "/v1/people/person_photo_history_fixture",
);
assert.equal(photoHistoryRead.payload.asset_count, 3);
assert.deepEqual(
  {
    futureCaptureDateCount:
      photoHistoryRead.payload.photo_history.futureCaptureDateCount,
    maxCaptureTime: new Date(
      photoHistoryRead.payload.photo_history.maxCaptureTime,
    ).toISOString(),
    minCaptureTime: new Date(
      photoHistoryRead.payload.photo_history.minCaptureTime,
    ).toISOString(),
    schemaVersion: photoHistoryRead.payload.photo_history.schemaVersion,
  },
  {
    futureCaptureDateCount: 1,
    maxCaptureTime: "2020-05-06T07:08:09.000Z",
    minCaptureTime: "2020-05-06T07:08:09.000Z",
    schemaVersion: "cimmich.person-photo-history.v1",
  },
);

const visibilityHeaders = {
  "content-type": "application/json",
  "x-cimmich-actor": "synthetic-photo-history",
  "x-cimmich-device-id": "synthetic-photo-history-device",
  "x-cimmich-principal-id": "local-primary",
};
const tierResponse = await fetch(`${root}/v1/visibility/objects`, {
  body: JSON.stringify({
    commandId: "photo-history-visibility-fixture-a",
    objects: [
      {
        objectId: "asset_photo_history_past",
        objectScope: "asset",
        visibilityTier: "personal",
      },
      {
        objectId: "asset_photo_history_future",
        objectScope: "asset",
        visibilityTier: "personal",
      },
    ],
  }),
  headers: visibilityHeaders,
  method: "PATCH",
});
assert.equal(tierResponse.status, 200, await tierResponse.text());
const standardPhotoHistoryResponse = await fetch(
  `${root}/v1/people/person_photo_history_fixture`,
  { headers: visibilityHeaders },
);
const standardPhotoHistory = await standardPhotoHistoryResponse.json();
assert.equal(standardPhotoHistoryResponse.status, 200);
assert.equal(standardPhotoHistory.asset_count, 1);
assert.deepEqual(standardPhotoHistory.photo_history, {
  futureCaptureDateCount: 0,
  maxCaptureTime: null,
  minCaptureTime: null,
  schemaVersion: "cimmich.person-photo-history.v1",
});
const modeResponse = await fetch(`${root}/v1/visibility/mode`, {
  body: JSON.stringify({ viewingMode: "personal" }),
  headers: visibilityHeaders,
  method: "POST",
});
assert.equal(modeResponse.status, 200, await modeResponse.text());
const personalPhotoHistoryResponse = await fetch(
  `${root}/v1/people/person_photo_history_fixture`,
  { headers: visibilityHeaders },
);
const personalPhotoHistory = await personalPhotoHistoryResponse.json();
assert.equal(personalPhotoHistoryResponse.status, 200);
assert.equal(personalPhotoHistory.asset_count, 3);
assert.equal(personalPhotoHistory.photo_history.futureCaptureDateCount, 1);
assert.equal(
  new Date(personalPhotoHistory.photo_history.minCaptureTime).toISOString(),
  "2020-05-06T07:08:09.000Z",
);

const personReads = [];
for (let index = 0; index < 3; index += 1) {
  personReads.push(await timedJson(`/v1/people/${personId}`));
}
const personDurations = personReads.map(({ elapsedMs }) => elapsedMs);
const person = personReads.at(-1).payload;
assert.equal(person.accepted_faces, 2500);
assert.equal(person.asset_count, 1);
assert.equal(person.prime_faces, 2500);
assert.equal(person.secondary_faces, 0);
assert.equal(person.head_faces, 0);
assert.equal(person.representative_asset_id, "asset_projection_perf_fixture");
assert.equal(person.representative_face_id, "face_projection_perf_00001");
assert.ok(
  Math.max(...personDurations) < 1500,
  `Person overview exceeded 1500ms: ${personDurations.join(", ")}`,
);

const assetReads = [];
for (let index = 0; index < 3; index += 1) {
  assetReads.push(await timedJson(`/v1/people/${personId}/assets?limit=5000`));
}
const assetDurations = assetReads.map(({ elapsedMs }) => elapsedMs);
const assets = assetReads.at(-1).payload.items;
assert.equal(assets.length, 1);
assert.deepEqual(assets[0].association_types, ["face"]);
assert.ok(
  Math.max(...assetDurations) < 750,
  `Person assets exceeded 750ms: ${assetDurations.join(", ")}`,
);

const assetPage = await timedJson(`/v1/people/${personId}/assets?pageSize=24`);
assert.equal(
  assetPage.payload.schemaVersion,
  "cimmich.person-projection-page.v1",
);
assert.equal(assetPage.payload.items.length, 1);
assert.equal(assetPage.payload.nextCursor, null);

const firstIdentityPage = await timedJson(
  `/v1/people/${personId}/identity?pageSize=24`,
);
assert.equal(
  firstIdentityPage.payload.schemaVersion,
  "cimmich.person-projection-page.v1",
);
assert.equal(firstIdentityPage.payload.pageSize, 24);
assert.equal(firstIdentityPage.payload.items.length, 24);
assert.ok(firstIdentityPage.payload.nextCursor);
assert.ok(
  firstIdentityPage.elapsedMs < 1000,
  `First Identity page exceeded 1000ms: ${firstIdentityPage.elapsedMs}`,
);

const secondIdentityPage = await timedJson(
  `/v1/people/${personId}/identity?pageSize=24&cursor=${encodeURIComponent(firstIdentityPage.payload.nextCursor)}`,
);
assert.equal(secondIdentityPage.payload.items.length, 24);
assert.ok(secondIdentityPage.payload.nextCursor);
assert.ok(
  secondIdentityPage.elapsedMs < 1000,
  `Second Identity page exceeded 1000ms: ${secondIdentityPage.elapsedMs}`,
);
const firstFaceIds = new Set(
  firstIdentityPage.payload.items.map((item) => item.face_id),
);
assert.equal(
  secondIdentityPage.payload.items.some((item) =>
    firstFaceIds.has(item.face_id),
  ),
  false,
);

const crossedCursorResponse = await fetch(
  `${root}/v1/people/person_service_fixture/identity?pageSize=24&cursor=${encodeURIComponent(firstIdentityPage.payload.nextCursor)}`,
);
const crossedCursor = await crossedCursorResponse.json();
assert.equal(crossedCursorResponse.status, 400);
assert.equal(crossedCursor.code, "PERSON_PAGE_CURSOR_INVALID");

console.log(
  JSON.stringify({
    assetDurationsMs: assetDurations.map((value) => Number(value.toFixed(1))),
    identityPageDurationsMs: [firstIdentityPage, secondIdentityPage].map(
      ({ elapsedMs }) => Number(elapsedMs.toFixed(1)),
    ),
    personDurationsMs: personDurations.map((value) => Number(value.toFixed(1))),
    schemaVersion: health.payload.schemaVersion,
    status: "PASS",
  }),
);
