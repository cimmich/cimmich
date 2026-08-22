const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const mapConcurrent = async (items, concurrency, operation) => {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await operation(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
};

export const createImmichAssetActivity = ({
  cacheTtlMs = 60_000,
  companion,
  concurrency = 16,
  sourceId,
  sql,
}) => {
  const cache = new Map();

  const persist = async (observations) => {
    const active = observations
      .filter((item) => item.state === "active")
      .map((item) => item.sourceAssetId);
    const trashed = observations
      .filter((item) => item.state === "trashed")
      .map((item) => item.sourceAssetId);
    const missing = observations
      .filter((item) => item.state === "missing")
      .map((item) => item.sourceAssetId);
    const authoritative = [...active, ...trashed, ...missing];
    if (authoritative.length === 0) return;

    await sql.begin(async (transaction) => {
      await transaction`
        UPDATE immich_asset_projection projection SET
          is_trashed = CASE
            WHEN projection.immich_asset_id = ANY(${trashed}::text[]) THEN true
            ELSE false
          END,
          state = CASE
            WHEN projection.immich_asset_id = ANY(${active}::text[])
              THEN CASE WHEN projection.state = 'unsupported'
                THEN 'unsupported' ELSE 'active' END
            ELSE 'missing'
          END
        WHERE projection.source_id = ${sourceId}
          AND projection.immich_asset_id = ANY(${authoritative}::text[])
      `;
      await transaction`
        UPDATE asset_source_binding binding SET
          state = CASE
            WHEN binding.external_asset_id = ANY(${active}::text[])
              THEN 'active'
            ELSE 'missing'
          END,
          last_seen_at = CASE
            WHEN binding.external_asset_id = ANY(${[...active, ...trashed]}::text[])
              THEN now()
            ELSE binding.last_seen_at
          END
        WHERE binding.source_kind = 'immich'
          AND binding.source_id = ${sourceId}
          AND binding.external_asset_id = ANY(${authoritative}::text[])
          AND NOT EXISTS (
            SELECT 1
            FROM archive_missing_file_command retirement
            WHERE retirement.source_id = binding.source_id
              AND binding.external_asset_id = ANY(
                retirement.source_asset_ids
              )
          )
      `;
      await transaction`
        UPDATE asset SET state = CASE
          WHEN EXISTS (
            SELECT 1 FROM asset_source_binding binding
            WHERE binding.asset_id = asset.asset_id
              AND binding.state = 'active'
          ) THEN 'active'
          ELSE 'missing'
        END
        WHERE asset.asset_id IN (
          SELECT projection.cimmich_asset_id
          FROM immich_asset_projection projection
          WHERE projection.source_id = ${sourceId}
            AND projection.immich_asset_id = ANY(${authoritative}::text[])
            AND projection.cimmich_asset_id IS NOT NULL
        )
          AND asset.state IN ('active','missing')
      `;
    });
  };

  return {
    async decorate(items) {
      if (!companion?.getAsset) {
        return items.map((item) => ({ ...item, sourceState: "active" }));
      }
      const sourceIds = items.map((item) => item.sourceAssetId).filter(Boolean);
      const assetIds = items.map((item) => item.asset_id).filter(Boolean);
      const rows =
        sourceIds.length > 0 || assetIds.length > 0
          ? await sql`
              SELECT cimmich_asset_id, immich_asset_id, is_trashed,
                original_file_name, state
              FROM immich_asset_projection
              WHERE source_id = ${sourceId}
                AND (
                  immich_asset_id = ANY(${sourceIds}::text[])
                  OR cimmich_asset_id = ANY(${assetIds}::text[])
                )
              ORDER BY cimmich_asset_id,
                (state = 'active') DESC, is_trashed DESC, last_seen_at DESC
            `
          : [];
      const fallback = new Map();
      for (const row of rows) {
        if (row.cimmich_asset_id && !fallback.has(row.cimmich_asset_id)) {
          fallback.set(row.cimmich_asset_id, row);
        }
      }
      const materialized = items.map((item) => {
        const projection = fallback.get(item.asset_id);
        return {
          ...item,
          filename: item.filename || projection?.original_file_name || "",
          sourceAssetId:
            item.sourceAssetId || projection?.immich_asset_id || "",
        };
      });
      const live = await this.inspect(
        materialized.map((item) => item.sourceAssetId).filter(Boolean),
      );
      const stored = new Map(
        rows.map((row) => [
          row.immich_asset_id,
          row.is_trashed
            ? "trashed"
            : ["suspected_missing", "missing"].includes(row.state)
              ? "missing"
              : "active",
        ]),
      );
      return materialized.map((item) => ({
        ...item,
        sourceState:
          live.get(item.sourceAssetId) ||
          stored.get(item.sourceAssetId) ||
          "active",
      }));
    },
    async inspect(sourceAssetIds) {
      const ids = [
        ...new Set(
          [sourceAssetIds]
            .flat()
            .map((value) => String(value || "").trim())
            .filter((value) => uuidPattern.test(value)),
        ),
      ].slice(0, 250);
      if (!companion?.getAsset || ids.length === 0) return new Map();

      const now = Date.now();
      const observations = await mapConcurrent(ids, concurrency, async (id) => {
        const cached = cache.get(id);
        if (cached && now - cached.checkedAt < cacheTtlMs) {
          return { sourceAssetId: id, state: cached.state, cached: true };
        }
        try {
          const projection = await companion.getAsset({ assetId: id });
          return {
            sourceAssetId: id,
            state: projection?.asset?.isTrashed ? "trashed" : "active",
            cached: false,
          };
        } catch (error) {
          if (error?.code === "IMMICH_ASSET_NOT_FOUND") {
            return { sourceAssetId: id, state: "missing", cached: false };
          }
          // Source folders, Immich availability, authentication and network
          // failures are never evidence that a database row was removed.
          return { sourceAssetId: id, state: null, cached: false };
        }
      });

      const authoritative = observations.filter((item) => item.state !== null);
      await persist(authoritative.filter((item) => !item.cached));
      for (const item of authoritative) {
        cache.set(item.sourceAssetId, { checkedAt: now, state: item.state });
      }
      return new Map(
        authoritative.map((item) => [item.sourceAssetId, item.state]),
      );
    },
  };
};

export const createRepositoryImmichAssetActivity = (options, sql) =>
  createImmichAssetActivity({
    companion: options.immichCompanion,
    sourceId: options.immichSourceId || "immich-primary",
    sql,
  });
