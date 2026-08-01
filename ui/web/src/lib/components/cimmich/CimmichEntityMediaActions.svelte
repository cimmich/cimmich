<script lang="ts">
  import {
    attachCimmichContextAssets,
    createCimmichContextCommandId,
    createCimmichManualPresenceCommandId,
    createCimmichVisibilityCommandId,
    detachCimmichContextAssets,
    getCimmichContextEntities,
    getCimmichPeople,
    getCimmichPets,
    setCimmichManualPresence,
    setCimmichVisibilityObjects,
    undoCimmichContextDecision,
    undoCimmichManualPresence,
    undoCimmichVisibilityDecision,
    type CimmichContextEntity,
    type CimmichPerson,
    type CimmichPet,
  } from '$lib/services/cimmich.service';
  import {
    addAssetsToAlbum,
    AssetVisibility,
    bulkTagAssets,
    getAllAlbums,
    getAllTags,
    getAssetInfo,
    removeAssetFromAlbum,
    untagAssets,
    updateAssets,
    type AlbumResponseDto,
    type TagResponseDto,
  } from '@immich/sdk';
  import { Icon, toastManager } from '@immich/ui';
  import {
    mdiAccountMultipleOutline,
    mdiAlertCircleOutline,
    mdiArchiveArrowDownOutline,
    mdiArchiveArrowUpOutline,
    mdiCalendarBlankOutline,
    mdiCheckCircleOutline,
    mdiHeartOutline,
    mdiImageAlbum,
    mdiImageMove,
    mdiLinkOff,
    mdiLockOutline,
    mdiMapMarkerOutline,
    mdiPackageVariantClosed,
    mdiPawOutline,
    mdiSelectAll,
    mdiTagOutline,
    mdiUndoVariant,
  } from '@mdi/js';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import Combobox, { type ComboBoxOption } from '../shared-components/Combobox.svelte';
  import {
    cimmichEntityMediaActionLabel,
    cimmichEntityMediaActionNeedsTarget,
    cimmichEntityMediaActionVisibilityTier,
    loadCimmichEntityMediaActionReceipt,
    saveCimmichEntityMediaActionReceipt,
    type CimmichEntityMediaActionKind,
    type CimmichEntityMediaActionReceipt,
    type CimmichEntityMediaItem,
    type CimmichEntityMediaPlaceTarget,
    type CimmichEntityMediaScope,
    type CimmichEntityMediaSubject,
  } from './entity-media-actions';

  interface Props {
    currentScope?: CimmichEntityMediaScope | null;
    currentSubject?: CimmichEntityMediaSubject | null;
    items: CimmichEntityMediaItem[];
    onChanged?: () => Promise<void> | void;
    onClear: () => void;
    onMoveWithinPlace?: (targetEntityId: string) => Promise<boolean>;
    onSelectShown?: () => void;
    moveWithinPlaceTargets?: CimmichEntityMediaPlaceTarget[];
    showControls?: boolean;
  }

  let {
    currentScope = null,
    currentSubject = null,
    items,
    moveWithinPlaceTargets = [],
    onChanged,
    onClear,
    onMoveWithinPlace,
    onSelectShown,
    showControls = true,
  }: Props = $props();

  type PlaceMoveAction = 'place-move-within';
  type MediaUiAction = CimmichEntityMediaActionKind | PlaceMoveAction;
  type MediaActionGroup = 'context' | 'library' | 'metadata' | 'presence' | 'privacy';

  let action = $state<MediaUiAction | null>(null);
  let actionGroup = $state<MediaActionGroup | null>(null);
  let targetId = $state('');
  let targetOption = $state<ComboBoxOption>();
  let albums = $state<AlbumResponseDto[]>([]);
  let tags = $state<TagResponseDto[]>([]);
  let people = $state<CimmichPerson[]>([]);
  let pets = $state<CimmichPet[]>([]);
  let places = $state<CimmichContextEntity[]>([]);
  let events = $state<CimmichContextEntity[]>([]);
  let objects = $state<CimmichContextEntity[]>([]);
  let loadingOptions = $state(false);
  let busy = $state(false);
  let error = $state('');
  let progress = $state('');
  let receipt = $state<CimmichEntityMediaActionReceipt | null>(null);
  let receiptLoaded = false;
  type OptionKind = 'album' | 'event' | 'object' | 'person' | 'pet' | 'place' | 'tag';
  const loadedOptionKinds = new SvelteSet<OptionKind>();
  const optionRequests = new SvelteMap<OptionKind, Promise<void>>();

  const selectedCount = $derived(items.length);
  const allDirectlyAssigned = $derived(items.length > 0 && items.every((item) => item.directlyAssigned !== false));
  const availableActions = $derived.by(() => {
    const result: MediaUiAction[] = [
      ...(currentScope?.family === 'places' &&
      allDirectlyAssigned &&
      moveWithinPlaceTargets.length > 0 &&
      onMoveWithinPlace
        ? (['place-move-within'] as const)
        : []),
      'event-attach',
      'place-attach',
      'object-attach',
      ...(currentSubject ? (['presence-current'] as const) : []),
      'presence-person',
      'presence-pet',
      'visibility-standard',
      'visibility-personal',
      'visibility-private',
      'tag-add',
      'tag-remove',
      'album-add',
      'favorite',
      'unfavorite',
      'archive',
      'unarchive',
      ...(currentScope && allDirectlyAssigned ? (['context-detach'] as const) : []),
    ];
    return result;
  });
  const needsTarget = $derived(
    action === 'place-move-within' || (action ? cimmichEntityMediaActionNeedsTarget(action) : false),
  );
  const targetOptions = $derived.by<ComboBoxOption[]>(() => {
    if (action === 'place-move-within') {
      return moveWithinPlaceTargets.map(({ depth, entityId, label, path }) => ({
        description: depth > 0 ? path : undefined,
        id: entityId,
        indent: depth,
        label,
        searchText: path,
        value: entityId,
      }));
    }
    if (action === 'event-attach') {
      return events.map(({ entityId, displayName }) => ({ id: entityId, label: displayName, value: entityId }));
    }
    if (action === 'place-attach') {
      return places.map(({ entityId, displayName }) => ({ id: entityId, label: displayName, value: entityId }));
    }
    if (action === 'object-attach') {
      return objects.map(({ entityId, displayName }) => ({ id: entityId, label: displayName, value: entityId }));
    }
    if (action === 'presence-person') {
      return people
        .filter((person) => person.subject_kind === 'person' && person.status === 'active')
        .map(({ person_id, display_name }) => ({ id: person_id, label: display_name, value: person_id }));
    }
    if (action === 'presence-pet') {
      return pets
        .filter((pet) => pet.status === 'active')
        .map(({ petId, displayName }) => ({ id: petId, label: displayName, value: petId }));
    }
    if (action === 'tag-add' || action === 'tag-remove') {
      return tags.map(({ id, name }) => ({ id, label: name, value: id }));
    }
    if (action === 'album-add') {
      return albums.map(({ id, albumName }) => ({ id, label: albumName, value: id }));
    }
    return [];
  });
  const targetLabel = $derived(
    action === 'place-move-within' ? targetOption?.description || targetOption?.label || '' : targetOption?.label || '',
  );
  const canApply = $derived(
    selectedCount > 0 &&
      !busy &&
      !receipt &&
      Boolean(action) &&
      (!needsTarget || Boolean(targetId)) &&
      Boolean(action && availableActions.includes(action)),
  );
  const actionGroupDefinitions: Array<{ actions: MediaUiAction[]; icon: string; id: MediaActionGroup; label: string }> =
    [
      {
        actions: ['place-move-within', 'event-attach', 'place-attach', 'object-attach', 'context-detach'],
        icon: mdiImageMove,
        id: 'context',
        label: 'Organise',
      },
      {
        actions: ['presence-current', 'presence-person', 'presence-pet'],
        icon: mdiAccountMultipleOutline,
        id: 'presence',
        label: 'People & pets',
      },
      {
        actions: ['visibility-standard', 'visibility-personal', 'visibility-private'],
        icon: mdiLockOutline,
        id: 'privacy',
        label: 'Privacy',
      },
      {
        actions: ['tag-add', 'tag-remove', 'album-add'],
        icon: mdiTagOutline,
        id: 'metadata',
        label: 'Tags & albums',
      },
      {
        actions: ['favorite', 'unfavorite', 'archive', 'unarchive'],
        icon: mdiImageAlbum,
        id: 'library',
        label: 'Library',
      },
    ];
  const actionGroups = $derived(
    actionGroupDefinitions
      .map((group) => ({
        ...group,
        actions: group.actions.filter((candidate) => availableActions.includes(candidate)),
      }))
      .filter((group) => group.actions.length > 0),
  );
  const visibleGroupActions = $derived(actionGroups.find((group) => group.id === actionGroup)?.actions ?? []);

  const actionLabel = (selectedAction: MediaUiAction) =>
    selectedAction === 'place-move-within'
      ? `Move within ${currentScope?.displayName || 'this Place'}`
      : cimmichEntityMediaActionLabel(selectedAction, currentSubject, currentScope);

  const actionIcon = (selectedAction: MediaUiAction) =>
    ({
      'album-add': mdiImageAlbum,
      archive: mdiArchiveArrowDownOutline,
      'context-detach': mdiLinkOff,
      'event-attach': mdiCalendarBlankOutline,
      favorite: mdiHeartOutline,
      'object-attach': mdiPackageVariantClosed,
      'place-attach': mdiMapMarkerOutline,
      'place-move-within': mdiImageMove,
      'presence-current': currentSubject?.subjectKind === 'pet' ? mdiPawOutline : mdiAccountMultipleOutline,
      'presence-person': mdiAccountMultipleOutline,
      'presence-pet': mdiPawOutline,
      'tag-add': mdiTagOutline,
      'tag-remove': mdiTagOutline,
      unarchive: mdiArchiveArrowUpOutline,
      unfavorite: mdiHeartOutline,
      'visibility-personal': mdiLockOutline,
      'visibility-private': mdiLockOutline,
      'visibility-standard': mdiLockOutline,
    })[selectedAction];

  const asError = (caught: unknown) =>
    caught instanceof Error ? caught.message : 'The action could not be completed.';

  const storeReceipt = (next: CimmichEntityMediaActionReceipt | null) => {
    receipt = next;
    saveCimmichEntityMediaActionReceipt(globalThis.localStorage, next);
  };

  $effect(() => {
    if (!receiptLoaded) {
      receiptLoaded = true;
      receipt = loadCimmichEntityMediaActionReceipt(globalThis.localStorage);
    }
  });

  const optionKindForAction = (selectedAction: MediaUiAction | null): OptionKind | null => {
    switch (selectedAction) {
      case 'album-add': {
        return 'album';
      }
      case 'event-attach': {
        return 'event';
      }
      case 'object-attach': {
        return 'object';
      }
      case 'presence-person': {
        return 'person';
      }
      case 'presence-pet': {
        return 'pet';
      }
      case 'place-attach': {
        return 'place';
      }
      case 'tag-add':
      case 'tag-remove': {
        return 'tag';
      }
      default: {
        return null;
      }
    }
  };

  const loadOptionKind = async (kind: OptionKind) => {
    if (loadedOptionKinds.has(kind)) {
      return;
    }
    const existing = optionRequests.get(kind);
    if (existing) {
      await existing;
      return;
    }

    const request = (async () => {
      loadingOptions = true;
      try {
        switch (kind) {
          case 'album': {
            albums = [...(await getAllAlbums({ isOwned: true }))].sort((left, right) =>
              left.albumName.localeCompare(right.albumName),
            );
            break;
          }
          case 'tag': {
            tags = [...(await getAllTags())].sort((left, right) => left.name.localeCompare(right.name));
            break;
          }
          case 'person': {
            people = [...(await getCimmichPeople(500, '', { presentation: false }))].sort((left, right) =>
              left.display_name.localeCompare(right.display_name),
            );
            break;
          }
          case 'pet': {
            pets = [...(await getCimmichPets({ limit: 500 }))].sort((left, right) =>
              left.displayName.localeCompare(right.displayName),
            );
            break;
          }
          case 'event':
          case 'object':
          case 'place': {
            const family = kind === 'event' ? 'events' : kind === 'place' ? 'places' : 'objects';
            const contextItems = await getCimmichContextEntities(family, { limit: 500 });
            const sorted = [...contextItems].sort((left, right) => left.displayName.localeCompare(right.displayName));
            if (kind === 'event') {
              events = sorted;
            } else if (kind === 'place') {
              places = sorted;
            } else {
              objects = sorted;
            }
            break;
          }
        }
        loadedOptionKinds.add(kind);
      } catch (error_) {
        error = `${asError(error_)} This choice list is unavailable; other actions still work.`;
      } finally {
        optionRequests.delete(kind);
        loadingOptions = optionRequests.size > 0;
      }
    })();
    optionRequests.set(kind, request);
    await request;
  };

  $effect(() => {
    const kind = optionKindForAction(action);
    if (selectedCount > 0 && kind) {
      void loadOptionKind(kind);
    }
  });

  const selectGroup = (group: MediaActionGroup) => {
    actionGroup = actionGroup === group ? null : group;
    action = null;
    targetId = '';
    targetOption = undefined;
  };

  const selectAction = (selectedAction: MediaUiAction) => {
    action = action === selectedAction ? null : selectedAction;
    targetId = '';
    targetOption = undefined;
  };

  const selectTarget = (option: ComboBoxOption | undefined) => {
    targetId = option?.value ?? '';
  };

  const emptyReceipt = (
    selectedAction: CimmichEntityMediaActionKind,
    label: string,
  ): CimmichEntityMediaActionReceipt => ({
    action: selectedAction,
    albumId: selectedAction === 'album-add' ? targetId : '',
    assetIds: [],
    completedAt: new Date().toISOString(),
    contextDecisionIds: [],
    label,
    nativePrevious: [],
    presenceDecisionIds: [],
    sourceAssetIds: [],
    tagId: selectedAction === 'tag-add' || selectedAction === 'tag-remove' ? targetId : '',
    targetId,
    version: 1,
    visibilityDecisionIds: [],
  });

  const loadNativeAssets = async () => {
    progress = `Checking ${selectedCount.toLocaleString()} selected ${selectedCount === 1 ? 'photo' : 'photos'}…`;
    return Promise.all(items.map((item) => getAssetInfo({ id: item.sourceAssetId })));
  };

  const apply = async () => {
    if (!canApply || !action) {
      return;
    }
    const selectedAction = action;
    const applyingCount = selectedCount;
    const baseLabel = actionLabel(selectedAction);
    const label = `${baseLabel}${targetLabel ? ` · ${targetLabel}` : ''}`;
    if (
      !globalThis.confirm(
        `${label} for ${applyingCount.toLocaleString()} ${applyingCount === 1 ? 'photo' : 'photos'}?\n\nThis changes only the selected photos. It does not move or delete source files.`,
      )
    ) {
      return;
    }

    busy = true;
    error = '';
    progress = `Applying ${label}…`;
    if (selectedAction === 'place-move-within') {
      try {
        const changed = await onMoveWithinPlace?.(targetId);
        if (!changed) {
          throw new Error('The selected photos could not be moved');
        }
        progress = `${applyingCount.toLocaleString()} ${applyingCount === 1 ? 'photo was' : 'photos were'} moved. Undo is available above.`;
        action = null;
        actionGroup = null;
        targetId = '';
        targetOption = undefined;
      } catch (error_) {
        error = `${asError(error_)} Nothing changed.`;
        progress = '';
      } finally {
        busy = false;
      }
      return;
    }
    const next = emptyReceipt(selectedAction, label);
    try {
      const visibilityTier = cimmichEntityMediaActionVisibilityTier(selectedAction);
      if (visibilityTier) {
        const result = await setCimmichVisibilityObjects(
          items.map(({ assetId }) => ({ objectId: assetId, objectScope: 'asset', visibilityTier })),
          createCimmichVisibilityCommandId('entity-media'),
        );
        if (result.decisionId) {
          next.visibilityDecisionIds.push(result.decisionId);
          next.assetIds.push(...items.map(({ assetId }) => assetId));
        }
      } else if (
        selectedAction === 'event-attach' ||
        selectedAction === 'place-attach' ||
        selectedAction === 'object-attach'
      ) {
        const family =
          selectedAction === 'event-attach' ? 'events' : selectedAction === 'place-attach' ? 'places' : 'objects';
        const associationKind =
          selectedAction === 'event-attach' ? 'direct' : selectedAction === 'place-attach' ? 'captured_at' : 'depicts';
        const result = await attachCimmichContextAssets(
          family,
          targetId,
          createCimmichContextCommandId('entity-media-attach'),
          items.map(({ assetId }) => ({ assetId, associationKind })),
        );
        if (result.decisionId && result.undo?.eligible) {
          next.contextDecisionIds.push(result.decisionId);
          next.assetIds.push(...(result.changedAssetIds ?? items.map(({ assetId }) => assetId)));
        }
      } else if (selectedAction === 'context-detach' && currentScope) {
        const result = await detachCimmichContextAssets(
          currentScope.family,
          currentScope.entityId,
          createCimmichContextCommandId('entity-media-detach'),
          items.map(({ assetId }) => assetId),
        );
        if (result.decisionId && result.undo?.eligible) {
          next.contextDecisionIds.push(result.decisionId);
          next.assetIds.push(...(result.changedAssetIds ?? items.map(({ assetId }) => assetId)));
        }
      } else if (
        selectedAction === 'presence-current' ||
        selectedAction === 'presence-person' ||
        selectedAction === 'presence-pet'
      ) {
        const selectedPerson =
          selectedAction === 'presence-person' ? people.find((person) => person.person_id === targetId) : null;
        const selectedPet = selectedAction === 'presence-pet' ? pets.find((pet) => pet.petId === targetId) : null;
        const subject =
          selectedAction === 'presence-current'
            ? currentSubject
            : selectedPerson
              ? {
                  displayName: selectedPerson.display_name,
                  subjectId: selectedPerson.person_id,
                  subjectKind: 'person' as const,
                }
              : selectedPet
                ? {
                    displayName: selectedPet.displayName,
                    subjectId: selectedPet.petId,
                    subjectKind: 'pet' as const,
                  }
                : null;
        if (!subject) {
          throw new Error('Choose a valid Person or Pet');
        }
        let completed = 0;
        for (const item of items) {
          progress = `Marking ${subject.displayName} present… ${completed.toLocaleString()} of ${selectedCount.toLocaleString()}`;
          const result = await setCimmichManualPresence(item.assetId, {
            action: 'attach',
            commandId: createCimmichManualPresenceCommandId('entity-media'),
            subjectId: subject.subjectId,
            subjectKind: subject.subjectKind,
          });
          if (result.changed && result.decisionId && result.undo.eligible) {
            next.presenceDecisionIds.push(result.decisionId);
            next.assetIds.push(item.assetId);
            storeReceipt(next);
          }
          completed += 1;
        }
      } else if (selectedAction === 'album-add') {
        const results = await addAssetsToAlbum({
          id: targetId,
          bulkIdsDto: { ids: items.map(({ sourceAssetId }) => sourceAssetId) },
        });
        next.sourceAssetIds.push(...results.filter(({ success }) => success).map(({ id }) => id));
      } else {
        const nativeAssets = await loadNativeAssets();
        if (selectedAction === 'tag-add' || selectedAction === 'tag-remove') {
          const changed = nativeAssets.filter((asset) =>
            selectedAction === 'tag-add'
              ? !asset.tags?.some((tag) => tag.id === targetId)
              : asset.tags?.some((tag) => tag.id === targetId),
          );
          if (changed.length > 0) {
            await (selectedAction === 'tag-add'
              ? bulkTagAssets({ tagBulkAssetsDto: { assetIds: changed.map(({ id }) => id), tagIds: [targetId] } })
              : untagAssets({ id: targetId, bulkIdsDto: { ids: changed.map(({ id }) => id) } }));
            next.sourceAssetIds.push(...changed.map(({ id }) => id));
          }
        } else {
          const changed = nativeAssets.filter((asset) =>
            selectedAction === 'favorite'
              ? !asset.isFavorite
              : selectedAction === 'unfavorite'
                ? asset.isFavorite
                : selectedAction === 'archive'
                  ? asset.visibility !== AssetVisibility.Archive
                  : asset.visibility === AssetVisibility.Archive,
          );
          next.nativePrevious.push(
            ...changed.map(({ id, isFavorite, visibility }) => ({ id, isFavorite, visibility })),
          );
          if (changed.length > 0) {
            await updateAssets({
              assetBulkUpdateDto: {
                ids: changed.map(({ id }) => id),
                ...(selectedAction === 'favorite' || selectedAction === 'unfavorite'
                  ? { isFavorite: selectedAction === 'favorite' }
                  : {
                      visibility: selectedAction === 'archive' ? AssetVisibility.Archive : AssetVisibility.Timeline,
                    }),
              },
            });
          }
        }
      }

      const changedCount = new Set([
        ...next.assetIds,
        ...next.sourceAssetIds,
        ...next.nativePrevious.map(({ id }) => id),
      ]).size;
      if (changedCount > 0) {
        storeReceipt(next);
        progress = `${changedCount.toLocaleString()} ${changedCount === 1 ? 'photo was' : 'photos were'} changed. Undo is saved.`;
        onClear();
        await onChanged?.();
      } else {
        progress = 'Everything already matched. Nothing changed.';
      }
    } catch (error_) {
      const partial =
        next.contextDecisionIds.length > 0 ||
        next.presenceDecisionIds.length > 0 ||
        next.visibilityDecisionIds.length > 0 ||
        next.sourceAssetIds.length > 0 ||
        next.nativePrevious.length > 0;
      if (partial) {
        storeReceipt(next);
      }
      error = `${asError(error_)}${partial ? ' Undo is saved for the completed part.' : ' Nothing changed.'}`;
      progress = '';
    } finally {
      busy = false;
    }
  };

  const undo = async () => {
    if (!receipt || busy) {
      return;
    }
    busy = true;
    error = '';
    progress = `Undoing ${receipt.label}…`;
    try {
      for (const decisionId of receipt.contextDecisionIds) {
        await undoCimmichContextDecision(decisionId, createCimmichContextCommandId('entity-media-undo'));
      }
      for (const decisionId of receipt.presenceDecisionIds) {
        await undoCimmichManualPresence(decisionId, createCimmichManualPresenceCommandId('entity-media-undo'));
      }
      for (const decisionId of receipt.visibilityDecisionIds) {
        await undoCimmichVisibilityDecision(decisionId, createCimmichVisibilityCommandId('entity-media-undo'));
      }
      if (receipt.action === 'album-add' && receipt.sourceAssetIds.length > 0) {
        await removeAssetFromAlbum({ id: receipt.albumId, bulkIdsDto: { ids: receipt.sourceAssetIds } });
      } else if (receipt.action === 'tag-add' && receipt.sourceAssetIds.length > 0) {
        await untagAssets({ id: receipt.tagId, bulkIdsDto: { ids: receipt.sourceAssetIds } });
      } else if (receipt.action === 'tag-remove' && receipt.sourceAssetIds.length > 0) {
        await bulkTagAssets({ tagBulkAssetsDto: { assetIds: receipt.sourceAssetIds, tagIds: [receipt.tagId] } });
      } else if (receipt.action === 'favorite' || receipt.action === 'unfavorite') {
        for (const isFavorite of [true, false]) {
          const ids = receipt.nativePrevious.filter((item) => item.isFavorite === isFavorite).map(({ id }) => id);
          if (ids.length > 0) {
            await updateAssets({ assetBulkUpdateDto: { ids, isFavorite } });
          }
        }
      } else if (receipt.action === 'archive' || receipt.action === 'unarchive') {
        for (const visibility of [AssetVisibility.Timeline, AssetVisibility.Archive, AssetVisibility.Locked]) {
          const ids = receipt.nativePrevious.filter((item) => item.visibility === visibility).map(({ id }) => id);
          if (ids.length > 0) {
            await updateAssets({ assetBulkUpdateDto: { ids, visibility } });
          }
        }
      }
      storeReceipt(null);
      progress = 'The selected-media action was undone.';
      toastManager.success('Bulk photo action undone');
      await onChanged?.();
    } catch (error_) {
      error = `${asError(error_)} The saved Undo receipt remains available.`;
      progress = '';
    } finally {
      busy = false;
    }
  };

  const dismissReceipt = () => {
    if (!receipt || globalThis.confirm('Keep these changes and dismiss the saved Undo receipt?')) {
      storeReceipt(null);
    }
  };
