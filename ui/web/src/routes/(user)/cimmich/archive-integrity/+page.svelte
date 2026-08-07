<script lang="ts">
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import { Route } from '$lib/route';
  import {
    getCimmichExactDuplicates,
    type CimmichExactDuplicateGroup,
    type CimmichExactDuplicatePage,
  } from '$lib/services/cimmich-archive-integrity.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import {
    mdiArrowRight,
    mdiContentDuplicate,
    mdiDatabaseSearchOutline,
    mdiImageMultipleOutline,
    mdiRefresh,
    mdiShieldCheckOutline,
  } from '@mdi/js';
  import { onMount } from 'svelte';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
  let error = $state('');
  let groups = $state<CimmichExactDuplicateGroup[]>([]);
  let loaded = $state(false);
  let loading = $state(false);
  let loadingMore = $state(false);
  let nextOffset = $state<number | null>(null);
  let summary = $state<CimmichExactDuplicatePage['summary']>({
    copiesInGroups: 0,
    duplicateGroups: 0,
    reclaimableBytes: 0,
    redundantCopies: 0,
  });

  const number = new Intl.NumberFormat();
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

  const load = async ({ append = false } = {}) => {
    if (append) {
      loadingMore = true;
    } else {
      loading = true;
      error = '';
    }
    try {
      const page = await getCimmichExactDuplicates({ limit: 24, offset: append ? (nextOffset ?? 0) : 0 });
      groups = append ? [...groups, ...page.groups] : page.groups;
      summary = page.summary;
      nextOffset = page.nextOffset;
      loaded = true;
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'Cimmich could not read archive integrity.';
    } finally {
      loading = false;
      loadingMore = false;
    }
  };

  onMount(() => void load());
</script>

<UserPageLayout title={data.meta.title} scrollbar={false}>
  <div class="mx-auto w-full max-w-7xl space-y-6 px-4 pt-4 pb-16 sm:px-6 lg:px-8">
    <header class="overflow-hidden rounded-4xl bg-[#111815] px-6 py-7 text-white shadow-sm sm:px-8 sm:py-9">
      <div class="flex flex-wrap items-start justify-between gap-5">
        <div class="max-w-3xl">
          <div class="flex items-center gap-2 text-xs font-semibold tracking-[0.18em] text-emerald-300 uppercase">
            <Icon icon={mdiShieldCheckOutline} size="18" /> Archive integrity
          </div>
          <h1 class="mt-2 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Know what is genuinely duplicated</h1>
          <p class="mt-3 max-w-2xl text-sm/6 text-slate-300 sm:text-base/7">
            Review files whose complete media bytes match. This surface is discovery-only: Cimmich does not move,
            rewrite or delete anything here.
          </p>
        </div>
        <button
          type="button"
          class="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 text-sm font-semibold hover:bg-white/15 disabled:opacity-50"
          disabled={loading || loadingMore}
          onclick={() => void load()}
        >
          <Icon icon={mdiRefresh} size="18" class={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>
    </header>

    <section class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Exact duplicate summary">
      {#each [{ label: 'Exact groups', value: number.format(summary.duplicateGroups) }, { label: 'Files in groups', value: number.format(summary.copiesInGroups) }, { label: 'Redundant copies', value: number.format(summary.redundantCopies) }, { label: 'Potential space', value: formatBytes(summary.reclaimableBytes) }] as metric (metric.label)}
        <div
          class="rounded-3xl border border-gray-200 bg-white px-5 py-4 dark:border-immich-dark-gray dark:bg-immich-dark-bg"
        >
          <p class="text-xs font-semibold tracking-[0.12em] text-gray-500 uppercase dark:text-gray-400">
            {metric.label}
          </p>
          <p class="mt-2 text-2xl font-semibold tracking-tight">{metric.value}</p>
        </div>
      {/each}
    </section>

    <section
      class="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900 dark:bg-emerald-950/25"
    >
      <div class="flex items-start gap-3">
        <span
          class="grid size-10 shrink-0 place-items-center rounded-2xl bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200"
        >
          <Icon icon={mdiDatabaseSearchOutline} size="21" />
        </span>
        <div>
          <h2 class="font-semibold">Exact means byte-for-byte</h2>
          <p class="mt-1 max-w-4xl text-sm/6 text-gray-700 dark:text-gray-300">
            These groups are backed by a verified SHA-256 of the complete media file. Recompressed social-media copies
            and files changed by embedded metadata belong to the next similarity-and-metadata review layer. Sidecars are
            not compared yet.
          </p>
        </div>
      </div>
    </section>

    {#if error}
      <div
        class="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
      >
        {error}
      </div>
    {/if}

    <section class="space-y-4" aria-labelledby="exact-duplicates-title">
      <div class="flex flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <p class="text-xs font-semibold tracking-[0.14em] text-violet-700 uppercase dark:text-violet-300">
            Review queue
          </p>
          <h2 id="exact-duplicates-title" class="mt-1 text-2xl font-semibold">Exact duplicate groups</h2>
        </div>
        <p class="text-sm text-gray-500 dark:text-gray-400">Largest recoverable groups first</p>
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
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Similar or metadata-different files may still exist.
          </p>
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
          onclick={() => void load({ append: true })}
        >
          {loadingMore ? 'Loading…' : 'Load more groups'}
        </button>
      </div>
    {/if}

    <section
      class="rounded-3xl border border-gray-200 bg-white p-6 dark:border-immich-dark-gray dark:bg-immich-dark-bg"
    >
      <p class="text-xs font-semibold tracking-[0.14em] text-gray-500 uppercase dark:text-gray-400">
        Next integrity layers
      </p>
      <div class="mt-4 grid gap-3 md:grid-cols-3">
        {#each [['Metadata variants', 'Compare identical pixels whose embedded metadata or encoding differs.'], ['Backup proof', 'Verify canonical media and sidecars across independent destinations.'], ['Sidecar export', 'Merge owner-approved Cimmich truth into staged, round-trip-tested XMP.']] as item (item[0])}
          <div class="rounded-2xl bg-gray-50 p-4 dark:bg-gray-900/60">
            <h3 class="text-sm font-semibold">{item[0]}</h3>
            <p class="mt-1 text-sm/6 text-gray-600 dark:text-gray-300">{item[1]}</p>
          </div>
        {/each}
      </div>
    </section>
  </div>
</UserPageLayout>
