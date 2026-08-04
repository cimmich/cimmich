import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  loadMigrations,
  loadSchemaPatches,
  migrationBody,
  schema48AdoptionSentinels,
} from "../src/migration-runner.mjs";

const serviceDirectory = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
);
const migrationsDirectory = path.resolve(serviceDirectory, "../migrations");

test("migration source is reduced to one runner-owned transaction body", () => {
  assert.equal(
    migrationBody(
      "\\set ON_ERROR_STOP on\nBEGIN;\nSELECT 1;\nCOMMIT;",
      "0001_test.sql",
    ),
    "SELECT 1;",
  );
  assert.throws(
    () => migrationBody("SELECT 1;", "bad.sql"),
    (error) => error.code === "MIGRATION_TRANSACTION_BOUNDARY_INVALID",
  );
});

test("the current source chain is contiguous and preserves schema-48 adoption", async () => {
  const migrations = await loadMigrations(migrationsDirectory);
  assert.equal(migrations.length, migrations.at(-1).version);
  assert.equal(migrations[0].version, 1);
  assert.equal(
    new Set(migrations.map((item) => item.checksum)).size,
    migrations.length,
  );
  assert.ok(migrations.every((item) => /^[0-9a-f]{64}$/.test(item.checksum)));
  assert.equal(schema48AdoptionSentinels.length, 48);
  const patches = await loadSchemaPatches(
    path.join(migrationsDirectory, "patches"),
  );
  assert.equal(patches.length, 1);
  assert.equal(patches[0].patchId, "0048_0001_inventory_two_strike_v1");

  const documentLifecycle = await import("node:fs/promises").then(
    ({ readFile }) =>
      readFile(
        new URL("../bin/document-lifecycle.mjs", import.meta.url),
        "utf8",
      ),
  );
  assert.match(documentLifecycle, /loadMigrations/);
  assert.doesNotMatch(documentLifecycle, /schemaVersion:\s*48/);

  const repository = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../src/repository.mjs", import.meta.url), "utf8"),
  );
  assert.match(repository, /generate_series\(1, \$\{expectedSchemaVersion\}\)/);
  assert.match(
    repository,
    /applied_schema_version\) !== expectedSchemaVersion/,
  );
});

test("schema 87 makes byte-verified legacy binding durable and replay-safe", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0087_verified_content_binding_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(source, /verified_content_binding_command/);
  assert.match(source, /request_digest ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(source, /cimmich\.verified-content-binding\.v1/);
  assert.match(source, /byte_verified/);
});

test("schema 88 keeps a content asset available while another binding remains active", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0088_multi_binding_asset_availability_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(source, /cimmich_asset_available_after_immich_run/);
  assert.match(source, /projection\.last_seen_run_id = p_run_id/);
  assert.match(source, /binding\.source_id = p_source_id/);
  assert.match(source, /AND NOT cimmich_asset_available_after_immich_run/);
  assert.match(
    source,
    /asset[\s\S]*cannot be missing while at least one source binding is active/,
  );
});

test("schema 105 records explicit Immich inventory source rollover lineage", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0105_immich_inventory_source_rollover_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(source, /superseded_by_source_id/);
  assert.match(source, /immich_inventory_source_rollover_command/);
  assert.match(source, /predecessor_source_id <> successor_source_id/);
  assert.match(source, /receipt_cimmich_immich_inventory_source_rollover_v1/);
});

test("schema 106 records replay-safe inventory placeholder pruning", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0106_inventory_placeholder_job_prune_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(source, /inventory_placeholder_job_prune_command/);
  assert.match(source, /expected_job_count integer NOT NULL/);
  assert.match(source, /request_digest/);
  assert.match(source, /receipt_cimmich_inventory_placeholder_job_prune_v1/);
});

test("schema 107 indexes the media pipeline detection-job dependency", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0107_media_pipeline_detection_job_lookup_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(source, /media_pipeline_run_detection_job_lookup/);
  assert.match(source, /media_pipeline_run \(detection_job_id\)/);
  assert.match(source, /WHERE detection_job_id IS NOT NULL/);
});

