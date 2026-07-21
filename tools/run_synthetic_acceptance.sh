#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
RUN_ID=$$
CONTAINER="cimmich-pg-acceptance-$RUN_ID"
SERVICE_CONTAINER="cimmich-service-acceptance-$RUN_ID"
SERVICE_IMAGE="cimmich-service-acceptance:$RUN_ID"
IMAGE=pgvector/pgvector:0.8.2-pg17-trixie

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    docker logs "$SERVICE_CONTAINER" 2>&1 || true
  fi
  docker rm -f "$SERVICE_CONTAINER" >/dev/null 2>&1 || true
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  return "$status"
}
trap cleanup EXIT INT TERM
cleanup

docker run -d --name "$CONTAINER" \
  -e POSTGRES_DB=cimmich_test \
  -e POSTGRES_USER=cimmich_test \
  -e POSTGRES_PASSWORD=synthetic-only-password \
  -p 127.0.0.1::5432 \
  --tmpfs /var/lib/postgresql/data \
  "$IMAGE" >/dev/null

i=0
until docker exec "$CONTAINER" pg_isready -U cimmich_test -d cimmich_test >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    echo "database readiness timeout" >&2
    exit 1
  fi
  sleep 1
done

HOST_PORT=$(docker port "$CONTAINER" 5432/tcp | sed -n 's/.*://p' | head -n 1)
case "$HOST_PORT" in
  '' | *[!0-9]*)
    echo "database port discovery failed" >&2
    exit 1
    ;;
esac

docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0001_intelligence_v0.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0002_reference_prototype_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0003_source_pack_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0004_source_pack_guards_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0005_source_pack_rebuild_queue_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0006_source_pack_identity_guard_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0007_identity_setup_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0008_head_evidence_bucket_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0009_asset_head_evidence_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0010_person_categories_sort_trust_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0011_person_candidate_review_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0012_body_head_geometry_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0013_face_body_link_idempotence_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0014_face_body_identity_lifecycle_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0015_source_pack_guard_hardening_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0016_holding_workflow_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0017_evidence_projection_semantics_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0018_low_quality_matching_lane_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0019_source_reconciliation_identity_guard_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0020_evidence_modifiers_capture_context_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0021_capture_context_rebuild_queue_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0022_face_modifier_proposal_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0023_face_local_measurement_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0024_partial_region_visibility_v2.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0025_scoped_region_contamination_v3.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0026_review_query_performance_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0027_source_pack_activation_performance_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0028_source_pack_rebuild_worker_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0029_pet_manual_management_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0030_resumable_media_job_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0031_pet_species_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0032_immich_inventory_checkpoint_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0033_face_detection_result_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0034_media_pipeline_binding_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0035_media_operator_control_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0036_person_profile_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0037_visibility_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0038_visibility_projection_guard_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0039_person_projection_performance_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0040_person_details_display_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0041_manual_subject_presence_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0042_body_pose_evidence_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0043_pet_profile_document_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0044_context_entity_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0045_context_search_projection_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0046_context_search_hardening_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0047_document_v1.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/migrations/0048_document_lifecycle_compatibility_v1.sql"
DATABASE_URL="postgres://cimmich_test:synthetic-only-password@127.0.0.1:$HOST_PORT/cimmich_test" \
  npm --prefix "$ROOT/service" run migrate -- apply --adopt-existing 48
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/tests/sql/018_existing_face_recognition_provenance_acceptance.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/tests/sql/001_intelligence_acceptance.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/tests/sql/002_local_service_fixture.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/tests/sql/003_media_job_acceptance.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/tests/sql/004_person_profile_acceptance.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/tests/sql/005_visibility_acceptance.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/tests/sql/006_visibility_projection_acceptance.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/tests/sql/008_manual_subject_presence_acceptance.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/tests/sql/009_body_pose_evidence_acceptance.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/tests/sql/010_person_details_display_acceptance.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/tests/sql/011_pet_profile_document_acceptance.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/tests/sql/012_context_entity_acceptance.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/tests/sql/015_context_search_hardening_acceptance.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/tests/sql/016_document_v1_acceptance.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/tests/sql/017_document_lifecycle_compatibility_acceptance.sql"

