import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import postgres from "postgres";
import {
  cimmichAssetIdForContent,
  createHashLinkedAssetResolver,
  normalizeContentFingerprint,
} from "../src/archive-mobility.mjs";
import { createImmichInventorySynchronizer } from "../src/immich-inventory.mjs";

const databaseUrl =
  process.env.DATABASE_URL || "postgres://cimmich@postgres:5432/cimmich";
const sql = postgres(databaseUrl, { max: 2, prepare: true });
const exactBytes = Buffer.from("portable archive mobility fixture");
const changedBytes = Buffer.from("portable archive mobility fixture changed");
const exactChecksum = createHash("sha1").update(exactBytes).digest("base64");
const changedChecksum = createHash("sha1")
  .update(changedBytes)
  .digest("base64");
const exactFingerprint = normalizeContentFingerprint(exactChecksum);
const changedFingerprint = normalizeContentFingerprint(changedChecksum);
const exactAssetId = cimmichAssetIdForContent(exactFingerprint);
const changedAssetId = cimmichAssetIdForContent(changedFingerprint);
const projectedAsset = ({ checksum, id, revision }) => ({
  assetType: "image",
  captureTime: "2026-01-01T00:00:00.000Z",
  checksum,
  duration: null,
  height: 800,
  immichAssetId: id,
  inputRevision: createHash("sha256")
    .update(`${id}:${revision}:${checksum}`)
    .digest("hex"),
  isArchived: false,
  isFavorite: false,
  isOffline: false,
  isTrashed: false,
  originalMimeType: "image/jpeg",
  originalFileName: `${id}.jpg`,
  ownerId: "mobility-owner",
  updatedAt: `2026-01-0${revision}T00:00:00.000Z`,
  visibility: "timeline",
  width: 1200,
});

const companion = (items) => ({
  async listAssets({ visibility }) {
    return {
      items: visibility === "timeline" ? items : [],
      nextCursor: null,
      visibility,
    };
  },
  async status() {
    return {
      immichVersion: "3.1.0",
      principal: { userId: "mobility-owner" },
      state: "ready",
    };
  },
});

const synchronize = async ({ items, sourceId }) => {
  const resolver = createHashLinkedAssetResolver({ sql });
  return createImmichInventorySynchronizer({
    companion: companion(items),
    job: null,
    resolveCimmichAssetId: resolver,
    sourceId,
    sql,
    trustSourceChecksums: true,
  }).synchronize({ visibilities: ["timeline"] });
};

try {
  const mac = await synchronize({
    items: [
      projectedAsset({
        checksum: exactChecksum,
        id: "mac-immich-uuid",
        revision: 1,
      }),
    ],
    sourceId: "mobility-mac",
  });
  assert.equal(mac.admittedAssetCount, 1);
  assert.equal(mac.admittedAssets[0].assetId, exactAssetId);

  await sql`
    INSERT INTO producer_receipt (
      producer_receipt_id, producer_kind, producer_name, producer_version,
      started_at, completed_at, result_digest, privacy_class
    ) VALUES (
      'receipt_archive_mobility_fixture', 'system',
      'archive-mobility-acceptance', 'v1', now(), now(),
      ${"a".repeat(64)}, 'private'
    ) ON CONFLICT (producer_receipt_id) DO NOTHING
  `;
  await sql`
    INSERT INTO face_observation (
      face_id, asset_id, box_x, box_y, box_w, box_h,
      detection_confidence, quality_measurements, state,
      producer_receipt_id, privacy_class
    ) VALUES (
      'face_archive_mobility_fixture', ${exactAssetId},
      0.1, 0.1, 0.3, 0.3, 0.95, '{}'::jsonb, 'valid',
      'receipt_archive_mobility_fixture', 'sensitive-biometric'
    )
  `;

  const server = await synchronize({
    items: [
      projectedAsset({
        checksum: exactChecksum,
        id: "server-immich-uuid-a",
        revision: 2,
      }),
      projectedAsset({
        checksum: exactChecksum,
        id: "server-immich-uuid-duplicate",
        revision: 2,
      }),
    ],
    sourceId: "mobility-server",
  });
  assert.equal(server.admittedAssetCount, 0);

  const [relocated] = await sql`
    SELECT
      (SELECT count(*)::int FROM asset
       WHERE asset_id = ${exactAssetId}) AS assets,
      (SELECT count(*)::int FROM face_observation
       WHERE face_id = 'face_archive_mobility_fixture'
         AND asset_id = ${exactAssetId}) AS faces,
      (SELECT count(*)::int FROM immich_asset_projection
       WHERE cimmich_asset_id = ${exactAssetId}
         AND state = 'active') AS projections,
      (SELECT count(*)::int FROM asset_source_binding
       WHERE asset_id = ${exactAssetId}
         AND state = 'active') AS bindings,
      (SELECT count(*)::int FROM media_content_fingerprint fingerprint
       JOIN asset_content_link link
         ON link.content_id = fingerprint.content_id
       WHERE link.asset_id = ${exactAssetId}
         AND fingerprint.hash_algorithm = 'sha1'
         AND fingerprint.content_digest = ${exactFingerprint.contentDigest})
        AS fingerprints
  `;
  assert.deepEqual(relocated, {
    assets: 1,
    bindings: 3,
    faces: 1,
    fingerprints: 1,
    projections: 3,
  });

  await synchronize({
    items: [
      projectedAsset({
        checksum: changedChecksum,
        id: "server-immich-uuid-a",
        revision: 3,
      }),
      projectedAsset({
        checksum: exactChecksum,
        id: "server-immich-uuid-duplicate",
        revision: 3,
      }),
    ],
    sourceId: "mobility-server",
  });

  const [changed] = await sql`
    SELECT
      (SELECT cimmich_asset_id FROM immich_asset_projection
       WHERE source_id = 'mobility-server'
         AND immich_asset_id = 'server-immich-uuid-a') AS changed_asset_id,
      (SELECT cimmich_asset_id FROM immich_asset_projection
       WHERE source_id = 'mobility-server'
         AND immich_asset_id = 'server-immich-uuid-duplicate') AS duplicate_asset_id,
      (SELECT count(*)::int FROM face_observation
       WHERE face_id = 'face_archive_mobility_fixture'
         AND asset_id = ${exactAssetId}) AS preserved_faces,
      (SELECT count(*)::int FROM asset_source_binding_event
       WHERE binding_id = (
         SELECT binding_id FROM asset_source_binding
         WHERE source_kind = 'immich'
           AND source_id = 'mobility-server'
           AND external_asset_id = 'server-immich-uuid-a'
       )) AS binding_events
  `;
  assert.equal(changed.changed_asset_id, changedAssetId);
  assert.equal(changed.duplicate_asset_id, exactAssetId);
  assert.equal(changed.preserved_faces, 1);
  assert.ok(changed.binding_events >= 2);

  process.stdout.write(
    `${JSON.stringify({
      changedBytesCreatedNewAsset: true,
      duplicateBindings: 3,
      exactAssetId,
      intelligencePreserved: true,
      relocationReusedAsset: true,
      schemaVersion: "cimmich.hash-linked-archive-mobility.v1",
      status: "PASS",
    })}\n`,
  );
} finally {
  await sql.end({ timeout: 5 });
}
