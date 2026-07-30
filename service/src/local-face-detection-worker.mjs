import { commitFaceDetectionJobResult } from "./face-detection-job-commit.mjs";
import {
  faceDetectionResultSchemaVersion,
  validateFaceDetectorManifest,
} from "./face-detector-contract.mjs";
import { createMediaJobLedger } from "./media-job-ledger.mjs";

export const localFaceDetectionWorkerVersion =
  "cimmich.local-face-detection-worker.v1";

const publicErrorCode = (error) => {
  const upstream = String(error?.code || "");
  if (/^[A-Z][A-Z0-9_]{2,79}$/.test(upstream)) return upstream;
  if (/input revision/i.test(error?.message || ""))
    return "ASSET_REVISION_CHANGED";
  if (/conflict/i.test(error?.message || ""))
    return "DETECTION_RESULT_CONFLICT";
  if (
    /schema|result|observation|coordinate|confidence/i.test(
      error?.message || "",
    )
  ) {
    return "DETECTOR_OUTPUT_INVALID";
  }
  return "LOCAL_FACE_DETECTION_FAILED";
};

const projectClaim = (row) => ({
  assetId: row.asset_id,
  configDigest: row.config_digest,
  inputRevision: row.input_revision,
  jobId: row.job_id,
  operation: row.operation,
  state: row.state,
});

const claimProviderJob = async (
  sql,
  { configDigest, expectedJobId = "", leaseSeconds = 300, workerId },
) =>
  sql.begin(async (transaction) => {
    await transaction`
      WITH expired AS (
        UPDATE media_job
        SET state = CASE
              WHEN attempt_count >= max_attempts THEN 'failed'
              ELSE 'pending'
            END,
            lease_owner = NULL,
            lease_expires_at = NULL,
            completed_at = CASE
              WHEN attempt_count >= max_attempts THEN now()
              ELSE NULL
            END,
            last_error_code = 'WORKER_LEASE_EXPIRED'
        WHERE operation = 'detect_faces'
          AND config_digest = ${configDigest}
          AND state = 'processing'
          AND lease_expires_at < now()
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
        attempt_count,
        checkpoint_revision,
        jsonb_build_object('errorCode', 'WORKER_LEASE_EXPIRED')
      FROM expired
    `;
    const claim = expectedJobId
      ? await transaction`
        WITH claimable AS (
          SELECT job.job_id
          FROM media_job job
          WHERE job.job_id = ${expectedJobId}
            AND job.state = 'pending'
            AND job.operation = 'detect_faces'
            AND job.config_digest = ${configDigest}
          FOR UPDATE OF job SKIP LOCKED
        ), claimed AS (
          UPDATE media_job job
          SET state = 'processing',
              attempt_count = job.attempt_count + 1,
              started_at = coalesce(job.started_at, now()),
              lease_owner = ${workerId}::text,
              lease_expires_at = now() + (${leaseSeconds} * interval '1 second'),
              last_error_code = NULL
          FROM claimable
          WHERE job.job_id = claimable.job_id
          RETURNING job.*
        ), events AS (
          INSERT INTO media_job_event (
            event_id, job_id, event_kind, attempt_count, checkpoint_revision,
            public_details
          )
          SELECT
            'media_job_event_' || replace(gen_random_uuid()::text, '-', ''),
            job_id,
            'leased',
            attempt_count,
            checkpoint_revision,
            jsonb_build_object('workerId', ${workerId}::text)
          FROM claimed
        )
        SELECT claimed.* FROM claimed
      `
      : await transaction`
        WITH claimable AS (
        SELECT job.job_id
        FROM media_job job
        WHERE job.state = 'pending'
          AND job.operation = 'detect_faces'
          AND job.config_digest = ${configDigest}
        ORDER BY job.requested_at, job.job_id
        FOR UPDATE OF job SKIP LOCKED
        LIMIT 1
      ), claimed AS (
        UPDATE media_job job
        SET state = 'processing',
            attempt_count = job.attempt_count + 1,
            started_at = coalesce(job.started_at, now()),
            lease_owner = ${workerId}::text,
            lease_expires_at = now() + (${leaseSeconds} * interval '1 second'),
            last_error_code = NULL
        FROM claimable
        WHERE job.job_id = claimable.job_id
        RETURNING job.*
      ), events AS (
        INSERT INTO media_job_event (
          event_id, job_id, event_kind, attempt_count, checkpoint_revision,
          public_details
        )
        SELECT
          'media_job_event_' || replace(gen_random_uuid()::text, '-', ''),
          job_id,
          'leased',
          attempt_count,
          checkpoint_revision,
          jsonb_build_object('workerId', ${workerId}::text)
        FROM claimed
      )
      SELECT claimed.* FROM claimed
    `;
    return claim[0] || null;
  });

