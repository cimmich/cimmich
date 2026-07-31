import type { MapMarkerResponseDto } from '@immich/sdk';
import type { CimmichContextEntity, CimmichContextGeometry } from '$lib/services/cimmich.service';

const EARTH_RADIUS_METERS = 6_371_000;
const METERS_PER_DEGREE = 111_320;

export const gpsDiscoveryRadii = [
  { label: 'Tight', value: 100 },
  { label: 'Nearby', value: 250 },
  { label: 'Broad', value: 1000 },
] as const;

export const GPS_REVIEW_PACK_SIZE = 500;

export const gpsGroupPackCount = (assetIds: string[]) => Math.max(1, Math.ceil(assetIds.length / GPS_REVIEW_PACK_SIZE));

export const gpsGroupPackAssetIds = (assetIds: string[], packIndex: number) => {
  const safeIndex = Math.max(0, Math.min(Math.floor(packIndex), gpsGroupPackCount(assetIds) - 1));
  const start = safeIndex * GPS_REVIEW_PACK_SIZE;
  return assetIds.slice(start, start + GPS_REVIEW_PACK_SIZE);
};

export type GpsDiscoveryRadius = (typeof gpsDiscoveryRadii)[number]['value'];

export type GpsPlaceGroup = {
  assetIds: string[];
  bounds: { east: number; north: number; south: number; west: number };
  center: { latitude: number; longitude: number };
  groupId: string;
  markers: MapMarkerResponseDto[];
  matchKind: 'name' | 'nearby' | null;
  nearestPlace: { distanceMeters: number; entity: CimmichContextEntity } | null;
  radiusMeters: number;
  suggestedName: string;
};

const radians = (degrees: number) => (degrees * Math.PI) / 180;

export const gpsDistanceMeters = (
  left: { latitude: number; longitude: number },
  right: { latitude: number; longitude: number },
) => {
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const firstLatitude = radians(left.latitude);
  const secondLatitude = radians(right.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(haversine));
};

const geometryCenter = (geometry: CimmichContextGeometry) => {
  if (!geometry) {
    return null;
  }
  if ('latitude' in geometry) {
    return geometry;
  }
  if ('north' in geometry) {
    return {
      latitude: (geometry.north + geometry.south) / 2,
      longitude: (geometry.east + geometry.west) / 2,
    };
  }
  if (geometry.points.length === 0) {
    return null;
  }
  return {
    latitude: geometry.points.reduce((sum, point) => sum + point.latitude, 0) / geometry.points.length,
    longitude: geometry.points.reduce((sum, point) => sum + point.longitude, 0) / geometry.points.length,
  };
};

