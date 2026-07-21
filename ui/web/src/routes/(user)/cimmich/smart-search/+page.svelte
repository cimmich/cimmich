<script lang="ts">
  import CimmichDocuments from '$lib/components/cimmich/CimmichDocuments.svelte';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import { cimmichVisibilityManager } from '$lib/managers/cimmich-visibility-manager.svelte';
  import {
    CimmichServiceError,
    searchCimmichSmart,
    type CimmichSmartSearchResult,
  } from '$lib/services/cimmich.service';
  import { formatDocumentDate, labelForDocumentKind } from '$lib/components/cimmich/document-presentation';
  import { smartSearchEntityLabel, smartSearchMatchLabel } from '$lib/components/cimmich/smart-search-presentation';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import {
    mdiCalendarRange,
    mdiFileDocumentOutline,
    mdiImageSearchOutline,
    mdiMagnify,
    mdiTagMultipleOutline,
  } from '@mdi/js';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
  let query = $state(data.initialQuery);
  let submittedQuery = $state(data.initialQuery);
  let result = $state<CimmichSmartSearchResult | null>(null);
  let error = $state<CimmichServiceError | null>(null);
  let isSearching = $state(false);
  let validationError = $state('');
  let lens = $state<'documents' | 'photos'>(data.initialLens);
  let documentLensQuery = $state('');
  let photoTab = $state<HTMLButtonElement>();
  let documentTab = $state<HTMLButtonElement>();
  let searchGeneration = 0;

  const selectLens = (nextLens: 'documents' | 'photos') => {
    if (nextLens === 'documents') {
      documentLensQuery = '';
    }
    lens = nextLens;
  };

  const handleLensKeydown = (event: KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const nextLens = event.key === 'ArrowLeft' || event.key === 'Home' ? 'photos' : 'documents';
    selectLens(nextLens);
    void (nextLens === 'photos' ? photoTab : documentTab)?.focus();
  };

  const asError = (caught: unknown) =>
    caught instanceof CimmichServiceError
      ? caught
      : new CimmichServiceError(caught instanceof Error ? caught.message : 'Search could not be completed.', {
          code: 'CIMMICH_REQUEST_FAILED',
          status: 0,
        });

  const search = async (event?: SubmitEvent, requestedQuery?: string) => {
    event?.preventDefault();
    const nextQuery = requestedQuery ?? query.trim();
    validationError = '';
    if (nextQuery.length < 2) {
      validationError = 'Enter at least two characters.';
      return;
    }
    if (nextQuery.length > 500) {
      validationError = 'Keep the search under 500 characters.';
      return;
    }
    const generation = ++searchGeneration;
    isSearching = true;
    error = null;
    result = null;
    try {
      const next = await searchCimmichSmart(nextQuery, 120);
      if (generation !== searchGeneration) {
        return;
      }
      result = next;
      submittedQuery = nextQuery;
    } catch (error_) {
      if (generation !== searchGeneration) {
        return;
      }
      error = asError(error_);
      result = null;
    } finally {
      if (generation === searchGeneration) {
        isSearching = false;
      }
    }
  };

  $effect(() => {
    void cimmichVisibilityManager.version;
    if (submittedQuery) {
      result = null;
      error = null;
      void search(undefined, submittedQuery);
    }
  });
</script>