docker build -q --target acceptance -f "$ROOT/service/Dockerfile" -t "$SERVICE_IMAGE" "$ROOT" >/dev/null
docker run -d --name "$SERVICE_CONTAINER" \
  --network "container:$CONTAINER" \
  -v "$ROOT/service/test/fixtures/synthetic-display-bridge.json:/tmp/cimmich-synthetic-display-bridge.json:ro" \
  -e DATABASE_URL=postgres://cimmich_test:synthetic-only-password@127.0.0.1:5432/cimmich_test \
  -e HOST=127.0.0.1 \
  -e PORT=3101 \
  -e CIMMICH_RUNTIME_MODE=acceptance \
  -e CIMMICH_VISIBILITY_TEST_MODE=true \
  -e CIMMICH_VISIBILITY_TEST_PASSWORD=1 \
  -e CIMMICH_VISIBILITY_PRIVATE_INACTIVITY_SECONDS=1 \
  -e CIMMICH_VISIBILITY_PRIVATE_ABSOLUTE_SECONDS=30 \
  -e CIMMICH_DOCUMENT_STORE_ROOT=/tmp/cimmich-documents \
  -e CIMMICH_DOCUMENT_MAX_FILE_BYTES=64 \
  -e CIMMICH_DOCUMENT_MAX_STORE_BYTES=64 \
  -e CIMMICH_DISPLAY_BRIDGE_PATH=/tmp/cimmich-synthetic-display-bridge.json \
  "$SERVICE_IMAGE" >/dev/null

i=0
until docker exec "$SERVICE_CONTAINER" node -e "fetch('http://127.0.0.1:3101/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "local service readiness timeout" >&2
    exit 1
  fi
  sleep 1
done
docker exec -e CIMMICH_PERSON_PROFILE_PHASE=write "$SERVICE_CONTAINER" \
  node acceptance/person-profile-journey.mjs
docker exec -e CIMMICH_PERSON_DETAILS_DISPLAY_PHASE=write "$SERVICE_CONTAINER" \
  node acceptance/person-details-display-journey.mjs
docker restart "$SERVICE_CONTAINER" >/dev/null
i=0
until docker exec "$SERVICE_CONTAINER" node -e "fetch('http://127.0.0.1:3101/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "local service restart persistence timeout" >&2
    exit 1
  fi
  sleep 1
done
docker exec -e CIMMICH_PERSON_PROFILE_PHASE=readback "$SERVICE_CONTAINER" \
  node acceptance/person-profile-journey.mjs
docker exec -e CIMMICH_PERSON_DETAILS_DISPLAY_PHASE=readback "$SERVICE_CONTAINER" \
  node acceptance/person-details-display-journey.mjs
docker exec "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test -c \
  "DO \$\$ BEGIN
    IF EXISTS (
      SELECT 1 FROM pg_views
      WHERE schemaname = 'public' AND definition ILIKE '%person_profile%'
    ) THEN
      RAISE EXCEPTION 'Person Profile tables leaked into an existing database projection';
    END IF;
    IF EXISTS (
      SELECT 1 FROM person WHERE coalesce(display_name, '') ILIKE '%private-profile-sentinel-7c4e9a%'
      UNION ALL
      SELECT 1 FROM person_alias WHERE label ILIKE '%private-profile-sentinel-7c4e9a%'
      UNION ALL
      SELECT 1 FROM asset WHERE locator_token ILIKE '%private-profile-sentinel-7c4e9a%'
      UNION ALL
      SELECT 1 FROM decision WHERE note ILIKE '%private-profile-sentinel-7c4e9a%'
      UNION ALL
      SELECT 1 FROM identity_claim
        WHERE evidence_refs::text ILIKE '%private-profile-sentinel-7c4e9a%'
      UNION ALL
      SELECT 1 FROM source_pack
        WHERE manifest::text ILIKE '%private-profile-sentinel-7c4e9a%'
    ) THEN
      RAISE EXCEPTION 'Person Profile value escaped its dedicated Cimmich tables';
    END IF;
  END \$\$;" >/dev/null
docker exec "$SERVICE_CONTAINER" node bin/link-face-bodies.mjs --asset-id=asset_body_link_clear_fixture --execute
docker exec "$SERVICE_CONTAINER" node bin/link-face-bodies.mjs --asset-id=asset_body_link_clear_fixture --execute
docker exec "$SERVICE_CONTAINER" node bin/link-face-bodies.mjs --asset-id=asset_body_link_ambiguous_fixture
docker exec "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test -c \
  "DO \$\$ BEGIN
    IF (SELECT count(*) FROM current_body_tag WHERE body_id = 'body_link_clear_fixture' AND state = 'accepted') <> 1 THEN
      RAISE EXCEPTION 'deterministic face-body link was not accepted exactly once';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM current_body_tag
      WHERE body_id = 'body_link_clear_fixture' AND person_id = 'person_body_link_fixture'
        AND supporting_face_id = 'face_body_link_clear_fixture'
        AND identity_claim_id = 'claim_body_link_clear_fixture'
        AND origin = 'face_body_linkage' AND state = 'accepted'
    ) THEN
      RAISE EXCEPTION 'face-body linkage provenance contract failed';
    END IF;
    IF EXISTS (
      SELECT 1 FROM current_body_tag
      WHERE body_id IN ('body_link_ambiguous_a_fixture','body_link_ambiguous_b_fixture')
    ) THEN
      RAISE EXCEPTION 'ambiguous face-body ownership did not abstain';
    END IF;
  END \$\$;" >/dev/null
