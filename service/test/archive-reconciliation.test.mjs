import assert from "node:assert/strict";
import test from "node:test";
import { reconcileImmichArchiveToLegacyAssets } from "../src/archive-reconciliation.mjs";

const asset = (id, name) => ({
  assetType: "image",
  captureTime: "2024-01-01T00:00:00.000Z",
  height: 100,
  immichAssetId: id,
  isOffline: false,
  isTrashed: false,
  originalFileName: name,
  originalMimeType: "image/jpeg",
  width: 100,
});

const sqlFor = (candidates) => {
  const sql = async (_strings, ...values) => {
    const name = values[1];
    return candidates[name] || [];
  };
  sql.begin = async (operation) => operation(sql);
  return sql;
};

test("archive reconciliation dry-run is metadata-only and bounded", async () => {
  let fingerprintReads = 0;
  const result = await reconcileImmichArchiveToLegacyAssets({
    actorId: "test-operator",
    companion: {
      async listAssets({ cursor, visibility }) {
        return {
          items:
            visibility === "timeline" && cursor === ""
              ? [asset("new-a", "a.jpg"), asset("new-b", "b.jpg")]
              : [],
          nextCursor: null,
        };
      },
      async readAssetFingerprint() {
        fingerprintReads += 1;
      },
    },
    legacySourceId: "immich-primary",
    sql: sqlFor({
      "a.jpg": [{ asset_id: "legacy-a", external_asset_id: "old-a" }],
      "b.jpg": [
        { asset_id: "legacy-b1", external_asset_id: "old-b1" },
        { asset_id: "legacy-b2", external_asset_id: "old-b2" },
      ],
    }),
  });

  assert.equal(result.scannedAssets, 2);
  assert.equal(result.metadataMatchedAssets, 1);
  assert.equal(result.metadataUnmatchedAssets, 1);
  assert.equal(result.candidateGroups, 1);
  assert.equal(result.boundGroups, 0);
  assert.equal(fingerprintReads, 0);
});

test("archive reconciliation binds only byte-consistent legacy groups", async () => {
  const bound = [];
  const result = await reconcileImmichArchiveToLegacyAssets({
    actorId: "test-operator",
    apply: true,
    bindContent: async (command) => {
      bound.push(command);
    },
    companion: {
      async listAssets({ cursor, visibility }) {
        return {
          items:
            visibility === "timeline" && cursor === ""
              ? [
                  asset("new-a1", "a.jpg"),
                  asset("new-a2", "a-copy.jpg"),
                  asset("new-b1", "b.jpg"),
                  asset("new-b2", "b-copy.jpg"),
                ]
              : [],
          nextCursor: null,
        };
      },
      async readAssetFingerprint({ assetId }) {
        return {
          byteLength: 10,
          contentDigest: assetId.startsWith("new-a")
            ? "a".repeat(64)
            : assetId.endsWith("1")
              ? "b".repeat(64)
              : "c".repeat(64),
        };
      },
    },
    legacySourceId: "immich-primary",
    sql: sqlFor({
      "a.jpg": [{ asset_id: "legacy-a", external_asset_id: "old-a" }],
      "a-copy.jpg": [{ asset_id: "legacy-a", external_asset_id: "old-a" }],
      "b.jpg": [{ asset_id: "legacy-b", external_asset_id: "old-b" }],
      "b-copy.jpg": [{ asset_id: "legacy-b", external_asset_id: "old-b" }],
    }),
  });

  assert.equal(result.candidateGroups, 2);
  assert.equal(result.multiCurrentGroups, 2);
  assert.equal(result.boundGroups, 1);
  assert.equal(result.boundCurrentAssets, 2);
  assert.equal(result.byteConflictGroups, 1);
  assert.equal(bound.length, 1);
  assert.equal(bound[0].externalAssetId, "old-a");
  assert.equal(bound[0].contentDigest, "a".repeat(64));
  assert.equal(bound[0].schemaVersion, "cimmich.verified-content-binding.v1");
});

test("archive reconciliation defers exact duplicates to existing byte authority", async () => {
  const error = Object.assign(new Error("already linked"), {
    code: "ARCHIVE_CONTENT_IDENTITY_AMBIGUOUS",
  });
  const result = await reconcileImmichArchiveToLegacyAssets({
    actorId: "test-operator",
    apply: true,
    bindContent: async () => {
      throw error;
    },
    companion: {
      async listAssets({ cursor, visibility }) {
        return {
          items:
            visibility === "timeline" && cursor === ""
              ? [asset("new-a", "a.jpg")]
              : [],
          nextCursor: null,
        };
      },
      async readAssetFingerprint() {
        return {
          byteLength: 10,
          contentDigest: "a".repeat(64),
        };
      },
    },
    legacySourceId: "immich-primary",
    sql: sqlFor({
      "a.jpg": [{ asset_id: "legacy-a", external_asset_id: "old-a" }],
    }),
  });

  assert.equal(result.existingContentGroups, 1);
  assert.equal(result.boundGroups, 0);
  assert.equal(result.byteConflictGroups, 0);
});

test("archive reconciliation does not rehash legacy assets with byte authority", async () => {
  let fingerprintReads = 0;
  const result = await reconcileImmichArchiveToLegacyAssets({
    actorId: "test-operator",
    apply: true,
    companion: {
      async listAssets({ cursor, visibility }) {
        return {
          items:
            visibility === "timeline" && cursor === ""
              ? [asset("new-a", "a.jpg")]
              : [],
          nextCursor: null,
        };
      },
      async readAssetFingerprint() {
        fingerprintReads += 1;
      },
    },
    legacySourceId: "immich-primary",
    sql: sqlFor({
      "a.jpg": [
        {
          asset_id: "legacy-a",
          content_bound: true,
          external_asset_id: "old-a",
        },
      ],
    }),
  });

  assert.equal(result.metadataMatchedAssets, 1);
  assert.equal(result.alreadyBoundLegacyAssets, 1);
  assert.equal(result.candidateGroups, 0);
  assert.equal(fingerprintReads, 0);
});
