import { createHash } from "node:crypto";

export const recognitionProviderSchemaVersion =
  "cimmich.recognition-provider.v1";
export const recognitionObservationSchemaVersion =
  "cimmich.recognition-observation.v1";
export const recognitionCheckpointSchemaVersion =
  "cimmich.recognition-checkpoint.v1";
export const recognitionReceiptSchemaVersion =
  "cimmich.recognition-batch-receipt.v1";

const sha256Pattern = /^[0-9a-f]{64}$/;
const terminalStates = new Set(["embedded", "abstained", "failed"]);

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

export const canonicalRecognitionJson = (value) =>
  JSON.stringify(canonicalize(value));

export const recognitionDigest = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : canonicalRecognitionJson(value))
    .digest("hex");

const requiredText = (value, label) => {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`Recognition contract requires ${label}`);
  return normalized;
};

const requiredDigest = (value, label) => {
  const digest = requiredText(value, label);
  if (!sha256Pattern.test(digest)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
  return digest;
};

const requiredPositiveInteger = (value, label) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return number;
};

const requiredUnitInterval = (value, label) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 1) {
    throw new Error(`${label} must be in (0, 1]`);
  }
  return number;
};

const vectorBytes = (vector) => {
  const bytes = Buffer.allocUnsafe(vector.length * 4);
  vector.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  return bytes;
};

export const recognitionVectorDigest = (vector) =>
  createHash("sha256").update(vectorBytes(vector)).digest("hex");

const normalizedManifestCore = (manifest) => ({
  detector: {
    artifactSha256: requiredDigest(
      manifest?.detector?.artifactSha256,
      "detector.artifactSha256",
    ),
    inputSize: [
      requiredPositiveInteger(
        manifest?.detector?.inputSize?.[0],
        "detector.inputSize[0]",
      ),
      requiredPositiveInteger(
        manifest?.detector?.inputSize?.[1],
        "detector.inputSize[1]",
      ),
    ],
    model: requiredText(manifest?.detector?.model, "detector.model"),
    modelVersion: requiredText(
      manifest?.detector?.modelVersion,
      "detector.modelVersion",
    ),
    scoreThreshold: requiredUnitInterval(
      manifest?.detector?.scoreThreshold,
      "detector.scoreThreshold",
    ),
  },
  embedding: {
    dimension: requiredPositiveInteger(
      manifest?.embedding?.dimension,
      "embedding.dimension",
    ),
    metric: requiredText(manifest?.embedding?.metric, "embedding.metric"),
    normalized: manifest?.embedding?.normalized === true,
  },
  preprocessing: {
    alignment: requiredText(
      manifest?.preprocessing?.alignment,
      "preprocessing.alignment",
    ),
    colorSpace: requiredText(
      manifest?.preprocessing?.colorSpace,
      "preprocessing.colorSpace",
    ),
    inputSize: [
      requiredPositiveInteger(
        manifest?.preprocessing?.inputSize?.[0],
        "preprocessing.inputSize[0]",
      ),
      requiredPositiveInteger(
        manifest?.preprocessing?.inputSize?.[1],
        "preprocessing.inputSize[1]",
      ),
    ],
    pipelineVersion: requiredText(
      manifest?.preprocessing?.pipelineVersion,
      "preprocessing.pipelineVersion",
    ),
  },
  provider: {
    name: requiredText(manifest?.provider?.name, "provider.name"),
    version: requiredText(manifest?.provider?.version, "provider.version"),
  },
  recognizer: {
    artifactSha256: requiredDigest(
      manifest?.recognizer?.artifactSha256,
      "recognizer.artifactSha256",
    ),
    model: requiredText(manifest?.recognizer?.model, "recognizer.model"),
    modelVersion: requiredText(
      manifest?.recognizer?.modelVersion,
      "recognizer.modelVersion",
    ),
  },
});

const normalizedExecution = (manifest) => ({
  device: requiredText(manifest?.execution?.device, "execution.device"),
  network: requiredText(manifest?.execution?.network, "execution.network"),
  runtime: requiredText(manifest?.execution?.runtime, "execution.runtime"),
  threads: requiredPositiveInteger(
    manifest?.execution?.threads,
    "execution.threads",
  ),
});

