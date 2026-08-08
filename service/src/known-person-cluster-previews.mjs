const previewLimit = 7;

export const readKnownPersonClusterPreviews = async (sql, clusterIds) => {
  if (clusterIds.length === 0) return new Map();
  const rows = await sql`
    WITH distinct_assets AS MATERIALIZED (
      SELECT DISTINCT ON (member.cluster_id, face.asset_id)
        member.cluster_id, member.face_id, member.membership_score,
        member.rank AS member_rank, face.asset_id,
        face.box_x::float8, face.box_y::float8,
        face.box_w::float8, face.box_h::float8,
        asset.width, asset.height,
        projection.immich_asset_id AS source_asset_id,
        CASE WHEN face.face_id = cluster.representative_face_id THEN 0 ELSE 1 END
          AS representative_rank
      FROM face_cluster_member member
      JOIN face_cluster cluster ON cluster.cluster_id = member.cluster_id
      JOIN face_observation face
        ON face.face_id = member.face_id AND face.state = 'valid'
      JOIN asset ON asset.asset_id = face.asset_id AND asset.state = 'active'
      LEFT JOIN LATERAL (
        SELECT current_projection.immich_asset_id
        FROM immich_asset_projection current_projection
        WHERE current_projection.cimmich_asset_id = asset.asset_id
          AND current_projection.state = 'active'
        ORDER BY current_projection.last_seen_at DESC,
          current_projection.source_id
        LIMIT 1
      ) projection ON true
      WHERE member.cluster_id = ANY(${clusterIds}::text[])
      ORDER BY member.cluster_id, face.asset_id,
        CASE WHEN face.face_id = cluster.representative_face_id THEN 0 ELSE 1 END,
        member.membership_score DESC NULLS LAST, member.rank, member.face_id
    ), ranked AS (
      SELECT distinct_assets.*,
        row_number() OVER (
          PARTITION BY cluster_id
          ORDER BY representative_rank, membership_score DESC NULLS LAST,
            member_rank, face_id
        )::int AS preview_rank
      FROM distinct_assets
      WHERE source_asset_id IS NOT NULL
    )
    SELECT * FROM ranked
    WHERE preview_rank <= ${previewLimit}
    ORDER BY cluster_id, preview_rank
  `;
  const grouped = new Map(clusterIds.map((clusterId) => [clusterId, []]));
  for (const row of rows) {
    grouped.get(row.cluster_id)?.push({
      box: { h: row.box_h, w: row.box_w, x: row.box_x, y: row.box_y },
      faceId: row.face_id,
      height: row.height,
      membershipScore:
        row.membership_score == null ? null : Number(row.membership_score),
      sourceAssetId: row.source_asset_id,
      width: row.width,
    });
  }
  return grouped;
};

export const knownPersonClusterPreviewLimit = previewLimit;
