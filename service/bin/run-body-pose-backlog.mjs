#!/usr/bin/env node

import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import postgres from "postgres";
import {
  argumentValue as argument,
  boundedInteger,
  requiredText,
} from "../src/bin-arguments.mjs";
import { createImmichCompanionManager } from "../src/immich-companion-manager.mjs";
import {
  createBodyPoseCurrentProjectionRepository,
  consumeCurrentBodyPoseProjection,
} from "../src/body-pose-current-projection.mjs";
import { createBodyPoseEvidenceRepository } from "../src/body-pose-evidence-repository.mjs";
import {
  bodyPoseEvaluationSchemaVersion,
  validateBodyPoseEvidence,
} from "../src/body-pose-provider-contract.mjs";
import { prepareLocalBodyPoseJobFromCurrent } from "../src/local-body-pose-worker.mjs";
import { createUltralyticsYoloPoseDetector } from "../src/ultralytics-yolo-pose-detector.mjs";

const required = (value, label) =>
  requiredText(value, label, "Body pose backlog");
const optionalTimestamp = (value, label) => {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (Number.isNaN(Date.parse(normalized))) {
    throw new Error(`${label} must be an ISO-8601 timestamp`);
  }
  return normalized;
};

const databaseUrl = required(process.env.DATABASE_URL, "DATABASE_URL");
const sourceId = required(
  process.env.CIMMICH_IMMICH_SOURCE_ID || "immich-primary",
  "CIMMICH_IMMICH_SOURCE_ID",
);
const detectorManifestPath = required(
  argument("detector-manifest"),
  "a detector manifest",
);
const poseManifestPath = required(argument("manifest"), "a pose manifest");
const modelPath = required(argument("model"), "a pose model");
const pythonPath = required(argument("python"), "a Python runtime");
const providerPath = required(argument("provider"), "a pose provider");
const limitAssets = boundedInteger(
  argument("limit-assets", "1000"),
  "limit-assets",
  1,
  100_000,
);
const priorityTierMax = boundedInteger(
  argument("priority-tier-max", "1"),
  "priority-tier-max",
  0,
  2,
);
const priorityTierMin = boundedInteger(
  argument("priority-tier-min", "0"),
  "priority-tier-min",
  0,
  2,
);
if (priorityTierMin > priorityTierMax) {
  throw new Error(
    "Body pose backlog priority-tier-min must not exceed priority-tier-max",
  );
}
const assetIdFilter = argument("asset-id");
const excludeAssetsWithPoseSince = optionalTimestamp(
  argument("exclude-assets-with-pose-since"),
  "exclude-assets-with-pose-since",
);
const detectorResultsSince = optionalTimestamp(
  argument("detector-results-since"),
  "detector-results-since",
);
const workerCount = boundedInteger(argument("workers", "4"), "workers", 1, 8);
const timeoutMs = boundedInteger(
  argument("timeout-ms", "120000"),
  "timeout-ms",
  1_000,
  600_000,
);

for (const [path, mode, label] of [
  [pythonPath, constants.X_OK, "Python runtime"],
  [providerPath, constants.R_OK, "provider script"],
  [modelPath, constants.R_OK, "model"],
  [detectorManifestPath, constants.R_OK, "detector manifest"],
  [poseManifestPath, constants.R_OK, "pose manifest"],
]) {
  try {
    await access(path, mode);
  } catch {
    throw new Error(`Body pose backlog ${label} is unavailable: ${path}`);
  }
}

const [detectorManifest, poseManifest] = await Promise.all([
  readFile(detectorManifestPath, "utf8").then(JSON.parse),
  readFile(poseManifestPath, "utf8").then(JSON.parse),
]);
const sql = postgres(databaseUrl, {
  max: Math.max(4, workerCount + 2),
  prepare: true,
});
const companion = await createImmichCompanionManager({
  apiBaseUrl: process.env.IMMICH_API_URL || "",
  apiKey: process.env.IMMICH_API_KEY || "",
  credentialFile: process.env.CIMMICH_IMMICH_CREDENTIAL_FILE || "",
});
const currentRepository = createBodyPoseCurrentProjectionRepository(sql, {
  presentationRank: () => 2,
});
const evidenceRepository = createBodyPoseEvidenceRepository(sql, {
  presentationRank: () => 2,
});
const providers = Array.from({ length: workerCount }, () =>
  createUltralyticsYoloPoseDetector({
    manifest: poseManifest,
    manifestPath: poseManifestPath,
    modelPath,
    pythonPath,
    scriptPath: providerPath,
    timeoutMs,
  }),
);

const summary = {
  assetsCompleted: 0,
  assetsFailed: 0,
  assetsTargeted: 0,
  failedAssets: [],
  paused: false,
  posesInserted: 0,
  posesReplayed: 0,
  posesUnavailable: 0,
  posesValidated: 0,
  workerFailures: [],
};

