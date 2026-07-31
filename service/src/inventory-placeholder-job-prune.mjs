import { createHash } from "node:crypto";

export const inventoryPlaceholderJobPruneSchemaVersion =
  "cimmich.inventory-placeholder-job-prune.v1";

const receiptId = "receipt_cimmich_inventory_placeholder_job_prune_v1";
const configDigest = "0".repeat(64);
const toolVersion = "inventory-only-v1";

const requiredText = (value, label, maximum = 200) => {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error(`Inventory placeholder prune requires ${label}`);
  }
  return normalized;
};

const requiredCount = (value) => {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(
      "Inventory placeholder prune requires a positive expectedJobCount",
    );
  }
  return count;
};

const digest = (value) =>
  createHash("sha256").update(String(value)).digest("hex");

const inspectPlaceholders = async (sql) => {
  const [row] = await sql`
    WITH scoped AS MATERIALIZED (
      SELECT job.*
      FROM media_job job
      WHERE job.operation = 'detect_and_recognize'
        AND job.tool_version = ${toolVersion}
        AND job.config_digest = ${configDigest}
    ), target AS MATERIALIZED (
      SELECT job.job_id
      FROM scoped job
      WHERE job.state = 'paused'
        AND job.attempt_count = 0
        AND job.checkpoint_stage = 'queued'
        AND job.checkpoint_revision = 0
        AND job.checkpoint_payload = '{}'::jsonb
        AND job.checkpoint_digest IS NULL
        AND job.lease_owner IS NULL
        AND job.lease_expires_at IS NULL
        AND job.result_receipt_id IS NULL
        AND job.result_digest IS NULL
        AND job.started_at IS NULL
        AND job.completed_at IS NULL
    ), event_shape AS MATERIALIZED (
      SELECT event.job_id,
        count(*)::integer AS event_count,
        count(*) FILTER (
          WHERE event.event_kind = 'queued'
            AND event.attempt_count = 0
            AND event.checkpoint_revision = 0
            AND event.public_details = '{}'::jsonb
        )::integer AS queued_count,
        count(*) FILTER (
          WHERE event.event_kind = 'paused'
            AND event.attempt_count = 0
            AND event.checkpoint_revision = 0
            AND event.public_details IN (
              '{"reason":"inventory_job_disabled"}'::jsonb,
              '{"reason":"inventory_asset_split_repaired"}'::jsonb
            )
        )::integer AS paused_count
      FROM media_job_event event
      JOIN target USING (job_id)
      GROUP BY event.job_id
    ), dependent_jobs AS MATERIALIZED (
      SELECT pipeline.detection_job_id AS job_id
      FROM media_pipeline_run pipeline
      WHERE pipeline.detection_job_id IS NOT NULL
      UNION
      SELECT pipeline.recognition_job_id
      FROM media_pipeline_run pipeline
      WHERE pipeline.recognition_job_id IS NOT NULL
      UNION
      SELECT result.job_id FROM media_job_detection_result result
      UNION
      SELECT result.job_id FROM media_job_body_detection_result result
      UNION
      SELECT request.job_id FROM manual_face_recognition_request request
    ), eligible AS MATERIALIZED (
      SELECT shape.job_id, shape.event_count
      FROM event_shape shape
      LEFT JOIN dependent_jobs dependency USING (job_id)
      WHERE shape.event_count = 2
        AND shape.queued_count = 1
        AND shape.paused_count = 1
        AND dependency.job_id IS NULL
    )
    SELECT
      (SELECT count(*) FROM scoped)::integer AS scoped_jobs,
      (SELECT count(*) FROM eligible)::integer AS eligible_jobs,
      (
        (SELECT count(*) FROM scoped) -
        (SELECT count(*) FROM eligible)
      )::integer AS unsafe_jobs,
      (SELECT coalesce(sum(event_count), 0)
        FROM eligible)::integer AS eligible_events
  `;
  return Object.fromEntries(
    Object.entries(row || {}).map(([key, value]) => [key, Number(value || 0)]),
  );
};

