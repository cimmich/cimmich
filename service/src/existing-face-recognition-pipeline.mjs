import {
  commitValidatedAssetSourceRead,
  consumeValidatedAssetSourceRead,
} from "./asset-source-revision.mjs";
import { createMediaJobLedger } from "./media-job-ledger.mjs";
import {
  mediaPipelineDigest,
  mediaPipelineRunIdentity,
} from "./media-pipeline-contract.mjs";
import { validateRecognitionProviderManifest } from "./recognition-provider-contract.mjs";

export const existingFaceRecognitionPipelineVersion =
  "cimmich.existing-face-recognition-pipeline.v1";

const error = (code, message, statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode });

const normalizeFaceIds = (value) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    throw error(
      "EXISTING_FACE_PIPELINE_INPUT_INVALID",
      "Existing recognition requires 1 to 32 Face observations",
    );
  }
  const ids = value.map((faceId) => String(faceId || "").trim());
  if (
    ids.some(
      (faceId) =>
        !faceId || faceId.length > 192 || /[\u0000-\u001f\u007f]/.test(faceId),
    ) ||
    new Set(ids).size !== ids.length
  ) {
    throw error(
      "EXISTING_FACE_PIPELINE_INPUT_INVALID",
      "Existing recognition Face identifiers are invalid",
    );
  }
  return ids.sort();
};

const project = (row) => ({
  activationAuthority: "none",
  assetId: row.asset_id,
  automaticIdentityAuthority: "none",
  inputRevision: row.input_revision,
  observationSetDigest: row.observation_set_digest,
  pipelineRunId: row.pipeline_run_id,
  providerConfigDigest: row.recognizer_provider_config_digest,
  recognitionJobId: row.recognition_job_id,
  recognitionSpaceConfigDigest: row.recognizer_config_digest,
  replayEvidence: row.state === "recognized" ? "consistent" : "pending",
  schemaVersion: existingFaceRecognitionPipelineVersion,
  sourceAccess: row.source_access || "immich_api_read_only",
  sourceRevisionId: row.source_revision_id,
  state: row.state,
  trainingAuthority: "none",
  vectorSpaceId: row.vector_space_id,
});

const canonicalFace = (row, observationOrder) => ({
  box: {
    h: Number(row.box_h),
    w: Number(row.box_w),
    x: Number(row.box_x),
    y: Number(row.box_y),
  },
  faceId: row.face_id,
  observationOrder,
  observationOrigin: row.observation_origin,
});

export const existingFaceObservationSetDigest = (rows) => {
  if (!Array.isArray(rows) || !rows.length || rows.length > 32) {
    throw error(
      "EXISTING_FACE_PIPELINE_STALE",
      "Existing recognition observation set is invalid",
      409,
    );
  }
  const canonical = rows.map((row, index) => {
    const observationOrder = Number(
      row.observation_order == null ? index : row.observation_order,
    );
    const geometry = [row.box_x, row.box_y, row.box_w, row.box_h].map(Number);
    if (
      !Number.isSafeInteger(observationOrder) ||
      observationOrder !== index ||
      !row.face_id ||
      !row.observation_origin ||
      geometry.some((value) => !Number.isFinite(value))
    ) {
      throw error(
        "EXISTING_FACE_PIPELINE_STALE",
        "Existing recognition observation set changed",
        409,
      );
    }
    return canonicalFace(row, observationOrder);
  });
  if (new Set(canonical.map((row) => row.faceId)).size !== canonical.length) {
    throw error(
      "EXISTING_FACE_PIPELINE_STALE",
      "Existing recognition observation set is duplicated",
      409,
    );
  }
  return mediaPipelineDigest(canonical);
};

