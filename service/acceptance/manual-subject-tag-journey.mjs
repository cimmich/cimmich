import assert from "node:assert/strict";
import postgres from "postgres";
import { createCimmichRepository } from "../src/repository.mjs";
import { loadPrimeCuratorFaces } from "../src/prime-curator-repository.mjs";
import { loadSourcePackFaces } from "../src/source-pack-repository.mjs";

const root = process.env.CIMMICH_ACCEPTANCE_URL || "http://127.0.0.1:3101";
const sql = postgres(process.env.DATABASE_URL, { max: 4 });
const headers = {
  "content-type": "application/json",
  "x-cimmich-actor": "typed-tag-acceptance",
  "x-cimmich-device-id": "typed-tag-device",
  "x-cimmich-principal-id": "local-primary",
  "x-cimmich-surface": "interactive",
};
const post = async (path, body) => {
  const response = await fetch(`${root}${path}`, {
    body: JSON.stringify(body),
    headers,
    method: "POST",
  });
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  return payload;
};
const patch = async (path, body) => {
  const response = await fetch(`${root}${path}`, {
    body: JSON.stringify(body),
    headers,
    method: "PATCH",
  });
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  return payload;
};

try {
  await sql`
    INSERT INTO person (
      person_id, display_name, status, subject_kind, created_by_receipt_id,
      privacy_class
    ) VALUES (
      'pet_typed_tag_fixture', 'Synthetic Pet', 'active', 'pet',
      'receipt_service_fixture', 'private'
    ) ON CONFLICT (person_id) DO NOTHING
  `;
  const faceRequest = {
    commandId: "typed.face.acceptance.0001",
    region: { h: 0.22, w: 0.18, x: 0.62, y: 0.48 },
    subjectId: "person_service_fixture",
    subjectKind: "person",
    tagType: "face",
  };
  const beforeRebuild = Number(
    (
      await sql`SELECT count(*)::int AS count FROM source_pack_rebuild_request`
    )[0].count,
  );
  const attached = await post(
    "/v1/assets/asset_service_fixture/manual-subject-tags",
    faceRequest,
  );
  assert.equal(
    attached.identityStatus ?? attached.tag.identityStatus,
    "accepted",
  );
  assert.equal(attached.tag.matchingStatus, "waiting_for_provider");
  assert.equal(attached.tag.observationId.startsWith("face_manual_"), true);
  const replay = await post(
    "/v1/assets/asset_service_fixture/manual-subject-tags",
    faceRequest,
  );
  assert.equal(replay.replayed, true);
  const noChange = await post(
    "/v1/assets/asset_service_fixture/manual-subject-tags",
    { ...faceRequest, commandId: "typed.face.acceptance.0002" },
  );
  assert.equal(noChange.status, "no_change");
  const [truth] = await sql`
    SELECT claim.identity_claim_id, claim.state AS claim_state,
      face.face_id, face.observation_origin, face.detection_confidence,
      operation.operation_id, lifecycle.state AS matching_state
    FROM manual_subject_tag_operation operation
    JOIN identity_claim claim ON claim.identity_claim_id = operation.tag_id
    JOIN face_observation face ON face.face_id = operation.observation_id
    JOIN current_manual_face_matching_lifecycle lifecycle
      ON lifecycle.operation_id = operation.operation_id
    WHERE operation.decision_id = ${attached.tag.decision.decisionId}
  `;
  assert.deepEqual(
    {
      claimState: truth.claim_state,
      confidence: truth.detection_confidence,
      matchingState: truth.matching_state,
      origin: truth.observation_origin,
    },
    {
      claimState: "accepted",
      confidence: null,
      matchingState: "pending_provider",
      origin: "manual_user",
    },
  );
  assert.equal(
    Number(
      (
        await sql`SELECT count(*)::int AS count FROM source_pack_rebuild_request`
      )[0].count,
    ),
    beforeRebuild,
  );

  const repository = createCimmichRepository(sql);
  const digest = "a".repeat(64);
  const unlockResponse = await fetch(`${root}/v1/visibility/unlock`, {
    body: JSON.stringify({ password: "1" }),
    headers,
    method: "POST",
  });
  const unlock = await unlockResponse.json();
  assert.equal(unlockResponse.status, 200, JSON.stringify(unlock));
  headers["x-cimmich-private-session"] = unlock.privateSessionToken;
  await patch("/v1/visibility/objects/asset/asset_service_fixture", {
    commandId: "typed.visibility.private.0001",
    visibilityTier: "private",
  });
  await assert.rejects(
    repository.transitionManualFaceMatching({
      actorId: "typed-tag-acceptance",
      commandId: "typed.match.hidden.0001",
      configDigest: digest,
      embeddingId: null,
      evidenceDigest: null,
      evidenceTier: null,
      modelFamily: "synthetic",
      modelVersion: "v1",
      operationId: truth.operation_id,
      providerId: "synthetic-local",
      reason: "invalid_face",
      state: "abstained",
      vectorDigest: null,
      vectorSpaceId: "synthetic.v1",
    }),
    (error) => error.code === "MANUAL_SUBJECT_TAG_ASSET_NOT_VISIBLE",
  );
  await patch("/v1/visibility/objects/asset/asset_service_fixture", {
    commandId: "typed.visibility.standard.0001",
    visibilityTier: "standard",
  });
  await repository.transitionManualFaceMatching({
    actorId: "typed-tag-acceptance",
    commandId: "typed.match.abstain.0001",
    configDigest: digest,
    embeddingId: null,
    evidenceDigest: null,
    evidenceTier: null,
    modelFamily: "synthetic",
    modelVersion: "v1",
    operationId: truth.operation_id,
    providerId: "synthetic-local",
    reason: "invalid_face",
    state: "abstained",
    vectorDigest: null,
    vectorSpaceId: "synthetic.v1",
  });
  assert.equal(
    (
      await sql`SELECT state FROM identity_claim WHERE identity_claim_id = ${truth.identity_claim_id}`
    )[0].state,
    "accepted",
  );
  await sql`
    INSERT INTO face_embedding (
      embedding_id, face_id, model_family, model_version, config_digest,
      dimension, normalized, embedding, vector_digest, state,
      producer_receipt_id, privacy_class
    ) VALUES (
      'embedding_typed_manual_fixture', ${truth.face_id}, 'synthetic', 'v1',
      ${digest}, 3, true, '[1,0,0]'::vector, ${digest}, 'active',
      'receipt_service_fixture', 'sensitive-biometric'
    )
  `;
  assert.equal(
    Number(
      (
        await sql`SELECT count(*)::int AS count FROM source_pack_rebuild_request`
      )[0].count,
    ),
    beforeRebuild,
  );
  const [evidence] = await sql`
    SELECT cimmich_manual_face_evidence_digest(${truth.face_id}) AS digest
  `;
  const rebuildBeforeCallerAssertion = Number(
    (
      await sql`SELECT count(*)::int AS count FROM source_pack_rebuild_request`
    )[0].count,
  );
  await assert.rejects(
    repository.transitionManualFaceMatching({
      actorId: "typed-tag-acceptance",
      commandId: "typed.match.eligible.0001",
      configDigest: digest,
      embeddingId: "embedding_typed_manual_fixture",
      evidenceDigest: evidence.digest,
      evidenceTier: "secondary",
      modelFamily: "synthetic",
      modelVersion: "v1",
      operationId: truth.operation_id,
      providerId: "synthetic-local",
      reason: null,
      state: "eligible_for_evaluation",
      vectorDigest: digest,
      vectorSpaceId: "synthetic.v1",
    }),
    (error) => error.code === "MANUAL_FACE_RECOGNITION_EVIDENCE_REQUIRED",
  );
  assert.equal(
    Number(
      (
        await sql`SELECT count(*)::int AS count FROM source_pack_rebuild_request`
      )[0].count,
    ),
    rebuildBeforeCallerAssertion,
  );
  assert.equal(
    Number(
      (
        await sql`
          SELECT count(*)::int AS count
          FROM manual_face_matching_lifecycle
          WHERE operation_id = ${truth.operation_id}
            AND state = 'eligible_for_evaluation'
        `
      )[0].count,
    ),
    0,
  );
  await assert.rejects(
    sql`
      INSERT INTO manual_face_matching_lifecycle (
        lifecycle_id, operation_id, identity_claim_id, face_id, scope_key,
        state, reason, provider_id, model_family, model_version, config_digest,
        vector_space_id, embedding_id, vector_digest, evidence_digest,
        evidence_tier, rebuild_request_id, supersedes_lifecycle_id,
        producer_receipt_id, privacy_class
      ) VALUES (
        'manualmatch_forged_eligible_fixture', ${truth.operation_id},
        ${truth.identity_claim_id}, ${truth.face_id}, ${digest},
        'eligible_for_evaluation', NULL, 'synthetic-local', 'synthetic', 'v1',
        ${digest}, 'synthetic.v1', 'embedding_typed_manual_fixture', ${digest},
        ${evidence.digest}, 'secondary', NULL, NULL,
        'receipt_cimmich_typed_manual_subject_tag_v1', 'sensitive-biometric'
      )
    `,
    /manual_face_matching_lifecycle_recognition_evidence_check|MANUAL_FACE_RECOGNITION_EVIDENCE_REQUIRED_DB/,
  );
  assert.equal(
    (await loadPrimeCuratorFaces(sql, "person_service_fixture")).some(
      (face) => face.faceId === truth.face_id,
    ),
    false,
  );
  const sourceFaces = await loadSourcePackFaces(sql, {
    configDigest: digest,
    modelFamily: "synthetic",
    modelVersion: "v1",
    personId: "person_service_fixture",
  });
  assert.equal(
    sourceFaces.some((face) => face.faceId === truth.face_id),
    false,
  );

  for (const [tagType, subjectId, subjectKind, commandId] of [
    ["body", "pet_typed_tag_fixture", "pet", "typed.body.acceptance.0001"],
    [
      "presence",
      "pet_typed_tag_fixture",
      "pet",
      "typed.presence.acceptance.0001",
    ],
  ]) {
    const result = await post(
      "/v1/assets/asset_service_fixture/manual-subject-tags",
      {
        commandId,
        region: { h: 0.3, w: 0.24, x: 0.05, y: 0.55 },
        subjectId,
        subjectKind,
        tagType,
      },
    );
    assert.equal(result.tag.tagType, tagType);
    assert.equal(result.tag.observationId === null, tagType === "presence");
  }

  const authorityCounts = async () => {
    const [row] = await sql`
      SELECT
        (SELECT count(*)::int FROM face_observation) AS faces,
        (SELECT count(*)::int FROM body_observation) AS bodies,
        (SELECT count(*)::int FROM presence_tag) AS presences,
        (SELECT count(*)::int FROM face_embedding) AS embeddings,
        (SELECT count(*)::int FROM source_pack_rebuild_request) AS rebuilds,
        (SELECT count(*)::int FROM source_pack) AS packs
    `;
    return row;
  };
  const beforeHeads = await authorityCounts();
  const headPerson = await post(
    "/v1/assets/asset_service_fixture/manual-subject-tags",
    {
      commandId: "typed.head.person.0001",
      region: { h: 0.19, w: 0.17, x: 0.34, y: 0.08 },
      subjectId: "person_service_fixture",
      subjectKind: "person",
      tagType: "head",
    },
  );
  const headPet = await post(
    "/v1/assets/asset_service_fixture/manual-subject-tags",
    {
      commandId: "typed.head.pet.0001",
      region: { h: 0.18, w: 0.16, x: 0.12, y: 0.11 },
      subjectId: "pet_typed_tag_fixture",
      subjectKind: "pet",
      tagType: "head",
    },
  );
  for (const head of [headPerson, headPet]) {
    assert.equal(head.tag.tagType, "head");
    assert.equal(head.tag.observationId.startsWith("head_manual_"), true);
    assert.equal(head.tag.provenance, "manual_user");
  }
  assert.deepEqual(await authorityCounts(), beforeHeads);
  assert.equal(
    Number(
      (
        await sql`
          SELECT count(*)::int AS count
          FROM current_manual_head_tag tag
          JOIN manual_head_observation head ON head.head_id = tag.head_id
          WHERE head.asset_id = 'asset_service_fixture'
            AND tag.head_tag_id IN (${headPerson.tag.tagId}, ${headPet.tag.tagId})
        `
      )[0].count,
    ),
    2,
  );

  const transitionTypes = ["face", "body", "head", "presence"];
  let transitionIndex = 0;
  for (const sourceType of transitionTypes) {
    for (const targetType of transitionTypes) {
      const suffix = String(transitionIndex).padStart(2, "0");
      const subjectId = `person_typed_replace_${suffix}`;
      await sql`
        INSERT INTO person (
          person_id, display_name, status, subject_kind,
          created_by_receipt_id, privacy_class
        ) VALUES (
          ${subjectId}, ${`Replace ${suffix}`}, 'active', 'person',
          'receipt_service_fixture', 'private'
        )
      `;
      const sourceRegion = {
        h: 0.12,
        w: 0.11,
        x: 0.02 + (transitionIndex % 4) * 0.2,
        y: 0.02 + Math.floor(transitionIndex / 4) * 0.2,
      };
      const targetRegion = {
        h: 0.13,
        w: 0.1,
        x: sourceRegion.x + 0.01,
        y: sourceRegion.y + 0.01,
      };
      const source = await post(
        "/v1/assets/asset_service_fixture/manual-subject-tags",
        {
          commandId: `typed.replace.source.${suffix}`,
          region: sourceRegion,
          subjectId,
          subjectKind: "person",
          tagType: sourceType,
        },
      );
      const replaceRequest = {
        commandId: `typed.replace.apply.${suffix}`,
        expectedDecisionId: source.tag.decision.decisionId,
        region: targetRegion,
        subjectId,
        subjectKind: "person",
        tagType: targetType,
      };
      const replaced = await post(
        `/v1/manual-subject-tags/${source.tag.tagId}/replace`,
        replaceRequest,
      );
      assert.equal(replaced.status, "replaced");
      assert.equal(replaced.tag.tagType, targetType);
      assert.notEqual(replaced.tag.tagId, source.tag.tagId);
      assert.equal(
        replaced.tag.observationId === null,
        targetType === "presence",
      );
      assert.deepEqual(replaced.tag.geometry, targetRegion);
      assert.equal(
        (
          await post(
            `/v1/manual-subject-tags/${source.tag.tagId}/replace`,
            replaceRequest,
          )
        ).replayed,
        true,
      );
      const conflict = await fetch(
        `${root}/v1/manual-subject-tags/${source.tag.tagId}/replace`,
        {
          body: JSON.stringify({
            ...replaceRequest,
            region: { ...targetRegion, x: targetRegion.x + 0.01 },
          }),
          headers,
          method: "POST",
        },
      );
      assert.equal(conflict.status, 409);
      const restored = await post(
        `/v1/manual-subject-tags/decisions/${replaced.tag.decision.decisionId}/undo`,
        { commandId: `typed.replace.undo.${suffix}` },
      );
      assert.equal(restored.status, "restored");
      assert.equal(restored.tag.tagId, source.tag.tagId);
      assert.equal(restored.tag.observationId, source.tag.observationId);
      assert.equal(restored.tag.tagType, sourceType);
      assert.deepEqual(restored.tag.geometry, sourceRegion);
      const restoredReplay = await post(
        `/v1/manual-subject-tags/decisions/${replaced.tag.decision.decisionId}/undo`,
        { commandId: `typed.replace.undo.${suffix}` },
      );
      assert.equal(restoredReplay.replayed, true);
      await post(
        `/v1/manual-subject-tags/decisions/${source.tag.decision.decisionId}/undo`,
        { commandId: `typed.replace.clear.${suffix}` },
      );
      transitionIndex += 1;
    }
  }
  assert.equal((await authorityCounts()).rebuilds, beforeHeads.rebuilds);

  for (const head of [headPerson, headPet]) {
    const headUndo = await post(
      `/v1/manual-subject-tags/decisions/${head.tag.decision.decisionId}/undo`,
      { commandId: `typed.head.undo.${head.tag.subject.subjectKind}` },
    );
    assert.equal(headUndo.status, "reverted");
    assert.equal(headUndo.tag.tagType, "head");
  }

  const readback = await fetch(
    `${root}/v1/assets/asset_service_fixture/manual-subject-tags`,
  ).then((response) => response.json());
  const readbackFace = readback.items.find(
    (tag) => tag.observationId === truth.face_id,
  );
  assert.equal(readbackFace.identityStatus, "accepted");
  assert.equal(readbackFace.matchingStatus, "abstained");
  const undone = await post(
    `/v1/manual-subject-tags/decisions/${attached.tag.decision.decisionId}/undo`,
    { commandId: "typed.face.undo.0001" },
  );
  assert.equal(undone.status, "reverted");
  const [afterUndo] = await sql`
    SELECT claim.state AS claim_state, face.state AS face_state
    FROM identity_claim claim JOIN face_observation face ON face.face_id = claim.face_id
    WHERE claim.identity_claim_id = ${truth.identity_claim_id}
  `;
  assert.deepEqual(afterUndo, {
    claim_state: "superseded",
    face_state: "rejected",
  });
  assert.equal(
    Number(
      (
        await sql`
        SELECT count(*)::int AS count
        FROM current_manual_face_matching_lifecycle
        WHERE operation_id = ${truth.operation_id} AND state <> 'cancelled'
      `
      )[0].count,
    ),
    0,
  );
} finally {
  await sql.end();
}
