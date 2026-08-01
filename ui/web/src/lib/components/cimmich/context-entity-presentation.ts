import type {
  CimmichAddressGeocodingItem,
  CimmichContextEntity,
  CimmichContextEntityKind,
  CimmichContextFamily,
  CimmichContextGeometry,
  CimmichContextRelation,
  CimmichContextTypeKind,
} from '$lib/services/cimmich.service';

const addressMatchQualityOrder: Record<CimmichAddressGeocodingItem['matchQuality'], number> = {
  exact: 0,
  close: 1,
  broad: 2,
};

const addressPrecisionOrder: Record<CimmichAddressGeocodingItem['precision'], number> = {
  address: 0,
  street: 1,
  place: 2,
};

export const contextPlaceNearbyRadii = [
  { label: '100 m', value: 100 },
  { label: '500 m', value: 500 },
  { label: '2 km', value: 2000 },
] as const;

export const formatContextPlaceDistance = (distanceMeters: number) => {
  const distance = Math.max(0, distanceMeters);
  if (distance < 1) {
    return 'At this place';
  }
  if (distance < 1000) {
    return `${Math.round(distance)} m`;
  }
  return `${(distance / 1000).toFixed(distance < 1e4 ? 1 : 0)} km`;
};

export const contextPlacePointDistanceMeters = (
  left: { latitude: number; longitude: number },
  right: { latitude: number; longitude: number },
) => {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const leftLatitude = radians(left.latitude);
  const rightLatitude = radians(right.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(haversine)));
};

export const contextPlaceSearchQualityLabel = (result: CimmichAddressGeocodingItem) => {
  if (result.matchQuality === 'exact') {
    return 'Exact address';
  }
  return result.matchQuality === 'close' ? 'Close match' : 'Broad match';
};

export const sortContextPlaceSearchResults = (results: CimmichAddressGeocodingItem[]) =>
  results
    .map((result, index) => ({ index, result }))
    .sort(
      (left, right) =>
        addressMatchQualityOrder[left.result.matchQuality] - addressMatchQualityOrder[right.result.matchQuality] ||
        addressPrecisionOrder[left.result.precision] - addressPrecisionOrder[right.result.precision] ||
        left.index - right.index,
    )
    .map(({ result }) => result);

export type ContextTypeFilter = 'all' | CimmichContextTypeKind;

export type ContextEditorTarget = { entityId: string; revision: number };

export const resolveContextEditorMutation = (
  mode: 'create' | 'edit',
  target: ContextEditorTarget | null,
): { kind: 'create' } | ({ kind: 'update' } & ContextEditorTarget) => {
  if (mode === 'create') {
    return { kind: 'create' };
  }
  if (!target) {
    throw new Error('The Thing or Place changed while its editor was open. Reopen it and try again.');
  }
  return { kind: 'update', ...target };
};

export const contextAssetViewerHref = (sourceAssetId: string) => `/photos/${encodeURIComponent(sourceAssetId)}`;

export const defaultContextRelationDraft = (entityKind: CimmichContextEntityKind, relationKinds: string[]) => {
  const relationKind =
    entityKind === 'event'
      ? (relationKinds[0] ?? 'related')
      : relationKinds.includes('related')
        ? 'related'
        : (relationKinds[0] ?? 'related');
  const relationTargetKind =
    relationKind === 'participant'
      ? 'person'
      : relationKind === 'companion'
        ? 'pet'
        : relationKind === 'location'
          ? 'place'
          : relationKind === 'object'
            ? 'object'
            : relationKind === 'parent'
              ? entityKind
              : 'person';
  return { relationKind, relationTargetKind } as const;
};

export const filterContextRelationTargets = (
  targets: Array<{ id: string; name: string }>,
  query: string,
  limit = 8,
) => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return [];
  }
  return targets
    .filter((target) => target.name.toLocaleLowerCase().includes(normalizedQuery))
    .slice(0, Math.max(1, limit));
};

export type ContextPlaceMapMarker = {
  id: string;
  lat: number;
  lon: number;
  name: string;
  parentName: string;
};

