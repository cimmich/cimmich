import { createHash } from "node:crypto";
import { projectValidatedBodyResultForRepository } from "./body-detector-contract.mjs";

export const bodyObjectConflictProviderSchemaVersion =
  "cimmich.body-object-conflict-provider.v1";
export const bodyObjectConflictResultSchemaVersion =
  "cimmich.body-object-conflict-result.v1";
export const bodyObjectConflictEvaluationSchemaVersion =
  "cimmich.body-object-conflict-evaluation.v1";
export const bodyObjectConflictReceiptSchemaVersion =
  "cimmich.body-object-conflict-receipt.v1";

const digestPattern = /^[0-9a-f]{64}$/;
const publicIdPattern = /^[a-z0-9](?:[a-z0-9._-]{0,63})$/;
const objectClasses = Object.freeze(["cat", "dog"]);
const validatedEnvelopes = new WeakSet();
const envelopeProjections = new WeakMap();

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

export const bodyObjectConflictDigest = (value) =>
  createHash("sha256")
    .update(
      typeof value === "string" ? value : JSON.stringify(canonicalize(value)),
    )
    .digest("hex");

const typedError = (message) =>
  Object.assign(new Error(message), {
    code: "BODY_OBJECT_CONFLICT_INPUT_INVALID",
    statusCode: 400,
  });

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

const exactObject = (value, keys, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw typedError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw typedError(`${label} fields are invalid`);
  }
};

const publicId = (value, label) => {
  if (typeof value !== "string" || !publicIdPattern.test(value)) {
    throw typedError(`${label} must be a bounded lowercase identifier`);
  }
  return value;
};

const digest = (value, label) => {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    throw typedError(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
};

const enumValue = (value, allowed, label) => {
  if (!allowed.includes(value)) throw typedError(`${label} is unsupported`);
  return value;
};

const boundedInteger = (value, minimum, maximum, label) => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw typedError(`${label} is outside its allowed range`);
  }
  return value;
};

const canonicalUnit = (value, label, { positive = false } = {}) => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1 ||
    (positive && value <= 0) ||
    Number(value.toFixed(6)) !== value
  ) {
    throw typedError(`${label} must be a canonical six-decimal unit value`);
  }
  return value;
};

const normalizeBox = (value, label) => {
  exactObject(value, ["h", "w", "x", "y"], label);
  const box = {
    h: canonicalUnit(value.h, `${label}.h`, { positive: true }),
    w: canonicalUnit(value.w, `${label}.w`, { positive: true }),
    x: canonicalUnit(value.x, `${label}.x`),
    y: canonicalUnit(value.y, `${label}.y`),
  };
  if (box.x + box.w > 1.000001 || box.y + box.h > 1.000001) {
    throw typedError(`${label} must fit normalized image space`);
  }
  return box;
};

