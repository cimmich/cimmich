import { createHash, randomUUID } from "node:crypto";

const schemaVersion = "cimmich.pet-document.v1";
const receiptId = "receipt_cimmich_pet_profile_document_v1";
const documentKinds = new Set([
  "veterinary",
  "vaccination",
  "registration",
  "insurance",
  "adoption",
  "receipt",
  "care",
  "other",
]);

const typedError = (message, statusCode, code, details) =>
  Object.assign(new Error(message), {
    code,
    statusCode,
    ...(details ? { details } : {}),
  });

const canonicalValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalValue(nested)]),
    );
  }
  return value;
};

const digest = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex");

const cleanActor = (value) => {
  const actor = String(value || "").trim();
  if (!actor || actor.length > 120) {
    throw typedError(
      "A Cimmich actor of 1 to 120 characters is required",
      400,
      "PET_DOCUMENT_ACTOR_REQUIRED",
    );
  }
  return actor;
};

const cleanCommandId = (value) => {
  const commandId = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$/.test(commandId)) {
    throw typedError(
      "A stable commandId of 8 to 120 safe characters is required",
      400,
      "PET_DOCUMENT_COMMAND_ID_INVALID",
    );
  }
  return commandId;
};

const cleanAssetIds = (value) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw typedError(
      "assetIds must contain 1 to 100 stable Cimmich asset IDs",
      400,
      "PET_DOCUMENT_ASSET_IDS_INVALID",
    );
  }
  const ids = value.map((item) => String(item || "").trim());
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    throw typedError(
      "assetIds must contain unique non-blank stable IDs",
      400,
      "PET_DOCUMENT_ASSET_IDS_INVALID",
    );
  }
  return ids;
};

const cleanKind = (value) => {
  const kind = String(value || "").trim();
  if (!documentKinds.has(kind)) {
    throw typedError(
      "documentKind is not supported",
      400,
      "PET_DOCUMENT_KIND_INVALID",
    );
  }
  return kind;
};

const cleanLabel = (value) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }
  const label = String(value).trim().replace(/\s+/g, " ");
  if (label.length > 120) {
    throw typedError(
      "documentLabel must be 120 characters or fewer",
      400,
      "PET_DOCUMENT_LABEL_INVALID",
    );
  }
  return label;
};

const cleanDocuments = (value) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw typedError(
      "documents must contain 1 to 100 stable Cimmich assets",
      400,
      "PET_DOCUMENT_ITEMS_INVALID",
    );
  }
  const documents = value.map((item) => ({
    assetId: String(item?.assetId || "").trim(),
    documentKind: cleanKind(item?.documentKind),
    documentLabel: cleanLabel(item?.documentLabel),
  }));
  if (
    documents.some((item) => !item.assetId) ||
    new Set(documents.map((item) => item.assetId)).size !== documents.length
  ) {
    throw typedError(
      "documents must target unique non-blank stable asset IDs",
      400,
      "PET_DOCUMENT_ITEMS_INVALID",
    );
  }
  return documents;
};

const requirePet = async (
  executor,
  petId,
  { lock = false, presentationRank = () => 0 } = {},
) => {
  const id = String(petId || "").trim();
  const rows = lock
    ? await executor`
        SELECT person_id, subject_kind, status
        FROM person
        WHERE person_id = ${id} AND status IN ('active','hidden')
          AND cimmich_visibility_pet_rank(person_id) <= ${presentationRank()}
        FOR UPDATE
      `
    : await executor`
        SELECT person_id, subject_kind, status
        FROM person
        WHERE person_id = ${id} AND status IN ('active','hidden')
          AND cimmich_visibility_pet_rank(person_id) <= ${presentationRank()}
      `;
  const pet = rows[0];
  if (!pet || pet.subject_kind !== "pet") {
    throw typedError("Pet not found", 404, "PET_DOCUMENT_PET_NOT_FOUND");
  }
  return pet;
};

const requireAssets = async (executor, assetIds) => {
  const rows = await executor`
    SELECT asset_id FROM asset
    WHERE asset_id = ANY(${assetIds}) AND state = 'active'
    ORDER BY asset_id
    FOR UPDATE
  `;
  const found = new Set(rows.map((row) => row.asset_id));
  const missing = assetIds.filter((assetId) => !found.has(assetId));
  if (missing.length) {
    throw typedError(
      "One or more active Cimmich document assets were not found",
      404,
      "PET_DOCUMENT_ASSET_NOT_FOUND",
      { missingAssetIds: missing },
    );
  }
};

