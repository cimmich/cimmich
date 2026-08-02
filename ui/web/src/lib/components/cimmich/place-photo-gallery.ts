import type { CimmichContextAsset, CimmichContextEntity, CimmichPlaceRollupAsset } from '$lib/services/cimmich.service';

export type PlacePhotoAsset = CimmichContextAsset | CimmichPlaceRollupAsset;
export type PlacePhotoSort = 'filename' | 'newest' | 'oldest';
export type PlacePhotoGroup = 'none' | 'subsection' | 'year';
export type PlacePhotoSize = 'large' | 'medium' | 'small';

export type PlacePhotoGroupResult = {
  id: string;
  items: PlacePhotoAsset[];
  label: string | null;
};

const captureTimestamp = (asset: PlacePhotoAsset) => {
  if (!asset.captureTime) {
    return null;
  }
  const timestamp = new Date(asset.captureTime).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
};

const stableAssetId = (asset: PlacePhotoAsset) => asset.sourceAssetId || asset.assetId;

export const preparePlacePhotos = (assets: PlacePhotoAsset[], sort: PlacePhotoSort, now = Date.now()) =>
  [...assets].sort((left, right) => {
    if (sort === 'filename') {
      return (
        left.filename.localeCompare(right.filename, undefined, { numeric: true, sensitivity: 'base' }) ||
        stableAssetId(left).localeCompare(stableAssetId(right))
      );
    }

    const leftTime = captureTimestamp(left);
    const rightTime = captureTimestamp(right);
    const leftIsTrusted = leftTime !== null && leftTime <= now;
    const rightIsTrusted = rightTime !== null && rightTime <= now;
    if (leftIsTrusted !== rightIsTrusted) {
      return leftIsTrusted ? -1 : 1;
    }
    if (leftIsTrusted && rightIsTrusted && leftTime !== rightTime) {
      return sort === 'newest' ? rightTime! - leftTime! : leftTime! - rightTime!;
    }
    return stableAssetId(left).localeCompare(stableAssetId(right));
  });

export const groupPlacePhotos = (
  assets: PlacePhotoAsset[],
  group: PlacePhotoGroup,
  children: Array<Pick<CimmichContextEntity, 'displayName' | 'entityId'>>,
  now = Date.now(),
): PlacePhotoGroupResult[] => {
  if (assets.length === 0) {
    return [];
  }
  if (group === 'none') {
    return [{ id: 'all', items: assets, label: null }];
  }

  if (group === 'year') {
    const groups = new Map<string, PlacePhotoAsset[]>();
    for (const asset of assets) {
      const timestamp = captureTimestamp(asset);
      const label =
        timestamp === null
          ? 'Date unknown'
          : timestamp > now
            ? 'Date needs review'
            : String(new Date(timestamp).getFullYear());
      groups.set(label, [...(groups.get(label) ?? []), asset]);
    }
    return [...groups].map(([label, items]) => ({ id: `year:${label}`, items, label }));
  }

  const childGroups = new Map(children.map((child) => [child.entityId, { child, items: [] as PlacePhotoAsset[] }]));
  const unassigned: PlacePhotoAsset[] = [];
  for (const asset of assets) {
    const branchEntityIds = 'branchEntityIds' in asset ? asset.branchEntityIds : [];
    let grouped = false;
    for (const entityId of branchEntityIds) {
      const childGroup = childGroups.get(entityId);
      if (childGroup) {
        childGroup.items.push(asset);
        grouped = true;
      }
    }
    if (!grouped) {
      unassigned.push(asset);
    }
  }

  return [
    ...(unassigned.length > 0 ? [{ id: 'subsection:unassigned', items: unassigned, label: 'Unassigned' }] : []),
    ...[...childGroups.values()]
      .filter(({ items }) => items.length > 0)
      .map(({ child, items }) => ({ id: `subsection:${child.entityId}`, items, label: child.displayName })),
  ];
};

export const placePhotoGridClass = (size: PlacePhotoSize) => {
  if (size === 'small') {
    return 'grid grid-cols-3 gap-1 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8';
  }
  if (size === 'large') {
    return 'grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3';
  }
  return 'grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5';
};
