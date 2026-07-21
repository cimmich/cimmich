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
