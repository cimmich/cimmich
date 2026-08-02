<script lang="ts">
  import { cimmichVisibilityManager } from '$lib/managers/cimmich-visibility-manager.svelte';
  import {
    attachCimmichContextAssets,
    createCimmichContextCommandId,
    createCimmichVisibilityCommandId,
    getCimmichContextEntities,
    getCimmichPeople,
    getCimmichPersonAssetsPage,
    getCimmichVisibleMapAssetBindings,
    setCimmichVisibilityObjects,
    undoCimmichContextDecision,
    undoCimmichVisibilityDecision,
    type CimmichContextEntity,
    type CimmichPerson,
    type CimmichVisibilityTier,
  } from '$lib/services/cimmich.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import {
    addAssetsToAlbum,
    AssetMediaSize,
    AssetVisibility,
    bulkTagAssets,
    getAllAlbums,
    getAllTags,
    removeAssetFromAlbum,
    searchAssets,
    untagAssets,
    updateAssets,
    type AlbumResponseDto,
    type AssetResponseDto,
    type MetadataSearchDto,
    type TagResponseDto,
  } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import {
    mdiAlertCircleOutline,
    mdiCheckCircleOutline,
    mdiFilterOutline,
    mdiFolderMultipleOutline,
    mdiImageMultipleOutline,
    mdiPlayCircleOutline,
    mdiRefresh,
    mdiUndoVariant,
  } from '@mdi/js';
  import { SvelteSet } from 'svelte/reactivity';
  import {
    BULK_PHOTO_SORTER_BATCH_SIZE,
    BULK_PHOTO_SORTER_PAGE_SIZE,
    BULK_PHOTO_SORTER_PREVIEW_SIZE,
    buildBulkPhotoSorterSearch,
    bulkPhotoSorterActionLabel,
    bulkPhotoSorterActionNeedsTarget,
    bulkPhotoSorterChangedAssets,
    bulkPhotoSorterFilterFingerprint,
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

  let filters = $state(emptyBulkPhotoSorterFilters());
  let action = $state<BulkPhotoSorterActionKind>('tag-add');
  let targetId = $state('');
  let albums = $state<AlbumResponseDto[]>([]);
  let people = $state<CimmichPerson[]>([]);
  let tags = $state<TagResponseDto[]>([]);
  let places = $state<CimmichContextEntity[]>([]);
  let events = $state<CimmichContextEntity[]>([]);
  let optionsLoading = $state(true);
  let optionSearching = $state(false);
  let optionsError = $state('');
  let personOptionQuery = $state('');
  let targetOptionQuery = $state('');
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
  let receiptStorageLoaded = false;

  const filterFingerprint = $derived(bulkPhotoSorterFilterFingerprint(filters));
  const previewIsCurrent = $derived(previewTotal !== null && previewFingerprint === filterFingerprint);
  const needsTarget = $derived(bulkPhotoSorterActionNeedsTarget(action));
  const canApply = $derived(
    previewIsCurrent && previewTotal !== null && previewTotal > 0 && (!needsTarget || targetId) && !receipt?.undo,
  );
  const targetOptions = $derived(
    action === 'album-add'
      ? albums.map(({ id, albumName }) => ({ id, label: albumName }))
      : action === 'tag-add' || action === 'tag-remove'
        ? tags.map(({ id, name }) => ({ id, label: name }))
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
    receipt = next;
    saveBulkPhotoSorterReceipt(globalThis.localStorage, next);
  };

  $effect(() => {
    if (!receiptStorageLoaded) {
      receiptStorageLoaded = true;
      receipt = loadBulkPhotoSorterReceipt(globalThis.localStorage);
    }
  });

  const loadOptions = async () => {
    optionsLoading = true;
    optionsError = '';
    try {
      const [albumItems, peopleResult, tagItems, placeItems, eventItems] = await Promise.all([
        getAllAlbums({ isOwned: true }),
        getCimmichPeople(500, '', { presentation: false }),
        getAllTags(),
        getCimmichContextEntities('places', { limit: 500 }),
        getCimmichContextEntities('events', { limit: 500 }),
      ]);
      albums = [...albumItems].sort((left, right) => left.albumName.localeCompare(right.albumName));
      people = peopleResult
        .filter((person) => person.subject_kind === 'person' && person.status === 'active')
        .sort((left, right) => left.display_name.localeCompare(right.display_name));
      tags = [...tagItems].sort((left, right) => left.name.localeCompare(right.name));
      places = [...placeItems].sort((left, right) => left.displayName.localeCompare(right.displayName));
      events = [...eventItems].sort((left, right) => left.displayName.localeCompare(right.displayName));
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

  $effect(() => {
    void loadOptions();
  });

  const loadCimmichPersonSourceIds = async (personId: string) => {
    const sourceIds = new SvelteSet<string>();
    let cursor: string | undefined;
    do {
      progress = `Loading Cimmich appearances… ${sourceIds.size.toLocaleString()}`;
      const page = await getCimmichPersonAssetsPage(personId, 250, cursor);
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
      if (filters.personId) {
        const personSourceIds = await loadCimmichPersonSourceIds(filters.personId);
        const samples: AssetResponseDto[] = [];
        const matches = await collectAssets(
          buildBulkPhotoSorterSearch(filters),
          undefined,
          'Finding exact Cimmich person matches',
          personSourceIds,
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
        return;
      }
      const result = await searchAssets({
        metadataSearchDto: buildBulkPhotoSorterSearch(filters, 1, BULK_PHOTO_SORTER_PREVIEW_SIZE),
      });
      if (fingerprint !== filterFingerprint) {
        return;
      }
      previewAssets = result.assets.items;
      previewTotal = result.assets.items.length;
      previewHasMore = Boolean(result.assets.nextPage);
      previewFingerprint = fingerprint;
      progress = `${result.assets.items.length.toLocaleString()}${result.assets.nextPage ? '+' : ''} ${result.assets.items.length === 1 && !result.assets.nextPage ? 'photo matches' : 'photos match'}. Nothing has changed.`;
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
      const matchingItems = (
        acceptedSourceIds ? result.assets.items.filter((asset) => acceptedSourceIds.has(asset.id)) : result.assets.items
      ).filter((asset) => {
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

  const applyNativeAction = async (
    assets: AssetResponseDto[],
    undoReceipt: BulkPhotoSorterUndoReceipt,
    persistUndo: () => void,
  ) => {
    const changed = bulkPhotoSorterChangedAssets(assets, action, targetId);
    let applied = 0;
    for (const batch of chunkBulkPhotoSorterItems(changed)) {
      const ids = batch.map(({ id }) => id);
      switch (action) {
        case 'favorite':
        case 'unfavorite': {
          await updateAssets({ assetBulkUpdateDto: { ids, isFavorite: action === 'favorite' } });

          break;
        }
        case 'archive':
        case 'unarchive': {
          await updateAssets({
            assetBulkUpdateDto: {
              ids,
              visibility: action === 'archive' ? AssetVisibility.Archive : AssetVisibility.Timeline,
            },
          });

          break;
        }
        case 'tag-add': {
          await bulkTagAssets({ tagBulkAssetsDto: { assetIds: ids, tagIds: [targetId] } });

          break;
        }
        case 'tag-remove': {
          await untagAssets({ id: targetId, bulkIdsDto: { ids } });

          break;
        }
        // No default
      }
      undoReceipt.assetIds.push(...ids);
      persistUndo();
      applied += ids.length;
      updateProgress(applied, changed.length);
    }
    return { applied, assetIds: changed.map(({ id }) => id) };
  };

  const applyAlbumAction = async (
    assets: AssetResponseDto[],
    undoReceipt: BulkPhotoSorterUndoReceipt,
    persistUndo: () => void,
  ) => {
    const targetAssets = await collectAssets(
      buildBulkPhotoSorterSearch({ ...emptyBulkPhotoSorterFilters(), albumId: targetId }),
      undefined,
      'Checking existing album membership',
    );
    const existing = new Set(targetAssets.map(({ id }) => id));
    const assetIds = assets.map(({ id }) => id).filter((id) => !existing.has(id));
    let applied = 0;
    for (const batch of chunkBulkPhotoSorterItems(assetIds)) {
      const results = await addAssetsToAlbum({ id: targetId, bulkIdsDto: { ids: batch } });
      const changedIds = results.filter(({ success }) => success).map(({ id }) => id);
      undoReceipt.assetIds.push(...changedIds);
      persistUndo();
      applied += changedIds.length;
      updateProgress(applied, assetIds.length);
    }
    return { applied, assetIds: undoReceipt.assetIds };
  };

  const mappedCimmichAssets = async (assets: AssetResponseDto[]) => {
    progress = 'Resolving photos in Cimmich…';
    const bindings = await getCimmichVisibleMapAssetBindings(assets.map(({ id }) => id));
    return assets.flatMap(({ id }) => {
      const assetId = bindings.get(id);
      return assetId ? [assetId] : [];
    });
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
      const snapshotPersonSourceIds = filters.personId ? await loadCimmichPersonSourceIds(filters.personId) : undefined;
      const snapshot = await collectAssets(
        buildBulkPhotoSorterSearch(filters),
        previewHasMore ? undefined : previewTotal,
        'Taking a stable snapshot',
        snapshotPersonSourceIds,
      );
      selectedCount = snapshot.length;
      const verificationPersonSourceIds = filters.personId
        ? await loadCimmichPersonSourceIds(filters.personId)
        : undefined;
      const verifiedSnapshot = await collectAssets(
        buildBulkPhotoSorterSearch(filters),
        snapshot.length,
        'Verifying the stable snapshot',
        verificationPersonSourceIds,
      );
      const samePersonSources =
        !snapshotPersonSourceIds ||
        !verificationPersonSourceIds ||
        bulkPhotoSorterSameSnapshot([...snapshotPersonSourceIds], [...verificationPersonSourceIds]);
      if (
        fingerprint !== filterFingerprint ||
        (!previewHasMore && snapshot.length !== previewTotal) ||
        !samePersonSources ||
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
        contextDecisionIds: [],
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
            contextDecisionIds: [...partialUndo.contextDecisionIds],
            visibilityDecisionIds: [...partialUndo.visibilityDecisionIds],
          },
          version: 1,
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
        version: 1,
      });

      let completedReceipt: BulkPhotoSorterOperationReceipt;

      if (action === 'album-add') {
        const result = await applyAlbumAction(snapshot, partialUndo, persistPartialUndo);
        completedReceipt = createReceipt({ applied: result.applied, undo: result.applied ? partialUndo : null });
      } else if (action.startsWith('visibility-')) {
        const result = await applyVisibilityAction(snapshot, partialUndo, persistPartialUndo);
        completedReceipt = createReceipt({
          applied: result.applied,
          undo: result.decisionIds.length > 0 ? partialUndo : null,
        });
      } else if (action === 'place-attach' || action === 'event-attach') {
        const result = await applyContextAction(snapshot, partialUndo, persistPartialUndo);
        completedReceipt = createReceipt({
          applied: result.applied,
          undo: result.decisionIds.length > 0 ? partialUndo : null,
        });
      } else {
        const result = await applyNativeAction(snapshot, partialUndo, persistPartialUndo);
        completedReceipt = createReceipt({ applied: result.applied, undo: result.applied ? partialUndo : null });
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
          partialUndo.contextDecisionIds.length > 0 ||
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
          version: 1,
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
      contextDecisionIds: [...undoReceipt.contextDecisionIds],
      visibilityDecisionIds: [...undoReceipt.visibilityDecisionIds],
    };
    const persistRemaining = () =>
      storeReceipt({
        ...receiptBeforeUndo,
        undo: {
          ...remaining,
          assetIds: [...remaining.assetIds],
          contextDecisionIds: [...remaining.contextDecisionIds],
          visibilityDecisionIds: [...remaining.visibilityDecisionIds],
        },
      });
    const undoAssetBatches = async (applyBatch: (batch: string[]) => Promise<unknown>) => {
      while (remaining.assetIds.length > 0) {
        const batch = remaining.assetIds.slice(0, BULK_PHOTO_SORTER_BATCH_SIZE);
        await applyBatch(batch);
        remaining.assetIds.splice(0, batch.length);
        persistRemaining();
        progress = `Undoing ${remaining.label}… ${remaining.assetIds.length.toLocaleString()} remaining`;
      }
    };
    undoing = true;
    error = '';
    progress = `Undoing ${remaining.label}…`;
    try {
      switch (remaining.action) {
        case 'album-add': {
          await undoAssetBatches(async (batch) => {
            const results = await removeAssetFromAlbum({ id: remaining.targetId, bulkIdsDto: { ids: batch } });
            const succeeded = new Set(results.filter(({ success }) => success).map(({ id }) => id));
            if (succeeded.size !== batch.length) {
              remaining.assetIds = [
                ...batch.filter((id) => !succeeded.has(id)),
                ...remaining.assetIds.slice(batch.length),
              ];
              persistRemaining();
              throw new Error('Some album memberships could not be removed');
            }
          });

          break;
        }
        case 'favorite':
        case 'unfavorite': {
          await undoAssetBatches(async (batch) => {
            await updateAssets({
              assetBulkUpdateDto: { ids: batch, isFavorite: remaining.action === 'unfavorite' },
            });
          });

          break;
        }
        case 'archive':
        case 'unarchive': {
          await undoAssetBatches(async (batch) => {
            await updateAssets({
              assetBulkUpdateDto: {
                ids: batch,
                visibility: remaining.action === 'archive' ? AssetVisibility.Timeline : AssetVisibility.Archive,
              },
            });
          });

          break;
        }
        case 'tag-add': {
          await undoAssetBatches((batch) => untagAssets({ id: remaining.targetId, bulkIdsDto: { ids: batch } }));

          break;
        }
        case 'tag-remove': {
          await undoAssetBatches((batch) =>
            bulkTagAssets({ tagBulkAssetsDto: { assetIds: batch, tagIds: [remaining.targetId] } }),
          );

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
    previewAssets = [];
    previewTotal = null;
    previewHasMore = false;
    previewFingerprint = '';
    error = '';
    progress = '';
    void loadOptions();
  };

  const selectAction = (event: Event) => {
    action = (event.currentTarget as HTMLSelectElement).value as BulkPhotoSorterActionKind;
    targetId = '';
    targetOptionQuery = '';
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

  const previewUrl = (asset: AssetResponseDto) =>
    getAssetMediaUrl({ id: asset.id, size: AssetMediaSize.Thumbnail, cacheKey: asset.thumbhash });
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
          Filters combine together. Leave them empty only if you really intend to target the whole library.
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
        >Tag
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
        >Album
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
        >Favourite
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
        >Library state
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
      ><input class="size-4 accent-primary" type="checkbox" bind:checked={filters.notInAlbum} /> Only photos not in any album</label
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
    <section
      class="mt-6 rounded-3xl border border-black/10 bg-white p-5 shadow-sm sm:p-7 dark:border-white/10 dark:bg-immich-dark-gray"
    >
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 class="text-xl font-semibold text-immich-primary dark:text-immich-dark-primary">
            2. Inspect the preview
          </h2>
          <p class="mt-2 text-sm text-immich-fg/65 dark:text-immich-dark-fg/65">
            Showing {previewAssets.length.toLocaleString()} of
            <strong>{previewTotal.toLocaleString()}{previewHasMore ? '+' : ''}</strong> matching items. The exact total is
            calculated before final confirmation.
          </p>
        </div>
        {#if previewIsCurrent}<span
            class="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-300"
            ><Icon icon={mdiCheckCircleOutline} size="18" /> Preview current</span
          >{/if}
      </div>
      {#if previewAssets.length}
        <div class="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
          {#each previewAssets as asset (asset.id)}
            <article class="min-w-0 overflow-hidden rounded-2xl bg-black/5 dark:bg-white/5">
              <img
                class="aspect-square w-full object-cover"
                src={previewUrl(asset)}
                alt={asset.originalFileName}
                loading="lazy"
              />
              <div class="p-2">
                <p class="truncate text-xs font-semibold" title={asset.originalFileName}>{asset.originalFileName}</p>
                <p class="mt-1 truncate text-[11px] opacity-60" title={asset.originalPath}>
                  {asset.fileCreatedAt.slice(0, 10)}
                </p>
              </div>
            </article>
          {/each}
        </div>
      {:else}<div class="mt-5 rounded-2xl bg-black/5 px-4 py-8 text-center text-sm opacity-70 dark:bg-white/5">
          No photos match these filters.
        </div>{/if}
    </section>
  {/if}

  <section
    class="mt-6 rounded-3xl border border-black/10 bg-white p-5 shadow-sm sm:p-7 dark:border-white/10 dark:bg-immich-dark-gray"
  >
    <h2 class="text-xl font-semibold text-immich-primary dark:text-immich-dark-primary">3. Choose one action</h2>
    <p class="mt-2 text-sm text-immich-fg/65 dark:text-immich-dark-fg/65">
      One action per run keeps the receipt and Undo exact.
    </p>
    {#if receipt?.undo}<p
        class="mt-4 rounded-2xl border border-amber-400/35 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 dark:bg-amber-950/25 dark:text-amber-100"
      >
        A saved Undo receipt is still active. Undo it or keep those changes before applying another action.
      </p>{/if}
    <div class="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
      <label class="grid gap-1.5 text-sm font-medium"
        >Action
        <select
          class="rounded-xl border border-black/15 bg-transparent px-3 py-2.5 dark:border-white/15"
          value={action}
          onchange={selectAction}
        >
          <optgroup label="Tags and albums"
            ><option value="tag-add">Add tag</option><option value="tag-remove">Remove tag</option><option
              value="album-add">Add to album</option
            ></optgroup
          >
          <optgroup label="Immich library"
            ><option value="favorite">Favourite</option><option value="unfavorite">Remove favourite</option><option
              value="archive">Archive</option
            ><option value="unarchive">Unarchive</option></optgroup
          >
          <optgroup label="Cimmich privacy"
            ><option value="visibility-standard">Set visibility to Standard</option><option value="visibility-personal"
              >Set visibility to Personal</option
            ><option value="visibility-private">Set visibility to Private</option></optgroup
          >
          <optgroup label="Cimmich context"
            ><option value="place-attach">Attach to Place</option><option value="event-attach">Attach to Event</option
            ></optgroup
          >
        </select>
      </label>
      {#if needsTarget}
        <div class="grid gap-1.5 text-sm font-medium">
          <span>Destination</span>
          {#if action === 'place-attach' || action === 'event-attach'}<div class="flex gap-2">
              <input
                class="min-w-0 flex-1 rounded-xl border border-black/15 bg-transparent px-3 py-2.5 dark:border-white/15"
                bind:value={targetOptionQuery}
                placeholder={`Search all ${action === 'place-attach' ? 'places' : 'events'}`}
              />
              <button
                class="rounded-xl border border-black/15 px-3 py-2 text-xs font-semibold hover:bg-black/5 disabled:opacity-50 dark:border-white/15 dark:hover:bg-white/5"
                type="button"
                onclick={searchContextOptions}
                disabled={optionSearching}>Search</button
              >
            </div>{/if}
          <select
            class="rounded-xl border border-black/15 bg-transparent px-3 py-2.5 dark:border-white/15"
            bind:value={targetId}
            disabled={optionsLoading || optionSearching}
            aria-label="Destination"
          >
            <option value="">Choose…</option>{#each targetOptions as option (option.id)}<option value={option.id}
                >{option.label}</option
              >{/each}
          </select>
        </div>
      {:else}<div class="hidden sm:block"></div>{/if}
      <button
        class="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        type="button"
        onclick={apply}
        disabled={!canApply || busy || undoing}
      >
        <Icon icon={mdiPlayCircleOutline} size="19" />
        {busy ? 'Applying…' : 'Review and apply'}
      </button>
    </div>
    <p class="mt-4 text-xs/5 text-immich-fg/55 dark:text-immich-dark-fg/55">
      “Add to album” organises photos without moving files on disk. Physical folder moves and automatic rules are
      deliberately not part of this first release.
    </p>
  </section>

  <div class="mt-6" aria-live="polite">
    {#if progress}<p class="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm font-medium">
        {progress}
      </p>{/if}
    {#if error}<p
        class="mt-3 flex gap-2 rounded-2xl border border-red-400/30 bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/25 dark:text-red-200"
      >
        <Icon icon={mdiAlertCircleOutline} size="20" />
        {error}
      </p>{/if}
  </div>

  {#if receipt}
    <section class="mt-6 rounded-3xl border border-emerald-500/25 bg-emerald-50/60 p-5 sm:p-7 dark:bg-emerald-950/15">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p class="text-sm font-semibold tracking-[0.14em] text-emerald-700 uppercase dark:text-emerald-300">
            {receipt.partial ? 'Partial receipt' : 'Operation receipt'}
          </p>
          <h2 class="mt-2 text-xl font-semibold">{receipt.label}</h2>
          <p class="mt-2 text-sm opacity-75">
            Selected {receipt.selected.toLocaleString()} · changed {receipt.applied.toLocaleString()} · unchanged or unavailable
            {receipt.skipped.toLocaleString()} · {new Date(receipt.completedAt).toLocaleTimeString()} · saved on this device
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          {#if receipt.undo}<button
              class="inline-flex items-center gap-2 rounded-full border border-emerald-700/30 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-500/10 disabled:opacity-50 dark:text-emerald-200"
              type="button"
              onclick={undo}
              disabled={busy || undoing}
              ><Icon icon={mdiUndoVariant} size="19" /> {undoing ? 'Undoing…' : 'Undo'}</button
            >{/if}
          <button
            class="rounded-full px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-500/10 disabled:opacity-50 dark:text-emerald-200"
            type="button"
            onclick={dismissReceipt}
            disabled={busy || undoing}>{receipt.undo ? 'Keep changes' : 'Dismiss receipt'}</button
          >
        </div>
      </div>
    </section>
  {/if}
</div>
