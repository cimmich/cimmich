import { createHash, randomUUID } from "node:crypto";

export const observationCorrectionSchemaVersion =
  "cimmich.detailed-observation-correction.v1";

const receiptId = "receipt_cimmich_detailed_observation_correction_v1";
const kinds = new Set(["face", "body"]);

const typedError = (message, statusCode, code, details) =>
  Object.assign(new Error(message), {
    code,
    statusCode,
    ...(details ? { details } : {}),
  });

const exactObject = (value, keys) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw typedError(
      "Observation correction input must be an object",
      400,
      "OBSERVATION_CORRECTION_INPUT_INVALID",
    );
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw typedError(
      "Observation correction input has unsupported or missing fields",
      400,
      "OBSERVATION_CORRECTION_INPUT_INVALID",
    );
  }
};

const cleanId = (value, label, maximum = 200) => {
  const id = String(value || "").trim();
  if (!id || id.length > maximum || /[\u0000-\u001f\u007f]/.test(id)) {
    throw typedError(
      `${label} is invalid`,
      400,
      "OBSERVATION_CORRECTION_INPUT_INVALID",
    );
  }
  return id;
};

const cleanCommandId = (value) => {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$/.test(id)) {
    throw typedError(
      "commandId must be a stable safe identifier",
      400,
      "OBSERVATION_CORRECTION_COMMAND_INVALID",
    );
  }
  return id;
};

const cleanRevision = (value) => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw typedError(
      "expectedRevision must be a positive integer",
      400,
      "OBSERVATION_CORRECTION_INPUT_INVALID",
    );
  }
  return value;
};

const cleanDecision = (value) =>
  value == null ? null : cleanId(value, "expectedDecisionId");

const coordinate = (value, label, positive = false) => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1 ||
    (positive && value === 0)
  ) {
    throw typedError(
      `${label} must be a normalized finite number`,
      400,
      "OBSERVATION_CORRECTION_REGION_INVALID",
    );
  }
  return Object.is(value, -0) ? 0 : value;
};

export const normalizeObservationRegion = (value) => {
  exactObject(value, ["h", "w", "x", "y"]);
  const region = {
    h: coordinate(value.h, "region.h", true),
    w: coordinate(value.w, "region.w", true),
    x: coordinate(value.x, "region.x"),
    y: coordinate(value.y, "region.y"),
  };
  if (region.x + region.w > 1 || region.y + region.h > 1) {
    throw typedError(
      "region must remain inside the normalized image",
      400,
      "OBSERVATION_CORRECTION_REGION_INVALID",
    );
  }
  return region;
};

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
};

const digest = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");

const regionOf = (row) => ({
  h: Number(row.box_h),
  w: Number(row.box_w),
  x: Number(row.box_x),
  y: Number(row.box_y),
});

const sameRegion = (left, right) =>
  ["x", "y", "w", "h"].every((key) => left[key] === right[key]);

const publicObservation = (row, kind) => ({
  assetId: row.asset_id,
  decisionId: row.current_decision_id || null,
  observationId: kind === "face" ? row.face_id : row.body_id,
  observationKind: kind,
  region: regionOf(row),
  revision: Number(row.current_revision),
  state: row.state,
});

const normalizeBase = (input, kind, observationId, fields) => {
  exactObject(input, fields);
  if (!kinds.has(kind)) {
    throw typedError(
      "observation kind is invalid",
      400,
      "OBSERVATION_CORRECTION_INPUT_INVALID",
    );
  }
  return {
    actorId: cleanId(input.actorId, "actorId", 120),
    commandId: cleanCommandId(input.commandId),
    expectedDecisionId: cleanDecision(input.expectedDecisionId),
    expectedRevision: cleanRevision(input.expectedRevision),
    kind,
    observationId: cleanId(observationId, "observationId"),
  };
};

export const normalizeGeometryCorrection = (input, kind, observationId) => ({
  ...normalizeBase(input, kind, observationId, [
    "actorId",
    "commandId",
    "expectedDecisionId",
    "expectedRevision",
    "region",
  ]),
  region: normalizeObservationRegion(input.region),
});

export const normalizeObservationRejection = (input, kind, observationId) =>
  normalizeBase(input, kind, observationId, [
    "actorId",
    "commandId",
    "expectedDecisionId",
    "expectedRevision",
  ]);

