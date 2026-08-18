<script lang="ts">
  import { cimmichVisibilityManager } from '$lib/managers/cimmich-visibility-manager.svelte';
  import { getCimmichArchiveSourceEvidence } from '$lib/services/cimmich-archive-integrity.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize, AssetTypeEnum, searchSmart, type AssetResponseDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiArrowRight, mdiImageSearchOutline, mdiMagnify } from '@mdi/js';

  interface Props {
    initialQuery?: string;
    initialQueryAssetId?: string;
    onStateChange?: (query: string, queryAssetId: string) => void;
  }

  let { initialQuery = '', initialQueryAssetId = '', onStateChange = () => undefined }: Props = $props();
  const PAGE_SIZE = 24;
  let query = $state(initialQuery);
  let submittedQuery = $state(initialQuery);
  let queryAssetId = $state(initialQueryAssetId);
  let assets = $state<AssetResponseDto[]>([]);
  let error = $state('');
  let loading = $state(false);
  let loadingMore = $state(false);
  let loaded = $state(false);
  let nextPage = $state(1);
  let validationError = $state('');
  let generation = 0;
  let observedVisibilityVersion = -1;

  const dateLabel = (asset: AssetResponseDto) => {
    const value = asset.exifInfo?.dateTimeOriginal ?? asset.fileCreatedAt;
    return new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }).format(new Date(value));
  };

  const search = async (
    event?: SubmitEvent,
    options: { append?: boolean; notifyState?: boolean; requestedAssetId?: string; requestedQuery?: string } = {},
  ) => {
    event?.preventDefault();
    const append = options.append ?? false;
    const nextAssetId = options.requestedAssetId ?? (append ? queryAssetId : '');
    const nextQuery = (options.requestedQuery ?? query).trim();
    validationError = '';
    if (!nextAssetId && nextQuery.length < 2) {
      validationError = 'Enter at least two characters.';
      return;
    }
    if (nextQuery.length > 500) {
      validationError = 'Keep the search under 500 characters.';
      return;
    }
    if (append) {
      loadingMore = true;
    } else {
      loading = true;
      error = '';
      submittedQuery = nextQuery;
      queryAssetId = nextAssetId;
      if (options.notifyState !== false) {
        onStateChange(nextQuery, nextAssetId);
      }
    }
    const requestGeneration = append ? generation : ++generation;
    try {
      const response = await searchSmart({
        smartSearchDto: {
          page: append ? nextPage : 1,
          query: nextAssetId ? undefined : nextQuery,
          queryAssetId: nextAssetId || undefined,
          size: PAGE_SIZE,
          type: AssetTypeEnum.Image,
        },
      });
      const candidates = response.assets.items.filter((asset) => asset.id !== nextAssetId);
      const evidence =
        candidates.length > 0
          ? await getCimmichArchiveSourceEvidence(candidates.map((asset) => asset.id))
          : { items: [] };
      if (requestGeneration !== generation) {
        return;
      }
      const visibleSourceIds = new Set(evidence.items.map((item) => item.sourceAssetId));
      const visible = candidates.filter((asset) => visibleSourceIds.has(asset.id));
      const combined = append ? [...assets, ...visible] : visible;
      assets = [...new Map(combined.map((asset) => [asset.id, asset])).values()];
      nextPage = Number(response.assets.nextPage) || 0;
      loaded = true;
    } catch (error_) {
      if (requestGeneration === generation) {
        error = error_ instanceof Error ? error_.message : 'Visual search could not be completed.';
      }
    } finally {
      if (requestGeneration === generation) {
        loading = false;
        loadingMore = false;
      }
    }
  };

  const submitPrompt = (value: string) => {
    query = value;
    void search(undefined, { requestedQuery: value });
  };

  $effect(() => {
    const visibilityVersion = cimmichVisibilityManager.version;
    const shouldSearch =
      (submittedQuery || queryAssetId) &&
      (observedVisibilityVersion < 0 || visibilityVersion !== observedVisibilityVersion);
    observedVisibilityVersion = visibilityVersion;
    if (shouldSearch) {
      void search(undefined, { notifyState: false, requestedAssetId: queryAssetId, requestedQuery: submittedQuery });
    }
  });
</script>

<form class="relative mx-auto mt-7 max-w-3xl" role="search" onsubmit={(event) => void search(event)}>
  <label>
    <span class="sr-only">Describe what the photos look like</span>
    <Icon
      class="pointer-events-none absolute top-[22px] left-5 -translate-y-1/2 text-gray-500"
      icon={mdiMagnify}
      size="22"
    />
    <input
      class="min-h-12 w-full rounded-full border border-gray-300 bg-white pr-28 pl-13 text-base shadow-sm transition outline-none focus:border-primary focus:ring-4 focus:ring-primary/15 dark:border-gray-700 dark:bg-gray-900"
      bind:value={query}
      aria-describedby={validationError ? 'visual-search-error' : undefined}
      placeholder="People around a table, a stormy beach, a handwritten note…"
      maxlength="500"
      autocomplete="off"
      oninput={() => {
        if (queryAssetId) {
          queryAssetId = '';
        }
      }}
    />
  </label>
  <button
    class="absolute top-1 right-1 min-h-10 rounded-full bg-primary px-5 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50"
    type="submit"
    disabled={loading}
  >
    {loading ? 'Searching…' : 'Search'}
  </button>
