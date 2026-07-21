import { createHash } from "node:crypto";
import { projectValidatedBodyResultForRepository } from "./body-detector-contract.mjs";

export const bodyMaskProviderSchemaVersion = "cimmich.body-mask-provider.v1";
export const bodyMaskResultSchemaVersion = "cimmich.body-mask-result.v1";
export const bodyMaskEvaluationSchemaVersion =
  "cimmich.body-mask-evaluation.v1";
export const bodyMaskReceiptSchemaVersion = "cimmich.body-mask-receipt.v1";
export const bodyMaskProjectionSchemaVersion =
  "cimmich.body-mask-projection.v1";

const digestPattern = /^[0-9a-f]{64}$/;
const publicIdPattern = /^[a-z0-9](?:[a-z0-9._-]{0,95})$/;
const validatedManifests = new WeakSet();
const validatedEnvelopes = new WeakSet();
const privateBindings = new WeakMap();
const allowedReasons = Object.freeze([
  "empty_mask",
  "mask_bleeds_outside_prompt_area",
  "mask_too_small_for_prompt_box",
  "mask_too_broad_for_prompt_box",
  "mask_partly_outside_prompt_area",
  "broad_mask_needs_visual_qc",
  "low_score_needs_visual_qc",
  "geometry_valid_semantics_unverified",
]);

const typedError = (message) =>
  Object.assign(new Error(message), {
    code: "BODY_MASK_PROVIDER_INPUT_INVALID",
    statusCode: 400,
  });

const canonicalValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  return value;
};

export const bodyMaskDigest = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex");

const fixed6 = (value) => value.toFixed(6);

export const bodyMaskPayloadDigest = (value) =>
  bodyMaskDigest({
    box: Object.fromEntries(
      ["h", "w", "x", "y"].map((key) => [key, fixed6(value.box[key])]),
    ),
    height: value.height,
    originX: value.originX,
    originY: value.originY,
    runs: value.runs,
    width: value.width,
  });

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

const exactObject = (value, keys, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw typedError(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  )
    throw typedError(`${label} fields are invalid`);
  return value;
};

const requiredDigest = (value, label) => {
  if (typeof value !== "string" || !digestPattern.test(value))
    throw typedError(`${label} must be a lowercase SHA-256 digest`);
  return value;
};

const publicId = (value, label) => {
  if (typeof value !== "string" || !publicIdPattern.test(value))
    throw typedError(`${label} must be a bounded lowercase identifier`);
  return value;
};

const enumValue = (value, allowed, label) => {
  if (!allowed.includes(value)) throw typedError(`${label} is invalid`);
  return value;
};

const boundedInteger = (value, minimum, maximum, label) => {
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw typedError(`${label} is invalid`);
  return value;
};

const canonicalNumber = (value, minimum, maximum, label) => {
  if (
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum ||
    Number(value.toFixed(6)) !== value
  )
    throw typedError(`${label} is not canonical`);
  return value;
};

const canonicalUnit = (value, label) => canonicalNumber(value, 0, 1, label);

const normalizedBox = (value, label) => {
  exactObject(value, ["h", "w", "x", "y"], label);
  const box = {
    h: canonicalNumber(value.h, 0.000001, 1, `${label}.h`),
    w: canonicalNumber(value.w, 0.000001, 1, `${label}.w`),
    x: canonicalUnit(value.x, `${label}.x`),
    y: canonicalUnit(value.y, `${label}.y`),
  };
  if (box.x + box.w > 1.000001 || box.y + box.h > 1.000001)
    throw typedError(`${label} leaves the normalized image`);
  return deepFreeze(box);
};

const roundRatio6 = (numerator, denominator) =>
  Math.floor((numerator * 1_000_000) / denominator + 0.5) / 1_000_000;
const roundPixel = (value) => Math.floor(value + 0.5);

const pixelBox = (box, width, height) => {
  const x1 = Math.max(0, Math.min(width - 1, roundPixel(box.x * width)));
  const y1 = Math.max(0, Math.min(height - 1, roundPixel(box.y * height)));
  const x2 = Math.max(
    x1 + 1,
    Math.min(width, roundPixel((box.x + box.w) * width)),
  );
  const y2 = Math.max(
    y1 + 1,
    Math.min(height, roundPixel((box.y + box.h) * height)),
  );
  return [x1, y1, x2, y2];
};

