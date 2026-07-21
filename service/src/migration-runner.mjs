import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const runnerVersion = "cimmich-migration-runner.v1";
const lockKey = "cimmich-schema-migrations-v1";

const typedError = (message, code, details) =>
  Object.assign(new Error(message), { code, ...(details ? { details } : {}) });

const checksum = (bytes) => createHash("sha256").update(bytes).digest("hex");

export const migrationBody = (source, filename = "migration.sql") => {
  const withoutPsql = String(source)
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("\\"))
    .join("\n")
    .trim();
  if (!/^BEGIN;\s/i.test(withoutPsql) || !/\sCOMMIT;\s*$/i.test(withoutPsql)) {
    throw typedError(
      `${filename} must have one explicit outer BEGIN/COMMIT wrapper`,
      "MIGRATION_TRANSACTION_BOUNDARY_INVALID",
    );
  }
  return withoutPsql
    .replace(/^BEGIN;\s*/i, "")
    .replace(/\s*COMMIT;\s*$/i, "")
    .trim();
};

export const loadMigrations = async (directory) => {
  const filenames = (await readdir(directory))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  const migrations = [];
  for (const filename of filenames) {
    const version = Number.parseInt(filename.slice(0, 4), 10);
    const bytes = await readFile(path.join(directory, filename));
    migrations.push({
      body: migrationBody(bytes.toString("utf8"), filename),
      checksum: checksum(bytes),
      filename,
      version,
    });
  }
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw typedError(
        "Migration versions must be contiguous from 0001",
        "MIGRATION_SEQUENCE_INVALID",
        { filename: migration.filename, expectedVersion: index + 1 },
      );
    }
  });
  return migrations;
};