const deletePlaceholders = async (sql) => sql`
  WITH scoped AS MATERIALIZED (
    SELECT job.*
    FROM media_job job
    WHERE job.operation = 'detect_and_recognize'
      AND job.tool_version = ${toolVersion}
      AND job.config_digest = ${configDigest}
  ), target AS MATERIALIZED (
    SELECT job.job_id
    FROM scoped job
    WHERE job.state = 'paused'
      AND job.attempt_count = 0
      AND job.checkpoint_stage = 'queued'
      AND job.checkpoint_revision = 0
      AND job.checkpoint_payload = '{}'::jsonb
      AND job.checkpoint_digest IS NULL
      AND job.lease_owner IS NULL
      AND job.lease_expires_at IS NULL
      AND job.result_receipt_id IS NULL
      AND job.result_digest IS NULL
      AND job.started_at IS NULL
      AND job.completed_at IS NULL
  ), event_shape AS MATERIALIZED (
    SELECT event.job_id,
      count(*)::integer AS event_count,
      count(*) FILTER (
        WHERE event.event_kind = 'queued'
          AND event.attempt_count = 0
          AND event.checkpoint_revision = 0
          AND event.public_details = '{}'::jsonb
      )::integer AS queued_count,
      count(*) FILTER (
        WHERE event.event_kind = 'paused'
          AND event.attempt_count = 0
          AND event.checkpoint_revision = 0
          AND event.public_details IN (
            '{"reason":"inventory_job_disabled"}'::jsonb,
            '{"reason":"inventory_asset_split_repaired"}'::jsonb
          )
      )::integer AS paused_count
    FROM media_job_event event
    JOIN target USING (job_id)
    GROUP BY event.job_id
  ), dependent_jobs AS MATERIALIZED (
    SELECT pipeline.detection_job_id AS job_id
    FROM media_pipeline_run pipeline
    WHERE pipeline.detection_job_id IS NOT NULL
    UNION
    SELECT pipeline.recognition_job_id
    FROM media_pipeline_run pipeline
    WHERE pipeline.recognition_job_id IS NOT NULL
    UNION
    SELECT result.job_id FROM media_job_detection_result result
    UNION
    SELECT result.job_id FROM media_job_body_detection_result result
    UNION
    SELECT request.job_id FROM manual_face_recognition_request request
  ), eligible AS MATERIALIZED (
    SELECT shape.job_id
    FROM event_shape shape
    LEFT JOIN dependent_jobs dependency USING (job_id)
    WHERE shape.event_count = 2
      AND shape.queued_count = 1
      AND shape.paused_count = 1
      AND dependency.job_id IS NULL
  )
  DELETE FROM media_job job
  USING eligible
  WHERE job.job_id = eligible.job_id
  RETURNING job.job_id
`;

export const pruneInventoryPlaceholderJobs = async ({
  actorId,
  apply = false,
  commandId,
  confirm = "",
  expectedJobCount,
  sql,
}) => {
  if (!sql || typeof sql.begin !== "function") {
    throw new Error("Inventory placeholder prune requires a Cimmich database");
  }
  const command = {
    actorId: requiredText(actorId, "actorId"),
    commandId: requiredText(commandId, "commandId"),
    expectedJobCount: requiredCount(expectedJobCount),
  };
  const expectedConfirmation = `inventory-only-placeholders:${command.expectedJobCount}`;
  if (apply && confirm !== expectedConfirmation) {
    throw new Error(
      `Inventory placeholder prune apply requires --confirm=${expectedConfirmation}`,
    );
  }
  const requestDigest = digest(
    JSON.stringify({
      ...command,
      schemaVersion: inventoryPlaceholderJobPruneSchemaVersion,
    }),
  );

  return sql.begin(async (transaction) => {
    await transaction`
      SELECT pg_advisory_xact_lock(
        hashtextextended('cimmich-inventory-placeholder-job-prune-v1', 0)
      )
    `;
    const [prior] = await transaction`
      SELECT request_digest, response
      FROM inventory_placeholder_job_prune_command
      WHERE command_id = ${command.commandId}
      FOR UPDATE
    `;
    if (prior) {
      if (prior.request_digest !== requestDigest) {
        throw new Error(
          "Inventory placeholder prune commandId was reused with different input",
        );
      }
      return { ...prior.response, replayed: true };
    }

    const before = await inspectPlaceholders(transaction);
    if (!apply) {
      return {
        applied: false,
        before,
        expectedConfirmation,
        schemaVersion: inventoryPlaceholderJobPruneSchemaVersion,
      };
    }
    if (
      before.eligible_jobs !== command.expectedJobCount ||
      before.unsafe_jobs !== 0
    ) {
      throw new Error(
        "Inventory placeholder prune live scope does not match the confirmed safe set",
      );
    }

    const deleted = await deletePlaceholders(transaction);
    if (deleted.length !== command.expectedJobCount) {
      throw new Error(
        "Inventory placeholder prune changed during apply; transaction rolled back",
      );
    }
    const response = {
      applied: true,
      before,
      deletedEvents: before.eligible_events,
      deletedJobs: deleted.length,
      schemaVersion: inventoryPlaceholderJobPruneSchemaVersion,
    };
    await transaction`
      INSERT INTO inventory_placeholder_job_prune_command (
        command_id, actor_id, expected_job_count, request_digest, response,
        producer_receipt_id
      ) VALUES (
        ${command.commandId}, ${command.actorId}, ${command.expectedJobCount},
        ${requestDigest}, ${transaction.json(response)}, ${receiptId}
      )
    `;
    return { ...response, replayed: false };
  });
};
