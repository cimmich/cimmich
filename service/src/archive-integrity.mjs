export const archiveIntegritySchemaVersion = "cimmich.archive-integrity.v1";

const cleanInteger = (value, fallback, maximum) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0
    ? Math.min(parsed, maximum)
    : fallback;
};

const count = (value) => Number(value || 0);

const captureTime = (value) => {
  if (!value) return null;
  if (typeof value.toISOString === "function") return value.toISOString();
  return String(value);
};

const visibleCopiesSql = (sql, visibleRank) => sql`
  SELECT binding.content_id, binding.asset_id, content.byte_length,
    fingerprint.content_digest,
    projection.immich_asset_id AS source_asset_id,
    projection.original_file_name AS filename,
    projection.asset_type, projection.original_mime_type,
    projection.capture_time, projection.width, projection.height,
    projection.visibility, projection.is_archived, projection.is_favorite
  FROM asset_source_binding binding
  JOIN asset ON asset.asset_id = binding.asset_id AND asset.state = 'active'
  JOIN media_content content
    ON content.content_id = binding.content_id AND content.state = 'active'
  JOIN media_content_fingerprint fingerprint
    ON fingerprint.content_id = content.content_id
    AND fingerprint.hash_algorithm = 'sha256'
    AND fingerprint.verification = 'byte_verified'
  JOIN immich_asset_projection projection
    ON binding.source_kind = 'immich'
    AND projection.source_id = binding.source_id
    AND projection.immich_asset_id = binding.external_asset_id
    AND projection.state = 'active'
  WHERE binding.state = 'active'
    AND cimmich_visibility_asset_rank(asset.asset_id) <= ${visibleRank}
`;

export const createArchiveIntegrityStore = (sql, { presentationRank }) => ({
  async exactDuplicates({ limit, offset } = {}) {
    const pageSize = Math.max(1, cleanInteger(limit, 24, 100));
    const pageOffset = cleanInteger(offset, 0, 1_000_000);
    const visibleRank = presentationRank();
    const visibleCopies = visibleCopiesSql(sql, visibleRank);
    const [summary = {}] = await sql`
      WITH visible_copies AS MATERIALIZED (${visibleCopies}),
      duplicate_groups AS (
        SELECT content_id, max(byte_length) AS byte_length,
          count(*)::int AS copy_count
        FROM visible_copies
        GROUP BY content_id
        HAVING count(*) > 1
      )
      SELECT count(*)::int AS duplicate_groups,
        coalesce(sum(copy_count), 0)::bigint AS copies_in_groups,
        coalesce(sum(copy_count - 1), 0)::bigint AS redundant_copies,
        coalesce(sum(coalesce(byte_length, 0) * (copy_count - 1)), 0)::bigint
          AS reclaimable_bytes
      FROM duplicate_groups
    `;
    const rows = await sql`
      WITH visible_copies AS MATERIALIZED (${visibleCopies}),
      duplicate_groups AS MATERIALIZED (
        SELECT content_id, max(byte_length) AS byte_length,
          min(content_digest) AS content_digest,
          min(asset_type) AS asset_type,
          count(*)::int AS copy_count,
          coalesce(max(byte_length), 0) * (count(*) - 1) AS reclaimable_bytes
        FROM visible_copies
        GROUP BY content_id
        HAVING count(*) > 1
      ), paged_groups AS (
        SELECT * FROM duplicate_groups
        ORDER BY reclaimable_bytes DESC, content_id
        LIMIT ${pageSize} OFFSET ${pageOffset}
      )
      SELECT group_row.content_id, group_row.byte_length,
        group_row.content_digest, group_row.asset_type,
        group_row.copy_count, group_row.reclaimable_bytes,
        copy.asset_id, copy.source_asset_id, copy.filename,
        copy.original_mime_type, copy.capture_time, copy.width, copy.height,
        copy.visibility, copy.is_archived, copy.is_favorite
      FROM paged_groups group_row
      JOIN visible_copies copy ON copy.content_id = group_row.content_id
      ORDER BY group_row.reclaimable_bytes DESC, group_row.content_id,
        copy.filename NULLS LAST, copy.source_asset_id
    `;
    const groups = [];
    let current = null;
    for (const row of rows) {
      if (!current || current.contentId !== row.content_id) {
        current = {
          assetType: row.asset_type,
          byteLength: count(row.byte_length),
          contentDigest: row.content_digest,
          contentId: row.content_id,
          copies: [],
          copyCount: count(row.copy_count),
          reclaimableBytes: count(row.reclaimable_bytes),
          redundantCopies: Math.max(0, count(row.copy_count) - 1),
        };
        groups.push(current);
      }
      current.copies.push({
        archived: row.is_archived === true,
        assetId: row.asset_id,
        captureTime: captureTime(row.capture_time),
        favorite: row.is_favorite === true,
        filename: row.filename || "Untitled media",
        height: row.height === null ? null : count(row.height),
        mimeType: row.original_mime_type || null,
        sourceAssetId: row.source_asset_id,
        visibility: row.visibility,
        width: row.width === null ? null : count(row.width),
      });
    }
    return {
      groups,
      limit: pageSize,
      nextOffset:
        pageOffset + groups.length < count(summary.duplicate_groups)
          ? pageOffset + groups.length
          : null,
      offset: pageOffset,
      schemaVersion: archiveIntegritySchemaVersion,
      summary: {
        copiesInGroups: count(summary.copies_in_groups),
        duplicateGroups: count(summary.duplicate_groups),
        reclaimableBytes: count(summary.reclaimable_bytes),
        redundantCopies: count(summary.redundant_copies),
      },
    };
  },
});
