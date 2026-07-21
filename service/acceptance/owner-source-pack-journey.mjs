import assert from "node:assert/strict";
import postgres from "postgres";
import { createFaceMatchingOperator } from "../src/face-matching-operator.mjs";
import { createCimmichRepository } from "../src/repository.mjs";
import { recognitionVectorDigest } from "../src/recognition-provider-contract.mjs";

const databaseUrl =
  process.env.DATABASE_URL || "postgres://cimmich@postgres:5432/cimmich";
const sql = postgres(databaseUrl, { max: 2, prepare: true });

const matchingProvider = {
  configDigest: "7".repeat(64),
  modelFamily: "synthetic-owner-face",
  modelVersion: "v1",
  providerId: "synthetic-owner-provider",
  vectorSpaceId: "synthetic-owner-space-v1",
};

const people = [
  { personId: "person_owner_pack_a", vector: [1, 0] },
  { personId: "person_owner_pack_b", vector: [0, 1] },
  { personId: "person_owner_pack_unknown", vector: [-1, 0] },
  ...Array.from({ length: 100 }, (_, index) => ({
    personId: `person_owner_pack_unknown_${String(index).padStart(3, "0")}`,
    vector: [-1, 0],
  })),
];
const acceptedEvidence = [
  { personIndex: 0, year: 2020 },
  { personIndex: 1, year: 2020 },
  { personIndex: 0, year: 2021 },
  { personIndex: 1, year: 2021 },
  { personIndex: 2, year: 2021 },
  { personIndex: 0, year: 2022 },
  { personIndex: 1, year: 2022 },
  { personIndex: 2, year: 2022 },
  ...Array.from({ length: 100 }, (_, index) => ({
    personIndex: index + 3,
    year: 2022,
  })),
];

