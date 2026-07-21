import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  contextualCandidatePriorSchemaVersion,
  contextualCandidateSetDigest,
  contextualEvidenceDigest,
  contextualPolicyDigest,
  evaluateContextualCandidatePrior,
} from "../src/candidate-context-policy-v2.mjs";
import {
  evaluateMatchingLever,
  matchingLeverEvaluationSchemaVersion,
  matchingLeverGateSchemaVersion,
} from "../src/matching-lever-gate.mjs";
import {
  buildPhotoIsolatedPacks,
  chooseGuardedSecondaryPolicy,
  photoIsolatedOutcomes,
  summarizeSecondaryTransitions,
  summarizeModifierTransitions,
  summarizePhotoIsolatedScores,
} from "../src/source-pack-photo-holdout.mjs";
import { digestValue } from "../src/source-pack.mjs";
import { contextualCandidateBodyAdapterContractDigest } from "../src/contextual-candidate-body-adapter.mjs";
import { contextualCandidateCaptureAdapterContractDigest } from "../src/contextual-candidate-capture-adapter.mjs";
import { contextualCandidateSamePhotoAdapterContractDigest } from "../src/contextual-candidate-same-photo-adapter.mjs";
import { summarizePhotoIsolatedSplit } from "../src/source-pack-photo-holdout-repository.mjs";

