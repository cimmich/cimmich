import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { validateFaceDetectorManifest } from "../src/face-detector-contract.mjs";
import { createInsightFaceUserSuppliedRecognizer } from "../src/insightface-user-supplied-recognizer.mjs";
import { validateRecognitionObservation } from "../src/recognition-provider-contract.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const manifestPath = `${root}/providers/opencv-sface/provider-manifest.json`;
const fakeScript = fileURLToPath(
  new URL("./fixtures/fake-sface-recognizer.mjs", import.meta.url),
);
const fakeResidentScript = fileURLToPath(
  new URL("./fixtures/fake-resident-recognizer.mjs", import.meta.url),
);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const createRecognizer = () =>
  createInsightFaceUserSuppliedRecognizer({
    detectorModelPath: "synthetic-detector-not-read",
    manifest,
    manifestPath,
    pythonPath: process.execPath,
    recognizerModelPath: "synthetic-recognizer-not-read",
    scriptPath: fakeScript,
    timeoutMs: 5_000,
  });

test("user-supplied InsightFace adapter passes only framed bytes and bounded targets", async () => {
  const [packet] = await createRecognizer().recognize({
    assetId: "asset-one",
    bytes: Buffer.from("synthetic-image"),
    observations: [
      {
        observationId: "face-one",
        targetBox: {
          coordinateSpace: "normalized",
          h: 0.4,
          w: 0.3,
          x: 0.1,
          y: 0.2,
        },
      },
    ],
  });
  const validated = validateRecognitionObservation(packet, manifest);
  assert.equal(validated.assetToken, "asset-one");
  assert.equal(validated.observationId, "face-one");
  assert.equal(validated.state, "embedded");
});

test("user-supplied InsightFace adapter rejects empty bytes, empty targets and copied manifests", async () => {
  const recognizer = createRecognizer();
  await assert.rejects(
    recognizer.recognize({
      assetId: "asset",
      bytes: Buffer.alloc(0),
      observations: [{}],
    }),
    (error) => error.code === "LOCAL_RECOGNIZER_INPUT_INVALID",
  );
  await assert.rejects(
    recognizer.recognize({
      assetId: "asset",
      bytes: Buffer.from("x"),
      observations: [],
    }),
    (error) => error.code === "LOCAL_RECOGNIZER_INPUT_INVALID",
  );
  assert.throws(
    () =>
      createInsightFaceUserSuppliedRecognizer({
        detectorModelPath: "detector",
        manifest: { ...manifest, providerConfigDigest: "f".repeat(64) },
        manifestPath,
        pythonPath: process.execPath,
        recognizerModelPath: "recognizer",
        scriptPath: fakeScript,
      }),
    /providerConfigDigest/,
  );
});

test("resident InsightFace adapter reuses one framed provider process", async () => {
  const recognizer = createInsightFaceUserSuppliedRecognizer({
    detectorModelPath: "synthetic-detector-not-read",
    manifest,
    manifestPath,
    pythonPath: process.execPath,
    recognizerModelPath: "synthetic-recognizer-not-read",
    residentProcess: true,
    scriptPath: fakeResidentScript,
    timeoutMs: 5_000,
  });
  const request = (assetId, observationId) =>
    recognizer.recognize({
      assetId,
      bytes: Buffer.from(`synthetic-image-${assetId}`),
      observations: [
        {
          observationId,
          targetBox: {
            coordinateSpace: "normalized",
            h: 0.4,
            w: 0.3,
            x: 0.1,
            y: 0.2,
          },
        },
      ],
    });
  const [[first], [second]] = await Promise.all([
    request("asset-one", "face-one"),
    request("asset-two", "face-two"),
  ]);
  assert.equal(first.processId, second.processId);
  assert.equal(first.route, "synthetic-resident-process");
  assert.equal(second.assetToken, "asset-two");
  const detection = await recognizer.detect({
    bytes: Buffer.from("synthetic-detection-image"),
  });
  assert.equal(detection.processId, first.processId);
  assert.equal(detection.state, "faces_detected");
  assert.equal(detection.faces.length, 1);
  assert.equal(
    validateFaceDetectorManifest(recognizer.detectorManifest).schemaVersion,
    "cimmich.face-detector.v1",
  );
  await recognizer.close();
});