</script>

{#if showControls || receipt || progress || error}
  <section class="entity-media-actions" aria-label="Selected photo actions">
    {#if receipt}
      <div class="entity-media-receipt" role="status">
        <Icon icon={mdiCheckCircleOutline} size="20" />
        <div class="min-w-0 flex-1">
          <strong>{receipt.label}</strong>
          <p>Undo is saved across navigation and reload.</p>
        </div>
        <button type="button" disabled={busy} onclick={() => void undo()}>
          <Icon icon={mdiUndoVariant} size="17" /> Undo
        </button>
        <button type="button" disabled={busy} onclick={dismissReceipt}>Keep changes</button>
      </div>
    {/if}

    {#if showControls}
      <div class="entity-media-workspace">
        <header class="entity-media-header">
          <div class="entity-media-count">
            <strong>{selectedCount} selected</strong>
            <span>Choose one action. Every completed action keeps one exact Undo.</span>
          </div>
          <div class="entity-media-header-actions">
            {#if onSelectShown}
              <button type="button" disabled={busy || Boolean(receipt)} onclick={onSelectShown}>
                <Icon icon={mdiSelectAll} size="17" /> Select shown
              </button>
            {/if}
            <button class="entity-media-clear" type="button" disabled={busy || selectedCount === 0} onclick={onClear}
              >Clear</button
            >
          </div>
        </header>

        <div>
          <p class="entity-media-eyebrow">What would you like to do?</p>
          <div class="entity-media-toolbar" role="toolbar" aria-label="Photo action categories">
            {#each actionGroups as group (group.id)}
              <button
                class:entity-media-group--active={actionGroup === group.id}
                class="entity-media-group"
                type="button"
                aria-pressed={actionGroup === group.id}
                disabled={busy || Boolean(receipt) || selectedCount === 0}
                onclick={() => selectGroup(group.id)}
              >
                <span class="entity-media-group-icon"><Icon icon={group.icon} size="20" /></span>
                <span>{group.label}</span>
              </button>
            {/each}
          </div>
        </div>

        {#if actionGroup}
          <div class="entity-media-panel">
            <p class="entity-media-panel-label">{actionGroups.find((group) => group.id === actionGroup)?.label}</p>
            <div class="entity-media-options" role="group" aria-label="Choose an action">
              {#each visibleGroupActions as option (option)}
                <button
                  class:entity-media-option--active={action === option}
                  class="entity-media-option"
                  type="button"
                  aria-pressed={action === option}
                  disabled={busy || Boolean(receipt)}
                  onclick={() => selectAction(option)}
                >
                  <Icon icon={actionIcon(option)} size="18" />
                  <span>{actionLabel(option)}</span>
                </button>
              {/each}
            </div>

            {#if action}
              <div class="entity-media-detail">
                <div class="entity-media-detail-copy">
                  <strong>{actionLabel(action)}</strong>
                  <span>
                    {action === 'place-move-within'
                      ? 'Choose any subsection below this Place. Deeper levels are indented.'
                      : 'Configure this action below, then apply it to only the selected photos.'}
                  </span>
                </div>
                {#if needsTarget}
                  <div class="entity-media-combobox-field">
                    <Combobox
                      label={action === 'place-move-within' ? 'Destination subsection' : 'Destination'}
                      options={targetOptions}
                      bind:selectedOption={targetOption}
                      placeholder={loadingOptions
                        ? 'Loading…'
                        : action === 'place-move-within'
                          ? 'Choose a subsection…'
                          : 'Choose or type…'}
                      disabled={busy || loadingOptions || Boolean(receipt)}
                      defaultFirstOption
                      clearSelectionOnInput
                      onSelect={selectTarget}
                    />
                  </div>
                {/if}
                <button class="entity-media-apply" type="button" disabled={!canApply} onclick={() => void apply()}>
                  {busy
                    ? 'Working…'
                    : action === 'place-move-within'
                      ? `Move ${selectedCount.toLocaleString()}`
                      : 'Apply'}
                </button>
              </div>
            {:else}
              <p class="entity-media-hint">Choose the exact action you want from this group.</p>
            {/if}
          </div>
        {:else}
          <p class="entity-media-hint">Choose an icon above to see its actions and controls here.</p>
        {/if}
      </div>
    {/if}

    {#if progress}<p class="entity-media-progress" role="status">{progress}</p>{/if}
    {#if error}
      <p class="entity-media-error" role="alert"><Icon icon={mdiAlertCircleOutline} size="18" /> {error}</p>
    {/if}
  </section>
{/if}

<style>
  .entity-media-actions {
    margin-top: 1rem;
    display: grid;
    gap: 0.75rem;
    border: 1px solid color-mix(in srgb, currentColor 13%, transparent);
    border-radius: 1rem;
    background: color-mix(in srgb, var(--immich-primary-color) 5%, transparent);
    padding: 0.875rem;
  }

  .entity-media-receipt {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.625rem;
  }

  .entity-media-workspace {
    display: grid;
    gap: 0.875rem;
  }

  .entity-media-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .entity-media-header-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.45rem;
  }

  .entity-media-header-actions button {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  .entity-media-count {
    display: grid;
    min-width: 9rem;
  }

  .entity-media-count span,
  .entity-media-receipt p {
    font-size: 0.75rem;
    opacity: 0.65;
  }

  .entity-media-combobox-field {
    display: grid;
    gap: 0.25rem;
    min-width: min(20rem, 100%);
    font-size: 0.75rem;
    font-weight: 650;
  }

  button {
    min-height: 2.5rem;
    border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
    border-radius: 0.75rem;
    background: transparent;
    padding: 0.5rem 0.75rem;
    font-size: 0.8125rem;
    font-weight: 650;
  }

  button:hover:not(:disabled) {
    background: color-mix(in srgb, currentColor 7%, transparent);
  }

  button:disabled,
  .entity-media-group:disabled,
  .entity-media-option:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .entity-media-eyebrow,
  .entity-media-panel-label {
    margin-bottom: 0.45rem;
    font-size: 0.6875rem;
    font-weight: 750;
    letter-spacing: 0.055em;
    opacity: 0.58;
    text-transform: uppercase;
  }

  .entity-media-toolbar {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 0.5rem;
  }

  .entity-media-group {
    display: flex;
    min-width: 0;
    min-height: 3.75rem;
    align-items: center;
    justify-content: flex-start;
    gap: 0.55rem;
    text-align: left;
  }

  .entity-media-group-icon {
    display: grid;
    width: 2rem;
    height: 2rem;
    flex: 0 0 auto;
    place-items: center;
    border-radius: 0.65rem;
    background: color-mix(in srgb, var(--immich-primary-color) 10%, transparent);
    color: var(--immich-primary-color);
  }

  .entity-media-group--active {
    border-color: color-mix(in srgb, var(--immich-primary-color) 70%, transparent);
    background: color-mix(in srgb, var(--immich-primary-color) 9%, transparent);
    color: var(--immich-primary-color);
  }

  .entity-media-panel {
    display: grid;
    gap: 0.75rem;
    border-top: 1px solid color-mix(in srgb, currentColor 11%, transparent);
    padding-top: 0.875rem;
  }

  .entity-media-options {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }

  .entity-media-option {
    display: inline-flex;
    min-height: 2.6rem;
    align-items: center;
    gap: 0.45rem;
    border-radius: 999px;
  }

  .entity-media-option--active {
    border-color: var(--immich-primary-color);
    background: var(--immich-primary-color);
    color: white;
  }

  .entity-media-detail {
    display: grid;
    grid-template-columns: minmax(12rem, 1fr) minmax(16rem, 22rem) auto;
    align-items: end;
    gap: 0.75rem;
    border-radius: 0.875rem;
    background: color-mix(in srgb, currentColor 4.5%, transparent);
    padding: 0.75rem;
  }

  .entity-media-detail-copy {
    display: grid;
    gap: 0.2rem;
    align-self: center;
  }

  .entity-media-detail-copy span,
  .entity-media-hint {
    font-size: 0.75rem;
    opacity: 0.65;
  }

  .entity-media-apply {
    border-color: transparent;
    background: var(--immich-primary-color);
    color: white;
    padding-inline: 1.25rem;
  }

  .entity-media-receipt {
    align-items: center;
    border-radius: 0.75rem;
    background: color-mix(in srgb, #10b981 11%, transparent);
    padding: 0.625rem;
    color: color-mix(in srgb, #047857 88%, currentColor);
  }

  .entity-media-progress,
  .entity-media-error {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.8125rem;
    font-weight: 600;
  }

  .entity-media-error {
    color: #b91c1c;
  }

  :global(.dark) .entity-media-receipt {
    color: #a7f3d0;
  }

  :global(.dark) .entity-media-error {
    color: #fca5a5;
  }

  @media (max-width: 640px) {
    .entity-media-toolbar {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .entity-media-detail {
      grid-template-columns: 1fr;
    }

    .entity-media-combobox-field,
    .entity-media-apply {
      width: 100%;
    }
  }
</style>
