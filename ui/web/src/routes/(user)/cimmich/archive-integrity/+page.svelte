<script lang="ts">
  import { replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import ArchiveBackupProof from '$lib/components/cimmich/ArchiveBackupProof.svelte';
  import ArchiveFolderComparison from '$lib/components/cimmich/ArchiveFolderComparison.svelte';
  import ArchiveVariantComparison from '$lib/components/cimmich/ArchiveVariantComparison.svelte';
  import {
    buildArchiveFolderOverlap,
    rankArchiveFoldersByImpact,
    type ArchiveFolderImpact,
  } from '$lib/components/cimmich/archive-folder-comparison';
  import {
    archiveVariantGroupsInFolder,
    buildArchiveVariantGroups,
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
  import { getParentPath } from '$lib/utils/tree-utils';
  import {
    AssetMediaSize,
    getAssetDuplicates,
    searchAssets,
    type AssetResponseDto,
    type DuplicateResponseDto,
  } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import {
    mdiArrowRight,
    mdiContentDuplicate,
    mdiDatabaseSearchOutline,
    mdiFolderOpenOutline,
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
  const focusedAssetId = page.url.searchParams.get('assetId')?.trim() ?? '';
  const initialFocusedFolder = page.url.searchParams.get('folder')?.trim() ?? '';
  const requestedMode = page.url.searchParams.get('mode');
  let mode = $state<'exact' | 'variants' | 'folder' | 'backup'>(
    requestedMode === 'folder' || (requestedMode === 'variants' && initialFocusedFolder)
      ? 'folder'
      : requestedMode === 'variants' || requestedMode === 'plan'
        ? 'variants'
        : requestedMode === 'backup'
          ? 'backup'
          : 'exact',
  );
  let routeReady = $state(false);
  let routeSignature = $state(`${mode}:${initialFocusedFolder}`);
  let activeFolder = $state(initialFocusedFolder);
  let folderPathInput = $state(initialFocusedFolder);
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
  let allVariantNativeGroups = $state<DuplicateResponseDto[]>([]);
  let folderAssets = $state<AssetResponseDto[]>([]);
  let folderImpacts = $state<ArchiveFolderImpact[]>([]);
  let folderNativeGroups = $state<DuplicateResponseDto[]>([]);
  let folderError = $state('');
  let folderLoaded = $state(false);
  let folderLoading = $state(false);
  let folderRankingLoading = $state(false);
  let folderVerifiedPaths = $state<string[]>([]);
  let verifyingFolder = $state('');
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
  let nativeVariantGroups = $state<DuplicateResponseDto[] | null>(null);
  let nativeVariantGroupsRequest: Promise<DuplicateResponseDto[]> | null = null;
  let folderRequestGeneration = 0;
  let scopedVariantGroups = $derived(
    archiveVariantGroupsInFolder(
      variantGroups.filter((group) => !focusedAssetId || group.assets.some((asset) => asset.id === focusedAssetId)),
      mode === 'folder' ? activeFolder : '',
    ),
  );
  let filteredVariantGroups = $derived(
    scopedVariantGroups.filter((group) => variantFilter === 'all' || group.classification === variantFilter),
  );
  let visibleVariantGroups = $derived(filteredVariantGroups);
  let libraryVariantGroupCount = $derived(
    allVariantNativeGroups.filter((group) => !group.duplicateId.startsWith('cimmich-visual-')).length,
  );
  let focusedFolderAsset = $derived(
    folderAssets[0] ??
      scopedVariantGroups
        .flatMap((group) => group.assets)
        .find(
          (asset) =>
            Boolean(asset.originalPath) &&
            asset.originalPath.slice(0, asset.originalPath.lastIndexOf('/')) === activeFolder,
        ),
  );
  let folderOverlap = $derived(buildArchiveFolderOverlap(activeFolder, folderAssets, variantGroups));
  let activeFolderName = $derived(activeFolder.split('/').findLast(Boolean) || activeFolder);
  let visibleFolderImpacts = $derived(folderImpacts.slice(0, 50));
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
  const friendlyError = (error_: unknown, fallback: string) => {
    const message = error_ instanceof Error ? error_.message : '';
    if (message.includes('did not respond in time')) {
      return 'This comparison took too long. Try again, or use Folder Check for a smaller comparison.';
    }
    return message.replace(/\s*\((GET|POST|PUT|PATCH|DELETE)\s+\/[^)]*\)\s*$/i, '').trim() || fallback;
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
      error = friendlyError(error_, 'Cimmich could not read archive integrity.');
    } finally {
      loading = false;
      loadingMore = false;
    }
  };

  const loadBackupProof = async (sourceAssetIds: string[]) => {
    backupLoading = true;
    backupError = '';
    try {
      const batches = Array.from({ length: Math.ceil(sourceAssetIds.length / 80) }, (_, index) =>
        sourceAssetIds.slice(index * 80, index * 80 + 80),
      );
      const pages = await Promise.all(batches.map((batch) => getCimmichArchiveBackupProof(batch)));
      const firstPage = pages[0];
      const items = pages.flatMap((page) => page.items);
      if (!firstPage) {
        return;
      }
      backupSummary = firstPage.summary;
      backupItems = new Map(items.map((item) => [item.sourceAssetId, item]));
      backupLoaded = true;
    } catch (error_) {
      backupError = friendlyError(error_, 'Cimmich could not read independent backup evidence.');
    } finally {
      backupLoading = false;
    }
  };

  const ensureNativeVariantGroups = async ({ refresh = false } = {}) => {
    if (refresh) {
      nativeVariantGroups = null;
      nativeVariantGroupsRequest = null;
      folderImpacts = [];
    }
    if (nativeVariantGroups) {
      return nativeVariantGroups;
    }
    nativeVariantGroupsRequest ??= getAssetDuplicates();
    try {
      nativeVariantGroups = [...(await nativeVariantGroupsRequest)];
      folderImpacts = rankArchiveFoldersByImpact(nativeVariantGroups);
      return nativeVariantGroups;
    } finally {
      nativeVariantGroupsRequest = null;
    }
  };

  const readArchiveEvidence = async (sourceAssetIds: string[]) => {
    const uniqueSourceAssetIds = [...new Set(sourceAssetIds)];
    const batches = Array.from({ length: Math.ceil(uniqueSourceAssetIds.length / 20) }, (_, index) =>
      uniqueSourceAssetIds.slice(index * 20, index * 20 + 20),
    );
    const pages: Awaited<ReturnType<typeof getCimmichArchiveSourceEvidence>>[] = [];
    for (let index = 0; index < batches.length; index += 3) {
      pages.push(
        ...(await Promise.all(batches.slice(index, index + 3).map((batch) => getCimmichArchiveSourceEvidence(batch)))),
      );
    }
    return pages.flatMap((page) => page.items);
  };

  const loadVariants = async ({ includeBackup = false, refreshNative = false } = {}) => {
    variantsLoading = true;
    variantError = '';
    try {
      let nativeGroups = [...(await ensureNativeVariantGroups({ refresh: refreshNative }))];
      if (focusedAssetId) {
        nativeGroups = nativeGroups.sort(
          (left, right) =>
            Number(right.assets.some((asset) => asset.id === focusedAssetId)) -
            Number(left.assets.some((asset) => asset.id === focusedAssetId)),
        );
      }
      allVariantNativeGroups = nativeGroups;
      const firstBatch = nativeGroups.slice(0, 12);
      const sourceAssetIds = [...new Set(firstBatch.flatMap((group) => group.assets.map((asset) => asset.id)))];
      const evidence = await readArchiveEvidence(sourceAssetIds);
      variantGroups = buildArchiveVariantGroups(firstBatch, evidence);
      variantsLoaded = true;
      if (includeBackup) {
        void loadBackupProof(sourceAssetIds);
      }
    } catch (error_) {
      variantError = friendlyError(error_, 'Cimmich could not read similarity candidates.');
    } finally {
      variantsLoading = false;
    }
  };

  const loadMoreVariants = async () => {
    const nextBatch = allVariantNativeGroups.slice(variantGroups.length, variantGroups.length + 12);
    if (nextBatch.length === 0 || variantsLoading) {
      return;
    }
    variantsLoading = true;
    variantError = '';
    try {
      const sourceAssetIds = [...new Set(nextBatch.flatMap((group) => group.assets.map((asset) => asset.id)))];
      const evidence = await readArchiveEvidence(sourceAssetIds);
      variantGroups = [...variantGroups, ...buildArchiveVariantGroups(nextBatch, evidence)];
    } catch (error_) {
      variantError = friendlyError(error_, 'Cimmich could not load more comparison details.');
    } finally {
      variantsLoading = false;
    }
  };

  const readFolderAssets = async (folderPath: string) => {
    const matches: AssetResponseDto[] = [];
    let pageNumber = 1;
    for (let pageIndex = 0; pageIndex < 50; pageIndex += 1) {
      const result = await searchAssets({
        metadataSearchDto: { originalPath: folderPath, page: pageNumber, size: 100, withExif: true },
      });
      matches.push(
        ...result.assets.items.filter((asset) => {
          if (asset.isTrashed || asset.isOffline || !asset.originalPath) {
            return false;
          }
          return asset.originalPath.slice(0, asset.originalPath.lastIndexOf('/')) === folderPath;
        }),
      );
      if (!result.assets.nextPage) {
        break;
      }
      const nextPage = Number(result.assets.nextPage);
      if (!Number.isInteger(nextPage) || nextPage <= pageNumber) {
        break;
      }
      pageNumber = nextPage;
    }
    return matches.filter(
      (asset, index, assets) => assets.findIndex((candidate) => candidate.id === asset.id) === index,
    );
  };

  const loadFolderRanking = async ({ refreshNative = false } = {}) => {
    folderRankingLoading = true;
    variantError = '';
    try {
      await ensureNativeVariantGroups({ refresh: refreshNative });
    } catch (error_) {
      variantError = friendlyError(error_, 'Cimmich could not rank archive folders.');
    } finally {
      folderRankingLoading = false;
    }
  };

  const verifyFolderEvidence = async (counterpartFolder: string, requestGeneration = folderRequestGeneration) => {
    if (
      !counterpartFolder ||
      folderVerifiedPaths.includes(counterpartFolder) ||
      verifyingFolder === counterpartFolder
    ) {
      return;
    }
    verifyingFolder = counterpartFolder;
    try {
      const targetGroups = folderNativeGroups.filter((group) =>
        group.assets.some(
          (asset) => Boolean(asset.originalPath) && getParentPath(asset.originalPath) === counterpartFolder,
        ),
      );
      const sourceAssetIds = [...new Set(targetGroups.flatMap((group) => group.assets.map((asset) => asset.id)))];
      const evidence = await readArchiveEvidence(sourceAssetIds);
      if (requestGeneration !== folderRequestGeneration) {
        return;
      }
      const verifiedGroups = new Map(
        buildArchiveVariantGroups(targetGroups, evidence).map((group) => [group.duplicateId, group]),
      );
      variantGroups = variantGroups.map((group) => verifiedGroups.get(group.duplicateId) ?? group);
      folderVerifiedPaths = [...new Set([...folderVerifiedPaths, counterpartFolder])];
    } catch (error_) {
      if (requestGeneration === folderRequestGeneration) {
        folderError = friendlyError(error_, 'Cimmich could not check byte details for these folders.');
      }
    } finally {
      if (requestGeneration === folderRequestGeneration && verifyingFolder === counterpartFolder) {
        verifyingFolder = '';
      }
    }
  };

  const loadFolderComparison = async (folderPath: string, { refreshNative = false } = {}) => {
    const requestGeneration = ++folderRequestGeneration;
    folderLoading = true;
    variantsLoading = true;
    folderLoaded = false;
    variantsLoaded = false;
    folderError = '';
    variantError = '';
    try {
      const [allNativeGroups, assets] = await Promise.all([
        ensureNativeVariantGroups({ refresh: refreshNative }),
        readFolderAssets(folderPath),
      ]);
      const scopedNativeGroups = archiveVariantGroupsInFolder(allNativeGroups, folderPath);
      if (requestGeneration !== folderRequestGeneration) {
        return;
      }
      folderAssets = assets;
      folderNativeGroups = scopedNativeGroups;
      folderVerifiedPaths = [];
      verifyingFolder = '';
      variantGroups = buildArchiveVariantGroups(scopedNativeGroups, []);
      folderLoaded = true;
      variantsLoaded = true;
      const largestOverlap = buildArchiveFolderOverlap(folderPath, assets, variantGroups).sharedFolders[0]?.folderPath;
      if (largestOverlap) {
        void verifyFolderEvidence(largestOverlap, requestGeneration);
      }
    } catch (error_) {
      if (requestGeneration === folderRequestGeneration) {
        folderError = friendlyError(error_, 'Cimmich could not compare this folder.');
      }
    } finally {
      if (requestGeneration === folderRequestGeneration) {
        folderLoading = false;
        variantsLoading = false;
      }
    }
  };

  const submitFolder = (event: SubmitEvent) => {
    event.preventDefault();
    const folderPath = folderPathInput.trim();
    if (!folderPath) {
      return;
    }
    activeFolder = folderPath;
    routeSignature = `folder:${folderPath}`;
    replaceState(Route.cimmichArchiveIntegrity({ folder: folderPath, mode: 'folder' }), globalThis.history.state);
    void loadFolderComparison(folderPath);
  };

  const refreshCurrentMode = () => {
    if (mode === 'exact') {
      void load();
      return;
    }
    if (mode === 'variants') {
      void loadVariants({ refreshNative: true });
      return;
    }
    if (mode === 'folder') {
      if (activeFolder) {
        void loadFolderComparison(activeFolder, { refreshNative: true });
      } else {
        void loadFolderRanking({ refreshNative: true });
      }
      return;
    }
    void load();
    void loadVariants({ includeBackup: true, refreshNative: true });
  };

  $effect(() => {
    const nextRequestedMode = page.url.searchParams.get('mode');
    const nextFolder = page.url.searchParams.get('folder')?.trim() ?? '';
    const nextMode: typeof mode =
      nextRequestedMode === 'folder' || (nextRequestedMode === 'variants' && nextFolder)
        ? 'folder'
        : nextRequestedMode === 'variants' || nextRequestedMode === 'plan'
          ? 'variants'
          : nextRequestedMode === 'backup'
            ? 'backup'
            : 'exact';
    const nextSignature = `${nextMode}:${nextFolder}`;
    if (!routeReady || nextSignature === routeSignature) {
      return;
    }
    routeSignature = nextSignature;
    mode = nextMode;
    activeFolder = nextFolder;
    folderPathInput = nextFolder;
    switch (nextMode) {
      case 'exact': {
        void load();
        break;
      }
      case 'variants': {
        void loadVariants();
        break;
      }
      case 'folder': {
        if (nextFolder) {
          void loadFolderComparison(nextFolder);
        } else {
          void loadFolderRanking();
        }
        break;
      }
      case 'backup': {
        void load();
        void loadVariants({ includeBackup: true });
        break;
      }
    }
  });

  onMount(() => {
    routeReady = true;
    switch (mode) {
      case 'exact': {
        void load();
        break;
      }
      case 'variants': {
        void loadVariants();
        break;
      }
      case 'folder': {
        if (activeFolder) {
          void loadFolderComparison(activeFolder);
        } else {
          void loadFolderRanking();
        }
        break;
      }
      case 'backup': {
        void load();
        void loadVariants({ includeBackup: true });
        break;
      }
    }
  });
</script>

<UserPageLayout title={mode === 'folder' ? undefined : data.meta.title} scrollbar={false}>
  <div class="mx-auto w-full max-w-7xl space-y-4 px-4 pb-16 sm:px-6 lg:px-8 {mode === 'folder' ? 'pt-2' : 'pt-4'}">
    {#if mode === 'folder'}
      <header
        class="flex min-h-14 flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 dark:border-immich-dark-gray dark:bg-immich-dark-bg"
      >
        <div
          class="min-w-0 flex-1"
          title="See what this folder shares with the rest of the archive. Nothing is changed."
        >
          <div class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h1 id="folder-check-title" class="text-lg font-semibold tracking-tight">Folder Check</h1>
            {#if activeFolderName}
              <span class="truncate text-sm font-semibold text-violet-700 dark:text-violet-300">{activeFolderName}</span
              >
            {/if}
          </div>
          {#if activeFolder}
            <p class="truncate text-xs text-gray-500 dark:text-gray-400" title={activeFolder}>{activeFolder}</p>
          {:else}
            <p class="text-xs text-gray-500 dark:text-gray-400">Choose a folder to compare with the archive.</p>
          {/if}
        </div>
        <div class="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          <a
            data-sveltekit-reload
            href={Route.cimmichArchiveIntegrity()}
            class="inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-semibold hover:bg-gray-100 dark:hover:bg-gray-800"
            title="Back to Archive Health"
          >
            <Icon icon={mdiArrowRight} size="16" class="rotate-180" /> Archive Health
          </a>
          {#if activeFolder && focusedFolderAsset}
            <a
              class="inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-primary hover:bg-gray-100 dark:hover:bg-gray-800"
              href={Route.viewFolderAsset({ cimmich: 1, id: focusedFolderAsset.id, path: activeFolder })}
              title="Open this folder in Library"
            >
              Open folder <Icon icon={mdiArrowRight} size="16" />
            </a>
          {/if}
          <button
            type="button"
            class="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-gray-300 px-3 text-sm font-semibold hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-800"
            disabled={loading ||
              loadingMore ||
              variantsLoading ||
              folderLoading ||
              folderRankingLoading ||
              backupLoading}
            onclick={refreshCurrentMode}
            title="Run Folder Check again"
          >
            <Icon
              icon={mdiRefresh}
              size="16"
              class={loading || variantsLoading || folderLoading || folderRankingLoading || backupLoading
                ? 'animate-spin'
                : ''}
            />
            Refresh
          </button>
        </div>
      </header>
    {:else}
      <header class="rounded-3xl bg-[#111815] p-5 text-white shadow-sm sm:px-6">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div class="max-w-3xl">
            <h1 class="text-2xl font-semibold tracking-tight">Archive Health</h1>
            <p class="mt-1 text-sm text-slate-300">
              Review exact copies, possible duplicates and independent backups. Nothing is changed.
            </p>
          </div>
          <button
            type="button"
            class="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 text-sm font-semibold hover:bg-white/15 disabled:opacity-50"
            disabled={loading ||
              loadingMore ||
              variantsLoading ||
              folderLoading ||
              folderRankingLoading ||
              backupLoading}
            onclick={refreshCurrentMode}
          >
            <Icon
              icon={mdiRefresh}
              size="18"
              class={loading || variantsLoading || folderLoading || folderRankingLoading || backupLoading
                ? 'animate-spin'
                : ''}
            />
            Refresh
          </button>
        </div>
      </header>
      <nav
        class="flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border border-gray-200 bg-white p-1 dark:border-immich-dark-gray dark:bg-immich-dark-bg"
        aria-label="Archive health tools"
      >
        <a
          data-sveltekit-reload
          href={Route.cimmichArchiveIntegrity({ mode: 'exact' })}
          class="min-h-10 shrink-0 rounded-full px-4 text-sm font-semibold {mode === 'exact'
            ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-950'
            : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}"
          aria-current={mode === 'exact' ? 'page' : undefined}
        >
          Exact copies {loaded ? `(${number.format(summary.duplicateGroups)})` : ''}
        </a>
        <a
          data-sveltekit-reload
          href={Route.cimmichArchiveIntegrity({ mode: 'variants' })}
          class="min-h-10 shrink-0 rounded-full px-4 text-sm font-semibold {mode === 'variants'
            ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-950'
            : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}"
          aria-current={mode === 'variants' ? 'page' : undefined}
        >
          Possible duplicates {variantsLoaded ? `(${number.format(scopedVariantGroups.length)})` : ''}
        </a>
        <a
          data-sveltekit-reload
          href={Route.cimmichArchiveIntegrity({ mode: 'backup' })}
          class="min-h-10 shrink-0 rounded-full px-4 text-sm font-semibold {mode === 'backup'
            ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-950'
            : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}"
          aria-current={mode === 'backup' ? 'page' : undefined}
        >
          Backup check
        </a>
      </nav>
    {/if}

    {#if (mode === 'variants' && focusedAssetId) || (mode === 'exact' && focusedAssetId)}
      <div
        class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm dark:border-violet-900 dark:bg-violet-950/25"
      >
        <span class="min-w-0 truncate">
          {mode === 'exact' ? 'Exact copies for the photo you opened' : 'Possible duplicates for the photo you opened'}
        </span>
        <div class="flex flex-wrap items-center gap-4">
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
        <strong>{countLabel(allVariantNativeGroups.length, 'group')} found</strong> · {countLabel(
          variantGroups.length,
          'group',
        )} detailed. Comparisons load in small batches. A visual match is a review lead, not deletion proof.
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
    {:else if mode === 'folder'}
      <section class="space-y-4" aria-labelledby="folder-check-title">
        {#if activeFolder}
          <ArchiveFolderComparison
            error={folderError || variantError}
            folderPath={activeFolder}
            loaded={folderLoaded && variantsLoaded}
            loading={folderLoading || variantsLoading}
            onVerify={(folderPath) => void verifyFolderEvidence(folderPath)}
            overlap={folderOverlap}
            verifiedFolders={folderVerifiedPaths}
            {verifyingFolder}
          />
        {/if}

        <details
          class="rounded-3xl border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
          open={!activeFolder}
        >
          <summary class="cursor-pointer list-none px-5 py-4 font-semibold">
            {activeFolder ? 'Check another folder' : 'Choose a folder'}
          </summary>
          <div class="space-y-4 border-t border-gray-100 p-5 dark:border-immich-dark-gray">
            <div class="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 id="folder-check-title" class="text-lg font-semibold">Most impacted folders</h2>
                <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Ranked by files that also appear in other archive folders.
                </p>
              </div>
              <a
                class="inline-flex min-h-10 items-center gap-2 rounded-full border border-gray-300 px-4 text-sm font-semibold hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
                href={Route.folders({ cimmichContext: 1 })}
              >
                <Icon icon={mdiFolderOpenOutline} size="18" /> Browse folders
              </a>
            </div>
            <select
              id="folder-impact-selector"
              aria-label="Most impacted folders"
              class="min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm text-gray-950 outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-200 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-950 dark:text-white dark:focus:ring-violet-900"
              bind:value={folderPathInput}
              disabled={folderRankingLoading && folderImpacts.length === 0}
            >
              <option value="">
                {folderRankingLoading && folderImpacts.length === 0
                  ? 'Ranking archive folders…'
                  : folderImpacts.length === 0
                    ? 'No cross-folder impacts found'
                    : 'Choose a high-impact folder'}
              </option>
              {#if activeFolder && !visibleFolderImpacts.some((candidate) => candidate.folderPath === activeFolder)}
                <option value={activeFolder}>{activeFolder} · current folder</option>
              {/if}
              {#each visibleFolderImpacts as candidate, index (candidate.folderPath)}
                <option value={candidate.folderPath}>
                  {index + 1}. {candidate.folderPath} · {countLabel(
                    candidate.affectedAssetCount,
                    'affected file',
                    'affected files',
                  )} · {countLabel(candidate.counterpartFolderCount, 'other folder', 'other folders')}
                </option>
              {/each}
            </select>
            <form
              class="flex flex-col gap-3 sm:flex-row"
              method="get"
              action={Route.cimmichArchiveIntegrity()}
              onsubmit={submitFolder}
            >
              <input type="hidden" name="mode" value="folder" />
              <label class="min-w-0 flex-1">
                <span class="sr-only">Archive folder path</span>
                <input
                  class="min-h-11 w-full rounded-xl border border-gray-300 bg-white px-4 text-sm text-gray-950 outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-200 dark:border-gray-700 dark:bg-gray-950 dark:text-white dark:focus:ring-violet-900"
                  name="folder"
                  placeholder="/archive/Photos/Folder name"
                  autocomplete="off"
                  bind:value={folderPathInput}
                />
              </label>
              <button
                type="submit"
                class="min-h-11 rounded-full bg-violet-700 px-5 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-50"
                disabled={!folderPathInput.trim()}>Check folder</button
              >
            </form>
          </div>
        </details>
      </section>
    {:else if mode === 'variants'}
      <ArchiveVariantComparison
        allGroups={variantGroups}
        error={variantError}
        filter={variantFilter}
        filteredGroups={filteredVariantGroups}
        loaded={variantsLoaded}
        loading={variantsLoading}
        onFilter={(filter) => (variantFilter = filter)}
        onLoadMore={() => void loadMoreVariants()}
        totalGroupCount={allVariantNativeGroups.length}
        visibleGroups={visibleVariantGroups}
      />
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
