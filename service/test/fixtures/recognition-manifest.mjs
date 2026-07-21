import {
  deriveProviderConfigDigest,
  deriveVectorSpaceId,
  recognitionProviderSchemaVersion,
} from "../../src/recognition-provider-contract.mjs";

export const recognitionManifestFixture = {
  schemaVersion: recognitionProviderSchemaVersion,
  provider: { name: "synthetic-local-provider", version: "1" },
  detector: {
    artifactSha256: "a".repeat(64),
    inputSize: [320, 320],
    model: "synthetic-detector",
    modelVersion: "1",
    scoreThreshold: 0.5,
  },
  recognizer: {
    artifactSha256: "b".repeat(64),
    model: "synthetic-recognizer",
    modelVersion: "1",
  },
  preprocessing: {
    alignment: "five-point",
    colorSpace: "rgb",
    inputSize: [112, 112],
    pipelineVersion: "synthetic-pipeline-v1",
  },
  embedding: { dimension: 2, metric: "cosine", normalized: true },
  execution: {
    device: "cpu",
    network: "forbidden",
    runtime: "synthetic",
    threads: 1,
  },
  licensing: {
    code: "synthetic-only",
    model: "synthetic-only",
    trainingData: "synthetic-only",
  },
  privacy: { externalUpload: "none", sourceMedia: "local-read-only" },
};
recognitionManifestFixture.vectorSpaceId = deriveVectorSpaceId(
  recognitionManifestFixture,
);
recognitionManifestFixture.providerConfigDigest = deriveProviderConfigDigest(
  recognitionManifestFixture,
);
