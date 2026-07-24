import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  insightFaceUserSuppliedProviderId,
  loadLocalMediaProviderRuntime,
  openCvReferenceProviderId,
} from "../src/local-media-provider-runtime.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const detectorManifest = JSON.parse(
  readFileSync(`${root}/providers/opencv-sface/detector-manifest.json`, "utf8"),
);
const recognitionManifest = JSON.parse(
  readFileSync(`${root}/providers/opencv-sface/provider-manifest.json`, "utf8"),
);
const insightFaceManifest = {
  ...recognitionManifest,
  detector: {
    ...recognitionManifest.detector,
    artifactSha256: "1".repeat(64),
    inputSize: [640, 640],
  },
  execution: {
    ...recognitionManifest.execution,
    runtime: "onnxruntime-1.27.0+insightface-1.0.1",
  },
  provider: { name: insightFaceUserSuppliedProviderId, version: "1" },
  providerConfigDigest: null,
  recognitionSpace: {
    detectorInputSize: [640, 640],
    modelFamily: "private_insightface_buffalo_l",
    modelVersion: "cimmich-target-centric-v2",
    pipelineVersion: "target-centric-tight-crop+2.4x-source-fallback-v2",
    recognitionModelSha256: "2".repeat(64),
  },
  recognizer: {
    ...recognitionManifest.recognizer,
    artifactSha256: "2".repeat(64),
  },
  vectorSpaceId: null,
};

const baseEnv = {
  CIMMICH_LOCAL_MEDIA_PROVIDER: openCvReferenceProviderId,
  CIMMICH_LOCAL_PYTHON_PATH: "/synthetic/python",
  CIMMICH_OPENCV_DETECTOR_MODEL_PATH: "/synthetic/detector.onnx",
  CIMMICH_OPENCV_PROVIDER_ROOT: "/synthetic/provider",
  CIMMICH_OPENCV_RECOGNIZER_MODEL_PATH: "/synthetic/recognizer.onnx",
};

const load = (overrides = {}) =>
  loadLocalMediaProviderRuntime({
    env: { ...baseEnv, ...overrides },
    fileDigest: async (path) => {
      if (path.endsWith("detector.onnx")) {
        return detectorManifest.detector.artifactSha256;
      }
      if (path.endsWith("recognizer.onnx")) {
        return recognitionManifest.recognizer.artifactSha256;
      }
      return "a".repeat(64);
    },
    readJson: async (path) =>
      path.endsWith("detector-manifest.json")
        ? detectorManifest
        : recognitionManifest,
    runtimeProbe: async () => ({
      opencvVersion: "4.11.0",
      pythonVersion: "3.12.9",
    }),
  });

test("local provider is opt-in and disabled state carries no paths", async () => {
  const runtime = await loadLocalMediaProviderRuntime({ env: {} });
  assert.equal(runtime.enabled, false);
  assert.equal(runtime.providerReceipt.state, "disabled");
  assert.equal(JSON.stringify(runtime).includes("/synthetic"), false);
});

test("OpenCV runtime binds verified provider stages and redacted receipt", async () => {
  const runtime = await load();
  assert.equal(runtime.enabled, true);
  assert.equal(runtime.detectionEnabled, true);
  assert.equal(runtime.recognitionEnabled, true);
  assert.equal(runtime.inventoryJob.operation, "detect_faces");
  assert.equal(
    runtime.inventoryJob.configDigest,
    detectorManifest.detectorConfigDigest,
  );
  assert.equal(runtime.providerReceipt.state, "ready");
  assert.equal(runtime.providerReceipt.opencvVersion, "4.11.0");
  assert.equal(runtime.providerReceipt.runtimeDigest.length, 64);
  assert.deepEqual(runtime.matchingProvider, {
    configDigest: runtime.recognitionManifest.recognitionSpaceConfigDigest,
    modelFamily: "SFace-MobileFaceNet",
    modelVersion: "2021dec",
    providerConfigDigest: runtime.recognitionManifest.providerConfigDigest,
    providerId: openCvReferenceProviderId,
    vectorSpaceId: runtime.recognitionManifest.vectorSpaceId,
  });
  assert.equal(
    JSON.stringify(runtime.providerReceipt).includes("/synthetic"),
    false,
  );
});

