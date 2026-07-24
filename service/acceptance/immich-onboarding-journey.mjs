import assert from "node:assert/strict";
import postgres from "postgres";
import { createImmichOnboarding } from "../src/immich-onboarding.mjs";
import { loadSourcePackFaces } from "../src/source-pack-repository.mjs";

const sql = postgres(process.env.DATABASE_URL, { max: 4 });
const sourceId = "immich-onboarding-fixture";
const assetId = "asset_immich_onboarding_fixture";
const sourceAssetId = "adc47f9b-59be-4603-bcec-bbd5cef8a9cd";
const existingPersonId = "person_immich_onboarding_existing_target";
const inputRevision = "7".repeat(64);
const digest = "8".repeat(64);
const boxes = [0.05, 0.23, 0.41, 0.59, 0.77].map((x) => ({
  h: 0.18,
  w: 0.14,
  x,
  y: 0.2,
}));
const people = boxes.map((_, index) => ({
  id: `source-person-${index + 1}`,
  isFavorite: false,
  isHidden: false,
  name: index === 4 ? null : `Inherited Fixture ${index + 1}`,
  sourceRevision: `${index + 1}`.repeat(64),
}));
const faces = boxes.map((box, index) => ({
  box,
  id: `source-face-${index + 1}`,
  person: people[index],
  personId: people[index].id,
  sourceRevision: `${index + 2}`.repeat(64),
}));

const companion = {
  listAssetFaces: async () => ({ assetId: sourceAssetId, items: faces }),
  listAssets: async ({ visibility }) => ({
    items:
      visibility === "timeline"
        ? [
            {
              assetType: "image",
              immichAssetId: sourceAssetId,
              inputRevision,
              visibility,
            },
          ]
        : [],
    nextCursor: null,
  }),
  listPeople: async () => ({ items: people, nextCursor: null }),
  status: async () => ({
    capabilities: { mediaRead: true },
    immichVersion: "3.0.3",
    principal: { userId: "owner-onboarding-fixture" },
    state: "ready",
  }),
  verifyOnboardingPermissions: async () => ({
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
  }),
};