test("schema 108 separates Place directory placement and assignment operations", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0108_place_hierarchy_directory_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(source, /directory_visibility/);
  assert.match(source, /'listed','nested_only'/);
  assert.match(source, /context_command_command_kind_check/);
  assert.match(source, /place_assignment/);
  assert.match(
    source,
    /CREATE OR REPLACE FUNCTION cimmich_visibility_context_entity_rank/,
  );
  assert.match(source, /WITH RECURSIVE lineage/);
  assert.match(source, /'assign'/);
});

test("schema 109 admits bounded owner-painted Place areas without invalidating bounds", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0109_place_painted_area_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(source, /DROP CONSTRAINT context_entity_place_geometry/);
  assert.match(source, /geometry \?& ARRAY\['north','south','east','west'\]/);
  assert.match(
    source,
    /jsonb_array_length\(geometry->'points'\) BETWEEN 3 AND 500/,
  );
  assert.match(source, /receipt_cimmich_place_painted_area_v1/);
});

test("schema 110 separates Location hierarchy from Geography without guessing existing rows", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0110_place_geography_location_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(
    source,
    /place_role IN \('geography','location','unclassified'\)/,
  );
  assert.match(source, /SET place_role = 'unclassified'/);
  assert.match(source, /AND status <> 'deleted'/);
  assert.match(source, /status = 'deleted' AND place_role IS NULL/);
  assert.match(source, /ADD COLUMN geography_entity_id text/);
  assert.match(
    source,
    /Location and Geography use separate parent hierarchies/,
  );
  assert.match(source, /context_entity_geography_guard/);
  assert.doesNotMatch(source, /SET place_role = 'geography'\s+WHERE/);
  assert.doesNotMatch(source, /SET place_role = 'location'\s+WHERE/);
});

test("schema 111 classifies only exact GPS-created unreviewed Places as Geography", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0111_gps_created_place_geography_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(source, /command\.command_id LIKE 'context\.gps-create\.%'/);
  assert.match(source, /entity\.place_role = 'unclassified'/);
  assert.match(source, /entity\.status <> 'deleted'/);
  assert.match(source, /SET place_role = 'geography'/);
  assert.match(source, /operation\.operation_scope = 'entity'/);
  assert.match(source, /operation\.action = 'create'/);
  assert.doesNotMatch(source, /display_name/);
});

test("schema 112 keeps normalized Location Plans separate from geographic geometry", async () => {
  const migration = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL("../../migrations/0112_location_plan_v1.sql", import.meta.url),
      "utf8",
    ),
  );
  assert.match(migration, /CREATE TABLE place_plan \(/);
  assert.match(migration, /CREATE TABLE place_plan_item \(/);
  assert.match(
    migration,
    /plan is deliberately not stored in context_entity\.geometry/i,
  );
  assert.match(migration, /immediate child Location/);
  assert.match(migration, /context_entity_plan_membership_guard/);
  assert.match(
    migration,
    /Remove this Location from its Plans before moving it/,
  );
  assert.match(migration, /'plan_save'/);
  assert.match(migration, /'place_assignment','plan'/);
});

test("schema 113 adds satellite as a Location Plan background without storing map tiles as Assets", async () => {
  const migration = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0113_location_plan_satellite_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(migration, /'blank','asset','satellite'/);
  assert.doesNotMatch(migration, /INSERT INTO asset/i);
  assert.doesNotMatch(migration, /context_entity\.geometry/i);
});

test("schema 116 adds bounded multi-stroke paint without changing Outline polygons", async () => {
  const migration = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0116_location_plan_paint_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(migration, /shape_kind IN \('point','rect','polygon','paint'\)/);
  assert.match(
    migration,
    /several\s+--?\s*\n?--?\s*disconnected|disconnected parts/i,
  );
});

