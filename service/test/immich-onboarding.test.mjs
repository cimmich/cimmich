import assert from "node:assert/strict";
import test from "node:test";
import {
  IMMICH_ONBOARDING_SCHEMA_VERSION,
  createImmichOnboarding,
  duplicateImmichPersonNames,
  normalizeImmichOnboardingScope,
  projectUnlabelledPersonClusters,
  reconcileImmichFacesByGeometry,
} from "../src/immich-onboarding.mjs";

const sourceFace = (id, box, personId = "source-person-1") => ({
  box,
  id,
  person: personId
    ? {
        id: personId,
        isHidden: false,
        name: "Fixture Person",
        sourceRevision: "b".repeat(64),
      }
    : null,
  personId,
  sourceRevision: "a".repeat(64),
});

const verifiedOnboardingPermissions = async () => ({
  capabilities: {
    assetRead: true,
    assetSearch: true,
    faceRead: true,
    mediaRead: false,
    personList: true,
    personRead: true,
  },
  permissionVerification: "verified",
  permissions: {
    assetSearch: "verified",
    faceRead: "verified",
    mediaRead: "deferred_until_optional_provider_run",
    peopleRead: "verified",
    sourceWrite: "none",
  },
});

test("onboarding scope is closed, deterministic and provider-optional", () => {
  assert.deepEqual(normalizeImmichOnboardingScope(), {
    importPeople: true,
    includeHiddenPeople: false,
    mediaKinds: ["image", "video"],
    providerMode: "deferred",
    visibilities: ["timeline"],
  });
  assert.throws(
    () => normalizeImmichOnboardingScope({ exif: true }),
    (error) => error.code === "IMMICH_ONBOARDING_SCOPE_INVALID",
  );
  assert.throws(
    () =>
      normalizeImmichOnboardingScope({
        visibilities: ["timeline", "timeline"],
      }),
    (error) => error.code === "IMMICH_ONBOARDING_SCOPE_INVALID",
  );
});

test("distinct upstream People with one display name fail the name-reuse seam", () => {
  const collisions = duplicateImmichPersonNames([
    sourceFace(
      "source-face-1",
      { h: 0.2, w: 0.2, x: 0.1, y: 0.1 },
      "source-person-1",
    ),
    {
      ...sourceFace(
        "source-face-2",
        { h: 0.2, w: 0.2, x: 0.5, y: 0.1 },
        "source-person-2",
      ),
      person: {
        id: "source-person-2",
        isHidden: false,
        name: "Fixture Person",
        sourceRevision: "c".repeat(64),
      },
    },
  ]);
  assert.deepEqual([...collisions], ["fixture person"]);
});

test("geometry reconciliation binds only unique high-overlap provider Faces", () => {
  const exact = reconcileImmichFacesByGeometry({
    providerFaces: [
      { box: { h: 0.2, w: 0.2, x: 0.1, y: 0.1 }, id: "provider-1" },
      { box: { h: 0.2, w: 0.2, x: 0.6, y: 0.1 }, id: "provider-2" },
    ],
    sourceFaces: [
      { box: { h: 0.2, w: 0.2, x: 0.1, y: 0.1 }, id: "source-1" },
      { box: { h: 0.2, w: 0.2, x: 0.6, y: 0.1 }, id: "source-2" },
    ],
  });
  assert.equal(exact.get("source-1").providerFaceId, "provider-1");
  assert.equal(exact.get("source-2").providerFaceId, "provider-2");

  const ambiguous = reconcileImmichFacesByGeometry({
    providerFaces: [
      { box: { h: 0.2, w: 0.2, x: 0.1, y: 0.1 }, id: "provider-1" },
    ],
    sourceFaces: [
      { box: { h: 0.2, w: 0.2, x: 0.1, y: 0.1 }, id: "source-1" },
      { box: { h: 0.2, w: 0.2, x: 0.105, y: 0.1 }, id: "source-2" },
    ],
  });
  assert.equal(ambiguous.get("source-1").state, "ambiguous");
  assert.equal(ambiguous.get("source-2").state, "ambiguous");
});