const normalizedLicensing = (manifest) => ({
  code: requiredText(manifest?.licensing?.code, "licensing.code"),
  model: requiredText(manifest?.licensing?.model, "licensing.model"),
  trainingData: requiredText(
    manifest?.licensing?.trainingData,
    "licensing.trainingData",
  ),
});

const normalizedPrivacy = (manifest) => ({
  externalUpload: requiredText(
    manifest?.privacy?.externalUpload,
    "privacy.externalUpload",
  ),
  sourceMedia: requiredText(
    manifest?.privacy?.sourceMedia,
    "privacy.sourceMedia",
  ),
});

const normalizedRecognitionSpace = (manifest, core) => {
  const declared = manifest?.recognitionSpace;
  if (declared == null) {
    return {
      detectorInputSize: core.detector.inputSize,
      modelFamily: core.recognizer.model,
      modelVersion: core.recognizer.modelVersion,
      pipelineVersion: core.preprocessing.pipelineVersion,
      recognitionModelSha256: core.recognizer.artifactSha256,
    };
  }
  if (
    typeof declared !== "object" ||
    Array.isArray(declared) ||
    Object.keys(declared).sort().join(",") !==
      "detectorInputSize,modelFamily,modelVersion,pipelineVersion,recognitionModelSha256"
  ) {
    throw new Error(
      "Recognition provider recognitionSpace must use the exact contract fields",
    );
  }
  const detectorInputSize = [
    requiredPositiveInteger(
      declared.detectorInputSize?.[0],
      "recognitionSpace.detectorInputSize[0]",
    ),
    requiredPositiveInteger(
      declared.detectorInputSize?.[1],
      "recognitionSpace.detectorInputSize[1]",
    ),
  ];
  const recognitionModelSha256 = requiredDigest(
    declared.recognitionModelSha256,
    "recognitionSpace.recognitionModelSha256",
  );
  if (
    detectorInputSize[0] !== core.detector.inputSize[0] ||
    detectorInputSize[1] !== core.detector.inputSize[1] ||
    recognitionModelSha256 !== core.recognizer.artifactSha256
  ) {
    throw new Error(
      "Recognition provider recognitionSpace conflicts with its model artifacts",
    );
  }
  return {
    detectorInputSize,
    modelFamily: requiredText(
      declared.modelFamily,
      "recognitionSpace.modelFamily",
    ),
    modelVersion: requiredText(
      declared.modelVersion,
      "recognitionSpace.modelVersion",
    ),
    pipelineVersion: requiredText(
      declared.pipelineVersion,
      "recognitionSpace.pipelineVersion",
    ),
    recognitionModelSha256,
  };
};

const hasDeclaredRecognitionSpace = (manifest) =>
  manifest?.recognitionSpaceExplicit === false
    ? false
    : manifest?.recognitionSpace != null;

export const deriveRecognitionSpaceConfigDigest = (manifest) => {
  if (!hasDeclaredRecognitionSpace(manifest)) {
    return deriveProviderConfigDigest(manifest);
  }
  const core = normalizedManifestCore(manifest);
  const space = normalizedRecognitionSpace(manifest, core);
  return recognitionDigest({
    det_size: space.detectorInputSize,
    model_family: space.modelFamily,
    model_version: space.modelVersion,
    pipeline: space.pipelineVersion,
    recognition_model_sha256: space.recognitionModelSha256,
  });
};

export const deriveVectorSpaceId = (manifest) => {
  const core = normalizedManifestCore(manifest);
  return `vector_space_${recognitionDigest({
    embedding: core.embedding,
    preprocessing: core.preprocessing,
    recognizer: core.recognizer,
  })}`;
};

export const deriveProviderConfigDigest = (manifest) => {
  const core = normalizedManifestCore(manifest);
  return recognitionDigest({
    ...core,
    execution: normalizedExecution(manifest),
    licensing: normalizedLicensing(manifest),
    privacy: normalizedPrivacy(manifest),
    recognitionSpace: !hasDeclaredRecognitionSpace(manifest)
      ? undefined
      : normalizedRecognitionSpace(manifest, core),
  });
};

