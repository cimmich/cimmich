import {
  mediaOperatorContractVersion,
  validateMediaOperatorCommand,
} from "./media-operator-contract.mjs";

const operatorError = (message, statusCode, code) =>
  Object.assign(new Error(message), { code, statusCode });

const publicErrorCode = (error) => {
  const code = String(error?.code || "");
  return /^[A-Z][A-Z0-9_]{2,79}$/.test(code)
    ? code
    : "MEDIA_OPERATOR_RUN_FAILED";
};

const projectControl = (row) => ({
  reasonCode: row.reason_code || null,
  revision: Number(row.revision),
  state: row.state,
  updatedAt: row.updated_at,
  updatedBy: row.updated_by,
});

const projectCommand = (row) => ({
  commandId: row.command_id,
  commandKind: row.command_kind,
  errorCode: row.error_code || null,
  response: row.response || null,
  state: row.state,
});

const queueDepth = (summary = {}) =>
  Number(summary.pending || 0) + Number(summary.processing || 0);

export const createMediaOperator = ({
  continueDetection,
  detectionWorker,
  existingRecognitionScheduler,
  existingRecognitionWorker,
  inventory,
  recognitionWorker,
  repository,
  sql,
  providerReceipt,
  workerId = `media-operator-${process.pid}`,
} = {}) => {
  if (!sql) throw new Error("Media operator requires a Cimmich database");
  const owner = String(workerId || "").trim();
  if (!owner) throw new Error("Media operator requires workerId");

  const status = async () => {
    const [control] = await sql`
      SELECT * FROM media_operator_control WHERE control_id = 'primary'
    `;
    const [summary] = await sql`SELECT * FROM media_job_status`;
    const recent = await sql`
      SELECT command_id, command_kind, state, error_code, response
      FROM media_operator_command
      ORDER BY started_at DESC, command_id DESC
      LIMIT 10
    `;
    return {
      activationAuthority: "none",
      control: projectControl(control),
      queue: summary,
      recentCommands: recent.map(projectCommand),
      provider: providerReceipt || {
        activationAuthority: "none",
        state: "not_configured",
      },
      schemaVersion: mediaOperatorContractVersion,
    };
  };

  const begin = async (command) =>
    sql.begin(async (tx) => {
      const [inserted] = await tx`
        INSERT INTO media_operator_command (
          command_id, command_kind, actor_id, request_digest,
          resource_envelope, state, lease_owner, lease_expires_at
        ) VALUES (
          ${command.commandId}, ${command.commandKind}, ${command.actorId},
          ${command.requestDigest}, ${tx.json(command.envelope)}, 'processing',
          ${owner}, now() + (${command.envelope.leaseSeconds} * interval '1 second')
        ) ON CONFLICT (command_id) DO NOTHING
        RETURNING *
      `;
      if (inserted) return { replay: false, row: inserted };
      const [existing] = await tx`
        SELECT * FROM media_operator_command
        WHERE command_id = ${command.commandId}
        FOR UPDATE
      `;
      if (existing.request_digest !== command.requestDigest) {
        throw operatorError(
          "Media operator commandId was reused with another request",
          409,
          "MEDIA_OPERATOR_COMMAND_CONFLICT",
        );
      }
      if (existing.state !== "processing") {
        return { replay: true, row: existing };
      }
      if (new Date(existing.lease_expires_at).getTime() > Date.now()) {
        throw operatorError(
          "Media operator command is already running",
          409,
          "MEDIA_OPERATOR_COMMAND_IN_PROGRESS",
        );
      }
      const [reclaimed] = await tx`
        UPDATE media_operator_command
        SET lease_owner = ${owner},
          lease_expires_at = now() + (${command.envelope.leaseSeconds} * interval '1 second'),
          started_at = now()
        WHERE command_id = ${command.commandId} AND state = 'processing'
        RETURNING *
      `;
      return { replay: false, row: reclaimed };
    });

  const finish = async (commandId, response) => {
    const [row] = await sql`
      UPDATE media_operator_command
      SET state = 'completed', response = ${sql.json(response)},
        lease_owner = NULL, lease_expires_at = NULL, completed_at = now()
      WHERE command_id = ${commandId} AND state = 'processing'
        AND lease_owner = ${owner}
      RETURNING *
    `;
    if (!row) {
      throw operatorError(
        "Media operator command lease changed before completion",
        409,
        "MEDIA_OPERATOR_LEASE_CHANGED",
      );
    }
    return row.response;
  };

  const fail = async (commandId, error) => {
    const code = publicErrorCode(error);
    const response = {
      activationAuthority: "none",
      errorCode: code,
      schemaVersion: mediaOperatorContractVersion,
      state: "failed",
    };
    await sql`
      UPDATE media_operator_command
      SET state = 'failed', error_code = ${code}, response = ${sql.json(response)},
        lease_owner = NULL, lease_expires_at = NULL, completed_at = now()
      WHERE command_id = ${commandId} AND state = 'processing'
        AND lease_owner = ${owner}
    `;
    return response;
  };

  const pauseQueue = async ({ actorId, reasonCode = "OPERATOR_PAUSED" }) =>
    sql.begin(async (tx) => {
      const [control] = await tx`
        UPDATE media_operator_control
        SET state = 'paused', reason_code = ${reasonCode}, updated_by = ${actorId},
          revision = revision + 1, updated_at = now()
        WHERE control_id = 'primary'
        RETURNING *
      `;
      const paused = await tx`
        WITH changed AS (
          UPDATE media_job
          SET state = 'paused', last_error_code = 'OPERATOR_PAUSED'
          WHERE state = 'pending'
          RETURNING *
        ), events AS (
          INSERT INTO media_job_event (
            event_id, job_id, event_kind, attempt_count,
            checkpoint_revision, public_details
          ) SELECT
            'media_job_event_' || replace(gen_random_uuid()::text, '-', ''),
            job_id, 'paused', attempt_count, checkpoint_revision,
            '{"reason":"operator_paused"}'::jsonb
          FROM changed
        ) SELECT job_id FROM changed
      `;
      const [{ draining }] = await tx`
        SELECT count(*)::int AS draining FROM media_job WHERE state = 'processing'
      `;
      return {
        control: projectControl(control),
        draining,
        paused: paused.length,
      };
    });

  const resumeQueue = async ({ actorId }) =>
    sql.begin(async (tx) => {
      const [control] = await tx`
        UPDATE media_operator_control
        SET state = 'running', reason_code = NULL, updated_by = ${actorId},
          revision = revision + 1, updated_at = now()
        WHERE control_id = 'primary'
        RETURNING *
      `;
      const resumed = await tx`
        WITH changed AS (
          UPDATE media_job
          SET state = 'pending', last_error_code = NULL
          WHERE state = 'paused' AND last_error_code = 'OPERATOR_PAUSED'
          RETURNING *
        ), events AS (
          INSERT INTO media_job_event (
            event_id, job_id, event_kind, attempt_count,
            checkpoint_revision, public_details
          ) SELECT
            'media_job_event_' || replace(gen_random_uuid()::text, '-', ''),
            job_id, 'resumed', attempt_count, checkpoint_revision,
            '{"reason":"operator_resumed"}'::jsonb
          FROM changed
        ) SELECT job_id FROM changed
      `;
      return { control: projectControl(control), resumed: resumed.length };
    });

  const execute = async (input) => {
    const command = validateMediaOperatorCommand(input);
    const started = await begin(command);
    if (started.replay) return { ...started.row.response, replayed: true };
    try {
      if (command.commandKind === "pause") {
        const result = await pauseQueue({ actorId: command.actorId });
        return finish(command.commandId, {
          ...result,
          activationAuthority: "none",
          commandId: command.commandId,
          schemaVersion: mediaOperatorContractVersion,
          state: "paused",
        });
      }
      if (command.commandKind === "resume") {
        const result = await resumeQueue({ actorId: command.actorId });
        return finish(command.commandId, {
          ...result,
          activationAuthority: "none",
          commandId: command.commandId,
          schemaVersion: mediaOperatorContractVersion,
          state: "running",
        });
      }

      const [control] = await sql`
        SELECT * FROM media_operator_control WHERE control_id = 'primary'
      `;
      if (control.state === "paused") {
        return finish(command.commandId, {
          activationAuthority: "none",
          commandId: command.commandId,
          control: projectControl(control),
          schemaVersion: mediaOperatorContractVersion,
          state: "paused",
          work: {
            candidates: 0,
            detections: 0,
            inventoryPages: 0,
            recognitions: 0,
          },
        });
      }
      if (
        (command.envelope.maxInventoryPages > 0 && !inventory) ||
        (command.envelope.maxDetectionJobs > 0 &&
          (!detectionWorker || !continueDetection)) ||
        (command.envelope.maxRecognitionJobs > 0 &&
          !recognitionWorker &&
          !(existingRecognitionScheduler && existingRecognitionWorker))
      ) {
        throw operatorError(
          "Requested media operator stage is not configured",
          503,
          "MEDIA_OPERATOR_STAGE_UNAVAILABLE",
        );
      }

      const deadline = Date.now() + command.envelope.maxDurationMs;
      const remainingBudget = () => deadline - Date.now();
      if (
        command.envelope.maxDetectionJobs > 0 &&
        typeof inventory?.ensureCurrentJobs === "function"
      ) {
        await inventory.ensureCurrentJobs({
          limit: command.envelope.maxPendingJobs,
        });
      }
      const [before] = await sql`SELECT * FROM media_job_status`;
      const backpressured =
        queueDepth(before) >= command.envelope.maxPendingJobs;
      let inventoryResult = null;
      let inventoryPages = 0;
      if (
        !backpressured &&
        command.envelope.maxInventoryPages > 0 &&
        inventory
      ) {
        inventoryResult = await inventory.synchronize({
          maxPages: command.envelope.maxInventoryPages,
        });
        inventoryPages = Number(inventoryResult?.pagesProcessed || 0);
      }

      let detections = 0;
      for (
        ;
        detections < command.envelope.maxDetectionJobs && Date.now() < deadline;
        detections += 1
      ) {
        if (!detectionWorker) break;
        if (remainingBudget() < 1_000) break;
        const result = await detectionWorker.runNext({
          timeoutMs: remainingBudget(),
        });
        if (["idle", "paused"].includes(result.state)) break;
        if (result.status === "completed" && continueDetection) {
          await continueDetection(result.jobId);
        }
      }

      let recognitionAttempts = 0;
      let recognitions = 0;
      while (
        recognitionAttempts < command.envelope.maxRecognitionJobs &&
        Date.now() < deadline
      ) {
        if (remainingBudget() < 1_000) break;
        let result = recognitionWorker
          ? await recognitionWorker.runNext({ timeoutMs: remainingBudget() })
          : { state: "idle" };
        if (
          result.state === "idle" &&
          existingRecognitionScheduler &&
          existingRecognitionWorker
        ) {
          const scheduled = await existingRecognitionScheduler.enqueueNext();
          if (scheduled.state === "enqueued") {
            result =
              remainingBudget() < 1_000
                ? { state: "pending" }
                : await existingRecognitionWorker.runNext({
                    timeoutMs: remainingBudget(),
                  });
          } else if (scheduled.state === "recognized") {
            result = scheduled;
          }
        }
        if (["idle", "paused"].includes(result.state)) break;
        recognitionAttempts += 1;
        if (result.status === "completed") recognitions += 1;
      }

      const candidates =
        command.envelope.candidateLimit > 0 && repository?.machineSuggestions
          ? await repository.machineSuggestions({
              limit: command.envelope.candidateLimit,
            })
          : [];
      const [after] = await sql`SELECT * FROM media_job_status`;
      const state =
        Date.now() >= deadline
          ? "budget_exhausted"
          : backpressured
            ? "backpressure"
            : "completed";
      return finish(command.commandId, {
        activationAuthority: "none",
        commandId: command.commandId,
        envelope: command.envelope,
        inventory: inventoryResult
          ? {
              admittedAssetCount: Number(
                inventoryResult.admittedAssetCount || 0,
              ),
              admittedAssets: inventoryResult.admittedAssets || [],
              admittedAssetsTruncated: Boolean(
                inventoryResult.admittedAssetsTruncated,
              ),
              runId: inventoryResult.run?.runId || null,
              state: inventoryResult.run?.state,
            }
          : null,
        queueAfter: after,
        queueBefore: before,
        schemaVersion: mediaOperatorContractVersion,
        state,
        work: {
          candidates: candidates.length,
          detections,
          inventoryPages,
          recognitions,
        },
      });
    } catch (error) {
      await fail(command.commandId, error);
      throw error;
    }
  };

  return { execute, status };
};
