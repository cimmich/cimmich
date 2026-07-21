import { createHash } from "node:crypto";
import { commitRecognitionJobResult } from "./recognition-job-commit.mjs";
import { createMediaJobLedger } from "./media-job-ledger.mjs";
import { existingFaceObservationSetDigest } from "./existing-face-recognition-pipeline.mjs";
import {
  mergeRecognitionCheckpoint,
  recognitionDigest,
  validateRecognitionProviderManifest,
} from "./recognition-provider-contract.mjs";

export const localExistingFaceRecognitionWorkerVersion =
  "cimmich.local-existing-face-recognition-worker.v1";

const publicErrorCode = (error) => {
  const upstream = String(error?.code || "");
  if (/^[A-Z][A-Z0-9_]{2,79}$/.test(upstream)) return upstream;
  if (/content digest|source revision/i.test(error?.message || ""))
    return "SOURCE_REVISION_CHANGED";
  if (/replay|checkpoint|packet|observation|vector/i.test(error?.message || ""))
    return "RECOGNIZER_REPLAY_INVALID";
  return "LOCAL_EXISTING_FACE_RECOGNITION_FAILED";
};

const mediaAssetId = (media) =>
  media?.asset?.assetId || media?.asset?.immichAssetId || null;

const projectedSourceAccess = (value) =>
  value === "operator_local_read_only"
    ? "operator-local-read-only"
    : "immich-api-read-only";

