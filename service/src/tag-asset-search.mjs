import { createHash } from "node:crypto";

const schemaVersion = "cimmich.tag-assets.v1";
const families = new Set([
  "people",
  "pets",
  "places",
  "things",
  "events",
  "labels",
]);

const typedError = (message, statusCode, code) =>
  Object.assign(new Error(message), { code, statusCode });

const cleanPageSize = (value) => {
  if (value === null || value === undefined || String(value).trim() === "") {
    return 120;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 250) {
    throw typedError(
      "pageSize must be an integer from 1 to 250",
      400,
      "TAG_ASSET_PAGE_SIZE_INVALID",
    );
  }
  return parsed;
};

const cleanSelection = (value) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) {
    throw typedError(
      "Choose between 1 and 12 Cimmich tags",
      400,
      "TAG_ASSET_SELECTION_INVALID",
    );
  }
  const selected = value.map((item) => ({
    entityId: String(item?.entityId || "").trim(),
    family: String(item?.family || "").trim(),
  }));
  if (selected.some((item) => !item.entityId || !families.has(item.family))) {
    throw typedError(
      "Every Cimmich tag needs a supported family and entityId",
      400,
      "TAG_ASSET_SELECTION_INVALID",
    );
  }
  return [
    ...new Map(
      selected.map((item) => [`${item.family}:${item.entityId}`, item]),
    ).values(),
  ];
};

const selectionKeyFor = (selected, visibleRank) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        tags: selected.map((item) => `${item.family}:${item.entityId}`).sort(),
        visibleRank,
      }),
    )
    .digest("hex");

const encodeCursor = (payload) =>
  Buffer.from(JSON.stringify({ ...payload, v: 1 }), "utf8").toString(
    "base64url",
  );

const decodeCursor = (value, { selectionKey }) => {
  if (!value) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(String(value), "base64url").toString("utf8"),
    );
    const captureTimeValid =
      payload?.captureTime === null ||
      (typeof payload?.captureTime === "string" &&
        Number.isFinite(Date.parse(payload.captureTime)));
    if (
      payload?.v !== 1 ||
      payload?.selectionKey !== selectionKey ||
      typeof payload?.assetId !== "string" ||
      !payload.assetId ||
      !captureTimeValid
    ) {
      throw new Error("cursor scope mismatch");
    }
    return payload;
  } catch {
    throw typedError(
      "Tag result cursor is invalid for this selection or viewing mode",
      400,
      "TAG_ASSET_CURSOR_INVALID",
    );
  }
};

