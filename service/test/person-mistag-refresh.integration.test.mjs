import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";

import { createPersonMistagRefresher } from "../src/person-mistag-refresh.mjs";

const databaseUrl = process.env.CIMMICH_TEST_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;
const digest = "d".repeat(64);
const vector512 = (first, second) =>
  `[${first},${second},${Array.from({ length: 510 }, () => 0).join(",")}]`;

integrationTest(
  "Person mistag refresh executes against the current schema and excludes a Person already in the photo",
  async () => {
    const sql = postgres(databaseUrl, { max: 2, prepare: true });
    try {
      await sql`
        INSERT INTO source_snapshot (
          snapshot_id, input_schema_version, source_digest,
          locator_root_token, started_at, completed_at,
          observed_asset_count, state
        ) VALUES (
          'snapshot_person_mistag_refresh_test', 'test.v1', ${"c".repeat(64)},
          'person-mistag-refresh-root', now(), now(), 3, 'complete'
        )
      `;
      await sql`
        INSERT INTO asset (
          asset_id, locator_token, media_kind, mime_type, width, height,
          source_snapshot_id, state
        ) VALUES
          ('asset_mistag_query', 'query.jpg', 'image', 'image/jpeg',
            800, 600, 'snapshot_person_mistag_refresh_test', 'active'),
          ('asset_mistag_assigned', 'assigned.jpg', 'image', 'image/jpeg',
            800, 600, 'snapshot_person_mistag_refresh_test', 'active'),
          ('asset_mistag_alternative', 'alternative.jpg', 'image', 'image/jpeg',
            800, 600, 'snapshot_person_mistag_refresh_test', 'active')
      `;
      await sql`
        INSERT INTO person (
          person_id, display_name, status, created_by_receipt_id, subject_kind
        ) VALUES
          ('person_mistag_assigned', 'Assigned Person', 'active',
            'receipt_cimmich_pet_matching_v1', 'person'),
          ('person_mistag_alternative', 'Alternative Person', 'active',
            'receipt_cimmich_pet_matching_v1', 'person')
      `;
      await sql`
        INSERT INTO face_observation (
          face_id, asset_id, box_x, box_y, box_w, box_h,
          detection_confidence, state, producer_receipt_id
        ) VALUES
          ('face_mistag_query', 'asset_mistag_query',
            0.1, 0.1, 0.2, 0.2, 0.9, 'valid',
            'receipt_cimmich_pet_matching_v1'),
          ('face_mistag_assigned', 'asset_mistag_assigned',
            0.1, 0.1, 0.2, 0.2, 0.9, 'valid',
            'receipt_cimmich_pet_matching_v1'),
          ('face_mistag_alternative', 'asset_mistag_alternative',
            0.1, 0.1, 0.2, 0.2, 0.9, 'valid',
            'receipt_cimmich_pet_matching_v1')
      `;
      await sql`
        INSERT INTO face_embedding (
          embedding_id, face_id, model_family, model_version, config_digest,
          dimension, normalized, embedding, vector_digest, state,
          producer_receipt_id
        ) VALUES
          ('embedding_mistag_query', 'face_mistag_query',
            'mistag-model', 'v1', 'mistag-config', 512, true,
            ${vector512(1, 0)}::vector, ${digest}, 'active',
            'receipt_cimmich_pet_matching_v1'),
          ('embedding_mistag_assigned', 'face_mistag_assigned',
            'mistag-model', 'v1', 'mistag-config', 512, true,
            ${vector512(0, 1)}::vector, ${digest}, 'active',
            'receipt_cimmich_pet_matching_v1'),
          ('embedding_mistag_alternative', 'face_mistag_alternative',
            'mistag-model', 'v1', 'mistag-config', 512, true,
            ${vector512(1, 0)}::vector, ${digest}, 'active',
            'receipt_cimmich_pet_matching_v1')
      `;
      await sql`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, producer_receipt_id
        ) VALUES
          ('decision_mistag_query', 'face', 'face_mistag_query', 'accept',
            'user', 'integration-test', 'integration-test',
            'receipt_cimmich_pet_matching_v1'),
          ('decision_mistag_assigned', 'face', 'face_mistag_assigned', 'accept',
            'user', 'integration-test', 'integration-test',
            'receipt_cimmich_pet_matching_v1'),
          ('decision_mistag_alternative', 'face', 'face_mistag_alternative',
            'accept', 'user', 'integration-test', 'integration-test',
            'receipt_cimmich_pet_matching_v1')
      `;
      await sql`
        INSERT INTO identity_claim (
          identity_claim_id, face_id, person_id, origin, state,
          calibrated_confidence, decision_id, producer_receipt_id
        ) VALUES
          ('claim_mistag_query', 'face_mistag_query',
            'person_mistag_assigned', 'user', 'accepted', 1,
            'decision_mistag_query', 'receipt_cimmich_pet_matching_v1'),
          ('claim_mistag_assigned', 'face_mistag_assigned',
            'person_mistag_assigned', 'user', 'accepted', 1,
            'decision_mistag_assigned', 'receipt_cimmich_pet_matching_v1'),
          ('claim_mistag_alternative', 'face_mistag_alternative',
            'person_mistag_alternative', 'user', 'accepted', 1,
            'decision_mistag_alternative', 'receipt_cimmich_pet_matching_v1')
      `;
      await sql`
        INSERT INTO reference_bucket (
          bucket_id, person_id, bucket_kind, created_by, policy_version,
          state, producer_receipt_id
        ) VALUES
          ('bucket_mistag_assigned', 'person_mistag_assigned', 'prime',
            'user', 'integration-test', 'active',
            'receipt_cimmich_pet_matching_v1'),
          ('bucket_mistag_alternative', 'person_mistag_alternative', 'prime',
            'user', 'integration-test', 'active',
            'receipt_cimmich_pet_matching_v1')
      `;
      await sql`
        INSERT INTO bucket_membership_event (
          membership_event_id, bucket_id, face_id, action, actor_kind,
          reason_code, producer_receipt_id
        ) VALUES
          ('membership_mistag_assigned', 'bucket_mistag_assigned',
            'face_mistag_assigned', 'activate', 'user', 'integration-test',
            'receipt_cimmich_pet_matching_v1'),
          ('membership_mistag_alternative', 'bucket_mistag_alternative',
            'face_mistag_alternative', 'activate', 'user', 'integration-test',
            'receipt_cimmich_pet_matching_v1')
      `;
      await sql`
        INSERT INTO source_pack (
          pack_id, pack_digest, model_family, model_version, config_digest,
          dimension, policy_version, source_revision_digest, evidence_cutoff,
          manifest, state, evaluation_status, producer_receipt_id
        ) VALUES (
          'sourcepack_person_mistag_refresh_test', ${"b".repeat(64)},
          'mistag-model', 'v1', 'mistag-config', 512, 'integration-test',
          ${"a".repeat(64)}, now(), '{}'::jsonb, 'retired', 'passed',
          'receipt_cimmich_pet_matching_v1'
        )
      `;
      await sql`
        INSERT INTO identity_audit_run (
          audit_run_id, pack_id, policy_version, score_floor, margin_floor,
          state, contradiction_candidates, completed_at
        ) VALUES (
          'audit_person_mistag_refresh_test',
          'sourcepack_person_mistag_refresh_test', 'integration-test',
          0.35, 0.21, 'completed', 1, now()
        )
      `;
      await sql`
        INSERT INTO identity_audit_item (
          audit_run_id, audit_kind, face_id, asset_id, assigned_person_id,
          suggested_person_id, suggested_score, comparison_score, margin,
          evidence_route, suggested_reference_asset_id
        ) VALUES (
          'audit_person_mistag_refresh_test', 'accepted_contradiction',
          'face_mistag_query', 'asset_mistag_query',
          'person_mistag_assigned', 'person_mistag_alternative',
          0.8, 0.2, 0.6, 'cross_person_match',
          'asset_mistag_alternative'
        )
      `;

      const refresher = createPersonMistagRefresher({
        requireVisibleSubject: async () => {},
        sql,
      });
      const retained = await refresher.refresh({
        personId: "person_mistag_assigned",
      });
      assert.equal(retained.reevaluatedCount, 1);
      assert.equal(retained.remainingCount, 1);
      const [refreshed] = await sql`
        SELECT suggested_person_id, suggested_score, comparison_score
        FROM identity_audit_item
        WHERE audit_run_id = 'audit_person_mistag_refresh_test'
      `;
      assert.equal(refreshed.suggested_person_id, "person_mistag_alternative");
      assert.ok(Number(refreshed.suggested_score) > 0.99);
      assert.ok(Number(refreshed.comparison_score) < 0.01);

      await sql`
        INSERT INTO face_observation (
          face_id, asset_id, box_x, box_y, box_w, box_h,
          detection_confidence, state, producer_receipt_id
        ) VALUES (
          'face_mistag_same_photo_alternative', 'asset_mistag_query',
          0.6, 0.1, 0.2, 0.2, 0.9, 'valid',
          'receipt_cimmich_pet_matching_v1'
        )
      `;
      await sql`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, producer_receipt_id
        ) VALUES (
          'decision_mistag_same_photo_alternative', 'face',
          'face_mistag_same_photo_alternative', 'accept', 'user',
          'integration-test', 'integration-test',
          'receipt_cimmich_pet_matching_v1'
        )
      `;
      await sql`
        INSERT INTO identity_claim (
          identity_claim_id, face_id, person_id, origin, state,
          calibrated_confidence, decision_id, producer_receipt_id
        ) VALUES (
          'claim_mistag_same_photo_alternative',
          'face_mistag_same_photo_alternative',
          'person_mistag_alternative', 'user', 'accepted', 1,
          'decision_mistag_same_photo_alternative',
          'receipt_cimmich_pet_matching_v1'
        )
      `;
      const resolved = await refresher.refresh({
        personId: "person_mistag_assigned",
      });
      assert.equal(resolved.reevaluatedCount, 1);
      assert.equal(resolved.resolvedCount, 1);
      const [remaining] = await sql`
        SELECT count(*)::int AS count
        FROM identity_audit_item
        WHERE audit_run_id = 'audit_person_mistag_refresh_test'
      `;
      assert.equal(remaining.count, 0);
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
);