test("eligible manual Face consumers use the filtered current-evidence view without a nonexistent state column", async () => {
  const [holdoutRepository, evaluator, schema50, schema51] = await Promise.all([
    readFile(
      new URL(
        "../src/source-pack-photo-holdout-repository.mjs",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../src/source-pack-evaluator.mjs", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../../migrations/0050_manual_recognition_intake_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../../migrations/0051_typed_manual_subject_tag_v2.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  for (const source of [holdoutRepository, evaluator]) {
    assert.match(source, /current_manual_face_matching_evidence/);
    assert.doesNotMatch(
      source,
      /lifecycle\.state\s*=\s*'eligible_for_evaluation'/,
    );
  }
  for (const migration of [schema50, schema51]) {
    assert.match(
      migration,
      /CREATE(?: OR REPLACE)? VIEW current_manual_face_matching_evidence[\s\S]*WHERE lifecycle\.state = 'eligible_for_evaluation'/,
    );
  }
});

const face = (
  faceId,
  personId,
  assetId,
  captureTime,
  vector,
  overrides = {},
) => ({
  assetId,
  blockedPrime: false,
  captureTime,
  conditionFeatures: {},
  configDigest: "config_a",
  currentBucketKind: null,
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
  sourceTierHint: "prime",
  modifiers: [],
  captureContexts: [],
  userPinnedSecondary: false,
  vector: Float32Array.from(vector),
  vectorDigest: digestValue(vector.join(",")),
  ...overrides,
});

const fixture = [
  face("a1", "alice", "asset_a1", "2020-01-01T00:00:00Z", [1, 0, 0]),
  face("a2", "alice", "asset_a2", "2020-02-01T00:00:00Z", [0.99, 0.01, 0]),
  face("a3", "alice", "asset_a3", "2020-03-01T00:00:00Z", [0.98, 0.02, 0], {
    sourceTierHint: "secondary",
  }),
  face("b1", "bob", "asset_b1", "2020-01-01T00:00:00Z", [0, 1, 0]),
  face("b2", "bob", "asset_b2", "2020-02-01T00:00:00Z", [0.01, 0.99, 0]),
  face("c1", "carol", "asset_c1", "2020-01-01T00:00:00Z", [0, 0, 1]),
];

test("context-isolated packs deterministically remove every face from each ungrouped query photo", () => {
  const options = {
    cutoff: "2020-12-31T23:59:59Z",
    primeOptions: { maxPrime: 2, minPrime: 1 },
    seed: "test-seed",
  };
  const first = buildPhotoIsolatedPacks(fixture, options);
  const second = buildPhotoIsolatedPacks([...fixture].reverse(), options);
  assert.equal(first.cohortDigest, second.cohortDigest);
  assert.equal(first.calibration.pack.packId, second.calibration.pack.packId);
  assert.equal(first.holdout.pack.packId, second.holdout.pack.packId);
  assert.equal(first.stats.evaluablePeople, 2);
  assert.equal(first.stats.singlePhotoPeople, 1);
  for (const fold of [first.calibration, first.holdout]) {
    for (const query of fold.queries) {
      const heldFaceIds = new Set(
        fixture
          .filter((row) => row.assetId === query.assetId)
          .map((row) => row.faceId),
      );
      assert.equal(
        fold.pack.references.some((reference) =>
          heldFaceIds.has(reference.faceId),
        ),
        false,
      );
      assert.equal(
        fold.pack.references.some((reference) =>
          reference.memberFaceIds.some((faceId) => heldFaceIds.has(faceId)),
        ),
        false,
      );
    }
  }
});

test("context isolation keeps connected Burst and Same-moment siblings out of the source pack", () => {
  const connectedContextFixture = [
    ...fixture,
    face("d1", "dana", "asset_d1", "2020-01-01T00:00:00Z", [0.7, 0.7, 0], {
      captureContexts: [{ contextId: "burst_d" }],
    }),
    face("d2", "dana", "asset_d2", "2020-01-01T00:00:01Z", [0.71, 0.69, 0], {
      captureContexts: [{ contextId: "burst_d" }, { contextId: "moment_d" }],
    }),
    face("d3", "dana", "asset_d3", "2020-01-01T00:00:02Z", [0.69, 0.71, 0], {
      captureContexts: [{ contextId: "moment_d" }],
    }),
    face("d4", "dana", "asset_d4", "2020-04-01T00:00:00Z", [0.72, 0.68, 0]),
  ];
  const result = buildPhotoIsolatedPacks(connectedContextFixture, {
    cutoff: "2020-12-31T23:59:59Z",
    primeOptions: { maxPrime: 3, minPrime: 1 },
    seed: "context-closure-test",
  });
  const contextFold = [result.calibration, result.holdout].find((fold) =>
    fold.queries.some(
      (query) =>
        query.personId === "dana" && query.captureContextIds.length > 0,
    ),
  );
  assert.ok(contextFold);
  const contextQuery = contextFold.queries.find(
    (query) => query.personId === "dana" && query.captureContextIds.length > 0,
  );
  assert.ok(contextQuery);
  assert.equal(contextFold.heldOutContexts >= 2, true);
  for (const faceId of ["d1", "d2", "d3"]) {
    assert.equal(
      contextFold.pack.references.some(
        (reference) =>
          reference.faceId === faceId ||
          reference.memberFaceIds.includes(faceId),
      ),
      false,
    );
  }
});

test("two photos from one capture context count as one evaluable opportunity", () => {
  const sharedOnly = [
    ...fixture,
    face("d1", "dana", "asset_d1", "2020-01-01T00:00:00Z", [0.7, 0.7, 0], {
      captureContexts: [{ contextId: "same_moment_d" }],
    }),
    face("d2", "dana", "asset_d2", "2020-01-01T00:00:01Z", [0.71, 0.69, 0], {
      captureContexts: [{ contextId: "same_moment_d" }],
    }),
  ];
  const result = buildPhotoIsolatedPacks(sharedOnly, {
    cutoff: "2020-12-31T23:59:59Z",
    seed: "independence-unit-test",
  });
  assert.equal(result.stats.singleIndependentContextPeople, 2);
  assert.equal(
    result.calibration.queries.some((query) => query.personId === "dana"),
    false,
  );
});

test("photo isolation masks a co-appearing Person from the held-out asset", () => {
  const sharedPhoto = [
    ...fixture,
    face(
      "bob_on_alice_photo",
      "bob",
      "asset_a1",
      "2020-01-01T00:00:00Z",
      [0.02, 0.98, 0],
    ),
    face(
      "bob_on_alice_photo_2",
      "bob",
      "asset_a2",
      "2020-02-01T00:00:00Z",
      [0.02, 0.98, 0],
    ),
  ];
  const result = buildPhotoIsolatedPacks(sharedPhoto, {
    cutoff: "2020-12-31T23:59:59Z",
    primeOptions: { maxPrime: 2, minPrime: 1 },
    seed: "test-seed",
  });
  let checked = 0;
  for (const fold of [result.calibration, result.holdout]) {
    for (const query of fold.queries.filter(
      (row) => row.personId === "alice",
    )) {
      const coappearance =
        query.assetId === "asset_a1"
          ? "bob_on_alice_photo"
          : "bob_on_alice_photo_2";
      assert.equal(
        fold.pack.references.some(
          (reference) =>
            reference.faceId === coappearance ||
            reference.memberFaceIds.includes(coappearance),
        ),
        false,
      );
      checked += 1;
    }
  }
  assert.equal(checked, 2);
});

test("held-out evidence cannot leak body-presence authority into its training fold", () => {
  const presenceFixture = [
    ...fixture,
    face(
      "presence_a",
      "presence_person",
      "presence_asset_a",
      "2020-04-01T00:00:00Z",
      [0.8, 0.6, 0],
      {
        galleryPermission: "never",
        maxOtherPrimeSimilarity: 0.2,
        sourceTierHint: "body_presence",
      },
    ),
    face(
      "presence_b",
      "presence_person",
      "presence_asset_b",
      "2020-05-01T00:00:00Z",
      [0.78, 0.62, 0],
      {
        galleryPermission: "never",
        maxOtherPrimeSimilarity: 0.2,
        sourceTierHint: "body_presence",
      },
    ),
  ];
  const result = buildPhotoIsolatedPacks(presenceFixture, {
    cutoff: "2020-12-31T23:59:59Z",
    seed: "presence-authority-isolation",
  });
  for (const fold of [result.calibration, result.holdout]) {
    assert.equal(
      fold.queries.some((row) => row.personId === "presence_person"),
      true,
    );
    assert.equal(
      fold.pack.references.some((row) => row.personId === "presence_person"),
      false,
    );
  }
});

test("guarded Secondary policy is calibrated separately then summarized on blind rows", () => {
  const rows = [
    {
      personId: "alice",
      primeMargin: 0.01,
      queryAssetId: "asset_q1",
      queryFaceId: "q1",
      rawPrimeScore: 0.9,
      robustPrimeScore: 0.81,
      secondaryScore: 0.99,
      sourceTierHint: "secondary",
      truthPersonId: "alice",
    },
    {
      personId: "bob",
      primeMargin: 0.01,
      queryFaceId: "q1",
      rawPrimeScore: 0.91,
      robustPrimeScore: 0.82,
      secondaryScore: 0.7,
      sourceTierHint: "secondary",
      truthPersonId: "alice",
    },
    {
      personId: "alice",
      primeMargin: 0.2,
      queryFaceId: "q2",
      rawPrimeScore: 0.95,
      robustPrimeScore: 0.94,
      secondaryScore: 0.8,
      sourceTierHint: "prime",
      truthPersonId: "alice",
    },
    {
      personId: "bob",
      primeMargin: 0.2,
      queryFaceId: "q2",
      rawPrimeScore: 0.8,
      robustPrimeScore: 0.79,
      secondaryScore: 0.9,
      sourceTierHint: "prime",
      truthPersonId: "alice",
    },
  ];
  const policy = chooseGuardedSecondaryPolicy(rows);
  const summary = summarizePhotoIsolatedScores(rows, policy);
  const outcomes = photoIsolatedOutcomes(rows, policy);
  const transitions = summarizeSecondaryTransitions(outcomes);
  const persistedSummary = summarizePhotoIsolatedSplit(rows, policy);
  assert.equal(policy.correct, 2);
  assert.equal(summary.layeredResolver.correct, 2);
  assert.equal(summary.robustPrime.correct, 1);
  assert.equal(summary.layeredResolver.secondaryRouted, 1);
  assert.equal(outcomes.length, 2);
  assert.equal(outcomes[0].queryAssetId, "asset_q1");
  assert.equal(outcomes.filter((outcome) => outcome.layeredCorrect).length, 2);
  assert.equal(transitions.rescues, 1);
  assert.equal(transitions.falseFlips, 0);
  assert.equal(transitions.ordinaryQueries, 1);
  assert.deepEqual(persistedSummary.secondaryTransitions, transitions);
  assert.equal(persistedSummary.modifierTransitions.queries, 2);
});

test("LQ can rescue a low-resolution query without entering ordinary matching", () => {
  const rows = [
    {
      lowQualityScore: 0.99,
      personId: "alice",
      primeMargin: 0.05,
      queryFaceId: "tiny_query",
      queryLowQuality: true,
      rawPrimeScore: 0.76,
      robustPrimeScore: 0.75,
      robustRank: 2,
      sourceTierHint: "lq",
      truthPersonId: "alice",
    },
    {
      lowQualityScore: 0.55,
      personId: "bob",
      primeMargin: 0.05,
      queryFaceId: "tiny_query",
      queryLowQuality: true,
      rawPrimeScore: 0.81,
      robustPrimeScore: 0.8,
      robustRank: 1,
      sourceTierHint: "lq",
      truthPersonId: "alice",
    },
  ];
  const summary = summarizePhotoIsolatedScores(rows, {
    threshold: 0.02,
    weight: 0.1,
  });
  assert.equal(summary.robustPrime.correct, 0);
  assert.equal(summary.layeredResolver.correct, 1);
  assert.equal(summary.layeredResolver.lowQualityRouted, 1);
});

test("modifier transition receipt separates rescues from ordinary false flips", () => {
  const rows = [
    {
      modifierScore: 0.99,
      personId: "alice",
      primeMargin: 0.2,
      queryFaceId: "rescue",
      rawPrimeScore: 0.79,
      robustPrimeScore: 0.78,
      robustRank: 2,
      truthPersonId: "alice",
    },
    {
      modifierScore: 0.6,
      personId: "bob",
      primeMargin: 0.2,
      queryFaceId: "rescue",
      rawPrimeScore: 0.82,
      robustPrimeScore: 0.81,
      robustRank: 1,
      truthPersonId: "alice",
    },
    {
      modifierScore: 0.55,
      personId: "alice",
      primeMargin: 0.2,
      queryFaceId: "false_flip",
      rawPrimeScore: 0.91,
      robustPrimeScore: 0.9,
      robustRank: 1,
      truthPersonId: "alice",
    },
    {
      modifierScore: 0.99,
      personId: "bob",
      primeMargin: 0.2,
      queryFaceId: "false_flip",
      rawPrimeScore: 0.8,
      robustPrimeScore: 0.79,
      robustRank: 2,
      truthPersonId: "alice",
    },
  ];
  const receipt = summarizeModifierTransitions(rows, {
    threshold: 0.02,
    weight: 0.1,
  });
  assert.equal(receipt.queries, 2);
  assert.equal(receipt.modifierEligible, 2);
  assert.equal(receipt.changedWinner, 2);
  assert.equal(receipt.rescues, 1);
  assert.equal(receipt.falseFlips, 1);
});

test("Sort identities remain gallery distractors but cannot become evaluation truth", () => {
  const sortedFixture = fixture.map((row) =>
    row.personId === "bob" ? { ...row, personNeedsSort: true } : row,
  );
  const result = buildPhotoIsolatedPacks(sortedFixture, {
    cutoff: "2020-12-31T23:59:59Z",
    primeOptions: { maxPrime: 2, minPrime: 1 },
    seed: "sort-trust-test",
  });
  assert.equal(result.stats.evaluablePeople, 1);
  assert.equal(result.stats.sortPeopleExcluded, 1);
  assert.equal(
    result.calibration.queries.some((query) => query.personId === "bob"),
    false,
  );
  assert.equal(
    result.calibration.pack.references.some(
      (reference) => reference.personId === "bob",
    ),
    true,
  );
});

test("synthetic contextual-prior transitions reuse the exact matching-lever QC gate", () => {
  const contextualPolicy = Object.freeze({
    bodyAdjustment: 0.01,
    captureAdjustment: 0.01,
    maximumMetadataErrorSeconds: 120,
    maximumTotalAdjustment: 0.02,
    minimumBodyMargin: 0.005,
    minimumBodyScore: 0.8,
    minimumCaptureConfidence: 0.8,
    tieWindow: 0.02,
    visualFloor: 0.7,
  });
  const providerConfigDigest = digestValue("synthetic-context-provider");
  const cohortDigest = digestValue("synthetic-context-frozen-cohort");
  const truthVersionDigest = digestValue("synthetic-context-frozen-truth");
  const vectorSpaceId = `vector_space_${digestValue("synthetic-context-space")}`;
  const visualPolicyDigest = digestValue("prime-only-frozen-visual-policy");

  const evidence = (character, support = false) => ({
    ambiguity: {
      evidenceDigest: character.repeat(64),
      state: "none",
    },
    bodyContinuity: support
      ? {
          evidenceDigest: digestValue(`${character}:body`),
          margin: 0.02,
          score: 0.95,
          state: "supported",
        }
      : {
          evidenceDigest: digestValue(`${character}:body`),
          margin: 0,
          score: 0,
          state: "unavailable",
        },
    captureContext: support
      ? {
          coappearance: "supporting",
          confidence: 0.95,
          contextKind: "same_moment",
          evidenceDigest: digestValue(`${character}:capture`),
          reliability: "verified",
          state: "supported",
          time: "supporting",
        }
      : {
          coappearance: "unavailable",
          confidence: 0,
          contextKind: "none",
          evidenceDigest: digestValue(`${character}:capture`),
          reliability: "unavailable",
          state: "unavailable",
          time: "unavailable",
        },
    metadata: {
      errorSeconds: 0,
      evidenceDigest: digestValue(`${character}:metadata`),
      reliability: "verified",
    },
    samePhoto: {
      evidenceDigest: digestValue(`${character}:same-photo`),
      state: "absent",
    },
  });

  const contextualQuery = ({
    key,
    separated = false,
    support = true,
    truth,
  }) => {
    const queryToken = digestValue(`${key}:query`);
    const baselineToken = digestValue(`${key}:baseline`);
    const contextualToken = digestValue(`${key}:contextual`);
    const candidates = [
      {
        ...evidence("a"),
        candidateToken: baselineToken,
        visualScore: separated ? 0.92 : 0.82,
      },
      {
        ...evidence("b", support),
        candidateToken: contextualToken,
        visualScore: separated ? 0.81 : 0.805,
      },
    ];
    const input = {
      baseline: {
        candidateToken: baselineToken,
        margin: separated ? 0.11 : 0.015,
        visualScore: separated ? 0.92 : 0.82,
      },
      bodyContinuitySource: "synthetic_fixture",
      candidateSetDigest: contextualCandidateSetDigest(candidates),
      candidates,
      cohortDigest,
      contextPolicyDigest: contextualPolicyDigest(contextualPolicy),
      evidenceDigest: contextualEvidenceDigest(candidates),
      nonRepresentative: true,
      operationalUse: "none",
      policy: contextualPolicy,
      providerConfigDigest,
      queryToken,
      schemaVersion: contextualCandidatePriorSchemaVersion,
      truthVersionDigest,
      vectorSpaceId,
      visualPolicyDigest,
    };
    return {
      baselineToken,
      contextualToken,
      receipt: evaluateContextualCandidatePrior(input),
      truthToken:
        truth === "baseline"
          ? baselineToken
          : truth === "contextual"
            ? contextualToken
            : digestValue(`${key}:historical-truth-conflict`),
    };
  };

  const summarize = (rows) => ({
    baselineCorrect: rows.filter((row) => row.baselineToken === row.truthToken)
      .length,
    candidateCorrect: rows.filter(
      (row) =>
        (row.receipt.decision.proposedCandidateToken || row.baselineToken) ===
        row.truthToken,
    ).length,
    changedOutcomes: rows.filter(
      (row) => row.receipt.decision.status === "tie_break_proposed",
    ).length,
  });

  const calibrationRows = [
    contextualQuery({ key: "calibration-rescue", truth: "contextual" }),
    contextualQuery({
      key: "calibration-ordinary",
      separated: true,
      truth: "baseline",
    }),
  ];
  const calibration = summarize(calibrationRows);
  assert.deepEqual(calibration, {
    baselineCorrect: 1,
    candidateCorrect: 2,
    changedOutcomes: 1,
  });

  const holdoutRows = [
    contextualQuery({ key: "holdout-rescue", truth: "contextual" }),
    contextualQuery({ key: "holdout-historical-tag", truth: "conflict" }),
    contextualQuery({
      key: "holdout-ordinary",
      separated: true,
      truth: "baseline",
    }),
    contextualQuery({
      key: "holdout-single-family",
      support: false,
      truth: "baseline",
    }),
  ];
  const holdout = summarize(holdoutRows);
  assert.deepEqual(holdout, {
    baselineCorrect: 2,
    candidateCorrect: 3,
    changedOutcomes: 2,
  });
  assert.equal(
    new Set(
      [...calibrationRows, ...holdoutRows].map((row) => row.receipt.queryToken),
    ).size,
    6,
  );
  assert.equal(
    [...calibrationRows, ...holdoutRows].every(
      (row) =>
        row.receipt.nonRepresentative === true &&
        row.receipt.operationalUse === "none" &&
        row.receipt.boundary.bodyContinuitySource === "synthetic_fixture",
    ),
    true,
  );

  const candidateArtifactDigest = digestValue({
    bodyAdapterContractDigest: contextualCandidateBodyAdapterContractDigest,
    calibration: calibrationRows.map((row) => row.receipt.receiptDigest),
    captureAdapterContractDigest:
      contextualCandidateCaptureAdapterContractDigest,
    holdout: holdoutRows.map((row) => row.receipt.receiptDigest),
    policyDigest: contextualPolicyDigest(contextualPolicy),
    samePhotoAdapterContractDigest:
      contextualCandidateSamePhotoAdapterContractDigest,
  });
  const gateReceipt = evaluateMatchingLever({
    authority: "human_review",
    baseline: {
      policyId: "prime_only_v1",
      providerConfigDigest,
      vectorSpaceId,
    },
    calibration: {
      baselineCorrect: calibration.baselineCorrect,
      candidateCorrect: calibration.candidateCorrect,
      cohortDigest,
      queries: calibrationRows.length,
      truthVersionDigest,
    },
    candidate: {
      artifactDigest: candidateArtifactDigest,
      policyId: "contextual_candidate_prior_v2",
      providerConfigDigest,
      vectorSpaceId,
    },
    experiment: {
      cohortDigest,
      experimentId: "synthetic_contextual_prior_v2",
      providerConfigDigest,
      truthVersionDigest,
      vectorSpaceId,
    },
    gate: {
      maximumConfirmedModelRegressions: 0,
      minimumConfirmedNetGain: 1,
      minimumHoldoutQueries: holdoutRows.length,
      requireCompleteQc: true,
    },
    holdout: {
      baselineCorrect: holdout.baselineCorrect,
      candidateCorrect: holdout.candidateCorrect,
      changedOutcomes: holdout.changedOutcomes,
      cohortDigest,
      consequentialChanges: holdout.changedOutcomes,
      qc: {
        ambiguousGroupTag: 0,
        confirmedModelRegression: 0,
        confirmedModelRescue: 1,
        historicalTagError: 1,
        metadataContextConflict: 0,
        unreviewed: 0,
        visuallyUnresolvable: 0,
      },
      queries: holdoutRows.length,
      truthVersionDigest,
    },
    protocol: {
      calibrationFrozenBeforeHoldout: true,
      deterministicReplay: true,
      holdoutAccess: "selected_candidate_once",
      queryReferenceOverlap: 0,
    },
    schemaVersion: matchingLeverEvaluationSchemaVersion,
  });
  assert.equal(gateReceipt.schemaVersion, matchingLeverGateSchemaVersion);
  assert.equal(gateReceipt.decision.status, "evidence_gate_passed");
  assert.equal(gateReceipt.holdout.confirmedNetGain, 1);
  assert.deepEqual(gateReceipt.holdout.qc, {
    ambiguousGroupTag: 0,
    confirmedModelRegression: 0,
    confirmedModelRescue: 1,
    historicalTagError: 1,
    metadataContextConflict: 0,
    unreviewed: 0,
    visuallyUnresolvable: 0,
  });
  assert.equal(gateReceipt.authority.recommendation, "none");
  assert.equal(gateReceipt.authority.activation, "none");
  assert.equal(gateReceipt.authority.training, "none");
  assert.equal(gateReceipt.authority.automaticIdentityAuthority, "none");
});
