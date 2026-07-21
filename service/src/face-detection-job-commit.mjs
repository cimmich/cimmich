import {
  faceDetectionDigest,
  faceObservationId,
  validateFaceDetectionResult,
} from "./face-detector-contract.mjs";
import { createMediaJobLedger } from "./media-job-ledger.mjs";

export const faceDetectionJobCommitVersion =
  "cimmich.face-detection-job-commit.v1";

const requiredText = (value, label) => {
  const normalized = String(value || "").trim();
  if (!normalized)
    throw new Error(`Face detection job commit requires ${label}`);
  return normalized;
};

export const prepareFaceDetectionJobCommit = ({ job, manifest, result }) => {
  if (!job || job.operation !== "detect_faces") {
    throw new Error(
      "Face detection packets require a dedicated detect_faces media job",
    );
  }
  if (job.state !== "processing") {
    throw new Error(
      "Face detection media job must hold an active processing lease",
    );
  }
  const validated = validateFaceDetectionResult(result, manifest);
  if (validated.result.assetId !== job.assetId) {
    throw new Error(
      "Face detection result crosses its media job asset boundary",
    );
  }
  if (validated.result.inputRevision !== job.inputRevision) {
    throw new Error("Face detection result uses another asset input revision");
  }
  if (validated.result.detectorConfigDigest !== job.configDigest) {
    throw new Error(
      "Face detection media job uses another detector configuration",
    );
  }
  const detectionResultId = `face_detection_${faceDetectionDigest({
    assetId: job.assetId,
    configDigest: job.configDigest,
    inputRevision: job.inputRevision,
  }).slice(0, 40)}`;
  const observations = validated.result.faces.map((face) => ({
    ...face,
    faceId: faceObservationId({
      assetId: job.assetId,
      detectorConfigDigest: job.configDigest,
      inputRevision: job.inputRevision,
      observationKey: face.observationKey,
    }),
  }));
  return {
    ...validated,
    detectionResultId,
    observations,
    resultReceiptId: `receipt_face_detection_${validated.resultDigest.slice(0, 40)}`,
  };
};

const sameNumber = (left, right) =>
  Math.abs(Number(left) - Number(right)) < 1e-12;

