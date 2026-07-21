import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  bodyDetectionResultSchemaVersion,
  bodyDetectorSchemaVersion,
  deriveBodyDetectorConfigDigest,
} from "../src/body-detector-contract.mjs";

const digest = (character) => character.repeat(64);

const manifestCore = {
  detector: {
    artifactDigest: digest("a"),
    modelId: "detector",
    modelVersionId: "v1",
    scoreThreshold: 0.3,
  },
  execution: {
    device: "cpu",
    network: "forbidden",
    runtimeId: "runtime",
    threads: 1,
  },
  licensing: { code: "declared", model: "unknown", trainingData: "unknown" },
  preprocessing: {
    colorSpace: "rgb",
    coordinateSpace: "normalized_image",
    inputHeight: 640,
    inputWidth: 640,
    resizeMode: "letterbox",
  },
  privacy: { externalUpload: "none", sourceMedia: "local-read-only" },
  provider: { providerId: "provider", versionId: "v1" },
  resources: { maxMemoryMiB: 1024, maxRuntimeMs: 60000 },
  schemaVersion: bodyDetectorSchemaVersion,
};
const manifest = {
  ...manifestCore,
  detectorConfigDigest: deriveBodyDetectorConfigDigest(manifestCore),
};

const packet = {
  faces: [{ boxH: 0.1, boxW: 0.1, boxX: 0.45, boxY: 0.1, faceId: "face_one" }],
  manifest,
  result: {
    assetToken: digest("b"),
    bodies: [
      {
        box: { h: 0.8, w: 0.4, x: 0.3, y: 0.05 },
        confidence: 0.9,
      },
    ],
    detectorConfigDigest: manifest.detectorConfigDigest,
    inputRevision: digest("c"),
    schemaVersion: bodyDetectionResultSchemaVersion,
    sourceContentDigest: digest("d"),
    state: "bodies_detected",
  },
};

const invoke = (value) =>
  spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("../bin/evaluate-local-body-link-slice.mjs", import.meta.url),
      ),
    ],
    { encoding: "utf8", input: JSON.stringify(value) },
  );

test("validated local Body boxes flow through the unchanged linker", () => {
  const result = invoke(packet);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.deepEqual(receipt.counts, {
    acceptedLinks: 1,
    abstainedLinks: 0,
    bodies: 1,
    candidateEdges: 1,
    faces: 1,
    unmatchedBodies: 0,
    unmatchedFaces: 0,
  });
  assert.equal(receipt.authority.automaticIdentityAuthority, "none");
});

test("raw or malformed detector payloads fail without echo", () => {
  const result = invoke({ ...packet, extra: "private path" });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.deepEqual(JSON.parse(result.stderr), {
    error: { code: "LOCAL_BODY_LINK_INPUT_INVALID" },
  });
  assert.doesNotMatch(result.stderr, /private path/);
});
