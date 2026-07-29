BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_immich_base64_fingerprint_backfill_v1', 'system',
    'cimmich-immich-base64-fingerprint-backfill', 'v1', now(), now(),
    encode(digest(
      'cimmich.immich-base64-fingerprint-backfill.v1', 'sha256'
    ), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

-- Immich's API emits its binary SHA-1 checksum in canonical Base64. Runtime
-- inventory already normalizes this representation, but the original schema-84
-- backfill recognized only hexadecimal legacy values. Decode only strict,
-- round-tripping Base64 with an exact SHA-1 or SHA-256 byte length.
WITH decoded AS (
    SELECT asset_id, content_hash,
      decode(content_hash, 'base64') AS fingerprint_bytes
    FROM asset
    WHERE content_hash ~ '^[A-Za-z0-9+/]+={0,2}$'
      AND length(content_hash) % 4 = 0
), recognized AS (
    SELECT asset_id,
      CASE octet_length(fingerprint_bytes)
        WHEN 20 THEN 'sha1'
        WHEN 32 THEN 'sha256'
      END AS hash_algorithm,
      encode(fingerprint_bytes, 'hex') AS content_digest
    FROM decoded
    WHERE octet_length(fingerprint_bytes) IN (20, 32)
      AND encode(fingerprint_bytes, 'base64') = content_hash
), normalized AS (
    SELECT asset_id, hash_algorithm, content_digest,
      'media_content_' || substr(encode(digest(
        hash_algorithm || E'\x1f' || content_digest, 'sha256'
      ), 'hex'), 1, 40) AS content_id
    FROM recognized
)
INSERT INTO media_content (content_id)
SELECT DISTINCT content_id FROM normalized
ON CONFLICT (content_id) DO NOTHING;

WITH decoded AS (
    SELECT content_hash, decode(content_hash, 'base64') AS fingerprint_bytes
    FROM asset
    WHERE content_hash ~ '^[A-Za-z0-9+/]+={0,2}$'
      AND length(content_hash) % 4 = 0
), recognized AS (
    SELECT DISTINCT
      CASE octet_length(fingerprint_bytes)
        WHEN 20 THEN 'sha1'
        WHEN 32 THEN 'sha256'
      END AS hash_algorithm,
      encode(fingerprint_bytes, 'hex') AS content_digest
    FROM decoded
    WHERE octet_length(fingerprint_bytes) IN (20, 32)
      AND encode(fingerprint_bytes, 'base64') = content_hash
), normalized AS (
    SELECT hash_algorithm, content_digest,
      'media_content_' || substr(encode(digest(
        hash_algorithm || E'\x1f' || content_digest, 'sha256'
      ), 'hex'), 1, 40) AS content_id
    FROM recognized
)
INSERT INTO media_content_fingerprint (
    content_id, hash_algorithm, content_digest, verification,
    producer_receipt_id
)
SELECT content_id, hash_algorithm, content_digest, 'source_asserted',
  'receipt_cimmich_immich_base64_fingerprint_backfill_v1'
FROM normalized
ON CONFLICT (hash_algorithm, content_digest) DO NOTHING;

WITH decoded AS (
    SELECT asset_id, content_hash,
      decode(content_hash, 'base64') AS fingerprint_bytes
    FROM asset
    WHERE content_hash ~ '^[A-Za-z0-9+/]+={0,2}$'
      AND length(content_hash) % 4 = 0
), recognized AS (
    SELECT asset_id,
      CASE octet_length(fingerprint_bytes)
        WHEN 20 THEN 'sha1'
        WHEN 32 THEN 'sha256'
      END AS hash_algorithm,
      encode(fingerprint_bytes, 'hex') AS content_digest
    FROM decoded
    WHERE octet_length(fingerprint_bytes) IN (20, 32)
      AND encode(fingerprint_bytes, 'base64') = content_hash
), normalized AS (
    SELECT asset_id,
      'media_content_' || substr(encode(digest(
        hash_algorithm || E'\x1f' || content_digest, 'sha256'
      ), 'hex'), 1, 40) AS content_id
    FROM recognized
)
INSERT INTO asset_content_link (
    asset_id, content_id, producer_receipt_id
)
SELECT asset_id, content_id,
  'receipt_cimmich_immich_base64_fingerprint_backfill_v1'
FROM normalized
ON CONFLICT (asset_id, content_id) DO NOTHING;

UPDATE asset_source_binding binding
SET content_id = link.content_id
FROM asset_content_link link
WHERE link.asset_id = binding.asset_id
  AND link.state = 'active'
  AND binding.content_id IS DISTINCT FROM link.content_id;

COMMIT;
