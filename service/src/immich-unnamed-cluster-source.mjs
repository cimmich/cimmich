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
  const enforceDuration = () => {
    if (now() - startedAt >= durationLimitMs) {
      throw typedError(
        "IMMICH_PERSON_RESOLUTION_SOURCE_TIMEOUT",
        "Immich possible-person discovery exceeded its time bound",
        504,
      );
    }
  };
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
  const targetAssetIds = new Set();
  let scannedAssetCount = 0;
  for (const visibility of scope.visibilities) {
    let cursor = "";
    do {
      enforceDuration();
      const page = await companion.listAssets({
        cursor,
        includePeople: true,
        limit: 500,
        visibility,
      });
      scannedAssetCount += page.items.length;
      if (scannedAssetCount > scanAssetLimit) {
        throw typedError(
          "IMMICH_PERSON_RESOLUTION_SOURCE_TOO_LARGE",
          "Immich possible-person discovery exceeds the supported scan bound",
          413,
        );
      }
      for (const asset of page.items) {
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
          throw typedError(
            "IMMICH_PERSON_RESOLUTION_TARGET_TOO_LARGE",
            "Immich possible-person discovery exceeds the supported candidate bound",
            413,
          );
        }
        targetAssetIds.add(asset.immichAssetId);
        assets.push(asset);
      }
      cursor = page.nextCursor || "";
    } while (cursor);
  }

  const facesByAsset = new Map();
  for (const group of batches(assets, 8)) {
    enforceDuration();
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
  }
  return {
    assets,
    facesByAsset,
    scanSummary: {
      scannedAssetCount,
      scanAssetLimit,
      targetAssetCount: assets.length,
      targetAssetLimit,
      timeoutMs: durationLimitMs,
    },
  };
};