test("schema 117 persists normalized Activity recurrence and ordered Trip Place stops", async () => {
  const migration = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0117_event_time_and_route_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(migration, /ADD COLUMN recurrence jsonb/);
  assert.match(migration, /event_kind = 'activity'/);
  assert.match(migration, /ADD COLUMN sort_order integer/);
  assert.match(migration, /v_source_event_kind = 'trip'/);
  assert.match(migration, /context_relation_link_current_stop_order/);
  assert.match(migration, /CREATE OR REPLACE VIEW current_context_relation/);
});

test("schema 119 remembers bounded Event source folders without copying assets", async () => {
  const migration = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0119_event_folder_graph_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(migration, /ADD COLUMN source_folders jsonb/);
  assert.match(migration, /jsonb_array_length\(value\) > 20/);
  assert.match(migration, /entity_kind = 'event'/);
  assert.doesNotMatch(migration, /INSERT INTO (asset|context_asset_link)/i);
});

test("schema 120 adds an explicit Event needs-check admission lane", async () => {
  const migration = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0120_event_media_needs_check_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(
    migration,
    /DROP CONSTRAINT context_asset_link_association_kind_check/,
  );
  assert.match(migration, /'needs_check'/);
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION enforce_context_asset_link_scope/,
  );
  assert.match(
    migration,
    /'direct','route_stop','context','needs_check','manual'/,
  );
  assert.doesNotMatch(migration, /UPDATE context_asset_link/i);
  assert.match(migration, /DROP CONSTRAINT context_entity_place_geometry/);
  assert.match(
    migration,
    /'latitude','longitude','provenance','uncertaintyMeters'/,
  );
  assert.match(migration, /'confirmed','contextual','manual','photo_gps'/);
  assert.match(migration, /BETWEEN 0 AND 1000000/);
});

test("schema 114 persists a bounded satellite Plan viewport without changing Place geometry", async () => {
  const migration = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0114_location_plan_satellite_viewport_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(migration, /ADD COLUMN background_viewport jsonb/);
  assert.match(migration, /background_kind = 'satellite'/);
  assert.match(migration, /BETWEEN 0 AND 18/);
  assert.doesNotMatch(migration, /context_entity\.geometry/i);
});

test("schema 115 permits honest Plan overzoom without claiming higher-resolution satellite tiles", async () => {
  const migration = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0115_location_plan_satellite_overzoom_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(migration, /BETWEEN 0 AND 22/);
  assert.match(migration, /provider supplies real tiles through zoom 18/i);
  assert.doesNotMatch(migration, /context_entity\.geometry/i);
});

test("schema 90 binds a batch worker to its exact recognition job", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0090_exact_existing_face_recognition_claim_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(source, /claim_exact_existing_face_recognition_job/);
  assert.match(source, /job\.job_id = p_job_id/);
  assert.match(source, /pipeline\.state = 'recognition_pending'/);
  assert.match(source, /FOR UPDATE OF job SKIP LOCKED/);
  assert.match(
    source,
    /jsonb_build_object\('workerId', p_worker_id, 'claim', 'exact'\)/,
  );
});

test("schema 91 binds pipeline recognition claims to one exact provider space", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0091_exact_pipeline_recognition_claim_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(source, /claim_exact_face_recognition_jobs/);
  assert.match(source, /job\.tool_version = p_tool_version/);
  assert.match(source, /job\.config_digest = p_config_digest/);
  assert.match(source, /pipeline\.recognizer_config_digest = p_config_digest/);
  assert.match(source, /pipeline\.vector_space_id = p_vector_space_id/);
  assert.match(source, /FOR UPDATE OF job SKIP LOCKED/);
});

test("schema 92 corrects exact pipeline claims for distinct provider and space digests", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0092_exact_pipeline_recognition_dual_digest_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(source, /p_job_config_digest/);
  assert.match(source, /p_recognition_space_config_digest/);
  assert.match(source, /job\.config_digest = p_job_config_digest/);
  assert.match(
    source,
    /pipeline\.recognizer_config_digest =\s+p_recognition_space_config_digest/,
  );
});