docker exec "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test -c \
  "DO \$\$ DECLARE previous_tag text; BEGIN
    SELECT body_tag_id INTO previous_tag FROM current_body_tag
    WHERE body_id = 'body_link_clear_fixture' AND state = 'accepted';
    INSERT INTO decision (
      decision_id, subject_type, subject_id, action, actor_kind, actor_id,
      reason_code, producer_receipt_id
    ) VALUES (
      'decision_body_link_reject_fixture', 'identity_claim', 'claim_body_link_clear_fixture',
      'reject', 'policy', 'synthetic-lifecycle', 'synthetic-correction', 'receipt_service_fixture'
    );
    UPDATE identity_claim SET state = 'rejected', decision_id = 'decision_body_link_reject_fixture'
    WHERE identity_claim_id = 'claim_body_link_clear_fixture';
    IF EXISTS (SELECT 1 FROM current_body_tag WHERE body_id = 'body_link_clear_fixture' AND state = 'accepted') THEN
      RAISE EXCEPTION 'rejected supporting face left a derived BodyTag accepted';
    END IF;

    INSERT INTO decision (
      decision_id, subject_type, subject_id, action, actor_kind, actor_id,
      reason_code, producer_receipt_id
    ) VALUES (
      'decision_body_link_restore_fixture', 'identity_claim', 'claim_body_link_restore_fixture',
      'accept', 'policy', 'synthetic-lifecycle', 'synthetic-correction', 'receipt_service_fixture'
    );
    INSERT INTO identity_claim (
      identity_claim_id, face_id, person_id, origin, state, calibrated_confidence,
      evidence_refs, decision_id, supersedes_claim_id, producer_receipt_id
    ) VALUES (
      'claim_body_link_restore_fixture', 'face_body_link_clear_fixture', 'person_body_link_fixture',
      'user', 'accepted', 1, '[\"synthetic-restored\"]', 'decision_body_link_restore_fixture',
      'claim_body_link_clear_fixture', 'receipt_service_fixture'
    );
    IF NOT EXISTS (
      SELECT 1 FROM current_body_tag
      WHERE body_id = 'body_link_clear_fixture' AND person_id = 'person_body_link_fixture'
        AND supporting_face_id = 'face_body_link_clear_fixture'
        AND identity_claim_id = 'claim_body_link_restore_fixture'
        AND supersedes_body_tag_id = previous_tag AND state = 'accepted'
    ) THEN
      RAISE EXCEPTION 'accepted replacement identity did not restore derived body ownership';
    END IF;

    INSERT INTO body_observation (
      body_id, asset_id, box_x, box_y, box_w, box_h, state, producer_receipt_id
    ) VALUES (
      'body_invalid_cross_asset_fixture', 'asset_split_fixture', 0.1, 0.1, 0.5, 0.8,
      'valid', 'receipt_service_fixture'
    );
    BEGIN
      INSERT INTO body_tag (
        body_tag_id, person_id, body_id, origin, state, supporting_face_id,
        identity_claim_id, confidence, producer_receipt_id
      ) VALUES (
        'bodytag_invalid_cross_asset_fixture', 'person_body_link_fixture',
        'body_invalid_cross_asset_fixture', 'face_body_linkage', 'accepted',
        'face_body_link_ambiguous_fixture', 'claim_body_link_ambiguous_fixture', 1, 'receipt_service_fixture'
      );
      RAISE EXCEPTION 'invalid cross-asset derived BodyTag was accepted';
    EXCEPTION WHEN check_violation THEN
      NULL;
    END;
  END \$\$;" >/dev/null
docker exec "$SERVICE_CONTAINER" node bin/curate-prime.mjs --execute
docker exec "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test -c \
  "DO \$\$ BEGIN IF (SELECT count(*) FROM current_reference_prototype) <> 2 THEN RAISE EXCEPTION 'Prime curator prototype acceptance failed'; END IF; END \$\$;" >/dev/null
docker exec "$SERVICE_CONTAINER" node bin/compile-source-pack.mjs \
  --cutoff=2020-12-31T23:59:59Z --model-version=v1 --execute
