import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  deriveProviderConfigDigest,
  deriveRecognitionSpaceConfigDigest,
  deriveVectorSpaceId,
  mergeRecognitionCheckpoint,
  recognitionObservationSchemaVersion,
  recognitionProviderSchemaVersion,
  recognitionVectorDigest,
  validateRecognitionObservation,
  validateRecognitionProviderManifest,
} from "../src/recognition-provider-contract.mjs";

test("public OpenCV provider manifest is stable and contract-valid", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL(
        "../../providers/opencv-sface/provider-manifest.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const validated = validateRecognitionProviderManifest(manifest);
  assert.equal(validated.embedding.dimension, 128);
  assert.equal(validated.execution.network, "forbidden");
  assert.equal(
    validated.providerConfigDigest,
    "07d88f33017baa05df755764b1e2a49c58fc7cb45c51cfd693deb09a64b42be5",
  );
  assert.equal(
    validated.vectorSpaceId,
    "vector_space_8727d0dacd9e0d5fdead7508c5e63975428a45fbe3ffe1af61947ada22ba3c86",
  );
});

const digest = (character) => character.repeat(64);
const manifest = {
  schemaVersion: recognitionProviderSchemaVersion,
  provider: { name: "fixture-local", version: "1" },
  detector: {
    artifactSha256: digest("a"),
    inputSize: [320, 320],
    model: "fixture-detector",
    modelVersion: "1",
    scoreThreshold: 0.5,
  },
  recognizer: {
    artifactSha256: digest("b"),
    model: "fixture-recognizer",
    modelVersion: "1",
  },
  preprocessing: {
    alignment: "five-point",
    colorSpace: "rgb",
    inputSize: [112, 112],
    pipelineVersion: "fixture-pipeline-v1",
  },
  embedding: { dimension: 2, metric: "cosine", normalized: true },
  execution: {
    device: "cpu",
    network: "forbidden",
    runtime: "fixture",
    threads: 1,
  },
  licensing: {
    code: "fixture-code",
    model: "fixture-only",
    trainingData: "fixture-declared",
  },
  privacy: { externalUpload: "none", sourceMedia: "local-read-only" },
};
manifest.vectorSpaceId = deriveVectorSpaceId(manifest);
manifest.providerConfigDigest = deriveProviderConfigDigest(manifest);

const embedded = (observationId = "observation-1") => {
  const vector = [0.6, 0.8];
  return {
    assetToken: "asset-token-1",
    cropDigest: digest("c"),
    observationId,
    providerConfigDigest: manifest.providerConfigDigest,
    route: "tight-target",
    schemaVersion: recognitionObservationSchemaVersion,
    state: "embedded",
    vector,
    vectorDigest: recognitionVectorDigest(vector),
    vectorSpaceId: manifest.vectorSpaceId,
  };
};

test("provider manifest derives stable configuration and vector-space identities", () => {
  const validated = validateRecognitionProviderManifest(manifest);
  assert.equal(validated.vectorSpaceId, manifest.vectorSpaceId);
  assert.equal(validated.providerConfigDigest, manifest.providerConfigDigest);
  assert.equal(validated.embedding.dimension, 2);
});

test("an explicit recognition space binds the historical target-centric lane without changing authority", () => {
  const target = structuredClone(manifest);
  target.detector.inputSize = [640, 640];
  target.recognizer.artifactSha256 =
    "4c06341c33c2ca1f86781dab0e829f88ad5b64be9fba56e56bc9ebdefc619e43";
  target.embedding.dimension = 512;
  target.preprocessing.pipelineVersion =
    "target-centric-tight-crop+2.4x-source-fallback-v2";
  target.recognitionSpace = {
    detectorInputSize: [640, 640],
    modelFamily: "private_insightface_buffalo_l",
    modelVersion: "cimmich-target-centric-v2",
    pipelineVersion: "target-centric-tight-crop+2.4x-source-fallback-v2",
    recognitionModelSha256: target.recognizer.artifactSha256,
  };
  target.vectorSpaceId = deriveVectorSpaceId(target);
  target.providerConfigDigest = deriveProviderConfigDigest(target);
  target.recognitionSpaceConfigDigest =
    deriveRecognitionSpaceConfigDigest(target);
  const validated = validateRecognitionProviderManifest(target);
  assert.equal(
    validated.recognitionSpaceConfigDigest,
    "037d1dac67ec15e70c8751e4edb08d38e3f5dbb1d76b1b2803f48d811e559299",
  );
  assert.equal(
    validated.recognitionSpace.modelFamily,
    "private_insightface_buffalo_l",
  );
  assert.notEqual(
    validated.providerConfigDigest,
    validated.recognitionSpaceConfigDigest,
  );
  assert.throws(
    () =>
      validateRecognitionProviderManifest({
        ...target,
        recognitionSpace: {
          ...target.recognitionSpace,
          detectorInputSize: [320, 320],
        },
      }),
    /conflicts with its model artifacts/,
  );
});

test("provider manifest requires licence truth and forbids provider networking", () => {
  assert.throws(
    () =>
      validateRecognitionProviderManifest({
        ...manifest,
        licensing: { ...manifest.licensing, trainingData: "" },
      }),
    /licensing.trainingData/,
  );
  assert.throws(
    () =>
      validateRecognitionProviderManifest({
        ...manifest,
        execution: { ...manifest.execution, network: "allowed" },
      }),
    /network access must be forbidden/,
  );
});

test("observation validation fails closed on mixed spaces and wrong dimensions", () => {
  assert.throws(
    () =>
      validateRecognitionObservation(
        { ...embedded(), vectorSpaceId: `vector_space_${digest("f")}` },
        manifest,
      ),
    /mixes vector spaces/,
  );
  assert.throws(
    () =>
      validateRecognitionObservation(
        { ...embedded(), vector: [1], vectorDigest: undefined },
        manifest,
      ),
    /dimension 1; expected 2/,
  );
});

test("abstentions are terminal evidence and cannot smuggle a vector", () => {
  const abstained = {
    assetToken: "asset-token-2",
    observationId: "observation-2",
    providerConfigDigest: manifest.providerConfigDigest,
    reason: "no-face",
    route: "full-image",
    schemaVersion: recognitionObservationSchemaVersion,
    state: "abstained",
    vectorSpaceId: manifest.vectorSpaceId,
  };
  assert.equal(
    validateRecognitionObservation(abstained, manifest).state,
    "abstained",
  );
  assert.throws(
    () =>
      validateRecognitionObservation(
        { ...abstained, vector: [0.6, 0.8] },
        manifest,
      ),
    /cannot carry a vector/,
  );
});

test("checkpoint merge is idempotent and conflicting replay fails", () => {
  const first = mergeRecognitionCheckpoint(manifest, [embedded()]);
  const replay = mergeRecognitionCheckpoint(
    manifest,
    [embedded()],
    first.checkpoint,
  );
  assert.equal(replay.receipt.counts.total, 1);
  assert.equal(replay.receipt.counts.reused, 1);
  assert.equal(replay.receipt.checkpointDigest, first.receipt.checkpointDigest);
  assert.throws(
    () =>
      mergeRecognitionCheckpoint(
        manifest,
        [{ ...embedded(), route: "expanded-fallback" }],
        first.checkpoint,
      ),
    /conflicts with its checkpoint/,
  );
});
