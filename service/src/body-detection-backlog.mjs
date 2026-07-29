import {
  completeAssetSourceRead,
  createAssetSourceRevisionRepository,
} from "./asset-source-revision.mjs";
import { createBodyDetectionResultRepository } from "./body-detection-result-repository.mjs";
import { bodyDetectionDigest } from "./body-detector-contract.mjs";
import {
  assembleLocalBodyDetectionResult,
  prepareLocalBodyDetectionJobFromSourceRead,
} from "./local-body-detection-worker.mjs";
import { createMediaJobLedger } from "./media-job-ledger.mjs";

export const bodyDetectionBacklogVersion = "cimmich.body-detection-backlog.v1";
export const bodyDetectionJobToolVersion = "cimmich-resident-body-detection-v2";

const requiredText = (value, label) => {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`Body detection backlog requires ${label}`);
  return normalized;
};
const boundedInteger = (value, label, minimum, maximum) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(
      `Body detection backlog ${label} must be from ${minimum} to ${maximum}`,
    );
  }
  return number;
};
const publicErrorCode = (error) => {
  const code = String(error?.code || "");
  return /^[A-Z][A-Z0-9_]{2,79}$/.test(code)
    ? code
    : "LOCAL_BODY_DETECTION_FAILED";
};

export const ensureBodyDetectionJobs = async (
  sql,
  {
    configDigest,
    limit = 10_000,
    maxAttempts = 3,
    sourceId,
    toolVersion = bodyDetectionJobToolVersion,
  } = {},
) => {
  const source = requiredText(sourceId, "sourceId");
  const digest = requiredText(configDigest, "configDigest");
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw new Error("Body detection backlog configDigest is invalid");
  }
  const boundedLimit = boundedInteger(limit, "job limit", 1, 10_000);
  const attempts = boundedInteger(maxAttempts, "max attempts", 1, 20);
  return sql.begin(async (transaction) => {
    const projections = await transaction`
      WITH triage_projection AS MATERIALIZED (
        SELECT * FROM media_asset_triage
      ),
      unique_projection AS (
        SELECT DISTINCT ON (projection.cimmich_asset_id)
          projection.cimmich_asset_id AS asset_id,
          projection.input_revision
        FROM immich_asset_projection projection
        JOIN asset ON asset.asset_id = projection.cimmich_asset_id
          AND asset.state = 'active' AND asset.media_kind = 'image'
        WHERE projection.source_id = ${source}
          AND projection.state = 'active'
          AND projection.asset_type = 'image'
          AND NOT EXISTS (
            SELECT 1
            FROM body_detection_result result
            JOIN current_asset_source_revision revision
              ON revision.revision_id = result.source_revision_id
              AND revision.asset_id = result.asset_id
            WHERE result.asset_id = projection.cimmich_asset_id
              AND result.detector_config_digest = ${digest}
          )
          AND NOT EXISTS (
            SELECT 1
            FROM media_job job
            WHERE job.asset_id = projection.cimmich_asset_id
              AND job.operation = 'detect_bodies'
              AND job.tool_version = ${toolVersion}
              AND job.config_digest = ${digest}
          )
        ORDER BY projection.cimmich_asset_id, projection.last_seen_at DESC,
          projection.input_revision, projection.immich_asset_id
      )
      SELECT projection.asset_id, projection.input_revision
      FROM unique_projection projection
      JOIN triage_projection triage ON triage.asset_id = projection.asset_id
      ORDER BY triage.priority_tier,
        triage.accepted_person_count DESC,
        triage.accepted_association_count DESC,
        triage.human_observation_count DESC,
        projection.asset_id, projection.input_revision
      LIMIT ${boundedLimit}
    `;
    for (const projection of projections) {
      await transaction`
        SELECT * FROM enqueue_media_job(
          ${projection.asset_id}, 'detect_bodies', ${toolVersion}, ${digest},
          ${projection.input_revision}, ${attempts}
        )
      `;
    }
    return {
      eligibleAssets: projections.length,
      ensuredJobs: projections.length,
    };
  });
};

