import { createHash } from "node:crypto";

export const immichSourceRolloverSchemaVersion =
  "cimmich.immich-inventory-source-rollover.v1";

const receiptId = "receipt_cimmich_immich_inventory_source_rollover_v1";
const visibilities = ["timeline", "archive", "hidden", "locked"];

const requiredText = (value, label, maximum = 200) => {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error(`Immich source rollover requires ${label}`);
  }
  return normalized;
};

const digest = (value) =>
  createHash("sha256").update(String(value)).digest("hex");

const inspectRollover = async (sql, predecessorSourceId, successorSourceId) => {
  const [row] = await sql`
    WITH predecessor AS MATERIALIZED (
      SELECT projection.*
      FROM immich_asset_projection projection
      WHERE projection.source_id = ${predecessorSourceId}
        AND projection.state IN ('active','suspected_missing')
    ), successor AS MATERIALIZED (
      SELECT projection.*
      FROM immich_asset_projection projection
      WHERE projection.source_id = ${successorSourceId}
        AND projection.state = 'active'
    ), shared_assets AS MATERIALIZED (
      SELECT DISTINCT predecessor.immich_asset_id
      FROM predecessor
      JOIN successor
        ON successor.cimmich_asset_id = predecessor.cimmich_asset_id
    ), metadata_match_counts AS MATERIALIZED (
      SELECT predecessor.immich_asset_id, count(*)::integer AS matches
      FROM predecessor
      JOIN successor
        ON predecessor.original_file_name IS NOT NULL
        AND successor.original_file_name IS NOT NULL
        AND lower(successor.original_file_name)
          = lower(predecessor.original_file_name)
        AND successor.capture_time = predecessor.capture_time
        AND successor.asset_type = predecessor.asset_type
        AND successor.original_mime_type
          IS NOT DISTINCT FROM predecessor.original_mime_type
        AND successor.width IS NOT DISTINCT FROM predecessor.width
        AND successor.height IS NOT DISTINCT FROM predecessor.height
        AND successor.duration_seconds
          IS NOT DISTINCT FROM predecessor.duration_seconds
      GROUP BY predecessor.immich_asset_id
    ), match_counts AS MATERIALIZED (
      SELECT predecessor.immich_asset_id,
        predecessor.cimmich_asset_id,
        shared.immich_asset_id IS NOT NULL AS shares_asset,
        coalesce(metadata.matches, 0) AS metadata_matches
      FROM predecessor
      LEFT JOIN shared_assets shared
        ON shared.immich_asset_id = predecessor.immich_asset_id
      LEFT JOIN metadata_match_counts metadata
        ON metadata.immich_asset_id = predecessor.immich_asset_id
    ), predecessor_only_assets AS MATERIALIZED (
      SELECT DISTINCT predecessor.cimmich_asset_id AS asset_id
      FROM predecessor
      WHERE predecessor.cimmich_asset_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM asset_source_binding binding
          WHERE binding.asset_id = predecessor.cimmich_asset_id
            AND binding.state = 'active'
            AND NOT (
              binding.source_kind = 'immich'
              AND binding.source_id = ${predecessorSourceId}
            )
        )
    ), historical_evidence_assets AS MATERIALIZED (
      SELECT face.asset_id
      FROM face_observation face
      JOIN current_face_identity identity
        ON identity.face_id = face.face_id
        AND identity.state = 'accepted'
      WHERE face.state = 'valid'
      UNION
      SELECT body.asset_id
      FROM body_observation body
      JOIN current_body_tag tag
        ON tag.body_id = body.body_id
        AND tag.state = 'accepted'
      WHERE body.state = 'valid'
      UNION
      SELECT presence.asset_id
      FROM current_presence_tag presence
      WHERE presence.state = 'accepted'
    )
    SELECT
      (SELECT count(*) FROM predecessor)::integer AS projections,
      (SELECT count(*) FROM match_counts WHERE shares_asset)::integer
        AS shared_asset_projections,
      (SELECT count(*) FROM match_counts
        WHERE NOT shares_asset AND metadata_matches > 0)::integer
        AS metadata_equivalent_projections,
      (SELECT count(*) FROM match_counts
        WHERE NOT shares_asset AND metadata_matches > 1)::integer
        AS ambiguous_metadata_projections,
      (SELECT count(*) FROM match_counts
        WHERE NOT shares_asset AND metadata_matches = 0)::integer
        AS unmatched_projections,
      (SELECT count(*) FROM asset_source_binding binding
        WHERE binding.source_kind = 'immich'
          AND binding.source_id = ${predecessorSourceId}
          AND binding.state IN ('active','offline'))::integer
        AS source_bindings,
      (SELECT count(*) FROM predecessor_only_assets)::integer
        AS predecessor_only_assets,
      (SELECT count(*) FROM predecessor_only_assets predecessor
        JOIN historical_evidence_assets evidence
          ON evidence.asset_id = predecessor.asset_id)::integer
        AS historical_evidence_assets,
      (SELECT count(*) FROM media_job job
        JOIN predecessor_only_assets predecessor
          ON predecessor.asset_id = job.asset_id
        WHERE job.state IN ('pending','processing'))::integer
        AS jobs_to_pause
  `;
  return Object.fromEntries(
    Object.entries(row || {}).map(([key, value]) => [key, Number(value || 0)]),
  );
};

