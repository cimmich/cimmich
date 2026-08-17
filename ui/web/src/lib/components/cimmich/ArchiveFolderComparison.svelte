<script lang="ts">
  import { Route } from '$lib/route';
  import { getAssetMediaUrl } from '$lib/utils';
  import { getParentPath } from '$lib/utils/tree-utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiArrowRight, mdiFolderMultipleImage, mdiImageCheckOutline, mdiImageSearchOutline } from '@mdi/js';
  import type { ArchiveFolderOverlap } from './archive-folder-comparison';

  interface Props {
    error: string;
    folderPath: string;
    loaded: boolean;
    loading: boolean;
    overlap: ArchiveFolderOverlap;
  }

  let { error, folderPath, loaded, loading, overlap }: Props = $props();
  let selectedFolder = $state('');
  let visibleGroupCount = $state(16);
  let visibleUniqueCount = $state(24);
  let filteredGroups = $derived(
    overlap.groups.filter(
      (group) =>
        !selectedFolder ||
        group.elsewhere.some(
          (asset) => Boolean(asset.originalPath) && getParentPath(asset.originalPath) === selectedFolder,
        ),
    ),
  );
  let visibleGroups = $derived(filteredGroups.slice(0, visibleGroupCount));

  const thumbnail = (sourceAssetId: string) => getAssetMediaUrl({ id: sourceAssetId, size: AssetMediaSize.Thumbnail });
  const folderLabel = (path: string) => path.split('/').findLast(Boolean) || path;
  const statusLabel = (classification: string) =>
    classification === 'verified_exact'
      ? 'Exact bytes'
      : classification === 'verified_variant'
        ? 'Different file'
        : 'Possible duplicate';
</script>

