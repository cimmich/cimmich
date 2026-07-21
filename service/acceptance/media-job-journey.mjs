import assert from "node:assert/strict";
import postgres from "postgres";
import { createMediaJobLedger } from "../src/media-job-ledger.mjs";
import {
  mergeRecognitionCheckpoint,
  recognitionObservationSchemaVersion,
  recognitionVectorDigest,
} from "../src/recognition-provider-contract.mjs";
import { commitRecognitionJobResult } from "../src/recognition-job-commit.mjs";
import { recognitionManifestFixture as manifest } from "../test/fixtures/recognition-manifest.mjs";

const databaseUrl =
  process.env.DATABASE_URL || "postgres://cimmich@postgres:5432/cimmich";
const sql = postgres(databaseUrl, { max: 2, prepare: true });
try {
  const ledger = createMediaJobLedger(sql);
  const queued = await ledger.enqueue({
    assetId: "asset_service_fixture",
    configDigest: manifest.providerConfigDigest,
    inputRevision: "f".repeat(64),
    operation: "recognize_faces",
    toolVersion: "synthetic-local-provider-v1",
  });
  const [claimed] = await ledger.claim({
    batchSize: 1,
    leaseSeconds: 300,
    workerId: "synthetic-recognition-worker",
  });
  assert.equal(claimed.jobId, queued.jobId);

  const vector = [0.6, 0.8];
  const { checkpoint } = mergeRecognitionCheckpoint(manifest, [
    {
      assetToken: "asset_service_fixture",
      cropDigest: "c".repeat(64),
      observationId: "face_service_fixture",
      providerConfigDigest: manifest.providerConfigDigest,
      route: "tight-target",
      schemaVersion: recognitionObservationSchemaVersion,
      state: "embedded",
      vector,
      vectorDigest: recognitionVectorDigest(vector),
      vectorSpaceId: manifest.vectorSpaceId,
    },
  ]);
  const committed = await commitRecognitionJobResult(sql, {
    checkpoint,
    jobId: queued.jobId,
    manifest,
    workerId: "synthetic-recognition-worker",
  });
  assert.equal(committed.status, "completed");
  assert.deepEqual(committed.embeddings, { inserted: 1, reused: 0 });
  assert.equal(committed.activationAuthority, "none");

  const replay = await ledger.enqueue({
    assetId: "asset_service_fixture",
    configDigest: manifest.providerConfigDigest,
    inputRevision: "f".repeat(64),
    operation: "recognize_faces",
    toolVersion: "synthetic-local-provider-v1",
  });
  assert.equal(replay.jobId, queued.jobId);
  assert.equal(replay.state, "completed");
  const [embedding] = await sql`
    SELECT vector_digest FROM face_embedding
    WHERE face_id = 'face_service_fixture'
      AND model_family = ${manifest.recognizer.model}
      AND model_version = ${manifest.recognizer.modelVersion}
      AND config_digest = ${manifest.providerConfigDigest}
      AND state = 'active'
  `;
  assert.equal(embedding.vector_digest, recognitionVectorDigest(vector));
  process.stdout.write(
    `${JSON.stringify({
      embeddings: committed.embeddings,
      jobId: queued.jobId,
      replayState: replay.state,
      schemaVersion: committed.schemaVersion,
      status: "PASS",
    })}\n`,
  );
} finally {
  await sql.end({ timeout: 5 });
}
