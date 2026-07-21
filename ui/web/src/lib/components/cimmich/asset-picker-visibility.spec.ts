import { describe, expect, it, vi } from 'vitest';
import { filterVisibleCimmichAssets } from './asset-picker-visibility';

describe('filterVisibleCimmichAssets', () => {
  it('keeps only admitted assets in their original order', async () => {
    const assets = [{ id: 'visible-a' }, { id: 'hidden' }, { id: 'visible-b' }];
    const canRead = vi.fn((id: string) => {
      if (id === 'hidden') {
        return Promise.reject(new Error('not visible'));
      }
      return Promise.resolve();
    });

    await expect(filterVisibleCimmichAssets(assets, canRead, 2)).resolves.toEqual([
      { id: 'visible-a' },
      { id: 'visible-b' },
    ]);
    expect(canRead).toHaveBeenCalledTimes(3);
  });

  it('does not exceed the requested admission concurrency', async () => {
    let active = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    const assets = Array.from({ length: 6 }, (_, index) => ({ id: `asset-${index}` }));
    const canRead = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          active += 1;
          peak = Math.max(peak, active);
          release.push(() => {
            active -= 1;
            resolve();
          });
        }),
    );

    const result = filterVisibleCimmichAssets(assets, canRead, 2);
    while (release.length < 2) {
      await Promise.resolve();
    }
    while (release.length > 0 || active > 0) {
      release.shift()?.();
      await Promise.resolve();
    }

    await expect(result).resolves.toEqual(assets);
    expect(peak).toBe(2);
  });

  it('returns an empty list without invoking admission for an empty source', async () => {
    const canRead = vi.fn();
    await expect(filterVisibleCimmichAssets([], canRead)).resolves.toEqual([]);
    expect(canRead).not.toHaveBeenCalled();
  });
});
