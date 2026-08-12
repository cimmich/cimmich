import { bridgeFields } from "./bridge-fields.mjs";

const displayError = (message, statusCode, code) =>
  Object.assign(new Error(message), { code, statusCode });

export const bridgeAssetBySourceId = (bridge, sourceAssetId) => {
  for (const [assetId, linked] of bridge) {
    if (linked.sourceAssetId === sourceAssetId) return { assetId, ...linked };
  }
};

export const createAssetDisplayResolver =
  ({ bridge, presentationRank, sql }) =>
  async (value) => {
    const requestedId = String(value || "").trim();
    if (!requestedId || requestedId.length > 240) {
      throw displayError(
        "A stable Cimmich or Immich asset ID is required",
        400,
        "ASSET_DISPLAY_ID_INVALID",
      );
    }
    const [projection] = await sql`
      SELECT projection.cimmich_asset_id AS asset_id,
        projection.immich_asset_id AS source_asset_id,
        projection.original_file_name AS filename,
        projection.state AS projection_state,
        asset.state AS asset_state
      FROM immich_asset_projection projection
      JOIN asset ON asset.asset_id = projection.cimmich_asset_id
      WHERE (projection.cimmich_asset_id = ${requestedId}
          OR projection.immich_asset_id = ${requestedId})
        AND cimmich_visibility_asset_rank(asset.asset_id) <= ${presentationRank()}
      ORDER BY CASE WHEN projection.immich_asset_id = ${requestedId} THEN 0 ELSE 1 END,
        CASE WHEN projection.state = 'active' AND asset.state = 'active'
          THEN 0 ELSE 1 END,
        projection.last_seen_at DESC,
        projection.source_id
      LIMIT 1
    `;
    const [newerEquivalent] = projection
      ? await sql`
        SELECT candidate_projection.cimmich_asset_id AS asset_id,
          candidate_projection.immich_asset_id AS source_asset_id,
          candidate_projection.original_file_name AS filename
        FROM immich_asset_projection requested_projection
        JOIN asset requested_asset
          ON requested_asset.asset_id = requested_projection.cimmich_asset_id
        JOIN asset candidate_asset
          ON candidate_asset.state = 'active'
          AND candidate_asset.asset_id <> requested_asset.asset_id
        JOIN immich_asset_projection candidate_projection
          ON candidate_projection.cimmich_asset_id = candidate_asset.asset_id
          AND candidate_projection.state = 'active'
          AND candidate_projection.last_seen_at
            > requested_projection.last_seen_at
        WHERE requested_projection.cimmich_asset_id = ${projection.asset_id}
          AND requested_projection.immich_asset_id = ${projection.source_asset_id}
          AND cimmich_visibility_asset_rank(candidate_asset.asset_id)
            <= ${presentationRank()}
          AND (
            (
              requested_asset.content_hash IS NOT NULL
              AND requested_asset.content_hash = candidate_asset.content_hash
            )
            OR (
              requested_projection.original_file_name IS NOT NULL
              AND candidate_projection.original_file_name IS NOT NULL
              AND lower(requested_projection.original_file_name)
                = lower(candidate_projection.original_file_name)
              AND requested_asset.capture_time = candidate_asset.capture_time
              AND requested_asset.width = candidate_asset.width
              AND requested_asset.height = candidate_asset.height
            )
          )
        ORDER BY candidate_projection.last_seen_at DESC,
          candidate_projection.source_id,
          candidate_projection.immich_asset_id
        LIMIT 1
      `
      : [];
    const displayProjection =
      newerEquivalent ||
      ((projection?.projection_state ?? "active") === "active" &&
      (projection?.asset_state ?? "active") === "active"
        ? projection
        : null);
    const legacy = projection
      ? null
      : bridgeAssetBySourceId(bridge, requestedId) ||
        (bridge.has(requestedId)
          ? { assetId: requestedId, ...bridge.get(requestedId) }
          : null);
    const assetId = displayProjection?.asset_id || legacy?.assetId;
    if (!assetId) {
      throw displayError(
        "Cimmich asset display mapping not found",
        404,
        "ASSET_DISPLAY_NOT_FOUND",
      );
    }
    if (!projection) {
      const [visible] = await sql`
        SELECT asset_id FROM asset
        WHERE asset_id = ${assetId} AND state = 'active'
          AND cimmich_visibility_asset_rank(asset_id) <= ${presentationRank()}
      `;
      if (!visible) {
        throw displayError(
          "Cimmich asset display mapping not found",
          404,
          "ASSET_DISPLAY_NOT_FOUND",
        );
      }
    }
    const fields = bridgeFields(bridge, assetId);
    return {
      assetId,
      filename: displayProjection?.filename || fields.filename,
      schemaVersion: "cimmich.asset-display.v1",
      sourceAssetId:
        displayProjection?.source_asset_id ||
        legacy?.sourceAssetId ||
        requestedId,
    };
  };
