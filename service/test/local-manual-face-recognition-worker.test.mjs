import assert from "node:assert/strict";
import test from "node:test";
import {
  assembleManualRecognitionIntake,
  prepareManualRecognitionJob,
} from "../src/local-manual-face-recognition-worker.mjs";
import {
  manualRecognitionDigest,
  manualRecognitionQualityVersion,
  projectValidatedManualRecognitionCommit,
} from "../src/manual-recognition-intake.mjs";
import {
  recognitionObservationSchemaVersion,
  recognitionVectorDigest,
} from "../src/recognition-provider-contract.mjs";
import { recognitionManifestFixture } from "./fixtures/recognition-manifest.mjs";

const digest = (character) => character.repeat(64);
const operation = {
  assetId: "asset_service_fixture",
  faceId: `face_manual_${"2".repeat(32)}`,
  identityClaimId: `claim_manual_${"3".repeat(32)}`,
  operationId: `manualtagop_${"1".repeat(32)}`,
  region: { h: 0.3, w: 0.25, x: 0.1, y: 0.2 },
};
const projection = {
  assetId: operation.assetId,
  immichAssetId: "immich_asset_fixture",
  inputRevision: digest("4"),
  sourceId: "immich-local",
};

test("worker seam prepares exact manual job without executing media or provider", () => {
  const prepared = prepareManualRecognitionJob({
    manifest: recognitionManifestFixture,
    operation,
    projection,
  });
  assert.equal(prepared.job.operation, "recognize_manual_face");
  assert.equal(prepared.authority.mediaRead, "not_executed");
  assert.equal(prepared.authority.providerExecution, "not_executed");
  assert.equal(
    prepared.job.configDigest,
    recognitionManifestFixture.providerConfigDigest,
  );
});

test("worker seam assembles only two-run quality-bound execution evidence", () => {
  const prepared = prepareManualRecognitionJob({
    manifest: recognitionManifestFixture,
    operation,
    projection,
  });
  const vector = [0.6, 0.8];
  const observation = {
    assetToken: operation.assetId,
    cropDigest: digest("c"),
    observationId: operation.faceId,
    providerConfigDigest: recognitionManifestFixture.providerConfigDigest,
    route: "manual-target-alignment",
    schemaVersion: recognitionObservationSchemaVersion,
    state: "embedded",
    vector,
    vectorDigest: recognitionVectorDigest(vector),
    vectorSpaceId: recognitionManifestFixture.vectorSpaceId,
  };
  const policy = {
    allowLowQuality: false,
    lowQualityThreshold: 0.5,
    policyVersion: "manual-quality-v1",
    usableThreshold: 0.7,
  };
  const envelope = assembleManualRecognitionIntake({
    prepared,
    quality: {
      ...policy,
      measurementDigest: digest("6"),
      policyDigest: manualRecognitionDigest(policy),
      schemaVersion: manualRecognitionQualityVersion,
      score: 0.8,
    },
    runs: [
      { observation, runId: "manualrun_fixture_0001" },
      { observation, runId: "manualrun_fixture_0002" },
    ],
    sourceContentDigest: digest("5"),
  });
  assert.equal(
    projectValidatedManualRecognitionCommit(envelope).requestDigest,
    prepared.requestDigest,
  );
});

test("worker seam rejects stale revision or region drift from prepared request", () => {
  const prepared = prepareManualRecognitionJob({
    manifest: recognitionManifestFixture,
    operation,
    projection,
  });
  assert.throws(() =>
    assembleManualRecognitionIntake({
      prepared: {
        ...prepared,
        projection: { ...prepared.projection, inputRevision: digest("f") },
      },
      quality: {},
      runs: [],
      sourceContentDigest: digest("5"),
    }),
  );
});
