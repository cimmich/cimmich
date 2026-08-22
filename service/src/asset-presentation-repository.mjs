const typedError = (message, statusCode, code) =>
  Object.assign(new Error(message), { code, statusCode });

const normalizeSourceAssetIds = (sourceAssetIds, code) => {
  if (
    !Array.isArray(sourceAssetIds) ||
    sourceAssetIds.length < 1 ||
    sourceAssetIds.length > 500
  ) {
    throw typedError(
      "Photo presentation filtering requires between 1 and 500 source asset IDs",
      400,
      code,
    );
  }
  const normalized = sourceAssetIds.map((value) => String(value || "").trim());
  if (
    normalized.some(
      (value) =>
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          value,
        ),
    ) ||
    new Set(normalized).size !== normalized.length
  ) {
    throw typedError(
      "Photo presentation source asset IDs must be unique UUIDs",
      400,
      code,
    );
  }
  return normalized;
};

const response = (rows, schemaVersion) => ({
  assets: rows.map((row) => ({
    assetId: row.asset_id,
    sourceAssetId: row.source_asset_id,
  })),
  schemaVersion,
  sourceAssetIds: rows.map((row) => row.source_asset_id),
});

export const createAssetPresentationRepository = ({
  presentationRank,
  sql,
}) => ({
  async filterPresentableAssetSourceIds({ sourceAssetIds }) {
    const normalized = normalizeSourceAssetIds(
      sourceAssetIds,
      "PRESENTATION_ASSET_IDS_INVALID",
    );
    const rows = await sql`
      SELECT projection.immich_asset_id AS source_asset_id,
        projection.cimmich_asset_id AS asset_id
      FROM immich_asset_projection projection
      JOIN asset ON asset.asset_id = projection.cimmich_asset_id
        AND asset.state = 'active'
      WHERE projection.state = 'active'
        AND projection.immich_asset_id = ANY(${normalized})
        AND cimmich_visibility_asset_rank(asset.asset_id) <= ${presentationRank()}
      ORDER BY projection.immich_asset_id
    `;
    return response(rows, "cimmich.presentable-assets.v1");
  },
  async filterViewableAssetSourceIds({ sourceAssetIds }) {
    const normalized = normalizeSourceAssetIds(
      sourceAssetIds,
      "VIEWABLE_ASSET_IDS_INVALID",
    );
    const rows = await sql`
      SELECT projection.immich_asset_id AS source_asset_id,
        projection.cimmich_asset_id AS asset_id
      FROM immich_asset_projection projection
      JOIN asset ON asset.asset_id = projection.cimmich_asset_id
      WHERE projection.immich_asset_id = ANY(${normalized})
        AND (
          (projection.state = 'active' AND asset.state = 'active')
          OR (projection.state = 'missing' AND projection.is_trashed = true)
        )
        AND cimmich_visibility_asset_rank(asset.asset_id) <= ${presentationRank()}
      ORDER BY projection.immich_asset_id
    `;
    return response(rows, "cimmich.viewable-assets.v1");
  },
});