const expandPixelBox = (box, width, height, fraction) => {
  const [x1, y1, x2, y2] = box;
  const boxWidth = x2 - x1;
  const boxHeight = y2 - y1;
  return [
    Math.max(0, roundPixel(x1 - boxWidth * fraction)),
    Math.max(0, roundPixel(y1 - boxHeight * fraction)),
    Math.min(width, roundPixel(x2 + boxWidth * fraction)),
    Math.min(height, roundPixel(y2 + boxHeight * fraction)),
  ];
};

const foregroundAreaInside = (mask, pixelBounds) => {
  const [x1, y1, x2, y2] = pixelBounds;
  let offset = 0;
  let total = 0;
  for (let runIndex = 0; runIndex < mask.runs.length; runIndex += 1) {
    const runEnd = offset + mask.runs[runIndex];
    if (runIndex % 2 === 1) {
      let cursor = offset;
      while (cursor < runEnd) {
        const row = Math.floor(cursor / mask.width);
        const rowEnd = Math.min(runEnd, (row + 1) * mask.width);
        const globalY = mask.originY + row;
        if (globalY >= y1 && globalY < y2) {
          const localStart = cursor - row * mask.width;
          const localEnd = rowEnd - row * mask.width;
          total += Math.max(
            0,
            Math.min(mask.originX + localEnd, x2) -
              Math.max(mask.originX + localStart, x1),
          );
        }
        cursor = rowEnd;
      }
    }
    offset = runEnd;
  }
  return total;
};

const foregroundTouchesCropBounds = (mask) => {
  const touched = { bottom: false, left: false, right: false, top: false };
  let offset = 0;
  for (let runIndex = 0; runIndex < mask.runs.length; runIndex += 1) {
    const runEnd = offset + mask.runs[runIndex];
    if (runIndex % 2 === 1) {
      let cursor = offset;
      while (cursor < runEnd) {
        const row = Math.floor(cursor / mask.width);
        const rowEnd = Math.min(runEnd, (row + 1) * mask.width);
        const localStart = cursor - row * mask.width;
        const localEnd = rowEnd - row * mask.width;
        if (row === 0) touched.top = true;
        if (row === mask.height - 1) touched.bottom = true;
        if (localStart === 0) touched.left = true;
        if (localEnd === mask.width) touched.right = true;
        cursor = rowEnd;
      }
    }
    offset = runEnd;
  }
  return Object.values(touched).every(Boolean);
};

const normalizeThresholds = (value) => {
  exactObject(
    value,
    [
      "validMaxAreaRatio",
      "validMinInside",
      "validMinScore",
      "expandedFraction",
      "rejectMaxAreaRatio",
      "rejectMinAreaRatio",
      "rejectMinInside",
    ],
    "manifest.mask.thresholds",
  );
  const thresholds = {
    validMaxAreaRatio: canonicalNumber(
      value.validMaxAreaRatio,
      0.05,
      4,
      "validMaxAreaRatio",
    ),
    validMinInside: canonicalUnit(value.validMinInside, "validMinInside"),
    validMinScore: canonicalUnit(value.validMinScore, "validMinScore"),
    expandedFraction: canonicalNumber(
      value.expandedFraction,
      0,
      0.5,
      "expandedFraction",
    ),
    rejectMaxAreaRatio: canonicalNumber(
      value.rejectMaxAreaRatio,
      0.05,
      4,
      "rejectMaxAreaRatio",
    ),
    rejectMinAreaRatio: canonicalNumber(
      value.rejectMinAreaRatio,
      0,
      1,
      "rejectMinAreaRatio",
    ),
    rejectMinInside: canonicalUnit(value.rejectMinInside, "rejectMinInside"),
  };
  if (
    thresholds.rejectMinAreaRatio >= thresholds.validMaxAreaRatio ||
    thresholds.validMaxAreaRatio >= thresholds.rejectMaxAreaRatio ||
    thresholds.rejectMinInside >= thresholds.validMinInside
  )
    throw typedError("mask thresholds are inconsistent");
  return deepFreeze(thresholds);
};

