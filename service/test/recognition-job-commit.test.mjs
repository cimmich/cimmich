import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeRecognitionCheckpoint,
  recognitionObservationSchemaVersion,
  recognitionVectorDigest,
} from "../src/recognition-provider-contract.mjs";
import {
  prepareRecognitionJobCommit,
  validateExistingRecognitionProviderRuns,
} from "../src/recognition-job-commit.mjs";
import { recognitionManifestFixture as manifest } from "./fixtures/recognition-manifest.mjs";

const checkpoint = mergeRecognitionCheckpoint(manifest, [
  {
    assetToken: "asset-one",
    cropDigest: "c".repeat(64),
    observationId: "face-one",
    providerConfigDigest: manifest.providerConfigDigest,
    route: "tight-target",
    schemaVersion: recognitionObservationSchemaVersion,
    state: "embedded",
    vector: [0.6, 0.8],
    vectorDigest: recognitionVectorDigest([0.6, 0.8]),
    vectorSpaceId: manifest.vectorSpaceId,
  },
]).checkpoint;

const job = {
  assetId: "asset-one",
  configDigest: manifest.providerConfigDigest,
  jobId: "media-job-one",
  operation: "recognize_faces",
  state: "processing",
};

test("recognition job commit binds a checkpoint to one job asset and provider", () => {
  const prepared = prepareRecognitionJobCommit({ checkpoint, job, manifest });
  assert.equal(prepared.embedded.length, 1);
  assert.equal(prepared.receipt.counts.embedded, 1);
  assert.match(prepared.resultReceiptId, /^receipt_media_job_[0-9a-f]{40}$/);
  assert.equal(prepared.manifest.providerConfigDigest, job.configDigest);
});

test("recognition job commit rejects crossed assets and provider configurations", () => {
  assert.throws(
    () =>
      prepareRecognitionJobCommit({
        checkpoint,
        job: { ...job, assetId: "asset-two" },
        manifest,
      }),
    /asset boundary/,
  );
  assert.throws(
    () =>
      prepareRecognitionJobCommit({
        checkpoint,
        job: { ...job, configDigest: "f".repeat(64) },
        manifest,
      }),
    /another provider configuration/,
  );
});

test("existing observation commit binds both provider runs to the prepared checkpoint and result", () => {
  const prepared = prepareRecognitionJobCommit({
    checkpoint,
    job: { ...job, operation: "recognize_existing_faces" },
    manifest,
  });
  const providerRuns = [1, 2].map((ordinal) => ({
    checkpointDigest: prepared.receipt.checkpointDigest,
    ordinal,
    resultDigest: prepared.resultDigest,
    runId: `provider_run_${String(ordinal).repeat(40)}`,
  }));
  assert.equal(
    validateExistingRecognitionProviderRuns({ prepared, providerRuns }),
    providerRuns,
  );
  assert.throws(
    () =>
      validateExistingRecognitionProviderRuns({
        prepared,
        providerRuns: [
          providerRuns[0],
          { ...providerRuns[1], checkpointDigest: "f".repeat(64) },
        ],
      }),
    /two distinct consistent provider runs/,
  );
  assert.throws(
    () =>
      validateExistingRecognitionProviderRuns({
        prepared,
        providerRuns: [
          providerRuns[0],
          { ...providerRuns[1], resultDigest: "e".repeat(64) },
        ],
      }),
    /two distinct consistent provider runs/,
  );
});