docker exec "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test -c \
  "DO \$\$ DECLARE candidate_pack text; BEGIN
    IF (SELECT count(*) FROM source_pack WHERE state = 'proposed') <> 1 THEN
      RAISE EXCEPTION 'SourcePack proposal acceptance failed';
    END IF;
    IF (SELECT count(*) FROM source_pack_reference WHERE reference_kind = 'prototype') <> 2 THEN
      RAISE EXCEPTION 'SourcePack prototype acceptance failed';
    END IF;
    IF (SELECT count(*) FROM current_source_pack) <> 0 THEN
      RAISE EXCEPTION 'Unqualified SourcePack activated';
    END IF;
    BEGIN
      UPDATE source_pack SET state = 'active';
      RAISE EXCEPTION 'SourcePack activation guard did not fire';
    EXCEPTION WHEN check_violation THEN
      NULL;
    END;

    SELECT pack_id INTO candidate_pack FROM source_pack WHERE state = 'proposed' LIMIT 1;
    INSERT INTO source_pack_evaluation (
      evaluation_id, pack_id, evaluator_version, split_definition, cohort_digest,
      leakage_assertions, metrics, status, producer_receipt_id
    ) VALUES (
      'evaluation_source_pack_fixture', candidate_pack, 'synthetic-v1', '{\"kind\":\"synthetic\"}',
      repeat('1', 64), '{\"passed\":true}', '{\"verifiedUnknowns\":1}', 'passed',
      'receipt_service_fixture'
    );
    UPDATE source_pack SET evaluation_status = 'passed' WHERE pack_id = candidate_pack;
    UPDATE source_pack SET state = 'active' WHERE pack_id = candidate_pack;

    BEGIN
      UPDATE identity_claim
      SET state = 'rejected'
      WHERE identity_claim_id = (
        SELECT claim.identity_claim_id
        FROM source_pack_reference reference
        CROSS JOIN LATERAL unnest(
          CASE
            WHEN reference.reference_kind = 'face' THEN ARRAY[reference.face_id]
            ELSE reference.member_face_ids
          END
        ) member(face_id)
        JOIN identity_claim claim
          ON claim.face_id = member.face_id
         AND claim.person_id = reference.person_id
         AND claim.state = 'accepted'
        WHERE reference.pack_id = candidate_pack
        ORDER BY reference.reference_id, member.face_id
        LIMIT 1
      );
      IF EXISTS (SELECT 1 FROM source_pack WHERE pack_id = candidate_pack AND state = 'active') THEN
        RAISE EXCEPTION 'accepted identity correction did not retire its active SourcePack'
          USING ERRCODE = '23514';
      END IF;
      -- The exception subtransaction rolls the destructive probe back so the
      -- remainder of synthetic acceptance exercises the original fixture.
      RAISE EXCEPTION 'rollback successful identity correction probe' USING ERRCODE = 'ZX001';
    EXCEPTION WHEN SQLSTATE 'ZX001' THEN
      NULL;
    END;

    BEGIN
      DELETE FROM source_pack_reference
      WHERE pack_id = candidate_pack AND reference_id = (
        SELECT reference_id FROM source_pack_reference WHERE pack_id = candidate_pack LIMIT 1
      );
      RAISE EXCEPTION 'active SourcePack reference delete was accepted';
    EXCEPTION WHEN check_violation THEN
      NULL;
    END;
    BEGIN
      UPDATE source_pack SET evaluation_status = 'failed' WHERE pack_id = candidate_pack;
      RAISE EXCEPTION 'active SourcePack evaluation downgrade was accepted';
    EXCEPTION WHEN check_violation THEN
      NULL;
    END;
    BEGIN
      INSERT INTO source_pack (
        pack_id, pack_digest, model_family, model_version, config_digest, dimension,
        policy_version, source_revision_digest, evidence_cutoff, manifest, state,
        evaluation_status, producer_receipt_id
      ) VALUES (
        'pack_direct_active_fixture', repeat('2', 64), 'test_face', 'v2', 'config_direct', 4,
        'synthetic', repeat('3', 64), now(), '{\"referenceDigests\":[]}', 'active', 'passed',
        'receipt_service_fixture'
      );
      RAISE EXCEPTION 'direct active SourcePack insert was accepted';
    EXCEPTION WHEN check_violation THEN
      NULL;
    END;
  END \$\$;" >/dev/null
docker exec "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test -c \
  "DO \$\$ DECLARE
    held_person text;
    active_pack text;
  BEGIN
    SELECT ref.person_id, ref.pack_id INTO held_person, active_pack
    FROM source_pack_reference ref
    JOIN source_pack pack ON pack.pack_id = ref.pack_id AND pack.state = 'active'
    ORDER BY ref.person_id, ref.reference_id
    LIMIT 1;
    IF held_person IS NULL OR active_pack IS NULL THEN
      RAISE EXCEPTION 'Holding SourcePack test requires an active referenced Person';
    END IF;

    INSERT INTO person_category_membership_event (
      membership_event_id, person_id, category_id, action, actor_kind, actor_id,
      producer_receipt_id, privacy_class
    ) VALUES (
      'categoryevent_holding_pack_guard_add', held_person, 'category_holding', 'add',
      'system', 'synthetic-acceptance', 'receipt_service_fixture', 'release-safe'
    );
    IF EXISTS (SELECT 1 FROM source_pack WHERE pack_id = active_pack AND state = 'active') THEN
      RAISE EXCEPTION 'Holding did not retire an active SourcePack containing that Person';
    END IF;
    BEGIN
      UPDATE source_pack SET state = 'active' WHERE pack_id = active_pack;
      RAISE EXCEPTION 'Holding SourcePack activation guard did not fire';
    EXCEPTION WHEN check_violation THEN
      NULL;
    END;
    INSERT INTO person_category_membership_event (
      membership_event_id, person_id, category_id, action, actor_kind, actor_id,
      producer_receipt_id, privacy_class
    ) VALUES (
      'categoryevent_holding_pack_guard_remove', held_person, 'category_holding', 'remove',
      'system', 'synthetic-acceptance', 'receipt_service_fixture', 'release-safe'
    );
  END \$\$;" >/dev/null