test("schema 93 derives live person-linked triage for every media claim path", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0093_media_asset_triage_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(source, /CREATE OR REPLACE VIEW media_asset_triage/);
  assert.match(source, /count\(DISTINCT people\.person_id\)/);
  assert.match(source, /people\.authority_state = 'accepted'/);
  assert.match(
    source,
    /WHEN coalesce\(people\.accepted_person_count, 0\) > 0 THEN 0/,
  );
  assert.match(source, /CREATE OR REPLACE FUNCTION claim_media_jobs/);
  assert.match(
    source,
    /CREATE OR REPLACE FUNCTION claim_existing_face_recognition_jobs/,
  );
  assert.match(
    source,
    /CREATE OR REPLACE FUNCTION claim_exact_face_recognition_jobs/,
  );
  assert.match(
    source,
    /ORDER BY triage\.priority_tier,\s+triage\.accepted_person_count DESC/,
  );
  assert.doesNotMatch(
    source,
    /ALTER TABLE media_job[\s\S]+ADD COLUMN priority/,
  );
});

test("schema 94 makes body detection resumable without weakening job binding", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0094_resumable_body_detection_job_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(source, /'detect_bodies'/);
  assert.match(source, /media_job_body_detection_result/);
  assert.match(source, /enforce_media_job_body_detection_binding/);
  assert.match(source, /v_job\.asset_id <> v_result\.asset_id/);
  assert.match(
    source,
    /v_job\.config_digest <> v_result\.detector_config_digest/,
  );
});

test("schema 95 makes hash-bound XMP face recovery resumable and provenance complete", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0095_xmp_sidecar_face_import_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(source, /'xmp_sidecar_import'/);
  assert.match(source, /CREATE TABLE xmp_sidecar_import_run/);
  assert.match(source, /CREATE TABLE xmp_sidecar_import_item/);
  assert.match(source, /CREATE TABLE xmp_sidecar_face_evidence/);
  assert.match(source, /CREATE TABLE xmp_sidecar_face_source/);
  assert.match(source, /UNIQUE \(source_id, content_id, region_key\)/);
  assert.doesNotMatch(source, /original_path|sidecar_path|source_path/);
});

test("schema 96 adds owner-command resolution for unresolved XMP names", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0096_xmp_sidecar_name_resolution_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(source, /CREATE TABLE xmp_sidecar_name_resolution_command/);
  assert.match(source, /owner_resolution_command_id/);
  assert.match(source, /owner_resolution_decision_id/);
  assert.match(source, /'owner_resolved'/);
  assert.match(source, /UNIQUE \(source_id, normalized_name\)/);
});

test("Pet matching migration keeps model proposals non-authoritative", async () => {
  const migration = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL("../../migrations/0083_pet_matching_v1.sql", import.meta.url),
      "utf8",
    ),
  );
  assert.match(
    migration,
    /state IN \('pending', 'confirmed', 'rejected', 'unknown', 'superseded'\)/,
  );
  assert.match(migration, /pet_match_one_confirmed_suggestion/);
  assert.match(migration, /must compare within one species/);
  assert.match(
    migration,
    /never becomes a Pet tag without an explicit user decision/,
  );
});

test("schema 72 retains restored reconciliation history while enforcing every new row", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0072_legacy_identity_claim_compatibility_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(source, /identity_claim_candidate_not_source_reconciliation/);
  assert.match(source, /NOT VALID/);
  assert.match(source, /accepted_matched_digikam_sidecar_face/);
  assert.match(
    source,
    /receipt_cimmich_legacy_identity_claim_compatibility_v1/,
  );
});

test("schema 73 adds exact entity create/update operations without rewriting prior history", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0073_context_entity_create_update_undo_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(
    source,
    /operation_scope IN \('asset','relation','cover','entity'\)/,
  );
  assert.match(
    source,
    /action IN \('attach','detach','set','create','update'\)/,
  );
  assert.doesNotMatch(source, /DROP TABLE|TRUNCATE|DELETE FROM/);
});

