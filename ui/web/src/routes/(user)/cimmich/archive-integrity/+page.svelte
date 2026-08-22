<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import ArchiveBackupCheck from '$lib/components/cimmich/ArchiveBackupCheck.svelte';
  import ArchiveExactDuplicateResults from '$lib/components/cimmich/ArchiveExactDuplicateResults.svelte';
  import ArchiveFolderComparison from '$lib/components/cimmich/ArchiveFolderComparison.svelte';
  import ArchiveMissingFiles from '$lib/components/cimmich/ArchiveMissingFiles.svelte';
  import ArchiveRotationReview from '$lib/components/cimmich/ArchiveRotationReview.svelte';
  import {
    ROTATION_BACKLOG_LIMIT,
    ROTATION_MAX_PAGE,
    ROTATION_PAGE_SIZE,
    ROTATION_VISUAL_QUERY,
  } from '$lib/components/cimmich/archive-rotation-backlog';
  import ArchiveVariantResults from '$lib/components/cimmich/ArchiveVariantResults.svelte';
  import {
    buildArchiveFolderOverlap,
    rankArchiveFoldersByImpact,
    type ArchiveFolderImpact,
  } from '$lib/components/cimmich/archive-folder-comparison';
  import { archiveHealthMode, type ArchiveHealthMode } from '$lib/components/cimmich/archive-health-mode';
  import {
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
  import {
    getCimmichAssetCorrections,
    setCimmichAssetRotations,
    type CimmichAssetCorrectionDetails,
    type CimmichAssetRotationChange,
    type CimmichPhotoDetailReviewItem,
  } from '$lib/services/cimmich-asset-correction.service';
  import { getParentPath } from '$lib/utils/tree-utils';
  import {
    AssetTypeEnum,
    getAssetDuplicates,
    getAssetInfo,
    searchAssets,
    searchSmart,
    type AssetResponseDto,
    type DuplicateResponseDto,
  } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiArrowRight, mdiFolderOpenOutline, mdiRefresh } from '@mdi/js';
  import { onMount } from 'svelte';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
  const focusedAssetId = page.url.searchParams.get('assetId')?.trim() ?? '';
  const initialFocusedFolder = page.url.searchParams.get('folder')?.trim() ?? '';
  const requestedMode = page.url.searchParams.get('mode');
  let mode = $state<ArchiveHealthMode>(archiveHealthMode(requestedMode, initialFocusedFolder));
  let routeReady = $state(false);
  let routeSignature = $state(`${mode}:${initialFocusedFolder}`);
  let activeFolder = $state(initialFocusedFolder);
  let folderPathInput = $state(initialFocusedFolder);
  let error = $state('');
  let groups = $state<CimmichExactDuplicateGroup[]>([]);
  let exactAssetPaths = $state<Map<string, string | null>>(new Map());
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
  let rotationAssets = $state<Map<string, AssetResponseDto | null>>(new Map());
  let rotationBusyAssetId = $state('');
  let rotationError = $state('');
  let rotationHasMore = $state(false);
  let rotationItems = $state<CimmichPhotoDetailReviewItem[]>([]);
  let rotationLoaded = $state(false);
  let rotationLoading = $state(false);
  let rotationLoadingMore = $state(false);
  let rotationNextPage = $state(1);
  let missingRefreshRevision = $state(0);
  let nativeVariantGroups = $state<DuplicateResponseDto[] | null>(null);
  let nativeVariantGroupsRequest: Promise<DuplicateResponseDto[]> | null = null;
  const exactPathRequests: string[] = [];
  let folderRequestGeneration = 0;
  let rotationRequestGeneration = 0;
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
  const countLabel = (value: number, singular: string, plural = `${singular}s`) =>
    `${number.format(value)} ${value === 1 ? singular : plural}`;
  const friendlyError = (error_: unknown, fallback: string) => {
    const message = error_ instanceof Error ? error_.message : '';
    if (message.includes('did not respond in time')) {
      return 'This comparison took too long. Try again, or use Folder Check for a smaller comparison.';
    }
    return message.replace(/\s*\((GET|POST|PUT|PATCH|DELETE)\s+\/[^)]*\)\s*$/i, '').trim() || fallback;
  };
  const loadExactPaths = async (nextGroups: CimmichExactDuplicateGroup[]) => {
    const pending = nextGroups
      .flatMap((group) => group.copies)
      .map((copy) => copy.sourceAssetId)
      .filter((sourceAssetId) => !exactAssetPaths.has(sourceAssetId) && !exactPathRequests.includes(sourceAssetId));
    exactPathRequests.push(...pending);
    let cursor = 0;
    const updates: Array<[string, string | null]> = [];
    const worker = async () => {
      while (cursor < pending.length) {
        const sourceAssetId = pending[cursor++];
        if (!sourceAssetId) {
          continue;
        }
        const asset = await getAssetInfo({ id: sourceAssetId }).catch(() => null);
        updates.push([sourceAssetId, asset?.originalPath || null]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, pending.length) }, () => worker()));
    if (updates.length > 0) {
      exactAssetPaths = new Map([...exactAssetPaths, ...updates]);
    }
  };
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
      void loadExactPaths(page.groups);
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

  const loadRotation = async ({ append = false } = {}) => {
    const requestGeneration = append ? rotationRequestGeneration : ++rotationRequestGeneration;
    if (append) {
      rotationLoadingMore = true;
    } else {
      rotationLoading = true;
      rotationLoaded = false;
      rotationError = '';
    }
    try {
      let pageNumber = append ? rotationNextPage : 1;
      let keepExisting = append;
      while (pageNumber > 0) {
        const next = await searchSmart({
          smartSearchDto: {
            page: pageNumber,
            query: ROTATION_VISUAL_QUERY,
            size: ROTATION_PAGE_SIZE,
            type: AssetTypeEnum.Image,
          },
        });
        if (requestGeneration !== rotationRequestGeneration) {
          return;
        }
        const remainingQueueSlots = Math.max(0, ROTATION_BACKLOG_LIMIT - (pageNumber - 1) * ROTATION_PAGE_SIZE);
        const nextAssets = next.assets.items.slice(0, remainingQueueSlots);
        const sourceEvidence =
          nextAssets.length > 0
            ? await getCimmichArchiveSourceEvidence(nextAssets.map((asset) => asset.id))
            : { items: [] };
        const assetIdsBySource = new Map(sourceEvidence.items.map((item) => [item.sourceAssetId, item.assetId]));
        const correctionPage =
          sourceEvidence.items.length > 0
            ? await getCimmichAssetCorrections(sourceEvidence.items.map((item) => item.assetId))
            : { items: [] };
        const corrections = new Map(correctionPage.items.map((item) => [item.assetId, item]));
        const nextItems = nextAssets
          .map<CimmichPhotoDetailReviewItem>((asset) => {
            const assetId = assetIdsBySource.get(asset.id) ?? asset.id;
            const correction = corrections.get(assetId);
            return {
              assetId,
              captureTime: asset.exifInfo?.dateTimeOriginal ?? asset.fileCreatedAt,
              captureTimeProvenance: correction?.captureTimeProvenance ?? 'source_metadata',
              confidenceSignal: 0,
              correctionDecisionIds: correction?.correctionDecisionIds ?? [],
              filename: correction?.filename ?? asset.originalFileName,
              location: correction?.location ?? null,
              originalCaptureTime:
                correction?.originalCaptureTime ?? asset.exifInfo?.dateTimeOriginal ?? asset.fileCreatedAt,
              reason: 'immich_visual_rotation_candidate',
              rotationDecisionId: correction?.rotationDecisionId ?? null,
              rotationQuarterTurns: correction?.rotationQuarterTurns ?? 0,
              schemaVersion: 'cimmich.asset-correction.v1',
              sourceAssetId: asset.id,
            };
          })
          .filter((candidate) => !candidate.rotationDecisionId);
        const activeSourceIds = new Set(nextItems.map((item) => item.sourceAssetId));
        const combined = keepExisting ? [...rotationItems, ...nextItems] : nextItems;
        rotationItems = [...new Map(combined.map((item) => [item.assetId, item])).values()];
        rotationAssets = new Map([
          ...(keepExisting ? rotationAssets : new Map<string, AssetResponseDto | null>()),
          ...nextAssets
            .filter((asset) => activeSourceIds.has(asset.id))
            .map((asset): [string, AssetResponseDto] => [asset.id, asset]),
        ]);
        rotationNextPage = pageNumber < ROTATION_MAX_PAGE ? Number(next.assets.nextPage) || 0 : 0;
        rotationHasMore = rotationNextPage > 0;
        if (nextItems.length > 0 || !rotationHasMore) {
          break;
        }
        pageNumber = rotationNextPage;
        keepExisting = true;
      }
      rotationLoaded = true;
    } catch (error_) {
      if (requestGeneration === rotationRequestGeneration) {
        rotationError = friendlyError(error_, 'Cimmich could not read likely rotation candidates.');
      }
    } finally {
      if (requestGeneration === rotationRequestGeneration) {
        rotationLoading = false;
        rotationLoadingMore = false;
      }
    }
  };

  const mergeRotationDetails = (
    candidate: CimmichPhotoDetailReviewItem,
    details: CimmichAssetCorrectionDetails | undefined,
  ) => (details ? { ...candidate, ...details } : candidate);

  const confirmCandidateRotations = async (changes: CimmichAssetRotationChange[]) => {
    if (rotationBusyAssetId || changes.length === 0) {
      return false;
    }
    rotationBusyAssetId = changes.length === 1 ? changes[0].assetId : 'bulk';
    rotationError = '';
    try {
      const detailsByAsset: Record<string, CimmichAssetCorrectionDetails> = {};
      for (let index = 0; index < changes.length; index += 100) {
        const result = await setCimmichAssetRotations(changes.slice(index, index + 100));
        for (const details of result.items ?? []) {
          detailsByAsset[details.assetId] = details;
        }
      }
      rotationItems = rotationItems
        .map((candidate) => mergeRotationDetails(candidate, detailsByAsset[candidate.assetId]))
        .filter((candidate) => !candidate.rotationDecisionId);
      const activeSourceIds = new Set(rotationItems.map((item) => item.sourceAssetId));
      rotationAssets = new Map([...rotationAssets].filter(([sourceAssetId]) => activeSourceIds.has(sourceAssetId)));
      if (rotationItems.length === 0 && rotationHasMore) {
        await loadRotation({ append: true });
      }
      return true;
    } catch (error_) {
      rotationError = friendlyError(error_, 'Cimmich could not save or confirm the rotation review.');
      return false;
    } finally {
      rotationBusyAssetId = '';
    }
  };

  const submitFolder = (event: SubmitEvent) => {
    event.preventDefault();
    const folderPath = folderPathInput.trim();
    if (!folderPath) {
      return;
    }
    void goto(Route.cimmichArchiveIntegrity({ folder: folderPath, mode: 'folder' }), {
      keepFocus: true,
      noScroll: true,
      replaceState: true,
    });
  };

  const refreshCurrentMode = () => {
    if (mode === 'missing') {
      missingRefreshRevision += 1;
      return;
    }
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
    if (mode === 'rotation') {
      void loadRotation();
      return;
    }
    void load();
    void loadVariants({ includeBackup: true, refreshNative: true });
  };

  $effect(() => {
    const nextRequestedMode = page.url.searchParams.get('mode');
    const nextFolder = page.url.searchParams.get('folder')?.trim() ?? '';
    const nextMode = archiveHealthMode(nextRequestedMode, nextFolder);
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
      case 'rotation': {
        void loadRotation();
        break;
      }
      case 'backup': {
        void load();
        void loadVariants({ includeBackup: true });
        break;
      }
      case 'missing': {
        missingRefreshRevision += 1;
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
      case 'rotation': {
        void loadRotation();
        break;
      }
      case 'backup': {
        void load();
        void loadVariants({ includeBackup: true });
        break;
      }
      case 'missing': {
        break;
      }
    }
  });
