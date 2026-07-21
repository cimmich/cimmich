import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPrimeModes,
  compileSourcePack,
  digestValue,
} from "../src/source-pack.mjs";

const vector = (x, y, z = 0) => Float32Array.from([x, y, z]);
const face = (faceId, personId, captureTime, values, overrides = {}) => ({
  assetId: `asset_${faceId}`,
  blockedPrime: false,
  captureTime,
  conditionFeatures: {},
  configDigest: "config_a",
  currentBucketKind: overrides.currentBucketKind || null,
  decisionActorKind: null,
  detection: 0.98,
  dimension: 3,
  faceId,
  galleryPermission: "allowed",
  identityClaimId: `claim_${faceId}`,
  identityOrigin: "trusted_import",
  identityState: "accepted",
  modelFamily: "test_face",
  modelVersion: "v1",
  personId,
  personNeedsSort: false,
  pinnedPrime: false,
  quality: 0.95,
  sourceInstanceSuffix: "",
  sourceTierHint: "prime",
  modifiers: [],
  captureContexts: [],
  userPinnedSecondary: false,
  vector: vector(...values),
  vectorDigest: digestValue(values.join(",")),
  ...overrides,
});

const fixture = [
  face("a1", "alice", "2020-01-01T00:00:00Z", [1, 0], {
    modifiers: [
      {
        actorKind: "user",
        class: "condition",
        confidence: 1,
        key: "helmet",
        label: "Helmet",
      },
    ],
  }),
  face("a2", "alice", "2020-02-01T00:00:00Z", [0.99, 0.05]),
  face("a3", "alice", "2020-03-01T00:00:00Z", [0.98, -0.05]),
  face("a4", "alice", "2020-04-01T00:00:00Z", [0.9, 0.2], {
    blockedPrime: true,
    currentBucketKind: "secondary",
    sourceInstanceSuffix: "1",
    sourceTierHint: "secondary",
    userPinnedSecondary: true,
  }),
  face("a5", "alice", "2020-05-01T00:00:00Z", [0.7, 0.4], {
    blockedPrime: true,
    currentBucketKind: "head",
  }),
  face("b1", "bob", "2020-01-01T00:00:00Z", [0, 1]),
  face("b2", "bob", "2020-02-01T00:00:00Z", [0.05, 0.99]),
  face("b3", "bob", "2020-03-01T00:00:00Z", [-0.05, 0.98]),
  face("future", "alice", "2022-01-01T00:00:00Z", [0.8, 0.3]),
  face("prediction", "bob", "2020-03-15T00:00:00Z", [0.1, 0.9], {
    identityOrigin: "prime_match",
    identityState: "candidate",
  }),
];

test("SourcePack compilation is deterministic, cutoff-safe and candidate-safe", () => {
  const options = {
    cutoff: "2020-12-31T23:59:59Z",
    primeOptions: { minPrime: 2, maxPrime: 3 },
  };
  const first = compileSourcePack(fixture, options);
  const second = compileSourcePack([...fixture].reverse(), options);
  assert.equal(first.packDigest, second.packDigest);
  assert.equal(first.packId, second.packId);
  assert.equal(first.summary.sourceFaces, 8);
  assert.equal(
    first.references.some((reference) => reference.faceId === "a5"),
    false,
  );
  assert.equal(
    first.references.some((reference) => reference.faceId === "future"),
    false,
  );
  assert.equal(
    first.references.some((reference) => reference.faceId === "prediction"),
    false,
  );
  assert.equal(first.summary.prototypes, 2);
});

test("Secondary remains available to the guarded resolver without entering the default gallery", () => {
  const pack = compileSourcePack(fixture, {
    cutoff: "2020-12-31T23:59:59Z",
    primeOptions: { minPrime: 2, maxPrime: 2 },
  });
  const secondary = pack.references.find(
    (reference) => reference.faceId === "a4",
  );
  assert.equal(secondary?.bucketKind, "secondary");
  assert.equal(secondary?.routingState, "condition_only");
  assert.equal(secondary?.conditionFeatures.evidenceState, "unmeasured");
  assert.equal(secondary?.conditionFeatures.sourceTierHint, "secondary");
  assert.equal(pack.summary.secondaryRoutingReady > 0, true);
  assert.equal(
    pack.references.some(
      (reference) =>
        reference.bucketKind === "secondary" && reference.faceId === "a3",
    ),
    true,
  );
});

