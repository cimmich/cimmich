import assert from "node:assert/strict";
import test from "node:test";
import {
  faceDetectionResultSchemaVersion,
  validateFaceDetectionResult,
  validateFaceDetectorManifest,
} from "../src/face-detector-contract.mjs";
import { prepareFaceDetectionJobCommit } from "../src/face-detection-job-commit.mjs";
import { faceDetectorManifestFixture as manifest } from "./fixtures/face-detector-manifest.mjs";

const job = {
  assetId: "asset-synthetic",
  configDigest: manifest.detectorConfigDigest,
  inputRevision: "a".repeat(64),
  operation: "detect_faces",
  state: "processing",
};

const result = (overrides = {}) => ({
  assetId: job.assetId,
  detectorConfigDigest: manifest.detectorConfigDigest,
  faces: [],
  inputRevision: job.inputRevision,
  schemaVersion: faceDetectionResultSchemaVersion,
  sourceContentDigest: "b".repeat(64),
  state: "no_face",
  ...overrides,
});

test("local face detector manifests forbid network and external upload", () => {
  assert.equal(
    validateFaceDetectorManifest(manifest).detectorConfigDigest,
    manifest.detectorConfigDigest,
  );
  assert.throws(
    () =>
      validateFaceDetectorManifest({
        ...manifest,
        execution: { network: "allowed" },
      }),
    /network access must be forbidden/,
  );
  assert.throws(
    () =>
      validateFaceDetectorManifest({
        ...manifest,
        privacy: { externalUpload: "optional" },
      }),
    /local and read-only/,
  );
});

test("no_face is a valid terminal result and cannot smuggle observations", () => {
  const validated = validateFaceDetectionResult(result(), manifest);
  assert.equal(validated.result.state, "no_face");
  assert.equal(validated.result.faces.length, 0);
  assert.throws(
    () =>
      validateFaceDetectionResult(
        result({
          faces: [
            { box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, confidence: 0.95 },
          ],
        }),
        manifest,
      ),
    /no_face results cannot contain/,
  );
});

test("detected observations are normalized, bounded and deterministically ordered", () => {
  const faces = [
    { box: { x: 0.5, y: 0.1, w: 0.2, h: 0.3 }, confidence: 0.91 },
    { box: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, confidence: 0.99 },
  ];
  const first = validateFaceDetectionResult(
    result({ faces, state: "faces_detected" }),
    manifest,
  );
  const second = validateFaceDetectionResult(
    result({ faces: [...faces].reverse(), state: "faces_detected" }),
    manifest,
  );
  assert.equal(first.resultDigest, second.resultDigest);
  assert.deepEqual(
    first.result.faces.map((face) => face.observationKey),
    second.result.faces.map((face) => face.observationKey),
  );
  assert.throws(
    () =>
      validateFaceDetectionResult(
        result({
          faces: [{ box: { x: 0.9, y: 0.1, w: 0.2, h: 0.3 }, confidence: 0.9 }],
          state: "faces_detected",
        }),
        manifest,
      ),
    /fit within/,
  );
});

test("detection commit preparation binds asset, revision and dedicated stage config", () => {
  const prepared = prepareFaceDetectionJobCommit({
    job,
    manifest,
    result: result(),
  });
  assert.match(prepared.detectionResultId, /^face_detection_[0-9a-f]{40}$/);
  assert.match(
    prepared.resultReceiptId,
    /^receipt_face_detection_[0-9a-f]{40}$/,
  );
  assert.throws(
    () =>
      prepareFaceDetectionJobCommit({
        job: { ...job, assetId: "other" },
        manifest,
        result: result(),
      }),
    /asset boundary/,
  );
  assert.throws(
    () =>
      prepareFaceDetectionJobCommit({
        job: { ...job, operation: "detect_and_recognize" },
        manifest,
        result: result(),
      }),
    /dedicated detect_faces/,
  );
});
