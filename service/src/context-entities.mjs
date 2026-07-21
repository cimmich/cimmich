import { createHash, randomUUID } from "node:crypto";

const schemaVersion = "cimmich.context-entity.v1";
const eventCoverSchemaVersion = "cimmich.event-cover.v1";
const placeDeleteSchemaVersion = "cimmich.place-delete.v1";
const placeCoverSchemaVersion = "cimmich.place-cover.v1";
const objectDeleteSchemaVersion = "cimmich.object-delete.v1";
const objectCoverSchemaVersion = "cimmich.object-cover.v1";
const receiptId = "receipt_cimmich_context_entity_v1";
const coverSchemaVersions = Object.freeze({
  event: eventCoverSchemaVersion,
  object: objectCoverSchemaVersion,
  place: placeCoverSchemaVersion,
});
const entityLabels = Object.freeze({
  event: "Event",
  object: "Thing",
  place: "Place",
});
const entityKinds = new Set(["place", "object", "event"]);
const typedKinds = {
  event: new Set(["trip", "event", "activity", "life_period"]),
  object: new Set([
    "vehicle",
    "property",
    "device",
    "collectible",
    "equipment",
    "other",
  ]),
  place: new Set(["point", "area", "route", "unlocated"]),
};
const datePrecisions = new Set([
  "exact",
  "month",
  "year",
  "approximate",
  "unknown",
]);
const statuses = new Set(["active", "hidden", "archived"]);
const associationKinds = {
  event: new Set(["direct", "route_stop", "context", "manual"]),
  object: new Set(["depicts", "owned_at", "manual"]),
  place: new Set(["captured_at", "depicts", "route_stop", "manual"]),
};
const relationKinds = new Set([
  "participant",
  "companion",
  "location",
  "object",
  "parent",
  "related",
]);
const targetKinds = new Set(["person", "pet", "place", "object", "event"]);
const targetKindByRelationKind = Object.freeze({
  companion: "pet",
  location: "place",
  object: "object",
  participant: "person",
});

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
      "CONTEXT_ACTOR_REQUIRED",
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
      "CONTEXT_COMMAND_ID_INVALID",
    );
  }
  return commandId;
};

const cleanEntityId = (value, field = "entityId") => {
  const entityId = String(value || "").trim();
  if (!/^(place|object|event)_[0-9a-f]{32}$/.test(entityId)) {
    throw typedError(
      `${field} is not a stable Cimmich context ID`,
      400,
      "CONTEXT_ID_INVALID",
      { field },
    );
  }
  return entityId;
};

const cleanText = (value, maximum, field, { nullable = false } = {}) => {
  if (value === undefined) return undefined;
  const text = String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!text) {
    if (nullable) return null;
    throw typedError(`${field} is required`, 400, "CONTEXT_VALUE_INVALID", {
      field,
    });
  }
  if (text.length > maximum) {
    throw typedError(
      `${field} must be ${maximum} characters or fewer`,
      400,
      "CONTEXT_VALUE_INVALID",
      { field, maximum },
    );
  }
  return text;
};

const cleanAliases = (value) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 30) {
    throw typedError(
      "aliases must be an array with at most 30 labels",
      400,
      "CONTEXT_ALIASES_INVALID",
    );
  }
  const values = value.map((alias) => cleanText(alias, 160, "alias"));
  return [
    ...new Map(values.map((alias) => [alias.toLowerCase(), alias])).values(),
  ];
};

const cleanDate = (value, field) => {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === "") return null;
  const date = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw typedError(
      `${field} must be an ISO calendar date`,
      400,
      "CONTEXT_DATE_INVALID",
      { field },
    );
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw typedError(
      `${field} must be a real ISO calendar date`,
      400,
      "CONTEXT_DATE_INVALID",
      { field },
    );
  }
  return date;
};

const cleanPoint = (value, field = "geometry") => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw typedError(
      `${field} must be an object`,
      400,
      "CONTEXT_GEOMETRY_INVALID",
    );
  }
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "latitude,longitude") {
    throw typedError(
      `${field} point must contain only latitude and longitude`,
      400,
      "CONTEXT_GEOMETRY_INVALID",
    );
  }
  const latitude = Number(value.latitude);
  const longitude = Number(value.longitude);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw typedError(
      `${field} coordinates are out of range`,
      400,
      "CONTEXT_GEOMETRY_INVALID",
    );
  }
  return { latitude, longitude };
};

const cleanGeometry = (entityKind, typeKind, value) => {
  if (entityKind !== "place") {
    if (value !== undefined && value !== null) {
      throw typedError(
        "Only Places may carry geometry",
        400,
        "CONTEXT_GEOMETRY_INVALID",
      );
    }
    return null;
  }
  if (typeKind === "unlocated") {
    if (value !== undefined && value !== null) {
      throw typedError(
        "Unlocated Places cannot carry geometry",
        400,
        "CONTEXT_GEOMETRY_INVALID",
      );
    }
    return null;
  }
  if (typeKind === "point") return cleanPoint(value);
  if (typeKind === "area") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw typedError(
        "Area geometry is required",
        400,
        "CONTEXT_GEOMETRY_INVALID",
      );
    }
    const keys = Object.keys(value).sort();
    if (keys.join(",") !== "east,north,south,west") {
      throw typedError(
        "Area geometry must contain only north, south, east and west",
        400,
        "CONTEXT_GEOMETRY_INVALID",
      );
    }
    const area = Object.fromEntries(
      keys.map((key) => [key, Number(value[key])]),
    );
    if (
      Object.values(area).some((number) => !Number.isFinite(number)) ||
      area.north < area.south ||
      area.north > 90 ||
      area.south < -90 ||
      area.east > 180 ||
      area.east < -180 ||
      area.west > 180 ||
      area.west < -180
    ) {
      throw typedError(
        "Area geometry is out of range",
        400,
        "CONTEXT_GEOMETRY_INVALID",
      );
    }
    return area;
  }
  if (typeKind === "route") {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).join(",") !== "points" ||
      !Array.isArray(value.points) ||
      value.points.length < 2 ||
      value.points.length > 500
    ) {
      throw typedError(
        "Route geometry requires 2 to 500 points",
        400,
        "CONTEXT_GEOMETRY_INVALID",
      );
    }
    return {
      points: value.points.map((point, index) =>
        cleanPoint(point, `geometry.points[${index}]`),
      ),
    };
  }
  throw typedError("Place kind is unsupported", 400, "CONTEXT_KIND_INVALID");
};

const cleanKind = (entityKind, value) => {
  const kind = String(value || "").trim();
  if (!typedKinds[entityKind]?.has(kind)) {
    throw typedError(
      `${entityKind} kind is unsupported`,
      400,
      "CONTEXT_KIND_INVALID",
    );
  }
  return kind;
};

const cleanEntityInput = (value, { partial = false } = {}) => {
  const entityKind =
    value.entityKind === undefined && partial
      ? undefined
      : String(value.entityKind || "").trim();
  if (entityKind !== undefined && !entityKinds.has(entityKind)) {
    throw typedError("entityKind is unsupported", 400, "CONTEXT_KIND_INVALID");
  }
  const requested = {
    ...(entityKind !== undefined ? { entityKind } : {}),
    ...(value.displayName !== undefined || !partial
      ? { displayName: cleanText(value.displayName, 160, "displayName") }
      : {}),
    ...(value.description !== undefined
      ? {
          description: cleanText(value.description, 4000, "description", {
            nullable: true,
          }),
        }
      : {}),
    ...(value.aliases !== undefined
      ? { aliases: cleanAliases(value.aliases) }
      : {}),
    ...(value.dateStart !== undefined
      ? { dateStart: cleanDate(value.dateStart, "dateStart") }
      : {}),
    ...(value.dateEnd !== undefined
      ? { dateEnd: cleanDate(value.dateEnd, "dateEnd") }
      : {}),
    ...(value.datePrecision !== undefined || !partial
      ? { datePrecision: String(value.datePrecision || "unknown").trim() }
      : {}),
    ...(value.parentEntityId !== undefined
      ? {
          parentEntityId:
            value.parentEntityId == null
              ? null
              : cleanEntityId(value.parentEntityId, "parentEntityId"),
        }
      : {}),
    ...(value.status !== undefined
      ? { status: String(value.status).trim() }
      : {}),
  };
  if (requested.datePrecision && !datePrecisions.has(requested.datePrecision)) {
    throw typedError(
      "datePrecision is unsupported",
      400,
      "CONTEXT_DATE_INVALID",
    );
  }
  if (requested.status && !statuses.has(requested.status)) {
    throw typedError("status is unsupported", 400, "CONTEXT_STATUS_INVALID");
  }
  if (!partial) {
    requested.typeKind = cleanKind(entityKind, value.typeKind);
    requested.geometry = cleanGeometry(
      entityKind,
      requested.typeKind,
      value.geometry,
    );
  } else {
    if (value.typeKind !== undefined)
      requested.typeKind = String(value.typeKind).trim();
    if (value.geometry !== undefined) requested.geometry = value.geometry;
  }
  if (
    requested.dateStart &&
    requested.dateEnd &&
    requested.dateEnd < requested.dateStart
  ) {
    throw typedError(
      "dateEnd cannot precede dateStart",
      400,
      "CONTEXT_DATE_INVALID",
    );
  }
  return requested;
};

const cleanLimit = (value, fallback = 100, maximum = 500) => {
  if (value === null || value === undefined || String(value).trim() === "") {
    return fallback;
  }
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) {
    throw typedError(
      `limit must be an integer from 1 to ${maximum}`,
      400,
      "CONTEXT_LIMIT_INVALID",
      { maximum },
    );
  }
  return limit;
};

