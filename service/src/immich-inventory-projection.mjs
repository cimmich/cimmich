const VISIBILITIES = ["timeline", "archive", "hidden", "locked"];

export const projectInventoryRun = (row) => ({
  completedAt: row.completed_at || null,
  immichVersion: row.immich_version,
  observedAssetCount: Number(row.observed_asset_count),
  pageCount: Number(row.page_count),
  runId: row.run_id,
  snapshotId: row.snapshot_id,
  sourceId: row.source_id,
  selectedVisibilities: row.selected_visibilities || [...VISIBILITIES],
  startedAt: row.started_at,
  state: row.state,
});

export const projectInventoryLane = (row) => ({
  cursor: row.cursor,
  observedItemCount: Number(row.observed_item_count),
  pageCount: Number(row.page_count),
  state: row.state,
  visibility: row.visibility,
});
