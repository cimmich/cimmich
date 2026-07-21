import assert from "node:assert/strict";
import test from "node:test";
import { curatePrimeSet } from "../src/prime-curator.mjs";
import {
  buildPrimeCurations,
  mainMembershipsToRemoveBeforePrime,
} from "../src/prime-curator-repository.mjs";
import { applyBiometricAuthority } from "../src/biometric-authority.mjs";

const normalized = (values) => {
  const norm = Math.sqrt(
    values.reduce((total, value) => total + value * value, 0),
  );
  return values.map((value) => value / norm);
};

const face = (faceId, vector, quality = 0.9, assetId = faceId, extra = {}) => ({
  assetId,
  blockedPrime: false,
  detection: quality,
  faceId,
  galleryPermission: "allowed",
  pinnedPrime: false,
  quality,
  vector: normalized(vector),
  ...extra,
});

test("curator selects a clean matching gallery and rejects a biometric outlier", () => {
  const rows = [
    face("clean_a", [1, 0.03, 0, 0], 0.96),
    face("clean_b", [0.96, -0.22, 0.01, 0], 0.94),
    face("clean_c", [0.96, 0.2, -0.01, 0], 0.93),
    face("clean_d", [0.95, -0.16, 0.12, 0], 0.91),
    face("clean_e", [0.95, 0.15, -0.1, 0.01], 0.9),
    face("outlier", [0, 1, 0, 0], 0.99),
  ];
  const result = curatePrimeSet(rows, { minCoverageGain: 0.0001 });
  assert.equal(
    result.selected.some((row) => row.faceId === "outlier"),
    false,
  );
  assert.equal(result.selected.length >= 3, true);
  assert.equal(result.metrics.prototypeMean > 0.9, true);
});

test("curator honours an explicit Prime pin and one-face-per-photo independence", () => {
  const pinned = {
    ...face("pinned", [0.8, 0.2, 0, 0], 0.5),
    pinnedPrime: true,
  };
  const rows = [
    pinned,
    face("same_photo_better", [1, 0, 0, 0], 0.99, "pinned"),
    face("clean_b", [0.99, 0.02, 0, 0], 0.95),
    face("clean_c", [0.98, -0.03, 0, 0], 0.94),
    face("clean_d", [0.97, 0.05, 0, 0], 0.93),
  ];
  const result = curatePrimeSet(rows);
  assert.equal(
    result.selected.some((row) => row.faceId === "pinned"),
    true,
  );
  assert.equal(
    result.selected.some((row) => row.faceId === "same_photo_better"),
    false,
  );
});

test("curator keeps one clean anchor instead of filling Prime with a weak fallback", () => {
  const rows = [
    face("clean_anchor", [1, 0, 0, 0], 0.9, "crowded_photo", {
      sourceTierHint: "prime",
    }),
    face("dark_side_on", [0.1, 0.99, 0, 0], 0.67, "background_photo", {
      sourceTierHint: "prime",
    }),
  ];
  const result = curatePrimeSet(rows);
  assert.deepEqual(
    result.selected.map((row) => row.faceId),
    ["clean_anchor"],
  );
  assert.equal(result.selected[0].reason, "minimum_clean_gallery");
  assert.equal(result.metrics.eligibleCount, 1);
});

test("curation routes automatic low-quality evidence outside Prime while preserving a manual override", () => {
  const common = {
    configDigest: "config",
    dimension: 4,
    modelFamily: "test",
    modelVersion: "v1",
    personId: "person",
  };
  const automatic = face("tiny", [0.98, 0.02, 0, 0], 0.8, "tiny_asset", {
    ...common,
    autoLowQuality: true,
    userMainOverride: false,
  });
  const manual = face("manual_tiny", [0.97, 0.03, 0, 0], 0.8, "manual_asset", {
    ...common,
    autoLowQuality: true,
    pinnedPrime: true,
    userMainOverride: true,
  });
  const clean = face("clean", [1, 0, 0, 0], 0.95, "clean_asset", common);
  const [curation] = buildPrimeCurations([automatic, manual, clean]);
  assert.deepEqual(
    curation.lowQualityFaces.map((row) => row.faceId),
    ["tiny"],
  );
  assert.equal(
    curation.selected.some((row) => row.faceId === "tiny"),
    false,
  );
  assert.equal(
    curation.selected.some((row) => row.faceId === "manual_tiny"),
    true,
  );
});