export const normalizeObservationCorrectionUndo = (input, decisionId) => {
  exactObject(input, ["actorId", "commandId"]);
  return {
    actorId: cleanId(input.actorId, "actorId", 120),
    commandId: cleanCommandId(input.commandId),
    decisionId: cleanId(decisionId, "decisionId"),
  };
};

const commandReplay = async (tx, commandId, payloadDigest) => {
  const [existing] = await tx`
    SELECT payload_digest, result FROM observation_correction_command
    WHERE command_id = ${commandId}
  `;
  if (!existing) return null;
  if (existing.payload_digest !== payloadDigest) {
    throw typedError(
      "commandId was already used for a different payload",
      409,
      "OBSERVATION_CORRECTION_COMMAND_CONFLICT",
    );
  }
  return { ...existing.result, replayed: true };
};

const insertCommand = async (
  tx,
  commandId,
  commandKind,
  payloadDigest,
  result,
) => {
  await tx`
    INSERT INTO observation_correction_command (
      command_id, command_kind, payload_digest, result,
      producer_receipt_id, privacy_class
    ) VALUES (
      ${commandId}, ${commandKind}, ${payloadDigest}, ${tx.json(result)},
      ${receiptId}, 'private'
    )
  `;
};

const loadVisibleObservation = async (tx, kind, observationId, visibleRank) => {
  const rows =
    kind === "face"
      ? await tx`
          SELECT face.*, asset.asset_id AS visible_asset_id
          FROM face_observation face
          JOIN asset ON asset.asset_id = face.asset_id AND asset.state = 'active'
          WHERE face.face_id = ${observationId}
            AND cimmich_visibility_asset_rank(asset.asset_id) <= ${visibleRank}
          FOR UPDATE OF face
        `
      : await tx`
          SELECT body.*, asset.asset_id AS visible_asset_id
          FROM body_observation body
          JOIN asset ON asset.asset_id = body.asset_id AND asset.state = 'active'
          WHERE body.body_id = ${observationId}
            AND cimmich_visibility_asset_rank(asset.asset_id) <= ${visibleRank}
          FOR UPDATE OF body
        `;
  const [row] = rows;
  if (!row) {
    throw typedError(
      "Observation was not found in the current visibility projection",
      404,
      "OBSERVATION_CORRECTION_NOT_VISIBLE",
    );
  }
  return row;
};

const assertHead = (row, expectedRevision, expectedDecisionId) => {
  if (
    Number(row.current_revision) !== expectedRevision ||
    (row.current_decision_id || null) !== expectedDecisionId
  ) {
    throw typedError(
      "Observation revision or decision head is stale",
      409,
      "OBSERVATION_CORRECTION_STALE",
      {
        currentDecisionId: row.current_decision_id || null,
        currentRevision: Number(row.current_revision),
      },
    );
  }
  if (row.state !== "valid") {
    throw typedError(
      "Only a current valid observation can be corrected",
      409,
      "OBSERVATION_CORRECTION_STATE_CONFLICT",
    );
  }
};

const snapshotDependencies = async (tx, kind, observationId) => {
  if (kind === "face") {
    const [claims, embeddings] = await Promise.all([
      tx`
        SELECT identity_claim_id, state, decision_id
        FROM identity_claim
        WHERE face_id = ${observationId} AND state IN ('accepted','candidate')
        ORDER BY identity_claim_id
      `,
      tx`
        SELECT embedding_id FROM face_embedding
        WHERE face_id = ${observationId} AND state = 'active'
        ORDER BY embedding_id
      `,
    ]);
    return {
      claims: claims.map((row) => ({
        decisionId: row.decision_id || null,
        identityClaimId: row.identity_claim_id,
        state: row.state,
      })),
      embeddingIds: embeddings.map((row) => row.embedding_id),
    };
  }
  const [tags, pose] = await Promise.all([
    tx`
      SELECT body_tag_id, state FROM body_tag
      WHERE body_id = ${observationId} AND state = 'accepted'
      ORDER BY body_tag_id
    `,
    tx`
      SELECT body_id FROM body_pose_evidence
      WHERE body_id = ${observationId} AND state = 'valid'
    `,
  ]);
  return {
    bodyTagIds: tags.map((row) => row.body_tag_id),
    poseWasValid: pose.length === 1,
  };
};

const supersedePriorCorrection = async (tx, kind, observationId) => {
  await tx`
    UPDATE observation_correction_operation
    SET state = 'superseded'
    WHERE observation_kind = ${kind} AND observation_id = ${observationId}
      AND state = 'active'
  `;
};

