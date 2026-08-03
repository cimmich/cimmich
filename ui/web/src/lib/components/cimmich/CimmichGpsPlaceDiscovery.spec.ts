import '@testing-library/jest-dom';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import type { CimmichContextEntity, CimmichContextMutationResult } from '$lib/services/cimmich.service';
import CimmichGpsPlaceDiscovery from './CimmichGpsPlaceDiscovery.svelte';

const mocks = vi.hoisted(() => ({
  attachAssets: vi.fn(),
  createEntity: vi.fn(),
  getMapMarkers: vi.fn(),
  getVisibleMapAssetBindings: vi.fn(),
  getVisibleMapAssetIds: vi.fn(),
}));

vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal()),
  getMapMarkers: mocks.getMapMarkers,
}));

vi.mock('$lib/services/cimmich.service', async (importOriginal) => ({
  ...(await importOriginal()),
  attachCimmichContextAssets: mocks.attachAssets,
  createCimmichGpsPlaceEntity: mocks.createEntity,
  getCimmichVisibleMapAssetBindings: mocks.getVisibleMapAssetBindings,
  getCimmichVisibleMapAssetIds: mocks.getVisibleMapAssetIds,
}));

vi.mock('$lib/utils', async (importOriginal) => ({
  ...(await importOriginal()),
  getAssetMediaUrl: () => 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
}));

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

const mutation = (entity: CimmichContextEntity): CimmichContextMutationResult => ({
  commandId: 'context.command',
  decisionId: 'decision-1',
  detail: {
    assets: [],
    entity,
    relations: [],
    schemaVersion: 'cimmich.context-entity.v1',
  },
  replayed: false,
  schemaVersion: 'cimmich.context-entity.v1',
  status: 'applied',
  undo: { eligible: true, token: 'undo-token' },
});

