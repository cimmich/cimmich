<script lang="ts">
  import { filterVisibleCimmichAssets } from '$lib/components/cimmich/asset-picker-visibility';
  import {
    type CimmichHomeCoverMode,
    type CimmichHomeCoverPreference,
    type CimmichHomeCoverRandomScope,
    type CimmichHomeCoverSlot,
  } from '$lib/components/cimmich/home-cover-preferences';
  import { getCimmichAssetEvidence, searchCimmichSmart } from '$lib/services/cimmich.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize, AssetTypeEnum, searchAssets } from '@immich/sdk';
  import { Icon, Modal, ModalBody, ModalFooter } from '@immich/ui';
  import {
    mdiAutoFix,
    mdiCheck,
    mdiHeartOutline,
    mdiImageMultipleOutline,
    mdiImageOutline,
    mdiMagnify,
    mdiPencilOutline,
    mdiShuffleVariant,
  } from '@mdi/js';
  import { SvelteSet } from 'svelte/reactivity';

  type PickerAsset = { id: string; label: string; thumbhash?: string | null };
  type Props = {
    candidateAssetIds: string[];
    label: string;
    onSave: (preference: CimmichHomeCoverPreference) => void;
    preference?: CimmichHomeCoverPreference;
    slot: CimmichHomeCoverSlot;
  };

  let { candidateAssetIds, label, onSave, preference, slot }: Props = $props();

  let editorOpen = $state(false);
  let mode = $state<CimmichHomeCoverMode>('automatic');
  let randomScope = $state<CimmichHomeCoverRandomScope>('section');
  let recentAssets = $state<PickerAsset[]>([]);
  let searchAssetsResult = $state<PickerAsset[]>([]);
  let searchError = $state('');
  let searchInput: HTMLInputElement | undefined = $state();
  let searchLoading = $state(false);
  let searchQuery = $state('');
  let selectedIds = $state<string[]>([]);
  let recentLoading = $state(false);
  let recentLoadGeneration = 0;
  let searchGeneration = 0;

  const suggestedAssets = $derived<PickerAsset[]>(candidateAssetIds.map((id) => ({ id, label: 'Suggested cover' })));
  const pickerAssets = $derived.by(() => {
    const seen = new SvelteSet<string>();
    const assets: PickerAsset[] = [
      ...selectedIds.map((id) => ({ id, label: 'Selected photo' })),
      ...suggestedAssets,
      ...searchAssetsResult,
      ...recentAssets,
    ];
    return assets.filter((asset) => {
      if (seen.has(asset.id)) {
        return false;
      }
      seen.add(asset.id);
      return true;
    });
  });
  const maximum = $derived(mode === 'single' ? 1 : 6);
  const canSave = $derived(
    mode === 'automatic' ||
      mode === 'random' ||
      (mode === 'single' && selectedIds.length === 1) ||
      (mode === 'group' && selectedIds.length >= 2 && selectedIds.length <= 6),
  );

  const loadRecentAssets = async () => {
    const generation = ++recentLoadGeneration;
    recentLoading = true;
    searchError = '';
    try {
      const result = await searchAssets({ metadataSearchDto: { size: 80, type: AssetTypeEnum.Image, withExif: true } });
      const readable = await filterVisibleCimmichAssets(
        result.assets.items.filter((asset) => !asset.isTrashed && !asset.isOffline),
        getCimmichAssetEvidence,
      );
      if (generation === recentLoadGeneration) {
        recentAssets = readable.map((asset) => ({
          id: asset.id,
          label: asset.originalFileName,
          thumbhash: asset.thumbhash,
        }));
      }
    } catch {
      if (generation === recentLoadGeneration) {
        searchError = 'Recent photos could not be loaded. Suggested covers are still available.';
      }
    } finally {
      if (generation === recentLoadGeneration) {
        recentLoading = false;
      }
    }
  };

  const openEditor = () => {
    mode = preference?.mode ?? 'automatic';
    randomScope = preference?.randomScope ?? 'section';
    selectedIds = [...(preference?.assetIds ?? [])];
    searchQuery = '';
    searchAssetsResult = [];
    searchError = '';
    editorOpen = true;
    if (recentAssets.length === 0) {
      void loadRecentAssets();
    }
  };

  const selectMode = (next: CimmichHomeCoverMode) => {
    mode = next;
    if (next === 'single' && selectedIds.length > 1) {
      selectedIds = selectedIds.slice(0, 1);
    }
  };

  const toggleAsset = (id: string) => {
    if (selectedIds.includes(id)) {
      selectedIds = selectedIds.filter((candidate) => candidate !== id);
      return;
    }
    if (mode === 'single') {
      selectedIds = [id];
      return;
    }
    if (selectedIds.length < maximum) {
      selectedIds = [...selectedIds, id];
    }
  };

  const runSearch = async () => {
    const query = searchQuery.trim();
    if (query.length < 2) {
      searchError = 'Enter at least two characters.';
      return;
    }
    const generation = ++searchGeneration;
    searchLoading = true;
    searchError = '';
    try {
      const result = await searchCimmichSmart(query, 120);
      if (generation === searchGeneration) {
        searchAssetsResult = result.items
          .filter((item) => item.mediaKind === 'image')
          .map((item) => ({ id: item.sourceAssetId, label: item.filename }));
        if (searchAssetsResult.length === 0) {
          searchError = `No visible photos matched “${query}”.`;
        }
      }
    } catch {
      if (generation === searchGeneration) {
        searchError = 'Search could not be completed. No cover changed.';
      }
    } finally {
      if (generation === searchGeneration) {
        searchLoading = false;
      }
    }
  };

  const save = () => {
    if (!canSave) {
      return;
    }
    onSave({
      assetIds: mode === 'single' || mode === 'group' ? selectedIds.slice(0, maximum) : [],
      mode,
      randomScope,
    });
    editorOpen = false;
  };
