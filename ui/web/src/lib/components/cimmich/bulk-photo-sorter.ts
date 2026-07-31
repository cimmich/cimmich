import { AssetOrder, AssetTypeEnum, AssetVisibility, type AssetResponseDto, type MetadataSearchDto } from '@immich/sdk';

export const BULK_PHOTO_SORTER_BATCH_SIZE = 100;
export const BULK_PHOTO_SORTER_PAGE_SIZE = 500;
export const BULK_PHOTO_SORTER_PREVIEW_SIZE = 24;

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
  | 'place-attach'
  | 'tag-add'
  | 'tag-remove'
  | 'unarchive'
  | 'unfavorite'
  | 'visibility-personal'
  | 'visibility-private'
  | 'visibility-standard';

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
  ['album-add', 'event-attach', 'place-attach', 'tag-add', 'tag-remove'].includes(action);

export const bulkPhotoSorterActionLabel = (action: BulkPhotoSorterActionKind) =>
  ({
    'album-add': 'Add to album',
    archive: 'Archive',
    'event-attach': 'Attach to Event',
    favorite: 'Favourite',
    'place-attach': 'Attach to Place',
    'tag-add': 'Add tag',
    'tag-remove': 'Remove tag',
    unarchive: 'Unarchive',
    unfavorite: 'Remove favourite',
    'visibility-personal': 'Set Cimmich visibility to Personal',
    'visibility-private': 'Set Cimmich visibility to Private',
    'visibility-standard': 'Set Cimmich visibility to Standard',
  })[action];
