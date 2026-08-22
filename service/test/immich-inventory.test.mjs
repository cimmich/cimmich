import assert from "node:assert/strict";
import test from "node:test";
import {
  cimmichAssetIdForImmich,
  createImmichInventorySynchronizer,
  normalizeInventoryJob,
  normalizeInventoryPage,
  projectInventoryCoverage,
  selectReusableByteFingerprints,
} from "../src/immich-inventory.mjs";

const asset = (overrides = {}) => ({
  assetType: "image",
  captureTime: "2026-01-01T00:00:00.000Z",
  checksum: "synthetic-checksum",
  height: 800,
  immichAssetId: "immich-asset-1",
  inputRevision: "a".repeat(64),
  isArchived: false,
  isFavorite: false,
  isOffline: false,
  isTrashed: false,
  originalMimeType: "image/jpeg",
  originalFileName: "synthetic.jpg",
  ownerId: "synthetic-owner",
  updatedAt: "2026-01-02T00:00:00.000Z",
  visibility: "timeline",
  width: 1200,
  ...overrides,
});

test("catalogue-presence inventory alone requests soft-deleted rows", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../src/immich-inventory.mjs", import.meta.url), "utf8"),
  );
  const reconciliationSource = await import("node:fs/promises").then(
    ({ readFile }) =>
      readFile(
        new URL("../src/immich-inventory-reconciliation.mjs", import.meta.url),
        "utf8",
      ),
  );
  assert.match(
    source,
    /companion\.listAssets\(\{[\s\S]+includeDeleted: cataloguePresenceOnly,[\s\S]+visibility/,
  );
  assert.match(
    source,
    /cataloguePresenceOnly\s*\?\s*"recordCataloguePresencePage"/,
  );
  assert.match(source, /!cataloguePresenceOnly &&\s*resumedRun/);
  assert.match(
    reconciliationSource,
    /UPDATE asset_source_binding binding SET[\s\S]+FROM archive_missing_file_command retirement/,
  );
});

test("provider-disabled inventory admits projections without manufacturing media jobs", () => {
  assert.equal(normalizeInventoryJob(null), null);
  assert.deepEqual(
    normalizeInventoryJob({
      configDigest: "7".repeat(64),
      maxAttempts: 3,
      operation: "detect_and_recognize",
      toolVersion: "synthetic-provider-v1",
    }),
    {
      configDigest: "7".repeat(64),
      maxAttempts: 3,
      operation: "detect_and_recognize",
      toolVersion: "synthetic-provider-v1",
    },
  );
  assert.throws(
    () =>
      normalizeInventoryJob({
        configDigest: "",
        operation: "detect_and_recognize",
        toolVersion: "",
      }),
    /job.configDigest/,
  );
  assert.throws(
    () =>
      createImmichInventorySynchronizer({
        companion: {
          listAssets: async () => ({}),
          status: async () => ({ state: "ready" }),
        },
        reuseVerifiedFingerprints: true,
        sql: {},
      }),
    /fingerprint reuse requires byte verification/,
  );
});

test("bounded current-job batches re-scan assets with existing faces but skip exact detector work", async () => {
  const queries = [];
  const transaction = async (strings, ...values) => {
    queries.push({
      text: strings.join("?"),
      values,
    });
    if (queries.length === 1) {
      return [
        {
          accepted_association_count: 2,
          accepted_person_count: 1,
          asset_id: "asset-new",
          human_observation_count: 3,
          input_revision: "8".repeat(64),
          priority_tier: 0,
        },
      ];
    }
    return [];
  };
  const sql = {
    begin: async (callback) => callback(transaction),
  };
  const inventory = createImmichInventorySynchronizer({
    companion: {
      listAssets: async () => ({
        accessState: "available",
        items: [],
        nextCursor: null,
      }),
      status: async () => ({ state: "ready" }),
    },
    job: {
      configDigest: "7".repeat(64),
      maxAttempts: 3,
      operation: "detect_faces",
      toolVersion: "synthetic-provider-v1",
    },
    sourceId: "archive-source",
    sql,
  });

  assert.deepEqual(
    await inventory.ensureCurrentJobs({
      limit: 25,
      priorityTierMax: 1,
    }),
    {
      eligibleAssets: 1,
      ensuredJobs: 1,
    },
  );
  assert.doesNotMatch(queries[0].text, /FROM face_observation/);
  assert.match(queries[0].text, /projection\.asset_type = 'image'/);
  assert.match(queries[0].text, /JOIN media_asset_triage triage/);
  assert.match(queries[0].text, /triage\.priority_tier/);
  assert.match(queries[0].text, /DISTINCT ON/);
  assert.match(queries[0].text, /NOT EXISTS[\s\S]+face_detection_result/);
  assert.match(queries[0].text, /NOT EXISTS[\s\S]+media_job/);
  assert.deepEqual(queries[0].values, [
    "archive-source",
    "7".repeat(64),
    "detect_faces",
    "7".repeat(64),
    1,
    25,
  ]);
  assert.match(queries[1].text, /enqueue_media_job/);
  assert.deepEqual(queries[1].values, [
    "asset-new",
    "detect_faces",
    "synthetic-provider-v1",
    "7".repeat(64),
    "8".repeat(64),
    3,
  ]);
});