const recoverExpiredBodyJobs = async (
  transaction,
  { configDigest, toolVersion },
) => {
  await transaction`
      WITH expired AS (
        UPDATE media_job
        SET state = CASE
              WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'pending'
            END,
            lease_owner = NULL, lease_expires_at = NULL,
            completed_at = CASE
              WHEN attempt_count >= max_attempts THEN now() ELSE NULL
            END,
            last_error_code = 'WORKER_LEASE_EXPIRED'
        WHERE operation = 'detect_bodies'
          AND tool_version = ${toolVersion}
          AND config_digest = ${configDigest}
          AND state = 'processing' AND lease_expires_at < now()
        RETURNING *
      )
      INSERT INTO media_job_event (
        event_id, job_id, event_kind, attempt_count, checkpoint_revision,
        public_details
      )
      SELECT
        'media_job_event_' || replace(gen_random_uuid()::text, '-', ''),
        job_id,
        CASE WHEN state = 'failed' THEN 'failed' ELSE 'lease_expired' END,
        attempt_count, checkpoint_revision,
        jsonb_build_object('errorCode', 'WORKER_LEASE_EXPIRED')
      FROM expired
    `;
};

const claimRankedBodyJob = async (
  sql,
  { configDigest, jobId, sourceId, toolVersion, workerId },
) =>
  sql.begin(async (transaction) => {
    const rows = await transaction`
      WITH claimed AS (
        UPDATE media_job job
        SET state = 'processing',
            attempt_count = job.attempt_count + 1,
            started_at = coalesce(job.started_at, now()),
            lease_owner = ${workerId}::text,
            lease_expires_at = now() + (300 * interval '1 second'),
            last_error_code = NULL
        WHERE job.job_id = ${jobId}
          AND job.state = 'pending'
          AND job.operation = 'detect_bodies'
          AND job.tool_version = ${toolVersion}
          AND job.config_digest = ${configDigest}
          AND EXISTS (
            SELECT 1
            FROM immich_asset_projection projection
            WHERE projection.cimmich_asset_id = job.asset_id
              AND projection.input_revision = job.input_revision
              AND projection.source_id = ${sourceId}
              AND projection.state = 'active'
          )
        RETURNING job.*
      ), events AS (
        INSERT INTO media_job_event (
          event_id, job_id, event_kind, attempt_count, checkpoint_revision,
          public_details
        )
        SELECT
          'media_job_event_' || replace(gen_random_uuid()::text, '-', ''),
          job_id, 'leased', attempt_count, checkpoint_revision,
          jsonb_build_object('workerId', ${workerId}::text)
        FROM claimed
      )
      SELECT claimed.* FROM claimed
    `;
    return rows[0] || null;
  });

export const createBodyDetectionJobClaimQueue = ({
  configDigest,
  sourceId,
  sql,
  toolVersion = bodyDetectionJobToolVersion,
  windowSize = 64,
} = {}) => {
  if (!sql) throw new Error("Body detection claim queue requires a database");
  const source = requiredText(sourceId, "sourceId");
  const digest = requiredText(configDigest, "configDigest");
  const version = requiredText(toolVersion, "toolVersion");
  const size = boundedInteger(windowSize, "claim window", 1, 1_000);
  let rankedJobIds = [];
  let refillPromise = null;

  const refill = async () => {
    const rows = await sql.begin(async (transaction) => {
      await recoverExpiredBodyJobs(transaction, {
        configDigest: digest,
        toolVersion: version,
      });
      return transaction`
        WITH triage_projection AS MATERIALIZED (
          SELECT * FROM media_asset_triage
        )
        SELECT job.job_id
        FROM media_job job
        JOIN triage_projection triage ON triage.asset_id = job.asset_id
        WHERE job.state = 'pending'
          AND job.operation = 'detect_bodies'
          AND job.tool_version = ${version}
          AND job.config_digest = ${digest}
          AND EXISTS (
            SELECT 1
            FROM immich_asset_projection projection
            WHERE projection.cimmich_asset_id = job.asset_id
              AND projection.input_revision = job.input_revision
              AND projection.source_id = ${source}
              AND projection.state = 'active'
          )
        ORDER BY triage.priority_tier,
          triage.accepted_person_count DESC,
          triage.accepted_association_count DESC,
          triage.human_observation_count DESC,
          job.requested_at, job.job_id
        LIMIT ${size}
      `;
    });
    rankedJobIds = rows.map((row) => row.job_id);
  };

  const ensureRankedJobs = async () => {
    if (rankedJobIds.length > 0) return;
    if (!refillPromise) {
      refillPromise = refill().finally(() => {
        refillPromise = null;
      });
    }
    await refillPromise;
  };

  return Object.freeze({
    async claimNext({ workerId }) {
      const worker = requiredText(workerId, "workerId");
      while (true) {
        await ensureRankedJobs();
        const jobId = rankedJobIds.shift();
        if (!jobId) return null;
        const row = await claimRankedBodyJob(sql, {
          configDigest: digest,
          jobId,
          sourceId: source,
          toolVersion: version,
          workerId: worker,
        });
        if (row) return row;
      }
    },
  });
};