const normalizeManifestCore = (value) => {
  exactObject(
    value,
    [
      "detector",
      "execution",
      "licensing",
      "preprocessing",
      "privacy",
      "provider",
      "resources",
      "schemaVersion",
    ],
    "manifest",
  );
  if (value.schemaVersion !== bodyObjectConflictProviderSchemaVersion) {
    throw typedError("manifest schemaVersion is invalid");
  }
  exactObject(
    value.detector,
    [
      "artifactDigest",
      "classes",
      "modelId",
      "modelVersionId",
      "scoreThreshold",
    ],
    "manifest.detector",
  );
  if (
    !Array.isArray(value.detector.classes) ||
    value.detector.classes.length !== objectClasses.length ||
    value.detector.classes.some((item, index) => item !== objectClasses[index])
  ) {
    throw typedError("manifest detector classes must be exactly cat,dog");
  }
  exactObject(
    value.execution,
    ["device", "network", "runtimeId", "threads"],
    "manifest.execution",
  );
  exactObject(
    value.licensing,
    ["code", "model", "trainingData"],
    "manifest.licensing",
  );
  exactObject(
    value.preprocessing,
    [
      "colorSpace",
      "coordinateSpace",
      "inputHeight",
      "inputWidth",
      "resizeMode",
    ],
    "manifest.preprocessing",
  );
  exactObject(
    value.privacy,
    ["externalUpload", "sourceMedia"],
    "manifest.privacy",
  );
  exactObject(value.provider, ["providerId", "versionId"], "manifest.provider");
  exactObject(
    value.resources,
    ["maxMemoryMiB", "maxRuntimeMs"],
    "manifest.resources",
  );
  return {
    detector: {
      artifactDigest: digest(
        value.detector.artifactDigest,
        "manifest.detector.artifactDigest",
      ),
      classes: [...objectClasses],
      modelId: publicId(value.detector.modelId, "manifest.detector.modelId"),
      modelVersionId: publicId(
        value.detector.modelVersionId,
        "manifest.detector.modelVersionId",
      ),
      scoreThreshold: canonicalUnit(
        value.detector.scoreThreshold,
        "manifest.detector.scoreThreshold",
        { positive: true },
      ),
    },
    execution: {
      device: enumValue(
        value.execution.device,
        ["auto", "cpu", "gpu", "npu"],
        "manifest.execution.device",
      ),
      network: enumValue(
        value.execution.network,
        ["forbidden"],
        "manifest.execution.network",
      ),
      runtimeId: publicId(
        value.execution.runtimeId,
        "manifest.execution.runtimeId",
      ),
      threads: boundedInteger(
        value.execution.threads,
        1,
        256,
        "manifest.execution.threads",
      ),
    },
    licensing: {
      code: enumValue(
        value.licensing.code,
        ["declared", "unknown"],
        "manifest.licensing.code",
      ),
      model: enumValue(
        value.licensing.model,
        ["declared", "unknown"],
        "manifest.licensing.model",
      ),
      trainingData: enumValue(
        value.licensing.trainingData,
        ["declared", "unknown"],
        "manifest.licensing.trainingData",
      ),
    },
    preprocessing: {
      colorSpace: enumValue(
        value.preprocessing.colorSpace,
        ["bgr", "rgb"],
        "manifest.preprocessing.colorSpace",
      ),
      coordinateSpace: enumValue(
        value.preprocessing.coordinateSpace,
        ["normalized_image"],
        "manifest.preprocessing.coordinateSpace",
      ),
      inputHeight: boundedInteger(
        value.preprocessing.inputHeight,
        1,
        16_384,
        "manifest.preprocessing.inputHeight",
      ),
      inputWidth: boundedInteger(
        value.preprocessing.inputWidth,
        1,
        16_384,
        "manifest.preprocessing.inputWidth",
      ),
      resizeMode: enumValue(
        value.preprocessing.resizeMode,
        ["letterbox", "stretch"],
        "manifest.preprocessing.resizeMode",
      ),
    },
    privacy: {
      externalUpload: enumValue(
        value.privacy.externalUpload,
        ["none"],
        "manifest.privacy.externalUpload",
      ),
      sourceMedia: enumValue(
        value.privacy.sourceMedia,
        ["local-read-only"],
        "manifest.privacy.sourceMedia",
      ),
    },
    provider: {
      providerId: publicId(
        value.provider.providerId,
        "manifest.provider.providerId",
      ),
      versionId: publicId(
        value.provider.versionId,
        "manifest.provider.versionId",
      ),
    },
    resources: {
      maxMemoryMiB: boundedInteger(
        value.resources.maxMemoryMiB,
        64,
        262_144,
        "manifest.resources.maxMemoryMiB",
      ),
      maxRuntimeMs: boundedInteger(
        value.resources.maxRuntimeMs,
        100,
        600_000,
        "manifest.resources.maxRuntimeMs",
      ),
    },
    schemaVersion: bodyObjectConflictProviderSchemaVersion,
  };
};

export const deriveBodyObjectConflictManifest = (value) => {
  const core = normalizeManifestCore(value);
  return deepFreeze({
    ...core,
    objectConfigDigest: bodyObjectConflictDigest(core),
  });
};

export const validateBodyObjectConflictManifest = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw typedError("manifest must be an object");
  }
  const { objectConfigDigest, ...coreInput } = value;
  if (Object.keys(value).length !== Object.keys(coreInput).length + 1) {
    throw typedError("manifest fields are invalid");
  }
  const manifest = deriveBodyObjectConflictManifest(coreInput);
  if (
    digest(objectConfigDigest, "manifest.objectConfigDigest") !==
    manifest.objectConfigDigest
  ) {
    throw typedError("manifest config digest does not match its contents");
  }
  return manifest;
};

const normalizeObject = (value, index, manifest) => {
  const label = `result.objects[${index}]`;
  exactObject(value, ["box", "category", "confidence"], label);
  const core = {
    box: normalizeBox(value.box, `${label}.box`),
    category: enumValue(value.category, objectClasses, `${label}.category`),
    confidence: canonicalUnit(value.confidence, `${label}.confidence`, {
      positive: true,
    }),
  };
  if (core.confidence < manifest.detector.scoreThreshold) {
    throw typedError(`${label}.confidence is below the manifest threshold`);
  }
  return deepFreeze({ ...core, objectKey: bodyObjectConflictDigest(core) });
};

