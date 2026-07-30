import assert from "node:assert/strict";
import test from "node:test";
import { loadMatchingProviderRuntime } from "../src/matching-provider-runtime.mjs";

const manifest = {
  detector: {
    artifactSha256:
      "5838f7fe053675b1c7a08b633df49e7af5495cee0493c7dcf6697200b85b5b91",
    inputSize: [640, 640],
    model: "SCRFD",
    modelVersion: "buffalo_l-private-local-v1",
    scoreThreshold: 0.2,
  },
  embedding: { dimension: 512, metric: "cosine", normalized: true },
  execution: {
    device: "coreml",
    network: "forbidden",
    runtime: "onnxruntime-1.27.0+insightface-1.0.1",
    threads: 1,
  },
  licensing: {
    code: "InsightFace Python code MIT",
    model: "user-supplied",
    trainingData: "operator-supplied",
  },
  preprocessing: {
    alignment: "insightface-five-point-norm-crop",
    colorSpace: "bgr-source-rgb-recognizer",
    inputSize: [112, 112],
    pipelineVersion: "target-centric-tight-crop+2.4x-source-fallback-v2",
  },
  privacy: { externalUpload: "none", sourceMedia: "local-read-only" },
  provider: { name: "insightface-user-supplied-coreml", version: "1" },
  providerConfigDigest: null,
  recognitionSpace: {
    detectorInputSize: [640, 640],
    modelFamily: "private_insightface_buffalo_l",
    modelVersion: "cimmich-target-centric-v2",
    pipelineVersion: "target-centric-tight-crop+2.4x-source-fallback-v2",
    recognitionModelSha256:
      "4c06341c33c2ca1f86781dab0e829f88ad5b64be9fba56e56bc9ebdefc619e43",
  },
  recognitionSpaceConfigDigest: null,
  recognizer: {
    artifactSha256:
      "4c06341c33c2ca1f86781dab0e829f88ad5b64be9fba56e56bc9ebdefc619e43",
    model: "ArcFace",
    modelVersion: "buffalo_l-private-local-v1",
  },
  schemaVersion: "cimmich.recognition-provider.v1",
  vectorSpaceId: null,
};

test("matching provider defaults to the executable local media provider", async () => {
  const fallbackProvider = {
    configDigest: "3".repeat(64),
    modelFamily: "SFace-MobileFaceNet",
    modelVersion: "2021dec",
    providerConfigDigest: "4".repeat(64),
    providerId: "opencv-yunet-sface-cpu",
    vectorSpaceId: "vector_space_opencv",
  };
  const fallbackReceipt = { state: "ready" };
  const runtime = await loadMatchingProviderRuntime({
    env: {},
    fallbackProvider,
    fallbackReceipt,
  });

  assert.equal(runtime.matchingProvider, fallbackProvider);
  assert.equal(runtime.providerReceipt, fallbackReceipt);
  assert.equal(runtime.recognitionCompatible, true);
  assert.equal(runtime.source, "local_media_provider");
});

test("validated matcher manifest can differ from ingest without enabling incompatible recognition", async () => {
  const runtime = await loadMatchingProviderRuntime({
    env: {
      CIMMICH_MATCHING_PROVIDER_MANIFEST_PATH: "/config/buffalo.json",
    },
    fallbackProvider: {
      configDigest: "3".repeat(64),
      modelFamily: "SFace-MobileFaceNet",
      modelVersion: "2021dec",
      providerConfigDigest: "4".repeat(64),
      providerId: "opencv-yunet-sface-cpu",
      vectorSpaceId: "vector_space_opencv",
    },
    readManifest: async (path) => {
      assert.equal(path, "/config/buffalo.json");
      return manifest;
    },
  });

  assert.deepEqual(runtime.matchingProvider, {
    configDigest:
      "037d1dac67ec15e70c8751e4edb08d38e3f5dbb1d76b1b2803f48d811e559299",
    modelFamily: "private_insightface_buffalo_l",
    modelVersion: "cimmich-target-centric-v2",
    providerConfigDigest: runtime.matchingProvider.providerConfigDigest,
    providerId: "insightface-user-supplied-coreml",
    vectorSpaceId: runtime.matchingProvider.vectorSpaceId,
  });
  assert.match(runtime.matchingProvider.providerConfigDigest, /^[0-9a-f]{64}$/);
  assert.match(
    runtime.matchingProvider.vectorSpaceId,
    /^vector_space_[0-9a-f]{64}$/,
  );
  assert.equal(runtime.providerReceipt.state, "ready");
  assert.equal(runtime.providerReceipt.recognitionExecution, "unavailable");
  assert.equal(runtime.recognitionCompatible, false);
});
