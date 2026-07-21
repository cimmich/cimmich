import {
  bodyDetectionContractDigest,
  projectValidatedBodyResultToLinker,
} from "./body-detector-contract.mjs";
import { recognitionDigest } from "./recognition-provider-contract.mjs";

export const bodyContinuityProviderSchemaVersion =
  "cimmich.body-continuity-provider.v1";
export const bodyContinuityFeatureResultSchemaVersion =
  "cimmich.body-continuity-feature-result.v1";
export const bodyContinuityComparisonSchemaVersion =
  "cimmich.body-continuity-comparison.v1";
export const bodyContinuityValidationReceiptSchemaVersion =
  "cimmich.body-continuity-validation.v1";
export const bodyContinuityEdgeProjectionSchemaVersion =
  "cimmich.body-continuity-edges.v1";
export const bodyContinuityRepositoryProjectionSchemaVersion =
  "cimmich.body-continuity-repository-projection.v1";

const absoluteMaximumBodiesPerAsset = 64;
const absoluteMaximumComparisons = 4096;
const numberPrecision = 6;
const digestPattern = /^[0-9a-f]{64}$/;
const bodyIdPattern = /^body_[0-9a-f]{40}$/;
const publicIdentifierPattern = /^[a-z0-9](?:[a-z0-9._-]{0,63})$/;
const featureSpacePattern = /^feature_space_[0-9a-f]{64}$/;
const validatedContinuityEnvelopes = new WeakSet();
const privateContinuityBindings = new WeakMap();

const typedError = (message, code = "BODY_CONTINUITY_INPUT_INVALID") =>
  Object.assign(new Error(message), { code, statusCode: 400 });

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
  const actualKeys = Object.keys(value);
  if (
    actualKeys.length !== keys.length ||
    actualKeys.some((key) => !keys.includes(key))
  ) {
    throw typedError(`${label} must use the exact contract fields`);
  }
  return value;
};

const requiredEnum = (value, label, allowed) => {
  if (!allowed.includes(value)) {
    throw typedError(`${label} must use a supported value`);
  }
  return value;
};

const requiredDigest = (value, label) => {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    throw typedError(`${label} must be a lowercase SHA-256 digest`);
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

const requiredFeatureSpace = (value, label) => {
  if (typeof value !== "string" || !featureSpacePattern.test(value)) {
    throw typedError(`${label} must be a derived feature-space identifier`);
  }
  return value;
};

const requiredBodyId = (value, label) => {
  if (typeof value !== "string" || !bodyIdPattern.test(value)) {
    throw typedError(`${label} must be an anonymous body observation ID`);
  }
  return value;
};

const requiredInteger = (value, label, minimum, maximum) => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw typedError(`${label} must be a bounded integer`);
  }
  return value;
};

const canonicalNumber = (
  value,
  label,
  { minimum = 0, maximum = 1, positive = false } = {},
) => {
  if (
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum ||
    (positive && value <= 0) ||
    Number(value.toFixed(numberPrecision)) !== value
  ) {
    throw typedError(`${label} must be a canonical bounded decimal`);
  }
  return value;
};

const roundNumber = (value) => Number(value.toFixed(numberPrecision));