export const createTagAssetSearch = (sql, { bridge, presentationRank }) =>
  async function tagAssets({ cursor = "", pageSize = 120, tags }) {
    const selected = cleanSelection(tags);
    const tagFamilies = selected.map((item) => item.family);
    const entityIds = selected.map((item) => item.entityId);
    const tagKeys = selected.map((item) => `${item.family}:${item.entityId}`);
    const visibleRank = presentationRank();
    const boundedPageSize = cleanPageSize(pageSize);
    const selectionKey = selectionKeyFor(selected, visibleRank);
    const decodedCursor = decodeCursor(cursor, { selectionKey });
    const cursorCaptureTime = decodedCursor?.captureTime
      ? new Date(decodedCursor.captureTime)
      : null;
    const cursorAssetId = String(decodedCursor?.assetId || "");
    const bridgedAssetIds = [...bridge.keys()];
    if (bridgedAssetIds.length === 0) {
      return {
        items: [],
        nextCursor: null,
        pageSize: boundedPageSize,
        schemaVersion,
        total: 0,
      };
    }
    const rows = await sql`
      WITH RECURSIVE selected_tags(tag_key, family, entity_id) AS (
        SELECT * FROM unnest(
          ${tagKeys}::text[], ${tagFamilies}::text[], ${entityIds}::text[]
        )
      ), hidden_assets AS MATERIALIZED (
        SELECT object_id
        FROM cimmich_visibility_object
        WHERE object_scope = 'asset'
          AND CASE visibility_tier
            WHEN 'personal' THEN 1
            WHEN 'private' THEN 2
            ELSE 0
          END > ${visibleRank}
      ), person_memberships AS MATERIALIZED (
        SELECT selected.tag_key, association.asset_id
        FROM selected_tags selected
        JOIN person_assets association
          ON association.person_id = selected.entity_id
          AND association.authority_state = 'accepted'
        WHERE selected.family IN ('people', 'pets')
        UNION
        SELECT selected.tag_key, face.asset_id
        FROM selected_tags selected
        JOIN current_face_identity identity
          ON identity.person_id = selected.entity_id
          AND identity.state = 'accepted'
        JOIN face_observation face
          ON face.face_id = identity.face_id AND face.state = 'valid'
        WHERE selected.family IN ('people', 'pets')
        UNION
        SELECT selected.tag_key, body.asset_id
        FROM selected_tags selected
        JOIN current_body_tag tag
          ON tag.person_id = selected.entity_id AND tag.state = 'accepted'
        JOIN body_observation body
          ON body.body_id = tag.body_id AND body.state = 'valid'
        WHERE selected.family IN ('people', 'pets')
        UNION
        SELECT selected.tag_key, presence.asset_id
        FROM selected_tags selected
        JOIN current_presence_tag presence
          ON presence.person_id = selected.entity_id
          AND presence.state = 'accepted'
        WHERE selected.family IN ('people', 'pets')
        UNION
        SELECT selected.tag_key, head.asset_id
        FROM selected_tags selected
        JOIN current_manual_head_tag tag
          ON tag.subject_id = selected.entity_id
        JOIN manual_head_observation head ON head.head_id = tag.head_id
        WHERE selected.family IN ('people', 'pets')
      ), context_scope(tag_key, family, entity_id) AS (
        SELECT tag_key, family, entity_id
        FROM selected_tags
        WHERE family IN ('places', 'things', 'events')
        UNION ALL
        SELECT scope.tag_key, scope.family, child.entity_id
        FROM context_scope scope
        JOIN context_entity child ON child.parent_entity_id = scope.entity_id
        WHERE scope.family IN ('places', 'events') AND child.status = 'active'
      ), context_memberships AS MATERIALIZED (
        SELECT scope.tag_key, association.asset_id
        FROM context_scope scope
        JOIN current_context_asset association
          ON association.entity_id = scope.entity_id
      ), label_memberships AS MATERIALIZED (
        SELECT selected.tag_key, membership.asset_id
        FROM selected_tags selected
        JOIN current_asset_label_membership membership
          ON membership.label_id = selected.entity_id
        JOIN asset_label label ON label.label_id = membership.label_id
          AND label.status = 'active'
        WHERE selected.family = 'labels'
      ), memberships AS MATERIALIZED (
        SELECT * FROM person_memberships
        UNION
        SELECT * FROM context_memberships
        UNION
        SELECT * FROM label_memberships
      ), matching_assets AS MATERIALIZED (
        SELECT membership.asset_id
        FROM memberships membership
        WHERE NOT EXISTS (
          SELECT 1 FROM hidden_assets hidden
          WHERE hidden.object_id = membership.asset_id
        )
        GROUP BY membership.asset_id
        HAVING count(DISTINCT membership.tag_key) = ${selected.length}
      ), displayable_assets AS MATERIALIZED (
        SELECT asset.asset_id, asset.capture_time
        FROM matching_assets match
        JOIN asset ON asset.asset_id = match.asset_id AND asset.state = 'active'
        WHERE asset.asset_id = ANY(${bridgedAssetIds})
      ), counted_assets AS (
        SELECT displayable.*, (count(*) OVER ())::int AS total_count
        FROM displayable_assets displayable
      )
      SELECT asset_id, capture_time, total_count
      FROM counted_assets
      WHERE (
        ${decodedCursor === null}
        OR (
          ${cursorCaptureTime !== null}
          AND (
            capture_time IS NULL
            OR capture_time < ${cursorCaptureTime}
            OR (capture_time = ${cursorCaptureTime} AND asset_id > ${cursorAssetId})
          )
        )
        OR (
          ${cursorCaptureTime === null}
          AND capture_time IS NULL
          AND asset_id > ${cursorAssetId}
        )
      )
      ORDER BY capture_time DESC NULLS LAST, asset_id
      LIMIT ${boundedPageSize + 1}
    `;
    const hasMore = rows.length > boundedPageSize;
    const pageRows = hasMore ? rows.slice(0, boundedPageSize) : rows;
    const last = pageRows.at(-1);
    return {
      items: pageRows.map((row) => ({
        captureTime: row.capture_time
          ? new Date(row.capture_time).toISOString()
          : null,
        sourceAssetId: bridge.get(row.asset_id)?.sourceAssetId || "",
      })),
      nextCursor:
        hasMore && last
          ? encodeCursor({
              assetId: last.asset_id,
              captureTime: last.capture_time
                ? new Date(last.capture_time).toISOString()
                : null,
              selectionKey,
            })
          : null,
      pageSize: boundedPageSize,
      schemaVersion,
      total: Number(pageRows[0]?.total_count || 0),
    };
  };

export const tagAssetSearchContract = Object.freeze({ schemaVersion });
