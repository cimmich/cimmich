import { createHash, randomUUID } from "node:crypto";

export const assetCorrectionSchemaVersion = "cimmich.asset-correction.v1";
const receiptId = "receipt_cimmich_asset_correction_v1";

const typedError = (message, statusCode, code, details) =>
  Object.assign(new Error(message), {
    code,
    statusCode,
    ...(details ? { details } : {}),
  });

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
  const actorId = String(value || "").trim();
  if (!actorId || actorId.length > 120) {
    throw typedError(
      "A bounded Cimmich actor is required",
      400,
      "ASSET_CORRECTION_ACTOR_INVALID",
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
      "ASSET_CORRECTION_COMMAND_INVALID",
    );
  }
  return commandId;
};

const cleanAssetIds = (values, maximum = 100) => {
  if (!Array.isArray(values) || values.length < 1 || values.length > maximum) {
    throw typedError(
      `Choose between 1 and ${maximum} Cimmich assets`,
      400,
      "ASSET_CORRECTION_ASSETS_INVALID",
    );
  }
  const assetIds = values.map((value) => String(value || "").trim());
  if (
    assetIds.some((value) => !value || value.length > 200) ||
    new Set(assetIds).size !== assetIds.length
  ) {
    throw typedError(
      "Asset IDs must be unique stable Cimmich identifiers",
      400,
      "ASSET_CORRECTION_ASSETS_INVALID",
    );
  }
  return assetIds;
};

const cleanDirection = (value) => {
  if (value !== "left" && value !== "right") {
    throw typedError(
      "Rotation direction must be left or right",
      400,
      "ASSET_ROTATION_DIRECTION_INVALID",
    );
  }
  return value;
};

const cleanCaptureTime = (value) => {
  if (typeof value !== "string") {
    throw typedError(
      "captureTime must be an ISO date-time",
      400,
      "ASSET_CAPTURE_TIME_INVALID",
    );
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw typedError(
      "captureTime must be an ISO date-time",
      400,
      "ASSET_CAPTURE_TIME_INVALID",
    );
  }
  return parsed.toISOString();
};

const cleanPlaceId = (value) => {
  const placeEntityId = String(value || "").trim();
  if (!/^place_[0-9a-f]{32}$/.test(placeEntityId)) {
    throw typedError(
      "placeEntityId must identify a Cimmich Place",
      400,
      "ASSET_PLACE_INVALID",
    );
  }
  return placeEntityId;
};

const cleanDecisionIds = (values) => {
  if (!Array.isArray(values) || values.length < 1 || values.length > 100) {
    throw typedError(
      "Choose between 1 and 100 correction decisions",
      400,
      "ASSET_CORRECTION_UNDO_INVALID",
    );
  }
  const decisionIds = values.map((value) => String(value || "").trim());
  if (
    decisionIds.some((value) => !/^decision_[0-9a-f]{32}$/.test(value)) ||
    new Set(decisionIds).size !== decisionIds.length
  ) {
    throw typedError(
      "Correction decisions must be unique Cimmich decision IDs",
      400,
      "ASSET_CORRECTION_UNDO_INVALID",
    );
  }
  return decisionIds;
};

const projectLocation = (row) =>
  row.location_entity_id
    ? {
        entityId: row.location_entity_id,
        label: row.location_label,
        provenance:
          row.location_source === "correction"
            ? "manual_correction"
            : "cimmich_place",
      }
    : null;

const projectDetails = (row, bridgeFields) => ({
  assetId: row.asset_id,
  captureTime: row.effective_capture_time,
  captureTimeProvenance: row.capture_correction_id
    ? "manual_correction"
    : "source_metadata",
  correctionDecisionIds: [
    row.rotation_decision_id,
    row.capture_decision_id,
    row.place_decision_id,
  ].filter(Boolean),
  location: projectLocation(row),
  originalCaptureTime: row.original_capture_time,
  rotationDecisionId: row.rotation_decision_id || null,
  rotationQuarterTurns: Number(row.rotation_quarter_turns || 0),
  schemaVersion: assetCorrectionSchemaVersion,
  ...bridgeFields(row.asset_id),
});

const commandReplay = async (tx, commandId, payloadDigest) => {
  const [existing] = await tx`
    SELECT payload_digest, result FROM asset_correction_command
    WHERE command_id = ${commandId}
  `;
  if (!existing) return null;
  if (existing.payload_digest !== payloadDigest) {
    throw typedError(
      "commandId was already used for a different correction",
      409,
      "ASSET_CORRECTION_COMMAND_CONFLICT",
    );
  }
  return { ...existing.result, replayed: true };
};

