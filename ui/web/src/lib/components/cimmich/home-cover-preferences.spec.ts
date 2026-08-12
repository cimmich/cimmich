import { describe, expect, it } from 'vitest';
import {
  CIMMICH_HOME_COVER_STORAGE_KEY,
  chooseCimmichHomeRandomAssetId,
  chooseCimmichHomeRotatingAssetId,
  loadCimmichHomeCoverPreferences,
  normalizeCimmichHomeCoverPreference,
  resolveCimmichHomeCoverAssetIds,
  saveCimmichHomeCoverPreference,
} from './home-cover-preferences';

const storage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  };
};

describe('Cimmich Home cover preferences', () => {
  it('keeps cover choices isolated by viewing mode', () => {
    const target = storage();
    saveCimmichHomeCoverPreference(target, 'private', 'hero', {
      assetIds: ['private-photo'],
      mode: 'single',
      randomScope: 'section',
    });

    expect(loadCimmichHomeCoverPreferences(target, 'private').hero?.assetIds).toEqual(['private-photo']);
    expect(loadCimmichHomeCoverPreferences(target, 'standard')).toEqual({});
    expect(JSON.parse(target.values.get(CIMMICH_HOME_COVER_STORAGE_KEY) ?? '{}').schemaVersion).toBe(
      'cimmich.home-covers.v1',
    );
  });

  it('deduplicates groups and caps them at six photos', () => {
    expect(
      normalizeCimmichHomeCoverPreference({
        assetIds: ['a', 'b', 'a', 'c', 'd', 'e', 'f', 'g'],
        mode: 'group',
        randomScope: 'library',
      }),
    ).toEqual({ assetIds: ['a', 'b', 'c', 'd', 'e', 'f'], mode: 'group', randomScope: 'library' });
  });

  it('rejects incomplete manual choices and malformed asset ids', () => {
    expect(normalizeCimmichHomeCoverPreference({ assetIds: [], mode: 'single' })).toBeNull();
    expect(normalizeCimmichHomeCoverPreference({ assetIds: ['one'], mode: 'group' })).toBeNull();
    expect(normalizeCimmichHomeCoverPreference({ assetIds: ['../secret'], mode: 'single' })).toBeNull();
  });

  it('restores automatic selection by removing the saved slot', () => {
    const target = storage();
    saveCimmichHomeCoverPreference(target, 'private', 'people', {
      assetIds: ['person-photo'],
      mode: 'single',
      randomScope: 'section',
    });
    const result = saveCimmichHomeCoverPreference(target, 'private', 'people', {
      assetIds: [],
      mode: 'automatic',
      randomScope: 'section',
    });
    expect(result.people).toBeUndefined();
  });

  it('resolves manual, random and automatic asset lists without mutating input', () => {
    const automatic = ['automatic-one', 'automatic-two'];
    expect(resolveCimmichHomeCoverAssetIds(automatic, undefined, null)).toEqual(automatic);
    expect(
      resolveCimmichHomeCoverAssetIds(
        automatic,
        { assetIds: ['manual'], mode: 'single', randomScope: 'section' },
        null,
      ),
    ).toEqual(['manual']);
    expect(
      resolveCimmichHomeCoverAssetIds(automatic, { assetIds: [], mode: 'random', randomScope: 'library' }, 'random'),
    ).toEqual(['random']);
    expect(automatic).toEqual(['automatic-one', 'automatic-two']);
  });

  it('selects a bounded random item from distinct candidates', () => {
    expect(chooseCimmichHomeRandomAssetId(['a', 'a', 'b', 'c'], 0)).toBe('a');
    expect(chooseCimmichHomeRandomAssetId(['a', 'b', 'c'], 0.99)).toBe('c');
    expect(chooseCimmichHomeRandomAssetId([], 0.5)).toBeNull();
  });

  it('rotates through a selected group and wraps safely', () => {
    expect(chooseCimmichHomeRotatingAssetId(['a', 'b', 'c'], 0)).toBe('a');
    expect(chooseCimmichHomeRotatingAssetId(['a', 'b', 'c'], 4)).toBe('b');
    expect(chooseCimmichHomeRotatingAssetId(['a', 'b', 'c'], -1)).toBe('c');
    expect(chooseCimmichHomeRotatingAssetId(['a', 'b'], Number.NaN)).toBe('a');
    expect(chooseCimmichHomeRotatingAssetId([], 2)).toBeNull();
  });
});
