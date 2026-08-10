import { describe, expect, it } from 'vitest';
import {
  contextAssociationKinds,
  contextAssociationLabel,
  contextAssetViewerHref,
  contextEventYear,
  contextFamilyFromDetailParams,
  contextFamilyHasNamedRoute,
  contextFamilyKind,
  contextFamilyLabels,
  contextRouteLoadSignature,
  contextPlaceLocationLabel,
  contextPlaceCountryLabel,
  contextGeographySubdivisionName,
  contextPlaceDescendants,
  contextRequestedEntityId,
  formatContextCoordinate,
  formatImmichPlaceLocation,
  getContextCollectionHref,
  getContextDetailHref,
  getContextGeographyGroupHref,
  resolveContextRouteEntity,
  contextPlaceHierarchy,
  contextPlaceMapProjection,
  contextPlaceNearbyRadii,
  contextPlacePointDistanceMeters,
  contextPlaceSearchQualityLabel,
  contextPlaceRoleLabel,
  contextRelationGroups,
  contextTypeKinds,
  contextTypeDescription,
  contextTypeLabel,
  eventTypeFilters,
  filterContextEntitiesByType,
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
  it('keeps tab-only navigation out of the directory and detail load identity', () => {
    const url = new URL('http://localhost/cimmich/places/Cedar?placeId=place_1');
    const signature = () =>
      contextRouteLoadSignature({
        activeFamily: 'places',
        allowedFamilies: ['places'],
        entityName: 'Cedar',
        searchParams: url.searchParams,
        visibilityVersion: 4,
      });
    const initial = signature();
    url.searchParams.set('tab', 'map');
    expect(signature()).toBe(initial);
    url.searchParams.set('tab', 'documents');
    expect(signature()).toBe(initial);
    url.searchParams.set('placeId', 'place_2');
    expect(signature()).not.toBe(initial);
    url.searchParams.set('placeId', 'place_1');
    url.searchParams.set('geographyGroup', 'Australia');
    expect(signature()).not.toBe(initial);
  });

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
      event: ['direct', 'route_stop', 'context', 'needs_check'],
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
    expect(eventTypeFilters.find((filter) => filter.value === 'trip')?.label).toBe('Trips & routes');
    expect(contextTypeLabel('trip')).toBe('Trip or route');
    expect(contextTypeDescription('trip')).toMatch(/ordered route/);
    expect(contextPlaceRoleLabel('location')).toBe('Location');
    expect(contextPlaceRoleLabel('geography')).toBe('Geography');
  });

  it('counts only the event type that the active directory filter renders', () => {
    const events = [
      entity({ entityId: 'trip-1', entityKind: 'event', typeKind: 'trip' }),
      entity({ entityId: 'trip-2', entityKind: 'event', typeKind: 'trip' }),
      entity({ entityId: 'event-1', entityKind: 'event', typeKind: 'event' }),
    ];

    expect(filterContextEntitiesByType(events, 'trip').map(({ entityId }) => entityId)).toEqual(['trip-1', 'trip-2']);
    expect(filterContextEntitiesByType(events, 'all')).toBe(events);
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
        displayName: 'Cedar House',
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
      entity({
        displayName: 'Office',
        entityId: 'place_office',
        geometry: {
          points: [
            { latitude: 39.551, longitude: 19.831 },
            { latitude: 39.552, longitude: 19.833 },
            { latitude: 39.55, longitude: 19.834 },
          ],
        },
        parentEntityId: 'place_point',
        typeKind: 'area',
      }),
      entity({
        displayName: 'Desk',
        entityId: 'place_desk',
        parentEntityId: 'place_office',
      }),
    ];
    expect(contextPlaceHierarchy(places[3], places)).toEqual(['Greece', 'Corfu', 'Cedar House', 'Beach']);
    expect(
      contextPlaceDescendants(places[2], places).map(({ depth, entity, path }) => ({
        depth,
        id: entity.entityId,
        path,
      })),
    ).toEqual([
      { depth: 0, id: 'place_area', path: 'Beach' },
      { depth: 0, id: 'place_office', path: 'Office' },
      { depth: 1, id: 'place_desk', path: 'Office › Desk' },
    ]);
    const projection = contextPlaceMapProjection(places);
    expect(projection.markers).toHaveLength(1);
    expect(projection.markers[0]?.parentName).toBe('Greece / Corfu');
    expect(projection.areas).toHaveLength(3);
    expect(projection.areas.find((area) => area.geometryKind === 'area')?.points).toHaveLength(5);
    expect(projection.areas.find((area) => area.id === 'place_office')?.points).toHaveLength(3);
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

describe('place location labels', () => {
  const place = (
    geometry: Parameters<typeof contextPlaceLocationLabel>[0]['geometry'],
    typeKind: Parameters<typeof contextPlaceLocationLabel>[0]['typeKind'] = 'point',
  ) => ({ geometry, typeKind });

  it('formats a point as signed-hemisphere coordinates', () => {
    // Parent's Home on the real archive: southern and eastern hemispheres.
    expect(formatContextCoordinate(-29.491_547, 153.231_453)).toBe('29.4915°S, 153.2315°E');
    expect(formatContextCoordinate(48.8584, -2.2945)).toBe('48.8584°N, 2.2945°W');
  });

  it("composes Immich's own reverse-geocoded fields, the way DetailPanelLocation does", () => {
    expect(formatImmichPlaceLocation({ city: 'Gulmarrad', state: 'New South Wales', country: 'Australia' })).toBe(
      'Gulmarrad, New South Wales, Australia',
    );
    // Partial geocoding is normal; skip the blanks rather than leaving commas.
    expect(formatImmichPlaceLocation({ city: null, state: '  ', country: 'Australia' })).toBe('Australia');
    expect(formatImmichPlaceLocation(null)).toBe('');
    expect(formatImmichPlaceLocation(undefined)).toBe('');
  });

  it('prefers the containing hierarchy over everything, because it is owner-defined truth', () => {
    expect(
      contextPlaceLocationLabel(
        place({ latitude: -29.491_547, longitude: 153.231_453 }),
        ['Australia', 'New South Wales', "Parent's Home"],
        'Gulmarrad, New South Wales, Australia',
      ),
    ).toBe('Australia / New South Wales');
  });

  it("prefers Immich's geocoded name over raw coordinates when there is no hierarchy", () => {
    expect(
      contextPlaceLocationLabel(
        place({ latitude: -29.491_547, longitude: 153.231_453 }),
        ["Parent's Home"],
        'Gulmarrad, New South Wales, Australia',
      ),
    ).toBe('Gulmarrad, New South Wales, Australia');
  });

  it('falls back to coordinates only when Immich has no geocoded name', () => {
    expect(contextPlaceLocationLabel(place({ latitude: -29.491_547, longitude: 153.231_453 }), ["Parent's Home"])).toBe(
      '29.4915°S, 153.2315°E',
    );
    expect(
      contextPlaceLocationLabel(place({ latitude: -29.491_547, longitude: 153.231_453 }), ["Parent's Home"], '   '),
    ).toBe('29.4915°S, 153.2315°E');
  });

  it('describes areas by centre and routes by start plus point count', () => {
    expect(contextPlaceLocationLabel(place({ north: 10, south: 0, east: 20, west: 0 }, 'area'))).toBe(
      'Area near 5.0000°N, 10.0000°E',
    );
    expect(
      contextPlaceLocationLabel(
        place(
          {
            points: [
              { latitude: 1, longitude: 2 },
              { latitude: 3, longitude: 4 },
            ],
          },
          'route',
        ),
      ),
    ).toBe('Route from 1.0000°N, 2.0000°E · 2 points');
  });

  it('says so honestly when there is no location, distinguishing unlocated from missing', () => {
    expect(contextPlaceLocationLabel(place(null, 'unlocated'))).toBe('Kept without a location');
    expect(contextPlaceLocationLabel(place(null, 'point'))).toBe('No location yet');
  });
});

describe('named context detail routes', () => {
  const at = (href: string) => new URL(href, 'http://localhost');

  it('gives places and things a named route and leaves events on the query form', () => {
    expect(contextFamilyHasNamedRoute('places')).toBe(true);
    expect(contextFamilyHasNamedRoute('objects')).toBe(true);
    // Events share this browser but have no [entityName] route; sending them to
    // a named path would 404.
    expect(contextFamilyHasNamedRoute('events')).toBe(false);

    expect(getContextDetailHref(at('/cimmich/events'), 'events', 'event_1', 'Japan 2024')).toBe(
      '/cimmich/events?family=events&entityId=event_1',
    );
  });

  it('builds a named place href carrying the id, with no family param needed', () => {
    expect(getContextDetailHref(at('/cimmich/places?family=places'), 'places', 'place_1', "Parent's Home")).toBe(
      "/cimmich/places/Parent's%20Home?placeId=place_1",
    );
  });

  it('builds data-derived country pages and keeps a country root in its own group', () => {
    expect(contextPlaceCountryLabel('Gulmarrad, New South Wales, Australia')).toBe('Australia');
    expect(contextPlaceCountryLabel('Australia')).toBe('Australia');
    expect(getContextGeographyGroupHref(at('/cimmich/places?family=places'), 'New Zealand')).toBe(
      '/cimmich/places/New%20Zealand?geographyGroup=New+Zealand',
    );
  });

  it('keeps a directory-created subdivision in its selected country group', () => {
    expect(contextGeographySubdivisionName('NSW', 'Australia')).toBe('NSW, Australia');
    expect(contextGeographySubdivisionName('Brisbane, Australia', 'Australia')).toBe('Brisbane, Australia');
  });

  it('builds a named thing href under its own section', () => {
    expect(getContextDetailHref(at('/cimmich/places?family=objects'), 'objects', 'object_1', 'ATV')).toBe(
      '/cimmich/things/ATV?thingId=object_1',
    );
  });

  it('encodes names that are not URL-safe and drops any stale id or tab', () => {
    expect(
      getContextDetailHref(
        at('/cimmich/places/Old?placeId=place_old&tab=map&entityId=place_legacy'),
        'places',
        'place_2',
        'Kim & Co / Studio #3',
      ),
    ).toBe('/cimmich/places/Kim%20%26%20Co%20%2F%20Studio%20%233?placeId=place_2');
  });

  it('falls back to the query form when an entity has no usable name', () => {
    expect(getContextDetailHref(at('/cimmich/places'), 'places', 'place_3', '   ')).toBe(
      '/cimmich/places?entityId=place_3',
    );
  });

  it('returns to the collection for the active family, dropping the named segment', () => {
    expect(getContextCollectionHref(at('/cimmich/places/ATV?thingId=object_1&tab=documents'), 'objects')).toBe(
      '/cimmich/things',
    );
    expect(getContextCollectionHref(at("/cimmich/places/Parent's%20Home?placeId=place_1"), 'places')).toBe(
      '/cimmich/places',
    );
    expect(getContextCollectionHref(at('/cimmich/places/Australia?geographyGroup=Australia'), 'places')).toBe(
      '/cimmich/places',
    );
  });

  it('reads the family from whichever id param is present, before any family param', () => {
    const families = ['places', 'objects'] as const;
    expect(contextFamilyFromDetailParams(at('/x?thingId=object_1').searchParams, families)).toBe('objects');
    expect(contextFamilyFromDetailParams(at('/x?placeId=place_1').searchParams, families)).toBe('places');
    // A bare collection URL states no family through an id param.
    expect(contextFamilyFromDetailParams(at('/x?family=objects').searchParams, families)).toBeNull();
  });

  it('prefers the family id param but still accepts a legacy entityId link', () => {
    expect(contextRequestedEntityId(at('/x?placeId=place_1').searchParams, 'places')).toBe('place_1');
    expect(contextRequestedEntityId(at('/x?entityId=place_legacy').searchParams, 'places')).toBe('place_legacy');
    expect(contextRequestedEntityId(at('/x?placeId=place_1&entityId=place_legacy').searchParams, 'places')).toBe(
      'place_1',
    );
    expect(contextRequestedEntityId(at('/x').searchParams, 'places')).toBe('');
  });

  it('resolves by id first, then by name, so a name-only link still lands', () => {
    const entities = [
      { displayName: "Parent's Home", entityId: 'place_1' },
      { displayName: 'Beach House', entityId: 'place_2' },
    ];
    expect(resolveContextRouteEntity(entities, { entityId: 'place_2' })?.entityId).toBe('place_2');
    expect(resolveContextRouteEntity(entities, { name: "  parent's home  " })?.entityId).toBe('place_1');
    // A stale id must not strand a still-valid name.
    expect(resolveContextRouteEntity(entities, { entityId: 'place_gone', name: 'Beach House' })?.entityId).toBe(
      'place_2',
    );
    expect(resolveContextRouteEntity(entities, { name: 'Nowhere' })).toBeNull();
    expect(resolveContextRouteEntity(entities, {})).toBeNull();
  });
});