test("preview counts assigned source truth without media, names or Locked leakage", async () => {
  const companion = {
    listAssetFaces: async () => ({
      assetId: "source-asset-1",
      items: [
        sourceFace("source-face-1", { h: 0.2, w: 0.2, x: 0.1, y: 0.1 }),
        sourceFace("source-face-2", { h: 0.2, w: 0.2, x: 0.5, y: 0.1 }, null),
      ],
    }),
    listAssets: async ({ visibility }) =>
      visibility === "locked"
        ? {
            accessState: "elevated_session_required",
            items: [],
            nextCursor: null,
            visibility,
          }
        : {
            items: [
              {
                assetType: "image",
                immichAssetId: "source-asset-1",
                inputRevision: "c".repeat(64),
                visibility,
              },
            ],
            nextCursor: null,
          },
    listPeople: async () => ({
      items: [
        {
          id: "source-person-1",
          isHidden: false,
          name: "Fixture Person",
          sourceRevision: "b".repeat(64),
        },
      ],
      nextCursor: null,
    }),
    status: async () => ({
      capabilities: { mediaRead: true },
      immichVersion: "3.0.3",
      principal: { userId: "owner-fixture" },
      state: "ready",
    }),
    verifyOnboardingPermissions: verifiedOnboardingPermissions,
  };
  const onboarding = createImmichOnboarding({
    companion,
    immichInventory: { synchronize: async () => ({}) },
    sql: async () => [],
  });
  const preview = await onboarding.preview({ viewingMode: "Standard" });
  assert.equal(preview.schemaVersion, IMMICH_ONBOARDING_SCHEMA_VERSION);
  assert.equal(preview.connection.permissionVerification, "verified");
  assert.equal(preview.counts.assignedFaces, 1);
  assert.equal(preview.counts.labelledPeople, 1);
  assert.equal(preview.counts.unlabelledPeople, 0);
  assert.equal(preview.counts.unassignedFaces, 1);
  assert.deepEqual(preview.coverage.visibilityLanes.timeline, {
    accessState: "available",
    itemCount: 1,
  });
  assert.equal(JSON.stringify(preview).includes("Fixture Person"), false);
  await assert.rejects(
    onboarding.preview({
      scope: { visibilities: ["hidden"] },
      viewingMode: "Standard",
    }),
    (error) => error.code === "IMMICH_ONBOARDING_SCOPE_NOT_VISIBLE",
  );
});

test("unlabelled upstream People preview honestly and block identity import before writes", async () => {
  let transactionCalls = 0;
  const anonymousPerson = {
    id: "source-person-anonymous",
    isHidden: false,
    name: null,
    sourceRevision: "d".repeat(64),
  };
  const companion = {
    listAssetFaces: async () => ({
      assetId: "source-asset-1",
      items: [
        {
          ...sourceFace(
            "source-face-1",
            { h: 0.2, w: 0.2, x: 0.1, y: 0.1 },
            anonymousPerson.id,
          ),
          person: anonymousPerson,
        },
      ],
    }),
    listAssets: async ({ visibility }) => ({
      items: [
        {
          assetType: "image",
          immichAssetId: "source-asset-1",
          inputRevision: "c".repeat(64),
          visibility,
        },
      ],
      nextCursor: null,
    }),
    listPeople: async () => ({
      items: [anonymousPerson],
      nextCursor: null,
    }),
    status: async () => ({
      capabilities: { mediaRead: true },
      immichVersion: "3.0.3",
      principal: { userId: "owner-fixture" },
      state: "ready",
    }),
    verifyOnboardingPermissions: verifiedOnboardingPermissions,
  };
  const sql = async () => [];
  sql.begin = async () => {
    transactionCalls += 1;
  };
  const onboarding = createImmichOnboarding({
    companion,
    immichInventory: { synchronize: async () => ({}) },
    sql,
  });
  const preview = await onboarding.preview({ viewingMode: "Standard" });
  assert.equal(preview.counts.assignedFaces, 1);
  assert.equal(preview.counts.labelledPeople, 0);
  assert.equal(preview.counts.unlabelledPeople, 1);
  await assert.rejects(
    onboarding.importCurrent({
      actorId: "owner",
      commandId: "anonymous-import-1",
      previewDigest: preview.previewDigest,
      scope: {},
      viewingMode: "Standard",
    }),
    (error) =>
      error.code === "IMMICH_ONBOARDING_PERSON_LABEL_REQUIRED" &&
      error.details.unlabelledAssignedFaces === 1,
  );
  assert.equal(transactionCalls, 0);
});