</script>

<UserPageLayout title={data.meta.title} scrollbar={false}>
  {#snippet buttons()}
    <div class="flex min-w-0 flex-1 items-center justify-end gap-2">
      <nav
        class="flex min-w-0 gap-1 overflow-x-auto rounded-full bg-gray-100 p-1 dark:bg-gray-900"
        aria-label="Archive health checks"
      >
        <a
          href={Route.cimmichArchiveIntegrity({ mode: 'exact' })}
          class="inline-flex min-h-9 shrink-0 items-center rounded-full px-3 text-sm font-semibold {mode === 'exact'
            ? 'bg-white text-gray-950 shadow-sm dark:bg-gray-700 dark:text-white'
            : 'text-gray-600 hover:bg-white/70 dark:text-gray-300 dark:hover:bg-gray-800'}"
          aria-current={mode === 'exact' ? 'page' : undefined}
          title="Find files whose complete bytes are identical"
        >
          Exact copies {loaded ? `(${number.format(summary.duplicateGroups)})` : ''}
        </a>
        <a
          href={Route.cimmichArchiveIntegrity({ mode: 'variants' })}
          class="inline-flex min-h-9 shrink-0 items-center rounded-full px-3 text-sm font-semibold {mode === 'variants'
            ? 'bg-white text-gray-950 shadow-sm dark:bg-gray-700 dark:text-white'
            : 'text-gray-600 hover:bg-white/70 dark:text-gray-300 dark:hover:bg-gray-800'}"
          aria-current={mode === 'variants' ? 'page' : undefined}
          title="Review visually similar files and compare their evidence"
        >
          Possible duplicates {variantsLoaded ? `(${number.format(scopedVariantGroups.length)})` : ''}
        </a>
        <a
          href={Route.cimmichArchiveIntegrity({ mode: 'folder' })}
          class="inline-flex min-h-9 shrink-0 items-center rounded-full px-3 text-sm font-semibold {mode === 'folder'
            ? 'bg-white text-gray-950 shadow-sm dark:bg-gray-700 dark:text-white'
            : 'text-gray-600 hover:bg-white/70 dark:text-gray-300 dark:hover:bg-gray-800'}"
          aria-current={mode === 'folder' ? 'page' : undefined}
          title="Compare one folder with the rest of the archive"
        >
          Folder check
        </a>
        <a
          href={Route.cimmichArchiveIntegrity({ mode: 'rotation' })}
          class="inline-flex min-h-9 shrink-0 items-center rounded-full px-3 text-sm font-semibold {mode === 'rotation'
            ? 'bg-white text-gray-950 shadow-sm dark:bg-gray-700 dark:text-white'
            : 'text-gray-600 hover:bg-white/70 dark:text-gray-300 dark:hover:bg-gray-800'}"
          aria-current={mode === 'rotation' ? 'page' : undefined}
          title="Review photos Immich ranks as visually similar to sideways images"
        >
          Rotation review
        </a>
        <a
          href={Route.cimmichArchiveIntegrity({ mode: 'missing' })}
          class="inline-flex min-h-9 shrink-0 items-center rounded-full px-3 text-sm font-semibold {mode === 'missing'
            ? 'bg-white text-gray-950 shadow-sm dark:bg-gray-700 dark:text-white'
            : 'text-gray-600 hover:bg-white/70 dark:text-gray-300 dark:hover:bg-gray-800'}"
          aria-current={mode === 'missing' ? 'page' : undefined}
          title="Find Cimmich records absent from complete Immich catalogue checks"
        >
          Missing files
        </a>
        <a
          href={Route.cimmichArchiveIntegrity({ mode: 'backup' })}
          class="inline-flex min-h-9 shrink-0 items-center rounded-full px-3 text-sm font-semibold {mode === 'backup'
            ? 'bg-white text-gray-950 shadow-sm dark:bg-gray-700 dark:text-white'
            : 'text-gray-600 hover:bg-white/70 dark:text-gray-300 dark:hover:bg-gray-800'}"
          aria-current={mode === 'backup' ? 'page' : undefined}
          title="Compare the archive with a read-only independent backup"
        >
          Backup check
        </a>
      </nav>
      <button
        type="button"
        class="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-gray-300 px-3 text-sm font-semibold hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-800"
        disabled={loading ||
          loadingMore ||
          variantsLoading ||
          folderLoading ||
          folderRankingLoading ||
          backupLoading ||
          rotationLoading ||
          rotationLoadingMore ||
          Boolean(rotationBusyAssetId)}
        onclick={refreshCurrentMode}
        title="Refresh only the selected check"
      >
        <Icon
          icon={mdiRefresh}
          size="16"
          class={loading ||
          variantsLoading ||
          folderLoading ||
          folderRankingLoading ||
          backupLoading ||
          rotationLoading ||
          rotationLoadingMore
            ? 'animate-spin'
            : ''}
        />
        <span class="hidden lg:inline">Refresh</span>
      </button>
    </div>
  {/snippet}

  <div class="mx-auto w-full max-w-7xl space-y-4 px-4 pt-2 pb-16 sm:px-6 lg:px-8">
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

    {#if error}
      <div
        class="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
      >
        {error}
      </div>
    {/if}

    {#if mode === 'missing'}
      <ArchiveMissingFiles refreshRevision={missingRefreshRevision} />
    {:else if mode === 'exact'}
      <ArchiveExactDuplicateResults
        assetPaths={exactAssetPaths}
        {groups}
        {loaded}
        {loading}
        {loadingMore}
        {nextOffset}
        onLoadMore={() => void load({ append: true })}
        {summary}
      />
    {:else if mode === 'folder'}
      <section class="space-y-4" aria-label="Folder check">
        {#if activeFolder}
          <div
            class="flex min-w-0 items-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-2 text-xs dark:border-immich-dark-gray dark:bg-immich-dark-bg"
          >
            <Icon icon={mdiFolderOpenOutline} size="16" class="shrink-0 text-violet-600" />
            <span class="shrink-0 font-semibold text-violet-700 dark:text-violet-300">{activeFolderName}</span>
            <span class="min-w-0 flex-1 truncate text-gray-500 dark:text-gray-400" title={activeFolder}
              >{activeFolder}</span
            >
            {#if focusedFolderAsset}
              <a
                class="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full px-2.5 font-semibold text-primary hover:bg-gray-100 dark:hover:bg-gray-800"
                href={Route.viewFolderAsset({ cimmich: 1, id: focusedFolderAsset.id, path: activeFolder })}
                title="Open this folder in Library"
              >
                Open folder <Icon icon={mdiArrowRight} size="15" />
              </a>
            {/if}
          </div>
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
                <h2 class="text-lg font-semibold">Most impacted folders</h2>
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
      <ArchiveVariantResults
        allGroupCount={allVariantNativeGroups.length}
        contextGroups={variantGroups}
        detailedGroupCount={variantGroups.length}
        error={variantError}
        filter={variantFilter}
        groups={visibleVariantGroups}
        loaded={variantsLoaded}
        loading={variantsLoading}
        moreAvailable={variantGroups.length < allVariantNativeGroups.length}
        onFilter={(filter) => (variantFilter = filter)}
        onLoadMore={() => void loadMoreVariants()}
      />
    {:else if mode === 'rotation'}
      <ArchiveRotationReview
        assets={rotationAssets}
        busyAssetId={rotationBusyAssetId}
        error={rotationError}
        hasMore={rotationHasMore}
        items={rotationItems}
        loaded={rotationLoaded}
        loading={rotationLoading}
        loadingMore={rotationLoadingMore}
        onConfirm={confirmCandidateRotations}
        onLoadMore={() => void loadRotation({ append: true })}
      />
    {:else}
      <ArchiveBackupCheck
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