const insertDecision = async (
  tx,
  { actorId, action, decisionId, observationId, reasonCode },
) => {
  await tx`
    INSERT INTO decision (
      decision_id, subject_type, subject_id, action, actor_kind, actor_id,
      reason_code, note, producer_receipt_id, privacy_class
    ) VALUES (
      ${decisionId}, 'observation', ${observationId}, ${action}, 'user', ${actorId},
      ${reasonCode}, '', ${receiptId}, 'sensitive-biometric'
    )
  `;
};

const retireFaceMatchingEvidence = async (tx, faceId) => {
  await tx`
    UPDATE source_pack pack SET state = 'retired'
    WHERE pack.state = 'active' AND EXISTS (
      SELECT 1 FROM source_pack_reference reference
      WHERE reference.pack_id = pack.pack_id
        AND (reference.face_id = ${faceId} OR ${faceId} = ANY(reference.member_face_ids))
    )
  `;
  await tx`
    UPDATE face_embedding SET state = 'superseded'
    WHERE face_id = ${faceId} AND state = 'active'
  `;
};

const resultFor = (row, kind, decisionId, changed = true) => ({
  changed,
  decisionId,
  observation: publicObservation(row, kind),
  replayed: false,
  schemaVersion: observationCorrectionSchemaVersion,
});

