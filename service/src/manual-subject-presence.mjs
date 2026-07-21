import { createHash, randomUUID } from "node:crypto";

export const manualSubjectPresenceSchemaVersion =
  "cimmich.manual-subject-presence.v1";

const receiptId = "receipt_cimmich_manual_subject_presence_v1";
const subjectKinds = new Set(["person", "pet"]);
const actions = new Set(["attach", "detach"]);

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

const digestCommand = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex");

const cleanActor = (value) => {
  const actor = String(value || "")
    .trim()
    .slice(0, 120);
  if (!actor) {
    throw typedError(
      "A Cimmich actor is required",
      400,
      "MANUAL_PRESENCE_ACTOR_REQUIRED",
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
      "MANUAL_PRESENCE_COMMAND_ID_INVALID",
    );
  }
  return commandId;
};

const cleanStableId = (value, field) => {
  const id = String(value || "").trim();
  if (!id || id.length > 200) {
    throw typedError(
      `${field} must be a stable Cimmich ID`,
      400,
      `MANUAL_PRESENCE_${field.replace(/Id$/, "").toUpperCase()}_INVALID`,
    );
  }
  return id;
};

const cleanSubjectKind = (value) => {
  const subjectKind = String(value || "").trim();
  if (!subjectKinds.has(subjectKind)) {
    throw typedError(
      "subjectKind must be person or pet",
      400,
      "MANUAL_PRESENCE_SUBJECT_KIND_INVALID",
    );
  }
  return subjectKind;
};

const cleanAction = (value) => {
  const action = String(value || "").trim();
  if (!actions.has(action)) {
    throw typedError(
      "action must be attach or detach",
      400,
      "MANUAL_PRESENCE_ACTION_INVALID",
    );
  }
  return action;
};

const cleanCoordinate = (value, key) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw typedError(
      `geometry.${key} must be a finite normalized number`,
      400,
      "MANUAL_PRESENCE_GEOMETRY_INVALID",
      { field: key },
    );
  }
  if (value < 0 || value > 1) {
    throw typedError(
      `geometry.${key} must be between 0 and 1`,
      400,
      "MANUAL_PRESENCE_GEOMETRY_INVALID",
      { field: key },
    );
  }
  return Object.is(value, -0) ? 0 : value;
};

export const cleanManualPresenceGeometry = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw typedError(
      "geometry must be null, a normalized point, or a normalized region",
      400,
      "MANUAL_PRESENCE_GEOMETRY_INVALID",
    );
  }
  const kind = String(value.kind || "");
  const x = cleanCoordinate(value.x, "x");
  const y = cleanCoordinate(value.y, "y");
  if (kind === "point") {
    if (value.w !== undefined || value.h !== undefined) {
      throw typedError(
        "Point geometry cannot include width or height",
        400,
        "MANUAL_PRESENCE_GEOMETRY_INVALID",
      );
    }
    return { kind, x, y };
  }
  if (kind === "region") {
    const w = cleanCoordinate(value.w, "w");
    const h = cleanCoordinate(value.h, "h");
    if (w <= 0 || h <= 0 || x + w > 1 || y + h > 1) {
      throw typedError(
        "Region geometry must have positive size and remain inside the image",
        400,
        "MANUAL_PRESENCE_GEOMETRY_INVALID",
      );
    }
    return { h, kind, w, x, y };
  }
  throw typedError(
    "geometry.kind must be point or region",
    400,
    "MANUAL_PRESENCE_GEOMETRY_INVALID",
  );
};

const reasonForKind = (subjectKind) =>
  subjectKind === "pet" ? "manual_pet" : "manual_person";

const compatibleReasons = {
  person: new Set(["manual_person", "manual_presence"]),
  pet: new Set(["manual_pet", "manual_pet_undo"]),
};

const sameGeometry = (left, right) =>
  JSON.stringify(canonicalValue(left ?? null)) ===
  JSON.stringify(canonicalValue(right ?? null));

