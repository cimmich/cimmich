import '@testing-library/jest-dom';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import type { CimmichContextDetail, CimmichContextEntity } from '$lib/services/cimmich.service';
import CimmichContextCollection from './CimmichContextCollection.svelte';
import CimmichContextDetailHero from './CimmichContextDetailHero.svelte';

const mocks = vi.hoisted(() => ({
  getAssetInfo: vi.fn().mockResolvedValue({ exifInfo: null }),
  getMapMarkers: vi.fn().mockResolvedValue([]),
  getVisibleMapAssetIds: vi.fn().mockResolvedValue(new Set<string>()),
}));

vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal()),
  getAssetInfo: mocks.getAssetInfo,
  getMapMarkers: mocks.getMapMarkers,
}));

vi.mock('$lib/services/cimmich.service', async (importOriginal) => ({
  ...(await importOriginal()),
  getCimmichVisibleMapAssetIds: mocks.getVisibleMapAssetIds,
}));

vi.hoisted(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ addEventListener: vi.fn(), matches: false, removeEventListener: vi.fn() })),
  });
});

const entity = (overrides: Partial<CimmichContextEntity> = {}): CimmichContextEntity => ({
  aliases: [],
  assetCount: 0,
  coverAssetId: null,
  dateEnd: null,
  datePrecision: 'unknown',
  dateStart: null,
  description: null,
  displayName: 'Example',
  entityId: 'entity_1',
  entityKind: 'object',
  geometry: null,
  parentEntityId: null,
  revision: 1,
  status: 'active',
  typeKind: 'other',
  ...overrides,
});

// Cards and rows are anchors now, so the collection needs to be told how to
// address an entity. A deterministic stub keeps the href assertions readable.
const entityHref = (candidate: CimmichContextEntity) => `/cimmich/test/${candidate.entityId}`;

