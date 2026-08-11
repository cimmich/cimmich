import { verifiedCompanionStatus } from "./immich-companion-verification.mjs";

const typedError = (code, message, statusCode) =>
  Object.assign(new Error(message), { code, statusCode });

const batches = (items, size) => {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
};

export const unnamedScanAssetLimit = 250_000;
export const unnamedTargetAssetLimit = 10_000;
export const unnamedScanTimeoutMs = 120_000;

const positiveLimit = (value, fallback) => {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
};

export const scanUnnamed = async (
  companion,
  scope,
  {
    maxScannedAssets = unnamedScanAssetLimit,
    maxTargetAssets = unnamedTargetAssetLimit,
    now = Date.now,
    timeoutMs = unnamedScanTimeoutMs,
  } = {},
) => {
  const scanAssetLimit = positiveLimit(maxScannedAssets, unnamedScanAssetLimit);
  const targetAssetLimit = positiveLimit(
    maxTargetAssets,
    unnamedTargetAssetLimit,
  );
  const durationLimitMs = positiveLimit(timeoutMs, unnamedScanTimeoutMs);
  const startedAt = now();
  const durationExpired = () => now() - startedAt >= durationLimitMs;
  const status = await verifiedCompanionStatus(companion, {
    failClosed: true,
  });
  if (status.state !== "ready") {
    throw typedError(
      status.code || "IMMICH_COMPANION_NOT_READY",
      "Immich connection is not ready for possible-person review",
      status.state === "incompatible" ? 409 : 503,
    );
  }

  const assets = [];
  const facesByAsset = new Map();
  const targetAssetIds = new Set();
  let scannedAssetCount = 0;
  let truncationReason = null;
  scan: for (const visibility of scope.visibilities) {
    let cursor = "";
    do {
      if (durationExpired()) {
        truncationReason = "timeout";
        break scan;
      }
      const page = await companion.listAssets({
        cursor,
        includePeople: true,
        limit: 500,
        visibility,
      });
      const remainingScanCapacity = Math.max(
        0,
        scanAssetLimit - scannedAssetCount,
      );
      const pageItems = page.items.slice(0, remainingScanCapacity);
      scannedAssetCount += pageItems.length;
      const pageTargets = [];
      for (const asset of pageItems) {
        const hasUnnamedPerson = (
          Array.isArray(asset.people) ? asset.people : []
        ).some(
          (person) =>
            !person.name && (scope.includeHiddenPeople || !person.isHidden),
        );
        if (
          !scope.mediaKinds.includes(asset.assetType) ||
          !hasUnnamedPerson ||
          targetAssetIds.has(asset.immichAssetId)
        ) {
          continue;
        }
        if (targetAssetIds.size >= targetAssetLimit) {
          truncationReason = "target_limit";
          break;
        }
        targetAssetIds.add(asset.immichAssetId);
        pageTargets.push(asset);
      }
      for (const group of batches(pageTargets, 8)) {
        if (durationExpired()) {
          truncationReason = "timeout";
          break scan;
        }
        const pages = await Promise.all(
          group.map((asset) =>
            companion.listAssetFaces({ assetId: asset.immichAssetId }),
          ),
        );
        for (const page of pages) {
          facesByAsset.set(
            page.assetId,
            page.items.filter(
              (face) =>
                face.person &&
                !face.person.name &&
                (scope.includeHiddenPeople || !face.person.isHidden),
            ),
          );
        }
        assets.push(...group);
      }
      if (truncationReason) {
        break scan;
      }
      if (
        scannedAssetCount >= scanAssetLimit &&
        (page.items.length > pageItems.length || page.nextCursor)
      ) {
        truncationReason = "asset_limit";
        break scan;
      }
      cursor = page.nextCursor || "";
    } while (cursor);
  }
  return {
    assets,
    facesByAsset,
    scanSummary: {
      complete: truncationReason === null,
      scannedAssetCount,
      scanAssetLimit,
      targetAssetCount: assets.length,
      targetAssetLimit,
      timeoutMs: durationLimitMs,
      truncationReason,
    },
  };
};
