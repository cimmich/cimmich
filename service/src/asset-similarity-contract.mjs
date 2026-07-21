import { createHash } from "node:crypto";
import { classifyCaptureContextPair } from "./capture-context-discovery.mjs";

export const assetSimilarityProviderSchemaVersion =
  "cimmich.asset-similarity-provider.v1";
export const assetSimilarityResultSchemaVersion =
  "cimmich.asset-similarity-result.v1";
export const assetSimilarityValidationReceiptSchemaVersion =
  "cimmich.asset-similarity-validation.v1";
export const assetSimilarityCaptureProjectionSchemaVersion =
  "cimmich.asset-similarity-capture-projection.v1";

const numberPrecision = 6;
const digestPattern = /^[0-9a-f]{64}$/;
const publicIdentifierPattern = /^[a-z0-9](?:[a-z0-9._-]{0,63})$/;
const featureSpacePattern = /^feature_space_[0-9a-f]{64}$/;
const validatedEnvelopes = new WeakSet();
const privateBindings = new WeakMap();

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
};

export const assetSimilarityDigest = (value) =>
  createHash("sha256")
    .update(
      typeof value === "string" ? value : JSON.stringify(canonicalize(value)),
    )
    .digest("hex");

const typedError = (message) =>
  Object.assign(new Error(message), {
    code: "ASSET_SIMILARITY_INPUT_INVALID",
    statusCode: 400,
  });

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

const exactObject = (value, label, keys) => {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw typedError(`${label} must be an object`);
  }
  const actual = Object.keys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => !keys.includes(key))
  ) {
    throw typedError(`${label} must use the exact contract fields`);
  }
  return value;
};

const requiredDigest = (value, label) => {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    throw typedError(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
};

const requiredFeatureSpace = (value, label) => {
  if (typeof value !== "string" || !featureSpacePattern.test(value)) {
    throw typedError(`${label} must be a derived feature-space identifier`);
  }
  return value;
};

const requiredPublicIdentifier = (value, label) => {
  if (typeof value !== "string" || !publicIdentifierPattern.test(value)) {
    throw typedError(
      `${label} must be a 1-64 character lowercase public identifier`,
    );
  }
  return value;
};

const requiredEnum = (value, label, allowed) => {
  if (!allowed.includes(value)) {
    throw typedError(`${label} must use a supported value`);
  }
  return value;
};

const requiredInteger = (value, label, minimum, maximum) => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw typedError(`${label} must be a bounded integer`);
  }
  return value;
};

const canonicalNumber = (value, label, minimum, maximum) => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum ||
    Number(value.toFixed(numberPrecision)) !== value
  ) {
    throw typedError(`${label} must be a canonical bounded decimal`);
  }
  return value;
};