describe('Cimmich context collections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('presents Things as durable identities and filters without changing the object contract', () => {
    const { getByRole, getByText, queryByRole, queryByText } = render(CimmichContextCollection, {
      controlledTypeFilter: 'device',
      entities: [
        entity({ displayName: 'Campervan', entityId: 'object_vehicle', typeKind: 'vehicle' }),
        entity({ assetCount: 1, displayName: 'Old camera', entityId: 'object_device', typeKind: 'device' }),
      ],
      entityHref,
      family: 'objects',
      onAdd: vi.fn(),
      onOpen: vi.fn(),
    });

    expect(queryByRole('link', { name: /Campervan/ })).not.toBeInTheDocument();
    expect(queryByText('The things that stay with you')).not.toBeInTheDocument();
    expect(getByText('1 photo')).toBeInTheDocument();
    expect(queryByRole('combobox', { name: 'Filter Things' })).not.toBeInTheDocument();
    // A thing card is a LINK, not a click handler: that is what makes it
    // middle-clickable, copyable and previewable on hover, as People and Pets are.
    expect(getByRole('link', { name: /Old camera/ })).toHaveAttribute('href', '/cimmich/test/object_device');
  });

  it('renders Events as a year-grouped newest-first memory timeline', () => {
    const { getAllByRole, getByRole, getByTestId, getByText } = render(CimmichContextCollection, {
      entities: [
        entity({
          dateStart: '2024-07-01',
          displayName: 'Corfu trip',
          entityId: 'event_trip',
          entityKind: 'event',
          previewAssetIds: ['asset_1', 'asset_2', 'asset_3', 'asset_4'],
          typeKind: 'trip',
        }),
        entity({
          dateStart: '2023-01-01',
          displayName: 'Summer football',
          entityId: 'event_activity',
          entityKind: 'event',
          typeKind: 'activity',
        }),
      ],
      entityHref,
      family: 'events',
      onAdd: vi.fn(),
      onOpen: vi.fn(),
    });

    expect(getByRole('heading', { name: '2024' })).toBeInTheDocument();
    expect(getByRole('heading', { name: '2023' })).toBeInTheDocument();
    expect(getByText('Corfu trip')).toBeInTheDocument();
    expect(getByText('Summer football')).toBeInTheDocument();
    expect(getByTestId('cimmich-event-contact-sheet').querySelectorAll('img')).toHaveLength(4);
    expect(getAllByRole('link', { name: /Corfu trip|Summer football/ }).map((card) => card.textContent)).toEqual([
      expect.stringContaining('Corfu trip'),
      expect.stringContaining('Summer football'),
    ]);
  });

  it('starts an empty Events collection from photos while preserving a metadata-first path', async () => {
    const onAdd = vi.fn();
    const onEventStartFromPhotos = vi.fn();
    const { getByRole, getByText } = render(CimmichContextCollection, {
      entities: [],
      entityHref,
      family: 'events',
      onAdd,
      onEventStartFromPhotos,
      onOpen: vi.fn(),
    });

    expect(getByText('Bring the first memory together')).toBeInTheDocument();
    expect(getByText('Recurring activity')).toBeInTheDocument();

    await fireEvent.click(getByRole('button', { name: 'Choose folders or photos' }));
    expect(onEventStartFromPhotos).toHaveBeenCalledOnce();

    await fireEvent.click(getByRole('button', { name: 'Start without photos' }));
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it('renders the controlled Places view and keeps GPS mounted after first entry', async () => {
    const onAdd = vi.fn();
    const props = {
      controlledPlaceView: 'locations' as 'atlas' | 'geography' | 'gps' | 'locations',
      entities: [],
      entityHref,
      family: 'places' as const,
      onAdd,
      onOpen: vi.fn(),
    };
    const rendered = render(CimmichContextCollection, props);
    const { getByRole, getByText } = rendered;

    expect(getByText('No locations yet')).toBeInTheDocument();
    await fireEvent.click(getByRole('button', { name: 'Add a location' }));
    expect(onAdd).toHaveBeenCalledWith('location');
    expect(mocks.getMapMarkers).not.toHaveBeenCalled();
    await rendered.rerender({ ...props, controlledPlaceView: 'atlas' });
    expect(getByText('Your atlas starts with a place')).toBeInTheDocument();
    await rendered.rerender({ ...props, controlledPlaceView: 'gps' });
    expect(getByRole('heading', { name: 'Turn photo locations into Geography' })).toBeInTheDocument();
    await waitFor(() => expect(mocks.getMapMarkers).toHaveBeenCalledOnce());

    await rendered.rerender({ ...props, controlledPlaceView: 'geography' });
    expect(getByText('No geography yet')).toBeInTheDocument();
    await rendered.rerender({ ...props, controlledPlaceView: 'locations' });
    expect(getByText('No locations yet')).toBeInTheDocument();
    await rendered.rerender({ ...props, controlledPlaceView: 'gps' });
    expect(getByRole('heading', { name: 'Turn photo locations into Geography' })).toBeInTheDocument();
    expect(mocks.getMapMarkers).toHaveBeenCalledOnce();

    await fireEvent.click(getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(mocks.getMapMarkers).toHaveBeenCalledTimes(2));
  });

  it('wraps a Place, cover photo and all, in a link to that place', () => {
    const { getByTestId } = render(CimmichContextCollection, {
      entities: [
        entity({
          coverAssetId: 'asset_cover',
          displayName: "Parent's Home",
          entityId: 'place_home',
          entityKind: 'place',
          typeKind: 'point',
        }),
      ],
      entityHref,
      family: 'places',
      onAdd: vi.fn(),
      onOpen: vi.fn(),
    });

    // The whole card is the link, so the cover is inside it rather than carrying
    // its own click handler. Clicking the photo still opens the place, and now
    // cmd-click opens it in a new tab.
    const cover = getByTestId('cimmich-place-cover-place_home');
    const card = cover.closest('a');
    expect(card).not.toBeNull();
    expect(card).toHaveAttribute('href', '/cimmich/test/place_home');
  });

  it('separates Locations from Geography and keeps geographic duplicate and sort views', async () => {
    const onAdd = vi.fn();
    const props = {
      controlledPlaceGroupMode: 'country' as 'country' | 'duplicates' | 'none',
      controlledPlaceSortMode: 'name' as 'name' | 'photos-asc' | 'photos-desc',
      controlledPlaceView: 'locations' as 'atlas' | 'geography' | 'gps' | 'locations',
      entities: [
        entity({
          assetCount: 15,
          displayName: 'Zagreb, Croatia',
          entityId: 'place_zagreb_point',
          entityKind: 'place',
          placeRole: 'geography',
          typeKind: 'point',
        }),
        entity({
          assetCount: 16,
          displayName: 'Zagreb, Croatia',
          entityId: 'place_zagreb_area',
          entityKind: 'place',
          placeRole: 'geography',
          typeKind: 'area',
        }),
        entity({
          assetCount: 3,
          displayName: "Parent's Home",
          entityId: 'place_home',
          entityKind: 'place',
          placeRole: 'location',
          typeKind: 'point',
        }),
      ],
      entityHref,
      family: 'places' as const,
      geographyGroupHref: (groupName: string) =>
        `/cimmich/places/${encodeURIComponent(groupName)}?geographyGroup=${encodeURIComponent(groupName)}`,
      onAdd,
      onOpen: vi.fn(),
    };
    const rendered = render(CimmichContextCollection, props);
    const { getAllByRole, getByRole, getByText, queryByText } = rendered;

    expect(getByRole('heading', { name: /^No geography set$/ })).toBeInTheDocument();
    expect(getByText("Parent's Home")).toBeInTheDocument();
    expect(queryByText('Each name is unique')).not.toBeInTheDocument();
    expect(queryByText('Zagreb, Croatia')).not.toBeInTheDocument();

    await rendered.rerender({ ...props, controlledPlaceView: 'geography' });
    expect(getByRole('heading', { name: /^Croatia$/ })).toBeInTheDocument();
    expect(getByRole('link', { name: 'Croatia' })).toHaveAttribute(
      'href',
      '/cimmich/places/Croatia?geographyGroup=Croatia',
    );
    await fireEvent.click(getByRole('button', { name: 'Add subdivision in Croatia' }));
    expect(onAdd).toHaveBeenCalledWith('geography', '', 'Croatia');

    await rendered.rerender({
      ...props,
      controlledPlaceGroupMode: 'duplicates',
      controlledPlaceView: 'geography',
    });
    await waitFor(() => expect(getByText('2 saved records need consolidation')).toBeInTheDocument());
    expect(queryByText("Parent's Home")).not.toBeInTheDocument();

    await rendered.rerender({
      ...props,
      controlledPlaceGroupMode: 'duplicates',
      controlledPlaceSortMode: 'photos-desc',
      controlledPlaceView: 'geography',
    });
    await waitFor(() =>
      expect(getAllByRole('link', { name: /Zagreb, Croatia/ }).map((link) => link.getAttribute('href'))).toEqual([
        '/cimmich/test/place_zagreb_area',
        '/cimmich/test/place_zagreb_point',
      ]),
    );
  });

  it('keeps nested-only subplaces out of the main directory while preserving subtree totals', () => {
    const places = [
      entity({
        assetCount: 3,
        childCount: 1,
        displayName: "Parent's Home",
        entityId: 'place_home',
        entityKind: 'place',
        subtreeAssetCount: 12,
        typeKind: 'property',
      }),
      entity({
        assetCount: 9,
        directoryVisibility: 'nested_only',
        displayName: 'Yard',
        entityId: 'place_yard',
        entityKind: 'place',
        parentEntityId: 'place_home',
        subtreeAssetCount: 9,
        typeKind: 'unlocated',
      }),
    ];
    const main = render(CimmichContextCollection, {
      entities: places,
      entityHref,
      family: 'places',
      onAdd: vi.fn(),
      onOpen: vi.fn(),
    });

    expect(main.getByRole('link', { name: /Parent's Home/ })).toHaveTextContent('12 photos');
    expect(main.getByRole('link', { name: /Parent's Home/ })).toHaveTextContent('1 subplace');
    expect(main.queryByRole('link', { name: /Yard/ })).not.toBeInTheDocument();
    main.unmount();

    const search = render(CimmichContextCollection, {
      entities: places,
      entityHref,
      family: 'places',
      includeNestedPlaces: true,
      onAdd: vi.fn(),
      onOpen: vi.fn(),
    });
    expect(search.getByRole('link', { name: /Yard/ })).toBeInTheDocument();
  });
});

describe('Cimmich context detail hero', () => {
  it('makes an Event a dated media identity rather than a generic record summary', () => {
    const event = entity({
      aliases: ['The big trip'],
      assetCount: 12,
      dateEnd: '2024-07-12',
      datePrecision: 'exact',
      dateStart: '2024-07-01',
      description: 'A week across Corfu.',
      displayName: 'Corfu trip',
      entityId: 'event_trip',
      entityKind: 'event',
      typeKind: 'trip',
    });
    const detail: CimmichContextDetail = {
      assets: [],
      entity: event,
      relations: [],
      schemaVersion: 'cimmich.context-entity.v1',
    };
    const { getByRole, getByText, queryByText } = render(CimmichContextDetailHero, {
      detail,
      entities: [event],
      family: 'events',
    });

    expect(getByRole('heading', { name: 'Corfu trip' })).toBeInTheDocument();
    // Description, date and other names now share one metadata line under the
    // name, so these are substring matches against that single line.
    expect(getByText(/A week across Corfu\./)).toBeInTheDocument();
    expect(getByText(/The big trip/)).toBeInTheDocument();
    // An Event's date is genuinely only available here, so it must survive.
    expect(getByText(/2024/)).toBeInTheDocument();
    // The media count deliberately does NOT appear: the tab rail beneath this
    // hero already renders "Photos 12", and printing it twice is what made the
    // copy column spend 93px on two integers. Asserted as an absence so the
    // count tiles cannot quietly come back.
    expect(queryByText('12')).toBeNull();
  });
});