test("unnamed cluster preview is deterministic and contains only one visible representative", () => {
  const person = {
    id: "source-person-anonymous",
    isHidden: false,
    name: null,
    sourceRevision: "d".repeat(64),
  };
  const asset = {
    assetType: "image",
    immichAssetId: "source-asset-1",
    inputRevision: "c".repeat(64),
    visibility: "timeline",
  };
  const first = {
    ...sourceFace(
      "source-face-b",
      { h: 0.2, w: 0.2, x: 0.4, y: 0.1 },
      person.id,
    ),
    person,
  };
  const second = {
    ...sourceFace(
      "source-face-a",
      { h: 0.2, w: 0.2, x: 0.1, y: 0.1 },
      person.id,
    ),
    person,
  };
  const projected = projectUnlabelledPersonClusters({
    assets: [asset],
    facesByAsset: new Map([[asset.immichAssetId, [first, second]]]),
  });

  assert.equal(projected.length, 1);
  assert.equal(projected[0].faceCount, 2);
  assert.equal(projected[0].representative.faceId, "source-face-a");
  assert.match(projected[0].snapshotDigest, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(projected).includes("name"), false);
});

test("status exposes only non-secret exact resume bindings", async () => {
  const sql = async () => [
    {
      command_id: "onboarding-import-resume-1",
      completed_at: null,
      preview_digest: "a".repeat(64),
      progress: { processedAssets: 3, requestDigest: "b".repeat(64) },
      result: null,
      run_id: "immich_onboarding_" + "1".repeat(32),
      scope: normalizeImmichOnboardingScope(),
      started_at: "2026-07-21T00:00:00.000Z",
      state: "interrupted",
      updated_at: "2026-07-21T00:01:00.000Z",
    },
  ];
  const onboarding = createImmichOnboarding({
    companion: {
      listAssetFaces: async () => ({ items: [] }),
      listPeople: async () => ({ items: [], nextCursor: null }),
      status: async () => ({ state: "ready" }),
      verifyOnboardingPermissions: verifiedOnboardingPermissions,
    },
    immichInventory: { synchronize: async () => ({}) },
    sql,
  });

  const status = await onboarding.status();
  assert.equal(status.next, "resume_import");
  assert.equal(status.latestRun.commandId, "onboarding-import-resume-1");
  assert.equal(status.latestRun.previewDigest, "a".repeat(64));
  assert.deepEqual(status.latestRun.scope, normalizeImmichOnboardingScope());
  assert.equal(JSON.stringify(status).includes("credential"), false);
});

test("status does not advertise preview when the bounded permission probe fails", async () => {
  const onboarding = createImmichOnboarding({
    companion: {
      listAssetFaces: async () => ({ items: [] }),
      listPeople: async () => ({ items: [], nextCursor: null }),
      status: async () => ({
        capabilities: {
          assetRead: false,
          assetSearch: false,
          faceRead: false,
          mediaRead: false,
          personList: false,
          personRead: false,
        },
        principal: { userId: "owner-fixture" },
        state: "ready",
      }),
      verifyOnboardingPermissions: async () => {
        throw Object.assign(new Error("redacted"), {
          code: "IMMICH_COMPANION_AUTH_FAILED",
        });
      },
    },
    immichInventory: { synchronize: async () => ({}) },
    sql: async () => [],
  });
  const status = await onboarding.status();
  assert.equal(status.connection.state, "unauthorized");
  assert.equal(status.connection.permissionVerification, "failed");
  assert.equal(status.next, "connect");
  assert.equal(
    Object.values(status.connection.capabilities).some(Boolean),
    false,
  );
  assert.equal(JSON.stringify(status).includes("redacted"), false);
});