test("schema 70 adds Pet-scoped visibility without coupling it to asset or context tiers", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0070_pet_visibility_connections_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(source, /'document','person','pet'/);
  assert.match(source, /NEW\.object_scope = 'pet'/);
  assert.match(source, /subject_kind = 'pet'/);
  assert.match(
    source,
    /CREATE OR REPLACE FUNCTION cimmich_visibility_pet_rank/,
  );
  assert.match(
    source,
    /CREATE OR REPLACE FUNCTION cimmich_visibility_subject_rank/,
  );
  assert.match(source, /WHEN 'pet' THEN cimmich_visibility_pet_rank/);
  assert.doesNotMatch(source, /cimmich_visibility_asset_rank\(p_pet_id\)/);
  assert.doesNotMatch(
    source,
    /cimmich_visibility_context_entity_rank\(p_pet_id\)/,
  );
});

test("schema 71 separates spatial Thing evidence from owner-authored photo summary", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0071_manual_photo_context_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(source, /manual_context_observation/);
  assert.match(source, /manual_context_tag/);
  assert.match(source, /asset_owner_summary_revision/);
  assert.match(source, /manual_photo_context_command/);
  assert.match(source, /manual_photo_context_operation/);
  assert.match(source, /entity_kind = 'object'/);
  assert.match(source, /asset_input_revision/);
  assert.doesNotMatch(source, /face_embedding|identity_claim|source_pack/i);
});

test("schema 69 permits the truthful disabled Enhanced head before any release exists", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0069_enhanced_component_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(source, /previous_release_id IS NULL/);
  assert.match(
    source,
    /active_release_id IS DISTINCT FROM previous_release_id/,
  );
  assert.match(
    source,
    /INSERT INTO enhanced_component_head \(singleton\) VALUES \(true\)/,
  );
});

test("migration ledgers interleave base patches before later migrations", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../src/migration-runner.mjs", import.meta.url), "utf8"),
  );
  assert.match(source, /execution_ms numeric/);
  assert.match(source, /runner_version, execution_ms/);
  assert.match(source, /applyPatchesAtBase\(currentVersion\)/);
  assert.doesNotMatch(source, /patch\.baseVersion !== Number\(finalLedger/);
});

test("schema 61 evaluates each SourcePack member against current accepted truth", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0061_source_pack_activation_current_claim_guard_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(source, /WHERE EXISTS \(/);
  assert.match(source, /identity\.face_id = member\.face_id/);
  assert.match(source, /identity\.state = 'accepted'/);
  assert.doesNotMatch(
    source,
    /LEFT JOIN current_face_identity identity ON identity\.face_id = member\.face_id/,
  );
});

test("schema 62 separates detector results from current companion-bound observation runs", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0062_existing_face_recognition_pipeline_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(
    source,
    /run_kind IN \('detector_result','existing_observation_set'\)/,
  );
  assert.match(
    source,
    /source_revision_id, asset_id, input_revision, source_content_digest/,
  );
  assert.match(source, /media_pipeline_run_observation/);
  assert.match(source, /media_pipeline_provider_run/);
  assert.match(source, /media_pipeline_provider_run_binding_guard/);
  assert.match(source, /NEW\.checkpoint_digest <> v_checkpoint_digest/);
  assert.match(source, /v_result_digest <> NEW\.provider_result_digest/);
  assert.match(source, /v_checkpoint_count <> 1/);
  assert.match(source, /recognize_existing_faces/);
  assert.match(source, /v_run_count <> 2 OR v_result_count <> 1/);
  assert.doesNotMatch(source, /INSERT INTO face_detection_result/);
});

test("schema 63 adds Person visibility without coupling it to asset visibility", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0063_person_visibility_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(source, /object_scope = 'person'/);
  assert.match(source, /subject_kind = 'person'/);
  assert.match(source, /cimmich_visibility_person_rank/);
  assert.match(source, /coalesce\(\(/);
  assert.doesNotMatch(source, /cimmich_visibility_asset_rank/);
});

test("schema 64 admits explicit Event covers without weakening link truth", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL("../../migrations/0064_event_cover_v1.sql", import.meta.url),
      "utf8",
    ),
  );
  assert.match(source, /entity_kind IN \('place','object','event'\)/);
  assert.match(source, /NEW\.entity_kind NOT IN \('place','object','event'\)/);
  assert.match(source, /link\.entity_id = NEW\.entity_id/);
  assert.match(source, /link\.asset_id = NEW\.cover_asset_id/);
  assert.match(source, /link\.state = 'accepted'/);
});

