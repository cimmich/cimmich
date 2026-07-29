import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  archiveMobilityContractVersion,
  bindVerifiedContent,
  cimmichAssetIdForContent,
  contentIdForFingerprint,
  createHashLinkedAssetResolver,
  normalizeContentFingerprint,
  sourceBindingId,
  verifiedContentBindingSchemaVersion,
} from "../src/archive-mobility.mjs";

const sha1 = createHash("sha1").update("same portable bytes").digest();
const sha256 = createHash("sha256").update("same portable bytes").digest();

test("archive mobility normalizes algorithm-labelled, hex and Immich base64 hashes", () => {
  assert.equal(
    archiveMobilityContractVersion,
    "cimmich.hash-linked-archive-mobility.v1",
  );
  assert.deepEqual(normalizeContentFingerprint(sha1.toString("base64")), {
    contentDigest: sha1.toString("hex"),
    hashAlgorithm: "sha1",
  });
  assert.deepEqual(
    normalizeContentFingerprint(`immich:${sha1.toString("hex")}`),
    {
      contentDigest: sha1.toString("hex"),
      hashAlgorithm: "sha1",
    },
  );
  assert.deepEqual(normalizeContentFingerprint(sha256.toString("hex")), {
    contentDigest: sha256.toString("hex"),
    hashAlgorithm: "sha256",
  });
  assert.equal(normalizeContentFingerprint("not-a-content-hash"), null);
});

test("content identity is stable across paths, sources and Immich UUIDs", () => {
  const fingerprint = normalizeContentFingerprint(sha1.toString("base64"));
  const contentId = contentIdForFingerprint(fingerprint);
  const assetId = cimmichAssetIdForContent(fingerprint);
  assert.match(contentId, /^media_content_[0-9a-f]{40}$/);
  assert.match(assetId, /^asset_content_[0-9a-f]{40}$/);
  assert.equal(contentIdForFingerprint(fingerprint), contentId);
  assert.equal(cimmichAssetIdForContent(fingerprint), assetId);
  assert.notEqual(
    sourceBindingId({
      externalAssetId: "mac-immich-uuid",
      sourceId: "mac",
      sourceKind: "immich",
    }),
    sourceBindingId({
      externalAssetId: "server-immich-uuid",
      sourceId: "server",
      sourceKind: "immich",
    }),
  );
});

test("resolver adopts one existing exact-content asset before deriving a new one", async () => {
  const fingerprint = normalizeContentFingerprint(sha1.toString("base64"));
  const queries = [];
  const sql = async (strings, ...values) => {
    queries.push({ strings, values });
    return [{ asset_id: "asset_existing_portable" }];
  };
  const resolver = createHashLinkedAssetResolver({
    legacyResolver: () => "asset_legacy_source_bound",
    sql,
  });
  assert.equal(
    await resolver({
      checksum: sha1.toString("base64"),
      immichAssetId: "different-server-uuid",
      sourceId: "server",
    }),
    "asset_existing_portable",
  );
  assert.equal(queries.length, 1);

  const freshResolver = createHashLinkedAssetResolver({
    legacyResolver: () => "asset_legacy_source_bound",
    sql: async () => [],
  });
  assert.equal(
    await freshResolver({
      checksum: sha1.toString("base64"),
      immichAssetId: "different-server-uuid",
      sourceId: "server",
    }),
    cimmichAssetIdForContent(fingerprint),
  );
});

test("resolver fails closed when legacy data links one exact hash to multiple assets", async () => {
  const resolver = createHashLinkedAssetResolver({
    sql: async () => [
      { asset_id: "asset_duplicate_a" },
      { asset_id: "asset_duplicate_b" },
    ],
  });
  await assert.rejects(
    () =>
      resolver({
        checksum: sha1.toString("base64"),
        immichAssetId: "server-uuid",
        sourceId: "server",
      }),
    (error) =>
      error.code === "ARCHIVE_CONTENT_IDENTITY_AMBIGUOUS" &&
      /multiple Cimmich assets/.test(error.message),
  );
});

test("unrecognized legacy checksums may use an explicit import bridge only", async () => {
  const resolver = createHashLinkedAssetResolver({
    legacyResolver: ({ immichAssetId }) =>
      immichAssetId === "known-import-id" ? "asset_imported" : null,
    sql: async () => {
      throw new Error("hash lookup should not run");
    },
  });
  assert.equal(
    await resolver({
      checksum: "legacy-unlabelled-checksum",
      immichAssetId: "known-import-id",
      sourceId: "legacy",
    }),
    "asset_imported",
  );
  assert.equal(
    await resolver({
      checksum: "legacy-unlabelled-checksum",
      immichAssetId: "unknown",
      sourceId: "legacy",
    }),
    null,
  );
});

test("verified content binding is byte-authoritative and exactly replay-safe", async () => {
  let recordedCommand = null;
  const transaction = async (strings, ...values) => {
    const query = strings.join(" ");
    if (query.includes("FROM verified_content_binding_command")) {
      return recordedCommand ? [recordedCommand] : [];
    }
    if (query.includes("FROM asset_source_binding binding")) {
      return [
        {
          asset_id: "asset_legacy",
          asset_state: "active",
          binding_id: "source_binding_legacy",
          content_id: null,
        },
      ];
    }
    if (query.includes("FROM asset_content_link link")) return [];
    if (query.includes("FROM media_content_fingerprint fingerprint")) {
      return [];
    }
    if (query.includes("INSERT INTO media_content ")) {
      return [{ content_id: values[0] }];
    }
    if (query.includes("INSERT INTO verified_content_binding_command")) {
      recordedCommand = {
        request_digest: values[2],
        response: values[3],
      };
    }
    return [];
  };
  transaction.json = (value) => value;
  const sql = Object.assign(transaction, {
    begin: async (callback) => callback(transaction),
  });
  const command = {
    actorId: "archive-transition-operator",
    byteLength: 1234,
    commandId: "shadow-existing-1",
    contentDigest: sha256.toString("hex"),
    externalAssetId: "legacy-immich-uuid",
    hashAlgorithm: "sha256",
    schemaVersion: verifiedContentBindingSchemaVersion,
    sourceId: "immich-primary",
    sourceKind: "immich",
    sql,
  };
  const first = await bindVerifiedContent(command);
  assert.equal(first.assetId, "asset_legacy");
  assert.equal(first.verification, "byte_verified");
  assert.equal(first.replayed, false);
  assert.match(first.contentId, /^media_content_[0-9a-f]{40}$/);

  const replay = await bindVerifiedContent(command);
  assert.deepEqual(replay, { ...first, replayed: true });
  await assert.rejects(
    bindVerifiedContent({ ...command, byteLength: 1235 }),
    (error) => error.code === "ARCHIVE_VERIFIED_BINDING_REPLAY_CONFLICT",
  );
});

test("verified content binding rejects path-shaped and non-SHA-256 authority", async () => {
  const neverSql = Object.assign(async () => [], {
    begin: async () => {
      throw new Error("database should not be reached");
    },
  });
  await assert.rejects(
    bindVerifiedContent({
      actorId: "operator",
      byteLength: 1,
      commandId: "invalid",
      contentDigest: sha1.toString("hex"),
      externalAssetId: "/private/archive/photo.jpg",
      hashAlgorithm: "sha1",
      schemaVersion: verifiedContentBindingSchemaVersion,
      sourceId: "legacy",
      sourceKind: "filesystem",
      sql: neverSql,
    }),
    (error) => error.code === "ARCHIVE_VERIFIED_BINDING_INVALID",
  );
});
