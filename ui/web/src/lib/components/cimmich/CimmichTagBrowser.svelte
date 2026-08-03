<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import GalleryViewer from '$lib/components/shared-components/gallery-viewer/GalleryViewer.svelte';
  import AssetSelectControlBar from '$lib/components/timeline/AssetSelectControlBar.svelte';
  import CreateSharedLink from '$lib/components/timeline/actions/CreateSharedLinkAction.svelte';
  import DownloadAction from '$lib/components/timeline/actions/DownloadAction.svelte';
  import FavoriteAction from '$lib/components/timeline/actions/FavoriteAction.svelte';
  import TagAction from '$lib/components/timeline/actions/TagAction.svelte';
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import type { Viewport } from '$lib/managers/timeline-manager/types';
  import {
    getCimmichContextEntities,
    getCimmichContextEntity,
    getCimmichPeople,
    getCimmichPersonAssetsPage,
    getCimmichPetMedia,
    getCimmichPets,
    type CimmichContextFamily,
  } from '$lib/services/cimmich.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { toTimelineAsset } from '$lib/utils/timeline-util';
  import { AssetMediaSize, getAssetInfo, searchAssets, type AssetResponseDto, type TagResponseDto } from '@immich/sdk';
  import { Icon, LoadingSpinner } from '@immich/ui';
  import { mdiCheck, mdiChevronDown, mdiClose, mdiImageMultipleOutline, mdiMagnify } from '@mdi/js';
  import { onMount } from 'svelte';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import {
    familyLabel,
    filterTagOptions,
    intersectAssetIds,
    normalTagOptions,
    type CimmichTagFamily,
    type TagBrowserOption,
  } from './tag-browser';

  type TagSource = 'cimmich' | 'normal';
  type CimmichAssetReference = { captureTime: string | null; sourceAssetId: string };

  interface Props {
    initialPath?: string;
    tags: TagResponseDto[];
  }

  let { initialPath = '', tags }: Props = $props();

  const viewport: Viewport = $state({ width: 0, height: 0 });
  const selectedIds = new SvelteSet<string>();
  const assetCache = new SvelteMap<string, AssetResponseDto | null>();
  let source = $state<TagSource>(
    initialPath || page.url.searchParams.get('tagSource') === 'normal' ? 'normal' : 'cimmich',
  );
  let activeFamily = $state<CimmichTagFamily | 'all'>('all');
  let query = $state('');
  let cimmichOptions = $state<TagBrowserOption[]>([]);
  let directoryLoading = $state(true);
  let resultsLoading = $state(false);
  let error = $state('');
  let resultAssets = $state<AssetResponseDto[]>([]);
  let totalMatches = $state(0);
  let normalNextPage = $state(0);
  let matchedCimmichIds = $state<string[]>([]);
  let loadedCimmichSourceCount = $state(0);
  let singlePersonCursor = $state<string | null>(null);
  let singlePersonId = $state('');
  let resultGeneration = 0;

  const normalOptions = $derived(normalTagOptions(tags));
  const allOptions = $derived(source === 'cimmich' ? cimmichOptions : normalOptions);
  const visibleOptions = $derived(filterTagOptions(allOptions, query, source === 'cimmich' ? activeFamily : 'all'));
  const selectedOptions = $derived(
    [...selectedIds].map((id) => allOptions.find((option) => option.id === id)).filter(Boolean) as TagBrowserOption[],
  );
  const resultLabel = $derived(
    selectedOptions.length === 0
      ? 'Choose tags to see their photos'
      : selectedOptions.length === 1
        ? `Photos tagged ${selectedOptions[0]!.label}`
        : `Photos with all ${selectedOptions.length} selected tags`,
  );
  const canLoadMore = $derived(
    source === 'normal'
      ? normalNextPage > 0
      : loadedCimmichSourceCount < matchedCimmichIds.length || Boolean(singlePersonCursor),
  );

  const toCount = (count: number | null) =>
    count === null ? 'Normal tag' : `${count.toLocaleString()} ${count === 1 ? 'photo' : 'photos'}`;

  const coverUrl = (option: TagBrowserOption) =>
    option.coverAssetId ? getAssetMediaUrl({ id: option.coverAssetId, size: AssetMediaSize.Thumbnail }) : '';

  const sortOptions = (options: TagBrowserOption[]) =>
    options.sort(
      (left, right) =>
        (right.assetCount ?? -1) - (left.assetCount ?? -1) ||
        left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }),
    );

  const loadDirectory = async () => {
    directoryLoading = true;
    error = '';
    try {
      const [people, pets, places, things, events] = await Promise.all([
        getCimmichPeople(500, '', { presentation: false }),
        getCimmichPets({ limit: 500 }),
        getCimmichContextEntities('places', { limit: 500 }),
        getCimmichContextEntities('objects', { limit: 500 }),
        getCimmichContextEntities('events', { limit: 500 }),
      ]);

      cimmichOptions = sortOptions([
        ...people
          .filter((person) => person.subject_kind === 'person' && person.status === 'active')
          .map((person) => ({
            aliases: person.aliases,
            assetCount: person.asset_count,
            coverAssetId: person.sourceAssetId || null,
            entityId: person.person_id,
            family: 'people' as const,
            id: `people:${person.person_id}`,
            label: person.display_name,
          })),
        ...pets
          .filter((pet) => pet.status === 'active')
          .map((pet) => ({
            aliases: pet.aliases,
            assetCount: pet.confirmedMediaCount,
            coverAssetId: pet.cover?.sourceAssetId ?? null,
            entityId: pet.petId,
            family: 'pets' as const,
            id: `pets:${pet.petId}`,
            label: pet.displayName,
          })),
        ...places
          .filter((entity) => entity.status === 'active')
          .map((entity) => ({
            aliases: entity.aliases,
            assetCount: entity.subtreeAssetCount ?? entity.assetCount,
            coverAssetId: entity.coverAssetId,
            entityId: entity.entityId,
            family: 'places' as const,
            id: `places:${entity.entityId}`,
            label: entity.displayName,
          })),
        ...things
          .filter((entity) => entity.status === 'active')
          .map((entity) => ({
            aliases: entity.aliases,
            assetCount: entity.assetCount,
            coverAssetId: entity.coverAssetId,
            entityId: entity.entityId,
            family: 'things' as const,
            id: `things:${entity.entityId}`,
            label: entity.displayName,
          })),
        ...events
          .filter((entity) => entity.status === 'active')
          .map((entity) => ({
            aliases: entity.aliases,
            assetCount: entity.assetCount,
            coverAssetId: entity.coverAssetId,
            entityId: entity.entityId,
            family: 'events' as const,
            id: `events:${entity.entityId}`,
            label: entity.displayName,
          })),
      ]);
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'Could not load Cimmich tags.';
    } finally {
      directoryLoading = false;
    }
  };

  const loadCimmichReferences = async (option: TagBrowserOption): Promise<CimmichAssetReference[]> => {
    if (option.family === 'people') {
      const references: CimmichAssetReference[] = [];
      let cursor: string | undefined;
      do {
        const page = await getCimmichPersonAssetsPage(option.entityId, 250, cursor);
        references.push(
          ...page.items.map((asset) => ({
            captureTime: asset.capture_time,
            sourceAssetId: asset.sourceAssetId,
          })),
        );
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return references;
    }
    if (option.family === 'pets') {
      const assets = await getCimmichPetMedia(option.entityId);
      return assets.map((asset) => ({
        captureTime: asset.capture_time,
        sourceAssetId: asset.sourceAssetId,
      }));
    }
    const family = (option.family === 'things' ? 'objects' : option.family) as CimmichContextFamily;
    const detail = await getCimmichContextEntity(family, option.entityId);
    const assets = family === 'places' && detail.subtreeAssets?.length ? detail.subtreeAssets : detail.assets;
    return assets.map((asset) => ({ captureTime: asset.captureTime, sourceAssetId: asset.sourceAssetId }));
  };

  const fetchAssets = async (ids: string[], generation: number) => {
    const loaded: AssetResponseDto[] = [];
    for (let offset = 0; offset < ids.length; offset += 12) {
      const chunk = ids.slice(offset, offset + 12);
      const results = await Promise.all(
        chunk.map(async (id) => {
          if (assetCache.has(id)) {
            return assetCache.get(id) ?? null;
          }
          const asset = await getAssetInfo({ id }).catch(() => null);
          assetCache.set(id, asset);
          return asset;
        }),
      );
      if (generation !== resultGeneration) {
        return [];
      }
      loaded.push(...(results.filter(Boolean) as AssetResponseDto[]));
    }
    return loaded;
  };

  const loadNormalResults = async (generation: number, pageNumber = 1) => {
    const selectedTagIds = selectedOptions.map((option) => option.normalTagId).filter(Boolean) as string[];
    const response = await searchAssets({
      metadataSearchDto: { page: pageNumber, size: 250, tagIds: selectedTagIds, withExif: true },
    });
    if (generation !== resultGeneration) {
      return;
    }
    resultAssets = pageNumber === 1 ? response.assets.items : [...resultAssets, ...response.assets.items];
    totalMatches = response.assets.total;
    normalNextPage = Number(response.assets.nextPage) || 0;
  };

  const loadCimmichResults = async (generation: number) => {
    if (selectedOptions.length === 1 && selectedOptions[0]!.family === 'people') {
      const option = selectedOptions[0]!;
      const page = await getCimmichPersonAssetsPage(option.entityId, 250);
      if (generation !== resultGeneration) {
        return;
      }
      singlePersonId = option.entityId;
      singlePersonCursor = page.nextCursor;
      matchedCimmichIds = page.items.map((asset) => asset.sourceAssetId);
      totalMatches = page.summary.total;
      loadedCimmichSourceCount = Math.min(120, matchedCimmichIds.length);
      resultAssets = await fetchAssets(matchedCimmichIds.slice(0, loadedCimmichSourceCount), generation);
      return;
    }
    const groups = await Promise.all(selectedOptions.map((option) => loadCimmichReferences(option)));
    if (generation !== resultGeneration) {
      return;
    }
    const captureTimes = new SvelteMap<string, string>();
    for (const group of groups) {
      for (const asset of group) {
        if (
          asset.captureTime &&
          (!captureTimes.has(asset.sourceAssetId) || asset.captureTime > captureTimes.get(asset.sourceAssetId)!)
        ) {
          captureTimes.set(asset.sourceAssetId, asset.captureTime);
        }
      }
    }
    matchedCimmichIds = intersectAssetIds(groups.map((group) => group.map((asset) => asset.sourceAssetId))).sort(
      (left, right) => (captureTimes.get(right) ?? '').localeCompare(captureTimes.get(left) ?? ''),
    );
    totalMatches = matchedCimmichIds.length;
    loadedCimmichSourceCount = Math.min(120, matchedCimmichIds.length);
    resultAssets = await fetchAssets(matchedCimmichIds.slice(0, loadedCimmichSourceCount), generation);
  };

  const refreshResults = async () => {
    const generation = ++resultGeneration;
    assetMultiSelectManager.clear();
    resultAssets = [];
    matchedCimmichIds = [];
    loadedCimmichSourceCount = 0;
    singlePersonCursor = null;
    singlePersonId = '';
    totalMatches = 0;
    normalNextPage = 0;
    error = '';
    if (selectedIds.size === 0) {
      resultsLoading = false;
      return;
    }
    resultsLoading = true;
    try {
      await (source === 'normal' ? loadNormalResults(generation) : loadCimmichResults(generation));
    } catch (error_) {
      if (generation === resultGeneration) {
        error = error_ instanceof Error ? error_.message : 'Could not load matching photos.';
      }
    } finally {
      if (generation === resultGeneration) {
        resultsLoading = false;
      }
    }
  };

  const toggleOption = (option: TagBrowserOption) => {
    if (selectedIds.has(option.id)) {
      selectedIds.delete(option.id);
    } else {
      selectedIds.add(option.id);
    }
    void refreshResults();
  };

  const clearSelection = () => {
    selectedIds.clear();
    void refreshResults();
  };

  const setSource = (next: TagSource) => {
    if (source === next) {
      return;
    }
    source = next;
    query = '';
    activeFamily = 'all';
    clearSelection();
    const url = new URL(page.url);
    url.searchParams.delete('path');
    if (next === 'normal') {
      url.searchParams.set('tagSource', 'normal');
    } else {
      url.searchParams.delete('tagSource');
    }
    void goto(url, { keepFocus: true, noScroll: true, replaceState: true });
  };

  const loadMore = async () => {
    if (resultsLoading || !canLoadMore) {
      return;
    }
    resultsLoading = true;
    const generation = resultGeneration;
    try {
      if (source === 'normal') {
        await loadNormalResults(generation, normalNextPage);
      } else {
        const targetCount = loadedCimmichSourceCount + 120;
        while (singlePersonId && singlePersonCursor && matchedCimmichIds.length < targetCount) {
          const page = await getCimmichPersonAssetsPage(singlePersonId, 250, singlePersonCursor);
          if (generation !== resultGeneration) {
            return;
          }
          matchedCimmichIds = [...matchedCimmichIds, ...page.items.map((asset) => asset.sourceAssetId)];
          singlePersonCursor = page.nextCursor;
          totalMatches = page.summary.total;
        }
        const nextSourceCount = Math.min(targetCount, matchedCimmichIds.length);
        const nextIds = matchedCimmichIds.slice(loadedCimmichSourceCount, nextSourceCount);
        resultAssets = [...resultAssets, ...(await fetchAssets(nextIds, generation))];
        loadedCimmichSourceCount = nextSourceCount;
      }
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'Could not load more photos.';
    } finally {
      if (generation === resultGeneration) {
        resultsLoading = false;
      }
    }
  };

  const handleSelectAll = () => {
    assetMultiSelectManager.selectAssets(resultAssets.map((asset) => toTimelineAsset(asset)));
  };

  onMount(() => {
    void loadDirectory();
    if (initialPath) {
      const initial = normalOptions.find((option) => option.label === initialPath);
      if (initial) {
        selectedIds.add(initial.id);
        void refreshResults();
      }
    }
  });
</script>

<div class="flex h-full min-h-0 flex-col gap-4 px-4 pt-3 pb-6 sm:px-6 lg:px-8">
  <div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
    <div>
      <h1 class="text-2xl font-semibold text-immich-primary dark:text-immich-dark-primary">Tags</h1>
      <p class="mt-1 max-w-2xl text-sm text-gray-600 dark:text-gray-300">
        Find labels, combine them, and see the matching photos in one place.
      </p>
    </div>

    <div
      class="inline-grid min-h-11 w-full grid-cols-2 rounded-xl bg-gray-100 p-1 sm:w-72 dark:bg-gray-800"
      aria-label="Tag source"
    >
      <button
        type="button"
        class:tag-source-active={source === 'cimmich'}
        class="min-h-9 rounded-lg px-4 text-sm font-semibold transition"
        aria-pressed={source === 'cimmich'}
        onclick={() => setSource('cimmich')}>Cimmich</button
      >
      <button
        type="button"
        class:tag-source-active={source === 'normal'}
        class="min-h-9 rounded-lg px-4 text-sm font-semibold transition"
        aria-pressed={source === 'normal'}
        onclick={() => setSource('normal')}>Normal</button
      >
    </div>
  </div>

  <div class="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(19rem,23rem)_minmax(0,1fr)]">
    <aside
      class="flex min-h-88 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-immich-dark-gray"
    >
      <div class="border-b border-gray-200 p-3 dark:border-gray-700">
        <label class="relative block">
          <span class="sr-only">Search {source === 'cimmich' ? 'Cimmich' : 'normal'} tags</span>
          <span class="pointer-events-none absolute inset-y-0 inset-s-3 flex items-center text-gray-500">
            <Icon icon={mdiMagnify} size="20" />
          </span>
          <input
            bind:value={query}
            type="search"
            class="min-h-11 w-full rounded-xl border border-gray-300 bg-white ps-10 pe-10 text-sm transition outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-gray-600 dark:bg-gray-900"
            placeholder={`Search ${source === 'cimmich' ? 'Cimmich' : 'normal'} tags`}
          />
          {#if query}
            <button
              type="button"
              class="absolute inset-y-0 inset-e-1 flex min-w-11 items-center justify-center text-gray-500"
              aria-label="Clear tag search"
              onclick={() => (query = '')}><Icon icon={mdiClose} size="18" /></button
            >
          {/if}
        </label>

        {#if source === 'cimmich'}
          <div class="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Cimmich tag type">
            {#each ['all', 'people', 'pets', 'places', 'things', 'events'] as family (family)}
              <button
                type="button"
                class:tag-filter-active={activeFamily === family}
                class="min-h-11 shrink-0 rounded-full border border-gray-200 px-4 text-sm font-medium transition dark:border-gray-600"
                aria-pressed={activeFamily === family}
                onclick={() => (activeFamily = family as CimmichTagFamily | 'all')}
                >{family === 'all' ? 'All' : familyLabel(family as CimmichTagFamily)}</button
              >
            {/each}
          </div>
        {/if}
      </div>

      <div class="flex items-center justify-between px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">
        <span>{visibleOptions.length.toLocaleString()} {visibleOptions.length === 1 ? 'tag' : 'tags'}</span>
        {#if selectedIds.size > 0}
          <button
            type="button"
            class="min-h-11 px-2 text-primary dark:text-immich-dark-primary"
            onclick={clearSelection}>Clear {selectedIds.size}</button
          >
        {/if}
      </div>

      <div class="min-h-0 flex-1 immich-scrollbar overflow-y-auto px-2 pb-2">
        {#if source === 'cimmich' && directoryLoading}
          <div class="flex h-48 items-center justify-center"><LoadingSpinner /></div>
        {:else if visibleOptions.length === 0}
          <div class="flex h-48 flex-col items-center justify-center px-6 text-center text-sm text-gray-500">
            <Icon icon={mdiMagnify} size="28" />
            <p class="mt-2 font-medium">No matching tags</p>
            <p class="mt-1 text-xs">Try another name or tag type.</p>
          </div>
        {:else}
          <div class="space-y-1">
            {#each visibleOptions as option (option.id)}
              <label
                class:selected-tag-row={selectedIds.has(option.id)}
                class="group flex min-h-16 cursor-pointer items-center gap-3 rounded-xl p-2 transition hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <input
                  type="checkbox"
                  class="size-5 shrink-0 rounded-sm border-gray-300 text-primary focus:ring-primary"
                  checked={selectedIds.has(option.id)}
                  onchange={() => toggleOption(option)}
                />
                {#if coverUrl(option)}
                  <img class="size-12 shrink-0 rounded-lg object-cover" src={coverUrl(option)} alt="" loading="lazy" />
                {:else}
                  <span
                    class="flex size-12 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-400 dark:bg-gray-700"
                  >
                    <Icon icon={mdiImageMultipleOutline} size="21" />
                  </span>
                {/if}
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-semibold text-gray-900 dark:text-white">{option.label}</span>
                  <span class="mt-0.5 flex items-center gap-1.5 truncate text-xs text-gray-500 dark:text-gray-400">
                    <span>{familyLabel(option.family)}</span><span aria-hidden="true">·</span><span
                      >{toCount(option.assetCount)}</span
                    >
                  </span>
                </span>
                {#if selectedIds.has(option.id)}
                  <span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-white">
                    <Icon icon={mdiCheck} size="17" />
                  </span>
                {/if}
              </label>
            {/each}
          </div>
        {/if}
      </div>
    </aside>

    <section
      class="min-h-112 min-w-0 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-immich-dark-gray"
    >
      <div
        class="flex min-h-19 flex-col justify-center gap-2 border-b border-gray-200 px-4 py-3 sm:px-5 dark:border-gray-700"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 class="font-semibold text-gray-900 dark:text-white">{resultLabel}</h2>
            {#if selectedIds.size > 0}
              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {resultsLoading && resultAssets.length === 0
                  ? 'Finding matches…'
                  : `${totalMatches.toLocaleString()} ${totalMatches === 1 ? 'photo' : 'photos'}`}
                {#if selectedIds.size > 1}
                  · all selected tags{/if}
              </p>
            {/if}
          </div>
          {#if resultAssets.length > 0}
            <button
              type="button"
              class="min-h-11 rounded-lg px-3 text-sm font-semibold text-primary dark:text-immich-dark-primary"
              onclick={handleSelectAll}>Select shown</button
            >
          {/if}
        </div>
        {#if selectedOptions.length > 0}
          <div class="flex gap-2 overflow-x-auto pb-1">
            {#each selectedOptions as option (option.id)}
              <button
                type="button"
                class="flex min-h-10 shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-3 text-xs font-semibold text-primary dark:bg-immich-dark-primary/15 dark:text-immich-dark-primary"
                aria-label={`Remove ${option.label}`}
                onclick={() => toggleOption(option)}
              >
                {option.label}<Icon icon={mdiClose} size="15" />
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <div class="h-[calc(100%-4.75rem)] min-h-96 immich-scrollbar overflow-y-auto p-2 sm:p-3">
        {#if error}
          <div
            class="m-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          >
            {error}
          </div>
        {/if}
        {#if selectedIds.size === 0}
          <div
            class="flex min-h-96 flex-col items-center justify-center px-6 text-center text-gray-500 dark:text-gray-400"
          >
            <span
              class="flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary dark:bg-immich-dark-primary/15 dark:text-immich-dark-primary"
            >
              <Icon icon={mdiImageMultipleOutline} size="30" />
            </span>
            <h3 class="mt-4 font-semibold text-gray-800 dark:text-gray-100">Pick one or more tags</h3>
            <p class="mt-1 max-w-sm text-sm">
              One tag shows its photos. Add another to narrow the results to photos that have both.
            </p>
          </div>
        {:else if resultsLoading && resultAssets.length === 0}
          <div class="flex min-h-96 items-center justify-center"><LoadingSpinner size="giant" /></div>
        {:else if error}
          <div
            class="flex min-h-96 flex-col items-center justify-center px-6 text-center text-gray-500 dark:text-gray-400"
          >
            <h3 class="font-semibold text-gray-800 dark:text-gray-100">Could not load these photos</h3>
            <button
              type="button"
              class="mt-3 min-h-11 rounded-full border border-gray-300 px-5 text-sm font-semibold dark:border-gray-600"
              onclick={refreshResults}>Try again</button
            >
          </div>
        {:else if resultAssets.length === 0}
          <div
            class="flex min-h-96 flex-col items-center justify-center px-6 text-center text-gray-500 dark:text-gray-400"
          >
            <Icon icon={mdiImageMultipleOutline} size="34" />
            <h3 class="mt-3 font-semibold text-gray-800 dark:text-gray-100">No shared photos</h3>
            <p class="mt-1 max-w-sm text-sm">These tags do not overlap. Remove one tag to broaden the result.</p>
          </div>
        {:else}
          <div bind:clientHeight={viewport.height} bind:clientWidth={viewport.width} class="min-h-96">
            <GalleryViewer
              assets={resultAssets}
              assetInteraction={assetMultiSelectManager}
              {viewport}
              pageHeaderOffset={152}
            />
          </div>
          {#if canLoadMore}
            <div class="flex justify-center py-5">
              <button
                type="button"
                class="flex min-h-11 items-center gap-2 rounded-full border border-gray-300 px-5 text-sm font-semibold hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
                onclick={loadMore}
                disabled={resultsLoading}
              >
                {#if resultsLoading}<LoadingSpinner />{:else}<Icon icon={mdiChevronDown} size="18" />{/if}
                Load more
              </button>
            </div>
          {/if}
        {/if}
      </div>
    </section>
  </div>
</div>

{#if assetMultiSelectManager.selectionActive}
  <div class="fixed inset-s-0 top-0 z-50 w-full">
    <AssetSelectControlBar>
      <CreateSharedLink />
      <FavoriteAction
        removeFavorite={assetMultiSelectManager.isAllFavorite}
        onFavorite={(ids, isFavorite) => {
          for (const asset of resultAssets) {
            if (ids.includes(asset.id)) {
              asset.isFavorite = isFavorite;
            }
          }
        }}
      />
      <DownloadAction />
      {#if authManager.preferences.tags.enabled}<TagAction />{/if}
    </AssetSelectControlBar>
  </div>
{/if}

<style>
  .tag-source-active {
    background: white;
    color: rgb(66 80 175);
    box-shadow: 0 1px 3px rgb(15 23 42 / 0.12);
  }

  :global(.dark) .tag-source-active {
    background: rgb(55 65 81);
    color: rgb(173 216 255);
  }

  .tag-filter-active {
    border-color: rgb(66 80 175);
    background: rgb(66 80 175 / 0.1);
    color: rgb(66 80 175);
  }

  :global(.dark) .tag-filter-active {
    border-color: rgb(173 216 255);
    background: rgb(173 216 255 / 0.12);
    color: rgb(173 216 255);
  }

  .selected-tag-row {
    background: rgb(66 80 175 / 0.08);
    box-shadow: inset 0 0 0 1px rgb(66 80 175 / 0.24);
  }

  :global(.dark) .selected-tag-row {
    background: rgb(173 216 255 / 0.1);
    box-shadow: inset 0 0 0 1px rgb(173 216 255 / 0.24);
  }
</style>
