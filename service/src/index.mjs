import postgres from "postgres";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAddressGeocoder } from "./address-geocoding.mjs";
import {
  createInventoryProjectionBridgeRefresher,
  loadDisplayBridge,
  mergeInventoryProjectionBridge,
  resolveCimmichAssetIdFromDisplayBridge,
} from "./bridge.mjs";
import { createImmichCompanionManager } from "./immich-companion-manager.mjs";
import { createImmichInventorySynchronizer } from "./immich-inventory.mjs";
import { createImmichOnboarding } from "./immich-onboarding.mjs";
import { createGuidedAccess } from "./guided-access.mjs";
import { createFaceMatchingOperator } from "./face-matching-operator.mjs";
import { createEnhancedComponent } from "./enhanced-component.mjs";
import { createLocalFaceDetectionWorker } from "./local-face-detection-worker.mjs";
import { createLocalFaceRecognitionWorker } from "./local-face-recognition-worker.mjs";
import { createLocalExistingFaceRecognitionWorker } from "./local-existing-face-recognition-worker.mjs";
import { loadLocalMediaProviderRuntime } from "./local-media-provider-runtime.mjs";
import { createMemorySteward } from "./memory-steward.mjs";
import { createMediaOperator } from "./media-operator.mjs";
import { continueFaceDetectionPipeline } from "./media-pipeline.mjs";
import { createCimmichRepository } from "./repository.mjs";
import { createCimmichServer } from "./server.mjs";
import { createVisibilityService } from "./visibility.mjs";
import { loadRuntimeConfig } from "./runtime-config.mjs";
import { loadMigrations, loadSchemaPatches } from "./migration-runner.mjs";
import {
  createCurrentImmichAssetReader,
  createOwnerFaceRecognitionScheduler,
} from "./owner-face-recognition.mjs";

const runtimeConfig = loadRuntimeConfig(process.env);
const { allowedOrigins, databaseUrl, host, port } = runtimeConfig;
const serviceDirectory = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
);
const migrationsDirectory = path.resolve(
  process.env.CIMMICH_MIGRATIONS_DIRECTORY ||
    path.join(serviceDirectory, "../migrations"),
);
const [releaseMigrations, releasePatches] = await Promise.all([
  loadMigrations(migrationsDirectory),
  loadSchemaPatches(path.join(migrationsDirectory, "patches")),
]);
const expectedSchemaVersion = releaseMigrations.at(-1)?.version || 0;

const addressGeocoder = createAddressGeocoder();
const immichCompanion = await createImmichCompanionManager({
  apiBaseUrl: process.env.IMMICH_API_URL || "",
  apiKey: process.env.IMMICH_API_KEY || "",
  credentialFile: runtimeConfig.immichCredentialFile,
});
const sql = postgres(databaseUrl, { max: 5, prepare: true });
const legacyBridge = await loadDisplayBridge(
  process.env.CIMMICH_DISPLAY_BRIDGE_PATH || "",
);
const bridge = await mergeInventoryProjectionBridge(sql, legacyBridge);
const refreshInventoryProjectionBridge =
  createInventoryProjectionBridgeRefresher({
    bridge,
    legacyBridge,
    sql,
  });
const visibility = createVisibilityService({
  absoluteSeconds: process.env.CIMMICH_VISIBILITY_PRIVATE_ABSOLUTE_SECONDS,
  inactivitySeconds: process.env.CIMMICH_VISIBILITY_PRIVATE_INACTIVITY_SECONDS,
  privateLockMode:
    process.env.CIMMICH_VISIBILITY_PRIVATE_LOCK_MODE || "password",
  runtimeMode: runtimeConfig.runtimeMode,
  sql,
  testMode: process.env.CIMMICH_VISIBILITY_TEST_MODE === "true",
  testPassword: process.env.CIMMICH_VISIBILITY_TEST_PASSWORD || "",
  unlockMaxConcurrent:
    process.env.CIMMICH_VISIBILITY_PRIVATE_MAX_CONCURRENT_UNLOCKS,
});
await visibility.initialize();
const localMediaProvider = await loadLocalMediaProviderRuntime();
const immichInventory = createImmichInventorySynchronizer({
  companion: immichCompanion,
  job: localMediaProvider.detectionEnabled
    ? localMediaProvider.inventoryJob
    : null,
  pageSize: Number(process.env.CIMMICH_IMMICH_PAGE_SIZE || "250"),
  onProjectionCommitted: refreshInventoryProjectionBridge,
  resolveCimmichAssetId: ({ immichAssetId }) =>
    resolveCimmichAssetIdFromDisplayBridge(bridge, immichAssetId),
  sourceId: process.env.CIMMICH_IMMICH_SOURCE_ID || "immich-primary",
  sql,
});
const immichOnboarding = createImmichOnboarding({
  companion: immichCompanion,
  immichInventory,
  sourceId: process.env.CIMMICH_IMMICH_SOURCE_ID || "immich-primary",
  sql,
});
const enhancedComponent = createEnhancedComponent({
  artifactDirectory:
    process.env.CIMMICH_ENHANCED_ARTIFACT_DIRECTORY || undefined,
  sql,
});
const repository = createCimmichRepository(sql, bridge, visibility, {
  allTrustedShortlistEvaluationReceiptDigest:
    runtimeConfig.allTrustedShortlistEvaluationReceiptDigest,
  allTrustedShortlistFrozenSourcePackId:
    runtimeConfig.allTrustedShortlistPackId,
  allTrustedShortlistReviewEnabled: runtimeConfig.allTrustedShortlistEnabled,
  conditionConsensusReviewEnabled: false,
  documentMaxFileBytes: runtimeConfig.documentMaxFileBytes,
  documentMaxStoreBytes: runtimeConfig.documentMaxStoreBytes,
  documentStoreRoot: runtimeConfig.documentStoreRoot,
  enhancedComponent,
  expectedSchemaPatchCount: releasePatches.length,
  expectedSchemaVersion,
  immichCompanion,
  immichSourceId: process.env.CIMMICH_IMMICH_SOURCE_ID || "immich-primary",
  matchingProvider: localMediaProvider.matchingProvider,
});
const guidedAccess = createGuidedAccess({
  accessToken: runtimeConfig.guidedAccessToken,
  authority: runtimeConfig.guidedAuthority,
  enabled: runtimeConfig.guidedEnabled,
  immichPublicBaseUrl: runtimeConfig.guidedImmichPublicUrl,
  publicBaseUrl: runtimeConfig.guidedPublicUrl,
  repository,
  uiPublicBaseUrl: runtimeConfig.guidedUiPublicUrl,
  visibilityCeiling: runtimeConfig.guidedVisibilityCeiling,
});
const detectionWorker = localMediaProvider.detectionEnabled
  ? createLocalFaceDetectionWorker({
      companion: immichCompanion,
      detector: localMediaProvider.detector,
      manifest: localMediaProvider.detectorManifest,
      sql,
    })
  : undefined;