describe('Cimmich GPS Place discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('visibility-filters GPS evidence and does not mutate until explicit promotion', async () => {
    mocks.getMapMarkers.mockResolvedValue([
      {
        city: 'Sydney',
        country: 'Australia',
        id: 'source-a',
        lat: -33.86,
        lon: 151.21,
        state: 'New South Wales',
      },
      {
        city: 'Sydney',
        country: 'Australia',
        id: 'source-b',
        lat: -33.8601,
        lon: 151.2101,
        state: 'New South Wales',
      },
      { city: 'Hidden', country: null, id: 'source-hidden', lat: -33.86, lon: 151.21, state: null },
    ]);
    mocks.getVisibleMapAssetIds.mockResolvedValue(new Set(['source-a', 'source-b']));
    mocks.getVisibleMapAssetBindings.mockResolvedValue(
      new Map([
        ['source-a', 'internal-source-a'],
        ['source-b', 'internal-source-b'],
      ]),
    );

    const { getByRole, getByText, queryByText } = render(CimmichGpsPlaceDiscovery, {
      entities: [place()],
    });

    await waitFor(() => expect(getByText('Sydney, New South Wales, Australia')).toBeInTheDocument());
    expect(queryByText('Hidden')).not.toBeInTheDocument();
    expect(getByText('209 m').parentElement).toHaveTextContent('Near Circular Quay');
    expect(mocks.createEntity).not.toHaveBeenCalled();
    expect(mocks.attachAssets).not.toHaveBeenCalled();
    expect(getByRole('button', { name: /Create Geography/ })).toBeEnabled();
  });

  it('creates a named Place and attaches the group only after confirmation', async () => {
    const created = place({ displayName: 'Harbour walk', entityId: 'place_created' });
    mocks.getMapMarkers.mockResolvedValue([
      { city: 'Sydney', country: 'Australia', id: 'source-a', lat: -33.86, lon: 151.21, state: null },
      { city: 'Sydney', country: 'Australia', id: 'source-b', lat: -33.8601, lon: 151.2101, state: null },
    ]);
    mocks.getVisibleMapAssetIds.mockResolvedValue(new Set(['source-a', 'source-b']));
    mocks.getVisibleMapAssetBindings.mockResolvedValue(
      new Map([
        ['source-a', 'internal-source-a'],
        ['source-b', 'internal-source-b'],
      ]),
    );
    mocks.createEntity.mockResolvedValue(mutation(created));
    mocks.attachAssets.mockResolvedValue(mutation(created));
    const onPlacesChanged = vi.fn();

    const { getByLabelText, getByRole, getByText } = render(CimmichGpsPlaceDiscovery, {
      entities: [],
      onPlacesChanged,
    });
    await waitFor(() => expect(getByText('Sydney, Australia')).toBeInTheDocument());
    await fireEvent.input(getByLabelText('New Geography name'), { target: { value: 'Harbour walk' } });
    await fireEvent.click(getByRole('button', { name: /Create Geography/ }));

    await waitFor(() => expect(mocks.attachAssets).toHaveBeenCalledTimes(1));
    expect(mocks.createEntity).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'Harbour walk', typeKind: 'point' }),
    );
    expect(mocks.attachAssets).toHaveBeenCalledWith('places', 'place_created', expect.any(String), [
      { assetId: 'internal-source-a', associationKind: 'captured_at' },
      { assetId: 'internal-source-b', associationKind: 'captured_at' },
    ]);
    expect(onPlacesChanged).toHaveBeenCalledOnce();
  });

  it('continues an exact-name locality instead of offering a duplicate Place', async () => {
    const zagreb = place({
      assetCount: 16,
      displayName: 'Zagreb, Croatia',
      entityId: 'place_zagreb',
      geometry: { east: 16.03, north: 45.84, south: 45.81, west: 16 },
      typeKind: 'area',
    });
    mocks.getMapMarkers.mockResolvedValue([
      { city: 'Zagreb', country: 'Croatia', id: 'source-a', lat: 45.817, lon: 16.004, state: null },
      { city: 'Zagreb', country: 'Croatia', id: 'source-b', lat: 45.83, lon: 16.02, state: null },
    ]);
    mocks.getVisibleMapAssetIds.mockResolvedValue(new Set(['source-a', 'source-b']));
    mocks.getVisibleMapAssetBindings.mockResolvedValue(
      new Map([
        ['source-a', 'internal-source-a'],
        ['source-b', 'internal-source-b'],
      ]),
    );
    mocks.attachAssets.mockResolvedValue(mutation(zagreb));

    const { getByRole, getByText, queryByRole } = render(CimmichGpsPlaceDiscovery, { entities: [zagreb] });

    await waitFor(() => expect(getByText('Continuing in')).toHaveTextContent('Zagreb, Croatia'));
    expect(queryByRole('button', { name: /Create Geography/ })).not.toBeInTheDocument();
    await fireEvent.click(getByRole('button', { name: 'Add photos to Zagreb, Croatia' }));

    await waitFor(() => expect(mocks.attachAssets).toHaveBeenCalledOnce());
    expect(mocks.createEntity).not.toHaveBeenCalled();
    expect(mocks.attachAssets).toHaveBeenCalledWith('places', 'place_zagreb', expect.any(String), [
      { assetId: 'internal-source-a', associationKind: 'captured_at' },
      { assetId: 'internal-source-b', associationKind: 'captured_at' },
    ]);
  });

  it('keeps a large location together and advances it through bounded review packs', async () => {
    const created = place({ displayName: 'Cedar House', entityId: 'place_cedar_house' });
    mocks.getMapMarkers.mockResolvedValue(
      Array.from({ length: 501 }, (_, index) => ({
        city: 'Káto Garoúna',
        country: 'Greece',
        id: `source-${index}`,
        lat: 39.56,
        lon: 19.84,
        state: 'Ionian Islands',
      })),
    );
    mocks.getVisibleMapAssetIds.mockResolvedValue(
      new Set(Array.from({ length: 501 }, (_, index) => `source-${index}`)),
    );
    mocks.getVisibleMapAssetBindings.mockImplementation(
      (sourceAssetIds: string[]) =>
        new Map(sourceAssetIds.map((sourceAssetId) => [sourceAssetId, `internal-${sourceAssetId}`])),
    );
    mocks.createEntity.mockResolvedValue(mutation(created));
    mocks.attachAssets.mockResolvedValue(mutation(created));

    const { getByLabelText, getByRole, getByText, queryByRole } = render(CimmichGpsPlaceDiscovery, { entities: [] });

    await waitFor(() =>
      expect(getByRole('heading', { name: 'Large locations are split into review packs' })).toBeInTheDocument(),
    );
    expect(getByText('Review pack 1 of 2 · 500 photos')).toBeInTheDocument();
    expect(getByText('500 / 501')).toBeInTheDocument();
    await fireEvent.input(getByLabelText('New Geography name'), { target: { value: 'Cedar House' } });
    await fireEvent.click(getByRole('button', { name: /Create Geography/ }));

    await waitFor(() => expect(mocks.attachAssets).toHaveBeenCalledTimes(5));
    expect(mocks.attachAssets.mock.calls.every((call) => call[3].length <= 100)).toBe(true);
    expect(mocks.attachAssets.mock.calls.flatMap((call) => call[3])).toHaveLength(500);
    expect(getByText('Review pack 2 of 2 · 1 photo')).toBeInTheDocument();
    expect(getByText('Continuing in')).toHaveTextContent('Cedar House');
    expect(queryByRole('button', { name: /Create Geography/ })).not.toBeInTheDocument();
    expect(getByRole('button', { name: 'Add photos to Cedar House' })).toBeEnabled();
  });

  it('does not create a Place when every photo cannot be preflighted', async () => {
    mocks.getMapMarkers.mockResolvedValue([
      { city: 'Sydney', country: 'Australia', id: 'source-a', lat: -33.86, lon: 151.21, state: null },
      { city: 'Sydney', country: 'Australia', id: 'source-b', lat: -33.8601, lon: 151.2101, state: null },
    ]);
    mocks.getVisibleMapAssetIds.mockResolvedValue(new Set(['source-a', 'source-b']));
    mocks.getVisibleMapAssetBindings.mockResolvedValue(new Map([['source-a', 'internal-source-a']]));

    const { getByRole, getByText } = render(CimmichGpsPlaceDiscovery, { entities: [] });
    await waitFor(() => expect(getByText('Sydney, Australia')).toBeInTheDocument());
    await fireEvent.click(getByRole('button', { name: /Create Geography/ }));

    await waitFor(() => expect(getByText(/1 photo is no longer available/)).toBeInTheDocument());
    expect(mocks.createEntity).not.toHaveBeenCalled();
    expect(mocks.attachAssets).not.toHaveBeenCalled();
  });
});
