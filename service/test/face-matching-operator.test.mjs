import assert from "node:assert/strict";
import test from "node:test";
import {
  createFaceMatchingOperator,
  deriveOwnerSourcePackPlan,
  deriveSourcePackReviewNext,
  projectSourcePackReviewGate,
} from "../src/face-matching-operator.mjs";
import { deriveSourcePackReviewGate } from "../src/source-pack-evaluator.mjs";

const face = (personId, captureTime) => ({ captureTime, personId });

test("owner SourcePack planning holds a tiny library without an open-set cohort", () => {
  const input = [
    face("person-b", "2022-01-01T00:00:00Z"),
    face("person-a", "2020-01-01T00:00:00Z"),
    face("person-b", "2020-01-01T00:00:00Z"),
    face("person-a", "2021-01-01T00:00:00Z"),
    face("person-b", "2021-01-01T00:00:00Z"),
    face("person-a", "2022-01-01T00:00:00Z"),
  ];
  const first = deriveOwnerSourcePackPlan(input);
  const second = deriveOwnerSourcePackPlan([...input].reverse());
  assert.deepEqual(first, second);
  assert.equal(first.calibrationEnd, null);
  assert.equal(first.reason, "INSUFFICIENT_BALANCED_OPEN_SET_HOLDOUT");
  assert.equal(first.reviewability, "operator_hold_required");
});

test("owner SourcePack planning holds instead of inventing a holdout", () => {
  const plan = deriveOwnerSourcePackPlan([
    face("person-a", "2020-01-01T00:00:00Z"),
    face("person-a", "2021-01-01T00:00:00Z"),
  ]);
  assert.equal(plan.calibrationEnd, null);
  assert.equal(plan.reason, "INSUFFICIENT_BALANCED_OPEN_SET_HOLDOUT");
  assert.equal(plan.reviewability, "operator_hold_required");
  assert.throws(
    () => deriveOwnerSourcePackPlan([]),
    (error) => error.code === "FACE_MATCHING_EVIDENCE_UNAVAILABLE",
  );
});

test("owner SourcePack planning selects a balanced known and unknown holdout", () => {
  const known = Array.from({ length: 20 }, (_, index) => `known-${index}`);
  const unknown = Array.from({ length: 20 }, (_, index) => `unknown-${index}`);
  const repeated = (people, captureTime, count) =>
    people.flatMap((personId) =>
      Array.from({ length: count }, () => face(personId, captureTime)),
    );
  const input = [
    ...repeated(known, "2010-01-01T00:00:00Z", 1),
    ...repeated(known, "2011-01-01T00:00:00Z", 5),
    ...repeated(unknown, "2012-01-01T00:00:00Z", 5),
    ...repeated(known, "2013-01-01T00:00:00Z", 5),
    ...repeated(unknown, "2014-01-01T00:00:00Z", 5),
  ];
  const plan = deriveOwnerSourcePackPlan(input);
  assert.equal(plan.evidenceCutoff, "2010-01-01T00:00:00.000Z");
  assert.equal(plan.calibrationEnd, "2012-01-01T00:00:00.000Z");
  assert.equal(plan.calibrationQueries, 100);
  assert.equal(plan.calibrationUnknownQueries, 100);
  assert.equal(plan.completePeople, 20);
  assert.equal(plan.evidenceRows, 420);
  assert.equal(plan.holdoutQueries, 100);
  assert.equal(plan.holdoutUnknownQueries, 100);
  assert.equal(plan.reviewability, "balanced_open_set_holdout_ready");
});

test("review routing never offers an impossible safety check", () => {
  const held = deriveSourcePackReviewNext({
    evaluation: { reason: "SOURCE_PACK_EVALUATION_REQUIRED", status: "untested" },
    reviewability: {
      reason: "INSUFFICIENT_BALANCED_OPEN_SET_HOLDOUT",
      state: "operator_hold_required",
    },
    state: "proposed",
  });
  assert.deepEqual(held, {
    action: "await_more_evidence",
    reason: "INSUFFICIENT_BALANCED_OPEN_SET_HOLDOUT",
  });

  const checkable = deriveSourcePackReviewNext({
    evaluation: { reason: "SOURCE_PACK_EVALUATION_REQUIRED", status: "untested" },
    reviewability: {
      reason: null,
      state: "balanced_open_set_holdout_ready",
    },
    state: "proposed",
  });
  assert.equal(checkable.action, "evaluate_source_pack");
});

