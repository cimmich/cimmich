import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

export const configSchema = "cimmich.local-ai-photo-lab-config.v1";
export const setSchema = "cimmich.local-ai-photo-set.v1";
export const runSchema = "cimmich.local-ai-photo-lab-run.v1";
export const operationNames = [
  "faces",
  "bodies",
  "context",
  "scene-text",
  "enhance",
];

const typedError = (message, code = "LOCAL_AI_INPUT_INVALID") =>
  Object.assign(new Error(message), { code });

export const canonicalize = (value) => {
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

export const canonicalJson = (value) => JSON.stringify(canonicalize(value));
export const digest = (value) =>
  createHash("sha256")
    .update(
      Buffer.isBuffer(value) || typeof value === "string"
        ? value
        : canonicalJson(value),
    )
    .digest("hex");

export const fileDigest = async (path) => digest(await readFile(path));

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
    throw typedError(`${label} must use the exact contract fields`);
  }
  return value;
};

const boundedInteger = (value, label, minimum, maximum) => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw typedError(
      `${label} must be an integer from ${minimum} to ${maximum}`,
    );
  }
  return value;
};

const boundedNumber = (value, label, minimum, maximum) => {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw typedError(`${label} must be a number from ${minimum} to ${maximum}`);
  }
  return value;
};

const requiredText = (value, label, maximum = 256) => {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > maximum || normalized.includes("\0")) {
    throw typedError(`${label} is invalid`);
  }
  return normalized;
};

const providerCore = (input, label, keys) => {
  exactObject(input, keys, label);
  return { ...input, enabled: Boolean(input.enabled) };
};

export const validateConfig = (input) => {
  exactObject(
    input,
    ["contextPolicy", "limits", "providers", "schemaVersion"],
    "config",
  );
  if (input.schemaVersion !== configSchema)
    throw typedError(`config.schemaVersion must be ${configSchema}`);
  exactObject(
    input.limits,
    [
      "maxAssets",
      "maxEnhanceInputPixels",
      "maxInputBytes",
      "maxInputPixels",
      "providerTimeoutMs",
    ],
    "config.limits",
  );
  const limits = {
    maxAssets: boundedInteger(
      input.limits.maxAssets,
      "limits.maxAssets",
      1,
      100,
    ),
    maxEnhanceInputPixels: boundedInteger(
      input.limits.maxEnhanceInputPixels,
      "limits.maxEnhanceInputPixels",
      1,
      16_000_000,
    ),
    maxInputBytes: boundedInteger(
      input.limits.maxInputBytes,
      "limits.maxInputBytes",
      1,
      1_073_741_824,
    ),
    maxInputPixels: boundedInteger(
      input.limits.maxInputPixels,
      "limits.maxInputPixels",
      1,
      100_000_000,
    ),
    providerTimeoutMs: boundedInteger(
      input.limits.providerTimeoutMs,
      "limits.providerTimeoutMs",
      1_000,
      3_600_000,
    ),
  };
  exactObject(
    input.providers,
    ["bodies", "enhance", "faces", "sceneText"],
    "config.providers",
  );
  const faces = providerCore(input.providers.faces, "providers.faces", [
    "detectorModelPath",
    "device",
    "enabled",
    "pythonPath",
    "scoreThreshold",
  ]);
  faces.pythonPath = resolve(
    requiredText(faces.pythonPath, "providers.faces.pythonPath", 4096),
  );
  faces.detectorModelPath = resolve(
    requiredText(
      faces.detectorModelPath,
      "providers.faces.detectorModelPath",
      4096,
    ),
  );
  if (!["coreml", "cpu"].includes(faces.device))
    throw typedError("providers.faces.device is unsupported");
  faces.scoreThreshold = boundedNumber(
    faces.scoreThreshold,
    "providers.faces.scoreThreshold",
    0.01,
    1,
  );

  const bodies = providerCore(input.providers.bodies, "providers.bodies", [
    "enabled",
    "manifestPath",
    "modelPath",
    "providerScriptPath",
    "pythonPath",
  ]);
  for (const key of [
    "manifestPath",
    "modelPath",
    "providerScriptPath",
    "pythonPath",
  ]) {
    bodies[key] = resolve(
      requiredText(bodies[key], `providers.bodies.${key}`, 4096),
    );
  }

  const sceneText = providerCore(
    input.providers.sceneText,
    "providers.sceneText",
    ["enabled", "endpoint", "model"],
  );
  const endpoint = new URL(
    requiredText(sceneText.endpoint, "providers.sceneText.endpoint", 2048),
  );
  if (!["127.0.0.1", "::1", "localhost"].includes(endpoint.hostname)) {
    throw typedError(
      "Scene/Text endpoint must be loopback-only",
      "LOCAL_AI_NETWORK_FORBIDDEN",
    );
  }
  sceneText.endpoint = endpoint.origin;
  sceneText.model = requiredText(sceneText.model, "providers.sceneText.model");

  const enhance = providerCore(input.providers.enhance, "providers.enhance", [
    "device",
    "enabled",
    "modelPath",
    "pythonPath",
    "scale",
  ]);
  enhance.pythonPath = resolve(
    requiredText(enhance.pythonPath, "providers.enhance.pythonPath", 4096),
  );
  enhance.modelPath = resolve(
    requiredText(enhance.modelPath, "providers.enhance.modelPath", 4096),
  );
  if (!["coreml", "cpu"].includes(enhance.device))
    throw typedError("providers.enhance.device is unsupported");
  if (![2, 4].includes(enhance.scale))
    throw typedError("providers.enhance.scale must be 2 or 4");

  exactObject(
    input.contextPolicy,
    ["minimumMargin", "minimumSimilarity", "requireBidirectionalAnchors"],
    "config.contextPolicy",
  );
  const contextPolicy = {
    minimumMargin: boundedNumber(
      input.contextPolicy.minimumMargin,
      "contextPolicy.minimumMargin",
      0,
      1,
    ),
    minimumSimilarity: boundedNumber(
      input.contextPolicy.minimumSimilarity,
      "contextPolicy.minimumSimilarity",
      0,
      1,
    ),
    requireBidirectionalAnchors:
      input.contextPolicy.requireBidirectionalAnchors === true,
  };
  return {
    contextPolicy,
    limits,
    providers: { bodies, enhance, faces, sceneText },
    schemaVersion: configSchema,
  };
};