docker exec "$SERVICE_CONTAINER" node acceptance/live.mjs
docker exec "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test -c \
  "DO \$\$ DECLARE
    created_person text;
  BEGIN
    IF (SELECT count(*) FROM person WHERE display_name = 'Synthetic New Face Person') <> 1 THEN
      RAISE EXCEPTION 'new-Person Face save did not create exactly one Person';
    END IF;
    SELECT person_id INTO created_person
    FROM person
    WHERE display_name = 'Synthetic New Face Person'
      AND status = 'active' AND subject_kind = 'person';
    IF created_person IS NULL THEN
      RAISE EXCEPTION 'new-Person Face save did not create one active Person';
    END IF;
    IF EXISTS (
      SELECT 1 FROM person
      WHERE display_name = 'Synthetic Existing Alias'
    ) THEN
      RAISE EXCEPTION 'alias collision left a partial Person';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM current_face_identity identity
      WHERE identity.face_id = 'face_new_person_fixture'
        AND identity.person_id = created_person
        AND identity.state = 'accepted' AND identity.origin = 'user'
    ) THEN
      RAISE EXCEPTION 'new-Person Face identity is not immediate accepted user truth';
    END IF;
    IF (SELECT count(*) FROM identity_claim
        WHERE face_id = 'face_new_person_fixture' AND state = 'accepted') <> 1 THEN
      RAISE EXCEPTION 'new-Person Face save did not leave exactly one accepted claim';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM current_person_category
      WHERE person_id = created_person AND slug = 'sort'
    ) THEN
      RAISE EXCEPTION 'new Person was not added to Sort atomically';
    END IF;
    IF EXISTS (
      SELECT 1 FROM current_reference_gallery
      WHERE person_id = created_person AND face_id = 'face_new_person_fixture'
    ) THEN
      RAISE EXCEPTION 'new-Person Face save fabricated a bucket assignment';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM decision
      WHERE decision_id = (
        SELECT decision_id FROM identity_claim
        WHERE face_id = 'face_new_person_fixture' AND state = 'accepted'
      )
        AND actor_kind = 'user' AND action = 'accept'
        AND reason_code = 'new_person_from_face'
    ) THEN
      RAISE EXCEPTION 'new-Person Face save lacks exact user audit provenance';
    END IF;
  END \$\$;" >/dev/null
docker exec "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test -c \
  "DO \$\$ DECLARE
    claimed_id text;
    claimed_person text;
  BEGIN
    SELECT rebuild_request_id, person_id INTO claimed_id, claimed_person
    FROM source_pack_rebuild_request
    WHERE state = 'pending'
    ORDER BY requested_at, rebuild_request_id
    LIMIT 1;
    IF claimed_id IS NULL THEN
      RAISE EXCEPTION 'SourcePack rebuild requests were not recorded';
    END IF;
    UPDATE source_pack_rebuild_request
    SET state = 'processing', attempt_count = attempt_count + 1,
      lease_owner = 'synthetic-concurrent-worker',
      lease_expires_at = now() + interval '5 minutes', started_at = now()
    WHERE rebuild_request_id = claimed_id;
    PERFORM enqueue_source_pack_rebuild(
      claimed_person, 'synthetic_change_during_processing',
      'synthetic_probe', 'change_during_processing'
    );
    IF NOT EXISTS (
      SELECT 1 FROM source_pack_rebuild_request
      WHERE person_id = claimed_person AND state = 'pending'
        AND reason_code = 'synthetic_change_during_processing'
    ) THEN
      RAISE EXCEPTION 'change during processing was swallowed instead of trailing';
    END IF;
    PERFORM enqueue_source_pack_rebuild(
      claimed_person, 'synthetic_duplicate_pending',
      'synthetic_probe', 'duplicate_pending'
    );
    IF NOT EXISTS (
      SELECT 1 FROM source_pack_rebuild_request
      WHERE person_id = claimed_person AND state = 'superseded'
        AND reason_code = 'synthetic_duplicate_pending'
    ) THEN
      RAISE EXCEPTION 'duplicate pending request was not preserved as superseded evidence';
    END IF;
    UPDATE source_pack_rebuild_request
    SET lease_expires_at = now() - interval '1 second'
    WHERE rebuild_request_id = claimed_id;
  END \$\$;" >/dev/null