</script>

<button
  class="absolute top-3 right-3 z-20 flex size-10 items-center justify-center rounded-full border border-white/25 bg-black/45 text-white shadow-sm backdrop-blur-md transition hover:scale-105 hover:bg-black/65 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
  type="button"
  onclick={openEditor}
  aria-label={`Change ${label} cover`}
  title={`Change ${label} cover`}
  data-cover-slot={slot}
>
  <Icon icon={mdiPencilOutline} size="19" />
</button>

{#if editorOpen}
  <Modal
    title={`Choose ${label} cover`}
    icon={mdiPencilOutline}
    size="giant"
    onOpenAutoFocus={(event) => event.preventDefault()}
    onClose={() => (editorOpen = false)}
  >
    <ModalBody class="flex min-h-0 flex-col gap-5 overflow-hidden">
      <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label="Cover style" role="group">
        {#each [{ description: 'Use Cimmich’s current cover logic.', icon: mdiAutoFix, label: 'Automatic', value: 'automatic' as const }, { description: 'Pin one photo.', icon: mdiImageOutline, label: 'Set photo', value: 'single' as const }, { description: 'Make a mosaic of 2–6 photos.', icon: mdiImageMultipleOutline, label: 'Group', value: 'group' as const }, { description: 'Choose afresh when Home opens.', icon: mdiShuffleVariant, label: 'Random from…', value: 'random' as const }] as option (option.value)}
          <button
            class={`min-h-24 rounded-2xl border p-3 text-left transition ${mode === option.value ? 'border-primary bg-primary/8 ring-2 ring-primary/20' : 'border-gray-200 hover:border-primary/60 dark:border-immich-dark-gray'}`}
            type="button"
            onclick={() => selectMode(option.value)}
            aria-pressed={mode === option.value}
          >
            <span class="flex items-center gap-2 font-semibold"
              ><Icon icon={option.icon} size="20" />{option.label}</span
            >
            <span class="mt-1 block text-xs/5 text-gray-500 dark:text-gray-400">{option.description}</span>
          </button>
        {/each}
      </div>

      {#if mode === 'single' || mode === 'group'}
        <div
          class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200 dark:border-immich-dark-gray"
        >
          <div
            class="flex flex-col gap-3 border-b border-gray-200 p-3 sm:flex-row sm:items-center dark:border-immich-dark-gray"
          >
            <form
              class="flex min-w-0 flex-1 gap-2"
              onsubmit={(event) => {
                event.preventDefault();
                void runSearch();
              }}
            >
              <label
                class="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-gray-100 px-3 dark:bg-immich-dark-gray/70"
              >
                <Icon icon={mdiMagnify} size="18" class="text-gray-500" />
                <input
                  bind:this={searchInput}
                  bind:value={searchQuery}
                  class="min-h-11 min-w-0 flex-1 bg-transparent text-sm outline-none"
                  placeholder="Search people, places, filenames or stories"
                  type="search"
                />
              </label>
              <button
                class="min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-white disabled:opacity-45"
                type="submit"
                disabled={searchLoading}>{searchLoading ? 'Searching…' : 'Search'}</button
              >
            </form>
            <span class="shrink-0 text-sm font-medium" aria-live="polite">{selectedIds.length}/{maximum} selected</span>
          </div>

          {#if searchError}
            <p
              class="mx-3 mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
              role="status"
            >
              {searchError}
            </p>
          {/if}

          <div class="min-h-64 flex-1 overflow-y-auto p-3">
            {#if recentLoading && pickerAssets.length === 0}
              <p class="py-12 text-center text-sm text-gray-500">Loading visible photos…</p>
            {:else}
              <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {#each pickerAssets as asset (asset.id)}
                  {@const selected = selectedIds.includes(asset.id)}
                  <button
                    class={`group relative aspect-square overflow-hidden rounded-xl bg-gray-100 ring-offset-2 transition dark:bg-immich-dark-gray dark:ring-offset-immich-dark-bg ${selected ? 'ring-3 ring-primary' : 'hover:ring-2 hover:ring-primary/50'}`}
                    type="button"
                    onclick={() => toggleAsset(asset.id)}
                    aria-label={`${selected ? 'Deselect' : 'Select'} ${asset.label}`}
                    aria-pressed={selected}
                  >
                    <img
                      class="size-full object-cover transition-transform duration-300 group-hover:scale-[1.025] motion-reduce:transform-none motion-reduce:transition-none"
                      src={getAssetMediaUrl({
                        id: asset.id,
                        cacheKey: asset.thumbhash ?? undefined,
                        size: AssetMediaSize.Thumbnail,
                      })}
                      alt=""
                      loading="lazy"
                    />
                    <span
                      class="absolute inset-x-0 bottom-0 truncate bg-linear-to-t from-black/80 px-2 pt-7 pb-2 text-left text-xs text-white"
                      >{asset.label}</span
                    >
                    {#if selected}
                      <span
                        class="absolute top-2 right-2 flex size-6 items-center justify-center rounded-full bg-primary text-white shadow-sm"
                      >
                        <Icon icon={mdiCheck} size="16" />
                      </span>
                    {/if}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      {:else if mode === 'random'}
        <div class="grid gap-2 sm:grid-cols-3" aria-label="Random cover source" role="radiogroup">
          {#each [{ description: 'Only photos already represented by this Home section.', icon: mdiImageMultipleOutline, label: 'This section', value: 'section' as const }, { description: 'Any favourite allowed by the current viewing mode.', icon: mdiHeartOutline, label: 'Favourites', value: 'favorites' as const }, { description: 'Any library photo allowed by the current viewing mode.', icon: mdiShuffleVariant, label: 'Visible library', value: 'library' as const }] as option (option.value)}
            <button
              class={`min-h-24 rounded-2xl border p-3 text-left transition ${randomScope === option.value ? 'border-primary bg-primary/8 ring-2 ring-primary/20' : 'border-gray-200 hover:border-primary/60 dark:border-immich-dark-gray'}`}
              type="button"
              onclick={() => (randomScope = option.value)}
              role="radio"
              aria-checked={randomScope === option.value}
            >
              <span class="flex items-center gap-2 font-semibold"
                ><Icon icon={option.icon} size="20" />{option.label}</span
              >
              <span class="mt-1 block text-xs/5 text-gray-500 dark:text-gray-400">{option.description}</span>
            </button>
          {/each}
        </div>
      {:else}
        <p class="rounded-2xl bg-gray-100 p-4 text-sm text-gray-600 dark:bg-immich-dark-gray/60 dark:text-gray-300">
          Automatic restores Cimmich’s existing Event-first, category-fallback selection for this cover.
        </p>
      {/if}
    </ModalBody>

    <ModalFooter class="flex items-center justify-between gap-3">
      <p class="text-xs text-gray-500 dark:text-gray-400">Saved for {label} in this viewing mode.</p>
      <div class="flex gap-2">
        <button
          class="rounded-xl px-4 py-2 text-sm font-semibold hover:bg-gray-100 dark:hover:bg-immich-dark-gray"
          type="button"
          onclick={() => (editorOpen = false)}>Cancel</button
        >
        <button
          class="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
          type="button"
          onclick={save}
          disabled={!canSave}>Save cover</button
        >
      </div>
    </ModalFooter>
  </Modal>
{/if}