test("provider-disabled status retains Basic truth in one total response shape", async () => {
  const sql = async (strings) => {
    assert.match(strings.join(""), /current_face_identity/);
    return [{ accepted_faces: 7 }];
  };
  const operator = createFaceMatchingOperator({
    repository: {
      async faceMatchingStatus() {
        return {
          automaticIdentityAuthority: "none",
          basicIdentityTruthRetainedWhenDisabled: true,
          provider: { configured: false },
          review: {
            enabled: false,
            humanAcceptanceRequired: true,
            marginFloor: null,
            policyVersion: "cimmich-best-prime-v1",
            scoreFloor: null,
          },
          schemaVersion: "cimmich.face-matching-status.v1",
          sourcePack: { activePassed: 0, awaitingReview: 0 },
          state: "provider_disabled",
        };
      },
    },
    sql,
  });
  const status = await operator.status();
  assert.deepEqual(status.evidence, {
    acceptedFaces: 7,
    analysedFaces: 0,
    eligibleFaces: 7,
    providerEmbeddings: 0,
  });
  assert.equal(status.latestPack, null);
  assert.equal(status.next.action, "configure_provider");
});

test("provider status separates eligible analysis from usable embeddings", async () => {
  const makeOperator = (analysedFaces, eligibleFaces = 7) =>
    createFaceMatchingOperator({
      matchingProvider: {
        configDigest: "a".repeat(64),
        modelFamily: "synthetic-face",
        modelVersion: "v1",
        providerConfigDigest: "b".repeat(64),
        providerId: "synthetic-provider",
        vectorSpaceId: "synthetic-space-v1",
      },
      providerReceipt: { state: "ready" },
      repository: {
        async faceMatchingStatus() {
          return {
            enhanced: { enabled: true },
            sourcePack: { activePassed: 0, awaitingReview: 0 },
            state: "needs_source_pack",
          };
        },
      },
      sql: async (strings) => {
        const query = strings.join("");
        if (query.includes("WITH accepted AS")) {
          return [
            {
              accepted_faces: 7,
              analysed_faces: analysedFaces,
              eligible_faces: eligibleFaces,
              provider_embeddings: 4,
            },
          ];
        }
        if (query.includes("FROM source_pack")) {
          return [];
        }
        throw new Error(`Unexpected status query: ${query}`);
      },
    });

  const partial = await makeOperator(6).status();
  assert.deepEqual(partial.evidence, {
    acceptedFaces: 7,
    analysedFaces: 6,
    eligibleFaces: 7,
    providerEmbeddings: 4,
  });
  assert.equal(partial.next.action, "run_recognition");

  const complete = await makeOperator(7).status();
  assert.deepEqual(complete.evidence, {
    acceptedFaces: 7,
    analysedFaces: 7,
    eligibleFaces: 7,
    providerEmbeddings: 4,
  });
  assert.equal(complete.next.action, "compile_source_pack");

  const scopedComplete = await makeOperator(6, 6).status();
  assert.deepEqual(scopedComplete.evidence, {
    acceptedFaces: 7,
    analysedFaces: 6,
    eligibleFaces: 6,
    providerEmbeddings: 4,
  });
  assert.equal(scopedComplete.next.action, "compile_source_pack");

  const noEligibleEvidence = await makeOperator(0, 0).status();
  assert.deepEqual(noEligibleEvidence.next, {
    action: "await_more_evidence",
    reason: "NO_ELIGIBLE_ACCEPTED_FACES",
  });

  const allAbstained = createFaceMatchingOperator({
    matchingProvider: {
      configDigest: "a".repeat(64),
      modelFamily: "synthetic-face",
      modelVersion: "v1",
      providerConfigDigest: "b".repeat(64),
      providerId: "synthetic-provider",
      vectorSpaceId: "synthetic-space-v1",
    },
    providerReceipt: { state: "ready" },
    repository: {
      async faceMatchingStatus() {
        return {
          enhanced: { enabled: true },
          sourcePack: { activePassed: 0, awaitingReview: 0 },
          state: "needs_source_pack",
        };
      },
    },
    sql: async (strings) => {
      const query = strings.join("");
      if (query.includes("WITH accepted AS")) {
        return [
          {
            accepted_faces: 7,
            analysed_faces: 7,
            eligible_faces: 7,
            provider_embeddings: 0,
          },
        ];
      }
      if (query.includes("FROM source_pack")) return [];
      throw new Error(`Unexpected status query: ${query}`);
    },
  });
  assert.deepEqual((await allAbstained.status()).next, {
    action: "await_more_evidence",
    reason: "NO_USABLE_PROVIDER_EMBEDDINGS",
  });
});

