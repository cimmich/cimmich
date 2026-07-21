import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import postgres from "postgres";
import { createImmichCompanion } from "../src/immich-companion.mjs";
import { IMMICH_READ_ONLY_COMPANION_PERMISSIONS } from "../src/immich-companion-permissions.mjs";
import { createImmichInventorySynchronizer } from "../src/immich-inventory.mjs";
import { createImmichOnboarding } from "../src/immich-onboarding.mjs";
import { createLocalFaceDetectionWorker } from "../src/local-face-detection-worker.mjs";
import { createLocalFaceRecognitionWorker } from "../src/local-face-recognition-worker.mjs";
import { loadLocalMediaProviderRuntime } from "../src/local-media-provider-runtime.mjs";
import { createMediaOperator } from "../src/media-operator.mjs";
import { continueFaceDetectionPipeline } from "../src/media-pipeline.mjs";
import { createCimmichRepository } from "../src/repository.mjs";

const apiBaseUrl = String(process.env.IMMICH_API_URL || "").trim();
const receiptPath = String(
  process.env.CIMMICH_STOCK_BOOTSTRAP_RECEIPT || "",
).trim();
const fixturePath = String(
  process.env.CIMMICH_PUBLIC_FIXTURE_IMAGE || "",
).trim();
const expectedFixtureDigest = String(
  process.env.CIMMICH_PUBLIC_FIXTURE_SHA256 || "",
).trim();
if (
  !apiBaseUrl ||
  !receiptPath ||
  !fixturePath ||
  !/^[0-9a-f]{64}$/.test(expectedFixtureDigest)
) {
  throw new Error(
    "Stock Immich lifecycle acceptance configuration is incomplete",
  );
}

const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
assert.equal(receipt.fixtureSha256, expectedFixtureDigest);
assert.equal(typeof receipt.apiKey, "string");
assert.equal(typeof receipt.assetId, "string");
assert.deepEqual(receipt.permissions, IMMICH_READ_ONLY_COMPANION_PERMISSIONS);
const fixture = await readFile(fixturePath);
assert.equal(
  createHash("sha256").update(fixture).digest("hex"),
  expectedFixtureDigest,
);

const requests = [];
const countedFetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  requests.push({ method: init.method || "GET", path: url.pathname });
  return fetch(input, init);
};
const companion = createImmichCompanion({
  apiBaseUrl,
  apiKey: receipt.apiKey,
  fetchImpl: countedFetch,
  maxImageBytes: 20 * 1024 * 1024,
  timeoutMs: 15_000,
});
const companionStatus = await companion.status();
assert.equal(companionStatus.state, "ready");
assert.equal(companionStatus.immichVersion, "3.0.3");
assert.equal(companionStatus.permissionVerification, "not_performed");
assert.equal(Object.values(companionStatus.capabilities).some(Boolean), false);
const permissionReceipt = await companion.verifyOnboardingPermissions();
assert.equal(permissionReceipt.permissionVerification, "verified");
assert.equal(permissionReceipt.permissions.peopleRead, "verified");
assert.equal(permissionReceipt.permissions.assetSearch, "verified");
assert.equal(permissionReceipt.permissions.faceRead, "verified");

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const sql = postgres(databaseUrl, { max: 3, prepare: true });