const normalizeManifestCore = (value, { requireDerived = true } = {}) => {
  const keys = [
    "execution",
    "feature",
    "featureSpaceId",
    "licensing",
    "policy",
    "preprocessing",
    "privacy",
    "provider",
    "providerConfigDigest",
    "resources",
    "schemaVersion",
  ];
  exactObject(
    value,
    "manifest",
    requireDerived
      ? keys
      : keys.filter(
          (key) => key !== "providerConfigDigest" && key !== "featureSpaceId",
        ),
  );
  if (value.schemaVersion !== bodyContinuityProviderSchemaVersion) {
    throw typedError(
      `Body continuity manifest must use ${bodyContinuityProviderSchemaVersion}`,
      "BODY_CONTINUITY_SCHEMA_UNSUPPORTED",
    );
  }
  exactObject(value.provider, "manifest.provider", ["providerId", "versionId"]);
  exactObject(value.feature, "manifest.feature", [
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
  exactObject(value.policy, "manifest.policy", [
    "maximumBodiesPerAsset",
    "maximumComparisons",
    "minimumBidirectionalMargin",
    "minimumSimilarity",
    "missingAlternativeRule",
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

  return {
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
    feature: {
      artifactDigest: requiredDigest(
        value.feature.artifactDigest,
        "manifest.feature.artifactDigest",
      ),
      modelId: requiredPublicIdentifier(
        value.feature.modelId,
        "manifest.feature.modelId",
      ),
      modelVersionId: requiredPublicIdentifier(
        value.feature.modelVersionId,
        "manifest.feature.modelVersionId",
      ),
      scoreSemantics: requiredEnum(
        value.feature.scoreSemantics,
        "manifest.feature.scoreSemantics",
        ["unit_interval_similarity"],
      ),
    },
    licensing: {
      code: requiredEnum(value.licensing.code, "manifest.licensing.code", [
        "declared",
        "unknown",
      ]),
      model: requiredEnum(value.licensing.model, "manifest.licensing.model", [
        "declared",
        "unknown",
      ]),
      trainingData: requiredEnum(
        value.licensing.trainingData,
        "manifest.licensing.trainingData",
        ["declared", "unknown"],
      ),
    },
    policy: {
      maximumBodiesPerAsset: requiredInteger(
        value.policy.maximumBodiesPerAsset,
        "manifest.policy.maximumBodiesPerAsset",
        1,
        absoluteMaximumBodiesPerAsset,
      ),
      maximumComparisons: requiredInteger(
        value.policy.maximumComparisons,
        "manifest.policy.maximumComparisons",
        1,
        absoluteMaximumComparisons,
      ),
      minimumBidirectionalMargin: canonicalNumber(
        value.policy.minimumBidirectionalMargin,
        "manifest.policy.minimumBidirectionalMargin",
        { positive: true },
      ),
      minimumSimilarity: canonicalNumber(
        value.policy.minimumSimilarity,
        "manifest.policy.minimumSimilarity",
        { positive: true },
      ),
      missingAlternativeRule: requiredEnum(
        value.policy.missingAlternativeRule,
        "manifest.policy.missingAlternativeRule",
        ["abstain_without_alternative"],
      ),
    },
    preprocessing: {
      colorSpace: requiredEnum(
        value.preprocessing.colorSpace,
        "manifest.preprocessing.colorSpace",
        ["bgr", "rgb"],
      ),
      inputHeight: requiredInteger(
        value.preprocessing.inputHeight,
        "manifest.preprocessing.inputHeight",
        1,
        16_384,
      ),
      inputWidth: requiredInteger(
        value.preprocessing.inputWidth,
        "manifest.preprocessing.inputWidth",
        1,
        16_384,
      ),
      resizeMode: requiredEnum(
        value.preprocessing.resizeMode,
        "manifest.preprocessing.resizeMode",
        ["letterbox", "stretch"],
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
        1,
        65_536,
      ),
      maxRuntimeMs: requiredInteger(
        value.resources.maxRuntimeMs,
        "manifest.resources.maxRuntimeMs",
        1,
        86_400_000,
      ),
    },
    schemaVersion: bodyContinuityProviderSchemaVersion,
  };
};

export const deriveBodyContinuityProviderConfigDigest = (manifest) =>
  recognitionDigest(normalizeManifestCore(manifest, { requireDerived: false }));

export const deriveBodyContinuityFeatureSpaceId = (manifest) => {
  const core = normalizeManifestCore(manifest, { requireDerived: false });
  const providerConfigDigest = recognitionDigest(core);
  return `feature_space_${recognitionDigest({
    feature: core.feature,
    preprocessing: core.preprocessing,
    providerConfigDigest,
  })}`;
};

export const validateBodyContinuityProviderManifest = (value) => {
  const core = normalizeManifestCore(value);
  const providerConfigDigest = recognitionDigest(core);
  const featureSpaceId = `feature_space_${recognitionDigest({
    feature: core.feature,
    preprocessing: core.preprocessing,
    providerConfigDigest,
  })}`;
  if (
    requiredDigest(
      value.providerConfigDigest,
      "manifest.providerConfigDigest",
    ) !== providerConfigDigest
  ) {
    throw typedError("Provider configuration digest does not match manifest");
  }
  if (
    requiredFeatureSpace(value.featureSpaceId, "manifest.featureSpaceId") !==
    featureSpaceId
  ) {
    throw typedError("Feature-space identity does not match manifest");
  }
  return deepFreeze({ ...core, featureSpaceId, providerConfigDigest });
};

const bindingFromBodyValidation = (validation, label) => {
  projectValidatedBodyResultToLinker(validation);
  const { result, resultDigest } = validation;
  if (result == null || typeof result !== "object") {
    throw typedError(`${label} must be an exact validated body envelope`);
  }
  return {
    assetToken: result.assetToken,
    bodyIds: result.bodies.map((body) => body.bodyId).sort(),
    detectorConfigDigest: result.detectorConfigDigest,
    inputRevision: result.inputRevision,
    resultDigest,
    sourceContentDigest: result.sourceContentDigest,
    state: result.state,
  };
};

const normalizeAssetBinding = (value, expected, label) => {
  exactObject(value, label, [
    "assetToken",
    "bodyResultDigest",
    "detectorConfigDigest",
    "inputRevision",
    "sourceContentDigest",
  ]);
  const binding = {
    assetToken: requiredDigest(value.assetToken, `${label}.assetToken`),
    bodyResultDigest: requiredDigest(
      value.bodyResultDigest,
      `${label}.bodyResultDigest`,
    ),
    detectorConfigDigest: requiredDigest(
      value.detectorConfigDigest,
      `${label}.detectorConfigDigest`,
    ),
    inputRevision: requiredDigest(
      value.inputRevision,
      `${label}.inputRevision`,
    ),
    sourceContentDigest: requiredDigest(
      value.sourceContentDigest,
      `${label}.sourceContentDigest`,
    ),
  };
  if (
    binding.assetToken !== expected.assetToken ||
    binding.bodyResultDigest !== expected.resultDigest ||
    binding.detectorConfigDigest !== expected.detectorConfigDigest ||
    binding.inputRevision !== expected.inputRevision ||
    binding.sourceContentDigest !== expected.sourceContentDigest
  ) {
    throw typedError(`${label} does not match its validated body envelope`);
  }
  return binding;
};

const normalizeFeatureObservation = (value, label) => {
  exactObject(value, label, [
    "bodyId",
    "featureDigest",
    "quality",
    "reason",
    "state",
  ]);
  exactObject(value.quality, `${label}.quality`, [
    "occlusion",
    "truncation",
    "visibility",
  ]);
  const state = requiredEnum(value.state, `${label}.state`, [
    "abstained",
    "available",
    "missing",
  ]);
  const reason = requiredEnum(value.reason, `${label}.reason`, [
    "missing_feature",
    "none",
    "provider_abstained",
    "weak_crop",
  ]);
  if (
    (state === "available" && reason !== "none") ||
    (state === "missing" && reason !== "missing_feature") ||
    (state === "abstained" &&
      !["provider_abstained", "weak_crop"].includes(reason))
  ) {
    throw typedError(`${label} state and reason are inconsistent`);
  }
  const featureDigest =
    state === "available"
      ? requiredDigest(value.featureDigest, `${label}.featureDigest`)
      : value.featureDigest;
  if (state !== "available" && featureDigest !== null) {
    throw typedError(`${label} unavailable features require a null digest`);
  }
  return {
    bodyId: requiredBodyId(value.bodyId, `${label}.bodyId`),
    featureDigest,
    quality: {
      occlusion: canonicalNumber(
        value.quality.occlusion,
        `${label}.quality.occlusion`,
      ),
      truncation: canonicalNumber(
        value.quality.truncation,
        `${label}.quality.truncation`,
      ),
      visibility: canonicalNumber(
        value.quality.visibility,
        `${label}.quality.visibility`,
      ),
    },
    reason,
    state,
  };
};

const normalizeFeatureResult = (value, expected, label, manifest) => {
  exactObject(value, label, [
    "binding",
    "featureSpaceId",
    "observations",
    "schemaVersion",
  ]);
  if (value.schemaVersion !== bodyContinuityFeatureResultSchemaVersion) {
    throw typedError(
      `${label} must use ${bodyContinuityFeatureResultSchemaVersion}`,
      "BODY_CONTINUITY_SCHEMA_UNSUPPORTED",
    );
  }
  if (!Array.isArray(value.observations)) {
    throw typedError(`${label}.observations must be an array`);
  }
  if (
    value.observations.length > manifest.policy.maximumBodiesPerAsset ||
    value.observations.length > absoluteMaximumBodiesPerAsset
  ) {
    throw typedError(`${label} exceeds the body observation limit`);
  }
  const observations = value.observations
    .map((observation, index) =>
      normalizeFeatureObservation(
        observation,
        `${label}.observations[${index}]`,
      ),
    )
    .sort((left, right) => left.bodyId.localeCompare(right.bodyId));
  if (
    new Set(observations.map((observation) => observation.bodyId)).size !==
    observations.length
  ) {
    throw typedError(`${label} contains duplicate body observations`);
  }
  if (
    observations.length !== expected.bodyIds.length ||
    observations.some(
      (observation, index) => observation.bodyId !== expected.bodyIds[index],
    )
  ) {
    throw typedError(`${label} must account for every validated body exactly`);
  }
  return {
    binding: normalizeAssetBinding(value.binding, expected, `${label}.binding`),
    featureSpaceId: requiredFeatureSpace(
      value.featureSpaceId,
      `${label}.featureSpaceId`,
    ),
    observations,
    schemaVersion: bodyContinuityFeatureResultSchemaVersion,
  };
};

const normalizeComparison = (value, label) => {
  exactObject(value, label, ["leftBodyId", "rightBodyId", "similarity"]);
  return {
    leftBodyId: requiredBodyId(value.leftBodyId, `${label}.leftBodyId`),
    rightBodyId: requiredBodyId(value.rightBodyId, `${label}.rightBodyId`),
    similarity: canonicalNumber(value.similarity, `${label}.similarity`),
  };
};

const comparisonKey = (comparison) =>
  `${comparison.leftBodyId}\u001f${comparison.rightBodyId}`;

const canonicalPacketPayload = (value) => ({
  comparisons: [...value.comparisons].sort((left, right) =>
    comparisonKey(left).localeCompare(comparisonKey(right)),
  ),
  contextEvidenceDigest: value.contextEvidenceDigest,
  contextScope: value.contextScope,
  left: {
    ...value.left,
    observations: [...value.left.observations].sort((left, right) =>
      left.bodyId.localeCompare(right.bodyId),
    ),
  },
  providerConfigDigest: value.providerConfigDigest,
  right: {
    ...value.right,
    observations: [...value.right.observations].sort((left, right) =>
      left.bodyId.localeCompare(right.bodyId),
    ),
  },
  schemaVersion: value.schemaVersion,
});

export const deriveBodyContinuityComparisonResultDigest = (value) =>
  recognitionDigest({
    payload: canonicalPacketPayload(value),
    runId: value.runId,
  });

const normalizeComparisonPacket = (
  value,
  label,
  manifest,
  leftExpected,
  rightExpected,
) => {
  exactObject(value, label, [
    "comparisons",
    "contextEvidenceDigest",
    "contextScope",
    "left",
    "providerConfigDigest",
    "resultDigest",
    "right",
    "runId",
    "schemaVersion",
  ]);
  if (value.schemaVersion !== bodyContinuityComparisonSchemaVersion) {
    throw typedError(
      `${label} must use ${bodyContinuityComparisonSchemaVersion}`,
      "BODY_CONTINUITY_SCHEMA_UNSUPPORTED",
    );
  }
  if (!Array.isArray(value.comparisons)) {
    throw typedError(`${label}.comparisons must be an array`);
  }
  if (
    value.comparisons.length > manifest.policy.maximumComparisons ||
    value.comparisons.length > absoluteMaximumComparisons
  ) {
    throw typedError(`${label} exceeds the comparison limit`);
  }
  const normalized = {
    comparisons: value.comparisons
      .map((comparison, index) =>
        normalizeComparison(comparison, `${label}.comparisons[${index}]`),
      )
      .sort((left, right) =>
        comparisonKey(left).localeCompare(comparisonKey(right)),
      ),
    contextEvidenceDigest: requiredDigest(
      value.contextEvidenceDigest,
      `${label}.contextEvidenceDigest`,
    ),
    contextScope: requiredEnum(value.contextScope, `${label}.contextScope`, [
      "capture_context_candidate",
    ]),
    left: normalizeFeatureResult(
      value.left,
      leftExpected,
      `${label}.left`,
      manifest,
    ),
    providerConfigDigest: requiredDigest(
      value.providerConfigDigest,
      `${label}.providerConfigDigest`,
    ),
    right: normalizeFeatureResult(
      value.right,
      rightExpected,
      `${label}.right`,
      manifest,
    ),
    runId: requiredPublicIdentifier(value.runId, `${label}.runId`),
    schemaVersion: bodyContinuityComparisonSchemaVersion,
  };
  if (normalized.providerConfigDigest !== manifest.providerConfigDigest) {
    throw typedError(`${label} uses another provider configuration`);
  }
  const crossSpace =
    normalized.left.featureSpaceId !== manifest.featureSpaceId ||
    normalized.right.featureSpaceId !== manifest.featureSpaceId ||
    normalized.left.featureSpaceId !== normalized.right.featureSpaceId;
  const availableLeft = normalized.left.observations.filter(
    (observation) => observation.state === "available",
  );
  const availableRight = normalized.right.observations.filter(
    (observation) => observation.state === "available",
  );
  const expectedComparisonCount = crossSpace
    ? 0
    : availableLeft.length * availableRight.length;
  if (normalized.comparisons.length !== expectedComparisonCount) {
    throw typedError(`${label} must contain the complete comparison matrix`);
  }
  if (expectedComparisonCount > manifest.policy.maximumComparisons) {
    throw typedError(`${label} comparison matrix exceeds the manifest limit`);
  }
  const allowedLeft = new Set(
    availableLeft.map((observation) => observation.bodyId),
  );
  const allowedRight = new Set(
    availableRight.map((observation) => observation.bodyId),
  );
  const comparisonKeys = new Set();
  for (const comparison of normalized.comparisons) {
    if (
      !allowedLeft.has(comparison.leftBodyId) ||
      !allowedRight.has(comparison.rightBodyId)
    ) {
      throw typedError(`${label} comparison references unavailable evidence`);
    }
    const key = comparisonKey(comparison);
    if (comparisonKeys.has(key)) {
      throw typedError(`${label} contains duplicate comparisons`);
    }
    comparisonKeys.add(key);
  }
  if (comparisonKeys.size !== expectedComparisonCount) {
    throw typedError(`${label} comparison matrix is incomplete`);
  }
  const resultDigest = requiredDigest(
    value.resultDigest,
    `${label}.resultDigest`,
  );
  if (
    resultDigest !==
    deriveBodyContinuityComparisonResultDigest({
      ...normalized,
      resultDigest,
    })
  ) {
    throw typedError(`${label} result digest does not match its contents`);
  }
  const payload = canonicalPacketPayload(normalized);
  return {
    ...normalized,
    crossSpace,
    payloadDigest: recognitionDigest(payload),
    resultDigest,
  };
};

const observationToken = (resultDigest, bodyId) =>
  recognitionDigest({ bodyId, resultDigest });

const deriveDecision = (
  manifest,
  leftExpected,
  rightExpected,
  first,
  second,
) => {
  const unavailableFeatureCount = [
    ...first.left.observations,
    ...first.right.observations,
  ].filter((observation) => observation.state !== "available").length;
  const binding = {
    comparisonEvidenceDigest: recognitionDigest(
      [first.payloadDigest, second.payloadDigest].sort(),
    ),
    firstResultDigest: first.resultDigest,
    leftBodyResultDigest: leftExpected.resultDigest,
    rightBodyResultDigest: rightExpected.resultDigest,
    secondResultDigest: second.resultDigest,
  };
  const noBody =
    leftExpected.state === "no_body" || rightExpected.state === "no_body";
  const sameSourceObservation =
    leftExpected.sourceContentDigest === rightExpected.sourceContentDigest;
  const detectorConfigDrift =
    leftExpected.detectorConfigDigest !== rightExpected.detectorConfigDigest;
  const replayConsistent = first.payloadDigest === second.payloadDigest;

  if (!replayConsistent) {
    return {
      binding,
      decision: {
        ambiguousCount: 0,
        missingAlternativeCount: 0,
        reasons: ["REPLAY_COMPARISON_DRIFT"],
        state: "abstained",
        supportedEdgeCount: 0,
        unavailableFeatureCount,
      },
      edges: [],
      replayEvidence: "drift",
    };
  }
  if (sameSourceObservation) {
    return {
      binding,
      decision: {
        ambiguousCount: 0,
        missingAlternativeCount: 0,
        reasons: ["SAME_SOURCE_OBSERVATION"],
        state: "abstained",
        supportedEdgeCount: 0,
        unavailableFeatureCount,
      },
      edges: [],
      replayEvidence: "consistent",
    };
  }
  if (first.crossSpace) {
    return {
      binding,
      decision: {
        ambiguousCount: 0,
        missingAlternativeCount: 0,
        reasons: ["CROSS_FEATURE_SPACE"],
        state: "abstained",
        supportedEdgeCount: 0,
        unavailableFeatureCount,
      },
      edges: [],
      replayEvidence: "consistent",
    };
  }
  if (detectorConfigDrift) {
    return {
      binding,
      decision: {
        ambiguousCount: 0,
        missingAlternativeCount: 0,
        reasons: ["DETECTOR_CONFIG_DRIFT"],
        state: "abstained",
        supportedEdgeCount: 0,
        unavailableFeatureCount,
      },
      edges: [],
      replayEvidence: "consistent",
    };
  }
  if (noBody) {
    return {
      binding,
      decision: {
        ambiguousCount: 0,
        missingAlternativeCount: 0,
        reasons: ["NO_BODY_EVIDENCE"],
        state: "unavailable",
        supportedEdgeCount: 0,
        unavailableFeatureCount,
      },
      edges: [],
      replayEvidence: "consistent",
    };
  }

  const availableLeft = first.left.observations.filter(
    (observation) => observation.state === "available",
  );
  const availableRight = first.right.observations.filter(
    (observation) => observation.state === "available",
  );
  if (availableLeft.length === 0 || availableRight.length === 0) {
    return {
      binding,
      decision: {
        ambiguousCount: 0,
        missingAlternativeCount: 0,
        reasons: ["FEATURE_EVIDENCE_UNAVAILABLE"],
        state: "unavailable",
        supportedEdgeCount: 0,
        unavailableFeatureCount,
      },
      edges: [],
      replayEvidence: "consistent",
    };
  }

  const byLeft = new Map(
    availableLeft.map((observation) => [observation.bodyId, []]),
  );
  const byRight = new Map(
    availableRight.map((observation) => [observation.bodyId, []]),
  );
  for (const comparison of first.comparisons) {
    byLeft.get(comparison.leftBodyId).push(comparison);
    byRight.get(comparison.rightBodyId).push(comparison);
  }
  const rankLeft = new Map();
  const rankRight = new Map();
  let missingAlternativeCount = 0;
  let ambiguousCount = 0;
  for (const [bodyId, comparisons] of byLeft) {
    const ranked = [...comparisons].sort(
      (left, right) =>
        right.similarity - left.similarity ||
        left.rightBodyId.localeCompare(right.rightBodyId),
    );
    const missingAlternative = ranked.length < 2;
    if (missingAlternative) missingAlternativeCount += 1;
    const margin = missingAlternative
      ? null
      : roundNumber(ranked[0].similarity - ranked[1].similarity);
    if (
      !missingAlternative &&
      margin < manifest.policy.minimumBidirectionalMargin
    )
      ambiguousCount += 1;
    rankLeft.set(bodyId, { margin, top: ranked[0] });
  }
  for (const [bodyId, comparisons] of byRight) {
    const ranked = [...comparisons].sort(
      (left, right) =>
        right.similarity - left.similarity ||
        left.leftBodyId.localeCompare(right.leftBodyId),
    );
    const missingAlternative = ranked.length < 2;
    if (missingAlternative) missingAlternativeCount += 1;
    const margin = missingAlternative
      ? null
      : roundNumber(ranked[0].similarity - ranked[1].similarity);
    if (
      !missingAlternative &&
      margin < manifest.policy.minimumBidirectionalMargin
    )
      ambiguousCount += 1;
    rankRight.set(bodyId, { margin, top: ranked[0] });
  }
  if (missingAlternativeCount > 0) {
    return {
      binding,
      decision: {
        ambiguousCount,
        missingAlternativeCount,
        reasons: ["MISSING_ALTERNATIVE_EVIDENCE"],
        state: "abstained",
        supportedEdgeCount: 0,
        unavailableFeatureCount,
      },
      edges: [],
      replayEvidence: "consistent",
    };
  }
  if (ambiguousCount > 0) {
    return {
      binding,
      decision: {
        ambiguousCount,
        missingAlternativeCount,
        reasons: ["AMBIGUOUS_APPEARANCE_ASSIGNMENT"],
        state: "ambiguous",
        supportedEdgeCount: 0,
        unavailableFeatureCount,
      },
      edges: [],
      replayEvidence: "consistent",
    };
  }

  const edges = [];
  for (const [leftBodyId, leftRank] of rankLeft) {
    const comparison = leftRank.top;
    const rightRank = rankRight.get(comparison.rightBodyId);
    if (
      rightRank.top.leftBodyId !== leftBodyId ||
      comparison.similarity < manifest.policy.minimumSimilarity ||
      leftRank.margin < manifest.policy.minimumBidirectionalMargin ||
      rightRank.margin < manifest.policy.minimumBidirectionalMargin
    ) {
      continue;
    }
    const leftObservationToken = observationToken(
      leftExpected.resultDigest,
      leftBodyId,
    );
    const rightObservationToken = observationToken(
      rightExpected.resultDigest,
      comparison.rightBodyId,
    );
    const core = {
      leftMargin: leftRank.margin,
      leftObservationToken,
      rightMargin: rightRank.margin,
      rightObservationToken,
      similarity: comparison.similarity,
    };
    edges.push({
      ...core,
      evidenceDigest: recognitionDigest({
        ...core,
        comparisonEvidenceDigest: binding.comparisonEvidenceDigest,
        contextEvidenceDigest: first.contextEvidenceDigest,
        featureSpaceId: manifest.featureSpaceId,
      }),
    });
  }
  edges.sort((left, right) =>
    left.leftObservationToken.localeCompare(right.leftObservationToken),
  );
  return {
    binding,
    decision: {
      ambiguousCount,
      missingAlternativeCount,
      reasons:
        edges.length > 0
          ? ["UNIQUE_MUTUAL_BEST_SUPPORTED"]
          : ["WEAK_APPEARANCE_EVIDENCE"],
      state: edges.length > 0 ? "supported" : "unsupported",
      supportedEdgeCount: edges.length,
      unavailableFeatureCount,
    },
    edges,
    replayEvidence: "consistent",
  };
};

export const bodyContinuityContractDigest = recognitionDigest({
  absoluteMaximumBodiesPerAsset,
  absoluteMaximumComparisons,
  bodyContinuityComparisonSchemaVersion,
  bodyContinuityEdgeProjectionSchemaVersion,
  bodyContinuityFeatureResultSchemaVersion,
  bodyContinuityProviderSchemaVersion,
  bodyContinuityValidationReceiptSchemaVersion,
  bodyDetectionContractDigest,
  numberPrecision,
});

export const validateBodyContinuityComparison = (input) => {
  exactObject(input, "input", [
    "first",
    "leftBodyValidation",
    "manifest",
    "rightBodyValidation",
    "second",
  ]);
  const {
    first,
    leftBodyValidation,
    manifest: manifestInput,
    rightBodyValidation,
    second,
  } = input;
  const manifest = validateBodyContinuityProviderManifest(manifestInput);
  const leftExpected = bindingFromBodyValidation(
    leftBodyValidation,
    "leftBodyValidation",
  );
  const rightExpected = bindingFromBodyValidation(
    rightBodyValidation,
    "rightBodyValidation",
  );
  if (leftExpected.assetToken === rightExpected.assetToken) {
    throw typedError("Cross-photo continuity requires two distinct assets");
  }
  if (
    leftExpected.bodyIds.length > manifest.policy.maximumBodiesPerAsset ||
    rightExpected.bodyIds.length > manifest.policy.maximumBodiesPerAsset
  ) {
    throw typedError("Validated body envelope exceeds the manifest body limit");
  }
  const normalizedFirst = normalizeComparisonPacket(
    first,
    "first",
    manifest,
    leftExpected,
    rightExpected,
  );
  const normalizedSecond = normalizeComparisonPacket(
    second,
    "second",
    manifest,
    leftExpected,
    rightExpected,
  );
  if (normalizedFirst.runId === normalizedSecond.runId) {
    throw typedError("Replay packets require distinct public run identifiers");
  }
  const derived = deriveDecision(
    manifest,
    leftExpected,
    rightExpected,
    normalizedFirst,
    normalizedSecond,
  );
  const validation = deepFreeze({
    binding: derived.binding,
    decision: derived.decision,
    edges: derived.edges,
    first: normalizedFirst,
    manifest,
    replayEvidence: derived.replayEvidence,
    second: normalizedSecond,
  });
  validatedContinuityEnvelopes.add(validation);
  privateContinuityBindings.set(
    validation,
    deepFreeze({ left: leftExpected, right: rightExpected }),
  );
  return validation;
};

const requireValidatedContinuityEnvelope = (validation) => {
  if (
    validation == null ||
    typeof validation !== "object" ||
    !validatedContinuityEnvelopes.has(validation)
  ) {
    throw typedError("An exact validated continuity envelope is required");
  }
  return validation;
};

export const createBodyContinuityValidationReceipt = (validationInput) => {
  const validation = requireValidatedContinuityEnvelope(validationInput);
  const receipt = {
    authority: {
      activation: "none",
      automaticIdentityAuthority: "none",
      persistence: "none",
      recommendation: "none",
      training: "none",
    },
    binding: {
      comparisonEvidenceDigest: validation.binding.comparisonEvidenceDigest,
      contractDigest: bodyContinuityContractDigest,
      featureSpaceId: validation.manifest.featureSpaceId,
      firstResultDigest: validation.binding.firstResultDigest,
      leftBodyResultDigest: validation.binding.leftBodyResultDigest,
      providerConfigDigest: validation.manifest.providerConfigDigest,
      rightBodyResultDigest: validation.binding.rightBodyResultDigest,
      secondResultDigest: validation.binding.secondResultDigest,
    },
    boundary: {
      captureContextScore: "none",
      currentRepositoryRevisionValidation: "not_performed",
      geometryScore: "none",
      operationalStaleStateDetection: "none",
      providerExecution: "none",
      providerExecutionProof: "none",
      rawFeatures: "none",
      repositoryWrites: "none",
    },
    decision: validation.decision,
    nonRepresentative: true,
    operationalUse: "none",
    replay: {
      evidence: validation.replayEvidence,
      packetCount: 2,
      providerExecutionProof: "none",
    },
    schemaVersion: bodyContinuityValidationReceiptSchemaVersion,
  };
  return deepFreeze({ ...receipt, receiptDigest: recognitionDigest(receipt) });
};

export const projectValidatedBodyContinuityEdges = (validationInput) => {
  const validation = requireValidatedContinuityEnvelope(validationInput);
  return deepFreeze({
    authority: {
      activation: "none",
      automaticIdentityAuthority: "none",
      persistence: "none",
      recommendation: "none",
      training: "none",
    },
    binding: {
      comparisonEvidenceDigest: validation.binding.comparisonEvidenceDigest,
      featureSpaceId: validation.manifest.featureSpaceId,
      providerConfigDigest: validation.manifest.providerConfigDigest,
    },
    boundary: {
      currentRepositoryRevisionValidation: "not_performed",
      operationalStaleStateDetection: "none",
      providerExecutionProof: "none",
    },
    edges: validation.edges,
    nonRepresentative: true,
    operationalUse: "none",
    reasons: validation.decision.reasons,
    schemaVersion: bodyContinuityEdgeProjectionSchemaVersion,
    state: validation.decision.state,
  });
};

export const projectValidatedBodyContinuityForRepository = (
  validationInput,
) => {
  const validation = requireValidatedContinuityEnvelope(validationInput);
  const privateBinding = privateContinuityBindings.get(validation);
  if (!privateBinding) {
    throw typedError("Continuity repository binding is unavailable");
  }
  const leftTokens = new Map(
    privateBinding.left.bodyIds.map((bodyId) => [
      observationToken(privateBinding.left.resultDigest, bodyId),
      bodyId,
    ]),
  );
  const rightTokens = new Map(
    privateBinding.right.bodyIds.map((bodyId) => [
      observationToken(privateBinding.right.resultDigest, bodyId),
      bodyId,
    ]),
  );
  const edges = validation.edges.map((edge) => {
    const leftBodyId = leftTokens.get(edge.leftObservationToken);
    const rightBodyId = rightTokens.get(edge.rightObservationToken);
    if (!leftBodyId || !rightBodyId) {
      throw typedError("Continuity edge is outside its exact Body envelopes");
    }
    return { ...edge, leftBodyId, rightBodyId };
  });
  return deepFreeze({
    decision: validation.decision,
    edges,
    left: privateBinding.left,
    right: privateBinding.right,
    schemaVersion: bodyContinuityRepositoryProjectionSchemaVersion,
  });
};
