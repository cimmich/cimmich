import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createOpenCvYuNetDetector } from "../src/opencv-yunet-detector.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const manifestPath = `${root}/providers/opencv-sface/detector-manifest.json`;
const fakeScript = fileURLToPath(
  new URL("./fixtures/fake-yunet-detector.mjs", import.meta.url),
);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const createDetector = () =>
  createOpenCvYuNetDetector({
    detectorModelPath: "synthetic-model-not-read-by-fixture",
    manifest,
    manifestPath,
    pythonPath: process.execPath,
    scriptPath: fakeScript,
    timeoutMs: 5_000,
  });

test("YuNet process adapter transfers image bytes by stdin and returns bounded observations", async () => {
  const detector = createDetector();
  const detected = await detector.detect({
    bytes: Buffer.from("synthetic-face"),
  });
  assert.equal(detected.state, "faces_detected");
  assert.equal(detected.faces.length, 1);
  const absent = await detector.detect({
    bytes: Buffer.from("synthetic-empty"),
  });
  assert.deepEqual(absent, { faces: [], state: "no_face" });
});

test("YuNet process adapter fails closed on empty input and manifest drift", async () => {
  const detector = createDetector();
  await assert.rejects(
    detector.detect({ bytes: Buffer.alloc(0) }),
    (error) => error.code === "LOCAL_DETECTOR_INPUT_INVALID",
  );
  assert.throws(
    () =>
      createOpenCvYuNetDetector({
        detectorModelPath: "synthetic",
        manifest: { ...manifest, detectorConfigDigest: "0".repeat(64) },
        manifestPath,
        pythonPath: process.execPath,
        scriptPath: fakeScript,
      }),
    /config digest does not match/,
  );
});
