import { createMediaJobLedger } from "./media-job-ledger.mjs";
import {
  mediaPipelineRunIdentity,
  validateMediaPipelineManifest,
} from "./media-pipeline-contract.mjs";
import { validateRecognitionProviderManifest } from "./recognition-provider-contract.mjs";

export const mediaPipelineRunSchemaVersion = "cimmich.media-pipeline-run.v1";

const requiredText = (value, label) => {
  const normalized = String(value || "").trim();
  if (!normalized)
    throw new Error(`Media pipeline continuation requires ${label}`);
  return normalized;
};

const projectRun = (row) => ({
  activationAuthority: "none",
  assetId: row.asset_id,
  detectionJobId: row.detection_job_id,
  detectionResultId: row.detection_result_id,
  inputRevision: row.input_revision,
  pipelineConfigDigest: row.pipeline_config_digest,
  pipelineRunId: row.pipeline_run_id,
  recognitionJobId: row.recognition_job_id || null,
  schemaVersion: mediaPipelineRunSchemaVersion,
  state: row.state,
  vectorSpaceId: row.vector_space_id,
  workKey: row.work_key,
});

export const continueFaceDetectionPipeline = async (
  sql,
  {
    detectionJobId,
    detectorManifest,
    manifest: manifestInput,
    maxAttempts = 3,
    recognitionManifest,
  },
) => {
  const jobId = requiredText(detectionJobId, "detectionJobId");
  const manifest = validateMediaPipelineManifest(manifestInput, {
    detectorManifest,
    recognitionManifest,
  });
  const recognizer = validateRecognitionProviderManifest(recognitionManifest);
  return sql.begin(async (tx) => {
    const [detection] = await tx`
      SELECT job.*, link.detection_result_id, result.outcome,
        result.source_content_digest, result.face_count
      FROM media_job job
      JOIN media_job_detection_result link ON link.job_id = job.job_id
      JOIN face_detection_result result
        ON result.detection_result_id = link.detection_result_id
      WHERE job.job_id = ${jobId}
      FOR SHARE OF job, result
    `;
    if (
      !detection ||
      detection.operation !== "detect_faces" ||
      detection.state !== "completed"
    ) {
      throw new Error(
        "Media pipeline requires a completed dedicated detection job",
      );
    }
    if (detection.config_digest !== manifest.detector.configDigest) {
      throw new Error(
        "Media pipeline detection result uses another detector configuration",
      );
    }
    const identity = mediaPipelineRunIdentity({
      assetId: detection.asset_id,
      inputRevision: detection.input_revision,
      pipelineConfigDigest: manifest.pipelineConfigDigest,
    });
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${identity.workKey}, 0))`;
    const [existing] = await tx`
      SELECT * FROM media_pipeline_run WHERE work_key = ${identity.workKey} FOR UPDATE
    `;
    if (existing) {
      if (
        existing.detection_job_id !== jobId ||
        existing.detection_result_id !== detection.detection_result_id
      ) {
        throw new Error(
          "Media pipeline run is already bound to another detection result",
        );
      }
      return projectRun(existing);
    }

    let recognitionJob = null;
    if (detection.outcome === "faces_detected") {
      const ledger = createMediaJobLedger(tx);
      recognitionJob = await ledger.enqueue({
        assetId: detection.asset_id,
        configDigest: manifest.recognizer.configDigest,
        inputRevision: detection.input_revision,
        maxAttempts,
        operation: "recognize_faces",
        toolVersion: manifest.recognizer.toolVersion,
      });
    }
    const state =
      detection.outcome === "no_face" ? "no_face" : "recognition_pending";
    const [created] = await tx`
      INSERT INTO media_pipeline_run (
        pipeline_run_id, work_key, asset_id, input_revision,
        pipeline_config_digest, detector_config_digest,
        recognizer_config_digest, recognizer_provider_config_digest,
        vector_space_id, detection_job_id, detection_result_id,
        recognition_job_id, state, source_content_digest
      ) VALUES (
        ${identity.pipelineRunId}, ${identity.workKey}, ${detection.asset_id},
        ${detection.input_revision}, ${manifest.pipelineConfigDigest},
        ${manifest.detector.configDigest},
        ${recognizer.recognitionSpaceConfigDigest},
        ${recognizer.providerConfigDigest},
        ${manifest.recognizer.vectorSpaceId}, ${jobId},
        ${detection.detection_result_id}, ${recognitionJob?.jobId || null},
        ${state}, ${detection.source_content_digest}
      )
      RETURNING *
    `;
    return projectRun(created);
  });
};
