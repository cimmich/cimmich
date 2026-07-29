#!/usr/bin/env node

import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import process from "node:process";
import postgres from "postgres";
import {
  boundedInteger,
  optionalArgument,
  requiredArgument,
} from "../src/bin-arguments.mjs";
import {
  completeAssetSourceRead,
  createAssetSourceRevisionRepository,
} from "../src/asset-source-revision.mjs";
import { enqueueExistingFaceRecognitionPipeline } from "../src/existing-face-recognition-pipeline.mjs";
import { createImmichCompanion } from "../src/immich-companion.mjs";
import { createInsightFaceUserSuppliedRecognizer } from "../src/insightface-user-supplied-recognizer.mjs";
import { createLocalExistingFaceRecognitionWorker } from "../src/local-existing-face-recognition-worker.mjs";
import { recognitionDigest } from "../src/recognition-provider-contract.mjs";

const manifestPath = requiredArgument("manifest");
const detectorModelPath = requiredArgument("detector-model");
const providerScriptPath = requiredArgument("provider-script");
const pythonPath = requiredArgument("python");
const recognizerModelPath = requiredArgument("recognizer-model");
const limitAssets = boundedInteger(
  optionalArgument("limit-assets"),
  "limit-assets",
  1,
  100_000,
  10,
);
const priorityTierMax = boundedInteger(
  optionalArgument("priority-tier-max"),
  "priority-tier-max",
  0,
  2,
  2,
);
const laneCount = boundedInteger(
  optionalArgument("lane-count"),
  "lane-count",
  1,
  16,
  1,
);
const laneIndex = boundedInteger(
  optionalArgument("lane-index"),
  "lane-index",
  0,
  laneCount - 1,
  0,
);
const workerCount = boundedInteger(
  optionalArgument("workers"),
  "workers",
  1,
  8,
  1,
);
const detectorConfigDigest = String(
  optionalArgument("detector-config-digest") || "",
).trim();
if (
  detectorConfigDigest &&
  !/^[0-9a-f]{64}$/.test(detectorConfigDigest)
) {
  throw new Error("detector-config-digest must be a lowercase SHA-256 digest");
}
const databaseUrl = String(process.env.DATABASE_URL || "").trim();
if (!databaseUrl) {
  throw new Error("Recognition backlog operator requires DATABASE_URL");
}
const sourceId = String(
  process.env.CIMMICH_IMMICH_SOURCE_ID || "immich-primary",
).trim();
const retryableRecognitionErrors = new Set([
  "LOCAL_EXISTING_FACE_RECOGNITION_FAILED",
  "LOCAL_RECOGNIZER_PROCESS_FAILED",
  "LOCAL_RECOGNIZER_TIMEOUT",
]);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const configDigest = String(manifest.recognitionSpaceConfigDigest || "").trim();
if (!/^[0-9a-f]{64}$/.test(configDigest)) {
  throw new Error("Provider manifest requires a recognition-space digest");
}
for (const [path, mode, label] of [
  [pythonPath, constants.X_OK, "Python runtime"],
  [providerScriptPath, constants.R_OK, "provider script"],
  [detectorModelPath, constants.R_OK, "detector model"],
  [recognizerModelPath, constants.R_OK, "recognizer model"],
]) {
  try {
    await access(path, mode);
  } catch {
    throw new Error(`Recognition backlog ${label} is unavailable`);
  }
}

const sql = postgres(databaseUrl, {
  max: Math.max(4, workerCount * 2),
  prepare: true,
});
const immich = createImmichCompanion({
  apiBaseUrl: process.env.IMMICH_API_URL || "",
  apiKey: process.env.IMMICH_API_KEY || "",
});
const sourceRepository = createAssetSourceRevisionRepository(sql, {
  presentationRank: () => 1,
});
const recognizers = Array.from({ length: workerCount }, () =>
  createInsightFaceUserSuppliedRecognizer({
    detectorModelPath,
    manifest,
    manifestPath,
    pythonPath,
    recognizerModelPath,
    residentProcess: true,
    scriptPath: providerScriptPath,
  }),
);
const startedAt = Date.now();
const summary = {
  assetsAttempted: 0,
  chunksCompleted: 0,
  detectorConfigDigestFilter: detectorConfigDigest || null,
  embedded: 0,
  execution: "resident-provider-process",
  facesAttempted: 0,
  laneCount,
  laneIndex,
  priorityTierMax,
  providerProcesses: workerCount,
  recognizedChunks: 0,
  retriedJobs: 0,
  schemaVersion: "cimmich.existing-face-recognition-backlog-receipt.v2",
  sourceMediaWrite: "none",
};