const normalizeAssignments = (value, label) => {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw typedError(`${label} must be an object`);
  return Object.fromEntries(
    Object.entries(value).map(([subject, index]) => [
      requiredText(subject, `${label} subject`),
      boundedInteger(index, `${label}.${subject}`, 0, 63),
    ]),
  );
};

const normalizeBox = (value, label) => {
  exactObject(value, ["h", "w", "x", "y"], label);
  const box = Object.fromEntries(
    ["h", "w", "x", "y"].map((key) => [
      key,
      boundedNumber(value[key], `${label}.${key}`, 0, 1),
    ]),
  );
  if (
    box.w <= 0 ||
    box.h <= 0 ||
    box.x + box.w > 1.000001 ||
    box.y + box.h > 1.000001
  ) {
    throw typedError(`${label} must fit within the image`);
  }
  return box;
};

const normalizeBaselineRows = (value, label, prefix) => {
  if (!Array.isArray(value) || value.length > 64)
    throw typedError(`${label} must be an array with at most 64 rows`);
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw typedError(`${label}[${index}] must be an object`);
    const allowed = new Set(["box", "observationId"]);
    if (Object.keys(raw).some((key) => !allowed.has(key)) || !raw.box) {
      throw typedError(`${label}[${index}] has unsupported or missing fields`);
    }
    return {
      box: normalizeBox(raw.box, `${label}[${index}].box`),
      observationId: raw.observationId
        ? requiredText(
            raw.observationId,
            `${label}[${index}].observationId`,
            128,
          )
        : `${prefix}-${index + 1}`,
    };
  });
};

