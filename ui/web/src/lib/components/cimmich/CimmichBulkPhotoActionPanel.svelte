<script lang="ts">
  import { Icon } from '@immich/ui';
  import { mdiPlayCircleOutline } from '@mdi/js';
  import type { BulkPhotoSorterActionKind } from './bulk-photo-sorter';
  import CimmichBulkPhotoActionSelect from './CimmichBulkPhotoActionSelect.svelte';
  import CimmichFolderAlbumManifest from './CimmichFolderAlbumManifest.svelte';

  interface Props {
    action: BulkPhotoSorterActionKind;
    busy: boolean;
    canApply: boolean;
    creatingLabel: boolean;
    hasUndo: boolean;
    needsTarget: boolean;
    newLabelName: string;
    onapply: () => void;
    oncreateLabel: () => void;
    onsearchContext: () => void;
    optionsLoading: boolean;
    optionSearching: boolean;
    rootPath: string;
    targetId: string;
    targetOptionQuery: string;
    targetOptions: Array<{ id: string; label: string }>;
    undoing: boolean;
  }

  let {
    action = $bindable(),
    busy,
    canApply,
    creatingLabel,
    hasUndo,
    needsTarget,
    newLabelName = $bindable(),
    onapply,
    oncreateLabel,
    onsearchContext,
    optionsLoading,
    optionSearching,
    rootPath,
    targetId = $bindable(),
    targetOptionQuery = $bindable(),
    targetOptions,
    undoing,
  }: Props = $props();

  const selectAction = (event: Event) => {
    action = (event.currentTarget as HTMLSelectElement).value as BulkPhotoSorterActionKind;
    targetId = '';
    targetOptionQuery = '';
    newLabelName = '';
  };
</script>

<section
  class="mt-6 rounded-3xl border border-black/10 bg-white p-5 shadow-sm sm:p-7 dark:border-white/10 dark:bg-immich-dark-gray"
>
  <h2 class="text-xl font-semibold text-immich-primary dark:text-immich-dark-primary">3. Choose one action</h2>
  <p class="mt-2 text-sm text-immich-fg/65 dark:text-immich-dark-fg/65">
    One action per run keeps the receipt and Undo exact.
  </p>
  {#if hasUndo}
    <p
      class="mt-4 rounded-2xl border border-amber-400/35 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 dark:bg-amber-950/25 dark:text-amber-100"
    >
      A saved Undo receipt is still active. Undo it or keep those changes before applying another action.
    </p>
  {/if}
  <div class="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
    <CimmichBulkPhotoActionSelect value={action} onchange={selectAction} />
    {#if needsTarget}
      <div class="grid gap-1.5 text-sm font-medium">
        <span>Destination</span>
        {#if action === 'place-attach' || action === 'event-attach'}
          <div class="flex gap-2">
            <input
              class="min-w-0 flex-1 rounded-xl border border-black/15 bg-transparent px-3 py-2.5 dark:border-white/15"
              bind:value={targetOptionQuery}
              placeholder={`Search all ${action === 'place-attach' ? 'places' : 'events'}`}
            />
            <button
              class="rounded-xl border border-black/15 px-3 py-2 text-xs font-semibold hover:bg-black/5 disabled:opacity-50 dark:border-white/15 dark:hover:bg-white/5"
              type="button"
              onclick={onsearchContext}
              disabled={optionSearching}>Search</button
            >
          </div>
        {/if}
        {#if action === 'label-add'}
          <div class="flex gap-2">
            <input
              class="min-w-0 flex-1 rounded-xl border border-black/15 bg-transparent px-3 py-2.5 dark:border-white/15"
              bind:value={newLabelName}
              placeholder="Create a Cimmich label"
              aria-label="New Cimmich label name"
            />
            <button
              class="rounded-xl border border-black/15 px-3 py-2 text-xs font-semibold hover:bg-black/5 disabled:opacity-50 dark:border-white/15 dark:hover:bg-white/5"
              type="button"
              onclick={oncreateLabel}
              disabled={creatingLabel || !newLabelName.trim()}>{creatingLabel ? 'Creating…' : 'Create'}</button
            >
          </div>
        {/if}
        <select
          class="rounded-xl border border-black/15 bg-transparent px-3 py-2.5 dark:border-white/15"
          bind:value={targetId}
          disabled={optionsLoading || optionSearching}
          aria-label="Destination"
        >
          <option value="">Choose…</option>
          {#each targetOptions as option (option.id)}<option value={option.id}>{option.label}</option>{/each}
        </select>
      </div>
    {:else}
      <div class="hidden sm:block"></div>
    {/if}
    {#if action !== 'folders-to-albums'}
      <button
        class="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        type="button"
        onclick={onapply}
        disabled={!canApply || busy || undoing}
      >
        <Icon icon={mdiPlayCircleOutline} size="19" />
        {busy ? 'Applying…' : 'Review and apply'}
      </button>
    {:else}
      <div class="hidden sm:block"></div>
    {/if}
  </div>
  {#if action === 'folders-to-albums'}
    <CimmichFolderAlbumManifest {rootPath} />
  {/if}
  <p class="mt-4 text-xs/5 text-immich-fg/55 dark:text-immich-dark-fg/55">
    Cimmich labels and album memberships live in databases, not beside originals. Folder creation never moves files.
  </p>
</section>