const recordCommand = async (
  tx,
  { commandId, commandKind, payloadDigest, result },
) => {
  await tx`
    INSERT INTO asset_correction_command (
      command_id, command_kind, payload_digest, result, producer_receipt_id
    ) VALUES (
      ${commandId}, ${commandKind}, ${payloadDigest}, ${tx.json(result)}, ${receiptId}
    )
  `;
};

const requireAssets = async (tx, assetIds, presentationRank, lock = false) => {
  const rows = lock
    ? await tx`
        SELECT asset_id FROM asset
        WHERE asset_id = ANY(${assetIds}) AND state = 'active'
          AND cimmich_visibility_asset_rank(asset_id) <= ${presentationRank()}
        ORDER BY asset_id FOR UPDATE
      `
    : await tx`
        SELECT asset_id FROM asset
        WHERE asset_id = ANY(${assetIds}) AND state = 'active'
          AND cimmich_visibility_asset_rank(asset_id) <= ${presentationRank()}
        ORDER BY asset_id
      `;
  const found = new Set(rows.map((row) => row.asset_id));
  const missingAssetIds = assetIds.filter((assetId) => !found.has(assetId));
  if (missingAssetIds.length) {
    throw typedError(
      "One or more visible active assets were not found",
      404,
      "ASSET_CORRECTION_ASSET_NOT_FOUND",
      { missingAssetIds },
    );
  }
};

const detailRows = async (sql, assetIds, presentationRank) => sql`
  SELECT asset.asset_id, asset.capture_time AS original_capture_time,
    coalesce(capture.capture_time, asset.capture_time) AS effective_capture_time,
    coalesce(rotation.rotation_quarter_turns, 0)::int AS rotation_quarter_turns,
    rotation.decision_id AS rotation_decision_id,
    capture.correction_id AS capture_correction_id,
    capture.decision_id AS capture_decision_id,
    place.decision_id AS place_decision_id,
    coalesce(place.place_entity_id, context_place.entity_id) AS location_entity_id,
    coalesce(corrected_place.display_name, context_place.display_name) AS location_label,
    CASE WHEN place.place_entity_id IS NOT NULL THEN 'correction'
      WHEN context_place.entity_id IS NOT NULL THEN 'context' ELSE NULL END AS location_source
  FROM asset
  LEFT JOIN current_asset_correction rotation
    ON rotation.asset_id = asset.asset_id AND rotation.correction_kind = 'rotation'
  LEFT JOIN current_asset_correction capture
    ON capture.asset_id = asset.asset_id AND capture.correction_kind = 'capture_time'
  LEFT JOIN current_asset_correction place
    ON place.asset_id = asset.asset_id AND place.correction_kind = 'place'
  LEFT JOIN context_entity corrected_place
    ON corrected_place.entity_id = place.place_entity_id
  LEFT JOIN LATERAL (
    SELECT entity.entity_id, entity.display_name
    FROM current_context_asset link
    JOIN context_entity entity ON entity.entity_id = link.entity_id
    WHERE link.asset_id = asset.asset_id AND entity.entity_kind = 'place'
      AND entity.status IN ('active','hidden')
      AND cimmich_visibility_context_entity_rank(entity.entity_id)
        <= ${presentationRank()}
    ORDER BY (entity.place_role = 'location') DESC,
      (link.association_kind = 'captured_at') DESC,
      link.created_at DESC, entity.display_name, entity.entity_id
    LIMIT 1
  ) context_place ON place.place_entity_id IS NULL
  WHERE asset.asset_id = ANY(${assetIds}) AND asset.state = 'active'
    AND cimmich_visibility_asset_rank(asset.asset_id) <= ${presentationRank()}
  ORDER BY array_position(${assetIds}::text[], asset.asset_id)
`;

const insertDecision = async (
  tx,
  { actorId, assetId, reasonCode, supersedesDecisionId = null },
) => {
  const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
  await tx`
    INSERT INTO decision (
      decision_id, subject_type, subject_id, action, actor_kind, actor_id,
      reason_code, supersedes_decision_id, producer_receipt_id
    ) VALUES (
      ${decisionId}, 'asset_correction', ${assetId}, 'accept', 'user',
      ${actorId}, ${reasonCode}, ${supersedesDecisionId}, ${receiptId}
    )
  `;
  return decisionId;
};

