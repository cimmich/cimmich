import { AssetVisibility, type TimeBucketAssetResponseDto } from '@immich/sdk';
import { CimmichAssetPresentationManager, filterTimeBucketAssets } from './cimmich-asset-presentation-manager';

describe('CimmichAssetPresentationManager', () => {
  it('batches, caches, and invalidates presentation decisions by visibility version', async () => {
    const calls: string[][] = [];
    const manager = new CimmichAssetPresentationManager((sourceAssetIds) => {
      calls.push(sourceAssetIds);
      return Promise.resolve({ sourceAssetIds: sourceAssetIds.filter((_, index) => index % 2 === 0) });
    });
    const ids = Array.from({ length: 501 }, (_, index) => `asset-${index}`);

    const first = await manager.presentableIds(ids, 1);
    expect(calls.map((batch) => batch.length)).toEqual([500, 1]);
    expect(first.has('asset-0')).toBe(true);
    expect(first.has('asset-1')).toBe(false);

    await manager.presentableIds(ids, 1);
    expect(calls).toHaveLength(2);

    await manager.presentableIds(ids.slice(0, 2), 2);
    expect(calls).toHaveLength(3);
  });

  it('filters every parallel timeline field without changing scalar fields', () => {
    const bucket = {
      id: ['visible', 'hidden'],
      city: ['Sydney', 'Hidden'],
      country: ['Australia', 'Hidden'],
      duration: [null, null],
      visibility: [AssetVisibility.Timeline, AssetVisibility.Timeline],
      isFavorite: [false, true],
      isImage: [true, true],
      isTrashed: [false, false],
      livePhotoVideoId: [null, null],
      fileCreatedAt: ['2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'],
      localOffsetHours: [0, 0],
      createdAt: ['2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'],
      ownerId: ['owner', 'owner'],
      projectionType: [null, null],
      ratio: [1, 1],
      stack: [null, null],
      thumbhash: ['one', 'two'],
    } satisfies TimeBucketAssetResponseDto;

    expect(filterTimeBucketAssets(bucket, new Set(['visible']))).toMatchObject({
      city: ['Sydney'],
      id: ['visible'],
      isFavorite: [false],
      thumbhash: ['one'],
    });
  });
});