const recognitionWorker = localMediaProvider.detectionEnabled
  ? createLocalFaceRecognitionWorker({
      companion: immichCompanion,
      manifest: localMediaProvider.recognitionManifest,
      recognizer: localMediaProvider.recognizer,
      sql,
    })
  : undefined;
const existingRecognitionScheduler = localMediaProvider.recognitionEnabled
  ? createOwnerFaceRecognitionScheduler({
      companion: immichCompanion,
      manifest: localMediaProvider.recognitionManifest,
      presentationRank: visibility.currentRank,
      sourceId: process.env.CIMMICH_IMMICH_SOURCE_ID || "immich-primary",
      sql,
    })
  : undefined;
const existingRecognitionWorker = localMediaProvider.recognitionEnabled
  ? createLocalExistingFaceRecognitionWorker({
      companion: createCurrentImmichAssetReader({
        companion: immichCompanion,
        sourceId: process.env.CIMMICH_IMMICH_SOURCE_ID || "immich-primary",
        sql,
      }),
      manifest: localMediaProvider.recognitionManifest,
      recognizer: localMediaProvider.recognizer,
      sql,
    })
  : undefined;
const mediaOperator = createMediaOperator({
  continueDetection: localMediaProvider.detectionEnabled
    ? (detectionJobId) =>
        continueFaceDetectionPipeline(sql, {
          detectionJobId,
          detectorManifest: localMediaProvider.detectorManifest,
          manifest: localMediaProvider.pipelineManifest,
          recognitionManifest: localMediaProvider.recognitionManifest,
        })
    : undefined,
  detectionWorker,
  existingRecognitionScheduler,
  existingRecognitionWorker,
  inventory: immichInventory,
  providerReceipt: localMediaProvider.providerReceipt,
  recognitionWorker,
  repository,
  sql,
});
const faceMatchingOperator = createFaceMatchingOperator({
  detectionEnabled: localMediaProvider.detectionEnabled,
  enhancedComponent,
  matchingProvider: localMediaProvider.matchingProvider,
  mediaOperator,
  providerReceipt: localMediaProvider.providerReceipt,
  repository,
  sql,
});
const memorySteward = createMemorySteward({
  repository,
});
const server = createCimmichServer({
  addressGeocoder,
  allowedOrigins,
  faceMatchingOperator,
  enhancedComponent,
  guidedAccess,
  immichCompanion,
  immichInventory,
  immichOnboarding,
  mediaOperator,
  memorySteward,
  repository,
  visibility,
});

let shuttingDown = false;
const shutdown = async (exitCode = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = exitCode;
  await new Promise((resolve) => server.close(() => resolve()));
  await sql.end({ timeout: 5 }).catch(() => {});
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
process.on("unhandledRejection", () => {
  console.error(
    JSON.stringify({
      code: "CIMMICH_PROCESS_FATAL",
      kind: "unhandled_rejection",
    }),
  );
  void shutdown(1);
});
process.on("uncaughtException", () => {
  console.error(
    JSON.stringify({
      code: "CIMMICH_PROCESS_FATAL",
      kind: "uncaught_exception",
    }),
  );
  void shutdown(1);
});

server.listen(port, host, () => {
  console.log(`Cimmich local service listening on ${host}:${port}`);
});
