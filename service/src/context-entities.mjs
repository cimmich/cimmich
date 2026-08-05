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
const recurrenceFrequencies = new Set(["daily", "weekly", "monthly", "yearly"]);
const statuses = new Set(["active", "hidden", "archived"]);
const directoryVisibilities = new Set(["listed", "nested_only"]);
const placeRoles = new Set(["geography", "location", "unclassified"]);
const defaultPlaceRole = "location";
const placePlanKinds = new Set(["property", "floor", "outdoor", "other"]);
const placePlanBackgroundKinds = new Set(["blank", "asset", "satellite"]);
const associationKinds = {
  event: new Set(["direct", "route_stop", "context", "needs_check", "manual"]),
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

const cleanRecurrence = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw typedError(
      "recurrence must be an object or null",
      400,
      "CONTEXT_RECURRENCE_INVALID",
    );
  }
  const keys = Object.keys(value).sort();
  if (
    keys.some((key) => !["frequency", "interval", "weekdays"].includes(key)) ||
    !keys.includes("frequency") ||
    !keys.includes("interval")
  ) {
    throw typedError(
      "recurrence contains unsupported fields",
      400,
      "CONTEXT_RECURRENCE_INVALID",
    );
  }
  const frequency = String(value.frequency || "").trim();
  const interval = Number(value.interval);
  if (
    !recurrenceFrequencies.has(frequency) ||
    !Number.isInteger(interval) ||
    interval < 1 ||
    interval > 99
  ) {
    throw typedError(
      "recurrence frequency or interval is invalid",
      400,
      "CONTEXT_RECURRENCE_INVALID",
    );
  }
  if (frequency !== "weekly") {
    if (value.weekdays !== undefined) {
      throw typedError(
        "weekdays belong only to weekly recurrence",
        400,
        "CONTEXT_RECURRENCE_INVALID",
      );
    }
    return { frequency, interval };
  }
  if (
    !Array.isArray(value.weekdays) ||
    value.weekdays.length < 1 ||
    value.weekdays.length > 7 ||
    value.weekdays.some(
      (day) => !Number.isInteger(day) || day < 0 || day > 6,
    ) ||
    new Set(value.weekdays).size !== value.weekdays.length
  ) {
    throw typedError(
      "weekly recurrence needs unique weekdays from 0 to 6",
      400,
      "CONTEXT_RECURRENCE_INVALID",
    );
  }
  return { frequency, interval, weekdays: [...value.weekdays].sort() };
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

const geometryProvenances = new Set([
  "confirmed",
  "contextual",
  "manual",
  "photo_gps",
]);

