import assert from "node:assert/strict";
import test from "node:test";
import {
  assetSimilarityResultDigest,
  createAssetSimilarityValidationReceipt,
  deriveAssetSimilarityManifest,
  projectValidatedAssetSimilarityToCaptureContext,
  validateAssetSimilarityEvidence,
} from "../src/asset-similarity-contract.mjs";

const digest = (character) => character.repeat(64);

const manifest = () =>
  deriveAssetSimilarityManifest({
    execution: {
      device: "cpu",
      network: "forbidden",
      runtimeId: "synthetic-runtime-v1",
      threads: 2,
    },
    licensing: {
      code: "declared",
      model: "unknown",
      trainingData: "unknown",
    },
    preprocessing: {
      colorSpace: "rgb",
      inputHeight: 256,
      inputWidth: 256,
      resizeMode: "fit",
    },
    privacy: {
      externalUpload: "none",
      sourceMedia: "local-read-only",
    },
    provider: {
      providerId: "synthetic-similarity",
      versionId: "v1",
    },
    resources: {
      maxMemoryMiB: 512,
      maxRuntimeMs: 5000,
    },
    schemaVersion: "cimmich.asset-similarity-provider.v1",
    similarity: {
      artifactDigest: digest("a"),
      modelId: "synthetic-perceptual",
      modelVersionId: "v1",
      scoreSemantics: "symmetric_unit_similarity",
    },
  });

const assets = ({ sharedSource = false } = {}) => [
  {
    assetToken: digest("1"),
    inputRevision: digest("2"),
    sourceContentDigest: digest("3"),
  },
  {
    assetToken: digest("4"),
    inputRevision: digest("5"),
    sourceContentDigest: sharedSource ? digest("3") : digest("6"),
  },
];

const result = ({
  assetBindings = assets(),
  provider = manifest(),
  runId = "run-a",
  similarity = 0.91,
} = {}) => {
  const core = {
    assets: assetBindings,
    featureSpaceId: provider.featureSpaceId,
    providerConfigDigest: provider.providerConfigDigest,
    runId,
    schemaVersion: "cimmich.asset-similarity-result.v1",
    similarity,
  };
  return { ...core, resultDigest: assetSimilarityResultDigest(core) };
};

const input = ({
  assetBindings = assets(),
  context = {},
  provider = manifest(),
  runOverrides = {},
} = {}) => ({
  assets: assetBindings,
  context: {
    acceptedCoappearanceCount: 0,
    filenameSequenceDelta: 2,
    sameDevice: true,
    sameLocation: false,
    timeDeltaSeconds: 3,
    ...context,
  },
  manifest: provider,
  runs: [
    result({
      assetBindings,
      provider,
      runId: "run-a",
      similarity: runOverrides.firstSimilarity ?? 0.91,
    }),
    result({
      assetBindings,
      provider,
      runId: "run-b",
      similarity: runOverrides.secondSimilarity ?? 0.91,
    }),
  ],
});

test("valid replay projects a capture candidate without identity authority", () => {
  const validation = validateAssetSimilarityEvidence(input());
  const projection =
    projectValidatedAssetSimilarityToCaptureContext(validation);
  const receipt = createAssetSimilarityValidationReceipt(validation);

  assert.equal(validation.disposition, "capture_context_candidate");
  assert.equal(validation.replayEvidence, "consistent");
  assert.equal(projection.discovery.contextKind, "rapid_burst");
  assert.equal(
    projection.discovery.independenceDisposition,
    "shared-capture-context",
  );
  assert.equal(receipt.authority.automaticIdentityAuthority, "none");
  assert.equal(receipt.authority.providerExecutionAuthority, "none");
  assert.equal(receipt.boundary.sourceMediaReadPerformed, "none");
});

test("time and filename proximity cannot overcome weak visual evidence", () => {
  const validation = validateAssetSimilarityEvidence(
    input({ runOverrides: { firstSimilarity: 0.2, secondSimilarity: 0.2 } }),
  );
  const projection =
    projectValidatedAssetSimilarityToCaptureContext(validation);
  assert.equal(validation.disposition, "abstained");
  assert.equal(validation.reason, "INSUFFICIENT_INDEPENDENT_EVIDENCE");
  assert.equal(projection.discovery, null);
});

test("distinct assets with the same source become a same-source quarantine", () => {
  const assetBindings = assets({ sharedSource: true });
  const validation = validateAssetSimilarityEvidence(input({ assetBindings }));
  const receipt = createAssetSimilarityValidationReceipt(validation);
  assert.equal(validation.disposition, "same_source_observation");
  assert.equal(validation.reason, "SAME_SOURCE_OBSERVATION");
  assert.equal(
    receipt.discovery.independenceDisposition,
    "same-source-observation",
  );
});

