import '@testing-library/jest-dom';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import type { CimmichContextDetail, CimmichContextEntity } from '$lib/services/cimmich.service';
import CimmichContextCollection from './CimmichContextCollection.svelte';
import CimmichContextDetailHero from './CimmichContextDetailHero.svelte';

const mocks = vi.hoisted(() => ({
  getMapMarkers: vi.fn().mockResolvedValue([]),
  getVisibleMapAssetIds: vi.fn().mockResolvedValue(new Set<string>()),
}));

vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal()),
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

  it('renders Events as a compact newest-first photo collection', () => {
    const { getAllByRole, getByTestId, getByText, queryByRole } = render(CimmichContextCollection, {
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

    expect(queryByRole('heading', { name: '2024' })).not.toBeInTheDocument();
    expect(queryByRole('heading', { name: '2023' })).not.toBeInTheDocument();
    expect(getByText('Corfu trip')).toBeInTheDocument();
    expect(getByText('Summer football')).toBeInTheDocument();
    expect(getByTestId('cimmich-event-contact-sheet').querySelectorAll('img')).toHaveLength(4);
    expect(getAllByRole('link', { name: /Corfu trip|Summer football/ }).map((card) => card.textContent)).toEqual([
      expect.stringContaining('Corfu trip'),
      expect.stringContaining('Summer football'),
    ]);
  });

  it('starts Places in the photographic view while keeping the Map adjacent', async () => {
    const onAdd = vi.fn();
    const { getByRole, getByText } = render(CimmichContextCollection, {
      entities: [],
      entityHref,
      family: 'places',
      onAdd,
      onOpen: vi.fn(),
    });

    expect(getByRole('button', { name: 'Places' })).toHaveAttribute('aria-pressed', 'true');
    expect(getByRole('button', { name: 'Map' })).toHaveAttribute('aria-pressed', 'false');
    expect(getByRole('button', { name: 'GPS' })).toHaveAttribute('aria-pressed', 'false');
    expect(getByText('No places yet')).toBeInTheDocument();
    expect(mocks.getMapMarkers).not.toHaveBeenCalled();
    await fireEvent.click(getByRole('button', { name: 'Map' }));
    expect(getByText('Your atlas starts with a place')).toBeInTheDocument();
    await fireEvent.click(getByRole('button', { name: 'GPS' }));
    expect(getByRole('heading', { name: 'Turn photo locations into Places' })).toBeInTheDocument();
    await waitFor(() => expect(mocks.getMapMarkers).toHaveBeenCalledOnce());

    await fireEvent.click(getByRole('button', { name: 'Places' }));
    expect(getByText('No places yet')).toBeInTheDocument();
    await fireEvent.click(getByRole('button', { name: 'GPS' }));
    expect(getByRole('heading', { name: 'Turn photo locations into Places' })).toBeInTheDocument();
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
    // its own click handler — clicking the photo still opens the place, and now
    // cmd-click opens it in a new tab.
    const cover = getByTestId('cimmich-place-cover-place_home');
    const card = cover.closest('a');
    expect(card).not.toBeNull();
    expect(card).toHaveAttribute('href', '/cimmich/test/place_home');
  });

  it('groups the Places directory by country and exposes duplicate and sort views', async () => {
    const { getAllByRole, getByLabelText, getByRole, getByText, queryByText } = render(CimmichContextCollection, {
      entities: [
        entity({
          assetCount: 15,
          displayName: 'Zagreb, Croatia',
          entityId: 'place_zagreb_point',
          entityKind: 'place',
          typeKind: 'point',
        }),
        entity({
          assetCount: 16,
          displayName: 'Zagreb, Croatia',
          entityId: 'place_zagreb_area',
          entityKind: 'place',
          typeKind: 'area',
        }),
        entity({
          assetCount: 3,
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

    expect(getByRole('heading', { name: /^Croatia$/ })).toBeInTheDocument();
    expect(getByRole('heading', { name: /^Personal & named places$/ })).toBeInTheDocument();
    expect(getByText('1 repeated name')).toBeInTheDocument();

    await fireEvent.change(getByLabelText('Group places'), { target: { value: 'duplicates' } });
    await waitFor(() => expect(getByText('2 saved records need consolidation')).toBeInTheDocument());
    expect(queryByText("Parent's Home")).not.toBeInTheDocument();

    await fireEvent.change(getByLabelText('Sort places'), { target: { value: 'photos-desc' } });
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
