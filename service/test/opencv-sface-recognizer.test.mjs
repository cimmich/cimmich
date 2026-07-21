import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createOpenCvSFaceRecognizer } from "../src/opencv-sface-recognizer.mjs";
import { validateRecognitionObservation } from "../src/recognition-provider-contract.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const manifestPath = `${root}/providers/opencv-sface/provider-manifest.json`;
const fakeScript = fileURLToPath(
  new URL("./fixtures/fake-sface-recognizer.mjs", import.meta.url),
);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const createRecognizer = () =>
  createOpenCvSFaceRecognizer({
    detectorModelPath: "synthetic-detector-not-read",
    manifest,
    manifestPath,
    pythonPath: process.execPath,
    recognizerModelPath: "synthetic-recognizer-not-read",
    scriptPath: fakeScript,
    timeoutMs: 5_000,
  });

test("SFace process adapter transfers one in-memory image and exact target boxes", async () => {
  const [packet] = await createRecognizer().recognize({
    assetId: "asset-one",
    bytes: Buffer.from("synthetic-image"),
    observations: [
      {
        observationId: "face-one",
        targetBox: {
          coordinateSpace: "normalized",
          x: 0.1,
          y: 0.2,
          w: 0.3,
          h: 0.4,
        },
      },
    ],
  });
  const validated = validateRecognitionObservation(packet, manifest);
  assert.equal(validated.assetToken, "asset-one");
  assert.equal(validated.observationId, "face-one");
  assert.equal(validated.state, "embedded");
});

test("SFace process adapter fails closed on empty image or observations", async () => {
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
});
