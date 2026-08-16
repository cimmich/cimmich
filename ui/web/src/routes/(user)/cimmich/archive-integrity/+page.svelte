<script lang="ts">
  import { page } from '$app/state';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import ArchiveBackupProof from '$lib/components/cimmich/ArchiveBackupProof.svelte';
  import {
    archiveVariantFolderContext,
    archiveVariantGroupsInFolder,
    buildArchiveVariantGroups,
    createArchiveVisualDuplicateGroup,
    type ArchiveVariantClassification,
    type ArchiveVariantGroup,
  } from '$lib/components/cimmich/archive-variant-groups';
  import { Route } from '$lib/route';
  import {
    getCimmichArchiveBackupProof,
    getCimmichArchiveSourceEvidence,
    getCimmichDuplicateStatus,
    getCimmichExactDuplicates,
    type CimmichArchiveBackupProofItem,
    type CimmichArchiveBackupProofPage,
    type CimmichExactDuplicateGroup,
    type CimmichExactDuplicatePage,
  } from '$lib/services/cimmich-archive-integrity.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize, getAssetDuplicates, getAssetInfo, type AssetResponseDto } from '@immich/sdk';
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
  const focusedAssetId = page.url.searchParams.get('assetId')?.trim() ?? '';
  const focusedFolder = page.url.searchParams.get('folder')?.trim() ?? '';
  const requestedMode = page.url.searchParams.get('mode');
  let mode = $state<'exact' | 'variants' | 'backup'>(
    requestedMode === 'variants' || requestedMode === 'plan'
      ? 'variants'
      : requestedMode === 'backup'
        ? 'backup'
        : 'exact',
  );
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
  let scopedVariantGroups = $derived(
    archiveVariantGroupsInFolder(
      variantGroups.filter((group) => !focusedAssetId || group.assets.some((asset) => asset.id === focusedAssetId)),
      focusedFolder,
    ),
  );
  let filteredVariantGroups = $derived(
    scopedVariantGroups.filter((group) => variantFilter === 'all' || group.classification === variantFilter),
  );
  let visibleVariantGroups = $derived(filteredVariantGroups.slice(0, visibleVariantCount));
  let libraryVariantGroupCount = $derived(
    variantGroups.filter((group) => !group.duplicateId.startsWith('cimmich-visual-')).length,
  );
  let scopedVariantAssets = $derived(
    new Set(scopedVariantGroups.flatMap((group) => group.assets.map((asset) => asset.id))).size,
  );
  let scopedVariantFolders = $derived(
    new Set(
      scopedVariantGroups.flatMap((group) =>
        group.assets.map((asset) => asset.originalPath?.slice(0, asset.originalPath.lastIndexOf('/'))).filter(Boolean),
      ),
    ).size,
  );
  let focusedFolderAsset = $derived(
    scopedVariantGroups
      .flatMap((group) => group.assets)
      .find(
        (asset) =>
          Boolean(asset.originalPath) &&
          asset.originalPath.slice(0, asset.originalPath.lastIndexOf('/')) === focusedFolder,
      ),
  );
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
      ? 'Different files'
      : classification === 'verified_exact'
        ? 'Exact copies'
        : 'Needs verification';
  const classificationClass = (classification: ArchiveVariantClassification) =>
    classification === 'verified_variant'
      ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
      : classification === 'verified_exact'
        ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
        : 'bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200';
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
  const load = async ({ append = false } = {}) => {
    if (append) {
      loadingMore = true;
    } else {
      loading = true;
      error = '';
    }
    try {
      const page = await getCimmichExactDuplicates({
        limit: 24,
        offset: append ? (nextOffset ?? 0) : 0,
        sourceAssetId: focusedAssetId,
      });
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
      if (focusedAssetId && !nativeGroups.some((group) => group.assets.some((asset) => asset.id === focusedAssetId))) {
        const statusPage = await getCimmichDuplicateStatus([focusedAssetId]);
        const status = statusPage.items.find(
          (item) => item.sourceAssetId === focusedAssetId && item.kind === 'possible_version',
        );
        if (status) {
          const relatedAssets = await Promise.all(
            status.relatedSourceAssetIds.map((id) => getAssetInfo({ id }).catch(() => null)),
          );
          const assets = relatedAssets.filter((asset): asset is AssetResponseDto => asset !== null);
          if (assets.length > 1) {
            nativeGroups.push(createArchiveVisualDuplicateGroup(`cimmich-visual-${status.contentId}`, assets));
          }
        }
      }
      const sourceAssetIds = [...new Set(nativeGroups.flatMap((group) => group.assets.map((asset) => asset.id)))];
      const evidence = [];
      for (let index = 0; index < sourceAssetIds.length; index += 80) {
        const page = await getCimmichArchiveSourceEvidence(sourceAssetIds.slice(index, index + 80));
        evidence.push(...page.items);
      }
      variantGroups = buildArchiveVariantGroups(nativeGroups, evidence);
      variantsLoaded = true;
      visibleVariantCount = 12;
      void loadBackupProof(sourceAssetIds);
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
  <div class="mx-auto w-full max-w-7xl space-y-4 px-4 pt-4 pb-16 sm:px-6 lg:px-8">
    <header class="rounded-3xl bg-[#111815] p-5 text-white shadow-sm sm:px-6">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div class="max-w-3xl">
          <h1 class="text-2xl font-semibold tracking-tight">Duplicate review</h1>
          <p class="mt-1 text-sm text-slate-300">Compare possible copies and versions. Nothing is changed here.</p>
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
        Possible duplicates {variantsLoaded ? `(${number.format(scopedVariantGroups.length)})` : ''}
      </button>
      <button
        type="button"
        class="min-h-10 shrink-0 rounded-full px-4 text-sm font-semibold {mode === 'backup'
          ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-950'
          : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}"
        aria-pressed={mode === 'backup'}
        onclick={() => (mode = 'backup')}
      >
        Backup status
      </button>
    </nav>

    {#if (mode === 'variants' && (focusedAssetId || focusedFolder)) || (mode === 'exact' && focusedAssetId)}
      <div
        class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm dark:border-violet-900 dark:bg-violet-950/25"
      >
        <span class="min-w-0 truncate">
          {focusedFolder
            ? `Flagged photos in ${focusedFolder}`
            : mode === 'exact'
              ? 'Exact copies for the photo you opened'
              : 'Possible duplicates for the photo you opened'}
        </span>
        <div class="flex flex-wrap items-center gap-4">
          {#if focusedFolder && focusedFolderAsset}
            <a
              class="font-semibold text-primary hover:underline"
              href={Route.viewFolderAsset({ cimmich: 1, id: focusedFolderAsset.id, path: focusedFolder })}
              >Open folder</a
            >
          {/if}
          <a
            class="rounded-full bg-violet-700 px-3 py-2 font-semibold text-white hover:bg-violet-800"
            data-sveltekit-reload
            href={Route.cimmichArchiveIntegrity({ mode })}
            >{mode === 'variants'
              ? `View all ${number.format(libraryVariantGroupCount)} groups`
              : 'View all exact copies'}</a
          >
        </div>
      </div>
    {/if}

    {#if mode === 'exact'}
      <p class="px-1 text-sm text-gray-600 dark:text-gray-300">
        <strong>{countLabel(summary.duplicateGroups, 'group')}</strong> · {countLabel(summary.copiesInGroups, 'file')} ·
        {formatBytes(summary.reclaimableBytes)} possible space. Exact means byte-for-byte.
      </p>
    {:else if mode === 'variants'}
      <p class="px-1 text-sm text-gray-600 dark:text-gray-300">
        <strong>{countLabel(scopedVariantGroups.length, 'group')}</strong> · {countLabel(scopedVariantAssets, 'file')} ·
        {countLabel(scopedVariantFolders, 'folder')}. A visual match is a review lead, not deletion proof.
      </p>
    {/if}

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
            <h2 id="variant-groups-title" class="text-xl font-semibold">Possible duplicate groups</h2>
          </div>
          <div class="flex flex-wrap gap-1 rounded-full bg-gray-100 p-1 dark:bg-gray-900" aria-label="Filter variants">
            {#each [['all', 'All'], ['verified_variant', 'Different files'], ['verified_exact', 'Exact copies'], ['similarity_candidate', 'Unverified']] as option (option[0])}
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
              <p class="mt-3 text-sm font-semibold">Loading comparisons…</p>
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
            {@const plan = group.canonicalPlan}
            {@const preferred = group.assets.find((asset) => asset.id === plan.preferredAssetId)}
            <article
              class="overflow-hidden rounded-3xl border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
            >
              <header class="border-b border-gray-100 px-5 py-4 dark:border-immich-dark-gray">
                <div class="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <span
                      class="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold {classificationClass(
                        group.classification,
                      )}">{classificationLabel(group.classification)}</span
                    >
                    <h3 class="mt-2 text-lg font-semibold">{countLabel(group.assets.length, 'file')} to compare</h3>
                    <p class="mt-1 text-sm text-gray-600 dark:text-gray-300">
                      {group.classification === 'verified_variant'
                        ? 'They look alike, but the file bytes differ.'
                        : group.classification === 'verified_exact'
                          ? 'The complete file bytes match.'
                          : 'They look alike, but byte verification is incomplete.'}
                    </p>
                  </div>
                  <div
                    class="max-w-md rounded-2xl {preferred
                      ? 'bg-emerald-50 dark:bg-emerald-950/25'
                      : 'bg-gray-100 dark:bg-gray-900'} px-4 py-3"
                  >
                    <p
                      class="text-xs font-semibold tracking-wide uppercase {preferred
                        ? 'text-emerald-800 dark:text-emerald-200'
                        : 'text-gray-600 dark:text-gray-300'}"
                    >
                      {preferred ? 'Recommended to keep' : 'No safe recommendation'}
                    </p>
                    <p class="mt-1 text-sm font-semibold">{preferred?.originalFileName ?? 'Compare these yourself'}</p>
                    {#if plan.reasons[0]}
                      <p class="mt-1 text-xs/5 text-gray-600 dark:text-gray-300">{plan.reasons[0]}</p>
                    {/if}
                  </div>
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
                {#if plan.reasons.length > 1 || plan.cautions.length > 0}
                  <details class="mt-3 text-xs/5 text-gray-600 dark:text-gray-300">
                    <summary class="cursor-pointer font-semibold">Why this recommendation</summary>
                    <div class="mt-2 grid gap-2 sm:grid-cols-2">
                      <ul>
                        {#each plan.reasons as reason (reason)}<li>• {reason}</li>{/each}
                      </ul>
                      <ul>
                        {#each plan.cautions as caution (caution)}<li>• {caution}</li>{/each}
                      </ul>
                    </div>
                  </details>
                {/if}
              </header>

              <div class="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
                {#each group.assets as asset, assetIndex (asset.id)}
                  {@const cimmichEvidence = group.evidence.get(asset.id)}
                  {@const folderContext = archiveVariantFolderContext(variantGroups, asset)}
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
                        >{isPreferred ? 'Recommended keep' : `Version ${assetIndex + 1}`}</span
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
                          <div class="mt-2 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs font-medium">
                            <Icon icon={mdiFolderOpenOutline} size="16" class="shrink-0 text-primary" />
                            <a
                              class="max-w-full min-w-0 truncate text-primary hover:underline"
                              href={Route.viewFolderAsset({ cimmich: 1, id: asset.id, path: folderContext.path })}
                              title={`Open ${folderContext.path}`}>{folderContext.path}</a
                            >
                            <a
                              class="shrink-0 whitespace-nowrap text-primary hover:underline"
                              data-sveltekit-reload
                              href={Route.cimmichArchiveIntegrity({ folder: folderContext.path, mode: 'variants' })}
                              >({countLabel(folderContext.otherFlaggedHere, 'other flagged photo')} here)</a
                            >
                          </div>
                        {/if}
                      </div>
                      <details class="text-xs/5 text-gray-600 dark:text-gray-300">
                        <summary class="cursor-pointer font-semibold text-gray-700 dark:text-gray-200"
                          >Technical details</summary
                        >
                        <div class="mt-2 space-y-1.5">
                          <p><strong class="text-gray-900 dark:text-white">Immich People:</strong> {names(asset)}</p>
                          <p><strong class="text-gray-900 dark:text-white">Immich Tags:</strong> {tags(asset)}</p>
                          <p>
                            <strong class="text-gray-900 dark:text-white">Cimmich evidence:</strong>
                            {cimmichEvidence
                              ? `${countLabel(cimmichEvidence.people, 'person', 'people')} · ${countLabel(cimmichEvidence.faceAssignments, 'face')} · ${countLabel(cimmichEvidence.headAssignments, 'head')} · ${countLabel(cimmichEvidence.bodyAssignments, 'body', 'bodies')} · ${countLabel(cimmichEvidence.presenceAssignments, 'presence', 'presence')}`
                              : 'Byte-linked evidence unavailable'}
                          </p>
                        </div>
                      </details>
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
  </div>
</UserPageLayout>
