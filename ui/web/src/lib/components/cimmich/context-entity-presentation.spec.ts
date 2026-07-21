import { describe, expect, it } from 'vitest';
import {
  contextAssociationKinds,
  contextAssociationLabel,
  contextAssetViewerHref,
  contextEventYear,
  contextFamilyKind,
  contextFamilyLabels,
  contextPlaceHierarchy,
  contextPlaceMapProjection,
  contextPlaceNearbyRadii,
  contextPlacePointDistanceMeters,
  contextPlaceSearchQualityLabel,
  contextRelationGroups,
  contextTypeKinds,
  contextTypeDescription,
  eventTypeFilters,
  filterContextRelationTargets,
  defaultContextRelationDraft,
  formatContextPlaceSearchResult,
  formatContextPlaceDistance,
  formatContextDateRange,
  groupContextEventsByYear,
  humanizeContextKind,
  objectTypeFilters,
  parseContextPlaceCoordinates,
  resolveContextEditorMutation,
  sortContextEntities,
  sortContextPlaceSearchResults,
} from './context-entity-presentation';

const entity = (
  overrides: Partial<import('$lib/services/cimmich.service').CimmichContextEntity> = {},
): import('$lib/services/cimmich.service').CimmichContextEntity => ({
  aliases: [],
  assetCount: 0,
  coverAssetId: null,
  dateEnd: null,
  datePrecision: 'unknown',
  dateStart: null,
  description: null,
  displayName: 'Example',
  entityId: 'entity_1',
  entityKind: 'place',
  geometry: null,
  parentEntityId: null,
  revision: 1,
  status: 'active',
  typeKind: 'unlocated',
  ...overrides,
});