<section class="space-y-5" aria-labelledby="folder-comparison-title">
  <header class="flex flex-wrap items-start justify-between gap-4 px-1">
    <div class="min-w-0">
      <p class="text-xs font-semibold tracking-[0.14em] text-violet-700 uppercase dark:text-violet-300">
        Folder checker
      </p>
      <h2 id="folder-comparison-title" class="mt-1 text-2xl font-semibold">This folder against the archive</h2>
      <p class="mt-1 text-sm break-all text-gray-500 dark:text-gray-400">{folderPath}</p>
    </div>
    {#if selectedFolder}
      <button
        type="button"
        class="min-h-10 rounded-full border border-gray-300 px-4 text-sm font-semibold hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
        onclick={() => {
          selectedFolder = '';
          visibleGroupCount = 16;
        }}>Show every shared folder</button
      >
    {/if}
  </header>

  {#if error}
    <div
      class="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
    >
      {error}
    </div>
  {/if}

  {#if loading && !loaded}
    <div
      class="grid min-h-52 place-items-center rounded-3xl border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
    >
      <div class="text-center">
        <Icon icon={mdiImageSearchOutline} size="34" class="mx-auto animate-pulse text-violet-500" />
        <p class="mt-3 text-sm font-semibold">Checking every photo in this folder…</p>
      </div>
    </div>
  {:else if loaded}
    <div
      class="grid overflow-hidden rounded-3xl border border-gray-200 bg-white lg:grid-cols-2 dark:border-immich-dark-gray dark:bg-immich-dark-bg"
    >
      <div class="p-5 lg:border-r lg:border-gray-100 dark:lg:border-immich-dark-gray">
        <div class="flex items-center gap-3">
          <span
            class="grid size-11 place-items-center rounded-2xl bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200"
          >
            <Icon icon={mdiFolderMultipleImage} size="23" />
          </span>
          <div>
            <p class="text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">This folder</p>
            <p class="text-2xl font-semibold">{overlap.folderAssetCount.toLocaleString()} files</p>
          </div>
        </div>
        <dl class="mt-5 grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt class="text-gray-500 dark:text-gray-400">Shared</dt>
            <dd class="mt-1 text-xl font-semibold">{overlap.sharedAssetCount.toLocaleString()}</dd>
          </div>
          <div>
            <dt class="text-gray-500 dark:text-gray-400">Only here</dt>
            <dd class="mt-1 text-xl font-semibold">{overlap.uniqueAssets.length.toLocaleString()}</dd>
          </div>
          <div>
            <dt class="text-gray-500 dark:text-gray-400">Internal only</dt>
            <dd class="mt-1 text-xl font-semibold">{overlap.withinFolderOnlyAssets.length.toLocaleString()}</dd>
          </div>
        </dl>
        <p class="mt-4 text-xs/5 text-gray-500 dark:text-gray-400">
          “Only here” means no current exact or visual-duplicate lead elsewhere. It is not deletion or backup proof.
        </p>
      </div>
      <div class="border-t border-gray-100 p-5 lg:border-t-0 dark:border-immich-dark-gray">
        <div class="flex items-center gap-3">
          <span
            class="grid size-11 place-items-center rounded-2xl bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
          >
            <Icon icon={mdiImageCheckOutline} size="23" />
          </span>
          <div>
            <p class="text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
              Rest of archive
            </p>
            <p class="text-2xl font-semibold">{overlap.sharedFolders.length.toLocaleString()} shared folders</p>
          </div>
        </div>
        <dl class="mt-5 grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt class="text-gray-500 dark:text-gray-400">Counterparts</dt>
            <dd class="mt-1 text-xl font-semibold">{overlap.matchedElsewhereAssetCount.toLocaleString()}</dd>
          </div>
          <div>
            <dt class="text-gray-500 dark:text-gray-400">Exact groups</dt>
            <dd class="mt-1 text-xl font-semibold">{overlap.exactGroups.toLocaleString()}</dd>
          </div>
          <div>
            <dt class="text-gray-500 dark:text-gray-400">Possible groups</dt>
            <dd class="mt-1 text-xl font-semibold">{overlap.possibleGroups.toLocaleString()}</dd>
          </div>
        </dl>
      </div>
    </div>

    {#if overlap.sharedFolders.length > 0}
      <div
        class="overflow-hidden rounded-3xl border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
      >
        <header class="border-b border-gray-100 px-5 py-4 dark:border-immich-dark-gray">
          <h3 class="font-semibold">Where this folder is shared</h3>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Largest overlap first. Select a row to inspect those pairs.
          </p>
        </header>
        <div class="divide-y divide-gray-100 dark:divide-immich-dark-gray">
          {#each overlap.sharedFolders as shared (shared.folderPath)}
            <button
              type="button"
              class="grid w-full gap-2 px-5 py-3 text-left hover:bg-gray-50 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center dark:hover:bg-gray-900 {selectedFolder ===
              shared.folderPath
                ? 'bg-violet-50 dark:bg-violet-950/20'
                : ''}"
              onclick={() => {
                selectedFolder = shared.folderPath;
                visibleGroupCount = 16;
              }}
            >
              <span class="min-w-0">
                <span class="block truncate text-sm font-semibold" title={shared.folderPath}
                  >{folderLabel(shared.folderPath)}</span
                >
                <span class="block truncate text-xs text-gray-500 dark:text-gray-400" title={shared.folderPath}
                  >{shared.folderPath}</span
                >
              </span>
              <span class="text-sm font-semibold">{shared.sharedAssetCount.toLocaleString()} shared</span>
              <span class="text-xs text-gray-500 dark:text-gray-400"
                >{shared.exactGroups} exact · {shared.possibleGroups} possible</span
              >
            </button>
          {/each}
        </div>
      </div>
    {/if}

    {#if filteredGroups.length > 0}
      <div class="flex flex-wrap items-end justify-between gap-3 px-1 pt-1">
        <div>
          <p class="text-xs font-semibold tracking-[0.14em] text-amber-700 uppercase dark:text-amber-300">
            Side-by-side
          </p>
          <h3 class="mt-1 text-xl font-semibold">
            {selectedFolder ? `Shared with ${folderLabel(selectedFolder)}` : 'Shared photo groups'}
          </h3>
        </div>
        <p class="text-sm text-gray-500 dark:text-gray-400">{filteredGroups.length.toLocaleString()} groups</p>
      </div>
      {#each visibleGroups as group (group.duplicateId)}
        <article
          class="overflow-hidden rounded-3xl border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
        >
          <header
            class="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-3 dark:border-immich-dark-gray"
          >
            <span class="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold dark:bg-gray-800"
              >{statusLabel(group.classification)}</span
            >
            <div class="flex flex-wrap gap-1.5">
              {#each group.differences.slice(0, 5) as difference (difference)}
                <span
                  class="rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
                  >{difference}</span
                >
              {/each}
            </div>
          </header>
          <div class="grid lg:grid-cols-2">
            <div class="p-4 lg:border-r lg:border-gray-100 dark:lg:border-immich-dark-gray">
              <p class="mb-3 text-xs font-semibold tracking-wide text-violet-700 uppercase dark:text-violet-300">
                This folder
              </p>
              <div class="grid gap-3 sm:grid-cols-2">
                {#each group.here as asset (asset.id)}
                  <a
                    class="grid grid-cols-[5rem_minmax(0,1fr)] overflow-hidden rounded-2xl border border-gray-200 hover:border-violet-400 dark:border-immich-dark-gray"
                    href={Route.viewAsset({ id: asset.id })}
                  >
                    <img class="aspect-square size-20 object-cover" src={thumbnail(asset.id)} alt="" loading="lazy" />
                    <span class="min-w-0 self-center p-3 text-sm font-semibold"
                      ><span class="block truncate" title={asset.originalFileName}>{asset.originalFileName}</span></span
                    >
                  </a>
                {/each}
              </div>
            </div>
            <div class="p-4">
              <p class="mb-3 text-xs font-semibold tracking-wide text-emerald-700 uppercase dark:text-emerald-300">
                Elsewhere
              </p>
              <div class="grid gap-3 sm:grid-cols-2">
                {#each group.elsewhere.filter((asset) => !selectedFolder || getParentPath(asset.originalPath) === selectedFolder) as asset (asset.id)}
                  <a
                    class="grid grid-cols-[5rem_minmax(0,1fr)] overflow-hidden rounded-2xl border border-gray-200 hover:border-emerald-400 dark:border-immich-dark-gray"
                    href={Route.viewAsset({ id: asset.id })}
                  >
                    <img class="aspect-square size-20 object-cover" src={thumbnail(asset.id)} alt="" loading="lazy" />
                    <span class="min-w-0 self-center p-3 text-sm font-semibold">
                      <span class="block truncate" title={asset.originalFileName}>{asset.originalFileName}</span>
                      <span
                        class="mt-1 block truncate text-xs font-normal text-gray-500 dark:text-gray-400"
                        title={getParentPath(asset.originalPath)}>{folderLabel(getParentPath(asset.originalPath))}</span
                      >
                    </span>
                  </a>
                {/each}
              </div>
            </div>
          </div>
        </article>
      {/each}
      {#if visibleGroupCount < filteredGroups.length}
        <div class="flex justify-center">
          <button
            type="button"
            class="min-h-11 rounded-full border border-gray-300 px-5 text-sm font-semibold hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
            onclick={() => (visibleGroupCount += 16)}>Show 16 more groups</button
          >
        </div>
      {/if}
    {/if}

    {#if overlap.uniqueAssets.length > 0}
      <details
        class="overflow-hidden rounded-3xl border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
      >
        <summary class="cursor-pointer px-5 py-4 font-semibold"
          >Only here in current evidence ({overlap.uniqueAssets.length.toLocaleString()})</summary
        >
        <div class="grid gap-3 border-t border-gray-100 p-4 sm:grid-cols-2 lg:grid-cols-4 dark:border-immich-dark-gray">
          {#each overlap.uniqueAssets.slice(0, visibleUniqueCount) as asset (asset.id)}
            <a
              class="group overflow-hidden rounded-2xl border border-gray-200 dark:border-immich-dark-gray"
              href={Route.viewAsset({ id: asset.id })}
            >
              <img
                class="aspect-4/3 w-full object-cover transition group-hover:scale-[1.02]"
                src={thumbnail(asset.id)}
                alt=""
                loading="lazy"
              />
              <span class="flex min-h-11 items-center justify-between gap-2 px-3 text-xs font-semibold"
                ><span class="truncate">{asset.originalFileName}</span><Icon icon={mdiArrowRight} size="15" /></span
              >
            </a>
          {/each}
        </div>
        {#if visibleUniqueCount < overlap.uniqueAssets.length}
          <div class="flex justify-center border-t border-gray-100 p-4 dark:border-immich-dark-gray">
            <button
              type="button"
              class="min-h-10 rounded-full border border-gray-300 px-4 text-sm font-semibold dark:border-gray-600"
              onclick={() => (visibleUniqueCount += 24)}>Show 24 more</button
            >
          </div>
        {/if}
      </details>
    {/if}
  {/if}
</section>
