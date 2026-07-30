import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";
import { createCimmichRepository } from "../src/repository.mjs";

const databaseUrl = process.env.CIMMICH_TEST_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;
const digest = "f".repeat(64);

integrationTest(
  "Face review chooses the compatible space with the widest accepted library",
  async () => {
    const sql = postgres(databaseUrl, { max: 2, prepare: true });
    try {
      await sql`
        INSERT INTO source_snapshot (
          snapshot_id, input_schema_version, source_digest, locator_root_token,
          started_at, completed_at, observed_asset_count, state
        ) VALUES (
          'snapshot_face_review_test', 'test.v1', ${"9".repeat(64)},
          'face-review-root', now(), now(), 3, 'complete'
        )
      `;
      await sql`
        INSERT INTO asset (
          asset_id, locator_token, media_kind, mime_type, width, height,
          source_snapshot_id, state
        ) VALUES
          ('asset_face_review_query', 'query.jpg', 'image', 'image/jpeg',
            800, 600, 'snapshot_face_review_test', 'active'),
          ('asset_face_review_alex', 'alex.jpg', 'image', 'image/jpeg',
            800, 600, 'snapshot_face_review_test', 'active'),
          ('asset_face_review_maya', 'maya.jpg', 'image', 'image/jpeg',
            800, 600, 'snapshot_face_review_test', 'active')
      `;
      await sql`
        INSERT INTO person (
          person_id, display_name, status, created_by_receipt_id, subject_kind
        ) VALUES
          ('person_face_review_alex', 'Alex', 'active',
            'receipt_cimmich_pet_matching_v1', 'person'),
          ('person_face_review_maya', 'Maya', 'active',
            'receipt_cimmich_pet_matching_v1', 'person')
      `;
      await sql`
        INSERT INTO face_observation (
          face_id, asset_id, box_x, box_y, box_w, box_h,
          detection_confidence, state, producer_receipt_id
        ) VALUES
          ('face_review_query', 'asset_face_review_query',
            0.1, 0.1, 0.3, 0.3, 0.9, 'valid',
            'receipt_cimmich_pet_matching_v1'),
          ('face_review_alex', 'asset_face_review_alex',
            0.1, 0.1, 0.3, 0.3, 0.9, 'valid',
            'receipt_cimmich_pet_matching_v1'),
          ('face_review_maya', 'asset_face_review_maya',
            0.1, 0.1, 0.3, 0.3, 0.9, 'valid',
            'receipt_cimmich_pet_matching_v1')
      `;
      await sql`
        INSERT INTO face_embedding (
          embedding_id, face_id, model_family, model_version, config_digest,
          dimension, normalized, embedding, vector_digest, state,
          producer_receipt_id
        ) VALUES
          ('embedding_face_review_query_wide', 'face_review_query',
            'review-model', 'v1', 'wide', 3, true, '[1,0,0]'::vector,
            ${digest}, 'active', 'receipt_cimmich_pet_matching_v1'),
          ('embedding_face_review_query_narrow', 'face_review_query',
            'review-model', 'v1', 'narrow', 3, true, '[0,1,0]'::vector,
            ${digest}, 'active', 'receipt_cimmich_pet_matching_v1'),
          ('embedding_face_review_alex_wide', 'face_review_alex',
            'review-model', 'v1', 'wide', 3, true, '[1,0,0]'::vector,
            ${digest}, 'active', 'receipt_cimmich_pet_matching_v1'),
          ('embedding_face_review_maya_wide', 'face_review_maya',
            'review-model', 'v1', 'wide', 3, true, '[0.8,0.6,0]'::vector,
            ${digest}, 'active', 'receipt_cimmich_pet_matching_v1'),
          ('embedding_face_review_alex_narrow', 'face_review_alex',
            'review-model', 'v1', 'narrow', 3, true, '[0,1,0]'::vector,
            ${digest}, 'active', 'receipt_cimmich_pet_matching_v1')
      `;
      await sql`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, producer_receipt_id
        ) VALUES
          ('decision_face_review_alex', 'face', 'face_review_alex', 'accept',
            'user', 'integration-test', 'integration-test',
            'receipt_cimmich_pet_matching_v1'),
          ('decision_face_review_maya', 'face', 'face_review_maya', 'accept',
            'user', 'integration-test', 'integration-test',
            'receipt_cimmich_pet_matching_v1')
      `;
      await sql`
        INSERT INTO identity_claim (
          identity_claim_id, face_id, person_id, origin, state,
          calibrated_confidence, decision_id, producer_receipt_id
        ) VALUES
          ('claim_face_review_alex', 'face_review_alex',
            'person_face_review_alex', 'user', 'accepted', 1,
            'decision_face_review_alex', 'receipt_cimmich_pet_matching_v1'),
          ('claim_face_review_maya', 'face_review_maya',
            'person_face_review_maya', 'user', 'accepted', 1,
            'decision_face_review_maya', 'receipt_cimmich_pet_matching_v1')
      `;

      const repository = createCimmichRepository(sql, new Map(), {
        currentRank: () => 0,
      });
      const result = await repository.faceReviewComparisons({
        faceId: "face_review_query",
        limit: 5,
      });

      assert.deepEqual(
        result.items.map(({ display_name }) => display_name),
        ["Alex", "Maya"],
      );
      assert.equal(Number(result.items[0].similarity), 1);
      assert.ok(Math.abs(Number(result.items[1].similarity) - 0.8) < 1e-6);
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
);