export type ContextPlaceMapArea = {
  geometryKind: 'area' | 'route';
  geometrySource: 'manual';
  id: string;
  name: string;
  parentName: string;
  points: Array<{ lat: number; lon: number }>;
};

export type ContextPlaceSearchResult = {
  admin1name?: string;
  admin2name?: string;
  latitude: number;
  longitude: number;
  name: string;
};

export const formatContextPlaceSearchResult = (place: ContextPlaceSearchResult) =>
  [place.name, place.admin1name, place.admin2name].filter(Boolean).join(', ');

export const parseContextPlaceCoordinates = (value: string) => {
  const parts = value.split(',').map((part) => part.trim());
  if (parts.length !== 2) {
    return null;
  }

  const lat = Number.parseFloat(parts[0] ?? '');
  const lng = Number.parseFloat(parts[1] ?? '');
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }

  return { lat, lng };
};

export const contextFamilyLabels: Record<CimmichContextFamily, string> = {
  events: 'Events',
  objects: 'Things',
  places: 'Places',
};

export const contextFamilyEyebrows: Record<CimmichContextFamily, string> = {
  events: 'Your life in moments',
  objects: 'The things that stay with you',
  places: 'Your personal atlas',
};

/**
 * ----------------------------
 * Place location labels
 * ----------------------------
 *
 * A place is identified by where it is, the way a person is identified by
 * their face, so every place surface has to be able to say where — including
 * when no map can be drawn. This returns the most specific human-readable
 * answer available and says so honestly when there is none, rather than
 * leaving the question unanswered.
 */
export const formatContextCoordinate = (latitude: number, longitude: number) => {
  const lat = `${Math.abs(latitude).toFixed(4)}°${latitude < 0 ? 'S' : 'N'}`;
  const lng = `${Math.abs(longitude).toFixed(4)}°${longitude < 0 ? 'W' : 'E'}`;
  return `${lat}, ${lng}`;
};

export const contextPlaceGeometryLabel = (geometry: CimmichContextGeometry) => {
  if (!geometry) {
    return '';
  }
  if ('latitude' in geometry) {
    return formatContextCoordinate(geometry.latitude, geometry.longitude);
  }
  if ('north' in geometry) {
    const centreLat = (geometry.north + geometry.south) / 2;
    const centreLng = (geometry.east + geometry.west) / 2;
    return `Area near ${formatContextCoordinate(centreLat, centreLng)}`;
  }
  if (geometry.points.length > 0) {
    const [start] = geometry.points;
    return `Route from ${formatContextCoordinate(start.latitude, start.longitude)} · ${geometry.points.length} points`;
  }
  return '';
};

/**
 * Immich already reverse-geocodes every asset to city/state/country and renders
 * exactly these three fields in its own `DetailPanelLocation`. Reuse that
 * instead of deriving a place name ourselves — it is the same intelligence the
 * rest of the product shows, so a place reads consistently with the asset
 * viewer and Explore.
 */
export const formatImmichPlaceLocation = (
  exif: { city?: string | null; country?: string | null; state?: string | null } | null | undefined,
) => {
  if (!exif) {
    return '';
  }
  return [exif.city, exif.state, exif.country]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(', ');
};

/**
 * The preference ladder for stating where a place is:
 *
 *   1. the owner's own place hierarchy — owner-defined truth outranks anything
 *      derived;
 *   2. Immich's reverse-geocoded city/state/country — existing product
 *      intelligence, and human-readable;
 *   3. raw coordinates from the place geometry — a last resort, because
 *      "29.4915°S, 153.2315°E" orients nobody;
 *   4. an honest statement that there is no location.
 *
 * Coordinates sat at rung 2 in the first version of this, which meant a place
 * Immich already knew as "Gulmarrad, New South Wales, Australia" was shown as a
 * number pair.
 */
