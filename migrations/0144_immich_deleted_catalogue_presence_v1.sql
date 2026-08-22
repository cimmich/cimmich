BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_immich_deleted_catalogue_presence_v1', 'system',
    'cimmich-immich-deleted-catalogue-presence', 'v1', now(), now(),
    encode(digest('cimmich.immich-deleted-catalogue-presence.v1', 'sha256'), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

ALTER TABLE immich_inventory_run
    ADD COLUMN catalogue_includes_deleted boolean NOT NULL DEFAULT false;

-- A run begun by an older service may already have paged an Immich search
-- that excluded soft-deleted catalogue rows. It cannot safely resume under
-- the database-presence contract, so close it without reconciling absence.
WITH incompatible AS MATERIALIZED (
    SELECT run_id, snapshot_id
    FROM immich_inventory_run
    WHERE state = 'processing'
    FOR UPDATE
), snapshots AS (
    UPDATE source_snapshot snapshot
    SET state = 'incomplete', completed_at = now(),
        declared_asset_count = NULL
    FROM incompatible
    WHERE snapshot.snapshot_id = incompatible.snapshot_id
      AND snapshot.state = 'open'
    RETURNING snapshot.snapshot_id
)
UPDATE immich_inventory_run run
SET state = 'failed', completed_at = now(),
    last_error_code = 'CATALOGUE_SCOPE_UPGRADED'
FROM incompatible
WHERE run.run_id = incompatible.run_id;

ALTER TABLE immich_inventory_run
    ALTER COLUMN catalogue_includes_deleted SET DEFAULT true;

COMMIT;
