BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_stale_inventory_run_recovery_v1', 'system',
    'cimmich-stale-inventory-run-recovery', 'v1', now(), now(),
    encode(digest('cimmich.stale-inventory-run-recovery.v1', 'sha256'), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

CREATE OR REPLACE FUNCTION fail_stale_immich_inventory_runs(
    p_started_before timestamptz
) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
    v_failed_count integer;
BEGIN
    IF p_started_before IS NULL OR p_started_before > now() THEN
        RAISE EXCEPTION 'stale inventory cutoff must not be in the future'
            USING ERRCODE = '22023';
    END IF;

    WITH stale AS MATERIALIZED (
        SELECT run_id, snapshot_id
        FROM immich_inventory_run
        WHERE state = 'processing'
          AND started_at < p_started_before
        FOR UPDATE
    ), snapshots AS (
        UPDATE source_snapshot snapshot
        SET state = 'incomplete', completed_at = now()
        FROM stale
        WHERE snapshot.snapshot_id = stale.snapshot_id
          AND snapshot.state = 'open'
        RETURNING snapshot.snapshot_id
    ), runs AS (
        UPDATE immich_inventory_run run
        SET state = 'failed',
            completed_at = now(),
            last_error_code = 'INVENTORY_RUN_INTERRUPTED'
        FROM stale
        WHERE run.run_id = stale.run_id
        RETURNING run.run_id
    )
    SELECT count(*)::integer INTO v_failed_count FROM runs;
    RETURN v_failed_count;
END;
$$;

-- Portable exports must not preserve transient ownership forever. One day is
-- deliberately much longer than a normal bounded inventory run and cannot
-- affect a current checkpoint.
SELECT fail_stale_immich_inventory_runs(now() - interval '24 hours');

COMMIT;
