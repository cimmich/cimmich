import assert from "node:assert/strict";
import test from "node:test";
import {
  cimmichAssetIdForImmich,
  normalizeInventoryJob,
  normalizeInventoryPage,
  projectInventoryCoverage,
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
