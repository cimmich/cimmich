import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import postgres from "postgres";
import { createLocalFaceDetectionWorker } from "../src/local-face-detection-worker.mjs";
import { createMediaJobLedger } from "../src/media-job-ledger.mjs";
import { faceDetectorManifestFixture as manifest } from "../test/fixtures/face-detector-manifest.mjs";

const databaseUrl =
  process.env.DATABASE_URL || "postgres://cimmich@postgres:5432/cimmich";
const sql = postgres(databaseUrl, { max: 2, prepare: true });
const ledger = createMediaJobLedger(sql);
let failNext = false;

try {
  const projections = await sql`
    SELECT immich_asset_id, cimmich_asset_id, input_revision
    FROM immich_asset_projection
    WHERE source_id = 'synthetic-immich-primary'
      AND state = 'active' AND asset_type = 'image'
    ORDER BY immich_asset_id
  `;
  assert.equal(projections.length, 2);
  const byImmichId = new Map(
    projections.map((row) => [row.immich_asset_id, row]),
  );
  for (const projection of projections) {
    await ledger.enqueue({
      assetId: projection.cimmich_asset_id,
      configDigest: manifest.detectorConfigDigest,
      inputRevision: projection.input_revision,
      operation: "detect_faces",
      toolVersion: "synthetic-local-detector-v1",
    });
  }

  const companion = {
    async readAssetImage({ assetId }) {
      const projection = byImmichId.get(assetId);
      if (!projection)
        throw Object.assign(new Error("missing"), {
          code: "IMMICH_ASSET_NOT_FOUND",
        });
      const bytes = Buffer.from(`synthetic-image:${assetId}`);
      return {
        asset: {
          assetType: "image",
          immichAssetId: assetId,
          inputRevision: projection.input_revision,
        },
        byteLength: bytes.length,
        bytes,
        contentDigest: createHash("sha256").update(bytes).digest("hex"),
        mimeType: "image/jpeg",
        sourceAccess: "immich-api-read-only",
      };
    },
  };
  const detector = {
    async detect({ asset }) {
      if (failNext) {
        failNext = false;
        throw new Error("synthetic interruption");
      }
      return asset.immichAssetId === "inventory-a"
        ? {
            faces: [
              {
                box: { x: 0.2, y: 0.1, w: 0.3, h: 0.4 },
                confidence: 0.97,
                quality: {
                  quality_bucket: "clean_core",
                  quality_score: 0.95,
                  route: "synthetic-general-detection",
                },
              },
            ],
            state: "faces_detected",
          }
        : { faces: [], state: "no_face" };
    },
  };
  const worker = createLocalFaceDetectionWorker({
    companion,
    detector,
    manifest,
    sql,
    workerId: "synthetic-face-detection-worker",
  });
  const first = await worker.runNext();
  const second = await worker.runNext();
  assert.deepEqual(
    new Set([first.outcome, second.outcome]),
    new Set(["faces_detected", "no_face"]),
  );
  assert.equal(first.status, "completed");
  assert.equal(second.status, "completed");

  const outcomes = await sql`
    SELECT result.outcome, result.face_count
    FROM face_detection_result result
    JOIN immich_asset_projection projection
      ON projection.cimmich_asset_id = result.asset_id
      AND projection.source_id = 'synthetic-immich-primary'
    ORDER BY result.outcome
  `;
  assert.deepEqual(
    outcomes.map((row) => ({ ...row })),
    [
      { face_count: 1, outcome: "faces_detected" },
      { face_count: 0, outcome: "no_face" },
    ],
  );
  const [{ count: detectedFaces }] = await sql`
    SELECT count(*)::int AS count
    FROM face_detection_result_observation observation
    JOIN face_detection_result result
      ON result.detection_result_id = observation.detection_result_id
    JOIN immich_asset_projection projection
      ON projection.cimmich_asset_id = result.asset_id
      AND projection.source_id = 'synthetic-immich-primary'
  `;
  assert.equal(detectedFaces, 1);

  const faceProjection = projections.find(
    (row) => row.immich_asset_id === "inventory-a",
  );
  const replayJob = await ledger.enqueue({
    assetId: faceProjection.cimmich_asset_id,
    configDigest: manifest.detectorConfigDigest,
    inputRevision: faceProjection.input_revision,
    operation: "detect_faces",
    toolVersion: "synthetic-local-detector-v2",
  });
  failNext = true;
  const interrupted = await worker.runNext();
  assert.equal(interrupted.jobId, replayJob.jobId);
  assert.equal(interrupted.state, "pending");
  assert.equal(interrupted.errorCode, "LOCAL_FACE_DETECTION_FAILED");
  const resumed = await worker.runNext();
  assert.equal(resumed.jobId, replayJob.jobId);
  assert.equal(resumed.status, "completed");
  assert.deepEqual(resumed.observations, { inserted: 0, reused: 1 });

  const [privacyProof] = await sql`
    SELECT
      count(*) FILTER (WHERE checkpoint_payload::text LIKE '%synthetic-image:%')::int
        AS leaked_media_bytes,
      count(*) FILTER (WHERE state = 'completed')::int AS completed_jobs
    FROM media_job
    WHERE operation = 'detect_faces'
      AND config_digest = ${manifest.detectorConfigDigest}
  `;
  assert.equal(privacyProof.leaked_media_bytes, 0);
  assert.equal(privacyProof.completed_jobs, 3);
  const inventoryCheckpoints = await sql`
    SELECT public_details FROM media_job_event
    WHERE job_id = ${replayJob.jobId} AND event_kind = 'retry_scheduled'
  `;
  assert.equal(inventoryCheckpoints.length, 1);

  const idle = await worker.runNext();
  assert.equal(idle.state, "idle");
  process.stdout.write(
    `${JSON.stringify({
      completedJobs: privacyProof.completed_jobs,
      detectedFaces,
      noFaceDurable: outcomes.some((row) => row.outcome === "no_face"),
      replayReused: resumed.observations.reused,
      status: "PASS",
    })}\n`,
  );
} finally {
  await sql.end({ timeout: 5 });
}