const normalizeManifestCore = (value, { requireDerived = true } = {}) => {
  const keys = [
    "execution",
    "featureSpaceId",
    "licensing",
    "preprocessing",
    "privacy",
    "provider",
    "providerConfigDigest",
    "resources",
    "schemaVersion",
    "similarity",
  ];
  exactObject(
    value,
    "manifest",
    requireDerived
      ? keys
      : keys.filter(
          (key) => key !== "featureSpaceId" && key !== "providerConfigDigest",
        ),
  );
  if (value.schemaVersion !== assetSimilarityProviderSchemaVersion) {
    throw typedError(
      `manifest.schemaVersion must be ${assetSimilarityProviderSchemaVersion}`,
    );
  }
  exactObject(value.provider, "manifest.provider", ["providerId", "versionId"]);
  exactObject(value.similarity, "manifest.similarity", [
    "artifactDigest",
    "modelId",
    "modelVersionId",
    "scoreSemantics",
  ]);
  exactObject(value.preprocessing, "manifest.preprocessing", [
    "colorSpace",
    "inputHeight",
    "inputWidth",
    "resizeMode",
  ]);
  exactObject(value.execution, "manifest.execution", [
    "device",
    "network",
    "runtimeId",
    "threads",
  ]);
  exactObject(value.licensing, "manifest.licensing", [
    "code",
    "model",
    "trainingData",
  ]);
  exactObject(value.privacy, "manifest.privacy", [
    "externalUpload",
    "sourceMedia",
  ]);
  exactObject(value.resources, "manifest.resources", [
    "maxMemoryMiB",
    "maxRuntimeMs",
  ]);

  const core = {
    execution: {
      device: requiredEnum(
        value.execution.device,
        "manifest.execution.device",
        ["ane", "auto", "cpu", "gpu", "npu"],
      ),
      network: requiredEnum(
        value.execution.network,
        "manifest.execution.network",
        ["forbidden"],
      ),
      runtimeId: requiredPublicIdentifier(
        value.execution.runtimeId,
        "manifest.execution.runtimeId",
      ),
      threads: requiredInteger(
        value.execution.threads,
        "manifest.execution.threads",
        1,
        256,
      ),
    },
    licensing: {
      code: requiredEnum(value.licensing.code, "manifest.licensing.code", [
        "declared",
        "unknown",
      ]),
      model: requiredEnum(value.licensing.model, "manifest.licensing.model", [
        "declared",
        "not_applicable",
        "unknown",
      ]),
      trainingData: requiredEnum(
        value.licensing.trainingData,
        "manifest.licensing.trainingData",
        ["declared", "not_applicable", "unknown"],
      ),
    },
    preprocessing: {
      colorSpace: requiredEnum(
        value.preprocessing.colorSpace,
        "manifest.preprocessing.colorSpace",
        ["gray", "rgb"],
      ),
      inputHeight: requiredInteger(
        value.preprocessing.inputHeight,
        "manifest.preprocessing.inputHeight",
        8,
        8192,
      ),
      inputWidth: requiredInteger(
        value.preprocessing.inputWidth,
        "manifest.preprocessing.inputWidth",
        8,
        8192,
      ),
      resizeMode: requiredEnum(
        value.preprocessing.resizeMode,
        "manifest.preprocessing.resizeMode",
        ["center_crop", "fit", "letterbox", "stretch"],
      ),
    },
    privacy: {
      externalUpload: requiredEnum(
        value.privacy.externalUpload,
        "manifest.privacy.externalUpload",
        ["none"],
      ),
      sourceMedia: requiredEnum(
        value.privacy.sourceMedia,
        "manifest.privacy.sourceMedia",
        ["local-read-only"],
      ),
    },
    provider: {
      providerId: requiredPublicIdentifier(
        value.provider.providerId,
        "manifest.provider.providerId",
      ),
      versionId: requiredPublicIdentifier(
        value.provider.versionId,
        "manifest.provider.versionId",
      ),
    },
    resources: {
      maxMemoryMiB: requiredInteger(
        value.resources.maxMemoryMiB,
        "manifest.resources.maxMemoryMiB",
        16,
        262144,
      ),
      maxRuntimeMs: requiredInteger(
        value.resources.maxRuntimeMs,
        "manifest.resources.maxRuntimeMs",
        1,
        3600000,
      ),
    },
    schemaVersion: assetSimilarityProviderSchemaVersion,
    similarity: {
      artifactDigest: requiredDigest(
        value.similarity.artifactDigest,
        "manifest.similarity.artifactDigest",
      ),
      modelId: requiredPublicIdentifier(
        value.similarity.modelId,
        "manifest.similarity.modelId",
      ),
      modelVersionId: requiredPublicIdentifier(
        value.similarity.modelVersionId,
        "manifest.similarity.modelVersionId",
      ),
      scoreSemantics: requiredEnum(
        value.similarity.scoreSemantics,
        "manifest.similarity.scoreSemantics",
        ["symmetric_unit_similarity"],
      ),
    },
  };

  if (!requireDerived) return core;
  return {
    ...core,
    featureSpaceId: requiredFeatureSpace(
      value.featureSpaceId,
      "manifest.featureSpaceId",
    ),
    providerConfigDigest: requiredDigest(
      value.providerConfigDigest,
      "manifest.providerConfigDigest",
    ),
  };
};

export const deriveAssetSimilarityManifest = (value) => {
  const core = normalizeManifestCore(value, { requireDerived: false });
  const providerConfigDigest = assetSimilarityDigest(core);
  const featureSpaceId = `feature_space_${assetSimilarityDigest({
    preprocessing: core.preprocessing,
    similarity: core.similarity,
  })}`;
  return deepFreeze({ ...core, featureSpaceId, providerConfigDigest });
};

const validateManifest = (value) => {
  const normalized = normalizeManifestCore(value);
  const expected = deriveAssetSimilarityManifest(
    Object.fromEntries(
      Object.entries(normalized).filter(
        ([key]) => key !== "featureSpaceId" && key !== "providerConfigDigest",
      ),
    ),
  );
  if (
    normalized.providerConfigDigest !== expected.providerConfigDigest ||
    normalized.featureSpaceId !== expected.featureSpaceId
  ) {
    throw typedError("manifest derived bindings do not match its exact core");
  }
  return expected;
};

export const validateAssetSimilarityManifest = (value) =>
  validateManifest(value);