const beginCommand = async (
  tx,
  { actorId, commandId, commandKind, payload },
) => {
  const id = cleanCommandId(commandId);
  const requestDigest = digest({ commandKind, payload });
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
  const [existing] = await tx`
    SELECT command_kind, actor_id, request_digest, response
    FROM pet_document_command WHERE command_id = ${id}
  `;
  if (existing) {
    if (
      existing.command_kind !== commandKind ||
      existing.actor_id !== actorId ||
      existing.request_digest !== requestDigest
    ) {
      throw typedError(
        "commandId was already used for a different Pet document command",
        409,
        "PET_DOCUMENT_COMMAND_CONFLICT",
      );
    }
    return { commandId: id, replay: { ...existing.response, replayed: true } };
  }
  return { commandId: id, replay: null, requestDigest };
};

const completeCommand = async (
  tx,
  { actorId, command, commandKind, decisionId, response },
) => {
  await tx`
    INSERT INTO pet_document_command (
      command_id, command_kind, actor_id, request_digest, decision_id, response
    ) VALUES (
      ${command.commandId}, ${commandKind}, ${actorId},
      ${command.requestDigest}, ${decisionId}, ${tx.json(response)}
    )
  `;
  return response;
};

const loadDocuments = async (
  executor,
  { bridgeFields, petId, presentationRank },
) => {
  const pet = await requirePet(executor, petId, { presentationRank });
  const rows = await executor`
    SELECT document.link_id, document.asset_id, document.document_kind,
      document.document_label, document.created_at, asset.capture_time,
      asset.media_kind, asset.mime_type, asset.width, asset.height
    FROM current_pet_document document
    JOIN asset ON asset.asset_id = document.asset_id AND asset.state = 'active'
    WHERE document.pet_id = ${pet.person_id}
      AND cimmich_visibility_asset_rank(document.asset_id) <= ${presentationRank()}
    ORDER BY document.created_at DESC, document.link_id DESC
  `;
  return {
    items: rows.map((row) => ({
      assetId: row.asset_id,
      associationId: row.link_id,
      captureTime: row.capture_time,
      documentKind: row.document_kind,
      documentLabel: row.document_label || null,
      height: row.height,
      linkedAt: row.created_at,
      mediaKind: row.media_kind,
      mimeType: row.mime_type,
      ...bridgeFields(row.asset_id),
      width: row.width,
    })),
    petId: pet.person_id,
    schemaVersion,
  };
};