export const createLocalExistingFaceRecognitionWorker = ({
  companion,
  manifest: manifestInput,
  recognizer,
  sql,
  workerId = "cimmich-local-existing-face-recognizer",
} = {}) => {
  if (!sql) {
    throw new Error(
      "Local existing Face recognition worker requires a Cimmich database",
    );
  }
  if (
    !companion ||
    typeof companion.readAssetImage !== "function" ||
    typeof companion.getAsset !== "function"
  ) {
    throw new Error(
      "Local existing Face recognition worker requires a current media reader",
    );
  }
  if (!recognizer || typeof recognizer.recognize !== "function") {
    throw new Error(
      "Local existing Face recognition worker requires a recognizer adapter",
    );
  }
  const manifest = validateRecognitionProviderManifest(manifestInput);
  const normalizedWorkerId = String(workerId || "").trim();
  if (!normalizedWorkerId) {
    throw new Error("Local existing recognition worker requires workerId");
  }
  const ledger = createMediaJobLedger(sql);

  return Object.freeze({
    async runNext({ timeoutMs } = {}) {
      const rows = await sql`
        SELECT * FROM claim_existing_face_recognition_jobs(
          ${normalizedWorkerId}, 300, 1
        )
      `;
      if (!rows.length) {
        return {
          schemaVersion: localExistingFaceRecognitionWorkerVersion,
          state: "idle",
        };
      }
      const job = rows[0];
      try {
        const [pipeline] = await sql`
          SELECT pipeline.*, revision.source_access,
            head.revision_id AS current_revision_id
          FROM media_pipeline_run pipeline
          JOIN asset_source_revision revision
            ON revision.revision_id = pipeline.source_revision_id
            AND revision.asset_id = pipeline.asset_id
            AND revision.input_revision = pipeline.input_revision
            AND revision.source_content_digest = pipeline.source_content_digest
          LEFT JOIN asset_source_revision_head head
            ON head.asset_id = revision.asset_id
            AND head.source_access = revision.source_access
            AND head.source_binding_digest = revision.source_binding_digest
          WHERE pipeline.recognition_job_id = ${job.job_id}
            AND pipeline.run_kind = 'existing_observation_set'
          LIMIT 1
        `;
        if (
          !pipeline ||
          pipeline.state !== "recognition_pending" ||
          pipeline.current_revision_id !== pipeline.source_revision_id ||
          pipeline.recognizer_provider_config_digest !==
            manifest.providerConfigDigest ||
          pipeline.recognizer_config_digest !==
            manifest.recognitionSpaceConfigDigest ||
          pipeline.vector_space_id !== manifest.vectorSpaceId ||
          job.config_digest !== manifest.providerConfigDigest
        ) {
          throw Object.assign(
            new Error("Existing recognition pipeline binding is unavailable"),
            { code: "EXISTING_RECOGNITION_PIPELINE_UNAVAILABLE" },
          );
        }
        const observations = await sql`
          SELECT face.face_id, face.box_x, face.box_y, face.box_w, face.box_h,
            face.observation_origin, observation.observation_order
          FROM media_pipeline_run_observation observation
          JOIN face_observation face ON face.face_id = observation.face_id
            AND face.asset_id = ${pipeline.asset_id}
            AND face.state = 'valid'
          WHERE observation.pipeline_run_id = ${pipeline.pipeline_run_id}
          ORDER BY observation.observation_order
        `;
        if (!observations.length) {
          throw Object.assign(
            new Error("Existing recognition observation set is empty"),
            { code: "EXISTING_RECOGNITION_OBSERVATIONS_STALE" },
          );
        }
        const currentObservationSetDigest =
          existingFaceObservationSetDigest(observations);
        if (currentObservationSetDigest !== pipeline.observation_set_digest) {
          throw Object.assign(
            new Error("Existing recognition observation geometry changed"),
            { code: "EXISTING_RECOGNITION_OBSERVATIONS_STALE" },
          );
        }
        const media = await companion.readAssetImage({
          assetId: pipeline.asset_id,
        });
        const contentDigest =
          media?.contentDigest ||
          (Buffer.isBuffer(media?.bytes)
            ? createHash("sha256").update(media.bytes).digest("hex")
            : null);
        if (
          !Buffer.isBuffer(media?.bytes) ||
          !media.bytes.length ||
          mediaAssetId(media) !== pipeline.asset_id ||
          media.asset?.inputRevision !== pipeline.input_revision ||
          media.sourceAccess !== projectedSourceAccess(pipeline.source_access) ||
          contentDigest !== pipeline.source_content_digest
        ) {
          throw Object.assign(
            new Error("Existing recognition source revision changed"),
            { code: "SOURCE_REVISION_CHANGED" },
          );
        }
        await ledger.checkpoint({
          jobId: job.job_id,
          payload: {
            observationCount: observations.length,
            observationSetDigest: currentObservationSetDigest,
            sourceContentDigest: contentDigest,
            sourceRevisionId: pipeline.source_revision_id,
          },
          stage: "inventory_verified",
          workerId: normalizedWorkerId,
        });
        const request = {
          assetId: job.asset_id,
          bytes: media.bytes,
          manifest,
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
        };
        const executions = [];
        for (const ordinal of [1, 2]) {
          const packets = await recognizer.recognize(request);
          const merged = mergeRecognitionCheckpoint(manifest, packets || []);
          executions.push({
            checkpoint: merged.checkpoint,
            checkpointDigest: merged.receipt.checkpointDigest,
            ordinal,
            resultDigest: merged.receipt.resultDigest,
          });
        }
        if (
          executions[0].resultDigest !== executions[1].resultDigest ||
          executions[0].checkpointDigest !== executions[1].checkpointDigest
        ) {
          throw Object.assign(
            new Error("Existing recognition provider replay diverged"),
            { code: "RECOGNIZER_REPLAY_DIVERGED" },
          );
        }
        const current = await companion.getAsset({
          assetId: pipeline.asset_id,
        });
        if (
          mediaAssetId(current) !== pipeline.asset_id ||
          current.asset?.inputRevision !== pipeline.input_revision
        ) {
          throw Object.assign(
            new Error("Existing recognition source changed after execution"),
            { code: "SOURCE_REVISION_CHANGED" },
          );
        }
        const providerRuns = executions.map((run) => ({
          checkpointDigest: run.checkpointDigest,
          ordinal: run.ordinal,
          resultDigest: run.resultDigest,
          runId: `provider_run_${recognitionDigest({
            ordinal: run.ordinal,
            pipelineRunId: pipeline.pipeline_run_id,
            resultDigest: run.resultDigest,
          }).slice(0, 40)}`,
        }));
        const committed = await commitRecognitionJobResult(sql, {
          checkpoint: executions[0].checkpoint,
          jobId: job.job_id,
          manifest,
          providerRuns,
          workerId: normalizedWorkerId,
        });
        return {
          ...committed,
          providerExecutions: 2,
          replayEvidence: "consistent",
          schemaVersion: localExistingFaceRecognitionWorkerVersion,
          sourceAccess: pipeline.source_access,
        };
      } catch (cause) {
        const errorCode = publicErrorCode(cause);
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
          schemaVersion: localExistingFaceRecognitionWorkerVersion,
          state: failed.state,
        };
      }
    },
  });
};
