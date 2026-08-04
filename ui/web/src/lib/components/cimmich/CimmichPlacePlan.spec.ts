import '@testing-library/jest-dom';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import type { CimmichContextEntity } from '$lib/services/cimmich.service';
import CimmichPlacePlan from './CimmichPlacePlan.svelte';

const place = (overrides: Partial<CimmichContextEntity>): CimmichContextEntity => ({
  aliases: [],
  assetCount: 0,
  coverAssetId: null,
  dateEnd: null,
  datePrecision: 'unknown',
  dateStart: null,
  description: null,
  displayName: 'Example location',
  entityId: 'place_example',
  entityKind: 'place',
  geometry: null,
  parentEntityId: null,
  revision: 1,
  status: 'active',
  typeKind: 'unlocated',
  ...overrides,
});

describe('CimmichPlacePlan', () => {
  it('lets a keyboard user place, move, resize, and save a Location', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { getByRole } = render(CimmichPlacePlan, {
      children: [place({ displayName: 'Kitchen', entityId: 'place_kitchen' })],
      onCreateSublocation: vi.fn(),
      onOpenPlace: vi.fn(),
      onSave,
      parent: place({ displayName: 'Home', entityId: 'place_home' }),
      plans: [],
    });

    await fireEvent.click(getByRole('button', { name: /Blank property/ }));
    await fireEvent.click(getByRole('button', { name: 'Place Kitchen in the centre' }));
    const zone = getByRole('button', { name: /Kitchen, drag to move/ });
    await fireEvent.keyDown(zone, { key: 'ArrowRight' });
    await fireEvent.keyDown(zone, { key: 'ArrowDown', shiftKey: true });
    await fireEvent.click(getByRole('button', { name: 'Save plan' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            childEntityId: 'place_kitchen',
            geometry: { h: 0.32, kind: 'rect', w: 0.3, x: 0.37, y: 0.35 },
          }),
        ],
      }),
    );
  });
});