test("curation keeps the best low-quality face as a temporary Prime when no cleaner anchor exists", () => {
  const common = {
    autoLowQuality: true,
    configDigest: "config",
    dimension: 4,
    galleryPermission: "never",
    modelFamily: "test",
    modelVersion: "v1",
    personId: "person",
    userMainOverride: false,
  };
  const [curation] = buildPrimeCurations([
    face("least_noisy", [1, 0, 0, 0], 0.75, "asset_a", common),
    face("noisy", [0.8, 0.2, 0, 0], 0.55, "asset_b", common),
  ]);
  assert.deepEqual(
    curation.selected.map((row) => row.faceId),
    ["least_noisy"],
  );
  assert.deepEqual(
    curation.lowQualityFaces.map((row) => row.faceId),
    ["noisy"],
  );
});

test("all-LQ fallback prefers usable face pixels over noisy embedding centrality", () => {
  const common = {
    autoLowQuality: true,
    configDigest: "config",
    dimension: 4,
    galleryPermission: "never",
    modelFamily: "test",
    modelVersion: "v1",
    personId: "person",
    userMainOverride: false,
  };
  const [curation] = buildPrimeCurations([
    face("tiny_numeric_winner", [1, 0, 0, 0], 0.91, "asset_a", {
      ...common,
      facePixelHeight: 34,
      facePixelWidth: 21,
    }),
    face("usable_lq_anchor", [0.38, 0.92, 0, 0], 0.87, "asset_b", {
      ...common,
      facePixelHeight: 52,
      facePixelWidth: 43,
    }),
    face("tiny_correlated", [0.99, 0.08, 0, 0], 0.89, "asset_c", {
      ...common,
      facePixelHeight: 36,
      facePixelWidth: 21,
    }),
  ]);
  assert.deepEqual(
    curation.selected.map((row) => row.faceId),
    ["usable_lq_anchor"],
  );
  assert.deepEqual(curation.lowQualityFaces.map((row) => row.faceId).sort(), [
    "tiny_correlated",
    "tiny_numeric_winner",
  ]);
});

test("curation keeps one temporary Prime when low-quality faces contain competing noise modes", () => {
  const common = {
    autoLowQuality: true,
    configDigest: "config",
    dimension: 4,
    modelFamily: "test",
    modelVersion: "v1",
    personId: "person",
    userMainOverride: false,
  };
  const [curation] = buildPrimeCurations([
    face("least_noisy", [1, 0, 0, 0], 0.94, "asset_a", common),
    face("similar_export", [0.96, 0.28, 0, 0], 0.9, "asset_b", common),
    face("noisy_profile_a", [0.5, 0.86, 0, 0], 0.86, "asset_c", common),
    face("noisy_profile_b", [0.46, 0.89, 0, 0], 0.84, "asset_d", common),
  ]);
  assert.equal(curation.selected.length, 1);
  assert.equal(curation.lowQualityFaces.length, 3);
  assert.equal(
    curation.lowQualityFaces.some(
      (row) => row.faceId === curation.selected[0].faceId,
    ),
    false,
  );
});

test("curation preserves multiple explicit Prime pins even when every face is low quality", () => {
  const common = {
    autoLowQuality: true,
    configDigest: "config",
    dimension: 4,
    modelFamily: "test",
    modelVersion: "v1",
    personId: "person",
    pinnedPrime: true,
    userMainOverride: true,
  };
  const [curation] = buildPrimeCurations([
    face("user_prime_a", [1, 0, 0, 0], 0.8, "asset_a", common),
    face("user_prime_b", [0.8, 0.6, 0, 0], 0.78, "asset_b", common),
  ]);
  assert.deepEqual(curation.selected.map((row) => row.faceId).sort(), [
    "user_prime_a",
    "user_prime_b",
  ]);
});

test("curator does not let a second clean face earn Prime by covering only itself", () => {
  const rows = [
    face("full_face", [1, 0, 0, 0], 0.9, "full_face_photo", {
      sourceTierHint: "prime",
    }),
    face("single_profile", [0.2, 0.98, 0, 0], 0.81, "profile_photo", {
      sourceTierHint: "secondary",
    }),
  ];
  const result = curatePrimeSet(rows);
  assert.deepEqual(
    result.selected.map((row) => row.faceId),
    ["full_face"],
  );
});