describe('Cimmich context entity presentation', () => {
  it('never falls an existing-record edit through to create when its live selection changes', () => {
    expect(resolveContextEditorMutation('create', null)).toEqual({ kind: 'create' });
    expect(resolveContextEditorMutation('edit', { entityId: 'object_star_quilt', revision: 4 })).toEqual({
      entityId: 'object_star_quilt',
      kind: 'update',
      revision: 4,
    });
    expect(() => resolveContextEditorMutation('edit', null)).toThrow(/changed while its editor was open/i);
  });

  it('keeps the deployed family and type vocabulary exact', () => {
    expect(contextFamilyKind).toEqual({ events: 'event', objects: 'object', places: 'place' });
    expect(contextTypeKinds).toEqual({
      event: ['trip', 'event', 'activity', 'life_period'],
      object: ['vehicle', 'property', 'device', 'collectible', 'equipment', 'other'],
      place: ['point', 'area', 'route', 'unlocated'],
    });
    expect(contextAssociationKinds).toEqual({
      event: ['direct', 'route_stop', 'context', 'manual'],
      object: ['depicts', 'owned_at', 'manual'],
      place: ['captured_at', 'depicts', 'route_stop', 'manual'],
    });
  });

  it('uses human-facing Things copy without changing the Object contract', () => {
    expect(contextFamilyLabels.objects).toBe('Things');
    expect(contextFamilyKind.objects).toBe('object');
    expect(objectTypeFilters.map((filter) => filter.value)).toEqual([
      'all',
      'vehicle',
      'property',
      'device',
      'collectible',
      'equipment',
      'other',
    ]);
    expect(eventTypeFilters.map((filter) => filter.value)).toEqual(['all', 'trip', 'event', 'activity', 'life_period']);
    expect(contextTypeDescription('trip')).toMatch(/Travel/);
  });

  it('uses human labels without changing stable contract values', () => {
    expect(humanizeContextKind('life_period')).toBe('Life Period');
    expect(humanizeContextKind('route_stop')).toBe('Route Stop');
  });

  it('opens linked media through the native viewer and starts ordinary connections on a useful target', () => {
    expect(contextAssetViewerHref('asset / one')).toBe('/photos/asset%20%2F%20one');
    expect(defaultContextRelationDraft('place', ['parent', 'related'])).toEqual({
      relationKind: 'related',
      relationTargetKind: 'person',
    });
    expect(defaultContextRelationDraft('event', ['participant', 'companion', 'related'])).toEqual({
      relationKind: 'participant',
      relationTargetKind: 'person',
    });
    expect(
      filterContextRelationTargets(
        [
          { id: 'person_1', name: 'Maya Chen' },
          { id: 'person_2', name: 'Theo Cedar' },
          { id: 'person_3', name: 'Samira Cedar' },
        ],
        'Cedar',
      ),
    ).toEqual([
      { id: 'person_2', name: 'Theo Cedar' },
      { id: 'person_3', name: 'Samira Cedar' },
    ]);
    expect(filterContextRelationTargets([{ id: 'person_1', name: 'Maya Chen' }], '')).toEqual([]);
  });

  it('renders honest empty, single and range date states', () => {
    expect(formatContextDateRange({ dateEnd: null, dateStart: null })).toBe('');
    expect(formatContextDateRange({ dateEnd: null, dateStart: '2026-07-17' })).toContain('2026');
    expect(formatContextDateRange({ dateEnd: '2026-07-20', dateStart: '2026-07-17' })).toMatch(/–/);
  });

  it('sorts and groups Events chronologically while keeping undated records visible', () => {
    const events = [
      entity({
        dateStart: '2023-02-01',
        displayName: 'Earlier',
        entityId: 'event_1',
        entityKind: 'event',
        typeKind: 'event',
      }),
      entity({
        dateStart: null,
        displayName: 'Undated',
        entityId: 'event_2',
        entityKind: 'event',
        typeKind: 'activity',
      }),
      entity({
        dateStart: '2024-08-01',
        displayName: 'Latest',
        entityId: 'event_3',
        entityKind: 'event',
        typeKind: 'trip',
      }),
    ];
    expect(sortContextEntities(events, 'events').map((row) => row.displayName)).toEqual([
      'Latest',
      'Earlier',
      'Undated',
    ]);
    expect(groupContextEventsByYear(events).map(([year]) => year)).toEqual(['2024', '2023', 'Undated']);
    expect(contextEventYear(events[0])).toBe('2023');
  });

  it('projects Place hierarchy and exact live point, rectangular area and route geometry for the map', () => {
    const places = [
      entity({ displayName: 'Greece', entityId: 'place_country' }),
      entity({ displayName: 'Corfu', entityId: 'place_island', parentEntityId: 'place_country' }),
      entity({
        displayName: 'The Pink Palace',
        entityId: 'place_point',
        geometry: { latitude: 39.55, longitude: 19.83 },
        parentEntityId: 'place_island',
        typeKind: 'point',
      }),
      entity({
        displayName: 'Beach',
        entityId: 'place_area',
        geometry: { east: 19.84, north: 39.56, south: 39.54, west: 19.82 },
        parentEntityId: 'place_point',
        typeKind: 'area',
      }),
      entity({
        displayName: 'Boat route',
        entityId: 'place_route',
        geometry: {
          points: [
            { latitude: 39.5, longitude: 19.8 },
            { latitude: 39.6, longitude: 19.9 },
          ],
        },
        typeKind: 'route',
      }),
    ];
    expect(contextPlaceHierarchy(places[3], places)).toEqual(['Greece', 'Corfu', 'The Pink Palace', 'Beach']);
    const projection = contextPlaceMapProjection(places);
    expect(projection.markers).toHaveLength(1);
    expect(projection.markers[0]?.parentName).toBe('Greece / Corfu');
    expect(projection.areas).toHaveLength(2);
    expect(projection.areas.find((area) => area.geometryKind === 'area')?.points).toHaveLength(5);
  });

  it('formats searchable addresses and accepts only valid latitude/longitude pairs', () => {
    expect(
      formatContextPlaceSearchResult({
        admin1name: 'New South Wales',
        admin2name: 'Sydney',
        latitude: -33.8568,
        longitude: 151.2153,
        name: 'Sydney Opera House',
      }),
    ).toBe('Sydney Opera House, New South Wales, Sydney');
    expect(parseContextPlaceCoordinates('-33.8568, 151.2153')).toEqual({ lat: -33.8568, lng: 151.2153 });
    expect(parseContextPlaceCoordinates('91, 151.2153')).toBeNull();
    expect(parseContextPlaceCoordinates('Sydney Opera House')).toBeNull();
  });

  it('ranks and labels address results by verified match quality rather than provider geometry', () => {
    const addressResult = (
      resultId: string,
      matchQuality: import('$lib/services/cimmich.service').CimmichAddressGeocodingItem['matchQuality'],
      precision: import('$lib/services/cimmich.service').CimmichAddressGeocodingItem['precision'],
    ): import('$lib/services/cimmich.service').CimmichAddressGeocodingItem => ({
      addressLine: null,
      admin1: 'New South Wales',
      country: 'Australia',
      label: resultId,
      latitude: -33.8,
      locality: 'Sydney',
      longitude: 151.2,
      matchQuality,
      matchReason:
        matchQuality === 'exact'
          ? 'exact_address'
          : matchQuality === 'close'
            ? 'house_number_unavailable'
            : 'street_partial_match',
      name: resultId,
      postcode: null,
      precision,
      resultId,
    });
    const broadAddress = addressResult('broad-address', 'broad', 'address');
    const closeStreet = addressResult('close-street', 'close', 'street');
    const exactAddress = addressResult('exact-address', 'exact', 'address');

    expect(
      sortContextPlaceSearchResults([broadAddress, closeStreet, exactAddress]).map(({ resultId }) => resultId),
    ).toEqual(['exact-address', 'close-street', 'broad-address']);
    expect(contextPlaceSearchQualityLabel(exactAddress)).toBe('Exact address');
    expect(contextPlaceSearchQualityLabel(closeStreet)).toBe('Close match');
    expect(contextPlaceSearchQualityLabel(broadAddress)).toBe('Broad match');
  });

  it('presents nearby Place reach and distance without implying an automatic match', () => {
    expect(contextPlaceNearbyRadii).toEqual([
      { label: '100 m', value: 100 },
      { label: '500 m', value: 500 },
      { label: '2 km', value: 2000 },
    ]);
    expect(formatContextPlaceDistance(0)).toBe('At this place');
    expect(formatContextPlaceDistance(23.7)).toBe('24 m');
    expect(formatContextPlaceDistance(1450)).toBe('1.4 km');
    expect(
      contextPlacePointDistanceMeters(
        { latitude: -33.8688, longitude: 151.2093 },
        { latitude: -33.8688, longitude: 151.2104 },
      ),
    ).toBeCloseTo(102, -1);
  });

  it('uses product language for media associations without changing stored values', () => {
    expect(contextAssociationLabel('event', 'direct')).toBe('Main');
    expect(contextAssociationLabel('event', 'route_stop')).toBe('Stops');
    expect(contextAssociationLabel('object', 'depicts')).toBe('Depicts this thing');
    expect(contextAssociationLabel('place', 'captured_at')).toBe('Captured here');
  });

  it('groups the same durable relations around each collection’s human job', () => {
    const relations: import('$lib/services/cimmich.service').CimmichContextRelation[] = [
      {
        linkedAt: '2026-07-18T00:00:00Z',
        relationId: 'relation_person',
        relationKind: 'participant',
        targetId: 'person_1',
        targetKind: 'person',
        targetName: 'Maya',
      },
      {
        linkedAt: '2026-07-18T00:00:00Z',
        relationId: 'relation_place',
        relationKind: 'location',
        targetId: 'place_1',
        targetKind: 'place',
        targetName: 'Corfu',
      },
      {
        linkedAt: '2026-07-18T00:00:00Z',
        relationId: 'relation_pet',
        relationKind: 'companion',
        targetId: 'pet_1',
        targetKind: 'pet',
        targetName: 'George',
      },
      {
        linkedAt: '2026-07-18T00:00:00Z',
        relationId: 'relation_object',
        relationKind: 'object',
        targetId: 'object_1',
        targetKind: 'object',
        targetName: 'Campervan',
      },
    ];
    expect(contextRelationGroups('events', relations).map((group) => group.label)).toEqual([
      'People',
      'Pets',
      'Places',
      'Things',
    ]);
    expect(contextRelationGroups('objects', relations).map((group) => group.label)).toEqual([
      'Seen with people',
      'Seen with pets',
      'Seen at',
      'Related things',
    ]);
  });
});