test("schema 118 lets Place covers follow accepted subsection media without weakening other contexts", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0118_place_subtree_cover_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(source, /cimmich_context_cover_available/);
  assert.match(source, /p_entity_kind = 'place'/);
  assert.match(source, /child\.parent_entity_id = parent\.entity_id/);
  assert.match(source, /child\.status IN \('active','hidden'\)/);
  assert.match(source, /parent\.depth < 8/);
  assert.match(source, /link\.state = 'accepted'/);
  assert.match(source, /asset\.state = 'active'/);
  assert.match(source, /entity\.cover_asset_id = v_asset_id/);
});

test("schema 65 registers map assets as an enforced asset-derived visibility surface", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0065_visibility_filtered_map_assets_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(source, /'map_assets', 'enforced', true/);

  const onboarding = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0067_immich_onboarding_identity_import_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(
    onboarding,
    /observation_origin IN \('detector_or_import', 'manual_user', 'immich_import'\)/,
  );
  assert.match(onboarding, /IMMICH_IMPORT_FACE_EMBEDDING_FORBIDDEN_DB/);
  assert.match(onboarding, /'immich_onboarding', 'enforced', true/);
  assert.match(source, /'\/v1\/map\/visible-assets'/);
});

test("schema 66 durably retains bounded inventory filenames", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0066_immich_inventory_filename_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(source, /ADD COLUMN original_file_name text/);
  assert.match(source, /length\(original_file_name\) BETWEEN 1 AND 500/);
  assert.match(source, /original_file_name !~ '\[\[:cntrl:\]\]'/);
});

test("schema 68 keeps unnamed Immich Person resolution explicit and auditable", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0068_immich_person_resolution_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(
    source,
    /'existing_person','create_person','later','unknown','noise'/,
  );
  assert.match(
    source,
    /resolution_action IN \('existing_person','create_person'\)/,
  );
  assert.match(source, /immich_person_resolution_one_active/);
  assert.match(source, /enforce_immich_person_resolution_immutable/);
  assert.match(source, /'owner_unknown','owner_noise'/);
});

test("schema 75 separates owner cluster decisions from identity decisions", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0075_immich_owner_resolution_projection_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(
    source,
    /ADD COLUMN resolution_decision_id text REFERENCES decision/,
  );
  assert.match(
    source,
    /reconciliation_state IN \('owner_unknown','owner_noise'\)/,
  );
  assert.match(source, /= \(resolution_decision_id IS NOT NULL\)/);
});

test("schema 77 admits every explicit unnamed-Person review outcome", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0077_immich_onboarding_resolution_review_reasons_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(source, /source_person_unlabelled/);
  assert.match(source, /source_person_resolution_required/);
  assert.match(source, /immich_onboarding_review_item_reason_check/);
});

test("schema 78 keeps exhaustive identity audit evidence separate from identity authority", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL("../../migrations/0078_identity_audit_v1.sql", import.meta.url),
      "utf8",
    ),
  );
  assert.match(source, /CREATE TABLE identity_audit_run/);
  assert.match(source, /CREATE TABLE identity_audit_item/);
  assert.match(source, /untagged_match','accepted_contradiction/);
  assert.match(source, /review_state IN \('open','dismissed'\)/);
  assert.doesNotMatch(
    source,
    /UPDATE identity_claim|INSERT INTO identity_claim/,
  );
});

test("schema 80 records independent-photo verification without granting identity authority", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0080_identity_audit_independent_evidence_v2.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(source, /derivative_candidates_suppressed/);
  assert.match(source, /independence_provider_config_digest/);
  assert.match(source, /suggested_reference_asset_id/);
  assert.doesNotMatch(
    source,
    /UPDATE identity_claim|INSERT INTO identity_claim/,
  );
});

