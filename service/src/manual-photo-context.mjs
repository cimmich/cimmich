import { createHash, randomUUID } from "node:crypto";

export const manualObjectRegionSchemaVersion =
  "cimmich.manual-object-region.v1";
export const assetOwnerSummarySchemaVersion = "cimmich.asset-owner-summary.v1";

const receiptId = "receipt_cimmich_manual_photo_context_v1";

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

const digestValue = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex");

const cleanActor = (value) => {
  const actorId = String(value || "").trim();
  if (!actorId || actorId.length > 120) {
    throw typedError(
      "A bounded Cimmich actor is required",
      400,
      "MANUAL_PHOTO_CONTEXT_ACTOR_INVALID",
    );
  }
  return actorId;
};

const cleanCommandId = (value) => {
  const commandId = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$/.test(commandId)) {
    throw typedError(
      "commandId must contain 8 to 120 safe characters",
      400,
      "MANUAL_PHOTO_CONTEXT_COMMAND_ID_INVALID",
    );
  }
  return commandId;
};

const cleanId = (value, field) => {
  const id = String(value || "").trim();
  if (!id || id.length > 200) {
    throw typedError(
      `${field} must be a stable Cimmich ID`,
      400,
      `MANUAL_PHOTO_CONTEXT_${field.replace(/Id$/, "").toUpperCase()}_INVALID`,
    );
  }
  return id;
};

const cleanDecisionId = (value) => {
  const decisionId = cleanId(value, "decisionId");
  if (!/^decision_[0-9a-f]{32}$/.test(decisionId)) {
    throw typedError(
      "expectedDecisionId must be a Cimmich decision ID",
      400,
      "MANUAL_PHOTO_CONTEXT_DECISION_INVALID",
    );
  }
  return decisionId;
};

const cleanCoordinate = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw typedError(
      "region coordinates must be finite normalized numbers",
      400,
      "MANUAL_OBJECT_REGION_INVALID",
    );
  }
  return Object.is(value, -0) ? 0 : Number(value.toFixed(6));
};

export const cleanManualObjectRegion = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw typedError(
      "region must be a normalized x/y/w/h object",
      400,
      "MANUAL_OBJECT_REGION_INVALID",
    );
  }
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "h,w,x,y") {
    throw typedError(
      "region accepts exactly x, y, w and h",
      400,
      "MANUAL_OBJECT_REGION_INVALID",
    );
  }
  const region = {
    h: cleanCoordinate(value.h),
    w: cleanCoordinate(value.w),
    x: cleanCoordinate(value.x),
    y: cleanCoordinate(value.y),
  };
  if (
    region.x < 0 ||
    region.y < 0 ||
    region.w <= 0 ||
    region.h <= 0 ||
    region.x + region.w > 1.000001 ||
    region.y + region.h > 1.000001
  ) {
    throw typedError(
      "region must have positive size and remain inside the image",
      400,
      "MANUAL_OBJECT_REGION_INVALID",
    );
  }
  return region;
};

const cleanSummaryText = (value) => {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw typedError(
      "summaryText must be bounded plain text or null",
      400,
      "ASSET_OWNER_SUMMARY_TEXT_INVALID",
    );
  }
  const text = value.trim();
  if (
    !text ||
    text.length > 2000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)
  ) {
    throw typedError(
      "summaryText must contain 1 to 2000 plain-text characters",
      400,
      "ASSET_OWNER_SUMMARY_TEXT_INVALID",
    );
  }
  return text;
};

const sameRegion = (left, right) =>
  ["x", "y", "w", "h"].every(
    (key) =>
      Number(left?.[key] ?? left?.[`box_${key}`]) === Number(right?.[key]),
  );

const projectTag = (row) =>
  row
    ? {
        decisionId: row.current_decision_id || row.decision_id,
        displayName: row.display_name,
        entityId: row.entity_id,
        entityKind: "object",
        observationId: row.observation_id,
        provenance: "manual_user",
        region: {
          h: Number(row.box_h),
          w: Number(row.box_w),
          x: Number(row.box_x),
          y: Number(row.box_y),
        },
        state: "accepted",
        tagId: row.tag_id,
      }
    : null;

const projectSummary = (row) => ({
  decisionId: row?.current_decision_id || row?.decision_id || null,
  provenance: row?.summary_text == null ? "none" : "manual_user",
  revision: Number(row?.revision || 0),
  summaryText: row?.summary_text ?? null,
});

