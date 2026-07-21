import assert from "node:assert/strict";
import test from "node:test";
import {
  createManualRecognitionIntakeReceipt,
  manualRecognitionDigest,
  manualRecognitionIntakeVersion,
  manualRecognitionQualityVersion,
  projectValidatedManualRecognitionCommit,
  validateManualRecognitionIntake,
} from "../src/manual-recognition-intake.mjs";
import {
  recognitionObservationSchemaVersion,
  recognitionVectorDigest,
} from "../src/recognition-provider-contract.mjs";
import { recognitionManifestFixture } from "./fixtures/recognition-manifest.mjs";

const digest = (character) => character.repeat(64);
const region = { h: 0.3, w: 0.25, x: 0.1, y: 0.2 };
const policy = {
  allowLowQuality: true,
  lowQualityThreshold: 0.45,
  policyVersion: "manual-quality-v1",
  usableThreshold: 0.7,
};
const observation = (overrides = {}) => {
  const vector = [0.6, 0.8];
  return {
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
    ...overrides,
  };
};
const fixture = (overrides = {}) => ({
  manifest: structuredClone(recognitionManifestFixture),
  operation: {
    assetId: "asset_service_fixture",
    faceId: `face_manual_${"2".repeat(32)}`,
    identityClaimId: `claim_manual_${"3".repeat(32)}`,
    operationId: `manualtagop_${"1".repeat(32)}`,
    region,
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
    score: 0.82,
  },
  runs: [
    { observation: observation(), runId: "manualrun_fixture_0001" },
    { observation: observation(), runId: "manualrun_fixture_0002" },
  ],
  schemaVersion: manualRecognitionIntakeVersion,
  ...overrides,
});

test("validated intake derives provider space, replay, quality tier and minimized receipt", () => {
  const envelope = validateManualRecognitionIntake(fixture());
  const projected = projectValidatedManualRecognitionCommit(envelope);
  const receipt = createManualRecognitionIntakeReceipt(envelope);
  assert.equal(projected.evidenceTier, "secondary");
  assert.equal(
    projected.manifest.vectorSpaceId,
    recognitionManifestFixture.vectorSpaceId,
  );
  assert.deepEqual(projected.runIds, [
    "manualrun_fixture_0001",
    "manualrun_fixture_0002",
  ]);
  assert.equal(receipt.replayEvidence, "consistent");
  assert.equal(receipt.authority.prime, "none");
  const serialized = JSON.stringify(receipt);
  assert.doesNotMatch(
    serialized,
    /sourceContentDigest|inputRevision|vector\"|region|assetId/,
  );
});

test("exact envelope membership rejects copied and substituted wrappers", () => {
  const envelope = validateManualRecognitionIntake(fixture());
  for (const forged of [
    { ...envelope },
    Object.freeze({ ...envelope }),
    { ...envelope, evidenceDigest: digest("f") },
  ]) {
    assert.throws(
      () => projectValidatedManualRecognitionCommit(forged),
      (error) => error.code === "MANUAL_RECOGNITION_ENVELOPE_INVALID",
    );
    assert.throws(
      () => createManualRecognitionIntakeReceipt(forged),
      (error) => error.code === "MANUAL_RECOGNITION_ENVELOPE_INVALID",
    );
  }
});

test("one run and divergent replay fail before an envelope is assigned", () => {
  assert.throws(
    () =>
      validateManualRecognitionIntake(
        fixture({
          runs: [
            { observation: observation(), runId: "manualrun_fixture_0001" },
          ],
        }),
      ),
    (error) => error.code === "MANUAL_RECOGNITION_REPLAY_REQUIRED",
  );
  assert.throws(
    () =>
      validateManualRecognitionIntake(
        fixture({
          runs: [
            { observation: observation(), runId: "manualrun_fixture_0001" },
            {
              observation: observation({ route: "changed-alignment" }),
              runId: "manualrun_fixture_0002",
            },
          ],
        }),
      ),
    (error) => error.code === "MANUAL_RECOGNITION_REPLAY_DIVERGED",
  );
});

test("operation, asset, region, provider and vector-space substitution fail closed", () => {
  assert.throws(() =>
    validateManualRecognitionIntake(
      fixture({
        projection: { ...fixture().projection, assetId: "other_asset" },
      }),
    ),
  );
  assert.throws(() =>
    validateManualRecognitionIntake(
      fixture({
        operation: { ...fixture().operation, region: { ...region, w: 2 } },
      }),
    ),
  );
  assert.throws(() =>
    validateManualRecognitionIntake(
      fixture({
        runs: [
          {
            observation: observation({
              vectorSpaceId: `vector_space_${digest("f")}`,
            }),
            runId: "manualrun_fixture_0001",
          },
          { observation: observation(), runId: "manualrun_fixture_0002" },
        ],
      }),
    ),
  );
});

test("quality policy derives secondary or low_quality and caller tier cannot exist", () => {
  const low = fixture({
    quality: {
      ...fixture().quality,
      score: 0.5,
    },
  });
  assert.equal(
    validateManualRecognitionIntake(low).evidenceTier,
    "low_quality",
  );
  assert.throws(
    () =>
      validateManualRecognitionIntake(
        fixture({
          quality: { ...fixture().quality, evidenceTier: "secondary" },
        }),
      ),
    /unsupported fields/,
  );
  assert.throws(
    () =>
      validateManualRecognitionIntake(
        fixture({
          quality: { ...fixture().quality, policyDigest: digest("f") },
        }),
      ),
    /policyDigest/,
  );
  assert.throws(
    () =>
      validateManualRecognitionIntake(
        fixture({ quality: { ...fixture().quality, score: 0.2 } }),
      ),
    (error) => error.code === "MANUAL_RECOGNITION_QUALITY_FAILED",
  );
});

test("exact allowlists and canonical numeric precision reject caller content drift", () => {
  assert.throws(() =>
    validateManualRecognitionIntake({
      ...fixture(),
      providerCredential: "secret",
    }),
  );
  assert.throws(() =>
    validateManualRecognitionIntake(
      fixture({
        operation: {
          ...fixture().operation,
          region: { ...region, x: 0.1234567 },
        },
      }),
    ),
  );
});