export const contextPlaceLocationLabel = (
  entity: Pick<CimmichContextEntity, 'geometry' | 'typeKind'>,
  hierarchy: string[] = [],
  geocoded = '',
) => {
  const ancestors = hierarchy.slice(0, -1).filter(Boolean);
  if (ancestors.length > 0) {
    return ancestors.join(' / ');
  }
  if (geocoded.trim()) {
    return geocoded.trim();
  }
  const geometryLabel = contextPlaceGeometryLabel(entity.geometry);
  if (geometryLabel) {
    return geometryLabel;
  }
  return entity.typeKind === 'unlocated' ? 'Kept without a location' : 'No location yet';
};

/**
 * ----------------------------
 * Named detail routes
 * ----------------------------
 *
 * Mirrors `Route.cimmichPerson` and `Route.cimmichPet`: the path segment
 * carries the human-readable name so a shared link says what it points at,
 * and an id query param keeps resolution exact when two entities share a
 * name. The id param is family-specific, so a detail URL never needs a
 * separate `family` param — `?thingId=` already means Things.
 *
 * Places and Things live under one section route and both have a named
 * route. Events share this browser but have no `[entityName]` route yet, so
 * they deliberately keep the legacy `?entityId=` form; sending them to a
 * named path would 404.
 */
export const contextFamilySectionRoot: Record<CimmichContextFamily, string> = {
  events: '/cimmich/events',
  objects: '/cimmich/places',
  places: '/cimmich/places',
};

export const contextFamilyIdParam: Record<CimmichContextFamily, string> = {
  events: 'eventId',
  objects: 'thingId',
  places: 'placeId',
};

export const contextNamedRouteFamilies: readonly CimmichContextFamily[] = ['places', 'objects'];

export const contextFamilyHasNamedRoute = (family: CimmichContextFamily) => contextNamedRouteFamilies.includes(family);

/**
 * Which family a detail URL is addressing, read from whichever id param is
 * present. Returns null when the URL carries no family-specific id, so the
 * caller can fall back to `?family=` or the section default.
 */
export const contextFamilyFromDetailParams = (
  searchParams: Pick<URLSearchParams, 'get'>,
  allowed: readonly CimmichContextFamily[],
): CimmichContextFamily | null => {
  for (const family of allowed) {
    if (searchParams.get(contextFamilyIdParam[family])) {
      return family;
    }
  }
  return null;
};

/** The id a detail URL is pinned to, preferring the family-specific param and
 * falling back to legacy `?entityId=` so links shared before the named routes
 * existed still resolve. */
export const contextRequestedEntityId = (searchParams: Pick<URLSearchParams, 'get'>, family: CimmichContextFamily) =>
  searchParams.get(contextFamilyIdParam[family]) ?? searchParams.get('entityId') ?? '';

export const getContextDetailHref = (
  currentUrl: URL,
  family: CimmichContextFamily,
  entityId: string,
  displayName: string,
) => {
  const url = new URL(currentUrl);
  url.searchParams.delete('geographyGroup');
  url.searchParams.delete('entityId');
  url.searchParams.delete('tab');
  url.searchParams.delete('family');
  for (const value of Object.values(contextFamilyIdParam)) {
    url.searchParams.delete(value);
  }

  const root = contextFamilySectionRoot[family];
  if (!contextFamilyHasNamedRoute(family) || !displayName.trim()) {
    url.searchParams.set('family', family);
    url.searchParams.set('entityId', entityId);
    return `${root}${url.search}`;
  }

  url.searchParams.set(contextFamilyIdParam[family], entityId);
  return `${root}/${encodeURIComponent(displayName)}${url.search}`;
};

/** Country grouping comes from the canonical comma-separated Geography name
 * already shown in the directory. A one-part Geography is itself the country
 * root, so `Australia` joins the Australia section instead of an unrelated
 * "Other" bucket. */
export const contextPlaceCountryLabel = (place: Pick<CimmichContextEntity, 'displayName'> | string) => {
  const displayName = typeof place === 'string' ? place : place.displayName;
  const parts = displayName
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.at(-1) ?? 'Other geography';
};

