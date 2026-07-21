import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import postgres from "postgres";
import { createLocalExistingFaceRecognitionWorker } from "../src/local-existing-face-recognition-worker.mjs";
import {
  createCurrentImmichAssetReader,
  createOwnerFaceRecognitionScheduler,
} from "../src/owner-face-recognition.mjs";
import {
  recognitionObservationSchemaVersion,
  recognitionVectorDigest,
  validateRecognitionProviderManifest,
} from "../src/recognition-provider-contract.mjs";
import { recognitionManifestFixture } from "../test/fixtures/recognition-manifest.mjs";

const manifest = validateRecognitionProviderManifest(
  recognitionManifestFixture,
);

const sql = postgres(process.env.DATABASE_URL, { max: 3, prepare: true });
const digest = (value) => createHash("sha256").update(value).digest("hex");
const ids = {
  asset: "asset_owner_recognition_fixture",
  claim: "claim_owner_recognition_fixture",
  decision: "decision_owner_recognition_fixture",
  face: "face_owner_recognition_fixture",
  immichAsset: "immich_owner_recognition_fixture",
  inventoryRun: "immich_inventory_run_owner_recognition_fixture",
  person: "person_owner_recognition_fixture",
  producer: "receipt_owner_recognition_fixture",
  snapshot: "snapshot_owner_recognition_fixture",
  source: "owner-recognition-fixture",
};
const bytes = Buffer.from("synthetic inherited owner Face source bytes");
const companionRevision = digest("owner-recognition-companion-revision-v1");
const sourceContentDigest = digest(bytes);

