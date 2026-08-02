import { describe, expect, it } from 'vitest';
import type { CimmichPlaceRollupAsset } from '$lib/services/cimmich.service';
import { groupPlacePhotos, placePhotoGridClass, preparePlacePhotos } from './place-photo-gallery';

const asset = (
  assetId: string,
  filename: string,
  captureTime: string | null,
  branchEntityIds: string[] = [],
): CimmichPlaceRollupAsset => ({
  assetId,
  assignedEntityIds: [],
  associationId: `association-${assetId}`,
  associationKind: 'direct',
  branchEntityIds,
  captureTime,
  directlyAssigned: branchEntityIds.length === 0,
  filename,
  height: 100,
  linkedAt: '2026-08-03T00:00:00.000Z',
  mediaKind: 'image',
  mimeType: 'image/jpeg',
  sourceAssetId: `source-${assetId}`,
  width: 100,
});

const children = [
  { displayName: 'My Room', entityId: 'room' },
  { displayName: 'Office', entityId: 'office' },
];

describe('Place photo gallery presentation', () => {
  it('sorts by capture time or natural filename without mutating the source', () => {
    const photos = [
      asset('old', 'IMG2.jpg', '2023-01-01T00:00:00.000Z'),
      asset('new', 'IMG10.jpg', '2024-01-01T00:00:00.000Z'),
    ];

    expect(preparePlacePhotos(photos, 'newest').map(({ assetId }) => assetId)).toEqual(['new', 'old']);
    expect(preparePlacePhotos(photos, 'oldest').map(({ assetId }) => assetId)).toEqual(['old', 'new']);
    expect(preparePlacePhotos(photos, 'filename').map(({ assetId }) => assetId)).toEqual(['old', 'new']);
    expect(photos.map(({ assetId }) => assetId)).toEqual(['old', 'new']);
  });

  it('groups the roll-up by immediate subsection and keeps direct photos as Unassigned', () => {
    const groups = groupPlacePhotos(
      [asset('direct', 'Direct.jpg', null), asset('office', 'Office.jpg', null, ['office'])],
      'subsection',
      children,
    );

    expect(groups.map(({ label }) => label)).toEqual(['Unassigned', 'Office']);
    expect(groups.map(({ items }) => items.map(({ assetId }) => assetId))).toEqual([['direct'], ['office']]);
  });

  it('groups known, future and missing capture dates honestly', () => {
    const groups = groupPlacePhotos(
      [
        asset('known', 'Known.jpg', '2024-01-01T00:00:00.000Z'),
        asset('future', 'Future.jpg', '2030-01-01T00:00:00.000Z'),
        asset('unknown', 'Unknown.jpg', null),
      ],
      'year',
      children,
      new Date('2026-08-03T00:00:00.000Z').getTime(),
    );

    expect(groups.map(({ label }) => label)).toEqual(['2024', 'Date needs review', 'Date unknown']);
  });

  it('matches the People gallery thumbnail density choices', () => {
    expect(placePhotoGridClass('small')).toContain('lg:grid-cols-8');
    expect(placePhotoGridClass('medium')).toContain('lg:grid-cols-5');
    expect(placePhotoGridClass('large')).toContain('lg:grid-cols-3');
  });
});