try {
  await sql`
    INSERT INTO producer_receipt (
      producer_receipt_id, producer_kind, producer_name, producer_version,
      started_at, completed_at, privacy_class
    ) VALUES (
      'receipt_owner_source_pack_fixture', 'trusted_import',
      'owner-source-pack-fixture', 'v1', now(), now(), 'private'
    )
  `;
  for (const [personIndex, person] of people.entries()) {
    await sql`
      INSERT INTO person (
        person_id, display_name, status, created_by_receipt_id
      ) VALUES (
        ${person.personId}, ${`Synthetic Owner ${personIndex + 1}`}, 'active',
        'receipt_owner_source_pack_fixture'
      )
    `;
  }
  for (const [index, evidence] of acceptedEvidence.entries()) {
    const person = people[evidence.personIndex];
    const suffix = String(index + 1).padStart(2, "0");
    const assetId = `asset_owner_pack_${suffix}`;
    const faceId = `face_owner_pack_${suffix}`;
    const decisionId = `decision_owner_pack_${suffix}`;
    const claimId = `claim_owner_pack_${suffix}`;
    const embeddingId = `embedding_owner_pack_${suffix}`;
    await sql`
      INSERT INTO asset (
        asset_id, content_hash, locator_token, media_kind, mime_type, width,
        height, capture_time, source_snapshot_id, state
      ) VALUES (
        ${assetId}, ${`synthetic:owner-pack:${suffix}`},
        ${`locator_owner_pack_${suffix}`}, 'image', 'image/jpeg', 1200, 900,
        ${`${evidence.year}-06-01T00:00:00.000Z`},
        'snapshot_service_acceptance', 'active'
      )
    `;
    await sql`
      INSERT INTO face_observation (
        face_id, asset_id, box_x, box_y, box_w, box_h,
        detection_confidence, quality_measurements, state,
        producer_receipt_id
      ) VALUES (
        ${faceId}, ${assetId}, 0.2, 0.15, 0.3, 0.4, 0.99,
        '{"quality_score":0.99,"quality_bucket":"clean_core"}',
        'valid', 'receipt_owner_source_pack_fixture'
      )
    `;
    await sql`
      INSERT INTO decision (
        decision_id, subject_type, subject_id, action, actor_kind, actor_id,
        reason_code, producer_receipt_id
      ) VALUES (
        ${decisionId}, 'identity_claim', ${claimId}, 'accept', 'user',
        'synthetic-owner', 'inherited-owner-tag',
        'receipt_owner_source_pack_fixture'
      )
    `;
    await sql`
      INSERT INTO identity_claim (
        identity_claim_id, face_id, person_id, origin, state,
        calibrated_confidence, evidence_refs, decision_id,
        producer_receipt_id
      ) VALUES (
        ${claimId}, ${faceId}, ${person.personId}, 'user', 'accepted', 1,
        '["inherited-owner-tag"]', ${decisionId},
        'receipt_owner_source_pack_fixture'
      )
    `;
    await sql`
      INSERT INTO face_embedding (
        embedding_id, face_id, model_family, model_version, config_digest,
        dimension, normalized, embedding, vector_digest, state,
        producer_receipt_id, privacy_class
      ) VALUES (
        ${embeddingId}, ${faceId}, ${matchingProvider.modelFamily},
        ${matchingProvider.modelVersion}, ${matchingProvider.configDigest},
        2, true, ${`[${person.vector.join(",")}]`}::vector,
        ${recognitionVectorDigest(person.vector)}, 'active',
        'receipt_owner_source_pack_fixture', 'sensitive-biometric'
      )
    `;
  }

  const queryVector = [0.990148, 0.140028];
  await sql`
    INSERT INTO asset (
      asset_id, content_hash, locator_token, media_kind, mime_type, width,
      height, capture_time, source_snapshot_id, state
    ) VALUES (
      'asset_owner_pack_query', 'synthetic:owner-pack:query',
      'locator_owner_pack_query', 'image', 'image/jpeg', 1200, 900,
      '2023-06-01T00:00:00.000Z', 'snapshot_service_acceptance', 'active'
    )
  `;
  await sql`
    INSERT INTO face_observation (
      face_id, asset_id, box_x, box_y, box_w, box_h,
      detection_confidence, quality_measurements, state,
      producer_receipt_id
    ) VALUES (
      'face_owner_pack_query', 'asset_owner_pack_query', 0.2, 0.15, 0.3, 0.4,
      0.98, '{"quality_score":0.98,"quality_bucket":"clean_core"}',
      'valid', 'receipt_owner_source_pack_fixture'
    )
  `;
  await sql`
    INSERT INTO face_embedding (
      embedding_id, face_id, model_family, model_version, config_digest,
      dimension, normalized, embedding, vector_digest, state,
      producer_receipt_id, privacy_class
    ) VALUES (
      'embedding_owner_pack_query', 'face_owner_pack_query',
      ${matchingProvider.modelFamily}, ${matchingProvider.modelVersion},
      ${matchingProvider.configDigest}, 2, true,
      ${`[${queryVector.join(",")}]`}::vector,
      ${recognitionVectorDigest(queryVector)}, 'active',
      'receipt_owner_source_pack_fixture', 'sensitive-biometric'
    )
  `;

  const commands = new Map();
  const mediaOperator = {
    async execute(input) {
      const prior = commands.get(input.commandId);
      if (prior) return { ...prior, replayed: true };
      const result = {
        commandId: input.commandId,
        inventory: { admittedAssetCount: 9, state: "completed" },
        queueAfter: { failed: 0, paused: 0, pending: 0, processing: 0 },
        replayed: false,
        state: "completed",
        work: { detections: 1, inventoryPages: 1, recognitions: 1 },
      };
      commands.set(input.commandId, result);
      return result;
    },
  };
  const createOperator = (provider = matchingProvider) => {
    const repository = createCimmichRepository(sql, new Map(), null, {
      matchingProvider: provider,
    });
    return {
      operator: createFaceMatchingOperator({
        matchingProvider: provider,
        mediaOperator,
        providerReceipt: provider ? { state: "ready" } : null,
        repository,
        sql,
      }),
      repository,
    };
  };
  const { operator, repository } = createOperator();

  const initial = await operator.status();
  assert.equal(initial.state, "needs_source_pack");
  assert.equal(initial.next.action, "compile_source_pack");
  assert.equal(initial.evidence.providerEmbeddings, 108);

  const recognition = await operator.runRecognition({
    actorId: "synthetic-owner",
    commandId: "owner-source-pack-recognition-0001",
    workLimit: 1,
  });
  const recognitionReplay = await operator.runRecognition({
    actorId: "synthetic-owner",
    commandId: "owner-source-pack-recognition-0001",
    workLimit: 1,
  });
  assert.equal(recognition.replayed, false);
  assert.equal(recognitionReplay.replayed, true);
  assert.deepEqual(recognitionReplay.work, recognition.work);

  const compiled = await operator.compile();
  assert.equal(compiled.changed, true);
  assert.equal(compiled.pack.state, "proposed");
  assert.equal(compiled.plan.reviewability, "temporal_holdout_ready");
  assert.equal(compiled.plan.calibrationQueries, 2);
  assert.equal(compiled.plan.holdoutQueries, 2);
  const compileReplay = await operator.compile();
  assert.equal(compileReplay.pack.packId, compiled.pack.packId);
  assert.equal(compileReplay.replayed, true);

  const evaluated = await operator.evaluate({ packId: compiled.pack.packId });
  assert.equal(evaluated.evaluation.status, "incomplete");
  assert.equal(evaluated.evaluation.reason, "OPERATOR_REVIEW_GATE_REQUIRED");
  assert.equal(evaluated.evaluation.leakage.passed, true);
  assert.equal(evaluated.evaluation.reviewArtifact.verifiedUnknowns, 101);
  assert.equal(evaluated.evaluation.reviewGateReceipt.status, "passed");
  assert.equal(evaluated.evaluation.reviewGateReceiptNullReason, null);
  const evaluationReplay = await operator.evaluate({
    packId: compiled.pack.packId,
  });
  assert.equal(evaluationReplay.replayed, true);
  assert.equal(
    evaluationReplay.evaluation.evaluationId,
    evaluated.evaluation.evaluationId,
  );

  const gateReceipt = evaluated.evaluation.reviewGateReceipt;
  assert.deepEqual(evaluationReplay.evaluation.reviewGateReceipt, gateReceipt);
  await assert.rejects(
    () =>
      operator.recordReview({
        gateReceipt: {
          ...gateReceipt,
          thresholds: {
            ...gateReceipt.thresholds,
            minimumDecisionPrecisionPercent: 97,
          },
        },
        packId: compiled.pack.packId,
      }),
    (error) => error.code === "FACE_MATCHING_REVIEW_ARTIFACT_MISMATCH",
  );
  const reviewed = await operator.recordReview({
    gateReceipt,
    packId: compiled.pack.packId,
  });
  assert.equal(reviewed.changed, true);
  assert.equal(reviewed.disposition, "passed");
  const reviewReplay = await operator.recordReview({
    gateReceipt,
    packId: compiled.pack.packId,
  });
  assert.equal(reviewReplay.replayed, true);
  await assert.rejects(
    () =>
      operator.recordReview({
        gateReceipt: {
          ...gateReceipt,
          metrics: { ...gateReceipt.metrics, knownCorrectCoveragePercent: 99 },
        },
        packId: compiled.pack.packId,
      }),
    (error) => error.code === "FACE_MATCHING_REVIEW_ARTIFACT_MISMATCH",
  );

  const readyToActivate = await operator.status();
  assert.equal(readyToActivate.next.action, "activate_source_pack");
  const reviewedEvaluationId = reviewed.pack.evaluation.evaluationId;
  assert.notEqual(reviewedEvaluationId, evaluated.evaluation.evaluationId);
  const activated = await operator.activate({
    expectedCurrentPackId: null,
    expectedEvaluationId: reviewedEvaluationId,
    packId: compiled.pack.packId,
  });
  assert.equal(activated.activated, true);
  assert.equal(activated.pack.state, "active");
  const activationReplay = await operator.activate({
    expectedCurrentPackId: null,
    expectedEvaluationId: reviewedEvaluationId,
    packId: compiled.pack.packId,
  });
  assert.equal(activationReplay.replayed, true);
  assert.equal(activationReplay.changed, false);

  const suggestions = await repository.machineSuggestions({ limit: 12 });
  const suggestion = suggestions.find(
    (item) => item.face_id === "face_owner_pack_query",
  );
  assert.ok(suggestion);
  assert.equal(suggestion.candidates[0].person_id, people[0].personId);
  const [{ count: automaticClaims }] = await sql`
    SELECT count(*)::int AS count FROM identity_claim
    WHERE face_id = 'face_owner_pack_query'
  `;
  assert.equal(automaticClaims, 0);

  const restarted = createOperator();
  const restartedStatus = await restarted.operator.status();
  assert.equal(restartedStatus.state, "ready");
  assert.equal(restartedStatus.next.action, "review_suggestions");
  const restartedSuggestions = await restarted.repository.machineSuggestions({
    limit: 12,
  });
  assert.equal(
    restartedSuggestions.find(
      (item) => item.face_id === "face_owner_pack_query",
    ).candidates[0].person_id,
    people[0].personId,
  );

  const disabled = createOperator(null);
  const disabledStatus = await disabled.operator.status();
  assert.equal(disabledStatus.state, "provider_disabled");
  assert.equal(disabledStatus.evidence.acceptedFaces >= 108, true);
  assert.equal(disabledStatus.evidence.providerEmbeddings, 0);
  assert.equal(disabledStatus.latestPack, null);
  assert.equal(disabledStatus.basicIdentityTruthRetainedWhenDisabled, true);
  assert.deepEqual(
    await disabled.repository.machineSuggestions({ limit: 12 }),
    [],
  );
  const [{ claims, evaluations, packs, references }] = await sql`
    SELECT
      (SELECT count(*)::int FROM identity_claim
        WHERE identity_claim_id LIKE 'claim_owner_pack_%') AS claims,
      (SELECT count(*)::int FROM source_pack_evaluation evaluation
        JOIN source_pack pack ON pack.pack_id = evaluation.pack_id
        WHERE pack.config_digest = ${matchingProvider.configDigest}) AS evaluations,
      (SELECT count(*)::int FROM source_pack
        WHERE config_digest = ${matchingProvider.configDigest}) AS packs,
      (SELECT count(*)::int FROM source_pack_reference reference
        JOIN source_pack pack ON pack.pack_id = reference.pack_id
        WHERE pack.config_digest = ${matchingProvider.configDigest}) AS references
  `;
  assert.deepEqual(
    { claims, evaluations, packs },
    { claims: 108, evaluations: 2, packs: 1 },
  );
  assert.equal(references > 0, true);

  process.stdout.write(
    `${JSON.stringify({
      activation: "operator_reviewed_only",
      automaticIdentityClaimsCreated: automaticClaims,
      backupReadiness: "database_only_state",
      basicTruthRetainedWhenDisabled: true,
      evaluationReplayStable: true,
      inheritedAcceptedFaces: 108,
      projectedReviewGateReceipt: "server_derived",
      providerRecognitionReplayStable: true,
      representativeAccuracyClaim: "none",
      restartReadback: "ready",
      status: "PASS",
      suggestionAuthority: "human_review_only",
    })}\n`,
  );
} finally {
  await sql.end({ timeout: 5 });
}