try {
  await sql`
    INSERT INTO source_snapshot (
      snapshot_id, input_schema_version, source_digest, locator_root_token,
      started_at, completed_at, observed_asset_count, state, privacy_class
    ) VALUES (
      ${ids.snapshot}, 'synthetic.owner-recognition.v1',
      ${digest("owner-recognition-snapshot")}, 'owner-recognition-fixture',
      now(), now(), 1, 'complete', 'private'
    )
  `;
  await sql`
    INSERT INTO producer_receipt (
      producer_receipt_id, producer_kind, producer_name, producer_version,
      source_snapshot_id, started_at, completed_at, result_digest,
      privacy_class
    ) VALUES (
      ${ids.producer}, 'trusted_import', 'owner-recognition-fixture', 'v1',
      ${ids.snapshot}, now(), now(), ${digest("owner-recognition-result")},
      'private'
    )
  `;
  await sql`
    INSERT INTO asset (
      asset_id, content_hash, locator_token, media_kind, mime_type, width,
      height, capture_time, source_snapshot_id, state
    ) VALUES (
      ${ids.asset}, 'synthetic:owner-recognition',
      'owner_recognition_locator', 'image', 'image/jpeg', 1200, 800,
      '2024-04-01T00:00:00Z', ${ids.snapshot}, 'active'
    )
  `;
  await sql`
    INSERT INTO person (
      person_id, display_name, status, created_by_receipt_id
    ) VALUES (
      ${ids.person}, 'Synthetic Owner Recognition', 'active', ${ids.producer}
    )
  `;
  await sql`
    INSERT INTO face_observation (
      face_id, asset_id, box_x, box_y, box_w, box_h,
      detection_confidence, quality_measurements, state, producer_receipt_id
    ) VALUES (
      ${ids.face}, ${ids.asset}, 0.2, 0.15, 0.25, 0.35, 0.99,
      '{"quality_score":0.99,"quality_bucket":"clean_core"}',
      'valid', ${ids.producer}
    )
  `;
  await sql`
    INSERT INTO decision (
      decision_id, subject_type, subject_id, action, actor_kind, actor_id,
      reason_code, producer_receipt_id
    ) VALUES (
      ${ids.decision}, 'identity_claim', ${ids.claim}, 'accept', 'user',
      'synthetic-owner', 'inherited-owner-tag', ${ids.producer}
    )
  `;
  await sql`
    INSERT INTO identity_claim (
      identity_claim_id, face_id, person_id, origin, state,
      calibrated_confidence, evidence_refs, decision_id, producer_receipt_id
    ) VALUES (
      ${ids.claim}, ${ids.face}, ${ids.person}, 'trusted_import', 'accepted',
      NULL, '["inherited-owner-tag"]', ${ids.decision}, ${ids.producer}
    )
  `;
  await sql`
    INSERT INTO immich_inventory_source (
      source_id, principal_digest, companion_schema_version,
      immich_version, state
    ) VALUES (
      ${ids.source}, ${digest("owner-recognition-principal")},
      'cimmich.immich-companion.v1', 'synthetic', 'active'
    )
  `;
  await sql`
    INSERT INTO immich_inventory_run (
      run_id, source_id, snapshot_id, immich_version, principal_digest,
      state, observed_asset_count, page_count, started_at, completed_at
    ) VALUES (
      ${ids.inventoryRun}, ${ids.source}, ${ids.snapshot}, 'synthetic',
      ${digest("owner-recognition-principal")}, 'completed', 1, 1,
      now(), now()
    )
  `;
  await sql`
    UPDATE immich_inventory_source SET last_completed_run_id = ${ids.inventoryRun}
    WHERE source_id = ${ids.source}
  `;
  await sql`
    INSERT INTO immich_asset_projection (
      source_id, immich_asset_id, cimmich_asset_id, owner_digest,
      input_revision, checksum, asset_type, visibility, original_mime_type,
      capture_time, source_updated_at, width, height, state,
      first_seen_run_id, last_seen_run_id
    ) VALUES (
      ${ids.source}, ${ids.immichAsset}, ${ids.asset},
      ${digest("owner-recognition-owner")}, ${companionRevision},
      'synthetic-owner-recognition-checksum', 'image', 'timeline',
      'image/jpeg', '2024-04-01T00:00:00Z', '2024-04-01T00:00:00Z',
      1200, 800, 'active', ${ids.inventoryRun}, ${ids.inventoryRun}
    )
  `;

  const upstreamAsset = () => ({
    asset: {
      immichAssetId: ids.immichAsset,
      inputRevision: companionRevision,
    },
  });
  const companion = {
    async getAsset({ assetId }) {
      assert.equal(assetId, ids.immichAsset);
      return upstreamAsset();
    },
    async readAssetImage({ assetId }) {
      assert.equal(assetId, ids.immichAsset);
      return {
        ...upstreamAsset(),
        bytes,
        contentDigest: sourceContentDigest,
        sourceAccess: "immich-api-read-only",
      };
    },
  };
  const vector = [0.6, 0.8];
  let executionCount = 0;
  const recognizer = {
    async recognize({ assetId, observations }) {
      executionCount += 1;
      assert.equal(assetId, ids.asset);
      assert.deepEqual(
        observations.map((observation) => observation.observationId),
        [ids.face],
      );
      return observations.map((observation) => ({
        assetToken: assetId,
        cropDigest: digest("owner-recognition-crop"),
        observationId: observation.observationId,
        providerConfigDigest: manifest.providerConfigDigest,
        route: "synthetic-target-box",
        schemaVersion: recognitionObservationSchemaVersion,
        state: "embedded",
        vector,
        vectorDigest: recognitionVectorDigest(vector),
        vectorSpaceId: manifest.vectorSpaceId,
      }));
    },
  };
  const presentationRank = () => 0;
  const scheduler = createOwnerFaceRecognitionScheduler({
    companion,
    manifest,
    presentationRank,
    sourceId: ids.source,
    sql,
  });
  const reader = createCurrentImmichAssetReader({
    companion,
    sourceId: ids.source,
    sql,
  });
  const worker = createLocalExistingFaceRecognitionWorker({
    companion: reader,
    manifest,
    recognizer,
    sql,
    workerId: "owner-recognition-acceptance-worker",
  });

  const scheduled = await scheduler.enqueueNext();
  assert.equal(scheduled.state, "enqueued");
  const completed = await worker.runNext();
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.embeddings, { inserted: 1, reused: 0 });
  assert.equal(completed.providerExecutions, 2);
  assert.equal(completed.replayEvidence, "consistent");
  assert.equal(completed.sourceAccess, "immich_api_read_only");
  assert.equal(executionCount, 2);

  const [truth] = await sql`
    SELECT embedding.face_id, embedding.model_family, embedding.model_version,
      embedding.config_digest, embedding.vector_digest, embedding.state,
      receipt.producer_kind, pipeline.run_kind, pipeline.source_content_digest,
      pipeline.provider_run_count, pipeline.provider_result_digest,
      pipeline.state AS pipeline_state, claim.state AS claim_state,
      claim.person_id
    FROM face_embedding embedding
    JOIN producer_receipt receipt
      ON receipt.producer_receipt_id = embedding.producer_receipt_id
    JOIN media_pipeline_run pipeline
      ON pipeline.pipeline_run_id = ${completed.pipelineRunId}
    JOIN identity_claim claim ON claim.face_id = embedding.face_id
      AND claim.state = 'accepted'
    WHERE embedding.face_id = ${ids.face}
      AND embedding.model_family = ${manifest.recognitionSpace.modelFamily}
      AND embedding.model_version = ${manifest.recognitionSpace.modelVersion}
      AND embedding.config_digest = ${manifest.recognitionSpaceConfigDigest}
      AND embedding.state = 'active'
  `;
  assert.deepEqual(truth, {
    claim_state: "accepted",
    config_digest: manifest.recognitionSpaceConfigDigest,
    face_id: ids.face,
    model_family: manifest.recognitionSpace.modelFamily,
    model_version: manifest.recognitionSpace.modelVersion,
    person_id: ids.person,
    pipeline_state: "recognized",
    producer_kind: "model",
    provider_result_digest: truth.provider_result_digest,
    provider_run_count: 2,
    run_kind: "existing_observation_set",
    source_content_digest: sourceContentDigest,
    state: "active",
    vector_digest: recognitionVectorDigest(vector),
  });
  assert.match(truth.provider_result_digest, /^[0-9a-f]{64}$/);
  const idle = await scheduler.enqueueNext();
  assert.deepEqual(idle, {
    schemaVersion: "cimmich.owner-face-recognition.v1",
    state: "idle",
  });
  const [{ count: claims }] = await sql`
    SELECT count(*)::int AS count FROM identity_claim WHERE face_id = ${ids.face}
  `;
  assert.equal(claims, 1);

  process.stdout.write(
    `${JSON.stringify({
      acceptedIdentityRetained: true,
      automaticIdentityAuthority: "none",
      providerExecutions: executionCount,
      providerReplay: completed.replayEvidence,
      recognitionSource: "current_immich_projection",
      replayState: idle.state,
      schemaVersion: "cimmich.owner-face-recognition-acceptance.v1",
      status: "PASS",
    })}\n`,
  );
} finally {
  await sql.end({ timeout: 5 });
}
