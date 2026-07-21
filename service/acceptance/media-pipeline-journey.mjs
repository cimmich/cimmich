import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import postgres from "postgres";
import { faceDetectorManifestFixture as detectorManifest } from "../test/fixtures/face-detector-manifest.mjs";
import { recognitionManifestFixture as baseRecognitionManifest } from "../test/fixtures/recognition-manifest.mjs";
import {
  deriveProviderConfigDigest,
  deriveVectorSpaceId,
  recognitionObservationSchemaVersion,
  recognitionVectorDigest,
} from "../src/recognition-provider-contract.mjs";
import { createMediaPipelineManifest } from "../src/media-pipeline-contract.mjs";
import { continueFaceDetectionPipeline } from "../src/media-pipeline.mjs";
import { createLocalFaceRecognitionWorker } from "../src/local-face-recognition-worker.mjs";
import { compileAndPersistSourcePack } from "../src/source-pack-repository.mjs";
import {
  activateSourcePack,
  persistSourcePackGateReceipt,
  sourcePackGateSchemaVersion,
} from "../src/source-pack-lifecycle.mjs";

const { createCimmichRepository } = await import("../src/repository.mjs");

const recognitionManifest = structuredClone(baseRecognitionManifest);
recognitionManifest.recognizer.modelVersion = "cimmich-target-centric-v2";
recognitionManifest.vectorSpaceId = deriveVectorSpaceId(recognitionManifest);
recognitionManifest.providerConfigDigest =
  deriveProviderConfigDigest(recognitionManifest);
const pipelineManifest = createMediaPipelineManifest({
  detectorManifest,
  recognitionManifest,
  recognitionToolVersion: "synthetic-fresh-photo-recognizer-v1",
});
const matchingProvider = {
  configDigest: recognitionManifest.providerConfigDigest,
  modelFamily: recognitionManifest.recognizer.model,
  modelVersion: recognitionManifest.recognizer.modelVersion,
  providerId: recognitionManifest.provider.name,
  vectorSpaceId: recognitionManifest.vectorSpaceId,
};

const databaseUrl =
  process.env.DATABASE_URL || "postgres://cimmich@postgres:5432/cimmich";
const sql = postgres(databaseUrl, { max: 2, prepare: true });
let interruptNext = true;

