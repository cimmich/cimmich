import assert from "node:assert/strict";
import test from "node:test";
import {
  mediaJobDigest,
  validateMediaJobCheckpoint,
  validateMediaJobClaim,
  validateMediaJobRequest,
} from "../src/media-job-ledger.mjs";

const digest = (character) => character.repeat(64);

test("media job identity inputs are strict and provider-specific", () => {
  assert.deepEqual(
    validateMediaJobRequest({
      assetId: "asset-one",
      configDigest: digest("a"),
      inputRevision: digest("b"),
      operation: "recognize_faces",
      toolVersion: "fixture-provider-v1",
    }),
    {
      assetId: "asset-one",
      configDigest: digest("a"),
      inputRevision: digest("b"),
      maxAttempts: 3,
      operation: "recognize_faces",
      toolVersion: "fixture-provider-v1",
    },
  );
  assert.throws(
    () =>
      validateMediaJobRequest({
        assetId: "asset-one",
        configDigest: digest("A"),
        inputRevision: digest("b"),
        operation: "recognize_faces",
        toolVersion: "fixture-provider-v1",
      }),
    /lowercase SHA-256/,
  );
  assert.throws(
    () =>
      validateMediaJobRequest({
        assetId: "asset-one",
        configDigest: digest("a"),
        inputRevision: digest("b"),
        operation: "caption_everything",
        toolVersion: "fixture-provider-v1",
      }),
    /Unsupported media job operation/,
  );
});

test("checkpoint digest is canonical and rejects non-durable queued state", () => {
  const left = validateMediaJobCheckpoint({
    payload: { count: 2, nested: { b: 2, a: 1 } },
    stage: "recognition_recorded",
  });
  const right = validateMediaJobCheckpoint({
    payload: { nested: { a: 1, b: 2 }, count: 2 },
    stage: "recognition_recorded",
  });
  assert.equal(left.checkpointDigest, right.checkpointDigest);
  assert.equal(
    left.checkpointDigest,
    mediaJobDigest({ payload: left.payload, stage: left.stage }),
  );
  assert.throws(
    () => validateMediaJobCheckpoint({ stage: "queued" }),
    /Unsupported durable/,
  );
});

test("worker leases and retries remain bounded", () => {
  assert.deepEqual(validateMediaJobClaim({ workerId: "worker-one" }), {
    batchSize: 1,
    leaseSeconds: 300,
    workerId: "worker-one",
  });
  assert.throws(
    () => validateMediaJobClaim({ leaseSeconds: 5, workerId: "worker-one" }),
    /leaseSeconds/,
  );
  assert.throws(
    () => validateMediaJobClaim({ batchSize: 101, workerId: "worker-one" }),
    /batchSize/,
  );
});
