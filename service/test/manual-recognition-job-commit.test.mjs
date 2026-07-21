import assert from "node:assert/strict";
import test from "node:test";
import {
  manualRecognitionDigest,
  manualRecognitionIntakeVersion,
  manualRecognitionQualityVersion,
  validateManualRecognitionIntake,
} from "../src/manual-recognition-intake.mjs";
import {
  manualRecognitionJobCommitVersion,
  prepareManualRecognitionCommit,
} from "../src/manual-recognition-job-commit.mjs";
import {
  recognitionObservationSchemaVersion,
  recognitionVectorDigest,
} from "../src/recognition-provider-contract.mjs";
import { recognitionManifestFixture } from "./fixtures/recognition-manifest.mjs";

const digest = (character) => character.repeat(64);
const policy = {
  allowLowQuality: false,
  lowQualityThreshold: 0.5,
  policyVersion: "manual-quality-v1",
  usableThreshold: 0.7,
};
const vector = [0.6, 0.8];
const observation = {
  assetToken: "asset_service_fixture",
  cropDigest: digest("c"),
  observationId: `face_manual_${"2".repeat(32)}`,
  providerConfigDigest: recognitionManifestFixture.providerConfigDigest,
  route: "manual-target-alignment",
  schemaVersion: recognitionObservationSchemaVersion,
  state: "embedded",
  vector,
  vectorDigest: recognitionVectorDigest(vector),
  vectorSpaceId: recognitionManifestFixture.vectorSpaceId,
};

const envelope = () =>
  validateManualRecognitionIntake({
    manifest: recognitionManifestFixture,
    operation: {
      assetId: "asset_service_fixture",
      faceId: observation.observationId,
      identityClaimId: `claim_manual_${"3".repeat(32)}`,
      operationId: `manualtagop_${"1".repeat(32)}`,
      region: { h: 0.3, w: 0.25, x: 0.1, y: 0.2 },
    },
    projection: {
      assetId: "asset_service_fixture",
      immichAssetId: "immich_asset_fixture",
      inputRevision: digest("4"),
      sourceContentDigest: digest("5"),
      sourceId: "immich-local",
    },
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
    schemaVersion: manualRecognitionIntakeVersion,
  });

test("commit plan is deterministic, minimized and has zero elevated authority", () => {
  const first = prepareManualRecognitionCommit(envelope());
  const second = prepareManualRecognitionCommit(envelope());
  assert.deepEqual(first.ids, second.ids);
  assert.equal(first.receipt.authority.activation, "none");
  assert.equal(first.receipt.authority.automaticIdentity, "none");
  assert.equal(first.receipt.authority.prime, "none");
  assert.equal(first.receipt.authority.training, "none");
  assert.match(first.ids.evidenceId, /^manualevidence_[0-9a-f]{40}$/);
  assert.equal(
    manualRecognitionJobCommitVersion,
    "cimmich.manual-recognition-job-commit.v1",
  );
});

test("commit planning itself requires exact validated envelope membership", () => {
  const valid = envelope();
  assert.throws(
    () => prepareManualRecognitionCommit({ ...valid }),
    (error) => error.code === "MANUAL_RECOGNITION_ENVELOPE_INVALID",
  );
});