export const createObservationCorrectionStore = (
  sql,
  { presentationRank = () => 0 } = {},
) => ({
  async correctGeometry(input, kind, observationId) {
    const request = normalizeGeometryCorrection(input, kind, observationId);
    const payloadDigest = digest({ ...request, operation: "geometry" });
    return sql.begin(async (tx) => {
      const replay = await commandReplay(tx, request.commandId, payloadDigest);
      if (replay) return replay;
      const row = await loadVisibleObservation(
        tx,
        kind,
        request.observationId,
        presentationRank(),
      );
      assertHead(row, request.expectedRevision, request.expectedDecisionId);
      const priorRegion = regionOf(row);
      if (sameRegion(priorRegion, request.region)) {
        const result = resultFor(
          row,
          kind,
          row.current_decision_id || null,
          false,
        );
        await insertCommand(
          tx,
          request.commandId,
          "geometry",
          payloadDigest,
          result,
        );
        return result;
      }
      const snapshot = await snapshotDependencies(
        tx,
        kind,
        request.observationId,
      );
      const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
      const operationId = `obscorrection_${randomUUID().replaceAll("-", "")}`;
      await supersedePriorCorrection(tx, kind, request.observationId);
      await insertDecision(tx, {
        action: "update",
        actorId: request.actorId,
        decisionId,
        observationId: request.observationId,
        reasonCode: `${kind}_geometry_corrected`,
      });
      if (kind === "face")
        await retireFaceMatchingEvidence(tx, request.observationId);
      else
        await tx`
          UPDATE body_pose_evidence SET state = 'invalidated'
          WHERE body_id = ${request.observationId} AND state = 'valid'
        `;
      const [updated] =
        kind === "face"
          ? await tx`
              UPDATE face_observation SET
                box_x = ${request.region.x}, box_y = ${request.region.y},
                box_w = ${request.region.w}, box_h = ${request.region.h},
                current_revision = current_revision + 1,
                current_decision_id = ${decisionId}
              WHERE face_id = ${request.observationId}
              RETURNING *
            `
          : await tx`
              UPDATE body_observation SET
                box_x = ${request.region.x}, box_y = ${request.region.y},
                box_w = ${request.region.w}, box_h = ${request.region.h},
                current_revision = current_revision + 1,
                current_decision_id = ${decisionId}
              WHERE body_id = ${request.observationId}
              RETURNING *
            `;
      await tx`
        INSERT INTO observation_correction_operation (
          operation_id, command_id, observation_kind, observation_id, asset_id,
          operation_kind, prior_revision, result_revision, prior_decision_id,
          decision_id, prior_region, result_region, prior_state, result_state,
          snapshot, state, producer_receipt_id, privacy_class
        ) VALUES (
          ${operationId}, ${request.commandId}, ${kind}, ${request.observationId}, ${row.asset_id},
          'geometry', ${request.expectedRevision}, ${request.expectedRevision + 1},
          ${request.expectedDecisionId}, ${decisionId}, ${tx.json(priorRegion)},
          ${tx.json(request.region)}, ${row.state}, 'valid', ${tx.json(snapshot)},
          'active', ${receiptId}, 'private'
        )
      `;
      const result = resultFor(updated, kind, decisionId);
      await insertCommand(
        tx,
        request.commandId,
        "geometry",
        payloadDigest,
        result,
      );
      return result;
    });
  },

  async rejectObservation(input, kind, observationId) {
    const request = normalizeObservationRejection(input, kind, observationId);
    const commandKind = kind === "face" ? "not_face" : "not_body";
    const payloadDigest = digest({ ...request, operation: commandKind });
    return sql.begin(async (tx) => {
      const replay = await commandReplay(tx, request.commandId, payloadDigest);
      if (replay) return replay;
      const row = await loadVisibleObservation(
        tx,
        kind,
        request.observationId,
        presentationRank(),
      );
      assertHead(row, request.expectedRevision, request.expectedDecisionId);
      const snapshot = await snapshotDependencies(
        tx,
        kind,
        request.observationId,
      );
      const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
      const operationId = `obscorrection_${randomUUID().replaceAll("-", "")}`;
      await supersedePriorCorrection(tx, kind, request.observationId);
      await insertDecision(tx, {
        action: "reject",
        actorId: request.actorId,
        decisionId,
        observationId: request.observationId,
        reasonCode: commandKind,
      });
      await tx`
        INSERT INTO observation_correction_operation (
          operation_id, command_id, observation_kind, observation_id, asset_id,
          operation_kind, prior_revision, result_revision, prior_decision_id,
          decision_id, prior_region, result_region, prior_state, result_state,
          snapshot, state, producer_receipt_id, privacy_class
        ) VALUES (
          ${operationId}, ${request.commandId}, ${kind}, ${request.observationId}, ${row.asset_id},
          ${commandKind}, ${request.expectedRevision}, ${request.expectedRevision + 1},
          ${request.expectedDecisionId}, ${decisionId}, ${tx.json(regionOf(row))},
          ${tx.json(regionOf(row))}, ${row.state}, 'rejected', ${tx.json(snapshot)},
          'active', ${receiptId}, 'private'
        )
      `;
      await tx`
        INSERT INTO observation_rejection_tombstone (
          observation_kind, observation_id, operation_id, decision_id, state,
          producer_receipt_id, privacy_class
        ) VALUES (
          ${kind}, ${request.observationId}, ${operationId}, ${decisionId}, 'active',
          ${receiptId}, 'private'
        )
      `;
      if (kind === "face") {
        await tx`
          UPDATE identity_claim SET state = 'superseded', decision_id = ${decisionId}
          WHERE face_id = ${request.observationId} AND state IN ('accepted','candidate')
        `;
      } else {
        await tx`
          UPDATE body_tag SET state = 'superseded'
          WHERE body_id = ${request.observationId} AND state = 'accepted'
        `;
        await tx`
          UPDATE body_pose_evidence SET state = 'invalidated'
          WHERE body_id = ${request.observationId} AND state = 'valid'
        `;
      }
      const [updated] =
        kind === "face"
          ? await tx`
              UPDATE face_observation SET state = 'rejected',
                current_revision = current_revision + 1,
                current_decision_id = ${decisionId}
              WHERE face_id = ${request.observationId}
              RETURNING *
            `
          : await tx`
              UPDATE body_observation SET state = 'rejected',
                current_revision = current_revision + 1,
                current_decision_id = ${decisionId}
              WHERE body_id = ${request.observationId}
              RETURNING *
            `;
      const result = resultFor(updated, kind, decisionId);
      await insertCommand(
        tx,
        request.commandId,
        commandKind,
        payloadDigest,
        result,
      );
      return result;
    });
  },

  async undo(input, decisionId) {
    const request = normalizeObservationCorrectionUndo(input, decisionId);
    const payloadDigest = digest({ ...request, operation: "undo" });
    return sql.begin(async (tx) => {
      const replay = await commandReplay(tx, request.commandId, payloadDigest);
      if (replay) return replay;
      const [operation] = await tx`
        SELECT * FROM observation_correction_operation
        WHERE decision_id = ${request.decisionId}
        FOR UPDATE
      `;
      if (!operation) {
        throw typedError(
          "Observation correction decision was not found",
          404,
          "OBSERVATION_CORRECTION_DECISION_NOT_FOUND",
        );
      }
      if (operation.state !== "active") {
        throw typedError(
          "Observation correction is no longer current",
          409,
          "OBSERVATION_CORRECTION_UNDO_STALE",
        );
      }
      const row = await loadVisibleObservation(
        tx,
        operation.observation_kind,
        operation.observation_id,
        presentationRank(),
      );
      if (
        Number(row.current_revision) !== Number(operation.result_revision) ||
        row.current_decision_id !== operation.decision_id
      ) {
        throw typedError(
          "Observation has a later decision or revision",
          409,
          "OBSERVATION_CORRECTION_UNDO_STALE",
        );
      }
      const undoDecisionId = `decision_${randomUUID().replaceAll("-", "")}`;
      await insertDecision(tx, {
        action: "undo",
        actorId: request.actorId,
        decisionId: undoDecisionId,
        observationId: operation.observation_id,
        reasonCode: "observation_correction_undo",
      });
      if (operation.operation_kind !== "geometry") {
        await tx`
          UPDATE observation_rejection_tombstone
          SET state = 'reverted'
          WHERE operation_id = ${operation.operation_id} AND state = 'active'
        `;
      }
      const prior = operation.prior_region;
      const nextRevision = Number(row.current_revision) + 1;
      const [updated] =
        operation.observation_kind === "face"
          ? await tx`
              UPDATE face_observation SET
                box_x = ${prior.x}, box_y = ${prior.y}, box_w = ${prior.w}, box_h = ${prior.h},
                state = ${operation.prior_state}, current_revision = ${nextRevision},
                current_decision_id = ${undoDecisionId}
              WHERE face_id = ${operation.observation_id}
              RETURNING *
            `
          : await tx`
              UPDATE body_observation SET
                box_x = ${prior.x}, box_y = ${prior.y}, box_w = ${prior.w}, box_h = ${prior.h},
                state = ${operation.prior_state}, current_revision = ${nextRevision},
                current_decision_id = ${undoDecisionId}
              WHERE body_id = ${operation.observation_id}
              RETURNING *
            `;
      const snapshot = operation.snapshot || {};
      if (operation.observation_kind === "face") {
        for (const claim of snapshot.claims || []) {
          if (claim.state === "accepted") {
            const conflicts = await tx`
              SELECT identity_claim_id FROM identity_claim
              WHERE face_id = ${operation.observation_id} AND state = 'accepted'
                AND identity_claim_id <> ${claim.identityClaimId}
            `;
            if (conflicts.length) {
              throw typedError(
                "Face identity changed after the correction",
                409,
                "OBSERVATION_CORRECTION_UNDO_STALE",
              );
            }
          }
          await tx`
            UPDATE identity_claim SET state = ${claim.state}, decision_id = ${claim.decisionId}
            WHERE identity_claim_id = ${claim.identityClaimId} AND state = 'superseded'
          `;
        }
        for (const embeddingId of snapshot.embeddingIds || []) {
          await tx`
            UPDATE face_embedding SET state = 'active'
            WHERE embedding_id = ${embeddingId} AND state = 'superseded'
              AND NOT EXISTS (
                SELECT 1 FROM face_embedding current
                JOIN face_embedding prior ON prior.embedding_id = ${embeddingId}
                WHERE current.face_id = prior.face_id AND current.state = 'active'
                  AND current.model_family = prior.model_family
                  AND current.model_version = prior.model_version
                  AND current.config_digest = prior.config_digest
              )
          `;
        }
      } else {
        for (const bodyTagId of snapshot.bodyTagIds || []) {
          await tx`
            UPDATE body_tag SET state = 'accepted'
            WHERE body_tag_id = ${bodyTagId} AND state = 'superseded'
              AND NOT EXISTS (
                SELECT 1 FROM body_tag current
                JOIN body_tag prior ON prior.body_tag_id = ${bodyTagId}
                WHERE current.body_id = prior.body_id AND current.state = 'accepted'
              )
          `;
        }
        if (snapshot.poseWasValid) {
          await tx`
            UPDATE body_pose_evidence SET state = 'valid'
            WHERE body_id = ${operation.observation_id} AND state = 'invalidated'
          `;
        }
      }
      await tx`
        UPDATE observation_correction_operation
        SET state = 'reverted', undo_decision_id = ${undoDecisionId}, reverted_at = now()
        WHERE operation_id = ${operation.operation_id} AND state = 'active'
      `;
      const result = resultFor(
        updated,
        operation.observation_kind,
        undoDecisionId,
      );
      await insertCommand(tx, request.commandId, "undo", payloadDigest, result);
      return result;
    });
  },
});
