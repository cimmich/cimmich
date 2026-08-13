<script lang="ts">
  import {
    cimmichExploreFilterCount,
    emptyCimmichExploreFilters,
    normalizeCimmichExploreFilters,
  } from '$lib/components/cimmich/explore-filters';
  import { cimmichVisibilityManager } from '$lib/managers/cimmich-visibility-manager.svelte';
  import type {
    CimmichExploreFacet,
    CimmichExploreFacetResult,
    CimmichExploreFilters,
    CimmichVisibilityTier,
  } from '$lib/services/cimmich.service';
  import { mdiChevronDown, mdiChevronUp, mdiClose, mdiFilterVariant, mdiLockOutline } from '@mdi/js';
  import { Icon } from '@immich/ui';

  interface Props {
    error?: string;
    filters: CimmichExploreFilters;
    initiallyExpanded?: boolean;
    loading?: boolean;
    onchange: (filters: CimmichExploreFilters) => void;
    onexpand?: () => void;
    result?: CimmichExploreFacetResult | null;
  }

  let {
    error = '',
    filters,
    initiallyExpanded = false,
    loading = false,
    onchange,
    onexpand,
    result = null,
  }: Props = $props();
  let expanded = $state(initiallyExpanded);
  let pendingMode = $state<CimmichVisibilityTier | null>(null);
  let pendingFilters = $state<CimmichExploreFilters | null>(null);
  const activeCount = $derived(cimmichExploreFilterCount(filters));
  const resultLabel = $derived(
    loading && !result
      ? 'Reading this view…'
      : result
        ? `${result.totalAssets.toLocaleString()} of ${result.availableAssets.toLocaleString()} photos${result.scope.kind === 'people' ? ` · ${result.people.length.toLocaleString()} people` : ''}`
        : 'Explore this view',
  );

  type ArrayKey = 'eventIds' | 'labelIds' | 'placeIds' | 'thingIds';
  type SelectionKey = ArrayKey | 'privacyTiers';
  const update = (next: CimmichExploreFilters) => onchange(normalizeCimmichExploreFilters(next));
  const toggleExpanded = () => {
    expanded = !expanded;
    if (expanded && !result) {
      onexpand?.();
    }
  };
  const viewingModeRank = (mode: CimmichVisibilityTier) => (mode === 'standard' ? 0 : mode === 'personal' ? 1 : 2);
  const needsViewingMode = (tier: CimmichVisibilityTier) =>
    viewingModeRank(tier) > viewingModeRank(cimmichVisibilityManager.viewingMode);
  const requestViewingMode = (mode: CimmichVisibilityTier, nextFilters: CimmichExploreFilters | null = null) => {
    pendingMode = nextFilters ? mode : null;
    pendingFilters = nextFilters;
    globalThis.dispatchEvent(new CustomEvent('cimmich:request-viewing-mode', { detail: { mode } }));
  };
  const setPrivacy = (tier: CimmichVisibilityTier) => {
    const next = { ...filters, privacyTiers: filters.privacyTiers.includes(tier) ? [] : [tier] };
    if (next.privacyTiers.length > 0 && needsViewingMode(tier)) {
      requestViewingMode(tier, next);
      return;
    }
    update(next);
  };
  const add = (key: ArrayKey, value: string) => {
    if (value && !filters[key].includes(value)) {
      update({ ...filters, [key]: [...filters[key], value] });
    }
  };
  const remove = (key: SelectionKey, value: string) =>
    update({ ...filters, [key]: filters[key].filter((item) => item !== value) });
  const facetName = (items: CimmichExploreFacet[], id: string) =>
    items.find((item) => item.id === id)?.displayName ?? id;
  const selectionGroups = $derived([
    { items: result?.facets.labels ?? [], key: 'labelIds' as const, label: 'Label', values: filters.labelIds },
    { items: result?.facets.places ?? [], key: 'placeIds' as const, label: 'Place', values: filters.placeIds },
    { items: result?.facets.events ?? [], key: 'eventIds' as const, label: 'Event', values: filters.eventIds },
    { items: result?.facets.things ?? [], key: 'thingIds' as const, label: 'Thing', values: filters.thingIds },
  ]);
  $effect(() => {
    if (
      pendingMode &&
      pendingFilters &&
      viewingModeRank(cimmichVisibilityManager.viewingMode) >= viewingModeRank(pendingMode)
    ) {
      const next = pendingFilters;
      pendingMode = null;
      pendingFilters = null;
      globalThis.queueMicrotask(() => update(next));
    }
  });
</script>

