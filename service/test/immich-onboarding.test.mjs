import assert from "node:assert/strict";
import test from "node:test";
import {
  IMMICH_ONBOARDING_SCHEMA_VERSION,
  createImmichOnboarding,
  duplicateImmichPersonNames,
  isCurrentFinalPersonResolution,
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

test("unlabelled Face clusters omitted from the People list still preview as held identity work", async () => {
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
      items: [],
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
  const onboarding = createImmichOnboarding({
    companion,
    immichInventory: { synchronize: async () => ({}) },
    sql,
  });
  const preview = await onboarding.preview({ viewingMode: "Standard" });
  assert.equal(preview.counts.assignedFaces, 1);
  assert.equal(preview.counts.people, 1);
  assert.equal(preview.counts.labelledPeople, 0);
  assert.equal(preview.counts.unlabelledPeople, 1);
});

const createAnonymousImportHarness = ({ resolutionAction = null } = {}) => {
  const anonymousPerson = {
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
  const face = {
    ...sourceFace(
      "source-face-1",
      { h: 0.2, w: 0.2, x: 0.1, y: 0.1 },
      anonymousPerson.id,
    ),
    person: anonymousPerson,
  };
  const [cluster] = projectUnlabelledPersonClusters({
    assets: [asset],
    facesByAsset: new Map([[asset.immichAssetId, [face]]]),
  });
  const queries = [];
  let transactionCalls = 0;
  const run = {
    actor_id: "owner",
    command_id: "anonymous-import-1",
    preview_digest: null,
    principal_id: "owner-fixture",
    progress: {},
    run_id: "immich_onboarding_" + "1".repeat(32),
    state: "importing",
  };
  const execute = async (strings, values = []) => {
    const query = strings
      .reduce(
        (rendered, part, index) =>
          `${rendered}${part}${index < values.length ? ` ${String(values[index])} ` : ""}`,
        "",
      )
      .replaceAll(/\s+/g, " ")
      .trim();
    queries.push(query);
    if (query.includes("FROM immich_person_resolution resolution")) {
      return resolutionAction
        ? [
            {
              decision_id: "decision-owner-resolution",
              display_name: ["existing_person", "create_person"].includes(
                resolutionAction,
              )
                ? "Resolved Person"
                : null,
              immich_person_id: anonymousPerson.id,
              person_id: ["existing_person", "create_person"].includes(
                resolutionAction,
              )
                ? "person-resolved"
                : null,
              resolution_action: resolutionAction,
              snapshot_digest: cluster.snapshotDigest,
              source_revision: cluster.sourceRevision,
            },
          ]
        : [];
    }
    if (
      query.includes(
        "SELECT * FROM immich_onboarding_run WHERE command_id",
      )
    ) {
      return [];
    }
    if (
      query.includes("FROM immich_asset_projection") &&
      query.includes("immich_asset_id = ANY")
    ) {
      return [];
    }
    if (
      query.includes("FROM immich_face_projection") &&
      query.includes("immich_face_id = ANY")
    ) {
      return [];
    }
    if (
      query.includes("FROM immich_person_projection") &&
      query.includes("immich_person_id = ANY")
    ) {
      return [];
    }
    if (
      query.includes("INSERT INTO immich_onboarding_run") ||
      (query.includes("UPDATE immich_onboarding_run SET state = 'importing'") &&
        query.includes("RETURNING *"))
    ) {
      return [run];
    }
    if (
      query.includes("FROM immich_asset_projection") &&
      query.includes("FOR SHARE")
    ) {
      return [
        {
          cimmich_asset_id: "asset-fixture",
          input_revision: asset.inputRevision,
          state: "active",
        },
      ];
    }
    if (query.includes("SELECT DISTINCT ON (face.face_id)")) return [];
    if (
      query.includes(
        "SELECT source_revision, asset_input_revision, state FROM immich_face_projection",
      )
    ) {
      return [];
    }
    if (query.includes("SELECT claim.identity_claim_id")) return [];
    if (
      query.includes(
        "count(*) FILTER (WHERE face.immich_person_id IS NOT NULL)",
      )
    ) {
      const resolvedPerson = ["existing_person", "create_person"].includes(
        resolutionAction,
      );
      return [
        {
          ambiguous: 0,
          assigned_faces: resolutionAction ? 1 : 0,
          exact_provider_binds: 0,
          imported_source_faces:
            resolutionAction === "unknown" || resolvedPerson ? 1 : 0,
          person_conflicts: 0,
          projected_people: resolvedPerson ? 1 : 0,
          review_items: resolutionAction === "noise" ? 0 : 1,
          unassigned_faces: 0,
        },
      ];
    }
    return [];
  };
  const sql = async (strings, ...values) => execute(strings, values);
  sql.json = (value) => value;
  sql.begin = async (callback) => {
    transactionCalls += 1;
    const tx = async (strings, ...values) => execute(strings, values);
    tx.json = (value) => value;
    return callback(tx);
  };
  const companion = {
    listAssetFaces: async () => ({
      assetId: asset.immichAssetId,
      items: [face],
    }),
    listAssets: async () => ({ items: [asset], nextCursor: null }),
    listPeople: async () => ({ items: [], nextCursor: null }),
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
    immichInventory: {
      synchronize: async () => ({
        run: { runId: "inventory-fixture" },
        source: { activeAssets: 1 },
      }),
    },
    sql,
  });
  return {
    get transactionCalls() {
      return transactionCalls;
    },
    onboarding,
    queries,
    run,
  };
};

test("unnamed identity questions are recorded without blocking the import transaction", async () => {
  const harness = createAnonymousImportHarness();
  const preview = await harness.onboarding.preview({
    viewingMode: "Standard",
  });
  harness.run.preview_digest = preview.previewDigest;
  const result = await harness.onboarding.importCurrent({
    actorId: "owner",
    commandId: "anonymous-import-1",
    previewDigest: preview.previewDigest,
    scope: {},
    viewingMode: "Standard",
  });

  assert.equal(harness.transactionCalls, 1);
  assert.equal(result.state, "completed_with_review");
  assert.equal(result.import.reviewItems, 1);
  assert.equal(
    harness.queries.some(
      (query) =>
        query.includes("INSERT INTO immich_onboarding_review_item") &&
        query.includes("source_person_resolution_required"),
    ),
    true,
  );
  assert.equal(
    harness.queries.some((query) => query.includes("INSERT INTO person (")),
    false,
  );
  assert.equal(
    harness.queries.some((query) =>
      query.includes("INSERT INTO identity_claim"),
    ),
    false,
  );
});

test("final owner resolutions drive the bounded anonymous import branches", async () => {
  for (const resolutionAction of [
    "existing_person",
    "create_person",
    "unknown",
    "noise",
  ]) {
    const harness = createAnonymousImportHarness({ resolutionAction });
    const preview = await harness.onboarding.preview({
      viewingMode: "Standard",
    });
    harness.run.preview_digest = preview.previewDigest;
    const result = await harness.onboarding.importCurrent({
      actorId: "owner",
      commandId: "anonymous-import-1",
      previewDigest: preview.previewDigest,
      scope: {},
      viewingMode: "Standard",
    });
    const identityExpected = ["existing_person", "create_person"].includes(
      resolutionAction,
    );

    assert.equal(harness.transactionCalls, 1, resolutionAction);
    assert.equal(result.import.assignedFaces, 1, resolutionAction);
    assert.equal(
      harness.queries.some((query) =>
        query.includes("INSERT INTO identity_claim"),
      ),
      identityExpected,
      resolutionAction,
    );
    assert.equal(
      harness.queries.some((query) =>
        query.includes("source_person_resolution_required"),
      ),
      false,
      resolutionAction,
    );
  }
});

test("only an exact final owner resolution can admit unnamed identity truth", () => {
  const cluster = {
    immichPersonId: "source-person-anonymous",
    snapshotDigest: "a".repeat(64),
    sourceRevision: "b".repeat(64),
  };
  const current = {
    display_name: "Fixture Person",
    person_id: "person-fixture",
    resolution_action: "existing_person",
    snapshot_digest: cluster.snapshotDigest,
    source_revision: cluster.sourceRevision,
  };
  assert.equal(isCurrentFinalPersonResolution(cluster, current), true);
  assert.equal(
    isCurrentFinalPersonResolution(cluster, {
      ...current,
      resolution_action: "later",
    }),
    false,
  );
  assert.equal(
    isCurrentFinalPersonResolution(cluster, {
      ...current,
      snapshot_digest: "c".repeat(64),
    }),
    false,
  );
  assert.equal(
    isCurrentFinalPersonResolution(cluster, {
      ...current,
      display_name: null,
    }),
    false,
  );
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

test("import failure diagnostics never log database values or exception messages", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../src/immich-onboarding.mjs", import.meta.url), "utf8"),
  );
  const failureLog = source.match(
    /console\.error\(\s*JSON\.stringify\(\{[\s\S]*?IMMICH_ONBOARDING_IMPORT_FAILURE[\s\S]*?\}\),\s*\);/,
  )?.[0];
  assert.ok(failureLog);
  assert.doesNotMatch(failureLog, /error\.message|String\(error\)/);
  assert.match(failureLog, /UNEXPECTED_FAILURE/);
});
