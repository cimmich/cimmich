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
      // The whole-grid snapshot path must bind its empty person filter as
      // text. PostgreSQL cannot infer a standalone parameter's type from
      // `parameter <> ''`, which previously made boot prewarm and the first
      // People load fail with 42P18 despite unit-query-shape coverage.
      await repository.people({ limit: 500 });
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

      const moved = await repository.setFaceBucket({
        actorId: "integration-test",
        bucketKind: "secondary",
        faceId: "face_review_alex",
        personId: "person_face_review_alex",
      });
      assert.equal(moved.changed, true);
      const [secondary] = await sql`
        SELECT bucket_id
        FROM reference_bucket
        WHERE person_id = 'person_face_review_alex'
          AND bucket_kind = 'secondary'
          AND state = 'active'
      `;
      assert.ok(secondary.bucket_id);
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
);

integrationTest(
  "grouped Person proposals materialise typed candidate evidence",
  async () => {
    const sql = postgres(databaseUrl, { max: 2, prepare: true });
    try {
      await sql`
            INSERT INTO source_snapshot (
              snapshot_id, input_schema_version, source_digest,
              locator_root_token, started_at, completed_at,
              observed_asset_count, state
            ) VALUES (
              'snapshot_possible_people_resolution_test', 'test.v1',
              ${"8".repeat(64)}, 'possible-people-resolution-root',
              now(), now(), 1, 'complete'
            )
          `;
      await sql`
            INSERT INTO asset (
              asset_id, locator_token, media_kind, mime_type, width, height,
              source_snapshot_id, state
            ) VALUES (
              'asset_possible_people_resolution_test', 'grouped-face.jpg',
              'image', 'image/jpeg', 800, 600,
              'snapshot_possible_people_resolution_test', 'active'
            )
          `;
      await sql`
            INSERT INTO person (
              person_id, display_name, status, created_by_receipt_id,
              subject_kind
            ) VALUES (
              'person_possible_people_resolution_test', 'Grouped Person',
              'active', 'receipt_cimmich_possible_people_v1', 'person'
            )
          `;
      await sql`
            INSERT INTO face_observation (
              face_id, asset_id, box_x, box_y, box_w, box_h,
              detection_confidence, state, producer_receipt_id
            ) VALUES (
              'face_possible_people_resolution_test',
              'asset_possible_people_resolution_test',
              0.1, 0.1, 0.3, 0.3, 0.9, 'valid',
              'receipt_cimmich_possible_people_v1'
            )
          `;
      await sql`
            INSERT INTO possible_person_run (
              run_id, command_id, state, algorithm_version, seed_limit,
              neighbour_limit, similarity_floor, total_seeds,
              processed_seeds, cluster_count, completed_at,
              classification_state, classification_version,
              classified_cluster_count, classification_completed_at
            ) VALUES (
              'possible_run_11111111111111111111111111111111',
              'possible-people.integration.refresh', 'completed',
              'cimmich-possible-people-graph-v1', 100, 12, 0.55, 1, 1, 1,
              now(), 'completed', 'cimmich-possible-people-known-person-v1',
              1, now()
            )
          `;
      await sql`
            INSERT INTO face_cluster (
              cluster_id, producer_receipt_id, status, member_count,
              possible_person_run_id, cluster_digest,
              representative_face_id, evidence, source_revision,
              suggested_person_id, suggestion_evidence,
              classification_version, classified_at
            ) VALUES (
              'cluster_possible_people_resolution_test',
              'receipt_cimmich_possible_people_v1', 'open', 1,
              'possible_run_11111111111111111111111111111111',
              ${"7".repeat(64)}, 'face_possible_people_resolution_test',
              '{}'::jsonb, 'test-revision',
              'person_possible_people_resolution_test', '{}'::jsonb,
              'cimmich-possible-people-known-person-v1', now()
            )
          `;
      await sql`
            INSERT INTO face_cluster_member (
              cluster_id, face_id, membership_score, rank
            ) VALUES (
              'cluster_possible_people_resolution_test',
              'face_possible_people_resolution_test', 0.91, 1
            )
          `;

      const repository = createCimmichRepository(sql, new Map(), {
        currentRank: () => 0,
      });
      const result = await repository.possiblePeopleResolve({
        action: "existing_person",
        actorId: "integration-test",
        clusterId: "cluster_possible_people_resolution_test",
        commandId: "possible-people.integration.resolve",
        personId: "person_possible_people_resolution_test",
        snapshotDigest: "7".repeat(64),
      });

      assert.equal(result.candidateCount, 1);
      const [claim] = await sql`
            SELECT evidence_refs
            FROM identity_claim
            WHERE face_id = 'face_possible_people_resolution_test'
          `;
      assert.equal(
        claim.evidence_refs.cluster_id,
        "cluster_possible_people_resolution_test",
      );
      assert.equal(
        claim.evidence_refs.policy_version,
        "cimmich-possible-people-graph-v1",
      );
      assert.equal(
        claim.evidence_refs.run_id,
        "possible_run_11111111111111111111111111111111",
      );
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
);