<section class="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-immich-dark-gray">
  <div class="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:px-4">
    <button
      class="inline-flex h-9 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-immich-fg transition hover:bg-gray-100 dark:text-immich-dark-fg dark:hover:bg-white/10"
      type="button"
      aria-expanded={expanded}
      onclick={toggleExpanded}
    >
      <Icon icon={mdiFilterVariant} size="18" /> Explore
      {#if activeCount > 0}
        <span class="rounded-full bg-primary px-2 py-0.5 text-[11px] text-white dark:text-black">{activeCount}</span>
      {/if}
      <Icon icon={expanded ? mdiChevronUp : mdiChevronDown} size="17" />
    </button>
    <span class="text-sm text-gray-600 dark:text-gray-300" aria-live="polite">{resultLabel}</span>
    {#if loading && result}
      <span class="size-2 animate-pulse rounded-full bg-primary" aria-label="Updating filters"></span>
    {/if}
    {#if activeCount > 0}
      <button
        class="ml-auto rounded-lg px-2.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10"
        type="button"
        onclick={() => update(emptyCimmichExploreFilters())}>Clear all</button
      >
    {/if}
  </div>

  {#if activeCount > 0}
    <div
      class="flex flex-wrap gap-1.5 border-t border-gray-100 px-4 py-2 dark:border-white/10"
      aria-label="Active filters"
    >
      {#if filters.futureDates}
        <button
          class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-950 dark:bg-amber-950 dark:text-amber-100"
          type="button"
          onclick={() => update({ ...filters, futureDates: false })}
        >
          Capture date after today <Icon icon={mdiClose} size="14" />
        </button>
      {/if}
      {#each filters.privacyTiers as tier (tier)}
        <button
          class="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-950 dark:bg-violet-950 dark:text-violet-100"
          type="button"
          onclick={() => remove('privacyTiers', tier)}
        >
          {tier[0]?.toUpperCase()}{tier.slice(1)} only <Icon icon={mdiClose} size="14" />
        </button>
      {/each}
      {#each selectionGroups as group (group.key)}
        {#each group.values as id (id)}
          <button
            class="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-950 dark:bg-sky-950 dark:text-sky-100"
            type="button"
            onclick={() => remove(group.key, id)}
          >
            {group.label}: {facetName(group.items, id)}
            <Icon icon={mdiClose} size="14" />
          </button>
        {/each}
      {/each}
    </div>
  {/if}

  {#if expanded}
    <div class="grid gap-4 border-t border-gray-200 p-4 md:grid-cols-2 xl:grid-cols-5 dark:border-gray-700">
      <fieldset class="min-w-0">
        <legend
          class="mb-2 flex items-center gap-1.5 text-xs font-bold tracking-wide text-gray-600 uppercase dark:text-gray-300"
        >
          <Icon icon={mdiLockOutline} size="16" /> Exact privacy
        </legend>
        <div class="grid grid-cols-3 gap-1.5">
          {#each result?.facets.privacy ?? [] as facet (facet.id)}
            {@const tier = facet.id as CimmichVisibilityTier}
            {@const protectedTier = needsViewingMode(tier)}
            <button
              class={[
                'rounded-lg border p-2 text-left text-xs transition',
                filters.privacyTiers.includes(facet.id as CimmichVisibilityTier)
                  ? 'border-primary bg-primary/10 font-semibold text-primary'
                  : 'border-gray-200 hover:border-primary/40 dark:border-gray-600',
              ]}
              type="button"
              aria-pressed={filters.privacyTiers.includes(tier)}
              onclick={() => setPrivacy(tier)}
            >
              <span class="block">{facet.displayName}</span>
              <span class="opacity-65">{protectedTier ? 'Enter to inspect' : facet.count.toLocaleString()}</span>
            </button>
          {/each}
        </div>
        <p class="mt-2 text-[11px]/4 text-gray-500 dark:text-gray-400">
          “Private” means Private only, not everything this viewing mode can access.
        </p>
      </fieldset>

      {#each selectionGroups as group (group.key)}
        <div class="min-w-0 text-xs font-bold tracking-wide text-gray-600 uppercase dark:text-gray-300">
          {group.label === 'Label' ? 'Tags & labels' : `${group.label}s`}
          <select
            class="mt-2 h-10 w-full rounded-lg border border-gray-200 bg-white px-2 text-sm font-normal tracking-normal text-immich-fg normal-case outline-none focus:border-primary dark:border-gray-600 dark:bg-black/20 dark:text-immich-dark-fg"
            aria-label={group.label === 'Label' ? 'Add tag or label filter' : `Add ${group.label.toLowerCase()} filter`}
            value=""
            onchange={(event) => {
              add(group.key, event.currentTarget.value);
              event.currentTarget.value = '';
            }}
          >
            <option value="">Add {group.label === 'Label' ? 'tag or label' : group.label.toLowerCase()}…</option>
            {#each group.items.filter((item) => !group.values.includes(item.id)) as facet (facet.id)}
              <option value={facet.id}>{facet.displayName} ({facet.count.toLocaleString()})</option>
            {/each}
          </select>
          {#if group.label === 'Label' && group.items.length === 0 && !loading && cimmichVisibilityManager.viewingMode !== 'private'}
            <button
              class="mt-2 block text-left text-[11px] font-semibold tracking-normal text-primary normal-case hover:underline"
              type="button"
              onclick={() => requestViewingMode('private')}>Enter Private for protected tags & labels</button
            >
          {:else if group.items.length === 0 && !loading}
            <span class="mt-2 block text-[11px] font-normal tracking-normal text-gray-500 normal-case"
              >None in this scope</span
            >
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if error}
    <p
      class="border-t border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
      role="alert"
    >
      {error}
    </p>
  {/if}
</section>
