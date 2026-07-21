import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { performance } from "node:perf_hooks";
import postgres from "postgres";
import { createImmichCompanion } from "../src/immich-companion.mjs";
import { createImmichInventorySynchronizer } from "../src/immich-inventory.mjs";
import { createLocalFaceDetectionWorker } from "../src/local-face-detection-worker.mjs";
import { createLocalFaceRecognitionWorker } from "../src/local-face-recognition-worker.mjs";
import { loadLocalMediaProviderRuntime } from "../src/local-media-provider-runtime.mjs";
import { createMediaOperator } from "../src/media-operator.mjs";
import { continueFaceDetectionPipeline } from "../src/media-pipeline.mjs";
import { createCimmichRepository } from "../src/repository.mjs";

const fixturePath = String(
  process.env.CIMMICH_PUBLIC_FIXTURE_IMAGE || "",
).trim();
const expectedFixtureDigest = String(
  process.env.CIMMICH_PUBLIC_FIXTURE_SHA256 || "",
).trim();
if (!fixturePath || !/^[0-9a-f]{64}$/.test(expectedFixtureDigest)) {
  throw new Error(
    "Stock-provider acceptance requires a public fixture path and SHA-256",
  );
}
const fixture = await readFile(fixturePath);
const fixtureDigest = createHash("sha256").update(fixture).digest("hex");
assert.equal(fixtureDigest, expectedFixtureDigest);

const assetId = "11111111-1111-4111-8111-111111111135";
const upstreamAsset = {
  checksum: Buffer.from(fixtureDigest, "hex").toString("base64"),
  createdAt: "2020-01-09T00:00:00.000Z",
  duration: null,
  fileCreatedAt: "2020-01-09T00:00:00.000Z",
  fileModifiedAt: "2020-01-09T00:00:00.000Z",
  height: 1600,
  id: assetId,
  isArchived: false,
  isFavorite: false,
  isOffline: false,
  isTrashed: false,
  localDateTime: "2020-01-09T00:00:00.000Z",
  originalFileName: "public-domain-nasa-portrait.jpg",
  originalMimeType: "image/jpeg",
  originalPath: "/must/not/project/public-domain-nasa-portrait.jpg",
  ownerId: "22222222-2222-4222-8222-222222222235",
  type: "IMAGE",
  updatedAt: "2026-07-16T00:00:00.000Z",
  visibility: "timeline",
  width: 1280,
};
const requests = [];
const upstream = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  requests.push({
    method: request.method,
    path: request.url,
    body: body ? JSON.parse(body) : null,
  });
  if (request.url === "/api/server/version") {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ major: 3, minor: 0, patch: 3 }));
    return;
  }
  if (request.headers["x-api-key"] !== "public-fixture-only-key") {
    response.setHeader("content-type", "application/json");
    response.statusCode = 401;
    response.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }
  if (request.url === "/api/users/me") {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ id: upstreamAsset.ownerId, isAdmin: false }));
    return;
  }
  if (request.url === `/api/assets/${assetId}`) {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(upstreamAsset));
    return;
  }
  if (request.url === `/api/assets/${assetId}/original`) {
    response.setHeader("content-length", fixture.length);
    response.setHeader("content-type", "image/jpeg");
    response.end(fixture);
    return;
  }
  if (request.url === "/api/search/metadata") {
    const visibility = JSON.parse(body).visibility;
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        albums: { items: [], total: 0 },
        assets: {
          count: visibility === "timeline" ? 1 : 0,
          facets: [],
          items: visibility === "timeline" ? [upstreamAsset] : [],
          nextPage: null,
          total: visibility === "timeline" ? 1 : 0,
        },
      }),
    );
    return;
  }
  response.setHeader("content-type", "application/json");
  response.statusCode = 404;
  response.end(JSON.stringify({ error: "not found" }));
});

await new Promise((resolve, reject) => {
  upstream.once("error", reject);
  upstream.listen(0, "127.0.0.1", resolve);
});

const databaseUrl =
  process.env.DATABASE_URL || "postgres://cimmich@postgres:5432/cimmich";
const sql = postgres(databaseUrl, { max: 3, prepare: true });