export const createBodyDetectionJobWorker = ({
  claimQueue,
  companion,
  detector,
  manifest,
  sourceId,
  sql,
  workerId = "cimmich-body-detection-worker",
} = {}) => {
  if (!sql) throw new Error("Body detection worker requires a database");
  if (!companion || typeof companion.readAssetImage !== "function") {
    throw new Error("Body detection worker requires an Immich media reader");
  }
  if (!detector || typeof detector.detect !== "function") {
    throw new Error("Body detection worker requires a detector");
  }
  const source = requiredText(sourceId, "sourceId");
  const worker = requiredText(workerId, "workerId");
  const presentationRank = () => 2;
  const sourceRepository = createAssetSourceRevisionRepository(sql, {
    presentationRank,
  });
  const resultRepository = createBodyDetectionResultRepository(sql, {
    presentationRank,
  });
  const ledger = createMediaJobLedger(sql);
  const queue =
    claimQueue ||
    createBodyDetectionJobClaimQueue({
      configDigest: manifest.detectorConfigDigest,
      sourceId: source,
      sql,
      toolVersion: bodyDetectionJobToolVersion,
    });

  return Object.freeze({
    async close() {
      await detector.close?.();
    },
    async runNext({ timeoutMs = 120_000 } = {}) {
      const [control] = await sql`
        SELECT state FROM media_operator_control WHERE control_id = 'primary'
      `;
      if (control?.state === "paused") {
        return { schemaVersion: bodyDetectionBacklogVersion, state: "paused" };
      }
      const row = await queue.claimNext({
        workerId: worker,
      });
      if (!row) {
        return { schemaVersion: bodyDetectionBacklogVersion, state: "idle" };
      }
      try {
        const [projection] = await sql`
          SELECT immich_asset_id, input_revision
          FROM immich_asset_projection
          WHERE cimmich_asset_id = ${row.asset_id}
            AND source_id = ${source}
            AND state = 'active'
            AND input_revision = ${row.input_revision}
          ORDER BY last_seen_at DESC, immich_asset_id
          LIMIT 1
        `;
        if (!projection) {
          throw Object.assign(
            new Error("Body source projection is unavailable"),
            {
              code: "IMMICH_ASSET_PROJECTION_UNAVAILABLE",
            },
          );
        }
        const media = await companion.readAssetImage({
          assetId: projection.immich_asset_id,
        });
        if (media.asset.inputRevision !== row.input_revision) {
          throw Object.assign(new Error("Body source revision changed"), {
            code: "ASSET_REVISION_CHANGED",
          });
        }
        const sourceBindingDigest = bodyDetectionDigest({
          assetId: row.asset_id,
          companionInputRevision: row.input_revision,
          schemaVersion: "cimmich.body-detection-companion-binding.v1",
          sourceAssetId: projection.immich_asset_id,
        });
        const preparedRead = await sourceRepository.prepare({
          assetId: row.asset_id,
          sourceAccess: "immich_api_read_only",
          sourceBindingDigest,
        });
        const sourceRead = completeAssetSourceRead({
          bytes: media.bytes,
          prepared: preparedRead,
        });
        const prepared = prepareLocalBodyDetectionJobFromSourceRead({
          manifest,
          sourceRead,
        });
        const detectorRequest = {
          assetToken: prepared.assetToken,
          bytes: media.bytes,
          inputRevision: prepared.inputRevision,
          sourceContentDigest: prepared.sourceContentDigest,
          timeoutMs,
        };
        const first = await detector.detect(detectorRequest);
        const second = await detector.detect(detectorRequest);
        const validation = assembleLocalBodyDetectionResult({
          prepared,
          runs: [
            {
              result: first,
              runId: `body-run-${bodyDetectionDigest({
                jobId: row.job_id,
                ordinal: 1,
              }).slice(0, 32)}`,
            },
            {
              result: second,
              runId: `body-run-${bodyDetectionDigest({
                jobId: row.job_id,
                ordinal: 2,
              }).slice(0, 32)}`,
            },
          ],
          sourceContentDigest: prepared.sourceContentDigest,
        });
        const commit = await resultRepository.commit({
          assetId: row.asset_id,
          sourceRead,
          validation,
        });
        const receiptId = `receipt_body_detection_intake_${commit.resultDigest.slice(0, 32)}`;
        await sql.begin(async (transaction) => {
          await transaction`
            INSERT INTO media_job_body_detection_result (
              job_id, detection_result_id
            ) VALUES (${row.job_id}, ${commit.detectionResultId})
            ON CONFLICT (job_id) DO NOTHING
          `;
          const [binding] = await transaction`
            SELECT detection_result_id
            FROM media_job_body_detection_result
            WHERE job_id = ${row.job_id}
          `;
          if (binding?.detection_result_id !== commit.detectionResultId) {
            throw Object.assign(
              new Error("Body media job is bound to another result"),
              { code: "BODY_DETECTION_RESULT_CONFLICT" },
            );
          }
          const txLedger = createMediaJobLedger(transaction);
          await txLedger.checkpoint({
            jobId: row.job_id,
            payload: {
              bodyCount: commit.bodyCount,
              detectionResultId: commit.detectionResultId,
              outcome: commit.state,
            },
            stage: "observations_recorded",
            workerId: worker,
          });
          await txLedger.complete({
            jobId: row.job_id,
            resultDigest: commit.resultDigest,
            resultReceiptId: receiptId,
            workerId: worker,
          });
        });
        return {
          bodyCount: commit.bodyCount,
          automaticIdentityWrites: 0,
          matcherInvocations: 0,
          outcome: commit.state,
          providerRuns: 2,
          schemaVersion: bodyDetectionBacklogVersion,
          state: "completed",
          status: "completed",
        };
      } catch (error) {
        const failed = await ledger.fail({
          errorCode: publicErrorCode(error),
          jobId: row.job_id,
          workerId: worker,
        });
        return {
          errorCode: publicErrorCode(error),
          schemaVersion: bodyDetectionBacklogVersion,
          state: failed.state === "failed" ? "failed" : "retry_pending",
        };
      }
    },
  });
};