export const deriveBodyMaskManifest = (value) => {
  exactObject(
    value,
    [
      "execution",
      "licensing",
      "mask",
      "preprocessing",
      "privacy",
      "provider",
      "resources",
      "schemaVersion",
    ],
    "manifest",
  );
  if (value.schemaVersion !== bodyMaskProviderSchemaVersion)
    throw typedError("manifest schemaVersion is invalid");
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
    value.mask,
    [
      "artifactDigest",
      "configId",
      "maxSide",
      "modelId",
      "modelVersionId",
      "multiMaskCount",
      "selectionPolicyId",
      "thresholds",
    ],
    "manifest.mask",
  );
  exactObject(
    value.preprocessing,
    ["colorSpace", "coordinateSpace", "orientation", "promptKind"],
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
    ["maxInputBytes", "maxMemoryMiB", "maxOutputBytes", "maxRuntimeMs"],
    "manifest.resources",
  );
  const core = {
    execution: {
      device: enumValue(
        value.execution.device,
        ["auto", "cpu", "gpu"],
        "device",
      ),
      network: enumValue(value.execution.network, ["forbidden"], "network"),
      runtimeId: publicId(value.execution.runtimeId, "runtimeId"),
      threads: boundedInteger(value.execution.threads, 1, 64, "threads"),
    },
    licensing: {
      code: enumValue(value.licensing.code, ["declared"], "code licence"),
      model: enumValue(
        value.licensing.model,
        ["declared", "unknown"],
        "model rights",
      ),
      trainingData: enumValue(
        value.licensing.trainingData,
        ["declared", "unknown"],
        "training-data rights",
      ),
    },
    mask: {
      artifactDigest: requiredDigest(
        value.mask.artifactDigest,
        "artifactDigest",
      ),
      configId: publicId(value.mask.configId, "configId"),
      maxSide: boundedInteger(value.mask.maxSide, 256, 2048, "maxSide"),
      modelId: publicId(value.mask.modelId, "modelId"),
      modelVersionId: publicId(value.mask.modelVersionId, "modelVersionId"),
      multiMaskCount: boundedInteger(
        value.mask.multiMaskCount,
        1,
        8,
        "multiMaskCount",
      ),
      selectionPolicyId: enumValue(
        value.mask.selectionPolicyId,
        ["sam2-bounded-box-v1"],
        "selectionPolicyId",
      ),
      thresholds: normalizeThresholds(value.mask.thresholds),
    },
    preprocessing: {
      colorSpace: enumValue(
        value.preprocessing.colorSpace,
        ["rgb"],
        "colorSpace",
      ),
      coordinateSpace: enumValue(
        value.preprocessing.coordinateSpace,
        ["normalized_image"],
        "coordinateSpace",
      ),
      orientation: enumValue(
        value.preprocessing.orientation,
        ["exif_transposed_top_left"],
        "orientation",
      ),
      promptKind: enumValue(
        value.preprocessing.promptKind,
        ["body_box"],
        "promptKind",
      ),
    },
    privacy: {
      externalUpload: enumValue(
        value.privacy.externalUpload,
        ["none"],
        "externalUpload",
      ),
      sourceMedia: enumValue(
        value.privacy.sourceMedia,
        ["local-read-only"],
        "sourceMedia",
      ),
    },
    provider: {
      providerId: publicId(value.provider.providerId, "providerId"),
      versionId: publicId(value.provider.versionId, "versionId"),
    },
    resources: {
      maxInputBytes: boundedInteger(
        value.resources.maxInputBytes,
        1024,
        512 * 1024 * 1024,
        "maxInputBytes",
      ),
      maxMemoryMiB: boundedInteger(
        value.resources.maxMemoryMiB,
        64,
        65536,
        "maxMemoryMiB",
      ),
      maxOutputBytes: boundedInteger(
        value.resources.maxOutputBytes,
        1024,
        64 * 1024 * 1024,
        "maxOutputBytes",
      ),
      maxRuntimeMs: boundedInteger(
        value.resources.maxRuntimeMs,
        1000,
        900000,
        "maxRuntimeMs",
      ),
    },
    schemaVersion: bodyMaskProviderSchemaVersion,
  };
  return deepFreeze({ ...core, maskConfigDigest: bodyMaskDigest(core) });
};

export const validateBodyMaskManifest = (value) => {
  exactObject(
    value,
    [
      "execution",
      "licensing",
      "mask",
      "maskConfigDigest",
      "preprocessing",
      "privacy",
      "provider",
      "resources",
      "schemaVersion",
    ],
    "manifest",
  );
  const { maskConfigDigest, ...input } = value;
  const manifest = deriveBodyMaskManifest(input);
  if (
    requiredDigest(maskConfigDigest, "maskConfigDigest") !==
    manifest.maskConfigDigest
  )
    throw typedError("manifest maskConfigDigest is invalid");
  validatedManifests.add(manifest);
  return manifest;
};