docker exec "$SERVICE_CONTAINER" node bin/run-source-pack-rebuild-worker.mjs \
  --model-family=synthetic-face --model-version=v1 --config-digest=synthetic-config \
  --cutoff=2100-01-01T00:00:00Z --worker-id=synthetic-worker
docker exec "$SERVICE_CONTAINER" node bin/run-source-pack-rebuild-worker.mjs \
  --model-family=synthetic-face --model-version=v1 --config-digest=synthetic-config \
  --cutoff=2100-01-01T00:00:00Z --worker-id=synthetic-worker-replay
docker exec "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test -c \
  "DO \$\$ BEGIN
    IF EXISTS (SELECT 1 FROM source_pack_rebuild_request WHERE state IN ('pending','processing')) THEN
      RAISE EXCEPTION 'SourcePack rebuild queue did not converge';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM source_pack_rebuild_request
      WHERE state = 'completed' AND result_pack_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'SourcePack rebuild worker did not record its proposed pack';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM source_pack_rebuild_request WHERE state = 'superseded') THEN
      RAISE EXCEPTION 'SourcePack rebuild dedupe left no supersession receipt';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM source_pack WHERE state = 'proposed') THEN
      RAISE EXCEPTION 'SourcePack rebuild worker did not compile a proposed pack';
    END IF;
    IF EXISTS (SELECT 1 FROM source_pack WHERE state = 'active') THEN
      RAISE EXCEPTION 'SourcePack rebuild worker granted itself activation authority';
    END IF;
    IF EXISTS (
      SELECT 1 FROM current_reference_gallery
      WHERE face_id = 'face_identity_fixture' AND membership_state = 'active'
    ) THEN
      RAISE EXCEPTION 'Corrected identity remained in a matching gallery';
    END IF;
    IF EXISTS (
      SELECT 1 FROM current_reference_prototype
      WHERE person_id = 'person_service_fixture'
    ) THEN
      RAISE EXCEPTION 'Corrected identity prototype remained active';
    END IF;
  END \$\$;" >/dev/null

docker exec "$SERVICE_CONTAINER" node acceptance/pet-manual-journey.mjs
docker exec -e CIMMICH_CONTEXT_PHASE=write "$SERVICE_CONTAINER" \
  node acceptance/context-search-journey.mjs
docker exec "$SERVICE_CONTAINER" node acceptance/context-entity-undo-journey.mjs
docker exec -e CIMMICH_PET_DOCUMENT_PHASE=write "$SERVICE_CONTAINER" \
  node acceptance/pet-document-journey.mjs
docker exec -e CIMMICH_DOCUMENT_LEGACY_PET_PHASE=write "$SERVICE_CONTAINER" \
  node acceptance/document-legacy-pet-journey.mjs
docker exec -e CIMMICH_MANUAL_PRESENCE_PHASE=write "$SERVICE_CONTAINER" \
  node acceptance/manual-subject-presence-journey.mjs
docker exec -e CIMMICH_DOCUMENT_PHASE=write "$SERVICE_CONTAINER" \
  node acceptance/document-journey.mjs
docker restart "$SERVICE_CONTAINER" >/dev/null
i=0
until docker exec "$SERVICE_CONTAINER" node -e "fetch('http://127.0.0.1:3101/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "manual Presence restart persistence timeout" >&2
    exit 1
  fi
  sleep 1
done
docker exec -e CIMMICH_MANUAL_PRESENCE_PHASE=readback "$SERVICE_CONTAINER" \
  node acceptance/manual-subject-presence-journey.mjs
docker exec -e CIMMICH_PET_DOCUMENT_PHASE=readback "$SERVICE_CONTAINER" \
  node acceptance/pet-document-journey.mjs
docker exec -e CIMMICH_DOCUMENT_LEGACY_PET_PHASE=readback "$SERVICE_CONTAINER" \
  node acceptance/document-legacy-pet-journey.mjs
docker exec -e CIMMICH_CONTEXT_PHASE=readback "$SERVICE_CONTAINER" \
  node acceptance/context-search-journey.mjs
docker exec -e CIMMICH_DOCUMENT_PHASE=readback "$SERVICE_CONTAINER" \
  node acceptance/document-journey.mjs
docker exec -e CIMMICH_DOCUMENT_DIGEST_REPAIR_PHASE=corrupt "$SERVICE_CONTAINER" \
  node acceptance/document-digest-repair-journey.mjs
docker exec "$SERVICE_CONTAINER" node bin/document-lifecycle.mjs repair-legacy-digests \
  --confirm=repair-schema47-document-digests
docker exec -e CIMMICH_DOCUMENT_DIGEST_REPAIR_PHASE=verify "$SERVICE_CONTAINER" \
  node acceptance/document-digest-repair-journey.mjs
docker exec -e CIMMICH_DOCUMENT_PHASE=readback "$SERVICE_CONTAINER" \
  node acceptance/document-journey.mjs
