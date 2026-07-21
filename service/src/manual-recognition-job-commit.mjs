import {
  createManualRecognitionIntakeReceipt,
  manualRecognitionDigest,
  projectValidatedManualRecognitionCommit,
} from "./manual-recognition-intake.mjs";
import { createMediaJobLedger } from "./media-job-ledger.mjs";

export const manualRecognitionJobCommitVersion =
  "cimmich.manual-recognition-job-commit.v1";

const requiredText = (value, label) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Manual recognition commit requires ${label}`);
  }
  return value.trim();
};

const commitIds = (projected) => ({
  embeddingId: `embedding_manual_${manualRecognitionDigest({
    configDigest: projected.manifest.providerConfigDigest,
    faceId: projected.faceId,
    vectorDigest: projected.vectorDigest,
  }).slice(0, 40)}`,
  evidenceId: `manualevidence_${projected.evidenceDigest.slice(0, 40)}`,
  qualityId: `manualquality_${manualRecognitionDigest({
    measurementDigest: projected.measurementDigest,
    policyDigest: projected.policyDigest,
    requestDigest: projected.requestDigest,
  }).slice(0, 40)}`,
  rebuildRequestId: `rebuild_manual_${projected.evidenceDigest.slice(0, 32)}`,
  requestId: `manualreq_${projected.requestDigest.slice(0, 40)}`,
  resultReceiptId: `receipt_manualrecognition_${projected.evidenceDigest.slice(0, 40)}`,
});

const responseFor = ({ ids, projected, replayed }) => ({
  activationAuthority: "none",
  automaticIdentityAuthority: "none",
  changed: !replayed,
  evidenceDigest: projected.evidenceDigest,
  evidenceId: ids.evidenceId,
  evidenceTier: projected.evidenceTier,
  identityStatus: "accepted",
  matchingStatus: "eligible_for_review",
  primeAuthority: "none",
  rebuildRequestId: ids.rebuildRequestId,
  replayEvidence: "consistent",
  replayed,
  requestDigest: projected.requestDigest,
  schemaVersion: manualRecognitionJobCommitVersion,
  trainingAuthority: "none",
});

export const prepareManualRecognitionCommit = (envelope) => {
  const projected = projectValidatedManualRecognitionCommit(envelope);
  return Object.freeze({
    ids: Object.freeze(commitIds(projected)),
    projected,
    receipt: createManualRecognitionIntakeReceipt(envelope),
  });
};

export const commitManualRecognitionJobResult = async (
  sql,
  { envelope, jobId, workerId },
) => {
  const prepared = prepareManualRecognitionCommit(envelope);
  const id = requiredText(jobId, "jobId");
  const worker = requiredText(workerId, "workerId");
  const { ids, projected } = prepared;
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${projected.operationId}, 0))`;
    const [existing] = await tx`
      SELECT evidence.evidence_id, evidence.evidence_digest,
        evidence.rebuild_request_id, request.request_digest
      FROM manual_face_recognition_evidence evidence
      JOIN manual_face_recognition_request request
        ON request.request_id = evidence.request_id
      WHERE evidence.evidence_id = ${ids.evidenceId}
      FOR UPDATE
    `;
    if (existing) {
      if (
        existing.evidence_digest !== projected.evidenceDigest ||
        existing.request_digest !== projected.requestDigest ||
        existing.rebuild_request_id !== ids.rebuildRequestId
      ) {
        throw new Error(
          "Manual recognition evidence conflicts with prior output",
        );
      }
      return responseFor({ ids, projected, replayed: true });
    }

    const [job] = await tx`
      SELECT * FROM media_job WHERE job_id = ${id} FOR UPDATE
    `;
    if (
      !job ||
      job.operation !== "recognize_manual_face" ||
      job.asset_id !== projected.assetId ||
      job.config_digest !== projected.manifest.providerConfigDigest ||
      job.input_revision !== projected.inputRevision
    ) {
      throw new Error("Manual recognition media job binding is invalid");
    }
    if (
      job.state !== "processing" ||
      job.lease_owner !== worker ||
      new Date(job.lease_expires_at) <= new Date()
    ) {
      throw new Error("Manual recognition media job lease is not current");
    }
    const [current] = await tx`
      SELECT operation.operation_id, operation.subject_id,
        operation.asset_id, operation.tag_id, operation.observation_id,
        face.box_x::float8 AS box_x, face.box_y::float8 AS box_y,
        face.box_w::float8 AS box_w, face.box_h::float8 AS box_h,
        projection.source_id, projection.immich_asset_id,
        projection.input_revision
      FROM manual_subject_tag_operation operation
      JOIN identity_claim claim ON claim.identity_claim_id = operation.tag_id
      JOIN face_observation face ON face.face_id = operation.observation_id
      JOIN immich_asset_projection projection
        ON projection.cimmich_asset_id = operation.asset_id
        AND projection.state = 'active'
      WHERE operation.operation_id = ${projected.operationId}
        AND operation.state = 'active' AND operation.tag_type = 'face'
        AND operation.tag_id = ${projected.identityClaimId}
        AND operation.observation_id = ${projected.faceId}
        AND operation.asset_id = ${projected.assetId}
        AND claim.face_id = face.face_id AND claim.state = 'accepted'
        AND claim.origin = 'user' AND face.state = 'valid'
        AND face.observation_origin = 'manual_user'
        AND projection.source_id = ${projected.projection.sourceId}
        AND projection.immich_asset_id = ${projected.projection.immichAssetId}
        AND projection.input_revision = ${projected.inputRevision}
      FOR UPDATE OF operation, claim, face, projection
    `;
    if (!current) {
      throw new Error(
        "Manual recognition operation or asset revision is stale",
      );
    }
    const persistedRegion = {
      h: Number(current.box_h),
      w: Number(current.box_w),
      x: Number(current.box_x),
      y: Number(current.box_y),
    };
    if (manualRecognitionDigest(persistedRegion) !== projected.regionDigest) {
      throw new Error(
        "Manual recognition region no longer matches its observation",
      );
    }

    await tx`
      INSERT INTO producer_receipt (
        producer_receipt_id, producer_kind, producer_name, producer_version,
        config_digest, started_at, completed_at, result_digest, privacy_class
      ) VALUES (
        ${ids.resultReceiptId}, 'model', 'cimmich-manual-recognition-intake',
        'v1', ${projected.manifest.providerConfigDigest}, now(), now(),
        ${projected.evidenceDigest}, 'sensitive-biometric'
      ) ON CONFLICT (producer_receipt_id) DO NOTHING
    `;
    const [persistedReceipt] = await tx`
      SELECT result_digest FROM producer_receipt
      WHERE producer_receipt_id = ${ids.resultReceiptId}
    `;
    if (persistedReceipt?.result_digest !== projected.evidenceDigest) {
      throw new Error("Manual recognition producer receipt conflicts");
    }

    await tx`
      INSERT INTO manual_face_recognition_request (
        request_id, request_digest, job_id, operation_id, identity_claim_id,
        face_id, asset_id, source_id, immich_asset_id, input_revision,
        region_digest, region, provider_id, model_family, model_version,
        provider_config_digest, vector_space_id, scope_key, producer_receipt_id
      ) VALUES (
        ${ids.requestId}, ${projected.requestDigest}, ${id},
        ${projected.operationId}, ${projected.identityClaimId}, ${projected.faceId},
        ${projected.assetId}, ${projected.projection.sourceId},
        ${projected.projection.immichAssetId}, ${projected.inputRevision},
        ${projected.regionDigest}, ${tx.json(projected.region)},
        ${projected.manifest.provider.name}, ${projected.manifest.recognizer.model},
        ${projected.manifest.recognizer.modelVersion},
        ${projected.manifest.providerConfigDigest},
        ${projected.manifest.vectorSpaceId}, ${projected.scopeKey},
        ${ids.resultReceiptId}
      )
    `;

    let embeddingId = ids.embeddingId;
    const [existingEmbedding] = await tx`
      SELECT embedding_id, vector_digest FROM face_embedding
      WHERE face_id = ${projected.faceId}
        AND model_family = ${projected.manifest.recognizer.model}
        AND model_version = ${projected.manifest.recognizer.modelVersion}
        AND config_digest = ${projected.manifest.providerConfigDigest}
        AND state = 'active'
      FOR UPDATE
    `;
    if (existingEmbedding) {
      if (existingEmbedding.vector_digest !== projected.vectorDigest) {
        throw new Error(
          "Manual recognition conflicts with the active embedding",
        );
      }
      embeddingId = existingEmbedding.embedding_id;
    } else {
      await tx`
        INSERT INTO face_embedding (
          embedding_id, face_id, model_family, model_version, config_digest,
          dimension, normalized, embedding, vector_digest, state,
          producer_receipt_id, privacy_class
        ) VALUES (
          ${embeddingId}, ${projected.faceId},
          ${projected.manifest.recognizer.model},
          ${projected.manifest.recognizer.modelVersion},
          ${projected.manifest.providerConfigDigest}, ${projected.dimension}, true,
          ${`[${projected.vector.join(",")}]`}::vector,
          ${projected.vectorDigest}, 'active', ${ids.resultReceiptId},
          'sensitive-biometric'
        )
      `;
    }

    for (const [index, runId] of projected.runIds.entries()) {
      await tx`
        INSERT INTO manual_face_recognition_run (
          run_id, request_id, run_ordinal, result_digest, crop_digest,
          vector_digest, producer_receipt_id
        ) VALUES (
          ${runId}, ${ids.requestId}, ${index + 1},
          ${projected.runResultDigest},
          ${envelope.runs[index].observation.cropDigest},
          ${projected.vectorDigest}, ${ids.resultReceiptId}
        )
      `;
    }
    await tx`
      INSERT INTO manual_face_recognition_quality (
        quality_id, request_id, measurement_digest, policy_version,
        policy_digest, quality_score, usable_threshold,
        low_quality_threshold, allow_low_quality, evidence_tier,
        producer_receipt_id
      ) VALUES (
        ${ids.qualityId}, ${ids.requestId}, ${projected.measurementDigest},
        ${projected.policyVersion}, ${projected.policyDigest},
        ${projected.qualityScore}, ${projected.qualityUsableThreshold},
        ${projected.qualityLowThreshold}, ${projected.qualityAllowLowQuality},
        ${projected.evidenceTier},
        ${ids.resultReceiptId}
      )
    `;

    const rebuildDigest = manualRecognitionDigest({
      configDigest: projected.manifest.providerConfigDigest,
      evidenceId: ids.evidenceId,
      modelFamily: projected.manifest.recognizer.model,
      modelVersion: projected.manifest.recognizer.modelVersion,
      personId: current.subject_id,
      reasonCode: "manual_face_recognition_eligible",
    });
    await tx`
      INSERT INTO source_pack_rebuild_request (
        rebuild_request_id, person_id, reason_code, subject_type, subject_id,
        model_family, model_version, config_digest, request_digest, state
      ) VALUES (
        ${ids.rebuildRequestId}, ${current.subject_id},
        'manual_face_recognition_eligible', 'manual_face_recognition_evidence',
        ${ids.evidenceId}, ${projected.manifest.recognizer.model},
        ${projected.manifest.recognizer.modelVersion},
        ${projected.manifest.providerConfigDigest}, ${rebuildDigest}, 'pending'
      )
    `;
    await tx`
      INSERT INTO manual_face_recognition_evidence (
        evidence_id, evidence_digest, request_id, run_one_id, run_two_id,
        replay_digest, result_digest, source_content_digest, quality_id,
        measurement_digest, policy_digest, evidence_tier, embedding_id,
        vector_digest, rebuild_request_id, producer_receipt_id
      ) VALUES (
        ${ids.evidenceId}, ${projected.evidenceDigest}, ${ids.requestId},
        ${projected.runIds[0]}, ${projected.runIds[1]}, ${projected.replayDigest},
        ${projected.runResultDigest}, ${projected.sourceContentDigest},
        ${ids.qualityId}, ${projected.measurementDigest}, ${projected.policyDigest},
        ${projected.evidenceTier}, ${embeddingId}, ${projected.vectorDigest},
        ${ids.rebuildRequestId}, ${ids.resultReceiptId}
      )
    `;

    const scopeKey = projected.scopeKey;
    const [prior] = await tx`
      SELECT lifecycle_id, state FROM current_manual_face_matching_lifecycle
      WHERE operation_id = ${projected.operationId} AND scope_key = ${scopeKey}
      FOR UPDATE
    `;
    if (
      prior?.state === "cancelled" ||
      prior?.state === "eligible_for_evaluation"
    ) {
      throw new Error("Manual recognition lifecycle scope is stale");
    }
    const lifecycleId = `manualmatch_${manualRecognitionDigest({
      evidenceDigest: projected.evidenceDigest,
      operationId: projected.operationId,
      scopeKey,
    }).slice(0, 32)}`;
    await tx`
      INSERT INTO manual_face_matching_lifecycle (
        lifecycle_id, operation_id, identity_claim_id, face_id, scope_key,
        state, reason, provider_id, model_family, model_version, config_digest,
        vector_space_id, embedding_id, vector_digest, evidence_digest,
        evidence_tier, rebuild_request_id, supersedes_lifecycle_id,
        producer_receipt_id, privacy_class, recognition_evidence_id
      ) VALUES (
        ${lifecycleId}, ${projected.operationId}, ${projected.identityClaimId},
        ${projected.faceId}, ${scopeKey}, 'eligible_for_evaluation', NULL,
        ${projected.manifest.provider.name},
        ${projected.manifest.recognizer.model},
        ${projected.manifest.recognizer.modelVersion},
        ${projected.manifest.providerConfigDigest},
        ${projected.manifest.vectorSpaceId}, ${embeddingId},
        ${projected.vectorDigest}, ${projected.evidenceDigest},
        ${projected.evidenceTier}, ${ids.rebuildRequestId},
        ${prior?.lifecycle_id || null}, ${ids.resultReceiptId},
        'sensitive-biometric', ${ids.evidenceId}
      )
    `;

    const ledger = createMediaJobLedger(tx);
    await ledger.checkpoint({
      jobId: id,
      payload: {
        evidenceDigest: projected.evidenceDigest,
        evidenceId: ids.evidenceId,
        replayEvidence: "consistent",
        requestDigest: projected.requestDigest,
      },
      stage: "recognition_recorded",
      workerId: worker,
    });
    await ledger.complete({
      jobId: id,
      resultDigest: projected.evidenceDigest,
      resultReceiptId: ids.resultReceiptId,
      workerId: worker,
    });
    return responseFor({ ids, projected, replayed: false });
  });
};
