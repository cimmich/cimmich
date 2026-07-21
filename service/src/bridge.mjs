import { readFile } from "node:fs/promises";

const bridgeMetadata = new WeakMap();
const filenameAuthorities = new Set(["inventory", "canonical_source"]);

const registerBridge = (bridge, canonicalAssetIds = new Set()) => {
  bridgeMetadata.set(bridge, {
    canonicalAssetIds: new Set(canonicalAssetIds),
  });
  return bridge;
};

const canonicalAssetIdsFor = (bridge) =>
  bridgeMetadata.get(bridge)?.canonicalAssetIds || new Set();

const hasCanonicalFilename = (bridge, assetId) =>
  canonicalAssetIdsFor(bridge).has(assetId);

export const emptyBridge = () => registerBridge(new Map());

export const parseDisplayBridge = (value) => {
  if (
    !value ||
    value.schemaVersion !== "cimmich.display-bridge.v1" ||
    !Array.isArray(value.assets)
  ) {
    throw new Error("Invalid Cimmich display bridge");
  }

  const filenameAuthority = value.filenameAuthority || "inventory";
  if (!filenameAuthorities.has(filenameAuthority)) {
    throw new Error("Invalid Cimmich display bridge filename authority");
  }

  const bridge = new Map(
    value.assets.map((asset) => [
      String(asset.assetId),
      {
        filename: String(asset.filename || ""),
        sourceAssetId: String(asset.sourceAssetId || ""),
      },
    ]),
  );
  return registerBridge(
    bridge,
    filenameAuthority === "canonical_source"
      ? new Set(bridge.keys())
      : new Set(),
  );
};

export const loadDisplayBridge = async (filePath) => {
  if (!filePath) {
    return emptyBridge();
  }
  return parseDisplayBridge(JSON.parse(await readFile(filePath, "utf8")));
};

export const resolveCimmichAssetIdFromDisplayBridge = (
  bridge,
  sourceAssetId,
) => {
  if (!(bridge instanceof Map)) {
    throw new Error("Invalid inventory display bridge resolver");
  }
  const sourceId = String(sourceAssetId || "").trim();
  if (!sourceId) {
    throw new Error("Inventory display bridge source asset is invalid");
  }
  const matches = [...bridge.entries()].filter(
    ([, fields]) => String(fields?.sourceAssetId || "").trim() === sourceId,
  );
  if (matches.length > 1) {
    throw new Error("Inventory display bridge source asset is ambiguous");
  }
  return matches.length === 1 ? String(matches[0][0]) : null;
};

const inventoryProjectionRows = (sql) => sql`
  SELECT cimmich_asset_id, immich_asset_id, original_file_name
  FROM immich_asset_projection
  WHERE cimmich_asset_id IS NOT NULL AND state = 'active'
  ORDER BY source_id, immich_asset_id
`;

// The inventory projection is the durable source of truth for Cimmich-to-Immich
// asset identity. A display-bridge file may still contribute a friendly
// filename for older/import-only installations, but it must never be required
// to resolve the current Immich UUID.
export const mergeInventoryProjectionBridge = async (
  sql,
  bridge = emptyBridge(),
) => {
  const merged = registerBridge(new Map(bridge), canonicalAssetIdsFor(bridge));
  const rows = await inventoryProjectionRows(sql);
  for (const row of rows) {
    const assetId = String(row.cimmich_asset_id);
    const existing = merged.get(assetId);
    const canonicalFilename = hasCanonicalFilename(merged, assetId);
    merged.set(assetId, {
      filename: String(
        canonicalFilename
          ? existing?.filename || row.original_file_name || ""
          : row.original_file_name || existing?.filename || "",
      ),
      sourceAssetId: String(row.immich_asset_id),
    });
  }
  return merged;
};

// Inventory pages commit before their display projection is published. Mutate
// the long-lived Map synchronously so every repository consumer observes the
// same post-commit identity without waiting for a process restart.
export const applyInventoryProjectionBridgeEntries = (bridge, entries) => {
  if (!(bridge instanceof Map) || !Array.isArray(entries)) {
    throw new Error("Invalid inventory display bridge update");
  }
  for (const entry of entries) {
    const assetId = String(entry?.assetId || "").trim();
    const sourceAssetId = String(entry?.sourceAssetId || "").trim();
    if (!assetId || !sourceAssetId) {
      throw new Error("Invalid inventory display bridge entry");
    }
    if (entry.active !== true) {
      bridge.delete(assetId);
      continue;
    }
    const filename = String(entry.filename || "").trim();
    const existing = bridge.get(assetId);
    bridge.set(assetId, {
      filename: hasCanonicalFilename(bridge, assetId)
        ? String(existing?.filename || filename)
        : filename || String(existing?.filename || ""),
      sourceAssetId,
    });
  }
  return bridge;
};

// A completed inventory run can mark previously projected assets missing.
// Reconcile the live Map to durable active rows while retaining only the
// presentation filenames observed in this process or supplied by the legacy
// display file. The replacement is synchronous after the database read, so a
// request never observes a half-rebuilt Map.
export const reconcileInventoryProjectionBridge = async (
  sql,
  bridge,
  legacyBridge = emptyBridge(),
) => {
  if (!(bridge instanceof Map) || !(legacyBridge instanceof Map)) {
    throw new Error("Invalid inventory display bridge reconciliation");
  }
  const rows = await inventoryProjectionRows(sql);
  const next = new Map(legacyBridge);
  const canonicalAssetIds = new Set();
  for (const row of rows) {
    const assetId = String(row.cimmich_asset_id);
    const canonicalFilename =
      hasCanonicalFilename(legacyBridge, assetId) ||
      hasCanonicalFilename(bridge, assetId);
    if (canonicalFilename) canonicalAssetIds.add(assetId);
    next.set(assetId, {
      filename: String(
        canonicalFilename
          ? legacyBridge.get(assetId)?.filename ||
              bridge.get(assetId)?.filename ||
              row.original_file_name ||
              ""
          : row.original_file_name ||
              bridge.get(assetId)?.filename ||
              legacyBridge.get(assetId)?.filename ||
              "",
      ),
      sourceAssetId: String(row.immich_asset_id),
    });
  }
  bridge.clear();
  for (const [assetId, fields] of next) bridge.set(assetId, fields);
  registerBridge(bridge, canonicalAssetIds);
  return bridge;
};

export const createInventoryProjectionBridgeRefresher = ({
  bridge,
  legacyBridge = emptyBridge(),
  sql,
}) => {
  if (!sql || !(bridge instanceof Map) || !(legacyBridge instanceof Map)) {
    throw new Error("Inventory display bridge refresher is not configured");
  }
  return async ({ entries = [], phase }) => {
    if (!new Set(["page_committed", "run_completed"]).has(phase)) {
      throw new Error("Inventory display bridge phase is invalid");
    }
    applyInventoryProjectionBridgeEntries(bridge, entries);
    if (phase === "run_completed") {
      await reconcileInventoryProjectionBridge(sql, bridge, legacyBridge);
    }
  };
};