docker exec "$SERVICE_CONTAINER" node bin/document-lifecycle.mjs repair-legacy-digests \
  --confirm=repair-schema47-document-digests

docker exec "$SERVICE_CONTAINER" rm -rf \
  /tmp/cimmich-document-backup /tmp/cimmich-document-export \
  /tmp/cimmich-documents-restored
docker exec "$SERVICE_CONTAINER" node bin/document-lifecycle.mjs backup \
  --output=/tmp/cimmich-document-backup
CURRENT_SCHEMA_VERSION=$(sh "$ROOT/tools/current_schema_version.sh" "$ROOT/migrations")
docker exec "$SERVICE_CONTAINER" node -e \
  "const m=JSON.parse(require('fs').readFileSync('/tmp/cimmich-document-backup/manifest.json'));if(m.schemaVersion!==Number(process.argv[1]))throw new Error('Document backup schema version drift')" \
  "$CURRENT_SCHEMA_VERSION"
docker exec "$SERVICE_CONTAINER" node bin/document-lifecycle.mjs verify \
  --input=/tmp/cimmich-document-backup
DOCUMENT_ID=$(docker exec "$SERVICE_CONTAINER" node -e \
  "const s=JSON.parse(require('fs').readFileSync('/tmp/cimmich-document-acceptance.json'));process.stdout.write(s.importedDocumentId)")
docker exec "$SERVICE_CONTAINER" node bin/document-lifecycle.mjs export \
  --document-id="$DOCUMENT_ID" --output=/tmp/cimmich-document-export
docker exec "$CONTAINER" dropdb --if-exists -U cimmich_test cimmich_restore
docker exec "$CONTAINER" createdb -U cimmich_test cimmich_restore
docker exec "$SERVICE_CONTAINER" node bin/document-lifecycle.mjs restore \
  --database-url=postgres://cimmich_test:synthetic-only-password@127.0.0.1:5432/cimmich_restore \
  --input=/tmp/cimmich-document-backup \
  --store-root=/tmp/cimmich-documents-restored
docker exec "$SERVICE_CONTAINER" node bin/document-lifecycle.mjs purge \
  --database-url=postgres://cimmich_test:synthetic-only-password@127.0.0.1:5432/cimmich_restore \
  --store-root=/tmp/cimmich-documents-restored \
  --document-id="$DOCUMENT_ID" --confirm="$DOCUMENT_ID"
docker exec "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_restore -c \
  "DO \$\$ BEGIN
    IF EXISTS (SELECT 1 FROM cimmich_document WHERE document_id = '$DOCUMENT_ID'
      OR supersedes_document_id = '$DOCUMENT_ID') THEN
      RAISE EXCEPTION 'Document edition chain survived privacy purge';
    END IF;
    IF (SELECT count(*) FROM cimmich_document_purge_receipt) <> 1 THEN
      RAISE EXCEPTION 'Document privacy purge receipt missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM current_pet_document) THEN
      RAISE EXCEPTION 'Legacy Pet document truth was changed by generic purge';
    END IF;
  END \$\$;" >/dev/null
docker exec "$SERVICE_CONTAINER" node bin/document-lifecycle.mjs remove-empty-store \
  --database-url=postgres://cimmich_test:synthetic-only-password@127.0.0.1:5432/cimmich_restore \
  --store-root=/tmp/cimmich-documents-restored \
  --confirm=remove-empty-document-store
docker exec "$CONTAINER" dropdb -U cimmich_test cimmich_restore
docker exec -e CIMMICH_VISIBILITY_PHASE=write "$SERVICE_CONTAINER" \
  node acceptance/visibility-journey.mjs
docker restart "$SERVICE_CONTAINER" >/dev/null
i=0
until docker exec "$SERVICE_CONTAINER" node -e "fetch('http://127.0.0.1:3101/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "visibility restart persistence timeout" >&2
    exit 1
  fi
  sleep 1
done
docker exec -e CIMMICH_VISIBILITY_PHASE=readback "$SERVICE_CONTAINER" \
  node acceptance/visibility-journey.mjs
docker exec "$SERVICE_CONTAINER" node acceptance/media-job-journey.mjs
docker exec "$SERVICE_CONTAINER" node acceptance/immich-companion-journey.mjs
docker exec "$SERVICE_CONTAINER" node acceptance/immich-inventory-journey.mjs
docker exec -e CIMMICH_MANUAL_PHOTO_CONTEXT_PHASE=write "$SERVICE_CONTAINER" \
  node acceptance/manual-photo-context-journey.mjs
docker restart "$SERVICE_CONTAINER" >/dev/null
i=0
until docker exec "$SERVICE_CONTAINER" node -e "fetch('http://127.0.0.1:3101/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "manual photo Context restart persistence timeout" >&2
    exit 1
  fi
  sleep 1
