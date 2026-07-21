import { createHash } from "node:crypto";
import { commitRecognitionJobResult } from "./recognition-job-commit.mjs";
import { createMediaJobLedger } from "./media-job-ledger.mjs";
import {
  mergeRecognitionCheckpoint,
  validateRecognitionProviderManifest,
} from "./recognition-provider-contract.mjs";

export const localFaceRecognitionWorkerVersion =
  "cimmich.local-face-recognition-worker.v1";

const publicErrorCode = (error) => {
  const upstream = String(error?.code || "");
  if (/^[A-Z][A-Z0-9_]{2,79}$/.test(upstream)) return upstream;
  if (/content digest/i.test(error?.message || ""))
    return "SOURCE_CONTENT_CHANGED";
  if (/input revision/i.test(error?.message || ""))
    return "ASSET_REVISION_CHANGED";
  if (
    /checkpoint|packet|observation|vector|face set/i.test(error?.message || "")
  ) {
    return "RECOGNIZER_OUTPUT_INVALID";
  }
  return "LOCAL_FACE_RECOGNITION_FAILED";
};

export const createLocalFaceRecognitionWorker = ({
  companion,
  manifest: manifestInput,
  recognizer,
  sql,
  workerId = "cimmich-local-face-recognizer",
} = {}) => {
  if (!sql)
    throw new Error(
      "Local face recognition worker requires a Cimmich database",
    );
  if (!companion || typeof companion.readAssetImage !== "function") {
    throw new Error(
      "Local face recognition worker requires an Immich media reader",
    );
  }
  if (!recognizer || typeof recognizer.recognize !== "function") {
    throw new Error(
      "Local face recognition worker requires a recognizer adapter",
    );
  }
  const manifest = validateRecognitionProviderManifest(manifestInput);
  const normalizedWorkerId = String(workerId || "").trim();
  if (!normalizedWorkerId)
    throw new Error("Local face recognition worker requires workerId");
  const ledger = createMediaJobLedger(sql);

  return {
    async runNext({ timeoutMs } = {}) {
      const [control] = await sql`
        SELECT state FROM media_operator_control WHERE control_id = 'primary'
      `;
      if (control?.state === "paused") {
        return {
          schemaVersion: localFaceRecognitionWorkerVersion,
          state: "paused",
        };
      }
      const rows = await sql`
        SELECT * FROM claim_face_recognition_jobs(${normalizedWorkerId}, 300, 1)
      `;
      if (!rows.length) {
        return {
          schemaVersion: localFaceRecognitionWorkerVersion,
          state: "idle",
        };
      }
      const job = rows[0];
      try {
        const [pipeline] = await sql`
          SELECT pipeline.*, result.source_content_digest,
            projection.immich_asset_id, projection.state AS projection_state,
            projection.input_revision AS projection_input_revision
          FROM media_pipeline_run pipeline
          JOIN face_detection_result result
            ON result.detection_result_id = pipeline.detection_result_id
          JOIN immich_asset_projection projection
            ON projection.cimmich_asset_id = pipeline.asset_id
            AND projection.state = 'active'
          WHERE pipeline.recognition_job_id = ${job.job_id}
          ORDER BY projection.last_seen_at DESC
          LIMIT 1
        `;
        if (!pipeline || pipeline.state !== "recognition_pending") {
          throw Object.assign(
            new Error("Recognition pipeline projection is unavailable"),
            {
              code: "RECOGNITION_PIPELINE_UNAVAILABLE",
            },
          );
        }
        if (
          pipeline.input_revision !== job.input_revision ||
          pipeline.projection_input_revision !== job.input_revision
        ) {
          throw Object.assign(
            new Error("Asset input revision changed before recognition"),
            {
              code: "ASSET_REVISION_CHANGED",
            },
          );
        }
        const observations = await sql`
          SELECT face.face_id, face.box_x, face.box_y, face.box_w, face.box_h
          FROM face_detection_result_observation result_observation
          JOIN face_observation face ON face.face_id = result_observation.face_id
          WHERE result_observation.detection_result_id = ${pipeline.detection_result_id}
          ORDER BY result_observation.observation_order
        `;
        const media = await companion.readAssetImage({
          assetId: pipeline.immich_asset_id,
        });
        if (media.asset.inputRevision !== job.input_revision) {
          throw Object.assign(
            new Error("Asset input revision changed during recognition read"),
            {
              code: "ASSET_REVISION_CHANGED",
            },
          );
        }
        const contentDigest =
          media.contentDigest ||
          createHash("sha256").update(media.bytes).digest("hex");
        if (contentDigest !== pipeline.source_content_digest) {
          throw Object.assign(
            new Error("Source content digest changed after detection"),
            {
              code: "SOURCE_CONTENT_CHANGED",
            },
          );
        }
        await ledger.checkpoint({
          jobId: job.job_id,
          payload: {
            detectionResultId: pipeline.detection_result_id,
            faceCount: observations.length,
            sourceContentDigest: contentDigest,
          },
          stage: "inventory_verified",
          workerId: normalizedWorkerId,
        });
        const packets = await recognizer.recognize({
          assetId: job.asset_id,
          bytes: media.bytes,
          manifest,
          mimeType: media.mimeType,
          observations: observations.map((face) => ({
            observationId: face.face_id,
            targetBox: {
              coordinateSpace: "normalized",
              h: Number(face.box_h),
              w: Number(face.box_w),
              x: Number(face.box_x),
              y: Number(face.box_y),
            },
          })),
          timeoutMs,
        });
        const { checkpoint } = mergeRecognitionCheckpoint(
          manifest,
          packets || [],
        );
        const committed = await commitRecognitionJobResult(sql, {
          checkpoint,
          jobId: job.job_id,
          manifest,
          workerId: normalizedWorkerId,
        });
        return {
          ...committed,
          jobId: job.job_id,
          schemaVersion: localFaceRecognitionWorkerVersion,
        };
      } catch (error) {
        const errorCode = publicErrorCode(error);
        const failed = await ledger.fail({
          errorCode,
          jobId: job.job_id,
          workerId: normalizedWorkerId,
        });
        if (failed.state === "failed") {
          await sql`
            UPDATE media_pipeline_run
            SET state = 'recognition_failed'
            WHERE recognition_job_id = ${job.job_id}
              AND state = 'recognition_pending'
          `;
        }
        return {
          errorCode,
          jobId: job.job_id,
          schemaVersion: localFaceRecognitionWorkerVersion,
          state: failed.state,
        };
      }
    },
  };
};