const cleanExpectedRevision = (value) => {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw typedError(
      "expectedRevision must be a positive integer",
      400,
      "CONTEXT_REVISION_INVALID",
    );
  }
  return revision;
};

const cleanQuery = (value) => {
  const query = String(value || "")
    .trim()
    .replace(/\s+/g, " ");
  if (query.length > 500) {
    throw typedError(
      "query must be 500 characters or fewer",
      400,
      "CONTEXT_QUERY_INVALID",
    );
  }
  return query;
};

const projectDate = (value) =>
  value instanceof Date
    ? value.toISOString().slice(0, 10)
    : value
      ? String(value).slice(0, 10)
      : null;

const beginCommand = async (
  tx,
  { actorId, commandId, commandKind, payload },
) => {
  const id = cleanCommandId(commandId);
  const requestDigest = digest({ commandKind, payload });
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
  const [existing] = await tx`
    SELECT command_kind, actor_id, request_digest, response
    FROM context_command WHERE command_id = ${id}
  `;
  if (existing) {
    if (
      existing.command_kind !== commandKind ||
      existing.actor_id !== actorId ||
      existing.request_digest !== requestDigest
    ) {
      throw typedError(
        "commandId was already used for a different context command",
        409,
        "CONTEXT_COMMAND_CONFLICT",
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
    INSERT INTO context_command (
      command_id, command_kind, actor_id, request_digest, decision_id, response
    ) VALUES (
      ${command.commandId}, ${commandKind}, ${actorId},
      ${command.requestDigest}, ${decisionId}, ${tx.json(response)}
    )
  `;
  return response;
};

const createDecision = async (
  tx,
  {
    action,
    actorId,
    entityId,
    note,
    reasonCode,
    subjectType = "context_entity",
    supersedes = null,
  },
) => {
  const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
  await tx`
    INSERT INTO decision (
      decision_id, subject_type, subject_id, action, actor_kind, actor_id,
      reason_code, note, supersedes_decision_id, producer_receipt_id,
      privacy_class
    ) VALUES (
      ${decisionId}, ${subjectType}, ${entityId}, ${action}, 'user', ${actorId},
      ${reasonCode}, ${note}, ${supersedes}, ${receiptId}, 'private'
    )
  `;
  return decisionId;
};

const requireEntity = async (
  executor,
  entityId,
  {
    entityKind,
    includeArchived = false,
    lock = false,
    presentationRank = () => 0,
    requireVisible = false,
  } = {},
) => {
  const id = cleanEntityId(entityId);
  const rows = lock
    ? await executor`
        SELECT entity.*,
          CASE
            WHEN entity.parent_entity_id IS NULL
              OR cimmich_visibility_context_entity_rank(entity.parent_entity_id) <= ${presentationRank()}
            THEN entity.parent_entity_id
            ELSE NULL
          END AS visible_parent_entity_id,
          coalesce((SELECT visibility_tier FROM cimmich_visibility_object
            WHERE object_scope = 'context_entity'
              AND object_id = entity.entity_id), 'standard') AS entity_visibility_tier,
          coalesce((SELECT revision FROM cimmich_visibility_object
            WHERE object_scope = 'context_entity'
              AND object_id = entity.entity_id), 0)::bigint AS entity_visibility_revision,
          (SELECT decision_id FROM cimmich_visibility_object
            WHERE object_scope = 'context_entity'
              AND object_id = entity.entity_id) AS entity_visibility_decision_id
        FROM context_entity entity
        WHERE entity.entity_id = ${id}
          AND entity.status <> 'deleted'
          AND (${Boolean(includeArchived)} OR entity.status <> 'archived')
          AND (${!requireVisible} OR cimmich_visibility_context_entity_rank(entity.entity_id) <= ${presentationRank()})
        FOR UPDATE OF entity
      `
    : await executor`
        SELECT entity.*,
          CASE
            WHEN entity.parent_entity_id IS NULL
              OR cimmich_visibility_context_entity_rank(entity.parent_entity_id) <= ${presentationRank()}
            THEN entity.parent_entity_id
            ELSE NULL
          END AS visible_parent_entity_id,
          coalesce((SELECT visibility_tier FROM cimmich_visibility_object
            WHERE object_scope = 'context_entity'
              AND object_id = entity.entity_id), 'standard') AS entity_visibility_tier,
          coalesce((SELECT revision FROM cimmich_visibility_object
            WHERE object_scope = 'context_entity'
              AND object_id = entity.entity_id), 0)::bigint AS entity_visibility_revision,
          (SELECT decision_id FROM cimmich_visibility_object
            WHERE object_scope = 'context_entity'
              AND object_id = entity.entity_id) AS entity_visibility_decision_id
        FROM context_entity entity
        WHERE entity.entity_id = ${id}
          AND entity.status <> 'deleted'
          AND (${Boolean(includeArchived)} OR entity.status <> 'archived')
          AND (${!requireVisible} OR cimmich_visibility_context_entity_rank(entity.entity_id) <= ${presentationRank()})
      `;
  const entity = rows[0];
  if (!entity || (entityKind && entity.entity_kind !== entityKind)) {
    throw typedError("Context entity not found", 404, "CONTEXT_NOT_FOUND");
  }
  return entity;
};

const loadAliases = async (executor, entityId) =>
  executor`
    SELECT label FROM context_entity_alias
    WHERE entity_id = ${entityId} AND state = 'active'
    ORDER BY lower(label), alias_id
  `;

const canonicalAliases = (aliases) =>
  [...aliases].sort(
    (left, right) =>
      left.toLowerCase().localeCompare(right.toLowerCase()) ||
      left.localeCompare(right),
  );

const entityStateSnapshot = (row, aliases) => ({
  aliases: canonicalAliases(aliases),
  coverAssetId: row.cover_asset_id || null,
  dateEnd: projectDate(row.date_end),
  datePrecision: row.date_precision,
  dateStart: projectDate(row.date_start),
  description: row.description || null,
  displayName: row.display_name,
  entityId: row.entity_id,
  entityKind: row.entity_kind,
  geometry: row.geometry || null,
  parentEntityId: row.parent_entity_id || null,
  revision: Number(row.revision),
  status: row.status,
  typeKind: row.place_kind || row.object_kind || row.event_kind,
});

const loadEntityStateSnapshot = async (executor, row) => {
  const aliases = await loadAliases(executor, row.entity_id);
  return entityStateSnapshot(
    row,
    aliases.map((alias) => alias.label),
  );
};

const sameEntityState = (left, right, { ignoreRevision = false } = {}) => {
  const comparable = (value) =>
    ignoreRevision ? { ...value, revision: 0 } : value;
  return digest(comparable(left)) === digest(comparable(right));
};

const sourceAssetIdFor = (assetId, bridgeFields) => {
  if (!assetId) return null;
  const sourceAssetId = bridgeFields?.(assetId)?.sourceAssetId;
  return sourceAssetId || assetId;
};

const projectEntityRow = (row, { bridgeFields } = {}) => ({
  aliases: row.aliases || [],
  assetCount: Number(row.asset_count || 0),
  coverAssetId: sourceAssetIdFor(
    row.effective_cover_asset_id ?? row.cover_asset_id,
    bridgeFields,
  ),
  coverMode:
    row.selected_cover_asset_id &&
    row.selected_cover_asset_id ===
      (row.effective_cover_asset_id ?? row.cover_asset_id)
      ? "explicit"
      : "automatic",
  dateEnd: projectDate(row.date_end),
  datePrecision: row.date_precision,
  dateStart: projectDate(row.date_start),
  description: row.description || null,
  displayName: row.display_name,
  entityId: row.entity_id,
  entityKind: row.entity_kind,
  geometry: row.geometry || null,
  parentEntityId: Object.hasOwn(row, "visible_parent_entity_id")
    ? row.visible_parent_entity_id || null
    : row.parent_entity_id || null,
  ...(row.entity_kind === "event" && Object.hasOwn(row, "preview_asset_ids")
    ? {
        previewAssetIds: (Array.isArray(row.preview_asset_ids)
          ? row.preview_asset_ids
          : []
        )
          .slice(0, 4)
          .map((assetId) => sourceAssetIdFor(String(assetId), bridgeFields)),
      }
    : {}),
  revision: Number(row.revision),
  status: row.status,
  typeKind: row.place_kind || row.object_kind || row.event_kind,
  visibility: {
    decisionId: row.entity_visibility_decision_id || null,
    explicit: Number(row.entity_visibility_revision || 0) > 0,
    objectId: row.entity_id,
    objectScope: "context_entity",
    revision: Number(row.entity_visibility_revision || 0),
    visibilityTier: row.entity_visibility_tier || "standard",
  },
});

const loadEntities = async (
  executor,
  {
    entityKind,
    bridgeFields,
    includeArchived = false,
    includeHidden = false,
    limit = 100,
    presentationRank,
    query = "",
  },
) => {
  const normalized = cleanQuery(query);
  const search = `%${normalized}%`;
  const rows = await executor`
    SELECT entity.*,
      CASE
        WHEN entity.parent_entity_id IS NULL
          OR cimmich_visibility_context_entity_rank(entity.parent_entity_id) <= ${presentationRank()}
        THEN entity.parent_entity_id
        ELSE NULL
      END AS visible_parent_entity_id,
      coalesce((SELECT visibility_tier FROM cimmich_visibility_object
        WHERE object_scope = 'context_entity'
          AND object_id = entity.entity_id), 'standard') AS entity_visibility_tier,
      coalesce((SELECT revision FROM cimmich_visibility_object
        WHERE object_scope = 'context_entity'
          AND object_id = entity.entity_id), 0)::bigint AS entity_visibility_revision,
      (SELECT decision_id FROM cimmich_visibility_object
        WHERE object_scope = 'context_entity'
          AND object_id = entity.entity_id) AS entity_visibility_decision_id,
      coalesce((SELECT array_agg(alias.label ORDER BY lower(alias.label), alias.alias_id)
        FROM context_entity_alias alias
        WHERE alias.entity_id = entity.entity_id AND alias.state = 'active'), ARRAY[]::text[]) AS aliases,
      coalesce((SELECT count(*)::int FROM current_context_asset link
        WHERE link.entity_id = entity.entity_id
          AND cimmich_visibility_asset_rank(link.asset_id) <= ${presentationRank()}), 0)::int AS asset_count,
      entity.cover_asset_id AS selected_cover_asset_id,
      cover.asset_id AS effective_cover_asset_id,
      coalesce(preview.asset_ids, ARRAY[]::text[]) AS preview_asset_ids
    FROM context_entity entity
    LEFT JOIN LATERAL (
      SELECT link.asset_id
      FROM current_context_asset link
      JOIN asset ON asset.asset_id = link.asset_id AND asset.state = 'active'
      WHERE link.entity_id = entity.entity_id
        AND cimmich_visibility_asset_rank(link.asset_id) <= ${presentationRank()}
      ORDER BY CASE WHEN link.asset_id = entity.cover_asset_id THEN 0 ELSE 1 END,
        asset.capture_time DESC NULLS LAST, link.asset_id
      LIMIT 1
    ) cover ON true
    LEFT JOIN LATERAL (
      SELECT array_agg(candidate.asset_id ORDER BY candidate.cover_priority,
        candidate.capture_time DESC NULLS LAST, candidate.asset_id) AS asset_ids
      FROM (
        SELECT link.asset_id, asset.capture_time,
          CASE WHEN link.asset_id = cover.asset_id THEN 0 ELSE 1 END AS cover_priority
        FROM current_context_asset link
        JOIN asset ON asset.asset_id = link.asset_id AND asset.state = 'active'
        WHERE link.entity_id = entity.entity_id
          AND entity.entity_kind = 'event'
          AND link.association_kind IN ('direct', 'manual')
          AND cimmich_visibility_asset_rank(link.asset_id) <= ${presentationRank()}
        ORDER BY cover_priority, asset.capture_time DESC NULLS LAST, link.asset_id
        LIMIT 4
      ) candidate
    ) preview ON true
    WHERE entity.entity_kind = ${entityKind}
      AND entity.status <> 'deleted'
      AND (
        entity.status = 'active'
        OR (${Boolean(includeHidden)} AND entity.status = 'hidden')
        OR (${Boolean(includeArchived)} AND entity.status = 'archived')
      )
      AND (${normalized} = '' OR entity.display_name ILIKE ${search} OR EXISTS (
        SELECT 1 FROM context_entity_alias alias
        WHERE alias.entity_id = entity.entity_id AND alias.state = 'active'
          AND alias.label ILIKE ${search}
      ))
      AND cimmich_visibility_context_entity_rank(entity.entity_id) <= ${presentationRank()}
    ORDER BY lower(entity.display_name), entity.entity_id
    LIMIT ${cleanLimit(limit)}
  `;
  return rows.map((row) => projectEntityRow(row, { bridgeFields }));
};

const loadDetail = async (
  executor,
  {
    bridgeFields,
    entityId,
    entityKind,
    includeArchived = false,
    presentationRank,
  },
) => {
  const entity = await requireEntity(executor, entityId, {
    entityKind,
    includeArchived,
    presentationRank,
    requireVisible: true,
  });
  const aliases = await loadAliases(executor, entity.entity_id);
  const assets = await executor`
    SELECT link.link_id, link.asset_id, link.association_kind, link.created_at,
      asset.capture_time, asset.media_kind, asset.mime_type, asset.width, asset.height
    FROM current_context_asset link
    JOIN asset ON asset.asset_id = link.asset_id AND asset.state = 'active'
    WHERE link.entity_id = ${entity.entity_id}
      AND cimmich_visibility_asset_rank(link.asset_id) <= ${presentationRank()}
    ORDER BY asset.capture_time DESC NULLS LAST, link.asset_id
  `;
  const relations = await executor`
    SELECT link.link_id, link.target_kind, link.target_id, link.relation_kind,
      link.created_at,
      coalesce(subject.display_name, target.display_name, '') AS target_name
    FROM current_context_relation link
    LEFT JOIN current_person subject
      ON link.target_kind IN ('person','pet') AND subject.person_id = link.target_id
      AND subject.subject_kind = link.target_kind AND subject.status = 'active'
    LEFT JOIN context_entity target
      ON link.target_kind IN ('place','object','event')
      AND target.entity_id = link.target_id
      AND target.status NOT IN ('archived','deleted')
    WHERE link.entity_id = ${entity.entity_id}
      AND ((link.target_kind IN ('person','pet') AND subject.person_id IS NOT NULL
          AND cimmich_visibility_subject_rank(
            subject.subject_kind, subject.person_id
          ) <= ${presentationRank()})
        OR (link.target_kind IN ('place','object','event')
          AND target.entity_id IS NOT NULL
          AND cimmich_visibility_context_entity_rank(target.entity_id) <= ${presentationRank()}))
    ORDER BY link.relation_kind, lower(coalesce(subject.display_name, target.display_name, '')),
      link.target_id
  `;
  return {
    assets: assets.map((row) => ({
      assetId: row.asset_id,
      associationId: row.link_id,
      associationKind: row.association_kind,
      captureTime: row.capture_time,
      height: row.height,
      linkedAt: row.created_at,
      mediaKind: row.media_kind,
      mimeType: row.mime_type,
      ...bridgeFields(row.asset_id),
      width: row.width,
    })),
    entity: (() => {
      const selected = assets.find(
        (asset) => asset.asset_id === entity.cover_asset_id,
      );
      return projectEntityRow(
        {
          ...entity,
          aliases: aliases.map((row) => row.label),
          asset_count: assets.length,
          effective_cover_asset_id:
            selected?.asset_id || assets[0]?.asset_id || null,
          selected_cover_asset_id: selected?.asset_id || null,
        },
        { bridgeFields },
      );
    })(),
    relations: relations.map((row) => ({
      linkedAt: row.created_at,
      relationId: row.link_id,
      relationKind: row.relation_kind,
      targetId: row.target_id,
      targetKind: row.target_kind,
      targetName: row.target_name || "",
    })),
    schemaVersion,
  };
};

// A replay is idempotent, but its embedded projection must still respect the
// caller's current visibility mode. Never return a historic asset count or
// cover from the stored response when that entity is now hidden.
const refreshReplay = async (
  executor,
  replay,
  { bridgeFields, presentationRank },
) => {
  const replayEntity = replay?.detail?.entity;
  if (!replayEntity?.entityId || !replayEntity?.entityKind) return replay;
  try {
    const detail = await loadDetail(executor, {
      bridgeFields,
      entityId: replayEntity.entityId,
      entityKind: replayEntity.entityKind,
      includeArchived: replayEntity.status === "archived",
      presentationRank,
    });
    return { ...replay, detail };
  } catch (error) {
    if (error?.code !== "CONTEXT_NOT_FOUND") throw error;
    return { ...replay, detail: null, projectionUnavailable: true };
  }
};

const applyAliases = async (tx, entityId, aliases) => {
  if (aliases === undefined) return;
  const desired = new Map(aliases.map((label) => [label.toLowerCase(), label]));
  const current = await tx`
    SELECT alias_id, label FROM context_entity_alias
    WHERE entity_id = ${entityId} AND state = 'active'
    FOR UPDATE
  `;
  for (const alias of current) {
    const key = alias.label.toLowerCase();
    if (desired.has(key)) desired.delete(key);
    else
      await tx`
      UPDATE context_entity_alias SET state = 'removed'
      WHERE alias_id = ${alias.alias_id}
    `;
  }
  for (const label of desired.values()) {
    await tx`
      INSERT INTO context_entity_alias (alias_id, entity_id, label)
      VALUES (${`contextalias_${randomUUID().replaceAll("-", "")}`}, ${entityId}, ${label})
    `;
  }
};

const cleanAssetItems = (value, entityKind) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw typedError(
      "assets must contain 1 to 100 items",
      400,
      "CONTEXT_ASSETS_INVALID",
    );
  }
  const items = value.map((item) => ({
    assetId: String(item?.assetId || "").trim(),
    associationKind: String(item?.associationKind || "").trim(),
  }));
  if (
    items.some(
      (item) =>
        !item.assetId ||
        item.assetId.length > 200 ||
        !associationKinds[entityKind].has(item.associationKind),
    ) ||
    new Set(items.map((item) => item.assetId)).size !== items.length
  ) {
    throw typedError(
      "Context asset IDs or association kinds are invalid",
      400,
      "CONTEXT_ASSETS_INVALID",
    );
  }
  return items;
};

const cleanIds = (value, code) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw typedError("IDs must contain 1 to 100 items", 400, code);
  }
  const ids = value.map((item) => String(item || "").trim());
  if (
    ids.some((id) => !id || id.length > 200) ||
    new Set(ids).size !== ids.length
  ) {
    throw typedError("IDs must be unique and non-blank", 400, code);
  }
  return ids;
};

const cleanRelations = (value, entityKind) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw typedError(
      "relations must contain 1 to 100 items",
      400,
      "CONTEXT_RELATIONS_INVALID",
    );
  }
  if (
    value.some(
      (item) => item?.direction !== undefined && item.direction !== "outgoing",
    )
  ) {
    throw typedError(
      "Context relation direction is unsupported",
      400,
      "CONTEXT_RELATIONS_INVALID",
    );
  }
  const items = value.map((item) => ({
    relationKind: String(item?.relationKind || "").trim(),
    targetId: String(item?.targetId || "").trim(),
    targetKind: String(item?.targetKind || "").trim(),
  }));
  if (
    items.some(
      (item) =>
        !item.targetId ||
        item.targetId.length > 200 ||
        !targetKinds.has(item.targetKind) ||
        !relationKinds.has(item.relationKind) ||
        (targetKindByRelationKind[item.relationKind] !== undefined &&
          targetKindByRelationKind[item.relationKind] !== item.targetKind) ||
        (item.relationKind === "parent" &&
          (item.targetKind !== entityKind ||
            !["place", "event"].includes(entityKind))) ||
        (entityKind !== "event" &&
          ["participant", "companion", "location", "object"].includes(
            item.relationKind,
          )),
    ) ||
    new Set(
      items.map(
        (item) => `${item.targetKind}:${item.targetId}:${item.relationKind}`,
      ),
    ).size !== items.length
  ) {
    throw typedError(
      "Context relations are invalid",
      400,
      "CONTEXT_RELATIONS_INVALID",
    );
  }
  return items;
};

const requireParent = async (
  executor,
  parentEntityId,
  entityKind,
  entityId = null,
  presentationRank = () => 0,
) => {
  if (!parentEntityId) return;
  const [parent] = await executor`
    SELECT entity_kind FROM context_entity
    WHERE entity_id = ${parentEntityId} AND status <> 'archived'
      AND status <> 'deleted'
      AND cimmich_visibility_context_entity_rank(entity_id) <= ${presentationRank()}
  `;
  if (
    !parent ||
    parent.entity_kind !== entityKind ||
    !["place", "event"].includes(entityKind)
  ) {
    throw typedError(
      "Context parent must be a current same-kind Place or Event",
      409,
      "CONTEXT_PARENT_INVALID",
    );
  }
  if (entityId) {
    const cycle = await executor`
      WITH RECURSIVE ancestors(entity_id, parent_entity_id) AS (
        SELECT entity_id, parent_entity_id FROM context_entity
        WHERE entity_id = ${parentEntityId}
        UNION
        SELECT parent.entity_id, parent.parent_entity_id
        FROM context_entity parent JOIN ancestors child
          ON parent.entity_id = child.parent_entity_id
      )
      SELECT 1 FROM ancestors WHERE entity_id = ${entityId} LIMIT 1
    `;
    if (cycle[0]) {
      throw typedError(
        "Context parent hierarchy cannot contain a cycle",
        409,
        "CONTEXT_PARENT_CYCLE",
      );
    }
  }
};

const requireRelationTargets = async (
  executor,
  items,
  presentationRank = () => 0,
) => {
  const personTargets = items.filter((item) =>
    ["person", "pet"].includes(item.targetKind),
  );
  const contextTargets = items.filter((item) =>
    ["place", "object", "event"].includes(item.targetKind),
  );
  const found = new Set();
  if (personTargets.length) {
    const ids = [...new Set(personTargets.map((item) => item.targetId))];
    const rows = await executor`
      SELECT person_id, subject_kind FROM person
      WHERE person_id = ANY(${ids}) AND status = 'active'
        AND cimmich_visibility_subject_rank(subject_kind, person_id)
          <= ${presentationRank()}
    `;
    for (const row of rows) found.add(`${row.subject_kind}:${row.person_id}`);
  }
  if (contextTargets.length) {
    const ids = [...new Set(contextTargets.map((item) => item.targetId))];
    const rows = await executor`
      SELECT entity_id, entity_kind FROM context_entity
      WHERE entity_id = ANY(${ids}) AND status = 'active'
        AND cimmich_visibility_context_entity_rank(entity_id) <= ${presentationRank()}
    `;
    for (const row of rows) found.add(`${row.entity_kind}:${row.entity_id}`);
  }
  const missing = items
    .filter((item) => !found.has(`${item.targetKind}:${item.targetId}`))
    .map((item) => ({ targetId: item.targetId, targetKind: item.targetKind }));
  if (missing.length) {
    throw typedError(
      "One or more context relation targets were not found in the declared scope",
      404,
      "CONTEXT_RELATION_TARGET_NOT_FOUND",
      { missing },
    );
  }
};

const cleanRelationIds = (value) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw typedError(
      "relationIds must contain 1 to 100 items",
      400,
      "CONTEXT_RELATIONS_INVALID",
    );
  }
  const ids = value.map((item) => String(item || "").trim());
  if (
    ids.some((id) => !id || id.length > 200) ||
    new Set(ids).size !== ids.length
  ) {
    throw typedError(
      "relationIds must be unique and non-blank",
      400,
      "CONTEXT_RELATIONS_INVALID",
    );
  }
  return ids;
};

export const createContextEntityStore = (
  sql,
  {
    assetIdBySourceId = () => null,
    bridgeFields = () => ({}),
    presentationRank = () => 0,
  } = {},
) => {
  const api = {
    list: ({ entityKind, includeArchived, includeHidden, limit, query }) => {
      if (!entityKinds.has(entityKind)) {
        throw typedError(
          "entityKind is unsupported",
          400,
          "CONTEXT_KIND_INVALID",
        );
      }
      return loadEntities(sql, {
        bridgeFields,
        entityKind,
        includeArchived,
        includeHidden,
        limit,
        presentationRank,
        query,
      });
    },

    get: ({ entityId, entityKind, includeArchived = false }) =>
      loadDetail(sql, {
        bridgeFields,
        entityId,
        entityKind,
        includeArchived,
        presentationRank,
      }),

    async create({ actorId, commandId, ...input }) {
      const actor = cleanActor(actorId);
      const requested = cleanEntityInput(input);
      if (requested.status === "archived") {
        throw typedError(
          "New context entities must be active or hidden",
          400,
          "CONTEXT_STATUS_INVALID",
        );
      }
      return sql.begin(async (tx) => {
        const command = await beginCommand(tx, {
          actorId: actor,
          commandId,
          commandKind: "create",
          payload: requested,
        });
        if (command.replay)
          return refreshReplay(tx, command.replay, {
            bridgeFields,
            presentationRank,
          });
        const entityId = `${requested.entityKind}_${randomUUID().replaceAll("-", "")}`;
        const decisionId = await createDecision(tx, {
          action: "create",
          actorId: actor,
          entityId,
          note: `Create ${requested.entityKind}`,
          reasonCode: "context_manual_create",
        });
        await requireParent(
          tx,
          requested.parentEntityId,
          requested.entityKind,
          null,
          presentationRank,
        );
        await tx`
          INSERT INTO context_entity (
            entity_id, entity_kind, place_kind, object_kind, event_kind,
            display_name, description, date_start, date_end, date_precision,
            geometry, parent_entity_id, status
          ) VALUES (
            ${entityId}, ${requested.entityKind},
            ${requested.entityKind === "place" ? requested.typeKind : null},
            ${requested.entityKind === "object" ? requested.typeKind : null},
            ${requested.entityKind === "event" ? requested.typeKind : null},
            ${requested.displayName}, ${requested.description || null},
            ${requested.dateStart || null}, ${requested.dateEnd || null},
            ${requested.datePrecision},
            ${requested.geometry ? tx.json(requested.geometry) : null},
            ${requested.parentEntityId || null}, ${requested.status || "active"}
          )
        `;
        await applyAliases(tx, entityId, requested.aliases || []);
        const created = await requireEntity(tx, entityId, {
          entityKind: requested.entityKind,
          lock: true,
          presentationRank,
        });
        const createdState = await loadEntityStateSnapshot(tx, created);
        const detail = await loadDetail(tx, {
          bridgeFields,
          entityId,
          entityKind: requested.entityKind,
          presentationRank,
        });
        const response = {
          changed: true,
          commandId: command.commandId,
          decisionId,
          detail,
          replayed: false,
          schemaVersion,
          status: "applied",
          undo: { eligible: true, token: decisionId },
        };
        await completeCommand(tx, {
          actorId: actor,
          command,
          commandKind: "create",
          decisionId,
          response,
        });
        await tx`
          INSERT INTO context_operation (
            operation_id, command_id, entity_id, operation_scope, action,
            decision_id, state, snapshot
          ) VALUES (
            ${`contextop_${randomUUID().replaceAll("-", "")}`},
            ${command.commandId}, ${entityId}, 'entity', 'create',
            ${decisionId}, 'active', ${tx.json([
              { next: createdState, operationKind: "create" },
            ])}
          )
        `;
        return response;
      });
    },

    async update({
      actorId,
      commandId,
      entityId,
      entityKind,
      expectedRevision,
      ...input
    }) {
      const actor = cleanActor(actorId);
      const revision =
        expectedRevision === undefined
          ? null
          : cleanExpectedRevision(expectedRevision);
      const requested = cleanEntityInput(input, { partial: true });
      delete requested.entityKind;
      if (!Object.keys(requested).length) {
        throw typedError(
          "No context fields were supplied",
          400,
          "CONTEXT_UPDATE_EMPTY",
        );
      }
      return sql.begin(async (tx) => {
        const command = await beginCommand(tx, {
          actorId: actor,
          commandId,
          commandKind: "update",
          payload: { entityId, expectedRevision: revision, ...requested },
        });
        if (command.replay)
          return refreshReplay(tx, command.replay, {
            bridgeFields,
            presentationRank,
          });
        const current = await requireEntity(tx, entityId, {
          entityKind,
          includeArchived: requested.status !== undefined,
          lock: true,
          presentationRank,
          requireVisible: true,
        });
        if (revision !== null && Number(current.revision) !== revision) {
          throw typedError(
            `${current.entity_kind === "place" ? "Place" : current.entity_kind === "object" ? "Thing" : "Event"} changed after its editor was opened`,
            409,
            "CONTEXT_UPDATE_STALE",
          );
        }
        const currentType =
          current.place_kind || current.object_kind || current.event_kind;
        const nextType =
          requested.typeKind === undefined
            ? currentType
            : cleanKind(current.entity_kind, requested.typeKind);
        const nextGeometry =
          requested.geometry === undefined && requested.typeKind === undefined
            ? current.geometry
            : nextType === "unlocated" && requested.geometry === undefined
              ? null
              : cleanGeometry(
                  current.entity_kind,
                  nextType,
                  requested.geometry === undefined
                    ? current.geometry
                    : requested.geometry,
                );
        const nextDateStart = Object.hasOwn(requested, "dateStart")
          ? requested.dateStart
          : projectDate(current.date_start);
        const nextDateEnd = Object.hasOwn(requested, "dateEnd")
          ? requested.dateEnd
          : projectDate(current.date_end);
        if (nextDateStart && nextDateEnd && nextDateEnd < nextDateStart) {
          throw typedError(
            "dateEnd cannot precede dateStart",
            400,
            "CONTEXT_DATE_INVALID",
          );
        }
        const nextParentId = Object.hasOwn(requested, "parentEntityId")
          ? requested.parentEntityId
          : current.parent_entity_id;
        await requireParent(
          tx,
          nextParentId,
          current.entity_kind,
          current.entity_id,
          presentationRank,
        );
        if (requested.status === "archived") {
          const [children] = await tx`
            SELECT count(*)::int AS count FROM context_entity
            WHERE parent_entity_id = ${current.entity_id}
              AND status IN ('active','hidden')
          `;
          if (Number(children.count) > 0) {
            throw typedError(
              "Move or archive current child entities first",
              409,
              "CONTEXT_ARCHIVE_HAS_CHILDREN",
              { childCount: Number(children.count) },
            );
          }
        }
        const previousState = await loadEntityStateSnapshot(tx, current);
        const nextState = {
          ...previousState,
          aliases:
            requested.aliases === undefined
              ? previousState.aliases
              : canonicalAliases(requested.aliases),
          dateEnd: nextDateEnd,
          datePrecision: requested.datePrecision ?? previousState.datePrecision,
          dateStart: nextDateStart,
          description: Object.hasOwn(requested, "description")
            ? requested.description
            : previousState.description,
          displayName: requested.displayName ?? previousState.displayName,
          geometry: nextGeometry,
          parentEntityId: nextParentId || null,
          revision: previousState.revision + 1,
          status: requested.status ?? previousState.status,
          typeKind: nextType,
        };
        if (
          sameEntityState(previousState, nextState, { ignoreRevision: true })
        ) {
          const detail = await loadDetail(tx, {
            bridgeFields,
            entityId: current.entity_id,
            entityKind: current.entity_kind,
            includeArchived: current.status === "archived",
            presentationRank,
          });
          const response = {
            changed: false,
            commandId: command.commandId,
            decisionId: null,
            detail,
            replayed: false,
            schemaVersion,
            status: "no_change",
            undo: { eligible: false, token: null },
          };
          return completeCommand(tx, {
            actorId: actor,
            command,
            commandKind: "update",
            decisionId: null,
            response,
          });
        }
        const decisionId = await createDecision(tx, {
          action:
            requested.status === "archived"
              ? "archive"
              : current.status === "archived" &&
                  ["active", "hidden"].includes(requested.status)
                ? "restore"
                : "update",
          actorId: actor,
          entityId: current.entity_id,
          note: `Update ${current.entity_kind}`,
          reasonCode: "context_manual_update",
        });
        await tx`
          UPDATE context_entity SET
            display_name = ${requested.displayName ?? current.display_name},
            description = ${Object.hasOwn(requested, "description") ? requested.description : current.description},
            place_kind = ${current.entity_kind === "place" ? nextType : null},
            object_kind = ${current.entity_kind === "object" ? nextType : null},
            event_kind = ${current.entity_kind === "event" ? nextType : null},
            date_start = ${nextDateStart}, date_end = ${nextDateEnd},
            date_precision = ${requested.datePrecision ?? current.date_precision},
            geometry = ${nextGeometry ? tx.json(nextGeometry) : null},
            parent_entity_id = ${nextParentId},
            status = ${requested.status ?? current.status},
            revision = revision + 1, updated_at = now()
          WHERE entity_id = ${current.entity_id}
        `;
        await applyAliases(tx, current.entity_id, requested.aliases);
        const updated = await requireEntity(tx, current.entity_id, {
          entityKind: current.entity_kind,
          includeArchived: nextState.status === "archived",
          lock: true,
          presentationRank,
        });
        const persistedNextState = await loadEntityStateSnapshot(tx, updated);
        if (!sameEntityState(persistedNextState, nextState)) {
          throw typedError(
            "Context update did not persist its exact canonical state",
            409,
            "CONTEXT_UPDATE_STALE",
          );
        }
        const detail = await loadDetail(tx, {
          bridgeFields,
          entityId: current.entity_id,
          entityKind: current.entity_kind,
          includeArchived: (requested.status ?? current.status) === "archived",
          presentationRank,
        });
        const response = {
          changed: true,
          commandId: command.commandId,
          decisionId,
          detail,
          replayed: false,
          schemaVersion,
          status: "applied",
          undo: { eligible: true, token: decisionId },
        };
        await completeCommand(tx, {
          actorId: actor,
          command,
          commandKind: "update",
          decisionId,
          response,
        });
        await tx`
          INSERT INTO context_operation (
            operation_id, command_id, entity_id, operation_scope, action,
            decision_id, state, snapshot
          ) VALUES (
            ${`contextop_${randomUUID().replaceAll("-", "")}`},
            ${command.commandId}, ${current.entity_id}, 'entity', 'update',
            ${decisionId}, 'active', ${tx.json([
              {
                next: persistedNextState,
                operationKind: "update",
                previous: previousState,
              },
            ])}
          )
        `;
        return response;
      });
    },
  };

  const setEntityCover = async ({
    actorId,
    commandId,
    entityId,
    entityKind,
    expectedRevision,
    sourceAssetId,
  }) => {
    const actor = cleanActor(actorId);
    const revision = cleanExpectedRevision(expectedRevision);
    const normalizedSourceAssetId =
      sourceAssetId === null ? null : String(sourceAssetId || "").trim();
    if (
      sourceAssetId !== null &&
      (!normalizedSourceAssetId || normalizedSourceAssetId.length > 200)
    ) {
      throw typedError(
        "sourceAssetId must be null or a bounded source asset ID",
        400,
        "CONTEXT_COVER_INPUT_INVALID",
      );
    }
    return sql.begin(async (tx) => {
      const command = await beginCommand(tx, {
        actorId: actor,
        commandId,
        commandKind: "cover_set",
        payload: {
          entityId: cleanEntityId(entityId),
          expectedRevision: revision,
          sourceAssetId: normalizedSourceAssetId,
        },
      });
      if (command.replay)
        return refreshReplay(tx, command.replay, {
          bridgeFields,
          presentationRank,
        });
      const entity = await requireEntity(tx, entityId, {
        entityKind,
        lock: true,
        presentationRank,
        requireVisible: true,
      });
      if (Number(entity.revision) !== revision) {
        throw typedError(
          `${entityLabels[entityKind]} changed after it was opened`,
          409,
          "CONTEXT_COVER_STALE",
          { currentRevision: Number(entity.revision) },
        );
      }
      const nextCoverAssetId = normalizedSourceAssetId
        ? assetIdBySourceId(normalizedSourceAssetId)
        : null;
      if (normalizedSourceAssetId) {
        const [available] = nextCoverAssetId
          ? await tx`
              SELECT link.link_id
              FROM context_asset_link link
              JOIN asset ON asset.asset_id = link.asset_id
                AND asset.state = 'active'
              WHERE link.entity_id = ${entity.entity_id}
                AND link.asset_id = ${nextCoverAssetId}
                AND link.state = 'accepted'
                AND cimmich_visibility_asset_rank(link.asset_id) <= ${presentationRank()}
              FOR UPDATE OF link, asset
            `
          : [];
        if (!available) {
          throw typedError(
            "Cover asset is not an active visible context link",
            404,
            "CONTEXT_COVER_ASSET_UNAVAILABLE",
          );
        }
      }
      const previousCoverAssetId = entity.cover_asset_id || null;
      if (previousCoverAssetId === nextCoverAssetId) {
        const detail = await loadDetail(tx, {
          bridgeFields,
          entityId: entity.entity_id,
          entityKind,
          presentationRank,
        });
        const response = {
          changed: false,
          commandId: command.commandId,
          decisionId: null,
          detail,
          replayed: false,
          schemaVersion: coverSchemaVersions[entityKind],
          status: "no_change",
          undo: { eligible: false, token: null },
        };
        return completeCommand(tx, {
          actorId: actor,
          command,
          commandKind: "cover_set",
          decisionId: null,
          response,
        });
      }
      const decisionId = await createDecision(tx, {
        action: "update",
        actorId: actor,
        entityId: entity.entity_id,
        note: nextCoverAssetId
          ? `Set explicit ${entityLabels[entityKind]} cover`
          : `Restore automatic ${entityLabels[entityKind]} cover`,
        reasonCode: nextCoverAssetId
          ? `context_${entityKind}_cover_set`
          : `context_${entityKind}_cover_automatic`,
      });
      await tx`
        UPDATE context_entity SET cover_asset_id = ${nextCoverAssetId},
          revision = revision + 1, updated_at = now()
        WHERE entity_id = ${entity.entity_id}
      `;
      const detail = await loadDetail(tx, {
        bridgeFields,
        entityId: entity.entity_id,
        entityKind,
        presentationRank,
      });
      const response = {
        changed: true,
        commandId: command.commandId,
        decisionId,
        detail,
        replayed: false,
        schemaVersion: coverSchemaVersions[entityKind],
        status: "applied",
        undo: { eligible: true, token: decisionId },
      };
      await completeCommand(tx, {
        actorId: actor,
        command,
        commandKind: "cover_set",
        decisionId,
        response,
      });
      await tx`
        INSERT INTO context_operation (
          operation_id, command_id, entity_id, operation_scope, action,
          decision_id, state, snapshot
        ) VALUES (
          ${`contextop_${randomUUID().replaceAll("-", "")}`},
          ${command.commandId}, ${entity.entity_id}, 'cover', 'set',
          ${decisionId}, 'active', ${tx.json([
            { nextCoverAssetId, previousCoverAssetId },
          ])}
        )
      `;
      return response;
    });
  };

  api.setPlaceCover = (input) =>
    setEntityCover({ ...input, entityKind: "place" });
  api.setObjectCover = (input) =>
    setEntityCover({ ...input, entityKind: "object" });
  api.setEventCover = (input) =>
    setEntityCover({ ...input, entityKind: "event" });

  const refreshDeleteReplay = async (executor, replay, actorId) => {
    const [visible] = await executor`
      SELECT deletion.entity_id
      FROM context_entity_deletion deletion
      JOIN context_entity entity ON entity.entity_id = deletion.entity_id
      WHERE deletion.command_id = ${replay.commandId}
        AND deletion.actor_id = ${actorId}
        AND entity.status = 'deleted'
        AND cimmich_visibility_context_entity_rank(deletion.entity_id) <= ${presentationRank()}
    `;
    if (!visible)
      throw typedError("Context entity not found", 404, "CONTEXT_NOT_FOUND");
    return { ...replay, replayed: true };
  };

  const deleteEntity = async ({
    actorId,
    commandId,
    deleteTags,
    entityId,
    entityKind,
    expectedRevision,
  }) => {
    const actor = cleanActor(actorId);
    const revision = cleanExpectedRevision(expectedRevision);
    if (typeof deleteTags !== "boolean") {
      throw typedError(
        "deleteTags must be true or false",
        400,
        "CONTEXT_DELETE_INPUT_INVALID",
      );
    }
    return sql.begin(async (tx) => {
      const command = await beginCommand(tx, {
        actorId: actor,
        commandId,
        commandKind: "delete",
        payload: {
          deleteTags,
          entityId: cleanEntityId(entityId),
          expectedRevision: revision,
        },
      });
      if (command.replay) return refreshDeleteReplay(tx, command.replay, actor);
      const entity = await requireEntity(tx, entityId, {
        entityKind,
        lock: true,
        presentationRank,
        requireVisible: true,
      });
      if (Number(entity.revision) !== revision) {
        throw typedError(
          `${entityKind === "place" ? "Place" : "Thing"} changed after it was opened`,
          409,
          "CONTEXT_DELETE_STALE",
          { currentRevision: Number(entity.revision) },
        );
      }
      const assets = await tx`
        SELECT link_id, asset_id FROM context_asset_link
        WHERE entity_id = ${entity.entity_id} AND state = 'accepted'
        ORDER BY asset_id FOR UPDATE
      `;
      const [children] = await tx`
        SELECT count(*)::int AS count FROM context_entity
        WHERE parent_entity_id = ${entity.entity_id}
          AND status IN ('active','hidden')
      `;
      const [relations] = await tx`
        SELECT count(*)::int AS count FROM context_relation_link
        WHERE state = 'accepted' AND (
          entity_id = ${entity.entity_id}
          OR (target_kind = ${entityKind} AND target_id = ${entity.entity_id})
        )
      `;
      const [documents] = await tx`
        SELECT count(*)::int AS count FROM current_cimmich_document_link
        WHERE subject_kind = ${entityKind} AND subject_id = ${entity.entity_id}
      `;
      const decisionId = await createDecision(tx, {
        action: "delete",
        actorId: actor,
        entityId: entity.entity_id,
        note: `Permanently delete ${entityKind === "place" ? "Place" : "Thing"}`,
        reasonCode: deleteTags
          ? `context_${entityKind}_delete_with_tags`
          : `context_${entityKind}_delete_keep_tags`,
      });
      await tx`
        UPDATE context_entity SET parent_entity_id = NULL,
          revision = revision + 1, updated_at = now()
        WHERE parent_entity_id = ${entity.entity_id}
          AND status IN ('active','hidden')
      `;
      await tx`
        UPDATE context_entity_alias SET state = 'removed'
        WHERE entity_id = ${entity.entity_id} AND state = 'active'
      `;
      await tx`
        UPDATE context_relation_link SET state = 'superseded'
        WHERE state = 'accepted' AND (
          entity_id = ${entity.entity_id}
          OR (target_kind = ${entityKind} AND target_id = ${entity.entity_id})
        )
      `;
      await tx`
        UPDATE cimmich_document_link SET state = 'superseded'
        WHERE state = 'current' AND subject_kind = ${entityKind}
          AND subject_id = ${entity.entity_id}
      `;
      if (deleteTags) {
        await tx`
          UPDATE context_asset_link SET state = 'superseded'
          WHERE entity_id = ${entity.entity_id} AND state = 'accepted'
        `;
      }
      await tx`
        UPDATE context_entity SET status = 'deleted', parent_entity_id = NULL,
          cover_asset_id = NULL,
          revision = revision + 1, updated_at = now()
        WHERE entity_id = ${entity.entity_id}
      `;
      const deletedTagCount = deleteTags ? assets.length : 0;
      const retainedTagCount = deleteTags ? 0 : assets.length;
      const response = {
        affectedChildren: Number(children.count),
        affectedDocuments: Number(documents.count),
        affectedRelations: Number(relations.count),
        changed: true,
        commandId: command.commandId,
        deletedTagCount,
        displayName: entity.display_name,
        entityId: entity.entity_id,
        immichDatabaseChanged: false,
        rawMediaChanged: false,
        replayed: false,
        retainedTagCount,
        schemaVersion:
          entityKind === "place"
            ? placeDeleteSchemaVersion
            : objectDeleteSchemaVersion,
        status: "deleted",
        undo: { eligible: false, reason: "permanent_delete" },
      };
      await completeCommand(tx, {
        actorId: actor,
        command,
        commandKind: "delete",
        decisionId,
        response,
      });
      await tx`
        INSERT INTO context_entity_deletion (
          deletion_id, entity_id, command_id, decision_id, actor_id,
          display_name, delete_tags, previous_revision, deleted_revision,
          deleted_tag_count, retained_tag_count, affected_child_count,
          affected_relation_count, affected_document_count, visibility_asset_ids
        ) VALUES (
          ${`contextdelete_${randomUUID().replaceAll("-", "")}`},
          ${entity.entity_id}, ${command.commandId}, ${decisionId}, ${actor},
          ${entity.display_name}, ${deleteTags}, ${revision}, ${revision + 1},
          ${deletedTagCount}, ${retainedTagCount}, ${Number(children.count)},
          ${Number(relations.count)}, ${Number(documents.count)},
          ${tx.json(assets.map((row) => row.asset_id))}
        )
      `;
      return response;
    });
  };

  api.deletePlace = (input) => deleteEntity({ ...input, entityKind: "place" });
  api.deleteObject = (input) =>
    deleteEntity({ ...input, entityKind: "object" });

  const modifyAssets = async ({
    actorId,
    assetIds,
    assets,
    commandId,
    entityId,
    entityKind,
    selected,
  }) => {
    const actor = cleanActor(actorId);
    const items = selected
      ? cleanAssetItems(assets, entityKind)
      : cleanIds(assetIds, "CONTEXT_ASSETS_INVALID").map((assetId) => ({
          assetId,
        }));
    const commandKind = selected ? "asset_attach" : "asset_detach";
    return sql.begin(async (tx) => {
      const command = await beginCommand(tx, {
        actorId: actor,
        commandId,
        commandKind,
        payload: { entityId, items },
      });
      if (command.replay)
        return refreshReplay(tx, command.replay, {
          bridgeFields,
          presentationRank,
        });
      const entity = await requireEntity(tx, entityId, {
        entityKind,
        lock: true,
        presentationRank,
        requireVisible: true,
      });
      const ids = items.map((item) => item.assetId);
      const found = await tx`
        SELECT asset_id FROM asset WHERE asset_id = ANY(${ids}) AND state = 'active'
        FOR UPDATE
      `;
      const foundIds = new Set(found.map((row) => row.asset_id));
      const missing = ids.filter((id) => !foundIds.has(id));
      if (missing.length) {
        throw typedError(
          "One or more active assets were not found",
          404,
          "CONTEXT_ASSET_NOT_FOUND",
          { missingAssetIds: missing },
        );
      }
      const rows = await tx`
        SELECT link_id, asset_id, association_kind, state
        FROM context_asset_link
        WHERE entity_id = ${entity.entity_id} AND asset_id = ANY(${ids})
          AND state IN ('accepted','rejected')
        FOR UPDATE
      `;
      const currentById = new Map(rows.map((row) => [row.asset_id, row]));
      const decisionId = await createDecision(tx, {
        action: selected ? "attach" : "detach",
        actorId: actor,
        entityId: entity.entity_id,
        note: `${selected ? "Attach" : "Detach"} ${ids.length} context asset(s)`,
        reasonCode: selected ? "context_asset_attach" : "context_asset_detach",
        subjectType: "context_asset",
      });
      const snapshot = [];
      const unchangedAssetIds = [];
      for (const item of items) {
        const current = currentById.get(item.assetId);
        if (
          (selected &&
            current?.state === "accepted" &&
            current.association_kind === item.associationKind) ||
          (!selected && current?.state !== "accepted")
        ) {
          unchangedAssetIds.push(item.assetId);
          continue;
        }
        if (current)
          await tx`
          UPDATE context_asset_link SET state = 'superseded'
          WHERE link_id = ${current.link_id}
        `;
        const linkId = `contextasset_${randomUUID().replaceAll("-", "")}`;
        const associationKind = selected
          ? item.associationKind
          : current.association_kind;
        await tx`
          INSERT INTO context_asset_link (
            link_id, entity_id, asset_id, association_kind, state, decision_id,
            supersedes_link_id
          ) VALUES (
            ${linkId}, ${entity.entity_id}, ${item.assetId}, ${associationKind},
            ${selected ? "accepted" : "rejected"}, ${decisionId},
            ${current?.link_id || null}
          )
        `;
        snapshot.push({
          assetId: item.assetId,
          createdLinkId: linkId,
          previousCoverAssetId:
            !selected && entity.cover_asset_id === item.assetId
              ? item.assetId
              : null,
          previousAssociationKind: current?.association_kind || null,
          previousLinkId: current?.link_id || null,
          previousState: current?.state || null,
        });
      }
      if (snapshot.length)
        await tx`
        UPDATE context_entity SET
          cover_asset_id = CASE
            WHEN ${!selected} AND cover_asset_id = ANY(${ids}) THEN NULL
            ELSE cover_asset_id
          END,
          revision = revision + 1, updated_at = now()
        WHERE entity_id = ${entity.entity_id}
      `;
      const operationId = snapshot.length
        ? `contextop_${randomUUID().replaceAll("-", "")}`
        : null;
      const detail = await loadDetail(tx, {
        bridgeFields,
        entityId: entity.entity_id,
        entityKind: entity.entity_kind,
        presentationRank,
      });
      const response = {
        changedAssetIds: snapshot.map((item) => item.assetId),
        commandId: command.commandId,
        decisionId,
        detail,
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
        commandKind,
        decisionId,
        response,
      });
      if (operationId)
        await tx`
        INSERT INTO context_operation (
          operation_id, command_id, entity_id, operation_scope, action,
          decision_id, state, snapshot
        ) VALUES (
          ${operationId}, ${command.commandId}, ${entity.entity_id}, 'asset',
          ${selected ? "attach" : "detach"}, ${decisionId}, 'active', ${tx.json(snapshot)}
        )
      `;
      return response;
    });
  };

  const modifyRelations = async ({
    actorId,
    commandId,
    entityId,
    entityKind,
    relationIds,
    relations,
    selected,
  }) => {
    const actor = cleanActor(actorId);
    const items = selected
      ? cleanRelations(relations, entityKind)
      : cleanRelationIds(relationIds).map((relationId) => ({ relationId }));
    const commandKind = selected ? "relation_attach" : "relation_detach";
    return sql.begin(async (tx) => {
      const command = await beginCommand(tx, {
        actorId: actor,
        commandId,
        commandKind,
        payload: { entityId, items },
      });
      if (command.replay)
        return refreshReplay(tx, command.replay, {
          bridgeFields,
          presentationRank,
        });
      const entity = await requireEntity(tx, entityId, {
        entityKind,
        lock: true,
        presentationRank,
        requireVisible: true,
      });
      if (selected) await requireRelationTargets(tx, items, presentationRank);
      let currentRows;
      if (selected) {
        currentRows = await tx`
          SELECT link_id, target_kind, target_id, relation_kind, state
          FROM context_relation_link
          WHERE entity_id = ${entity.entity_id} AND state IN ('accepted','rejected')
          FOR UPDATE
        `;
      } else {
        currentRows = await tx`
          SELECT link_id, target_kind, target_id, relation_kind, state
          FROM context_relation_link
          WHERE entity_id = ${entity.entity_id}
            AND link_id = ANY(${items.map((item) => item.relationId)})
            AND state IN ('accepted','rejected')
          FOR UPDATE
        `;
      }
      const currentByKey = new Map(
        currentRows.map((row) => [
          selected
            ? `${row.target_kind}:${row.target_id}:${row.relation_kind}`
            : row.link_id,
          row,
        ]),
      );
      const decisionId = await createDecision(tx, {
        action: selected ? "attach" : "detach",
        actorId: actor,
        entityId: entity.entity_id,
        note: `${selected ? "Attach" : "Detach"} ${items.length} context relation(s)`,
        reasonCode: selected
          ? "context_relation_attach"
          : "context_relation_detach",
        subjectType: "context_relation",
      });
      const snapshot = [];
      const unchangedRelationIds = [];
      for (const item of items) {
        const key = selected
          ? `${item.targetKind}:${item.targetId}:${item.relationKind}`
          : item.relationId;
        const current = currentByKey.get(key);
        if (
          (selected && current?.state === "accepted") ||
          (!selected && current?.state !== "accepted")
        ) {
          unchangedRelationIds.push(current?.link_id || item.relationId);
          continue;
        }
        if (!selected && !current) {
          throw typedError(
            "Active context relation not found",
            404,
            "CONTEXT_RELATION_NOT_FOUND",
            { relationId: item.relationId },
          );
        }
        if (current)
          await tx`
          UPDATE context_relation_link SET state = 'superseded'
          WHERE link_id = ${current.link_id}
        `;
        const linkId = `contextrel_${randomUUID().replaceAll("-", "")}`;
        const targetKind = selected ? item.targetKind : current.target_kind;
        const targetId = selected ? item.targetId : current.target_id;
        const relationKind = selected
          ? item.relationKind
          : current.relation_kind;
        await tx`
          INSERT INTO context_relation_link (
            link_id, entity_id, target_kind, target_id, relation_kind, state,
            decision_id, supersedes_link_id
          ) VALUES (
            ${linkId}, ${entity.entity_id}, ${targetKind}, ${targetId},
            ${relationKind}, ${selected ? "accepted" : "rejected"},
            ${decisionId}, ${current?.link_id || null}
          )
        `;
        snapshot.push({
          createdLinkId: linkId,
          previousLinkId: current?.link_id || null,
          previousState: current?.state || null,
          relationKind,
          targetId,
          targetKind,
        });
      }
      if (snapshot.length)
        await tx`
        UPDATE context_entity SET revision = revision + 1, updated_at = now()
        WHERE entity_id = ${entity.entity_id}
      `;
      const operationId = snapshot.length
        ? `contextop_${randomUUID().replaceAll("-", "")}`
        : null;
      const detail = await loadDetail(tx, {
        bridgeFields,
        entityId: entity.entity_id,
        entityKind: entity.entity_kind,
        presentationRank,
      });
      const response = {
        changedRelationIds: snapshot.map((item) => item.createdLinkId),
        commandId: command.commandId,
        decisionId,
        detail,
        replayed: false,
        schemaVersion,
        status: snapshot.length ? "applied" : "no_change",
        unchangedRelationIds,
        undo: {
          eligible: Boolean(operationId),
          token: operationId ? decisionId : null,
        },
      };
      await completeCommand(tx, {
        actorId: actor,
        command,
        commandKind,
        decisionId,
        response,
      });
      if (operationId)
        await tx`
        INSERT INTO context_operation (
          operation_id, command_id, entity_id, operation_scope, action,
          decision_id, state, snapshot
        ) VALUES (
          ${operationId}, ${command.commandId}, ${entity.entity_id}, 'relation',
          ${selected ? "attach" : "detach"}, ${decisionId}, 'active', ${tx.json(snapshot)}
        )
      `;
      return response;
    });
  };

  api.attachAssets = (input) => modifyAssets({ ...input, selected: true });
  api.detachAssets = (input) => modifyAssets({ ...input, selected: false });
  api.attachRelations = (input) =>
    modifyRelations({ ...input, selected: true });
  api.detachRelations = (input) =>
    modifyRelations({ ...input, selected: false });

  api.undo = async ({ actorId, commandId, decisionId }) => {
    const actor = cleanActor(actorId);
    const originalDecisionId = String(decisionId || "").trim();
    return sql.begin(async (tx) => {
      const command = await beginCommand(tx, {
        actorId: actor,
        commandId,
        commandKind: "undo",
        payload: { decisionId: originalDecisionId },
      });
      if (command.replay)
        return refreshReplay(tx, command.replay, {
          bridgeFields,
          presentationRank,
        });
      const [operation] = await tx`
        SELECT operation_id, entity_id, operation_scope, action, decision_id,
          state, snapshot
        FROM context_operation WHERE decision_id = ${originalDecisionId}
        FOR UPDATE
      `;
      if (!operation || operation.state !== "active") {
        throw typedError(
          "Context decision is not reversible",
          409,
          "CONTEXT_UNDO_NOT_AVAILABLE",
        );
      }
      const entity = await requireEntity(tx, operation.entity_id, {
        includeArchived: true,
        lock: true,
        presentationRank,
        requireVisible: true,
      });
      const snapshot = operation.snapshot || [];
      if (operation.operation_scope === "entity") {
        const [item] = snapshot;
        if (
          snapshot.length !== 1 ||
          !["create", "update"].includes(operation.action) ||
          item?.operationKind !== operation.action ||
          !item.next ||
          (operation.action === "update" && !item.previous)
        ) {
          throw typedError(
            "Context entity undo snapshot is invalid",
            409,
            "CONTEXT_UNDO_NOT_AVAILABLE",
          );
        }
        const currentState = await loadEntityStateSnapshot(tx, entity);
        if (
          !sameEntityState(currentState, item.next, {
            ignoreRevision: operation.action === "create",
          })
        ) {
          throw typedError(
            "Context entity changed after this decision",
            409,
            "CONTEXT_UNDO_SUPERSEDED",
          );
        }
        if (operation.action === "update" && item.previous.parentEntityId) {
          await requireParent(
            tx,
            item.previous.parentEntityId,
            entity.entity_kind,
            entity.entity_id,
            presentationRank,
          );
        }
        if (operation.action === "create") {
          const [dependencies] = await tx`
            SELECT
              (SELECT count(*)::int FROM context_entity child
                WHERE child.parent_entity_id = ${entity.entity_id}
                  AND child.status <> 'deleted') AS child_count,
              (SELECT count(*)::int FROM current_context_asset link
                WHERE link.entity_id = ${entity.entity_id}) AS asset_count,
              (SELECT count(*)::int FROM current_context_relation link
                WHERE link.entity_id = ${entity.entity_id}
                  OR (link.target_kind = ${entity.entity_kind}
                    AND link.target_id = ${entity.entity_id})) AS relation_count,
              (SELECT count(*)::int FROM current_cimmich_document_link link
                WHERE link.subject_kind = ${entity.entity_kind}
                  AND link.subject_id = ${entity.entity_id}) AS document_count,
              (SELECT count(*)::int FROM current_manual_context_tag tag
                WHERE tag.entity_id = ${entity.entity_id}) AS manual_tag_count,
              (SELECT count(*)::int FROM cimmich_visibility_object visibility
                WHERE visibility.object_scope = 'context_entity'
                  AND visibility.object_id = ${entity.entity_id}) AS visibility_count,
              (SELECT count(*)::int FROM context_operation later
                WHERE later.entity_id = ${entity.entity_id}
                  AND later.state = 'active'
                  AND later.operation_id <> ${operation.operation_id}) AS later_operation_count
          `;
          if (Object.values(dependencies).some((value) => Number(value) > 0)) {
            throw typedError(
              "Created context entity has dependent current state",
              409,
              "CONTEXT_UNDO_DEPENDENCY",
            );
          }
        }
      } else if (operation.operation_scope === "cover") {
        const [item] = snapshot;
        if (
          snapshot.length !== 1 ||
          (entity.cover_asset_id || null) !== (item.nextCoverAssetId || null)
        ) {
          throw typedError(
            "Context projection changed after this decision",
            409,
            "CONTEXT_UNDO_SUPERSEDED",
          );
        }
        if (item.previousCoverAssetId) {
          const [available] = await tx`
            SELECT link.link_id FROM context_asset_link link
            JOIN asset ON asset.asset_id = link.asset_id AND asset.state = 'active'
            WHERE link.entity_id = ${entity.entity_id}
              AND link.asset_id = ${item.previousCoverAssetId}
              AND link.state = 'accepted'
              AND cimmich_visibility_asset_rank(link.asset_id) <= ${presentationRank()}
            FOR UPDATE OF link, asset
          `;
          if (!available) {
            throw typedError(
              "Prior context cover is no longer available",
              409,
              "CONTEXT_UNDO_SUPERSEDED",
            );
          }
        }
      } else {
        for (const item of snapshot) {
          const rows =
            operation.operation_scope === "asset"
              ? await tx`SELECT link_id FROM context_asset_link WHERE link_id = ${item.createdLinkId} AND entity_id = ${entity.entity_id} AND state IN ('accepted','rejected') FOR UPDATE`
              : await tx`SELECT link_id FROM context_relation_link WHERE link_id = ${item.createdLinkId} AND entity_id = ${entity.entity_id} AND state IN ('accepted','rejected') FOR UPDATE`;
          if (!rows[0]) {
            throw typedError(
              "Context projection changed after this decision",
              409,
              "CONTEXT_UNDO_SUPERSEDED",
            );
          }
          if (
            operation.operation_scope === "asset" &&
            item.previousCoverAssetId &&
            entity.cover_asset_id !== null
          ) {
            throw typedError(
              "Context cover changed after this asset decision",
              409,
              "CONTEXT_UNDO_SUPERSEDED",
            );
          }
        }
      }
      const undoDecisionId = await createDecision(tx, {
        action: "undo",
        actorId: actor,
        entityId: entity.entity_id,
        note:
          operation.operation_scope === "entity"
            ? operation.action === "create"
              ? `Undo ${entityLabels[entity.entity_kind]} creation`
              : `Undo ${entityLabels[entity.entity_kind]} update`
            : operation.operation_scope === "cover"
              ? `Undo ${entityLabels[entity.entity_kind]} cover`
              : "Undo context association",
        reasonCode:
          operation.operation_scope === "entity"
            ? operation.action === "create"
              ? "context_manual_create_undo"
              : "context_manual_update_undo"
            : operation.operation_scope === "cover"
              ? `context_${entity.entity_kind}_cover_undo`
              : "context_manual_undo",
        subjectType:
          operation.operation_scope === "asset"
            ? "context_asset"
            : operation.operation_scope === "relation"
              ? "context_relation"
              : "context_entity",
        supersedes: operation.decision_id,
      });
      for (const item of snapshot) {
        if (operation.operation_scope === "asset") {
          await tx`UPDATE context_asset_link SET state = 'superseded' WHERE link_id = ${item.createdLinkId}`;
          await tx`
            INSERT INTO context_asset_link (
              link_id, entity_id, asset_id, association_kind, state, decision_id,
              supersedes_link_id
            ) VALUES (
              ${`contextasset_${randomUUID().replaceAll("-", "")}`}, ${entity.entity_id},
              ${item.assetId}, ${item.previousAssociationKind || "manual"},
              ${item.previousState === "accepted" ? "accepted" : "rejected"},
              ${undoDecisionId}, ${item.createdLinkId}
            )
          `;
          if (item.previousCoverAssetId) {
            await tx`
              UPDATE context_entity
              SET cover_asset_id = ${item.previousCoverAssetId}
              WHERE entity_id = ${entity.entity_id}
            `;
          }
        } else if (operation.operation_scope === "relation") {
          await tx`UPDATE context_relation_link SET state = 'superseded' WHERE link_id = ${item.createdLinkId}`;
          await tx`
            INSERT INTO context_relation_link (
              link_id, entity_id, target_kind, target_id, relation_kind, state,
              decision_id, supersedes_link_id
            ) VALUES (
              ${`contextrel_${randomUUID().replaceAll("-", "")}`}, ${entity.entity_id},
              ${item.targetKind}, ${item.targetId}, ${item.relationKind},
              ${item.previousState === "accepted" ? "accepted" : "rejected"},
              ${undoDecisionId}, ${item.createdLinkId}
            )
          `;
        } else if (operation.operation_scope === "cover") {
          await tx`
            UPDATE context_entity
            SET cover_asset_id = ${item.previousCoverAssetId || null}
            WHERE entity_id = ${entity.entity_id}
          `;
        } else if (operation.action === "create") {
          await tx`
            UPDATE context_entity SET status = 'deleted',
              revision = revision + 1, updated_at = now()
            WHERE entity_id = ${entity.entity_id}
          `;
        } else {
          await tx`
            UPDATE context_entity SET
              display_name = ${item.previous.displayName},
              description = ${item.previous.description},
              place_kind = ${entity.entity_kind === "place" ? item.previous.typeKind : null},
              object_kind = ${entity.entity_kind === "object" ? item.previous.typeKind : null},
              event_kind = ${entity.entity_kind === "event" ? item.previous.typeKind : null},
              date_start = ${item.previous.dateStart},
              date_end = ${item.previous.dateEnd},
              date_precision = ${item.previous.datePrecision},
              geometry = ${item.previous.geometry ? tx.json(item.previous.geometry) : null},
              parent_entity_id = ${item.previous.parentEntityId},
              status = ${item.previous.status},
              cover_asset_id = ${item.previous.coverAssetId}
            WHERE entity_id = ${entity.entity_id}
          `;
          await applyAliases(tx, entity.entity_id, item.previous.aliases);
        }
      }
      await tx`
        UPDATE context_operation SET state = 'reverted',
          undo_decision_id = ${undoDecisionId}, reverted_at = now()
        WHERE operation_id = ${operation.operation_id}
      `;
      if (
        !(
          operation.operation_scope === "entity" &&
          operation.action === "create"
        )
      ) {
        await tx`
          UPDATE context_entity SET revision = revision + 1, updated_at = now()
          WHERE entity_id = ${entity.entity_id}
        `;
      }
      const creationReverted =
        operation.operation_scope === "entity" && operation.action === "create";
      const detail = creationReverted
        ? null
        : await loadDetail(tx, {
            bridgeFields,
            entityId: entity.entity_id,
            entityKind: entity.entity_kind,
            includeArchived:
              operation.operation_scope === "entity" &&
              operation.action === "update" &&
              snapshot[0].previous.status === "archived",
            presentationRank,
          });
      const response = {
        commandId: command.commandId,
        decisionId: undoDecisionId,
        detail,
        ...(creationReverted ? { projectionUnavailable: true } : {}),
        replayed: false,
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
  };

  return api;
};

export const contextEntityContract = Object.freeze({
  associationKinds: Object.fromEntries(
    Object.entries(associationKinds).map(([key, values]) => [key, [...values]]),
  ),
  datePrecisions: [...datePrecisions],
  entityKinds: [...entityKinds],
  eventCoverSchemaVersion,
  objectCoverSchemaVersion,
  objectDeleteSchemaVersion,
  placeCoverSchemaVersion,
  relationKinds: [...relationKinds],
  schemaVersion,
  placeDeleteSchemaVersion,
  targetKinds: [...targetKinds],
  typedKinds: Object.fromEntries(
    Object.entries(typedKinds).map(([key, values]) => [key, [...values]]),
  ),
});
