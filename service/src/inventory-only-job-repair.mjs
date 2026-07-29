const inventoryOnlyConfigDigest = "0".repeat(64);
const inventoryOnlyToolVersion = "inventory-only-v1";

const requiredText = (value, label, maximum = 200) => {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error(`Inventory-only job repair requires ${label}`);
  }
  return normalized;
};

export const repairInventoryOnlyJobs = async ({
  apply = false,
  sourceId,
  sql,
}) => {
  if (!sql || typeof sql.begin !== "function") {
    throw new Error("Inventory-only job repair requires a database");
  }
  const normalizedSourceId = requiredText(sourceId, "sourceId", 120);
  return sql.begin(async (transaction) => {
    await transaction`
      SELECT pg_advisory_xact_lock(
        hashtextextended('cimmich-inventory-only-job-repair-v1', 0)
      )
    `;
    const [summary] = await transaction`
      SELECT
        count(*) FILTER (
          WHERE job.state = 'pending'
            AND job.attempt_count = 0
            AND job.checkpoint_stage = 'queued'
            AND job.checkpoint_revision = 0
            AND job.lease_owner IS NULL
            AND job.lease_expires_at IS NULL
            AND job.result_receipt_id IS NULL
            AND job.result_digest IS NULL
        )::integer AS repairable,
        count(*) FILTER (
          WHERE NOT (
            job.state IN ('pending', 'paused')
            AND job.attempt_count = 0
            AND job.checkpoint_stage = 'queued'
            AND job.checkpoint_revision = 0
            AND job.lease_owner IS NULL
            AND job.lease_expires_at IS NULL
            AND job.result_receipt_id IS NULL
            AND job.result_digest IS NULL
          )
        )::integer AS unsafe,
        count(*) FILTER (WHERE job.state = 'paused')::integer AS already_paused
      FROM media_job job
      JOIN immich_asset_projection projection
        ON projection.cimmich_asset_id = job.asset_id
       AND projection.source_id = ${normalizedSourceId}
       AND projection.input_revision = job.input_revision
      WHERE job.operation = 'detect_and_recognize'
        AND job.tool_version = ${inventoryOnlyToolVersion}
        AND job.config_digest = ${inventoryOnlyConfigDigest}
    `;
    const before = {
      alreadyPaused: Number(summary.already_paused),
      repairable: Number(summary.repairable),
      unsafe: Number(summary.unsafe),
    };
    if (before.unsafe !== 0) {
      throw new Error(
        "Inventory-only job repair found attempted or derived queue state",
      );
    }
    if (!apply || before.repairable === 0) {
      return {
        applied: false,
        before,
        schemaVersion: "cimmich.inventory-only-job-repair.v1",
      };
    }
    const events = await transaction`
      WITH paused AS (
        UPDATE media_job job SET
          state = 'paused',
          last_error_code = 'INVENTORY_JOB_DISABLED',
          lease_owner = NULL,
          lease_expires_at = NULL
        FROM immich_asset_projection projection
        WHERE projection.cimmich_asset_id = job.asset_id
          AND projection.source_id = ${normalizedSourceId}
          AND projection.input_revision = job.input_revision
          AND job.operation = 'detect_and_recognize'
          AND job.tool_version = ${inventoryOnlyToolVersion}
          AND job.config_digest = ${inventoryOnlyConfigDigest}
          AND job.state = 'pending'
          AND job.attempt_count = 0
          AND job.checkpoint_stage = 'queued'
          AND job.checkpoint_revision = 0
          AND job.lease_owner IS NULL
          AND job.lease_expires_at IS NULL
          AND job.result_receipt_id IS NULL
          AND job.result_digest IS NULL
        RETURNING job.job_id, job.attempt_count, job.checkpoint_revision
      )
      INSERT INTO media_job_event (
        event_id, job_id, event_kind, attempt_count,
        checkpoint_revision, public_details
      )
      SELECT
        'event_inventory_job_disabled_' ||
          substr(encode(digest(job_id, 'sha256'), 'hex'), 1, 40),
        job_id, 'paused', attempt_count, checkpoint_revision,
        '{"reason":"inventory_job_disabled"}'::jsonb
      FROM paused
      ON CONFLICT (event_id) DO NOTHING
      RETURNING job_id
    `;
    return {
      applied: true,
      before,
      pausedJobs: events.length,
      schemaVersion: "cimmich.inventory-only-job-repair.v1",
    };
  });
};
