import { AssetTypeEnum, AssetVisibility, type AssetResponseDto } from '@immich/sdk';
import { describe, expect, it } from 'vitest';
import {
  buildBulkPhotoSorterSearch,
  bulkPhotoSorterChangedAssets,
  bulkPhotoSorterFilterFingerprint,
  chunkBulkPhotoSorterItems,
  emptyBulkPhotoSorterFilters,
} from './bulk-photo-sorter';

const asset = (overrides: Partial<AssetResponseDto> = {}) =>
  ({
    id: crypto.randomUUID(),
    isArchived: false,
    isFavorite: false,
    tags: [],
    visibility: AssetVisibility.Timeline,
    ...overrides,
  }) as AssetResponseDto;

describe('bulk photo sorter', () => {
  it('builds a metadata query from the supported selectors', () => {
    const query = buildBulkPhotoSorterSearch({
      ...emptyBulkPhotoSorterFilters(),
      albumId: 'album_1',
      favorite: 'yes',
      folder: '  /archive/Trips/Croatia  ',
      mediaType: 'image',
      personId: 'person_1',
      tagId: 'tag_1',
      takenAfter: '2023-01-01',
      takenBefore: '2023-12-31',
      visibility: 'archive',
    });

    expect(query).toMatchObject({
      albumIds: ['album_1'],
      isFavorite: true,
      originalPath: '/archive/Trips/Croatia',
      page: 1,
      size: 500,
      tagIds: ['tag_1'],
      takenAfter: '2023-01-01T00:00:00.000',
      takenBefore: '2023-12-31T23:59:59.999',
      type: AssetTypeEnum.Image,
      visibility: AssetVisibility.Archive,
    });
    expect(query).not.toHaveProperty('personIds');
  });

  it('creates a stable fingerprint after trimming the folder', () => {
    expect(bulkPhotoSorterFilterFingerprint({ ...emptyBulkPhotoSorterFilters(), folder: ' /archive/family ' })).toBe(
      bulkPhotoSorterFilterFingerprint({ ...emptyBulkPhotoSorterFilters(), folder: '/archive/family' }),
    );
  });

  it('chunks large snapshots at the service-safe boundary', () => {
    expect(
      chunkBulkPhotoSorterItems(Array.from({ length: 205 }, (_, index) => index)).map((items) => items.length),
    ).toEqual([100, 100, 5]);
  });

  it('changes only assets that need the selected native action', () => {
    const tagged = asset({ id: 'tagged', tags: [{ id: 'tag_1' }] as AssetResponseDto['tags'] });
    const plain = asset({ id: 'plain' });
    const locked = asset({ id: 'locked', visibility: AssetVisibility.Locked });

    expect(bulkPhotoSorterChangedAssets([tagged, plain], 'tag-add', 'tag_1').map(({ id }) => id)).toEqual(['plain']);
    expect(bulkPhotoSorterChangedAssets([tagged, plain], 'tag-remove', 'tag_1').map(({ id }) => id)).toEqual([
      'tagged',
    ]);
    expect(bulkPhotoSorterChangedAssets([plain, locked], 'archive').map(({ id }) => id)).toEqual(['plain']);
  });
});
