import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";
import { createPetMatchingStore } from "../src/pet-matching.mjs";

const databaseUrl = process.env.CIMMICH_TEST_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;
const sha = "b".repeat(64);

integrationTest(
  "imports, reviews, and realizes Pet match evidence",
  async () => {
    const sql = postgres(databaseUrl, { max: 2, prepare: true });
    try {
      await sql`
      INSERT INTO source_snapshot (
        snapshot_id, input_schema_version, source_digest, locator_root_token,
        started_at, completed_at, observed_asset_count, state
      ) VALUES (
        'snapshot_petmatch_test', 'test.v1', ${"c".repeat(64)}, 'test-root',
        now(), now(), 3, 'complete'
      )
    `;
      await sql`
      INSERT INTO asset (
        asset_id, locator_token, media_kind, mime_type, width, height,
        source_snapshot_id, state
      ) VALUES
        ('asset_petmatch_dog', 'dog.jpg', 'image', 'image/jpeg', 1200, 800,
          'snapshot_petmatch_test', 'active'),
        ('asset_petmatch_unknown_dog', 'unknown-dog.jpg', 'image', 'image/jpeg', 900, 900,
          'snapshot_petmatch_test', 'active'),
        ('asset_petmatch_not_dog', 'not-dog.jpg', 'image', 'image/jpeg', 900, 900,
          'snapshot_petmatch_test', 'active')
    `;
      await sql`
      INSERT INTO person (
        person_id, display_name, status, created_by_receipt_id,
        subject_kind, species_kind
      ) VALUES
        ('person_petmatch_cafe', 'Café', 'active',
          'receipt_cimmich_pet_matching_v1', 'pet', 'dog')
    `;

      const store = createPetMatchingStore(sql, {
        bridgeFields: (assetId) => ({
          filename: `${assetId}.jpg`,
          sourceAssetId: `immich-${assetId}`,
        }),
      });
      const imported = await store.importBatch({
        actorId: "integration-test",
        packet: {
          observations: [
            {
              assetId: "asset_petmatch_dog",
              box: { h: 0.5, w: 0.4, x: 0.1, y: 0.2 },
              candidates: [
                {
                  galleryCount: 4,
                  petId: "person_petmatch_cafe",
                  score: 0.736,
                },
              ],
              detectionConfidence: 0.91,
              embeddingDigest: sha,
              observationId: "petobservation_dog_test",
              speciesKind: "dog",
            },
            {
              assetId: "asset_petmatch_unknown_dog",
              box: { h: 0.6, w: 0.6, x: 0.2, y: 0.2 },
              candidates: [],
              detectionConfidence: 0.88,
              embeddingDigest: "d".repeat(64),
              observationId: "petobservation_unknown_test",
              speciesKind: "dog",
            },
            {
              assetId: "asset_petmatch_not_dog",
              box: { h: 0.4, w: 0.4, x: 0.3, y: 0.3 },
              candidates: [],
              detectionConfidence: 0.71,
              embeddingDigest: "e".repeat(64),
              observationId: "petobservation_not_dog_test",
              speciesKind: "dog",
            },
          ],
          provider: {
            configDigest: sha,
            lane: "face",
            modelFamily: "petface-arcface",
            modelVersion: "community-cat-dog-v1",
            providerId: "local.petface",
            speciesKind: "dog",
            vectorSpaceId: "petface-arcface-dog-512",
          },
          runId: "petmatchrun_face_test",
          schemaVersion: "cimmich.pet-matching.v1",
        },
      });
      assert.equal(imported.observationCount, 3);
      assert.equal((await store.status()).unknown, 2);

      const queue = await store.suggestions({
        limit: 20,
        petId: "person_petmatch_cafe",
      });
      assert.equal(queue.items.length, 1);
      assert.equal(queue.items[0].sourceAssetId, "immich-asset_petmatch_dog");

      const reviewed = await store.review({
        action: "confirm",
        actorId: "integration-test",
        commandId: "petmatchconfirm_test_0001",
        suggestionId: queue.items[0].suggestionId,
      });
      assert.equal(reviewed.lane, "face");
      const [claim] = await sql`
      SELECT claim.person_id, observation.asset_id
      FROM identity_claim claim
      JOIN face_observation observation ON observation.face_id = claim.face_id
      WHERE claim.identity_claim_id = ${reviewed.realizedAssociationId}
    `;
      assert.deepEqual(
        { assetId: claim.asset_id, petId: claim.person_id },
        { assetId: "asset_petmatch_dog", petId: "person_petmatch_cafe" },
      );
      const replay = await store.review({
        action: "confirm",
        actorId: "integration-test",
        commandId: "petmatchconfirm_test_0001",
        suggestionId: queue.items[0].suggestionId,
      });
      assert.equal(replay.replayed, true);

      const assigned = await store.resolveUnknown({
        action: "assign",
        actorId: "integration-test",
        commandId: "petmatchunknownassign_test_0001",
        observationId: "petobservation_unknown_test",
        petId: "person_petmatch_cafe",
      });
      assert.equal(assigned.petId, "person_petmatch_cafe");
      const [assignedClaim] = await sql`
      SELECT claim.person_id, observation.asset_id
      FROM identity_claim claim
      JOIN face_observation observation ON observation.face_id = claim.face_id
      WHERE claim.identity_claim_id = ${assigned.realizedAssociationId}
    `;
      assert.deepEqual(
        { assetId: assignedClaim.asset_id, petId: assignedClaim.person_id },
        {
          assetId: "asset_petmatch_unknown_dog",
          petId: "person_petmatch_cafe",
        },
      );
      const rejected = await store.resolveUnknown({
        action: "reject",
        actorId: "integration-test",
        commandId: "petmatchunknownreject_test_0001",
        observationId: "petobservation_not_dog_test",
      });
      assert.equal(rejected.action, "reject");
      assert.equal((await store.status()).unknown, 0);
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
);
