import { createHash } from "node:crypto";

export const bodyDetectorSchemaVersion = "cimmich.body-detector.v1";
export const bodyDetectionResultSchemaVersion =
  "cimmich.body-detection-result.v1";
export const bodyDetectionValidationReceiptSchemaVersion =
  "cimmich.body-detection-validation-receipt.v1";
export const bodyDetectionRepositoryProjectionSchemaVersion =
  "cimmich.body-detection-repository-projection.v1";

const digestPattern = /^[0-9a-f]{64}$/;
const publicIdentifierPattern = /^[a-z0-9](?:[a-z0-9._-]{0,63})$/;
const qualityKeys = Object.freeze(["occlusion", "truncation", "visibility"]);
const validatedEnvelopes = new WeakSet();
const validatedResultBrand = Symbol("cimmich.validated-body-detection-result");

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

export const bodyDetectionDigest = (value) =>
  createHash("sha256")
    .update(
      typeof value === "string" ? value : JSON.stringify(canonicalize(value)),
    )
    .digest("hex");

const typedError = (message) =>
  Object.assign(new Error(message), {
    code: "BODY_DETECTOR_INPUT_INVALID",
    statusCode: 400,
  });

const exactObject = (value, label, allowedKeys, requiredKeys = allowedKeys) => {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw typedError(`${label} must be an object`);
  }
  const keys = Object.keys(value);
  if (keys.some((key) => !allowedKeys.includes(key))) {
    throw typedError(`${label} contains unsupported fields`);
  }
  if (requiredKeys.some((key) => !Object.hasOwn(value, key))) {
    throw typedError(`${label} is missing required fields`);
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

const requiredDigest = (value, label) => {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    throw typedError(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
};

const requiredEnum = (value, label, allowed) => {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw typedError(`${label} is unsupported`);
  }
  return value;
};

const requiredInteger = (value, label, minimum, maximum) => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw typedError(`${label} is outside its allowed integer range`);
  }
  return value;
};

const requiredUnitInterval = (value, label) => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw typedError(`${label} must be a finite number from 0 to 1`);
  }
  return value;
};

const normalizeBox = (value, label) => {
  exactObject(value, label, ["h", "w", "x", "y"]);
  const box = {
    h: requiredUnitInterval(value.h, `${label}.h`),
    w: requiredUnitInterval(value.w, `${label}.w`),
    x: requiredUnitInterval(value.x, `${label}.x`),
    y: requiredUnitInterval(value.y, `${label}.y`),
  };
  if (box.w <= 0 || box.h <= 0) {
    throw typedError(`${label} width and height must be positive`);
  }
  if (box.x + box.w > 1.000001 || box.y + box.h > 1.000001) {
    throw typedError(`${label} must fit within normalized image space`);
  }
  return box;
};

const normalizeQuality = (value, label) => {
  if (value === undefined) return {};
  exactObject(value, label, qualityKeys, []);
  return Object.fromEntries(
    qualityKeys
      .filter((key) => Object.hasOwn(value, key))
      .map((key) => [key, requiredUnitInterval(value[key], `${label}.${key}`)]),
  );
};

const normalizeManifestCore = (value, { requireConfigDigest = true } = {}) => {
  const manifestKeys = [
    "detector",
    "detectorConfigDigest",
    "execution",
    "licensing",
    "preprocessing",
    "privacy",
    "provider",
    "resources",
    "schemaVersion",
  ];
  exactObject(
    value,
    "manifest",
    manifestKeys,
    requireConfigDigest
      ? manifestKeys
      : manifestKeys.filter((key) => key !== "detectorConfigDigest"),
  );
  if (value.schemaVersion !== bodyDetectorSchemaVersion) {
    throw typedError(
      `Body detector schema must be ${bodyDetectorSchemaVersion}`,
    );
  }
  exactObject(value.provider, "manifest.provider", ["providerId", "versionId"]);
  exactObject(value.detector, "manifest.detector", [
    "artifactDigest",
    "modelId",
    "modelVersionId",
    "scoreThreshold",
  ]);
  exactObject(value.preprocessing, "manifest.preprocessing", [
    "colorSpace",
    "coordinateSpace",
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
    detector: {
      artifactDigest: requiredDigest(
        value.detector.artifactDigest,
        "manifest.detector.artifactDigest",
      ),
      modelId: requiredPublicIdentifier(
        value.detector.modelId,
        "manifest.detector.modelId",
      ),
      modelVersionId: requiredPublicIdentifier(
        value.detector.modelVersionId,
        "manifest.detector.modelVersionId",
      ),
      scoreThreshold: requiredUnitInterval(
        value.detector.scoreThreshold,
        "manifest.detector.scoreThreshold",
      ),
    },
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
        "unknown",
      ]),
      trainingData: requiredEnum(
        value.licensing.trainingData,
        "manifest.licensing.trainingData",
        ["declared", "unknown"],
      ),
    },
    preprocessing: {
      colorSpace: requiredEnum(
        value.preprocessing.colorSpace,
        "manifest.preprocessing.colorSpace",
        ["bgr", "rgb"],
      ),
      coordinateSpace: requiredEnum(
        value.preprocessing.coordinateSpace,
        "manifest.preprocessing.coordinateSpace",
        ["normalized_image"],
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
        1_048_576,
      ),
      maxRuntimeMs: requiredInteger(
        value.resources.maxRuntimeMs,
        "manifest.resources.maxRuntimeMs",
        1,
        86_400_000,
      ),
    },
    schemaVersion: bodyDetectorSchemaVersion,
  };
  return core;
};