test("curator may add a different mode when it improves an independent face", () => {
  const rows = [
    face("full_face_a", [1, 0, 0, 0], 0.98, "full_face_a_photo", {
      sourceTierHint: "prime",
    }),
    face("full_face_b", [0.99, 0.04, 0, 0], 0.96, "full_face_b_photo", {
      sourceTierHint: "prime",
    }),
    face("profile_a", [0.55, 0.83, 0, 0], 0.9, "profile_a_photo", {
      sourceTierHint: "secondary",
    }),
    face("profile_b", [0.52, 0.85, 0, 0], 0.89, "profile_b_photo", {
      sourceTierHint: "secondary",
    }),
  ];
  const result = curatePrimeSet(rows, {
    centralitySlack: 1,
    minCoverageGain: 0.0001,
  });
  assert.equal(result.selected.length >= 2, true);
  assert.equal(
    result.selected.some(
      (row) => row.reason === "independent_matching_coverage_gain",
    ),
    true,
  );
});

test("capture-context siblings cannot manufacture independent Prime gain", () => {
  const sharedMoment = [{ contextId: "context_shared_moment" }];
  const rows = [
    face("full_face", [1, 0, 0, 0], 0.98, "full_face_photo", {
      sourceTierHint: "prime",
    }),
    face("profile_a", [0.3, 0.95, 0, 0], 0.9, "profile_a_photo", {
      captureContexts: sharedMoment,
      sourceTierHint: "secondary",
    }),
    face("profile_b", [0.28, 0.96, 0, 0], 0.89, "profile_b_photo", {
      captureContexts: sharedMoment,
      sourceTierHint: "secondary",
    }),
  ];
  const result = curatePrimeSet(rows, {
    centralitySlack: 1,
    minCoverageGain: 0.0001,
  });
  assert.equal(result.selected.length, 1);
  assert.equal(
    result.selected.some(
      (row) => row.reason === "independent_matching_coverage_gain",
    ),
    false,
  );
});

test("curator retains an explicit larger minimum only when a caller requests it", () => {
  const rows = [
    face("clean_anchor", [1, 0, 0, 0], 0.9),
    face("weak_fallback", [0.1, 0.99, 0, 0], 0.67),
  ];
  const result = curatePrimeSet(rows, { minPrime: 2 });
  assert.equal(result.selected.length, 2);
});

test("repository curator fails closed when one Person has multiple embedding configurations", () => {
  const base = {
    configDigest: "config_a",
    dimension: 4,
    modelFamily: "test_face",
    modelVersion: "v1",
    personId: "person_a",
  };
  assert.throws(
    () =>
      buildPrimeCurations([
        { ...face("face_a", [1, 0, 0, 0]), ...base },
        {
          ...face("face_b", [1, 0.01, 0, 0]),
          ...base,
          configDigest: "config_b",
        },
      ]),
    /refuses model-ambiguous People/,
  );
});

test("Prime promotion retires both Secondary and LQ main-tier memberships first", () => {
  const movable = mainMembershipsToRemoveBeforePrime([
    {
      bucket_id: "secondary",
      bucket_kind: "secondary",
      face_id: "face_a",
      membership_state: "active",
    },
    {
      bucket_id: "lq",
      bucket_kind: "lq",
      face_id: "face_a",
      membership_state: "active",
    },
    {
      bucket_id: "retired_lq",
      bucket_kind: "lq",
      face_id: "face_a",
      membership_state: "removed",
    },
  ]);
  assert.deepEqual(
    movable.map((row) => row.bucket_id),
    ["secondary", "lq"],
  );
});

test("Prime promotion fails closed while explicit Head evidence is active", () => {
  assert.throws(
    () =>
      mainMembershipsToRemoveBeforePrime([
        {
          bucket_id: "head",
          bucket_kind: "head",
          face_id: "face_head",
          membership_state: "active",
        },
      ]),
    /while Head evidence is active/,
  );
});

const presenceFace = (faceId, vector, assetId = faceId, extra = {}) => ({
  ...face(faceId, vector, 0.9, assetId),
  autoLowQuality: false,
  configDigest: "config",
  dimension: vector.length,
  galleryPermission: "never",
  maxOtherPrimeSimilarity: 0.2,
  modelFamily: "test",
  modelVersion: "v1",
  personId: "presence_person",
  sourceTierHint: "body_presence",
  userMainOverride: false,
  ...extra,
});

test("a lone imported body-presence face cannot grant itself biometric authority", () => {
  const [result] = applyBiometricAuthority([
    presenceFace("only_face", [1, 0, 0, 0]),
  ]);
  assert.equal(result.galleryPermission, "never");
  assert.equal(result.sourceTierHint, "body_presence");
});

test("same-photo detections are not independent corroboration", () => {
  const result = applyBiometricAuthority([
    presenceFace("face_a", [1, 0, 0, 0], "same_photo"),
    presenceFace("face_b", [0.99, 0.02, 0, 0], "same_photo"),
  ]);
  assert.equal(
    result.every((row) => row.galleryPermission === "never"),
    true,
  );
});