test("stable Cimmich asset IDs isolate source and upstream asset identity", () => {
  const first = cimmichAssetIdForImmich({
    immichAssetId: "asset-1",
    sourceId: "source-a",
  });
  assert.equal(
    first,
    cimmichAssetIdForImmich({ immichAssetId: "asset-1", sourceId: "source-a" }),
  );
  assert.notEqual(
    first,
    cimmichAssetIdForImmich({ immichAssetId: "asset-1", sourceId: "source-b" }),
  );
  assert.match(first, /^asset_immich_[0-9a-f]{40}$/);
});

test("inventory reuses one exact byte-verified binding only while the source checksum is unchanged", () => {
  const contentDigest = "9".repeat(64);
  const normalizedAsset = (overrides = {}) => {
    const value = asset(overrides);
    return {
      ...value,
      sourceUpdatedAt: new Date(value.updatedAt).toISOString(),
    };
  };
  const matching = {
    byte_length: "1234",
    checksum: "synthetic-checksum",
    content_digest: contentDigest,
    hash_algorithm: "sha256",
    immich_asset_id: "immich-asset-1",
    source_updated_at: "2026-01-02T00:00:00.000Z",
    verification: "byte_verified",
  };
  const reusable = selectReusableByteFingerprints({
    assets: [
      normalizedAsset(),
      normalizedAsset({ immichAssetId: "changed", checksum: "new" }),
    ],
    rows: [
      matching,
      { ...matching },
      {
        ...matching,
        checksum: "old",
        immich_asset_id: "changed",
      },
    ],
  });
  assert.deepEqual(reusable.get("immich-asset-1"), {
    byteLength: 1234,
    contentDigest,
    hashAlgorithm: "sha256",
    verification: "byte_verified",
  });
  assert.equal(reusable.has("changed"), false);

  const sourceRevisionChanged = selectReusableByteFingerprints({
    assets: [normalizedAsset({ updatedAt: "2026-01-03T00:00:00.000Z" })],
    rows: [matching],
  });
  assert.equal(sourceRevisionChanged.has("immich-asset-1"), false);

  const ambiguous = selectReusableByteFingerprints({
    assets: [normalizedAsset()],
    rows: [matching, { ...matching, content_digest: "8".repeat(64) }],
  });
  assert.equal(ambiguous.has("immich-asset-1"), false);
});

test("inventory pages minimize owners and produce deterministic receipts", () => {
  const input = {
    cursor: "",
    page: { items: [asset()], nextCursor: "2", visibility: "timeline" },
    visibility: "timeline",
  };
  const first = normalizeInventoryPage(input);
  const second = normalizeInventoryPage(input);
  assert.equal(first.pageDigest, second.pageDigest);
  assert.equal(
    first.pageDigest,
    normalizeInventoryPage({
      ...input,
      page: { ...input.page, accessState: "available" },
    }).pageDigest,
  );
  assert.equal(first.items[0].ownerDigest.length, 64);
  assert.equal(JSON.stringify(first).includes("synthetic-owner"), false);
});

test("inventory treats upstream zero dimensions as unknown", () => {
  const normalized = normalizeInventoryPage({
    cursor: "",
    page: {
      items: [asset({ height: 0, width: 0 })],
      nextCursor: null,
      visibility: "timeline",
    },
    visibility: "timeline",
  });
  assert.equal(normalized.items[0].height, null);
  assert.equal(normalized.items[0].width, null);
  assert.throws(
    () =>
      normalizeInventoryPage({
        cursor: "",
        page: {
          items: [asset({ height: -1 })],
          nextCursor: null,
          visibility: "timeline",
        },
        visibility: "timeline",
      }),
    /asset.height must be a non-negative integer/,
  );
});

test("inventory pages reject visibility crossing, duplicate assets and cursor loops", () => {
  assert.throws(
    () =>
      normalizeInventoryPage({
        cursor: "",
        page: {
          items: [asset({ visibility: "archive" })],
          nextCursor: null,
          visibility: "timeline",
        },
        visibility: "timeline",
      }),
    /crossed visibility lanes/,
  );
  assert.throws(
    () =>
      normalizeInventoryPage({
        cursor: "",
        page: {
          items: [asset(), asset()],
          nextCursor: null,
          visibility: "timeline",
        },
        visibility: "timeline",
      }),
    /duplicate assets/,
  );
  assert.throws(
    () =>
      normalizeInventoryPage({
        cursor: "2",
        page: { items: [], nextCursor: "2", visibility: "timeline" },
        visibility: "timeline",
      }),
    /cursor did not advance/,
  );
});

