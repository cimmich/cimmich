import type { MapMarkerResponseDto } from '@immich/sdk';
import { describe, expect, it } from 'vitest';
import type { CimmichContextEntity } from '$lib/services/cimmich.service';
import {
  GPS_REVIEW_PACK_SIZE,
  gpsGroupGeometry,
  gpsGroupPackAssetIds,
  gpsGroupPackCount,
  groupGpsMarkers,
} from './gps-place-discovery';

const marker = (
  id: string,
  lat: number,
  lon: number,
  location: Partial<Pick<MapMarkerResponseDto, 'city' | 'country' | 'state'>> = {},
): MapMarkerResponseDto => ({
  city: null,
  country: null,
  id,
  lat,
  lon,
  state: null,
  ...location,
});

const place = (overrides: Partial<CimmichContextEntity> = {}): CimmichContextEntity => ({
  aliases: [],
  assetCount: 0,
  coverAssetId: null,
  dateEnd: null,
  datePrecision: 'unknown',
  dateStart: null,
  description: null,
  displayName: 'Circular Quay',
  entityId: 'place_quay',
  entityKind: 'place',
  geometry: { latitude: -33.861, longitude: 151.212 },
  parentEntityId: null,
  revision: 1,
  status: 'active',
  typeKind: 'point',
  ...overrides,
});

describe('GPS place discovery', () => {
  it('builds deterministic groups without duplicating asset IDs', () => {
    const markers = [
      marker('asset-b', -33.86, 151.21, { city: 'Sydney', country: 'Australia', state: 'New South Wales' }),
      marker('asset-a', -33.8601, 151.2101, {
        city: 'Sydney',
        country: 'Australia',
        state: 'New South Wales',
      }),
      marker('asset-a', -33.8601, 151.2101),
      marker('invalid-origin', 0, 0),
    ];

    const first = groupGpsMarkers(markers, [], 250);
    const second = groupGpsMarkers([...markers].reverse(), [], 250);

    expect(first).toEqual(second);
    expect(first).toHaveLength(1);
    expect(first[0]?.assetIds).toEqual(['asset-a', 'asset-b']);
    expect(first[0]?.suggestedName).toBe('Sydney, New South Wales, Australia');
  });

  it('keeps distant evidence separate and identifies a nearby existing Place', () => {
    const groups = groupGpsMarkers(
      [marker('asset-near', -33.8611, 151.2121), marker('asset-far', -34.4, 150.8)],
      [place()],
      250,
    );

    expect(groups).toHaveLength(2);
    expect(groups.find((group) => group.assetIds.includes('asset-near'))?.nearestPlace?.entity.entityId).toBe(
      'place_quay',
    );
    expect(groups.find((group) => group.assetIds.includes('asset-far'))?.nearestPlace).toBeNull();
  });

  it('treats separate GPS clusters with the same locality name as one logical Place', () => {
    const groups = groupGpsMarkers(
      [
        marker('zagreb-a', 45.8169, 16.0042, { city: 'Zagreb', country: 'Croatia' }),
        marker('zagreb-b', 45.817, 16.0043, { city: 'Zagreb', country: 'Croatia' }),
        marker('zagreb-c', 45.83, 16.02, { city: 'Zagreb', country: 'Croatia' }),
      ],
      [],
      100,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.suggestedName).toBe('Zagreb, Croatia');
    expect(groups[0]?.assetIds).toEqual(['zagreb-a', 'zagreb-b', 'zagreb-c']);
    expect(groups[0]?.radiusMeters).toBeGreaterThan(100);
  });

  it('continues an exact-name locality in the strongest saved Place even when another Place is nearer', () => {
    const zagrebArea = place({
      assetCount: 16,
      displayName: 'Zagreb, Croatia',
      entityId: 'place_zagreb_area',
      geometry: { east: 16.03, north: 45.84, south: 45.81, west: 16 },
      typeKind: 'area',
    });
    const nearbyVenue = place({
      assetCount: 100,
      displayName: 'Nearby venue',
      entityId: 'place_venue',
      geometry: { latitude: 45.817, longitude: 16.004 },
    });
    const duplicatePoint = place({
      assetCount: 15,
      displayName: 'Zagreb, Croatia',
      entityId: 'place_zagreb_point',
      geometry: { latitude: 45.817, longitude: 16.004 },
    });

    const group = groupGpsMarkers(
      [marker('zagreb-a', 45.817, 16.004, { city: 'Zagreb', country: 'Croatia' })],
      [nearbyVenue, duplicatePoint, zagrebArea],
      100,
    )[0]!;

    expect(group.matchKind).toBe('name');
    expect(group.nearestPlace?.entity.entityId).toBe('place_zagreb_area');
  });

  it('does not collapse country-only evidence into one nationwide Place', () => {
    const groups = groupGpsMarkers(
      [
        marker('croatia-north', 45.81, 15.98, { country: 'Croatia' }),
        marker('croatia-south', 43.5, 16.44, { country: 'Croatia' }),
      ],
      [],
      1000,
    );

    expect(groups).toHaveLength(2);
  });

  it('proposes a point for tight evidence and an area for a spread group', () => {
    const tight = groupGpsMarkers(
      [marker('asset-a', -33.86, 151.21), marker('asset-b', -33.8601, 151.2101)],
      [],
      1000,
    )[0]!;
    const spread = groupGpsMarkers(
      [marker('asset-c', -33.86, 151.21), marker('asset-d', -33.865, 151.215)],
      [],
      1000,
    )[0]!;

    expect(gpsGroupGeometry(tight)).toHaveProperty('latitude');
    expect(gpsGroupGeometry(spread)).toEqual(spread.bounds);
  });

  it('splits a large location into stable bounded review packs', () => {
    const assetIds = Array.from({ length: GPS_REVIEW_PACK_SIZE + 1 }, (_, index) => `asset-${index}`);

    expect(gpsGroupPackCount(assetIds)).toBe(2);
    expect(gpsGroupPackAssetIds(assetIds, 0)).toHaveLength(GPS_REVIEW_PACK_SIZE);
    expect(gpsGroupPackAssetIds(assetIds, 1)).toEqual([`asset-${GPS_REVIEW_PACK_SIZE}`]);
    expect(new Set([...gpsGroupPackAssetIds(assetIds, 0), ...gpsGroupPackAssetIds(assetIds, 1)])).toEqual(
      new Set(assetIds),
    );
  });
});
