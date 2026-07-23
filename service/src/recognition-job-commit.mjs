import {
  mergeRecognitionCheckpoint,
  recognitionDigest,
} from "./recognition-provider-contract.mjs";
import { createMediaJobLedger } from "./media-job-ledger.mjs";
import { existingFaceObservationSetDigest } from "./existing-face-recognition-pipeline.mjs";

export const recognitionJobCommitVersion = "cimmich.recognition-job-commit.v1";

const requiredText = (value, label) => {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`Recognition job commit requires ${label}`);
  return normalized;
};

export const prepareRecognitionJobCommit = ({ checkpoint, job, manifest }) => {
  if (
    !job ||
    ![
      "recognize_faces",
      "detect_and_recognize",
      "recognize_existing_faces",
    ].includes(job.operation)
  ) {
    throw new Error("Recognition packets require a recognition media job");
  }
  if (job.state !== "processing") {
    throw new Error(
      "Recognition media job must hold an active processing lease",
    );
  }
  const validated = mergeRecognitionCheckpoint(manifest, [], checkpoint);
  if (job.configDigest !== validated.manifest.providerConfigDigest) {
    throw new Error(
      "Recognition media job uses another provider configuration",
    );
  }
  const assetId = requiredText(job.assetId, "assetId");
  if (
    validated.checkpoint.results.some((packet) => packet.assetToken !== assetId)
  ) {
    throw new Error(
      "Recognition checkpoint crosses its media job asset boundary",
    );
  }
  const resultDigest = validated.receipt.resultDigest;
  return {
    checkpoint: validated.checkpoint,
    embedded: validated.checkpoint.results.filter(
      (packet) => packet.state === "embedded",
    ),
    manifest: validated.manifest,
    receipt: validated.receipt,
    resultDigest,
    resultReceiptId: `receipt_media_job_${recognitionDigest({
      jobId: job.jobId,
      resultDigest,
    }).slice(0, 40)}`,
  };
};

export const validateExistingRecognitionProviderRuns = ({
  prepared,
  providerRuns,
}) => {
  if (
    !prepared?.receipt ||
    !Array.isArray(providerRuns) ||
    providerRuns.length !== 2 ||
    providerRuns.some(
      (run, index) =>
        run?.ordinal !== index + 1 ||
        run?.resultDigest !== prepared.resultDigest ||
        run?.checkpointDigest !== prepared.receipt.checkpointDigest,
    ) ||
    new Set(providerRuns.map((run) => run.runId)).size !== 2 ||
    new Set(providerRuns.map((run) => run.resultDigest)).size !== 1 ||
    new Set(providerRuns.map((run) => run.checkpointDigest)).size !== 1
  ) {
    throw new Error(
      "Existing recognition requires two distinct consistent provider runs",
    );
  }
  return providerRuns;
};