test("Locked inventory is an explicit elevated coverage exclusion, not unfinished work", () => {
  const locked = normalizeInventoryPage({
    cursor: "",
    page: {
      accessState: "elevated_session_required",
      items: [],
      nextCursor: null,
      visibility: "locked",
    },
    visibility: "locked",
  });
  assert.equal(locked.accessState, "elevated_session_required");
  assert.throws(
    () =>
      normalizeInventoryPage({
        cursor: "",
        page: {
          accessState: "elevated_session_required",
          items: [],
          nextCursor: null,
          visibility: "timeline",
        },
        visibility: "timeline",
      }),
    /elevated access state is invalid/,
  );

  const coverage = projectInventoryCoverage({
    lanes: [
      {
        observedItemCount: 12,
        state: "completed",
        visibility: "timeline",
      },
      {
        observedItemCount: 0,
        state: "completed",
        visibility: "locked",
      },
    ],
    lockedAccessState: "elevated_session_required",
    selectedVisibilities: ["timeline", "locked"],
  });
  assert.equal(coverage.state, "complete_with_exclusions");
  assert.equal(coverage.complete, true);
  assert.deepEqual(
    coverage.lanes.find((lane) => lane.visibility === "locked"),
    {
      accessState: "elevated_session_required",
      inventoryState: "unavailable",
      observedItemCount: 0,
      selected: true,
      visibility: "locked",
    },
  );
  assert.equal(
    coverage.lanes.find((lane) => lane.visibility === "archive").inventoryState,
    "not_selected",
  );
  assert.equal(
    projectInventoryCoverage({
      lanes: [
        {
          observedItemCount: 1,
          state: "completed",
          visibility: "locked",
        },
      ],
      lockedAccessState: "available",
      selectedVisibilities: ["locked"],
    }).state,
    "complete",
  );
  const processingWithExclusion = projectInventoryCoverage({
    lanes: [
      {
        observedItemCount: 12,
        state: "completed",
        visibility: "timeline",
      },
      {
        observedItemCount: 0,
        state: "pending",
        visibility: "hidden",
      },
    ],
    lockedAccessState: "elevated_session_required",
    selectedVisibilities: ["timeline", "hidden", "locked"],
  });
  assert.equal(processingWithExclusion.state, "processing");
  assert.equal(processingWithExclusion.complete, false);
  assert.deepEqual(projectInventoryCoverage({ selectedVisibilities: [] }), {
    complete: false,
    lanes: [
      {
        accessState: "available",
        inventoryState: "not_selected",
        observedItemCount: 0,
        selected: false,
        visibility: "timeline",
      },
      {
        accessState: "available",
        inventoryState: "not_selected",
        observedItemCount: 0,
        selected: false,
        visibility: "archive",
      },
      {
        accessState: "available",
        inventoryState: "not_selected",
        observedItemCount: 0,
        selected: false,
        visibility: "hidden",
      },
      {
        accessState: "unknown",
        inventoryState: "not_selected",
        observedItemCount: 0,
        selected: false,
        visibility: "locked",
      },
    ],
    state: "not_started",
  });
});

test("inventory filenames are presentation-bounded without changing private owner minimization", () => {
  const normalized = normalizeInventoryPage({
    cursor: "",
    page: { items: [asset()], nextCursor: null, visibility: "timeline" },
    visibility: "timeline",
  });
  assert.equal(normalized.items[0].originalFileName, "synthetic.jpg");
  assert.throws(
    () =>
      normalizeInventoryPage({
        cursor: "",
        page: {
          items: [
            asset({ originalFileName: `unsafe\u0000${"x".repeat(501)}` }),
          ],
          nextCursor: null,
          visibility: "timeline",
        },
        visibility: "timeline",
      }),
    /originalFileName is invalid/,
  );
});

test("synchronize recovers stale processing runs before touching the companion", async () => {
  const staleSweeps = [];
  let companionProbed = false;
  const sql = async (strings, ...values) => {
    const query = strings.join("?");
    if (query.includes("fail_stale_immich_inventory_runs")) {
      staleSweeps.push(values);
      return [{ failed_count: 1 }];
    }
    throw new Error(`Unexpected query: ${query}`);
  };
  sql.begin = async (callback) => callback(sql);
  const inventory = createImmichInventorySynchronizer({
    companion: {
      listAssets: async () => ({ items: [], nextCursor: null }),
      status: async () => {
        companionProbed = true;
        return { state: "starting" };
      },
    },
    sourceId: "archive-source",
    sql,
  });

  // The wedged-run recovery must not depend on companion health: a stale
  // 'processing' run is failed even when the companion cannot serve a sync.
  await assert.rejects(
    inventory.synchronize(),
    (error) => error.code === "IMMICH_COMPANION_NOT_READY",
  );

  assert.equal(staleSweeps.length, 1);
  assert.equal(companionProbed, true);
  const [cutoff] = staleSweeps[0];
  assert.ok(cutoff instanceof Date);
  // 0089's deliberate cutoff: one day, far beyond any bounded inventory run.
  const ageMs = Date.now() - cutoff.getTime();
  assert.ok(ageMs >= 24 * 60 * 60 * 1000 - 5_000);
  assert.ok(ageMs <= 24 * 60 * 60 * 1000 + 60_000);
});