const insertCorrection = async (
  tx,
  {
    actorId,
    assetId,
    captureTime = null,
    kind,
    placeEntityId = null,
    quarterTurns = null,
  },
) => {
  const [current] = await tx`
    SELECT * FROM asset_correction
    WHERE asset_id = ${assetId} AND correction_kind = ${kind} AND state = 'active'
    FOR UPDATE
  `;
  const decisionId = await insertDecision(tx, {
    actorId,
    assetId,
    reasonCode: `asset_${kind}_manual`,
    supersedesDecisionId: current?.decision_id || null,
  });
  const correctionId = `assetcorrection_${randomUUID().replaceAll("-", "")}`;
  if (current) {
    await tx`
      UPDATE asset_correction SET state = 'superseded'
      WHERE correction_id = ${current.correction_id} AND state = 'active'
    `;
  }
  await tx`
    INSERT INTO asset_correction (
      correction_id, asset_id, correction_kind, rotation_quarter_turns,
      capture_time, place_entity_id, state, decision_id,
      supersedes_correction_id, producer_receipt_id
    ) VALUES (
      ${correctionId}, ${assetId}, ${kind}, ${quarterTurns}, ${captureTime},
      ${placeEntityId}, 'active', ${decisionId},
      ${current?.correction_id || null}, ${receiptId}
    )
  `;
  return decisionId;
};

