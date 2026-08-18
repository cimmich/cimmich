<script lang="ts">
  import { Route } from '$lib/route';
  import type {
    CimmichExactDuplicateGroup,
    CimmichExactDuplicatePage,
  } from '$lib/services/cimmich-archive-integrity.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { getParentPath } from '$lib/utils/tree-utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import {
    mdiArrowRight,
    mdiContentDuplicate,
    mdiDatabaseSearchOutline,
    mdiImageMultipleOutline,
    mdiShieldCheckOutline,
  } from '@mdi/js';

  interface Props {
    assetPaths: Map<string, string | null>;
    groups: CimmichExactDuplicateGroup[];
    loaded: boolean;
    loading: boolean;
    loadingMore: boolean;
    nextOffset: number | null;
    onLoadMore: () => void;
    summary: CimmichExactDuplicatePage['summary'];
  }

  let { assetPaths, groups, loaded, loading, loadingMore, nextOffset, onLoadMore, summary }: Props = $props();

  const number = new Intl.NumberFormat();
  const countLabel = (value: number, singular: string, plural = `${singular}s`) =>
    `${number.format(value)} ${value === 1 ? singular : plural}`;
  const formatBytes = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) {
      return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const power = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    const amount = value / 1024 ** power;
    return `${amount >= 10 || power === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[power]}`;
  };
  const formatDate = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
      : 'Date unavailable';
  const dimensions = (group: CimmichExactDuplicateGroup, index: number) => {
    const copy = group.copies[index];
    return copy?.width && copy?.height
      ? `${number.format(copy.width)} × ${number.format(copy.height)}`
      : 'Size unavailable';
  };
  const thumbnail = (sourceAssetId: string) => getAssetMediaUrl({ id: sourceAssetId, size: AssetMediaSize.Thumbnail });
</script>

