import { describe, expect, it } from 'vitest';
import {
  cimmichExploreFilterCount,
  cimmichExploreFiltersFromUrl,
  cimmichExploreFiltersUrl,
  withCimmichExploreFilters,
} from './explore-filters';

describe('Cimmich Explore filter URLs', () => {
  it('round-trips exact privacy and repeatable domain facets', () => {
    const source = new URL(
      'http://cimmich.local/cimmich/people?personId=person-one&privacy=private&label=label-two&label=label-one',
    );
    const filters = cimmichExploreFiltersFromUrl(source);
    expect(filters).toEqual({
      eventIds: [],
      futureDates: false,
      labelIds: ['label-one', 'label-two'],
      placeIds: [],
      privacyTiers: ['private'],
      thingIds: [],
    });
    expect(cimmichExploreFilterCount(filters)).toBe(3);
    expect(cimmichExploreFiltersUrl(source, filters).searchParams.get('personId')).toBe('person-one');
  });

  it('carries People filters into a Person workspace without losing its identity selector', () => {
    expect(
      withCimmichExploreFilters('/cimmich/people/Aga?personId=person-aga', {
        eventIds: [],
        futureDates: false,
        labelIds: ['label-restricted'],
        placeIds: [],
        privacyTiers: ['private'],
        thingIds: [],
      }),
    ).toBe('/cimmich/people/Aga?personId=person-aga&privacy=private&label=label-restricted');
  });

  it('round-trips the exact future-date review scope', () => {
    const source = new URL('http://cimmich.local/cimmich/people/Benji?personId=person-benji&mode=photos&future=1');
    const filters = cimmichExploreFiltersFromUrl(source);
    expect(filters.futureDates).toBe(true);
    expect(cimmichExploreFilterCount(filters)).toBe(1);
    expect(cimmichExploreFiltersUrl(source, { ...filters, futureDates: false }).searchParams.has('future')).toBe(false);
  });
});