export const createManualPhotoContextStore = (
  sql,
  { presentationRank = () => 0, resolveVisibleAssetDisplay } = {},
) => {
  if (typeof resolveVisibleAssetDisplay !== "function") {
    throw new Error("manual photo context requires visible asset resolution");
  }

  const resolveCurrentAsset = async (
    executor,
    value,
    { lock = false } = {},
  ) => {
    const linked = await resolveVisibleAssetDisplay(value);
    const rows = lock
      ? await executor`
          SELECT asset.asset_id, projection.input_revision
          FROM asset
          JOIN immich_asset_projection projection
            ON projection.cimmich_asset_id = asset.asset_id
            AND projection.state = 'active'
          WHERE asset.asset_id = ${linked.assetId} AND asset.state = 'active'
            AND cimmich_visibility_asset_rank(asset.asset_id)
              <= ${presentationRank()}
          ORDER BY projection.source_id
          LIMIT 1
          FOR UPDATE OF asset, projection
        `
      : await executor`
          SELECT asset.asset_id, projection.input_revision
          FROM asset
          JOIN immich_asset_projection projection
            ON projection.cimmich_asset_id = asset.asset_id
            AND projection.state = 'active'
          WHERE asset.asset_id = ${linked.assetId} AND asset.state = 'active'
            AND cimmich_visibility_asset_rank(asset.asset_id)
              <= ${presentationRank()}
          ORDER BY projection.source_id
          LIMIT 1
        `;
    if (!rows[0]) {
      throw typedError(
        "Visible current asset not found",
        404,
        "MANUAL_PHOTO_CONTEXT_ASSET_NOT_FOUND",
      );
    }
    return { ...linked, ...rows[0] };
  };

  const requireVisibleObject = async (
    executor,
    entityId,
    { lock = false } = {},
  ) => {
    const id = cleanId(entityId, "entityId");
    const rows = lock
      ? await executor`
          SELECT entity_id, display_name
          FROM context_entity
          WHERE entity_id = ${id} AND entity_kind = 'object' AND status = 'active'
            AND cimmich_visibility_context_entity_rank(entity_id)
              <= ${presentationRank()}
          FOR UPDATE
        `
      : await executor`
          SELECT entity_id, display_name
          FROM context_entity
          WHERE entity_id = ${id} AND entity_kind = 'object' AND status = 'active'
            AND cimmich_visibility_context_entity_rank(entity_id)
              <= ${presentationRank()}
        `;
    if (!rows[0]) {
      throw typedError(
        "Visible active Thing not found",
        404,
        "MANUAL_OBJECT_REGION_ENTITY_NOT_FOUND",
      );
    }
    return rows[0];
  };

  const currentTag = async (
    executor,
    { assetId, entityId, lock = false, tagId = "" },
  ) => {
    const rows = lock
      ? await executor`
          SELECT tag.tag_id, tag.entity_id, tag.observation_id,
            tag.decision_id, tag.current_decision_id, entity.display_name,
            observation.box_x::float8, observation.box_y::float8,
            observation.box_w::float8, observation.box_h::float8,
            observation.asset_input_revision
          FROM manual_context_tag tag
          JOIN manual_context_observation observation
            ON observation.observation_id = tag.observation_id
          JOIN context_entity entity ON entity.entity_id = tag.entity_id
          WHERE tag.asset_id = ${assetId}
            AND (${entityId || ""} = '' OR tag.entity_id = ${entityId || ""})
            AND (${tagId || ""} = '' OR tag.tag_id = ${tagId || ""})
            AND tag.state = 'accepted' AND observation.state = 'valid'
            AND entity.status = 'active'
            AND cimmich_visibility_context_entity_rank(entity.entity_id)
              <= ${presentationRank()}
          ORDER BY tag.created_at DESC, tag.tag_id DESC
          LIMIT 1
          FOR UPDATE OF tag, observation, entity
        `
      : await executor`
          SELECT tag.tag_id, tag.entity_id, tag.observation_id,
            tag.decision_id, tag.current_decision_id, entity.display_name,
            observation.box_x::float8, observation.box_y::float8,
            observation.box_w::float8, observation.box_h::float8,
            observation.asset_input_revision
          FROM manual_context_tag tag
          JOIN manual_context_observation observation
            ON observation.observation_id = tag.observation_id
          JOIN context_entity entity ON entity.entity_id = tag.entity_id
          WHERE tag.asset_id = ${assetId}
            AND (${entityId || ""} = '' OR tag.entity_id = ${entityId || ""})
            AND (${tagId || ""} = '' OR tag.tag_id = ${tagId || ""})
            AND tag.state = 'accepted' AND observation.state = 'valid'
            AND entity.status = 'active'
            AND cimmich_visibility_context_entity_rank(entity.entity_id)
              <= ${presentationRank()}
          ORDER BY tag.created_at DESC, tag.tag_id DESC
          LIMIT 1
        `;
    return rows[0] || null;
  };

  const beginCommand = async (tx, { commandId, commandKind, payload }) => {
    const id = cleanCommandId(commandId);
    const requestDigest = digestValue({ commandKind, payload });
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
    const [existing] = await tx`
      SELECT command_kind, request_digest, response
      FROM manual_photo_context_command WHERE command_id = ${id}
      FOR UPDATE
    `;
    if (existing) {
      if (
        existing.command_kind !== commandKind ||
        existing.request_digest !== requestDigest
      ) {
        throw typedError(
          "commandId was already used with another payload",
          409,
          "MANUAL_PHOTO_CONTEXT_COMMAND_CONFLICT",
        );
      }
      return {
        id,
        replay: { ...existing.response, replayed: true },
        requestDigest,
      };
    }
    return { id, replay: null, requestDigest };
  };

  const recordCommand = async (
    tx,
    { actorId, command, commandKind, decisionId = null, response },
  ) => {
    await tx`
      INSERT INTO manual_photo_context_command (
        command_id, command_kind, actor_id, request_digest, decision_id,
        response, producer_receipt_id
      ) VALUES (
        ${command.id}, ${commandKind}, ${actorId}, ${command.requestDigest},
        ${decisionId}, ${tx.json(response)}, ${receiptId}
      )
    `;
    return response;
  };

  const createDecision = async (
    tx,
    { action, actorId, reasonCode, subjectId, subjectType, supersedes = null },
  ) => {
    const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
    await tx`
      INSERT INTO decision (
        decision_id, subject_type, subject_id, action, actor_kind, actor_id,
        reason_code, supersedes_decision_id, producer_receipt_id
      ) VALUES (
        ${decisionId}, ${subjectType}, ${subjectId}, ${action}, 'user',
        ${actorId}, ${reasonCode}, ${supersedes}, ${receiptId}
      )
    `;
    return decisionId;
  };

  const insertTag = async (
    tx,
    { asset, decisionId, entityId, previous = null, region },
  ) => {
    const observationId = `contextobs_${randomUUID().replaceAll("-", "")}`;
    const tagId = `contexttag_${randomUUID().replaceAll("-", "")}`;
    await tx`
      INSERT INTO manual_context_observation (
        observation_id, asset_id, asset_input_revision, box_x, box_y, box_w,
        box_h, origin, state, decision_id, current_decision_id,
        supersedes_observation_id
      ) VALUES (
        ${observationId}, ${asset.asset_id}, ${asset.input_revision},
        ${region.x}, ${region.y}, ${region.w}, ${region.h}, 'manual_user',
        'valid', ${decisionId}, ${decisionId}, ${previous?.observation_id || null}
      )
    `;
    await tx`
      INSERT INTO manual_context_tag (
        tag_id, asset_id, observation_id, entity_id, entity_kind, provenance,
        state, decision_id, current_decision_id, supersedes_tag_id
      ) VALUES (
        ${tagId}, ${asset.asset_id}, ${observationId}, ${entityId}, 'object',
        'manual_user', 'accepted', ${decisionId}, ${decisionId},
        ${previous?.tag_id || null}
      )
    `;
    return { observationId, tagId };
  };

  const readProjection = async (executor, assetId) => {
    const tags = await executor`
      SELECT tag.tag_id, tag.entity_id, tag.observation_id,
        tag.current_decision_id, entity.display_name,
        observation.box_x::float8, observation.box_y::float8,
        observation.box_w::float8, observation.box_h::float8
      FROM manual_context_tag tag
      JOIN manual_context_observation observation
        ON observation.observation_id = tag.observation_id
      JOIN context_entity entity ON entity.entity_id = tag.entity_id
      WHERE tag.asset_id = ${assetId} AND tag.state = 'accepted'
        AND observation.state = 'valid' AND entity.status = 'active'
        AND EXISTS (
          SELECT 1 FROM immich_asset_projection projection
          WHERE projection.cimmich_asset_id = tag.asset_id
            AND projection.state = 'active'
            AND projection.input_revision = observation.asset_input_revision
        )
        AND cimmich_visibility_context_entity_rank(entity.entity_id)
          <= ${presentationRank()}
      ORDER BY observation.box_x, observation.box_y,
        lower(entity.display_name), tag.tag_id
      LIMIT 100
    `;
    const [summary] = await executor`
      SELECT summary.summary_revision_id, summary.revision,
        summary.summary_text, summary.decision_id AS current_decision_id
      FROM current_asset_owner_summary summary
      WHERE summary.asset_id = ${assetId}
        AND EXISTS (
          SELECT 1 FROM immich_asset_projection projection
          WHERE projection.cimmich_asset_id = summary.asset_id
            AND projection.state = 'active'
            AND projection.input_revision = summary.asset_input_revision
        )
    `;
    return {
      ownerSummary: projectSummary(summary),
      thingRegions: tags.map(projectTag),
    };
  };

  const attachObject = async ({
    actorId,
    assetId,
    commandId,
    entityId,
    region,
  }) => {
    const actor = cleanActor(actorId);
    const requestedAssetId = cleanId(assetId, "assetId");
    const objectId = cleanId(entityId, "entityId");
    const normalizedRegion = cleanManualObjectRegion(region);
    return sql.begin(async (tx) => {
      const commandKind = "object_attach";
      const command = await beginCommand(tx, {
        commandId,
        commandKind,
        payload: {
          assetId: requestedAssetId,
          entityId: objectId,
          region: normalizedRegion,
        },
      });
      if (command.replay) return command.replay;
      const asset = await resolveCurrentAsset(tx, requestedAssetId, {
        lock: true,
      });
      await requireVisibleObject(tx, objectId, { lock: true });
      const existing = await currentTag(tx, {
        assetId: asset.asset_id,
        entityId: objectId,
        lock: true,
      });
      if (existing) {
        if (!sameRegion(existing, normalizedRegion)) {
          throw typedError(
            "This Thing already has a current region on the asset",
            409,
            "MANUAL_OBJECT_REGION_ALREADY_EXISTS",
            { tagId: existing.tag_id },
          );
        }
        const response = {
          changed: false,
          decisionId: null,
          replayed: false,
          schemaVersion: manualObjectRegionSchemaVersion,
          status: "no_change",
          tag: projectTag(existing),
        };
        return recordCommand(tx, {
          actorId: actor,
          command,
          commandKind,
          response,
        });
      }
      const tagId = `contexttag_${randomUUID().replaceAll("-", "")}`;
      const decisionId = await createDecision(tx, {
        action: "attach",
        actorId: actor,
        reasonCode: "manual_object_region_attach",
        subjectId: tagId,
        subjectType: "manual_context_tag",
      });
      const observationId = `contextobs_${randomUUID().replaceAll("-", "")}`;
      await tx`
        INSERT INTO manual_context_observation (
          observation_id, asset_id, asset_input_revision, box_x, box_y, box_w,
          box_h, origin, state, decision_id, current_decision_id
        ) VALUES (
          ${observationId}, ${asset.asset_id}, ${asset.input_revision},
          ${normalizedRegion.x}, ${normalizedRegion.y}, ${normalizedRegion.w},
          ${normalizedRegion.h}, 'manual_user', 'valid', ${decisionId}, ${decisionId}
        )
      `;
      await tx`
        INSERT INTO manual_context_tag (
          tag_id, asset_id, observation_id, entity_id, entity_kind, provenance,
          state, decision_id, current_decision_id
        ) VALUES (
          ${tagId}, ${asset.asset_id}, ${observationId}, ${objectId}, 'object',
          'manual_user', 'accepted', ${decisionId}, ${decisionId}
        )
      `;
      const snapshot = {
        createdObservationId: observationId,
        createdTagId: tagId,
      };
      await tx`
        INSERT INTO manual_photo_context_operation (
          operation_id, command_id, asset_id, operation_scope, action,
          decision_id, state, snapshot
        ) VALUES (
          ${`contextoperation_${randomUUID().replaceAll("-", "")}`},
          ${command.id}, ${asset.asset_id}, 'object_region', 'attach',
          ${decisionId}, 'active', ${tx.json(snapshot)}
        )
      `;
      const projection = await readProjection(tx, asset.asset_id);
      const response = {
        changed: true,
        decisionId,
        replayed: false,
        schemaVersion: manualObjectRegionSchemaVersion,
        status: "attached",
        tag: projection.thingRegions.find((item) => item.tagId === tagId),
      };
      return recordCommand(tx, {
        actorId: actor,
        command,
        commandKind,
        decisionId,
        response,
      });
    });
  };

  const replaceObject = async ({
    actorId,
    commandId,
    entityId,
    expectedDecisionId,
    region,
    tagId,
  }) => {
    const actor = cleanActor(actorId);
    const currentTagId = cleanId(tagId, "tagId");
    const objectId = cleanId(entityId, "entityId");
    const decisionHead = cleanDecisionId(expectedDecisionId);
    const normalizedRegion = cleanManualObjectRegion(region);
    return sql.begin(async (tx) => {
      const commandKind = "object_replace";
      const command = await beginCommand(tx, {
        commandId,
        commandKind,
        payload: {
          entityId: objectId,
          expectedDecisionId: decisionHead,
          region: normalizedRegion,
          tagId: currentTagId,
        },
      });
      if (command.replay) return command.replay;
      const [located] = await tx`
        SELECT asset_id FROM manual_context_tag WHERE tag_id = ${currentTagId}
      `;
      if (!located) {
        throw typedError(
          "Current object region not found",
          404,
          "MANUAL_OBJECT_REGION_NOT_FOUND",
        );
      }
      const asset = await resolveCurrentAsset(tx, located.asset_id, {
        lock: true,
      });
      const previous = await currentTag(tx, {
        assetId: asset.asset_id,
        lock: true,
        tagId: currentTagId,
      });
      if (!previous) {
        throw typedError(
          "Current object region not found",
          404,
          "MANUAL_OBJECT_REGION_NOT_FOUND",
        );
      }
      if (previous.current_decision_id !== decisionHead) {
        throw typedError(
          "Object region changed after it was opened",
          409,
          "MANUAL_OBJECT_REGION_STALE",
        );
      }
      await requireVisibleObject(tx, objectId, { lock: true });
      if (
        previous.entity_id === objectId &&
        sameRegion(previous, normalizedRegion)
      ) {
        const response = {
          changed: false,
          decisionId: null,
          replayed: false,
          schemaVersion: manualObjectRegionSchemaVersion,
          status: "no_change",
          tag: projectTag(previous),
        };
        return recordCommand(tx, {
          actorId: actor,
          command,
          commandKind,
          response,
        });
      }
      const collision = await currentTag(tx, {
        assetId: asset.asset_id,
        entityId: objectId,
        lock: true,
      });
      if (collision && collision.tag_id !== currentTagId) {
        throw typedError(
          "The replacement Thing already has a current region on the asset",
          409,
          "MANUAL_OBJECT_REGION_COLLISION",
        );
      }
      const newTagId = `contexttag_${randomUUID().replaceAll("-", "")}`;
      const decisionId = await createDecision(tx, {
        action: "update",
        actorId: actor,
        reasonCode: "manual_object_region_replace",
        subjectId: newTagId,
        subjectType: "manual_context_tag",
        supersedes: previous.current_decision_id,
      });
      await tx`
        UPDATE manual_context_tag SET state = 'superseded',
          current_decision_id = ${decisionId}
        WHERE tag_id = ${previous.tag_id}
      `;
      await tx`
        UPDATE manual_context_observation SET state = 'superseded',
          current_decision_id = ${decisionId}
        WHERE observation_id = ${previous.observation_id}
      `;
      const created = await insertTag(tx, {
        asset,
        decisionId,
        entityId: objectId,
        previous,
        region: normalizedRegion,
      });
      await tx`
        INSERT INTO manual_photo_context_operation (
          operation_id, command_id, asset_id, operation_scope, action,
          decision_id, state, snapshot
        ) VALUES (
          ${`contextoperation_${randomUUID().replaceAll("-", "")}`},
          ${command.id}, ${asset.asset_id}, 'object_region', 'replace',
          ${decisionId}, 'active', ${tx.json({
            createdObservationId: created.observationId,
            createdTagId: created.tagId,
            previousObservationId: previous.observation_id,
            previousTagId: previous.tag_id,
          })}
        )
      `;
      const projection = await readProjection(tx, asset.asset_id);
      const response = {
        changed: true,
        decisionId,
        replayed: false,
        schemaVersion: manualObjectRegionSchemaVersion,
        status: "replaced",
        tag: projection.thingRegions.find(
          (item) => item.tagId === created.tagId,
        ),
      };
      return recordCommand(tx, {
        actorId: actor,
        command,
        commandKind,
        decisionId,
        response,
      });
    });
  };

  const rejectObject = async ({
    actorId,
    commandId,
    expectedDecisionId,
    tagId,
  }) => {
    const actor = cleanActor(actorId);
    const currentTagId = cleanId(tagId, "tagId");
    const decisionHead = cleanDecisionId(expectedDecisionId);
    return sql.begin(async (tx) => {
      const commandKind = "object_reject";
      const command = await beginCommand(tx, {
        commandId,
        commandKind,
        payload: { expectedDecisionId: decisionHead, tagId: currentTagId },
      });
      if (command.replay) return command.replay;
      const [located] = await tx`
        SELECT asset_id FROM manual_context_tag WHERE tag_id = ${currentTagId}
      `;
      if (!located) {
        throw typedError(
          "Current object region not found",
          404,
          "MANUAL_OBJECT_REGION_NOT_FOUND",
        );
      }
      const asset = await resolveCurrentAsset(tx, located.asset_id, {
        lock: true,
      });
      const previous = await currentTag(tx, {
        assetId: asset.asset_id,
        lock: true,
        tagId: currentTagId,
      });
      if (!previous) {
        throw typedError(
          "Current object region not found",
          404,
          "MANUAL_OBJECT_REGION_NOT_FOUND",
        );
      }
      if (previous.current_decision_id !== decisionHead) {
        throw typedError(
          "Object region changed after it was opened",
          409,
          "MANUAL_OBJECT_REGION_STALE",
        );
      }
      const decisionId = await createDecision(tx, {
        action: "reject",
        actorId: actor,
        reasonCode: "manual_object_region_reject",
        subjectId: previous.tag_id,
        subjectType: "manual_context_tag",
        supersedes: previous.current_decision_id,
      });
      await tx`
        UPDATE manual_context_tag SET state = 'rejected',
          current_decision_id = ${decisionId}
        WHERE tag_id = ${previous.tag_id}
      `;
      await tx`
        UPDATE manual_context_observation SET state = 'rejected',
          current_decision_id = ${decisionId}
        WHERE observation_id = ${previous.observation_id}
      `;
      await tx`
        INSERT INTO manual_photo_context_operation (
          operation_id, command_id, asset_id, operation_scope, action,
          decision_id, state, snapshot
        ) VALUES (
          ${`contextoperation_${randomUUID().replaceAll("-", "")}`},
          ${command.id}, ${asset.asset_id}, 'object_region', 'reject',
          ${decisionId}, 'active', ${tx.json({
            previousObservationId: previous.observation_id,
            previousTagId: previous.tag_id,
          })}
        )
      `;
      const response = {
        changed: true,
        decisionId,
        replayed: false,
        schemaVersion: manualObjectRegionSchemaVersion,
        status: "rejected",
        tag: null,
      };
      return recordCommand(tx, {
        actorId: actor,
        command,
        commandKind,
        decisionId,
        response,
      });
    });
  };

  const setSummary = async ({
    actorId,
    assetId,
    commandId,
    expectedRevision,
    summaryText,
  }) => {
    const actor = cleanActor(actorId);
    const requestedAssetId = cleanId(assetId, "assetId");
    const text = cleanSummaryText(summaryText);
    const revision = Number(expectedRevision);
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw typedError(
        "expectedRevision must be a non-negative integer",
        400,
        "ASSET_OWNER_SUMMARY_REVISION_INVALID",
      );
    }
    return sql.begin(async (tx) => {
      const commandKind = "summary_set";
      const command = await beginCommand(tx, {
        commandId,
        commandKind,
        payload: {
          assetId: requestedAssetId,
          expectedRevision: revision,
          summaryText: text,
        },
      });
      if (command.replay) return command.replay;
      const asset = await resolveCurrentAsset(tx, requestedAssetId, {
        lock: true,
      });
      const [previous] = await tx`
        SELECT summary_revision_id, revision, summary_text,
          current_decision_id
        FROM asset_owner_summary_revision
        WHERE asset_id = ${asset.asset_id} AND state = 'current'
        FOR UPDATE
      `;
      const currentRevision = Number(previous?.revision || 0);
      const [history] = await tx`
        SELECT coalesce(max(revision), 0)::bigint AS latest_revision
        FROM asset_owner_summary_revision
        WHERE asset_id = ${asset.asset_id}
      `;
      const nextRevision = Number(history.latest_revision) + 1;
      if (currentRevision !== revision) {
        throw typedError(
          "Owner summary changed after it was opened",
          409,
          "ASSET_OWNER_SUMMARY_STALE",
          { currentRevision },
        );
      }
      if ((previous?.summary_text ?? null) === text) {
        const response = {
          changed: false,
          decisionId: null,
          replayed: false,
          schemaVersion: assetOwnerSummarySchemaVersion,
          status: "no_change",
          summary: projectSummary(previous),
        };
        return recordCommand(tx, {
          actorId: actor,
          command,
          commandKind,
          response,
        });
      }
      const summaryRevisionId = `ownersummary_${randomUUID().replaceAll("-", "")}`;
      const decisionId = await createDecision(tx, {
        action: "update",
        actorId: actor,
        reasonCode: "asset_owner_summary_set",
        subjectId: summaryRevisionId,
        subjectType: "asset_owner_summary",
        supersedes: previous?.current_decision_id || null,
      });
      if (previous) {
        await tx`
          UPDATE asset_owner_summary_revision SET state = 'superseded',
            current_decision_id = ${decisionId}
          WHERE summary_revision_id = ${previous.summary_revision_id}
        `;
      }
      await tx`
        INSERT INTO asset_owner_summary_revision (
          summary_revision_id, asset_id, asset_input_revision, revision,
          summary_text, provenance, state, decision_id, current_decision_id,
          supersedes_summary_revision_id
        ) VALUES (
          ${summaryRevisionId}, ${asset.asset_id}, ${asset.input_revision},
          ${nextRevision}, ${text}, 'manual_user', 'current',
          ${decisionId}, ${decisionId}, ${previous?.summary_revision_id || null}
        )
      `;
      await tx`
        INSERT INTO manual_photo_context_operation (
          operation_id, command_id, asset_id, operation_scope, action,
          decision_id, state, snapshot
        ) VALUES (
          ${`contextoperation_${randomUUID().replaceAll("-", "")}`},
          ${command.id}, ${asset.asset_id}, 'owner_summary', 'set',
          ${decisionId}, 'active', ${tx.json({
            createdSummaryRevisionId: summaryRevisionId,
            previousSummaryRevisionId: previous?.summary_revision_id || null,
          })}
        )
      `;
      const response = {
        changed: true,
        decisionId,
        replayed: false,
        schemaVersion: assetOwnerSummarySchemaVersion,
        status: text === null ? "cleared" : "updated",
        summary: projectSummary({
          current_decision_id: decisionId,
          revision: nextRevision,
          summary_text: text,
        }),
      };
      return recordCommand(tx, {
        actorId: actor,
        command,
        commandKind,
        decisionId,
        response,
      });
    });
  };

  const undo = async ({ actorId, commandId, decisionId }) => {
    const actor = cleanActor(actorId);
    const originalDecisionId = cleanDecisionId(decisionId);
    return sql.begin(async (tx) => {
      const commandKind = "undo";
      const command = await beginCommand(tx, {
        commandId,
        commandKind,
        payload: { decisionId: originalDecisionId },
      });
      if (command.replay) return command.replay;
      const [operation] = await tx`
        SELECT operation_id, asset_id, operation_scope, action, decision_id,
          state, snapshot
        FROM manual_photo_context_operation
        WHERE decision_id = ${originalDecisionId}
        FOR UPDATE
      `;
      if (!operation || operation.state !== "active") {
        throw typedError(
          "Manual photo-context decision is not undoable",
          409,
          "MANUAL_PHOTO_CONTEXT_UNDO_NOT_AVAILABLE",
        );
      }
      const asset = await resolveCurrentAsset(tx, operation.asset_id, {
        lock: true,
      });
      const snapshot = operation.snapshot;
      if (operation.operation_scope === "object_region") {
        const scopeTagId = snapshot.createdTagId || snapshot.previousTagId;
        const [scope] = await tx`
          SELECT tag.entity_id, observation.asset_input_revision
          FROM manual_context_tag tag
          JOIN manual_context_observation observation
            ON observation.observation_id = tag.observation_id
          WHERE tag.tag_id = ${scopeTagId}
        `;
        if (!scope || scope.asset_input_revision !== asset.input_revision) {
          throw typedError(
            "Object region changed after this decision",
            409,
            "MANUAL_PHOTO_CONTEXT_UNDO_STALE",
          );
        }
        await requireVisibleObject(tx, scope.entity_id, { lock: true });
      } else {
        const [scope] = await tx`
          SELECT asset_input_revision
          FROM asset_owner_summary_revision
          WHERE summary_revision_id = ${snapshot.createdSummaryRevisionId}
        `;
        if (!scope || scope.asset_input_revision !== asset.input_revision) {
          throw typedError(
            "Owner summary changed after this decision",
            409,
            "MANUAL_PHOTO_CONTEXT_UNDO_STALE",
          );
        }
      }
      const undoDecisionId = await createDecision(tx, {
        action: "undo",
        actorId: actor,
        reasonCode: `manual_photo_context_${operation.operation_scope}_undo`,
        subjectId: operation.operation_id,
        subjectType: operation.operation_scope,
        supersedes: operation.decision_id,
      });
      if (operation.operation_scope === "object_region") {
        if (operation.action === "attach" || operation.action === "replace") {
          const [created] = await tx`
            SELECT tag.tag_id, observation.observation_id
            FROM manual_context_tag tag
            JOIN manual_context_observation observation
              ON observation.observation_id = tag.observation_id
            WHERE tag.tag_id = ${snapshot.createdTagId}
              AND observation.observation_id = ${snapshot.createdObservationId}
              AND tag.state = 'accepted' AND observation.state = 'valid'
            FOR UPDATE OF tag, observation
          `;
          if (!created) {
            throw typedError(
              "Object region changed after this decision",
              409,
              "MANUAL_PHOTO_CONTEXT_UNDO_STALE",
            );
          }
          await tx`
            UPDATE manual_context_tag SET state = 'superseded',
              current_decision_id = ${undoDecisionId}
            WHERE tag_id = ${snapshot.createdTagId}
          `;
          await tx`
            UPDATE manual_context_observation SET state = 'rejected',
              current_decision_id = ${undoDecisionId}
            WHERE observation_id = ${snapshot.createdObservationId}
          `;
        }
        if (operation.action === "replace" || operation.action === "reject") {
          const [previous] = await tx`
            SELECT tag.tag_id, observation.observation_id
            FROM manual_context_tag tag
            JOIN manual_context_observation observation
              ON observation.observation_id = tag.observation_id
            WHERE tag.tag_id = ${snapshot.previousTagId}
              AND observation.observation_id = ${snapshot.previousObservationId}
              AND tag.state = ${operation.action === "replace" ? "superseded" : "rejected"}
              AND observation.state = ${operation.action === "replace" ? "superseded" : "rejected"}
            FOR UPDATE OF tag, observation
          `;
          if (!previous) {
            throw typedError(
              "Object region changed after this decision",
              409,
              "MANUAL_PHOTO_CONTEXT_UNDO_STALE",
            );
          }
          const [collision] = await tx`
            SELECT collision.tag_id
            FROM manual_context_tag previous
            JOIN manual_context_tag collision
              ON collision.asset_id = previous.asset_id
              AND collision.entity_id = previous.entity_id
              AND collision.state = 'accepted'
              AND collision.tag_id <> previous.tag_id
            WHERE previous.tag_id = ${snapshot.previousTagId}
            LIMIT 1
          `;
          if (collision) {
            throw typedError(
              "Object region changed after this decision",
              409,
              "MANUAL_PHOTO_CONTEXT_UNDO_STALE",
            );
          }
          await tx`
            UPDATE manual_context_tag SET state = 'accepted',
              current_decision_id = ${undoDecisionId}
            WHERE tag_id = ${snapshot.previousTagId}
          `;
          await tx`
            UPDATE manual_context_observation SET state = 'valid',
              current_decision_id = ${undoDecisionId}
            WHERE observation_id = ${snapshot.previousObservationId}
          `;
        }
      } else {
        const [created] = await tx`
          SELECT summary_revision_id
          FROM asset_owner_summary_revision
          WHERE summary_revision_id = ${snapshot.createdSummaryRevisionId}
            AND state = 'current'
          FOR UPDATE
        `;
        if (!created) {
          throw typedError(
            "Owner summary changed after this decision",
            409,
            "MANUAL_PHOTO_CONTEXT_UNDO_STALE",
          );
        }
        await tx`
          UPDATE asset_owner_summary_revision SET state = 'superseded',
            current_decision_id = ${undoDecisionId}
          WHERE summary_revision_id = ${snapshot.createdSummaryRevisionId}
        `;
        if (snapshot.previousSummaryRevisionId) {
          await tx`
            UPDATE asset_owner_summary_revision SET state = 'current',
              current_decision_id = ${undoDecisionId}
            WHERE summary_revision_id = ${snapshot.previousSummaryRevisionId}
              AND state = 'superseded'
          `;
          const restored = await tx`
            SELECT 1 FROM asset_owner_summary_revision
            WHERE summary_revision_id = ${snapshot.previousSummaryRevisionId}
              AND state = 'current'
          `;
          if (!restored[0]) {
            throw typedError(
              "Owner summary changed after this decision",
              409,
              "MANUAL_PHOTO_CONTEXT_UNDO_STALE",
            );
          }
        }
      }
      await tx`
        UPDATE manual_photo_context_operation SET state = 'reverted',
          undo_decision_id = ${undoDecisionId}, reverted_at = now()
        WHERE operation_id = ${operation.operation_id}
      `;
      const projection = await readProjection(tx, asset.asset_id);
      const response = {
        changed: true,
        decisionId: undoDecisionId,
        ownerSummary: projection.ownerSummary,
        replayed: false,
        schemaVersion: "cimmich.manual-photo-context-undo.v1",
        status: "undone",
        thingRegions: projection.thingRegions,
        undoneDecisionId: originalDecisionId,
      };
      return recordCommand(tx, {
        actorId: actor,
        command,
        commandKind,
        decisionId: undoDecisionId,
        response,
      });
    });
  };

  return {
    attachObject,
    project: async ({ assetId }) => {
      const asset = await resolveCurrentAsset(sql, assetId);
      return readProjection(sql, asset.asset_id);
    },
    projectCurrentAsset: async ({ assetId }) => readProjection(sql, assetId),
    rejectObject,
    replaceObject,
    setSummary,
    undo,
  };
};
