import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  assetSimilarityResultDigest,
  deriveAssetSimilarityManifest,
} from "../src/asset-similarity-contract.mjs";
import {
  createAssetSimilarityWorkerReceipt,
  executeAssetSimilarityJob,
  prepareAssetSimilarityJob,
} from "../src/local-asset-similarity-worker.mjs";

const digest = (character) => character.repeat(64);
const manifest = deriveAssetSimilarityManifest({
  execution: {
    device: "cpu",
    network: "forbidden",
    runtimeId: "worker-fixture",
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
  privacy: { externalUpload: "none", sourceMedia: "local-read-only" },
  provider: { providerId: "worker-fixture", versionId: "v1" },
  resources: { maxMemoryMiB: 64, maxRuntimeMs: 1000 },
  schemaVersion: "cimmich.asset-similarity-provider.v1",
  similarity: {
    artifactDigest: digest("a"),
    modelId: "difference-hash-64",
    modelVersionId: "v1",
    scoreSemantics: "symmetric_unit_similarity",
  },
});
const projections = [
  {
    assetToken: digest("1"),
    immichAssetId: "immich-asset-one",
    inputRevision: digest("2"),
    sourceId: "immich-local",
  },
  {
    assetToken: digest("3"),
    immichAssetId: "immich-asset-two",
    inputRevision: digest("4"),
    sourceId: "immich-local",
  },
];
const bytes = [Buffer.from("image-one"), Buffer.from("image-two")];
const context = {
  acceptedCoappearanceCount: 0,
  filenameSequenceDelta: 1,
  sameDevice: true,
  sameLocation: false,
  timeDeltaSeconds: 2,
};

const prepared = () =>
  prepareAssetSimilarityJob({ context, manifest, projections });

const fixture = ({
  corruptDigest = false,
  drift = false,
  staleAfter = false,
} = {}) => {
  const calls = { compare: 0, current: 0, read: 0 };
  const companion = {
    async getAsset({ assetId }) {
      calls.current += 1;
      const index = projections.findIndex(
        (row) => row.immichAssetId === assetId,
      );
      return {
        asset: {
          immichAssetId: assetId,
          inputRevision:
            staleAfter && calls.current > 0
              ? digest("f")
              : projections[index].inputRevision,
        },
      };
    },
    async readAssetImage({ assetId }) {
      calls.read += 1;
      const index = projections.findIndex(
        (row) => row.immichAssetId === assetId,
      );
      return {
        asset: {
          immichAssetId: assetId,
          inputRevision: projections[index].inputRevision,
        },
        bytes: bytes[index],
        contentDigest: corruptDigest
          ? digest("e")
          : createHash("sha256").update(bytes[index]).digest("hex"),
        sourceAccess: "immich-api-read-only",
      };
    },
  };
  const provider = {
    manifest,
    async compare({ assets, runId }) {
      calls.compare += 1;
      const core = {
        assets,
        featureSpaceId: manifest.featureSpaceId,
        providerConfigDigest: manifest.providerConfigDigest,
        runId,
        schemaVersion: "cimmich.asset-similarity-result.v1",
        similarity: drift && calls.compare === 2 ? 0.9 : 0.91,
      };
      return { ...core, resultDigest: assetSimilarityResultDigest(core) };
    },
  };
  return { calls, companion, provider };
};

test("prepared work is authority-free and exact execution yields a minimized read receipt", async () => {
  const job = prepared();
  assert.equal(job.authority.mediaRead, "not_executed");
  assert.equal(job.authority.providerExecution, "not_executed");
  const { calls, companion, provider } = fixture();
  const execution = await executeAssetSimilarityJob({
    companion,
    prepared: job,
    provider,
  });
  const receipt = createAssetSimilarityWorkerReceipt(execution);
  assert.deepEqual(calls, { compare: 2, current: 2, read: 2 });
  assert.equal(receipt.disposition, "capture_context_candidate");
  assert.equal(receipt.replayEvidence, "consistent");
  assert.equal(
    receipt.boundary.sourceMediaReadPerformed,
    "immich-api-read-only",
  );
  assert.equal(receipt.boundary.providerProcessInvocations, 2);
  assert.equal(receipt.authority.repositoryWrite, "none");
});

test("copied prepared and execution wrappers fail before read or receipt", async () => {
  const job = prepared();
  const first = fixture();
  await assert.rejects(
    executeAssetSimilarityJob({
      companion: first.companion,
      prepared: Object.freeze({ ...job }),
      provider: first.provider,
    }),
    /exact prepared asset-similarity job/,
  );
  assert.equal(first.calls.read, 0);

  const second = fixture();
  const execution = await executeAssetSimilarityJob({
    companion: second.companion,
    prepared: job,
    provider: second.provider,
  });
  assert.throws(
    () => createAssetSimilarityWorkerReceipt(Object.freeze({ ...execution })),
    /exact asset-similarity execution envelope/,
  );
});

test("source digest or post-read revision drift fails with no receipt", async () => {
  const corrupt = fixture({ corruptDigest: true });
  await assert.rejects(
    executeAssetSimilarityJob({
      companion: corrupt.companion,
      prepared: prepared(),
      provider: corrupt.provider,
    }),
    (error) => error.code === "ASSET_SIMILARITY_WORKER_SOURCE_DRIFT",
  );
  assert.equal(corrupt.calls.compare, 0);

  const stale = fixture({ staleAfter: true });
  await assert.rejects(
    executeAssetSimilarityJob({
      companion: stale.companion,
      prepared: prepared(),
      provider: stale.provider,
    }),
    (error) => error.code === "ASSET_SIMILARITY_WORKER_STALE",
  );
  assert.equal(stale.calls.compare, 2);
});

test("provider/config mismatch fails before media read", async () => {
  const current = fixture();
  const mismatched = {
    ...current.provider,
    manifest: { ...manifest, providerConfigDigest: digest("f") },
  };
  await assert.rejects(
    executeAssetSimilarityJob({
      companion: current.companion,
      prepared: prepared(),
      provider: mismatched,
    }),
    (error) => error.code === "ASSET_SIMILARITY_WORKER_CONFIG_INVALID",
  );
  assert.equal(current.calls.read, 0);
});

test("well-formed provider replay drift produces an abstained no-write receipt", async () => {
  const current = fixture({ drift: true });
  const execution = await executeAssetSimilarityJob({
    companion: current.companion,
    prepared: prepared(),
    provider: current.provider,
  });
  const receipt = createAssetSimilarityWorkerReceipt(execution);
  assert.equal(receipt.disposition, "abstained");
  assert.equal(receipt.replayEvidence, "drift");
  assert.equal(receipt.authority.acceptedTruthMutation, "none");
});

test("public worker receipt contains no asset, source, path or media evidence", async () => {
  const current = fixture();
  const receipt = createAssetSimilarityWorkerReceipt(
    await executeAssetSimilarityJob({
      companion: current.companion,
      prepared: prepared(),
      provider: current.provider,
    }),
  );
  const serialized = JSON.stringify(receipt);
  for (const projection of projections) {
    assert.equal(serialized.includes(projection.assetToken), false);
    assert.equal(serialized.includes(projection.immichAssetId), false);
    assert.equal(serialized.includes(projection.inputRevision), false);
    assert.equal(serialized.includes(projection.sourceId), false);
  }
  assert.equal(serialized.includes("image-one"), false);
  assert.equal(serialized.includes("person"), false);
  assert.equal(serialized.includes("filename"), false);
});
