import assert from "node:assert/strict";
import postgres from "postgres";
import {
  commitValidatedAssetSourceRead,
  completeAssetSourceRead,
  createAssetSourceRevisionReceipt,
  createAssetSourceRevisionRepository,
} from "../src/asset-source-revision.mjs";
import {
  bodyDetectionResultSchemaVersion,
  bodyDetectorSchemaVersion,
  deriveBodyDetectorConfigDigest,
} from "../src/body-detector-contract.mjs";
import { createBodyDetectionResultRepository } from "../src/body-detection-result-repository.mjs";
import {
  assembleLocalBodyDetectionResult,
  prepareLocalBodyDetectionJobFromSourceRead,
} from "../src/local-body-detection-worker.mjs";
import {
  createBodyPoseCurrentProjectionReceipt,
  createBodyPoseCurrentProjectionRepository,
} from "../src/body-pose-current-projection.mjs";

const digest = (character) => character.repeat(64);
const databaseUrl =
  process.env.DATABASE_URL || "postgres://cimmich@postgres:5432/cimmich";
const sql = postgres(databaseUrl, { max: 2, prepare: true });
const assetId = "asset_identity_fixture";
const sourceBindingDigest = digest("e");

const coreManifest = {
  detector: {
    artifactDigest: digest("a"),
    modelId: "synthetic-local-body-detector",
    modelVersionId: "v1",
    scoreThreshold: 0.5,
  },
  execution: {
    device: "cpu",
    network: "forbidden",
    runtimeId: "synthetic-runtime",
    threads: 1,
  },
  licensing: { code: "declared", model: "unknown", trainingData: "unknown" },
  preprocessing: {
    colorSpace: "rgb",
    coordinateSpace: "normalized_image",
    inputHeight: 640,
    inputWidth: 640,
    resizeMode: "letterbox",
  },
  privacy: { externalUpload: "none", sourceMedia: "local-read-only" },
  provider: { providerId: "synthetic-local-body", versionId: "v1" },
  resources: { maxMemoryMiB: 1024, maxRuntimeMs: 30_000 },
  schemaVersion: bodyDetectorSchemaVersion,
};
const manifest = {
  ...coreManifest,
  detectorConfigDigest: deriveBodyDetectorConfigDigest(coreManifest),
};

const sourceRepository = createAssetSourceRevisionRepository(sql, {
  presentationRank: () => 1,
});
const bodyRepository = createBodyDetectionResultRepository(sql, {
  presentationRank: () => 1,
});

const read = async (bytes, bindingDigest = sourceBindingDigest) =>
  completeAssetSourceRead({
    bytes,
    prepared: await sourceRepository.prepare({
      assetId,
      sourceAccess: "operator_local_read_only",
      sourceBindingDigest: bindingDigest,
    }),
  });

const validationFor = (sourceRead, runPrefix, x = 0.78) => {
  const prepared = prepareLocalBodyDetectionJobFromSourceRead({
    manifest,
    sourceRead,
  });
  const result = {
    assetToken: prepared.assetToken,
    bodies: [
      {
        box: { h: 0.45, w: 0.18, x, y: 0.5 },
        confidence: 0.9,
        quality: { occlusion: 0.1, visibility: 0.95 },
      },
    ],
    detectorConfigDigest: prepared.detectorConfigDigest,
    inputRevision: sourceRead.inputRevision,
    schemaVersion: bodyDetectionResultSchemaVersion,
    sourceContentDigest: sourceRead.sourceContentDigest,
    state: "bodies_detected",
  };
  return assembleLocalBodyDetectionResult({
    prepared,
    runs: [
      { result, runId: `${runPrefix}-a` },
      { result, runId: `${runPrefix}-b` },
    ],
    sourceContentDigest: sourceRead.sourceContentDigest,
  });
};

