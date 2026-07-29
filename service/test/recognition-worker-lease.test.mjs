import assert from "node:assert/strict";
import test from "node:test";
import { createLocalFaceRecognitionWorker } from "../src/local-face-recognition-worker.mjs";
import { createLocalExistingFaceRecognitionWorker } from "../src/local-existing-face-recognition-worker.mjs";
import { recognitionManifestFixture as manifest } from "./fixtures/recognition-manifest.mjs";

const claimCapturingSql = (claims) =>
  async (strings, ...values) => {
    const statement = strings.join("?");
    if (statement.includes("media_operator_control")) return [];
    if (statement.includes("claim_")) {
      claims.push({ statement, values });
      return [];
    }
    throw new Error(`Unexpected worker query: ${statement.slice(0, 80)}`);
  };

test("exact recognition claim lease covers the double provider run for the configured timeout", async () => {
  const claims = [];
  const worker = createLocalFaceRecognitionWorker({
    companion: { readAssetImage: async () => ({}) },
    manifest,
    recognizer: { recognize: async () => ({}) },
    sql: claimCapturingSql(claims),
    toolVersion: "recognition-tool-v1",
  });
  assert.equal((await worker.runNext({ timeoutMs: 600_000 })).state, "idle");
  // Two provider runs of 600s each plus 60s commit headroom.
  assert.ok(claims[0].values.includes(1260));
  assert.equal((await worker.runNext()).state, "idle");
  // Default 120s timeout derives to exactly the 300s floor (2*120+60).
  assert.ok(claims[1].values.includes(300));
});

test("existing recognition claim lease is derived in both claim branches", async () => {
  const claims = [];
  const worker = createLocalExistingFaceRecognitionWorker({
    companion: {
      getAsset: async () => ({}),
      readAssetImage: async () => ({}),
    },
    manifest,
    recognizer: { recognize: async () => ({}) },
    sql: claimCapturingSql(claims),
  });
  assert.equal((await worker.runNext({ timeoutMs: 600_000 })).state, "idle");
  assert.match(claims[0].statement, /claim_existing_face_recognition_jobs/);
  assert.ok(claims[0].values.includes(1260));
  assert.equal(
    (await worker.runNext({ expectedJobId: "job-1", timeoutMs: 600_000 }))
      .state,
    "idle",
  );
  assert.match(claims[1].statement, /claim_exact_existing_face_recognition_job/);
  assert.ok(claims[1].values.includes(1260));
});
