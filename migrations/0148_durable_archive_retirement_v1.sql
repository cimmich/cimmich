BEGIN;

-- An explicit Archive Health removal is durable Cimmich management truth.
-- Inventory and exact-activity refreshes may continue updating the source
-- projection, but they must never reactivate the retired source binding.
WITH retired AS MATERIALIZED (
  SELECT command.source_id, source_asset_id
  FROM archive_missing_file_command command
  CROSS JOIN LATERAL unnest(command.source_asset_ids) AS source_asset_id
)
UPDATE asset_source_binding binding
SET state = 'superseded'
FROM retired
WHERE binding.source_kind = 'immich'
  AND binding.source_id = retired.source_id
  AND binding.external_asset_id = retired.source_asset_id
  AND binding.state <> 'superseded';

UPDATE asset SET state = 'tombstoned'
WHERE state IN ('active','missing')
  AND NOT EXISTS (
    SELECT 1
    FROM asset_source_binding remaining
    WHERE remaining.asset_id = asset.asset_id
      AND remaining.state IN ('active','offline','missing')
  )
  AND EXISTS (
    SELECT 1
    FROM asset_source_binding retired_binding
    JOIN archive_missing_file_command command
      ON command.source_id = retired_binding.source_id
      AND retired_binding.external_asset_id = ANY(command.source_asset_ids)
    WHERE retired_binding.asset_id = asset.asset_id
      AND retired_binding.source_kind = 'immich'
      AND retired_binding.state = 'superseded'
  );

INSERT INTO producer_receipt (
  producer_receipt_id, producer_kind, producer_name, producer_version,
  started_at, completed_at, result_digest, privacy_class
) VALUES (
  'receipt_cimmich_durable_archive_retirement_v1', 'system',
  'cimmich-durable-archive-retirement', 'v1', now(), now(),
  encode(digest('cimmich.durable-archive-retirement.v1', 'sha256'), 'hex'),
  'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
  completed_at = excluded.completed_at,
  result_digest = excluded.result_digest;

COMMIT;
