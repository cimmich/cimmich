#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import process from "node:process";
import postgres from "postgres";
import {
  completeAssetSourceRead,
  createAssetSourceRevisionRepository,
} from "../src/asset-source-revision.mjs";
import { enqueueExistingFaceRecognitionPipeline } from "../src/existing-face-recognition-pipeline.mjs";
import { createImmichCompanion } from "../src/immich-companion.mjs";
import { createInsightFaceUserSuppliedRecognizer } from "../src/insightface-user-supplied-recognizer.mjs";
import { createLocalExistingFaceRecognitionWorker } from "../src/local-existing-face-recognition-worker.mjs";
import { recognitionDigest } from "../src/recognition-provider-contract.mjs";

const requiredArgument = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : null;
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing --${name}`);
  }
  return value;
};

const exactInput = (value) => {
  const fields = ["faceIds"];
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== fields.sort().join(",") ||
    !Array.isArray(value.faceIds) ||
    value.faceIds.length < 1 ||
    value.faceIds.length > 32 ||
    value.faceIds.some(
      (faceId) =>
        typeof faceId !== "string" ||
        !faceId ||
        faceId.length > 192 ||
        /[\u0000-\u001f\u007f]/.test(faceId),
    ) ||
    new Set(value.faceIds).size !== value.faceIds.length
  ) {
    throw new Error("Existing recognition operator input is invalid");
  }
  return value;
};

const inputPath = requiredArgument("input");
const manifestPath = requiredArgument("manifest");
const detectorModelPath = requiredArgument("detector-model");
const providerScriptPath = requiredArgument("provider-script");
const pythonPath = requiredArgument("python");
const recognizerModelPath = requiredArgument("recognizer-model");
const databaseUrl = String(process.env.DATABASE_URL || "").trim();
if (!databaseUrl) {
  throw new Error("Existing recognition operator requires DATABASE_URL");
}
const input = exactInput(JSON.parse(await readFile(inputPath, "utf8")));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const sql = postgres(databaseUrl, { max: 2, prepare: true });

try {
  const faceRows = await sql`
    SELECT face.face_id, asset.asset_id, projection.immich_asset_id,
      projection.input_revision AS companion_input_revision,
      projection.source_id
    FROM face_observation face
    JOIN asset ON asset.asset_id = face.asset_id AND asset.state = 'active'
    LEFT JOIN immich_asset_projection projection
      ON projection.cimmich_asset_id = asset.asset_id
      AND projection.state = 'active'
    WHERE face.face_id = ANY(${input.faceIds}) AND face.state = 'valid'
    ORDER BY face.face_id
  `;
  const normalizedFaceIds = [...input.faceIds].sort();
  const assetIds = new Set(faceRows.map((row) => row.asset_id));
  const sourceAssetIds = new Set(faceRows.map((row) => row.immich_asset_id));
  const sourceIds = new Set(faceRows.map((row) => row.source_id));
  if (
    faceRows.length !== normalizedFaceIds.length ||
    faceRows.some((row, index) => row.face_id !== normalizedFaceIds[index]) ||
    assetIds.size !== 1 ||
    sourceAssetIds.size !== 1 ||
    sourceIds.size !== 1
  ) {
    throw new Error(
      "Existing recognition operator requires one exact current asset observation set",
    );
  }
  const assetId = faceRows[0].asset_id;
  const sourceAssetId = faceRows[0].immich_asset_id;
  const sourceRepository = createAssetSourceRevisionRepository(sql, {
    presentationRank: () => 1,
  });
  if (
    !sourceAssetId ||
    faceRows[0].source_id !==
      (process.env.CIMMICH_IMMICH_SOURCE_ID || "immich-primary")
  ) {
    throw new Error("Existing recognition configured source is unavailable");
  }
  const immich = createImmichCompanion({
    apiBaseUrl: process.env.IMMICH_API_URL || "",
    apiKey: process.env.IMMICH_API_KEY || "",
  });
  const initialProjection = await immich.getAsset({ assetId: sourceAssetId });
  if (
    initialProjection.asset.immichAssetId !== sourceAssetId ||
    initialProjection.asset.inputRevision !==
      faceRows[0].companion_input_revision
  ) {
    throw new Error("Configured companion returned another source asset");
  }
  const sourceBindingDigest = recognitionDigest({
    assetId,
    companionInputRevision: initialProjection.asset.inputRevision,
    schemaVersion: "cimmich.existing-face-recognition-companion-binding.v1",
    sourceAssetId,
  });
  const media = await immich.readAssetImage({ assetId: sourceAssetId });
  if (
    media.asset.immichAssetId !== sourceAssetId ||
    media.asset.inputRevision !== initialProjection.asset.inputRevision
  ) {
    throw new Error("Configured companion source changed during validation");
  }
  const prepared = await sourceRepository.prepare({
    assetId,
    sourceAccess: "immich_api_read_only",
    sourceBindingDigest,
  });
  const sourceRead = completeAssetSourceRead({ bytes: media.bytes, prepared });
  const companion = {
    async getAsset({ assetId: requestedAssetId }) {
      if (requestedAssetId !== assetId) {
        throw new Error("Existing recognition companion asset mismatch");
      }
      const current = await immich.getAsset({ assetId: sourceAssetId });
      if (
        current.asset.immichAssetId !== sourceAssetId ||
        current.asset.inputRevision !== initialProjection.asset.inputRevision
      ) {
        throw new Error("Configured companion source revision changed");
      }
      return { asset: { assetId, inputRevision: sourceRead.inputRevision } };
    },
    async readAssetImage({ assetId: requestedAssetId }) {
      if (requestedAssetId !== assetId) {
        throw new Error("Existing recognition companion asset mismatch");
      }
      const current = await immich.readAssetImage({ assetId: sourceAssetId });
      if (
        current.asset.immichAssetId !== sourceAssetId ||
        current.asset.inputRevision !== initialProjection.asset.inputRevision ||
        current.contentDigest !== sourceRead.sourceContentDigest
      ) {
        throw new Error("Configured companion source revision changed");
      }
      return {
        asset: { assetId, inputRevision: sourceRead.inputRevision },
        bytes: current.bytes,
        contentDigest: sourceRead.sourceContentDigest,
        sourceAccess: "immich-api-read-only",
      };
    },
  };
  const pipeline = await enqueueExistingFaceRecognitionPipeline(sql, {
    faceIds: input.faceIds,
    manifest,
    presentationRank: () => 1,
    sourceRead,
  });
  const recognizer = createInsightFaceUserSuppliedRecognizer({
    detectorModelPath,
    manifest,
    manifestPath,
    pythonPath,
    recognizerModelPath,
    scriptPath: providerScriptPath,
  });
  const worker = createLocalExistingFaceRecognitionWorker({
    companion,
    manifest,
    recognizer,
    sql,
  });
  const result =
    pipeline.state === "recognized"
      ? { state: "recognized" }
      : await worker.runNext();
  const [lineage] = await sql`
    SELECT pipeline.state, pipeline.provider_run_count,
      count(embedding.embedding_id)::int AS runtime_embedding_count,
      count(*) FILTER (WHERE embedding.state = 'active')::int AS active_runtime_embedding_count,
      count(*) FILTER (WHERE embedding.state = 'superseded')::int AS superseded_runtime_embedding_count
    FROM media_pipeline_run pipeline
    JOIN media_job job ON job.job_id = pipeline.recognition_job_id
    LEFT JOIN face_embedding embedding
      ON embedding.producer_receipt_id = job.result_receipt_id
      AND embedding.face_id = ANY(${input.faceIds})
    WHERE pipeline.pipeline_run_id = ${pipeline.pipelineRunId}
    GROUP BY pipeline.pipeline_run_id
  `;
  const [isolation] = await sql`
    WITH selected_pipeline AS (
      SELECT pipeline.*, job.result_receipt_id
      FROM media_pipeline_run pipeline
      JOIN media_job job ON job.job_id = pipeline.recognition_job_id
      WHERE pipeline.pipeline_run_id = ${pipeline.pipelineRunId}
    ), same_space AS (
      SELECT embedding.state, embedding.vector_digest,
        embedding.producer_receipt_id,
        selected.result_receipt_id
      FROM selected_pipeline selected
      JOIN face_embedding embedding
        ON embedding.face_id = ANY(${input.faceIds})
        AND embedding.config_digest = selected.recognizer_config_digest
    )
    SELECT
      count(*) FILTER (WHERE state = 'active')::int AS active_same_space_count,
      count(*) FILTER (
        WHERE state = 'active'
          AND producer_receipt_id = result_receipt_id
      )::int AS active_runtime_count,
      count(*) FILTER (
        WHERE state = 'superseded'
          AND producer_receipt_id <> result_receipt_id
      )::int AS superseded_prior_count,
      (SELECT count(*)::int FROM source_pack pack, selected_pipeline selected
        WHERE pack.state = 'active' AND pack.evaluation_status = 'passed'
          AND pack.config_digest = selected.recognizer_config_digest
      ) AS active_passed_pack_count,
      (SELECT count(*)::int
        FROM current_asset_source_revision revision, selected_pipeline selected
        WHERE revision.revision_id = selected.source_revision_id
          AND revision.asset_id = selected.asset_id
          AND revision.input_revision = selected.input_revision
          AND revision.source_content_digest = selected.source_content_digest
      ) AS current_source_revision_count
    FROM same_space
  `;
  const receipt = {
    activePassedPackCount: isolation?.active_passed_pack_count || 0,
    activeRuntimeEmbeddingCount: lineage?.active_runtime_embedding_count || 0,
    activeSameSpaceCount: isolation?.active_same_space_count || 0,
    automaticIdentityAuthority: "none",
    currentSourceRevisionCount: isolation?.current_source_revision_count || 0,
    pipelineRunId: pipeline.pipelineRunId,
    pipelineState: lineage?.state || result.state,
    providerRunCount: lineage?.provider_run_count || 0,
    runtimeEmbeddingCount: lineage?.runtime_embedding_count || 0,
    schemaVersion: "cimmich.existing-face-recognition-operator-receipt.v1",
    sourceMediaWrite: "none",
    supersededPriorImporterCount: isolation?.superseded_prior_count || 0,
    trainingAuthority: "none",
  };
  console.log(
    JSON.stringify({
      ...receipt,
      receiptDigest: recognitionDigest(receipt),
    }),
  );
} finally {
  await sql.end({ timeout: 5 });
}