export const getContextGeographyGroupHref = (currentUrl: URL, groupName: string) => {
  const url = new URL(currentUrl);
  url.pathname = `/cimmich/places/${encodeURIComponent(groupName.trim())}`;
  url.search = '';
  url.searchParams.set('geographyGroup', groupName.trim());
  return `${url.pathname}${url.search}`;
};

export const getContextCollectionHref = (currentUrl: URL, family: CimmichContextFamily) => {
  const url = new URL(currentUrl);
  url.searchParams.delete('geographyGroup');
  url.searchParams.delete('entityId');
  url.searchParams.delete('tab');
  for (const value of Object.values(contextFamilyIdParam)) {
    url.searchParams.delete(value);
  }
  url.searchParams.set('family', family);
  return `${contextFamilySectionRoot[family]}${url.search}`;
};

/**
 * Resolve the entity a route is asking for: by id when one is pinned,
 * otherwise by name so a hand-typed or truncated link still lands. Name
 * matching is case- and whitespace-insensitive because the segment is
 * user-facing text, not an identifier.
 */
export const resolveContextRouteEntity = <T extends { displayName: string; entityId: string }>(
  entities: T[],
  requested: { entityId?: string; name?: string },
): T | null => {
  const entityId = requested.entityId?.trim();
  if (entityId) {
    const byId = entities.find((entity) => entity.entityId === entityId);
    if (byId) {
      return byId;
    }
  }
  const name = requested.name?.trim().toLocaleLowerCase();
  if (name) {
    const byName = entities.find((entity) => entity.displayName.trim().toLocaleLowerCase() === name);
    if (byName) {
      return byName;
    }
  }
  return null;
};

export const contextTypeKinds: Record<CimmichContextEntityKind, CimmichContextTypeKind[]> = {
  event: ['trip', 'event', 'activity', 'life_period'],
  object: ['vehicle', 'property', 'device', 'collectible', 'equipment', 'other'],
  place: ['point', 'area', 'route', 'unlocated'],
};

export const contextFamilyKind: Record<CimmichContextFamily, CimmichContextEntityKind> = {
  events: 'event',
  objects: 'object',
  places: 'place',
};

export const objectTypeFilters: Array<{ label: string; value: ContextTypeFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Vehicles', value: 'vehicle' },
  { label: 'Properties', value: 'property' },
  { label: 'Devices', value: 'device' },
  { label: 'Collectibles', value: 'collectible' },
  { label: 'Equipment', value: 'equipment' },
  { label: 'Other', value: 'other' },
];

export const eventTypeFilters: Array<{ label: string; value: ContextTypeFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Trips', value: 'trip' },
  { label: 'Events', value: 'event' },
  { label: 'Activities', value: 'activity' },
  { label: 'Life periods', value: 'life_period' },
];

export const humanizeContextKind = (value: string) =>
  value
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');

export const contextTypeDescription = (kind: CimmichContextTypeKind) => {
  const descriptions: Partial<Record<CimmichContextTypeKind, string>> = {
    activity: 'Something that happens more than once',
    area: 'A property, venue or wider location',
    collectible: 'A particular item you keep',
    device: 'A named phone, camera or other device',
    equipment: 'Equipment with its own history',
    event: 'One occasion or bounded moment',
    life_period: 'A longer chapter of life',
    other: 'Another durable thing',
    point: 'One specific location',
    property: 'A home, building or property',
    route: 'A path, journey or recurring route',
    trip: 'Travel or a stay across places',
    unlocated: 'Meaningful even without a map location',
    vehicle: 'A car, motorbike, boat or other vehicle',
  };
  return descriptions[kind] ?? humanizeContextKind(kind);
};

export const formatContextDateRange = (entity: Pick<CimmichContextEntity, 'dateEnd' | 'dateStart'>) => {
  const formatter = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const format = (value: string) => formatter.format(new Date(`${value}T00:00:00`));
  if (entity.dateStart && entity.dateEnd && entity.dateStart !== entity.dateEnd) {
    return `${format(entity.dateStart)} – ${format(entity.dateEnd)}`;
  }
  if (entity.dateStart) {
    return format(entity.dateStart);
  }
  if (entity.dateEnd) {
    return `Until ${format(entity.dateEnd)}`;
  }
  return '';
};

