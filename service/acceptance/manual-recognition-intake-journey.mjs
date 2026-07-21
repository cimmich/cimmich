import assert from "node:assert/strict";
import postgres from "postgres";
import {
  assembleManualRecognitionIntake,
  prepareManualRecognitionJob,
} from "../src/local-manual-face-recognition-worker.mjs";
import {
  manualRecognitionDigest,
  manualRecognitionQualityVersion,
} from "../src/manual-recognition-intake.mjs";
import { commitManualRecognitionJobResult } from "../src/manual-recognition-job-commit.mjs";
import { createMediaJobLedger } from "../src/media-job-ledger.mjs";
import {
  recognitionObservationSchemaVersion,
  recognitionVectorDigest,
} from "../src/recognition-provider-contract.mjs";
import { recognitionManifestFixture } from "../test/fixtures/recognition-manifest.mjs";
import { loadSourcePackFaces } from "../src/source-pack-repository.mjs";

const root = process.env.CIMMICH_ACCEPTANCE_URL || "http://127.0.0.1:3101";
const sql = postgres(process.env.DATABASE_URL, { max: 4 });
const digest = (character) => character.repeat(64);
const headers = {
  "content-type": "application/json",
  "x-cimmich-actor": "manual-recognition-acceptance",
};

try {
  const attachResponse = await fetch(
    `${root}/v1/assets/asset_service_fixture/manual-subject-tags`,
    {
      body: JSON.stringify({
        commandId: "manual.recognition.attach.0001",
        region: { h: 0.2, w: 0.16, x: 0.78, y: 0.02 },
        subjectId: "person_service_fixture",
        subjectKind: "person",
        tagType: "face",
      }),
      headers,
      method: "POST",
    },
  );
  const attached = await attachResponse.json();
  assert.equal(attachResponse.status, 200, JSON.stringify(attached));
  assert.equal(attached.tag.identityStatus, "accepted");
  assert.equal(attached.tag.matchingStatus, "waiting_for_provider");
  const [operation] = await sql`
    SELECT operation_id, tag_id AS identity_claim_id,
      observation_id AS face_id, asset_id
    FROM manual_subject_tag_operation
    WHERE decision_id = ${attached.tag.decision.decisionId}
  `;

  await sql`
    INSERT INTO source_snapshot (
      snapshot_id, input_schema_version, source_digest, locator_root_token,
      started_at, completed_at, observed_asset_count, state, privacy_class
    ) VALUES (
      'snapshot_manual_recognition_fixture', 'synthetic.manual-recognition.v1',
      ${digest("1")}, 'synthetic-manual-recognition', now(), now(), 1,
      'complete', 'private'
    ) ON CONFLICT (snapshot_id) DO NOTHING
  `;
  await sql`
    INSERT INTO immich_inventory_source (
      source_id, principal_digest, companion_schema_version,
      immich_version, state
    ) VALUES (
      'manual-recognition-fixture', ${digest("2")},
      'cimmich.immich-companion.v1', 'synthetic', 'active'
    ) ON CONFLICT (source_id) DO NOTHING
  `;
  await sql`
    INSERT INTO immich_inventory_run (
      run_id, source_id, snapshot_id, immich_version, principal_digest,
      state, observed_asset_count, page_count, started_at, completed_at
    ) VALUES (
      'immich_inventory_run_manual_recognition_fixture',
      'manual-recognition-fixture', 'snapshot_manual_recognition_fixture',
      'synthetic', ${digest("2")}, 'completed', 1, 1, now(), now()
    ) ON CONFLICT (run_id) DO NOTHING
  `;
  await sql`
    UPDATE immich_inventory_source
    SET last_completed_run_id = 'immich_inventory_run_manual_recognition_fixture'
    WHERE source_id = 'manual-recognition-fixture'
  `;
  await sql`
    INSERT INTO immich_asset_projection (
      source_id, immich_asset_id, cimmich_asset_id, owner_digest,
      input_revision, checksum, asset_type, visibility, original_mime_type,
      capture_time, source_updated_at, width, height, state,
      first_seen_run_id, last_seen_run_id
    ) VALUES (
      'manual-recognition-fixture', 'immich_manual_recognition_fixture',
      ${operation.asset_id}, ${digest("3")}, ${digest("4")},
      'synthetic-checksum', 'image', 'timeline', 'image/jpeg',
      '2020-02-01T00:00:00Z', '2020-02-01T00:00:00Z', 1000, 800,
      'active', 'immich_inventory_run_manual_recognition_fixture',
      'immich_inventory_run_manual_recognition_fixture'
    )
  `;

  const prepared = prepareManualRecognitionJob({
    manifest: recognitionManifestFixture,
    operation: {
      assetId: operation.asset_id,
      faceId: operation.face_id,
      identityClaimId: operation.identity_claim_id,
      operationId: operation.operation_id,
      region: { h: 0.2, w: 0.16, x: 0.78, y: 0.02 },
    },
    projection: {
      assetId: operation.asset_id,
      immichAssetId: "immich_manual_recognition_fixture",
      inputRevision: digest("4"),
      sourceId: "manual-recognition-fixture",
    },
  });
  const ledger = createMediaJobLedger(sql);
  const enqueued = await ledger.enqueue(prepared.job);
  const claimed = await ledger.claim({
    batchSize: 100,
    leaseSeconds: 300,
    workerId: "manual-recognition-synthetic-worker",
  });
  assert.equal(
    claimed.some((job) => job.jobId === enqueued.jobId),
    true,
  );

  const vector = [0.6, 0.8];
  const observation = {
    assetToken: operation.asset_id,
    cropDigest: digest("5"),
    observationId: operation.face_id,
    providerConfigDigest: recognitionManifestFixture.providerConfigDigest,
    route: "manual-target-alignment",
    schemaVersion: recognitionObservationSchemaVersion,
    state: "embedded",
    vector,
    vectorDigest: recognitionVectorDigest(vector),
    vectorSpaceId: recognitionManifestFixture.vectorSpaceId,
  };
  const policy = {
    allowLowQuality: false,
    lowQualityThreshold: 0.5,
    policyVersion: "manual-quality-v1",
    usableThreshold: 0.7,
  };
  const envelope = assembleManualRecognitionIntake({
    prepared,
    quality: {
      ...policy,
      measurementDigest: digest("6"),
      policyDigest: manualRecognitionDigest(policy),
      schemaVersion: manualRecognitionQualityVersion,
      score: 0.82,
    },
    runs: [
      { observation, runId: "manualrun_acceptance_0001" },
      { observation, runId: "manualrun_acceptance_0002" },
    ],
    sourceContentDigest: digest("7"),
  });
  const beforeCommit = Number(
    (
      await sql`
        SELECT count(*)::int AS count FROM source_pack_rebuild_request
        WHERE reason_code = 'manual_face_recognition_eligible'
      `
    )[0].count,
  );
  const committed = await commitManualRecognitionJobResult(sql, {
    envelope,
    jobId: enqueued.jobId,
    workerId: "manual-recognition-synthetic-worker",
  });
  assert.equal(committed.replayed, false);
  assert.equal(committed.identityStatus, "accepted");
  assert.equal(committed.evidenceTier, "secondary");
  assert.equal(committed.primeAuthority, "none");
  const replay = await commitManualRecognitionJobResult(sql, {
    envelope,
    jobId: enqueued.jobId,
    workerId: "manual-recognition-synthetic-worker",
  });
  assert.deepEqual(
    { ...replay, changed: undefined, replayed: undefined },
    { ...committed, changed: undefined, replayed: undefined },
  );
  assert.equal(replay.replayed, true);
  assert.equal(replay.changed, false);

  const [truth] = await sql`
    SELECT claim.state AS claim_state, face.observation_origin,
      face.detection_confidence, lifecycle.state,
      evidence.replay_evidence, evidence.provider_execution_proof,
      quality.evidence_tier, rebuild.state AS rebuild_state
    FROM manual_face_recognition_evidence evidence
    JOIN manual_face_recognition_quality quality
      ON quality.quality_id = evidence.quality_id
    JOIN current_manual_face_matching_lifecycle lifecycle
      ON lifecycle.recognition_evidence_id = evidence.evidence_id
    JOIN identity_claim claim
      ON claim.identity_claim_id = lifecycle.identity_claim_id
    JOIN face_observation face ON face.face_id = lifecycle.face_id
    JOIN source_pack_rebuild_request rebuild
      ON rebuild.rebuild_request_id = evidence.rebuild_request_id
    WHERE evidence.evidence_id = ${committed.evidenceId}
  `;
  assert.deepEqual(truth, {
    claim_state: "accepted",
    detection_confidence: null,
    evidence_tier: "secondary",
    observation_origin: "manual_user",
    provider_execution_proof: "none",
    rebuild_state: "pending",
    replay_evidence: "consistent",
    state: "eligible_for_evaluation",
  });
  assert.equal(
    Number(
      (
        await sql`
          SELECT count(*)::int AS count FROM source_pack_rebuild_request
          WHERE reason_code = 'manual_face_recognition_eligible'
        `
      )[0].count,
    ),
    beforeCommit + 1,
  );
  const faces = await loadSourcePackFaces(sql, {
    configDigest: recognitionManifestFixture.providerConfigDigest,
    modelFamily: recognitionManifestFixture.recognizer.model,
    modelVersion: recognitionManifestFixture.recognizer.modelVersion,
    personId: "person_service_fixture",
  });
  const admitted = faces.find((face) => face.faceId === operation.face_id);
  assert.equal(admitted.blockedPrime, true);
  assert.equal(admitted.pinnedPrime, false);
  assert.equal(admitted.quality, 0.82);
  assert.equal(admitted.sourceTierHint, "secondary");
} finally {
  await sql.end();
}
