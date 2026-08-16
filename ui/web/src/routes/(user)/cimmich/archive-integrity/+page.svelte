<script lang="ts">
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import ArchiveBackupProof from '$lib/components/cimmich/ArchiveBackupProof.svelte';
  import {
    archiveVariantFolderContext,
    buildArchiveVariantGroups,
    type ArchiveCanonicalPlanStatus,
    type ArchiveVariantClassification,
    type ArchiveVariantGroup,
  } from '$lib/components/cimmich/archive-variant-groups';
  import { Route } from '$lib/route';
  import {
    getCimmichArchiveBackupProof,
    getCimmichArchiveSourceEvidence,
    getCimmichExactDuplicates,
    type CimmichArchiveBackupProofItem,
    type CimmichArchiveBackupProofPage,
    type CimmichExactDuplicateGroup,
    type CimmichExactDuplicatePage,
  } from '$lib/services/cimmich-archive-integrity.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize, getAssetDuplicates, type AssetResponseDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import {
    mdiArrowRight,
    mdiContentDuplicate,
    mdiDatabaseSearchOutline,
    mdiFolderOpenOutline,
    mdiImageMultipleOutline,
    mdiInformationOutline,
    mdiRefresh,
    mdiShieldCheckOutline,
    mdiTuneVariant,
  } from '@mdi/js';
  import { onMount } from 'svelte';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
  let mode = $state<'exact' | 'variants' | 'plan' | 'backup'>('exact');
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
  let variantError = $state('');
  let variantFilter = $state<'all' | ArchiveVariantClassification>('all');
  let variantGroups = $state<ArchiveVariantGroup[]>([]);
  let variantsLoaded = $state(false);
  let variantsLoading = $state(false);
  let visibleVariantCount = $state(12);
  let planFilter = $state<'all' | 'candidate' | 'held'>('all');
  let visiblePlanCount = $state(12);
  let backupError = $state('');
  let backupItems = $state(new Map<string, CimmichArchiveBackupProofItem>());
  let backupLoaded = $state(false);
  let backupLoading = $state(false);
  let backupSummary = $state<CimmichArchiveBackupProofPage['summary']>({
    byteVerifiedBytes: 0,
    byteVerifiedItems: 0,
    independentDestinationCount: 0,
    independentlyProtectedItems: 0,
    maximumSourceSystemsPerItem: 0,
    multipleSourceSystemItems: 0,
    proofState: 'storage_domain_evidence_required',
    sourceSystemCount: 0,
    unprovenItems: 0,
  });
  let filteredVariantGroups = $derived(
    variantGroups.filter((group) => variantFilter === 'all' || group.classification === variantFilter),
  );
  let visibleVariantGroups = $derived(filteredVariantGroups.slice(0, visibleVariantCount));
  let filteredPlanGroups = $derived(
    variantGroups.filter(
      (group) =>
        planFilter === 'all' ||
        (planFilter === 'candidate' && group.canonicalPlan.status === 'candidate') ||
        (planFilter === 'held' && group.canonicalPlan.status !== 'candidate'),
    ),
  );
  let visiblePlanGroups = $derived(filteredPlanGroups.slice(0, visiblePlanCount));
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
  const countLabel = (value: number, singular: string, plural = `${singular}s`) =>
    `${number.format(value)} ${value === 1 ? singular : plural}`;
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
  const assetDimensions = (asset: AssetResponseDto) =>
    asset.width && asset.height ? `${number.format(asset.width)} × ${number.format(asset.height)}` : 'Size unavailable';
  const thumbnail = (sourceAssetId: string) => getAssetMediaUrl({ id: sourceAssetId, size: AssetMediaSize.Thumbnail });
  const classificationLabel = (classification: ArchiveVariantClassification) =>
    classification === 'verified_variant'
      ? 'Verified bytes differ'
      : classification === 'verified_exact'
        ? 'Verified exact bytes'
        : 'Similarity candidate';
  const classificationClass = (classification: ArchiveVariantClassification) =>
    classification === 'verified_variant'
      ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
      : classification === 'verified_exact'
        ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
        : 'bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200';
  const planLabel = (status: ArchiveCanonicalPlanStatus) =>
    status === 'candidate'
      ? 'Preferred candidate'
      : status === 'hold_exact'
        ? 'Hold — exact bytes'
        : status === 'hold_incomplete'
          ? 'Hold — byte evidence incomplete'
          : 'Hold — owner comparison needed';
  const planClass = (status: ArchiveCanonicalPlanStatus) =>
    status === 'candidate'
      ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
      : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200';
  const names = (asset: AssetResponseDto) =>
    asset.people
      ?.map((person) => person.name.trim())
      .filter(Boolean)
      .join(', ') || 'No Immich People';
  const tags = (asset: AssetResponseDto) =>
    asset.tags
      ?.map((tag) => tag.value)
      .filter(Boolean)
      .join(', ') || 'No Immich Tags';
  let summaryMetrics = $derived.by(() => {
    if (mode === 'exact') {
      return [
        { label: 'Exact groups', value: number.format(summary.duplicateGroups) },
        { label: 'Files in groups', value: number.format(summary.copiesInGroups) },
        { label: 'Redundant copies', value: number.format(summary.redundantCopies) },
        { label: 'Potential space', value: formatBytes(summary.reclaimableBytes) },
      ];
    }
    if (mode === 'variants') {
      return [
        { label: 'Similarity groups', value: number.format(variantGroups.length) },
        {
          label: 'Files compared',
          value: number.format(variantGroups.reduce((total, group) => total + group.assets.length, 0)),
        },
        {
          label: 'Bytes differ',
          value: number.format(variantGroups.filter((group) => group.classification === 'verified_variant').length),
        },
        {
          label: 'Exact overlap',
          value: number.format(variantGroups.filter((group) => group.classification === 'verified_exact').length),
        },
      ];
    }
    if (mode === 'plan') {
      return [
        { label: 'Groups assessed', value: number.format(variantGroups.length) },
        {
          label: 'Preferred candidates',
          value: number.format(variantGroups.filter((group) => group.canonicalPlan.status === 'candidate').length),
        },
        {
          label: 'Held for review',
          value: number.format(variantGroups.filter((group) => group.canonicalPlan.status !== 'candidate').length),
        },
        {
          label: 'Exact-byte holds',
          value: number.format(variantGroups.filter((group) => group.canonicalPlan.status === 'hold_exact').length),
        },
      ];
    }
    return [
      { label: 'Byte-verified media', value: number.format(backupSummary.byteVerifiedItems) },
      { label: 'Independently protected', value: number.format(backupSummary.independentlyProtectedItems) },
      { label: 'Need destination proof', value: number.format(backupSummary.unprovenItems) },
      { label: 'Verified destinations', value: number.format(backupSummary.independentDestinationCount) },
    ];
  });

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

  const loadBackupProof = async (sourceAssetIds: string[]) => {
    backupLoading = true;
    backupError = '';
    try {
      const items: CimmichArchiveBackupProofItem[] = [];
      const firstPage = await getCimmichArchiveBackupProof(sourceAssetIds.slice(0, 80));
      items.push(...firstPage.items);
      for (let index = 80; index < sourceAssetIds.length; index += 80) {
        const page = await getCimmichArchiveBackupProof(sourceAssetIds.slice(index, index + 80));
        items.push(...page.items);
      }
      backupSummary = firstPage.summary;
      backupItems = new Map(items.map((item) => [item.sourceAssetId, item]));
      backupLoaded = true;
    } catch (error_) {
      backupError = error_ instanceof Error ? error_.message : 'Cimmich could not read independent backup evidence.';
    } finally {
      backupLoading = false;
    }
  };

  const loadVariants = async () => {
    variantsLoading = true;
    variantError = '';
    try {
      const nativeGroups = await getAssetDuplicates();
      const sourceAssetIds = [...new Set(nativeGroups.flatMap((group) => group.assets.map((asset) => asset.id)))];
      const evidence = [];
      for (let index = 0; index < sourceAssetIds.length; index += 80) {
        const page = await getCimmichArchiveSourceEvidence(sourceAssetIds.slice(index, index + 80));
        evidence.push(...page.items);
      }
      variantGroups = buildArchiveVariantGroups(nativeGroups, evidence);
      await loadBackupProof(sourceAssetIds);
      variantsLoaded = true;
      visibleVariantCount = 12;
      visiblePlanCount = 12;
    } catch (error_) {
      variantError = error_ instanceof Error ? error_.message : 'Cimmich could not read similarity candidates.';
    } finally {
      variantsLoading = false;
    }
  };

  onMount(() => {
    void load();
    void loadVariants();
  });
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
          disabled={loading || loadingMore || variantsLoading || backupLoading}
          onclick={() => void (mode === 'exact' ? load() : loadVariants())}
        >
          <Icon icon={mdiRefresh} size="18" class={loading || variantsLoading || backupLoading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>
    </header>

    <nav
      class="flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border border-gray-200 bg-white p-1 dark:border-immich-dark-gray dark:bg-immich-dark-bg"
      aria-label="Archive integrity evidence layer"
    >
      <button
        type="button"
        class="min-h-10 shrink-0 rounded-full px-4 text-sm font-semibold {mode === 'exact'
          ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-950'
          : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}"
        aria-pressed={mode === 'exact'}
        onclick={() => (mode = 'exact')}
      >
        Exact copies {loaded ? `(${number.format(summary.duplicateGroups)})` : ''}
      </button>
      <button
        type="button"
        class="min-h-10 shrink-0 rounded-full px-4 text-sm font-semibold {mode === 'variants'
          ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-950'
          : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}"
        aria-pressed={mode === 'variants'}
        onclick={() => (mode = 'variants')}
      >
        Similar variants {variantsLoaded ? `(${number.format(variantGroups.length)})` : ''}
      </button>
      <button
        type="button"
        class="min-h-10 shrink-0 rounded-full px-4 text-sm font-semibold {mode === 'plan'
          ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-950'
          : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}"
        aria-pressed={mode === 'plan'}
        onclick={() => (mode = 'plan')}
      >
        Canonical plan {variantsLoaded ? `(${number.format(variantGroups.length)})` : ''}
      </button>
      <button
        type="button"
        class="min-h-10 shrink-0 rounded-full px-4 text-sm font-semibold {mode === 'backup'
          ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-950'
          : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}"
        aria-pressed={mode === 'backup'}
        onclick={() => (mode = 'backup')}
      >
        Backup proof
      </button>
    </nav>

    <section class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Archive integrity summary">
      {#each summaryMetrics as metric (metric.label)}
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
          {#if mode === 'exact'}
            <h2 class="font-semibold">Exact means byte-for-byte</h2>
            <p class="mt-1 max-w-4xl text-sm/6 text-gray-700 dark:text-gray-300">
              These groups are backed by a verified SHA-256 of the complete media file. Recompressed social-media copies
              and files changed by embedded metadata belong to Similar variants. Sidecars are not compared yet.
            </p>
          {:else if mode === 'variants'}
            <h2 class="font-semibold">Similarity is a lead, not deletion proof</h2>
            <p class="mt-1 max-w-4xl text-sm/6 text-gray-700 dark:text-gray-300">
              Immich supplies local similarity groups; Cimmich checks each available complete-file digest and explains
              catalogue, People, Tags and Cimmich-evidence differences. Suggested keep/bin decisions are deliberately
              ignored here.
            </p>
          {:else if mode === 'plan'}
            <h2 class="font-semibold">A preservation lead, never a deletion instruction</h2>
            <p class="mt-1 max-w-4xl text-sm/6 text-gray-700 dark:text-gray-300">
              Cimmich compares original capture format, pixel dimensions, complete-file size, capture metadata and then
              organisation/identity evidence. Exact bytes, incomplete evidence and true ties are held. No recommendation
              is saved or grants authority to retire a file.
            </p>
          {:else}
            <h2 class="font-semibold">Same disk is not a backup</h2>
            <p class="mt-1 max-w-4xl text-sm/6 text-gray-700 dark:text-gray-300">
              Complete-file SHA-256 proves byte identity, but multiple paths, partitions or Immich records on one
              physical storage domain do not prove recovery. Retirement stays blocked until a separate destination
              independently verifies the media bytes and, once exported, their sidecars.
            </p>
          {/if}
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

    {#if mode === 'exact'}
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
    {:else if mode === 'variants'}
      <section class="space-y-4" aria-labelledby="variant-groups-title">
        <div class="flex flex-wrap items-end justify-between gap-4 px-1">
          <div>
            <p class="text-xs font-semibold tracking-[0.14em] text-amber-700 uppercase dark:text-amber-300">
              Explanation queue
            </p>
            <h2 id="variant-groups-title" class="mt-1 text-2xl font-semibold">Similar media, explained</h2>
          </div>
          <div class="flex flex-wrap gap-1 rounded-full bg-gray-100 p-1 dark:bg-gray-900" aria-label="Filter variants">
            {#each [['all', 'All'], ['verified_variant', 'Bytes differ'], ['verified_exact', 'Exact overlap'], ['similarity_candidate', 'Candidate only']] as option (option[0])}
              <button
                type="button"
                class="min-h-9 rounded-full px-3 text-xs font-semibold {variantFilter === option[0]
                  ? 'bg-white shadow-sm dark:bg-gray-700'
                  : 'text-gray-500 dark:text-gray-400'}"
                aria-pressed={variantFilter === option[0]}
                onclick={() => {
                  variantFilter = option[0] as typeof variantFilter;
                  visibleVariantCount = 12;
                }}>{option[1]}</button
              >
            {/each}
          </div>
        </div>

        {#if variantError}
          <div
            class="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
          >
            {variantError}
          </div>
        {/if}

        {#if variantsLoading && !variantsLoaded}
          <div
            class="grid min-h-52 place-items-center rounded-3xl border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
          >
            <div class="text-center">
              <Icon icon={mdiTuneVariant} size="34" class="mx-auto animate-pulse text-amber-500" />
              <p class="mt-3 text-sm font-semibold">Comparing similarity, byte identity and metadata…</p>
            </div>
          </div>
        {:else if variantsLoaded && filteredVariantGroups.length === 0}
          <div
            class="rounded-3xl border border-gray-200 bg-white px-6 py-12 text-center dark:border-immich-dark-gray dark:bg-immich-dark-bg"
          >
            <Icon icon={mdiShieldCheckOutline} size="38" class="mx-auto text-emerald-600" />
            <h3 class="mt-3 text-lg font-semibold">No groups match this evidence filter</h3>
          </div>
        {:else}
          {#each visibleVariantGroups as group (group.duplicateId)}
            <article
              class="overflow-hidden rounded-3xl border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
            >
              <header class="border-b border-gray-100 px-5 py-4 dark:border-immich-dark-gray">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <span
                      class="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold {classificationClass(
                        group.classification,
                      )}">{classificationLabel(group.classification)}</span
                    >
                    <h3 class="mt-2 font-semibold">{group.assets.length} locally similar files</h3>
                  </div>
                  <p class="max-w-xl text-xs/5 text-gray-500 dark:text-gray-400">
                    {group.classification === 'verified_variant'
                      ? 'Complete-file digests differ. Treat this as a transformed or visually similar candidate.'
                      : group.classification === 'verified_exact'
                        ? 'Complete-file digests match. Copy-local Immich organisation may still differ.'
                        : 'At least one file lacks Cimmich byte verification, so similarity remains the only claim.'}
                  </p>
                </div>
                <div class="mt-3 flex flex-wrap gap-1.5">
                  {#if group.differences.length === 0}
                    <span class="rounded-full bg-gray-100 px-2.5 py-1 text-xs dark:bg-gray-800">
                      No catalogued metadata difference
                    </span>
                  {:else}
                    {#each group.differences as difference (difference)}
                      <span class="rounded-full bg-gray-100 px-2.5 py-1 text-xs dark:bg-gray-800">{difference}</span>
                    {/each}
                  {/if}
                </div>
              </header>

              <div class="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
                {#each group.assets as asset, assetIndex (asset.id)}
                  {@const cimmichEvidence = group.evidence.get(asset.id)}
                  {@const folderContext = archiveVariantFolderContext(group.assets, asset)}
                  <div class="overflow-hidden rounded-2xl border border-gray-200 dark:border-immich-dark-gray">
                    <a
                      class="group relative block aspect-16/10 overflow-hidden bg-gray-100 dark:bg-gray-900"
                      href={Route.viewAsset({ id: asset.id })}
                    >
                      <img
                        class="size-full object-cover transition duration-200 group-hover:scale-[1.02]"
                        src={thumbnail(asset.id)}
                        alt=""
                        loading="lazy"
                      />
                      <span
                        class="absolute top-3 left-3 rounded-full bg-black/70 px-2.5 py-1 text-xs font-semibold text-white"
                        >Version {assetIndex + 1}</span
                      >
                    </a>
                    <div class="space-y-3 p-4">
                      <div>
                        <p class="truncate text-sm font-semibold" title={asset.originalFileName}>
                          {asset.originalFileName}
                        </p>
                        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {formatDate(asset.exifInfo?.dateTimeOriginal ?? asset.localDateTime)} ·
                          {assetDimensions(asset)} · {formatBytes(asset.exifInfo?.fileSizeInByte ?? 0)}
                        </p>
                        {#if folderContext}
                          <a
                            class="mt-2 flex min-w-0 items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                            href={Route.viewFolderAsset({ cimmich: 1, id: asset.id, path: folderContext.path })}
                            title={`Show all in ${folderContext.path}`}
                          >
                            <Icon icon={mdiFolderOpenOutline} size="16" class="shrink-0" />
                            <span class="min-w-0 truncate">{folderContext.path}</span>
                            <span class="shrink-0 whitespace-nowrap">
                              ({folderContext.moreLikelySameHere > 0 ? '+' : ''}{folderContext.moreLikelySameHere} more likely
                              same here · see all)
                            </span>
                          </a>
                        {/if}
                      </div>
                      <div class="space-y-1.5 text-xs/5 text-gray-600 dark:text-gray-300">
                        <p><strong class="text-gray-900 dark:text-white">Immich People:</strong> {names(asset)}</p>
                        <p><strong class="text-gray-900 dark:text-white">Immich Tags:</strong> {tags(asset)}</p>
                        <p>
                          <strong class="text-gray-900 dark:text-white">Cimmich evidence:</strong>
                          {cimmichEvidence
                            ? `${countLabel(cimmichEvidence.people, 'person', 'people')} · ${countLabel(cimmichEvidence.faceAssignments, 'face')} · ${countLabel(cimmichEvidence.headAssignments, 'head')} · ${countLabel(cimmichEvidence.bodyAssignments, 'body', 'bodies')} · ${countLabel(cimmichEvidence.presenceAssignments, 'presence', 'presence')}`
                            : 'Byte-linked evidence unavailable'}
                        </p>
                      </div>
                      <a
                        class="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-primary hover:underline"
                        href={Route.viewAsset({ id: asset.id })}
                      >
                        Open photo <Icon icon={mdiArrowRight} size="17" />
                      </a>
                    </div>
                  </div>
                {/each}
              </div>

              {#if group.classification === 'verified_exact'}
                <footer
                  class="flex items-start gap-2 border-t border-gray-100 bg-gray-50 px-5 py-3 text-xs/5 text-gray-600 dark:border-immich-dark-gray dark:bg-gray-900/50 dark:text-gray-300"
                >
                  <Icon icon={mdiInformationOutline} size="17" class="mt-0.5 shrink-0" />
                  Cimmich intelligence follows verified content, so its evidence is shared across exact copies. Immich People
                  and Tags remain copy-local and can still differ.
                </footer>
              {/if}
            </article>
          {/each}
        {/if}
      </section>

      {#if visibleVariantCount < filteredVariantGroups.length}
        <div class="flex justify-center">
          <button
            type="button"
            class="min-h-11 rounded-full border border-gray-300 px-5 text-sm font-semibold hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
            onclick={() => (visibleVariantCount += 12)}
          >
            Show 12 more groups
          </button>
        </div>
      {/if}
    {:else if mode === 'plan'}
      <section class="space-y-4" aria-labelledby="canonical-plan-title">
        <div class="flex flex-wrap items-end justify-between gap-4 px-1">
          <div>
            <p class="text-xs font-semibold tracking-[0.14em] text-emerald-700 uppercase dark:text-emerald-300">
              Recommendation-only plan
            </p>
            <h2 id="canonical-plan-title" class="mt-1 text-2xl font-semibold">Preferred preservation candidates</h2>
          </div>
          <div class="flex flex-wrap gap-1 rounded-full bg-gray-100 p-1 dark:bg-gray-900" aria-label="Filter plan">
            {#each [['all', 'All'], ['candidate', 'Candidates'], ['held', 'Held']] as option (option[0])}
              <button
                type="button"
                class="min-h-9 rounded-full px-3 text-xs font-semibold {planFilter === option[0]
                  ? 'bg-white shadow-sm dark:bg-gray-700'
                  : 'text-gray-500 dark:text-gray-400'}"
                aria-pressed={planFilter === option[0]}
                onclick={() => {
                  planFilter = option[0] as typeof planFilter;
                  visiblePlanCount = 12;
                }}>{option[1]}</button
              >
            {/each}
          </div>
        </div>

        <div
          class="rounded-2xl border border-gray-200 bg-white px-5 py-4 text-sm/6 text-gray-600 dark:border-immich-dark-gray dark:bg-immich-dark-bg dark:text-gray-300"
        >
          This plan covers Immich's local similarity groups. Other byte-exact groups do not need a media-quality winner;
          review their copy retention in Exact copies only after independent backup proof.
        </div>

        {#if variantError}
          <div
            class="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
          >
            {variantError}
          </div>
        {/if}

        {#if variantsLoading && !variantsLoaded}
          <div
            class="grid min-h-52 place-items-center rounded-3xl border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
          >
            <div class="text-center">
              <Icon icon={mdiTuneVariant} size="34" class="mx-auto animate-pulse text-emerald-500" />
              <p class="mt-3 text-sm font-semibold">Building transparent preservation comparisons…</p>
            </div>
          </div>
        {:else if variantsLoaded && filteredPlanGroups.length === 0}
          <div
            class="rounded-3xl border border-gray-200 bg-white px-6 py-12 text-center dark:border-immich-dark-gray dark:bg-immich-dark-bg"
          >
            <Icon icon={mdiShieldCheckOutline} size="38" class="mx-auto text-emerald-600" />
            <h3 class="mt-3 text-lg font-semibold">No groups match this plan filter</h3>
          </div>
        {:else}
          {#each visiblePlanGroups as group (group.duplicateId)}
            {@const plan = group.canonicalPlan}
            {@const preferred = group.assets.find((asset) => asset.id === plan.preferredAssetId)}
            <article
              class="overflow-hidden rounded-3xl border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
            >
              <header class="border-b border-gray-100 p-5 dark:border-immich-dark-gray">
                <div class="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <span class="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold {planClass(plan.status)}">
                      {planLabel(plan.status)}
                    </span>
                    <h3 class="mt-2 text-lg font-semibold">
                      {preferred ? preferred.originalFileName : `${group.assets.length} versions held`}
                    </h3>
                    <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {group.assets.length} locally similar files · {classificationLabel(group.classification)}
                    </p>
                  </div>
                  <p class="max-w-md text-xs/5 text-gray-500 dark:text-gray-400">
                    {plan.status === 'candidate'
                      ? 'First by the disclosed preservation order. Owner review is still required.'
                      : 'Cimmich refused to manufacture a preferred version from insufficient or equivalent evidence.'}
                  </p>
                </div>

                <div class="mt-4 grid gap-3 lg:grid-cols-2">
                  <div class="rounded-2xl bg-emerald-50 px-4 py-3 dark:bg-emerald-950/25">
                    <p class="text-xs font-semibold tracking-widest text-emerald-800 uppercase dark:text-emerald-200">
                      Basis
                    </p>
                    <ul class="mt-2 space-y-1 text-sm/5 text-gray-700 dark:text-gray-300">
                      {#each plan.reasons as reason (reason)}
                        <li>• {reason}</li>
                      {/each}
                    </ul>
                  </div>
                  <div class="rounded-2xl bg-amber-50 px-4 py-3 dark:bg-amber-950/25">
                    <p class="text-xs font-semibold tracking-widest text-amber-800 uppercase dark:text-amber-200">
                      Before any retirement
                    </p>
                    <ul class="mt-2 space-y-1 text-sm/5 text-gray-700 dark:text-gray-300">
                      {#each plan.cautions as caution (caution)}
                        <li>• {caution}</li>
                      {/each}
                    </ul>
                  </div>
                </div>
              </header>

              <div class="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
                {#each group.assets as asset (asset.id)}
                  {@const signal = plan.rankings.get(asset.id)}
                  {@const isPreferred = plan.preferredAssetId === asset.id}
                  <div
                    class="overflow-hidden rounded-2xl border {isPreferred
                      ? 'border-emerald-500 ring-2 ring-emerald-500/20'
                      : 'border-gray-200 dark:border-immich-dark-gray'}"
                  >
                    <a
                      class="group relative block aspect-16/10 overflow-hidden bg-gray-100 dark:bg-gray-900"
                      href={Route.viewAsset({ id: asset.id })}
                    >
                      <img
                        class="size-full object-cover transition duration-200 group-hover:scale-[1.02]"
                        src={thumbnail(asset.id)}
                        alt=""
                        loading="lazy"
                      />
                      <span
                        class="absolute top-3 left-3 rounded-full {isPreferred
                          ? 'bg-emerald-700'
                          : 'bg-black/70'} px-2.5 py-1 text-xs font-semibold text-white"
                        >{isPreferred ? 'Preferred candidate' : 'Alternative'}</span
                      >
                    </a>
                    <div class="space-y-3 p-4">
                      <div>
                        <p class="truncate text-sm font-semibold" title={asset.originalFileName}>
                          {asset.originalFileName}
                        </p>
                        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {assetDimensions(asset)} · {formatBytes(asset.exifInfo?.fileSizeInByte ?? 0)}
                        </p>
                      </div>
                      {#if signal}
                        <div class="flex flex-wrap gap-1.5 text-[0.7rem] font-semibold">
                          {#if signal.originalCapture === 1}
                            <span
                              class="rounded-full bg-violet-100 px-2 py-1 text-violet-900 dark:bg-violet-950 dark:text-violet-200"
                              >Original capture</span
                            >
                          {/if}
                          <span class="rounded-full bg-gray-100 px-2 py-1 dark:bg-gray-800">
                            {signal.metadataFields} metadata fields
                          </span>
                          <span class="rounded-full bg-gray-100 px-2 py-1 dark:bg-gray-800">
                            {signal.evidenceLinks} evidence links
                          </span>
                        </div>
                      {/if}
                      <a
                        class="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-primary hover:underline"
                        href={Route.viewAsset({ id: asset.id })}
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

      {#if visiblePlanCount < filteredPlanGroups.length}
        <div class="flex justify-center">
          <button
            type="button"
            class="min-h-11 rounded-full border border-gray-300 px-5 text-sm font-semibold hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
            onclick={() => (visiblePlanCount += 12)}
          >
            Show 12 more plans
          </button>
        </div>
      {/if}
    {:else}
      <ArchiveBackupProof
        error={backupError}
        exactGroupCount={summary.duplicateGroups}
        groups={variantGroups}
        items={backupItems}
        loaded={backupLoaded}
        loading={backupLoading}
        summary={backupSummary}
      />
    {/if}

    <section
      class="rounded-3xl border border-gray-200 bg-white p-6 dark:border-immich-dark-gray dark:bg-immich-dark-bg"
    >
      <p class="text-xs font-semibold tracking-[0.14em] text-gray-500 uppercase dark:text-gray-400">
        Next integrity layers
      </p>
      <div class="mt-4 grid gap-3 md:grid-cols-3">
        {#each [['Canonical planning', 'Live recommendation-only preservation leads; no choice or file change is saved.'], ['Backup proof', 'Live readiness gate; the current archive has no independent destination proof.'], ['Sidecar export', 'Merge owner-approved Cimmich truth into staged, round-trip-tested XMP.']] as item (item[0])}
          <div class="rounded-2xl bg-gray-50 p-4 dark:bg-gray-900/60">
            <h3 class="text-sm font-semibold">{item[0]}</h3>
            <p class="mt-1 text-sm/6 text-gray-600 dark:text-gray-300">{item[1]}</p>
          </div>
        {/each}
      </div>
    </section>
  </div>
</UserPageLayout>