export const rolloverImmichInventorySource = async ({
  actorId,
  apply = false,
  commandId,
  confirm = "",
  predecessorSourceId,
  successorSourceId,
  sql,
}) => {
  if (!sql || typeof sql.begin !== "function") {
    throw new Error("Immich source rollover requires a Cimmich database");
  }
  const command = {
    actorId: requiredText(actorId, "actorId"),
    commandId: requiredText(commandId, "commandId"),
    predecessorSourceId: requiredText(
      predecessorSourceId,
      "predecessorSourceId",
      120,
    ),
    successorSourceId: requiredText(
      successorSourceId,
      "successorSourceId",
      120,
    ),
  };
  if (command.predecessorSourceId === command.successorSourceId) {
    throw new Error(
      "Immich source rollover predecessor and successor must differ",
    );
  }
  const expectedConfirmation = `${command.predecessorSourceId}->${command.successorSourceId}`;
  if (apply && confirm !== expectedConfirmation) {
    throw new Error(
      `Immich source rollover apply requires --confirm=${expectedConfirmation}`,
    );
  }
  const requestDigest = digest(
    JSON.stringify({
      ...command,
      schemaVersion: immichSourceRolloverSchemaVersion,
    }),
  );

  return sql.begin(async (transaction) => {
    for (const sourceId of [
      command.predecessorSourceId,
      command.successorSourceId,
    ].sort()) {
      await transaction`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`immich-source-rollover:${sourceId}`}, 0)
        )
      `;
    }
    const [prior] = await transaction`
      SELECT request_digest, response
      FROM immich_inventory_source_rollover_command
      WHERE command_id = ${command.commandId}
      FOR UPDATE
    `;
    if (prior) {
      if (prior.request_digest !== requestDigest) {
        throw new Error(
          "Immich source rollover commandId was reused with different input",
        );
      }
      return { ...prior.response, replayed: true };
    }

    const sources = await transaction`
      SELECT source_id, state, superseded_by_source_id, last_completed_run_id
      FROM immich_inventory_source
      WHERE source_id IN (
        ${command.predecessorSourceId}, ${command.successorSourceId}
      )
      ORDER BY source_id
      FOR UPDATE
    `;
    const predecessor = sources.find(
      (source) => source.source_id === command.predecessorSourceId,
    );
    const successor = sources.find(
      (source) => source.source_id === command.successorSourceId,
    );
    if (!predecessor || !successor) {
      throw new Error("Immich source rollover source identity was not found");
    }
    if (predecessor.state !== "active" || predecessor.superseded_by_source_id) {
      throw new Error(
        "Immich source rollover predecessor is not an active authority",
      );
    }
    if (successor.state !== "active") {
      throw new Error(
        "Immich source rollover successor is not an active authority",
      );
    }
    const processing = await transaction`
      SELECT source_id
      FROM immich_inventory_run
      WHERE source_id IN (
        ${command.predecessorSourceId}, ${command.successorSourceId}
      )
        AND state = 'processing'
      LIMIT 1
    `;
    if (processing.length > 0) {
      throw new Error(
        "Immich source rollover cannot run while inventory is processing",
      );
    }
    const [completedSuccessor] = await transaction`
      SELECT run.run_id
      FROM immich_inventory_run run
      WHERE run.run_id = ${successor.last_completed_run_id}
        AND run.source_id = ${command.successorSourceId}
        AND run.state = 'completed'
        AND run.selected_visibilities = ${visibilities}
        AND NOT EXISTS (
          SELECT 1
          FROM immich_inventory_lane lane
          WHERE lane.run_id = run.run_id
            AND lane.state <> 'completed'
        )
    `;
    if (!completedSuccessor) {
      throw new Error(
        "Immich source rollover requires a completed full successor inventory",
      );
    }

    const before = await inspectRollover(
      transaction,
      command.predecessorSourceId,
      command.successorSourceId,
    );
    if (!apply) {
      return {
        applied: false,
        before,
        predecessorSourceId: command.predecessorSourceId,
        schemaVersion: immichSourceRolloverSchemaVersion,
        successorRunId: completedSuccessor.run_id,
        successorSourceId: command.successorSourceId,
      };
    }

    const changedProjections = await transaction`
      UPDATE immich_asset_projection projection
      SET state = 'missing'
      WHERE projection.source_id = ${command.predecessorSourceId}
        AND projection.state IN ('active','suspected_missing')
      RETURNING projection.cimmich_asset_id
    `;
    const changedBindings = await transaction`
      WITH changed AS (
        UPDATE asset_source_binding binding
        SET state = 'missing'
        WHERE binding.source_kind = 'immich'
          AND binding.source_id = ${command.predecessorSourceId}
          AND binding.state IN ('active','offline')
        RETURNING binding.binding_id, binding.asset_id, binding.content_id,
          binding.input_revision
      )
      INSERT INTO asset_source_binding_event (
        event_id, binding_id, asset_id, content_id, input_revision,
        event_kind, producer_receipt_id
      )
      SELECT
        'source_binding_event_' || substr(encode(digest(
          binding_id || E'\x1f' || asset_id || E'\x1f'
            || coalesce(input_revision, '') || E'\x1fmissing',
          'sha256'
        ), 'hex'), 1, 40),
        binding_id, asset_id, content_id, input_revision, 'missing',
        ${receiptId}
      FROM changed
      ON CONFLICT (
        binding_id, asset_id, input_revision, event_kind
      ) DO NOTHING
      RETURNING binding_id
    `;
    const pausedJobs = await transaction`
      WITH unavailable AS (
        SELECT DISTINCT projection.cimmich_asset_id AS asset_id
        FROM immich_asset_projection projection
        WHERE projection.source_id = ${command.predecessorSourceId}
          AND projection.cimmich_asset_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM asset_source_binding binding
            WHERE binding.asset_id = projection.cimmich_asset_id
              AND binding.state = 'active'
          )
      ), paused AS (
        UPDATE media_job job
        SET state = 'paused',
          attempt_count = CASE
            WHEN job.state = 'processing'
              THEN greatest(job.attempt_count - 1, 0)
            ELSE job.attempt_count
          END,
          lease_owner = NULL,
          lease_expires_at = NULL,
          last_error_code = 'ASSET_NOT_VISIBLE'
        FROM unavailable
        WHERE job.asset_id = unavailable.asset_id
          AND job.state IN ('pending','processing')
        RETURNING job.job_id, job.attempt_count, job.checkpoint_revision
      )
      INSERT INTO media_job_event (
        event_id, job_id, event_kind, attempt_count, checkpoint_revision,
        public_details
      )
      SELECT
        'media_job_event_' || replace(gen_random_uuid()::text, '-', ''),
        job_id, 'paused', attempt_count, checkpoint_revision,
        '{"reason":"inventory_source_superseded"}'::jsonb
      FROM paused
      RETURNING job_id
    `;
    const missingAssets = await transaction`
      UPDATE asset
      SET state = 'missing'
      WHERE asset_id IN (
        SELECT projection.cimmich_asset_id
        FROM immich_asset_projection projection
        WHERE projection.source_id = ${command.predecessorSourceId}
          AND projection.cimmich_asset_id IS NOT NULL
      )
        AND state = 'active'
        AND NOT EXISTS (
          SELECT 1
          FROM asset_source_binding binding
          WHERE binding.asset_id = asset.asset_id
            AND binding.state = 'active'
        )
      RETURNING asset_id
    `;
    await transaction`
      UPDATE immich_inventory_source
      SET state = 'disabled',
        superseded_by_source_id = ${command.successorSourceId},
        updated_at = now()
      WHERE source_id = ${command.predecessorSourceId}
    `;
    const response = {
      applied: true,
      before,
      changedBindings: changedBindings.length,
      changedProjections: changedProjections.length,
      missingAssets: missingAssets.length,
      pausedJobs: pausedJobs.length,
      predecessorSourceId: command.predecessorSourceId,
      schemaVersion: immichSourceRolloverSchemaVersion,
      successorRunId: completedSuccessor.run_id,
      successorSourceId: command.successorSourceId,
    };
    await transaction`
      INSERT INTO immich_inventory_source_rollover_command (
        command_id, actor_id, predecessor_source_id, successor_source_id,
        request_digest, response, producer_receipt_id
      ) VALUES (
        ${command.commandId}, ${command.actorId},
        ${command.predecessorSourceId}, ${command.successorSourceId},
        ${requestDigest}, ${transaction.json(response)}, ${receiptId}
      )
    `;
    return { ...response, replayed: false };
  });
};
