import { projectInventoryLane } from "./immich-inventory-projection.mjs";

export const recordImmichCataloguePresencePage = async (
  sql,
  { normalized, runId, sourceId },
) =>
  sql.begin(async (transaction) => {
    const [priorPage] = await transaction`
      SELECT page_digest FROM immich_inventory_page
      WHERE run_id = ${runId} AND visibility = ${normalized.visibility}
        AND cursor = ${normalized.cursor}
    `;
    if (priorPage) {
      if (priorPage.page_digest !== normalized.pageDigest) {
        throw new Error("Immich inventory page replay changed contents");
      }
      const [lane] = await transaction`
        SELECT * FROM immich_inventory_lane
        WHERE run_id = ${runId} AND visibility = ${normalized.visibility}
      `;
      return {
        admittedAssetMappings: [],
        bridgeEntries: [],
        lane: projectInventoryLane(lane),
        replayed: true,
      };
    }

    const [run] = await transaction`
      SELECT * FROM immich_inventory_run
      WHERE run_id = ${runId} AND source_id = ${sourceId}
      FOR UPDATE
    `;
    const [lane] = await transaction`
      SELECT * FROM immich_inventory_lane
      WHERE run_id = ${runId} AND visibility = ${normalized.visibility}
      FOR UPDATE
    `;
    if (
      !run ||
      run.state !== "processing" ||
      !lane ||
      lane.state === "completed"
    ) {
      throw new Error("Immich inventory run or lane is not processing");
    }
    if (run.catalogue_includes_deleted !== true) {
      throw new Error("Immich catalogue-presence run excludes deleted rows");
    }
    if (lane.cursor !== normalized.cursor) {
      throw new Error("Immich inventory page cursor is stale");
    }

    const sourceAssetIds = normalized.items.map((item) => item.immichAssetId);
    const trashedSourceAssetIds = normalized.items
      .filter((item) => item.isTrashed)
      .map((item) => item.immichAssetId);
    if (sourceAssetIds.length > 0) {
      const [crossedLane] = await transaction`
        SELECT immich_asset_id
        FROM immich_asset_projection
        WHERE source_id = ${sourceId}
          AND immich_asset_id = ANY(${sourceAssetIds}::text[])
          AND last_seen_run_id = ${runId}
          AND visibility <> ${normalized.visibility}
        LIMIT 1
      `;
      if (crossedLane) {
        throw new Error("Immich asset appeared in multiple visibility lanes");
      }
      await transaction`
        WITH observed AS (
          UPDATE immich_asset_projection projection SET
            visibility = ${normalized.visibility},
            is_trashed = projection.immich_asset_id = ANY(
              ${trashedSourceAssetIds}::text[]
            ),
            state = CASE
              WHEN projection.immich_asset_id = ANY(
                ${trashedSourceAssetIds}::text[]
              ) THEN 'missing'
              WHEN projection.state = 'unsupported' THEN 'unsupported'
              ELSE 'active'
            END,
            last_seen_run_id = ${runId}, last_seen_at = now()
          WHERE projection.source_id = ${sourceId}
            AND projection.immich_asset_id = ANY(${sourceAssetIds}::text[])
          RETURNING projection.source_id, projection.immich_asset_id,
            projection.cimmich_asset_id, projection.state
        ), refreshed_bindings AS (
          UPDATE asset_source_binding binding SET state = CASE
              WHEN observed.state = 'missing' THEN 'missing'
              ELSE 'active'
            END,
            last_seen_at = now()
          FROM observed
          WHERE observed.cimmich_asset_id IS NOT NULL
            AND binding.source_kind = 'immich'
            AND binding.source_id = observed.source_id
            AND binding.external_asset_id = observed.immich_asset_id
            AND NOT EXISTS (
              SELECT 1
              FROM archive_missing_file_command retirement
              WHERE retirement.source_id = binding.source_id
                AND binding.external_asset_id = ANY(
                  retirement.source_asset_ids
                )
            )
          RETURNING binding.asset_id, binding.state
        )
        UPDATE asset SET state = CASE
          WHEN EXISTS (
            SELECT 1 FROM asset_source_binding binding
            WHERE binding.asset_id = asset.asset_id
              AND binding.state = 'active'
          ) THEN 'active'
          ELSE 'missing'
        END
        WHERE asset_id IN (SELECT asset_id FROM refreshed_bindings)
          AND asset.state IN ('active','missing')
      `;
    }

    await transaction`
      INSERT INTO immich_inventory_page (
        run_id, visibility, cursor, next_cursor, page_digest, item_count
      ) VALUES (
        ${runId}, ${normalized.visibility}, ${normalized.cursor},
        ${normalized.nextCursor}, ${normalized.pageDigest},
        ${normalized.items.length}
      )
    `;
    const [updatedLane] = await transaction`
      UPDATE immich_inventory_lane SET
        state = ${normalized.nextCursor == null ? "completed" : "processing"},
        access_state = ${normalized.accessState},
        cursor = ${normalized.nextCursor || ""},
        page_count = page_count + 1,
        observed_item_count = observed_item_count + ${normalized.items.length},
        updated_at = now()
      WHERE run_id = ${runId} AND visibility = ${normalized.visibility}
      RETURNING *
    `;
    await transaction`
      UPDATE immich_inventory_run SET page_count = page_count + 1
      WHERE run_id = ${runId}
    `;
    return {
      admittedAssetMappings: [],
      bridgeEntries: [],
      lane: projectInventoryLane(updatedLane),
      replayed: false,
    };
  });