export const loadSchemaPatches = async (directory) => {
  let filenames = [];
  try {
    filenames = (await readdir(directory))
      .filter((name) => /^\d{4}_\d{4}_[a-z0-9_]+\.sql$/.test(name))
      .sort();
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const patches = [];
  for (const filename of filenames) {
    const [baseVersionText, sequenceText] = filename.split("_", 2);
    const bytes = await readFile(path.join(directory, filename));
    patches.push({
      baseVersion: Number.parseInt(baseVersionText, 10),
      body: migrationBody(bytes.toString("utf8"), filename),
      checksum: checksum(bytes),
      filename,
      patchId: filename.replace(/\.sql$/, ""),
      sequence: Number.parseInt(sequenceText, 10),
    });
  }
  patches.forEach((patch, index) => {
    if (patch.baseVersion !== 48 || patch.sequence !== index + 1) {
      throw typedError(
        "Schema-48 patch sequence is invalid",
        "MIGRATION_PATCH_SEQUENCE_INVALID",
        { filename: patch.filename, expectedSequence: index + 1 },
      );
    }
  });
  return patches;
};

const receipt = (name) => ({ kind: "receipt", name });
const table = (name) => ({ kind: "relation", name });
const column = (tableName, name) => ({ kind: "column", name, tableName });
const routine = (name) => ({ kind: "routine", name });

export const schema48AdoptionSentinels = [
  table("asset"),
  table("reference_prototype"),
  table("source_pack"),
  routine("prevent_source_pack_content_update"),
  table("source_pack_rebuild_request"),
  routine("enforce_source_pack_activation_gate"),
  column("person", "subject_kind"),
  receipt("receipt_cimmich_head_evidence_bucket_v1"),
  receipt("receipt_cimmich_asset_head_evidence_v1"),
  receipt("receipt_cimmich_person_categories_sort_trust_v1"),
  table("identity_claim_person_state_created"),
  column("body_observation", "head_box_x"),
  table("body_tag_one_accepted_body_per_supporting_face"),
  routine("sync_face_body_linkage_with_identity_claim"),
  routine("enforce_source_pack_reference_immutability"),
  receipt("receipt_cimmich_holding_workflow_v1"),
  receipt("receipt_cimmich_evidence_projection_semantics_v1"),
  receipt("receipt_cimmich_low_quality_matching_lane_v1"),
  receipt("receipt_cimmich_source_reconciliation_identity_guard_v1"),
  receipt("receipt_cimmich_evidence_modifiers_capture_context_v1"),
  receipt("receipt_cimmich_capture_context_rebuild_queue_v1"),
  receipt("receipt_cimmich_face_modifier_proposal_v1"),
  receipt("receipt_cimmich_face_local_measurement_v1"),
  receipt("receipt_cimmich_partial_region_visibility_v2"),
  receipt("receipt_cimmich_scoped_region_contamination_v3"),
  receipt("receipt_cimmich_review_query_performance_v1"),
  receipt("receipt_cimmich_source_pack_activation_performance_v1"),
  column("source_pack_rebuild_request", "request_digest"),
  receipt("receipt_cimmich_pet_manual_management_v1"),
  receipt("receipt_cimmich_resumable_media_job_v1"),
  column("person", "species_kind"),
  table("immich_inventory_source"),
  table("face_detection_result"),
  table("media_pipeline_run"),
  table("media_operator_control"),
  receipt("receipt_cimmich_person_profile_v1"),
  receipt("receipt_cimmich_visibility_v1"),
  receipt("receipt_cimmich_visibility_projection_guard_v1"),
  receipt("receipt_cimmich_person_projection_performance_v1"),
  receipt("receipt_cimmich_person_details_display_v1"),
  receipt("receipt_cimmich_manual_subject_presence_v1"),
  receipt("receipt_cimmich_body_pose_evidence_v1"),
  receipt("receipt_cimmich_pet_profile_document_v1"),
  receipt("receipt_cimmich_context_entity_v1"),
  receipt("receipt_cimmich_context_search_projection_v1"),
  receipt("receipt_cimmich_context_search_hardening_v1"),
  receipt("receipt_cimmich_document_v1"),
  receipt("receipt_cimmich_document_lifecycle_compatibility_v1"),
];

const sentinelPresent = async (sql, sentinel) => {
  if (sentinel.kind === "relation") {
    const [row] =
      await sql`SELECT to_regclass(${sentinel.name}) IS NOT NULL AS present`;
    return Boolean(row?.present);
  }
  if (sentinel.kind === "column") {
    const [row] = await sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${sentinel.tableName}
          AND column_name = ${sentinel.name}
      ) AS present
    `;
    return Boolean(row?.present);
  }
  if (sentinel.kind === "routine") {
    const [row] = await sql`
      SELECT EXISTS (
        SELECT 1 FROM pg_proc
        JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
        WHERE pg_namespace.nspname = 'public' AND pg_proc.proname = ${sentinel.name}
      ) AS present
    `;
    return Boolean(row?.present);
  }
  const [row] = await sql`
    SELECT EXISTS (
      SELECT 1 FROM producer_receipt WHERE producer_receipt_id = ${sentinel.name}
    ) AS present
  `;
  return Boolean(row?.present);
};

const verifyAdoption = async (sql, targetVersion) => {
  if (targetVersion !== schema48AdoptionSentinels.length) {
    throw typedError(
      "Only the explicitly verified schema-48 adoption path is supported",
      "MIGRATION_ADOPTION_TARGET_UNSUPPORTED",
      { targetVersion },
    );
  }
  const missing = [];
  for (let index = 0; index < schema48AdoptionSentinels.length; index += 1) {
    const sentinel = schema48AdoptionSentinels[index];
    if (!(await sentinelPresent(sql, sentinel))) {
      missing.push({ sentinel, version: index + 1 });
    }
  }
  if (missing.length) {
    throw typedError(
      "Existing Cimmich schema failed adoption verification",
      "MIGRATION_ADOPTION_VERIFICATION_FAILED",
      { missing },
    );
  }
};

const ensureLedger = async (sql) => {
  await sql`
    CREATE TABLE IF NOT EXISTS cimmich_schema_migration (
      version integer PRIMARY KEY CHECK (version > 0),
      filename text NOT NULL UNIQUE,
      checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
      runner_version text NOT NULL,
      execution_ms numeric CHECK (execution_ms IS NULL OR execution_ms >= 0),
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS cimmich_schema_patch (
      patch_id text PRIMARY KEY,
      base_version integer NOT NULL CHECK (base_version > 0),
      sequence integer NOT NULL CHECK (sequence > 0),
      filename text NOT NULL UNIQUE,
      checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
      runner_version text NOT NULL,
      execution_ms numeric CHECK (execution_ms IS NULL OR execution_ms >= 0),
      applied_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (base_version, sequence)
    )
  `;
  await sql`
    ALTER TABLE cimmich_schema_migration
    ADD COLUMN IF NOT EXISTS execution_ms numeric
      CHECK (execution_ms IS NULL OR execution_ms >= 0)
  `;
  await sql`
    ALTER TABLE cimmich_schema_patch
    ADD COLUMN IF NOT EXISTS execution_ms numeric
      CHECK (execution_ms IS NULL OR execution_ms >= 0)
  `;
};

const readLedger = (sql) => sql`
  SELECT version, filename, checksum_sha256, runner_version, execution_ms,
    applied_at
  FROM cimmich_schema_migration
  ORDER BY version
`;

const readPatchLedger = (sql) => sql`
  SELECT patch_id, base_version, sequence, filename, checksum_sha256,
    runner_version, execution_ms, applied_at
  FROM cimmich_schema_patch
  ORDER BY base_version, sequence
`;

const transaction = async (connection, operation) => {
  await connection.unsafe("BEGIN");
  try {
    const result = await operation(connection);
    await connection.unsafe("COMMIT");
    return result;
  } catch (error) {
    await connection.unsafe("ROLLBACK");
    throw error;
  }
};

const assertLedger = (applied, migrations) => {
  for (let index = 0; index < applied.length; index += 1) {
    const row = applied[index];
    const expected = migrations[index];
    if (!expected || Number(row.version) !== index + 1) {
      throw typedError(
        "Migration ledger is not contiguous",
        "MIGRATION_LEDGER_INVALID",
      );
    }
    if (
      row.filename !== expected.filename ||
      row.checksum_sha256 !== expected.checksum
    ) {
      throw typedError(
        "An applied migration no longer matches its recorded source",
        "MIGRATION_CHECKSUM_MISMATCH",
        { filename: row.filename, version: Number(row.version) },
      );
    }
  }
};

const assertPatchLedger = (applied, patches) => {
  for (let index = 0; index < applied.length; index += 1) {
    const row = applied[index];
    const expected = patches[index];
    if (
      !expected ||
      row.patch_id !== expected.patchId ||
      Number(row.base_version) !== expected.baseVersion ||
      Number(row.sequence) !== expected.sequence ||
      row.filename !== expected.filename ||
      row.checksum_sha256 !== expected.checksum
    ) {
      throw typedError(
        "An applied schema patch no longer matches its recorded source",
        "MIGRATION_PATCH_CHECKSUM_MISMATCH",
        { patchId: row.patch_id || null },
      );
    }
  }
};

export const migrate = async ({
  adoptExisting = 0,
  migrationsDirectory,
  sql,
} = {}) => {
  const migrations = await loadMigrations(migrationsDirectory);
  const patches = await loadSchemaPatches(
    path.join(migrationsDirectory, "patches"),
  );
  const connection = await sql.reserve();
  try {
    await connection`SELECT pg_advisory_lock(hashtextextended(${lockKey}, 48))`;
    await ensureLedger(connection);
    let applied = await readLedger(connection);
    const [legacy] = await connection`
      SELECT to_regclass('public.asset') IS NOT NULL AS has_existing_schema
    `;
    if (!applied.length && legacy?.has_existing_schema) {
      const targetVersion = Number.parseInt(String(adoptExisting), 10) || 0;
      if (!targetVersion) {
        throw typedError(
          "Existing schema has no migration ledger; explicit verified adoption is required",
          "MIGRATION_LEDGER_ADOPTION_REQUIRED",
        );
      }
      if (targetVersion > migrations.length) {
        throw typedError(
          "Adoption target exceeds available migrations",
          "MIGRATION_ADOPTION_TARGET_UNSUPPORTED",
          { targetVersion },
        );
      }
      await verifyAdoption(connection, targetVersion);
      await transaction(connection, async (tx) => {
        for (const migration of migrations.slice(0, targetVersion)) {
          await tx`
            INSERT INTO cimmich_schema_migration (
              version, filename, checksum_sha256, runner_version
            ) VALUES (
              ${migration.version}, ${migration.filename}, ${migration.checksum},
              ${`${runnerVersion}:verified-adoption`}
            )
          `;
        }
      });
      applied = await readLedger(connection);
    }
    assertLedger(applied, migrations);
    const newlyApplied = [];
    let appliedPatches = await readPatchLedger(connection);
    assertPatchLedger(appliedPatches, patches);
    const newlyAppliedPatches = [];
    const applyPatchesAtBase = async (baseVersion) => {
      while (appliedPatches.length < patches.length) {
        const patch = patches[appliedPatches.length];
        if (patch.baseVersion < baseVersion) {
          throw typedError(
            "An unapplied schema patch targets an older schema version",
            "MIGRATION_PATCH_BASE_MISMATCH",
            { currentVersion: baseVersion, patchId: patch.patchId },
          );
        }
        if (patch.baseVersion !== baseVersion) break;
        const startedAt = performance.now();
        await transaction(connection, async (tx) => {
          await tx.unsafe(patch.body);
          const executionMs =
            Math.round((performance.now() - startedAt) * 10) / 10;
          await tx`
            INSERT INTO cimmich_schema_patch (
              patch_id, base_version, sequence, filename, checksum_sha256,
              runner_version, execution_ms
            ) VALUES (
              ${patch.patchId}, ${patch.baseVersion}, ${patch.sequence},
              ${patch.filename}, ${patch.checksum}, ${runnerVersion},
              ${executionMs}
            )
          `;
        });
        newlyAppliedPatches.push(patch.patchId);
        appliedPatches = await readPatchLedger(connection);
        assertPatchLedger(appliedPatches, patches);
      }
    };
    for (const migration of migrations.slice(applied.length)) {
      const currentVersion = Number(applied.at(-1)?.version || 0);
      await applyPatchesAtBase(currentVersion);
      const startedAt = performance.now();
      await transaction(connection, async (tx) => {
        await tx.unsafe(migration.body);
        const executionMs =
          Math.round((performance.now() - startedAt) * 10) / 10;
        await tx`
          INSERT INTO cimmich_schema_migration (
            version, filename, checksum_sha256, runner_version, execution_ms
          ) VALUES (
            ${migration.version}, ${migration.filename}, ${migration.checksum},
            ${runnerVersion}, ${executionMs}
          )
        `;
      });
      newlyApplied.push(migration.version);
      applied = await readLedger(connection);
      assertLedger(applied, migrations);
    }
    const finalLedger = await readLedger(connection);
    assertLedger(finalLedger, migrations);
    await applyPatchesAtBase(Number(finalLedger.at(-1)?.version || 0));
    appliedPatches = await readPatchLedger(connection);
    assertPatchLedger(appliedPatches, patches);
    return {
      appliedCount: finalLedger.length,
      currentVersion: Number(finalLedger.at(-1)?.version || 0),
      newlyApplied,
      newlyAppliedPatches,
      patchCount: appliedPatches.length,
      runnerVersion,
    };
  } finally {
    try {
      await connection`SELECT pg_advisory_unlock(hashtextextended(${lockKey}, 48))`;
    } finally {
      connection.release();
    }
  }
};