try {
  const [before] = await sql`
    SELECT (SELECT count(*)::int FROM identity_claim) AS claims,
      (SELECT count(*)::int FROM body_tag) AS tags
  `;
  const sourceRead = await read(Buffer.from("synthetic local body source v1"));
  const validation = validationFor(sourceRead, "synthetic-source-read");
  const committed = await bodyRepository.commit({
    assetId,
    sourceRead,
    validation,
  });
  const replay = await bodyRepository.commit({
    assetId,
    sourceRead,
    validation,
  });
  assert.equal(committed.repositoryWrites, "source_revision_and_body_result");
  assert.equal(replay.repositoryWrites, "none");
  assert.equal(replay.replayed, true);

  const current = await createBodyPoseCurrentProjectionRepository(sql, {
    presentationRank: () => 1,
  }).load({ assetId, detectorManifest: manifest });
  const currentReceipt = createBodyPoseCurrentProjectionReceipt(current);
  assert.equal(current.proof, "current_at_last_validated_read");
  assert.equal(current.sourceKind, "operator_local_read_only");
  assert.equal(currentReceipt.bodyCount, 1);

  const alternateRead = await read(
    Buffer.from("synthetic local body source v1"),
    digest("f"),
  );
  const alternateValidation = validationFor(
    alternateRead,
    "synthetic-alternate-source-read",
    0.12,
  );
  const alternateCommit = await bodyRepository.commit({
    assetId,
    sourceRead: alternateRead,
    validation: alternateValidation,
  });
  const selectedAlternate = await sql`
    SELECT DISTINCT detection_result_id
    FROM current_body_detection_result_observation
    WHERE asset_id = ${assetId}
      AND detector_config_digest = ${manifest.detectorConfigDigest}
  `;
  assert.deepEqual(Array.from(selectedAlternate), [
    { detection_result_id: alternateCommit.detectionResultId },
  ]);

  const changedAlternateRead = await read(
    Buffer.from("synthetic alternate source v2 changed"),
    digest("f"),
  );
  await sql.begin((tx) =>
    commitValidatedAssetSourceRead(tx, {
      presentationRank: () => 1,
      sourceRead: changedAlternateRead,
    }),
  );
  const fallbackOriginal = await sql`
    SELECT DISTINCT detection_result_id
    FROM current_body_detection_result_observation
    WHERE asset_id = ${assetId}
      AND detector_config_digest = ${manifest.detectorConfigDigest}
  `;
  assert.deepEqual(Array.from(fallbackOriginal), [
    { detection_result_id: committed.detectionResultId },
  ]);

  const changedRead = await read(
    Buffer.from("synthetic local body source v2 changed"),
  );
  await sql.begin((tx) =>
    commitValidatedAssetSourceRead(tx, {
      presentationRank: () => 1,
      sourceRead: changedRead,
    }),
  );
  const [stale] = await sql`
    SELECT count(*)::int AS count
    FROM current_body_detection_result_observation
    WHERE detection_result_id = ${committed.detectionResultId}
  `;
  assert.equal(stale.count, 0);
  await assert.rejects(
    createBodyPoseCurrentProjectionRepository(sql, {
      presentationRank: () => 1,
    }).load({ assetId, detectorManifest: manifest }),
    (error) => error.code === "BODY_POSE_CURRENT_UNAVAILABLE",
  );
  await assert.rejects(
    sql`UPDATE asset_source_revision SET byte_length = byte_length WHERE revision_id = ${sourceRead.revisionId}`,
    (error) => error.code === "23514",
  );
  const [after] = await sql`
    SELECT (SELECT count(*)::int FROM identity_claim) AS claims,
      (SELECT count(*)::int FROM body_tag) AS tags
  `;
  assert.deepEqual(after, before);
  const receipt = createAssetSourceRevisionReceipt(sourceRead);
  assert.doesNotMatch(
    JSON.stringify(receipt),
    /asset_identity_fixture|sourceContentDigest|sourceBindingDigest/,
  );
  process.stdout.write(
    `${JSON.stringify({
      automaticIdentityAuthority: "none",
      currentProof: current.proof,
      identityWrites: "none",
      immichWrites: "none",
      receiptDigest: receipt.receiptDigest,
      replayed: replay.replayed,
      scopedSourceSelection: "exact_latest_current_binding",
      staleAfterChangedRead: stale.count === 0,
      status: "PASS",
    })}\n`,
  );
} finally {
  await sql.end({ timeout: 5 });
}