const openSetRows = ({ holdoutWinner = "person-a" } = {}) => [
  {
    known_person: true,
    margin: 0.4,
    split: "calibration",
    truth_person_id: "person-a",
    winner_person_id: "person-a",
    winner_score: 0.9,
  },
  {
    known_person: false,
    margin: 0.02,
    split: "calibration",
    truth_person_id: "person-unknown-calibration",
    winner_person_id: "person-a",
    winner_score: 0.3,
  },
  {
    known_person: true,
    margin: 0.4,
    split: "holdout",
    truth_person_id: "person-a",
    winner_person_id: holdoutWinner,
    winner_score: 0.9,
  },
  {
    known_person: true,
    margin: 0.4,
    split: "holdout",
    truth_person_id: "person-b",
    winner_person_id: "person-b",
    winner_score: 0.88,
  },
  ...Array.from({ length: 100 }, (_, index) => ({
    known_person: false,
    margin: 0.02,
    split: "holdout",
    truth_person_id: `person-unknown-${index}`,
    winner_person_id: "person-a",
    winner_score: 0.3,
  })),
];

const gateContext = {
  cohortDigest: "a".repeat(64),
  leakage: { passed: true, queryReferenceOverlap: 0 },
  packId: "pack-owner-v1",
  split: { kind: "synthetic-open-set" },
};

test("review receipt projection is immutable, server-derived and closed when unavailable", () => {
  const absent = projectSourcePackReviewGate({ packId: gateContext.packId });
  assert.equal(absent.reviewGateReceipt, null);
  assert.equal(absent.reviewGateReceiptNullReason, "EVALUATION_REQUIRED");
  assert.equal(
    projectSourcePackReviewGate({ evaluation: {}, packId: gateContext.packId })
      .reviewGateReceiptNullReason,
    "REVIEW_GATE_NOT_DERIVED",
  );

  const derived = deriveSourcePackReviewGate(openSetRows(), gateContext);
  assert.equal(derived.reason, null);
  assert.equal(derived.receipt.status, "passed");
  assert.deepEqual(derived.receipt.thresholds, {
    maximumUnknownFalseAcceptRatePercent: 2.5,
    minimumDecisionPrecisionPercent: 98,
    minimumVerifiedUnknowns: 100,
  });
  const projected = projectSourcePackReviewGate({
    evaluation: { reviewGate: derived },
    packId: gateContext.packId,
  });
  assert.equal(projected.reviewGateReceiptNullReason, null);
  assert.equal(projected.reviewGateReceipt.status, "passed");
  assert.equal(Object.isFrozen(projected.reviewGateReceipt), true);
  assert.equal(Object.isFrozen(projected.reviewGateReceipt.thresholds), true);
  assert.throws(() => {
    projected.reviewGateReceipt.thresholds.minimumVerifiedUnknowns = 1;
  }, TypeError);
});

test("review receipt projection returns failed evidence and rejects tampered artifacts", () => {
  const failed = deriveSourcePackReviewGate(
    openSetRows({ holdoutWinner: "person-b" }),
    gateContext,
  );
  assert.equal(failed.receipt.status, "failed");
  assert.equal(failed.receipt.matcherPolicy, null);

  const tampered = projectSourcePackReviewGate({
    evaluation: {
      reviewGate: {
        ...failed,
        receipt: { ...failed.receipt, packId: "pack-substituted" },
      },
    },
    packId: gateContext.packId,
  });
  assert.equal(tampered.reviewGateReceipt, null);
  assert.equal(
    tampered.reviewGateReceiptNullReason,
    "EVALUATION_ARTIFACT_INVALID",
  );

  const unreviewable = deriveSourcePackReviewGate(
    openSetRows().slice(0, 5),
    gateContext,
  );
  assert.equal(unreviewable.receipt, null);
  assert.equal(unreviewable.reason, "INSUFFICIENT_VERIFIED_UNKNOWNS");
});

