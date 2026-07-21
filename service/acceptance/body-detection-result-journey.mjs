import assert from "node:assert/strict";
import postgres from "postgres";
import {
  bodyDetectionResultSchemaVersion,
  bodyDetectorSchemaVersion,
  deriveBodyDetectorConfigDigest,
  validateBodyDetectionResult,
} from "../src/body-detector-contract.mjs";
import {
  createBodyDetectionResultRepository,
  deriveRepositoryBodyAssetToken,
} from "../src/body-detection-result-repository.mjs";

const digest = (character) => character.repeat(64);
const databaseUrl =
  process.env.DATABASE_URL || "postgres://cimmich@postgres:5432/cimmich";
const sql = postgres(databaseUrl, { max: 2, prepare: true });

try {
  const [projection] = await sql`
    SELECT projection.cimmich_asset_id AS asset_id, projection.input_revision
    FROM immich_asset_projection projection
    JOIN asset ON asset.asset_id = projection.cimmich_asset_id
      AND asset.state = 'active'
    WHERE projection.state = 'active'
      AND cimmich_visibility_asset_rank(asset.asset_id) <= 1
    ORDER BY projection.last_seen_at DESC, projection.cimmich_asset_id
    LIMIT 1
  `;
  assert.ok(projection, "a current visible synthetic asset is required");
  const coreManifest = {
    detector: {
      artifactDigest: digest("a"),
      modelId: "synthetic-body-detector",
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
    provider: { providerId: "synthetic-provider", versionId: "v1" },
    resources: { maxMemoryMiB: 1024, maxRuntimeMs: 30_000 },
    schemaVersion: bodyDetectorSchemaVersion,
  };
  const manifest = {
    ...coreManifest,
    detectorConfigDigest: deriveBodyDetectorConfigDigest(coreManifest),
  };
  const validation = validateBodyDetectionResult(
    {
      assetToken: deriveRepositoryBodyAssetToken({
        assetId: projection.asset_id,
        detectorConfigDigest: manifest.detectorConfigDigest,
        inputRevision: projection.input_revision,
      }),
      bodies: [
        {
          box: { h: 0.5, w: 0.2, x: 0.7, y: 0.4 },
          confidence: 0.9,
          quality: { occlusion: 0.1, truncation: 0, visibility: 0.95 },
        },
      ],
      detectorConfigDigest: manifest.detectorConfigDigest,
      inputRevision: projection.input_revision,
      schemaVersion: bodyDetectionResultSchemaVersion,
      sourceContentDigest: digest("d"),
      state: "bodies_detected",
    },
    manifest,
  );
  const before = (
    await sql`
      SELECT (SELECT count(*)::int FROM identity_claim) AS claims,
        (SELECT count(*)::int FROM body_tag) AS tags,
        (SELECT count(*)::int FROM body_observation) AS bodies,
        (SELECT count(*)::int FROM body_detection_result) AS results
    `
  )[0];
  const repository = createBodyDetectionResultRepository(sql, {
    presentationRank: () => 1,
  });
  const first = await repository.commit({
    assetId: projection.asset_id,
    validation,
  });
  const replay = await repository.commit({
    assetId: projection.asset_id,
    validation,
  });
  assert.equal(first.changed, true);
  assert.equal(first.providerExecutionProof, "none");
  assert.equal(replay.changed, false);
  assert.equal(replay.replayed, true);
  const [current] = await sql`
    SELECT count(*)::int AS count
    FROM current_body_detection_result_observation
    WHERE detection_result_id = ${first.detectionResultId}
  `;
  assert.equal(current.count, 1);
  await assert.rejects(
    sql`UPDATE body_detection_result SET body_count = body_count WHERE detection_result_id = ${first.detectionResultId}`,
    (error) => error.code === "23514",
  );
  const after = (
    await sql`
      SELECT (SELECT count(*)::int FROM identity_claim) AS claims,
        (SELECT count(*)::int FROM body_tag) AS tags,
        (SELECT count(*)::int FROM body_observation) AS bodies,
        (SELECT count(*)::int FROM body_detection_result) AS results
    `
  )[0];
  assert.equal(after.claims, before.claims);
  assert.equal(after.tags, before.tags);
  assert.equal(after.bodies, before.bodies + 1);
  assert.equal(after.results, before.results + 1);
  process.stdout.write(
    `${JSON.stringify({
      automaticIdentityAuthority: "none",
      bodyCount: first.bodyCount,
      providerExecutionProof: "none",
      replayed: replay.replayed,
      repositoryWrites: "body_result_only",
      resultDigest: first.resultDigest,
      schemaVersion: first.schemaVersion,
      sourceMediaRead: "none",
      status: "PASS",
    })}\n`,
  );
} finally {
  await sql.end({ timeout: 5 });
}
