BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_same_photo_derivative_guard_multi_projection_v1',
    'system', 'cimmich-same-photo-derivative-guard-multi-projection', 'v1',
    now(), now(),
    encode(
        digest(
            'cimmich.same-photo-derivative-guard-multi-projection.v1', 'sha256'
        ),
        'hex'
    ),
    'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

-- Migration 0099's guard joined immich_asset_projection assuming exactly one
-- active projection per content asset. Content-hash mobility (schema 84+)
-- makes several active projections legitimate - the same content seen by
-- more than one source - and the plain joins then multiply asset_pair, so
-- the scalar verdict subquery raises "more than one row" and every guarded
-- audit statement fails closed on those assets. This re-issue keeps the
-- conservative body byte-for-byte except the projection lookup: each side
-- selects one deterministic projection row (lowest source_id, then
-- immich_asset_id), so both sides of the filename comparison come from the
-- same source ordering and the verdict is again a scalar.
CREATE OR REPLACE FUNCTION cimmich_probable_same_photo_derivative(
  governed_pack_id text,
  left_asset_id text,
  right_asset_id text
) RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  WITH pack AS (
    SELECT model_family, model_version, config_digest
    FROM source_pack
    WHERE pack_id = governed_pack_id
  ), asset_pair AS (
    SELECT left_asset.content_hash AS left_content_hash,
      right_asset.content_hash AS right_content_hash,
      left_asset.capture_time AS left_capture_time,
      right_asset.capture_time AS right_capture_time,
      left_asset.width AS left_width, right_asset.width AS right_width,
      left_asset.height AS left_height, right_asset.height AS right_height,
      left_projection.original_file_name AS left_filename,
      right_projection.original_file_name AS right_filename
    FROM asset left_asset
    JOIN asset right_asset ON right_asset.asset_id = right_asset_id
    LEFT JOIN LATERAL (
      SELECT projection.original_file_name
      FROM immich_asset_projection projection
      WHERE projection.cimmich_asset_id = left_asset.asset_id
        AND projection.state = 'active'
      ORDER BY projection.source_id, projection.immich_asset_id
      LIMIT 1
    ) left_projection ON true
    LEFT JOIN LATERAL (
      SELECT projection.original_file_name
      FROM immich_asset_projection projection
      WHERE projection.cimmich_asset_id = right_asset.asset_id
        AND projection.state = 'active'
      ORDER BY projection.source_id, projection.immich_asset_id
      LIMIT 1
    ) right_projection ON true
    WHERE left_asset.asset_id = left_asset_id
      AND left_asset.state = 'active'
      AND right_asset.state = 'active'
  ), left_faces AS MATERIALIZED (
    SELECT face.face_id, face.box_x, face.box_y, face.box_w, face.box_h,
      embedding.embedding
    FROM pack
    JOIN face_observation face
      ON face.asset_id = left_asset_id AND face.state = 'valid'
    JOIN face_embedding embedding
      ON embedding.face_id = face.face_id
      AND embedding.state = 'active'
      AND embedding.model_family = pack.model_family
      AND embedding.model_version = pack.model_version
      AND embedding.config_digest = pack.config_digest
  ), right_faces AS MATERIALIZED (
    SELECT face.face_id, face.box_x, face.box_y, face.box_w, face.box_h,
      embedding.embedding
    FROM pack
    JOIN face_observation face
      ON face.asset_id = right_asset_id AND face.state = 'valid'
    JOIN face_embedding embedding
      ON embedding.face_id = face.face_id
      AND embedding.state = 'active'
      AND embedding.model_family = pack.model_family
      AND embedding.model_version = pack.model_version
      AND embedding.config_digest = pack.config_digest
  ), face_counts AS (
    SELECT (SELECT count(*)::int FROM left_faces) AS left_count,
      (SELECT count(*)::int FROM right_faces) AS right_count
  ), smaller AS (
    SELECT face.*
    FROM left_faces face, face_counts count
    WHERE count.left_count <= count.right_count
    UNION ALL
    SELECT face.*
    FROM right_faces face, face_counts count
    WHERE count.right_count < count.left_count
  ), larger AS (
    SELECT face.*
    FROM right_faces face, face_counts count
    WHERE count.left_count <= count.right_count
    UNION ALL
    SELECT face.*
    FROM left_faces face, face_counts count
    WHERE count.right_count < count.left_count
  ), ranked_matches AS (
    SELECT smaller.face_id AS smaller_face_id,
      larger.face_id AS larger_face_id,
      (1 - (smaller.embedding <=> larger.embedding))::float8 AS score,
      greatest(
        abs(smaller.box_x - larger.box_x),
        abs(smaller.box_y - larger.box_y),
        abs(smaller.box_w - larger.box_w),
        abs(smaller.box_h - larger.box_h)
      )::float8 AS geometry_delta,
      row_number() OVER (
        PARTITION BY smaller.face_id
        ORDER BY smaller.embedding <=> larger.embedding, larger.face_id
      ) AS match_rank
    FROM smaller
    CROSS JOIN larger
  ), matched_summary AS (
    SELECT count(*)::int AS matched_count,
      count(DISTINCT larger_face_id)::int AS distinct_larger_count,
      min(score) AS minimum_score,
      max(geometry_delta) AS maximum_geometry_delta
    FROM ranked_matches
    WHERE match_rank = 1
  )
  SELECT coalesce(
    (
      SELECT
        (
          pair.left_content_hash IS NOT NULL
          AND pair.left_content_hash = pair.right_content_hash
        )
        OR (
          pair.left_filename IS NOT NULL
          AND pair.right_filename IS NOT NULL
          AND lower(pair.left_filename) = lower(pair.right_filename)
          AND pair.left_capture_time = pair.right_capture_time
          AND pair.left_width = pair.right_width
          AND pair.left_height = pair.right_height
        )
        OR (
          least(count.left_count, count.right_count) >= 2
          AND least(count.left_count, count.right_count) * 2
            >= greatest(count.left_count, count.right_count)
          AND summary.matched_count
            = least(count.left_count, count.right_count)
          AND summary.distinct_larger_count = summary.matched_count
          AND summary.minimum_score >= 0.90
          AND summary.maximum_geometry_delta <= 0.04
        )
      FROM asset_pair pair
      CROSS JOIN face_counts count
      CROSS JOIN matched_summary summary
    ),
    false
  )
$$;

COMMENT ON FUNCTION cimmich_probable_same_photo_derivative(text, text, text)
IS 'Conservative audit-only independence guard for exact files, exact export metadata, or multi-face geometry-preserving derivatives in one governed embedding space. An empty or uninspectable pair is explicitly not a probable derivative (false, never NULL). Assets with several active Immich projections contribute one deterministic projection per side.';

COMMIT;