const cleanGeometryMetadata = (value) => {
  const provenance =
    value?.provenance === undefined
      ? "manual"
      : String(value.provenance).trim();
  if (!geometryProvenances.has(provenance)) {
    throw typedError(
      "geometry provenance is unsupported",
      400,
      "CONTEXT_GEOMETRY_PROVENANCE_INVALID",
    );
  }
  if (
    value?.uncertaintyMeters === undefined ||
    value.uncertaintyMeters === null
  ) {
    return { provenance };
  }
  const uncertaintyMeters = Number(value.uncertaintyMeters);
  if (
    !Number.isFinite(uncertaintyMeters) ||
    uncertaintyMeters < 0 ||
    uncertaintyMeters > 1_000_000
  ) {
    throw typedError(
      "geometry uncertaintyMeters must be from 0 to 1000000",
      400,
      "CONTEXT_GEOMETRY_UNCERTAINTY_INVALID",
    );
  }
  return { provenance, uncertaintyMeters };
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
  if (typeKind === "point") {
    return {
      ...cleanPoint({
        latitude: value?.latitude,
        longitude: value?.longitude,
      }),
      ...cleanGeometryMetadata(value),
    };
  }
  if (typeKind === "area") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw typedError(
        "Area geometry is required",
        400,
        "CONTEXT_GEOMETRY_INVALID",
      );
    }
    const metadata = cleanGeometryMetadata(value);
    const keys = Object.keys(value)
      .filter((key) => key !== "provenance" && key !== "uncertaintyMeters")
      .sort();
    if (keys.join(",") === "points") {
      if (
        !Array.isArray(value.points) ||
        value.points.length < 3 ||
        value.points.length > 500
      ) {
        throw typedError(
          "Painted area geometry requires 3 to 500 points",
          400,
          "CONTEXT_GEOMETRY_INVALID",
        );
      }
      const points = value.points.map((point, index) =>
        cleanPoint(point, `geometry.points[${index}]`),
      );
      const uniquePoints = new Set(
        points.map((point) => `${point.latitude},${point.longitude}`),
      );
      if (uniquePoints.size < 3) {
        throw typedError(
          "Painted area geometry requires at least three distinct points",
          400,
          "CONTEXT_GEOMETRY_INVALID",
        );
      }
      return { points, ...metadata };
    }
    if (keys.join(",") !== "east,north,south,west") {
      throw typedError(
        "Area geometry must be bounds or painted points",
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
    return { ...area, ...metadata };
  }
  if (typeKind === "route") {
    const metadata = cleanGeometryMetadata(value);
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value)
        .filter((key) => key !== "provenance" && key !== "uncertaintyMeters")
        .join(",") !== "points" ||
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
      ...metadata,
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

const cleanSourceFolders = (value) => {
  if (!Array.isArray(value) || value.length > 20) {
    throw typedError(
      "sourceFolders must contain no more than 20 folders",
      400,
      "CONTEXT_SOURCE_FOLDERS_INVALID",
    );
  }
  const folders = value.map((item) =>
    String(item || "")
      .trim()
      .replaceAll("\\", "/")
      .replace(/\/{2,}/g, "/")
      .replace(/\/$/, ""),
  );
  if (
    folders.some(
      (folder) =>
        !folder || folder.length > 1000 || /[\u0000-\u001f\u007f]/.test(folder),
    ) ||
    new Set(folders).size !== folders.length
  ) {
    throw typedError(
      "sourceFolders must be unique, non-blank folder paths",
      400,
      "CONTEXT_SOURCE_FOLDERS_INVALID",
    );
  }
  return folders;
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
    ...(value.recurrence !== undefined
      ? { recurrence: cleanRecurrence(value.recurrence) }
      : {}),
    ...(value.sourceFolders !== undefined
      ? { sourceFolders: cleanSourceFolders(value.sourceFolders) }
      : {}),
    ...(value.parentEntityId !== undefined
      ? {
          parentEntityId:
            value.parentEntityId == null
              ? null
              : cleanEntityId(value.parentEntityId, "parentEntityId"),
        }
      : {}),
    ...(value.placeRole !== undefined || (!partial && entityKind === "place")
      ? { placeRole: String(value.placeRole || defaultPlaceRole).trim() }
      : {}),
    ...(value.geographyEntityId !== undefined
      ? {
          geographyEntityId:
            value.geographyEntityId == null
              ? null
              : cleanEntityId(value.geographyEntityId, "geographyEntityId"),
        }
      : {}),
    ...(value.directoryVisibility !== undefined
      ? { directoryVisibility: String(value.directoryVisibility).trim() }
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
  if (
    requested.directoryVisibility &&
    !directoryVisibilities.has(requested.directoryVisibility)
  ) {
    throw typedError(
      "directoryVisibility is unsupported",
      400,
      "CONTEXT_DIRECTORY_VISIBILITY_INVALID",
    );
  }
  if (requested.placeRole && !placeRoles.has(requested.placeRole)) {
    throw typedError(
      "placeRole is unsupported",
      400,
      "CONTEXT_PLACE_ROLE_INVALID",
    );
  }
  if (
    !partial &&
    entityKind !== "place" &&
    (requested.placeRole !== undefined ||
      requested.geographyEntityId !== undefined)
  ) {
    throw typedError(
      "Only Places may use Place roles or geography links",
      400,
      "CONTEXT_PLACE_ROLE_INVALID",
    );
  }
  if (
    !partial &&
    entityKind !== "event" &&
    requested.sourceFolders !== undefined
  ) {
    throw typedError(
      "Only Events may remember source folders",
      400,
      "CONTEXT_SOURCE_FOLDERS_INVALID",
    );
  }
  if (
    !partial &&
    entityKind !== "place" &&
    requested.directoryVisibility !== undefined
  ) {
    throw typedError(
      "Only Places may change directory visibility",
      400,
      "CONTEXT_DIRECTORY_VISIBILITY_INVALID",
    );
  }
  if (!partial) {
    requested.typeKind = cleanKind(entityKind, value.typeKind);
    if (
      requested.recurrence !== undefined &&
      requested.recurrence !== null &&
      (entityKind !== "event" || requested.typeKind !== "activity")
    ) {
      throw typedError(
        "Only Activities may repeat",
        400,
        "CONTEXT_RECURRENCE_INVALID",
      );
    }
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
  directoryVisibility: row.directory_visibility || "listed",
  displayName: row.display_name,
  entityId: row.entity_id,
  entityKind: row.entity_kind,
  geometry: row.geometry || null,
  geographyEntityId: row.geography_entity_id || null,
  parentEntityId: row.parent_entity_id || null,
  placeRole: row.place_role || null,
  recurrence: row.recurrence || null,
  sourceFolders: row.source_folders || [],
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
  childCount: Number(row.child_count || 0),
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
  directAssetCount: Number(row.direct_asset_count ?? row.asset_count ?? 0),
  directoryVisibility: row.directory_visibility || "listed",
  displayName: row.display_name,
  entityId: row.entity_id,
  entityKind: row.entity_kind,
  geometry: row.geometry || null,
  geographyEntityId: row.geography_entity_id || null,
  parentEntityId: Object.hasOwn(row, "visible_parent_entity_id")
    ? row.visible_parent_entity_id || null
    : row.parent_entity_id || null,
  placeRole: row.place_role || null,
  recurrence: row.recurrence || null,
  sourceFolders: row.source_folders || [],
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
  subtreeAssetCount: Number(row.subtree_asset_count ?? row.asset_count ?? 0),
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
    placeRole = null,
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
      coalesce((SELECT count(*)::int FROM context_entity child
        WHERE child.parent_entity_id = entity.entity_id
          AND child.status = 'active'
          AND cimmich_visibility_context_entity_rank(child.entity_id) <= ${presentationRank()}), 0)::int AS child_count,
      CASE WHEN entity.entity_kind IN ('place','event') THEN coalesce((
        WITH RECURSIVE descendants(entity_id) AS (
          SELECT entity.entity_id
          UNION ALL
          SELECT child.entity_id
          FROM context_entity child
          JOIN descendants parent ON child.parent_entity_id = parent.entity_id
          WHERE child.entity_kind = entity.entity_kind AND child.status = 'active'
            AND cimmich_visibility_context_entity_rank(child.entity_id) <= ${presentationRank()}
        )
        SELECT count(DISTINCT link.asset_id)::int
        FROM descendants place
        JOIN current_context_asset link ON link.entity_id = place.entity_id
        JOIN asset ON asset.asset_id = link.asset_id AND asset.state = 'active'
        WHERE cimmich_visibility_asset_rank(link.asset_id) <= ${presentationRank()}
      ), 0)::int ELSE coalesce((SELECT count(*)::int FROM current_context_asset link
        WHERE link.entity_id = entity.entity_id
          AND cimmich_visibility_asset_rank(link.asset_id) <= ${presentationRank()}), 0)::int
      END AS subtree_asset_count,
      entity.cover_asset_id AS selected_cover_asset_id,
      cover.asset_id AS effective_cover_asset_id,
      coalesce(preview.asset_ids, ARRAY[]::text[]) AS preview_asset_ids
    FROM context_entity entity
    LEFT JOIN LATERAL (
      WITH RECURSIVE cover_scope(entity_id, depth) AS (
        SELECT entity.entity_id, 0
        UNION ALL
        SELECT child.entity_id, parent.depth + 1
        FROM context_entity child
        JOIN cover_scope parent ON child.parent_entity_id = parent.entity_id
        WHERE entity.entity_kind = 'place'
          AND child.entity_kind = 'place' AND child.status IN ('active','hidden')
          AND parent.depth < 8
      )
      SELECT link.asset_id
      FROM cover_scope scope
      JOIN current_context_asset link ON link.entity_id = scope.entity_id
      JOIN asset ON asset.asset_id = link.asset_id AND asset.state = 'active'
      WHERE cimmich_visibility_asset_rank(link.asset_id) <= ${presentationRank()}
      ORDER BY CASE WHEN link.asset_id = entity.cover_asset_id THEN 0 ELSE 1 END,
        CASE WHEN scope.entity_id = entity.entity_id THEN 0 ELSE 1 END,
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
      AND (${placeRole === null} OR entity.place_role = ${placeRole})
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
  const eventLineage =
    entity.entity_kind === "event"
      ? await executor`
          WITH RECURSIVE lineage AS (
            SELECT current.entity_id, current.parent_entity_id,
              current.display_name, 0 AS depth
            FROM context_entity current
            WHERE current.entity_id = ${entity.entity_id}
            UNION ALL
            SELECT parent.entity_id, parent.parent_entity_id,
              parent.display_name, child.depth + 1
            FROM context_entity parent
            JOIN lineage child ON child.parent_entity_id = parent.entity_id
            WHERE parent.entity_kind = 'event'
              AND parent.status IN ('active','hidden')
              AND child.depth < 11
              AND cimmich_visibility_context_entity_rank(parent.entity_id) <= ${presentationRank()}
          )
          SELECT entity_id, parent_entity_id, display_name
          FROM lineage
          ORDER BY depth DESC
        `
      : [];
  const eventChildren =
    entity.entity_kind === "event"
      ? await executor`
          SELECT child.entity_id, child.parent_entity_id, child.display_name,
            child.event_kind, child.date_start,
            coalesce((
              SELECT count(*)::int
              FROM current_context_asset direct_link
              WHERE direct_link.entity_id = child.entity_id
                AND cimmich_visibility_asset_rank(direct_link.asset_id) <= ${presentationRank()}
            ), 0)::int AS asset_count,
            coalesce((
              WITH RECURSIVE descendants(entity_id) AS (
                SELECT child.entity_id
                UNION ALL
                SELECT nested.entity_id
                FROM context_entity nested
                JOIN descendants parent ON nested.parent_entity_id = parent.entity_id
                WHERE nested.entity_kind = 'event' AND nested.status = 'active'
                  AND cimmich_visibility_context_entity_rank(nested.entity_id) <= ${presentationRank()}
              )
              SELECT count(DISTINCT subtree_link.asset_id)::int
              FROM descendants descendant
              JOIN current_context_asset subtree_link
                ON subtree_link.entity_id = descendant.entity_id
              WHERE cimmich_visibility_asset_rank(subtree_link.asset_id) <= ${presentationRank()}
            ), 0)::int AS subtree_asset_count
          FROM context_entity child
          WHERE child.parent_entity_id = ${entity.entity_id}
            AND child.entity_kind = 'event' AND child.status = 'active'
            AND cimmich_visibility_context_entity_rank(child.entity_id) <= ${presentationRank()}
          ORDER BY child.date_start NULLS LAST, lower(child.display_name), child.entity_id
        `
      : [];
  const assets = await executor`
    SELECT link.link_id, link.asset_id, link.association_kind, link.created_at,
      asset.capture_time, asset.media_kind, asset.mime_type, asset.width, asset.height
    FROM current_context_asset link
    JOIN asset ON asset.asset_id = link.asset_id AND asset.state = 'active'
    WHERE link.entity_id = ${entity.entity_id}
      AND cimmich_visibility_asset_rank(link.asset_id) <= ${presentationRank()}
    ORDER BY asset.capture_time DESC NULLS LAST, link.asset_id
  `;
  const subtreeAssets =
    entity.entity_kind === "place"
      ? await executor`
          WITH RECURSIVE place_tree(entity_id, branch_entity_id, depth) AS (
            SELECT ${entity.entity_id}::text, NULL::text, 0
            UNION ALL
            SELECT child.entity_id,
              CASE WHEN parent.depth = 0 THEN child.entity_id ELSE parent.branch_entity_id END,
              parent.depth + 1
            FROM context_entity child
            JOIN place_tree parent ON child.parent_entity_id = parent.entity_id
            WHERE child.entity_kind = 'place' AND child.status = 'active'
              AND cimmich_visibility_context_entity_rank(child.entity_id) <= ${presentationRank()}
          )
          SELECT link.asset_id, asset.capture_time, asset.media_kind,
            asset.mime_type, asset.width, asset.height,
            max(link.created_at) AS linked_at,
            max(link.link_id) FILTER (WHERE link.entity_id = ${entity.entity_id}) AS direct_link_id,
            max(link.association_kind) FILTER (WHERE link.entity_id = ${entity.entity_id}) AS direct_association_kind,
            array_agg(DISTINCT link.entity_id ORDER BY link.entity_id) AS assigned_entity_ids,
            coalesce(array_agg(DISTINCT place.branch_entity_id ORDER BY place.branch_entity_id)
              FILTER (WHERE place.branch_entity_id IS NOT NULL), ARRAY[]::text[]) AS branch_entity_ids
          FROM place_tree place
          JOIN current_context_asset link ON link.entity_id = place.entity_id
          JOIN asset ON asset.asset_id = link.asset_id AND asset.state = 'active'
          WHERE cimmich_visibility_asset_rank(link.asset_id) <= ${presentationRank()}
          GROUP BY link.asset_id, asset.capture_time, asset.media_kind,
            asset.mime_type, asset.width, asset.height
          ORDER BY asset.capture_time DESC NULLS LAST, link.asset_id
        `
      : [];
  const [childSummary = { count: 0 }] =
    entity.entity_kind === "place"
      ? await executor`
          SELECT count(*)::int AS count FROM context_entity child
          WHERE child.parent_entity_id = ${entity.entity_id}
            AND child.status = 'active'
            AND cimmich_visibility_context_entity_rank(child.entity_id) <= ${presentationRank()}
        `
      : [];
  const relations = await executor`
    SELECT link.link_id, link.target_kind, link.target_id, link.relation_kind,
      link.created_at, link.sort_order,
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
  // Related context connections are conceptually symmetric even though the
  // append-only relation ledger has one owning side. Project the inverse so a
  // Thing→Event or Thing→Place connection is visible from both memories
  // without manufacturing a second persisted edge.
  const incomingContextRelations = await executor`
          SELECT link.link_id, source.entity_kind AS target_kind,
            source.entity_id AS target_id, link.relation_kind,
            link.created_at, link.sort_order, source.display_name AS target_name
          FROM current_context_relation link
          JOIN context_entity source ON source.entity_id = link.entity_id
            AND source.status IN ('active','hidden')
          WHERE link.target_kind = ${entity.entity_kind}
            AND link.target_id = ${entity.entity_id}
            AND link.relation_kind = 'related'
            AND cimmich_visibility_context_entity_rank(source.entity_id) <= ${presentationRank()}
          ORDER BY source.entity_kind, lower(source.display_name), source.entity_id
        `;
  const projectedSubtreeAssets = subtreeAssets.map((row) => ({
    assetId: row.asset_id,
    assignedEntityIds: row.assigned_entity_ids || [],
    associationId: row.direct_link_id || `place-rollup:${row.asset_id}`,
    associationKind: row.direct_association_kind || "descendant",
    branchEntityIds: row.branch_entity_ids || [],
    captureTime: row.capture_time,
    directlyAssigned: Boolean(row.direct_link_id),
    height: row.height,
    linkedAt: row.linked_at,
    mediaKind: row.media_kind,
    mimeType: row.mime_type,
    ...bridgeFields(row.asset_id),
    width: row.width,
  }));
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
      const coverAssets =
        entity.entity_kind === "place" ? subtreeAssets : assets;
      const selected = coverAssets.find(
        (asset) => asset.asset_id === entity.cover_asset_id,
      );
      return projectEntityRow(
        {
          ...entity,
          aliases: aliases.map((row) => row.label),
          asset_count: assets.length,
          child_count:
            entity.entity_kind === "event"
              ? eventChildren.length
              : Number(childSummary.count || 0),
          subtree_asset_count:
            entity.entity_kind === "place"
              ? projectedSubtreeAssets.length
              : assets.length,
          effective_cover_asset_id:
            selected?.asset_id ||
            assets[0]?.asset_id ||
            coverAssets[0]?.asset_id ||
            null,
          selected_cover_asset_id: selected?.asset_id || null,
        },
        { bridgeFields },
      );
    })(),
    relations: [
      ...relations.map((row) => ({ ...row, direction: "outgoing" })),
      ...incomingContextRelations.map((row) => ({
        ...row,
        direction: "incoming",
      })),
    ]
      .filter(
        (row, index, rows) =>
          rows.findIndex(
            (candidate) =>
              candidate.target_kind === row.target_kind &&
              candidate.target_id === row.target_id &&
              candidate.relation_kind === row.relation_kind,
          ) === index,
      )
      .map((row) => ({
        direction: row.direction,
        linkedAt: row.created_at,
        relationId: row.link_id,
        relationKind: row.relation_kind,
        sortOrder: row.sort_order === null ? null : Number(row.sort_order),
        targetId: row.target_id,
        targetKind: row.target_kind,
        targetName: row.target_name || "",
      })),
    schemaVersion,
    ...(entity.entity_kind === "event"
      ? {
          eventChildren: eventChildren.map((row) => ({
            assetCount: Number(row.asset_count || 0),
            dateStart: projectDate(row.date_start),
            displayName: row.display_name,
            entityId: row.entity_id,
            parentEntityId: row.parent_entity_id || null,
            subtreeAssetCount: Number(row.subtree_asset_count || 0),
            typeKind: row.event_kind,
          })),
          eventLineage: eventLineage.map((row) => ({
            displayName: row.display_name,
            entityId: row.entity_id,
            parentEntityId: row.parent_entity_id || null,
          })),
        }
      : {}),
    ...(entity.entity_kind === "place"
      ? { subtreeAssets: projectedSubtreeAssets }
      : {}),
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
  const maximum = entityKind === "event" ? 1000 : 100;
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) {
    throw typedError(
      `assets must contain 1 to ${maximum} items`,
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
    sortOrder:
      item?.sortOrder === undefined || item?.sortOrder === null
        ? null
        : Number(item.sortOrder),
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
          )) ||
        (item.sortOrder !== null &&
          (!Number.isInteger(item.sortOrder) ||
            item.sortOrder < 0 ||
            item.sortOrder > 99 ||
            entityKind !== "event" ||
            item.relationKind !== "location" ||
            item.targetKind !== "place")),
    ) ||
    new Set(
      items.map(
        (item) => `${item.targetKind}:${item.targetId}:${item.relationKind}`,
      ),
    ).size !== items.length ||
    new Set(
      items.flatMap((item) =>
        item.sortOrder === null ? [] : [item.sortOrder],
      ),
    ).size !== items.filter((item) => item.sortOrder !== null).length
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
  placeRole = null,
) => {
  if (!parentEntityId) return;
  const [parent] = await executor`
    SELECT entity_kind, place_role FROM context_entity
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
  if (
    entityKind === "place" &&
    placeRole &&
    placeRole !== "unclassified" &&
    parent.place_role !== "unclassified" &&
    parent.place_role !== placeRole
  ) {
    throw typedError(
      "Locations and Geography use separate parent hierarchies",
      409,
      "CONTEXT_PARENT_ROLE_INVALID",
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

const requireGeography = async (
  executor,
  geographyEntityId,
  placeRole,
  entityId = null,
  presentationRank = () => 0,
) => {
  if (!geographyEntityId) return;
  if (placeRole !== "location" || geographyEntityId === entityId) {
    throw typedError(
      "Only a Location may link to a separate Geography",
      409,
      "CONTEXT_GEOGRAPHY_INVALID",
    );
  }
  const [geography] = await executor`
    SELECT entity_kind, place_role FROM context_entity
    WHERE entity_id = ${geographyEntityId}
      AND status IN ('active','hidden')
      AND cimmich_visibility_context_entity_rank(entity_id) <= ${presentationRank()}
  `;
  if (
    geography?.entity_kind !== "place" ||
    geography.place_role !== "geography"
  ) {
    throw typedError(
      "Location geography must be a current Geography Place",
      409,
      "CONTEXT_GEOGRAPHY_INVALID",
    );
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

const cleanPlanId = (value, { nullable = false } = {}) => {
  const planId = String(value || "").trim();
  if (!planId && nullable) return null;
  if (!/^placeplan_[0-9a-f]{32}$/.test(planId)) {
    throw typedError(
      "planId is not a stable Cimmich Location Plan ID",
      400,
      "PLACE_PLAN_ID_INVALID",
    );
  }
  return planId;
};

const cleanPlanNumber = (value, field) => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw typedError(
      `${field} must be a number from 0 to 1`,
      400,
      "PLACE_PLAN_GEOMETRY_INVALID",
      { field },
    );
  }
  return Number(value.toFixed(6));
};

const cleanPlanShape = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw typedError(
      "Plan item geometry must be an object",
      400,
      "PLACE_PLAN_GEOMETRY_INVALID",
    );
  }
  const kind = String(value.kind || "").trim();
  if (kind === "point") {
    return {
      kind,
      x: cleanPlanNumber(value.x, "geometry.x"),
      y: cleanPlanNumber(value.y, "geometry.y"),
    };
  }
  if (kind === "rect") {
    const rect = {
      h: cleanPlanNumber(value.h, "geometry.h"),
      kind,
      w: cleanPlanNumber(value.w, "geometry.w"),
      x: cleanPlanNumber(value.x, "geometry.x"),
      y: cleanPlanNumber(value.y, "geometry.y"),
    };
    if (
      rect.w <= 0 ||
      rect.h <= 0 ||
      rect.x + rect.w > 1.000001 ||
      rect.y + rect.h > 1.000001
    ) {
      throw typedError(
        "Plan rectangle must have size and remain inside the canvas",
        400,
        "PLACE_PLAN_GEOMETRY_INVALID",
      );
    }
    return rect;
  }
  if (kind === "polygon") {
    if (
      !Array.isArray(value.points) ||
      value.points.length < 3 ||
      value.points.length > 256
    ) {
      throw typedError(
        "Plan polygon must contain 3 to 256 points",
        400,
        "PLACE_PLAN_GEOMETRY_INVALID",
      );
    }
    const points = value.points.map((point, index) => ({
      x: cleanPlanNumber(point?.x, `geometry.points[${index}].x`),
      y: cleanPlanNumber(point?.y, `geometry.points[${index}].y`),
    }));
    if (new Set(points.map((point) => `${point.x}:${point.y}`)).size < 3) {
      throw typedError(
        "Plan polygon needs at least three distinct points",
        400,
        "PLACE_PLAN_GEOMETRY_INVALID",
      );
    }
    return { kind, points };
  }
  if (kind === "paint") {
    if (
      !Array.isArray(value.strokes) ||
      value.strokes.length < 1 ||
      value.strokes.length > 64
    ) {
      throw typedError(
        "Plan paint must contain 1 to 64 brush strokes",
        400,
        "PLACE_PLAN_GEOMETRY_INVALID",
      );
    }
    let totalPoints = 0;
    const strokes = value.strokes.map((stroke, strokeIndex) => {
      if (
        !stroke ||
        typeof stroke !== "object" ||
        Array.isArray(stroke) ||
        !Array.isArray(stroke.points) ||
        stroke.points.length < 1 ||
        stroke.points.length > 256 ||
        typeof stroke.radius !== "number" ||
        !Number.isFinite(stroke.radius) ||
        stroke.radius < 0.005 ||
        stroke.radius > 0.15
      ) {
        throw typedError(
          "Each Plan brush stroke needs 1 to 256 points and a bounded radius",
          400,
          "PLACE_PLAN_GEOMETRY_INVALID",
        );
      }
      totalPoints += stroke.points.length;
      return {
        points: stroke.points.map((point, pointIndex) => ({
          x: cleanPlanNumber(
            point?.x,
            `geometry.strokes[${strokeIndex}].points[${pointIndex}].x`,
          ),
          y: cleanPlanNumber(
            point?.y,
            `geometry.strokes[${strokeIndex}].points[${pointIndex}].y`,
          ),
        })),
        radius: stroke.radius,
      };
    });
    if (totalPoints > 2048) {
      throw typedError(
        "Plan paint must contain at most 2048 points",
        400,
        "PLACE_PLAN_GEOMETRY_INVALID",
      );
    }
    return { kind, strokes };
  }
  throw typedError(
    "Plan item geometry kind must be point, rect, polygon, or paint",
    400,
    "PLACE_PLAN_GEOMETRY_INVALID",
  );
};

const cleanPlacePlanInput = (value) => {
  const displayName = cleanText(value?.displayName, 120, "displayName");
  const planKind = String(value?.planKind || "").trim();
  if (!placePlanKinds.has(planKind)) {
    throw typedError(
      "planKind must be property, floor, outdoor, or other",
      400,
      "PLACE_PLAN_KIND_INVALID",
    );
  }
  const backgroundSourceAssetId = value?.backgroundSourceAssetId
    ? String(value.backgroundSourceAssetId).trim()
    : null;
  const backgroundKind = String(
    value?.backgroundKind || (backgroundSourceAssetId ? "asset" : "blank"),
  ).trim();
  if (!placePlanBackgroundKinds.has(backgroundKind)) {
    throw typedError(
      "backgroundKind must be blank, asset, or satellite",
      400,
      "PLACE_PLAN_BACKGROUND_INVALID",
    );
  }
  if (backgroundSourceAssetId && backgroundSourceAssetId.length > 200) {
    throw typedError(
      "backgroundSourceAssetId is invalid",
      400,
      "PLACE_PLAN_BACKGROUND_INVALID",
    );
  }
  if ((backgroundKind === "asset") !== Boolean(backgroundSourceAssetId)) {
    throw typedError(
      "An asset Plan background needs exactly one background photo",
      400,
      "PLACE_PLAN_BACKGROUND_INVALID",
    );
  }
  let backgroundViewport = null;
  if (value?.backgroundViewport != null) {
    if (
      typeof value.backgroundViewport !== "object" ||
      Array.isArray(value.backgroundViewport)
    ) {
      throw typedError(
        "backgroundViewport must be a satellite centre and zoom",
        400,
        "PLACE_PLAN_VIEWPORT_INVALID",
      );
    }
    const { latitude, longitude, zoom } = value.backgroundViewport;
    if (
      backgroundKind !== "satellite" ||
      typeof latitude !== "number" ||
      !Number.isFinite(latitude) ||
      latitude < -85.051129 ||
      latitude > 85.051129 ||
      typeof longitude !== "number" ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180 ||
      typeof zoom !== "number" ||
      !Number.isFinite(zoom) ||
      zoom < 0 ||
      zoom > 22
    ) {
      throw typedError(
        "backgroundViewport must be a valid satellite centre and zoom",
        400,
        "PLACE_PLAN_VIEWPORT_INVALID",
      );
    }
    backgroundViewport = { latitude, longitude, zoom };
  }
  if (!Array.isArray(value?.items) || value.items.length > 200) {
    throw typedError(
      "Plan items must be an array with at most 200 entries",
      400,
      "PLACE_PLAN_ITEMS_INVALID",
    );
  }
  const items = value.items.map((item, index) => ({
    childEntityId: cleanEntityId(
      item?.childEntityId,
      `items[${index}].childEntityId`,
    ),
    geometry: cleanPlanShape(item?.geometry),
    zIndex: Number.isInteger(item?.zIndex)
      ? Math.min(10000, Math.max(0, item.zIndex))
      : index,
  }));
  if (new Set(items.map((item) => item.childEntityId)).size !== items.length) {
    throw typedError(
      "Each child Location can appear only once on a Plan",
      400,
      "PLACE_PLAN_ITEMS_INVALID",
    );
  }
  return {
    backgroundKind,
    backgroundSourceAssetId,
    backgroundViewport,
    displayName,
    isDefault: value?.isDefault === true,
    items,
    planKind,
  };
};

const loadPlacePlanSnapshot = async (executor, planId) => {
  const [plan] = await executor`
    SELECT plan_id, location_entity_id, display_name, plan_kind,
      background_kind, background_asset_id, background_viewport, is_default, revision
    FROM place_plan WHERE plan_id = ${planId}
  `;
  if (!plan) return null;
  const items = await executor`
    SELECT plan_item_id, child_entity_id, shape_kind, geometry, z_index
    FROM place_plan_item WHERE plan_id = ${planId}
    ORDER BY z_index, plan_item_id
  `;
  return {
    backgroundAssetId: plan.background_asset_id || null,
    backgroundKind: plan.background_kind,
    backgroundViewport: plan.background_viewport || null,
    displayName: plan.display_name,
    isDefault: plan.is_default,
    items: items.map((item) => ({
      childEntityId: item.child_entity_id,
      geometry: item.geometry,
      planItemId: item.plan_item_id,
      shapeKind: item.shape_kind,
      zIndex: item.z_index,
    })),
    locationEntityId: plan.location_entity_id,
    planId: plan.plan_id,
    planKind: plan.plan_kind,
    revision: plan.revision,
  };
};

const restorePlacePlanSnapshot = async (tx, snapshot) => {
  await tx`
    INSERT INTO place_plan (
      plan_id, location_entity_id, display_name, plan_kind, background_kind,
      background_asset_id, background_viewport, is_default, revision, updated_at
    ) VALUES (
      ${snapshot.planId}, ${snapshot.locationEntityId}, ${snapshot.displayName},
      ${snapshot.planKind}, ${snapshot.backgroundKind}, ${snapshot.backgroundAssetId},
      ${snapshot.backgroundViewport ? tx.json(snapshot.backgroundViewport) : null},
      ${snapshot.isDefault}, ${snapshot.revision}, now()
    ) ON CONFLICT (plan_id) DO UPDATE SET
      display_name = excluded.display_name,
      plan_kind = excluded.plan_kind,
      background_kind = excluded.background_kind,
      background_asset_id = excluded.background_asset_id,
      background_viewport = excluded.background_viewport,
      is_default = excluded.is_default,
      revision = excluded.revision,
      updated_at = now()
  `;
  await tx`DELETE FROM place_plan_item WHERE plan_id = ${snapshot.planId}`;
  for (const item of snapshot.items) {
    await tx`
      INSERT INTO place_plan_item (
        plan_item_id, plan_id, child_entity_id, shape_kind, geometry, z_index
      ) VALUES (
        ${item.planItemId}, ${snapshot.planId}, ${item.childEntityId},
        ${item.shapeKind}, ${tx.json(item.geometry)}, ${item.zIndex}
      )
    `;
  }
};

export const createContextEntityStore = (
  sql,
  {
    assetIdBySourceId = () => null,
    bridgeFields = () => ({}),
    presentationRank = () => 0,
  } = {},
) => {
  const projectPlacePlans = async (executor, locationEntityId) => {
    const owner = await requireEntity(executor, locationEntityId, {
      entityKind: "place",
      presentationRank,
      requireVisible: true,
    });
    if (owner.place_role !== "location") {
      throw typedError(
        "Plans belong to Locations",
        409,
        "PLACE_PLAN_OWNER_INVALID",
      );
    }
    const plans = await executor`
      SELECT plan_id FROM place_plan
      WHERE location_entity_id = ${locationEntityId}
      ORDER BY is_default DESC, created_at, plan_id
    `;
    const projected = [];
    for (const row of plans) {
      const snapshot = await loadPlacePlanSnapshot(executor, row.plan_id);
      if (!snapshot) continue;
      let backgroundSourceAssetId = null;
      if (snapshot.backgroundAssetId) {
        const [visibleBackground] = await executor`
          SELECT asset_id FROM asset
          WHERE asset_id = ${snapshot.backgroundAssetId} AND state = 'active'
            AND cimmich_visibility_asset_rank(asset_id) <= ${presentationRank()}
        `;
        backgroundSourceAssetId = visibleBackground
          ? bridgeFields(snapshot.backgroundAssetId).sourceAssetId || null
          : null;
      }
      const visibleItems = [];
      for (const item of snapshot.items) {
        const [child] = await executor`
          SELECT entity_id, display_name, status
          FROM context_entity
          WHERE entity_id = ${item.childEntityId}
            AND parent_entity_id = ${locationEntityId}
            AND entity_kind = 'place' AND place_role = 'location'
            AND status IN ('active','hidden')
            AND cimmich_visibility_context_entity_rank(entity_id) <= ${presentationRank()}
        `;
        if (child) {
          visibleItems.push({
            childEntityId: child.entity_id,
            childName: child.display_name,
            geometry: item.geometry,
            planItemId: item.planItemId,
            zIndex: item.zIndex,
          });
        }
      }
      projected.push({
        backgroundKind: snapshot.backgroundKind,
        backgroundSourceAssetId,
        backgroundViewport: snapshot.backgroundViewport,
        displayName: snapshot.displayName,
        isDefault: snapshot.isDefault,
        items: visibleItems,
        locationEntityId: snapshot.locationEntityId,
        planId: snapshot.planId,
        planKind: snapshot.planKind,
        revision: snapshot.revision,
      });
    }
    return {
      items: projected,
      locationEntityId,
      schemaVersion: "cimmich.location-plan.v1",
    };
  };

  const api = {
    list: ({
      entityKind,
      includeArchived,
      includeHidden,
      limit,
      placeRole = null,
      query,
    }) => {
      if (!entityKinds.has(entityKind)) {
        throw typedError(
          "entityKind is unsupported",
          400,
          "CONTEXT_KIND_INVALID",
        );
      }
      if (
        placeRole !== null &&
        (entityKind !== "place" || !placeRoles.has(placeRole))
      ) {
        throw typedError(
          "placeRole filter is unsupported",
          400,
          "CONTEXT_PLACE_ROLE_INVALID",
        );
      }
      return loadEntities(sql, {
        bridgeFields,
        entityKind,
        includeArchived,
        includeHidden,
        limit,
        placeRole,
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

    listPlacePlans: ({ entityId }) =>
      projectPlacePlans(sql, cleanEntityId(entityId)),

    savePlacePlan: async ({
      actorId,
      commandId,
      entityId,
      expectedRevision,
      planId,
      ...input
    }) => {
      const actor = cleanActor(actorId);
      const locationEntityId = cleanEntityId(entityId);
      const requestedPlanId = cleanPlanId(planId, { nullable: true });
      const requested = cleanPlacePlanInput(input);
      const revision = Number(expectedRevision ?? (requestedPlanId ? NaN : 0));
      if (!Number.isInteger(revision) || revision < 0) {
        throw typedError(
          "expectedRevision must be zero for a new Plan or the current positive revision",
          400,
          "PLACE_PLAN_REVISION_INVALID",
        );
      }
      return sql.begin(async (tx) => {
        const command = await beginCommand(tx, {
          actorId: actor,
          commandId,
          commandKind: "plan_save",
          payload: {
            entityId: locationEntityId,
            expectedRevision: revision,
            planId: requestedPlanId,
            ...requested,
          },
        });
        if (command.replay) return command.replay;
        const owner = await requireEntity(tx, locationEntityId, {
          entityKind: "place",
          lock: true,
          presentationRank,
          requireVisible: true,
        });
        if (
          owner.place_role !== "location" ||
          !["active", "hidden"].includes(owner.status)
        ) {
          throw typedError(
            "Plans belong to current Locations",
            409,
            "PLACE_PLAN_OWNER_INVALID",
          );
        }
        const actualPlanId =
          requestedPlanId || `placeplan_${randomUUID().replaceAll("-", "")}`;
        const previous = await loadPlacePlanSnapshot(tx, actualPlanId);
        if (previous && previous.locationEntityId !== locationEntityId) {
          throw typedError(
            "Plan belongs to another Location",
            409,
            "PLACE_PLAN_SCOPE_INVALID",
          );
        }
        if (
          (!previous && revision !== 0) ||
          (previous && revision !== previous.revision)
        ) {
          throw typedError(
            "Location Plan changed after it was loaded",
            409,
            "PLACE_PLAN_REVISION_CONFLICT",
            {
              actualRevision: previous?.revision ?? 0,
              expectedRevision: revision,
            },
          );
        }
        const childRows = requested.items.length
          ? await tx`
              SELECT entity_id FROM context_entity
              WHERE entity_id = ANY(${requested.items.map((item) => item.childEntityId)})
                AND parent_entity_id = ${locationEntityId}
                AND entity_kind = 'place' AND place_role = 'location'
                AND status IN ('active','hidden')
                AND cimmich_visibility_context_entity_rank(entity_id) <= ${presentationRank()}
              ORDER BY entity_id FOR UPDATE
            `
          : [];
        if (childRows.length !== requested.items.length) {
          throw typedError(
            "Every Plan item must be a visible immediate child Location",
            409,
            "PLACE_PLAN_CHILD_INVALID",
          );
        }
        let backgroundAssetId = null;
        if (requested.backgroundSourceAssetId) {
          backgroundAssetId = assetIdBySourceId(
            requested.backgroundSourceAssetId,
          );
          const [background] = backgroundAssetId
            ? await tx`
                SELECT asset_id FROM asset
                WHERE asset_id = ${backgroundAssetId} AND state = 'active'
                  AND cimmich_visibility_asset_rank(asset_id) <= ${presentationRank()}
              `
            : [];
          if (!background) {
            throw typedError(
              "Plan background photo is not available in this viewing mode",
              409,
              "PLACE_PLAN_BACKGROUND_INVALID",
            );
          }
        }
        const [planCount] = await tx`
          SELECT count(*)::int AS count FROM place_plan
          WHERE location_entity_id = ${locationEntityId}
        `;
        const [previousDefault] = await tx`
          SELECT plan_id FROM place_plan
          WHERE location_entity_id = ${locationEntityId} AND is_default
          FOR UPDATE
        `;
        const previousDefaultPlanId = previousDefault?.plan_id || null;
        const isDefault =
          requested.isDefault || Number(planCount?.count || 0) === 0;
        if (isDefault) {
          await tx`
            UPDATE place_plan SET is_default = false, updated_at = now()
            WHERE location_entity_id = ${locationEntityId} AND is_default
          `;
        }
        await tx`
          INSERT INTO place_plan (
            plan_id, location_entity_id, display_name, plan_kind,
            background_kind, background_asset_id, background_viewport, is_default, revision
          ) VALUES (
            ${actualPlanId}, ${locationEntityId}, ${requested.displayName}, ${requested.planKind},
            ${requested.backgroundKind}, ${backgroundAssetId},
            ${requested.backgroundViewport ? tx.json(requested.backgroundViewport) : null}, ${isDefault}, 1
          ) ON CONFLICT (plan_id) DO UPDATE SET
            display_name = excluded.display_name,
            plan_kind = excluded.plan_kind,
            background_kind = excluded.background_kind,
            background_asset_id = excluded.background_asset_id,
            background_viewport = excluded.background_viewport,
            is_default = excluded.is_default,
            revision = place_plan.revision + 1,
            updated_at = now()
        `;
        await tx`DELETE FROM place_plan_item WHERE plan_id = ${actualPlanId}`;
        for (const item of requested.items) {
          await tx`
            INSERT INTO place_plan_item (
              plan_item_id, plan_id, child_entity_id, shape_kind, geometry, z_index
            ) VALUES (
              ${`planitem_${randomUUID().replaceAll("-", "")}`}, ${actualPlanId},
              ${item.childEntityId}, ${item.geometry.kind}, ${tx.json(item.geometry)}, ${item.zIndex}
            )
          `;
        }
        const next = await loadPlacePlanSnapshot(tx, actualPlanId);
        const decisionId = await createDecision(tx, {
          action: previous ? "update" : "create",
          actorId: actor,
          entityId: actualPlanId,
          note: `${previous ? "Update" : "Create"} Location Plan`,
          reasonCode: previous
            ? "location_plan_update"
            : "location_plan_create",
          subjectType: "place_plan",
        });
        await tx`
          UPDATE context_entity SET revision = revision + 1, updated_at = now()
          WHERE entity_id = ${locationEntityId}
        `;
        const detail = await loadDetail(tx, {
          bridgeFields,
          entityId: locationEntityId,
          entityKind: "place",
          presentationRank,
        });
        const plans = await projectPlacePlans(tx, locationEntityId);
        const response = {
          changed: true,
          commandId: command.commandId,
          decisionId,
          detail,
          plan: plans.items.find((item) => item.planId === actualPlanId),
          plans: plans.items,
          replayed: false,
          schemaVersion: "cimmich.location-plan.v1",
          status: "applied",
          undo: { eligible: true, token: decisionId },
        };
        await completeCommand(tx, {
          actorId: actor,
          command,
          commandKind: "plan_save",
          decisionId,
          response,
        });
        await tx`
          INSERT INTO context_operation (
            operation_id, command_id, entity_id, operation_scope, action,
            decision_id, state, snapshot
          ) VALUES (
            ${`contextop_${randomUUID().replaceAll("-", "")}`},
            ${command.commandId}, ${locationEntityId}, 'plan', 'save',
            ${decisionId}, 'active', ${tx.json([{ next, previous, previousDefaultPlanId }])}
          )
        `;
        return response;
      });
    },

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
          requested.placeRole,
        );
        await requireGeography(
          tx,
          requested.geographyEntityId,
          requested.placeRole,
          null,
          presentationRank,
        );
        if (
          requested.directoryVisibility === "nested_only" &&
          !requested.parentEntityId
        ) {
          throw typedError(
            "A Place shown only inside its parent must have a parent Place",
            400,
            "CONTEXT_DIRECTORY_PARENT_REQUIRED",
          );
        }
        await tx`
          INSERT INTO context_entity (
            entity_id, entity_kind, place_kind, object_kind, event_kind,
            display_name, description, date_start, date_end, date_precision,
            recurrence, source_folders, geometry, parent_entity_id, status, directory_visibility,
            place_role, geography_entity_id
          ) VALUES (
            ${entityId}, ${requested.entityKind},
            ${requested.entityKind === "place" ? requested.typeKind : null},
            ${requested.entityKind === "object" ? requested.typeKind : null},
            ${requested.entityKind === "event" ? requested.typeKind : null},
            ${requested.displayName}, ${requested.description || null},
            ${requested.dateStart || null}, ${requested.dateEnd || null},
            ${requested.datePrecision},
            ${requested.recurrence ? tx.json(requested.recurrence) : null},
            ${requested.entityKind === "event" ? tx.json(requested.sourceFolders || []) : tx.json([])},
            ${requested.geometry ? tx.json(requested.geometry) : null},
            ${requested.parentEntityId || null}, ${requested.status || "active"},
            ${requested.entityKind === "place" ? requested.directoryVisibility || "listed" : "listed"},
            ${requested.entityKind === "place" ? requested.placeRole : null},
            ${requested.entityKind === "place" ? requested.geographyEntityId || null : null}
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
        if (
          current.entity_kind !== "place" &&
          (requested.directoryVisibility !== undefined ||
            requested.placeRole !== undefined ||
            requested.geographyEntityId !== undefined)
        ) {
          throw typedError(
            "Only Places may change directory visibility, role, or geography",
            400,
            "CONTEXT_PLACE_ROLE_INVALID",
          );
        }
        if (
          current.entity_kind !== "event" &&
          requested.sourceFolders !== undefined
        ) {
          throw typedError(
            "Only Events may remember source folders",
            400,
            "CONTEXT_SOURCE_FOLDERS_INVALID",
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
        const nextRecurrence = Object.hasOwn(requested, "recurrence")
          ? requested.recurrence
          : nextType === "activity"
            ? current.recurrence
            : null;
        const nextSourceFolders = Object.hasOwn(requested, "sourceFolders")
          ? requested.sourceFolders
          : current.source_folders || [];
        if (
          nextRecurrence !== null &&
          (current.entity_kind !== "event" || nextType !== "activity")
        ) {
          throw typedError(
            "Only Activities may repeat",
            400,
            "CONTEXT_RECURRENCE_INVALID",
          );
        }
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
        const nextPlaceRole =
          current.entity_kind === "place"
            ? (requested.placeRole ?? current.place_role ?? "unclassified")
            : null;
        const nextGeographyEntityId =
          current.entity_kind === "place"
            ? Object.hasOwn(requested, "geographyEntityId")
              ? requested.geographyEntityId
              : current.geography_entity_id
            : null;
        await requireParent(
          tx,
          nextParentId,
          current.entity_kind,
          current.entity_id,
          presentationRank,
          nextPlaceRole,
        );
        await requireGeography(
          tx,
          nextGeographyEntityId,
          nextPlaceRole,
          current.entity_id,
          presentationRank,
        );
        if (
          current.entity_kind === "place" &&
          nextPlaceRole !== "unclassified" &&
          nextPlaceRole !== current.place_role
        ) {
          const [conflictingChildren] = await tx`
            SELECT count(*)::int AS count FROM context_entity
            WHERE parent_entity_id = ${current.entity_id}
              AND status IN ('active','hidden')
              AND place_role <> 'unclassified'
              AND place_role <> ${nextPlaceRole}
          `;
          if (Number(conflictingChildren.count) > 0) {
            throw typedError(
              "Classified Place children must use the same hierarchy role",
              409,
              "CONTEXT_CHILD_ROLE_INVALID",
            );
          }
        }
        if (
          current.entity_kind === "place" &&
          current.place_role === "geography" &&
          (nextPlaceRole !== "geography" ||
            (requested.status &&
              !["active", "hidden"].includes(requested.status)))
        ) {
          const [linkedLocations] = await tx`
            SELECT count(*)::int AS count FROM context_entity
            WHERE geography_entity_id = ${current.entity_id}
              AND status IN ('active','hidden')
          `;
          if (Number(linkedLocations.count) > 0) {
            throw typedError(
              "Move linked Locations before changing or removing this Geography",
              409,
              "CONTEXT_GEOGRAPHY_HAS_LOCATIONS",
              { locationCount: Number(linkedLocations.count) },
            );
          }
        }
        const nextDirectoryVisibility =
          requested.directoryVisibility ??
          current.directory_visibility ??
          "listed";
        if (nextDirectoryVisibility === "nested_only" && !nextParentId) {
          throw typedError(
            "A Place shown only inside its parent must have a parent Place",
            400,
            "CONTEXT_DIRECTORY_PARENT_REQUIRED",
          );
        }
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
          directoryVisibility: nextDirectoryVisibility,
          displayName: requested.displayName ?? previousState.displayName,
          geometry: nextGeometry,
          geographyEntityId: nextGeographyEntityId || null,
          parentEntityId: nextParentId || null,
          placeRole: nextPlaceRole,
          recurrence: nextRecurrence,
          sourceFolders: nextSourceFolders,
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
            recurrence = ${nextRecurrence ? tx.json(nextRecurrence) : null},
            source_folders = ${tx.json(nextSourceFolders)},
            geometry = ${nextGeometry ? tx.json(nextGeometry) : null},
            parent_entity_id = ${nextParentId},
            place_role = ${nextPlaceRole},
            geography_entity_id = ${nextGeographyEntityId},
            status = ${requested.status ?? current.status},
            directory_visibility = ${nextDirectoryVisibility},
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
              SELECT asset.asset_id
              FROM asset
              WHERE asset.asset_id = ${nextCoverAssetId}
                AND asset.state = 'active'
                AND cimmich_context_cover_available(
                  ${entity.entity_id}, ${entity.entity_kind}, asset.asset_id
                )
                AND cimmich_visibility_asset_rank(asset.asset_id) <= ${presentationRank()}
              FOR UPDATE OF asset
            `
          : [];
        if (!available) {
          throw typedError(
            "Cover asset is not active and visible in this context",
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
        UPDATE context_relation_link SET state = 'superseded', sort_order = NULL
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

  api.assignPlaceAssetsToChild = ({
    actorId,
    assetIds,
    childEntityId,
    commandId,
    entityId,
  }) => {
    const actor = cleanActor(actorId);
    const parentId = cleanEntityId(entityId);
    const childId = cleanEntityId(childEntityId, "childEntityId");
    const ids = cleanIds(assetIds, "CONTEXT_PLACE_ASSIGNMENT_INVALID");
    if (!parentId.startsWith("place_") || !childId.startsWith("place_")) {
      throw typedError(
        "Place assignment requires Place IDs",
        400,
        "CONTEXT_PLACE_ASSIGNMENT_INVALID",
      );
    }
    return sql.begin(async (tx) => {
      const command = await beginCommand(tx, {
        actorId: actor,
        commandId,
        commandKind: "place_assignment",
        payload: { assetIds: ids, childEntityId: childId, entityId: parentId },
      });
      if (command.replay) {
        return refreshReplay(tx, command.replay, {
          bridgeFields,
          presentationRank,
        });
      }
      const parent = await requireEntity(tx, parentId, {
        entityKind: "place",
        lock: true,
        presentationRank,
        requireVisible: true,
      });
      const child = await requireEntity(tx, childId, {
        entityKind: "place",
        lock: true,
        presentationRank,
        requireVisible: true,
      });
      const [destination] = await tx`
        WITH RECURSIVE descendants AS (
          SELECT entity_id, parent_entity_id, 1 AS depth
          FROM context_entity
          WHERE parent_entity_id = ${parent.entity_id}
            AND entity_kind = 'place' AND status IN ('active','hidden')
          UNION ALL
          SELECT child_entity.entity_id, child_entity.parent_entity_id,
                 parent_entity.depth + 1
          FROM context_entity child_entity
          JOIN descendants parent_entity
            ON child_entity.parent_entity_id = parent_entity.entity_id
          WHERE child_entity.entity_kind = 'place'
            AND child_entity.status IN ('active','hidden')
            AND parent_entity.depth < 8
        )
        SELECT entity_id FROM descendants WHERE entity_id = ${child.entity_id}
      `;
      if (!destination) {
        throw typedError(
          "The destination must be a subsection within this Place",
          409,
          "CONTEXT_PLACE_ASSIGNMENT_CHILD_INVALID",
        );
      }
      const found = await tx`
        SELECT asset_id FROM asset
        WHERE asset_id = ANY(${ids}) AND state = 'active'
        ORDER BY asset_id FOR UPDATE
      `;
      if (found.length !== ids.length) {
        const foundIds = new Set(found.map((row) => row.asset_id));
        throw typedError(
          "One or more active assets were not found",
          404,
          "CONTEXT_ASSET_NOT_FOUND",
          { missingAssetIds: ids.filter((id) => !foundIds.has(id)) },
        );
      }
      const scopeRows = await tx`
        WITH RECURSIVE place_scope(entity_id, depth) AS (
          SELECT ${parent.entity_id}::text, 0
          UNION ALL
          SELECT child_place.entity_id, parent_place.depth + 1
          FROM context_entity child_place
          JOIN place_scope parent_place
            ON child_place.parent_entity_id = parent_place.entity_id
          WHERE child_place.entity_kind = 'place'
            AND child_place.status IN ('active','hidden')
            AND parent_place.depth < 8
        )
        SELECT link.link_id, link.entity_id, link.asset_id,
          link.association_kind, link.state
        FROM place_scope place
        JOIN context_asset_link link ON link.entity_id = place.entity_id
        WHERE link.asset_id = ANY(${ids})
          AND link.state IN ('accepted','rejected')
        ORDER BY link.asset_id, link.entity_id
        FOR UPDATE OF link
      `;
      const scopeRowsByAssetId = new Map();
      for (const row of scopeRows) {
        const rows = scopeRowsByAssetId.get(row.asset_id) || [];
        rows.push(row);
        scopeRowsByAssetId.set(row.asset_id, rows);
      }
      const outsidePlace = ids.filter(
        (assetId) =>
          !(scopeRowsByAssetId.get(assetId) || []).some(
            (row) => row.state === "accepted",
          ),
      );
      if (outsidePlace.length) {
        throw typedError(
          "Every photo must already belong to this Place or one of its subsections",
          409,
          "CONTEXT_PLACE_ASSIGNMENT_OUTSIDE_SCOPE",
          { assetIds: outsidePlace },
        );
      }
      const decisionId = await createDecision(tx, {
        action: "update",
        actorId: actor,
        entityId: parent.entity_id,
        note: `Assign ${ids.length} Place asset(s) to ${child.display_name}`,
        reasonCode: "context_place_subsection_assignment",
        subjectType: "context_asset",
      });
      const snapshot = [];
      const unchangedAssetIds = [];
      const touchedEntityIds = new Set([parent.entity_id, child.entity_id]);
      for (const assetId of ids) {
        const rows = scopeRowsByAssetId.get(assetId) || [];
        const acceptedRows = rows.filter((row) => row.state === "accepted");
        if (
          acceptedRows.length === 1 &&
          acceptedRows[0].entity_id === child.entity_id
        ) {
          unchangedAssetIds.push(assetId);
          continue;
        }
        const targetRow = rows.find((row) => row.entity_id === child.entity_id);
        const transitionRows = [
          ...acceptedRows,
          ...(targetRow && !acceptedRows.includes(targetRow)
            ? [targetRow]
            : []),
        ];
        const transitions = [];
        for (const previous of transitionRows) {
          await tx`
            UPDATE context_asset_link SET state = 'superseded'
            WHERE link_id = ${previous.link_id}
          `;
          const createdLinkId = `contextasset_${randomUUID().replaceAll("-", "")}`;
          const nextState =
            previous.entity_id === child.entity_id ? "accepted" : "rejected";
          await tx`
            INSERT INTO context_asset_link (
              link_id, entity_id, asset_id, association_kind, state,
              decision_id, supersedes_link_id
            ) VALUES (
              ${createdLinkId}, ${previous.entity_id}, ${assetId},
              ${previous.association_kind}, ${nextState}, ${decisionId},
              ${previous.link_id}
            )
          `;
          transitions.push({
            createdLinkId,
            entityId: previous.entity_id,
            previousAssociationKind: previous.association_kind,
            previousState: previous.state,
          });
          touchedEntityIds.add(previous.entity_id);
        }
        if (!targetRow) {
          const createdLinkId = `contextasset_${randomUUID().replaceAll("-", "")}`;
          await tx`
            INSERT INTO context_asset_link (
              link_id, entity_id, asset_id, association_kind, state,
              decision_id, supersedes_link_id
            ) VALUES (
              ${createdLinkId}, ${child.entity_id}, ${assetId}, 'manual',
              'accepted', ${decisionId}, NULL
            )
          `;
          transitions.push({
            createdLinkId,
            entityId: child.entity_id,
            previousAssociationKind: null,
            previousState: null,
          });
        }
        snapshot.push({
          assetId,
          childEntityId: child.entity_id,
          transitions,
        });
      }
      if (snapshot.length) {
        await tx`
          UPDATE context_entity SET revision = revision + 1, updated_at = now()
          WHERE entity_id = ANY(${[...touchedEntityIds]})
        `;
      }
      const operationId = snapshot.length
        ? `contextop_${randomUUID().replaceAll("-", "")}`
        : null;
      const detail = await loadDetail(tx, {
        bridgeFields,
        entityId: parent.entity_id,
        entityKind: "place",
        presentationRank,
      });
      const response = {
        changedAssetIds: snapshot.map((item) => item.assetId),
        childEntityId: child.entity_id,
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
        commandKind: "place_assignment",
        decisionId,
        response,
      });
      if (operationId)
        await tx`
        INSERT INTO context_operation (
          operation_id, command_id, entity_id, operation_scope, action,
          decision_id, state, snapshot
        ) VALUES (
          ${operationId}, ${command.commandId}, ${parent.entity_id},
          'place_assignment', 'assign', ${decisionId}, 'active', ${tx.json(snapshot)}
        )
      `;
      return response;
    });
  };

  const modifyAssets = async ({
    actorId,
    assetIds,
    assets,
    commandId,
    entityId,
    entityKind,
    selected,
    sourceFolders,
  }) => {
    const actor = cleanActor(actorId);
    const items = selected
      ? cleanAssetItems(assets, entityKind)
      : cleanIds(assetIds, "CONTEXT_ASSETS_INVALID").map((assetId) => ({
          assetId,
        }));
    const commandKind = selected ? "asset_attach" : "asset_detach";
    const requestedSourceFolders =
      selected && sourceFolders !== undefined
        ? cleanSourceFolders(sourceFolders)
        : undefined;
    if (requestedSourceFolders !== undefined && entityKind !== "event") {
      throw typedError(
        "Only Events may remember source folders",
        400,
        "CONTEXT_SOURCE_FOLDERS_INVALID",
      );
    }
    return sql.begin(async (tx) => {
      const command = await beginCommand(tx, {
        actorId: actor,
        commandId,
        commandKind,
        payload: { entityId, items, sourceFolders: requestedSourceFolders },
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
      const previousSourceFolders = entity.source_folders || [];
      const nextSourceFolders =
        requestedSourceFolders === undefined
          ? previousSourceFolders
          : [
              ...previousSourceFolders,
              ...requestedSourceFolders.filter(
                (folder) => !previousSourceFolders.includes(folder),
              ),
            ];
      if (nextSourceFolders.length > 20) {
        throw typedError(
          "An Event may remember no more than 20 source folders",
          400,
          "CONTEXT_SOURCE_FOLDERS_INVALID",
        );
      }
      const sourceFoldersChanged =
        digest(previousSourceFolders) !== digest(nextSourceFolders);
      if (sourceFoldersChanged)
        snapshot.push({
          nextSourceFolders,
          operationKind: "source_folders",
          previousSourceFolders,
        });
      if (snapshot.length)
        await tx`
        UPDATE context_entity SET
          cover_asset_id = CASE
            WHEN ${!selected} AND cover_asset_id = ANY(${ids}) THEN NULL
            ELSE cover_asset_id
          END,
          source_folders = ${tx.json(nextSourceFolders)},
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
        changedAssetIds: snapshot.flatMap((item) =>
          item.assetId ? [item.assetId] : [],
        ),
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
      const relatedEventTargetIds = items
        .filter(
          (item) =>
            item.targetKind === "event" && item.relationKind === "related",
        )
        .map((item) => item.targetId);
      const inverseRelatedRows =
        selected &&
        entity.entity_kind === "event" &&
        relatedEventTargetIds.length
          ? await tx`
              SELECT link_id, entity_id
              FROM current_context_relation
              WHERE target_kind = 'event'
                AND target_id = ${entity.entity_id}
                AND relation_kind = 'related'
                AND entity_id = ANY(${relatedEventTargetIds})
              FOR UPDATE
            `
          : [];
      const inverseRelatedByTargetId = new Map(
        inverseRelatedRows.map((row) => [row.entity_id, row]),
      );
      let currentRows;
      if (selected) {
        currentRows = await tx`
          SELECT link_id, target_kind, target_id, relation_kind, sort_order, state
          FROM context_relation_link
          WHERE entity_id = ${entity.entity_id} AND state IN ('accepted','rejected')
          FOR UPDATE
        `;
      } else {
        currentRows = await tx`
          SELECT link_id, target_kind, target_id, relation_kind, sort_order, state
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
      // Release every changed stop position before inserting any replacement.
      // A one-at-a-time update makes a simple swap (0 <-> 1) collide with the
      // unique current-position index while the second old row is still live.
      const preSupersededLinkIds = new Set(
        selected
          ? items.flatMap((item) => {
              const current = currentByKey.get(
                `${item.targetKind}:${item.targetId}:${item.relationKind}`,
              );
              const currentSortOrder =
                current?.sort_order === null ||
                current?.sort_order === undefined
                  ? null
                  : Number(current.sort_order);
              return current?.state === "accepted" &&
                currentSortOrder !== item.sortOrder
                ? [current.link_id]
                : [];
            })
          : [],
      );
      if (preSupersededLinkIds.size)
        await tx`
          UPDATE context_relation_link SET state = 'superseded', sort_order = NULL
          WHERE link_id = ANY(${[...preSupersededLinkIds]})
        `;
      for (const item of items) {
        const key = selected
          ? `${item.targetKind}:${item.targetId}:${item.relationKind}`
          : item.relationId;
        const current = currentByKey.get(key);
        const inverseRelated =
          selected &&
          item.targetKind === "event" &&
          item.relationKind === "related" &&
          !current
            ? inverseRelatedByTargetId.get(item.targetId)
            : null;
        if (inverseRelated) {
          unchangedRelationIds.push(inverseRelated.link_id);
          continue;
        }
        if (
          (selected &&
            current?.state === "accepted" &&
            (current.sort_order === null
              ? null
              : Number(current.sort_order)) === item.sortOrder) ||
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
        if (current && !preSupersededLinkIds.has(current.link_id))
          await tx`
          UPDATE context_relation_link SET state = 'superseded', sort_order = NULL
          WHERE link_id = ${current.link_id}
        `;
        const linkId = `contextrel_${randomUUID().replaceAll("-", "")}`;
        const targetKind = selected ? item.targetKind : current.target_kind;
        const targetId = selected ? item.targetId : current.target_id;
        const relationKind = selected
          ? item.relationKind
          : current.relation_kind;
        const sortOrder = selected ? item.sortOrder : null;
        await tx`
          INSERT INTO context_relation_link (
            link_id, entity_id, target_kind, target_id, relation_kind, state,
            sort_order, decision_id, supersedes_link_id
          ) VALUES (
            ${linkId}, ${entity.entity_id}, ${targetKind}, ${targetId},
            ${relationKind}, ${selected ? "accepted" : "rejected"},
            ${sortOrder}, ${decisionId}, ${current?.link_id || null}
          )
        `;
        snapshot.push({
          createdLinkId: linkId,
          previousLinkId: current?.link_id || null,
          previousSortOrder:
            current?.sort_order === null || current?.sort_order === undefined
              ? null
              : Number(current.sort_order),
          previousState: current?.state || null,
          relationKind,
          sortOrder,
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
      let assignmentChild = null;
      const assignmentTouchedEntityIds = new Set();
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
            item.previous.placeRole,
          );
        }
        if (operation.action === "update") {
          await requireGeography(
            tx,
            item.previous.geographyEntityId,
            item.previous.placeRole,
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
              (SELECT count(*)::int FROM context_entity location
                WHERE location.geography_entity_id = ${entity.entity_id}
                  AND location.status <> 'deleted') AS geography_location_count,
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
              (SELECT count(*)::int FROM place_plan plan
                WHERE plan.location_entity_id = ${entity.entity_id}) AS plan_count,
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
      } else if (operation.operation_scope === "plan") {
        const [item] = snapshot;
        if (
          snapshot.length !== 1 ||
          operation.action !== "save" ||
          !item?.next?.planId ||
          item.next.locationEntityId !== entity.entity_id
        ) {
          throw typedError(
            "Location Plan undo snapshot is invalid",
            409,
            "CONTEXT_UNDO_NOT_AVAILABLE",
          );
        }
        const current = await loadPlacePlanSnapshot(tx, item.next.planId);
        if (!current || digest(current) !== digest(item.next)) {
          throw typedError(
            "Location Plan changed after this decision",
            409,
            "CONTEXT_UNDO_SUPERSEDED",
          );
        }
        if (item.next.isDefault) {
          const [currentDefault] = await tx`
            SELECT plan_id FROM place_plan
            WHERE location_entity_id = ${entity.entity_id} AND is_default
            FOR UPDATE
          `;
          if (currentDefault?.plan_id !== item.next.planId) {
            throw typedError(
              "Location Plan default changed after this decision",
              409,
              "CONTEXT_UNDO_SUPERSEDED",
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
            SELECT asset.asset_id FROM asset
            WHERE asset.asset_id = ${item.previousCoverAssetId}
              AND asset.state = 'active'
              AND cimmich_context_cover_available(
                ${entity.entity_id}, ${entity.entity_kind}, asset.asset_id
              )
              AND cimmich_visibility_asset_rank(asset.asset_id) <= ${presentationRank()}
            FOR UPDATE OF asset
          `;
          if (!available) {
            throw typedError(
              "Prior context cover is no longer available",
              409,
              "CONTEXT_UNDO_SUPERSEDED",
            );
          }
        }
      } else if (operation.operation_scope === "place_assignment") {
        const childIds = new Set(snapshot.map((item) => item.childEntityId));
        const usesTransitions = snapshot.every(
          (item) => Array.isArray(item.transitions) && item.transitions.length,
        );
        const usesLegacyLinks = snapshot.every(
          (item) => item.parentCreatedLinkId && item.childCreatedLinkId,
        );
        if (
          operation.action !== "assign" ||
          snapshot.length < 1 ||
          childIds.size !== 1 ||
          (!usesTransitions && !usesLegacyLinks)
        ) {
          throw typedError(
            "Place assignment undo snapshot is invalid",
            409,
            "CONTEXT_UNDO_NOT_AVAILABLE",
          );
        }
        [assignmentChild] = await tx`
          SELECT * FROM context_entity
          WHERE entity_id = ${snapshot[0].childEntityId}
            AND entity_kind = 'place' AND status IN ('active','hidden')
            AND cimmich_visibility_context_entity_rank(entity_id) <= ${presentationRank()}
          FOR UPDATE
        `;
        if (!assignmentChild) {
          throw typedError(
            "Place subsection is no longer available",
            409,
            "CONTEXT_UNDO_SUPERSEDED",
          );
        }
        for (const item of snapshot) {
          if (usesTransitions) {
            for (const transition of item.transitions) {
              const [row] = await tx`
                SELECT link_id FROM context_asset_link
                WHERE link_id = ${transition.createdLinkId}
                  AND entity_id = ${transition.entityId}
                  AND state IN ('accepted','rejected')
                FOR UPDATE
              `;
              if (!row) {
                throw typedError(
                  "Place assignment changed after this decision",
                  409,
                  "CONTEXT_UNDO_SUPERSEDED",
                );
              }
              assignmentTouchedEntityIds.add(transition.entityId);
            }
          } else {
            const rows = await tx`
              SELECT link_id FROM context_asset_link
              WHERE ((link_id = ${item.parentCreatedLinkId}
                    AND entity_id = ${entity.entity_id})
                  OR (link_id = ${item.childCreatedLinkId}
                    AND entity_id = ${assignmentChild.entity_id}))
                AND state IN ('accepted','rejected')
              ORDER BY link_id FOR UPDATE
            `;
            if (rows.length !== 2) {
              throw typedError(
                "Place assignment changed after this decision",
                409,
                "CONTEXT_UNDO_SUPERSEDED",
              );
            }
          }
          if (
            item.parentPreviousCoverAssetId &&
            entity.cover_asset_id !== null
          ) {
            throw typedError(
              "Place cover changed after this assignment",
              409,
              "CONTEXT_UNDO_SUPERSEDED",
            );
          }
        }
      } else {
        for (const item of snapshot) {
          if (
            operation.operation_scope === "asset" &&
            item.operationKind === "source_folders"
          ) {
            if (
              digest(entity.source_folders || []) !==
              digest(item.nextSourceFolders || [])
            ) {
              throw typedError(
                "Event source folders changed after this decision",
                409,
                "CONTEXT_UNDO_SUPERSEDED",
              );
            }
            continue;
          }
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
            : operation.operation_scope === "plan"
              ? "Undo Location Plan change"
              : operation.operation_scope === "cover"
                ? `Undo ${entityLabels[entity.entity_kind]} cover`
                : operation.operation_scope === "place_assignment"
                  ? "Undo Place subsection assignment"
                  : "Undo context association",
        reasonCode:
          operation.operation_scope === "entity"
            ? operation.action === "create"
              ? "context_manual_create_undo"
              : "context_manual_update_undo"
            : operation.operation_scope === "plan"
              ? "location_plan_undo"
              : operation.operation_scope === "cover"
                ? `context_${entity.entity_kind}_cover_undo`
                : operation.operation_scope === "place_assignment"
                  ? "context_place_subsection_assignment_undo"
                  : "context_manual_undo",
        subjectType:
          operation.operation_scope === "plan"
            ? "place_plan"
            : ["asset", "place_assignment"].includes(operation.operation_scope)
              ? "context_asset"
              : operation.operation_scope === "relation"
                ? "context_relation"
                : "context_entity",
        supersedes: operation.decision_id,
      });
      // Relation Undo can restore several prior stop positions at once. Release
      // every replacement position first so a swap does not collide while the
      // other replacement row is still current.
      if (operation.operation_scope === "relation")
        await tx`
          UPDATE context_relation_link SET state = 'superseded', sort_order = NULL
          WHERE entity_id = ${entity.entity_id}
            AND link_id = ANY(${snapshot.map((item) => item.createdLinkId)})
        `;
      for (const item of snapshot) {
        if (operation.operation_scope === "plan") {
          if (item.next.isDefault) {
            await tx`
              UPDATE place_plan SET is_default = false, updated_at = now()
              WHERE location_entity_id = ${entity.entity_id} AND is_default
            `;
          }
          if (item.previous) {
            await restorePlacePlanSnapshot(tx, item.previous);
          } else {
            await tx`DELETE FROM place_plan WHERE plan_id = ${item.next.planId}`;
          }
          if (
            item.previousDefaultPlanId &&
            item.previousDefaultPlanId !== item.previous?.planId
          ) {
            await tx`
              UPDATE place_plan SET is_default = true, updated_at = now()
              WHERE plan_id = ${item.previousDefaultPlanId}
                AND location_entity_id = ${entity.entity_id}
            `;
          }
        } else if (operation.operation_scope === "place_assignment") {
          if (Array.isArray(item.transitions)) {
            for (const transition of item.transitions) {
              await tx`
                UPDATE context_asset_link SET state = 'superseded'
                WHERE link_id = ${transition.createdLinkId}
              `;
              await tx`
                INSERT INTO context_asset_link (
                  link_id, entity_id, asset_id, association_kind, state,
                  decision_id, supersedes_link_id
                ) VALUES (
                  ${`contextasset_${randomUUID().replaceAll("-", "")}`},
                  ${transition.entityId}, ${item.assetId},
                  ${transition.previousAssociationKind || "manual"},
                  ${transition.previousState === "accepted" ? "accepted" : "rejected"},
                  ${undoDecisionId}, ${transition.createdLinkId}
                )
              `;
            }
          } else {
            await tx`
              UPDATE context_asset_link SET state = 'superseded'
              WHERE link_id IN (${item.parentCreatedLinkId}, ${item.childCreatedLinkId})
            `;
            await tx`
              INSERT INTO context_asset_link (
                link_id, entity_id, asset_id, association_kind, state, decision_id,
                supersedes_link_id
              ) VALUES (
                ${`contextasset_${randomUUID().replaceAll("-", "")}`},
                ${entity.entity_id}, ${item.assetId},
                ${item.parentPreviousAssociationKind || "manual"},
                ${item.parentPreviousState === "accepted" ? "accepted" : "rejected"},
                ${undoDecisionId}, ${item.parentCreatedLinkId}
              ), (
                ${`contextasset_${randomUUID().replaceAll("-", "")}`},
                ${assignmentChild.entity_id}, ${item.assetId},
                ${item.childPreviousAssociationKind || "manual"},
                ${item.childPreviousState === "accepted" ? "accepted" : "rejected"},
                ${undoDecisionId}, ${item.childCreatedLinkId}
              )
            `;
          }
          if (item.parentPreviousCoverAssetId) {
            await tx`
              UPDATE context_entity
              SET cover_asset_id = ${item.parentPreviousCoverAssetId}
              WHERE entity_id = ${entity.entity_id}
            `;
          }
        } else if (operation.operation_scope === "asset") {
          if (item.operationKind === "source_folders") {
            await tx`
              UPDATE context_entity
              SET source_folders = ${tx.json(item.previousSourceFolders || [])}
              WHERE entity_id = ${entity.entity_id}
            `;
          } else {
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
          }
        } else if (operation.operation_scope === "relation") {
          await tx`
            INSERT INTO context_relation_link (
              link_id, entity_id, target_kind, target_id, relation_kind, state,
              sort_order, decision_id, supersedes_link_id
            ) VALUES (
              ${`contextrel_${randomUUID().replaceAll("-", "")}`}, ${entity.entity_id},
              ${item.targetKind}, ${item.targetId}, ${item.relationKind},
              ${item.previousState === "accepted" ? "accepted" : "rejected"},
              ${item.previousState === "accepted" ? item.previousSortOrder : null},
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
              recurrence = ${item.previous.recurrence ? tx.json(item.previous.recurrence) : null},
              source_folders = ${tx.json(item.previous.sourceFolders || [])},
              geometry = ${item.previous.geometry ? tx.json(item.previous.geometry) : null},
              parent_entity_id = ${item.previous.parentEntityId},
              place_role = ${item.previous.placeRole},
              geography_entity_id = ${item.previous.geographyEntityId},
              status = ${item.previous.status},
              directory_visibility = ${item.previous.directoryVisibility || "listed"},
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
      const assignmentRevisionEntityIds = [
        ...assignmentTouchedEntityIds,
      ].filter((entityId) => entityId !== entity.entity_id);
      if (assignmentRevisionEntityIds.length) {
        await tx`
          UPDATE context_entity SET revision = revision + 1, updated_at = now()
          WHERE entity_id = ANY(${assignmentRevisionEntityIds})
        `;
      } else if (assignmentChild) {
        await tx`
          UPDATE context_entity SET revision = revision + 1, updated_at = now()
          WHERE entity_id = ${assignmentChild.entity_id}
        `;
      }
      if (!(
        operation.operation_scope === "entity" && operation.action === "create"
      )) {
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
        ...(operation.operation_scope === "plan"
          ? { plans: (await projectPlacePlans(tx, entity.entity_id)).items }
          : {}),
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
  directoryVisibilities: [...directoryVisibilities],
  entityKinds: [...entityKinds],
  eventCoverSchemaVersion,
  geometryProvenances: [...geometryProvenances],
  objectCoverSchemaVersion,
  objectDeleteSchemaVersion,
  placeCoverSchemaVersion,
  defaultPlaceRole,
  placePlanKinds: [...placePlanKinds],
  placePlanBackgroundKinds: [...placePlanBackgroundKinds],
  placeRoles: [...placeRoles],
  recurrenceFrequencies: [...recurrenceFrequencies],
  relationKinds: [...relationKinds],
  schemaVersion,
  placeDeleteSchemaVersion,
  targetKinds: [...targetKinds],
  typedKinds: Object.fromEntries(
    Object.entries(typedKinds).map(([key, values]) => [key, [...values]]),
  ),
});
