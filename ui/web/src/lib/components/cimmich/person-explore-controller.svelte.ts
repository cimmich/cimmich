import { SvelteURL } from 'svelte/reactivity';
import {
  getCimmichExploreFacets,
  getCimmichPersonAssetsPage,
  type CimmichExploreFacetResult,
  type CimmichExploreFilters,
  type CimmichPersonAssetPage,
} from '$lib/services/cimmich.service';
import {
  cimmichExploreFilterCount,
  cimmichExploreFilterKey,
  cimmichExploreFiltersFromUrl,
  cimmichExploreFiltersUrl,
  emptyCimmichExploreFilters,
} from './explore-filters';

type ApplyAssets = (page: CimmichPersonAssetPage) => void;

export class CimmichPersonExploreController {
  error = $state('');
  facetsLoading = $state(false);
  filters = $state<CimmichExploreFilters>(emptyCimmichExploreFilters());
  loadedKey = $state('');
  loading = $state(false);
  result = $state<CimmichExploreFacetResult | null>(null);
  #applyAssets: ApplyAssets;
  #generation = 0;

  constructor(initialUrl: URL, applyAssets: ApplyAssets) {
    this.filters = cimmichExploreFiltersFromUrl(initialUrl);
    this.#applyAssets = applyAssets;
  }

  get key() {
    return cimmichExploreFilterKey(this.filters);
  }

  getAssetsPage = (personId: string, cursor?: string) =>
    getCimmichPersonAssetsPage(personId, 120, cursor, undefined, this.filters);

  load = async (personId: string) => {
    const generation = ++this.#generation;
    const filters = this.filters;
    const filterKey = cimmichExploreFilterKey(filters);
    this.loading = true;
    this.error = '';
    try {
      const assetsPage = await getCimmichPersonAssetsPage(personId, 120, undefined, undefined, filters);
      if (generation !== this.#generation || filterKey !== this.key) {
        return;
      }
      this.#applyAssets(assetsPage);
      this.loadedKey = filterKey;
      if (cimmichExploreFilterCount(filters) > 0) {
        void this.loadFacets(personId);
      }
    } catch (error) {
      if (generation === this.#generation) {
        this.error = error instanceof Error ? error.message : 'Unable to filter this Person';
      }
    } finally {
      if (generation === this.#generation) {
        this.loading = false;
      }
    }
  };

  loadFacets = async (personId: string) => {
    const generation = this.#generation;
    const filters = this.filters;
    const filterKey = cimmichExploreFilterKey(filters);
    this.facetsLoading = true;
    try {
      const result = await getCimmichExploreFacets(filters, personId);
      if (generation === this.#generation && filterKey === this.key) {
        this.result = result;
      }
    } catch (error) {
      if (generation === this.#generation) {
        this.error = error instanceof Error ? error.message : 'Unable to load Explore options';
      }
    } finally {
      if (generation === this.#generation) {
        this.facetsLoading = false;
      }
    }
  };

  resetCachedResult() {
    this.loadedKey = '';
    this.result = null;
  }

  async resetAssets(personId: string, isCurrent: () => boolean) {
    const page = await this.getAssetsPage(personId);
    if (isCurrent()) {
      this.#applyAssets(page);
    }
  }

  restoreCachedResult(filterKey: string, result: CimmichExploreFacetResult | null) {
    this.loadedKey = filterKey;
    this.result = result;
  }

  restoreFromLocation = () => {
    this.filters = cimmichExploreFiltersFromUrl(new SvelteURL(globalThis.location.href));
  };

  setFilters = (filters: CimmichExploreFilters) => {
    this.filters = filters;
    globalThis.history.pushState(
      globalThis.history.state,
      '',
      cimmichExploreFiltersUrl(new SvelteURL(globalThis.location.href), filters),
    );
  };
}
