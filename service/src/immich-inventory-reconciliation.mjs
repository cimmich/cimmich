export const reconcileMobilityBindings = async (sql, runId) => {
  await sql`
    UPDATE asset_source_binding binding SET
      state = CASE projection.state
        WHEN 'active' THEN 'active'
        WHEN 'suspected_missing' THEN 'offline'
        WHEN 'missing' THEN 'missing'
        ELSE 'superseded'
      END,
      last_seen_at = projection.last_seen_at
    FROM immich_asset_projection projection, immich_inventory_run run
    WHERE run.run_id = ${runId}
      AND projection.source_id = run.source_id
      AND binding.source_kind = 'immich'
      AND binding.source_id = projection.source_id
      AND binding.external_asset_id = projection.immich_asset_id
      AND NOT EXISTS (
        SELECT 1
        FROM archive_missing_file_command retirement
        WHERE retirement.source_id = binding.source_id
          AND binding.external_asset_id = ANY(retirement.source_asset_ids)
      )
  `;
  await sql`
    INSERT INTO asset_source_binding_event (
      event_id, binding_id, asset_id, content_id, input_revision,
      event_kind, producer_receipt_id
    )
    SELECT
      'source_binding_event_' || substr(encode(digest(
        binding.binding_id || E'\x1f' || binding.asset_id || E'\x1f'
          || coalesce(binding.input_revision, '') || E'\x1f'
          || binding.state, 'sha256'
      ), 'hex'), 1, 40),
      binding.binding_id, binding.asset_id, binding.content_id,
      binding.input_revision,
      CASE binding.state
        WHEN 'offline' THEN 'offline'
        WHEN 'missing' THEN 'missing'
        WHEN 'superseded' THEN 'superseded'
        ELSE 'observed'
      END,
      'receipt_cimmich_hash_linked_archive_mobility_v1'
    FROM asset_source_binding binding
    JOIN immich_inventory_run run ON run.run_id = ${runId}
      AND run.source_id = binding.source_id
    WHERE binding.source_kind = 'immich'
    ON CONFLICT (binding_id, asset_id, input_revision, event_kind) DO NOTHING
  `;
  await sql`
    UPDATE asset SET state = CASE
      WHEN EXISTS (
        SELECT 1 FROM asset_source_binding binding
        WHERE binding.asset_id = asset.asset_id
          AND binding.state = 'active'
      ) THEN 'active'
      WHEN EXISTS (
        SELECT 1 FROM asset_source_binding binding
        WHERE binding.asset_id = asset.asset_id
          AND binding.state IN ('offline','missing')
      ) THEN 'missing'
      ELSE asset.state
    END
    WHERE asset.asset_id IN (
      SELECT binding.asset_id
      FROM asset_source_binding binding
      JOIN immich_inventory_run run ON run.run_id = ${runId}
        AND run.source_id = binding.source_id
      WHERE binding.source_kind = 'immich'
    )
      AND asset.state IN ('active','missing')
  `;
};