const projectAssociation = (row) =>
  row && row.state === "accepted"
    ? {
        associationId: row.presence_tag_id,
        assetId: row.asset_id,
        decisionId: row.decision_id || null,
        displayName: row.display_name || "",
        geometry: row.manual_geometry || null,
        origin: row.origin,
        reasonCode: row.reason_code,
        state: "accepted",
        subjectId: row.person_id,
        subjectKind: row.subject_kind,
      }
    : null;

const loadCurrent = async (executor, { assetId, subjectId }) => {
  const [row] = await executor`
    SELECT tag.presence_tag_id, tag.person_id, tag.asset_id, tag.origin,
      tag.reason_code, tag.note, tag.state, tag.confidence, tag.decision_id,
      tag.manual_geometry, subject.display_name, subject.subject_kind
    FROM presence_tag tag
    JOIN person subject ON subject.person_id = tag.person_id
    WHERE tag.person_id = ${subjectId} AND tag.asset_id = ${assetId}
      AND tag.state <> 'superseded'
      AND NOT EXISTS (
        SELECT 1 FROM presence_tag newer
        WHERE newer.supersedes_presence_tag_id = tag.presence_tag_id
      )
    ORDER BY tag.created_at DESC, tag.presence_tag_id DESC
    LIMIT 1
  `;
  return row || null;
};

const beginCommand = async (
  tx,
  { actorId, commandId, commandKind, payload },
) => {
  const id = cleanCommandId(commandId);
  const requestDigest = digestCommand({ commandKind, payload });
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
  const [existing] = await tx`
    SELECT command_kind, actor_id, request_digest, response
    FROM manual_subject_presence_command
    WHERE command_id = ${id}
  `;
  if (existing) {
    if (
      existing.command_kind !== commandKind ||
      existing.actor_id !== actorId ||
      existing.request_digest !== requestDigest
    ) {
      throw typedError(
        "commandId was already used for a different manual Presence command",
        409,
        "MANUAL_PRESENCE_COMMAND_CONFLICT",
      );
    }
    return {
      commandId: id,
      replay: { ...existing.response, replayed: true },
      requestDigest,
    };
  }
  return { commandId: id, replay: null, requestDigest };
};

const completeCommand = async (
  tx,
  { actorId, command, commandKind, decisionId, response },
) => {
  await tx`
    INSERT INTO manual_subject_presence_command (
      command_id, command_kind, actor_id, request_digest, decision_id,
      response, producer_receipt_id, privacy_class
    ) VALUES (
      ${command.commandId}, ${commandKind}, ${actorId},
      ${command.requestDigest}, ${decisionId || null}, ${tx.json(response)},
      ${receiptId}, 'private'
    )
  `;
  return response;
};

