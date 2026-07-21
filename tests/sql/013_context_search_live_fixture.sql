BEGIN;

INSERT INTO source_snapshot (
  snapshot_id, input_schema_version, source_digest, locator_root_token,
  started_at, completed_at, declared_asset_count, observed_asset_count, state
) VALUES (
  'snapshot_context_live_fixture', 'synthetic.context.v1',
  'digest_context_live_fixture', 'root_context_live_fixture', now(), now(),
  2, 2, 'complete'
) ON CONFLICT (snapshot_id) DO NOTHING;

INSERT INTO producer_receipt (
  producer_receipt_id, producer_kind, producer_name, producer_version,
  source_snapshot_id, started_at, completed_at, privacy_class
) VALUES (
  'receipt_context_live_fixture', 'system', 'synthetic-context-live-fixture',
  'v1', 'snapshot_context_live_fixture', now(), now(), 'release-safe'
) ON CONFLICT (producer_receipt_id) DO NOTHING;

INSERT INTO asset (
  asset_id, content_hash, locator_token, media_kind, mime_type, width, height,
  capture_time, source_snapshot_id, state
) VALUES
  (
    'asset_context_live_fixture_a', 'synthetic:context-live-a',
    'locator_context_live_fixture_a', 'image', 'image/jpeg', 1200, 800,
    '2024-01-01T00:00:00Z', 'snapshot_context_live_fixture', 'active'
  ),
  (
    'asset_context_live_fixture_b', 'synthetic:context-live-b',
    'locator_context_live_fixture_b', 'image', 'image/jpeg', 1200, 800,
    '2024-02-01T00:00:00Z', 'snapshot_context_live_fixture', 'active'
  )
ON CONFLICT (asset_id) DO NOTHING;

COMMIT;