</form>

{#if validationError}
  <p class="mt-2 text-center text-sm text-red-700 dark:text-red-300" id="visual-search-error" role="alert">
    {validationError}
  </p>
{/if}

<div
  class="mx-auto mt-4 flex max-w-3xl items-center justify-between gap-3 text-left text-xs text-gray-500 dark:text-gray-400"
>
  <p>Immich ranks visual similarity. Results are leads, not facts recorded in Cimmich.</p>
  {#if queryAssetId}
    <span class="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 font-semibold text-primary">Reference photo</span>
  {/if}
</div>

{#if error}
  <div
    class="mx-auto mt-8 max-w-3xl rounded-2xl border border-red-200 bg-red-50 p-4 text-left text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
    role="alert"
  >
    <p class="font-semibold">We couldn't finish that visual search.</p>
    <p class="mt-1">{error}</p>
    <button
      class="mt-4 min-h-10 rounded-full bg-red-800 px-4 font-semibold text-white dark:bg-red-200 dark:text-red-950"
      type="button"
      onclick={() => void search(undefined, { requestedAssetId: queryAssetId, requestedQuery: submittedQuery })}
    >
      Try again
    </button>
  </div>
{/if}

{#if loading && !loaded}
  <div
    class="mt-10 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6"
    aria-label="Searching Immich's visual index"
    aria-busy="true"
  >
    {#each Array.from({ length: 18 }) as _, index (index)}
      <div class="aspect-square animate-pulse rounded-2xl bg-gray-100 dark:bg-gray-800"></div>
    {/each}
  </div>
{:else if loaded}
  <section class="mt-10 text-left" aria-labelledby="visual-results-title">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="text-xl font-semibold" id="visual-results-title">
          {assets.length === 0
            ? 'No visual leads'
            : `${assets.length} visual ${assets.length === 1 ? 'lead' : 'leads'}`}
        </h2>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {queryAssetId ? 'Ranked against the photo you opened' : `for “${submittedQuery}”`}{nextPage
            ? ' · more available'
            : ''}
        </p>
      </div>
      <span
        class="rounded-full bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200"
        title="Immich returns ranked assets without an explanation or stable similarity score"
      >
        Immich visual ranking
      </span>
    </div>

    {#if assets.length === 0}
      <div class="mt-5 rounded-3xl border border-dashed border-gray-300 px-6 py-16 text-center dark:border-gray-700">
        <Icon class="mx-auto text-gray-400" icon={mdiImageSearchOutline} size="34" />
        <p class="mt-4 font-semibold">Try describing the visible scene, action, colour or composition</p>
      </div>
    {:else}
      <div class="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
        {#each assets as asset (asset.id)}
          <a
            class="group relative aspect-square overflow-hidden rounded-2xl bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:bg-gray-800"
            href={`/photos/${encodeURIComponent(asset.id)}`}
            aria-label={`Open ${asset.originalFileName}`}
            title={asset.originalFileName}
          >
            <img
              class="size-full object-cover transition duration-300 group-hover:scale-[1.02]"
              src={getAssetMediaUrl({ id: asset.id, size: AssetMediaSize.Preview })}
              alt={asset.originalFileName}
              loading="lazy"
            />
            <span
              class="absolute right-2 bottom-2 rounded-full bg-black/60 px-2 py-1 text-[11px] font-semibold text-white backdrop-blur-sm"
            >
              {dateLabel(asset)}
            </span>
          </a>
        {/each}
      </div>
    {/if}
  </section>
{:else}
  <section class="mx-auto mt-12 grid max-w-4xl gap-3 sm:grid-cols-3" aria-label="Visual search suggestions">
    <button class="smart-search-prompt" type="button" onclick={() => submitPrompt('people around a table')}
      ><Icon icon={mdiImageSearchOutline} size="22" /><span
        ><strong>Shared moments</strong><small>People and activity</small></span
      ></button
    >
    <button class="smart-search-prompt" type="button" onclick={() => submitPrompt('a stormy beach')}
      ><Icon icon={mdiImageSearchOutline} size="22" /><span
        ><strong>Scenes</strong><small>Place, weather and colour</small></span
      ></button
    >
    <button class="smart-search-prompt" type="button" onclick={() => submitPrompt('a handwritten note')}
      ><Icon icon={mdiImageSearchOutline} size="22" /><span
        ><strong>Visual details</strong><small>Objects and composition</small></span
      ></button
    >
  </section>
{/if}

{#if nextPage > 0 && loaded}
  <div class="mt-8 flex justify-center">
    <button
      type="button"
      class="inline-flex min-h-11 items-center gap-2 rounded-full border border-gray-300 px-5 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
      disabled={loadingMore}
      onclick={() =>
        void search(undefined, { append: true, requestedAssetId: queryAssetId, requestedQuery: submittedQuery })}
    >
      {loadingMore ? 'Loading visual leads…' : 'Load 24 more'}
      <Icon icon={mdiArrowRight} size="17" />
    </button>
  </div>
{/if}