export const runBodyDetectionBacklog = async ({
  ensureJobs,
  limitJobs,
  onProgress = () => {},
  timeoutMs = 120_000,
  workers,
} = {}) => {
  if (typeof ensureJobs !== "function") {
    throw new Error("Body detection backlog requires a job scheduler");
  }
  if (!Array.isArray(workers) || workers.length < 1 || workers.length > 8) {
    throw new Error("Body detection backlog requires from 1 to 8 workers");
  }
  const limit = boundedInteger(limitJobs, "job limit", 1, 1_000_000);
  const summary = {
    attempts: 0,
    bodiesDetected: 0,
    completed: 0,
    failed: 0,
    imagesWithBodies: 0,
    noBody: 0,
    providerProcesses: workers.length,
    retryPending: 0,
    scheduled: 0,
    schemaVersion: bodyDetectionBacklogVersion,
    sourceMediaWrite: "none",
    sourceUnreadable: 0,
  };
  try {
    let remaining = limit;
    while (remaining > 0) {
      const result = await ensureJobs({ limit: Math.min(10_000, remaining) });
      const ensured = Number(result?.ensuredJobs || 0);
      if (!Number.isInteger(ensured) || ensured < 0 || ensured > remaining) {
        throw new Error("Body detection scheduler returned invalid work");
      }
      summary.scheduled += ensured;
      remaining -= ensured;
      if (ensured === 0) break;
    }
    let issued = 0;
    const runWorker = async (worker) => {
      while (issued < limit) {
        issued += 1;
        const result = await worker.runNext({ timeoutMs });
        if (result.state === "idle" || result.state === "paused") return;
        summary.attempts += 1;
        if (result.state === "completed") {
          summary.completed += 1;
          summary.bodiesDetected += Number(result.bodyCount || 0);
          if (result.outcome === "bodies_detected") {
            summary.imagesWithBodies += 1;
          } else if (result.outcome === "no_body") {
            summary.noBody += 1;
          } else if (result.outcome === "source_unreadable") {
            summary.sourceUnreadable += 1;
          }
        } else if (result.state === "failed") {
          summary.failed += 1;
        } else {
          summary.retryPending += 1;
        }
        await onProgress({ ...summary });
      }
    };
    await Promise.all(workers.map(runWorker));
    return {
      ...summary,
      state:
        summary.failed > 0
          ? "bounded_run_complete_with_failures"
          : summary.retryPending > 0
            ? "bounded_run_complete_with_retries"
            : "bounded_run_complete",
    };
  } finally {
    await Promise.allSettled(workers.map((worker) => worker.close()));
  }
};
