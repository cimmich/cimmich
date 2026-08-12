import { AssetTypeEnum, AssetVisibility, type AssetResponseDto } from '@immich/sdk';
import { describe, expect, it } from 'vitest';
import {
  BULK_PHOTO_SORTER_RECEIPT_KEY,
  buildBulkPhotoSorterSearch,
  bulkPhotoSorterActionLabel,
  bulkPhotoSorterActionNeedsTarget,
  bulkPhotoSorterChangedAssets,
  bulkPhotoSorterFilterFingerprint,
  bulkPhotoSorterMappedIds,
  bulkPhotoSorterSameSnapshot,
  chunkBulkPhotoSorterItems,
  createBulkPhotoSorterOperationId,
  emptyBulkPhotoSorterFilters,
  loadBulkPhotoSorterReceipt,
  saveBulkPhotoSorterReceipt,
  type BulkPhotoSorterOperationReceipt,
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
  const context = { ownerId: 'owner-1', sessionId: 'session-1', viewingMode: 'standard' as const };
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

  it('maps alternate metadata selectors without leaking unused filters', () => {
    expect(
      buildBulkPhotoSorterSearch({
        ...emptyBulkPhotoSorterFilters(),
        favorite: 'no',
        mediaType: 'video',
        notInAlbum: true,
        visibility: 'locked',
      }),
    ).toMatchObject({
      isFavorite: false,
      isNotInAlbum: true,
      type: AssetTypeEnum.Video,
      visibility: AssetVisibility.Locked,
    });
    expect(buildBulkPhotoSorterSearch({ ...emptyBulkPhotoSorterFilters(), visibility: 'timeline' })).toHaveProperty(
      'visibility',
      AssetVisibility.Timeline,
    );
    expect(buildBulkPhotoSorterSearch({ ...emptyBulkPhotoSorterFilters(), favorite: 'any' })).not.toHaveProperty(
      'isFavorite',
    );
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

  it('requires the same unique IDs before applying a collected snapshot', () => {
    expect(bulkPhotoSorterSameSnapshot(['asset-a', 'asset-b'], ['asset-b', 'asset-a'])).toBe(true);
    expect(bulkPhotoSorterSameSnapshot(['asset-a', 'asset-b'], ['asset-a', 'asset-c'])).toBe(false);
    expect(bulkPhotoSorterSameSnapshot(['asset-a', 'asset-a'], ['asset-a', 'asset-a'])).toBe(false);
  });

  it('deduplicates multiple visible media records that resolve to one Cimmich object', () => {
    const bindings = new Map([
      ['source-a', 'asset-a'],
      ['source-b', 'asset-a'],
      ['source-c', 'asset-c'],
    ]);
    expect(bulkPhotoSorterMappedIds([{ id: 'source-a' }, { id: 'source-b' }, { id: 'source-c' }], bindings)).toEqual([
      'asset-a',
      'asset-c',
    ]);
  });

  it('creates a namespaced operation ID', () => {
    expect(createBulkPhotoSorterOperationId()).toMatch(/^organise\.[A-Za-z0-9.-]+$/);
  });

  it('persists and restores a validated undo receipt', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const receipt: BulkPhotoSorterOperationReceipt = {
      applied: 1,
      completedAt: '2026-08-01T00:00:00.000Z',
      label: 'Favourite',
      operationId: 'operation-1',
      partial: false,
      selected: 1,
      skipped: 0,
      undo: {
        action: 'favorite',
        assetIds: ['asset-1'],
        assetCorrectionDecisionIds: [],
        contextDecisionIds: [],
        labelDecisions: [],
        label: 'Favourite',
        targetId: '',
        visibilityDecisionIds: [],
      },
      version: 1,
    };

    saveBulkPhotoSorterReceipt(storage, receipt, context, 1000);
    expect(loadBulkPhotoSorterReceipt(storage, context, 1001)).toEqual(receipt);

    values.set(BULK_PHOTO_SORTER_RECEIPT_KEY, '{"version":1,"undo":"unsafe"}');
    expect(loadBulkPhotoSorterReceipt(storage, context)).toBeNull();
    expect(values.has(BULK_PHOTO_SORTER_RECEIPT_KEY)).toBe(false);
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
    const archived = asset({ id: 'archived', visibility: AssetVisibility.Archive });
    expect(bulkPhotoSorterChangedAssets([plain, archived], 'unarchive').map(({ id }) => id)).toEqual(['archived']);
    expect(bulkPhotoSorterChangedAssets([plain], 'favorite').map(({ id }) => id)).toEqual(['plain']);
    expect(bulkPhotoSorterChangedAssets([plain], 'unfavorite')).toEqual([]);
    expect(bulkPhotoSorterChangedAssets([plain], 'rotate-left')).toEqual([plain]);
  });

  it('names actions and identifies only actions that require a target', () => {
    expect(bulkPhotoSorterActionLabel('place-attach')).toBe('Attach to Place');
    expect(bulkPhotoSorterActionLabel('visibility-private')).toBe('Set Cimmich visibility to Private');
    expect(bulkPhotoSorterActionNeedsTarget('album-add')).toBe(true);
    expect(bulkPhotoSorterActionNeedsTarget('favorite')).toBe(false);
  });
});