export const commitFaceDetectionJobResult = async (
  sql,
  { jobId, manifest, result, workerId },
) => {
  const id = requiredText(jobId, "jobId");
  const worker = requiredText(workerId, "workerId");
  return sql.begin(async (tx) => {
    const [row] = await tx`
      SELECT * FROM media_job WHERE job_id = ${id} FOR UPDATE
    `;
    if (!row) throw new Error("Face detection media job not found");
    if (
      row.lease_owner !== worker ||
      !row.lease_expires_at ||
      new Date(row.lease_expires_at) <= new Date()
    ) {
      throw new Error("Face detection media job lease is not current");
    }
    const prepared = prepareFaceDetectionJobCommit({
      job: {
        assetId: row.asset_id,
        configDigest: row.config_digest,
        inputRevision: row.input_revision,
        operation: row.operation,
        state: row.state,
      },
      manifest,
      result,
    });

    const [existingResult] = await tx`
      SELECT * FROM face_detection_result
      WHERE asset_id = ${row.asset_id}
        AND detector_config_digest = ${row.config_digest}
        AND input_revision = ${row.input_revision}
      FOR SHARE
    `;
    if (
      existingResult &&
      existingResult.result_digest !== prepared.resultDigest
    ) {
      throw new Error("Face detection result conflicts with prior output");
    }

    let inserted = 0;
    let reused = 0;
    if (!existingResult) {
      await tx`
        INSERT INTO producer_receipt (
          producer_receipt_id, producer_kind, producer_name, producer_version,
          config_digest, started_at, completed_at, result_digest, privacy_class
        ) VALUES (
          ${prepared.resultReceiptId}, 'model',
          ${`cimmich-face-detector:${prepared.manifest.provider.name}`},
          ${prepared.manifest.provider.version},
          ${prepared.manifest.detectorConfigDigest}, now(), now(),
          ${prepared.resultDigest}, 'sensitive-biometric'
        )
        ON CONFLICT (producer_receipt_id) DO NOTHING
      `;
      const [receipt] = await tx`
        SELECT result_digest FROM producer_receipt
        WHERE producer_receipt_id = ${prepared.resultReceiptId}
      `;
      if (receipt?.result_digest !== prepared.resultDigest) {
        throw new Error("Face detection receipt conflicts with prior output");
      }

      for (const observation of prepared.observations) {
        const [existingFace] = await tx`
          SELECT * FROM face_observation WHERE face_id = ${observation.faceId}
        `;
        if (existingFace) {
          const same =
            existingFace.asset_id === row.asset_id &&
            sameNumber(existingFace.box_x, observation.box.x) &&
            sameNumber(existingFace.box_y, observation.box.y) &&
            sameNumber(existingFace.box_w, observation.box.w) &&
            sameNumber(existingFace.box_h, observation.box.h) &&
            sameNumber(
              existingFace.detection_confidence,
              observation.confidence,
            ) &&
            (existingFace.landmark_digest || null) ===
              observation.landmarkDigest &&
            faceDetectionDigest(existingFace.quality_measurements || {}) ===
              faceDetectionDigest(observation.quality);
          if (!same) {
            throw new Error(
              "Stable face observation ID conflicts with prior output",
            );
          }
          reused += 1;
        } else {
          await tx`
            INSERT INTO face_observation (
              face_id, asset_id, box_x, box_y, box_w, box_h,
              landmark_digest, detection_confidence, quality_measurements,
              state, producer_receipt_id
            ) VALUES (
              ${observation.faceId}, ${row.asset_id},
              ${observation.box.x}, ${observation.box.y},
              ${observation.box.w}, ${observation.box.h},
              ${observation.landmarkDigest}, ${observation.confidence},
              ${tx.json(observation.quality)}, 'valid', ${prepared.resultReceiptId}
            )
          `;
          inserted += 1;
        }
      }

      await tx`
        INSERT INTO face_detection_result (
          detection_result_id, asset_id, detector_config_digest,
          input_revision, source_content_digest, outcome, face_count,
          result_digest, producer_receipt_id
        ) VALUES (
          ${prepared.detectionResultId}, ${row.asset_id},
          ${row.config_digest}, ${row.input_revision},
          ${prepared.result.sourceContentDigest}, ${prepared.result.state},
          ${prepared.observations.length}, ${prepared.resultDigest},
          ${prepared.resultReceiptId}
        )
      `;
      for (const [index, observation] of prepared.observations.entries()) {
        await tx`
          INSERT INTO face_detection_result_observation (
            detection_result_id, face_id, observation_order
          ) VALUES (${prepared.detectionResultId}, ${observation.faceId}, ${index})
        `;
      }
    } else {
      reused = prepared.observations.length;
    }

    await tx`
      INSERT INTO media_job_detection_result (job_id, detection_result_id)
      VALUES (${id}, ${prepared.detectionResultId})
      ON CONFLICT (job_id) DO NOTHING
    `;
    const [jobResult] = await tx`
      SELECT detection_result_id FROM media_job_detection_result WHERE job_id = ${id}
    `;
    if (jobResult?.detection_result_id !== prepared.detectionResultId) {
      throw new Error("Media job is already bound to another detection result");
    }

    const ledger = createMediaJobLedger(tx);
    await ledger.checkpoint({
      jobId: id,
      payload: {
        detectionResultId: prepared.detectionResultId,
        faceCount: prepared.observations.length,
        outcome: prepared.result.state,
      },
      stage: "observations_recorded",
      workerId: worker,
    });
    const completed = await ledger.complete({
      jobId: id,
      resultDigest: prepared.resultDigest,
      resultReceiptId: prepared.resultReceiptId,
      workerId: worker,
    });
    return {
      activationAuthority: "none",
      detectionResultId: prepared.detectionResultId,
      observations: { inserted, reused },
      outcome: prepared.result.state,
      schemaVersion: faceDetectionJobCommitVersion,
      status: completed.state,
    };
  });
};
