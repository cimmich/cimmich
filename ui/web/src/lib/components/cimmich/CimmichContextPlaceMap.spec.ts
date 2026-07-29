import '@testing-library/jest-dom';
import { render, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { CimmichContextAsset, CimmichContextDetail } from '$lib/services/cimmich.service';
import CimmichContextPlaceMap from './CimmichContextPlaceMap.svelte';

const mocks = vi.hoisted(() => ({
  getMapMarkers: vi.fn(),
}));

vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal()),
  getMapMarkers: mocks.getMapMarkers,
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

// The inline map itself is out of scope: MapLibre cannot mount in jsdom and
// the panel's marker loading happens before the dynamic import resolves.
vi.mock('$lib/components/shared-components/map/Map.svelte', () => ({
  default: () => ({}),
}));

const asset = (overrides: Partial<CimmichContextAsset> = {}): CimmichContextAsset => ({
  assetId: 'asset-1',
  associationId: 'association-1',
  associationKind: 'depicts',
  captureTime: '2024-05-04T12:00:00.000Z',
  filename: 'photo.jpg',
  height: 3000,
  linkedAt: '2024-05-05T12:00:00.000Z',
  mediaKind: 'image',
  mimeType: 'image/jpeg',
  sourceAssetId: 'source-1',
  width: 4000,
  ...overrides,
});

const detail = (assets: CimmichContextAsset[]): CimmichContextDetail => ({
  assets,
  entity: {
    aliases: [],
    assetCount: assets.length,
    coverAssetId: null,
    dateEnd: null,
    datePrecision: 'unknown',
    dateStart: null,
    description: null,
    displayName: 'Lighthouse',
    entityId: 'place_lighthouse',
    entityKind: 'place',
    geometry: null,
    parentEntityId: null,
    revision: 1,
    status: 'active',
    typeKind: 'other',
  },
  relations: [],
  schemaVersion: 'cimmich.context-entity.v1',
});

describe('CimmichContextPlaceMap linked markers', () => {
  it('scopes the marker download to the linked capture window and skips identity-only changes', async () => {
    mocks.getMapMarkers.mockResolvedValue([
      { city: null, country: null, id: 'source-1', lat: 1, lon: 2, state: null },
      { city: null, country: null, id: 'source-unrelated', lat: 5, lon: 6, state: null },
    ]);
    const first = detail([
      asset({ captureTime: '2024-05-04T12:00:00.000Z', sourceAssetId: 'source-1' }),
      asset({
        assetId: 'asset-2',
        associationId: 'association-2',
        captureTime: '2024-05-06T12:00:00.000Z',
        sourceAssetId: 'source-2',
      }),
    ]);
    const { rerender } = render(CimmichContextPlaceMap, { detail: first });

    await waitFor(() => expect(mocks.getMapMarkers).toHaveBeenCalledTimes(1));
    expect(mocks.getMapMarkers).toHaveBeenCalledWith({
      fileCreatedAfter: '2024-05-03T12:00:00.000Z',
      fileCreatedBefore: '2024-05-07T12:00:00.000Z',
    });

    // A fresh detail object with the same linked assets (post-mutation server
    // response) must not re-download the markers.
    await rerender({ detail: detail(first.assets.map((item) => ({ ...item }))) });
    expect(mocks.getMapMarkers).toHaveBeenCalledTimes(1);

    // A genuinely different asset list refetches.
    await rerender({
      detail: detail([asset({ captureTime: '2024-05-04T12:00:00.000Z', sourceAssetId: 'source-3' })]),
    });
    await waitFor(() => expect(mocks.getMapMarkers).toHaveBeenCalledTimes(2));
  });

  it('falls back to the unbounded query when a linked capture time is unknown', async () => {
    mocks.getMapMarkers.mockClear();
    mocks.getMapMarkers.mockResolvedValue([]);
    render(CimmichContextPlaceMap, {
      detail: detail([asset({ captureTime: null, sourceAssetId: 'source-9' })]),
    });

    await waitFor(() => expect(mocks.getMapMarkers).toHaveBeenCalledTimes(1));
    expect(mocks.getMapMarkers).toHaveBeenCalledWith({});
  });
});