try {
  await sql`
    INSERT INTO person (
      person_id, display_name, status, subject_kind,
      created_by_receipt_id, privacy_class
    ) VALUES (
      ${existingPersonId}, 'Existing Resolution Target', 'active', 'person',
      'receipt_service_fixture', 'private'
    ) ON CONFLICT (person_id) DO NOTHING
  `;
  await sql`
    INSERT INTO immich_inventory_source (
      source_id, principal_digest, companion_schema_version, immich_version,
      state
    ) VALUES (
      ${sourceId}, ${"6".repeat(64)}, 'cimmich.immich-companion.v1', '3.0.3',
      'active'
    ) ON CONFLICT (source_id) DO NOTHING
  `;
  await sql`
    INSERT INTO source_snapshot (
      snapshot_id, input_schema_version, source_digest, locator_root_token,
      started_at, completed_at, observed_asset_count, state, privacy_class
    ) VALUES (
      'snapshot_immich_onboarding_fixture', 'cimmich.immich-companion.v1',
      ${"5".repeat(64)}, ${sourceId}, now(), now(), 1, 'complete', 'private'
    ) ON CONFLICT (snapshot_id) DO NOTHING
  `;
  await sql`
    INSERT INTO immich_inventory_run (
      run_id, source_id, snapshot_id, immich_version, principal_digest,
      state, observed_asset_count, completed_at
    ) VALUES (
      'immich_inventory_run_onboarding_fixture', ${sourceId},
      'snapshot_immich_onboarding_fixture', '3.0.3', ${"6".repeat(64)},
      'completed', 1, now()
    ) ON CONFLICT (run_id) DO NOTHING
  `;
  await sql`
    INSERT INTO asset (
      asset_id, content_hash, locator_token, media_kind, mime_type, width,
      height, capture_time, source_snapshot_id, state, privacy_class
    ) VALUES (
      ${assetId}, ${"4".repeat(64)}, 'immich:onboarding:fixture', 'image',
      'image/png', 2000, 1200, now(), 'snapshot_immich_onboarding_fixture',
      'active', 'private'
    ) ON CONFLICT (asset_id) DO NOTHING
  `;
  await sql`
    INSERT INTO immich_asset_projection (
      source_id, immich_asset_id, cimmich_asset_id, owner_digest,
      input_revision, checksum, asset_type, visibility, original_mime_type,
      original_file_name, capture_time, source_updated_at, width, height,
      is_archived, is_favorite, is_offline, is_trashed, state,
      first_seen_run_id, last_seen_run_id
    ) VALUES (
      ${sourceId}, ${sourceAssetId}, ${assetId}, ${"3".repeat(64)},
      ${inputRevision}, 'fixture-checksum', 'image', 'timeline', 'image/png',
      'CHA-023-bluewater-arrival.png', now(), now(), 2000, 1200,
      false, false, false, false, 'active',
      'immich_inventory_run_onboarding_fixture',
      'immich_inventory_run_onboarding_fixture'
    ) ON CONFLICT (source_id, immich_asset_id) DO UPDATE SET
      input_revision = excluded.input_revision, state = 'active'
  `;
  for (const [index, box] of boxes.entries()) {
    await sql`
      INSERT INTO face_observation (
        face_id, asset_id, box_x, box_y, box_w, box_h,
        detection_confidence, quality_measurements, state,
        producer_receipt_id, observation_origin
      ) VALUES (
        ${`face_onboarding_provider_${index + 1}`}, ${assetId}, ${box.x},
        ${box.y}, ${box.w}, ${box.h}, 0.95,
        ${sql.json({ quality_score: 0.9 })}, 'valid',
        'receipt_service_fixture', 'detector_or_import'
      ) ON CONFLICT (face_id) DO NOTHING
    `;
  }
  await sql`
    INSERT INTO face_detection_result (
      detection_result_id, asset_id, detector_config_digest, input_revision,
      source_content_digest, outcome, face_count, result_digest,
      producer_receipt_id
    ) VALUES (
      'detection_onboarding_fixture', ${assetId}, ${digest}, ${inputRevision},
      ${"9".repeat(64)}, 'faces_detected', 5, ${"a".repeat(64)},
      'receipt_service_fixture'
    ) ON CONFLICT (detection_result_id) DO NOTHING
  `;
  for (let index = 0; index < boxes.length; index += 1) {
    await sql`
      INSERT INTO face_detection_result_observation (
        detection_result_id, face_id, observation_order
      ) VALUES (
        'detection_onboarding_fixture',
        ${`face_onboarding_provider_${index + 1}`}, ${index}
      ) ON CONFLICT (detection_result_id, face_id) DO NOTHING
    `;
    await sql`
      INSERT INTO face_embedding (
        embedding_id, face_id, model_family, model_version, config_digest,
        dimension, normalized, embedding, vector_digest, state,
        producer_receipt_id, privacy_class
      ) VALUES (
        ${`embedding_onboarding_provider_${index + 1}`},
        ${`face_onboarding_provider_${index + 1}`}, 'synthetic', 'v1',
        ${digest}, 3, true, ${`[${index === 0 ? 1 : 0},${index === 1 ? 1 : 0},${index > 1 ? 1 : 0}]`}::vector,
        ${`${index + 3}`.repeat(64)}, 'active', 'receipt_service_fixture',
        'sensitive-biometric'
      ) ON CONFLICT (embedding_id) DO NOTHING
    `;
  }

  let inventoryAttempts = 0;
  const onboarding = createImmichOnboarding({
    companion,
    immichInventory: {
      synchronize: async ({ visibilities }) => {
        assert.deepEqual(visibilities, ["timeline"]);
        inventoryAttempts += 1;
        if (inventoryAttempts === 1) {
          throw new Error("synthetic partial inventory scope collision");
        }
        return {
          run: { runId: "immich_inventory_run_onboarding_fixture" },
          source: { activeAssets: 1 },
        };
      },
    },
    sourceId,
    sql,
  });
  const preview = await onboarding.preview({
    scope: { providerMode: "configured", visibilities: ["timeline"] },
    viewingMode: "Standard",
  });
  assert.equal(preview.counts.assignedFaces, 5);
  assert.equal(preview.counts.unlabelledPeople, 1);
  let clusterPreview = await onboarding.personClusters({
    scope: { providerMode: "configured", visibilities: ["timeline"] },
    viewingMode: "Standard",
  });
  assert.equal(clusterPreview.clusters.length, 1);
  const cluster = clusterPreview.clusters[0];
  const firstResolution = await onboarding.resolvePersonCluster({
    action: "existing_person",
    actorId: "onboarding-acceptance",
    commandId: "onboarding.person.resolve.0001",
    expectedSourceRevision: cluster.sourceRevision,
    immichPersonId: cluster.immichPersonId,
    personId: existingPersonId,
    scope: { providerMode: "configured", visibilities: ["timeline"] },
    snapshotDigest: cluster.snapshotDigest,
    viewingMode: "Standard",
  });
  assert.equal(firstResolution.createdPerson, false);
  assert.equal(firstResolution.resolution.action, "existing_person");
  assert.equal(firstResolution.resolution.personId, existingPersonId);
  const resolutionReplay = await onboarding.resolvePersonCluster({
    action: "existing_person",
    actorId: "onboarding-acceptance",
    commandId: "onboarding.person.resolve.0001",
    expectedSourceRevision: cluster.sourceRevision,
    immichPersonId: cluster.immichPersonId,
    personId: existingPersonId,
    scope: { providerMode: "configured", visibilities: ["timeline"] },
    snapshotDigest: cluster.snapshotDigest,
    viewingMode: "Standard",
  });
  assert.equal(resolutionReplay.replayed, true);
  const undone = await onboarding.undoPersonClusterResolution({
    actorId: "onboarding-acceptance",
    commandId: "onboarding.person.undo.0001",
    decisionId: firstResolution.resolution.decisionId,
    scope: { providerMode: "configured", visibilities: ["timeline"] },
    viewingMode: "Standard",
  });
  assert.equal(undone.state, "reverted");
  assert.equal(undone.resolution, null);
  clusterPreview = await onboarding.personClusters({
    scope: { providerMode: "configured", visibilities: ["timeline"] },
    viewingMode: "Standard",
  });
  assert.equal(clusterPreview.clusters[0].resolution.state, "unresolved");
  const createdResolution = await onboarding.resolvePersonCluster({
    action: "create_person",
    actorId: "onboarding-acceptance",
    commandId: "onboarding.person.resolve.0002",
    expectedSourceRevision: cluster.sourceRevision,
    immichPersonId: cluster.immichPersonId,
    newPersonName: "Inherited Fixture 5",
    scope: { providerMode: "configured", visibilities: ["timeline"] },
    snapshotDigest: cluster.snapshotDigest,
    viewingMode: "Standard",
  });
  assert.equal(createdResolution.createdPerson, true);
  const createdUndo = await onboarding.undoPersonClusterResolution({
    actorId: "onboarding-acceptance",
    commandId: "onboarding.person.undo.0002",
    decisionId: createdResolution.resolution.decisionId,
    scope: { providerMode: "configured", visibilities: ["timeline"] },
    viewingMode: "Standard",
  });
  assert.equal(createdUndo.state, "reverted");
  const finalResolution = await onboarding.resolvePersonCluster({
    action: "unknown",
    actorId: "onboarding-acceptance",
    commandId: "onboarding.person.resolve.0003",
    expectedSourceRevision: cluster.sourceRevision,
    immichPersonId: cluster.immichPersonId,
    scope: { providerMode: "configured", visibilities: ["timeline"] },
    snapshotDigest: cluster.snapshotDigest,
    viewingMode: "Standard",
  });
  assert.equal(finalResolution.createdPerson, false);
  assert.equal(finalResolution.resolution.action, "unknown");
  await assert.rejects(
    onboarding.importCurrent({
      actorId: "onboarding-acceptance",
      commandId: "onboarding.import.acceptance.0001",
      previewDigest: preview.previewDigest,
      scope: { providerMode: "configured", visibilities: ["timeline"] },
      viewingMode: "Standard",
    }),
    (error) =>
      error.code === "IMMICH_ONBOARDING_IMPORT_INTERRUPTED" &&
      error.statusCode === 503 &&
      error.details.resume === "same_command",
  );
  const [interruptedRun] = await sql`
    SELECT state, progress FROM immich_onboarding_run
    WHERE command_id = 'onboarding.import.acceptance.0001'
  `;
  assert.equal(interruptedRun.state, "interrupted");
  assert.equal(interruptedRun.progress.processedAssets, 0);
  assert.equal(
    interruptedRun.progress.lastErrorCode,
    "IMMICH_ONBOARDING_IMPORT_INTERRUPTED",
  );
  assert.equal((await onboarding.status()).next, "resume_import");
  assert.equal(
    Number(
      (
        await sql`
          SELECT count(*)::int AS count FROM immich_face_projection
          WHERE source_id = ${sourceId}
        `
      )[0].count,
    ),
    0,
  );
  const result = await onboarding.importCurrent({
    actorId: "onboarding-acceptance",
    commandId: "onboarding.import.acceptance.0001",
    previewDigest: preview.previewDigest,
    scope: { providerMode: "configured", visibilities: ["timeline"] },
    viewingMode: "Standard",
  });
  assert.equal(result.import.assignedFaces, 5);
  assert.equal(result.import.exactProviderBinds, 4);
  assert.equal(result.import.importedSourceFaces, 1);
  assert.equal(result.next.automaticIdentityAuthority, "none");
  const replay = await onboarding.importCurrent({
    actorId: "onboarding-acceptance",
    commandId: "onboarding.import.acceptance.0001",
    previewDigest: preview.previewDigest,
    scope: { providerMode: "configured", visibilities: ["timeline"] },
    viewingMode: "Standard",
  });
  assert.equal(replay.replayed, true);
  const noChange = await onboarding.importCurrent({
    actorId: "onboarding-acceptance",
    commandId: "onboarding.import.acceptance.0002",
    previewDigest: preview.previewDigest,
    scope: { providerMode: "configured", visibilities: ["timeline"] },
    viewingMode: "Standard",
  });
  assert.equal(noChange.changed, false);
  assert.equal(noChange.state, "no_change");
  await assert.rejects(
    onboarding.undoPersonClusterResolution({
      actorId: "onboarding-acceptance",
      commandId: "onboarding.person.undo.after-import",
      decisionId: finalResolution.resolution.decisionId,
      scope: { providerMode: "configured", visibilities: ["timeline"] },
      viewingMode: "Standard",
    }),
    (error) => error.code === "IMMICH_PERSON_RESOLUTION_UNDO_DEPENDENCY",
  );
  assert.equal(
    Number(
      (
        await sql`
          SELECT count(*)::int AS count FROM immich_face_projection
          WHERE source_id = ${sourceId}
            AND reconciliation_state = 'exact_provider_bind'
        `
      )[0].count,
    ),
    4,
  );
  assert.equal(
    Number(
      (
        await sql`
          SELECT count(*)::int AS count
          FROM face_observation
          WHERE asset_id = ${assetId} AND observation_origin = 'immich_import'
        `
      )[0].count,
    ),
    1,
  );
  assert.equal(
    Number(
      (
        await sql`
          SELECT count(*)::int AS count FROM identity_claim claim
          JOIN immich_face_projection projection
            ON projection.identity_claim_id = claim.identity_claim_id
          WHERE projection.source_id = ${sourceId} AND claim.state = 'accepted'
            AND claim.origin = 'trusted_import'
        `
      )[0].count,
    ),
    4,
  );
  assert.equal(
    (await loadSourcePackFaces(sql, { configDigest: digest })).length,
    4,
  );
  assert.equal(
    Number(
      (
        await sql`SELECT count(*)::int AS count FROM source_pack WHERE state = 'active'`
      )[0].count,
    ),
    0,
  );
  await sql`
    INSERT INTO face_observation (
      face_id, asset_id, box_x, box_y, box_w, box_h, detection_confidence,
      quality_measurements, state, producer_receipt_id, observation_origin
    ) VALUES (
      'face_onboarding_source_only_fixture', ${assetId}, 0.01, 0.7, 0.1, 0.1,
      NULL, '{}'::jsonb, 'valid',
      'receipt_cimmich_immich_onboarding_identity_import_v1', 'immich_import'
    ) ON CONFLICT (face_id) DO NOTHING
  `;
  await assert.rejects(
    sql`
      INSERT INTO face_embedding (
        embedding_id, face_id, model_family, model_version, config_digest,
        dimension, normalized, embedding, vector_digest, state,
        producer_receipt_id, privacy_class
      ) SELECT 'forged_immich_import_embedding', face_id, 'synthetic', 'v1',
        ${digest}, 3, true, '[1,0,0]'::vector, ${"f".repeat(64)}, 'active',
        'receipt_service_fixture', 'sensitive-biometric'
      FROM face_observation
      WHERE face_id = 'face_onboarding_source_only_fixture'
    `,
    /IMMICH_IMPORT_FACE_EMBEDDING_FORBIDDEN_DB|no rows/i,
  );
  const [{ schema_version: schemaVersion }] = await sql`
    SELECT max(version)::integer AS schema_version
    FROM cimmich_schema_migration
  `;
  process.stdout.write(
    `${JSON.stringify({
      acceptedFaces: 5,
      automaticIdentityAuthority: "none",
      exactProviderBinds: 5,
      schemaVersion,
      status: "PASS",
    })}\n`,
  );
} finally {
  await sql.end({ timeout: 5 });
}
