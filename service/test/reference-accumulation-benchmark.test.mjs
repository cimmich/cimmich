import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProviderPrimePolicyGalleries,
  buildReferenceAccumulationGalleries,
} from "../src/reference-accumulation-benchmark.mjs";

const unit = (values) => {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return values.map((value) => value / norm);
};
const face = (personId, faceId, vector, quality = 0.9) => ({
  assetId: `asset-${faceId}`,
  captureContexts: [],
  detection: 0.9,
  faceId,
  galleryPermission: "allowed",
  personId,
  primeEligible: true,
  quality,
  sourceTierHint: "prime",
  vector: unit(vector),
});

test("reference accumulation gives both policies the same accepted evidence sequence", () => {
  const result = buildReferenceAccumulationGalleries(
    [
      face("a", "a1", [1, 0]),
      face("a", "a2", [0.99, 0.01]),
      face("a", "a3", [0, 1], 0.7),
      face("b", "b1", [0, 1]),
      face("b", "b2", [0.01, 0.99]),
    ],
    { budgets: [1, 2, "all"], seed: "fixture-seed" },
  );
  assert.deepEqual(
    result.map((row) => row.acceptedFaces),
    [2, 4, 5],
  );
  assert.deepEqual(
    result.map((row) => row.standardFaceIds.length),
    [2, 4, 5],
  );
  assert.ok(
    result.every(
      (row) => row.cimmichFaceIds.length <= row.standardFaceIds.length,
    ),
  );
  assert.deepEqual(
    result,
    buildReferenceAccumulationGalleries(
      [
        face("a", "a1", [1, 0]),
        face("a", "a2", [0.99, 0.01]),
        face("a", "a3", [0, 1], 0.7),
        face("b", "b1", [0, 1]),
        face("b", "b2", [0.01, 0.99]),
      ],
      { budgets: [1, 2, "all"], seed: "fixture-seed" },
    ),
  );
});

test("provider Prime policy grid returns deterministic isolated galleries", () => {
  const faces = [
    face("person-a", "a", [1, 0], 0.9),
    face("person-a", "b", [0.8, 0.2], 0.8),
    face("person-b", "c", [0, 1], 0.9),
  ];
  const policies = [
    { policyId: "strict", primeOptions: { minQuality: 0.85 } },
    { policyId: "broad", primeOptions: { minQuality: 0.5 } },
  ];
  const first = buildProviderPrimePolicyGalleries(faces, { policies });
  const second = buildProviderPrimePolicyGalleries(faces, { policies });
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.map((row) => row.policyId),
    ["strict", "broad"],
  );
  assert.ok(first.every((row) => row.faceIds.length >= 2));
});
