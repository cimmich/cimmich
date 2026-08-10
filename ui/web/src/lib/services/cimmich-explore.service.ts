import type {
  CimmichPersonAssetAssociationFilter,
  CimmichPersonAssetPage,
  CimmichVisibilityTier,
} from './cimmich.service';

export type CimmichExploreFilters = {
  eventIds: string[];
  labelIds: string[];
  placeIds: string[];
  privacyTiers: CimmichVisibilityTier[];
  thingIds: string[];
};

export type CimmichExploreFacet = {
  count: number;
  displayName: string;
  id: string;
};

export type CimmichExploreFacetResult = {
  availableAssets: number;
  facets: {
    events: CimmichExploreFacet[];
    labels: CimmichExploreFacet[];
    places: CimmichExploreFacet[];
    privacy: CimmichExploreFacet[];
    things: CimmichExploreFacet[];
  };
  filters: CimmichExploreFilters;
  people: Array<{ assetCount: number; personId: string }>;
  schemaVersion: 'cimmich.explore-facets.v1';
  scope: { kind: 'people' | 'person'; personId: string };
  totalAssets: number;
};

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
type Coalesce = <T>(key: string, create: () => Promise<T>) => Promise<T>;

export const createCimmichExploreClient = (request: Request, coalesce: Coalesce) => ({
  getExploreFacets(filters: CimmichExploreFilters, personId = '') {
    const scope = personId ? { kind: 'person' as const, personId } : { kind: 'people' as const, personId: '' };
    const key = `explore-facets:${JSON.stringify({ filters, scope })}`;
    return coalesce(key, () =>
      request<CimmichExploreFacetResult>('/v1/explore/facets', {
        body: JSON.stringify({ filters, scope }),
        method: 'POST',
      }),
    );
  },
  getPersonAssetsPage(
    personId: string,
    pageSize = 120,
    cursor?: string,
    associationType?: CimmichPersonAssetAssociationFilter,
    filters?: CimmichExploreFilters,
  ) {
    const search = new URLSearchParams({ pageSize: String(Math.max(1, Math.min(250, pageSize))) });
    if (cursor) {
      search.set('cursor', cursor);
    }
    if (associationType) {
      search.set('associationType', associationType);
    }
    for (const [key, values] of [
      ['privacy', filters?.privacyTiers],
      ['label', filters?.labelIds],
      ['place', filters?.placeIds],
      ['event', filters?.eventIds],
      ['thing', filters?.thingIds],
    ] as const) {
      for (const value of values ?? []) {
        search.append(key, value);
      }
    }
    return request<CimmichPersonAssetPage>(`/v1/people/${encodeURIComponent(personId)}/assets?${search.toString()}`);
  },
});