export const createPetDocumentStore = (
  sql,
  { bridgeFields = () => ({}), presentationRank = () => 0 } = {},
) => ({
  list: ({ petId }) =>
    loadDocuments(sql, { bridgeFields, petId, presentationRank }),

  async attach({ actorId, commandId, documents, petId }) {
    const actor = cleanActor(actorId);
    const items = cleanDocuments(documents);
    return sql.begin(async (tx) => {
      const command = await beginCommand(tx, {
        actorId: actor,
        commandId,
        commandKind: "attach",
        payload: { documents: items, petId },
      });
      if (command.replay) return command.replay;
      const pet = await requirePet(tx, petId, {
        lock: true,
        presentationRank,
      });
      await requireAssets(
        tx,
        items.map((item) => item.assetId),
      );
      const rows = await tx`
        SELECT link_id, asset_id, document_kind, document_label, state
        FROM pet_document_link
        WHERE pet_id = ${pet.person_id}
          AND asset_id = ANY(${items.map((item) => item.assetId)})
          AND state IN ('accepted','rejected')
        FOR UPDATE
      `;
      const currentByAsset = new Map(rows.map((row) => [row.asset_id, row]));
      const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
      await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'pet_document', ${pet.person_id}, 'attach', 'user',
          ${actor}, 'pet_document_manual_attach',
          ${`Attach ${items.length} Pet document asset(s)`}, ${receiptId}, 'private'
        )
      `;
      const snapshot = [];
      const unchangedAssetIds = [];
      for (const item of items) {
        const current = currentByAsset.get(item.assetId);
        if (
          current?.state === "accepted" &&
          current.document_kind === item.documentKind &&
          (current.document_label || null) === item.documentLabel
        ) {
          unchangedAssetIds.push(item.assetId);
          continue;
        }
        if (current) {
          await tx`
            UPDATE pet_document_link SET state = 'superseded'
            WHERE link_id = ${current.link_id}
          `;
        }
        const linkId = `petdoc_${randomUUID().replaceAll("-", "")}`;
        await tx`
          INSERT INTO pet_document_link (
            link_id, pet_id, asset_id, document_kind, document_label, state,
            decision_id, supersedes_link_id, producer_receipt_id
          ) VALUES (
            ${linkId}, ${pet.person_id}, ${item.assetId}, ${item.documentKind},
            ${item.documentLabel}, 'accepted', ${decisionId},
            ${current?.link_id || null}, ${receiptId}
          )
        `;
        snapshot.push({
          assetId: item.assetId,
          createdLinkId: linkId,
          previousDocumentKind: current?.document_kind || null,
          previousDocumentLabel: current?.document_label || null,
          previousLinkId: current?.link_id || null,
          previousState: current?.state || null,
        });
      }
      const operationId = snapshot.length
        ? `petdocop_${randomUUID().replaceAll("-", "")}`
        : null;
      const documentsProjection = await loadDocuments(tx, {
        bridgeFields,
        petId: pet.person_id,
        presentationRank,
      });
      const response = {
        changedAssetIds: snapshot.map((item) => item.assetId),
        decisionId,
        documents: documentsProjection,
        replayed: false,
        schemaVersion,
        status: snapshot.length ? "applied" : "no_change",
        unchangedAssetIds,
        undo: {
          eligible: Boolean(operationId),
          token: operationId ? decisionId : null,
        },
      };
      await completeCommand(tx, {
        actorId: actor,
        command,
        commandKind: "attach",
        decisionId,
        response,
      });
      if (operationId) {
        await tx`
          INSERT INTO pet_document_operation (
            operation_id, command_id, pet_id, action, decision_id, state,
            snapshot
          ) VALUES (
            ${operationId}, ${command.commandId}, ${pet.person_id}, 'attach',
            ${decisionId}, 'active', ${tx.json(snapshot)}
          )
        `;
      }
      return response;
    });
  },

  async detach({ actorId, assetIds, commandId, petId }) {
    const actor = cleanActor(actorId);
    const ids = cleanAssetIds(assetIds);
    return sql.begin(async (tx) => {
      const command = await beginCommand(tx, {
        actorId: actor,
        commandId,
        commandKind: "detach",
        payload: { assetIds: ids, petId },
      });
      if (command.replay) return command.replay;
      const pet = await requirePet(tx, petId, {
        lock: true,
        presentationRank,
      });
      await requireAssets(tx, ids);
      const rows = await tx`
        SELECT link_id, asset_id, document_kind, document_label, state
        FROM pet_document_link
        WHERE pet_id = ${pet.person_id} AND asset_id = ANY(${ids})
          AND state IN ('accepted','rejected')
        FOR UPDATE
      `;
      const currentByAsset = new Map(rows.map((row) => [row.asset_id, row]));
      const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
      await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'pet_document', ${pet.person_id}, 'detach', 'user',
          ${actor}, 'pet_document_manual_detach',
          ${`Detach ${ids.length} Pet document asset(s)`}, ${receiptId}, 'private'
        )
      `;
      const snapshot = [];
      const unchangedAssetIds = [];
      for (const assetId of ids) {
        const current = currentByAsset.get(assetId);
        if (!current || current.state !== "accepted") {
          unchangedAssetIds.push(assetId);
          continue;
        }
        await tx`
          UPDATE pet_document_link SET state = 'superseded'
          WHERE link_id = ${current.link_id}
        `;
        const linkId = `petdoc_${randomUUID().replaceAll("-", "")}`;
        await tx`
          INSERT INTO pet_document_link (
            link_id, pet_id, asset_id, document_kind, document_label, state,
            decision_id, supersedes_link_id, producer_receipt_id
          ) VALUES (
            ${linkId}, ${pet.person_id}, ${assetId}, ${current.document_kind},
            ${current.document_label}, 'rejected', ${decisionId},
            ${current.link_id}, ${receiptId}
          )
        `;
        snapshot.push({
          assetId,
          createdLinkId: linkId,
          previousDocumentKind: current.document_kind,
          previousDocumentLabel: current.document_label || null,
          previousLinkId: current.link_id,
          previousState: current.state,
        });
      }
      const operationId = snapshot.length
        ? `petdocop_${randomUUID().replaceAll("-", "")}`
        : null;
      const documentsProjection = await loadDocuments(tx, {
        bridgeFields,
        petId: pet.person_id,
        presentationRank,
      });
      const response = {
        changedAssetIds: snapshot.map((item) => item.assetId),
        decisionId,
        documents: documentsProjection,
        replayed: false,
        schemaVersion,
        status: snapshot.length ? "applied" : "no_change",
        unchangedAssetIds,
        undo: {
          eligible: Boolean(operationId),
          token: operationId ? decisionId : null,
        },
      };
      await completeCommand(tx, {
        actorId: actor,
        command,
        commandKind: "detach",
        decisionId,
        response,
      });
      if (operationId) {
        await tx`
          INSERT INTO pet_document_operation (
            operation_id, command_id, pet_id, action, decision_id, state,
            snapshot
          ) VALUES (
            ${operationId}, ${command.commandId}, ${pet.person_id}, 'detach',
            ${decisionId}, 'active', ${tx.json(snapshot)}
          )
        `;
      }
      return response;
    });
  },

  async undo({ actorId, commandId, decisionId }) {
    const actor = cleanActor(actorId);
    const originalDecisionId = String(decisionId || "").trim();
    return sql.begin(async (tx) => {
      const command = await beginCommand(tx, {
        actorId: actor,
        commandId,
        commandKind: "undo",
        payload: { decisionId: originalDecisionId },
      });
      if (command.replay) return command.replay;
      const [operation] = await tx`
        SELECT operation_id, pet_id, decision_id, state, snapshot
        FROM pet_document_operation
        WHERE decision_id = ${originalDecisionId}
        FOR UPDATE
      `;
      if (!operation || operation.state !== "active") {
        throw typedError(
          "This Pet document decision is superseded or not reversible",
          409,
          "PET_DOCUMENT_UNDO_NOT_AVAILABLE",
        );
      }
      const pet = await requirePet(tx, operation.pet_id, {
        lock: true,
        presentationRank,
      });
      for (const item of operation.snapshot || []) {
        const [current] = await tx`
          SELECT link_id FROM pet_document_link
          WHERE link_id = ${item.createdLinkId}
            AND pet_id = ${pet.person_id}
            AND state IN ('accepted','rejected')
          FOR UPDATE
        `;
        if (!current) {
          throw typedError(
            "Pet document projection changed after this decision",
            409,
            "PET_DOCUMENT_UNDO_SUPERSEDED",
            { assetId: item.assetId },
          );
        }
      }
      const undoDecisionId = `decision_${randomUUID().replaceAll("-", "")}`;
      await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, supersedes_decision_id, producer_receipt_id,
          privacy_class
        ) VALUES (
          ${undoDecisionId}, 'pet_document', ${pet.person_id}, 'undo', 'user',
          ${actor}, 'pet_document_manual_undo', 'Undo Pet document association',
          ${operation.decision_id}, ${receiptId}, 'private'
        )
      `;
      const restoredAssetIds = [];
      for (const item of operation.snapshot || []) {
        await tx`
          UPDATE pet_document_link SET state = 'superseded'
          WHERE link_id = ${item.createdLinkId}
        `;
        await tx`
          INSERT INTO pet_document_link (
            link_id, pet_id, asset_id, document_kind, document_label, state,
            decision_id, supersedes_link_id, producer_receipt_id
          ) VALUES (
            ${`petdoc_${randomUUID().replaceAll("-", "")}`}, ${pet.person_id},
            ${item.assetId},
            ${item.previousDocumentKind || "other"},
            ${item.previousDocumentLabel},
            ${item.previousState === "accepted" ? "accepted" : "rejected"},
            ${undoDecisionId}, ${item.createdLinkId}, ${receiptId}
          )
        `;
        restoredAssetIds.push(item.assetId);
      }
      await tx`
        UPDATE pet_document_operation SET
          state = 'reverted', undo_decision_id = ${undoDecisionId},
          reverted_at = now()
        WHERE operation_id = ${operation.operation_id}
      `;
      const documentsProjection = await loadDocuments(tx, {
        bridgeFields,
        petId: pet.person_id,
        presentationRank,
      });
      const response = {
        decisionId: undoDecisionId,
        documents: documentsProjection,
        replayed: false,
        restoredAssetIds,
        schemaVersion,
        status: "reverted",
        supersedesDecisionId: operation.decision_id,
      };
      return completeCommand(tx, {
        actorId: actor,
        command,
        commandKind: "undo",
        decisionId: undoDecisionId,
        response,
      });
    });
  },
});

export const petDocumentContract = Object.freeze({
  documentKinds: [...documentKinds],
  schemaVersion,
});