export const deriveBodyDetectorConfigDigest = (manifest) =>
  bodyDetectionDigest(
    normalizeManifestCore(manifest, { requireConfigDigest: false }),
  );

export const validateBodyDetectorManifest = (value) => {
  const core = normalizeManifestCore(value);
  const detectorConfigDigest = bodyDetectionDigest(core);
  if (
    requiredDigest(
      value.detectorConfigDigest,
      "manifest.detectorConfigDigest",
    ) !== detectorConfigDigest
  ) {
    throw typedError("Body detector config digest does not match its contents");
  }
  return deepFreeze({ ...core, detectorConfigDigest });
};

const normalizeObservation = (value, index) => {
  const label = `result.bodies[${index}]`;
  exactObject(
    value,
    label,
    ["box", "confidence", "headBox", "quality"],
    ["box", "confidence"],
  );
  const box = normalizeBox(value.box, `${label}.box`);
  const headBox =
    value.headBox == null
      ? null
      : normalizeBox(value.headBox, `${label}.headBox`);
  if (headBox) {
    if (headBox.w * headBox.h > box.w * box.h + 1e-12) {
      throw typedError(`${label}.headBox area cannot exceed its body box`);
    }
    const centerX = headBox.x + headBox.w / 2;
    const centerY = headBox.y + headBox.h / 2;
    if (
      centerX < box.x ||
      centerX > box.x + box.w ||
      centerY < box.y ||
      centerY > box.y + box.h
    ) {
      throw typedError(`${label}.headBox center must lie inside its body box`);
    }
  }
  const core = {
    box,
    confidence: requiredUnitInterval(value.confidence, `${label}.confidence`),
    headBox,
    quality: normalizeQuality(value.quality, `${label}.quality`),
  };
  return { ...core, observationKey: bodyDetectionDigest(core) };
};

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

export const validateBodyDetectionResult = (value, manifestInput) => {
  const manifest = validateBodyDetectorManifest(manifestInput);
  exactObject(value, "result", [
    "assetToken",
    "bodies",
    "detectorConfigDigest",
    "inputRevision",
    "schemaVersion",
    "sourceContentDigest",
    "state",
  ]);
  if (value.schemaVersion !== bodyDetectionResultSchemaVersion) {
    throw typedError(
      `Body detection result schema must be ${bodyDetectionResultSchemaVersion}`,
    );
  }
  if (!Array.isArray(value.bodies)) {
    throw typedError("result.bodies must be an array");
  }
  if (value.bodies.length > 1000) {
    throw typedError("Body detection result exceeds 1000 observations");
  }
  const assetToken = requiredDigest(value.assetToken, "result.assetToken");
  const detectorConfigDigest = requiredDigest(
    value.detectorConfigDigest,
    "result.detectorConfigDigest",
  );
  if (detectorConfigDigest !== manifest.detectorConfigDigest) {
    throw typedError(
      "Body detection result uses another detector configuration",
    );
  }
  const inputRevision = requiredDigest(
    value.inputRevision,
    "result.inputRevision",
  );
  const sourceContentDigest = requiredDigest(
    value.sourceContentDigest,
    "result.sourceContentDigest",
  );
  const state = requiredEnum(value.state, "result.state", [
    "bodies_detected",
    "no_body",
  ]);
  const observations = value.bodies
    .map(normalizeObservation)
    .sort((left, right) =>
      left.observationKey.localeCompare(right.observationKey),
    );
  if (
    new Set(observations.map((observation) => observation.observationKey))
      .size !== observations.length
  ) {
    throw typedError("Body detection result contains duplicate observations");
  }
  if (state === "no_body" && observations.length !== 0) {
    throw typedError("no_body results cannot contain observations");
  }
  if (state === "bodies_detected" && observations.length === 0) {
    throw typedError("bodies_detected results require observations");
  }
  const bodies = observations.map((observation) => ({
    ...observation,
    bodyId: `body_${bodyDetectionDigest({
      assetToken,
      detectorConfigDigest,
      inputRevision,
      observationKey: observation.observationKey,
    }).slice(0, 40)}`,
  }));
  const result = {
    assetToken,
    bodies,
    detectorConfigDigest,
    inputRevision,
    schemaVersion: bodyDetectionResultSchemaVersion,
    sourceContentDigest,
    state,
  };
  const resultDigest = bodyDetectionDigest(result);
  Object.defineProperty(result, validatedResultBrand, { value: true });
  deepFreeze(result);
  const validation = deepFreeze({ manifest, result, resultDigest });
  validatedEnvelopes.add(validation);
  return validation;
};

