import assert from "node:assert/strict";
import test from "node:test";
import { compileShadowSourcePack } from "../src/source-pack-shadow.mjs";

const face = (faceId, personId, vector, assetId = faceId) => ({
  assetId,
  blockedPrime: false,
  captureTime: "2026-01-01T00:00:00.000Z",
  configDigest: "config_shadow",
  decisionActorKind: "user",
  detection: 0.99,
  dimension: 3,
  faceId,
  galleryPermission: "allowed",
  identityClaimId: `claim_${faceId}`,
  identityOrigin: "user",
  identityState: "accepted",
  modelFamily: "shadow-family",
  modelVersion: "shadow-v1",
  personId,
  primeEligible: true,
  quality: 0.99,
  sourceTierHint: "unknown",
  vector: Float32Array.from(vector),
  vectorDigest: `vector_${faceId}`,
});

test("shadow compilation proves exact Prime parity without persisting identifiers", () => {
  const faces = [
    face("face_private_a", "person_private_a", [1, 0, 0]),
    face("face_private_b", "person_private_b", [0, 1, 0]),
  ];
  const first = compileShadowSourcePack(
    faces,
    {
      cutoff: "2026-01-02T00:00:00.000Z",
      lowQualityLimit: 0,
      primeOptions: { maxPrime: 1, minDetection: 0.4, minQuality: 0.68 },
      secondaryLimit: 0,
    },
    {
      expectedAnchoredPersonIds: ["person_private_a", "person_private_b"],
      expectedPrimeFaceIds: ["face_private_a", "face_private_b"],
    },
  );
  const second = compileShadowSourcePack(
    [...faces].reverse(),
    {
      cutoff: "2026-01-02T00:00:00.000Z",
      lowQualityLimit: 0,
      primeOptions: { maxPrime: 1, minDetection: 0.4, minQuality: 0.68 },
      secondaryLimit: 0,
    },
    {
      expectedAnchoredPersonIds: ["person_private_b", "person_private_a"],
      expectedPrimeFaceIds: ["face_private_b", "face_private_a"],
    },
  );

  assert.equal(first.receipt.status, "passed");
  assert.equal(first.receipt.anchoredPersonCoverage.passed, true);
  assert.equal(first.receipt.primeParity.passed, true);
  assert.equal(first.receipt.primeParity.actualCount, 2);
  assert.deepEqual(first.receipt, second.receipt);
  assert.equal(JSON.stringify(first.receipt).includes("face_private"), false);
  assert.equal(JSON.stringify(first.receipt).includes("person_private"), false);
});

test("shadow compilation fails closed on membership drift", () => {
  const { receipt } = compileShadowSourcePack(
    [face("face_a", "person_a", [1, 0, 0])],
    {
      cutoff: "2026-01-02T00:00:00.000Z",
      lowQualityLimit: 0,
      primeOptions: { maxPrime: 1 },
      secondaryLimit: 0,
    },
    { expectedPrimeFaceIds: ["face_elsewhere"] },
  );

  assert.equal(receipt.status, "failed");
  assert.equal(receipt.primeParity.passed, false);
  assert.equal(receipt.primeParity.missingCount, 1);
  assert.equal(receipt.primeParity.unexpectedCount, 1);
});

test("shadow compilation blocks activation when a current anchor loses provider coverage", () => {
  const { receipt } = compileShadowSourcePack(
    [face("face_a", "person_a", [1, 0, 0])],
    {
      cutoff: "2026-01-02T00:00:00.000Z",
      lowQualityLimit: 0,
      primeOptions: { maxPrime: 1 },
      secondaryLimit: 0,
    },
    {
      expectedAnchoredPersonIds: ["person_a", "person_without_provider_vector"],
      expectedPrimeFaceIds: ["face_a"],
    },
  );

  assert.equal(receipt.status, "blocked");
  assert.equal(receipt.primeParity.passed, true);
  assert.equal(receipt.anchoredPersonCoverage.passed, false);
  assert.equal(receipt.anchoredPersonCoverage.missingCount, 1);
  assert.equal(
    JSON.stringify(receipt).includes("person_without_provider_vector"),
    false,
  );
});