try {
  const runtime = await loadLocalMediaProviderRuntime();
  assert.equal(runtime.enabled, true);
  const inventory = createImmichInventorySynchronizer({
    companion,
    job: runtime.inventoryJob,
    pageSize: 100,
    sourceId: "actual-stock-immich-v3-0-3",
    sql,
  });
  const onboarding = createImmichOnboarding({
    companion,
    immichInventory: inventory,
    sourceId: "actual-stock-immich-v3-0-3",
    sql,
  });
  const onboardingScope = {
    importPeople: true,
    includeHiddenPeople: false,
    mediaKinds: ["image", "video"],
    providerMode: "deferred",
    visibilities: ["timeline"],
  };
  const onboardingPreview = await onboarding.preview({
    scope: onboardingScope,
    viewingMode: "Standard",
  });
  assert.equal(onboardingPreview.connection.permissionVerification, "verified");
  assert.equal(onboardingPreview.counts.assets, 1);
  assert.equal(onboardingPreview.counts.people, 0);
  const onboardingImport = await onboarding.importCurrent({
    actorId: "stock-immich-owner",
    commandId: "stock-immich-onboarding-import-0001",
    previewDigest: onboardingPreview.previewDigest,
    scope: onboardingScope,
    viewingMode: "Standard",
  });
  assert.equal(onboardingImport.state, "completed");
  const onboardingReplay = await onboarding.importCurrent({
    actorId: "stock-immich-owner",
    commandId: "stock-immich-onboarding-import-0001",
    previewDigest: onboardingPreview.previewDigest,
    scope: onboardingScope,
    viewingMode: "Standard",
  });
  assert.equal(onboardingReplay.replayed, true);
  const repository = createCimmichRepository(sql);
  const detectionWorker = createLocalFaceDetectionWorker({
    companion,
    detector: runtime.detector,
    manifest: runtime.detectorManifest,
    sql,
    workerId: "stock-immich-detector",
  });
  const recognitionWorker = createLocalFaceRecognitionWorker({
    companion,
    manifest: runtime.recognitionManifest,
    recognizer: runtime.recognizer,
    sql,
    workerId: "stock-immich-recognizer",
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
    workerId: "stock-immich-operator",
  });
  const rssBefore = process.memoryUsage().rss;
  const cpuBefore = process.cpuUsage();
  const wallStarted = performance.now();
  const attempts = [];
  let result;
  let successfulCommand;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const command = {
      actorId: "stock-immich-lifecycle-acceptance",
      commandId: `stock-immich-lifecycle-run-${String(attempt).padStart(4, "0")}`,
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
    };
    result = await operator.execute(command);
    attempts.push({ command, work: result.work });
    const [{ recognized }] = await sql`
      SELECT count(*)::int AS recognized
      FROM media_pipeline_run WHERE state = 'recognized'
    `;
    if (recognized === 1) {
      successfulCommand = command;
      break;
    }
  }
  const wallDurationMs = Math.round(performance.now() - wallStarted);
  const cpu = process.cpuUsage(cpuBefore);
  const rssAfter = process.memoryUsage().rss;
  assert.ok(successfulCommand, "Stock Immich revision drift did not converge");
  assert.equal(result.activationAuthority, "none");
  assert.equal(result.state, "completed");

  const [databaseProof] = await sql`
    SELECT
      (SELECT count(*)::int FROM immich_asset_projection
       WHERE source_id = 'actual-stock-immich-v3-0-3') AS projected_assets,
      (SELECT count(*)::int FROM face_detection_result
       WHERE outcome = 'faces_detected') AS detection_results,
      (SELECT count(*)::int FROM face_detection_result_observation) AS observations,
      (SELECT count(*)::int FROM face_embedding
       WHERE config_digest = ${runtime.recognitionManifest.providerConfigDigest}) AS embeddings,
      (SELECT count(*)::int FROM identity_claim) AS identity_claims,
      (SELECT count(*)::int FROM media_pipeline_run
       WHERE state = 'recognized') AS recognized_pipelines
  `;
  assert.equal(databaseProof.projected_assets, 1);
  assert.ok(databaseProof.detection_results >= 1);
  assert.ok(databaseProof.observations >= 1);
  assert.equal(databaseProof.embeddings, 1);
  assert.equal(databaseProof.identity_claims, 0);
  assert.equal(databaseProof.recognized_pipelines, 1);
  const [{ revision_recoveries: revisionRecoveries }] = await sql`
    SELECT count(*)::int AS revision_recoveries
    FROM media_job
    WHERE last_error_code IN (
      'ASSET_REVISION_CHANGED', 'INPUT_REVISION_SUPERSEDED'
    )
  `;
  const [{ durable_source_bytes: durableSourceBytes }] = await sql`
    SELECT count(*)::int AS durable_source_bytes
    FROM media_job
    WHERE checkpoint_payload::text LIKE ${`%${fixture.toString("base64").slice(0, 128)}%`}
  `;
  assert.equal(durableSourceBytes, 0);

  const originalReadsBeforeReplay = requests.filter((request) =>
    request.path.endsWith("/original"),
  ).length;
  const replay = await operator.execute(successfulCommand);
  assert.equal(replay.replayed, true);
  assert.equal(
    requests.filter((request) => request.path.endsWith("/original")).length,
    originalReadsBeforeReplay,
  );
  const assetAfter = await companion.getAsset({ assetId: receipt.assetId });
  assert.equal(assetAfter.asset.isFavorite, false);
  assert.equal(assetAfter.asset.isTrashed, false);
  assert.equal(assetAfter.asset.visibility, "timeline");
  assert.equal(
    requests.every(
      ({ method, path }) =>
        method === "GET" ||
        (method === "POST" && path === "/api/search/metadata"),
    ),
    true,
  );
  const status = await operator.status();
  assert.equal(status.provider.state, "ready");
  assert.equal(JSON.stringify(status).includes(fixturePath), false);
  assert.equal(JSON.stringify(status).includes(receipt.apiKey), false);

  process.stdout.write(
    `${JSON.stringify({
      activationAuthority: result.activationAuthority,
      boundedCommands: attempts.length,
      database: databaseProof,
      fixtureBytes: fixture.length,
      fixtureSha256: expectedFixtureDigest,
      originalReads: originalReadsBeforeReplay,
      provider: status.provider,
      replayedWithoutRead: replay.replayed,
      revisionRecoveries,
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
        api: "actual-stock-immich",
        immichVersion: companionStatus.immichVersion,
        requestCount: requests.length,
      },
      work: attempts.map(({ work }) => work),
    })}\n`,
  );
} finally {
  await sql.end({ timeout: 5 });
}
