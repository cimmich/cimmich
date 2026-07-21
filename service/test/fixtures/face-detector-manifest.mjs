import {
  faceDetectionDigest,
  faceDetectorSchemaVersion,
} from "../../src/face-detector-contract.mjs";

const core = {
  detector: {
    model: "synthetic-yunet",
    modelVersion: "2026-07-test",
    scoreThreshold: 0.9,
  },
  execution: { network: "forbidden", threads: 1 },
  preprocessing: { colorSpace: "bgr", orientation: "exif-normalized" },
  privacy: { externalUpload: "none", sourceMedia: "local-read-only" },
  provider: { name: "synthetic-local-detector", version: "v1" },
};

export const faceDetectorManifestFixture = {
  ...core,
  detectorConfigDigest: faceDetectionDigest(core),
  schemaVersion: faceDetectorSchemaVersion,
};