const classify = (
  { maskArea, maskAreaRatioToPrompt, insideExpandedRatio },
  score,
  thresholds,
) => {
  if (maskArea === 0) return ["abstained", "empty_mask"];
  if (insideExpandedRatio < thresholds.rejectMinInside)
    return ["abstained", "mask_bleeds_outside_prompt_area"];
  if (maskAreaRatioToPrompt < thresholds.rejectMinAreaRatio)
    return ["abstained", "mask_too_small_for_prompt_box"];
  if (maskAreaRatioToPrompt > thresholds.rejectMaxAreaRatio)
    return ["abstained", "mask_too_broad_for_prompt_box"];
  if (insideExpandedRatio < thresholds.validMinInside)
    return ["review", "mask_partly_outside_prompt_area"];
  if (maskAreaRatioToPrompt > thresholds.validMaxAreaRatio)
    return ["review", "broad_mask_needs_visual_qc"];
  if (score < thresholds.validMinScore)
    return ["review", "low_score_needs_visual_qc"];
  return ["geometry_valid", "geometry_valid_semantics_unverified"];
};

const normalizeMask = (value, label, canvas) => {
  if (value === null) return null;
  exactObject(
    value,
    ["box", "digest", "height", "originX", "originY", "runs", "width"],
    label,
  );
  const width = boundedInteger(value.width, 1, 2048, `${label}.width`);
  const height = boundedInteger(value.height, 1, 2048, `${label}.height`);
  const originX = boundedInteger(
    value.originX,
    0,
    canvas.width - 1,
    `${label}.originX`,
  );
  const originY = boundedInteger(
    value.originY,
    0,
    canvas.height - 1,
    `${label}.originY`,
  );
  if (originX + width > canvas.width || originY + height > canvas.height)
    throw typedError(`${label} leaves its raster canvas`);
  if (
    !Array.isArray(value.runs) ||
    value.runs.length < 1 ||
    value.runs.length > 250000
  )
    throw typedError(`${label}.runs is invalid`);
  const runs = value.runs.map((run, index) =>
    boundedInteger(
      run,
      index === 0 ? 0 : 1,
      width * height,
      `${label}.runs[${index}]`,
    ),
  );
  if (runs.reduce((sum, run) => sum + run, 0) !== width * height)
    throw typedError(`${label}.runs does not cover its mask crop`);
  const core = {
    box: normalizedBox(value.box, `${label}.box`),
    height,
    originX,
    originY,
    runs,
    width,
  };
  const expectedBox = {
    h: roundRatio6(height, canvas.height),
    w: roundRatio6(width, canvas.width),
    x: roundRatio6(originX, canvas.width),
    y: roundRatio6(originY, canvas.height),
  };
  if (
    Object.keys(expectedBox).some((key) => core.box[key] !== expectedBox[key])
  )
    throw typedError(`${label}.box is not derived from its raster crop`);
  if (
    requiredDigest(value.digest, `${label}.digest`) !==
    bodyMaskPayloadDigest(core)
  )
    throw typedError(`${label}.digest is invalid`);
  if (!foregroundTouchesCropBounds(core))
    throw typedError(`${label}.runs is not a minimal foreground crop`);
  return deepFreeze({ ...core, digest: value.digest });
};