export const commitRecognitionJobResult = async (
  sql,
  { checkpoint, jobId, manifest, providerRuns = null, workerId },
) => {
  const id = requiredText(jobId, "jobId");
  const worker = requiredText(workerId, "workerId");
  return sql.begin(async (tx) => {
    const [row] = await tx`
      SELECT * FROM media_job WHERE job_id = ${id} FOR UPDATE
    `;
    if (!row) throw new Error("Recognition media job not found");
    const job = {
      assetId: row.asset_id,
      configDigest: row.config_digest,
      jobId: row.job_id,
      operation: row.operation,
      state: row.state,
    };
    if (
      row.lease_owner !== worker ||
      new Date(row.lease_expires_at) <= new Date()
    ) {
      throw new Error("Recognition media job lease is not current");
    }
    const prepared = prepareRecognitionJobCommit({ checkpoint, job, manifest });
    const [pipeline] = await tx`
      SELECT * FROM media_pipeline_run
      WHERE recognition_job_id = ${id}
      FOR UPDATE
    `;
    if (pipeline) {
      if (
        pipeline.asset_id !== job.assetId ||
        pipeline.recognizer_config_digest !==
          prepared.manifest.recognitionSpaceConfigDigest ||
        (pipeline.recognizer_provider_config_digest ||
          pipeline.recognizer_config_digest) !==
          prepared.manifest.providerConfigDigest ||
        pipeline.vector_space_id !== prepared.manifest.vectorSpaceId ||
        pipeline.state !== "recognition_pending"
      ) {
        throw new Error(
          "Recognition media job conflicts with its pipeline stage binding",
        );
      }
      if (pipeline.run_kind === "existing_observation_set") {
        const [currentSource] = await tx`
          SELECT revision_id FROM current_asset_source_revision
          WHERE revision_id = ${pipeline.source_revision_id}
            AND asset_id = ${pipeline.asset_id}
            AND input_revision = ${pipeline.input_revision}
            AND source_content_digest = ${pipeline.source_content_digest}
        `;
        if (!currentSource) {
          throw new Error(
            "Existing recognition source revision is no longer current",
          );
        }
      }
    }
    const faceIds = prepared.checkpoint.results.map(
      (packet) => packet.observationId,
    );
    const faces = faceIds.length
      ? await tx`
          SELECT face_id FROM face_observation
          WHERE asset_id = ${job.assetId} AND state = 'valid'
            AND face_id = ANY(${faceIds})
          ORDER BY face_id
        `
      : [];
    const known = new Set(faces.map((face) => face.face_id));
    const missing = [
      ...new Set(faceIds.filter((faceId) => !known.has(faceId))),
    ];
    if (missing.length) {
      throw new Error(
        `Recognition checkpoint references unknown job observations: ${missing.join(", ")}`,
      );
    }
    if (pipeline) {
      let expectedFaces;
      if (pipeline.run_kind === "existing_observation_set") {
        expectedFaces = await tx`
          SELECT observation.face_id, observation.observation_order,
            face.box_x, face.box_y, face.box_w, face.box_h,
            face.observation_origin
          FROM media_pipeline_run_observation observation
          JOIN face_observation face ON face.face_id = observation.face_id
            AND face.asset_id = ${pipeline.asset_id}
            AND face.state = 'valid'
          WHERE observation.pipeline_run_id = ${pipeline.pipeline_run_id}
          ORDER BY observation.observation_order
        `;
        if (
          existingFaceObservationSetDigest(expectedFaces) !==
          pipeline.observation_set_digest
        ) {
          throw new Error(
            "Existing recognition observation geometry is no longer current",
          );
        }
      } else {
        expectedFaces = await tx`
              SELECT observation.face_id
              FROM face_detection_result_observation observation
              WHERE observation.detection_result_id = ${pipeline.detection_result_id}
              ORDER BY observation.face_id
            `;
      }
      const expected = expectedFaces.map((face) => face.face_id);
      const received = [...new Set(faceIds)].sort();
      if (
        expected.length !== received.length ||
        expected.some((faceId, index) => faceId !== received[index])
      ) {
        throw new Error(
          "Recognition checkpoint does not cover the exact detected face set",
        );
      }
    }

    let replayDigest = null;
    if (pipeline?.run_kind === "existing_observation_set") {
      validateExistingRecognitionProviderRuns({ prepared, providerRuns });
      replayDigest = recognitionDigest({
        pipelineRunId: pipeline.pipeline_run_id,
        runs: providerRuns.map((run) => ({
          checkpointDigest: run.checkpointDigest,
          ordinal: run.ordinal,
          resultDigest: run.resultDigest,
          runId: run.runId,
        })),
      });
    }

    await tx`
      INSERT INTO producer_receipt (
        producer_receipt_id, producer_kind, producer_name, producer_version,
        config_digest, started_at, completed_at, result_digest, privacy_class
      ) VALUES (
        ${prepared.resultReceiptId}, 'model',
        ${`cimmich-recognition-job:${prepared.manifest.provider.name}`},
        ${prepared.manifest.provider.version},
        ${prepared.manifest.providerConfigDigest}, now(), now(),
        ${prepared.resultDigest}, 'sensitive-biometric'
      )
      ON CONFLICT (producer_receipt_id) DO NOTHING
    `;
    const [persistedReceipt] = await tx`
      SELECT result_digest FROM producer_receipt
      WHERE producer_receipt_id = ${prepared.resultReceiptId}
    `;
    if (persistedReceipt?.result_digest !== prepared.resultDigest) {
      throw new Error(
        "Recognition job result receipt conflicts with prior output",
      );
    }

    let inserted = 0;
    let reused = 0;
    if (
      pipeline?.run_kind === "existing_observation_set" &&
      faceIds.length
    ) {
      await tx`
        UPDATE face_embedding
        SET state = 'superseded'
        WHERE face_id = ANY(${faceIds})
          AND model_family =
            ${prepared.manifest.recognitionSpace.modelFamily}
          AND model_version =
            ${prepared.manifest.recognitionSpace.modelVersion}
          AND config_digest =
            ${prepared.manifest.recognitionSpaceConfigDigest}
          AND state = 'active'
      `;
    }
    for (const packet of prepared.embedded) {
      const [existing] = await tx`
        SELECT embedding_id, vector_digest, producer_receipt_id
        FROM face_embedding
        WHERE face_id = ${packet.observationId}
          AND model_family = ${prepared.manifest.recognitionSpace.modelFamily}
          AND model_version = ${prepared.manifest.recognitionSpace.modelVersion}
          AND config_digest = ${prepared.manifest.recognitionSpaceConfigDigest}
          AND state = 'active'
        FOR UPDATE
      `;
      if (existing) {
        if (pipeline?.run_kind === "existing_observation_set") {
          await tx`
            UPDATE face_embedding
            SET state = 'superseded'
            WHERE embedding_id = ${existing.embedding_id}
              AND state = 'active'
          `;
        } else if (existing.vector_digest !== packet.vectorDigest) {
          throw new Error(
            `Recognition observation ${packet.observationId} conflicts with active embedding`,
          );
        } else {
          reused += 1;
          continue;
        }
      }
      const embeddingId = `embedding_${recognitionDigest({
        configDigest: prepared.manifest.recognitionSpaceConfigDigest,
        faceId: packet.observationId,
        producerReceiptId:
          pipeline?.run_kind === "existing_observation_set"
            ? prepared.resultReceiptId
            : undefined,
        vectorDigest: packet.vectorDigest,
      }).slice(0, 40)}`;
      const vectorLiteral = `[${packet.vector.join(",")}]`;
      await tx`
        INSERT INTO face_embedding (
          embedding_id, face_id, model_family, model_version, config_digest,
          dimension, normalized, embedding, vector_digest, state,
          producer_receipt_id, privacy_class
        ) VALUES (
          ${embeddingId}, ${packet.observationId},
          ${prepared.manifest.recognitionSpace.modelFamily},
          ${prepared.manifest.recognitionSpace.modelVersion},
          ${prepared.manifest.recognitionSpaceConfigDigest},
          ${prepared.manifest.embedding.dimension}, true,
          ${vectorLiteral}::vector, ${packet.vectorDigest}, 'active',
          ${prepared.resultReceiptId}, 'sensitive-biometric'
        )
      `;
      inserted += 1;
    }

    const ledger = createMediaJobLedger(tx);
    await ledger.checkpoint({
      jobId: id,
      payload: {
        checkpointDigest: prepared.receipt.checkpointDigest,
        counts: prepared.receipt.counts,
        resultDigest: prepared.resultDigest,
        resultReceiptId: prepared.resultReceiptId,
        vectorSpaceId: prepared.manifest.vectorSpaceId,
      },
      stage: "recognition_recorded",
      workerId: worker,
    });
    const completed = await ledger.complete({
      jobId: id,
      resultDigest: prepared.resultDigest,
      resultReceiptId: prepared.resultReceiptId,
      workerId: worker,
    });
    if (pipeline) {
      if (pipeline.run_kind === "existing_observation_set") {
        for (const run of providerRuns) {
          await tx`
            INSERT INTO media_pipeline_provider_run (
              run_id, pipeline_run_id, run_ordinal, result_digest,
              checkpoint_digest
            ) VALUES (
              ${run.runId}, ${pipeline.pipeline_run_id}, ${run.ordinal},
              ${run.resultDigest}, ${run.checkpointDigest}
            )
          `;
        }
        await tx`
          UPDATE media_pipeline_run
          SET state = 'recognized', recognized_at = now(),
            provider_run_count = 2, provider_replay_digest = ${replayDigest},
            provider_result_digest = ${prepared.resultDigest}
          WHERE pipeline_run_id = ${pipeline.pipeline_run_id}
            AND state = 'recognition_pending'
        `;
      } else {
        await tx`
          UPDATE media_pipeline_run
          SET state = 'recognized', recognized_at = now()
          WHERE pipeline_run_id = ${pipeline.pipeline_run_id}
            AND state = 'recognition_pending'
        `;
      }
    }
    return {
      activationAuthority: "none",
      embeddings: { inserted, reused },
      job: completed,
      observationCounts: prepared.receipt.counts,
      pipelineRunId: pipeline?.pipeline_run_id || null,
      schemaVersion: recognitionJobCommitVersion,
      status: "completed",
    };
  });
};
