import type { CimmichPersonAsset } from '$lib/services/cimmich.service';
import { cimmichSquareObservationStyle } from '$lib/utils/cimmich-crop';

export type PersonPhotoRelationFilter = 'all' | 'presence' | 'visible';
export type PersonPhotoSort = 'filename' | 'newest' | 'oldest';
export type PersonPhotoGroup = 'day' | 'event' | 'month' | 'none' | 'object' | 'place' | 'week' | 'year';
export type PersonPhotoSize = 'large' | 'medium' | 'small';
export type PersonPhotoView = 'face' | 'photo';
export type PersonPhotoDateStatus = 'known' | 'needs-review' | 'unknown';

export const personPhotoGroupOptions: Array<{ label: string; value: PersonPhotoGroup }> = [
  { label: 'No grouping', value: 'none' },
  { label: 'Year', value: 'year' },
  { label: 'Month', value: 'month' },
  { label: 'Week', value: 'week' },
  { label: 'Day', value: 'day' },
  { label: 'Place', value: 'place' },
  { label: 'Event', value: 'event' },
  { label: 'Thing', value: 'object' },
];

export type PersonPhotoGroupResult = {
  id: string;
  items: CimmichPersonAsset[];
  kindLabel: string | null;
  label: string | null;
};

const dateGroupLabel = (timestamp: number, group: Extract<PersonPhotoGroup, 'day' | 'month' | 'week' | 'year'>) => {
  const date = new Date(timestamp);
  if (group === 'year') {
    return String(date.getFullYear());
  }
  if (group === 'month') {
    return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(date);
  }
  if (group === 'day') {
    return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
  }

  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const startLabel = new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: start.getFullYear() === end.getFullYear() ? undefined : 'numeric',
  }).format(start);
  const endLabel = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(end);
  return `${startLabel}–${endLabel}`;
};

const dateGroupId = (timestamp: number, group: Extract<PersonPhotoGroup, 'day' | 'month' | 'week' | 'year'>) => {
  const date = new Date(timestamp);
  if (group === 'year') {
    return String(date.getFullYear());
  }
  if (group === 'month') {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
  if (group === 'day') {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
};

const rawCaptureTimestamp = ({ capture_time }: CimmichPersonAsset) => {
  if (!capture_time) {
    return null;
  }
  const timestamp = new Date(capture_time).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
};

export const personPhotoDateStatus = (asset: CimmichPersonAsset, now = Date.now()): PersonPhotoDateStatus => {
  const timestamp = rawCaptureTimestamp(asset);
  if (timestamp === null) {
    return 'unknown';
  }
  return timestamp > now ? 'needs-review' : 'known';
};

const trustedCaptureTimestamp = (asset: CimmichPersonAsset, now: number) =>
  personPhotoDateStatus(asset, now) === 'known' ? rawCaptureTimestamp(asset) : null;

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
  now = Date.now(),
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

    const leftStatus = personPhotoDateStatus(left, now);
    const rightStatus = personPhotoDateStatus(right, now);
    const statusOrder: Record<PersonPhotoDateStatus, number> = { known: 0, 'needs-review': 1, unknown: 2 };
    if (leftStatus !== rightStatus) {
      return statusOrder[leftStatus] - statusOrder[rightStatus];
    }
    const leftTime = trustedCaptureTimestamp(left, now);
    const rightTime = trustedCaptureTimestamp(right, now);
    if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
      return sort === 'newest' ? rightTime - leftTime : leftTime - rightTime;
    }
    return stableAssetId(left).localeCompare(stableAssetId(right));
  });
};

export const groupPersonPhotos = (
  assets: CimmichPersonAsset[],
  group: PersonPhotoGroup,
  now = Date.now(),
): PersonPhotoGroupResult[] => {
  if (assets.length === 0) {
    return [];
  }
  if (group === 'none') {
    return [{ id: 'all', items: assets, kindLabel: null, label: null }];
  }

  if (group === 'year' || group === 'month' || group === 'week' || group === 'day') {
    const groups = new Map<string, PersonPhotoGroupResult>();
    for (const asset of assets) {
      const status = personPhotoDateStatus(asset, now);
      const timestamp = trustedCaptureTimestamp(asset, now);
      const label =
        status === 'needs-review'
          ? 'Date needs review'
          : timestamp === null
            ? 'Date unknown'
            : dateGroupLabel(timestamp, group);
      const id = timestamp === null || status === 'needs-review' ? label : dateGroupId(timestamp, group);
      const existing = groups.get(id);
      groups.set(id, { id: `${group}:${id}`, items: [...(existing?.items ?? []), asset], kindLabel: null, label });
    }
    return [...groups.values()];
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

export const personFaceCropStyle = (asset: CimmichPersonAsset) => {
  if (!asset.face_crop) {
    return '';
  }
  return cimmichSquareObservationStyle({
    boxH: asset.face_crop.box_h,
    boxW: asset.face_crop.box_w,
    boxX: asset.face_crop.box_x,
    boxY: asset.face_crop.box_y,
    height: asset.height,
    padding: 2.4,
    width: asset.width,
  });
};

export const personPhotoDateLabel = (asset: CimmichPersonAsset, now = Date.now()) => {
  if (personPhotoDateStatus(asset, now) === 'needs-review') {
    return 'Date needs review';
  }
  if (!asset.capture_time) {
    return '';
  }
  const date = new Date(asset.capture_time);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
};
