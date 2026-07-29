BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_media_content_producer_v1', 'system',
    'cimmich-media-content-producer', 'v1', now(), now(),
    encode(digest('cimmich.media-content-producer.v1', 'sha256'), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

-- Caveat on migration 0086 (checksummed, immutable): its cleanup deleted
-- every orphan media_content row — not only rows created by the schema-85
-- Base64 backfill it was reverting — because media_content never recorded
-- which producer created each row. That destructive DELETE cannot be
-- re-scoped retroactively. This migration adds the missing producer column
-- so every future cleanup MUST scope its deletes to its own producer's rows
-- instead of deleting whatever happens to be orphaned.
ALTER TABLE media_content
    ADD COLUMN producer_receipt_id text
        REFERENCES producer_receipt(producer_receipt_id);

-- Retroactive attribution: adopt the earliest producer recorded by the row's
-- fingerprints or asset links. Rows with neither stay NULL — exactly the
-- orphan shape 0086 deleted — and remain out of scope for producer-scoped
-- cleanups.
UPDATE media_content content
SET producer_receipt_id = attributed.producer_receipt_id
FROM (
    SELECT DISTINCT ON (content_id) content_id, producer_receipt_id
    FROM (
        SELECT content_id, producer_receipt_id, created_at
        FROM media_content_fingerprint
        UNION ALL
        SELECT content_id, producer_receipt_id, created_at
        FROM asset_content_link
    ) sources
    ORDER BY content_id, created_at, producer_receipt_id
) attributed
WHERE content.content_id = attributed.content_id
  AND content.producer_receipt_id IS NULL;

COMMENT ON COLUMN media_content.producer_receipt_id
IS 'Producer that created this content row. Backfilled retroactively by migration 0100 from the earliest fingerprint/link producer. Cleanup jobs must scope destructive deletes to their own producer (see the migration 0086 caveat).';

COMMIT;
