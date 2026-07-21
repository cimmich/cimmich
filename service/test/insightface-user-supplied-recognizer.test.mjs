import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createInsightFaceUserSuppliedRecognizer } from "../src/insightface-user-supplied-recognizer.mjs";
import { validateRecognitionObservation } from "../src/recognition-provider-contract.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const manifestPath = `${root}/providers/opencv-sface/provider-manifest.json`;
const fakeScript = fileURLToPath(
  new URL("./fixtures/fake-sface-recognizer.mjs", import.meta.url),
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
