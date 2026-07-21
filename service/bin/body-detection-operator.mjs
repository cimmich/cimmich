#!/usr/bin/env node

import process from "node:process";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import {
  completeAssetSourceRead,
  createAssetSourceRevisionRepository,
} from "../src/asset-source-revision.mjs";
import { createBodyDetectionResultRepository } from "../src/body-detection-result-repository.mjs";
import {
  createBodyPoseCurrentProjectionRepository,
  consumeCurrentBodyPoseProjection,
} from "../src/body-pose-current-projection.mjs";
import { createBodyPoseEvidenceRepository } from "../src/body-pose-evidence-repository.mjs";
import {
  bodyPoseEvaluationSchemaVersion,
  validateBodyPoseEvidence,
} from "../src/body-pose-provider-contract.mjs";
import { bodyDetectionDigest } from "../src/body-detector-contract.mjs";
import {
  applyFaceBodyLinks,
  buildFaceBodyLinks,
  loadFaceBodyLinkAssets,
} from "../src/face-body-linker-repository.mjs";
import { createImmichCompanion } from "../src/immich-companion.mjs";
import {
  assembleLocalBodyDetectionResult,
  prepareLocalBodyDetectionJobFromSourceRead,
} from "../src/local-body-detection-worker.mjs";
import { prepareLocalBodyPoseJobFromCurrent } from "../src/local-body-pose-worker.mjs";

const readInput = async () => {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 4 * 1024 * 1024)
      throw new Error("BODY_OPERATOR_INPUT_TOO_LARGE");
    chunks.push(Buffer.from(chunk));
  }
  const value = JSON.parse(Buffer.concat(chunks, size).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("BODY_OPERATOR_INPUT_INVALID");
  }
  return value;
};

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
if (!databaseUrl) throw new Error("BODY_OPERATOR_DATABASE_UNAVAILABLE");
const sql = postgres(databaseUrl, { max: 2, prepare: true });
const presentationRank = () => 3;
const configuredApiKey = String(process.env.IMMICH_API_KEY || "").trim();
const credential = configuredApiKey
  ? null
  : JSON.parse(
      await readFile(
        process.env.CIMMICH_IMMICH_CREDENTIAL_PATH ||
          "/demo-state/immich-credential.json",
        "utf8",
      ),
    );
const immich = createImmichCompanion({
  apiBaseUrl: process.env.IMMICH_API_URL || "",
  apiKey: configuredApiKey || credential?.apiKey || "",
});
const sourceRepository = createAssetSourceRevisionRepository(sql, {
  presentationRank,
});

const readCurrentSource = async (sourceAssetId) => {
  const stableSourceAssetId = String(sourceAssetId || "").trim();
  const [projection] = await sql`
    SELECT projection.cimmich_asset_id AS asset_id,
      projection.immich_asset_id AS source_asset_id
    FROM immich_asset_projection projection
    JOIN asset ON asset.asset_id = projection.cimmich_asset_id
      AND asset.state = 'active' AND asset.media_kind = 'image'
    WHERE projection.immich_asset_id = ${stableSourceAssetId}
      AND projection.state = 'active'
      AND projection.source_id = ${process.env.CIMMICH_IMMICH_SOURCE_ID || "immich-primary"}
      AND cimmich_visibility_asset_rank(asset.asset_id) <= 3
  `;
  if (!projection) throw new Error("BODY_OPERATOR_SOURCE_NOT_VISIBLE");
  const current = await immich.getAsset({ assetId: stableSourceAssetId });
  if (current.asset.immichAssetId !== stableSourceAssetId) {
    throw new Error("BODY_OPERATOR_SOURCE_REVISION_CHANGED");
  }
  const media = await immich.readAssetImage({ assetId: stableSourceAssetId });
  if (
    media.asset.immichAssetId !== stableSourceAssetId ||
    media.asset.inputRevision !== current.asset.inputRevision
  ) {
    throw new Error("BODY_OPERATOR_SOURCE_REVISION_CHANGED");
  }
  const sourceBindingDigest = bodyDetectionDigest({
    assetId: projection.asset_id,
    companionInputRevision: current.asset.inputRevision,
    schemaVersion: "cimmich.body-detection-companion-binding.v1",
    sourceAssetId: stableSourceAssetId,
  });
  const preparedRead = await sourceRepository.prepare({
    assetId: projection.asset_id,
    sourceAccess: "immich_api_read_only",
    sourceBindingDigest,
  });
  return {
    assetId: projection.asset_id,
    bytes: media.bytes,
    mimeType: media.mimeType,
    sourceAssetId: stableSourceAssetId,
    sourceRead: completeAssetSourceRead({
      bytes: media.bytes,
      prepared: preparedRead,
    }),
  };
};

