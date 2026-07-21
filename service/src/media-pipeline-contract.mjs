import { createHash } from "node:crypto";
import { validateFaceDetectorManifest } from "./face-detector-contract.mjs";
import { validateRecognitionProviderManifest } from "./recognition-provider-contract.mjs";

export const mediaPipelineSchemaVersion = "cimmich.media-pipeline.v1";

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

export const mediaPipelineDigest = (value) =>
  createHash("sha256")
    .update(
      typeof value === "string" ? value : JSON.stringify(canonicalize(value)),
    )
    .digest("hex");

const requiredText = (value, label, maximum = 200) => {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error(`Media pipeline requires ${label}`);
  }
  return normalized;
};

export const createMediaPipelineManifest = ({
  detectorManifest,
  name = "local-face-intelligence",
  recognitionManifest,
  recognitionToolVersion,
  version = "1",
} = {}) => {
  const detector = validateFaceDetectorManifest(detectorManifest);
  const recognizer = validateRecognitionProviderManifest(recognitionManifest);
  const core = {
    detector: { configDigest: detector.detectorConfigDigest },
    pipeline: {
      name: requiredText(name, "pipeline.name"),
      version: requiredText(version, "pipeline.version"),
    },
    recognizer: {
      configDigest: recognizer.providerConfigDigest,
      toolVersion: requiredText(
        recognitionToolVersion,
        "recognizer.toolVersion",
      ),
      vectorSpaceId: recognizer.vectorSpaceId,
    },
    schemaVersion: mediaPipelineSchemaVersion,
  };
  return { ...core, pipelineConfigDigest: mediaPipelineDigest(core) };
};

export const validateMediaPipelineManifest = (
  manifest,
  { detectorManifest, recognitionManifest } = {},
) => {
  if (manifest?.schemaVersion !== mediaPipelineSchemaVersion) {
    throw new Error(
      `Media pipeline schema must be ${mediaPipelineSchemaVersion}`,
    );
  }
  const normalized = createMediaPipelineManifest({
    detectorManifest,
    name: manifest?.pipeline?.name,
    recognitionManifest,
    recognitionToolVersion: manifest?.recognizer?.toolVersion,
    version: manifest?.pipeline?.version,
  });
  if (manifest?.detector?.configDigest !== normalized.detector.configDigest) {
    throw new Error("Media pipeline detector stage uses another configuration");
  }
  if (
    manifest?.recognizer?.configDigest !== normalized.recognizer.configDigest ||
    manifest?.recognizer?.vectorSpaceId !== normalized.recognizer.vectorSpaceId
  ) {
    throw new Error(
      "Media pipeline recognition stage uses another configuration",
    );
  }
  if (manifest?.pipelineConfigDigest !== normalized.pipelineConfigDigest) {
    throw new Error("Media pipeline config digest does not match its stages");
  }
  return normalized;
};

export const mediaPipelineRunIdentity = ({
  assetId,
  inputRevision,
  pipelineConfigDigest,
}) => {
  const workKey = mediaPipelineDigest({
    assetId,
    inputRevision,
    pipelineConfigDigest,
  });
  return { pipelineRunId: `media_pipeline_${workKey.slice(0, 40)}`, workKey };
};