export const formatContextDatePrecision = (entity: CimmichContextEntity) => {
  const range = formatContextDateRange(entity);
  if (!range) {
    return '';
  }
  return entity.datePrecision === 'approximate' ? `Around ${range}` : range;
};

export const contextEventYear = (entity: CimmichContextEntity) =>
  entity.dateStart?.slice(0, 4) || entity.dateEnd?.slice(0, 4) || 'Undated';

export const sortContextEntities = (entities: CimmichContextEntity[], family: CimmichContextFamily) =>
  [...entities].sort((left, right) => {
    if (family === 'events') {
      const leftDate = left.dateStart || left.dateEnd || '';
      const rightDate = right.dateStart || right.dateEnd || '';
      return rightDate.localeCompare(leftDate) || left.displayName.localeCompare(right.displayName);
    }
    return right.assetCount - left.assetCount || left.displayName.localeCompare(right.displayName);
  });

export const groupContextEventsByYear = (entities: CimmichContextEntity[]) => {
  const groups = new Map<string, CimmichContextEntity[]>();
  for (const entity of sortContextEntities(entities, 'events')) {
    const year = contextEventYear(entity);
    groups.set(year, [...(groups.get(year) ?? []), entity]);
  }
  return [...groups.entries()].sort(([left], [right]) => {
    if (left === 'Undated') {
      return 1;
    }
    if (right === 'Undated') {
      return -1;
    }
    return right.localeCompare(left);
  });
};

export const contextPlaceLineage = (entity: CimmichContextEntity, entities: CimmichContextEntity[]) => {
  const byId = new Map(entities.map((candidate) => [candidate.entityId, candidate]));
  const lineage = [entity];
  let parent = entity.parentEntityId ? byId.get(entity.parentEntityId) : undefined;
  const visited = new Set([entity.entityId]);
  while (parent && !visited.has(parent.entityId) && lineage.length < 8) {
    lineage.unshift(parent);
    visited.add(parent.entityId);
    parent = parent.parentEntityId ? byId.get(parent.parentEntityId) : undefined;
  }
  return lineage;
};

export type ContextPlaceDescendant = {
  depth: number;
  entity: CimmichContextEntity;
  path: string;
};

