import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import postgres from "postgres";
import { compileAndPersistSourcePack } from "../src/source-pack-repository.mjs";
import {
  activateSourcePack,
  persistSourcePackGateReceipt,
  sourcePackGateSchemaVersion,
} from "../src/source-pack-lifecycle.mjs";
import {
  createVisualCandidateSetRepository,
  visualCandidateCaptureEvidenceContractDigest,
  visualCandidateSamePhotoEvidenceContractDigest,
} from "../src/visual-candidate-set.mjs";

const databaseUrl =
  process.env.DATABASE_URL || "postgres://cimmich@postgres:5432/cimmich";
const sql = postgres(databaseUrl, { max: 2, prepare: true });

try {
  const [query] = await sql`
    SELECT face.face_id, embedding.model_family, embedding.model_version,
      embedding.config_digest
    FROM face_observation face
    JOIN face_embedding embedding ON embedding.face_id = face.face_id
      AND embedding.state = 'active'
    JOIN media_job job ON job.result_receipt_id = embedding.producer_receipt_id
      AND job.state = 'completed'
    JOIN media_pipeline_run pipeline ON pipeline.recognition_job_id = job.job_id
      AND pipeline.asset_id = face.asset_id
      AND pipeline.recognizer_config_digest = embedding.config_digest
      AND pipeline.state = 'recognized'
    JOIN immich_asset_projection projection
      ON projection.cimmich_asset_id = face.asset_id
      AND projection.input_revision = pipeline.input_revision
      AND projection.state = 'active'
    WHERE face.state = 'valid'
    ORDER BY pipeline.recognized_at DESC, face.face_id
    LIMIT 1
  `;
  assert.ok(query, "synthetic provider-bound query face is required");

  const [currentPack] = await sql`
    SELECT pack_id, pack_digest
    FROM current_source_pack
    WHERE model_family = ${query.model_family}
      AND model_version = ${query.model_version}
      AND config_digest = ${query.config_digest}
  `;
  let pack = currentPack
    ? { packDigest: currentPack.pack_digest, packId: currentPack.pack_id }
    : null;
  if (!pack) {
    const compiled = await compileAndPersistSourcePack(
      sql,
      {
        configDigest: query.config_digest,
        cutoff: "2030-01-01T00:00:00.000Z",
        modelFamily: query.model_family,
        modelVersion: query.model_version,
      },
      { execute: true },
    );
    assert.equal(compiled.persistence.created, true);
    pack = compiled.pack;
    await persistSourcePackGateReceipt(
      sql,
      {
        authorityScope: "human-review",
        cohortDigest: createHash("sha256")
          .update(`visual-candidate-set:${pack.packDigest}`)
          .digest("hex"),
        leakage: { passed: true, queryReferenceOverlap: 0 },
        matcherPolicy: {
          marginFloor: 0,
          policyVersion: "cimmich-best-prime-v1",
          scoreFloor: 0,
          scorer: "best_individual_prime",
        },
        metrics: {
          decisionPrecisionPercent: 100,
          knownCorrectCoveragePercent: 100,
          unknownFalseAcceptRatePercent: 0,
          verifiedUnknowns: 1,
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
  }

  const before = (
    await sql`
      SELECT (SELECT count(*)::int FROM source_pack) AS packs,
        (SELECT count(*)::int FROM source_pack_reference) AS references,
        (SELECT count(*)::int FROM identity_claim) AS claims,
        (SELECT count(*)::int FROM source_pack_rebuild_request) AS rebuilds
    `
  )[0];
  const repository = createVisualCandidateSetRepository(sql, {
    presentationRank: () => 1,
  });
  const request = {
    faceId: query.face_id,
    limit: 12,
    providerConfigDigest: query.config_digest,
    visualFloor: 0,
  };
  const first = await repository.load(request);
  const second = await repository.load(request);
  assert.deepEqual(first, second);
  assert.equal(first.state, "available");
  assert.ok(first.candidates.length >= 1);
  assert.equal(
    first.baseline.candidateToken,
    first.candidates[0].candidateToken,
  );
  assert.equal(first.binding.packDigest, pack.packDigest);
  assert.equal(first.binding.providerConfigDigest, query.config_digest);
  assert.equal(
    first.boundary.currentRepositoryRevisionValidation,
    "performed_at_issue",
  );
  assert.equal(first.boundary.repositoryWrites, "none");
  assert.equal(first.authority.automaticIdentityAuthority, "none");
  assert.equal(first.authority.activation, "none");
  assert.throws(() => repository.project({ ...first }));

  const firstCapture = await repository.loadCaptureContextEvidence({
    candidateEnvelope: first,
  });
  const secondCapture = await repository.loadCaptureContextEvidence({
    candidateEnvelope: first,
  });
  assert.deepEqual(firstCapture, secondCapture);
  assert.match(visualCandidateCaptureEvidenceContractDigest, /^[0-9a-f]{64}$/);
  assert.equal(
    firstCapture.binding.candidateSetDigest,
    first.candidateSetDigest,
  );
  assert.equal(firstCapture.binding.queryToken, first.queryToken);
  assert.equal(firstCapture.boundary.visibilityBeforeCount, "enforced");
  assert.equal(firstCapture.boundary.repositoryWrites, "none");
  assert.equal(firstCapture.authority.automaticIdentityAuthority, "none");
  assert.equal(
    firstCapture.evidence.every((evidence) =>
      first.candidates.some(
        (candidate) => candidate.candidateToken === evidence.candidateToken,
      ),
    ),
    true,
  );
  await assert.rejects(() =>
    repository.loadCaptureContextEvidence({
      candidateEnvelope: { ...first },
    }),
  );
  const firstSamePhoto = await repository.loadSamePhotoEvidence({
    candidateEnvelope: first,
  });
  const secondSamePhoto = await repository.loadSamePhotoEvidence({
    candidateEnvelope: first,
  });
  assert.deepEqual(firstSamePhoto, secondSamePhoto);
  assert.match(
    visualCandidateSamePhotoEvidenceContractDigest,
    /^[0-9a-f]{64}$/,
  );
  assert.equal(
    firstSamePhoto.binding.candidateSetDigest,
    first.candidateSetDigest,
  );
  assert.equal(firstSamePhoto.binding.queryToken, first.queryToken);
  assert.equal(firstSamePhoto.boundary.samePhotoAuthority, "suppress_only");
  assert.equal(firstSamePhoto.boundary.repositoryWrites, "none");
  assert.equal(firstSamePhoto.authority.automaticIdentityAuthority, "none");
  assert.equal(
    firstSamePhoto.evidence.every((evidence) =>
      first.candidates.some(
        (candidate) => candidate.candidateToken === evidence.candidateToken,
      ),
    ),
    true,
  );
  await assert.rejects(() =>
    repository.loadSamePhotoEvidence({ candidateEnvelope: { ...first } }),
  );

  const serialized = JSON.stringify({ first, firstCapture, firstSamePhoto });
  for (const forbidden of [
    "person_pipeline_",
    "face_pipeline_",
    "asset_pipeline_",
    "displayName",
    "personId",
    "faceId",
    "assetId",
    "filename",
    "path",
    "embedding",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  const wrongSpace = await repository.load({
    ...request,
    providerConfigDigest: "f".repeat(64),
  });
  assert.equal(wrongSpace.state, "unavailable");
  assert.equal(
    wrongSpace.reason,
    "PROVIDER_OR_ACTIVE_PACK_BINDING_UNAVAILABLE",
  );

  const after = (
    await sql`
      SELECT (SELECT count(*)::int FROM source_pack) AS packs,
        (SELECT count(*)::int FROM source_pack_reference) AS references,
        (SELECT count(*)::int FROM identity_claim) AS claims,
        (SELECT count(*)::int FROM source_pack_rebuild_request) AS rebuilds
    `
  )[0];
  assert.deepEqual(after, before);

  process.stdout.write(
    `${JSON.stringify({
      automaticIdentityAuthority: "none",
      captureEvidenceCount: firstCapture.evidence.length,
      captureEvidenceState: firstCapture.state,
      candidateCount: first.candidates.length,
      candidateSetDigest: first.candidateSetDigest,
      packDigest: first.binding.packDigest,
      receiptDigest: first.receiptDigest,
      repositoryWrites: "none",
      samePhotoEvidenceCount: firstSamePhoto.evidence.length,
      samePhotoEvidenceState: firstSamePhoto.state,
      schemaVersion: first.schemaVersion,
      status: "PASS",
    })}\n`,
  );
} finally {
  await sql.end({ timeout: 5 });
}