export const enqueueExistingFaceRecognitionPipeline = async (
  sql,
  {
    faceIds: faceIdsInput,
    manifest: manifestInput,
    maxAttempts = 3,
    presentationRank,
    sourceRead,
  },
) => {
  if (typeof sql !== "function" || typeof presentationRank !== "function") {
    throw new TypeError(
      "Existing recognition pipeline requires SQL and visibility rank",
    );
  }
  const faceIds = normalizeFaceIds(faceIdsInput);
  const manifest = validateRecognitionProviderManifest(manifestInput);
  const source = consumeValidatedAssetSourceRead(sourceRead);
  if (
    source.sourceAccess !== "immich_api_read_only" &&
    source.sourceAccess !== "operator_local_read_only"
  ) {
    throw error(
      "EXISTING_FACE_PIPELINE_SOURCE_INVALID",
      "Existing observation recognition requires an exact validated source read",
    );
  }
  const visibleRank = presentationRank();
  if (
    !Number.isSafeInteger(visibleRank) ||
    visibleRank < 0 ||
    visibleRank > 2
  ) {
    throw error(
      "EXISTING_FACE_PIPELINE_INPUT_INVALID",
      "Existing recognition visibility rank is invalid",
    );
  }

  return sql.begin(async (tx) => {
    const committedSource = await commitValidatedAssetSourceRead(tx, {
      presentationRank,
      sourceRead,
    });
    const rows = await tx`
      SELECT face_id, asset_id, box_x, box_y, box_w, box_h,
        observation_origin
      FROM face_observation
      WHERE face_id = ANY(${faceIds}) AND state = 'valid'
        AND asset_id = ${committedSource.assetId}
        AND cimmich_visibility_asset_rank(asset_id) <= ${visibleRank}
      ORDER BY face_id
      FOR SHARE
    `;
    if (
      rows.length !== faceIds.length ||
      rows.some((row, index) => row.face_id !== faceIds[index])
    ) {
      throw error(
        "EXISTING_FACE_PIPELINE_STALE",
        "Existing recognition observations are not current and visible",
        409,
      );
    }
    const observationSetDigest = existingFaceObservationSetDigest(rows);
    const pipelineConfigDigest = mediaPipelineDigest({
      observationSetDigest,
      providerConfigDigest: manifest.providerConfigDigest,
      recognitionSpaceConfigDigest: manifest.recognitionSpaceConfigDigest,
      runKind: "existing_observation_set",
      schemaVersion: existingFaceRecognitionPipelineVersion,
      vectorSpaceId: manifest.vectorSpaceId,
    });
    const identity = mediaPipelineRunIdentity({
      assetId: committedSource.assetId,
      inputRevision: committedSource.inputRevision,
      pipelineConfigDigest,
    });
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${identity.workKey}, 0))`;
    const existing = await tx`
      SELECT pipeline.*, revision.source_access
      FROM media_pipeline_run pipeline
      JOIN asset_source_revision revision
        ON revision.revision_id = pipeline.source_revision_id
      WHERE pipeline.work_key = ${identity.workKey}
      FOR UPDATE
    `;
    if (existing.length) {
      const mapped = await tx`
        SELECT face_id FROM media_pipeline_run_observation
        WHERE pipeline_run_id = ${identity.pipelineRunId}
        ORDER BY face_id
      `;
      if (
        existing.length !== 1 ||
        existing[0].run_kind !== "existing_observation_set" ||
        existing[0].observation_set_digest !== observationSetDigest ||
        existing[0].source_revision_id !== committedSource.revisionId ||
        mapped.length !== faceIds.length ||
        mapped.some((row, index) => row.face_id !== faceIds[index])
      ) {
        throw error(
          "EXISTING_FACE_PIPELINE_CONFLICT",
          "Existing recognition replay conflicts with prior provenance",
          409,
        );
      }
      return project(existing[0]);
    }

    const ledger = createMediaJobLedger(tx);
    const recognitionJob = await ledger.enqueue({
      assetId: committedSource.assetId,
      configDigest: manifest.providerConfigDigest,
      inputRevision: committedSource.inputRevision,
      maxAttempts,
      operation: "recognize_existing_faces",
      toolVersion: `${existingFaceRecognitionPipelineVersion}:${observationSetDigest}`,
    });
    const [created] = await tx`
      INSERT INTO media_pipeline_run (
        pipeline_run_id, work_key, asset_id, input_revision,
        pipeline_config_digest, detector_config_digest,
        recognizer_config_digest, recognizer_provider_config_digest,
        vector_space_id, detection_job_id, detection_result_id,
        recognition_job_id, state, run_kind, source_revision_id,
        source_content_digest, observation_set_digest
      ) VALUES (
        ${identity.pipelineRunId}, ${identity.workKey}, ${committedSource.assetId},
        ${committedSource.inputRevision}, ${pipelineConfigDigest}, NULL,
        ${manifest.recognitionSpaceConfigDigest}, ${manifest.providerConfigDigest},
        ${manifest.vectorSpaceId}, NULL, NULL, ${recognitionJob.jobId},
        'recognition_pending', 'existing_observation_set',
        ${committedSource.revisionId}, ${committedSource.sourceContentDigest},
        ${observationSetDigest}
      )
      RETURNING *
    `;
    for (const [index, faceId] of faceIds.entries()) {
      await tx`
        INSERT INTO media_pipeline_run_observation (
          pipeline_run_id, face_id, observation_order
        ) VALUES (${identity.pipelineRunId}, ${faceId}, ${index})
      `;
    }
    return project({ ...created, source_access: committedSource.sourceAccess });
  });
};