test("replay drift abstains before capture-context classification", () => {
  const validation = validateAssetSimilarityEvidence(
    input({ runOverrides: { firstSimilarity: 0.91, secondSimilarity: 0.9 } }),
  );
  const projection =
    projectValidatedAssetSimilarityToCaptureContext(validation);
  assert.equal(validation.replayEvidence, "drift");
  assert.equal(validation.reason, "REPLAY_DRIFT");
  assert.equal(projection.discovery, null);
});

test("input and provider-result order are canonical", () => {
  const forward = validateAssetSimilarityEvidence(input());
  const reversedAssets = assets().toReversed();
  const reverseInput = input({ assetBindings: reversedAssets });
  reverseInput.runs.reverse();
  reverseInput.runs.forEach((run) => {
    run.assets.reverse();
    const core = { ...run };
    delete core.resultDigest;
    run.resultDigest = assetSimilarityResultDigest(core);
  });
  const reverse = validateAssetSimilarityEvidence(reverseInput);
  assert.deepEqual(
    createAssetSimilarityValidationReceipt(reverse),
    createAssetSimilarityValidationReceipt(forward),
  );
});

test("copied and frozen envelopes cannot receipt or project", () => {
  const validation = validateAssetSimilarityEvidence(input());
  const copied = Object.freeze({ ...validation });
  assert.throws(
    () => createAssetSimilarityValidationReceipt(copied),
    /exact validated asset-similarity envelope/,
  );
  assert.throws(
    () => projectValidatedAssetSimilarityToCaptureContext(copied),
    /exact validated asset-similarity envelope/,
  );
});

test("asset revision, manifest and feature-space substitution fail closed", () => {
  const revisionForgery = input();
  revisionForgery.runs[0].assets[0].inputRevision = digest("f");
  assert.throws(
    () => validateAssetSimilarityEvidence(revisionForgery),
    /resultDigest does not match/,
  );

  const providerForgery = input();
  providerForgery.manifest = {
    ...providerForgery.manifest,
    provider: { ...providerForgery.manifest.provider, versionId: "v2" },
  };
  assert.throws(
    () => validateAssetSimilarityEvidence(providerForgery),
    /derived bindings do not match/,
  );

  const spaceForgery = input();
  spaceForgery.runs[0].featureSpaceId = `feature_space_${digest("f")}`;
  const core = { ...spaceForgery.runs[0] };
  delete core.resultDigest;
  spaceForgery.runs[0].resultDigest = assetSimilarityResultDigest(core);
  assert.throws(
    () => validateAssetSimilarityEvidence(spaceForgery),
    /validated provider space/,
  );
});

test("one run, reused run ID and non-canonical precision fail closed", () => {
  const oneRun = input();
  oneRun.runs.pop();
  assert.throws(
    () => validateAssetSimilarityEvidence(oneRun),
    /exactly two provider results/,
  );

  const reusedRun = input();
  reusedRun.runs[1] = result({ runId: "run-a" });
  assert.throws(
    () => validateAssetSimilarityEvidence(reusedRun),
    /distinct public run identifiers/,
  );

  assert.throws(
    () =>
      result({
        similarity: 0.9000001,
      }),
    /canonical bounded decimal/,
  );
});

test("free-form fields, paths and duplicate asset tokens are rejected", () => {
  const extra = input();
  extra.context.filename = "/private/library/photo.jpg";
  assert.throws(
    () => validateAssetSimilarityEvidence(extra),
    /exact contract fields/,
  );

  const duplicate = assets();
  duplicate[1].assetToken = duplicate[0].assetToken;
  assert.throws(
    () => validateAssetSimilarityEvidence(input({ assetBindings: duplicate })),
    /two distinct anonymous assets/,
  );

  const badProvider = {
    ...manifest(),
    provider: { providerId: "../../model", versionId: "v1" },
  };
  assert.throws(
    () => validateAssetSimilarityEvidence(input({ provider: badProvider })),
    /lowercase public identifier/,
  );
});

test("the minimized receipt omits asset and source evidence", () => {
  const assetBindings = assets();
  const receipt = createAssetSimilarityValidationReceipt(
    validateAssetSimilarityEvidence(input({ assetBindings })),
  );
  const serialized = JSON.stringify(receipt);
  for (const asset of assetBindings) {
    assert.equal(serialized.includes(asset.assetToken), false);
    assert.equal(serialized.includes(asset.inputRevision), false);
    assert.equal(serialized.includes(asset.sourceContentDigest), false);
  }
  assert.equal(serialized.includes("person"), false);
  assert.equal(serialized.includes("filename"), false);
  assert.equal(serialized.includes("embedding"), false);
});
