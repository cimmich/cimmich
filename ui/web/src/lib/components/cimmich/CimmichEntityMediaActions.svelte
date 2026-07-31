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
  import { mdiAlertCircleOutline, mdiCheckCircleOutline, mdiUndoVariant } from '@mdi/js';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import {
    cimmichEntityMediaActionLabel,
    cimmichEntityMediaActionNeedsTarget,
    cimmichEntityMediaActionVisibilityTier,
    loadCimmichEntityMediaActionReceipt,
    saveCimmichEntityMediaActionReceipt,
    type CimmichEntityMediaActionKind,
    type CimmichEntityMediaActionReceipt,
    type CimmichEntityMediaItem,
    type CimmichEntityMediaScope,
    type CimmichEntityMediaSubject,
  } from './entity-media-actions';

  interface Props {
    currentScope?: CimmichEntityMediaScope | null;
    currentSubject?: CimmichEntityMediaSubject | null;
    items: CimmichEntityMediaItem[];
    onChanged?: () => Promise<void> | void;
    onClear: () => void;
    showControls?: boolean;
  }

  let { currentScope = null, currentSubject = null, items, onChanged, onClear, showControls = true }: Props = $props();

  let action = $state<CimmichEntityMediaActionKind | null>(null);
  let targetId = $state('');
  let targetQuery = $state('');
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
    const result: CimmichEntityMediaActionKind[] = [
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
  const needsTarget = $derived(action ? cimmichEntityMediaActionNeedsTarget(action) : false);
  const targetOptions = $derived.by(() => {
    if (action === 'event-attach') {
      return events.map(({ entityId, displayName }) => ({ id: entityId, label: displayName }));
    }
    if (action === 'place-attach') {
      return places.map(({ entityId, displayName }) => ({ id: entityId, label: displayName }));
    }
    if (action === 'object-attach') {
      return objects.map(({ entityId, displayName }) => ({ id: entityId, label: displayName }));
    }
    if (action === 'presence-person') {
      return people
        .filter((person) => person.subject_kind === 'person' && person.status === 'active')
        .map(({ person_id, display_name }) => ({ id: person_id, label: display_name }));
    }
    if (action === 'presence-pet') {
      return pets
        .filter((pet) => pet.status === 'active')
        .map(({ petId, displayName }) => ({ id: petId, label: displayName }));
    }
    if (action === 'tag-add' || action === 'tag-remove') {
      return tags.map(({ id, name }) => ({ id, label: name }));
    }
    if (action === 'album-add') {
      return albums.map(({ id, albumName }) => ({ id, label: albumName }));
    }
    return [];
  });
  const targetLabel = $derived(targetOptions.find((option) => option.id === targetId)?.label ?? '');
  const canApply = $derived(
    selectedCount > 0 &&
      !busy &&
      !receipt &&
      Boolean(action) &&
      (!needsTarget || Boolean(targetId)) &&
      Boolean(action && availableActions.includes(action)),
  );

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

  const optionKindForAction = (selectedAction: CimmichEntityMediaActionKind | null): OptionKind | null => {
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

  const selectAction = (event: Event) => {
    const value = (event.currentTarget as HTMLSelectElement).value;
    action = (value as CimmichEntityMediaActionKind) || null;
    targetId = '';
    targetQuery = '';
  };

  const selectTarget = (event: Event) => {
    targetQuery = (event.currentTarget as HTMLInputElement).value;
    const normalizedQuery = targetQuery.trim().toLocaleLowerCase();
    const exactMatches = targetOptions.filter((option) => option.label.trim().toLocaleLowerCase() === normalizedQuery);
    targetId = exactMatches.length === 1 ? exactMatches[0].id : '';
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
    const baseLabel = cimmichEntityMediaActionLabel(selectedAction, currentSubject, currentScope);
    const label = `${baseLabel}${targetLabel ? ` · ${targetLabel}` : ''}`;
    if (
      !globalThis.confirm(
        `${label} for ${selectedCount.toLocaleString()} ${selectedCount === 1 ? 'photo' : 'photos'}?\n\nThis changes only the selected photos. It does not move or delete source files.`,
      )
    ) {
      return;
    }

    busy = true;
    error = '';
    progress = `Applying ${label}…`;
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

    {#if showControls}<div class="entity-media-row">
        <div class="entity-media-count">
          <strong>{selectedCount} selected</strong>
          <span>One action per run keeps Undo exact.</span>
        </div>
        <button class="entity-media-clear" type="button" disabled={busy || selectedCount === 0} onclick={onClear}
          >Clear</button
        >
        <label>
          <span>Action</span>
          <select value={action ?? ''} disabled={busy || Boolean(receipt)} onchange={selectAction}>
            <option value="">Pick action…</option>
            <optgroup label="Cimmich context">
              <option value="event-attach">Add to Event</option>
              <option value="place-attach">Add to Place</option>
              <option value="object-attach">Mark Thing depicted</option>
              {#if currentScope && allDirectlyAssigned}<option value="context-detach"
                  >Remove from {currentScope.displayName}</option
                >{/if}
            </optgroup>
            <optgroup label="People and Pets">
              {#if currentSubject}<option value="presence-current">Mark {currentSubject.displayName} present</option
                >{/if}
              <option value="presence-person">Mark Person present</option>
              <option value="presence-pet">Mark Pet present</option>
            </optgroup>
            <optgroup label="Photo privacy">
              <option value="visibility-standard">Set to Standard</option>
              <option value="visibility-personal">Set to Personal</option>
              <option value="visibility-private">Set to Private</option>
            </optgroup>
            <optgroup label="Tags and albums">
              <option value="tag-add">Add tag</option>
              <option value="tag-remove">Remove tag</option>
              <option value="album-add">Add to album</option>
            </optgroup>
            <optgroup label="Immich library">
              <option value="favorite">Favourite</option>
              <option value="unfavorite">Remove favourite</option>
              <option value="archive">Archive</option>
              <option value="unarchive">Unarchive</option>
            </optgroup>
          </select>
        </label>
        {#if needsTarget}
          <label>
            <span>Destination</span>
            <input
              aria-label="Destination"
              aria-describedby="entity-media-destination-help"
              autocomplete="off"
              list="entity-media-destinations"
              placeholder={loadingOptions ? 'Loading…' : 'Type to search…'}
              value={targetQuery}
              disabled={busy || loadingOptions || Boolean(receipt)}
              oninput={selectTarget}
            />
            <datalist id="entity-media-destinations">
              {#each targetOptions as option (option.id)}<option value={option.label}></option>{/each}
            </datalist>
            <span id="entity-media-destination-help" class="sr-only"
              >Type a destination name, then choose an exact match.</span
            >
          </label>
        {/if}
        <button class="entity-media-apply" type="button" disabled={!canApply} onclick={() => void apply()}>
          {busy ? 'Working…' : 'Apply'}
        </button>
      </div>{/if}

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

  .entity-media-row,
  .entity-media-receipt {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.625rem;
  }

  .entity-media-count {
    display: grid;
    min-width: 9rem;
    margin-right: auto;
  }

  .entity-media-count span,
  .entity-media-receipt p {
    font-size: 0.75rem;
    opacity: 0.65;
  }

  label {
    display: grid;
    gap: 0.25rem;
    min-width: 11rem;
    font-size: 0.75rem;
    font-weight: 650;
  }

  select,
  input,
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
  select:disabled,
  input:disabled {
    cursor: not-allowed;
    opacity: 0.45;
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
    label,
    .entity-media-apply {
      width: 100%;
    }
  }
</style>