export const createLocalFaceDetectionWorker = ({
  companion,
  detector,
  manifest: manifestInput,
  sql,
  workerId = "cimmich-local-face-detector",
} = {}) => {
  if (!sql)
    throw new Error("Local face detection worker requires a Cimmich database");
  if (!companion || typeof companion.readAssetImage !== "function") {
    throw new Error(
      "Local face detection worker requires an Immich media reader",
    );
  }
  if (!detector || typeof detector.detect !== "function") {
    throw new Error("Local face detection worker requires a detector adapter");
  }
  const manifest = validateFaceDetectorManifest(manifestInput);
  const normalizedWorkerId = String(workerId || "").trim();
  if (!normalizedWorkerId)
    throw new Error("Local face detection worker requires workerId");
  const ledger = createMediaJobLedger(sql);

  return {
    async runNext({ expectedJobId, priorityTierMax = 2, timeoutMs } = {}) {
      if (
        !Number.isInteger(priorityTierMax) ||
        priorityTierMax < 0 ||
        priorityTierMax > 2
      ) {
        throw new Error(
          "Local face detection priorityTierMax must be from 0 to 2",
        );
      }
      const startedAt = performance.now();
      const [control] = await sql`
        SELECT state FROM media_operator_control WHERE control_id = 'primary'
      `;
      if (control?.state === "paused") {
        return {
          schemaVersion: localFaceDetectionWorkerVersion,
          state: "paused",
        };
      }
      const controlCheckedAt = performance.now();
      // One provider run may take the full configured timeout. Derive the
      // lease from that worst-case wall time plus read/commit headroom so an
      // in-flight job cannot lose its lease and be re-run by another worker.
      const boundedTimeoutMs =
        Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
          ? Number(timeoutMs)
          : 120_000;
      const claimed = await claimProviderJob(sql, {
        configDigest: manifest.detectorConfigDigest,
        expectedJobId: String(expectedJobId || "").trim(),
        leaseSeconds: Math.max(
          300,
          Math.ceil((boundedTimeoutMs + 60_000) / 1000),
        ),
        workerId: normalizedWorkerId,
      });
      if (!claimed) {
        return {
          schemaVersion: localFaceDetectionWorkerVersion,
          state: "idle",
        };
      }
      const claimedAt = performance.now();
      const job = projectClaim(claimed);
      try {
        const [projection] = await sql`
          SELECT immich_asset_id, input_revision, state
          FROM immich_asset_projection
          WHERE cimmich_asset_id = ${job.assetId}
            AND input_revision = ${job.inputRevision}
          ORDER BY (state = 'active') DESC, last_seen_at DESC, immich_asset_id
          LIMIT 1
        `;
        if (!projection || projection.state !== "active") {
          throw Object.assign(
            new Error("Asset has no active Immich projection"),
            {
              code: "IMMICH_ASSET_PROJECTION_UNAVAILABLE",
            },
          );
        }
        if (projection.input_revision !== job.inputRevision) {
          throw Object.assign(
            new Error("Asset input revision changed before media read"),
            {
              code: "ASSET_REVISION_CHANGED",
            },
          );
        }
        const projectionLoadedAt = performance.now();
        const media = await companion.readAssetImage({
          assetId: projection.immich_asset_id,
        });
        if (media.asset.inputRevision !== job.inputRevision) {
          throw Object.assign(
            new Error("Asset input revision changed during media read"),
            {
              code: "ASSET_REVISION_CHANGED",
            },
          );
        }
        const mediaReadAt = performance.now();
        await ledger.checkpoint({
          jobId: job.jobId,
          payload: {
            byteLength: media.byteLength,
            sourceAccess: media.sourceAccess,
            sourceContentDigest: media.contentDigest,
          },
          stage: "inventory_verified",
          workerId: normalizedWorkerId,
        });
        const inventoryCheckpointedAt = performance.now();
        const detected = await detector.detect({
          asset: media.asset,
          bytes: media.bytes,
          mimeType: media.mimeType,
          timeoutMs,
        });
        const detectedAt = performance.now();
        const result = {
          assetId: job.assetId,
          detectorConfigDigest: manifest.detectorConfigDigest,
          faces: detected?.faces || [],
          inputRevision: job.inputRevision,
          schemaVersion: faceDetectionResultSchemaVersion,
          sourceContentDigest: media.contentDigest,
          state: detected?.state,
        };
        const committed = await commitFaceDetectionJobResult(sql, {
          jobId: job.jobId,
          manifest,
          result,
          workerId: normalizedWorkerId,
        });
        const committedAt = performance.now();
        const seconds = (left, right) =>
          Number(((right - left) / 1000).toFixed(3));
        return {
          ...committed,
          jobId: job.jobId,
          schemaVersion: localFaceDetectionWorkerVersion,
          timings: {
            claimSeconds: seconds(controlCheckedAt, claimedAt),
            commitSeconds: seconds(detectedAt, committedAt),
            controlSeconds: seconds(startedAt, controlCheckedAt),
            detectSeconds: seconds(inventoryCheckpointedAt, detectedAt),
            inventoryCheckpointSeconds: seconds(
              mediaReadAt,
              inventoryCheckpointedAt,
            ),
            mediaReadSeconds: seconds(projectionLoadedAt, mediaReadAt),
            projectionSeconds: seconds(claimedAt, projectionLoadedAt),
            totalSeconds: seconds(startedAt, committedAt),
          },
        };
      } catch (error) {
        const errorCode = publicErrorCode(error);
        let failed;
        try {
          failed = await ledger.fail({
            errorCode,
            jobId: job.jobId,
            workerId: normalizedWorkerId,
          });
        } catch (failError) {
          // A parallel expired-lease sweep can reclaim the job between the
          // failure and this report (SQLSTATE 55000). The retry is already
          // in flight elsewhere; rethrowing killed this worker loop.
          if (failError?.code !== "55000") throw failError;
          failed = { state: "pending" };
        }
        return {
          errorCode,
          jobId: job.jobId,
          schemaVersion: localFaceDetectionWorkerVersion,
          state: failed.state,
        };
      }
    },
  };
};