test("corroborated body-presence imports require explicit or measured Prime completeness", () => {
  const presence = [
    face("p1", "presence_person", "2020-01-01T00:00:00Z", [1, 0], {
      galleryPermission: "never",
      maxOtherPrimeSimilarity: 0.2,
      pinnedPrime: true,
      sourceInstanceSuffix: "2",
      sourceTierHint: "body_presence",
    }),
    face("p2", "presence_person", "2020-01-02T00:00:00Z", [0.96, 0.12], {
      galleryPermission: "never",
      maxOtherPrimeSimilarity: 0.2,
      blockedPrime: true,
      sourceInstanceSuffix: "2",
      sourceTierHint: "body_presence",
      userPinnedSecondary: true,
    }),
    face("p3", "presence_person", "2020-01-03T00:00:00Z", [0.42, 0.9], {
      galleryPermission: "never",
      maxOtherPrimeSimilarity: 0.2,
      blockedPrime: true,
      sourceInstanceSuffix: "2",
      sourceTierHint: "body_presence",
      userPinnedSecondary: true,
    }),
    face("p4", "presence_person", "2020-01-04T00:00:00Z", [0.38, 0.92], {
      galleryPermission: "never",
      maxOtherPrimeSimilarity: 0.2,
      blockedPrime: true,
      sourceInstanceSuffix: "2",
      sourceTierHint: "body_presence",
      userPinnedSecondary: true,
    }),
  ];
  const pack = compileSourcePack(presence, {
    cutoff: "2020-12-31T23:59:59Z",
  });
  const person = pack.manifest.people.find(
    (row) => row.personId === "presence_person",
  );
  assert.equal(person.primeFaceIds.length, 1);
  assert.equal(person.secondaryFaceIds.length, 3);
  assert.equal(
    pack.references
      .filter((row) => row.referenceKind === "face")
      .every(
        (row) =>
          row.provenance.biometricAuthority === "user_bucket_override" ||
          row.conditionFeatures.biometricAuthority === "user_bucket_override",
      ),
    true,
  );
});

test("LQ remains available only to low-quality queries even when the imported gallery permission was never", () => {
  const lowQualityFace = face(
    "a_lq",
    "alice",
    "2020-06-01T00:00:00Z",
    [0.82, 0.18],
    {
      blockedPrime: true,
      currentBucketKind: "lq",
      facePixelHeight: 50,
      facePixelWidth: 34,
      galleryPermission: "never",
      lowQualityReasons: ["tiny_face"],
      sourceInstanceSuffix: "2",
      sourceTierHint: "body_presence",
    },
  );
  const pack = compileSourcePack([...fixture, lowQualityFace], {
    cutoff: "2020-12-31T23:59:59Z",
    primeOptions: { minPrime: 2, maxPrime: 2 },
  });
  const reference = pack.references.find((row) => row.faceId === "a_lq");
  assert.equal(reference?.bucketKind, "lq");
  assert.equal(reference?.routingState, "condition_only");
  assert.deepEqual(reference?.conditionFeatures.reasons, ["tiny_face"]);
  assert.equal(
    pack.references.some(
      (row) => row.faceId === "a_lq" && row.bucketKind === "secondary",
    ),
    false,
  );
  assert.equal(pack.summary.lowQualityFaces, 1);
  assert.equal(pack.summary.lowQualityRoutingReady, 1);
});