test("independent clean body-presence faces unlock the cohort as Secondary evidence", () => {
  const result = applyBiometricAuthority([
    presenceFace("clean_a", [1, 0, 0, 0], "photo_a"),
    presenceFace("clean_b", [0.92, 0.38, 0, 0], "photo_b"),
    presenceFace("weaker_but_useful", [0.9, 0.3, 0.1, 0], "photo_c", {
      quality: 0.64,
    }),
  ]);
  assert.equal(
    result.every((row) => row.galleryPermission === "allowed"),
    true,
  );
  assert.equal(
    result.every((row) => row.sourceTierHint === "secondary"),
    true,
  );
  assert.equal(
    result.every((row) => row.primeEligible === false),
    true,
  );
  assert.equal(
    result.every(
      (row) => row.biometricAuthority === "corroborated_body_presence",
    ),
    true,
  );
});

test("corroboration alone cannot manufacture a new Prime without face completeness", () => {
  const common = {
    configDigest: "config",
    dimension: 4,
    modelFamily: "test",
    modelVersion: "v1",
    personId: "presence_person",
  };
  const [curation] = buildPrimeCurations([
    presenceFace("full_unknown", [1, 0, 0, 0], "photo_a", common),
    presenceFace("partial_unknown", [0.92, 0.38, 0, 0], "photo_b", common),
  ]);
  assert.equal(curation.selected.length, 0);
});

test("measured completeness or an existing reviewed Prime can seed a corroborated cohort", () => {
  const measured = applyBiometricAuthority([
    presenceFace("measured_full", [1, 0, 0, 0], "photo_a", {
      faceCompletenessQualified: true,
    }),
    presenceFace("support", [0.92, 0.38, 0, 0], "photo_b"),
  ]);
  assert.equal(
    measured.find((row) => row.faceId === "measured_full").primeEligible,
    true,
  );
  assert.equal(
    measured.find((row) => row.faceId === "support").primeEligible,
    false,
  );

  const reviewed = applyBiometricAuthority([
    presenceFace("reviewed_prime", [1, 0, 0, 0], "photo_a", {
      currentBucketKind: "prime",
    }),
    presenceFace("reviewed_support", [0.92, 0.38, 0, 0], "photo_b"),
  ]);
  assert.equal(
    reviewed.find((row) => row.faceId === "reviewed_prime").primeEligible,
    true,
  );
  assert.equal(
    reviewed.find((row) => row.faceId === "reviewed_prime").preservedPrime,
    true,
  );
  const [reviewedCuration] = buildPrimeCurations(reviewed);
  assert.equal(
    reviewedCuration.selected.some((row) => row.faceId === "reviewed_prime"),
    true,
  );
});

test("body-presence agreement must clear the nearest outside-Person competitor", () => {
  const result = applyBiometricAuthority([
    presenceFace("face_a", [1, 0, 0, 0], "photo_a", {
      maxOtherPrimeSimilarity: 0.5,
    }),
    presenceFace("face_b", [0.5, 0.866, 0, 0], "photo_b", {
      maxOtherPrimeSimilarity: 0.5,
    }),
  ]);
  assert.equal(
    result.every((row) => row.galleryPermission === "never"),
    true,
  );
});

test("explicit Head remains excluded when its body-presence cohort corroborates", () => {
  const result = applyBiometricAuthority([
    presenceFace("clean_a", [1, 0, 0, 0], "photo_a"),
    presenceFace("clean_b", [0.92, 0.38, 0, 0], "photo_b"),
    presenceFace("user_head", [0.94, 0.3, 0, 0], "photo_c", {
      blockedPrime: true,
      userMainOverride: true,
    }),
  ]);
  assert.equal(
    result.find((row) => row.faceId === "user_head").galleryPermission,
    "never",
  );
  assert.equal(
    result.filter((row) => row.galleryPermission === "allowed").length,
    2,
  );
});

test("an explicit user Secondary choice overrides an imported body-presence prohibition", () => {
  const [result] = applyBiometricAuthority([
    presenceFace("user_secondary", [1, 0, 0, 0], "photo_a", {
      blockedPrime: true,
      userMainOverride: true,
      userPinnedSecondary: true,
    }),
  ]);
  assert.equal(result.galleryPermission, "allowed");
  assert.equal(result.sourceTierHint, "secondary");
  assert.equal(result.biometricAuthority, "user_bucket_override");
});
