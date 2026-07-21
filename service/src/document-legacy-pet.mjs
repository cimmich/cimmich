import { createHash, randomUUID } from "node:crypto";

const schemaVersion = "cimmich.document-legacy-pet.v1";
const receiptId = "receipt_cimmich_document_lifecycle_compatibility_v1";
const legacyKinds = new Set([
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
const stableId = (prefix) => `${prefix}_${randomUUID().replaceAll("-", "")}`;
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonical(nested)]),
    );
  }
  return value;
};
const digest = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
const cleanActor = (value) => {
  const actor = String(value || "").trim();
  if (!actor || actor.length > 120) {
    throw typedError(
      "A Cimmich actor is required",
      400,
      "DOCUMENT_ACTOR_REQUIRED",
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
      "DOCUMENT_COMMAND_ID_INVALID",
    );
  }
  return commandId;
};
const cleanAssociationId = (value) => {
  const id = String(value || "").trim();
  if (!/^petdoc_[0-9a-f]{32}$/.test(id)) {
    throw typedError(
      "A stable legacy Pet document association ID is required",
      400,
      "DOCUMENT_LEGACY_PET_ID_INVALID",
    );
  }
  return id;
};
const cleanTitle = (value) => {
  const title = String(value || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!title || title.length > 240) {
    throw typedError("displayTitle is invalid", 400, "DOCUMENT_FIELD_INVALID", {
      field: "displayTitle",
    });
  }
  return title;
};
const cleanFilename = (value, assetId, mediaKind) => {
  const filename = String(value || `${assetId}.${mediaKind || "asset"}`)
    .trim()
    .replaceAll("/", "_")
    .replaceAll("\\", "_");
  if (
    !filename ||
    filename.length > 255 ||
    /[\u0000-\u001f\u007f]/.test(filename)
  ) {
    throw typedError(
      "sourceFilename is invalid",
      400,
      "DOCUMENT_FILENAME_INVALID",
    );
  }
  return filename;
};
const cleanTier = (value) => {
  const tier = String(value || "").trim();
  if (!new Set(["standard", "personal", "private"]).has(tier)) {
    throw typedError(
      "visibilityTier is required for legacy adoption",
      400,
      "DOCUMENT_VISIBILITY_INVALID",
    );
  }
  return tier;
};

const beginCommand = async (
  tx,
  { actorId, commandId, commandKind, payload },
) => {
  const actor = cleanActor(actorId);
  const id = cleanCommandId(commandId);
  const requestDigest = digest({ commandKind, payload });
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
  const [existing] = await tx`
    SELECT actor_id, command_kind, request_digest, response_body, state
    FROM cimmich_document_legacy_pet_command WHERE command_id = ${id}
  `;
  if (existing) {
    if (
      existing.actor_id !== actor ||
      existing.command_kind !== commandKind ||
      existing.request_digest !== requestDigest
    ) {
      throw typedError(
        "commandId was already used for a different legacy Pet document command",
        409,
        "DOCUMENT_COMMAND_CONFLICT",
      );
    }
    if (existing.state !== "completed") {
      throw typedError(
        "Legacy Pet document command is already in progress",
        409,
        "DOCUMENT_COMMAND_CONFLICT",
      );
    }
    return { actor, id, replay: { ...existing.response_body, replayed: true } };
  }
  await tx`
    INSERT INTO cimmich_document_legacy_pet_command (
      command_id, actor_id, command_kind, request_digest, state
    ) VALUES (${id}, ${actor}, ${commandKind}, ${requestDigest}, 'started')
  `;
  return { actor, id, replay: null, requestDigest };
};

const completeCommand = async (
  tx,
  { actor, commandId, commandKind, decisionId, requestDigest, response },
) => {
  await tx`
    UPDATE cimmich_document_legacy_pet_command SET
      decision_id = ${decisionId}, response_body = ${tx.json(response)},
      state = 'completed', completed_at = now()
    WHERE command_id = ${commandId} AND actor_id = ${actor}
      AND command_kind = ${commandKind} AND request_digest = ${requestDigest}
  `;
  return response;
};