export const validateRecognitionProviderManifest = (manifest) => {
  if (manifest?.schemaVersion !== recognitionProviderSchemaVersion) {
    throw new Error(
      `Recognition provider schema must be ${recognitionProviderSchemaVersion}`,
    );
  }
  const core = normalizedManifestCore(manifest);
  if (core.embedding.metric !== "cosine") {
    throw new Error("Recognition provider metric must be cosine");
  }
  if (!core.embedding.normalized) {
    throw new Error("Recognition provider embeddings must be normalized");
  }
  const execution = normalizedExecution(manifest);
  const licensing = normalizedLicensing(manifest);
  const privacy = normalizedPrivacy(manifest);
  const recognitionSpace = normalizedRecognitionSpace(manifest, core);
  const recognitionSpaceExplicit = hasDeclaredRecognitionSpace(manifest);
  if (execution.network !== "forbidden") {
    throw new Error(
      "Local recognition provider network access must be forbidden",
    );
  }
  if (privacy.sourceMedia !== "local-read-only") {
    throw new Error(
      "Recognition provider source media must be local-read-only",
    );
  }
  if (privacy.externalUpload !== "none") {
    throw new Error("Local recognition providers cannot upload source media");
  }
  const vectorSpaceId = deriveVectorSpaceId(manifest);
  const providerConfigDigest = deriveProviderConfigDigest(manifest);
  const recognitionSpaceConfigDigest =
    deriveRecognitionSpaceConfigDigest(manifest);
  if (manifest.vectorSpaceId && manifest.vectorSpaceId !== vectorSpaceId) {
    throw new Error(
      "Recognition provider vectorSpaceId does not match its contract",
    );
  }
  if (
    manifest.providerConfigDigest &&
    manifest.providerConfigDigest !== providerConfigDigest
  ) {
    throw new Error(
      "Recognition provider providerConfigDigest does not match its contract",
    );
  }
  if (
    recognitionSpaceExplicit &&
    manifest.recognitionSpaceConfigDigest &&
    manifest.recognitionSpaceConfigDigest !== recognitionSpaceConfigDigest
  ) {
    throw new Error(
      "Recognition provider recognitionSpaceConfigDigest does not match its contract",
    );
  }
  return {
    ...core,
    execution,
    licensing,
    privacy,
    providerConfigDigest,
    recognitionSpace,
    recognitionSpaceConfigDigest,
    recognitionSpaceExplicit,
    schemaVersion: recognitionProviderSchemaVersion,
    vectorSpaceId,
  };
};