<UserPageLayout title={data.meta.title}>
  <div class="mx-auto w-full max-w-[1500px] px-4 pb-20 sm:px-6 lg:px-10">
    <section class="mx-auto max-w-4xl pt-8 text-center sm:pt-14">
      <span
        class="mx-auto flex size-14 items-center justify-center rounded-3xl bg-primary/10 text-primary"
        aria-hidden="true"
      >
        <Icon icon={mdiImageSearchOutline} size="29" />
      </span>
      <h1 class="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">
        {lens === 'photos' ? 'Find a moment' : 'Find a document'}
      </h1>
      <p class="mx-auto mt-3 max-w-2xl text-sm/6 text-gray-600 dark:text-gray-300">
        {lens === 'photos'
          ? 'Search names, pets, places, things, events and dates you have recorded in Cimmich.'
          : 'Search titles, filenames, types, dates and confirmed links.'}
      </p>
      <div
        class="mx-auto mt-6 inline-flex rounded-full bg-gray-100 p-1 dark:bg-gray-800"
        role="tablist"
        aria-label="Search lens"
      >
        <button
          bind:this={photoTab}
          class={`min-h-11 rounded-full px-5 text-sm font-semibold ${lens === 'photos' ? 'bg-white text-primary shadow-sm dark:bg-gray-900' : 'text-gray-600 dark:text-gray-300'}`}
          type="button"
          role="tab"
          aria-selected={lens === 'photos'}
          tabindex={lens === 'photos' ? 0 : -1}
          onkeydown={handleLensKeydown}
          onclick={() => selectLens('photos')}>Photos</button
        >
        <button
          bind:this={documentTab}
          class={`min-h-11 rounded-full px-5 text-sm font-semibold ${lens === 'documents' ? 'bg-white text-primary shadow-sm dark:bg-gray-900' : 'text-gray-600 dark:text-gray-300'}`}
          type="button"
          role="tab"
          aria-selected={lens === 'documents'}
          tabindex={lens === 'documents' ? 0 : -1}
          onkeydown={handleLensKeydown}
          onclick={() => selectLens('documents')}>All documents</button
        >
      </div>
      {#if lens === 'photos'}
        <form class="relative mx-auto mt-7 max-w-3xl" role="search" onsubmit={(event) => void search(event)}>
          <label>
            <span class="sr-only">Search your Cimmich library</span>
            <Icon
              class="pointer-events-none absolute top-[22px] left-5 -translate-y-1/2 text-gray-500"
              icon={mdiMagnify}
              size="22"
            />
            <input
              class="min-h-12 w-full rounded-full border border-gray-300 bg-white pr-28 pl-13 text-base shadow-sm transition outline-none focus:border-primary focus:ring-4 focus:ring-primary/15 dark:border-gray-700 dark:bg-gray-900"
              bind:value={query}
              aria-describedby={validationError ? 'smart-search-error' : undefined}
              placeholder="Maya at Cedar House, Bluewater in 2024…"
              maxlength="500"
              autocomplete="off"
              onkeydown={(event) => {
                if (event.key === 'Enter' && !event.isComposing) {
                  event.preventDefault();
                  void search();
                }
              }}
            />
          </label>
          <button
            class="absolute top-1 right-1 min-h-10 rounded-full bg-primary px-5 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50"
            type="submit"
            disabled={isSearching}
          >
            {isSearching ? 'Searching…' : 'Search'}
          </button>
        </form>
        {#if validationError}<p
            class="mt-2 text-sm text-red-700 dark:text-red-300"
            id="smart-search-error"
            role="alert"
          >
            {validationError}
          </p>{/if}
      {/if}
    </section>

    {#if lens === 'documents'}
      <div class="mx-auto mt-10 max-w-6xl text-left">
        <CimmichDocuments heading="All documents" initialQuery={documentLensQuery} />
      </div>
    {:else}
      {#if error}
        <div
          class="mx-auto mt-8 max-w-3xl rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
          role="alert"
        >
          <p class="font-semibold">{error.message}</p>
          <p class="mt-1 text-xs opacity-75">{error.code}</p>
        </div>
      {/if}

      {#if isSearching}
        <div
          class="mt-10 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6"
          aria-label="Searching"
          aria-busy="true"
        >
          {#each Array.from({ length: 18 }) as _, index (index)}<div
              class="aspect-square animate-pulse rounded-2xl bg-gray-100 dark:bg-gray-800"
            ></div>{/each}
        </div>
      {:else if result}
        <section class="mt-10" aria-labelledby="smart-results-title">
          <div class="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 class="text-xl font-semibold" id="smart-results-title">
                {result.items.length + result.documents.length === 0
                  ? 'No matching results'
                  : `${result.items.length + result.documents.length} ${result.items.length + result.documents.length === 1 ? 'result' : 'results'}`}
              </h2>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                for “{result.query}”{result.hasMore || result.documentHasMore ? ' · more results available' : ''}
              </p>
            </div>
            <details class="relative">
              <summary
                class="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-full border border-gray-300 px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-primary dark:border-gray-700"
              >
                <Icon icon={mdiTagMultipleOutline} size="19" /> What matched
              </summary>
              <div
                class="absolute top-13 right-0 z-20 w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-xl dark:border-gray-700 dark:bg-gray-900"
              >
                {#if result.interpretation.selectors.length > 0}
                  <p class="text-xs font-bold tracking-[0.14em] text-gray-500 uppercase">Recognised</p>
                  <ul class="mt-2 grid gap-2">
                    {#each result.interpretation.selectors as selector (`${selector.selectorKind}:${selector.entityKind}:${selector.label}`)}
                      <li class="rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-800">
                        <span class="font-semibold">{selector.label}</span><span class="ml-2 text-xs text-gray-500"
                          >{smartSearchEntityLabel(selector.entityKind)} · {smartSearchMatchLabel(
                            selector.matchKind,
                          )}</span
                        >
                      </li>
                    {/each}
                  </ul>
                {/if}
                {#if result.interpretation.dateRange}
                  <p class="mt-4 flex items-center gap-2 text-sm">
                    <Icon icon={mdiCalendarRange} size="18" /><span class="font-semibold"
                      >{result.interpretation.dateRange.sourceText}</span
                    ><span class="text-gray-500">({result.interpretation.dateRange.precision})</span>
                  </p>
                {/if}
                {#if result.interpretation.unresolvedTerms.length > 0}
                  <p class="mt-4 text-xs font-bold tracking-[0.14em] text-gray-500 uppercase">Not understood yet</p>
                  <div class="mt-2 flex flex-wrap gap-2">
                    {#each result.interpretation.unresolvedTerms as term (term)}<span
                        class="rounded-full border border-gray-300 px-2.5 py-1 text-xs dark:border-gray-700"
                        >{term}</span
                      >{/each}
                  </div>
                {/if}
                {#if result.interpretation.candidateSetTruncated}
                  <p
                    class="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                  >
                    The candidate pool reached 5,000 items. Refine the names, context or date for a narrower result.
                  </p>
                {/if}
              </div>
            </details>
          </div>

          {#if result.items.length + result.documents.length === 0}
            <div
              class="mt-5 rounded-3xl border border-dashed border-gray-300 px-6 py-16 text-center dark:border-gray-700"
            >
              <Icon class="mx-auto text-gray-400" icon={mdiImageSearchOutline} size="34" />
              <p class="mt-4 font-semibold">Try a recorded name, place, thing, event, Document or date</p>
              {#if result.interpretation.unresolvedTerms.length > 0}<p
                  class="mx-auto mt-2 max-w-xl text-sm/6 text-gray-500"
                >
                  Some words were not recognised. Basic Search only uses details already recorded in Cimmich.
                </p>{/if}
            </div>
          {:else}
            {#if result.documents.length > 0}
              <section class="mt-6" aria-labelledby="smart-document-results-title">
                <div class="flex items-center justify-between gap-3">
                  <h3 class="text-base font-semibold" id="smart-document-results-title">
                    Documents · {result.documents.length}
                  </h3>
                  {#if result.documentHasMore}<span class="text-xs text-gray-500">More Documents available</span>{/if}
                </div>
                <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {#each result.documents as document (document.documentId)}
                    <button
                      class="flex min-h-28 items-start gap-3 rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-primary/40 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:border-gray-700 dark:bg-gray-900"
                      type="button"
                      aria-label={`Open ${document.displayTitle} in Documents`}
                      onclick={() => {
                        documentLensQuery = document.displayTitle;
                        lens = 'documents';
                      }}
                    >
                      <span
                        class="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"
                        aria-hidden="true"
                      >
                        <Icon icon={mdiFileDocumentOutline} size="23" />
                      </span>
                      <span class="min-w-0 flex-1">
                        <span class="line-clamp-2 block leading-5 font-semibold">{document.displayTitle}</span>
                        <span class="mt-1 block truncate text-xs text-gray-500 dark:text-gray-400">
                          {labelForDocumentKind(document.documentKind, document.documentLabel)} · {document.sourceFilename}
                        </span>
                        {#if document.issuedOn || document.subjectCount}
                          <span class="mt-2 block text-xs text-gray-500 dark:text-gray-400">
                            {#if document.issuedOn}{formatDocumentDate(
                                document.issuedOn,
                              )}{/if}{#if document.issuedOn && document.subjectCount}
                              ·
                            {/if}{#if document.subjectCount}{document.subjectCount} link{document.subjectCount === 1
                                ? ''
                                : 's'}{/if}
                          </span>
                        {/if}
                      </span>
                      <span
                        class="rounded-full bg-gray-100 px-2 py-1 text-[11px] font-semibold capitalize dark:bg-gray-800"
                        >{document.effectiveVisibilityTier}</span
                      >
                    </button>
                  {/each}
                </div>
              </section>
            {/if}
            {#if result.items.length > 0}
              <section class="mt-6" aria-labelledby="smart-photo-results-title">
                <h3 class="text-base font-semibold" id="smart-photo-results-title">Photos · {result.items.length}</h3>
                <div class="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
                  {#each result.items as item (item.assetId)}
                    <a
                      class="group relative aspect-square overflow-hidden rounded-2xl bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:bg-gray-800"
                      href={`/photos/${encodeURIComponent(item.sourceAssetId)}`}
                      aria-label={`Open ${item.filename}`}
                    >
                      <img
                        class="size-full object-cover transition duration-300 group-hover:scale-[1.02]"
                        src={getAssetMediaUrl({ id: item.sourceAssetId, size: AssetMediaSize.Preview })}
                        alt={item.filename}
                        loading="lazy"
                      />
                      {#if item.captureTime}<time
                          class="absolute right-2 bottom-2 rounded-full bg-black/55 px-2 py-1 text-[11px] font-semibold text-white backdrop-blur-sm"
                          datetime={item.captureTime}
                          >{new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }).format(
                            new Date(item.captureTime),
                          )}</time
                        >{/if}
                    </a>
                  {/each}
                </div>
              </section>
            {/if}
          {/if}
        </section>
      {:else}
        <section class="mx-auto mt-12 grid max-w-4xl gap-3 sm:grid-cols-3" aria-label="Search suggestions">
          <button class="smart-search-prompt" type="button" onclick={() => (query = 'Maya')}
            ><Icon icon={mdiTagMultipleOutline} size="22" /><span
              ><strong>People & pets</strong><small>Search a recorded name</small></span
            ></button
          >
          <button class="smart-search-prompt" type="button" onclick={() => (query = 'Cedar House')}
            ><Icon icon={mdiMagnify} size="22" /><span
              ><strong>Context</strong><small>Places, things and events</small></span
            ></button
          >
          <button class="smart-search-prompt" type="button" onclick={() => (query = String(new Date().getFullYear()))}
            ><Icon icon={mdiCalendarRange} size="22" /><span
              ><strong>Dates</strong><small>Day, month or year</small></span
            ></button
          >
        </section>
      {/if}
    {/if}
  </div>
</UserPageLayout>

<style>
  :global(.smart-search-prompt) {
    display: flex;
    min-height: 5rem;
    align-items: center;
    gap: 0.8rem;
    border-radius: 1.25rem;
    border: 1px solid rgb(229 231 235);
    background: white;
    padding: 1rem;
    text-align: left;
    transition: 150ms;
  }
  :global(.dark .smart-search-prompt) {
    border-color: rgb(55 65 81);
    background: rgb(17 24 39);
  }
  :global(.smart-search-prompt:hover) {
    border-color: rgb(var(--immich-primary) / 0.45);
    transform: translateY(-1px);
  }
  :global(.smart-search-prompt:focus-visible) {
    outline: 2px solid rgb(var(--immich-primary));
    outline-offset: 2px;
  }
  :global(.smart-search-prompt svg) {
    flex: none;
    color: rgb(var(--immich-primary));
  }
  :global(.smart-search-prompt span) {
    display: grid;
    gap: 0.2rem;
  }
  :global(.smart-search-prompt small) {
    color: rgb(107 114 128);
    font-size: 0.75rem;
  }
</style>