const currentSource = async (assetId) => {
  const [projection] = await sql`
    SELECT projection.immich_asset_id, projection.input_revision,
      projection.source_id
    FROM immich_asset_projection projection
    JOIN asset ON asset.asset_id = projection.cimmich_asset_id
      AND asset.state = 'active'
    WHERE projection.cimmich_asset_id = ${assetId}
      AND projection.source_id = ${sourceId}
      AND projection.state = 'active'
    ORDER BY projection.last_seen_at DESC, projection.immich_asset_id
    LIMIT 1
  `;
  if (!projection) {
    throw new Error("Existing recognition configured source is unavailable");
  }
  const initial = await immich.getAsset({
    assetId: projection.immich_asset_id,
  });
  if (initial.asset.immichAssetId !== projection.immich_asset_id) {
    throw new Error("Configured companion returned another source asset");
  }
  if (initial.asset.inputRevision !== projection.input_revision) {
    throw new Error(
      "Configured companion source revision changed; refresh inventory first",
    );
  }
  const media = await immich.readAssetImage({
    assetId: projection.immich_asset_id,
  });
  if (
    media.asset.immichAssetId !== projection.immich_asset_id ||
    media.asset.inputRevision !== projection.input_revision
  ) {
    throw new Error("Configured companion source changed during validation");
  }
  return {
    assetId,
    inputRevision: projection.input_revision,
    media,
    sourceAssetId: projection.immich_asset_id,
    sourceBindingDigest: recognitionDigest({
      assetId,
      companionInputRevision: projection.input_revision,
      schemaVersion: "cimmich.existing-face-recognition-companion-binding.v1",
      sourceAssetId: projection.immich_asset_id,
    }),
  };
};