export const validateRecognitionObservation = (packet, manifestInput) => {
  const manifest = validateRecognitionProviderManifest(manifestInput);
  if (packet?.schemaVersion !== recognitionObservationSchemaVersion) {
    throw new Error(
      `Recognition observation schema must be ${recognitionObservationSchemaVersion}`,
    );
  }
  const observationId = requiredText(packet.observationId, "observationId");
  const assetToken = requiredText(packet.assetToken, "assetToken");
  const state = requiredText(packet.state, "state");
  if (!terminalStates.has(state)) {
    throw new Error(`Unsupported recognition observation state: ${state}`);
  }
  if (packet.vectorSpaceId !== manifest.vectorSpaceId) {
    throw new Error(
      `Recognition observation ${observationId} mixes vector spaces`,
    );
  }
  if (packet.providerConfigDigest !== manifest.providerConfigDigest) {
    throw new Error(
      `Recognition observation ${observationId} uses another provider configuration`,
    );
  }

  const normalized = {
    assetToken,
    observationId,
    providerConfigDigest: manifest.providerConfigDigest,
    route: requiredText(packet.route, "route"),
    schemaVersion: recognitionObservationSchemaVersion,
    state,
    vectorSpaceId: manifest.vectorSpaceId,
  };
  if (state !== "embedded") {
    if (packet.vector != null || packet.vectorDigest != null) {
      throw new Error(
        `Recognition observation ${observationId} cannot carry a vector in state ${state}`,
      );
    }
    return {
      ...normalized,
      reason: requiredText(packet.reason, "reason"),
    };
  }

  const cropDigest = requiredDigest(packet.cropDigest, "cropDigest");
  if (!Array.isArray(packet.vector)) {
    throw new Error(
      `Recognition observation ${observationId} requires a vector`,
    );
  }
  if (packet.vector.length !== manifest.embedding.dimension) {
    throw new Error(
      `Recognition observation ${observationId} has dimension ${packet.vector.length}; expected ${manifest.embedding.dimension}`,
    );
  }
  const vector = packet.vector.map(Number);
  if (vector.some((value) => !Number.isFinite(value))) {
    throw new Error(
      `Recognition observation ${observationId} has a non-finite vector`,
    );
  }
  const norm = Math.sqrt(
    vector.reduce((total, value) => total + value * value, 0),
  );
  if (Math.abs(norm - 1) > 0.001) {
    throw new Error(
      `Recognition observation ${observationId} vector norm ${norm.toFixed(6)} is not normalized`,
    );
  }
  const vectorDigest = recognitionVectorDigest(vector);
  if (packet.vectorDigest && packet.vectorDigest !== vectorDigest) {
    throw new Error(
      `Recognition observation ${observationId} vectorDigest does not match its vector`,
    );
  }
  return {
    ...normalized,
    cropDigest,
    vector,
    vectorDigest,
  };
};

export const mergeRecognitionCheckpoint = (
  manifestInput,
  packets,
  priorCheckpoint = null,
) => {
  const manifest = validateRecognitionProviderManifest(manifestInput);
  if (
    priorCheckpoint &&
    priorCheckpoint.schemaVersion !== recognitionCheckpointSchemaVersion
  ) {
    throw new Error("Recognition checkpoint schema is incompatible");
  }
  if (
    priorCheckpoint &&
    (priorCheckpoint.vectorSpaceId !== manifest.vectorSpaceId ||
      priorCheckpoint.providerConfigDigest !== manifest.providerConfigDigest)
  ) {
    throw new Error(
      "Recognition checkpoint belongs to another provider contract",
    );
  }
  const byObservation = new Map();
  for (const packet of priorCheckpoint?.results || []) {
    const normalized = validateRecognitionObservation(packet, manifest);
    byObservation.set(normalized.observationId, normalized);
  }
  let reused = 0;
  for (const packet of packets) {
    const normalized = validateRecognitionObservation(packet, manifest);
    const existing = byObservation.get(normalized.observationId);
    if (existing) {
      if (recognitionDigest(existing) !== recognitionDigest(normalized)) {
        throw new Error(
          `Recognition observation ${normalized.observationId} conflicts with its checkpoint`,
        );
      }
      reused += 1;
      continue;
    }
    byObservation.set(normalized.observationId, normalized);
  }
  const results = [...byObservation.values()].sort((left, right) =>
    left.observationId.localeCompare(right.observationId),
  );
  const counts = Object.fromEntries(
    [...terminalStates]
      .sort()
      .map((state) => [
        state,
        results.filter((row) => row.state === state).length,
      ]),
  );
  const checkpoint = {
    providerConfigDigest: manifest.providerConfigDigest,
    results,
    schemaVersion: recognitionCheckpointSchemaVersion,
    vectorSpaceId: manifest.vectorSpaceId,
  };
  const receipt = {
    boundary: {
      externalUpload: manifest.privacy.externalUpload,
      sourceMedia: manifest.privacy.sourceMedia,
    },
    checkpointDigest: recognitionDigest(checkpoint),
    counts: { ...counts, reused, total: results.length },
    providerConfigDigest: manifest.providerConfigDigest,
    resultDigest: recognitionDigest(results),
    schemaVersion: recognitionReceiptSchemaVersion,
    status: counts.failed > 0 ? "complete_with_failures" : "complete",
    vectorSpaceId: manifest.vectorSpaceId,
  };
  return { checkpoint, manifest, receipt };
};
