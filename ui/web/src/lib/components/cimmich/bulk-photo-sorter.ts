import { AssetOrder, AssetTypeEnum, AssetVisibility, type AssetResponseDto, type MetadataSearchDto } from '@immich/sdk';
import { CIMMICH_BULK_PHOTO_SORTER_RECEIPT_KEY } from './cimmich-undo-receipt-context.svelte';
import {
  loadPersistedUndoReceipt,
  savePersistedUndoReceipt,
  type CimmichUndoReceiptContext,
} from './persisted-undo-receipt';

export const BULK_PHOTO_SORTER_BATCH_SIZE = 100;
export const BULK_PHOTO_SORTER_PAGE_SIZE = 500;
export const BULK_PHOTO_SORTER_PREVIEW_SIZE = 24;
export const BULK_PHOTO_SORTER_RECEIPT_KEY = CIMMICH_BULK_PHOTO_SORTER_RECEIPT_KEY;

export type BulkPhotoSorterFilters = {
  albumId: string;
  favorite: 'any' | 'no' | 'yes';
  folder: string;
  mediaType: 'all' | 'image' | 'video';
  notInAlbum: boolean;
  personId: string;
  tagId: string;
  takenAfter: string;
  takenBefore: string;
  visibility: 'all' | 'archive' | 'locked' | 'timeline';
};

export type BulkPhotoSorterActionKind =
  | 'album-add'
  | 'archive'
  | 'event-attach'
  | 'favorite'
  | 'folders-to-albums'
  | 'place-attach'
  | 'label-add'
  | 'label-remove'
  | 'rotate-left'
  | 'rotate-right'
  | 'tag-add'
  | 'tag-remove'
  | 'unarchive'
  | 'unfavorite'
  | 'visibility-personal'
  | 'visibility-private'
  | 'visibility-standard';

export type BulkPhotoSorterUndoReceipt = {
  action: BulkPhotoSorterActionKind;
  assetCorrectionDecisionIds: string[];
  assetIds: string[];
  contextDecisionIds: string[];
  labelDecisions: Array<{ assetIds: string[]; decisionId: string }>;
  label: string;
  targetId: string;
  visibilityDecisionIds: string[];
};

export type BulkPhotoSorterOperationReceipt = {
  applied: number;
  completedAt: string;
  label: string;
  operationId: string;
  partial: boolean;
  selected: number;
  skipped: number;
  undo: BulkPhotoSorterUndoReceipt | null;
  version: 1;
};

type BulkPhotoSorterReceiptStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

const bulkPhotoSorterActionKinds = new Set<BulkPhotoSorterActionKind>([
  'album-add',
  'archive',
  'event-attach',
  'favorite',
  'folders-to-albums',
  'place-attach',
  'label-add',
  'label-remove',
  'rotate-left',
  'rotate-right',
  'tag-add',
  'tag-remove',
  'unarchive',
  'unfavorite',
  'visibility-personal',
  'visibility-private',
  'visibility-standard',
]);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const isLabelDecisions = (value: unknown): value is BulkPhotoSorterUndoReceipt['labelDecisions'] =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      item &&
      typeof item === 'object' &&
      typeof (item as Record<string, unknown>).decisionId === 'string' &&
      isStringArray((item as Record<string, unknown>).assetIds),
  );

const isUndoReceipt = (value: unknown): value is BulkPhotoSorterUndoReceipt => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    bulkPhotoSorterActionKinds.has(item.action as BulkPhotoSorterActionKind) &&
    isStringArray(item.assetIds) &&
    isStringArray(item.assetCorrectionDecisionIds ?? []) &&
    isStringArray(item.contextDecisionIds) &&
    isLabelDecisions(item.labelDecisions ?? []) &&
    typeof item.label === 'string' &&
    typeof item.targetId === 'string' &&
    isStringArray(item.visibilityDecisionIds)
  );
};

const isReceiptCount = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;

const isOperationReceipt = (value: unknown): value is BulkPhotoSorterOperationReceipt => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    item.version === 1 &&
    isReceiptCount(item.applied) &&
    typeof item.completedAt === 'string' &&
    Number.isFinite(Date.parse(item.completedAt)) &&
    typeof item.label === 'string' &&
    typeof item.operationId === 'string' &&
    item.operationId.length > 0 &&
    typeof item.partial === 'boolean' &&
    isReceiptCount(item.selected) &&
    isReceiptCount(item.skipped) &&
    (item.undo === null || isUndoReceipt(item.undo))
  );
};

export const loadBulkPhotoSorterReceipt = (
  storage: BulkPhotoSorterReceiptStorage,
  context: CimmichUndoReceiptContext | null,
  now?: number,
): BulkPhotoSorterOperationReceipt | null =>
  loadPersistedUndoReceipt(storage, BULK_PHOTO_SORTER_RECEIPT_KEY, context, isOperationReceipt, now);

export const saveBulkPhotoSorterReceipt = (
  storage: BulkPhotoSorterReceiptStorage,
  receipt: BulkPhotoSorterOperationReceipt | null,
  context: CimmichUndoReceiptContext | null,
  now?: number,
) => savePersistedUndoReceipt(storage, BULK_PHOTO_SORTER_RECEIPT_KEY, receipt, context, now);

