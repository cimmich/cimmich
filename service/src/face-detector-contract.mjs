import { createHash } from "node:crypto";

export const faceDetectorSchemaVersion = "cimmich.face-detector.v1";
export const faceDetectionResultSchemaVersion =
  "cimmich.face-detection-result.v1";

const digestPattern = /^[0-9a-f]{64}$/;

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

export const faceDetectionDigest = (value) =>
  createHash("sha256")
    .update(
      typeof value === "string" ? value : JSON.stringify(canonicalize(value)),
    )
    .digest("hex");

const requiredText = (value, label, maximum = 200) => {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error(`Face detector requires ${label}`);
  }
  return normalized;
};

const requiredDigest = (value, label) => {
  const digest = requiredText(value, label, 64);
  if (!digestPattern.test(digest)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
  return digest;
};

const finiteNumber = (value, label) => {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
};

const validateBox = (value, label) => {
  if (!value || typeof value !== "object") {
    throw new Error(`${label} must use normalized coordinates`);
  }
  const box = Object.fromEntries(
    ["x", "y", "w", "h"].map((key) => [
      key,
      finiteNumber(value[key], `${label}.${key}`),
    ]),
  );
  if (
    box.x < 0 ||
    box.y < 0 ||
    box.w <= 0 ||
    box.h <= 0 ||
    box.x + box.w > 1.000001 ||
    box.y + box.h > 1.000001
  ) {
    throw new Error(`${label} must fit within the source image`);
  }
  return box;
};

export const validateFaceDetectorManifest = (value = {}) => {
  if (value.schemaVersion !== faceDetectorSchemaVersion) {
    throw new Error(
      `Face detector schema must be ${faceDetectorSchemaVersion}`,
    );
  }
  if (value.execution?.network !== "forbidden") {
    throw new Error("Face detector network access must be forbidden");
  }
  if (
    value.privacy?.externalUpload !== "none" ||
    value.privacy?.sourceMedia !== "local-read-only"
  ) {
    throw new Error(
      "Face detector source media must remain local and read-only",
    );
  }
  const core = {
    detector: canonicalize(value.detector || {}),
    execution: canonicalize(value.execution || {}),
    preprocessing: canonicalize(value.preprocessing || {}),
    privacy: canonicalize(value.privacy || {}),
    provider: {
      name: requiredText(value.provider?.name, "provider.name"),
      version: requiredText(value.provider?.version, "provider.version"),
    },
  };
  const detectorConfigDigest = faceDetectionDigest(core);
  if (value.detectorConfigDigest !== detectorConfigDigest) {
    throw new Error("Face detector config digest does not match its contents");
  }
  return {
    ...core,
    detectorConfigDigest,
    schemaVersion: faceDetectorSchemaVersion,
  };
};

export const validateFaceDetectionResult = (value = {}, manifestInput) => {
  const manifest = validateFaceDetectorManifest(manifestInput);
  if (value.schemaVersion !== faceDetectionResultSchemaVersion) {
    throw new Error(
      `Face detection result schema must be ${faceDetectionResultSchemaVersion}`,
    );
  }
  const state = requiredText(value.state, "result state");
  if (!new Set(["faces_detected", "no_face"]).has(state)) {
    throw new Error(`Unsupported face detection result state: ${state}`);
  }
  const facesInput = Array.isArray(value.faces) ? value.faces : [];
  if (facesInput.length > 1000) {
    throw new Error("Face detection result exceeds 1000 observations");
  }
  const faces = facesInput
    .map((face, index) => {
      const box = validateBox(face?.box, `faces[${index}].box`);
      const confidence = finiteNumber(
        face?.confidence,
        `faces[${index}].confidence`,
      );
      if (confidence < 0 || confidence > 1) {
        throw new Error(`faces[${index}].confidence must be from 0 to 1`);
      }
      const landmarkDigest =
        face?.landmarkDigest == null
          ? null
          : requiredDigest(
              face.landmarkDigest,
              `faces[${index}].landmarkDigest`,
            );
      const quality = canonicalize(face?.quality || {});
      const observationKey = faceDetectionDigest({
        box,
        confidence,
        landmarkDigest,
        quality,
      });
      return { box, confidence, landmarkDigest, observationKey, quality };
    })
    .sort((left, right) =>
      left.observationKey.localeCompare(right.observationKey),
    );
  if (new Set(faces.map((face) => face.observationKey)).size !== faces.length) {
    throw new Error("Face detection result contains duplicate observations");
  }
  if (state === "no_face" && faces.length !== 0) {
    throw new Error("no_face results cannot contain observations");
  }
  if (state === "faces_detected" && faces.length === 0) {
    throw new Error("faces_detected results require observations");
  }
  const result = {
    assetId: requiredText(value.assetId, "assetId"),
    detectorConfigDigest: requiredDigest(
      value.detectorConfigDigest,
      "detectorConfigDigest",
    ),
    faces,
    inputRevision: requiredDigest(value.inputRevision, "inputRevision"),
    schemaVersion: faceDetectionResultSchemaVersion,
    sourceContentDigest: requiredDigest(
      value.sourceContentDigest,
      "sourceContentDigest",
    ),
    state,
  };
  if (result.detectorConfigDigest !== manifest.detectorConfigDigest) {
    throw new Error(
      "Face detection result uses another detector configuration",
    );
  }
  return {
    manifest,
    result,
    resultDigest: faceDetectionDigest(result),
  };
};

export const faceObservationId = ({
  assetId,
  detectorConfigDigest,
  inputRevision,
  observationKey,
}) =>
  `face_${faceDetectionDigest({ assetId, detectorConfigDigest, inputRevision, observationKey }).slice(0, 40)}`;