export const createDocumentLegacyPetStore = (
  sql,
  { presentationRank = () => 0 } = {},
) => ({
  async list({ includeAdopted = false, petId = "" } = {}) {
    const stablePetId = String(petId || "").trim();
    const rows = await sql`
      SELECT legacy.link_id, legacy.pet_id, pet.display_name AS pet_name,
        legacy.asset_id, legacy.document_kind, legacy.document_label,
        legacy.created_at, asset.media_kind, asset.mime_type,
        adoption.adoption_id, adoption.document_id,
        adoption.state AS adoption_state
      FROM current_pet_document legacy
      JOIN person pet ON pet.person_id = legacy.pet_id
        AND pet.subject_kind = 'pet' AND pet.status IN ('active','hidden')
        AND cimmich_visibility_pet_rank(pet.person_id) <= ${presentationRank()}
      JOIN asset ON asset.asset_id = legacy.asset_id AND asset.state = 'active'
      LEFT JOIN cimmich_document_legacy_pet_adoption adoption
        ON adoption.legacy_link_id = legacy.link_id AND adoption.state = 'active'
      WHERE (${stablePetId} = '' OR legacy.pet_id = ${stablePetId})
        AND cimmich_visibility_asset_rank(legacy.asset_id) <= ${presentationRank()}
        AND (${Boolean(includeAdopted)} OR adoption.adoption_id IS NULL)
      ORDER BY legacy.created_at, legacy.link_id
    `;
    return {
      items: rows.map((row) => ({
        adoptedDocumentId: row.document_id || null,
        adoptionId: row.adoption_id || null,
        assetId: row.asset_id,
        documentKind: row.document_kind,
        documentLabel: row.document_label || null,
        legacyAssociationId: row.link_id,
        linkedAt: row.created_at,
        mediaKind: row.media_kind,
        mimeType: row.mime_type,
        petId: row.pet_id,
        petName: row.pet_name,
        state: row.adoption_state === "active" ? "adopted" : "available",
      })),
      schemaVersion,
    };
  },

  async adopt({
    actorId,
    commandId,
    displayTitle,
    legacyAssociationId,
    sourceFilename,
    visibilityTier,
  }) {
    const legacyId = cleanAssociationId(legacyAssociationId);
    const title = cleanTitle(displayTitle);
    const tier = cleanTier(visibilityTier);
    return sql.begin(async (tx) => {
      const prepared = await beginCommand(tx, {
        actorId,
        commandId,
        commandKind: "adopt",
        payload: {
          displayTitle: title,
          legacyAssociationId: legacyId,
          sourceFilename,
          visibilityTier: tier,
        },
      });
      if (prepared.replay) return prepared.replay;
      const [legacy] = await tx`
        SELECT link.link_id, link.pet_id, link.asset_id, link.document_kind,
          link.document_label, asset.content_hash, asset.media_kind, asset.mime_type
        FROM current_pet_document link
        JOIN person pet ON pet.person_id = link.pet_id
          AND pet.subject_kind = 'pet' AND pet.status IN ('active','hidden')
          AND cimmich_visibility_pet_rank(pet.person_id) <= ${presentationRank()}
        JOIN asset ON asset.asset_id = link.asset_id AND asset.state = 'active'
        WHERE link.link_id = ${legacyId}
          AND cimmich_visibility_asset_rank(link.asset_id) <= ${presentationRank()}
        FOR UPDATE OF link, pet, asset
      `;
      if (!legacy) {
        throw typedError(
          "Legacy Pet document association not found",
          404,
          "DOCUMENT_LEGACY_PET_NOT_FOUND",
        );
      }
      if (!legacyKinds.has(legacy.document_kind)) {
        throw typedError(
          "Legacy Pet document kind is unsupported",
          409,
          "DOCUMENT_LEGACY_PET_KIND_INVALID",
        );
      }
      const [activeAdoption] = await tx`
        SELECT adoption_id FROM cimmich_document_legacy_pet_adoption
        WHERE legacy_link_id = ${legacyId} AND state = 'active' FOR UPDATE
      `;
      if (activeAdoption) {
        throw typedError(
          "Legacy Pet document association was already adopted",
          409,
          "DOCUMENT_LEGACY_PET_ALREADY_ADOPTED",
        );
      }
      const [existingDocument] = await tx`
        SELECT document_id, revision, status,
          cimmich_visibility_document_rank(document_id) <= ${presentationRank()} AS visible
        FROM cimmich_document
        WHERE source_kind = 'immich_asset' AND source_asset_id = ${legacy.asset_id}
        FOR UPDATE
      `;
      if (existingDocument && !existingDocument.visible) {
        throw typedError(
          "A more-private Document already owns this source asset",
          409,
          "DOCUMENT_LEGACY_PET_SOURCE_CONFLICT",
        );
      }
      const decisionId = stableId("decision");
      await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'document_legacy_pet', ${legacyId}, 'accept', 'user',
          ${prepared.actor}, 'document_legacy_pet_adopt',
          'Adopt legacy Pet document link into generic Documents', ${receiptId}, 'private'
        )
      `;
      const documentId = existingDocument?.document_id || stableId("document");
      const createdDocument = !existingDocument;
      const reactivatedDocument = existingDocument?.status === "archived";
      if (createdDocument) {
        const filename = cleanFilename(
          sourceFilename,
          legacy.asset_id,
          legacy.media_kind,
        );
        await tx`
          INSERT INTO cimmich_document (
            document_id, source_kind, source_asset_id, source_filename, mime_type,
            content_sha256, source_content_hash, display_title, document_kind,
            document_label, status, visibility_tier, created_by
          ) VALUES (
            ${documentId}, 'immich_asset', ${legacy.asset_id}, ${filename},
            ${legacy.mime_type},
            ${/^[0-9a-f]{64}$/.test(legacy.content_hash || "") ? legacy.content_hash : null},
            ${legacy.content_hash || null}, ${title}, ${legacy.document_kind},
            ${legacy.document_label || null}, 'active', ${tier}, ${prepared.actor}
          )
        `;
      }
      if (reactivatedDocument) {
        await tx`
          UPDATE cimmich_document SET status = 'active', revision = revision + 1,
            updated_at = now() WHERE document_id = ${documentId}
        `;
      }
      const [existingLink] = await tx`
        SELECT link_id FROM current_cimmich_document_link
        WHERE document_id = ${documentId} AND subject_kind = 'pet'
          AND subject_id = ${legacy.pet_id} AND relation_kind = 'about'
        FOR UPDATE
      `;
      const createdLinkId = existingLink ? null : stableId("document_link");
      if (createdLinkId) {
        await tx`
          INSERT INTO cimmich_document_link (
            link_id, document_id, subject_kind, subject_id, relation_kind,
            state, decision_id
          ) VALUES (
            ${createdLinkId}, ${documentId}, 'pet', ${legacy.pet_id}, 'about',
            'current', ${decisionId}
          )
        `;
        if (!createdDocument) {
          await tx`
            UPDATE cimmich_document SET revision = revision + 1, updated_at = now()
            WHERE document_id = ${documentId}
          `;
        }
      }
      const [{ revision: documentRevisionAfter }] = await tx`
        SELECT revision FROM cimmich_document WHERE document_id = ${documentId}
      `;
      const [previous] = await tx`
        SELECT adoption_id FROM cimmich_document_legacy_pet_adoption
        WHERE legacy_link_id = ${legacyId}
        ORDER BY created_at DESC, adoption_id DESC LIMIT 1
      `;
      const adoptionId = stableId("document_pet_adoption");
      await tx`
        INSERT INTO cimmich_document_legacy_pet_adoption (
          adoption_id, legacy_link_id, document_id, created_document,
          reactivated_document, document_revision_after, created_link_id,
          command_id, decision_id, state, supersedes_adoption_id
        ) VALUES (
          ${adoptionId}, ${legacyId}, ${documentId}, ${createdDocument},
          ${reactivatedDocument}, ${documentRevisionAfter}, ${createdLinkId},
          ${prepared.id}, ${decisionId}, 'active',
          ${previous?.adoption_id || null}
        )
      `;
      const response = {
        adoptionId,
        changed: true,
        createdDocument,
        createdLink: Boolean(createdLinkId),
        decisionId,
        documentId,
        legacyAssociationId: legacyId,
        reactivatedDocument,
        replayed: false,
        schemaVersion,
      };
      return completeCommand(tx, {
        actor: prepared.actor,
        commandId: prepared.id,
        commandKind: "adopt",
        decisionId,
        requestDigest: prepared.requestDigest,
        response,
      });
    });
  },

  async undo({ actorId, commandId, decisionId }) {
    const originalDecisionId = String(decisionId || "").trim();
    if (!/^decision_[0-9a-f]{32}$/.test(originalDecisionId)) {
      throw typedError(
        "A stable adoption decision ID is required",
        400,
        "DOCUMENT_DECISION_INVALID",
      );
    }
    return sql.begin(async (tx) => {
      const prepared = await beginCommand(tx, {
        actorId,
        commandId,
        commandKind: "undo",
        payload: { decisionId: originalDecisionId },
      });
      if (prepared.replay) return prepared.replay;
      const [adoption] = await tx`
        SELECT * FROM cimmich_document_legacy_pet_adoption
        WHERE decision_id = ${originalDecisionId} FOR UPDATE
      `;
      if (!adoption) {
        throw typedError(
          "Legacy Pet adoption decision not found",
          404,
          "DOCUMENT_DECISION_NOT_FOUND",
        );
      }
      if (adoption.state !== "active") {
        throw typedError(
          "Legacy Pet adoption is stale",
          409,
          "DOCUMENT_UNDO_STALE",
        );
      }
      const [document] = await tx`
        SELECT document_id, revision, status FROM cimmich_document
        WHERE document_id = ${adoption.document_id} FOR UPDATE
      `;
      if (!document) {
        throw typedError(
          "Document no longer exists",
          409,
          "DOCUMENT_UNDO_STALE",
        );
      }
      if (
        (adoption.created_document ||
          adoption.reactivated_document ||
          adoption.created_link_id) &&
        Number(document.revision) !== Number(adoption.document_revision_after)
      ) {
        throw typedError(
          "The adopted Document changed and can no longer be undone safely",
          409,
          "DOCUMENT_UNDO_STALE",
        );
      }
      if (adoption.created_document || adoption.reactivated_document) {
        const [state] = await tx`
          SELECT count(*)::int AS link_count FROM current_cimmich_document_link
          WHERE document_id = ${adoption.document_id}
            AND (${adoption.created_link_id}::text IS NULL OR link_id <> ${adoption.created_link_id})
        `;
        if (document.status !== "active" || Number(state.link_count) > 0) {
          throw typedError(
            "The adopted Document changed and can no longer be undone safely",
            409,
            "DOCUMENT_UNDO_STALE",
          );
        }
      }
      const undoDecisionId = stableId("decision");
      await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, producer_receipt_id, privacy_class,
          supersedes_decision_id
        ) VALUES (
          ${undoDecisionId}, 'document_legacy_pet', ${adoption.legacy_link_id},
          'restore', 'user', ${prepared.actor}, 'document_legacy_pet_undo',
          'Undo legacy Pet document adoption', ${receiptId}, 'private',
          ${originalDecisionId}
        )
      `;
      if (adoption.created_link_id) {
        await tx`
          UPDATE cimmich_document_link SET state = 'superseded'
          WHERE link_id = ${adoption.created_link_id} AND state = 'current'
        `;
      }
      if (adoption.created_document || adoption.reactivated_document) {
        await tx`
          UPDATE cimmich_document SET status = 'archived', revision = revision + 1,
            updated_at = now() WHERE document_id = ${adoption.document_id}
        `;
      } else if (adoption.created_link_id) {
        await tx`
          UPDATE cimmich_document SET revision = revision + 1, updated_at = now()
          WHERE document_id = ${adoption.document_id}
        `;
      }
      await tx`
        UPDATE cimmich_document_legacy_pet_adoption SET
          state = 'undone', undo_decision_id = ${undoDecisionId}, undone_at = now()
        WHERE adoption_id = ${adoption.adoption_id}
      `;
      const response = {
        adoptionId: adoption.adoption_id,
        changed: true,
        decisionId: undoDecisionId,
        documentId: adoption.document_id,
        legacyAssociationId: adoption.legacy_link_id,
        replayed: false,
        schemaVersion,
        undoneDecisionId: originalDecisionId,
      };
      return completeCommand(tx, {
        actor: prepared.actor,
        commandId: prepared.id,
        commandKind: "undo",
        decisionId: undoDecisionId,
        requestDigest: prepared.requestDigest,
        response,
      });
    });
  },
});

export const documentLegacyPetContract = Object.freeze({ schemaVersion });