export const bulkPhotoSorterSameSnapshot = (left: string[], right: string[]) => {
  if (left.length !== right.length) {
    return false;
  }
  const leftIds = new Set(left);
  if (leftIds.size !== left.length) {
    return false;
  }
  return right.every((id) => leftIds.has(id));
};

export const bulkPhotoSorterMappedIds = (
  assets: Pick<AssetResponseDto, 'id'>[],
  bindings: ReadonlyMap<string, string>,
) => [...new Set(assets.flatMap(({ id }) => (bindings.get(id) ? [bindings.get(id)!] : [])))];

export const createBulkPhotoSorterOperationId = () => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `organise.${globalThis.crypto.randomUUID()}`;
  }
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index++) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return `organise.${Date.now().toString(36)}.${[...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
};

export const emptyBulkPhotoSorterFilters = (): BulkPhotoSorterFilters => ({
  albumId: '',
  favorite: 'any',
  folder: '',
  mediaType: 'all',
  notInAlbum: false,
  personId: '',
  tagId: '',
  takenAfter: '',
  takenBefore: '',
  visibility: 'all',
});

const dateBoundary = (value: string, endOfDay = false) =>
  value ? `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}` : undefined;

export const buildBulkPhotoSorterSearch = (
  filters: BulkPhotoSorterFilters,
  page = 1,
  size = BULK_PHOTO_SORTER_PAGE_SIZE,
): MetadataSearchDto => ({
  ...(filters.albumId ? { albumIds: [filters.albumId] } : {}),
  ...(filters.favorite === 'yes' ? { isFavorite: true } : filters.favorite === 'no' ? { isFavorite: false } : {}),
  ...(filters.folder.trim() ? { originalPath: filters.folder.trim() } : {}),
  ...(filters.mediaType === 'image'
    ? { type: AssetTypeEnum.Image }
    : filters.mediaType === 'video'
      ? { type: AssetTypeEnum.Video }
      : {}),
  ...(filters.notInAlbum ? { isNotInAlbum: true } : {}),
  ...(filters.tagId ? { tagIds: [filters.tagId] } : {}),
  ...(filters.takenAfter ? { takenAfter: dateBoundary(filters.takenAfter) } : {}),
  ...(filters.takenBefore ? { takenBefore: dateBoundary(filters.takenBefore, true) } : {}),
  ...(filters.visibility === 'archive'
    ? { visibility: AssetVisibility.Archive }
    : filters.visibility === 'locked'
      ? { visibility: AssetVisibility.Locked }
      : filters.visibility === 'timeline'
        ? { visibility: AssetVisibility.Timeline }
        : {}),
  order: AssetOrder.Desc,
  page,
  size,
});

export const bulkPhotoSorterFilterFingerprint = (filters: BulkPhotoSorterFilters) =>
  JSON.stringify({
    ...filters,
    folder: filters.folder.trim(),
  });

export const chunkBulkPhotoSorterItems = <T>(items: T[], size = BULK_PHOTO_SORTER_BATCH_SIZE): T[][] => {
  const chunks: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    chunks.push(items.slice(offset, offset + size));
  }
  return chunks;
};

export const bulkPhotoSorterChangedAssets = (
  assets: AssetResponseDto[],
  action: BulkPhotoSorterActionKind,
  targetId = '',
) => {
  switch (action) {
    case 'favorite': {
      return assets.filter((asset) => !asset.isFavorite);
    }
    case 'unfavorite': {
      return assets.filter((asset) => asset.isFavorite);
    }
    case 'archive': {
      return assets.filter(
        (asset) => asset.visibility !== AssetVisibility.Archive && asset.visibility !== AssetVisibility.Locked,
      );
    }
    case 'unarchive': {
      return assets.filter((asset) => asset.visibility === AssetVisibility.Archive);
    }
    case 'tag-add': {
      return assets.filter((asset) => !asset.tags?.some((tag) => tag.id === targetId));
    }
    case 'tag-remove': {
      return assets.filter((asset) => asset.tags?.some((tag) => tag.id === targetId));
    }
    default: {
      return assets;
    }
  }
};

export const bulkPhotoSorterActionNeedsTarget = (action: BulkPhotoSorterActionKind) =>
  ['album-add', 'event-attach', 'place-attach', 'label-add', 'label-remove', 'tag-add', 'tag-remove'].includes(action);

export const bulkPhotoSorterActionLabel = (action: BulkPhotoSorterActionKind) =>
  ({
    'album-add': 'Add to album',
    archive: 'Archive',
    'event-attach': 'Attach to Event',
    favorite: 'Favourite',
    'folders-to-albums': 'Create albums from folders',
    'label-add': 'Add Cimmich label',
    'label-remove': 'Remove Cimmich label',
    'place-attach': 'Attach to Place',
    'rotate-left': 'Rotate left',
    'rotate-right': 'Rotate right',
    'tag-add': 'Add tag',
    'tag-remove': 'Remove tag',
    unarchive: 'Unarchive',
    unfavorite: 'Remove favourite',
    'visibility-personal': 'Set Cimmich visibility to Personal',
    'visibility-private': 'Set Cimmich visibility to Private',
    'visibility-standard': 'Set Cimmich visibility to Standard',
  })[action];