const processChunk = async ({ faceIds, recognizer, source, workerSlot }) => {
  const prepared = await sourceRepository.prepare({
    assetId: source.assetId,
    sourceAccess: "immich_api_read_only",
    sourceBindingDigest: source.sourceBindingDigest,
  });
  const sourceRead = completeAssetSourceRead({
    bytes: source.media.bytes,
    prepared,
  });
  const pipeline = await enqueueExistingFaceRecognitionPipeline(sql, {
    faceIds,
    manifest,
    presentationRank: () => 1,
    sourceRead,
  });
  let result = { state: pipeline.state };
  if (pipeline.state !== "recognized") {
    const companion = {
      async getAsset({ assetId }) {
        if (assetId !== source.assetId) {
          throw new Error("Existing recognition companion asset mismatch");
        }
        const current = await immich.getAsset({
          assetId: source.sourceAssetId,
        });
        if (
          current.asset.immichAssetId !== source.sourceAssetId ||
          current.asset.inputRevision !== source.inputRevision
        ) {
          throw new Error("Configured companion source revision changed");
        }
        return {
          asset: {
            assetId: source.assetId,
            inputRevision: sourceRead.inputRevision,
          },
        };
      },
      async readAssetImage({ assetId }) {
        if (assetId !== source.assetId) {
          throw new Error("Existing recognition companion asset mismatch");
        }
        return {
          asset: {
            assetId: source.assetId,
            inputRevision: sourceRead.inputRevision,
          },
          bytes: source.media.bytes,
          contentDigest: sourceRead.sourceContentDigest,
          sourceAccess: "immich-api-read-only",
        };
      },
    };
    const worker = createLocalExistingFaceRecognitionWorker({
      companion,
      manifest,
      recognizer,
      sql,
      workerId: `cimmich-resident-backlog-${process.pid}-${workerSlot}`,
    });
    for (
      let executionAttempt = 1;
      executionAttempt <= 3;
      executionAttempt += 1
    ) {
      for (let claimAttempt = 1; claimAttempt <= 3; claimAttempt += 1) {
        result = await worker.runNext({
          expectedJobId: pipeline.recognitionJobId,
        });
        if (result.state !== "idle") break;
        if (claimAttempt < 3) {
          await new Promise((resolve) =>
            setTimeout(resolve, 25 * claimAttempt),
          );
        }
      }
      if (result.status === "completed") break;
      if (
        result.state !== "pending" ||
        !retryableRecognitionErrors.has(result.errorCode) ||
        executionAttempt === 3
      ) {
        break;
      }
      summary.retriedJobs += 1;
      await new Promise((resolve) =>
        setTimeout(resolve, 100 * executionAttempt),
      );
    }
    if (result.status !== "completed") {
      const resultState = String(result.state || result.status || "unknown");
      const [jobState] = await sql`
        SELECT job.state AS job_state, pipeline.state AS pipeline_state
        FROM media_job job
        JOIN media_pipeline_run pipeline
          ON pipeline.recognition_job_id = job.job_id
        WHERE job.job_id = ${pipeline.recognitionJobId}
      `;
      throw Object.assign(
        new Error(
          `Resident recognition worker did not complete exact job (${resultState}; job=${jobState?.job_state || "missing"}; pipeline=${jobState?.pipeline_state || "missing"})`,
        ),
        { code: result.errorCode || "RESIDENT_RECOGNITION_INCOMPLETE" },
      );
    }
  }
  const [lineage] = await sql`
    SELECT pipeline.state,
      count(embedding.embedding_id)::int AS runtime_embedding_count
    FROM media_pipeline_run pipeline
    JOIN media_job job ON job.job_id = pipeline.recognition_job_id
    LEFT JOIN face_embedding embedding
      ON embedding.producer_receipt_id = job.result_receipt_id
      AND embedding.face_id = ANY(${faceIds})
    WHERE pipeline.pipeline_run_id = ${pipeline.pipelineRunId}
    GROUP BY pipeline.pipeline_run_id
  `;
  return {
    embedded: Number(lineage?.runtime_embedding_count || 0),
    state: lineage?.state || result.state,
  };
};

