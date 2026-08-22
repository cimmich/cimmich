<script lang="ts">
  import './CimmichEntityMediaActions.css';
  import {
    attachCimmichContextAssets,
    changeCimmichAssetLabelMembership,
    createCimmichAssetLabel,
    createCimmichAssetLabelCommandId,
    createCimmichContextCommandId,
    createCimmichManualPresenceCommandId,
    createCimmichVisibilityCommandId,
    detachCimmichContextAssets,
    getCimmichContextEntities,
    getCimmichAssetLabels,
    getCimmichPeople,
    getCimmichPets,
    rotateCimmichAssets,
    setCimmichManualPresence,
    setCimmichVisibilityObjects,
    undoCimmichContextDecision,
    undoCimmichAssetLabelDecision,
    undoCimmichManualPresence,
    undoCimmichAssetCorrections,
    undoCimmichVisibilityDecision,
    type CimmichContextEntity,
    type CimmichAssetLabel,
    type CimmichPerson,
    type CimmichPet,
  } from '$lib/services/cimmich.service';
  import { Icon, Tooltip, toastManager } from '@immich/ui';
  import { updateAssets } from '@immich/sdk';
  import {
    mdiAlertCircleOutline,
    mdiCheckCircleOutline,
    mdiClose,
    mdiCrosshairsGps,
    mdiImageMove,
    mdiSelectAll,
    mdiUndoVariant,
  } from '@mdi/js';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import Combobox, { type ComboBoxOption } from '../shared-components/Combobox.svelte';
  import { currentCimmichUndoReceiptContext } from './cimmich-undo-receipt-context.svelte';
  import CimmichLocalAiAction from './CimmichLocalAiAction.svelte';
  import {
    CIMMICH_ENTITY_MEDIA_ACTION_GROUPS,
    cimmichEntityMediaActionIcon,
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
  import { sameCimmichUndoReceiptContext, type CimmichUndoReceiptContext } from './persisted-undo-receipt';

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
  type PlaceLocationAction = 'gps-update-from-place' | 'place-move';
  type MediaUiAction = CimmichEntityMediaActionKind | PlaceLocationAction | PlaceMoveAction;
  type MediaActionGroup = 'context' | 'library' | 'metadata' | 'presence' | 'privacy';

  let action = $state<MediaUiAction | null>(null);
  let actionGroup = $state<MediaActionGroup | null>(null);
  let targetId = $state('');
  let targetOption = $state<ComboBoxOption>();
  let collections = $state<CimmichAssetLabel[]>([]);
  let tags = $state<CimmichAssetLabel[]>([]);
  let people = $state<CimmichPerson[]>([]);
  let pets = $state<CimmichPet[]>([]);
  let places = $state<CimmichContextEntity[]>([]);
  let events = $state<CimmichContextEntity[]>([]);
  let objects = $state<CimmichContextEntity[]>([]);
  let loadingOptions = $state(false);
  let creatingOrganization = $state(false);
  let newOrganizationName = $state('');
  let busy = $state(false);
  let error = $state('');
  let progress = $state('');
  let receipt = $state<CimmichEntityMediaActionReceipt | null>(null);
  let receiptContext: CimmichUndoReceiptContext | null = null;
  let receiptLoaded = false;
  type OptionKind = 'album' | 'event' | 'object' | 'person' | 'pet' | 'place' | 'tag';
  const loadedOptionKinds = new SvelteSet<OptionKind>();
  const optionRequests = new SvelteMap<OptionKind, Promise<void>>();

  const selectedCount = $derived(items.length);
  const allDirectlyAssigned = $derived(items.length > 0 && items.every((item) => item.directlyAssigned !== false));
  const availableActions = $derived.by(() => {
    const result: MediaUiAction[] = [
      ...(currentScope?.family === 'places' && moveWithinPlaceTargets.length > 0 && onMoveWithinPlace
        ? (['place-move-within'] as const)
        : []),
      ...(currentScope?.family === 'places' && allDirectlyAssigned ? (['place-move'] as const) : []),
      'event-attach',
      'place-attach',
      'object-attach',
      'gps-update-from-place',
      ...(currentSubject ? (['presence-current'] as const) : []),
      'presence-person',
      'presence-pet',
      'visibility-standard',
      'visibility-personal',
      'visibility-private',
      'rotate-left',
      'rotate-right',
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
    action === 'place-move-within' ||
      action === 'place-move' ||
      action === 'gps-update-from-place' ||
      (action ? cimmichEntityMediaActionNeedsTarget(action) : false),
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
    if (action === 'place-attach' || action === 'place-move' || action === 'gps-update-from-place') {
      return places
        .filter(
          ({ entityId, geometry, typeKind }) =>
            (action !== 'place-move' || entityId !== currentScope?.entityId) &&
            (action !== 'gps-update-from-place' ||
              (typeKind === 'point' && Boolean(geometry && 'latitude' in geometry))),
        )
        .map(({ entityId, displayName, geometry }) => ({
          description:
            action === 'gps-update-from-place' && geometry && 'latitude' in geometry
              ? `${geometry.latitude.toFixed(5)}, ${geometry.longitude.toFixed(5)}`
              : undefined,
          id: entityId,
          label: displayName,
          value: entityId,
        }));
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
      return tags.map(({ labelId, displayName }) => ({ id: labelId, label: displayName, value: labelId }));
    }
    if (action === 'album-add') {
      return collections.map(({ labelId, displayName }) => ({ id: labelId, label: displayName, value: labelId }));
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
        actions: ['place-move-within', 'place-move', 'event-attach', 'place-attach', 'object-attach', 'context-detach'],
        icon: mdiImageMove,
        id: 'context',
        label: 'Organise',
      },
      ...CIMMICH_ENTITY_MEDIA_ACTION_GROUPS.map(
        (group): { actions: MediaUiAction[]; icon: string; id: MediaActionGroup; label: string } => ({
          ...group,
          actions: group.id === 'metadata' ? [...group.actions, 'gps-update-from-place'] : [...group.actions],
        }),
      ),
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
      : selectedAction === 'place-move'
        ? 'Move to another Place'
        : selectedAction === 'gps-update-from-place'
          ? 'Update GPS from Place'
          : cimmichEntityMediaActionLabel(selectedAction, currentSubject, currentScope);

  const actionIcon = (selectedAction: MediaUiAction) =>
    selectedAction === 'place-move-within'
      ? mdiImageMove
      : selectedAction === 'place-move'
        ? mdiImageMove
        : selectedAction === 'gps-update-from-place'
          ? mdiCrosshairsGps
          : cimmichEntityMediaActionIcon(selectedAction, currentSubject);

  const actionDescription = (selectedAction: MediaUiAction) =>
    selectedAction === 'place-move'
      ? `Moves the selected media out of ${currentScope?.displayName || 'this Place'} and into the chosen Place. GPS is unchanged.`
      : selectedAction === 'gps-update-from-place'
        ? 'Writes the chosen Place coordinates to the selected photos in Immich. Source files are not rewritten.'
        : '';

  const asError = (caught: unknown) =>
    caught instanceof Error ? caught.message : 'The action could not be completed.';

  const storeReceipt = (next: CimmichEntityMediaActionReceipt | null) => {
    const context = currentCimmichUndoReceiptContext();
    receiptContext = context;
    receipt = context ? next : null;
    saveCimmichEntityMediaActionReceipt(globalThis.localStorage, next, context);
  };

  $effect(() => {
    const context = currentCimmichUndoReceiptContext();
    if (!receiptLoaded || !sameCimmichUndoReceiptContext(receiptContext, context)) {
      receiptLoaded = true;
      receiptContext = context;
      receipt = loadCimmichEntityMediaActionReceipt(globalThis.localStorage, context);
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
      case 'place-move':
      case 'gps-update-from-place': {
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
            collections = [...(await getCimmichAssetLabels('', 250, 'collection'))].sort((left, right) =>
              left.displayName.localeCompare(right.displayName),
            );
            break;
          }
          case 'tag': {
            tags = [...(await getCimmichAssetLabels())].sort((left, right) =>
              left.displayName.localeCompare(right.displayName),
            );
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
    newOrganizationName = '';
  };
  const selectTarget = (option: ComboBoxOption | undefined) => {
    targetId = option?.value ?? '';
  };
  const createOrganizationTarget = async () => {
    const displayName = newOrganizationName.trim();
    if (!displayName || (action !== 'album-add' && action !== 'tag-add')) {
      return;
    }
    creatingOrganization = true;
    error = '';
    try {
      const kind = action === 'album-add' ? 'collection' : 'label';
      const result = await createCimmichAssetLabel(
        displayName,
        createCimmichAssetLabelCommandId(`entity-media-create-${kind}`),
        kind,
      );
      if (kind === 'collection') {
        collections = [...collections.filter(({ labelId }) => labelId !== result.label.labelId), result.label].sort(
          (left, right) => left.displayName.localeCompare(right.displayName),
        );
      } else {
        tags = [...tags.filter(({ labelId }) => labelId !== result.label.labelId), result.label].sort((left, right) =>
          left.displayName.localeCompare(right.displayName),
        );
      }
      targetOption = { id: result.label.labelId, label: result.label.displayName, value: result.label.labelId };
      targetId = result.label.labelId;
      newOrganizationName = '';
    } catch (error_) {
      error = `${asError(error_)} Nothing changed.`;
    } finally {
      creatingOrganization = false;
    }
  };

  const emptyReceipt = (
    selectedAction: CimmichEntityMediaActionKind,
    label: string,
  ): CimmichEntityMediaActionReceipt => ({
    action: selectedAction,
    assetCorrectionDecisionIds: [],
    assetIds: [],
    completedAt: new Date().toISOString(),
    contextDecisionIds: [],
    label,
    labelDecisionIds: [],
    presenceDecisionIds: [],
    targetId,
    version: 2,
    visibilityDecisionIds: [],
  });

  const apply = async () => {
    if (!canApply || !action) {
      return;
    }
    const selectedAction = action;
    const applyingCount = selectedCount;
    const baseLabel = actionLabel(selectedAction);
    const label = `${baseLabel}${targetLabel ? ` · ${targetLabel}` : ''}`;

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
    if (selectedAction === 'gps-update-from-place') {
      const place = places.find(({ entityId }) => entityId === targetId);
      const geometry = place?.geometry;
      if (!geometry || !('latitude' in geometry)) {
        error = 'Choose a Place with a saved point location. Nothing changed.';
        progress = '';
        busy = false;
        return;
      }
      try {
        await updateAssets({
          assetBulkUpdateDto: {
            ids: items.map(({ sourceAssetId }) => sourceAssetId),
            latitude: geometry.latitude,
            longitude: geometry.longitude,
          },
        });
        progress = `${applyingCount.toLocaleString()} ${applyingCount === 1 ? 'photo now uses' : 'photos now use'} ${place.displayName} GPS in Immich. Source files were not rewritten.`;
        action = null;
        actionGroup = null;
        targetId = '';
        targetOption = undefined;
        onClear();
        await onChanged?.();
      } catch (error_) {
        error = `${asError(error_)} Nothing changed.`;
        progress = '';
      } finally {
        busy = false;
      }
      return;
    }
    const receiptAction = (
      selectedAction === 'place-move' ? 'place-attach' : selectedAction
    ) as CimmichEntityMediaActionKind;
    const next = emptyReceipt(receiptAction, label);
    try {
      const visibilityTier = cimmichEntityMediaActionVisibilityTier(receiptAction);
      if (selectedAction === 'rotate-left' || selectedAction === 'rotate-right') {
        const result = await rotateCimmichAssets(
          items.map(({ assetId }) => assetId),
          selectedAction === 'rotate-left' ? 'left' : 'right',
        );
        next.assetCorrectionDecisionIds?.push(...(result.decisionIds ?? []));
        next.assetIds.push(...items.map(({ assetId }) => assetId));
      } else if (visibilityTier) {
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
      } else if (selectedAction === 'place-move' && currentScope?.family === 'places') {
        const attached = await attachCimmichContextAssets(
          'places',
          targetId,
          createCimmichContextCommandId('entity-media-move-attach'),
          items.map(({ assetId }) => ({ assetId, associationKind: 'captured_at' })),
        );
        if (attached.decisionId && attached.undo?.eligible) {
          next.contextDecisionIds.push(attached.decisionId);
          next.assetIds.push(...(attached.changedAssetIds ?? items.map(({ assetId }) => assetId)));
          storeReceipt(next);
        }
        const detached = await detachCimmichContextAssets(
          'places',
          currentScope.entityId,
          createCimmichContextCommandId('entity-media-move-detach'),
          items.map(({ assetId }) => assetId),
        );
        if (detached.decisionId && detached.undo?.eligible) {
          next.contextDecisionIds.push(detached.decisionId);
          next.assetIds.push(...(detached.changedAssetIds ?? items.map(({ assetId }) => assetId)));
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
      } else if (
        selectedAction === 'album-add' ||
        selectedAction === 'tag-add' ||
        selectedAction === 'tag-remove' ||
        selectedAction === 'favorite' ||
        selectedAction === 'unfavorite' ||
        selectedAction === 'archive' ||
        selectedAction === 'unarchive'
      ) {
        const systemKind =
          selectedAction === 'favorite' || selectedAction === 'unfavorite'
            ? 'favorite'
            : selectedAction === 'archive' || selectedAction === 'unarchive'
              ? 'archive'
              : null;
        const systemLabels = systemKind ? await getCimmichAssetLabels('', 1, systemKind) : [];
        const organizationTargetId = systemKind ? systemLabels[0]?.labelId : targetId;
        if (!organizationTargetId) {
          throw new Error('Cimmich organisation state is not ready');
        }
        const membershipAction = ['tag-remove', 'unfavorite', 'unarchive'].includes(selectedAction)
          ? 'detach'
          : 'attach';
        const result = await changeCimmichAssetLabelMembership(
          organizationTargetId,
          membershipAction,
          items.map(({ assetId }) => assetId),
          createCimmichAssetLabelCommandId('entity-media-organisation'),
        );
        if (result.changedAssetIds.length > 0) {
          next.labelDecisionIds.push(result.decisionId);
          next.assetIds.push(...result.changedAssetIds);
        }
      }

      const changedCount = new Set(next.assetIds).size;
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
        (next.assetCorrectionDecisionIds?.length ?? 0) > 0 ||
        next.contextDecisionIds.length > 0 ||
        next.labelDecisionIds.length > 0 ||
        next.presenceDecisionIds.length > 0 ||
        next.visibilityDecisionIds.length > 0;
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
      if (receipt.assetCorrectionDecisionIds?.length) {
        await undoCimmichAssetCorrections(receipt.assetCorrectionDecisionIds);
      }
      for (const decisionId of receipt.contextDecisionIds) {
        await undoCimmichContextDecision(decisionId, createCimmichContextCommandId('entity-media-undo'));
      }
      for (const decisionId of receipt.presenceDecisionIds) {
        await undoCimmichManualPresence(decisionId, createCimmichManualPresenceCommandId('entity-media-undo'));
      }
      for (const decisionId of receipt.visibilityDecisionIds) {
        await undoCimmichVisibilityDecision(decisionId, createCimmichVisibilityCommandId('entity-media-undo'));
      }
      for (const decisionId of [...receipt.labelDecisionIds].reverse()) {
        await undoCimmichAssetLabelDecision(decisionId, createCimmichAssetLabelCommandId('entity-media-undo'));
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
    storeReceipt(null);
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
          <Icon icon={mdiUndoVariant} size="17" /> Undo last
        </button>
        <button type="button" disabled={busy} onclick={dismissReceipt}>Keep changes</button>
      </div>
    {/if}

    {#if showControls}
      <div class="entity-media-workspace">
        <div class="entity-media-toolbar" role="toolbar" aria-label="Selected photo actions">
          <strong class="entity-media-count">{selectedCount.toLocaleString()} selected</strong>
          <div class="entity-media-selection-tools">
            {#if selectedCount > 0}
              <CimmichLocalAiAction
                sourceAssetIds={items.map(({ sourceAssetId }) => sourceAssetId)}
                variant="toolbar"
              />
            {/if}
            {#if onSelectShown}
              <Tooltip text="Select shown">
                {#snippet child({ props })}
                  <button
                    {...props}
                    class="entity-media-tool"
                    type="button"
                    aria-label="Select shown"
                    disabled={busy || Boolean(receipt)}
                    onclick={onSelectShown}
                  >
                    <Icon icon={mdiSelectAll} size="20" />
                  </button>
                {/snippet}
              </Tooltip>
            {/if}
            <Tooltip text="Clear selection">
              {#snippet child({ props })}
                <button
                  {...props}
                  class="entity-media-tool"
                  type="button"
                  aria-label="Clear selection"
                  disabled={busy || selectedCount === 0}
                  onclick={onClear}
                >
                  <Icon icon={mdiClose} size="20" />
                </button>
              {/snippet}
            </Tooltip>
          </div>

          <span class="entity-media-divider" aria-hidden="true"></span>

          <div class="entity-media-category-tools" aria-label="Action categories">
            {#each actionGroups as group (group.id)}
              <Tooltip text={group.label}>
                {#snippet child({ props })}
                  <button
                    {...props}
                    class:entity-media-group--active={actionGroup === group.id}
                    class="entity-media-group"
                    type="button"
                    aria-label={group.label}
                    aria-pressed={actionGroup === group.id}
                    disabled={busy || Boolean(receipt) || selectedCount === 0}
                    onclick={() => selectGroup(group.id)}
                  >
                    <Icon icon={group.icon} size="21" />
                  </button>
                {/snippet}
              </Tooltip>
            {/each}
          </div>
        </div>

        {#if actionGroup}
          <div class="entity-media-panel">
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
                  {#if actionDescription(action)}<p>{actionDescription(action)}</p>{/if}
                </div>
                {#if needsTarget}
                  <div class="entity-media-combobox-field">
                    {#if action === 'album-add' || action === 'tag-add'}
                      <div class="entity-media-create-target">
                        <input
                          bind:value={newOrganizationName}
                          aria-label={action === 'album-add' ? 'New Cimmich collection name' : 'New Cimmich tag name'}
                          placeholder={action === 'album-add' ? 'Create collection' : 'Create tag'}
                          disabled={busy || creatingOrganization || Boolean(receipt)}
                        />
                        <button
                          type="button"
                          onclick={() => void createOrganizationTarget()}
                          disabled={!newOrganizationName.trim() || busy || creatingOrganization || Boolean(receipt)}
                          >{creatingOrganization ? 'Creating…' : 'Create'}</button
                        >
                      </div>
                    {/if}
                    <Combobox
                      label={action === 'place-move-within'
                        ? 'Destination subsection'
                        : action === 'gps-update-from-place'
                          ? 'GPS source Place'
                          : 'Destination'}
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
            {/if}
          </div>
        {/if}
      </div>
    {/if}

    {#if progress}<p class="entity-media-progress" role="status">{progress}</p>{/if}
    {#if error}
      <p class="entity-media-error" role="alert"><Icon icon={mdiAlertCircleOutline} size="18" /> {error}</p>
    {/if}
  </section>
{/if}