export const projectValidatedBodyResultToLinker = (validation) => {
  if (
    validation == null ||
    typeof validation !== "object" ||
    !validatedEnvelopes.has(validation) ||
    validation.result?.[validatedResultBrand] !== true ||
    validation.manifest?.detectorConfigDigest !==
      validation.result?.detectorConfigDigest ||
    bodyDetectionDigest(validation.result) !== validation.resultDigest
  ) {
    throw typedError("Linker projection requires a validated body result");
  }
  return {
    assetId: validation.result.assetToken,
    bodies: validation.result.bodies.map((body) => ({
      bodyId: body.bodyId,
      boxH: body.box.h,
      boxW: body.box.w,
      boxX: body.box.x,
      boxY: body.box.y,
      ...(body.headBox
        ? {
            headBox: {
              boxH: body.headBox.h,
              boxW: body.headBox.w,
              boxX: body.headBox.x,
              boxY: body.headBox.y,
            },
          }
        : {}),
    })),
  };
};

export const projectValidatedBodyResultForRepository = (validation) => {
  if (
    validation == null ||
    typeof validation !== "object" ||
    !validatedEnvelopes.has(validation) ||
    validation.result?.[validatedResultBrand] !== true ||
    validation.manifest?.detectorConfigDigest !==
      validation.result?.detectorConfigDigest ||
    bodyDetectionDigest(validation.result) !== validation.resultDigest
  ) {
    throw typedError(
      "Repository projection requires an exact validated body result",
    );
  }
  return deepFreeze({
    artifactDigest: validation.manifest.detector.artifactDigest,
    assetToken: validation.result.assetToken,
    bodies: validation.result.bodies.map((body) => ({
      bodyId: body.bodyId,
      box: body.box,
      confidence: body.confidence,
      headBox: body.headBox,
      observationKey: body.observationKey,
      quality: body.quality,
      qualityDigest: bodyDetectionDigest(body.quality),
    })),
    detectorConfigDigest: validation.result.detectorConfigDigest,
    inputRevision: validation.result.inputRevision,
    providerId: validation.manifest.provider.providerId,
    providerVersionId: validation.manifest.provider.versionId,
    resultDigest: validation.resultDigest,
    schemaVersion: bodyDetectionRepositoryProjectionSchemaVersion,
    sourceContentDigest: validation.result.sourceContentDigest,
    state: validation.result.state,
  });
};

export const bodyDetectionContractDigest = bodyDetectionDigest({
  manifestSchemaVersion: bodyDetectorSchemaVersion,
  receiptSchemaVersion: bodyDetectionValidationReceiptSchemaVersion,
  resultSchemaVersion: bodyDetectionResultSchemaVersion,
});

export const createBodyDetectionValidationReceipt = (validation) => {
  if (
    validation == null ||
    typeof validation !== "object" ||
    !validatedEnvelopes.has(validation) ||
    validation?.result?.[validatedResultBrand] !== true ||
    validation.manifest?.detectorConfigDigest !==
      validation.result?.detectorConfigDigest ||
    bodyDetectionDigest(validation.result) !== validation.resultDigest
  ) {
    throw typedError("Body detection receipt requires a validated result");
  }
  const manifest = validateBodyDetectorManifest(validation.manifest);
  if (
    manifest.detectorConfigDigest !== validation.result.detectorConfigDigest
  ) {
    throw typedError(
      "Body detection receipt manifest/result binding is invalid",
    );
  }
  const receipt = {
    authority: {
      activation: "none",
      automaticIdentityAuthority: "none",
      recommendation: "none",
      training: "none",
    },
    boundary: {
      databaseWrites: "none",
      externalNetwork: "none",
      identityWrites: "none",
      immichWrites: "none",
      persistence: "none",
      providerExecution: "none",
      sourceMediaReads: "none",
      sourceMediaWrites: "none",
    },
    contractDigest: bodyDetectionContractDigest,
    detectorArtifactDigest: manifest.detector.artifactDigest,
    detectorConfigDigest: manifest.detectorConfigDigest,
    observationCount: validation.result.bodies.length,
    resultDigest: validation.resultDigest,
    schemaVersion: bodyDetectionValidationReceiptSchemaVersion,
    state: validation.result.state,
  };
  return { ...receipt, receiptDigest: bodyDetectionDigest(receipt) };
};

export const validateBodyDetectorPacket = (value) => {
  exactObject(value, "input", ["manifest", "result"]);
  return validateBodyDetectionResult(value.result, value.manifest);
};
