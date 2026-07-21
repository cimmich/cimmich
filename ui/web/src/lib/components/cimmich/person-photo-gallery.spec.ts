import { describe, expect, it } from 'vitest';
import type { CimmichPersonAsset } from '$lib/services/cimmich.service';
import {
  groupPersonPhotos,
  personPhotoDateLabel,
  personPhotoGridClass,
  photoMatchesRelation,
  preparePersonPhotos,
} from './person-photo-gallery';

const photo = (
  id: string,
  association_types: CimmichPersonAsset['association_types'],
  capture_time: string | null,
  filename = `${id}.jpg`,
  contexts: CimmichPersonAsset['contexts'] = [],
): CimmichPersonAsset => ({
  asset_id: `asset-${id}`,
  asset_head_evidence: association_types.includes('head'),
  association_types,
  capture_time,
  contexts,
  filename,
  has_linked_body: association_types.includes('body'),
  height: 100,
  media_kind: 'image',
  mime_type: 'image/jpeg',
  presence_evidence: association_types.includes('presence'),
  sourceAssetId: id,
  width: 100,
});

describe('person photo gallery', () => {
  it('reduces evidence taxonomy to visible and presence browsing relationships', () => {
    expect(photoMatchesRelation(photo('face', ['face'], null), 'visible')).toBe(true);
    expect(photoMatchesRelation(photo('head', ['head'], null), 'visible')).toBe(true);
    expect(photoMatchesRelation(photo('body', ['body'], null), 'visible')).toBe(true);
    expect(photoMatchesRelation(photo('presence', ['presence'], null), 'visible')).toBe(false);
    expect(photoMatchesRelation(photo('presence', ['presence'], null), 'presence')).toBe(true);
  });

  it('deduplicates assets and sorts dated photos ahead of unknown dates', () => {
    const newer = photo('newer', ['face'], '2025-02-01T10:00:00.000Z');
    const older = photo('older', ['presence'], '2024-02-01T10:00:00.000Z');
    const unknown = photo('unknown', ['body'], null);

    expect(
      preparePersonPhotos([older, newer, newer, unknown], 'all', 'newest').map(({ sourceAssetId }) => sourceAssetId),
    ).toEqual(['newer', 'older', 'unknown']);
    expect(
      preparePersonPhotos([newer, older, unknown], 'all', 'oldest').map(({ sourceAssetId }) => sourceAssetId),
    ).toEqual(['older', 'newer', 'unknown']);
  });

  it('supports filename sorting, year grouping and gallery density', () => {
    const photos = preparePersonPhotos(
      [
        photo('2', ['face'], '2024-01-01T00:00:00Z', 'CHA-10.jpg'),
        photo('1', ['face'], '2023-01-01T00:00:00Z', 'CHA-2.jpg'),
      ],
      'all',
      'filename',
    );
    expect(photos.map(({ filename }) => filename)).toEqual(['CHA-2.jpg', 'CHA-10.jpg']);
    expect(groupPersonPhotos(photos, 'year').map(({ label }) => label)).toEqual(['2023', '2024']);
    expect(personPhotoGridClass('small')).toContain('lg:grid-cols-8');
    expect(personPhotoGridClass('large')).toContain('lg:grid-cols-3');
    expect(personPhotoDateLabel(photos[0])).toContain('2023');
  });

  it('groups one photo under every visible context and retains ungrouped photos', () => {
    const garden = {
      displayName: 'Garden',
      entityId: 'place-garden',
      entityKind: 'place' as const,
      typeKind: 'area' as const,
    };
    const coast = {
      displayName: 'The Coast',
      entityId: 'place-coast',
      entityKind: 'place' as const,
      typeKind: 'area' as const,
    };
    const trip = {
      displayName: 'Bluewater Weekend',
      entityId: 'event-trip',
      entityKind: 'event' as const,
      typeKind: 'trip' as const,
    };
    const linked = photo('linked', ['face'], '2024-01-01T00:00:00Z', 'linked.jpg', [garden, coast, trip]);
    const unlinked = photo('unlinked', ['face'], '2024-01-02T00:00:00Z');

    expect(groupPersonPhotos([linked, unlinked], 'place')).toEqual([
      expect.objectContaining({ id: 'place:place-garden', items: [linked], label: 'Garden' }),
      expect.objectContaining({ id: 'place:place-coast', items: [linked], label: 'The Coast' }),
      expect.objectContaining({ id: 'place:none', items: [unlinked], label: 'No place' }),
    ]);
    expect(groupPersonPhotos([linked], 'event')).toEqual([
      expect.objectContaining({ items: [linked], kindLabel: 'Trip', label: 'Bluewater Weekend' }),
    ]);
  });
});
