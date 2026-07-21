import assert from "node:assert/strict";
import postgres from "postgres";
import { createCimmichRepository } from "../src/repository.mjs";

const sql = postgres(process.env.DATABASE_URL, { max: 4 });
const bridge = new Map([
  [
    "source-identity-fixture",
    {
      assetId: "asset_identity_fixture",
      filename: "synthetic-identity.jpg",
      sourceAssetId: "source-identity-fixture",
    },
  ],
]);
const repository = createCimmichRepository(sql, bridge, {
  currentRank: () => 2,
});
const actorId = "observation-correction-acceptance";

try {
  await sql`
    INSERT INTO face_observation (
      face_id, asset_id, box_x, box_y, box_w, box_h, detection_confidence,
      quality_measurements, state, producer_receipt_id
    ) VALUES (
      'face_observation_correction_fixture', 'asset_identity_fixture',
      0.38, 0.12, 0.18, 0.15, 0.96,
      ${sql.json({ quality_bucket: "clean_core", quality_score: 0.91 })},
      'valid', 'receipt_service_fixture'
    )
  `;
  await sql`
    INSERT INTO decision (
      decision_id, subject_type, subject_id, action, actor_kind, actor_id,
      reason_code, producer_receipt_id
    ) VALUES (
      'decision_observation_correction_fixture', 'identity_claim',
      'claim_observation_correction_fixture', 'accept', 'trusted_import',
      'synthetic-fixture', 'synthetic_truth', 'receipt_service_fixture'
    )
  `;
  await sql`
    INSERT INTO identity_claim (
      identity_claim_id, face_id, person_id, origin, state,
      calibrated_confidence, evidence_refs, decision_id, producer_receipt_id
    ) VALUES (
      'claim_observation_correction_fixture',
      'face_observation_correction_fixture', 'person_service_fixture',
      'trusted_import', 'accepted', 1, ${sql.json(["synthetic-correction"])},
      'decision_observation_correction_fixture', 'receipt_service_fixture'
    )
  `;
  await sql`
    INSERT INTO face_embedding (
      embedding_id, face_id, model_family, model_version, config_digest,
      dimension, normalized, embedding, vector_digest, state,
      producer_receipt_id
    ) VALUES (
      'embedding_observation_correction_fixture',
      'face_observation_correction_fixture', 'synthetic', 'correction-v1',
      ${"d".repeat(64)}, 3, true, '[1,0,0]'::vector, ${"e".repeat(64)},
      'active', 'receipt_service_fixture'
    )
  `;
  await sql`
    INSERT INTO body_observation (
      body_id, asset_id, box_x, box_y, box_w, box_h,
      quality_measurements, state, producer_receipt_id
    ) VALUES (
      'body_observation_correction_fixture', 'asset_identity_fixture',
      0.2, 0.06, 0.55, 0.88, ${sql.json({ quality_score: 0.89 })},
      'valid', 'receipt_service_fixture'
    )
  `;
  const [faceBefore] = await sql`
    SELECT box_x::float8, box_y::float8, box_w::float8, box_h::float8,
      current_revision, current_decision_id
    FROM face_observation WHERE face_id = 'face_observation_correction_fixture'
  `;
  const faceGeometry = await repository.correctGeometry(
    {
      actorId,
      commandId: "correction.face.geometry.0001",
      expectedDecisionId: faceBefore.current_decision_id,
      expectedRevision: Number(faceBefore.current_revision),
      region: { h: 0.17, w: 0.2, x: 0.36, y: 0.11 },
    },
    "face",
    "face_observation_correction_fixture",
  );
  assert.equal(faceGeometry.changed, true);
  assert.equal(faceGeometry.observation.revision, 2);
  assert.equal(
    (
      await sql`
        SELECT count(*)::int AS count FROM face_embedding
        WHERE face_id = 'face_observation_correction_fixture' AND state = 'active'
      `
    )[0].count,
    0,
  );
  assert.equal(
    (
      await sql`
        SELECT state FROM identity_claim
        WHERE identity_claim_id = 'claim_observation_correction_fixture'
      `
    )[0].state,
    "accepted",
  );
  const faceReplay = await repository.correctGeometry(
    {
      actorId,
      commandId: "correction.face.geometry.0001",
      expectedDecisionId: faceBefore.current_decision_id,
      expectedRevision: Number(faceBefore.current_revision),
      region: { h: 0.17, w: 0.2, x: 0.36, y: 0.11 },
    },
    "face",
    "face_observation_correction_fixture",
  );
  assert.equal(faceReplay.replayed, true);
  await assert.rejects(
    repository.correctGeometry(
      {
        actorId,
        commandId: "correction.face.geometry.stale.0001",
        expectedDecisionId: faceBefore.current_decision_id,
        expectedRevision: Number(faceBefore.current_revision),
        region: { h: 0.18, w: 0.2, x: 0.36, y: 0.11 },
      },
      "face",
      "face_observation_correction_fixture",
    ),
    (error) => error.code === "OBSERVATION_CORRECTION_STALE",
  );
  const faceGeometryUndo = await repository.undo(
    { actorId, commandId: "correction.face.geometry.undo.0001" },
    faceGeometry.decisionId,
  );
  assert.deepEqual(faceGeometryUndo.observation.region, {
    h: Number(faceBefore.box_h),
    w: Number(faceBefore.box_w),
    x: Number(faceBefore.box_x),
    y: Number(faceBefore.box_y),
  });
  assert.equal(
    (
      await sql`
        SELECT count(*)::int AS count FROM face_embedding
        WHERE face_id = 'face_observation_correction_fixture' AND state = 'active'
      `
    )[0].count,
    1,
  );

  const faceRejected = await repository.rejectObservation(
    {
      actorId,
      commandId: "correction.face.reject.0001",
      expectedDecisionId: faceGeometryUndo.decisionId,
      expectedRevision: faceGeometryUndo.observation.revision,
    },
    "face",
    "face_observation_correction_fixture",
  );
  assert.equal(faceRejected.observation.state, "rejected");
  assert.equal(
    (
      await sql`
        SELECT state FROM identity_claim
        WHERE identity_claim_id = 'claim_observation_correction_fixture'
      `
    )[0].state,
    "superseded",
  );
  await assert.rejects(
    sql`UPDATE face_observation SET state = 'valid' WHERE face_id = 'face_observation_correction_fixture'`,
    /OBSERVATION_REJECTION_ACTIVE_DB/,
  );
  const faceRejectUndo = await repository.undo(
    { actorId, commandId: "correction.face.reject.undo.0001" },
    faceRejected.decisionId,
  );
  assert.equal(faceRejectUndo.observation.state, "valid");
  assert.equal(
    (
      await sql`
        SELECT state FROM identity_claim
        WHERE identity_claim_id = 'claim_observation_correction_fixture'
      `
    )[0].state,
    "accepted",
  );

  const [bodyBefore] = await sql`
    SELECT current_revision, current_decision_id
    FROM body_observation WHERE body_id = 'body_observation_correction_fixture'
  `;
  const bodyRejected = await repository.rejectObservation(
    {
      actorId,
      commandId: "correction.body.reject.0001",
      expectedDecisionId: bodyBefore.current_decision_id,
      expectedRevision: Number(bodyBefore.current_revision),
    },
    "body",
    "body_observation_correction_fixture",
  );
  assert.equal(bodyRejected.observation.state, "rejected");
  const bodyUndo = await repository.undo(
    { actorId, commandId: "correction.body.reject.undo.0001" },
    bodyRejected.decisionId,
  );
  assert.equal(bodyUndo.observation.state, "valid");

  const evidence = await repository.assetEvidence({
    sourceAssetId: "source-identity-fixture",
  });
  assert.equal(evidence.schemaVersion, "cimmich.asset-detailed-evidence.v3");
  assert.equal(
    evidence.bodies.some(
      (body) => body.body_id === "body_observation_correction_fixture",
    ),
    true,
  );
  assert.equal(
    evidence.heads.some((head) => head.body_id),
    false,
  );
  assert.equal(
    evidence.faces.every(
      (face) =>
        Number.isInteger(face.current_revision) &&
        Array.isArray(face.candidate_matches),
    ),
    true,
  );

  console.log(
    JSON.stringify({
      bodyRejectionUndo: "passed",
      candidateAuthority: "suggestion_only",
      faceGeometryUndo: "passed",
      faceRejectionUndo: "passed",
      schemaVersion: "cimmich.detailed-observation-correction.v1",
      sourceWrites: "none",
    }),
  );
} finally {
  await sql.end({ timeout: 5 });
}