export const normalizeGpsPlaceName = (value: string) =>
  value
    .normalize('NFKD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
    .replaceAll(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim();

const locationLabel = (markers: MapMarkerResponseDto[]) => {
  const counts = new Map<string, { cityCount: number; count: number }>();
  for (const marker of markers) {
    const label = [marker.city, marker.state, marker.country]
      .filter((part, index, values): part is string => Boolean(part) && values.indexOf(part) === index)
      .join(', ');
    if (label) {
      const current = counts.get(label) ?? { cityCount: 0, count: 0 };
      counts.set(label, {
        cityCount: current.cityCount + Number(Boolean(marker.city)),
        count: current.count + 1,
      });
    }
  }
  return [...counts.entries()].sort(
    ([leftLabel, left], [rightLabel, right]) => right.count - left.count || leftLabel.localeCompare(rightLabel),
  )[0];
};

const coordinateLabel = (latitude: number, longitude: number) => {
  const latitudeDirection = latitude < 0 ? 'S' : 'N';
  const longitudeDirection = longitude < 0 ? 'W' : 'E';
  return `${Math.abs(latitude).toFixed(4)}° ${latitudeDirection}, ${Math.abs(longitude).toFixed(4)}° ${longitudeDirection}`;
};

const validMarker = (marker: MapMarkerResponseDto) =>
  Boolean(marker.id) &&
  Number.isFinite(marker.lat) &&
  Number.isFinite(marker.lon) &&
  marker.lat >= -90 &&
  marker.lat <= 90 &&
  marker.lon >= -180 &&
  marker.lon <= 180 &&
  !(marker.lat === 0 && marker.lon === 0);

const markerGeometry = (markers: MapMarkerResponseDto[]) => {
  const center = {
    latitude: markers.reduce((sum, marker) => sum + marker.lat, 0) / markers.length,
    longitude: markers.reduce((sum, marker) => sum + marker.lon, 0) / markers.length,
  };
  return {
    bounds: {
      east: Math.max(...markers.map((marker) => marker.lon)),
      north: Math.max(...markers.map((marker) => marker.lat)),
      south: Math.min(...markers.map((marker) => marker.lat)),
      west: Math.min(...markers.map((marker) => marker.lon)),
    },
    center,
    radiusMeters: Math.max(
      0,
      ...markers.map((marker) => gpsDistanceMeters(center, { latitude: marker.lat, longitude: marker.lon })),
    ),
  };
};

const placeMatch = (
  center: { latitude: number; longitude: number },
  suggestedName: string,
  places: CimmichContextEntity[],
  cellSizeMeters: GpsDiscoveryRadius,
) => {
  const namedMatches = places
    .filter((entity) => normalizeGpsPlaceName(entity.displayName) === normalizeGpsPlaceName(suggestedName))
    .flatMap((entity) => {
      const placeCenter = geometryCenter(entity.geometry);
      return placeCenter ? [{ distanceMeters: gpsDistanceMeters(center, placeCenter), entity }] : [];
    })
    .sort(
      (left, right) =>
        right.entity.assetCount - left.entity.assetCount ||
        Number(right.entity.typeKind === 'area') - Number(left.entity.typeKind === 'area') ||
        left.distanceMeters - right.distanceMeters ||
        left.entity.entityId.localeCompare(right.entity.entityId),
    );
  if (namedMatches[0]) {
    return { matchKind: 'name' as const, nearestPlace: namedMatches[0] };
  }
  const nearestPlace =
    places
      .flatMap((entity) => {
        const placeCenter = geometryCenter(entity.geometry);
        return placeCenter ? [{ distanceMeters: gpsDistanceMeters(center, placeCenter), entity }] : [];
      })
      .sort((left, right) => left.distanceMeters - right.distanceMeters)[0] ?? null;
  return {
    matchKind:
      nearestPlace && nearestPlace.distanceMeters <= Math.max(300, cellSizeMeters * 2) ? ('nearby' as const) : null,
    nearestPlace:
      nearestPlace && nearestPlace.distanceMeters <= Math.max(300, cellSizeMeters * 2) ? nearestPlace : null,
  };
};

/**
 * Groups visible GPS evidence into deterministic proximity cells. It deliberately
 * does not create Place records: callers must ask the owner to promote a group.
 */
export const groupGpsMarkers = (
  sourceMarkers: MapMarkerResponseDto[],
  places: CimmichContextEntity[],
  cellSizeMeters: GpsDiscoveryRadius = 250,
): GpsPlaceGroup[] => {
  const locationScore = (marker: MapMarkerResponseDto) =>
    Number(Boolean(marker.city)) + Number(Boolean(marker.state)) + Number(Boolean(marker.country));
  const uniqueById = new Map<string, MapMarkerResponseDto>();
  for (const marker of sourceMarkers
    .filter((candidate) => validMarker(candidate))
    .sort((left, right) => left.id.localeCompare(right.id) || locationScore(right) - locationScore(left))) {
    if (!uniqueById.has(marker.id)) {
      uniqueById.set(marker.id, marker);
    }
  }
  const uniqueMarkers = [...uniqueById.values()];
  const latitudeStep = cellSizeMeters / METERS_PER_DEGREE;
  const longitudeStep = cellSizeMeters / METERS_PER_DEGREE;
  const cellMarkers = new Map<string, MapMarkerResponseDto[]>();

  for (const marker of uniqueMarkers) {
    const latitudeCell = Math.floor((marker.lat + 90) / latitudeStep);
    const longitudeCell = Math.floor((marker.lon + 180) / longitudeStep);
    const key = `${latitudeCell}:${longitudeCell}`;
    cellMarkers.set(key, [...(cellMarkers.get(key) ?? []), marker]);
  }

  const cells = [...cellMarkers.entries()].map(([key, markers]) => {
    const [latitudeCell, longitudeCell] = key.split(':').map(Number) as [number, number];
    return {
      center: {
        latitude: markers.reduce((sum, marker) => sum + marker.lat, 0) / markers.length,
        longitude: markers.reduce((sum, marker) => sum + marker.lon, 0) / markers.length,
      },
      key,
      latitudeCell,
      longitudeCell,
      markers,
    };
  });
  const cellIndex = new Map(cells.map((cell, index) => [cell.key, index]));
  const parents = cells.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parents[root] !== root) {
      root = parents[root]!;
    }
    while (parents[index] !== index) {
      const parent = parents[index]!;
      parents[index] = root;
      index = parent;
    }
    return root;
  };
  const join = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) {
      parents[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
    }
  };

  for (const [index, cell] of cells.entries()) {
    const longitudeReach = Math.min(
      12,
      Math.ceil(1 / Math.max(0.1, Math.abs(Math.cos(radians(cell.center.latitude))))) + 1,
    );
    for (let latitudeOffset = -1; latitudeOffset <= 1; latitudeOffset += 1) {
      for (let longitudeOffset = -longitudeReach; longitudeOffset <= longitudeReach; longitudeOffset += 1) {
        const candidateIndex = cellIndex.get(
          `${cell.latitudeCell + latitudeOffset}:${cell.longitudeCell + longitudeOffset}`,
        );
        if (
          candidateIndex !== undefined &&
          candidateIndex > index &&
          gpsDistanceMeters(cell.center, cells[candidateIndex]!.center) <= cellSizeMeters * 1.25
        ) {
          join(index, candidateIndex);
        }
      }
    }
  }

  const components = new Map<number, typeof cells>();
  for (const [index, cell] of cells.entries()) {
    const root = find(index);
    components.set(root, [...(components.get(root) ?? []), cell]);
  }
  const markerGroups = [...components.values()].flatMap((componentCells) => {
    const componentMarkers = componentCells.flatMap((cell) => cell.markers);
    const componentCenter = {
      latitude: componentMarkers.reduce((sum, marker) => sum + marker.lat, 0) / componentMarkers.length,
      longitude: componentMarkers.reduce((sum, marker) => sum + marker.lon, 0) / componentMarkers.length,
    };
    const componentRadius = Math.max(
      ...componentMarkers.map((marker) =>
        gpsDistanceMeters(componentCenter, { latitude: marker.lat, longitude: marker.lon }),
      ),
    );
    // Prevent a chain of neighbouring journey points from becoming one Place.
    return componentRadius <= cellSizeMeters * 1.25
      ? [
          {
            key: componentCells
              .map((cell) => cell.key)
              .sort()
              .join('+'),
            markers: componentMarkers,
          },
        ]
      : componentCells.map((cell) => ({ key: cell.key, markers: cell.markers }));
  });

  const proximityGroups = markerGroups.map(({ key, markers: groupMarkers }) => {
    const markers = [...groupMarkers].sort((left, right) => left.id.localeCompare(right.id));
    const geometry = markerGeometry(markers);
    const label = locationLabel(markers);
    const suggestedName =
      label?.[0] ?? `GPS location ${coordinateLabel(geometry.center.latitude, geometry.center.longitude)}`;
    return {
      consolidationKey:
        label && label[1].cityCount > 0 ? `name:${normalizeGpsPlaceName(suggestedName)}` : `proximity:${key}`,
      markers,
      suggestedName,
    };
  });

  const logicalGroups = new Map<string, typeof proximityGroups>();
  for (const group of proximityGroups) {
    logicalGroups.set(group.consolidationKey, [...(logicalGroups.get(group.consolidationKey) ?? []), group]);
  }

  return [...logicalGroups.entries()]
    .map(([consolidationKey, groups]) => {
      const markers = [
        ...new Map(groups.flatMap((group) => group.markers).map((marker) => [marker.id, marker])).values(),
      ].sort((left, right) => left.id.localeCompare(right.id));
      const geometry = markerGeometry(markers);
      const suggestedName =
        locationLabel(markers)?.[0] ??
        groups[0]?.suggestedName ??
        `GPS location ${coordinateLabel(geometry.center.latitude, geometry.center.longitude)}`;
      const match = placeMatch(geometry.center, suggestedName, places, cellSizeMeters);
      return {
        assetIds: markers.map((marker) => marker.id),
        bounds: geometry.bounds,
        center: geometry.center,
        groupId: `gps:${cellSizeMeters}:${consolidationKey}`,
        markers,
        matchKind: match.matchKind,
        nearestPlace: match.nearestPlace,
        radiusMeters: geometry.radiusMeters,
        suggestedName,
      };
    })
    .sort(
      (left, right) =>
        right.assetIds.length - left.assetIds.length ||
        left.suggestedName.localeCompare(right.suggestedName) ||
        left.groupId.localeCompare(right.groupId),
    );
};

export const gpsGroupGeometry = (group: GpsPlaceGroup): CimmichContextGeometry =>
  group.radiusMeters <= 150 ? { latitude: group.center.latitude, longitude: group.center.longitude } : group.bounds;
