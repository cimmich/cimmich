import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import postgres from "postgres";
import { createXmpSidecarReviewStore } from "../src/xmp-sidecar-review.mjs";

const sql = postgres(process.env.DATABASE_URL, { max: 3, prepare: true });
const digest = (value) => createHash("sha256").update(value).digest("hex");
const ids = {
  asset: "asset_xmp_name_review_fixture",
  content: `media_content_${"9".repeat(40)}`,
  evidenceOne: `xmp_face_evidence_${"8".repeat(40)}`,
  evidenceTwo: `xmp_face_evidence_${"7".repeat(40)}`,
  faceOne: "face_xmp_name_review_fixture_one",
  faceTwo: "face_xmp_name_review_fixture_two",
  person: "person_xmp_name_review_fixture",
  receipt: "receipt_xmp_name_review_fixture",
  snapshot: "snapshot_xmp_name_review_fixture",
};
const sourceId = "synthetic-xmp-name-review";
const normalizedName = "Historical Imported Name";

try {
  await sql`
    INSERT INTO source_snapshot (
      snapshot_id, input_schema_version, source_digest, locator_root_token,
      started_at, completed_at, observed_asset_count, state, privacy_class
    ) VALUES (
      ${ids.snapshot}, 'synthetic.xmp-name-review.v1',
      ${digest("xmp-name-review-snapshot")}, 'xmp-name-review-fixture',
      now(), now(), 1, 'complete', 'private'
    )
  `;
  await sql`
    INSERT INTO producer_receipt (
      producer_receipt_id, producer_kind, producer_name, producer_version,
      source_snapshot_id, started_at, completed_at, result_digest,
      privacy_class
    ) VALUES (
      ${ids.receipt}, 'trusted_import', 'xmp-name-review-fixture', 'v1',
      ${ids.snapshot}, now(), now(), ${digest("xmp-name-review-result")},
      'sensitive-biometric'
    )
  `;
  await sql`
    INSERT INTO asset (
      asset_id, content_hash, locator_token, media_kind, mime_type, width,
      height, capture_time, source_snapshot_id, state
    ) VALUES (
      ${ids.asset}, 'synthetic:xmp-name-review',
      'xmp_name_review_locator', 'image', 'image/jpeg', 1600, 1200,
      '2004-03-02T00:00:00Z', ${ids.snapshot}, 'active'
    )
  `;
  await sql`
    INSERT INTO media_content (content_id, byte_length)
    VALUES (${ids.content}, 4096)
  `;
  await sql`
    INSERT INTO person (
      person_id, display_name, status, subject_kind, created_by_receipt_id
    ) VALUES (
      ${ids.person}, 'Canonical Fixture Person', 'active', 'person',
      ${ids.receipt}
    )
  `;
  await sql`
    INSERT INTO face_observation (
      face_id, asset_id, box_x, box_y, box_w, box_h,
      detection_confidence, quality_measurements, state,
      producer_receipt_id, observation_origin
    ) VALUES (
      ${ids.faceOne}, ${ids.asset}, 0.1, 0.1, 0.2, 0.3, NULL,
      '{}', 'valid', 'receipt_cimmich_xmp_sidecar_face_import_v1',
      'xmp_sidecar_import'
    ), (
      ${ids.faceTwo}, ${ids.asset}, 0.6, 0.1, 0.2, 0.3, NULL,
      '{}', 'valid', 'receipt_cimmich_xmp_sidecar_face_import_v1',
      'xmp_sidecar_import'
    )
  `;
  await sql`
    INSERT INTO xmp_sidecar_face_evidence (
      evidence_id, source_id, content_id, asset_id, face_id,
      region_key, raw_name, normalized_name, box_x, box_y, box_w, box_h,
      resolution_state
    ) VALUES (
      ${ids.evidenceOne}, ${sourceId}, ${ids.content}, ${ids.asset},
      ${ids.faceOne}, ${"6".repeat(64)}, ${`${normalizedName} 1`},
      ${normalizedName}, 0.1, 0.1, 0.2, 0.3, 'created_unresolved'
    ), (
      ${ids.evidenceTwo}, ${sourceId}, ${ids.content}, ${ids.asset},
      ${ids.faceTwo}, ${"5".repeat(64)}, ${normalizedName},
      ${normalizedName}, 0.6, 0.1, 0.2, 0.3, 'created_unresolved'
    )
  `;

  const store = createXmpSidecarReviewStore(sql, {
    bridgeFields: () => ({ sourceAssetId: "immich_xmp_review_fixture" }),
    presentationRank: () => 2,
  });
  const queue = await store.list({ limit: 10 });
  const group = queue.items.find(
    (item) =>
      item.sourceId === sourceId &&
      item.normalizedName === normalizedName,
  );
  assert.ok(group);
  assert.equal(group.faceCount, 2);
  assert.equal(group.assetCount, 1);
  assert.equal(group.previews.length, 1);
  assert.equal(group.previews[0].sourceAssetId, "immich_xmp_review_fixture");

  const first = await store.resolve({
    actorId: "synthetic-owner",
    commandId: "xmp-name-review-acceptance-001",
    groupId: group.groupId,
    personId: ids.person,
  });
  assert.equal(first.resolvedFaceCount, 2);
  assert.equal(first.createdClaimCount, 2);
  assert.equal(first.reusedClaimCount, 0);
  assert.equal(first.aliasAdded, true);
  assert.equal(first.replayed, false);

  const replay = await store.resolve({
    actorId: "synthetic-owner",
    commandId: "xmp-name-review-acceptance-001",
    groupId: group.groupId,
    personId: ids.person,
  });
  assert.equal(replay.replayed, true);

  const [proof] = await sql`
    SELECT
      count(*) FILTER (
        WHERE evidence.resolution_state = 'owner_resolved'
          AND evidence.import_resolution_state = 'created_unresolved'
          AND evidence.person_id = ${ids.person}
          AND evidence.identity_claim_id IS NOT NULL
      )::int AS resolved,
      count(*) FILTER (
        WHERE claim.origin = 'user' AND claim.state = 'accepted'
      )::int AS user_claims
    FROM xmp_sidecar_face_evidence evidence
    LEFT JOIN identity_claim claim
      ON claim.identity_claim_id = evidence.identity_claim_id
    WHERE evidence.evidence_id IN (${ids.evidenceOne}, ${ids.evidenceTwo})
  `;
  assert.equal(Number(proof.resolved), 2);
  assert.equal(Number(proof.user_claims), 2);

  const [alias] = await sql`
    SELECT label, alias_kind, source_system
    FROM person_alias
    WHERE person_id = ${ids.person} AND lower(label) = lower(${normalizedName})
      AND state = 'active'
  `;
  assert.equal(alias.label, normalizedName);
  assert.equal(alias.alias_kind, "imported");
  assert.equal(alias.source_system, "xmp_sidecar");

  const after = await store.list({ limit: 100 });
  assert.equal(
    after.items.some((item) => item.groupId === group.groupId),
    false,
  );
  process.stdout.write(
    `${JSON.stringify({
      aliasAdded: true,
      automaticIdentityAuthority: "owner_command_only",
      exactReplay: true,
      importedStatePreserved: true,
      resolvedFaces: 2,
      schemaVersion: "cimmich.xmp-sidecar-name-review.v1",
      status: "PASS",
    })}\n`,
  );
} finally {
  await sql.end({ timeout: 5 });
}
