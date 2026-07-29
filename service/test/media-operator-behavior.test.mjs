import assert from "node:assert/strict";
import test from "node:test";
import { shouldContinueDetectionPipeline } from "../src/media-operator.mjs";

test("zero-recognition envelopes do not manufacture recognition queue work", () => {
  assert.equal(
    shouldContinueDetectionPipeline({
      continuationAvailable: true,
      maxRecognitionJobs: 0,
      resultStatus: "completed",
    }),
    false,
  );
  assert.equal(
    shouldContinueDetectionPipeline({
      continuationAvailable: true,
      maxRecognitionJobs: 1,
      resultStatus: "completed",
    }),
    true,
  );
  assert.equal(
    shouldContinueDetectionPipeline({
      continuationAvailable: true,
      maxRecognitionJobs: 1,
      resultStatus: "failed",
    }),
    false,
  );
});