test("InsightFace runtime recognizes upstream inventory without owning detection", async () => {
  const runtime = await loadLocalMediaProviderRuntime({
    env: {
      CIMMICH_INSIGHTFACE_DETECTOR_MODEL_PATH: "/synthetic/detector.onnx",
      CIMMICH_INSIGHTFACE_PROVIDER_MANIFEST_PATH:
        "/synthetic/provider-manifest.json",
      CIMMICH_INSIGHTFACE_PROVIDER_ROOT: "/synthetic/provider",
      CIMMICH_INSIGHTFACE_RECOGNIZER_MODEL_PATH:
        "/synthetic/recognizer.onnx",
      CIMMICH_LOCAL_MEDIA_PROVIDER: insightFaceUserSuppliedProviderId,
      CIMMICH_LOCAL_PYTHON_PATH: "/synthetic/python",
    },
    fileDigest: async (path) => {
      if (path.endsWith("detector.onnx")) return "1".repeat(64);
      if (path.endsWith("recognizer.onnx")) return "2".repeat(64);
      return "a".repeat(64);
    },
    insightFaceRuntimeProbe: async () => ({
      pythonVersion: "3.12.9",
      runtime: "onnxruntime-1.27.0+insightface-1.0.1",
    }),
    readJson: async () => insightFaceManifest,
  });
  assert.equal(runtime.enabled, true);
  assert.equal(runtime.detectionEnabled, false);
  assert.equal(runtime.recognitionEnabled, true);
  assert.equal(runtime.inventoryJob, null);
  assert.equal(runtime.providerReceipt.detection, "upstream-inventory");
  assert.equal(runtime.providerReceipt.runtimeDigest.length, 64);
  assert.deepEqual(runtime.matchingProvider, {
    configDigest: runtime.recognitionManifest.recognitionSpaceConfigDigest,
    modelFamily: "private_insightface_buffalo_l",
    modelVersion: "cimmich-target-centric-v2",
    providerConfigDigest: runtime.recognitionManifest.providerConfigDigest,
    providerId: insightFaceUserSuppliedProviderId,
    vectorSpaceId: runtime.recognitionManifest.vectorSpaceId,
  });
  assert.equal(
    JSON.stringify(runtime.providerReceipt).includes("/synthetic"),
    false,
  );
});

test("OpenCV runtime fails closed on version, digest or provider drift", async () => {
  await assert.rejects(
    loadLocalMediaProviderRuntime({
      env: { ...baseEnv, CIMMICH_LOCAL_MEDIA_PROVIDER: "unknown-provider" },
    }),
    (error) => error.code === "LOCAL_MEDIA_PROVIDER_CONFIG_INVALID",
  );
  await assert.rejects(
    loadLocalMediaProviderRuntime({
      env: baseEnv,
      fileDigest: async () => "0".repeat(64),
      readJson: async (path) =>
        path.endsWith("detector-manifest.json")
          ? detectorManifest
          : recognitionManifest,
      runtimeProbe: async () => ({
        opencvVersion: "4.11.0",
        pythonVersion: "3.12.9",
      }),
    }),
    /digest does not match/,
  );
  await assert.rejects(
    loadLocalMediaProviderRuntime({
      env: baseEnv,
      fileDigest: async (path) =>
        path.endsWith("recognizer.onnx")
          ? recognitionManifest.recognizer.artifactSha256
          : path.endsWith("detector.onnx")
            ? detectorManifest.detector.artifactSha256
            : "a".repeat(64),
      readJson: async (path) =>
        path.endsWith("detector-manifest.json")
          ? detectorManifest
          : recognitionManifest,
      runtimeProbe: async () => ({
        opencvVersion: "5.0.0",
        pythonVersion: "3.12.9",
      }),
    }),
    /runtime does not match/,
  );
});