test("recognition run derives the provider envelope and preserves command replay", async () => {
  const calls = [];
  const operator = createFaceMatchingOperator({
    enhancedComponent: { isEnabled: async () => true },
    matchingProvider: {
      configDigest: "a".repeat(64),
      modelFamily: "synthetic-face",
      modelVersion: "v1",
      providerId: "synthetic-provider",
      vectorSpaceId: "synthetic-space-v1",
    },
    mediaOperator: {
      async execute(input) {
        calls.push(input);
        return {
          commandId: input.commandId,
          inventory: { admittedAssetCount: 0, state: "completed" },
          queueAfter: { failed: 0, paused: 0, pending: 0, processing: 0 },
          replayed: true,
          state: "completed",
          work: { detections: 3, inventoryPages: 1, recognitions: 3 },
        };
      },
    },
    providerReceipt: { state: "ready" },
    repository: { faceMatchingStatus: async () => ({}) },
    sql: async () => [],
  });
  const result = await operator.runRecognition({
    actorId: "owner-operator",
    commandId: "owner-recognition-0001",
    workLimit: 3,
  });
  assert.equal(result.replayed, true);
  assert.deepEqual(result.work, {
    detections: 3,
    inventoryPages: 1,
    recognitions: 3,
  });
  assert.equal(calls[0].envelope.maxDetectionJobs, 3);
  assert.equal(calls[0].envelope.maxRecognitionJobs, 3);
  assert.equal(calls[0].envelope.candidateLimit, 0);
});

test("recognition-only provider skips Cimmich detection and processes imported Faces", async () => {
  let envelope;
  const operator = createFaceMatchingOperator({
    detectionEnabled: false,
    enhancedComponent: { isEnabled: async () => true },
    matchingProvider: {
      configDigest: "a".repeat(64),
      modelFamily: "synthetic-face",
      modelVersion: "v1",
      providerId: "synthetic-provider",
      vectorSpaceId: "synthetic-space-v1",
    },
    mediaOperator: {
      async execute(input) {
        envelope = input.envelope;
        return {
          commandId: input.commandId,
          inventory: { admittedAssetCount: 4, state: "completed" },
          queueAfter: { failed: 0, paused: 0, pending: 0, processing: 0 },
          replayed: false,
          state: "completed",
          work: { detections: 0, inventoryPages: 1, recognitions: 3 },
        };
      },
    },
    providerReceipt: { state: "ready" },
    repository: { faceMatchingStatus: async () => ({}) },
    sql: async () => [],
  });
  const result = await operator.runRecognition({
    actorId: "owner-operator",
    commandId: "owner-recognition-imported-0001",
    workLimit: 3,
  });
  assert.equal(envelope.maxDetectionJobs, 0);
  assert.equal(envelope.maxRecognitionJobs, 3);
  assert.equal(envelope.maxInventoryPages, 1);
  assert.deepEqual(result.work, {
    detections: 0,
    inventoryPages: 1,
    recognitions: 3,
  });
});

test("recognition fails closed before provider inference when Enhanced is disabled or unavailable", async () => {
  for (const enhancedComponent of [
    { isEnabled: async () => false },
    null,
  ]) {
    let inferenceCalls = 0;
    const operator = createFaceMatchingOperator({
      enhancedComponent,
      matchingProvider: {
        configDigest: "a".repeat(64),
        modelFamily: "synthetic-face",
        modelVersion: "v1",
        providerId: "synthetic-provider",
        vectorSpaceId: "synthetic-space-v1",
      },
      mediaOperator: {
        async execute() {
          inferenceCalls += 1;
          throw new Error("inference must remain gated");
        },
      },
      providerReceipt: { state: "ready" },
      repository: { faceMatchingStatus: async () => ({}) },
      sql: async () => [],
    });
    await assert.rejects(
      operator.runRecognition({
        actorId: "owner-operator",
        commandId: "owner-recognition-gated-0001",
        workLimit: 3,
      }),
      (error) =>
        error.code === "FACE_MATCHING_ENHANCED_DISABLED" &&
        error.statusCode === 409,
    );
    assert.equal(inferenceCalls, 0);
  }
});
