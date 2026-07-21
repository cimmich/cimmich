import type { CimmichPersonAsset } from '$lib/services/cimmich.service';

export type PersonPhotoRelationFilter = 'all' | 'presence' | 'visible';
export type PersonPhotoSort = 'filename' | 'newest' | 'oldest';
export type PersonPhotoGroup = 'event' | 'none' | 'object' | 'place' | 'year';
export type PersonPhotoSize = 'large' | 'medium' | 'small';

export type PersonPhotoGroupResult = {
  id: string;
  items: CimmichPersonAsset[];
  kindLabel: string | null;
  label: string | null;
};

const captureTimestamp = ({ capture_time }: CimmichPersonAsset) => {
  if (!capture_time) {
    return null;
  }
  const timestamp = new Date(capture_time).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
};

const stableAssetId = (asset: CimmichPersonAsset) => asset.sourceAssetId || asset.asset_id;

export const photoMatchesRelation = (asset: CimmichPersonAsset, filter: PersonPhotoRelationFilter) => {
  if (filter === 'all') {
    return true;
  }
  if (filter === 'presence') {
    return asset.association_types.includes('presence');
  }
  return asset.association_types.some((type) => type === 'face' || type === 'head' || type === 'body');
};

export const preparePersonPhotos = (
  assets: CimmichPersonAsset[],
  filter: PersonPhotoRelationFilter,
  sort: PersonPhotoSort,
) => {
  const deduplicated = [...new Map(assets.map((asset) => [stableAssetId(asset), asset])).values()].filter((asset) =>
    photoMatchesRelation(asset, filter),
  );

  return deduplicated.sort((left, right) => {
    if (sort === 'filename') {
      return (
        left.filename.localeCompare(right.filename, undefined, { numeric: true, sensitivity: 'base' }) ||
        stableAssetId(left).localeCompare(stableAssetId(right))
      );
    }

    const leftTime = captureTimestamp(left);
    const rightTime = captureTimestamp(right);
    if (leftTime === null && rightTime !== null) {
      return 1;
    }
    if (leftTime !== null && rightTime === null) {
      return -1;
    }
    if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
      return sort === 'newest' ? rightTime - leftTime : leftTime - rightTime;
    }
    return stableAssetId(left).localeCompare(stableAssetId(right));
  });
};

export const groupPersonPhotos = (assets: CimmichPersonAsset[], group: PersonPhotoGroup): PersonPhotoGroupResult[] => {
  if (assets.length === 0) {
    return [];
  }
  if (group === 'none') {
    return [{ id: 'all', items: assets, kindLabel: null, label: null }];
  }

  if (group === 'year') {
    const groups = new Map<string, CimmichPersonAsset[]>();
    for (const asset of assets) {
      const timestamp = captureTimestamp(asset);
      const label = timestamp === null ? 'Date unknown' : String(new Date(timestamp).getFullYear());
      groups.set(label, [...(groups.get(label) ?? []), asset]);
    }
    return [...groups].map(([label, items]) => ({ id: `year:${label}`, items, kindLabel: null, label }));
  }

  const contextGroups = new Map<string, PersonPhotoGroupResult>();
  const ungrouped: CimmichPersonAsset[] = [];
  for (const asset of assets) {
    const contexts = asset.contexts.filter(({ entityKind }) => entityKind === group);
    if (contexts.length === 0) {
      ungrouped.push(asset);
      continue;
    }
    for (const context of contexts) {
      const existing = contextGroups.get(context.entityId);
      contextGroups.set(context.entityId, {
        id: `${group}:${context.entityId}`,
        items: [...(existing?.items ?? []), asset],
        kindLabel:
          context.entityKind === 'event'
            ? context.typeKind.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase())
            : null,
        label: context.displayName,
      });
    }
  }

  const grouped = [...contextGroups.values()].sort((left, right) =>
    (left.label ?? '').localeCompare(right.label ?? '', undefined, { numeric: true, sensitivity: 'base' }),
  );
  if (ungrouped.length > 0) {
    const noun = group === 'object' ? 'thing' : group;
    grouped.push({ id: `${group}:none`, items: ungrouped, kindLabel: null, label: `No ${noun}` });
  }
  return grouped;
};

export const personPhotoGridClass = (size: PersonPhotoSize) => {
  if (size === 'small') {
    return 'grid grid-cols-3 gap-1 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8';
  }
  if (size === 'large') {
    return 'grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3';
  }
  return 'grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5';
};

export const personPhotoDateLabel = ({ capture_time }: CimmichPersonAsset) => {
  if (!capture_time) {
    return '';
  }
  const date = new Date(capture_time);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
};