export const createAssetCorrectionStore = (
  sql,
  { bridgeFields = () => ({}), presentationRank = () => 0 } = {},
) => {
  const details = async ({ assetIds }) => {
    const ids = cleanAssetIds(assetIds);
    await requireAssets(sql, ids, presentationRank);
    return {
      items: (await detailRows(sql, ids, presentationRank)).map((row) =>
        projectDetails(row, bridgeFields),
      ),
      schemaVersion: assetCorrectionSchemaVersion,
    };
  };

  const rotate = async ({ actorId, assetIds, commandId, direction }) => {
    const request = {
      actorId: cleanActor(actorId),
      assetIds: cleanAssetIds(assetIds),
      commandId: cleanCommandId(commandId),
      direction: cleanDirection(direction),
    };
    const payloadDigest = digest(request);
    return sql.begin(async (tx) => {
      const replay = await commandReplay(tx, request.commandId, payloadDigest);
      if (replay) return replay;
      await requireAssets(tx, request.assetIds, presentationRank, true);
      const currentRows = await tx`
        SELECT asset_id, rotation_quarter_turns
        FROM current_asset_correction
        WHERE asset_id = ANY(${request.assetIds}) AND correction_kind = 'rotation'
      `;
      const current = new Map(
        currentRows.map((row) => [
          row.asset_id,
          Number(row.rotation_quarter_turns),
        ]),
      );
      const decisionIds = [];
      const delta = request.direction === "right" ? 1 : -1;
      for (const assetId of request.assetIds) {
        decisionIds.push(
          await insertCorrection(tx, {
            actorId: request.actorId,
            assetId,
            kind: "rotation",
            quarterTurns: ((current.get(assetId) || 0) + delta + 4) % 4,
          }),
        );
      }
      const result = {
        changed: true,
        decisionIds,
        direction: request.direction,
        items: (await detailRows(tx, request.assetIds, presentationRank)).map(
          (row) => projectDetails(row, bridgeFields),
        ),
        replayed: false,
        schemaVersion: assetCorrectionSchemaVersion,
      };
      await recordCommand(tx, {
        commandId: request.commandId,
        commandKind: "rotate",
        payloadDigest,
        result,
      });
      return result;
    });
  };

  const setCaptureTime = async ({
    actorId,
    assetId,
    captureTime,
    commandId,
  }) => {
    const request = {
      actorId: cleanActor(actorId),
      assetId: cleanAssetIds([assetId], 1)[0],
      captureTime: cleanCaptureTime(captureTime),
      commandId: cleanCommandId(commandId),
    };
    const payloadDigest = digest(request);
    return sql.begin(async (tx) => {
      const replay = await commandReplay(tx, request.commandId, payloadDigest);
      if (replay) return replay;
      await requireAssets(tx, [request.assetId], presentationRank, true);
      const decisionId = await insertCorrection(tx, {
        actorId: request.actorId,
        assetId: request.assetId,
        captureTime: request.captureTime,
        kind: "capture_time",
      });
      const result = {
        changed: true,
        decisionIds: [decisionId],
        item: projectDetails(
          (await detailRows(tx, [request.assetId], presentationRank))[0],
          bridgeFields,
        ),
        replayed: false,
        schemaVersion: assetCorrectionSchemaVersion,
      };
      await recordCommand(tx, {
        commandId: request.commandId,
        commandKind: "set_capture_time",
        payloadDigest,
        result,
      });
      return result;
    });
  };

  const setPlace = async ({ actorId, assetId, commandId, placeEntityId }) => {
    const request = {
      actorId: cleanActor(actorId),
      assetId: cleanAssetIds([assetId], 1)[0],
      commandId: cleanCommandId(commandId),
      placeEntityId: cleanPlaceId(placeEntityId),
    };
    const payloadDigest = digest(request);
    return sql.begin(async (tx) => {
      const replay = await commandReplay(tx, request.commandId, payloadDigest);
      if (replay) return replay;
      await requireAssets(tx, [request.assetId], presentationRank, true);
      const [place] = await tx`
        SELECT entity_id FROM context_entity
        WHERE entity_id = ${request.placeEntityId} AND entity_kind = 'place'
          AND status IN ('active','hidden')
          AND cimmich_visibility_context_entity_rank(entity_id) <= ${presentationRank()}
        FOR UPDATE
      `;
      if (!place) {
        throw typedError(
          "Visible Place not found",
          404,
          "ASSET_PLACE_NOT_FOUND",
        );
      }
      const decisionId = await insertCorrection(tx, {
        actorId: request.actorId,
        assetId: request.assetId,
        kind: "place",
        placeEntityId: request.placeEntityId,
      });
      const result = {
        changed: true,
        decisionIds: [decisionId],
        item: projectDetails(
          (await detailRows(tx, [request.assetId], presentationRank))[0],
          bridgeFields,
        ),
        replayed: false,
        schemaVersion: assetCorrectionSchemaVersion,
      };
      await recordCommand(tx, {
        commandId: request.commandId,
        commandKind: "set_place",
        payloadDigest,
        result,
      });
      return result;
    });
  };

  const undo = async ({ actorId, commandId, decisionIds }) => {
    const request = {
      actorId: cleanActor(actorId),
      commandId: cleanCommandId(commandId),
      decisionIds: cleanDecisionIds(decisionIds),
    };
    const payloadDigest = digest(request);
    return sql.begin(async (tx) => {
      const replay = await commandReplay(tx, request.commandId, payloadDigest);
      if (replay) return replay;
      const rows = await tx`
        SELECT * FROM asset_correction
        WHERE decision_id = ANY(${request.decisionIds}) AND state = 'active'
        ORDER BY asset_id, correction_kind FOR UPDATE
      `;
      if (rows.length !== request.decisionIds.length) {
        throw typedError(
          "A correction changed after this decision and cannot be undone",
          409,
          "ASSET_CORRECTION_UNDO_STALE",
        );
      }
      const assetIds = [...new Set(rows.map((row) => row.asset_id))];
      const undoDecisionIds = [];
      for (const row of rows) {
        const undoDecisionId = `decision_${randomUUID().replaceAll("-", "")}`;
        await tx`
          INSERT INTO decision (
            decision_id, subject_type, subject_id, action, actor_kind, actor_id,
            reason_code, supersedes_decision_id, producer_receipt_id
          ) VALUES (
            ${undoDecisionId}, 'asset_correction', ${row.asset_id}, 'restore',
            'user', ${request.actorId}, 'asset_correction_undo',
            ${row.decision_id}, ${receiptId}
          )
        `;
        await tx`
          UPDATE asset_correction SET state = 'reverted',
            reverted_by_decision_id = ${undoDecisionId}, reverted_at = now()
          WHERE correction_id = ${row.correction_id} AND state = 'active'
        `;
        if (row.supersedes_correction_id) {
          await tx`
            UPDATE asset_correction SET state = 'active'
            WHERE correction_id = ${row.supersedes_correction_id}
              AND state = 'superseded'
          `;
        }
        undoDecisionIds.push(undoDecisionId);
      }
      const result = {
        changed: true,
        items: (await detailRows(tx, assetIds, presentationRank)).map((row) =>
          projectDetails(row, bridgeFields),
        ),
        replayed: false,
        schemaVersion: assetCorrectionSchemaVersion,
        undoDecisionIds,
      };
      await recordCommand(tx, {
        commandId: request.commandId,
        commandKind: "undo",
        payloadDigest,
        result,
      });
      return result;
    });
  };

  const review = async ({
    kind = "orientation",
    limit = 50,
    offset = 0,
  } = {}) => {
    const reviewKind = String(kind || "orientation");
    if (!new Set(["orientation", "dates", "locations"]).has(reviewKind)) {
      throw typedError(
        "Photo review kind is invalid",
        400,
        "ASSET_REVIEW_KIND_INVALID",
      );
    }
    const boundedLimit = Math.min(
      100,
      Math.max(1, Number.parseInt(String(limit), 10) || 50),
    );
    const boundedOffset = Math.max(0, Number.parseInt(String(offset), 10) || 0);
    let rows;
    if (reviewKind === "orientation") {
      rows = await sql`
        SELECT asset.asset_id, 'likely_sideways_face' AS reason,
          max(abs((measurement.pose->>'rollDegrees')::float8)) AS confidence_signal
        FROM asset
        JOIN face_observation face ON face.asset_id = asset.asset_id AND face.state = 'valid'
        JOIN current_face_local_measurement measurement ON measurement.face_id = face.face_id
        WHERE asset.state = 'active' AND asset.media_kind = 'image'
          AND NOT EXISTS (
            SELECT 1 FROM current_asset_correction correction
            WHERE correction.asset_id = asset.asset_id AND correction.correction_kind = 'rotation'
          )
          AND measurement.measurement_state = 'measured'
          AND measurement.pose ? 'rollDegrees'
          AND abs((measurement.pose->>'rollDegrees')::float8) BETWEEN 55 AND 125
          AND cimmich_visibility_asset_rank(asset.asset_id) <= ${presentationRank()}
        GROUP BY asset.asset_id
        ORDER BY confidence_signal DESC, asset.asset_id
        LIMIT ${boundedLimit} OFFSET ${boundedOffset}
      `;
    } else if (reviewKind === "dates") {
      rows = await sql`
        SELECT asset.asset_id, 'future_capture_time' AS reason,
          extract(epoch FROM (coalesce(correction.capture_time, asset.capture_time) - now())) AS confidence_signal
        FROM asset
        LEFT JOIN current_asset_correction correction
          ON correction.asset_id = asset.asset_id AND correction.correction_kind = 'capture_time'
        WHERE asset.state = 'active'
          AND coalesce(correction.capture_time, asset.capture_time) > now() + interval '1 day'
          AND cimmich_visibility_asset_rank(asset.asset_id) <= ${presentationRank()}
        ORDER BY confidence_signal DESC, asset.asset_id
        LIMIT ${boundedLimit} OFFSET ${boundedOffset}
      `;
    } else {
      rows = await sql`
        SELECT asset.asset_id, 'multiple_current_places' AS reason,
          count(DISTINCT entity.entity_id)::float8 AS confidence_signal
        FROM asset
        JOIN current_context_asset link ON link.asset_id = asset.asset_id
        JOIN context_entity entity ON entity.entity_id = link.entity_id
          AND entity.entity_kind = 'place' AND entity.status IN ('active','hidden')
        WHERE asset.state = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM current_asset_correction correction
            WHERE correction.asset_id = asset.asset_id AND correction.correction_kind = 'place'
          )
          AND cimmich_visibility_asset_rank(asset.asset_id) <= ${presentationRank()}
          AND cimmich_visibility_context_entity_rank(entity.entity_id) <= ${presentationRank()}
        GROUP BY asset.asset_id
        HAVING count(DISTINCT entity.entity_id) > 1
        ORDER BY confidence_signal DESC, asset.asset_id
        LIMIT ${boundedLimit} OFFSET ${boundedOffset}
      `;
    }
    const assetIds = rows.map((row) => row.asset_id);
    const detailsByAsset = new Map(
      assetIds.length
        ? (await detailRows(sql, assetIds, presentationRank)).map((row) => [
            row.asset_id,
            projectDetails(row, bridgeFields),
          ])
        : [],
    );
    return {
      items: rows.map((row) => ({
        ...detailsByAsset.get(row.asset_id),
        confidenceSignal: Number(row.confidence_signal),
        reason: row.reason,
      })),
      kind: reviewKind,
      limit: boundedLimit,
      offset: boundedOffset,
      schemaVersion: assetCorrectionSchemaVersion,
    };
  };

  return { details, review, rotate, setCaptureTime, setPlace, undo };
};