const normalizeObservation = (value, index, thresholds, canvas, body) => {
  const label = `result.observations[${index}]`;
  exactObject(
    value,
    ["bodyId", "mask", "metrics", "reason", "score", "state"],
    label,
  );
  exactObject(
    value.metrics,
    ["insideExpandedRatio", "maskArea", "maskAreaRatioToPrompt"],
    `${label}.metrics`,
  );
  const metrics = {
    insideExpandedRatio: canonicalUnit(
      value.metrics.insideExpandedRatio,
      `${label}.insideExpandedRatio`,
    ),
    maskArea: boundedInteger(
      value.metrics.maskArea,
      0,
      4_194_304,
      `${label}.maskArea`,
    ),
    maskAreaRatioToPrompt: canonicalNumber(
      value.metrics.maskAreaRatioToPrompt,
      0,
      4_194_304,
      `${label}.maskAreaRatioToPrompt`,
    ),
  };
  const score = canonicalUnit(value.score, `${label}.score`);
  const state = enumValue(
    value.state,
    ["geometry_valid", "review", "abstained"],
    `${label}.state`,
  );
  const reason = enumValue(value.reason, allowedReasons, `${label}.reason`);
  const mask = normalizeMask(value.mask, `${label}.mask`, canvas);
  if ((metrics.maskArea === 0) !== (mask === null))
    throw typedError(`${label} empty-mask state is inconsistent`);
  const derivedMetrics = mask
    ? (() => {
        const prompt = pixelBox(body.box, canvas.width, canvas.height);
        const expanded = expandPixelBox(
          prompt,
          canvas.width,
          canvas.height,
          thresholds.expandedFraction,
        );
        const maskArea = mask.runs.reduce(
          (sum, run, runIndex) => sum + (runIndex % 2 === 1 ? run : 0),
          0,
        );
        const promptArea = (prompt[2] - prompt[0]) * (prompt[3] - prompt[1]);
        return {
          insideExpandedRatio: roundRatio6(
            foregroundAreaInside(mask, expanded),
            Math.max(1, maskArea),
          ),
          maskArea,
          maskAreaRatioToPrompt: roundRatio6(maskArea, Math.max(1, promptArea)),
        };
      })()
    : { insideExpandedRatio: 0, maskArea: 0, maskAreaRatioToPrompt: 0 };
  if (
    Object.keys(derivedMetrics).some(
      (key) => derivedMetrics[key] !== metrics[key],
    )
  )
    throw typedError(`${label}.metrics are not derived from its mask evidence`);
  const [expectedState, expectedReason] = classify(
    derivedMetrics,
    score,
    thresholds,
  );
  if (state !== expectedState || reason !== expectedReason)
    throw typedError(`${label} disposition is not policy-derived`);
  return deepFreeze({
    bodyId: publicId(value.bodyId, `${label}.bodyId`),
    mask,
    metrics,
    reason,
    score,
    state,
  });
};

const normalizeResult = (value, manifest, bodyResult) => {
  exactObject(
    value,
    [
      "assetToken",
      "bodyResultDigest",
      "canvas",
      "inputRevision",
      "maskConfigDigest",
      "observations",
      "schemaVersion",
      "sourceContentDigest",
      "state",
    ],
    "result",
  );
  if (value.schemaVersion !== bodyMaskResultSchemaVersion)
    throw typedError("result schemaVersion is invalid");
  exactObject(value.canvas, ["height", "width"], "result.canvas");
  const canvas = deepFreeze({
    height: boundedInteger(
      value.canvas.height,
      1,
      manifest.mask.maxSide,
      "result.canvas.height",
    ),
    width: boundedInteger(
      value.canvas.width,
      1,
      manifest.mask.maxSide,
      "result.canvas.width",
    ),
  });
  if (
    value.assetToken !== bodyResult.assetToken ||
    value.bodyResultDigest !== bodyResult.resultDigest ||
    value.inputRevision !== bodyResult.inputRevision ||
    value.sourceContentDigest !== bodyResult.sourceContentDigest ||
    value.maskConfigDigest !== manifest.maskConfigDigest
  )
    throw typedError("result crosses its Body/source/provider binding");
  if (
    !Array.isArray(value.observations) ||
    value.observations.length !== bodyResult.bodies.length
  )
    throw typedError("result must disposition every Body observation");
  const bodiesById = new Map(
    bodyResult.bodies.map((body) => [body.bodyId, body]),
  );
  const observations = value.observations.map((observation, index) => {
    const body = bodiesById.get(observation?.bodyId);
    if (!body) throw typedError("result Body membership is invalid");
    return normalizeObservation(
      observation,
      index,
      manifest.mask.thresholds,
      canvas,
      body,
    );
  });
  const expectedIds = bodyResult.bodies.map((body) => body.bodyId).sort();
  const actualIds = observations
    .map((observation) => observation.bodyId)
    .sort();
  if (
    new Set(actualIds).size !== actualIds.length ||
    actualIds.some((id, index) => id !== expectedIds[index])
  )
    throw typedError("result Body membership is invalid");
  const expectedState = observations.some((item) => item.state !== "abstained")
    ? "masks_produced"
    : "all_abstained";
  if (value.state !== expectedState)
    throw typedError("result state is inconsistent");
  const result = deepFreeze({
    assetToken: value.assetToken,
    bodyResultDigest: value.bodyResultDigest,
    canvas,
    inputRevision: value.inputRevision,
    maskConfigDigest: value.maskConfigDigest,
    observations: [...observations].sort((left, right) =>
      left.bodyId.localeCompare(right.bodyId),
    ),
    schemaVersion: bodyMaskResultSchemaVersion,
    sourceContentDigest: value.sourceContentDigest,
    state: value.state,
  });
  const totalRuns = result.observations.reduce(
    (sum, item) => sum + (item.mask?.runs.length || 0),
    0,
  );
  if (totalRuns > 1_000_000)
    throw typedError("result mask evidence exceeds its absolute cap");
  return result;
};

