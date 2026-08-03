import { describe, expect, it } from 'vitest';
import { filterTagOptions, intersectAssetIds, normalTagOptions, type TagBrowserOption } from './tag-browser';

const options: TagBrowserOption[] = [
  {
    aliases: ['Manila holiday'],
    assetCount: 120,
    coverAssetId: 'asset-1',
    entityId: 'event-1',
    family: 'events',
    id: 'events:event-1',
    label: 'Manila Trip',
  },
  {
    aliases: [],
    assetCount: 48,
    coverAssetId: 'asset-2',
    entityId: 'place-1',
    family: 'places',
    id: 'places:place-1',
    label: 'Pink Palace',
  },
];

describe('tag browser', () => {
  it('searches labels and aliases while respecting the family filter', () => {
    expect(filterTagOptions(options, 'holiday')).toEqual([options[0]]);
    expect(filterTagOptions(options, '', 'places')).toEqual([options[1]]);
    expect(filterTagOptions(options, 'pink', 'events')).toEqual([]);
  });

  it('returns the unique intersection for multi-tag results', () => {
    expect(
      intersectAssetIds([
        ['a', 'b', 'c', 'c'],
        ['b', 'c', 'd'],
        ['c', 'e'],
      ]),
    ).toEqual(['c']);
    expect(intersectAssetIds([])).toEqual([]);
  });

  it('turns the normal hierarchy into a searchable flat directory', () => {
    const result = normalTagOptions([
      { color: '#fff', createdAt: '', id: '2', name: 'June', parentId: '1', updatedAt: '', value: 'Trips/June' },
      { createdAt: '', id: '1', name: 'Trips', updatedAt: '', value: 'Trips' },
    ]);
    expect(result.map((option) => option.label)).toEqual(['Trips', 'Trips/June']);
    expect(result[1]).toMatchObject({ family: 'normal', normalTagId: '2' });
  });
});