const normalizeAsset = (value, label) => {
  exactObject(value, label, [
    "assetToken",
    "inputRevision",
    "sourceContentDigest",
  ]);
  return {
    assetToken: requiredDigest(value.assetToken, `${label}.assetToken`),
    inputRevision: requiredDigest(
      value.inputRevision,
      `${label}.inputRevision`,
    ),
    sourceContentDigest: requiredDigest(
      value.sourceContentDigest,
      `${label}.sourceContentDigest`,
    ),
  };
};

const canonicalAssets = (value, label = "assets") => {
  if (!Array.isArray(value) || value.length !== 2) {
    throw typedError(`${label} must contain exactly two asset bindings`);
  }
  const assets = value
    .map((asset, index) => normalizeAsset(asset, `${label}[${index}]`))
    .sort((left, right) => left.assetToken.localeCompare(right.assetToken));
  if (assets[0].assetToken === assets[1].assetToken) {
    throw typedError(`${label} must bind two distinct anonymous assets`);
  }
  return assets;
};

const sameAssetBinding = (left, right) =>
  left.assetToken === right.assetToken &&
  left.inputRevision === right.inputRevision &&
  left.sourceContentDigest === right.sourceContentDigest;

const normalizeRunCore = (value) => {
  exactObject(value, "result", [
    "assets",
    "featureSpaceId",
    "providerConfigDigest",
    "runId",
    "schemaVersion",
    "similarity",
  ]);
  if (value.schemaVersion !== assetSimilarityResultSchemaVersion) {
    throw typedError(
      `result.schemaVersion must be ${assetSimilarityResultSchemaVersion}`,
    );
  }
  return {
    assets: canonicalAssets(value.assets, "result.assets"),
    featureSpaceId: requiredFeatureSpace(
      value.featureSpaceId,
      "result.featureSpaceId",
    ),
    providerConfigDigest: requiredDigest(
      value.providerConfigDigest,
      "result.providerConfigDigest",
    ),
    runId: requiredPublicIdentifier(value.runId, "result.runId"),
    schemaVersion: assetSimilarityResultSchemaVersion,
    similarity: canonicalNumber(value.similarity, "result.similarity", 0, 1),
  };
};

export const assetSimilarityResultDigest = (value) =>
  assetSimilarityDigest(normalizeRunCore(value));

const normalizeRun = (value, label) => {
  exactObject(value, label, [
    "assets",
    "featureSpaceId",
    "providerConfigDigest",
    "resultDigest",
    "runId",
    "schemaVersion",
    "similarity",
  ]);
  const core = normalizeRunCore(
    Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== "resultDigest"),
    ),
  );
  const resultDigest = requiredDigest(
    value.resultDigest,
    `${label}.resultDigest`,
  );
  if (resultDigest !== assetSimilarityDigest(core)) {
    throw typedError(
      `${label}.resultDigest does not match its canonical result`,
    );
  }
  return { ...core, resultDigest };
};

const normalizeContext = (value) => {
  exactObject(value, "context", [
    "acceptedCoappearanceCount",
    "filenameSequenceDelta",
    "sameDevice",
    "sameLocation",
    "timeDeltaSeconds",
  ]);
  if (typeof value.sameDevice !== "boolean") {
    throw typedError("context.sameDevice must be boolean");
  }
  if (typeof value.sameLocation !== "boolean") {
    throw typedError("context.sameLocation must be boolean");
  }
  return {
    acceptedCoappearanceCount: requiredInteger(
      value.acceptedCoappearanceCount,
      "context.acceptedCoappearanceCount",
      0,
      1000,
    ),
    filenameSequenceDelta:
      value.filenameSequenceDelta === null
        ? null
        : requiredInteger(
            value.filenameSequenceDelta,
            "context.filenameSequenceDelta",
            0,
            1000000,
          ),
    sameDevice: value.sameDevice,
    sameLocation: value.sameLocation,
    timeDeltaSeconds: canonicalNumber(
      value.timeDeltaSeconds,
      "context.timeDeltaSeconds",
      0,
      315576000,
    ),
  };
};

export const validateAssetSimilarityContext = (value) =>
  deepFreeze(normalizeContext(value));

const assertRunBindings = (run, manifest, assets, label) => {
  if (
    run.providerConfigDigest !== manifest.providerConfigDigest ||
    run.featureSpaceId !== manifest.featureSpaceId
  ) {
    throw typedError(`${label} does not match the validated provider space`);
  }
  if (
    !sameAssetBinding(run.assets[0], assets[0]) ||
    !sameAssetBinding(run.assets[1], assets[1])
  ) {
    throw typedError(`${label} does not match the exact asset revisions`);
  }
};

const replayPayloadDigest = (run) =>
  assetSimilarityDigest({
    assets: run.assets,
    featureSpaceId: run.featureSpaceId,
    providerConfigDigest: run.providerConfigDigest,
    schemaVersion: run.schemaVersion,
    similarity: run.similarity,
  });