export const validateBodyMaskEvidence = ({
  bodyValidation,
  manifest: inputManifest,
  runs,
  schemaVersion,
}) => {
  if (schemaVersion !== bodyMaskEvaluationSchemaVersion)
    throw typedError("evaluation schemaVersion is invalid");
  const manifest = validatedManifests.has(inputManifest)
    ? inputManifest
    : validateBodyMaskManifest(inputManifest);
  const bodyResult = projectValidatedBodyResultForRepository(bodyValidation);
  if (!Array.isArray(runs) || runs.length !== 2)
    throw typedError("evaluation requires exactly two Body-mask runs");
  const runIds = new Set();
  const normalized = runs.map((run, index) => {
    exactObject(run, ["result", "runId"], `runs[${index}]`);
    const runId = publicId(run.runId, `runs[${index}].runId`);
    if (runIds.has(runId))
      throw typedError("Body-mask runs require distinct run identifiers");
    runIds.add(runId);
    const result = normalizeResult(run.result, manifest, bodyResult);
    return deepFreeze({ result, resultDigest: bodyMaskDigest(result), runId });
  });
  const replayEvidence =
    normalized[0].resultDigest === normalized[1].resultDigest
      ? "consistent"
      : "drift";
  const result = normalized[0].result;
  const counts = Object.fromEntries(
    ["geometry_valid", "review", "abstained"].map((state) => [
      state,
      result.observations.filter((item) => item.state === state).length,
    ]),
  );
  const core = {
    authority: {
      activation: "none",
      automaticIdentityAuthority: "none",
      countAuthority: "none",
      persistence: "none",
      recommendation: "none",
      training: "none",
    },
    bodyResultDigest: bodyResult.resultDigest,
    counts,
    maskConfigDigest: manifest.maskConfigDigest,
    replayEvidence,
    resultDigest:
      replayEvidence === "consistent" ? normalized[0].resultDigest : null,
    schemaVersion: bodyMaskEvaluationSchemaVersion,
    status: replayEvidence === "consistent" ? "validated" : "replay_drift",
  };
  const envelope = deepFreeze({
    ...core,
    evaluationDigest: bodyMaskDigest(core),
  });
  privateBindings.set(
    envelope,
    deepFreeze({ bodyValidation, manifest, result }),
  );
  validatedEnvelopes.add(envelope);
  return envelope;
};

const requireEnvelope = (value) => {
  if (!validatedEnvelopes.has(value) || !privateBindings.has(value))
    throw typedError("An exact validated Body-mask envelope is required");
  return privateBindings.get(value);
};

export const createBodyMaskReceipt = (validation) => {
  const binding = requireEnvelope(validation);
  if (binding.manifest.maskConfigDigest !== validation.maskConfigDigest)
    throw typedError("Body-mask validation manifest drifted");
  const core = {
    artifactDigest: binding.manifest.mask.artifactDigest,
    authority: validation.authority,
    bodyResultDigest: validation.bodyResultDigest,
    counts: validation.counts,
    evaluationDigest: validation.evaluationDigest,
    maskConfigDigest: validation.maskConfigDigest,
    replayEvidence: validation.replayEvidence,
    resultDigest: validation.resultDigest,
    schemaVersion: bodyMaskReceiptSchemaVersion,
    status: validation.status,
  };
  return deepFreeze({ ...core, receiptDigest: bodyMaskDigest(core) });
};

export const projectValidatedBodyMasks = (validation) => {
  const binding = requireEnvelope(validation);
  if (validation.replayEvidence !== "consistent")
    throw typedError("Body-mask projection requires exact provider replay");
  return deepFreeze({
    authority: {
      automaticIdentityAuthority: "none",
      countAuthority: "none",
      persistence: "none",
    },
    items: binding.result.observations,
    maskConfigDigest: validation.maskConfigDigest,
    resultDigest: validation.resultDigest,
    schemaVersion: bodyMaskProjectionSchemaVersion,
  });
};