<section class="space-y-4" aria-labelledby="exact-duplicates-title">
  <div class="flex flex-wrap items-center justify-between gap-3 px-1">
    <div>
      <h2 id="exact-duplicates-title" class="text-xl font-semibold">Exact duplicate groups</h2>
      <p class="mt-0.5 text-sm text-gray-600 dark:text-gray-300">
        <strong>{countLabel(summary.duplicateGroups, 'group')}</strong> · {countLabel(summary.copiesInGroups, 'file')} · {formatBytes(
          summary.reclaimableBytes,
        )} possible space. Exact means byte-for-byte.
      </p>
    </div>
    <p
      class="text-xs text-gray-500 dark:text-gray-400"
      title="Groups with the most possible recoverable space appear first"
    >
      Largest recoverable groups first
    </p>
  </div>

  {#if loading && !loaded}
    <div
      class="grid min-h-52 place-items-center rounded-3xl border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
    >
      <div class="text-center">
        <Icon icon={mdiDatabaseSearchOutline} size="34" class="mx-auto animate-pulse text-violet-500" />
        <p class="mt-3 text-sm font-semibold">Checking verified content identity…</p>
      </div>
    </div>
  {:else if loaded && groups.length === 0}
    <div
      class="rounded-3xl border border-gray-200 bg-white px-6 py-12 text-center dark:border-immich-dark-gray dark:bg-immich-dark-bg"
    >
      <Icon icon={mdiShieldCheckOutline} size="38" class="mx-auto text-emerald-600" />
      <h3 class="mt-3 text-lg font-semibold">No exact duplicates in this viewing mode</h3>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Similar or metadata-different files may still exist.</p>
    </div>
  {:else}
    {#each groups as group, groupIndex (`${group.contentId}:${groupIndex}`)}
      <article
        class="overflow-hidden rounded-3xl border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
      >
        <header
          class="flex flex-wrap items-start justify-between gap-4 border-b border-gray-100 px-5 py-4 dark:border-immich-dark-gray"
        >
          <div class="flex items-start gap-3">
            <span
              class="grid size-10 shrink-0 place-items-center rounded-2xl bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200"
            >
              <Icon icon={mdiContentDuplicate} size="21" />
            </span>
            <div>
              <h3 class="font-semibold">{group.copyCount} byte-for-byte copies</h3>
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {group.assetType} · {formatBytes(group.byteLength)} · SHA-256 {group.contentDigest.slice(0, 12)}…
              </p>
            </div>
          </div>
          <div class="text-left sm:text-right">
            <p class="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
              {formatBytes(group.reclaimableBytes)} potential
            </p>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              if {group.redundantCopies}
              {group.redundantCopies === 1 ? 'copy is' : 'copies are'} later retired
            </p>
          </div>
        </header>

        <div class="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
          {#each group.copies as copy, copyIndex (copy.sourceAssetId)}
            {@const originalPath = assetPaths.get(copy.sourceAssetId)}
            {@const folderPath = originalPath ? getParentPath(originalPath) : ''}
            <div class="overflow-hidden rounded-2xl border border-gray-200 dark:border-immich-dark-gray">
              <a
                class="group relative block aspect-16/10 overflow-hidden bg-gray-100 dark:bg-gray-900"
                href={Route.viewAsset({ id: copy.sourceAssetId })}
              >
                {#if group.assetType === 'image' || group.assetType === 'video'}
                  <img
                    class="size-full object-cover transition duration-200 group-hover:scale-[1.02]"
                    src={thumbnail(copy.sourceAssetId)}
                    alt=""
                    loading="lazy"
                  />
                {:else}
                  <span class="grid size-full place-items-center text-gray-400"
                    ><Icon icon={mdiImageMultipleOutline} size="34" /></span
                  >
                {/if}
                <span
                  class="absolute top-3 left-3 rounded-full bg-black/70 px-2.5 py-1 text-xs font-semibold text-white"
                  >Copy {copyIndex + 1}</span
                >
              </a>
              <div class="space-y-3 p-4">
                <div>
                  <p class="truncate text-sm font-semibold" title={copy.filename}>{copy.filename}</p>
                  <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {formatDate(copy.captureTime)} · {dimensions(group, copyIndex)}
                  </p>
                </div>
                <div class="rounded-xl bg-gray-50 px-3 py-2.5 text-xs dark:bg-gray-900/70">
                  <p class="font-semibold text-gray-950 dark:text-white">Source folder</p>
                  {#if folderPath}
                    <a
                      class="mt-1 block font-semibold break-all text-primary hover:underline"
                      href={Route.viewFolderAsset({ cimmich: 1, id: copy.sourceAssetId, path: folderPath })}
                      title={`Open ${folderPath} in Library`}
                    >
                      {folderPath}
                    </a>
                    <p class="mt-1 break-all text-gray-500 dark:text-gray-400" title={originalPath}>
                      {originalPath}
                    </p>
                    <a
                      class="mt-2 inline-flex items-center gap-1 font-semibold text-violet-700 hover:underline dark:text-violet-300"
                      href={Route.cimmichArchiveIntegrity({ folder: folderPath, mode: 'folder' })}
                      title={`Compare ${folderPath} with the rest of the archive`}
                    >
                      Check this folder <Icon icon={mdiArrowRight} size="15" />
                    </a>
                  {:else if originalPath === null}
                    <p class="mt-1 text-gray-500 dark:text-gray-400">Folder unavailable</p>
                  {:else}
                    <p class="mt-1 text-gray-500 dark:text-gray-400">Reading folder…</p>
                  {/if}
                </div>
                <div class="flex flex-wrap gap-1.5 text-[0.7rem] font-semibold">
                  <span class="rounded-full bg-gray-100 px-2 py-1 dark:bg-gray-800">{copy.visibility}</span>
                  {#if copy.archived}<span
                      class="rounded-full bg-amber-100 px-2 py-1 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                      >Archived</span
                    >{/if}
                  {#if copy.favorite}<span
                      class="rounded-full bg-rose-100 px-2 py-1 text-rose-900 dark:bg-rose-950 dark:text-rose-200"
                      >Favourite</span
                    >{/if}
                </div>
                <a
                  class="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-primary hover:underline"
                  href={Route.viewAsset({ id: copy.sourceAssetId })}
                >
                  Open photo <Icon icon={mdiArrowRight} size="17" />
                </a>
              </div>
            </div>
          {/each}
        </div>
      </article>
    {/each}
  {/if}
</section>

{#if nextOffset !== null}
  <div class="flex justify-center">
    <button
      type="button"
      class="min-h-11 rounded-full border border-gray-300 px-5 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-800"
      disabled={loadingMore}
      onclick={onLoadMore}
    >
      {loadingMore ? 'Loading…' : 'Load more groups'}
    </button>
  </div>
{/if}
