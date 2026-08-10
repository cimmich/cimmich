import type { CimmichExploreFilters, CimmichVisibilityTier } from '$lib/services/cimmich.service';

export const emptyCimmichExploreFilters = (): CimmichExploreFilters => ({
  eventIds: [],
  labelIds: [],
  placeIds: [],
  privacyTiers: [],
  thingIds: [],
});

const unique = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();

export const normalizeCimmichExploreFilters = (filters: CimmichExploreFilters): CimmichExploreFilters => ({
  eventIds: unique(filters.eventIds).slice(0, 12),
  labelIds: unique(filters.labelIds).slice(0, 12),
  placeIds: unique(filters.placeIds).slice(0, 12),
  privacyTiers: unique(filters.privacyTiers).filter((tier): tier is CimmichVisibilityTier =>
    ['standard', 'personal', 'private'].includes(tier),
  ),
  thingIds: unique(filters.thingIds).slice(0, 12),
});

export const cimmichExploreFiltersFromUrl = (url: URL): CimmichExploreFilters =>
  normalizeCimmichExploreFilters({
    eventIds: url.searchParams.getAll('event'),
    labelIds: url.searchParams.getAll('label'),
    placeIds: url.searchParams.getAll('place'),
    privacyTiers: url.searchParams.getAll('privacy') as CimmichVisibilityTier[],
    thingIds: url.searchParams.getAll('thing'),
  });

export const cimmichExploreFilterKey = (filters: CimmichExploreFilters) =>
  JSON.stringify(normalizeCimmichExploreFilters(filters));

export const cimmichExploreFilterCount = (filters: CimmichExploreFilters) =>
  Object.values(filters).reduce((count, values) => count + values.length, 0);

export const cimmichExploreFiltersUrl = (source: URL, filters: CimmichExploreFilters) => {
  const url = new URL(source);
  for (const key of ['event', 'label', 'place', 'privacy', 'thing']) {
    url.searchParams.delete(key);
  }
  const normalized = normalizeCimmichExploreFilters(filters);
  for (const [key, values] of [
    ['privacy', normalized.privacyTiers],
    ['label', normalized.labelIds],
    ['place', normalized.placeIds],
    ['event', normalized.eventIds],
    ['thing', normalized.thingIds],
  ] as const) {
    for (const value of values) {
      url.searchParams.append(key, value);
    }
  }
  return url;
};

export const withCimmichExploreFilters = (href: string, filters: CimmichExploreFilters) => {
  const url = cimmichExploreFiltersUrl(new URL(href, 'http://cimmich.local'), filters);
  return `${url.pathname}${url.search}${url.hash}`;
};