try {
  const compileActivateSyntheticPack = async ({
    predecessorPackId = null,
  } = {}) => {
    const { pack } = await compileAndPersistSourcePack(
      sql,
      {
        configDigest: matchingProvider.configDigest,
        cutoff: "2099-01-01T00:00:00.000Z",
        modelFamily: matchingProvider.modelFamily,
        modelVersion: matchingProvider.modelVersion,
        predecessorPackId,
      },
      { execute: true },
    );
    await persistSourcePackGateReceipt(
      sql,
      {
        authorityScope: "human-review",
        cohortDigest: createHash("sha256")
          .update(`synthetic-gate:${pack.packDigest}`)
          .digest("hex"),
        leakage: { passed: true, queryReferenceOverlap: 0 },
        metrics: {
          decisionPrecisionPercent: 100,
          knownCorrectCoveragePercent: 100,
          unknownFalseAcceptRatePercent: 0,
          verifiedUnknowns: 1,
        },
        matcherPolicy: {
          marginFloor: 0,
          policyVersion: "cimmich-best-prime-v1",
          scoreFloor: 0,
          scorer: "best_individual_prime",
        },
        packId: pack.packId,
        schemaVersion: sourcePackGateSchemaVersion,
        split: { kind: "synthetic-disposable-fixture" },
        status: "passed",
        thresholds: {
          maximumUnknownFalseAcceptRatePercent: 0,
          minimumDecisionPrecisionPercent: 100,
          minimumVerifiedUnknowns: 1,
        },
      },
      { execute: true },
    );
    await activateSourcePack(sql, pack.packId, { execute: true });
    return pack;
  };
  const [detection] = await sql`
    SELECT job.job_id, job.asset_id, projection.immich_asset_id,
      job.input_revision, result.source_content_digest,
      result_observation.face_id
    FROM media_job job
    JOIN media_job_detection_result link ON link.job_id = job.job_id
    JOIN face_detection_result result ON result.detection_result_id = link.detection_result_id
    JOIN face_detection_result_observation result_observation
      ON result_observation.detection_result_id = result.detection_result_id
    JOIN immich_asset_projection projection
      ON projection.cimmich_asset_id = job.asset_id AND projection.state = 'active'
    WHERE job.operation = 'detect_faces' AND job.state = 'completed'
      AND result.outcome = 'faces_detected'
    ORDER BY job.requested_at
    LIMIT 1
  `;
  assert.ok(detection);
  const continued = await continueFaceDetectionPipeline(sql, {
    detectionJobId: detection.job_id,
    detectorManifest,
    manifest: pipelineManifest,
    recognitionManifest,
  });
  assert.equal(continued.state, "recognition_pending");
  assert.ok(continued.recognitionJobId);
  const replay = await continueFaceDetectionPipeline(sql, {
    detectionJobId: detection.job_id,
    detectorManifest,
    manifest: pipelineManifest,
    recognitionManifest,
  });
  assert.equal(replay.pipelineRunId, continued.pipelineRunId);
  assert.equal(replay.recognitionJobId, continued.recognitionJobId);
  const [noFaceDetection] = await sql`
    SELECT job.job_id
    FROM media_job job
    JOIN media_job_detection_result link ON link.job_id = job.job_id
    JOIN face_detection_result result ON result.detection_result_id = link.detection_result_id
    WHERE job.operation = 'detect_faces' AND job.state = 'completed'
      AND result.outcome = 'no_face'
    ORDER BY job.requested_at
    LIMIT 1
  `;
  const noFaceRun = await continueFaceDetectionPipeline(sql, {
    detectionJobId: noFaceDetection.job_id,
    detectorManifest,
    manifest: pipelineManifest,
    recognitionManifest,
  });
  assert.equal(noFaceRun.state, "no_face");
  assert.equal(noFaceRun.recognitionJobId, null);

  const referenceVector = [1, 0];
  const reviewedVector = [0.8660254, 0.5];
  const competitorVector = [0.3420201, 0.9396926];
  const secondQueryVector = [0.7431448, 0.6691306];

  await sql`
    INSERT INTO person (
      person_id, display_name, status, created_by_receipt_id
    ) VALUES
      (
        'person_pipeline_reference', 'Synthetic Pipeline Reference',
        'active', 'receipt_service_fixture'
      ),
      (
        'person_pipeline_competitor', 'Synthetic Pipeline Competitor',
        'active', 'receipt_service_fixture'
      )
  `;
  await sql`
    INSERT INTO asset (
      asset_id, content_hash, locator_token, media_kind, mime_type, width, height,
      capture_time, source_snapshot_id, state
    ) VALUES
      (
        'asset_pipeline_competitor_reference', 'synthetic:pipeline-competitor-reference',
        'locator_pipeline_competitor_reference', 'image', 'image/jpeg', 1000, 800,
        '2026-01-02T00:00:00Z', 'snapshot_service_acceptance', 'active'
      ),
      (
        'asset_pipeline_second_query', 'synthetic:pipeline-second-query',
        'locator_pipeline_second_query', 'image', 'image/jpeg', 1200, 800,
        '2026-01-03T00:00:00Z', 'snapshot_service_acceptance', 'active'
      )
  `;
  await sql`
    INSERT INTO face_observation (
      face_id, asset_id, box_x, box_y, box_w, box_h,
      detection_confidence, quality_measurements, state, producer_receipt_id
    ) VALUES
      (
        'face_pipeline_reference', 'asset_service_fixture',
        0.1, 0.1, 0.2, 0.2, 0.99,
        '{"quality_score":0.99,"quality_bucket":"clean_core"}',
        'valid', 'receipt_service_fixture'
      ),
      (
        'face_pipeline_competitor_reference', 'asset_pipeline_competitor_reference',
        0.2, 0.1, 0.3, 0.4, 0.98,
        '{"quality_score":0.98,"quality_bucket":"clean_core"}',
        'valid', 'receipt_service_fixture'
      ),
      (
        'face_pipeline_second_query', 'asset_pipeline_second_query',
        0.25, 0.15, 0.3, 0.45, 0.96,
        '{"quality_score":0.96,"quality_bucket":"clean_core"}',
        'valid', 'receipt_service_fixture'
      )
  `;
  await sql`
    INSERT INTO reference_bucket (
      bucket_id, person_id, bucket_kind, created_by, policy_version,
      state, producer_receipt_id
    ) VALUES
      (
        'bucket_pipeline_reference_prime', 'person_pipeline_reference',
        'prime', 'system', 'synthetic-pipeline-reference-v1',
        'active', 'receipt_service_fixture'
      ),
      (
        'bucket_pipeline_competitor_prime', 'person_pipeline_competitor',
        'prime', 'system', 'synthetic-pipeline-reference-v1',
        'active', 'receipt_service_fixture'
      )
  `;
  await sql`
    INSERT INTO decision (
      decision_id, subject_type, subject_id, action, actor_kind, actor_id,
      reason_code, producer_receipt_id
    ) VALUES
      (
        'decision_pipeline_reference_identity', 'identity_claim',
        'claim_pipeline_reference_identity', 'accept', 'user',
        'synthetic-acceptance', 'synthetic-reference-truth',
        'receipt_service_fixture'
      ),
      (
        'decision_pipeline_competitor_identity', 'identity_claim',
        'claim_pipeline_competitor_identity', 'accept', 'user',
        'synthetic-acceptance', 'synthetic-reference-truth',
        'receipt_service_fixture'
      )
  `;
  await sql`
    INSERT INTO identity_claim (
      identity_claim_id, face_id, person_id, origin, state,
      calibrated_confidence, evidence_refs, decision_id, producer_receipt_id
    ) VALUES
      (
        'claim_pipeline_reference_identity', 'face_pipeline_reference',
        'person_pipeline_reference', 'user', 'accepted', 1,
        '["synthetic-reference-truth"]', 'decision_pipeline_reference_identity',
        'receipt_service_fixture'
      ),
      (
        'claim_pipeline_competitor_identity', 'face_pipeline_competitor_reference',
        'person_pipeline_competitor', 'user', 'accepted', 1,
        '["synthetic-reference-truth"]', 'decision_pipeline_competitor_identity',
        'receipt_service_fixture'
      )
  `;
  await sql`
    INSERT INTO bucket_membership_event (
      membership_event_id, bucket_id, face_id, action, actor_kind,
      reason_code, policy_version, producer_receipt_id
    ) VALUES
      (
        'membership_pipeline_reference_prime', 'bucket_pipeline_reference_prime',
        'face_pipeline_reference', 'activate', 'policy',
        'synthetic-pipeline-reference', 'synthetic-pipeline-reference-v1',
        'receipt_service_fixture'
      ),
      (
        'membership_pipeline_competitor_prime', 'bucket_pipeline_competitor_prime',
        'face_pipeline_competitor_reference', 'activate', 'policy',
        'synthetic-pipeline-reference', 'synthetic-pipeline-reference-v1',
        'receipt_service_fixture'
      )
  `;
  await sql`
    INSERT INTO face_embedding (
      embedding_id, face_id, model_family, model_version, config_digest,
      dimension, normalized, embedding, vector_digest, state,
      producer_receipt_id, privacy_class
    ) VALUES
      (
        'embedding_pipeline_reference_fixture', 'face_pipeline_reference',
        ${recognitionManifest.recognizer.model},
        ${recognitionManifest.recognizer.modelVersion},
        ${recognitionManifest.providerConfigDigest}, 2, true,
        ${`[${referenceVector.join(",")}]`}::vector,
        ${recognitionVectorDigest(referenceVector)},
        'active', 'receipt_service_fixture', 'sensitive-biometric'
      ),
      (
        'embedding_pipeline_competitor_fixture', 'face_pipeline_competitor_reference',
        ${recognitionManifest.recognizer.model},
        ${recognitionManifest.recognizer.modelVersion},
        ${recognitionManifest.providerConfigDigest}, 2, true,
        ${`[${competitorVector.join(",")}]`}::vector,
        ${recognitionVectorDigest(competitorVector)},
        'active', 'receipt_service_fixture', 'sensitive-biometric'
      ),
      (
        'embedding_pipeline_second_query_fixture', 'face_pipeline_second_query',
        ${recognitionManifest.recognizer.model},
        ${recognitionManifest.recognizer.modelVersion},
        ${recognitionManifest.providerConfigDigest}, 2, true,
        ${`[${secondQueryVector.join(",")}]`}::vector,
        ${recognitionVectorDigest(secondQueryVector)},
        'active', 'receipt_service_fixture', 'sensitive-biometric'
      )
  `;

  const bytes = Buffer.from(`synthetic-image:${detection.immich_asset_id}`);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    detection.source_content_digest,
  );
  const companion = {
    async readAssetImage({ assetId }) {
      assert.equal(assetId, detection.immich_asset_id);
      return {
        asset: {
          immichAssetId: assetId,
          inputRevision: detection.input_revision,
        },
        byteLength: bytes.length,
        bytes,
        contentDigest: detection.source_content_digest,
        mimeType: "image/jpeg",
        sourceAccess: "immich-api-read-only",
      };
    },
  };
  const recognizer = {
    async recognize({ assetId, observations }) {
      if (interruptNext) {
        interruptNext = false;
        throw new Error("synthetic recognition interruption");
      }
      assert.equal(assetId, detection.asset_id);
      assert.deepEqual(
        observations.map((row) => row.observationId),
        [detection.face_id],
      );
      return observations.map((observation) => ({
        assetToken: assetId,
        cropDigest: "c".repeat(64),
        observationId: observation.observationId,
        providerConfigDigest: recognitionManifest.providerConfigDigest,
        route: "synthetic-target-box",
        schemaVersion: recognitionObservationSchemaVersion,
        state: "embedded",
        vector: reviewedVector,
        vectorDigest: recognitionVectorDigest(reviewedVector),
        vectorSpaceId: recognitionManifest.vectorSpaceId,
      }));
    },
  };
  const worker = createLocalFaceRecognitionWorker({
    companion,
    manifest: recognitionManifest,
    recognizer,
    sql,
    workerId: "synthetic-pipeline-recognizer",
  });
  const interrupted = await worker.runNext();
  assert.equal(interrupted.state, "pending");
  assert.equal(interrupted.errorCode, "LOCAL_FACE_RECOGNITION_FAILED");
  const completed = await worker.runNext();
  assert.equal(completed.status, "completed");
  assert.equal(completed.pipelineRunId, continued.pipelineRunId);
  assert.deepEqual(completed.embeddings, { inserted: 1, reused: 0 });

  const [run] = await sql`
    SELECT state, recognized_at FROM media_pipeline_run
    WHERE pipeline_run_id = ${continued.pipelineRunId}
  `;
  assert.equal(run.state, "recognized");
  assert.ok(run.recognized_at);
  const initialPack = await compileActivateSyntheticPack();
  const repository = createCimmichRepository(sql, new Map(), null, {
    matchingProvider,
  });
  const suggestions = await repository.machineSuggestions({ limit: 80 });
  const suggestion = suggestions.find(
    (item) => item.face_id === detection.face_id,
  );
  assert.ok(suggestion);
  assert.equal(suggestion.candidates[0].person_id, "person_pipeline_reference");
  const secondSuggestionBefore = suggestions.find(
    (item) => item.face_id === "face_pipeline_second_query",
  );
  assert.ok(secondSuggestionBefore);
  assert.equal(
    secondSuggestionBefore.candidates[0].person_id,
    "person_pipeline_competitor",
  );
  const [{ count: claims }] = await sql`
    SELECT count(*)::int AS count FROM identity_claim WHERE face_id = ${detection.face_id}
  `;
  assert.equal(claims, 0);

  const unknown = await repository.dismissMachineSuggestion({
    actorId: "synthetic-reviewer",
    faceId: detection.face_id,
  });
  assert.equal(unknown.changed, true);
  assert.equal(unknown.state, "ignored");
  const unknownReplay = await repository.dismissMachineSuggestion({
    actorId: "synthetic-reviewer",
    faceId: detection.face_id,
  });
  assert.equal(unknownReplay.changed, false);
  assert.equal(unknownReplay.decisionId, unknown.decisionId);
  assert.equal(
    (await repository.machineSuggestions({ limit: 80 })).some(
      (item) => item.face_id === detection.face_id,
    ),
    false,
  );

  const restored = await repository.restoreMachineSuggestion({
    actorId: "synthetic-reviewer",
    faceId: detection.face_id,
  });
  assert.equal(restored.changed, true);
  assert.equal(restored.state, "active");
  const restoreReplay = await repository.restoreMachineSuggestion({
    actorId: "synthetic-reviewer",
    faceId: detection.face_id,
  });
  assert.equal(restoreReplay.changed, false);
  assert.equal(restoreReplay.decisionId, restored.decisionId);
  assert.equal(
    (await repository.machineSuggestions({ limit: 80 })).some(
      (item) => item.face_id === detection.face_id,
    ),
    true,
  );

  const accepted = await repository.reassignFaceIdentity({
    actorId: "synthetic-reviewer",
    faceId: detection.face_id,
    personId: "person_pipeline_reference",
  });
  assert.equal(accepted.changed, true);
  assert.equal(accepted.state, "accepted");
  const acceptReplay = await repository.reassignFaceIdentity({
    actorId: "synthetic-reviewer",
    faceId: detection.face_id,
    personId: "person_pipeline_reference",
  });
  assert.equal(acceptReplay.changed, false);
  assert.equal(acceptReplay.claimId, accepted.claimId);
  const suggestionsAfterIdentityAccept = await repository.machineSuggestions({
    limit: 80,
  });
  assert.equal(
    suggestionsAfterIdentityAccept.find(
      (item) => item.face_id === "face_pipeline_second_query",
    ).candidates[0].person_id,
    "person_pipeline_competitor",
  );
  const promoted = await repository.setFaceBucket({
    actorId: "synthetic-reviewer",
    bucketKind: "prime",
    faceId: detection.face_id,
    personId: "person_pipeline_reference",
  });
  assert.equal(promoted.changed, true);
  assert.equal(promoted.maintenancePending, false);
  const promoteReplay = await repository.setFaceBucket({
    actorId: "synthetic-reviewer",
    bucketKind: "prime",
    faceId: detection.face_id,
    personId: "person_pipeline_reference",
  });
  assert.equal(promoteReplay.changed, false);
  const successorPack = await compileActivateSyntheticPack({
    predecessorPackId: initialPack.packId,
  });
  assert.notEqual(successorPack.packId, initialPack.packId);
  const suggestionsAfterAccept = await repository.machineSuggestions({
    limit: 80,
  });
  assert.equal(
    suggestionsAfterAccept.some((item) => item.face_id === detection.face_id),
    false,
  );
  const secondSuggestionAfter = suggestionsAfterAccept.find(
    (item) => item.face_id === "face_pipeline_second_query",
  );
  assert.ok(secondSuggestionAfter);
  assert.equal(
    secondSuggestionAfter.candidates[0].person_id,
    "person_pipeline_reference",
  );
  assert.ok(
    secondSuggestionAfter.candidates[0].prime_score >
      secondSuggestionBefore.candidates[0].prime_score,
  );
  const improvedDismissed = await repository.dismissMachineSuggestion({
    actorId: "synthetic-reviewer",
    faceId: "face_pipeline_second_query",
  });
  const improvedDismissReplay = await repository.dismissMachineSuggestion({
    actorId: "synthetic-reviewer",
    faceId: "face_pipeline_second_query",
  });
  assert.equal(improvedDismissReplay.decisionId, improvedDismissed.decisionId);
  assert.equal(
    (await repository.machineSuggestions({ limit: 80 })).some(
      (item) => item.face_id === "face_pipeline_second_query",
    ),
    false,
  );
  const improvedRestored = await repository.restoreMachineSuggestion({
    actorId: "synthetic-reviewer",
    faceId: "face_pipeline_second_query",
  });
  const improvedRestoreReplay = await repository.restoreMachineSuggestion({
    actorId: "synthetic-reviewer",
    faceId: "face_pipeline_second_query",
  });
  assert.equal(improvedRestoreReplay.decisionId, improvedRestored.decisionId);
  assert.equal(
    (await repository.machineSuggestions({ limit: 80 })).find(
      (item) => item.face_id === "face_pipeline_second_query",
    ).candidates[0].person_id,
    "person_pipeline_reference",
  );
  const [reviewedGalleryEvidence] = await sql`
    SELECT membership_state
    FROM current_reference_gallery
    WHERE person_id = 'person_pipeline_reference'
      AND face_id = ${detection.face_id}
      AND bucket_kind = 'prime'
  `;
  assert.equal(reviewedGalleryEvidence?.membership_state, "active");
  const [acceptedClaim] = await sql`
    SELECT origin, person_id, state
    FROM identity_claim
    WHERE face_id = ${detection.face_id} AND state = 'accepted'
  `;
  assert.deepEqual(
    { ...acceptedClaim },
    {
      origin: "user",
      person_id: "person_pipeline_reference",
      state: "accepted",
    },
  );
  const [{ count: leaked }] = await sql`
    SELECT count(*)::int AS count FROM media_job
    WHERE checkpoint_payload::text LIKE ${`%synthetic-image:${detection.immich_asset_id}%`}
  `;
  assert.equal(leaked, 0);
  const idle = await worker.runNext();
  assert.equal(idle.state, "idle");

  process.stdout.write(
    `${JSON.stringify({
      candidatePersonId: suggestion.candidates[0].person_id,
      automaticIdentityClaimsCreated: claims,
      humanAcceptReplayStable: acceptReplay.claimId === accepted.claimId,
      humanIdentityClaimsCreated: 1,
      humanPrimePromotionReplayStable: promoteReplay.changed === false,
      improvedSuggestionUndoReplayStable:
        improvedDismissReplay.decisionId === improvedDismissed.decisionId &&
        improvedRestoreReplay.decisionId === improvedRestored.decisionId,
      interruptionRecovered: true,
      noFaceRecognitionJobs: 0,
      secondPhotoCandidateAfter: secondSuggestionAfter.candidates[0].person_id,
      secondPhotoCandidateBefore:
        secondSuggestionBefore.candidates[0].person_id,
      secondPhotoImprovedAfterReview: true,
      unknownRestoreReplayStable:
        unknownReplay.decisionId === unknown.decisionId &&
        restoreReplay.decisionId === restored.decisionId,
      pipelineRunId: continued.pipelineRunId,
      sourceBytesLeaked: leaked,
      status: "PASS",
    })}\n`,
  );
} finally {
  await sql.end({ timeout: 5 });
}