export const validateAssetSimilarityEvidence = (value) => {
  exactObject(value, "input", ["assets", "context", "manifest", "runs"]);
  const manifest = validateManifest(value.manifest);
  const assets = canonicalAssets(value.assets);
  const context = normalizeContext(value.context);
  if (!Array.isArray(value.runs) || value.runs.length !== 2) {
    throw typedError("runs must contain exactly two provider results");
  }
  const runs = value.runs
    .map((run, index) => normalizeRun(run, `runs[${index}]`))
    .sort((left, right) => left.runId.localeCompare(right.runId));
  if (runs[0].runId === runs[1].runId) {
    throw typedError("runs must use two distinct public run identifiers");
  }
  assertRunBindings(runs[0], manifest, assets, "runs[0]");
  assertRunBindings(runs[1], manifest, assets, "runs[1]");

  const replayEvidence =
    replayPayloadDigest(runs[0]) === replayPayloadDigest(runs[1])
      ? "consistent"
      : "drift";
  const sameSourceObservation =
    assets[0].sourceContentDigest === assets[1].sourceContentDigest;
  let discovery = null;
  let disposition = "abstained";
  let reason = replayEvidence === "drift" ? "REPLAY_DRIFT" : null;

  if (replayEvidence === "consistent") {
    discovery = classifyCaptureContextPair({
      ...context,
      exactDuplicate: sameSourceObservation,
      filenameSequenceDelta: context.filenameSequenceDelta ?? undefined,
      perceptualSimilarity: runs[0].similarity,
    });
    if (sameSourceObservation) {
      disposition = "same_source_observation";
      reason = "SAME_SOURCE_OBSERVATION";
    } else if (discovery) {
      disposition = "capture_context_candidate";
    } else {
      reason = "INSUFFICIENT_INDEPENDENT_EVIDENCE";
    }
  }

  const publicEnvelope = {
    disposition,
    featureSpaceId: manifest.featureSpaceId,
    providerConfigDigest: manifest.providerConfigDigest,
    reason,
    replayEvidence,
    resultDigests: runs.map((run) => run.resultDigest),
  };
  const envelope = deepFreeze({
    ...publicEnvelope,
    envelopeDigest: assetSimilarityDigest(publicEnvelope),
  });
  privateBindings.set(
    envelope,
    deepFreeze({ assets, context, discovery, manifest, runs }),
  );
  validatedEnvelopes.add(envelope);
  return envelope;
};

const requireValidatedEnvelope = (value) => {
  if (!validatedEnvelopes.has(value) || !privateBindings.has(value)) {
    throw typedError(
      "An exact validated asset-similarity envelope is required",
    );
  }
  return privateBindings.get(value);
};

export const projectValidatedAssetSimilarityToCaptureContext = (validation) => {
  const binding = requireValidatedEnvelope(validation);
  return deepFreeze({
    assets: binding.assets,
    discovery: binding.discovery,
    disposition: validation.disposition,
    featureSpaceId: validation.featureSpaceId,
    providerConfigDigest: validation.providerConfigDigest,
    reason: validation.reason,
    replayEvidence: validation.replayEvidence,
    schemaVersion: assetSimilarityCaptureProjectionSchemaVersion,
  });
};

export const createAssetSimilarityValidationReceipt = (validation) => {
  const binding = requireValidatedEnvelope(validation);
  const receipt = {
    authority: {
      acceptedTruthMutation: "none",
      automaticIdentityAuthority: "none",
      providerExecutionAuthority: "none",
      recommendation: "none",
      repositoryWrite: "none",
      training: "none",
    },
    boundary: {
      externalUpload: binding.manifest.privacy.externalUpload,
      providerExecutionProof: "none",
      sourceMedia: binding.manifest.privacy.sourceMedia,
      sourceMediaReadPerformed: "none",
      sourceWrite: "none",
    },
    discovery:
      binding.discovery === null
        ? null
        : {
            confidence: binding.discovery.confidence,
            contextKind: binding.discovery.contextKind,
            independenceDisposition: binding.discovery.independenceDisposition,
          },
    disposition: validation.disposition,
    envelopeDigest: validation.envelopeDigest,
    featureSpaceId: validation.featureSpaceId,
    providerConfigDigest: validation.providerConfigDigest,
    reason: validation.reason,
    replay: {
      evidence: validation.replayEvidence,
      providerExecutionProof: "none",
      resultDigests: validation.resultDigests,
    },
    schemaVersion: assetSimilarityValidationReceiptSchemaVersion,
  };
  return deepFreeze({
    ...receipt,
    receiptDigest: assetSimilarityDigest(receipt),
  });
};
