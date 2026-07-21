BEGIN;

DELETE FROM context_entity
WHERE display_name LIKE 'Cimmich Live Disposable %';

DELETE FROM context_command
WHERE actor_id = 'synthetic-live-context';

DELETE FROM decision
WHERE actor_id = 'synthetic-live-context';

DELETE FROM asset
WHERE asset_id IN (
  'asset_context_live_fixture_a',
  'asset_context_live_fixture_b'
);

DELETE FROM producer_receipt
WHERE producer_receipt_id = 'receipt_context_live_fixture';

DELETE FROM source_snapshot
WHERE snapshot_id = 'snapshot_context_live_fixture';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM context_entity
    WHERE display_name LIKE 'Cimmich Live Disposable %'
    UNION ALL
    SELECT 1 FROM context_command WHERE actor_id = 'synthetic-live-context'
    UNION ALL
    SELECT 1 FROM decision WHERE actor_id = 'synthetic-live-context'
    UNION ALL
    SELECT 1 FROM asset WHERE asset_id LIKE 'asset_context_live_fixture_%'
  ) THEN
    RAISE EXCEPTION 'Disposable context/search proof did not clean to zero';
  END IF;
END;
$$;

COMMIT;