done
docker exec -e CIMMICH_MANUAL_PHOTO_CONTEXT_PHASE=readback "$SERVICE_CONTAINER" \
  node acceptance/manual-photo-context-journey.mjs
docker exec "$SERVICE_CONTAINER" node acceptance/decision-history-journey.mjs
docker exec "$SERVICE_CONTAINER" node acceptance/immich-onboarding-journey.mjs
docker exec "$SERVICE_CONTAINER" node acceptance/face-detection-journey.mjs
docker exec "$SERVICE_CONTAINER" node acceptance/media-pipeline-journey.mjs
docker exec "$SERVICE_CONTAINER" node acceptance/owner-source-pack-journey.mjs
docker exec "$SERVICE_CONTAINER" node acceptance/enhanced-component-journey.mjs
docker exec "$SERVICE_CONTAINER" node acceptance/owner-face-recognition-journey.mjs
docker exec "$SERVICE_CONTAINER" node acceptance/media-operator-journey.mjs
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_test -d cimmich_test < "$ROOT/tests/sql/007_person_projection_performance_fixture.sql"
docker exec "$SERVICE_CONTAINER" node acceptance/person-projection-performance-journey.mjs
docker exec "$SERVICE_CONTAINER" node acceptance/manual-subject-tag-journey.mjs
docker exec "$SERVICE_CONTAINER" node acceptance/manual-recognition-intake-journey.mjs
docker exec "$SERVICE_CONTAINER" node acceptance/body-detection-result-journey.mjs
docker exec "$SERVICE_CONTAINER" node acceptance/asset-source-revision-journey.mjs
docker exec "$SERVICE_CONTAINER" node acceptance/observation-correction-journey.mjs
docker exec "$SERVICE_CONTAINER" node acceptance/visual-candidate-set-journey.mjs
docker exec "$SERVICE_CONTAINER" \
  node acceptance/existing-face-recognition-source-access-journey.mjs

if ! command -v rg >/dev/null 2>&1; then
  echo "privacy leakage scans require ripgrep (rg); refusing a vacuous pass" >&2
  exit 1
fi

if rg -n -P --hidden \
  --glob '!tools/run_synthetic_acceptance.sh' \
  --glob '!docs/PRIVACY_BOUNDARY.md' \
  --glob '!tests/sql/001_intelligence_acceptance.sql' \
  --glob '!**/node_modules/**' \
  --glob '!**/.svelte-kit/**' \
  --glob '!**/build/**' \
  --glob '!**/coverage/**' \
  --glob '!**/test-results/**' \
  "(/Users/|/home/|BEGIN [A-Z ]*PRIVATE KEY|(?i:(?:api[_-]?key|password)\\s*=\\s*['\"](?![<\${])(?!password['\"])(?!auth\\.)[^'\"]{8,}['\"]))" "$ROOT"; then
  echo "privacy leakage scan failed" >&2
  exit 1
fi

if rg -n "person_profile|private_notes|gender_identity_kind" \
  "$ROOT/service/src/local-face-recognition-worker.mjs" \
  "$ROOT/service/src/recognition-job-commit.mjs" \
  "$ROOT/service/src/prime-curator.mjs" \
  "$ROOT/service/src/prime-curator-repository.mjs" \
  "$ROOT/service/src/source-pack.mjs" \
  "$ROOT/service/src/source-pack-repository.mjs" \
  "$ROOT/service/src/source-pack-rebuild-worker.mjs" \
  "$ROOT/service/src/memory-steward.mjs"; then
  echo "Person Profile matching/model-input isolation scan failed" >&2
  exit 1
fi

if rg -n "from .*immich|IMMICH_|localStorage|console\." \
  "$ROOT/service/src/person-profile.mjs" \
  "$ROOT/service/src/person-details-display.mjs"; then
  echo "Person Profile local ownership/log isolation scan failed" >&2
  exit 1
fi

if rg -n "cimmich_document|document_link|document_label|source_filename" \
  "$ROOT/service/src/local-face-recognition-worker.mjs" \
  "$ROOT/service/src/recognition-job-commit.mjs" \
  "$ROOT/service/src/prime-curator.mjs" \
  "$ROOT/service/src/prime-curator-repository.mjs" \
  "$ROOT/service/src/source-pack.mjs" \
  "$ROOT/service/src/source-pack-repository.mjs" \
  "$ROOT/service/src/source-pack-rebuild-worker.mjs" \
  "$ROOT/service/src/memory-steward.mjs"; then
  echo "Document matching/model-input isolation scan failed" >&2
  exit 1
fi

if rg -n "from .*immich|process\.env\.IMMICH_|localStorage|sessionStorage|indexedDB|console\.|fetch\(" \
  "$ROOT/service/src/documents.mjs"; then
  echo "Document local ownership/network/log isolation scan failed" >&2
  exit 1
fi

echo "Cimmich synthetic acceptance: PASS"
