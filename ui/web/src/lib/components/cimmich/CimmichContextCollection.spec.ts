import '@testing-library/jest-dom';
import { fireEvent, render } from '@testing-library/svelte';
import type { CimmichContextDetail, CimmichContextEntity } from '$lib/services/cimmich.service';
import CimmichContextCollection from './CimmichContextCollection.svelte';
import CimmichContextDetailHero from './CimmichContextDetailHero.svelte';

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

describe('Cimmich context collections', () => {
  it('presents Things as durable identities and filters without changing the object contract', async () => {
    const onOpen = vi.fn();
    const { getByRole, getByText, queryByRole } = render(CimmichContextCollection, {
      description: 'Particular things with history.',
      entities: [
        entity({ assetCount: 1, displayName: 'Campervan', entityId: 'object_vehicle', typeKind: 'vehicle' }),
        entity({ displayName: 'Old camera', entityId: 'object_device', typeKind: 'device' }),
      ],
      family: 'objects',
      onAdd: vi.fn(),
      onOpen,
    });

    expect(getByRole('button', { name: /Campervan/ })).toBeInTheDocument();
    expect(getByText('2 things')).toBeInTheDocument();
    expect(getByText('1 photo')).toBeInTheDocument();
    await fireEvent.click(getByRole('button', { name: 'Devices' }));
    expect(queryByRole('button', { name: /Campervan/ })).not.toBeInTheDocument();
    await fireEvent.click(getByRole('button', { name: /Old camera/ }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'object_device' }));
  });

  it('renders Events as a newest-first year timeline with distinct temporal shapes', () => {
    const { getByRole, getByTestId, getByText } = render(CimmichContextCollection, {
      description: 'Moments and longer chapters.',
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
      family: 'events',
      onAdd: vi.fn(),
      onOpen: vi.fn(),
    });

    expect(getByRole('heading', { name: '2024' })).toBeInTheDocument();
    expect(getByRole('heading', { name: '2023' })).toBeInTheDocument();
    expect(getByText('Corfu trip')).toBeInTheDocument();
    expect(getByText('Summer football')).toBeInTheDocument();
    expect(getByTestId('cimmich-event-contact-sheet').querySelectorAll('img')).toHaveLength(4);
  });

  it('starts Places in the photographic view while keeping the Map adjacent', async () => {
    const onAdd = vi.fn();
    const { getByRole, getByText } = render(CimmichContextCollection, {
      description: 'Your locations.',
      entities: [],
      family: 'places',
      onAdd,
      onOpen: vi.fn(),
    });

    expect(getByRole('button', { name: 'Places' })).toHaveAttribute('aria-pressed', 'true');
    expect(getByRole('button', { name: 'Map' })).toHaveAttribute('aria-pressed', 'false');
    expect(getByText('No places yet')).toBeInTheDocument();
    await fireEvent.click(getByRole('button', { name: 'Map' }));
    expect(getByText('Your atlas starts with a place')).toBeInTheDocument();
  });

  it('opens a Place when its cover photo is clicked', async () => {
    const onOpen = vi.fn();
    const { getByTestId } = render(CimmichContextCollection, {
      description: 'Your locations.',
      entities: [
        entity({
          coverAssetId: 'asset_cover',
          displayName: "Parent's Home",
          entityId: 'place_home',
          entityKind: 'place',
          typeKind: 'point',
        }),
      ],
      family: 'places',
      onAdd: vi.fn(),
      onOpen,
    });

    const cover = getByTestId('cimmich-place-cover-place_home');
    await fireEvent.click(cover);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'place_home' }));
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
    const { getByRole, getByText } = render(CimmichContextDetailHero, {
      detail,
      entities: [event],
      family: 'events',
    });

    expect(getByRole('heading', { name: 'Corfu trip' })).toBeInTheDocument();
    expect(getByText('A week across Corfu.')).toBeInTheDocument();
    expect(getByText('The big trip')).toBeInTheDocument();
    expect(getByText('12')).toBeInTheDocument();
    expect(getByText(/2024/)).toBeInTheDocument();
  });
});
