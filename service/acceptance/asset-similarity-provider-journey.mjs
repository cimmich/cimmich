import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  assetSimilarityDigest,
  createAssetSimilarityValidationReceipt,
  validateAssetSimilarityEvidence,
} from "../src/asset-similarity-contract.mjs";
import { createLocalDHashSimilarityProvider } from "../src/local-dhash-similarity-provider.mjs";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const manifestPath = `${projectRoot}/providers/perceptual-dhash/provider-manifest.json`;
const scriptPath = `${projectRoot}/providers/perceptual-dhash/provider.py`;
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const images = [
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAACAAAAAYCAAAAAC+OKDoAAAAGklEQVR4nGNkYMcPmBgIgFEFEDCqAAKGhwIA3mUBCRxoSrMAAAAASUVORK5CYII=",
    "base64",
  ),
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAACAAAAAYCAAAAAC+OKDoAAAAIklEQVR4nGNkYMcPmBgIgFEFNFPASEjBf4qtQAejChjAAAA4pAIJJ9Jv1wAAAABJRU5ErkJggg==",
    "base64",
  ),
];
const assets = images.map((bytes, index) => ({
  assetToken: assetSimilarityDigest(`synthetic-asset-${index + 1}`),
  inputRevision: assetSimilarityDigest(`synthetic-revision-${index + 1}`),
  sourceContentDigest: createHash("sha256").update(bytes).digest("hex"),
}));
const provider = createLocalDHashSimilarityProvider({
  manifest,
  manifestPath,
  pythonPath: process.env.CIMMICH_DHASH_PYTHON || "python3",
  scriptPath,
});
const compare = (runId) =>
  provider.compare({
    assets,
    leftBytes: images[0],
    rightBytes: images[1],
    runId,
  });
const runs = [
  await compare("acceptance-run-a"),
  await compare("acceptance-run-b"),
];
const validation = validateAssetSimilarityEvidence({
  assets,
  context: {
    acceptedCoappearanceCount: 0,
    filenameSequenceDelta: 1,
    sameDevice: true,
    sameLocation: false,
    timeDeltaSeconds: 2,
  },
  manifest,
  runs,
});
const receipt = createAssetSimilarityValidationReceipt(validation);

assert.equal(runs[0].similarity, 1);
assert.equal(runs[1].similarity, 1);
assert.equal(receipt.replay.evidence, "consistent");
assert.equal(receipt.discovery.contextKind, "rapid_burst");
assert.equal(receipt.boundary.providerExecutionProof, "none");
assert.equal(receipt.authority.automaticIdentityAuthority, "none");

process.stdout.write(
  `${JSON.stringify(
    {
      contractReceipt: receipt,
      executionObservation: "local_process_completed_twice",
      syntheticMediaOnly: true,
    },
    null,
    2,
  )}\n`,
);
