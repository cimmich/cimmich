import assert from "node:assert/strict";
import test from "node:test";
import {
  createMediaPipelineManifest,
  mediaPipelineRunIdentity,
  validateMediaPipelineManifest,
} from "../src/media-pipeline-contract.mjs";
import { faceDetectorManifestFixture as detectorManifest } from "./fixtures/face-detector-manifest.mjs";
import { recognitionManifestFixture as recognitionManifest } from "./fixtures/recognition-manifest.mjs";

const manifest = createMediaPipelineManifest({
  detectorManifest,
  recognitionManifest,
  recognitionToolVersion: "synthetic-recognizer-v1",
});

test("media pipeline preserves independent detector and recognizer configurations", () => {
  const validated = validateMediaPipelineManifest(manifest, {
    detectorManifest,
    recognitionManifest,
  });
  assert.equal(
    validated.detector.configDigest,
    detectorManifest.detectorConfigDigest,
  );
  assert.equal(
    validated.recognizer.configDigest,
    recognitionManifest.providerConfigDigest,
  );
  assert.notEqual(
    validated.detector.configDigest,
    validated.recognizer.configDigest,
  );
  assert.throws(
    () =>
      validateMediaPipelineManifest(
        { ...manifest, detector: { configDigest: "0".repeat(64) } },
        { detectorManifest, recognitionManifest },
      ),
    /detector stage uses another configuration/,
  );
});

test("media pipeline run identity binds asset revision and full stage manifest", () => {
  const first = mediaPipelineRunIdentity({
    assetId: "asset-one",
    inputRevision: "a".repeat(64),
    pipelineConfigDigest: manifest.pipelineConfigDigest,
  });
  assert.deepEqual(
    first,
    mediaPipelineRunIdentity({
      assetId: "asset-one",
      inputRevision: "a".repeat(64),
      pipelineConfigDigest: manifest.pipelineConfigDigest,
    }),
  );
  assert.notEqual(
    first.workKey,
    mediaPipelineRunIdentity({
      assetId: "asset-one",
      inputRevision: "b".repeat(64),
      pipelineConfigDigest: manifest.pipelineConfigDigest,
    }).workKey,
  );
});