test("schema 81 preserves imported spatial identity metadata without granting typed identity authority", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0081_imported_identity_locator_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(source, /CREATE TABLE imported_identity_locator/);
  assert.match(source, /intended_tag_type IN \('body', 'head'\)/);
  assert.match(source, /geometry_role IN \('head_locator'\)/);
  assert.match(source, /state IN \('unresolved', 'resolved', 'ignored'\)/);
  assert.match(source, /producer_receipt_id/);
  assert.doesNotMatch(
    source,
    /INSERT INTO (?:face_association|head_association|body_association)/,
  );
});

test("schema 82 binds owner locator resolution to the resulting typed tag decision", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0082_imported_identity_locator_resolution_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(
    source,
    /resolution_kind IN \('stronger_existing_truth', 'owner_typed_tag'\)/,
  );
  assert.match(source, /resolution_decision_id text REFERENCES decision/);
  assert.match(source, /resolved_subject_id text REFERENCES person/);
  assert.match(
    source,
    /resolved_tag_type IN \('face', 'body', 'head', 'presence'\)/,
  );
});

test("schema 102 retains dormant imported locator provenance after reader retirement", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0102_retain_imported_identity_locator_provenance_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(source, /COMMENT ON TABLE imported_identity_locator/);
  assert.match(source, /retained losslessly/);
  assert.doesNotMatch(source, /DROP TABLE/);
  assert.doesNotMatch(source, /DELETE FROM imported_identity_locator/);
});

test("schema 84 separates exact content identity from replaceable source bindings", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0084_hash_linked_archive_mobility_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(source, /CREATE TABLE media_content \(/);
  assert.match(source, /CREATE TABLE media_content_fingerprint \(/);
  assert.match(source, /UNIQUE \(hash_algorithm, content_digest\)/);
  assert.match(source, /CREATE TABLE asset_content_link \(/);
  assert.match(source, /CREATE TABLE asset_source_binding \(/);
  assert.match(source, /CREATE TABLE asset_source_binding_event \(/);
  assert.match(
    source,
    /DROP CONSTRAINT IF EXISTS immich_asset_projection_cimmich_asset_id_key/,
  );
  assert.match(
    source,
    /source_kind IN \('immich','filesystem','trusted_import'\)/,
  );
  assert.doesNotMatch(
    source,
    /UPDATE (?:face_observation|identity_claim|person)/,
  );
});

test("schema 85 backfills canonical Immich Base64 fingerprints", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0085_immich_base64_fingerprint_backfill_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(source, /decode\(content_hash, 'base64'\)/);
  assert.match(source, /octet_length\(fingerprint_bytes\) IN \(20, 32\)/);
  assert.match(source, /encode\(fingerprint_bytes, 'base64'\) = content_hash/);
  assert.match(source, /INSERT INTO media_content \(/);
  assert.match(source, /INSERT INTO media_content_fingerprint \(/);
  assert.match(source, /INSERT INTO asset_content_link \(/);
  assert.match(source, /UPDATE asset_source_binding binding/);
  assert.doesNotMatch(
    source,
    /UPDATE (?:asset|face_observation|identity_claim|person)\s/,
  );
});

test("schema 86 quarantines links inferred from ambiguous Immich checksums", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0086_quarantine_unverified_immich_checksum_links_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(source, /receipt_cimmich_immich_base64_fingerprint_backfill_v1/);
  assert.match(source, /UPDATE asset_source_binding binding/);
  assert.match(source, /DELETE FROM asset_content_link/);
  assert.match(source, /DELETE FROM media_content_fingerprint/);
  assert.match(source, /DELETE FROM media_content content/);
  assert.doesNotMatch(
    source,
    /UPDATE (?:asset|face_observation|identity_claim|person)\s/,
  );
});

test("schema 89 recovers only stale interrupted inventory ownership", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../../migrations/0089_stale_inventory_run_recovery_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(source, /fail_stale_immich_inventory_runs/);
  assert.match(source, /INVENTORY_RUN_INTERRUPTED/);
  assert.match(source, /started_at < p_started_before/);
  assert.match(source, /state = 'incomplete'/);
  assert.match(source, /interval '24 hours'/);
});