try {
  const address = upstream.address();
  const companion = createImmichCompanion({
    apiBaseUrl: `http://127.0.0.1:${address.port}`,
    apiKey: "public-fixture-only-key",
    maxImageBytes: 20 * 1024 * 1024,
  });
  const runtime = await loadLocalMediaProviderRuntime();
  assert.equal(runtime.enabled, true);
  const inventory = createImmichInventorySynchronizer({
    companion,
    job: runtime.inventoryJob,
    pageSize: 1,
    sourceId: "stock-compatible-public-fixture",
    sql,
  });
  const repository = createCimmichRepository(sql);
  const detectionWorker = createLocalFaceDetectionWorker({
    companion,
    detector: runtime.detector,
    manifest: runtime.detectorManifest,
    sql,
    workerId: "stock-provider-detector",
  });
  const recognitionWorker = createLocalFaceRecognitionWorker({
    companion,
    manifest: runtime.recognitionManifest,
    recognizer: runtime.recognizer,
    sql,
    workerId: "stock-provider-recognizer",
  });
  const operator = createMediaOperator({
    continueDetection: (detectionJobId) =>
      continueFaceDetectionPipeline(sql, {
        detectionJobId,
        detectorManifest: runtime.detectorManifest,
        manifest: runtime.pipelineManifest,
        recognitionManifest: runtime.recognitionManifest,
      }),
    detectionWorker,
    inventory,
    providerReceipt: runtime.providerReceipt,
    recognitionWorker,
    repository,
    sql,
    workerId: "stock-provider-operator",
  });

  const rssBefore = process.memoryUsage().rss;
  const cpuBefore = process.cpuUsage();
  const wallStarted = performance.now();
  const result = await operator.execute({
    actorId: "stock-provider-acceptance",
    commandId: "stock-provider-run-0001",
    commandKind: "run",
    envelope: {
      candidateLimit: 24,
      leaseSeconds: 120,
      maxDetectionJobs: 1,
      maxDurationMs: 120_000,
      maxInventoryPages: 1,
      maxPendingJobs: 10,
      maxRecognitionJobs: 1,
    },
  });
  const wallDurationMs = Math.round(performance.now() - wallStarted);
  const cpu = process.cpuUsage(cpuBefore);
  const rssAfter = process.memoryUsage().rss;
  assert.deepEqual(result.work, {
    candidates: 0,
    detections: 1,
    inventoryPages: 1,
    recognitions: 1,
  });
  assert.equal(result.activationAuthority, "none");
  assert.equal(result.state, "completed");

  const [databaseProof] = await sql`
    SELECT
      (SELECT count(*)::int FROM face_detection_result
       WHERE outcome = 'faces_detected') AS detection_results,
      (SELECT count(*)::int
       FROM face_detection_result_observation) AS observations,
      (SELECT count(*)::int FROM face_embedding
       WHERE config_digest = ${runtime.recognitionManifest.providerConfigDigest}) AS embeddings,
      (SELECT count(*)::int FROM identity_claim) AS identity_claims,
      (SELECT count(*)::int FROM media_pipeline_run
       WHERE state = 'recognized') AS recognized_pipelines
  `;
  assert.deepEqual(databaseProof, {
    detection_results: 1,
    embeddings: 1,
    identity_claims: 0,
    observations: 1,
    recognized_pipelines: 1,
  });
  const [{ durable_source_bytes: durableSourceBytes }] = await sql`
    SELECT count(*)::int AS durable_source_bytes
    FROM media_job
    WHERE checkpoint_payload::text LIKE ${`%${fixture.toString("base64").slice(0, 128)}%`}
  `;
  assert.equal(durableSourceBytes, 0);
  const originalReadsBeforeReplay = requests.filter((request) =>
    request.path.endsWith("/original"),
  ).length;
  const replay = await operator.execute({
    actorId: "stock-provider-acceptance",
    commandId: "stock-provider-run-0001",
    commandKind: "run",
    envelope: {
      candidateLimit: 24,
      leaseSeconds: 120,
      maxDetectionJobs: 1,
      maxDurationMs: 120_000,
      maxInventoryPages: 1,
      maxPendingJobs: 10,
      maxRecognitionJobs: 1,
    },
  });
  assert.equal(replay.replayed, true);
  assert.equal(
    requests.filter((request) => request.path.endsWith("/original")).length,
    originalReadsBeforeReplay,
  );
  const status = await operator.status();
  assert.equal(status.provider.state, "ready");
  assert.equal(JSON.stringify(status).includes(fixturePath), false);
  assert.equal(JSON.stringify(status).includes("originalPath"), false);

  process.stdout.write(
    `${JSON.stringify({
      activationAuthority: result.activationAuthority,
      database: databaseProof,
      fixtureBytes: fixture.length,
      fixtureSha256: fixtureDigest,
      originalReads: originalReadsBeforeReplay,
      provider: status.provider,
      replayedWithoutRead: replay.replayed,
      resources: {
        nodeCpuSystemMs: Math.round(cpu.system / 1_000),
        nodeCpuUserMs: Math.round(cpu.user / 1_000),
        nodeRssAfterBytes: rssAfter,
        nodeRssBeforeBytes: rssBefore,
        wallDurationMs,
      },
      schemaVersion: result.schemaVersion,
      sourceMutation: "none",
      status: "PASS",
      upstream: {
        immichVersion: "3.0.3",
        originalReads: originalReadsBeforeReplay,
        requestCount: requests.length,
      },
      work: result.work,
    })}\n`,
  );
} finally {
  await sql.end({ timeout: 5 });
  await new Promise((resolve) => upstream.close(resolve));
}