try {
  const input = await readInput();
  const action = String(input.action || "");
  if (action === "list") {
    const rows = await sql`
      SELECT projection.immich_asset_id AS source_asset_id
      FROM immich_asset_projection projection
      JOIN asset ON asset.asset_id = projection.cimmich_asset_id
        AND asset.state = 'active' AND asset.media_kind = 'image'
      WHERE projection.state = 'active'
        AND projection.source_id = ${process.env.CIMMICH_IMMICH_SOURCE_ID || "immich-primary"}
        AND cimmich_visibility_asset_rank(asset.asset_id) <= 3
      ORDER BY projection.immich_asset_id
    `;
    process.stdout.write(
      `${JSON.stringify({
        items: rows.map((row) => row.source_asset_id),
        schemaVersion: "cimmich.body-detection-operator-list.v1",
      })}\n`,
    );
  } else if (action === "poseList") {
    const configDigest = String(input.detectorConfigDigest || "");
    const rows = await sql`
      SELECT DISTINCT projection.immich_asset_id AS source_asset_id
      FROM current_body_detection_result_observation current_result
      JOIN immich_asset_projection projection
        ON projection.cimmich_asset_id = current_result.asset_id
        AND projection.state = 'active'
      JOIN asset ON asset.asset_id = current_result.asset_id
        AND asset.state = 'active' AND asset.media_kind = 'image'
      WHERE current_result.detector_config_digest = ${configDigest}
        AND projection.source_id = ${process.env.CIMMICH_IMMICH_SOURCE_ID || "immich-primary"}
        AND cimmich_visibility_asset_rank(asset.asset_id) <= 3
      ORDER BY projection.immich_asset_id
    `;
    process.stdout.write(
      `${JSON.stringify({
        items: rows.map((row) => row.source_asset_id),
        schemaVersion: "cimmich.body-pose-operator-list.v1",
      })}\n`,
    );
  } else if (action === "status") {
    const configDigest = String(input.detectorConfigDigest || "");
    const [row] = await sql`
      WITH library AS (
        SELECT asset.asset_id
        FROM immich_asset_projection projection
        JOIN asset ON asset.asset_id = projection.cimmich_asset_id
          AND asset.state = 'active' AND asset.media_kind = 'image'
        WHERE projection.state = 'active'
          AND projection.source_id = ${process.env.CIMMICH_IMMICH_SOURCE_ID || "immich-primary"}
          AND cimmich_visibility_asset_rank(asset.asset_id) <= 3
      ), current_results AS (
        SELECT result.*
        FROM body_detection_result result
        JOIN current_asset_source_revision revision
          ON revision.revision_id = result.source_revision_id
          AND revision.asset_id = result.asset_id
        WHERE result.detector_config_digest = ${configDigest}
      )
      SELECT
        (SELECT count(*)::int FROM library) AS assets,
        count(DISTINCT result.asset_id)::int AS completed,
        count(DISTINCT result.asset_id) FILTER (WHERE result.outcome = 'bodies_detected')::int AS detected,
        count(DISTINCT result.asset_id) FILTER (WHERE result.outcome = 'no_body')::int AS no_body,
        coalesce(sum(result.body_count), 0)::int AS bodies,
        (SELECT count(*)::int FROM body_pose_evidence pose
          JOIN current_body_detection_result_observation current_pose
            ON current_pose.body_id = pose.body_id
          JOIN library ON library.asset_id = current_pose.asset_id
          WHERE pose.state = 'valid') AS poses,
        (SELECT count(*)::int FROM current_body_tag tag
          JOIN body_observation body ON body.body_id = tag.body_id
          JOIN library ON library.asset_id = body.asset_id
          WHERE tag.state = 'accepted' AND tag.origin = 'face_body_linkage') AS linked
      FROM library LEFT JOIN current_results result ON result.asset_id = library.asset_id
    `;
    process.stdout.write(
      `${JSON.stringify({
        assets: Number(row.assets),
        bodies: Number(row.bodies),
        completed: Number(row.completed),
        detected: Number(row.detected),
        linked: Number(row.linked),
        noBody: Number(row.no_body),
        poses: Number(row.poses),
        schemaVersion: "cimmich.body-detection-operator-status.v1",
      })}\n`,
    );
  } else {
    const source = await readCurrentSource(input.sourceAssetId);
    if (action === "read") {
      if (
        input.sourceContentDigest !== source.sourceRead.sourceContentDigest ||
        input.inputRevision !== source.sourceRead.inputRevision
      ) {
        throw new Error("BODY_OPERATOR_SOURCE_REVISION_CHANGED");
      }
      process.stdout.write(source.bytes);
    } else if (action === "posePrepare" || action === "poseCommit") {
      const currentRepository = createBodyPoseCurrentProjectionRepository(sql, {
        presentationRank,
      });
      const current = await currentRepository.load({
        assetId: source.assetId,
        detectorManifest: input.detectorManifest,
      });
      const prepared = prepareLocalBodyPoseJobFromCurrent({
        current,
        manifest: input.poseManifest,
      });
      const bodyValidation =
        consumeCurrentBodyPoseProjection(current).validation;
      if (action === "posePrepare") {
        process.stdout.write(
          `${JSON.stringify({
            assetToken: bodyValidation.result.assetToken,
            bodyCount: current.bodyCount,
            inputRevision: current.inputRevision,
            mimeType: source.mimeType,
            requestDigest: prepared.requestDigest,
            sourceAssetId: source.sourceAssetId,
            sourceContentDigest: bodyValidation.result.sourceContentDigest,
          })}\n`,
        );
      } else {
        if (input.requestDigest !== prepared.requestDigest) {
          throw new Error("BODY_POSE_OPERATOR_PREPARATION_CHANGED");
        }
        const validation = validateBodyPoseEvidence({
          bodyValidation,
          manifest: input.poseManifest,
          policy: input.policy,
          runs: [input.first, input.second],
          schemaVersion: bodyPoseEvaluationSchemaVersion,
        });
        const repository = createBodyPoseEvidenceRepository(sql, {
          presentationRank,
        });
        const commit = await repository.commit({ current, validation });
        process.stdout.write(
          `${JSON.stringify({
            ...commit,
            providerRuns: 2,
            replayEvidence: validation.replayEvidence,
            sourceCurrent: true,
          })}\n`,
        );
      }
    } else {
      const prepared = prepareLocalBodyDetectionJobFromSourceRead({
        manifest: input.manifest,
        sourceRead: source.sourceRead,
      });
      if (action === "prepare") {
        process.stdout.write(
          `${JSON.stringify({
            assetToken: prepared.assetToken,
            inputRevision: prepared.inputRevision,
            mimeType: source.mimeType,
            requestDigest: prepared.requestDigest,
            sourceAssetId: source.sourceAssetId,
            sourceContentDigest: source.sourceRead.sourceContentDigest,
          })}\n`,
        );
      } else if (action === "commit") {
        if (input.requestDigest !== prepared.requestDigest) {
          throw new Error("BODY_OPERATOR_PREPARATION_CHANGED");
        }
        const validation = assembleLocalBodyDetectionResult({
          prepared,
          runs: [input.first, input.second],
          sourceContentDigest: source.sourceRead.sourceContentDigest,
        });
        const repository = createBodyDetectionResultRepository(sql, {
          presentationRank,
        });
        const commit = await repository.commit({
          assetId: source.assetId,
          sourceRead: source.sourceRead,
          validation,
        });
        const assets = await loadFaceBodyLinkAssets(sql, source.assetId);
        const proposal = buildFaceBodyLinks(assets);
        const linkage = await applyFaceBodyLinks(sql, proposal, {
          execute: true,
        });
        process.stdout.write(
          `${JSON.stringify({
            bodyCount: commit.bodyCount,
            changed: commit.changed,
            linkage,
            providerRuns: 2,
            replayed: commit.replayed,
            schemaVersion: "cimmich.body-detection-operator-receipt.v1",
            sourceCurrent: true,
            state: commit.state,
          })}\n`,
        );
      } else {
        throw new Error("BODY_OPERATOR_ACTION_INVALID");
      }
    }
  }
} catch (error) {
  const stableCode = /^[A-Z][A-Z0-9_]{2,95}$/.test(String(error?.code || ""))
    ? String(error.code)
    : /^[A-Z][A-Z0-9_]{2,95}$/.test(String(error?.message || ""))
      ? String(error.message)
      : "BODY_OPERATOR_FAILED";
  process.stderr.write(
    `${JSON.stringify({
      error: { code: stableCode },
    })}\n`,
  );
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