try {
  const detectorScope = detectorConfigDigest
    ? sql`AND EXISTS (
        SELECT 1
        FROM face_detection_result_observation detector_observation
        JOIN face_detection_result detector_result
          ON detector_result.detection_result_id =
            detector_observation.detection_result_id
        WHERE detector_observation.face_id = face.face_id
          AND detector_result.detector_config_digest =
            ${detectorConfigDigest}
      )`
    : sql``;
  // The asset bound is applied inside the statement: the eligible frontier is
  // archive-wide, and returning every eligible face only to keep the first
  // limitAssets groups pulled hundreds of thousands of rows into process
  // memory on a full archive. The availability totals the receipt reports are
  // computed over the same materialized frontier, so bounding the transfer
  // does not change any reported number.
  const rows = await sql`
    WITH eligible AS MATERIALIZED (
      SELECT face.asset_id, face.face_id,
        triage.priority_tier, triage.accepted_person_count,
        triage.accepted_association_count, triage.human_observation_count
      FROM face_observation face
      JOIN asset ON asset.asset_id = face.asset_id AND asset.state = 'active'
      JOIN media_asset_triage triage ON triage.asset_id = face.asset_id
      WHERE face.state = 'valid'
        AND triage.priority_tier <= ${priorityTierMax}
        ${detectorScope}
        AND mod(
          hashtextextended(face.asset_id, 0)::numeric + 9223372036854775808,
          ${laneCount}
        ) = ${laneIndex}
        AND EXISTS (
          SELECT 1
          FROM immich_asset_projection projection
          WHERE projection.cimmich_asset_id = face.asset_id
            AND projection.source_id = ${sourceId}
            AND projection.state = 'active'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM media_pipeline_run active_pipeline
          JOIN media_job active_job
            ON active_job.job_id = active_pipeline.recognition_job_id
          WHERE active_pipeline.asset_id = face.asset_id
            AND active_pipeline.run_kind = 'existing_observation_set'
            AND active_pipeline.state = 'recognition_pending'
            AND active_pipeline.recognizer_config_digest = ${configDigest}
            AND active_job.state = 'processing'
            AND active_job.lease_expires_at > now()
        )
        AND NOT EXISTS (
          SELECT 1
          FROM face_embedding embedding
          WHERE embedding.face_id = face.face_id
            AND embedding.state = 'active'
            AND embedding.config_digest = ${configDigest}
        )
        AND NOT EXISTS (
          SELECT 1
          FROM media_pipeline_run_observation observation
          JOIN media_pipeline_run pipeline
            ON pipeline.pipeline_run_id = observation.pipeline_run_id
          WHERE observation.face_id = face.face_id
            AND pipeline.state = 'recognized'
            AND pipeline.recognizer_config_digest = ${configDigest}
        )
    ), availability AS (
      SELECT count(*)::int AS faces_available,
        count(DISTINCT asset_id)::int AS assets_available
      FROM eligible
    ), bounded_assets AS (
      SELECT asset_id
      FROM eligible
      GROUP BY asset_id, priority_tier, accepted_person_count,
        accepted_association_count, human_observation_count
      ORDER BY priority_tier,
        accepted_person_count DESC,
        accepted_association_count DESC,
        human_observation_count DESC,
        asset_id
      LIMIT ${limitAssets}
    )
    SELECT eligible.asset_id, eligible.face_id,
      availability.faces_available, availability.assets_available
    FROM eligible
    JOIN bounded_assets USING (asset_id)
    CROSS JOIN availability
    ORDER BY eligible.priority_tier,
      eligible.accepted_person_count DESC,
      eligible.accepted_association_count DESC,
      eligible.human_observation_count DESC,
      eligible.asset_id,
      eligible.face_id
  `;
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.asset_id)) grouped.set(row.asset_id, []);
    grouped.get(row.asset_id).push(row.face_id);
  }
  const assets = [...grouped.entries()];
  summary.assetsAvailableAtStart = Number(rows[0]?.assets_available || 0);
  summary.facesAvailableAtStart = Number(rows[0]?.faces_available || 0);
  let nextAssetIndex = 0;
  let stopped = false;
  const processAsset = async ([assetId, faceIds], recognizer, workerSlot) => {
    const source = await currentSource(assetId);
    summary.assetsAttempted += 1;
    for (let offset = 0; offset < faceIds.length; offset += 32) {
      const chunk = faceIds.slice(offset, offset + 32);
      const result = await processChunk({
        faceIds: chunk,
        recognizer,
        source,
        workerSlot,
      });
      summary.chunksCompleted += 1;
      summary.facesAttempted += chunk.length;
      summary.embedded += result.embedded;
      if (result.state === "recognized") summary.recognizedChunks += 1;
      process.stderr.write(
        `${JSON.stringify({
          assetsAttempted: summary.assetsAttempted,
          chunksCompleted: summary.chunksCompleted,
          embedded: summary.embedded,
          facesAttempted: summary.facesAttempted,
        })}\n`,
      );
    }
  };
  await Promise.all(
    recognizers.map(async (recognizer, index) => {
      const workerSlot = index + 1;
      while (!stopped) {
        const assetIndex = nextAssetIndex;
        nextAssetIndex += 1;
        if (assetIndex >= assets.length) return;
        try {
          await processAsset(assets[assetIndex], recognizer, workerSlot);
        } catch (error) {
          stopped = true;
          throw error;
        }
      }
    }),
  );
  summary.elapsedSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(3));
  summary.receiptDigest = recognitionDigest(summary);
  process.stdout.write(`${JSON.stringify(summary)}\n`);
} finally {
  await Promise.allSettled(recognizers.map((recognizer) => recognizer.close()));
  await sql.end({ timeout: 5 });
}