export const createManualSubjectPresenceStore = (
  sql,
  { presentationRank = () => 0 } = {},
) => {
  const requireVisibleAsset = async (
    executor,
    assetId,
    { lock = false } = {},
  ) => {
    const rows = await executor`
      SELECT asset_id FROM asset
      WHERE asset_id = ${assetId} AND state = 'active'
        AND cimmich_visibility_asset_rank(asset_id) <= ${presentationRank()}
      ${lock ? executor`FOR UPDATE` : executor``}
    `;
    if (!rows[0]) {
      throw typedError(
        "Active Cimmich asset was not found in the current viewing mode",
        404,
        "MANUAL_PRESENCE_ASSET_NOT_VISIBLE",
      );
    }
  };

  const requireSubject = async (executor, subjectId, subjectKind) => {
    const [subject] = await executor`
      SELECT person_id, display_name, subject_kind, status
      FROM person
      WHERE person_id = ${subjectId} AND status = 'active'
        AND cimmich_visibility_subject_rank(subject_kind, person_id)
          <= ${presentationRank()}
      FOR UPDATE
    `;
    if (!subject) {
      throw typedError(
        "Active Cimmich subject was not found",
        404,
        "MANUAL_PRESENCE_SUBJECT_NOT_FOUND",
      );
    }
    if (subject.subject_kind !== subjectKind) {
      throw typedError(
        "subjectKind does not match the stable Cimmich subject",
        409,
        "MANUAL_PRESENCE_SUBJECT_KIND_MISMATCH",
      );
    }
    return subject;
  };

  const list = async ({ assetId }) => {
    const stableAssetId = cleanStableId(assetId, "assetId");
    await requireVisibleAsset(sql, stableAssetId);
    const rows = await sql`
      SELECT tag.presence_tag_id, tag.person_id, tag.asset_id, tag.origin,
        tag.reason_code, tag.state, tag.decision_id, tag.manual_geometry,
        subject.display_name, subject.subject_kind
      FROM current_presence_tag tag
      JOIN person subject ON subject.person_id = tag.person_id
        AND subject.status = 'active'
      WHERE tag.asset_id = ${stableAssetId} AND tag.state = 'accepted'
        AND cimmich_visibility_subject_rank(
          subject.subject_kind, subject.person_id
        ) <= ${presentationRank()}
        AND (
          (subject.subject_kind = 'person'
            AND tag.reason_code IN ('manual_person','manual_presence'))
          OR (subject.subject_kind = 'pet'
            AND tag.reason_code IN ('manual_pet','manual_pet_undo'))
        )
      ORDER BY subject.subject_kind,
        coalesce(subject.display_name, subject.person_id), subject.person_id
    `;
    return {
      assetId: stableAssetId,
      items: rows.map(projectAssociation),
      schemaVersion: manualSubjectPresenceSchemaVersion,
    };
  };

  const modify = async ({
    action,
    actorId,
    assetId,
    commandId,
    geometry,
    subjectId,
    subjectKind,
  }) => {
    const actor = cleanActor(actorId);
    const stableAssetId = cleanStableId(assetId, "assetId");
    const stableSubjectId = cleanStableId(subjectId, "subjectId");
    const kind = cleanSubjectKind(subjectKind);
    const commandKind = cleanAction(action);
    if (
      commandKind === "detach" &&
      geometry !== undefined &&
      geometry !== null
    ) {
      throw typedError(
        "Detach does not accept geometry",
        400,
        "MANUAL_PRESENCE_GEOMETRY_INVALID",
      );
    }
    const normalizedGeometry =
      commandKind === "attach" ? cleanManualPresenceGeometry(geometry) : null;
    const payload = {
      action: commandKind,
      assetId: stableAssetId,
      geometry: normalizedGeometry,
      subjectId: stableSubjectId,
      subjectKind: kind,
    };

    return sql.begin(async (tx) => {
      const command = await beginCommand(tx, {
        actorId: actor,
        commandId,
        commandKind,
        payload,
      });
      if (command.replay) return command.replay;
      await requireVisibleAsset(tx, stableAssetId, { lock: true });
      const subject = await requireSubject(tx, stableSubjectId, kind);
      const current = await loadCurrent(tx, {
        assetId: stableAssetId,
        subjectId: stableSubjectId,
      });
      const compatible =
        !current || compatibleReasons[kind].has(current.reason_code);
      if (current?.state === "accepted" && !compatible) {
        throw typedError(
          "Existing accepted Presence has different authority and was not changed",
          409,
          "MANUAL_PRESENCE_AUTHORITY_CONFLICT",
          { reasonCode: current.reason_code },
        );
      }

      const noChange =
        commandKind === "attach"
          ? current?.state === "accepted" &&
            compatible &&
            sameGeometry(current.manual_geometry, normalizedGeometry)
          : current?.state !== "accepted";
      if (noChange) {
        const response = {
          action: commandKind,
          association: projectAssociation(current),
          assetId: stableAssetId,
          changed: false,
          decisionId: null,
          replayed: false,
          schemaVersion: manualSubjectPresenceSchemaVersion,
          status: "no_change",
          subject: {
            displayName: subject.display_name || "",
            subjectId: subject.person_id,
            subjectKind: subject.subject_kind,
          },
          undo: { eligible: false, decisionId: null },
        };
        return completeCommand(tx, {
          actorId: actor,
          command,
          commandKind,
          decisionId: null,
          response,
        });
      }

      const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
      await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'asset_subject_presence',
          ${`${kind}:${stableSubjectId}:${stableAssetId}`}, ${commandKind},
          'user', ${actor}, ${`manual_subject_presence_${commandKind}`},
          ${`${commandKind === "attach" ? "Attach" : "Detach"} manual ${kind} Presence`},
          ${receiptId}, 'private'
        )
      `;
      if (current) {
        await tx`
          UPDATE presence_tag SET state = 'superseded'
          WHERE presence_tag_id = ${current.presence_tag_id}
        `;
      }
      const presenceTagId = `presence_tag_${randomUUID().replaceAll("-", "")}`;
      const nextGeometry =
        commandKind === "attach"
          ? normalizedGeometry
          : current?.manual_geometry || null;
      await tx`
        INSERT INTO presence_tag (
          presence_tag_id, person_id, asset_id, origin, reason_code, note,
          state, confidence, decision_id, supersedes_presence_tag_id,
          producer_receipt_id, privacy_class, manual_geometry
        ) VALUES (
          ${presenceTagId}, ${stableSubjectId}, ${stableAssetId}, 'user',
          ${reasonForKind(kind)}, '',
          ${commandKind === "attach" ? "accepted" : "rejected"}, 1,
          ${decisionId}, ${current?.presence_tag_id || null}, ${receiptId},
          'private', ${nextGeometry ? tx.json(nextGeometry) : null}
        )
      `;
      await tx`
        UPDATE person SET current_revision = current_revision + 1
        WHERE person_id = ${stableSubjectId}
      `;
      const created = await loadCurrent(tx, {
        assetId: stableAssetId,
        subjectId: stableSubjectId,
      });
      const response = {
        action: commandKind,
        association: projectAssociation(created),
        assetId: stableAssetId,
        changed: true,
        decisionId,
        replayed: false,
        schemaVersion: manualSubjectPresenceSchemaVersion,
        status: "applied",
        subject: {
          displayName: subject.display_name || "",
          subjectId: subject.person_id,
          subjectKind: subject.subject_kind,
        },
        undo: { decisionId, eligible: true },
      };
      await completeCommand(tx, {
        actorId: actor,
        command,
        commandKind,
        decisionId,
        response,
      });
      await tx`
        INSERT INTO manual_subject_presence_operation (
          operation_id, command_id, subject_id, subject_kind, asset_id, action,
          decision_id, created_presence_tag_id, previous_presence_tag_id,
          snapshot, state, producer_receipt_id, privacy_class
        ) VALUES (
          ${`manualpresenceop_${randomUUID().replaceAll("-", "")}`},
          ${command.commandId}, ${stableSubjectId}, ${kind}, ${stableAssetId},
          ${commandKind}, ${decisionId}, ${presenceTagId},
          ${current?.presence_tag_id || null},
          ${tx.json({
            previous: current
              ? {
                  confidence:
                    current.confidence === null
                      ? null
                      : Number(current.confidence),
                  geometry: current.manual_geometry || null,
                  note: current.note || "",
                  origin: current.origin,
                  presenceTagId: current.presence_tag_id,
                  reasonCode: current.reason_code,
                  state: current.state,
                }
              : null,
          })},
          'active', ${receiptId}, 'private'
        )
      `;
      return response;
    });
  };

  const undo = async ({ actorId, commandId, decisionId }) => {
    const actor = cleanActor(actorId);
    const originalDecisionId = cleanStableId(decisionId, "decisionId");
    return sql.begin(async (tx) => {
      const command = await beginCommand(tx, {
        actorId: actor,
        commandId,
        commandKind: "undo",
        payload: { decisionId: originalDecisionId },
      });
      if (command.replay) return command.replay;
      const [operation] = await tx`
        SELECT operation_id, subject_id, subject_kind, asset_id, action,
          decision_id, created_presence_tag_id, snapshot, state
        FROM manual_subject_presence_operation
        WHERE decision_id = ${originalDecisionId}
        FOR UPDATE
      `;
      if (!operation || operation.state !== "active") {
        throw typedError(
          "Manual Presence decision is not available for undo",
          409,
          "MANUAL_PRESENCE_UNDO_NOT_AVAILABLE",
        );
      }
      await requireVisibleAsset(tx, operation.asset_id, { lock: true });
      const subject = await requireSubject(
        tx,
        operation.subject_id,
        operation.subject_kind,
      );
      const [created] = await tx`
        SELECT tag.presence_tag_id
        FROM presence_tag tag
        WHERE tag.presence_tag_id = ${operation.created_presence_tag_id}
          AND tag.state <> 'superseded'
          AND NOT EXISTS (
            SELECT 1 FROM presence_tag newer
            WHERE newer.supersedes_presence_tag_id = tag.presence_tag_id
          )
        FOR UPDATE
      `;
      if (!created) {
        throw typedError(
          "Manual Presence changed after this decision",
          409,
          "MANUAL_PRESENCE_UNDO_STALE",
        );
      }
      const undoDecisionId = `decision_${randomUUID().replaceAll("-", "")}`;
      await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, supersedes_decision_id, producer_receipt_id,
          privacy_class
        ) VALUES (
          ${undoDecisionId}, 'asset_subject_presence',
          ${`${operation.subject_kind}:${operation.subject_id}:${operation.asset_id}`},
          'undo', 'user', ${actor}, 'manual_subject_presence_undo',
          'Undo manual subject Presence', ${operation.decision_id},
          ${receiptId}, 'private'
        )
      `;
      await tx`
        UPDATE presence_tag SET state = 'superseded'
        WHERE presence_tag_id = ${created.presence_tag_id}
      `;
      const previous = operation.snapshot?.previous || null;
      if (previous) {
        await tx`
          INSERT INTO presence_tag (
            presence_tag_id, person_id, asset_id, origin, reason_code, note,
            state, confidence, decision_id, supersedes_presence_tag_id,
            producer_receipt_id, privacy_class, manual_geometry
          ) VALUES (
            ${`presence_tag_${randomUUID().replaceAll("-", "")}`},
            ${operation.subject_id}, ${operation.asset_id}, ${previous.origin},
            ${previous.reasonCode}, ${previous.note || ""}, ${previous.state},
            ${previous.confidence}, ${undoDecisionId},
            ${created.presence_tag_id}, ${receiptId}, 'private',
            ${previous.geometry ? tx.json(previous.geometry) : null}
          )
        `;
      }
      await tx`
        UPDATE manual_subject_presence_operation
        SET state = 'reverted', undo_decision_id = ${undoDecisionId},
          reverted_at = now()
        WHERE operation_id = ${operation.operation_id}
      `;
      await tx`
        UPDATE person SET current_revision = current_revision + 1
        WHERE person_id = ${operation.subject_id}
      `;
      const restored = await loadCurrent(tx, {
        assetId: operation.asset_id,
        subjectId: operation.subject_id,
      });
      const response = {
        action: "undo",
        association: projectAssociation(restored),
        assetId: operation.asset_id,
        changed: true,
        decisionId: undoDecisionId,
        replayed: false,
        schemaVersion: manualSubjectPresenceSchemaVersion,
        status: "reverted",
        subject: {
          displayName: subject.display_name || "",
          subjectId: subject.person_id,
          subjectKind: subject.subject_kind,
        },
        supersedesDecisionId: operation.decision_id,
        undo: { decisionId: null, eligible: false },
      };
      return completeCommand(tx, {
        actorId: actor,
        command,
        commandKind: "undo",
        decisionId: undoDecisionId,
        response,
      });
    });
  };

  return { list, modify, undo };
};