const normalizeBaseline = (value, label) => {
  if (value === undefined) return null;
  exactObject(value, ["bodies", "faces"], label);
  return {
    bodies: normalizeBaselineRows(
      value.bodies,
      `${label}.bodies`,
      "baseline-body",
    ),
    faces: normalizeBaselineRows(
      value.faces,
      `${label}.faces`,
      "baseline-face",
    ),
  };
};

export const validatePhotoSet = async (input, limits) => {
  exactObject(
    input,
    ["assets", "contextKind", "schemaVersion", "setId"],
    "photo set",
  );
  if (input.schemaVersion !== setSchema)
    throw typedError(`photo set schemaVersion must be ${setSchema}`);
  if (
    !["none", "rapid_burst", "same_moment", "sequence"].includes(
      input.contextKind,
    )
  ) {
    throw typedError("photo set contextKind is unsupported");
  }
  if (
    !Array.isArray(input.assets) ||
    input.assets.length < 1 ||
    input.assets.length > limits.maxAssets
  ) {
    throw typedError(`photo set must contain 1-${limits.maxAssets} assets`);
  }
  const seen = new Set();
  const assets = [];
  for (const [index, raw] of input.assets.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw typedError(`assets[${index}] must be an object`);
    const allowed = new Set([
      "acceptedSubjects",
      "assetId",
      "baselineObservations",
      "bodyAssignments",
      "path",
    ]);
    if (Object.keys(raw).some((key) => !allowed.has(key)))
      throw typedError(`assets[${index}] has unsupported fields`);
    const assetId = requiredText(raw.assetId, `assets[${index}].assetId`, 128);
    if (seen.has(assetId)) throw typedError(`duplicate assetId ${assetId}`);
    seen.add(assetId);
    const path = resolve(requiredText(raw.path, `assets[${index}].path`, 4096));
    const info = await stat(path).catch(() => null);
    if (!info?.isFile())
      throw typedError(`asset ${assetId} is not a readable file`);
    if (info.size < 1 || info.size > limits.maxInputBytes)
      throw typedError(`asset ${assetId} exceeds the byte limit`);
    if (!Array.isArray(raw.acceptedSubjects))
      throw typedError(`assets[${index}].acceptedSubjects must be an array`);
    const acceptedSubjects = [
      ...new Set(
        raw.acceptedSubjects.map((value) =>
          requiredText(value, "accepted subject"),
        ),
      ),
    ];
    const bodyAssignments = normalizeAssignments(
      raw.bodyAssignments,
      `assets[${index}].bodyAssignments`,
    );
    const baselineObservations = normalizeBaseline(
      raw.baselineObservations,
      `assets[${index}].baselineObservations`,
    );
    if (
      Object.keys(bodyAssignments).some(
        (subject) => !acceptedSubjects.includes(subject),
      )
    ) {
      throw typedError(
        `asset ${assetId} assigns a body to a subject that is not accepted`,
      );
    }
    const sourceContentDigest = await fileDigest(path);
    assets.push({
      acceptedSubjects,
      assetId,
      basename: basename(path),
      baselineObservations,
      bodyAssignments,
      path,
      sourceContentDigest,
      sourceSize: info.size,
    });
  }
  return {
    assets,
    contextKind: input.contextKind,
    schemaVersion: setSchema,
    setId: requiredText(input.setId, "photo set setId", 128),
  };
};

export const normalizeOperations = (value) => {
  const requested = String(value || "full")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const expanded = requested.includes("full") ? operationNames : requested;
  if (
    !expanded.length ||
    expanded.some((item) => !operationNames.includes(item))
  ) {
    throw typedError(
      `operations must be full or a comma list of ${operationNames.join(", ")}`,
    );
  }
  return operationNames.filter((item) => new Set(expanded).has(item));
};

export const publicAsset = ({
  acceptedSubjects,
  assetId,
  baselineObservations,
  basename: name,
  bodyAssignments,
  sourceContentDigest,
  sourceSize,
}) => ({
  acceptedSubjects,
  assetId,
  baselineObservations,
  basename: name,
  bodyAssignments,
  sourceContentDigest,
  sourceSize,
});