export const contextPlaceDescendants = (
  entity: CimmichContextEntity,
  entities: CimmichContextEntity[],
): ContextPlaceDescendant[] => {
  const childrenByParent = new Map<string, CimmichContextEntity[]>();
  for (const candidate of entities) {
    if (candidate.status !== 'active' || !candidate.parentEntityId) {
      continue;
    }
    childrenByParent.set(candidate.parentEntityId, [
      ...(childrenByParent.get(candidate.parentEntityId) ?? []),
      candidate,
    ]);
  }
  for (const children of childrenByParent.values()) {
    children.sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  const descendants: ContextPlaceDescendant[] = [];
  const visited = new Set([entity.entityId]);
  const visit = (parentId: string, depth: number, parentPath: string) => {
    if (depth >= 8) {
      return;
    }
    for (const child of childrenByParent.get(parentId) ?? []) {
      if (visited.has(child.entityId)) {
        continue;
      }
      visited.add(child.entityId);
      const path = parentPath ? `${parentPath} › ${child.displayName}` : child.displayName;
      descendants.push({ depth, entity: child, path });
      visit(child.entityId, depth + 1, path);
    }
  };
  visit(entity.entityId, 0, '');
  return descendants;
};

export const contextPlaceHierarchy = (entity: CimmichContextEntity, entities: CimmichContextEntity[]) =>
  contextPlaceLineage(entity, entities).map((candidate) => candidate.displayName);

export const contextPlaceMapProjection = (entities: CimmichContextEntity[]) => {
  const markers: ContextPlaceMapMarker[] = [];
  const areas: ContextPlaceMapArea[] = [];
  for (const entity of entities) {
    const parentName = contextPlaceHierarchy(entity, entities).slice(0, -1).join(' / ');
    if (entity.typeKind === 'point' && entity.geometry && 'latitude' in entity.geometry) {
      markers.push({
        id: entity.entityId,
        lat: entity.geometry.latitude,
        lon: entity.geometry.longitude,
        name: entity.displayName,
        parentName,
      });
    } else if (entity.typeKind === 'route' && entity.geometry && 'points' in entity.geometry) {
      areas.push({
        geometryKind: 'route',
        geometrySource: 'manual',
        id: entity.entityId,
        name: entity.displayName,
        parentName,
        points: entity.geometry.points.map((point) => ({ lat: point.latitude, lon: point.longitude })),
      });
    } else if (entity.typeKind === 'area' && entity.geometry && 'points' in entity.geometry) {
      areas.push({
        geometryKind: 'area',
        geometrySource: 'manual',
        id: entity.entityId,
        name: entity.displayName,
        parentName,
        points: entity.geometry.points.map((point) => ({ lat: point.latitude, lon: point.longitude })),
      });
    } else if (entity.typeKind === 'area' && entity.geometry && 'north' in entity.geometry) {
      const { east, north, south, west } = entity.geometry;
      areas.push({
        geometryKind: 'area',
        geometrySource: 'manual',
        id: entity.entityId,
        name: entity.displayName,
        parentName,
        points: [
          { lat: north, lon: west },
          { lat: north, lon: east },
          { lat: south, lon: east },
          { lat: south, lon: west },
          { lat: north, lon: west },
        ],
      });
    }
  }
  return { areas, markers };
};

export const contextAssociationLabel = (entityKind: CimmichContextEntityKind, associationKind: string) => {
  const labels: Record<CimmichContextEntityKind, Record<string, string>> = {
    event: {
      context: 'Nearby',
      direct: 'Main',
      manual: 'Main',
      route_stop: 'Stops',
    },
    object: {
      depicts: 'Depicts this thing',
      manual: 'This thing is present',
      owned_at: 'Owned here',
    },
    place: {
      captured_at: 'Captured here',
      depicts: 'Depicts this place',
      manual: 'Linked to this place',
      route_stop: 'On this route',
    },
  };
  return labels[entityKind][associationKind] ?? humanizeContextKind(associationKind);
};

export const contextAssociationKinds: Record<CimmichContextEntityKind, string[]> = {
  event: ['direct', 'route_stop', 'context', 'manual'],
  object: ['depicts', 'owned_at', 'manual'],
  place: ['captured_at', 'depicts', 'route_stop', 'manual'],
};

export const contextRelationGroups = (
  family: CimmichContextFamily,
  relations: CimmichContextRelation[],
): Array<{ label: string; relations: CimmichContextRelation[] }> => {
  const groupDefinitions: Record<CimmichContextFamily, Array<{ label: string; targetKinds: string[] }>> = {
    events: [
      { label: 'People', targetKinds: ['person'] },
      { label: 'Pets', targetKinds: ['pet'] },
      { label: 'Places', targetKinds: ['place'] },
      { label: 'Things', targetKinds: ['object'] },
      { label: 'Related events', targetKinds: ['event'] },
    ],
    objects: [
      { label: 'Seen with people', targetKinds: ['person'] },
      { label: 'Seen with pets', targetKinds: ['pet'] },
      { label: 'Seen at', targetKinds: ['place'] },
      { label: 'Part of events', targetKinds: ['event'] },
      { label: 'Related things', targetKinds: ['object'] },
    ],
    places: [
      { label: 'Events', targetKinds: ['event'] },
      { label: 'People', targetKinds: ['person'] },
      { label: 'Pets', targetKinds: ['pet'] },
      { label: 'Things', targetKinds: ['object'] },
      { label: 'Related places', targetKinds: ['place'] },
    ],
  };
  return groupDefinitions[family]
    .map((definition) => ({
      label: definition.label,
      relations: relations.filter((relation) => definition.targetKinds.includes(relation.targetKind)),
    }))
    .filter((group) => group.relations.length > 0);
};
