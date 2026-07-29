BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_quarantine_unverified_immich_checksum_links_v1', 'system',
    'cimmich-quarantine-unverified-immich-checksum-links', 'v1', now(), now(),
    encode(digest(
      'cimmich.quarantine-unverified-immich-checksum-links.v1', 'sha256'
    ), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

-- Immich 3.0.3 may return a deprecated sha1-path value through the same API
-- checksum field used for whole-file SHA-1, without exposing the algorithm.
-- Remove only the links created by schema 85's Base64 backfill.
WITH false_links AS (
    SELECT asset_id, content_id
    FROM asset_content_link
    WHERE producer_receipt_id =
      'receipt_cimmich_immich_base64_fingerprint_backfill_v1'
)
UPDATE asset_source_binding binding
SET content_id = NULL
FROM false_links
WHERE binding.asset_id = false_links.asset_id
  AND binding.content_id = false_links.content_id;

DELETE FROM asset_content_link
WHERE producer_receipt_id =
  'receipt_cimmich_immich_base64_fingerprint_backfill_v1';

DELETE FROM media_content_fingerprint fingerprint
WHERE fingerprint.producer_receipt_id =
    'receipt_cimmich_immich_base64_fingerprint_backfill_v1'
  AND NOT EXISTS (
    SELECT 1 FROM asset_content_link link
    WHERE link.content_id = fingerprint.content_id
  );

DELETE FROM media_content content
WHERE NOT EXISTS (
    SELECT 1 FROM asset_content_link link
    WHERE link.content_id = content.content_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM media_content_fingerprint fingerprint
    WHERE fingerprint.content_id = content.content_id
  );

COMMIT;