const normalizeResult = (value, manifest) => {
  exactObject(
    value,
    [
      "assetToken",
      "inputRevision",
      "objectConfigDigest",
      "objects",
      "schemaVersion",
      "sourceContentDigest",
      "state",
    ],
    "result",
  );
  if (value.schemaVersion !== bodyObjectConflictResultSchemaVersion) {
    throw typedError("result schemaVersion is invalid");
  }
  if (!Array.isArray(value.objects) || value.objects.length > 32) {
    throw typedError("result objects exceed the absolute cap");
  }
  const objects = value.objects
    .map((object, index) => normalizeObject(object, index, manifest))
    .sort((left, right) => left.objectKey.localeCompare(right.objectKey));
  if (new Set(objects.map((item) => item.objectKey)).size !== objects.length) {
    throw typedError("result contains duplicate objects");
  }
  const state = enumValue(
    value.state,
    ["no_object", "objects_detected"],
    "result.state",
  );
  if (
    (state === "no_object" && objects.length !== 0) ||
    (state === "objects_detected" && objects.length === 0)
  ) {
    throw typedError("result state and object count disagree");
  }
  const core = {
    assetToken: digest(value.assetToken, "result.assetToken"),
    inputRevision: digest(value.inputRevision, "result.inputRevision"),
    objectConfigDigest: digest(
      value.objectConfigDigest,
      "result.objectConfigDigest",
    ),
    objects,
    schemaVersion: bodyObjectConflictResultSchemaVersion,
    sourceContentDigest: digest(
      value.sourceContentDigest,
      "result.sourceContentDigest",
    ),
    state,
  };
  if (core.objectConfigDigest !== manifest.objectConfigDigest) {
    throw typedError("result uses another object detector configuration");
  }
  return deepFreeze({ ...core, resultDigest: bodyObjectConflictDigest(core) });
};

export const validateBodyObjectConflictEvidence = (value) => {
  exactObject(
    value,
    ["bodyValidation", "manifest", "runs", "schemaVersion"],
    "evaluation",
  );
  if (value.schemaVersion !== bodyObjectConflictEvaluationSchemaVersion) {
    throw typedError("evaluation schemaVersion is invalid");
  }
  const bodyResult = projectValidatedBodyResultForRepository(
    value.bodyValidation,
  );
  const manifest = validateBodyObjectConflictManifest(value.manifest);
  if (!Array.isArray(value.runs) || value.runs.length !== 2) {
    throw typedError("evaluation requires exactly two object runs");
  }
  const runs = value.runs.map((run, index) => {
    exactObject(run, ["result", "runId"], `runs[${index}]`);
    return deepFreeze({
      result: normalizeResult(run.result, manifest),
      runId: publicId(run.runId, `runs[${index}].runId`),
    });
  });
  if (runs[0].runId === runs[1].runId) {
    throw typedError("object runs require distinct run identifiers");
  }
  for (const run of runs) {
    if (
      run.result.assetToken !== bodyResult.assetToken ||
      run.result.inputRevision !== bodyResult.inputRevision ||
      run.result.sourceContentDigest !== bodyResult.sourceContentDigest
    ) {
      throw typedError("object run drifted from the validated Body input");
    }
  }
  const replayEvidence =
    runs[0].result.resultDigest === runs[1].result.resultDigest
      ? "consistent"
      : "drift";
  const orderedRuns = runs.toSorted((left, right) =>
    left.runId.localeCompare(right.runId),
  );
  const envelope = deepFreeze({
    binding: {
      bodyResultDigest: bodyResult.resultDigest,
      objectConfigDigest: manifest.objectConfigDigest,
      resultDigests: orderedRuns.map((run) => run.result.resultDigest),
    },
    counts: {
      bodyCount: bodyResult.bodies.length,
      objectCount:
        replayEvidence === "consistent" ? runs[0].result.objects.length : 0,
    },
    replayEvidence,
    runs: orderedRuns.map((run) => ({
      resultDigest: run.result.resultDigest,
      runId: run.runId,
    })),
  });
  validatedEnvelopes.add(envelope);
  envelopeProjections.set(
    envelope,
    deepFreeze({
      bodyResultDigest: bodyResult.resultDigest,
      objects:
        replayEvidence === "consistent"
          ? runs[0].result.objects.map(({ box, category, confidence }) => ({
              box,
              category,
              confidence,
            }))
          : [],
      replayEvidence,
    }),
  );
  return envelope;
};

const requireEnvelope = (value) => {
  if (!value || typeof value !== "object" || !validatedEnvelopes.has(value)) {
    throw typedError("An exact validated Body-object envelope is required");
  }
  return value;
};

export const createBodyObjectConflictReceipt = (value) => {
  const envelope = requireEnvelope(value);
  const core = {
    authority: {
      activation: "none",
      automaticIdentityAuthority: "none",
      recommendation: "none",
      training: "none",
    },
    binding: envelope.binding,
    boundary: {
      databaseWrites: "none",
      externalUpload: "none",
      identityWrites: "none",
      immichWrites: "none",
      providerExecutionProof: "none",
      sourceMedia: "local-read-only",
    },
    counts: envelope.counts,
    replayEvidence: envelope.replayEvidence,
    schemaVersion: bodyObjectConflictReceiptSchemaVersion,
  };
  return deepFreeze({ ...core, receiptDigest: bodyObjectConflictDigest(core) });
};

export const projectValidatedBodyObjectConflicts = (value) => {
  const envelope = requireEnvelope(value);
  return envelopeProjections.get(envelope);
};
