import { SvelteURL } from 'svelte/reactivity';
import {
  getCimmichExploreFacets,
  getCimmichPersonAssetsPage,
  type CimmichExploreFacetResult,
  type CimmichExploreFilters,
  type CimmichPersonAssetPage,
} from '$lib/services/cimmich.service';
import {
  cimmichExploreFilterKey,
  cimmichExploreFiltersFromUrl,
  cimmichExploreFiltersUrl,
  emptyCimmichExploreFilters,
} from './explore-filters';

type ApplyAssets = (page: CimmichPersonAssetPage) => void;

export class CimmichPersonExploreController {
  error = $state('');
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
      const [result, assetsPage] = await Promise.all([
        getCimmichExploreFacets(filters, personId),
        getCimmichPersonAssetsPage(personId, 120, undefined, undefined, filters),
      ]);
      if (generation !== this.#generation || filterKey !== this.key) {
        return;
      }
      this.result = result;
      this.#applyAssets(assetsPage);
      this.loadedKey = filterKey;
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
