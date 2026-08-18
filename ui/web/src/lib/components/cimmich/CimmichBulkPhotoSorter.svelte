<script lang="ts">
  import { page } from '$app/state';
  import { cimmichVisibilityManager } from '$lib/managers/cimmich-visibility-manager.svelte';
  import {
    attachCimmichContextAssets,
    changeCimmichAssetLabelMembership,
    createCimmichAssetLabel,
    createCimmichAssetLabelCommandId,
    createCimmichContextCommandId,
    createCimmichVisibilityCommandId,
    getCimmichContextEntities,
    getCimmichAssetLabels,
    getCimmichPeople,
    getCimmichTagAssets,
    getCimmichVisibleMapAssetBindings,
    setCimmichVisibilityObjects,
    undoCimmichContextDecision,
    undoCimmichAssetLabelDecision,
    undoCimmichVisibilityDecision,
    type CimmichAssetLabel,
    type CimmichContextEntity,
    type CimmichPerson,
    type CimmichVisibilityTier,
  } from '$lib/services/cimmich.service';
  import {
    getAllAlbums,
    getAllTags,
    searchAssets,
    type AlbumResponseDto,
    type AssetResponseDto,
    type MetadataSearchDto,
    type TagResponseDto,
  } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import {
    mdiAlertCircleOutline,
    mdiFilterOutline,
    mdiFolderMultipleOutline,
    mdiImageMultipleOutline,
    mdiRefresh,
  } from '@mdi/js';
  import { SvelteSet } from 'svelte/reactivity';
  import { applyBulkPhotoRotation, undoBulkPhotoRotation } from './bulk-photo-corrections';
  import { currentCimmichUndoReceiptContext } from './cimmich-undo-receipt-context.svelte';
  import CimmichBulkPhotoActionPanel from './CimmichBulkPhotoActionPanel.svelte';
  import CimmichBulkPhotoPreview from './CimmichBulkPhotoPreview.svelte';
  import CimmichBulkPhotoStatus from './CimmichBulkPhotoStatus.svelte';
  import {
    BULK_PHOTO_SORTER_PAGE_SIZE,
    BULK_PHOTO_SORTER_PREVIEW_SIZE,
    buildBulkPhotoSorterSearch,
    bulkPhotoSorterActionLabel,
    bulkPhotoSorterActionNeedsTarget,
    bulkPhotoSorterFilterFingerprint,
    bulkPhotoSorterMappedIds,
    bulkPhotoSorterSameSnapshot,
    chunkBulkPhotoSorterItems,
    createBulkPhotoSorterOperationId,
    emptyBulkPhotoSorterFilters,
    loadBulkPhotoSorterReceipt,
    saveBulkPhotoSorterReceipt,
    type BulkPhotoSorterActionKind,
    type BulkPhotoSorterOperationReceipt,
    type BulkPhotoSorterUndoReceipt,
  } from './bulk-photo-sorter';
  import { sameCimmichUndoReceiptContext, type CimmichUndoReceiptContext } from './persisted-undo-receipt';
  const initialFilters = emptyBulkPhotoSorterFilters();
  initialFilters.folder = page.url.searchParams.get('folder') ?? '';
  let filters = $state(initialFilters);
  let action = $state<BulkPhotoSorterActionKind>('label-add');
  let targetId = $state('');
  let albums = $state<AlbumResponseDto[]>([]);
  let collections = $state<CimmichAssetLabel[]>([]);
  let labels = $state<CimmichAssetLabel[]>([]);
  let organizationStates = $state<Record<'archive' | 'favorite', CimmichAssetLabel | undefined>>({
    archive: undefined,
    favorite: undefined,
  });
  let people = $state<CimmichPerson[]>([]);
  let tags = $state<TagResponseDto[]>([]);
  let places = $state<CimmichContextEntity[]>([]);
  let events = $state<CimmichContextEntity[]>([]);
  let optionsLoading = $state(true);
  let optionSearching = $state(false);
  let optionsError = $state('');
  let personOptionQuery = $state('');
  let targetOptionQuery = $state('');
  let newLabelName = $state('');
  let creatingLabel = $state(false);
  let previewAssets = $state<AssetResponseDto[]>([]);
  let previewTotal = $state<number | null>(null);
  let previewHasMore = $state(false);
  let previewFingerprint = $state('');
  let previewing = $state(false);
  let busy = $state(false);
  let undoing = $state(false);
  let progress = $state('');
  let error = $state('');
  let receipt = $state<BulkPhotoSorterOperationReceipt | null>(null);
  let receiptContext: CimmichUndoReceiptContext | null = null;
  let receiptStorageLoaded = false;

  const filterFingerprint = $derived(bulkPhotoSorterFilterFingerprint(filters));
  const previewIsCurrent = $derived(previewTotal !== null && previewFingerprint === filterFingerprint);
  const needsTarget = $derived(bulkPhotoSorterActionNeedsTarget(action));
  const canApply = $derived(
    previewIsCurrent &&
      previewTotal !== null &&
      previewTotal > 0 &&
      (!needsTarget || Boolean(targetId)) &&
      !receipt?.undo,
  );
  const targetOptions = $derived(
    action === 'album-add'
      ? collections.map(({ labelId, displayName }) => ({ id: labelId, label: displayName }))
      : action === 'label-add' || action === 'label-remove'
        ? labels.map(({ labelId, displayName }) => ({ id: labelId, label: displayName }))
        : action === 'tag-add' || action === 'tag-remove'
          ? labels.map(({ labelId, displayName }) => ({ id: labelId, label: displayName }))
          : action === 'place-attach'
            ? places.map(({ entityId, displayName }) => ({ id: entityId, label: displayName }))
            : action === 'event-attach'
              ? events.map(({ entityId, displayName }) => ({ id: entityId, label: displayName }))
              : [],
  );
  const targetLabel = $derived(targetOptions.find(({ id }) => id === targetId)?.label ?? '');

  const asErrorMessage = (caught: unknown) =>
    caught instanceof Error ? caught.message : 'The operation could not be completed.';

  const storeReceipt = (next: BulkPhotoSorterOperationReceipt | null) => {
    const context = currentCimmichUndoReceiptContext();
    receiptContext = context;
    receipt = context ? next : null;
    saveBulkPhotoSorterReceipt(globalThis.localStorage, next, context);
  };

  $effect(() => {
    const context = currentCimmichUndoReceiptContext();
    if (!receiptStorageLoaded || !sameCimmichUndoReceiptContext(receiptContext, context)) {
      receiptStorageLoaded = true;
      receiptContext = context;
      receipt = loadBulkPhotoSorterReceipt(globalThis.localStorage, context);
    }
  });

  const loadOptions = async () => {
    optionsLoading = true;
    optionsError = '';
    try {
      const [
        albumItems,
        peopleResult,
        tagItems,
        placeItems,
        eventItems,
        labelItems,
        collectionItems,
        favoriteItems,
        archiveItems,
      ] = await Promise.all([
        getAllAlbums({ isOwned: true }),
        getCimmichPeople(500, '', { presentation: false }),
        getAllTags(),
        getCimmichContextEntities('places', { limit: 500 }),
        getCimmichContextEntities('events', { limit: 500 }),
        getCimmichAssetLabels(),
        getCimmichAssetLabels('', 250, 'collection'),
        getCimmichAssetLabels('', 1, 'favorite'),
        getCimmichAssetLabels('', 1, 'archive'),
      ]);
      albums = [...albumItems].sort((left, right) => left.albumName.localeCompare(right.albumName));
      people = peopleResult
        .filter((person) => person.subject_kind === 'person' && person.status === 'active')
        .sort((left, right) => left.display_name.localeCompare(right.display_name));
      tags = [...tagItems].sort((left, right) => left.name.localeCompare(right.name));
      places = [...placeItems].sort((left, right) => left.displayName.localeCompare(right.displayName));
      events = [...eventItems].sort((left, right) => left.displayName.localeCompare(right.displayName));
      labels = [...labelItems].sort((left, right) => left.displayName.localeCompare(right.displayName));
      collections = [...collectionItems].sort((left, right) => left.displayName.localeCompare(right.displayName));
      organizationStates = { archive: archiveItems[0], favorite: favoriteItems[0] };
    } catch (error_) {
      optionsError = `${asErrorMessage(error_)} You can still use filters and actions that do not need these lists.`;
    } finally {
      optionsLoading = false;
    }
  };

  const searchPeopleOptions = async () => {
    optionSearching = true;
    optionsError = '';
    try {
      const result = await getCimmichPeople(500, personOptionQuery, { presentation: false });
      people = result
        .filter((person) => person.subject_kind === 'person' && person.status === 'active')
        .sort((left, right) => left.display_name.localeCompare(right.display_name));
    } catch (error_) {
      optionsError = asErrorMessage(error_);
    } finally {
      optionSearching = false;
    }
  };

  const searchContextOptions = async () => {
    if (action !== 'place-attach' && action !== 'event-attach') {
      return;
    }
    optionSearching = true;
    optionsError = '';
    try {
      const family = action === 'place-attach' ? 'places' : 'events';
      const result = await getCimmichContextEntities(family, { limit: 500, query: targetOptionQuery });
      const items = result.sort((left, right) => left.displayName.localeCompare(right.displayName));
      if (family === 'places') {
        places = items;
      } else {
        events = items;
      }
    } catch (error_) {
      optionsError = asErrorMessage(error_);
    } finally {
      optionSearching = false;
    }
  };

  const createLabel = async () => {
    const displayName = newLabelName.trim();
    if (!displayName) {
      return;
    }
    creatingLabel = true;
    optionsError = '';
    try {
      const kind = action === 'album-add' ? 'collection' : 'label';
      const result = await createCimmichAssetLabel(
        displayName,
        createCimmichAssetLabelCommandId(`organise-create-${kind}`),
        kind,
      );
      if (kind === 'collection') {
        collections = [...collections.filter(({ labelId }) => labelId !== result.label.labelId), result.label].sort(
          (left, right) => left.displayName.localeCompare(right.displayName),
        );
      } else {
        labels = [...labels.filter(({ labelId }) => labelId !== result.label.labelId), result.label].sort(
          (left, right) => left.displayName.localeCompare(right.displayName),
        );
      }
      targetId = result.label.labelId;
      newLabelName = '';
    } catch (error_) {
      optionsError = asErrorMessage(error_);
    } finally {
      creatingLabel = false;
    }
  };

  $effect(() => {
    void loadOptions();
  });

  const loadCimmichFilterSourceIds = async () => {
    const selected: Array<{ entityId: string; family: 'labels' | 'people' }> = [];
    if (filters.personId) {
      selected.push({ entityId: filters.personId, family: 'people' });
    }
    if (filters.cimmichCollectionId) {
      selected.push({ entityId: filters.cimmichCollectionId, family: 'labels' });
    }
    if (filters.cimmichLabelId) {
      selected.push({ entityId: filters.cimmichLabelId, family: 'labels' });
    }
    if (filters.cimmichState !== 'any') {
      const stateLabel = organizationStates[filters.cimmichState];
      if (!stateLabel) {
        throw new Error('Cimmich library state is not ready');
      }
      selected.push({ entityId: stateLabel.labelId, family: 'labels' });
    }
    if (selected.length === 0) {
      return undefined;
    }
    const sourceIds = new SvelteSet<string>();
    let cursor: string | undefined;
    do {
      progress = `Loading exact Cimmich matches… ${sourceIds.size.toLocaleString()}`;
      const page = await getCimmichTagAssets(selected, 250, cursor);
      for (const asset of page.items) {
        sourceIds.add(asset.sourceAssetId);
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return sourceIds;
  };

  const preview = async () => {
    previewing = true;
    error = '';
    progress = 'Finding matching photos…';
    try {
      const fingerprint = filterFingerprint;
      const acceptedSourceIds = await loadCimmichFilterSourceIds();
      const samples: AssetResponseDto[] = [];
      const matches = await collectAssets(
        buildBulkPhotoSorterSearch(filters),
        undefined,
        acceptedSourceIds ? 'Finding exact Cimmich matches' : 'Finding visible matches',
        acceptedSourceIds,
        samples,
      );
      if (fingerprint !== filterFingerprint) {
        return;
      }
      previewAssets = samples;
      previewTotal = matches.length;
      previewHasMore = false;
      previewFingerprint = fingerprint;
      progress = `${matches.length.toLocaleString()} ${matches.length === 1 ? 'photo matches' : 'photos match'}. Nothing has changed.`;
    } catch (error_) {
      previewAssets = [];
      previewTotal = null;
      previewHasMore = false;
      previewFingerprint = '';
      error = `${asErrorMessage(error_)} Nothing has changed.`;
      progress = '';
    } finally {
      previewing = false;
    }
  };

  const collectAssets = async (
    query: MetadataSearchDto,
    expectedTotal?: number,
    progressLabel = 'Taking a stable snapshot',
    acceptedSourceIds?: Set<string>,
    sampleTarget?: AssetResponseDto[],
  ) => {
    const collected: AssetResponseDto[] = [];
    const seen = new SvelteSet<string>();
    let page = 1;
    while (true) {
      progress = expectedTotal
        ? `${progressLabel}… ${Math.min(collected.length, expectedTotal).toLocaleString()} of ${expectedTotal.toLocaleString()}`
        : `${progressLabel}… ${collected.length.toLocaleString()}`;
      const result = await searchAssets({
        metadataSearchDto: { ...query, page, size: BULK_PHOTO_SORTER_PAGE_SIZE },
      });
      const bindings = await getCimmichVisibleMapAssetBindings(result.assets.items.map(({ id }) => id));
      const matchingItems = result.assets.items.filter((asset) => {
        if (!bindings.has(asset.id) || (acceptedSourceIds && !acceptedSourceIds.has(asset.id))) {
          return false;
        }
        if (seen.has(asset.id)) {
          return false;
        }
        seen.add(asset.id);
        return true;
      });
      if (sampleTarget && sampleTarget.length < BULK_PHOTO_SORTER_PREVIEW_SIZE) {
        sampleTarget.push(...matchingItems.slice(0, BULK_PHOTO_SORTER_PREVIEW_SIZE - sampleTarget.length));
      }
      collected.push(
        ...matchingItems.map(
          (asset) =>
            ({
              id: asset.id,
              isFavorite: asset.isFavorite,
              tags: asset.tags,
              visibility: asset.visibility,
            }) as AssetResponseDto,
        ),
      );
      if (!result.assets.nextPage) {
        return collected;
      }
      const nextPage = Number(result.assets.nextPage);
      page = Number.isFinite(nextPage) && nextPage > page ? nextPage : page + 1;
    }
  };

  const updateProgress = (completed: number, total: number) => {
    progress = `Applying ${bulkPhotoSorterActionLabel(action)}… ${completed.toLocaleString()} of ${total.toLocaleString()}`;
  };

  const mappedCimmichAssets = async (assets: AssetResponseDto[]) => {
    progress = 'Resolving photos in Cimmich…';
    const bindings = await getCimmichVisibleMapAssetBindings(assets.map(({ id }) => id));
    return bulkPhotoSorterMappedIds(assets, bindings);
  };

  const applyVisibilityAction = async (
    assets: AssetResponseDto[],
    undoReceipt: BulkPhotoSorterUndoReceipt,
    persistUndo: () => void,
  ) => {
    const mappedIds = await mappedCimmichAssets(assets);
    const tier = action.replace('visibility-', '') as CimmichVisibilityTier;
    const decisionIds: string[] = [];
    let applied = 0;
    for (const batch of chunkBulkPhotoSorterItems(mappedIds)) {
      const result = await setCimmichVisibilityObjects(
        batch.map((objectId) => ({ objectId, objectScope: 'asset', visibilityTier: tier })),
        createCimmichVisibilityCommandId(`organise-${tier}`),
      );
      if (result.decisionId) {
        decisionIds.push(result.decisionId);
        undoReceipt.visibilityDecisionIds.push(result.decisionId);
        undoReceipt.assetIds.push(...batch);
        persistUndo();
      }
      applied += batch.length;
      updateProgress(applied, mappedIds.length);
    }
    cimmichVisibilityManager.notify();
    return { applied, assetIds: mappedIds, decisionIds };
  };

  const applyContextAction = async (
    assets: AssetResponseDto[],
    undoReceipt: BulkPhotoSorterUndoReceipt,
    persistUndo: () => void,
  ) => {
    const mappedIds = await mappedCimmichAssets(assets);
    const family = action === 'place-attach' ? 'places' : 'events';
    const associationKind = action === 'place-attach' ? 'captured_at' : 'direct';
    const decisionIds: string[] = [];
    let applied = 0;
    for (const batch of chunkBulkPhotoSorterItems(mappedIds)) {
      const result = await attachCimmichContextAssets(
        family,
        targetId,
        createCimmichContextCommandId(`organise-${family}`),
        batch.map((assetId) => ({ assetId, associationKind })),
      );
      const changedIds = result.changedAssetIds ?? (result.status === 'applied' ? batch : []);
      if (changedIds.length > 0 && result.decisionId && result.undo?.eligible) {
        decisionIds.push(result.decisionId);
        undoReceipt.contextDecisionIds.push(result.decisionId);
        undoReceipt.assetIds.push(...changedIds);
        persistUndo();
      }
      applied += changedIds.length;
      updateProgress(Math.min(applied, mappedIds.length), mappedIds.length);
    }
    return { applied, assetIds: undoReceipt.assetIds, decisionIds };
  };

  const applyLabelAction = async (
    assets: AssetResponseDto[],
    undoReceipt: BulkPhotoSorterUndoReceipt,
    persistUndo: () => void,
  ) => {
    const mappedIds = await mappedCimmichAssets(assets);
    const membershipAction = ['label-remove', 'tag-remove', 'unarchive', 'unfavorite'].includes(action)
      ? 'detach'
      : 'attach';
    const organizationTargetId =
      action === 'archive' || action === 'unarchive'
        ? organizationStates.archive?.labelId
        : action === 'favorite' || action === 'unfavorite'
          ? organizationStates.favorite?.labelId
          : targetId;
    if (!organizationTargetId) {
      throw new Error('Cimmich organisation state is not ready');
    }
    let applied = 0;
    for (const batch of chunkBulkPhotoSorterItems(mappedIds)) {
      const result = await changeCimmichAssetLabelMembership(
        organizationTargetId,
        membershipAction,
        batch,
        createCimmichAssetLabelCommandId(`organise-${membershipAction}`),
      );
      if (result.changedAssetIds.length > 0) {
        undoReceipt.assetIds.push(...result.changedAssetIds);
        undoReceipt.labelDecisions.push({
          assetIds: [...result.changedAssetIds],
          decisionId: result.decisionId,
        });
        persistUndo();
      }
      applied += result.changedAssetIds.length;
      updateProgress(applied, mappedIds.length);
    }
    return { applied, assetIds: undoReceipt.assetIds };
  };

  const apply = async () => {
    if (!canApply || previewTotal === null) {
      return;
    }
    const label = `${bulkPhotoSorterActionLabel(action)}${targetLabel ? ` · ${targetLabel}` : ''}`;
    busy = true;
    error = '';
    let partialUndo: BulkPhotoSorterUndoReceipt | null = null;
    let operationId = '';
    let selectedCount = previewTotal;
    try {
      const fingerprint = filterFingerprint;
      const snapshotCimmichSourceIds = await loadCimmichFilterSourceIds();
      const snapshot = await collectAssets(
        buildBulkPhotoSorterSearch(filters),
        previewHasMore ? undefined : previewTotal,
        'Taking a stable snapshot',
        snapshotCimmichSourceIds,
      );
      selectedCount = snapshot.length;
      const verificationCimmichSourceIds = await loadCimmichFilterSourceIds();
      const verifiedSnapshot = await collectAssets(
        buildBulkPhotoSorterSearch(filters),
        snapshot.length,
        'Verifying the stable snapshot',
        verificationCimmichSourceIds,
      );
      const sameCimmichSources =
        !snapshotCimmichSourceIds ||
        !verificationCimmichSourceIds ||
        bulkPhotoSorterSameSnapshot([...snapshotCimmichSourceIds], [...verificationCimmichSourceIds]);
      if (
        fingerprint !== filterFingerprint ||
        (!previewHasMore && snapshot.length !== previewTotal) ||
        !sameCimmichSources ||
        !bulkPhotoSorterSameSnapshot(
          snapshot.map(({ id }) => id),
          verifiedSnapshot.map(({ id }) => id),
        )
      ) {
        previewFingerprint = '';
        throw new Error('The matching set changed between two exact reads. Preview it again before applying anything.');
      }

      const confirmed = globalThis.confirm(
        `${label} for ${snapshot.length.toLocaleString()} ${snapshot.length === 1 ? 'photo' : 'photos'}?\n\nThe exact set is ready. Source files will not be moved or deleted.`,
      );
      if (!confirmed) {
        progress = 'The exact set was reviewed and cancelled. Nothing has changed.';
        return;
      }

      partialUndo = {
        action,
        assetIds: [],
        assetCorrectionDecisionIds: [],
        contextDecisionIds: [],
        labelDecisions: [],
        label,
        targetId,
        visibilityDecisionIds: [],
      };
      operationId = createBulkPhotoSorterOperationId();
      const persistPartialUndo = () => {
        if (!partialUndo || partialUndo.assetIds.length === 0) {
          return;
        }
        storeReceipt({
          applied: partialUndo.assetIds.length,
          completedAt: new Date().toISOString(),
          label,
          operationId,
          partial: true,
          selected: snapshot.length,
          skipped: Math.max(0, snapshot.length - partialUndo.assetIds.length),
          undo: {
            ...partialUndo,
            assetIds: [...partialUndo.assetIds],
            assetCorrectionDecisionIds: [...partialUndo.assetCorrectionDecisionIds],
            contextDecisionIds: [...partialUndo.contextDecisionIds],
            labelDecisions: partialUndo.labelDecisions.map((item) => ({
              assetIds: [...item.assetIds],
              decisionId: item.decisionId,
            })),
            visibilityDecisionIds: [...partialUndo.visibilityDecisionIds],
          },
          version: 2,
        });
      };

      const createReceipt = (result: {
        applied: number;
        undo: BulkPhotoSorterUndoReceipt | null;
      }): BulkPhotoSorterOperationReceipt => ({
        applied: result.applied,
        completedAt: new Date().toISOString(),
        label,
        operationId,
        partial: false,
        selected: snapshot.length,
        skipped: snapshot.length - result.applied,
        undo: result.undo,
        version: 2,
      });

      let completedReceipt: BulkPhotoSorterOperationReceipt;

      switch (action) {
        case 'album-add': {
          const result = await applyLabelAction(snapshot, partialUndo, persistPartialUndo);
          completedReceipt = createReceipt({ applied: result.applied, undo: result.applied ? partialUndo : null });
          break;
        }
        case 'visibility-personal':
        case 'visibility-private':
        case 'visibility-standard': {
          const result = await applyVisibilityAction(snapshot, partialUndo, persistPartialUndo);
          completedReceipt = createReceipt({
            applied: result.applied,
            undo: result.decisionIds.length > 0 ? partialUndo : null,
          });
          break;
        }
        case 'event-attach':
        case 'place-attach': {
          const result = await applyContextAction(snapshot, partialUndo, persistPartialUndo);
          completedReceipt = createReceipt({
            applied: result.applied,
            undo: result.decisionIds.length > 0 ? partialUndo : null,
          });
          break;
        }
        case 'label-add':
        case 'label-remove':
        case 'tag-add':
        case 'tag-remove':
        case 'favorite':
        case 'unfavorite':
        case 'archive':
        case 'unarchive': {
          const result = await applyLabelAction(snapshot, partialUndo, persistPartialUndo);
          completedReceipt = createReceipt({ applied: result.applied, undo: result.applied ? partialUndo : null });
          break;
        }
        case 'rotate-left':
        case 'rotate-right': {
          const result = await applyBulkPhotoRotation(
            snapshot.map(({ id }) => id),
            action === 'rotate-left' ? 'left' : 'right',
            (assetIds, decisionIds) => {
              partialUndo!.assetIds.push(...assetIds);
              partialUndo!.assetCorrectionDecisionIds.push(...decisionIds);
              persistPartialUndo();
            },
            updateProgress,
          );
          completedReceipt = createReceipt({ applied: result.applied, undo: result.applied ? partialUndo : null });
          break;
        }
        case 'folders-to-albums': {
          throw new Error('Use the folder manifest controls below to create collections.');
        }
        default: {
          throw new Error('That Cimmich action is not available.');
        }
      }
      storeReceipt(completedReceipt);
      progress = completedReceipt.applied
        ? `${completedReceipt.applied.toLocaleString()} ${completedReceipt.applied === 1 ? 'photo was' : 'photos were'} changed.`
        : 'Everything already matched. No changes were needed.';
      previewFingerprint = '';
    } catch (error_) {
      const hasUndoWork = Boolean(
        partialUndo &&
        (partialUndo.assetIds.length > 0 ||
          partialUndo.assetCorrectionDecisionIds.length > 0 ||
          partialUndo.contextDecisionIds.length > 0 ||
          partialUndo.labelDecisions.length > 0 ||
          partialUndo.visibilityDecisionIds.length > 0),
      );
      error = `${asErrorMessage(error_)}${hasUndoWork ? ' You can undo the completed part below.' : ' Nothing has changed.'}`;
      if (partialUndo && hasUndoWork) {
        storeReceipt({
          applied: partialUndo.assetIds.length,
          completedAt: new Date().toISOString(),
          label: partialUndo.label,
          operationId,
          partial: true,
          selected: selectedCount,
          skipped: Math.max(0, selectedCount - partialUndo.assetIds.length),
          undo: partialUndo,
          version: 2,
        });
      }
      progress = '';
    } finally {
      busy = false;
    }
  };

  const undo = async () => {
    const undoReceipt = receipt?.undo;
    if (!undoReceipt) {
      return;
    }
    const receiptBeforeUndo = receipt!;
    const remaining: BulkPhotoSorterUndoReceipt = {
      ...undoReceipt,
      assetIds: [...undoReceipt.assetIds],
      assetCorrectionDecisionIds: [...(undoReceipt.assetCorrectionDecisionIds ?? [])],
      contextDecisionIds: [...undoReceipt.contextDecisionIds],
      labelDecisions: [...(undoReceipt.labelDecisions ?? [])].map((item) => ({
        assetIds: [...item.assetIds],
        decisionId: item.decisionId,
      })),
      visibilityDecisionIds: [...undoReceipt.visibilityDecisionIds],
    };
    const persistRemaining = () =>
      storeReceipt({
        ...receiptBeforeUndo,
        undo: {
          ...remaining,
          assetIds: [...remaining.assetIds],
          assetCorrectionDecisionIds: [...remaining.assetCorrectionDecisionIds],
          contextDecisionIds: [...remaining.contextDecisionIds],
          labelDecisions: remaining.labelDecisions.map((item) => ({
            assetIds: [...item.assetIds],
            decisionId: item.decisionId,
          })),
          visibilityDecisionIds: [...remaining.visibilityDecisionIds],
        },
      });
    undoing = true;
    error = '';
    progress = `Undoing ${remaining.label}…`;
    try {
      switch (remaining.action) {
        case 'rotate-left':
        case 'rotate-right': {
          await undoBulkPhotoRotation(remaining.assetCorrectionDecisionIds, (decisionIds) => {
            remaining.assetCorrectionDecisionIds.splice(0, decisionIds.length);
            remaining.assetIds.splice(0, decisionIds.length);
            persistRemaining();
          });
          break;
        }
        case 'label-add':
        case 'label-remove':
        case 'album-add':
        case 'tag-add':
        case 'tag-remove':
        case 'favorite':
        case 'unfavorite':
        case 'archive':
        case 'unarchive': {
          while (remaining.labelDecisions.length > 0) {
            const item = remaining.labelDecisions.at(-1)!;
            await undoCimmichAssetLabelDecision(item.decisionId, createCimmichAssetLabelCommandId('organise-undo'));
            remaining.labelDecisions.pop();
            const undoneIds = new Set(item.assetIds);
            remaining.assetIds = remaining.assetIds.filter((assetId) => !undoneIds.has(assetId));
            persistRemaining();
          }
          break;
        }
        default: {
          if (remaining.action.startsWith('visibility-')) {
            while (remaining.visibilityDecisionIds.length > 0) {
              const decisionId = remaining.visibilityDecisionIds.at(-1)!;
              await undoCimmichVisibilityDecision(decisionId, createCimmichVisibilityCommandId('organise-undo'));
              remaining.visibilityDecisionIds.pop();
              persistRemaining();
            }
            cimmichVisibilityManager.notify();
          } else {
            while (remaining.contextDecisionIds.length > 0) {
              const decisionId = remaining.contextDecisionIds.at(-1)!;
              await undoCimmichContextDecision(decisionId, createCimmichContextCommandId('organise-undo'));
              remaining.contextDecisionIds.pop();
              persistRemaining();
            }
          }
        }
      }
      storeReceipt({ ...receiptBeforeUndo, undo: null });
      progress = 'The operation was undone.';
      previewFingerprint = '';
    } catch (error_) {
      error = `${asErrorMessage(error_)} The completed Undo steps were saved; resume Undo before starting another action.`;
      progress = '';
    } finally {
      undoing = false;
    }
  };

  const reset = () => {
    filters = emptyBulkPhotoSorterFilters();
    personOptionQuery = '';
    targetOptionQuery = '';
    newLabelName = '';
    previewAssets = [];
    previewTotal = null;
    previewHasMore = false;
    previewFingerprint = '';
    error = '';
    progress = '';
    void loadOptions();
  };

  const dismissReceipt = () => {
    if (
      receipt?.undo &&
      !globalThis.confirm('Keep these changes and dismiss the saved Undo receipt? This cannot be undone from Organise.')
    ) {
      return;
    }
    storeReceipt(null);
  };
</script>

<div class="mx-auto w-full max-w-[1500px] px-4 pb-24 sm:px-6 lg:px-10">
  <section class="max-w-3xl pt-8 sm:pt-12">
    <div class="mb-5 flex size-14 items-center justify-center rounded-3xl bg-primary/10 text-primary">
      <Icon icon={mdiFolderMultipleOutline} size="29" />
    </div>
    <p class="text-sm font-semibold tracking-[0.18em] text-primary uppercase">Advanced tool</p>
    <h1
      class="mt-2 text-3xl font-semibold tracking-tight text-immich-primary sm:text-4xl dark:text-immich-dark-primary"
    >
      Make one careful change across many photos
    </h1>
    <p class="mt-4 max-w-2xl text-base/7 text-immich-fg/70 dark:text-immich-dark-fg/70">
      Choose a precise set, inspect the result, then apply one reversible action. Original files stay where they are,
      and large sets run in safe batches with a saved Undo receipt.
    </p>
  </section>

  {#if optionsError}
    <div
      class="mt-6 flex max-w-4xl gap-3 rounded-2xl border border-amber-400/40 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/25 dark:text-amber-100"
    >
      <Icon icon={mdiAlertCircleOutline} size="20" />
      <p>{optionsError}</p>
    </div>
  {/if}

  <section
    class="mt-8 rounded-3xl border border-black/10 bg-white p-5 shadow-sm sm:p-7 dark:border-white/10 dark:bg-immich-dark-gray"
  >
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div class="flex items-center gap-2 text-immich-primary dark:text-immich-dark-primary">
          <Icon icon={mdiFilterOutline} size="22" />
          <h2 class="text-xl font-semibold">1. Choose photos</h2>
        </div>
        <p class="mt-2 text-sm text-immich-fg/65 dark:text-immich-dark-fg/65">
          Filters combine together. Immich source filters are read-only. Leave them empty only if you really intend to
          target the whole library.
        </p>
      </div>
      <button
        class="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/10"
        type="button"
        onclick={reset}
        disabled={busy || previewing}
      >
        <Icon icon={mdiRefresh} size="18" /> Reset
      </button>
    </div>

    <div class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <label class="grid gap-1.5 text-sm font-medium"
        >Folder or path contains
        <input
          class="rounded-xl border border-black/15 bg-transparent px-3 py-2.5 dark:border-white/15"
          bind:value={filters.folder}
          placeholder="/Photos/Trips/Croatia"
        />
      </label>
      <div class="grid gap-1.5 text-sm font-medium">
        <span>Cimmich person</span>
        <div class="flex gap-2">
          <input
            class="min-w-0 flex-1 rounded-xl border border-black/15 bg-transparent px-3 py-2.5 dark:border-white/15"
            bind:value={personOptionQuery}
            placeholder="Search all people"
          />
          <button
            class="rounded-xl border border-black/15 px-3 py-2 text-xs font-semibold hover:bg-black/5 disabled:opacity-50 dark:border-white/15 dark:hover:bg-white/5"
            type="button"
            onclick={searchPeopleOptions}
            disabled={optionSearching}>Search</button
          >
        </div>
        <select
          class="rounded-xl border border-black/15 bg-transparent px-3 py-2.5 dark:border-white/15"
          bind:value={filters.personId}
          disabled={optionsLoading || optionSearching}
          aria-label="Cimmich person"
        >
          <option value="">Any Cimmich person</option>
          {#each people as person (person.person_id)}<option value={person.person_id}>{person.display_name}</option
            >{/each}
        </select>
      </div>
      <label class="grid gap-1.5 text-sm font-medium"
        >Immich source tag
        <select
          class="rounded-xl border border-black/15 bg-transparent px-3 py-2.5 dark:border-white/15"
          bind:value={filters.tagId}
          disabled={optionsLoading}
        >
          <option value="">Any tag</option>
          {#each tags as tag (tag.id)}<option value={tag.id}>{tag.name}</option>{/each}
        </select>
      </label>
      <label class="grid gap-1.5 text-sm font-medium"
        >Immich source album
        <select
          class="rounded-xl border border-black/15 bg-transparent px-3 py-2.5 dark:border-white/15"
          bind:value={filters.albumId}
          disabled={optionsLoading}
        >
          <option value="">Any album</option>
          {#each albums as album (album.id)}<option value={album.id}>{album.albumName}</option>{/each}
        </select>
      </label>
      <label class="grid gap-1.5 text-sm font-medium"
        >Cimmich collection
        <select
          class="rounded-xl border border-black/15 bg-transparent px-3 py-2.5 dark:border-white/15"
          bind:value={filters.cimmichCollectionId}
          disabled={optionsLoading}
          title="Find photos already placed in a Cimmich-owned collection. Immich albums are not changed."
        >
          <option value="">Any collection</option>
          {#each collections as collection (collection.labelId)}<option value={collection.labelId}
              >{collection.displayName}</option
            >{/each}
        </select>
      </label>
      <label class="grid gap-1.5 text-sm font-medium"
        >Cimmich tag
        <select
          class="rounded-xl border border-black/15 bg-transparent px-3 py-2.5 dark:border-white/15"
          bind:value={filters.cimmichLabelId}
          disabled={optionsLoading}
          title="Find photos carrying this Cimmich-owned tag. Immich tags are not changed."
        >
          <option value="">Any Cimmich tag</option>
          {#each labels as label (label.labelId)}<option value={label.labelId}>{label.displayName}</option>{/each}
        </select>
      </label>
      <label class="grid gap-1.5 text-sm font-medium"
        >Cimmich library state
        <select
          class="rounded-xl border border-black/15 bg-transparent px-3 py-2.5 dark:border-white/15"
          bind:value={filters.cimmichState}
          disabled={optionsLoading}
          title="Find photos marked as a favourite or archived inside Cimmich. Immich state is not changed."
        >
          <option value="any">Any Cimmich state</option><option value="favorite">Favourite</option><option
            value="archive">Archived</option
          >
        </select>
      </label>
      <label class="grid gap-1.5 text-sm font-medium"
        >Taken from
        <input
          class="rounded-xl border border-black/15 bg-transparent px-3 py-2.5 dark:border-white/15"
          type="date"
          bind:value={filters.takenAfter}
        />
      </label>
      <label class="grid gap-1.5 text-sm font-medium"
        >Taken through
        <input
          class="rounded-xl border border-black/15 bg-transparent px-3 py-2.5 dark:border-white/15"
          type="date"
          bind:value={filters.takenBefore}
        />
      </label>
      <label class="grid gap-1.5 text-sm font-medium"
        >Media
        <select
          class="rounded-xl border border-black/15 bg-transparent px-3 py-2.5 dark:border-white/15"
          bind:value={filters.mediaType}
        >
          <option value="all">Photos and videos</option><option value="image">Photos only</option><option value="video"
            >Videos only</option
          >
        </select>
      </label>
      <label class="grid gap-1.5 text-sm font-medium"
        >Immich source favourite
        <select
          class="rounded-xl border border-black/15 bg-transparent px-3 py-2.5 dark:border-white/15"
          bind:value={filters.favorite}
        >
          <option value="any">Either</option><option value="yes">Favourite</option><option value="no"
            >Not favourite</option
          >
        </select>
      </label>
      <label class="grid gap-1.5 text-sm font-medium"
        >Immich source state
        <select
          class="rounded-xl border border-black/15 bg-transparent px-3 py-2.5 dark:border-white/15"
          bind:value={filters.visibility}
        >
          <option value="all">Any state</option><option value="timeline">Timeline</option><option value="archive"
            >Archive</option
          ><option value="locked">Locked</option>
        </select>
      </label>
    </div>
    <label class="mt-5 flex items-center gap-3 text-sm font-medium"
      ><input class="size-4 accent-primary" type="checkbox" bind:checked={filters.notInAlbum} /> Only photos not in any Immich
      source album</label
    >
    <div class="mt-6 flex flex-wrap items-center gap-3">
      <button
        class="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        type="button"
        onclick={preview}
        disabled={busy || previewing}
      >
        <Icon icon={mdiImageMultipleOutline} size="19" />
        {previewing ? 'Finding photos…' : 'Preview matches'}
      </button>
      {#if previewTotal !== null && !previewIsCurrent}<span
          class="text-sm font-medium text-amber-700 dark:text-amber-300"
          >Filters changed. Preview again before applying.</span
        >{/if}
    </div>
  </section>

  {#if previewTotal !== null}
    <CimmichBulkPhotoPreview
      assets={previewAssets}
      current={previewIsCurrent}
      hasMore={previewHasMore}
      total={previewTotal}
    />
  {/if}

  <CimmichBulkPhotoActionPanel
    bind:action
    bind:newLabelName
    bind:targetId
    bind:targetOptionQuery
    {busy}
    {canApply}
    {creatingLabel}
    hasUndo={Boolean(receipt?.undo)}
    {needsTarget}
    onapply={apply}
    oncreateLabel={createLabel}
    onsearchContext={searchContextOptions}
    {optionsLoading}
    {optionSearching}
    rootPath={filters.folder}
    {targetOptions}
    {undoing}
  />

  <CimmichBulkPhotoStatus {busy} {error} ondismiss={dismissReceipt} onundo={undo} {progress} {receipt} {undoing} />
</div>
