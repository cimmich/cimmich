import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import {
  createAssetSimilarityValidationReceipt,
  deriveAssetSimilarityManifest,
  validateAssetSimilarityEvidence,
} from "../src/asset-similarity-contract.mjs";
import { createLocalDHashSimilarityProvider } from "../src/local-dhash-similarity-provider.mjs";

const fakeScript = fileURLToPath(
  new URL("./fixtures/fake-dhash-provider.mjs", import.meta.url),
);
const digest = (character) => character.repeat(64);
const scriptDigest = async () =>
  createHash("sha256")
    .update(await readFile(fakeScript))
    .digest("hex");

const manifest = async () =>
  deriveAssetSimilarityManifest({
    execution: {
      device: "cpu",
      network: "forbidden",
      runtimeId: "node-fixture",
      threads: 1,
    },
    licensing: {
      code: "declared",
      model: "not_applicable",
      trainingData: "not_applicable",
    },
    preprocessing: {
      colorSpace: "gray",
      inputHeight: 8,
      inputWidth: 9,
      resizeMode: "stretch",
    },
    privacy: {
      externalUpload: "none",
      sourceMedia: "local-read-only",
    },
    provider: { providerId: "fake-dhash", versionId: "v1" },
    resources: { maxMemoryMiB: 64, maxRuntimeMs: 5000 },
    schemaVersion: "cimmich.asset-similarity-provider.v1",
    similarity: {
      artifactDigest: await scriptDigest(),
      modelId: "difference-hash-64",
      modelVersionId: "v1",
      scoreSemantics: "symmetric_unit_similarity",
    },
  });

const assets = [
  {
    assetToken: digest("1"),
    inputRevision: digest("2"),
    sourceContentDigest: digest("3"),
  },
  {
    assetToken: digest("4"),
    inputRevision: digest("5"),
    sourceContentDigest: digest("6"),
  },
];

const withProvider = async (callback) => {
  const directory = await mkdtemp(`${tmpdir()}/cimmich-dhash-test-`);
  try {
    const providerManifest = await manifest();
    const manifestPath = `${directory}/manifest.json`;
    await writeFile(manifestPath, `${JSON.stringify(providerManifest)}\n`);
    const provider = createLocalDHashSimilarityProvider({
      manifest: providerManifest,
      manifestPath,
      pythonPath: process.execPath,
      scriptPath: fakeScript,
      timeoutMs: 5000,
    });
    return await callback({ manifestPath, provider, providerManifest });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
};

test("local provider transfers two in-memory images and passes exact replay validation", async () => {
  await withProvider(async ({ provider, providerManifest }) => {
    const first = await provider.compare({
      assets,
      leftBytes: Buffer.from("left-image"),
      rightBytes: Buffer.from("right-image"),
      runId: "run-a",
    });
    const second = await provider.compare({
      assets: assets.toReversed(),
      leftBytes: Buffer.from("left-image"),
      rightBytes: Buffer.from("right-image"),
      runId: "run-b",
    });
    const validation = validateAssetSimilarityEvidence({
      assets,
      context: {
        acceptedCoappearanceCount: 0,
        filenameSequenceDelta: 1,
        sameDevice: true,
        sameLocation: false,
        timeDeltaSeconds: 2,
      },
      manifest: providerManifest,
      runs: [first, second],
    });
    const receipt = createAssetSimilarityValidationReceipt(validation);
    assert.equal(first.similarity, 0.84375);
    assert.equal(receipt.replay.evidence, "consistent");
    assert.equal(receipt.discovery.contextKind, "rapid_burst");
    assert.equal(receipt.boundary.providerExecutionProof, "none");
  });
});

test("local provider rejects empty media and invalid anonymous bindings before execution", async () => {
  await withProvider(async ({ provider }) => {
    await assert.rejects(
      provider.compare({
        assets,
        leftBytes: Buffer.alloc(0),
        rightBytes: Buffer.from("right"),
        runId: "run-a",
      }),
      (error) => error.code === "LOCAL_ASSET_SIMILARITY_INPUT_INVALID",
    );
    await assert.rejects(
      provider.compare({
        assets: [{ assetToken: "private/path" }, assets[1]],
        leftBytes: Buffer.from("left"),
        rightBytes: Buffer.from("right"),
        runId: "run-a",
      }),
      (error) => error.code === "LOCAL_ASSET_SIMILARITY_INPUT_INVALID",
    );
  });
});

test("local provider rejects manifest or artifact drift before execution", async () => {
  await withProvider(async ({ manifestPath, provider }) => {
    await writeFile(manifestPath, "{}\n");
    await assert.rejects(
      provider.compare({
        assets,
        leftBytes: Buffer.from("left"),
        rightBytes: Buffer.from("right"),
        runId: "run-a",
      }),
      (error) => error.code === "LOCAL_ASSET_SIMILARITY_CONFIG_INVALID",
    );
  });
});