test("Observed modifiers enrich one authority reference without duplicating its embedding", () => {
  const pack = compileSourcePack(fixture, {
    cutoff: "2020-12-31T23:59:59Z",
    primeOptions: { minPrime: 2, maxPrime: 3 },
  });
  const prime = pack.references.find(
    (reference) =>
      reference.faceId === "a1" && reference.bucketKind === "prime",
  );
  assert.ok(prime);
  assert.deepEqual(prime?.conditionFeatures.modifiers, [
    {
      actorKind: "user",
      class: "condition",
      confidence: 1,
      key: "helmet",
      label: "Helmet",
    },
  ]);
  assert.equal(
    pack.references.filter((reference) => reference.faceId === "a1").length,
    1,
  );
  assert.equal(pack.summary.modifierFaces, 1);
  assert.equal(pack.manifest.policy.modifiers.duplicateReferenceWeight, false);
});

test("Sort identities stay rankable while SourcePack provenance marks them review-only", () => {
  const pack = compileSourcePack(
    fixture.map((row) =>
      row.personId === "bob" ? { ...row, personNeedsSort: true } : row,
    ),
    {
      cutoff: "2020-12-31T23:59:59Z",
      primeOptions: { minPrime: 1, maxPrime: 2 },
    },
  );
  const person = pack.manifest.people.find((row) => row.personId === "bob");
  const references = pack.references.filter((row) => row.personId === "bob");
  assert.equal(person?.identityReviewState, "sort");
  assert.equal(references.length > 0, true);
  assert.equal(
    references
      .filter((row) => row.bucketKind === "prime")
      .every((row) => row.routingState === "eligible"),
    true,
  );
  assert.equal(
    references
      .filter((row) => row.bucketKind === "secondary")
      .every((row) => row.routingState === "condition_only"),
    true,
  );
  assert.equal(
    references.every((row) => row.provenance.identityReviewState === "sort"),
    true,
  );
  assert.equal(pack.summary.reviewOnlyPeople, 1);
  assert.equal(pack.manifest.policy.sortTrust.supervision, "excluded");
});

test("Prime mode prototypes deterministically preserve multiple clean appearance centers", () => {
  const modeFaces = [
    face("m1", "mode_person", "2020-01-01T00:00:00Z", [1, 0, 0], {
      cleanScore: 0.99,
    }),
    face("m2", "mode_person", "2020-01-02T00:00:00Z", [0.98, 0.1, 0], {
      cleanScore: 0.98,
    }),
    face("m3", "mode_person", "2020-01-03T00:00:00Z", [0.96, -0.1, 0], {
      cleanScore: 0.97,
    }),
    face("m4", "mode_person", "2020-01-04T00:00:00Z", [0.55, 0.83, 0], {
      cleanScore: 0.96,
    }),
    face("m5", "mode_person", "2020-01-05T00:00:00Z", [0.5, 0.86, 0], {
      cleanScore: 0.95,
    }),
    face("m6", "mode_person", "2020-01-06T00:00:00Z", [0.6, 0.8, 0], {
      cleanScore: 0.94,
    }),
  ];
  const modes = buildPrimeModes(modeFaces, { maxModes: 2 });
  const reversed = buildPrimeModes([...modeFaces].reverse(), { maxModes: 2 });
  assert.equal(modes.length, 2);
  assert.deepEqual(
    modes.map((mode) => mode.selected.map((row) => row.faceId)),
    reversed.map((mode) => mode.selected.map((row) => row.faceId)),
  );

  const pack = compileSourcePack(modeFaces, {
    cutoff: "2020-12-31T23:59:59Z",
    primeModeOptions: { maxModes: 2 },
    primeOptions: {
      maxPrime: 6,
      minCoverageGain: -1,
      minPrime: 6,
      nearDuplicateCosine: 1.1,
    },
  });
  const prototypes = pack.references.filter(
    (reference) => reference.referenceKind === "prototype",
  );
  assert.equal(prototypes.length, 3);
  assert.equal(
    prototypes.filter(
      (reference) => reference.provenance.prototypeKind === "prime_mode",
    ).length,
    2,
  );
});

test("SourcePack requires one embedding configuration", () => {
  assert.throws(
    () =>
      compileSourcePack(
        [
          ...fixture,
          face("other_config", "alice", "2020-05-01T00:00:00Z", [1, 0], {
            configDigest: "config_b",
          }),
        ],
        {
          cutoff: "2020-12-31T23:59:59Z",
        },
      ),
    /exactly one embedding configuration/,
  );
});
