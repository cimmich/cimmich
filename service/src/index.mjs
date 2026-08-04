import postgres from "postgres";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createAddressGeocoder } from "./address-geocoding.mjs";
import { createHashLinkedAssetResolver } from "./archive-mobility.mjs";
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
import { createLocalDHashSimilarityProvider } from "./local-dhash-similarity-provider.mjs";
import { loadLocalMediaProviderRuntime } from "./local-media-provider-runtime.mjs";
import { loadMatchingProviderRuntime } from "./matching-provider-runtime.mjs";
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
const { allowedHosts, allowedOrigins, databaseUrl, guidedPort, host, port } =
  runtimeConfig;
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

const optionalEgressEnabled =
  process.env.CIMMICH_OPTIONAL_EGRESS_ENABLED === "true";
const addressGeocoder = optionalEgressEnabled ? createAddressGeocoder() : null;
const immichCompanion = await createImmichCompanionManager({
  apiBaseUrl: process.env.IMMICH_API_URL || "",
  apiKey: process.env.IMMICH_API_KEY || "",
  credentialFile: runtimeConfig.immichCredentialFile,
});
const sql = postgres(databaseUrl, { max: 5, prepare: true });
const legacyBridge = await loadDisplayBridge(
  process.env.CIMMICH_DISPLAY_BRIDGE_PATH || "",
).catch((error) => {
  console.warn(
    "Cimmich optional legacy display bridge unavailable; using inventory projection only",
    { error: error instanceof Error ? error.message : String(error) },
  );
  return new Map();
});
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
const matchingProviderRuntime = await loadMatchingProviderRuntime({
  fallbackProvider: localMediaProvider.matchingProvider,
  fallbackReceipt: localMediaProvider.providerReceipt,
});
const derivativeProviderRoot = path.resolve(
  serviceDirectory,
  "../providers/perceptual-dhash",
);
const derivativeProviderManifestPath = path.join(
  derivativeProviderRoot,
  "provider-manifest.json",
);
// The perceptual-dhash derivative provider is optional: a missing or
// malformed manifest must not refuse the whole service boot. Without it the
// identity audit reports independence verification as unavailable
// (IDENTITY_AUDIT_INDEPENDENCE_UNAVAILABLE) instead.
const derivativeProvider = await (async () => {
  try {
    return createLocalDHashSimilarityProvider({
      manifest: JSON.parse(
        await readFile(derivativeProviderManifestPath, "utf8"),
      ),
      manifestPath: derivativeProviderManifestPath,
      pythonPath: process.env.CIMMICH_LOCAL_PYTHON_PATH || "/usr/bin/python3",
      scriptPath: path.join(derivativeProviderRoot, "provider.py"),
    });
  } catch (error) {
    console.warn(
      "Cimmich derivative provider unavailable; identity-audit independence checks are disabled",
      { error: error instanceof Error ? error.message : String(error) },
    );
    return null;
  }
})();
const hashLinkedAssetResolver = createHashLinkedAssetResolver({
  legacyResolver: ({ immichAssetId }) =>
    resolveCimmichAssetIdFromDisplayBridge(bridge, immichAssetId),
  sql,
});
const immichInventory = createImmichInventorySynchronizer({
  companion: immichCompanion,
  job: localMediaProvider.detectionEnabled
    ? localMediaProvider.inventoryJob
    : null,
  pageSize: Number(process.env.CIMMICH_IMMICH_PAGE_SIZE || "250"),
  onProjectionCommitted: refreshInventoryProjectionBridge,
  resolveCimmichAssetId: hashLinkedAssetResolver,
  sourceId: process.env.CIMMICH_IMMICH_SOURCE_ID || "immich-primary",
  sql,
  verifySourceBytes: true,
});
const immichOnboarding = createImmichOnboarding({
  companion: immichCompanion,
  immichInventory,
  presentationRank: visibility.currentRank,
  resolveCimmichAssetId: ({ immichAssetId }) =>
    resolveCimmichAssetIdFromDisplayBridge(bridge, immichAssetId),
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
  identityAuditDerivativeProvider: derivativeProvider,
  enhancedComponent,
  expectedSchemaPatchCount: releasePatches.length,
  expectedSchemaVersion,
  immichCompanion,
  immichSourceId: process.env.CIMMICH_IMMICH_SOURCE_ID || "immich-primary",
  matchingProvider: matchingProviderRuntime.matchingProvider,
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
      toolVersion: localMediaProvider.pipelineManifest.recognizer.toolVersion,
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
  detectionEnabled:
    matchingProviderRuntime.recognitionCompatible &&
    localMediaProvider.detectionEnabled,
  enhancedComponent,
  matchingProvider: matchingProviderRuntime.matchingProvider,
  mediaOperator: matchingProviderRuntime.recognitionCompatible
    ? mediaOperator
    : null,
  presentationRank: visibility.currentRank,
  providerReceipt: matchingProviderRuntime.providerReceipt,
  repository,
  sourceId: process.env.CIMMICH_IMMICH_SOURCE_ID || "immich-primary",
  sql,
});
const memorySteward = createMemorySteward({
  repository,
});
const serverDependencies = {
  addressGeocoder,
  allowedHosts,
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
  optionalEgressEnabled,
  visibility,
};
const server = createCimmichServer({
  ...serverDependencies,
  surfacePolicy: "canonical",
});
const guidedServer = createCimmichServer({
  ...serverDependencies,
  surfacePolicy: "guided",
});

let shuttingDown = false;
const shutdown = async (exitCode = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = exitCode;
  await Promise.all(
    [server, guidedServer].map(
      (activeServer) =>
        new Promise((resolve) => activeServer.close(() => resolve())),
    ),
  );
  await localMediaProvider.recognizer?.close?.().catch(() => {});
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
  console.log(`Cimmich owner service listening on ${host}:${port}`);
  // Prewarm the People-grid snapshot variant the live page requests, so the
  // first signed-in visit after a restart is served hot. Best-effort: a cold
  // database at boot only costs the prewarm, never the boot.
  void repository
    .people({ includePresentation: true, limit: 500 })
    .catch((error) => {
      console.error("Cimmich people snapshot prewarm failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    });
});
guidedServer.listen(guidedPort, host, () => {
  console.log(`Cimmich Guided service listening on ${host}:${guidedPort}`);
});