const runLockKey = [
  "cimmich-body-pose-backlog",
  sourceId,
  detectorManifest.detectorConfigDigest,
  poseManifest.poseConfigDigest,
].join(":");
const lockConnection = await sql.reserve();
let runLockAcquired = false;

try {
  const [runLock] = await lockConnection`
    SELECT pg_try_advisory_lock(
      hashtextextended(${runLockKey}, 63)
    ) AS acquired
  `;
  if (!runLock?.acquired) {
    throw Object.assign(
      new Error("Another Body pose backlog run already owns this scope"),
      { code: "BODY_POSE_BACKLOG_ALREADY_RUNNING" },
    );
  }
  runLockAcquired = true;
  const [initialControl] = await sql`
    SELECT state FROM media_operator_control WHERE control_id = 'primary'
  `;
  if (initialControl?.state === "paused") {
    summary.paused = true;
  }
  const assetFilter = assetIdFilter
    ? sql`AND body.asset_id = ${assetIdFilter}`
    : sql``;
  const recentPoseAssetCte = excludeAssetsWithPoseSince
    ? sql`recent_pose_asset AS MATERIALIZED (
        SELECT DISTINCT retry_body.asset_id
        FROM body_pose_evidence retry_pose
        JOIN body_observation retry_body
          ON retry_body.body_id = retry_pose.body_id
        WHERE retry_pose.state = 'valid'
          AND retry_pose.created_at >=
            ${excludeAssetsWithPoseSince}::timestamptz
      ),`
    : sql``;
  const retryFilter = excludeAssetsWithPoseSince
    ? sql`AND NOT EXISTS (
        SELECT 1
        FROM recent_pose_asset retry_asset
        WHERE retry_asset.asset_id = body.asset_id
      )`
    : sql``;
  const detectorResultFilter = detectorResultsSince
    ? sql`AND result.created_at >= ${detectorResultsSince}::timestamptz`
    : sql``;
  const targets = summary.paused
    ? []
    : await sql`
    WITH ${recentPoseAssetCte}
    triage_projection AS MATERIALIZED (
      SELECT * FROM media_asset_triage
    ),
    target_asset AS (
      SELECT DISTINCT ON (body.asset_id)
        body.asset_id
      FROM body_detection_result result
      JOIN body_detection_result_observation result_body
        ON result_body.detection_result_id = result.detection_result_id
      JOIN body_observation body
        ON body.body_id = result_body.body_id
        AND body.asset_id = result.asset_id
        AND body.state = 'valid'
      JOIN asset ON asset.asset_id = body.asset_id
        AND asset.state = 'active' AND asset.media_kind = 'image'
      JOIN triage_projection triage ON triage.asset_id = body.asset_id
      WHERE result.detector_config_digest =
          ${detectorManifest.detectorConfigDigest}
        AND result.outcome = 'bodies_detected'
        ${detectorResultFilter}
        AND triage.priority_tier BETWEEN
          ${priorityTierMin} AND ${priorityTierMax}
        ${assetFilter}
        ${retryFilter}
        AND NOT EXISTS (
          SELECT 1 FROM body_pose_evidence pose
          WHERE pose.body_id = body.body_id AND pose.state = 'valid'
        )
      ORDER BY body.asset_id
      LIMIT ${limitAssets}
    )
    SELECT target.asset_id,
      projection.immich_asset_id AS source_asset_id,
      missing.missing_body_ids
    FROM target_asset target
    JOIN LATERAL (
      SELECT source_projection.immich_asset_id
      FROM immich_asset_projection source_projection
      WHERE source_projection.cimmich_asset_id = target.asset_id
        AND source_projection.source_id = ${sourceId}
        AND source_projection.state = 'active'
      ORDER BY source_projection.last_seen_at DESC,
        source_projection.immich_asset_id
      LIMIT 1
    ) projection ON true
    JOIN LATERAL (
      SELECT array_agg(
        current_body.body_id ORDER BY current_result.observation_order
      ) AS missing_body_ids
      FROM current_body_detection_result_observation current_result
      JOIN body_observation current_body
        ON current_body.body_id = current_result.body_id
        AND current_body.asset_id = current_result.asset_id
        AND current_body.state = 'valid'
      WHERE current_result.asset_id = target.asset_id
        AND current_result.detector_config_digest =
          ${detectorManifest.detectorConfigDigest}
        AND NOT EXISTS (
          SELECT 1 FROM body_pose_evidence pose
          WHERE pose.body_id = current_body.body_id AND pose.state = 'valid'
        )
    ) missing ON cardinality(missing.missing_body_ids) > 0
    ORDER BY target.asset_id
  `;
  summary.assetsTargeted = targets.length;
  let next = 0;
  const runWorker = async (provider, workerIndex) => {
    while (next < targets.length) {
      const [control] = await sql`
        SELECT state FROM media_operator_control WHERE control_id = 'primary'
      `;
      if (control?.state === "paused") {
        summary.paused = true;
        return;
      }
      const index = next;
      next += 1;
      const target = targets[index];
      try {
        const current = await currentRepository.load({
          assetId: target.asset_id,
          detectorManifest,
        });
        const bodyValidation =
          consumeCurrentBodyPoseProjection(current).validation;
        prepareLocalBodyPoseJobFromCurrent({
          current,
          manifest: poseManifest,
        });
        const media = await companion.readAssetImage({
          assetId: target.source_asset_id,
        });
        if (bodyValidation.result.sourceContentDigest !== media.contentDigest) {
          throw Object.assign(new Error("Body pose source revision changed"), {
            code: "BODY_POSE_SOURCE_REVISION_CHANGED",
          });
        }
        const request = {
          assetToken: bodyValidation.result.assetToken,
          bytes: media.bytes,
          inputRevision: current.inputRevision,
          sourceContentDigest: bodyValidation.result.sourceContentDigest,
          timeoutMs,
        };
        const first = await provider.detect({
          ...request,
          runId: `pose-${workerIndex + 1}-a`,
        });
        const second = await provider.detect({
          ...request,
          runId: `pose-${workerIndex + 1}-b`,
        });
        const validation = validateBodyPoseEvidence({
          bodyValidation,
          manifest: poseManifest,
          policy: { alternativeMargin: 0.05, minimumIou: 0.5 },
          runs: [first, second],
          schemaVersion: bodyPoseEvaluationSchemaVersion,
        });
        const receipt = await evidenceRepository.commit({
          current,
          targetBodyIds: target.missing_body_ids,
          validation,
        });
        summary.assetsCompleted += 1;
        summary.posesInserted +=
          receipt.persistedPoseCount - receipt.replayedPoseCount;
        summary.posesReplayed += receipt.replayedPoseCount;
        summary.posesUnavailable += receipt.unavailablePoseCount;
        summary.posesValidated += receipt.persistedPoseCount;
        process.stderr.write(
          `${JSON.stringify({
            asset: index + 1,
            assetId: target.asset_id,
            completed: summary.assetsCompleted,
            persistedPoseCount: receipt.persistedPoseCount,
            sourceAssetId: target.source_asset_id,
            targetBodyCount: target.missing_body_ids.length,
          })}\n`,
        );
      } catch (error) {
        summary.assetsFailed += 1;
        summary.failedAssets.push({
          assetId: target.asset_id,
          errorCode: String(error?.code || "BODY_POSE_INGEST_FAILED"),
          errorMessage: String(error?.message || "Body pose ingest failed"),
          sourceAssetId: target.source_asset_id,
          targetBodyCount: target.missing_body_ids.length,
        });
        process.stderr.write(
          `${JSON.stringify({
            asset: index + 1,
            assetId: target.asset_id,
            errorCode: String(error?.code || "BODY_POSE_INGEST_FAILED"),
            errorMessage: String(error?.message || "Body pose ingest failed"),
            sourceAssetId: target.source_asset_id,
            targetBodyCount: target.missing_body_ids.length,
          })}\n`,
        );
      }
    }
  };
  const settledWorkers = await Promise.allSettled(providers.map(runWorker));
  summary.workerFailures = settledWorkers
    .filter((outcome) => outcome.status === "rejected")
    .map((outcome) =>
      String(
        outcome.reason?.code ||
          outcome.reason?.message ||
          "BODY_POSE_BACKLOG_WORKER_FAILED",
      ).slice(0, 200),
    );
  process.stdout.write(
    `${JSON.stringify({
      ...summary,
      automaticIdentityWrites: 0,
      detectorConfigDigest: detectorManifest.detectorConfigDigest,
      detectorResultsSince: detectorResultsSince || null,
      matcherInvocations: 0,
      poseConfigDigest: poseManifest.poseConfigDigest,
      poseProviderRunsPerAsset: 2,
      priorityTierMin,
      priorityTierMax,
      retryEvidenceCutoff: excludeAssetsWithPoseSince || null,
      providerProcesses: workerCount,
      sourceMediaWrite: "none",
      state: summary.paused
        ? "paused"
        : summary.assetsFailed === 0 && summary.workerFailures.length === 0
          ? "bounded_run_complete"
          : "bounded_run_complete_with_failures",
    })}\n`,
  );
  if (summary.workerFailures.length > 0) process.exitCode = 1;
} finally {
  try {
    if (runLockAcquired) {
      await lockConnection`
        SELECT pg_advisory_unlock(hashtextextended(${runLockKey}, 63))
      `;
    }
  } finally {
    lockConnection.release();
    await Promise.allSettled(providers.map((provider) => provider.close()));
    await sql.end({ timeout: 5 });
  }
}
