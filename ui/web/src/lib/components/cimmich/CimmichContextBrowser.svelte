<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import CimmichDocuments from './CimmichDocuments.svelte';
  import CimmichContextCollection from './CimmichContextCollection.svelte';
  import CimmichPlaceCollectionControls from './CimmichPlaceCollectionControls.svelte';
  import CimmichContextDetailHero from './CimmichContextDetailHero.svelte';
  import CimmichPlaceCanvas from './CimmichPlaceCanvas.svelte';
  import CimmichPlacePlan from './CimmichPlacePlan.svelte';
  import CimmichContextPlaceMap from './CimmichContextPlaceMap.svelte';
  import CimmichEntityMediaActions from './CimmichEntityMediaActions.svelte';
  import CimmichDuplicateIndicator from './CimmichDuplicateIndicator.svelte';
  import { handleCimmichMediaCardClick } from './media-card-selection';
  import { cimmichPlaceChildCoverAssetId } from './place-child-cover';
  import { cimmichPlaceAssetSectionNames } from './place-media-section';
  import {
    groupPlacePhotos,
    placePhotoGridClass,
    preparePlacePhotos,
    type PlacePhotoGroup,
    type PlacePhotoSize,
    type PlacePhotoSort,
  } from './place-photo-gallery';
  import CimmichSectionHeader from './CimmichSectionHeader.svelte';
  import CimmichObjectVisibility from './CimmichObjectVisibility.svelte';
  import CimmichPlaceDeleteDialog from './CimmichPlaceDeleteDialog.svelte';
  import { focusTrap } from '$lib/actions/focus-trap';
  import { keyboardTabs } from './keyboard-tabs';
  import { cimmichVisibilityManager } from '$lib/managers/cimmich-visibility-manager.svelte';
  import {
    CimmichServiceError,
    assignCimmichPlaceAssetsToChild,
    attachCimmichContextAssets,
    attachCimmichContextRelations,
    createCimmichContextCommandId,
    createCimmichContextEntity,
    deleteCimmichObject,
    deleteCimmichPlace,
    detachCimmichContextAssets,
    detachCimmichContextRelations,
    getCimmichAssetEvidence,
    getCimmichContextEntities,
    getCimmichContextEntity,
    getCimmichPlacePlans,
    getCimmichPeople,
    getCimmichPetMedia,
    getCimmichPets,
    getCimmichVisibleMapAssetBindings,
    searchCimmichAddresses,
    saveCimmichPlacePlan,
    setCimmichEventCover,
    setCimmichObjectCover,
    setCimmichPlaceCover,
    undoCimmichContextDecision,
    updateCimmichContextEntity,
    type CimmichContextDetail,
    type CimmichContextDatePrecision,
    type CimmichContextEntity,
    type CimmichContextFamily,
    type CimmichContextGeometry,
    type CimmichContextGeometryProvenance,
    type CimmichContextTypeKind,
    type CimmichPlaceRole,
    type CimmichAddressGeocodingItem,
    type CimmichAddressGeocodingResult,
    type CimmichContextRelation,
    type CimmichPlaceRollupAsset,
    type CimmichPlacePlan as CimmichPlacePlanRecord,
    type CimmichPlacePlanSaveInput,
  } from '$lib/services/cimmich.service';
  import { ENTITY_MEDIA_SELECTION_LIMIT, type CimmichEntityMediaItem } from './entity-media-actions';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize, getMapMarkers, searchAssets, type AssetResponseDto } from '@immich/sdk';
  import { Icon, toastManager } from '@immich/ui';
  import { SvelteURLSearchParams } from 'svelte/reactivity';
  import { onDestroy, untrack } from 'svelte';
  import {
    mdiArrowLeft,
    mdiArrowRight,
    mdiArrowDown,
    mdiArrowUp,
    mdiCalendarBlankOutline,
    mdiCheck,
    mdiChevronRight,
    mdiClose,
    mdiCogOutline,
    mdiContentCopy,
    mdiDotsVertical,
    mdiFileDocumentOutline,
    mdiFloorPlan,
    mdiFolderMultipleOutline,
    mdiFilterVariant,
    mdiGroup,
    mdiImageMultipleOutline,
    mdiLinkPlus,
    mdiMagnify,
    mdiMapMarkerOutline,
    mdiMapOutline,
    mdiPackageVariantClosed,
    mdiPlus,
    mdiSelectAll,
    mdiSortVariant,
    mdiTrashCanOutline,
    mdiUndoVariant,
    mdiViewGridOutline,
  } from '@mdi/js';
  import {
    contextAssociationKinds,
    contextAssociationLabel,
    contextAssetViewerHref,
    contextFamilyFromDetailParams,
    contextFamilyKind,
    contextFamilyLabels,
    contextRouteLoadSignature,
    contextRequestedEntityId,
    contextPlaceCountryLabel,
    contextGeographySubdivisionName,
    getContextCollectionHref,
    getContextDetailHref,
    getContextGeographyGroupHref,
    resolveContextRouteEntity,
    contextPlaceSearchQualityLabel,
    contextPlaceDescendants,
    contextPlaceLineage,
    contextPlaceNearbyRadii,
    contextPlacePointDistanceMeters,
    contextRelationGroups,
    eventTypeFilters,
    objectTypeFilters,
    contextTypeDescription,
    contextTypeLabel,
    contextTypeKinds,
    defaultContextRelationDraft,
    filterContextRelationTargets,
    filterContextEntitiesByType,
    formatContextPlaceDistance,
    humanizeContextKind,
    parseContextPlaceCoordinates,
    resolveContextEditorMutation,
    sortContextPlaceSearchResults,
    type ContextTypeFilter,
  } from './context-entity-presentation';
  import {
    eventAssetBelongsToFolder,
    eventCopyName,
    eventFolderAdmission,
    eventFolderCandidates,
    eventFolderLabel,
    eventLineage,
  } from './event-folder-graph';

  interface Props {
    families: CimmichContextFamily[];
  }

  let { families }: Props = $props();

  // The named /cimmich/places/[entityName] route is canonical for Places and
  // Things; ?entityId= remains supported so links shared before the route
  // existed still resolve. A detail URL states its family through its id param
  // (?placeId= / ?thingId=), which is why that is checked before ?family=.
  const requestedEntityName = $derived((page.data as { entityName?: string }).entityName ?? '');
  const resolveRequestedFamily = (): CimmichContextFamily | null =>
    contextFamilyFromDetailParams(page.url.searchParams, families) ??
    (families.includes(page.url.searchParams.get('family') as CimmichContextFamily)
      ? (page.url.searchParams.get('family') as CimmichContextFamily)
      : null);

  let activeFamily = $state<CimmichContextFamily>(untrack(() => resolveRequestedFamily() ?? families[0]));
  const routeLoadSignature = $derived(
    contextRouteLoadSignature({
      activeFamily,
      allowedFamilies: families,
      entityName: requestedEntityName,
      searchParams: page.url.searchParams,
      visibilityVersion: cimmichVisibilityManager.version,
    }),
  );
  let entities = $state<CimmichContextEntity[]>([]);
  let error = $state<CimmichServiceError | null>(null);
  let loaded = $state(false);
  let query = $state('');
  let collectionSearchTimeout: ReturnType<typeof globalThis.setTimeout> | undefined;
  let selected = $state<CimmichContextDetail | null>(null);
  let selectedPlacePlans = $state<CimmichPlacePlanRecord[]>([]);
  let selectedGeographyGroup = $state('');
  let selectedGeographyGroupEntityIds = $state<string[]>([]);
  let selectedLoading = $state(false);
  let showEditor = $state(false);
  let showAssetPicker = $state(false);
  let showRelationPicker = $state(false);
  let editorMode = $state<'create' | 'edit'>('create');
  let editorTarget = $state<{ entityId: string; revision: number } | null>(null);
  let editorTypeChosen = $state(false);
  let isSaving = $state(false);
  let editorError = $state('');
  let assetError = $state('');
  let libraryAssets = $state<AssetResponseDto[]>([]);
  let libraryLoaded = $state(false);
  let libraryLoading = $state(false);
  let libraryQuery = $state('');
  let assetPickerMode = $state<'folders' | 'library' | 'nearby'>('library');
  let assetPickerPurpose = $state<'attach' | 'seed-event'>('attach');
  let nearbyAssets = $state<
    Array<{ distanceMeters: number; latitude: number; longitude: number; sourceAssetId: string }>
  >([]);
  let nearbyError = $state('');
  let nearbyLoading = $state(false);
  let nearbyRadius = $state<(typeof contextPlaceNearbyRadii)[number]['value']>(100);
  let nearbyGeneration = 0;
  let showPhotoLocationPicker = $state(false);
  let photoLocationAssets = $state<
    Array<{ filename: string; latitude: number; longitude: number; sourceAssetId: string }>
  >([]);
  let photoLocationError = $state('');
  let photoLocationLoading = $state(false);
  let photoLocationGeneration = 0;
  let placeLocationPhotoName = $state('');
  let selectedSourceIds = $state<string[]>([]);
  let eventSeedSourceIds = $state<string[]>([]);
  let eventSeedAttachCommandId = $state('');
  let folderQuery = $state('');
  let folderSearchAssets = $state<AssetResponseDto[]>([]);
  let folderSearchLoading = $state(false);
  let folderSearchStarted = $state(false);
  let folderError = $state('');
  let selectedFolderPaths = $state<string[]>([]);
  let folderAssetIds = $state<Record<string, string[]>>({});
  let associationKind = $state('manual');
  let undoDecisionId = $state<string | null>(null);
  let showArchived = $state(false);
  let editorCommandId = $state('');
  let editorForm = $state<HTMLFormElement | undefined>();
  let continueWithAnotherEvent = $state(false);
  let assetAttachCommandId = $state('');
  let detachCommandIds = $state<Record<string, string>>({});
  let mediaMenuAssetId = $state<string | null>(null);
  let undoCommandId = $state('');
  let undoLabel = $state('Undo last change');
  let statusCommandId = $state('');
  let relationCommandId = $state('');
  let relationPickerPurpose = $state<'connection' | 'trip-stop'>('connection');
  let relationKind = $state('related');
  let relationTargetKind = $state<'event' | 'object' | 'person' | 'pet' | 'place'>('place');
  let relationTargetId = $state('');
  let relationTargetQuery = $state('');
  let relationTargets = $state<Array<{ id: string; name: string }>>([]);
  let relationTargetsLoading = $state(false);
  let relationError = $state('');
  let connectionPresentations = $state<Record<string, { objectPosition: string; sourceAssetId: string | null }>>({});
  let connectionPresentationGeneration = 0;
  let connectionPresentationKey = '';
  let eventMediaLane = $state<'adjacent' | 'all' | 'main' | 'needs_check' | 'stops'>('main');
  let placeMediaLane = $state<'all' | 'unassigned' | string>('all');
  let placePhotoGroup = $state<PlacePhotoGroup>('none');
  let placePhotoSize = $state<PlacePhotoSize>('medium');
  let placePhotoSort = $state<PlacePhotoSort>('newest');
  let selectedPlaceAssetIds = $state<string[]>([]);
  let mediaSelectionMode = $state(false);
  let showDeleteContext = $state(false);
  let showCollectionFilters = $state(false);
  let collectionTypeFilter = $state<ContextTypeFilter>('all');
  let placeCollectionView = $state<'atlas' | 'geography' | 'gps' | 'locations'>('locations');
  let placeGroupMode = $state<'country' | 'duplicates' | 'none'>('country');
  let placeSortMode = $state<'name' | 'photos-asc' | 'photos-desc'>('name');
  let deleteContextError = $state('');
  let deleteContextCommandId = $state('');

  const relatedIds = $derived(
    new Set(
      (page.url.searchParams.get('relatedIds') ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  );
  const relatedFrom = $derived(page.url.searchParams.get('relatedFrom') ?? '');
  const displayedEntities = $derived(
    relatedIds.size === 0 ? entities : entities.filter((entity) => relatedIds.has(entity.entityId)),
  );

  let formName = $state('');
  let formGeographyGroupName = $state('');
  let formType = $state<CimmichContextTypeKind>('unlocated');
  let formDescription = $state('');
  let formAliases = $state('');
  let formDatePrecision = $state<CimmichContextDatePrecision>('unknown');
  let formDateStart = $state('');
  let formDateEnd = $state('');
  let formRecurrenceEnabled = $state(false);
  let formRecurrenceFrequency = $state<'daily' | 'monthly' | 'weekly' | 'yearly'>('weekly');
  let formRecurrenceInterval = $state(1);
  let formRecurrenceWeekdays = $state<number[]>([1]);
  let formSourceFolders = $state<string[]>([]);
  let formParentId = $state('');
  let formPlaceRole = $state<CimmichPlaceRole>('location');
  let formGeographyEntityId = $state('');
  let formDirectoryVisibility = $state<'listed' | 'nested_only'>('listed');
  let formLatitude = $state('');
  let formLongitude = $state('');
  let formNorth = $state('');
  let formSouth = $state('');
  let formEast = $state('');
  let formWest = $state('');
  let formRoute = $state('');
  let formGeometryProvenance = $state<CimmichContextGeometryProvenance>('manual');
  let formGeometryUncertainty = $state('');
  let formMapPoints = $state<Array<{ lat: number; lng: number }>>([]);
  let formAreaUsesPoints = $state(false);
  let showPreciseGeometry = $state(false);
  let placeSearchQuery = $state('');
  let placeSearchResults = $state<CimmichAddressGeocodingItem[]>([]);
  let placeSearchLoading = $state(false);
  let placeSearchError = $state('');
  let placeSearchCenter = $state<{ lat: number; lng: number } | undefined>();
  let placeSearchZoom = $state<number | undefined>();
  let placeSearchAttribution = $state<CimmichAddressGeocodingResult['attribution'] | undefined>();
  let placeSearchTimeout: ReturnType<typeof globalThis.setTimeout> | undefined;
  let placeSearchGeneration = 0;

  const entityKind = $derived(contextFamilyKind[activeFamily]);
  const entityNoun = $derived(entityKind === 'object' ? 'thing' : entityKind);
  const addLabel = $derived(
    activeFamily === 'events'
      ? 'Add event'
      : activeFamily === 'places' && placeCollectionView === 'geography'
        ? 'Add geography'
        : `Add ${entityNoun}`,
  );
  const collectionTitle = $derived(contextFamilyLabels[activeFamily]);
  const collectionCount = $derived(
    activeFamily === 'places'
      ? displayedEntities.length
      : filterContextEntitiesByType(displayedEntities, collectionTypeFilter).length,
  );
  const collectionMeta = $derived(
    `${collectionCount.toLocaleString()} ${
      collectionCount === 1
        ? activeFamily === 'objects'
          ? 'thing'
          : contextFamilyLabels[activeFamily].slice(0, -1).toLocaleLowerCase()
        : contextFamilyLabels[activeFamily].toLocaleLowerCase()
    }`,
  );
  const collectionTypeFilters = $derived(activeFamily === 'objects' ? objectTypeFilters : eventTypeFilters);
  const filteredLibraryAssets = $derived(
    libraryAssets.filter((asset) => asset.originalFileName.toLowerCase().includes(libraryQuery.trim().toLowerCase())),
  );
  const folderCandidates = $derived(
    eventFolderCandidates(folderSearchStarted ? folderSearchAssets : libraryAssets).slice(0, 16),
  );
  const selectedAssetIds = $derived(
    new Set(
      (activeFamily === 'places' ? selected?.subtreeAssets : selected?.assets)?.map((asset) => asset.sourceAssetId),
    ),
  );
  const selectedIsGeographyGroup = $derived(Boolean(selectedGeographyGroup));
  const selectedGeographyGroupRoot = $derived(
    selectedGeographyGroup
      ? (entities.find(
          (entity) =>
            entity.placeRole === 'geography' &&
            entity.displayName.trim().toLocaleLowerCase() === selectedGeographyGroup.trim().toLocaleLowerCase(),
        ) ?? null)
      : null,
  );
  const selectedPlaceChildren = $derived.by(() => {
    if (activeFamily !== 'places' || !selected) {
      return [];
    }
    if (!selectedGeographyGroup) {
      return entities
        .filter((entity) => entity.parentEntityId === selected?.entity.entityId && entity.status === 'active')
        .sort((left, right) => left.displayName.localeCompare(right.displayName));
    }
    const memberIds = new Set(selectedGeographyGroupEntityIds);
    const countryRoot = entities.find(
      (entity) =>
        memberIds.has(entity.entityId) &&
        entity.displayName.trim().toLocaleLowerCase() === selectedGeographyGroup.trim().toLocaleLowerCase(),
    );
    return entities
      .filter(
        (entity) =>
          memberIds.has(entity.entityId) &&
          entity.entityId !== countryRoot?.entityId &&
          (!entity.parentEntityId ||
            entity.parentEntityId === countryRoot?.entityId ||
            !memberIds.has(entity.parentEntityId)),
      )
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  });
  const placeChildNames = (entityId: string) =>
    entities
      .filter((entity) => entity.parentEntityId === entityId && entity.status === 'active')
      .sort((left, right) => left.displayName.localeCompare(right.displayName))
      .map((entity) => entity.displayName)
      .join(' · ');
  const selectedPlaceMoveTargets = $derived(
    activeFamily === 'places' && selected ? contextPlaceDescendants(selected.entity, entities) : [],
  );
  const selectedPlaceLineage = $derived(
    activeFamily === 'places' && selected ? contextPlaceLineage(selected.entity, entities) : [],
  );
  const effectiveLocationGeographyId = (location: CimmichContextEntity | undefined) => {
    let current: CimmichContextEntity | undefined = location;
    const visited = new SvelteSet<string>();
    while (current && !visited.has(current.entityId)) {
      visited.add(current.entityId);
      if (current.geographyEntityId) {
        return current.geographyEntityId;
      }
      current = current.parentEntityId
        ? entities.find((entity) => entity.entityId === current?.parentEntityId)
        : undefined;
    }
    return null;
  };
  const selectedGeographyLocations = $derived(
    activeFamily === 'places' && selected?.entity.placeRole === 'geography'
      ? entities
          .filter((entity) => {
            if (entity.placeRole !== 'location') {
              return false;
            }
            const geographyId = effectiveLocationGeographyId(entity);
            return selectedGeographyGroup
              ? selectedGeographyGroupEntityIds.includes(geographyId ?? '')
              : geographyId === selected?.entity.entityId;
          })
          .sort((left, right) => left.displayName.localeCompare(right.displayName))
      : [],
  );
  const nearbyPlacePoint = $derived.by(() => {
    const geometry = selected?.entity.geometry;
    return activeFamily === 'places' && selected?.entity.typeKind === 'point' && geometry && 'latitude' in geometry
      ? geometry
      : null;
  });
  const nearbyMapMarkers = $derived(
    nearbyAssets.map((asset) => ({
      city: null,
      country: null,
      id: asset.sourceAssetId,
      lat: asset.latitude,
      lon: asset.longitude,
      state: null,
    })),
  );
  const nearbyPlaceMarkers = $derived(
    nearbyPlacePoint && selected
      ? [
          {
            id: selected.entity.entityId,
            lat: nearbyPlacePoint.latitude,
            lon: nearbyPlacePoint.longitude,
            name: selected.entity.displayName,
            parentName: '',
          },
        ]
      : [],
  );
  const photoLocationMapMarkers = $derived(
    photoLocationAssets.map((asset) => ({
      city: null,
      country: null,
      id: asset.sourceAssetId,
      lat: asset.latitude,
      lon: asset.longitude,
      state: null,
    })),
  );
  const visibleDetailAssets = $derived.by(() => {
    if (!selected) {
      return [];
    }
    if (entityKind === 'place') {
      const assets = selected.subtreeAssets ?? selected.assets;
      if (placeMediaLane === 'all' || !selected.subtreeAssets) {
        return assets;
      }
      return selected.subtreeAssets.filter((asset) =>
        placeMediaLane === 'unassigned'
          ? asset.directlyAssigned && asset.branchEntityIds.length === 0
          : asset.branchEntityIds.includes(placeMediaLane),
      );
    }
    if (entityKind !== 'event' || eventMediaLane === 'all') {
      return selected.assets;
    }
    return selected.assets.filter((asset) =>
      eventMediaLane === 'main'
        ? asset.associationKind === 'direct' || asset.associationKind === 'manual'
        : eventMediaLane === 'stops'
          ? asset.associationKind === 'route_stop'
          : eventMediaLane === 'needs_check'
            ? asset.associationKind === 'needs_check'
            : asset.associationKind === 'context',
    );
  });
  const presentedDetailAssets = $derived(
    entityKind === 'place' ? preparePlacePhotos(visibleDetailAssets, placePhotoSort) : visibleDetailAssets,
  );
  const groupedDetailAssets = $derived(
    entityKind === 'place'
      ? groupPlacePhotos(presentedDetailAssets, placePhotoGroup, selectedPlaceChildren)
      : [{ id: 'all', items: presentedDetailAssets, label: null }],
  );
  $effect(() => {
    if (placePhotoGroup === 'subsection' && selectedPlaceChildren.length === 0) {
      placePhotoGroup = 'none';
    }
  });
  const eventMediaLaneCounts = $derived.by(() => {
    const assets = selected?.assets ?? [];
    return {
      all: assets.length,
      main: assets.filter((asset) => asset.associationKind === 'direct' || asset.associationKind === 'manual').length,
      adjacent: assets.filter((asset) => asset.associationKind === 'context').length,
      needs_check: assets.filter((asset) => asset.associationKind === 'needs_check').length,
      stops: assets.filter((asset) => asset.associationKind === 'route_stop').length,
    };
  });
  const eventMediaLaneDescription = $derived(
    eventMediaLane === 'main'
      ? 'The defining photos and videos you explicitly placed in this memory.'
      : eventMediaLane === 'stops'
        ? 'Media attached to Places along this trip or route.'
        : eventMediaLane === 'adjacent'
          ? 'Useful adjacent time or location context kept separate from the main memory.'
          : eventMediaLane === 'needs_check'
            ? 'Candidates waiting for your decision. They are not Main media until you promote them.'
            : 'Everything linked to this memory, with each relationship still visible.',
  );
  const placeDetailAssetCount = $derived(
    activeFamily === 'places' ? (selected?.subtreeAssets?.length ?? selected?.assets.length ?? 0) : 0,
  );
  const placeBulkSelectionLimit = ENTITY_MEDIA_SELECTION_LIMIT;
  const selectedEntityMediaItems = $derived<CimmichEntityMediaItem[]>(
    visibleDetailAssets
      .filter((asset) => selectedPlaceAssetIds.includes(asset.assetId))
      .map((asset) => ({
        assetId: asset.assetId,
        directlyAssigned: !('directlyAssigned' in asset) || asset.directlyAssigned === true,
        filename: asset.filename,
        sourceAssetId: asset.sourceAssetId,
      })),
  );
  const visibleRelationGroups = $derived(contextRelationGroups(activeFamily, selected?.relations ?? []));
  const selectedEventStops = $derived.by(() =>
    (selected?.relations ?? [])
      .filter((relation) => relation.relationKind === 'location' && relation.targetKind === 'place')
      .sort(
        (left, right) =>
          (left.sortOrder ?? Number.MAX_SAFE_INTEGER) - (right.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
          left.linkedAt.localeCompare(right.linkedAt) ||
          left.targetName.localeCompare(right.targetName),
      ),
  );
  const selectedEventLineage = $derived(
    activeFamily === 'events' && selected ? (selected.eventLineage ?? eventLineage(selected.entity, entities)) : [],
  );
  const selectedEventChildren = $derived(
    activeFamily === 'events' && selected
      ? (selected.eventChildren ??
          entities
            .filter((entity) => entity.parentEntityId === selected?.entity.entityId && entity.status === 'active')
            .sort(
              (left, right) =>
                (left.dateStart ?? '').localeCompare(right.dateStart ?? '') ||
                left.displayName.localeCompare(right.displayName),
            ))
      : [],
  );
  const eventParentChoices = $derived(
    entities
      .filter(
        (candidate) =>
          candidate.entityKind === 'event' &&
          candidate.status === 'active' &&
          candidate.entityId !== editorTarget?.entityId &&
          (!editorTarget ||
            !eventLineage(candidate, entities).some((ancestor) => ancestor.entityId === editorTarget?.entityId)),
      )
      .sort((left, right) => left.displayName.localeCompare(right.displayName)),
  );
  type ContextDetailTab = 'connections' | 'documents' | 'journey' | 'map' | 'plan' | 'photos';
  const detailTabs = $derived<Array<{ icon: string; label: string; value: ContextDetailTab }>>([
    { icon: mdiImageMultipleOutline, label: 'Photos', value: 'photos' },
    ...(activeFamily === 'events' && selected?.entity.typeKind === 'trip'
      ? [{ icon: mdiMapMarkerOutline, label: 'Journey', value: 'journey' } as const]
      : []),
    ...(activeFamily === 'places' ? [{ icon: mdiMapOutline, label: 'Map', value: 'map' } as const] : []),
    ...(activeFamily === 'places' && selected?.entity.placeRole === 'location'
      ? [{ icon: mdiFloorPlan, label: 'Plan', value: 'plan' } as const]
      : []),
    ...(selectedIsGeographyGroup
      ? []
      : [
          { icon: mdiLinkPlus, label: 'Connections', value: 'connections' } as const,
          { icon: mdiFileDocumentOutline, label: 'Documents', value: 'documents' } as const,
        ]),
  ]);
  const activeDetailTab = $derived.by<ContextDetailTab>(() => {
    const requested = page.url.searchParams.get('tab') as ContextDetailTab | null;
    return detailTabs.some((tab) => tab.value === requested) ? requested! : 'photos';
  });
  const relationKinds = $derived(
    entityKind === 'event'
      ? ['participant', 'companion', 'location', 'object', 'parent', 'related']
      : entityKind === 'place'
        ? ['parent', 'related']
        : ['related'],
  );
  const eventDateLabels = $derived.by(() => {
    if (formType === 'trip') {
      return { end: 'Returns', start: 'Leaves' };
    }
    if (formType === 'activity') {
      return { end: 'Until', start: 'Begins' };
    }
    if (formType === 'life_period') {
      return { end: 'Ends', start: 'Begins' };
    }
    return { end: 'Ends', start: 'Starts' };
  });
  const eventCreationGuidance = $derived.by(() => {
    if (formType === 'trip') {
      return 'Set the journey window now. After creation, add Places as ordered stops and keep stop media separate from the main story.';
    }
    if (formType === 'activity') {
      return 'Use the dates for the span in which this activity happened. Individual occurrences stay visible through their linked media.';
    }
    if (formType === 'life_period') {
      return 'Approximate or open-ended dates are welcome. Choose representative media rather than trying to include every photo.';
    }
    return 'Name the occasion and its honest time boundary. You can add People, Pets, Places and Things immediately afterwards.';
  });
  const filteredRelationTargets = $derived(filterContextRelationTargets(relationTargets, relationTargetQuery));
  const selectedRelationTarget = $derived(relationTargets.find((target) => target.id === relationTargetId) ?? null);

  const iconForFamily = (family: CimmichContextFamily) => {
    if (family === 'places') {
      return mdiMapMarkerOutline;
    }
    if (family === 'objects') {
      return mdiPackageVariantClosed;
    }
    return mdiCalendarBlankOutline;
  };

  const contextTargetLabel = (kind: 'event' | 'object' | 'person' | 'pet' | 'place') =>
    kind === 'object' ? 'Thing' : humanizeContextKind(kind);

  const updateSelectedVisibility = (visibility: NonNullable<CimmichContextEntity['visibility']>) => {
    if (!selected) {
      return;
    }
    const entity = { ...selected.entity, visibility };
    selected = { ...selected, entity };
    entities = entities.map((candidate) => (candidate.entityId === entity.entityId ? entity : candidate));
  };

  const asError = (caught: unknown) =>
    caught instanceof CimmichServiceError
      ? caught
      : new CimmichServiceError(caught instanceof Error ? caught.message : 'Cimmich could not complete this request.', {
          code: 'CIMMICH_REQUEST_FAILED',
          status: 0,
        });

  let listRequestGeneration = 0;
  let detailRequestGeneration = 0;

  const geographyGroupMembers = (groupName: string, candidates: CimmichContextEntity[]) => {
    const memberIds = new SvelteSet(
      candidates
        .filter(
          (entity) =>
            entity.status === 'active' &&
            entity.placeRole === 'geography' &&
            contextPlaceCountryLabel(entity).toLocaleLowerCase() === groupName.trim().toLocaleLowerCase(),
        )
        .map((entity) => entity.entityId),
    );
    let changed = true;
    while (changed) {
      changed = false;
      for (const entity of candidates) {
        if (
          entity.status === 'active' &&
          entity.placeRole === 'geography' &&
          entity.parentEntityId &&
          memberIds.has(entity.parentEntityId) &&
          !memberIds.has(entity.entityId)
        ) {
          memberIds.add(entity.entityId);
          changed = true;
        }
      }
    }
    return candidates.filter((entity) => memberIds.has(entity.entityId));
  };

  const openGeographyGroup = async (groupName: string, candidates: CimmichContextEntity[] = entities) => {
    const generation = ++detailRequestGeneration;
    selectedLoading = true;
    eventMediaLane = 'main';
    placeMediaLane = 'all';
    selectedPlaceAssetIds = [];
    mediaSelectionMode = false;
    error = null;
    try {
      const members = geographyGroupMembers(groupName, candidates);
      if (members.length === 0) {
        throw new Error(`No Geography is currently grouped under ${groupName}.`);
      }
      const settled = await Promise.allSettled(
        members.map((entity) => getCimmichContextEntity('places', entity.entityId)),
      );
      const details = settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
      if (details.length === 0) {
        throw new Error(`${groupName} could not load its Geography records.`);
      }
      const memberIds = new SvelteSet(members.map((entity) => entity.entityId));
      const countryRoot = members.find(
        (entity) => entity.displayName.trim().toLocaleLowerCase() === groupName.trim().toLocaleLowerCase(),
      );
      const topLevelMemberId = (member: CimmichContextEntity) => {
        let current = member;
        const visited = new SvelteSet<string>();
        while (
          current.parentEntityId &&
          current.parentEntityId !== countryRoot?.entityId &&
          memberIds.has(current.parentEntityId) &&
          !visited.has(current.entityId)
        ) {
          visited.add(current.entityId);
          current = members.find((candidate) => candidate.entityId === current.parentEntityId) ?? current;
        }
        return current.entityId === countryRoot?.entityId ? null : current.entityId;
      };
      const assetsBySourceId = new SvelteMap<string, CimmichPlaceRollupAsset>();
      for (const detail of details) {
        const topEntityId = topLevelMemberId(detail.entity);
        for (const asset of detail.assets) {
          const existing = assetsBySourceId.get(asset.sourceAssetId);
          const assignedEntityIds = [...new Set([...(existing?.assignedEntityIds ?? []), detail.entity.entityId])];
          const branchEntityIds = [
            ...new Set([...(existing?.branchEntityIds ?? []), ...(topEntityId ? [topEntityId] : [])]),
          ];
          assetsBySourceId.set(asset.sourceAssetId, {
            ...(existing ?? asset),
            assignedEntityIds,
            associationId: `geography-group:${groupName}:${asset.assetId}`,
            branchEntityIds,
            directlyAssigned: false,
          });
        }
      }
      const subtreeAssets = [...assetsBySourceId.values()].sort((left, right) =>
        (right.captureTime ?? '').localeCompare(left.captureTime ?? ''),
      );
      const coverEntity =
        countryRoot ??
        [...members]
          .filter((entity) => entity.coverAssetId)
          .sort(
            (left, right) =>
              (right.subtreeAssetCount ?? right.assetCount) - (left.subtreeAssetCount ?? left.assetCount),
          )[0];
      const coverAssetId =
        coverEntity?.coverAssetId && assetsBySourceId.has(coverEntity.coverAssetId)
          ? coverEntity.coverAssetId
          : (subtreeAssets[0]?.sourceAssetId ?? null);
      if (generation === detailRequestGeneration) {
        placeCollectionView = 'geography';
        selectedGeographyGroup = groupName;
        selectedGeographyGroupEntityIds = members.map((entity) => entity.entityId);
        selected = {
          assets: subtreeAssets,
          entity: {
            aliases: [],
            assetCount: subtreeAssets.length,
            childCount: members.length - (countryRoot ? 1 : 0),
            coverAssetId,
            dateEnd: null,
            datePrecision: 'unknown',
            dateStart: null,
            description: `${members.length.toLocaleString()} grouped ${members.length === 1 ? 'geography' : 'geographies'}`,
            directoryVisibility: 'listed',
            displayName: groupName,
            entityId: `geography-group:${groupName.toLocaleLowerCase()}`,
            entityKind: 'place',
            geometry: countryRoot?.geometry ?? null,
            geographyEntityId: null,
            parentEntityId: null,
            placeRole: 'geography',
            revision: 1,
            status: 'active',
            subtreeAssetCount: subtreeAssets.length,
            typeKind: countryRoot?.typeKind ?? 'area',
          },
          relations: [],
          schemaVersion: 'cimmich.context-entity.v1',
          subtreeAssets,
        };
      }
    } catch (error_) {
      if (generation === detailRequestGeneration) {
        error = asError(error_);
        selected = null;
        selectedGeographyGroup = '';
        selectedGeographyGroupEntityIds = [];
      }
    } finally {
      if (generation === detailRequestGeneration) {
        selectedLoading = false;
      }
    }
  };

  const loadEntities = async ({ preserveCollection = false }: { preserveCollection?: boolean } = {}) => {
    const generation = ++listRequestGeneration;
    const selectedEntityId = selected?.entity.entityId;
    if (!preserveCollection) {
      loaded = false;
    }
    error = null;
    try {
      const next = await getCimmichContextEntities(activeFamily, {
        includeArchived: showArchived,
        includeHidden: showArchived,
        limit: 500,
        query,
      });
      if (generation === listRequestGeneration) {
        entities = next;
        const requestedGeographyGroup =
          activeFamily === 'places' ? (page.url.searchParams.get('geographyGroup')?.trim() ?? '') : '';
        if (requestedGeographyGroup) {
          void openGeographyGroup(requestedGeographyGroup, next);
          return;
        }
        const requestedEntityId =
          contextRequestedEntityId(page.url.searchParams, activeFamily) || selectedEntityId || '';
        const requestedEntity = resolveContextRouteEntity(next, {
          entityId: requestedEntityId,
          name: requestedEntityName,
        });
        if (requestedEntity) {
          void openDetail(requestedEntity);
        } else if (requestedEntityId) {
          // Durable detail URLs also reopen archived records even though the
          // default collection intentionally omits archived rows.
          void openDetailById(requestedEntityId, true);
        } else if (selectedEntityId || requestedEntityName) {
          selected = null;
        }
      }
    } catch (error_) {
      if (generation === listRequestGeneration) {
        error = asError(error_);
      }
    } finally {
      if (generation === listRequestGeneration) {
        loaded = true;
      }
    }
  };

  const clearCollectionSearchTimeout = () => {
    if (collectionSearchTimeout) {
      globalThis.clearTimeout(collectionSearchTimeout);
      collectionSearchTimeout = undefined;
    }
  };

  const queueCollectionSearch = () => {
    clearCollectionSearchTimeout();
    collectionSearchTimeout = globalThis.setTimeout(() => {
      collectionSearchTimeout = undefined;
      void loadEntities({ preserveCollection: true });
    }, 250);
  };

  const submitCollectionSearch = () => {
    clearCollectionSearchTimeout();
    void loadEntities({ preserveCollection: true });
  };

  onDestroy(clearCollectionSearchTimeout);

  const closeDetail = () => {
    selected = null;
    selectedPlacePlans = [];
    const collectionHref = getContextCollectionHref(page.url, activeFamily);
    if (`${page.url.pathname}${page.url.search}` === collectionHref) {
      return;
    }
    void goto(collectionHref, { replaceState: true });
  };

  const openDetailById = async (entityId: string, includeArchived: boolean) => {
    const generation = ++detailRequestGeneration;
    selectedGeographyGroup = '';
    selectedGeographyGroupEntityIds = [];
    selectedLoading = true;
    eventMediaLane = 'main';
    placeMediaLane = 'all';
    selectedPlaceAssetIds = [];
    mediaSelectionMode = false;
    error = null;
    try {
      const next = await getCimmichContextEntity(activeFamily, entityId, { includeArchived });
      const plans =
        activeFamily === 'places' && next.entity.placeRole === 'location'
          ? await getCimmichPlacePlans(entityId).then((result) => result.items)
          : [];
      if (generation === detailRequestGeneration) {
        selected = next;
        selectedPlacePlans = plans;
      }
    } catch (error_) {
      if (generation === detailRequestGeneration) {
        error = asError(error_);
      }
    } finally {
      if (generation === detailRequestGeneration) {
        selectedLoading = false;
      }
    }
  };

  const openDetail = (entity: CimmichContextEntity) => openDetailById(entity.entityId, entity.status === 'archived');

  const openEntity = (entity: CimmichContextEntity) => {
    void goto(getContextDetailHref(page.url, activeFamily, entity.entityId, entity.displayName));
  };

  const selectDetailTab = (tab: ContextDetailTab) => {
    const url = new URL(page.url);
    if (tab === 'photos') {
      url.searchParams.delete('tab');
    } else {
      url.searchParams.set('tab', tab);
    }
    void goto(`${url.pathname}${url.search}`, { keepFocus: true, noScroll: true, replaceState: true });
  };

  const resetForm = () => {
    if (placeSearchTimeout) {
      globalThis.clearTimeout(placeSearchTimeout);
      placeSearchTimeout = undefined;
    }
    placeSearchGeneration += 1;
    formName = '';
    formGeographyGroupName = '';
    formDescription = '';
    formAliases = '';
    formDateStart = '';
    formDateEnd = '';
    formDatePrecision = 'unknown';
    formRecurrenceEnabled = false;
    formRecurrenceFrequency = 'weekly';
    formRecurrenceInterval = 1;
    formRecurrenceWeekdays = [1];
    formSourceFolders = [];
    formParentId = '';
    formPlaceRole = 'location';
    formGeographyEntityId = '';
    formDirectoryVisibility = 'listed';
    formLatitude = '';
    formLongitude = '';
    formNorth = '';
    formSouth = '';
    formEast = '';
    formWest = '';
    formRoute = '';
    formGeometryProvenance = 'manual';
    formGeometryUncertainty = '';
    formMapPoints = [];
    formAreaUsesPoints = false;
    showPreciseGeometry = false;
    placeSearchQuery = '';
    placeSearchResults = [];
    placeSearchLoading = false;
    placeSearchError = '';
    placeSearchCenter = undefined;
    placeSearchZoom = undefined;
    placeSearchAttribution = undefined;
    placeLocationPhotoName = '';
    formType = entityKind === 'place' ? 'unlocated' : contextTypeKinds[entityKind][0];
    editorError = '';
  };

  const openCreate = (
    placeRole: 'geography' | 'location' = 'location',
    parentEntityId = '',
    geographyGroupName = '',
    preserveEventSeed = false,
  ) => {
    editorMode = 'create';
    editorTarget = null;
    resetForm();
    if (entityKind === 'event' && !preserveEventSeed) {
      eventSeedSourceIds = [];
      eventSeedAttachCommandId = '';
    }
    if (entityKind === 'place') {
      formPlaceRole = placeRole;
      formParentId = parentEntityId;
      formGeographyGroupName = geographyGroupName;
    }
    // A Place is a Location or Geography; its map geometry is optional detail,
    // not a second taxonomy people must understand before naming it.
    editorTypeChosen = entityKind === 'place';
    editorCommandId = createCimmichContextCommandId('create');
    showEditor = true;
  };

  const createPlanSublocation = async (displayName: string) => {
    if (!selected || activeFamily !== 'places' || selected.entity.placeRole !== 'location') {
      throw new Error('Open a Location before adding a sublocation.');
    }
    const parentId = selected.entity.entityId;
    isSaving = true;
    error = null;
    try {
      const result = await createCimmichContextEntity('places', {
        aliases: [],
        commandId: createCimmichContextCommandId('plan-sublocation-create'),
        description: null,
        directoryVisibility: 'nested_only',
        displayName,
        parentEntityId: parentId,
        placeRole: 'location',
        typeKind: 'unlocated',
      });
      if (!result.detail) {
        throw new Error('The sublocation was not returned after it was added.');
      }
      const child = result.detail.entity;
      entities = [...entities.filter((entity) => entity.entityId !== child.entityId), child];
      undoDecisionId = result.undo?.eligible ? result.decisionId : null;
      undoCommandId = undoDecisionId ? createCimmichContextCommandId('plan-sublocation-create-undo') : '';
      undoLabel = `Undo adding ${child.displayName}`;
      return child;
    } catch (error_) {
      const nextError = asError(error_);
      error = nextError;
      throw nextError;
    } finally {
      isSaving = false;
    }
  };

  const closeEditor = () => {
    showEditor = false;
    continueWithAnotherEvent = false;
    if (editorMode === 'create' && entityKind === 'event') {
      eventSeedSourceIds = [];
      eventSeedAttachCommandId = '';
    }
  };

  const openEdit = () => {
    if (!selected) {
      return;
    }
    const entity = selected.entity;
    if (placeSearchTimeout) {
      globalThis.clearTimeout(placeSearchTimeout);
      placeSearchTimeout = undefined;
    }
    placeSearchGeneration += 1;
    editorMode = 'edit';
    editorTarget = { entityId: entity.entityId, revision: entity.revision };
    editorTypeChosen = true;
    formName = entity.displayName;
    formDescription = entity.description ?? '';
    formAliases = entity.aliases.join(', ');
    formDateStart = entity.dateStart ?? '';
    formDateEnd = entity.dateEnd ?? '';
    formDatePrecision = entity.datePrecision;
    formRecurrenceEnabled = Boolean(entity.recurrence);
    formRecurrenceFrequency = entity.recurrence?.frequency ?? 'weekly';
    formRecurrenceInterval = entity.recurrence?.interval ?? 1;
    formRecurrenceWeekdays = entity.recurrence?.weekdays ?? [1];
    formSourceFolders = entity.sourceFolders ?? [];
    formParentId = entity.parentEntityId ?? '';
    formPlaceRole = entity.placeRole ?? 'unclassified';
    formGeographyEntityId = entity.geographyEntityId ?? '';
    formDirectoryVisibility = entity.directoryVisibility ?? 'listed';
    formType = entity.typeKind;
    const geometry = entity.geometry;
    formAreaUsesPoints = entity.typeKind === 'area' && Boolean(geometry && 'points' in geometry);
    formLatitude = geometry && 'latitude' in geometry ? String(geometry.latitude) : '';
    formLongitude = geometry && 'longitude' in geometry ? String(geometry.longitude) : '';
    formNorth = geometry && 'north' in geometry ? String(geometry.north) : '';
    formSouth = geometry && 'south' in geometry ? String(geometry.south) : '';
    formEast = geometry && 'east' in geometry ? String(geometry.east) : '';
    formWest = geometry && 'west' in geometry ? String(geometry.west) : '';
    formRoute =
      geometry && 'points' in geometry
        ? geometry.points.map((point) => `${point.latitude}, ${point.longitude}`).join('\n')
        : '';
    formGeometryProvenance = geometry?.provenance ?? 'manual';
    formGeometryUncertainty = geometry?.uncertaintyMeters === undefined ? '' : String(geometry.uncertaintyMeters);
    formMapPoints =
      geometry && 'points' in geometry
        ? geometry.points.map((point) => ({ lat: point.latitude, lng: point.longitude }))
        : geometry && 'latitude' in geometry
          ? [{ lat: geometry.latitude, lng: geometry.longitude }]
          : geometry && 'north' in geometry
            ? [
                { lat: geometry.north, lng: geometry.west },
                { lat: geometry.north, lng: geometry.east },
                { lat: geometry.south, lng: geometry.east },
                { lat: geometry.south, lng: geometry.west },
              ]
            : [];
    showPreciseGeometry = false;
    placeSearchQuery = '';
    placeSearchResults = [];
    placeSearchLoading = false;
    placeSearchError = '';
    placeSearchCenter =
      geometry && 'latitude' in geometry ? { lat: geometry.latitude, lng: geometry.longitude } : undefined;
    placeSearchZoom = geometry && 'latitude' in geometry ? 16 : undefined;
    placeSearchAttribution = undefined;
    placeLocationPhotoName = '';
    editorError = '';
    editorCommandId = createCimmichContextCommandId('update');
    showEditor = true;
  };

  const openEventCopy = () => {
    if (!selected || activeFamily !== 'events') {
      return;
    }
    const entity = selected.entity;
    editorMode = 'create';
    editorTarget = null;
    resetForm();
    editorTypeChosen = true;
    formName = eventCopyName(entity.displayName);
    formDescription = entity.description ?? '';
    formAliases = entity.aliases.join(', ');
    formDateStart = entity.dateStart ?? '';
    formDateEnd = entity.dateEnd ?? '';
    formDatePrecision = entity.datePrecision;
    formRecurrenceEnabled = Boolean(entity.recurrence);
    formRecurrenceFrequency = entity.recurrence?.frequency ?? 'weekly';
    formRecurrenceInterval = entity.recurrence?.interval ?? 1;
    formRecurrenceWeekdays = entity.recurrence?.weekdays ?? [1];
    formParentId = entity.parentEntityId ?? '';
    formSourceFolders = entity.sourceFolders ?? [];
    formType = entity.typeKind;
    eventSeedSourceIds = selected.assets
      .filter((asset) => asset.associationKind === 'direct' || asset.associationKind === 'manual')
      .map((asset) => asset.sourceAssetId)
      .slice(0, 1000);
    associationKind = 'direct';
    eventSeedAttachCommandId = createCimmichContextCommandId('event-copy-attach');
    editorCommandId = createCimmichContextCommandId('event-copy');
    editorError = '';
    showEditor = true;
  };

  const numberValue = (value: string | number | undefined, label: string) => {
    const normalizedValue = String(value ?? '').trim();
    const number = Number(normalizedValue);
    if (!normalizedValue || !Number.isFinite(number)) {
      throw new Error(`${label} must be a number.`);
    }
    return number;
  };

  const formGeometry = (): CimmichContextGeometry => {
    if (entityKind !== 'place' || formType === 'unlocated') {
      return null;
    }
    const metadata = {
      provenance: formGeometryProvenance,
      ...(String(formGeometryUncertainty ?? '').trim()
        ? { uncertaintyMeters: numberValue(formGeometryUncertainty, 'Uncertainty') }
        : {}),
    };
    if (formType === 'point') {
      return {
        latitude: numberValue(formLatitude, 'Latitude'),
        longitude: numberValue(formLongitude, 'Longitude'),
        ...metadata,
      };
    }
    if (formType === 'area') {
      if (formAreaUsesPoints) {
        if (formMapPoints.length < 3) {
          throw new Error('A painted area needs at least three points.');
        }
        return {
          points: formMapPoints.map((point) => ({ latitude: point.lat, longitude: point.lng })),
          ...metadata,
        };
      }
      return {
        east: numberValue(formEast, 'East'),
        north: numberValue(formNorth, 'North'),
        south: numberValue(formSouth, 'South'),
        west: numberValue(formWest, 'West'),
        ...metadata,
      };
    }
    if (formType === 'route') {
      const points = formRoute
        .split('\n')
        .map((row) => row.trim())
        .filter(Boolean)
        .map((row, index) => {
          const [latitude, longitude, ...rest] = row.split(',').map((value) => value.trim());
          if (rest.length > 0) {
            throw new Error(`Route point ${index + 1} must be “latitude, longitude”.`);
          }
          return {
            latitude: numberValue(latitude ?? '', `Route point ${index + 1} latitude`),
            longitude: numberValue(longitude ?? '', `Route point ${index + 1} longitude`),
          };
        });
      if (points.length < 2) {
        throw new Error('A route needs at least two points.');
      }
      return { points, ...metadata };
    }
    return null;
  };

  const updateGeometryFromMapPoints = () => {
    if (formType === 'route') {
      formRoute = formMapPoints.map((point) => `${point.lat}, ${point.lng}`).join('\n');
      return;
    }
    if (formType === 'area' && formMapPoints.length > 0) {
      if (formAreaUsesPoints) {
        formRoute = formMapPoints.map((point) => `${point.lat}, ${point.lng}`).join('\n');
        return;
      }
      const latitudes = formMapPoints.map((point) => point.lat);
      const longitudes = formMapPoints.map((point) => point.lng);
      formNorth = String(Math.max(...latitudes));
      formSouth = String(Math.min(...latitudes));
      formEast = String(Math.max(...longitudes));
      formWest = String(Math.min(...longitudes));
    }
  };

  const addPlaceMapPoint = ({ lat, lng }: { lat: number; lng: number }) => {
    formGeometryProvenance = 'manual';
    if (formType === 'point') {
      placeLocationPhotoName = '';
      formLatitude = String(lat);
      formLongitude = String(lng);
      formMapPoints = [{ lat, lng }];
      return;
    }
    if (formType !== 'area' && formType !== 'route') {
      return;
    }
    const nextMapPoints = formType === 'area' && !formAreaUsesPoints ? [] : formMapPoints;
    if (formType === 'area') {
      formAreaUsesPoints = true;
    }
    const last = nextMapPoints.at(-1);
    if (last && Math.hypot(last.lat - lat, last.lng - lng) < 0.000_02) {
      return;
    }
    formMapPoints = [...nextMapPoints, { lat, lng }].slice(-500);
    updateGeometryFromMapPoints();
  };

  const selectPlaceSearchResult = (place: CimmichAddressGeocodingItem) => {
    const point = { lat: place.latitude, lng: place.longitude };
    placeSearchCenter = point;
    placeSearchZoom = place.precision === 'address' ? 17 : place.precision === 'street' ? 16 : 14;
    placeSearchQuery = place.label;
    placeSearchResults = [];
    placeSearchError = '';
    if (formType === 'point') {
      addPlaceMapPoint(point);
      formGeometryProvenance = 'contextual';
      formGeometryUncertainty = place.precision === 'address' ? '20' : place.precision === 'street' ? '75' : '500';
    }
  };

  const performPlaceSearch = async () => {
    const query = placeSearchQuery.trim();
    const generation = ++placeSearchGeneration;
    if (!query) {
      placeSearchResults = [];
      placeSearchLoading = false;
      placeSearchError = '';
      placeSearchAttribution = undefined;
      return;
    }

    const coordinates = parseContextPlaceCoordinates(query);
    if (coordinates) {
      placeSearchCenter = coordinates;
      placeSearchZoom = 17;
      placeSearchResults = [];
      placeSearchError = '';
      placeSearchAttribution = undefined;
      if (formType === 'point') {
        addPlaceMapPoint(coordinates);
      }
      return;
    }

    placeSearchLoading = true;
    placeSearchError = '';
    try {
      const result = await searchCimmichAddresses(query, 5);
      if (generation === placeSearchGeneration) {
        placeSearchResults = sortContextPlaceSearchResults(result.items);
        placeSearchAttribution = result.attribution;
        placeSearchError = result.items.length === 0 ? 'No matching addresses or places found.' : '';
      }
    } catch {
      if (generation === placeSearchGeneration) {
        placeSearchResults = [];
        placeSearchAttribution = undefined;
        placeSearchError = 'Online address search is unavailable. You can still click the map or enter coordinates.';
      }
    } finally {
      if (generation === placeSearchGeneration) {
        placeSearchLoading = false;
      }
    }
  };

  const queuePlaceSearch = () => {
    if (placeSearchTimeout) {
      globalThis.clearTimeout(placeSearchTimeout);
    }
    if (placeSearchQuery.trim().length < 3) {
      placeSearchResults = [];
      placeSearchLoading = false;
      placeSearchError = '';
      placeSearchAttribution = undefined;
      return;
    }
    placeSearchLoading = true;
    placeSearchTimeout = globalThis.setTimeout(() => void performPlaceSearch(), 350);
  };

  const undoPlaceMapPoint = () => {
    formMapPoints = formMapPoints.slice(0, -1);
    updateGeometryFromMapPoints();
  };

  const clearPlaceMapPoints = () => {
    placeLocationPhotoName = '';
    formMapPoints = [];
    formLatitude = '';
    formLongitude = '';
    formNorth = '';
    formSouth = '';
    formEast = '';
    formWest = '';
    formRoute = '';
    formAreaUsesPoints = false;
    formGeometryProvenance = 'manual';
    formGeometryUncertainty = '';
  };

  const setPlaceMapMode = (mode: 'area' | 'point' | 'route' | 'unlocated') => {
    if (formType !== mode) {
      clearPlaceMapPoints();
    }
    formType = mode;
    showPreciseGeometry = false;
  };

  const draftPlaceMarkers = $derived(
    formType === 'point' && formMapPoints[0]
      ? [
          {
            id: 'draft-point',
            lat: formMapPoints[0].lat,
            lon: formMapPoints[0].lng,
            name: formName.trim() || 'New place',
            parentName: '',
          },
        ]
      : [],
  );

  const draftPlaceAreas = $derived.by(() => {
    if (formType === 'route' && formMapPoints.length >= 2) {
      return [
        {
          geometryKind: 'route' as const,
          geometrySource: 'manual' as const,
          id: 'draft-route',
          name: formName.trim() || 'New route',
          parentName: '',
          points: formMapPoints.map((point) => ({ lat: point.lat, lon: point.lng })),
        },
      ];
    }
    if (formType === 'area' && formAreaUsesPoints && formMapPoints.length >= 3) {
      return [
        {
          geometryKind: 'area' as const,
          geometrySource: 'manual' as const,
          id: 'draft-area',
          name: formName.trim() || 'New area',
          parentName: '',
          points: formMapPoints.map((point) => ({ lat: point.lat, lon: point.lng })),
        },
      ];
    }
    if (formType === 'area' && formMapPoints.length >= 2) {
      const latitudes = formMapPoints.map((point) => point.lat);
      const longitudes = formMapPoints.map((point) => point.lng);
      const north = Math.max(...latitudes);
      const south = Math.min(...latitudes);
      const east = Math.max(...longitudes);
      const west = Math.min(...longitudes);
      return [
        {
          geometryKind: 'area' as const,
          geometrySource: 'manual' as const,
          id: 'draft-area',
          name: formName.trim() || 'New area',
          parentName: '',
          points: [
            { lat: north, lon: west },
            { lat: north, lon: east },
            { lat: south, lon: east },
            { lat: south, lon: west },
            { lat: north, lon: west },
          ],
        },
      ];
    }
    return [];
  });

  const draftPlaceBrushPoints = $derived(
    formMapPoints.map((point, index) => ({ id: `draft-${index}`, lat: point.lat, lon: point.lng })),
  );

  const draftPlaceMapCenter = $derived.by(() => {
    if (formMapPoints.length === 0) {
      return placeSearchCenter;
    }
    return {
      lat: formMapPoints.reduce((total, point) => total + point.lat, 0) / formMapPoints.length,
      lng: formMapPoints.reduce((total, point) => total + point.lng, 0) / formMapPoints.length,
    };
  });

  const entityDraftCanSave = $derived.by(() => {
    if (!formName.trim()) {
      return false;
    }
    if (
      entityKind === 'event' &&
      formType === 'activity' &&
      formRecurrenceEnabled &&
      (!Number.isInteger(formRecurrenceInterval) ||
        formRecurrenceInterval < 1 ||
        formRecurrenceInterval > 99 ||
        (formRecurrenceFrequency === 'weekly' && formRecurrenceWeekdays.length === 0))
    ) {
      return false;
    }
    if (entityKind !== 'place' || formType === 'unlocated') {
      return true;
    }
    try {
      const geometry = formGeometry();
      if (formType === 'area' && geometry) {
        if ('points' in geometry) {
          return new Set(geometry.points.map((point) => `${point.latitude},${point.longitude}`)).size >= 3;
        }
        return 'north' in geometry && geometry.north > geometry.south && geometry.east > geometry.west;
      }
      return true;
    } catch {
      return false;
    }
  });

  const saveEntity = async (event: SubmitEvent) => {
    event.preventDefault();
    editorError = '';
    if (!formName.trim()) {
      editorError = 'Name is required.';
      return;
    }
    let geometry: CimmichContextGeometry;
    try {
      geometry = formGeometry();
    } catch (error_) {
      editorError = error_ instanceof Error ? error_.message : 'Location is invalid.';
      return;
    }
    isSaving = true;
    const reusableEventSeedIds = [...eventSeedSourceIds];
    const reusableEventSourceFolders = [...formSourceFolders];
    const reusableEventSeedAssociationKind = associationKind;
    const reusableEventDefaults = {
      dateEnd: formDateEnd,
      datePrecision: formDatePrecision,
      dateStart: formDateStart,
      parentId: formParentId,
      recurrenceEnabled: formRecurrenceEnabled,
      recurrenceFrequency: formRecurrenceFrequency,
      recurrenceInterval: formRecurrenceInterval,
      recurrenceWeekdays: [...formRecurrenceWeekdays],
      type: formType,
    };
    const createdFromGeographyGroup = editorMode === 'create' ? formGeographyGroupName || selectedGeographyGroup : '';
    try {
      const base = {
        aliases: formAliases
          .split(',')
          .map((alias) => alias.trim())
          .filter(Boolean),
        commandId: editorCommandId || createCimmichContextCommandId(editorMode),
        dateEnd: formDateEnd || null,
        datePrecision: formDateStart || formDateEnd ? formDatePrecision : ('unknown' as const),
        dateStart: formDateStart || null,
        description: formDescription.trim() || null,
        directoryVisibility: entityKind === 'place' ? formDirectoryVisibility : undefined,
        displayName:
          createdFromGeographyGroup && formPlaceRole === 'geography'
            ? contextGeographySubdivisionName(formName, createdFromGeographyGroup)
            : formName.trim(),
        geometry,
        geographyEntityId:
          entityKind === 'place' && formPlaceRole === 'location' ? formGeographyEntityId || null : undefined,
        parentEntityId: entityKind === 'place' || entityKind === 'event' ? formParentId || null : undefined,
        placeRole: entityKind === 'place' ? formPlaceRole : undefined,
        recurrence:
          entityKind === 'event' && formType === 'activity' && formRecurrenceEnabled
            ? {
                frequency: formRecurrenceFrequency,
                interval: formRecurrenceInterval,
                ...(formRecurrenceFrequency === 'weekly' ? { weekdays: formRecurrenceWeekdays } : {}),
              }
            : entityKind === 'event'
              ? null
              : undefined,
        sourceFolders: entityKind === 'event' ? formSourceFolders : undefined,
        typeKind: formType,
      };
      const mutation = resolveContextEditorMutation(editorMode, editorTarget);
      const result =
        mutation.kind === 'update'
          ? await updateCimmichContextEntity(activeFamily, mutation.entityId, {
              ...base,
              expectedRevision: mutation.revision,
            })
          : await createCimmichContextEntity(activeFamily, base);
      if (mutation.kind === 'update' && result.detail?.entity.entityId !== mutation.entityId) {
        throw new Error('The update returned a different Thing or Place. Nothing else will be created from this edit.');
      }
      if (
        result.detail &&
        (entityKind === 'event' || entityKind === 'place') &&
        result.detail.entity.parentEntityId !== (base.parentEntityId ?? null)
      ) {
        throw new Error(
          `The ${entityNoun} hierarchy did not save exactly. Nothing else will be changed from this edit.`,
        );
      }
      let finalResult = result;
      if (mutation.kind === 'create' && activeFamily === 'events' && result.detail && eventSeedSourceIds.length > 0) {
        const assetIds = await getVisibleCimmichAssetIds(eventSeedSourceIds);
        if (assetIds.length !== eventSeedSourceIds.length) {
          throw new Error(
            'The memory was created, but one or more selected photos are no longer available. Try again to reuse this memory and finish linking its photos.',
          );
        }
        finalResult = await attachCimmichContextAssets(
          'events',
          result.detail.entity.entityId,
          eventSeedAttachCommandId || createCimmichContextCommandId('event-seed-attach'),
          assetIds.map((assetId) => ({ assetId, associationKind })),
        );
      }
      undoDecisionId = finalResult.undo?.eligible ? finalResult.decisionId : null;
      undoCommandId = undoDecisionId ? createCimmichContextCommandId(`${editorMode}-undo`) : '';
      undoLabel =
        editorMode === 'edit' ? 'Undo edit' : eventSeedSourceIds.length > 0 ? 'Undo added photos' : 'Undo creation';
      showEditor = false;
      editorCommandId = '';
      editorTarget = null;
      await loadEntities();
      selected = finalResult.detail;
      if (mutation.kind === 'create' && finalResult.detail && activeFamily !== 'events' && !createdFromGeographyGroup) {
        void goto(
          getContextDetailHref(
            page.url,
            activeFamily,
            finalResult.detail.entity.entityId,
            finalResult.detail.entity.displayName,
          ),
        );
      }
      if (mutation.kind === 'create' && activeFamily === 'events' && finalResult.detail) {
        if (continueWithAnotherEvent) {
          continueWithAnotherEvent = false;
          eventSeedSourceIds = reusableEventSeedIds;
          associationKind = reusableEventSeedAssociationKind;
          eventSeedAttachCommandId = createCimmichContextCommandId('event-seed-attach');
          openCreate('location', '', '', true);
          editorTypeChosen = true;
          formType = reusableEventDefaults.type;
          formDateStart = reusableEventDefaults.dateStart;
          formDateEnd = reusableEventDefaults.dateEnd;
          formDatePrecision = reusableEventDefaults.datePrecision;
          formParentId = reusableEventDefaults.parentId;
          formRecurrenceEnabled = reusableEventDefaults.recurrenceEnabled;
          formRecurrenceFrequency = reusableEventDefaults.recurrenceFrequency;
          formRecurrenceInterval = reusableEventDefaults.recurrenceInterval;
          formRecurrenceWeekdays = reusableEventDefaults.recurrenceWeekdays;
          formSourceFolders = reusableEventSourceFolders;
        } else {
          eventSeedSourceIds = [];
          eventSeedAttachCommandId = '';
          selectedFolderPaths = [];
          void goto(
            getContextDetailHref(
              page.url,
              'events',
              finalResult.detail.entity.entityId,
              finalResult.detail.entity.displayName,
            ),
          );
        }
      }
      if (createdFromGeographyGroup && finalResult.detail) {
        selectedGeographyGroup = '';
        selectedGeographyGroupEntityIds = [];
        void goto(
          getContextDetailHref(
            page.url,
            'places',
            finalResult.detail.entity.entityId,
            finalResult.detail.entity.displayName,
          ),
        );
      }
    } catch (error_) {
      editorError = asError(error_).message;
    } finally {
      isSaving = false;
    }
  };

  const loadLibrary = async () => {
    libraryLoading = true;
    assetError = '';
    try {
      const result = await searchAssets({ metadataSearchDto: { size: 80, withExif: true } });
      const recent = result.assets.items.filter((asset) => !asset.isTrashed && !asset.isOffline);
      const visibleBindings = await getCimmichVisibleMapAssetBindings(recent.map((asset) => asset.id));
      const visibleIds = new Set(visibleBindings.keys());
      libraryAssets = recent.filter((asset) => visibleIds.has(asset.id));
      libraryLoaded = true;
    } catch {
      assetError = 'Your library could not be loaded. Nothing has changed.';
    } finally {
      libraryLoading = false;
    }
  };

  const getVisibleCimmichAssetIds = async (sourceAssetIds: string[]) => {
    const bindings = await getCimmichVisibleMapAssetBindings(sourceAssetIds);
    return sourceAssetIds.flatMap((sourceAssetId) => {
      const assetId = bindings.get(sourceAssetId);
      return assetId ? [assetId] : [];
    });
  };

  const searchEventFolders = async () => {
    const needle = folderQuery.trim();
    if (needle.length < 2) {
      folderSearchStarted = false;
      folderSearchAssets = [];
      folderError = needle.length === 1 ? 'Keep typing to search every folder, or choose a recent folder below.' : '';
      return;
    }
    folderSearchLoading = true;
    folderSearchStarted = true;
    folderError = '';
    try {
      const result = await searchAssets({ metadataSearchDto: { originalPath: needle, size: 100, withExif: true } });
      const candidates = result.assets.items.filter((asset) => !asset.isTrashed && !asset.isOffline);
      const visibleBindings = await getCimmichVisibleMapAssetBindings(candidates.map((asset) => asset.id));
      const visibleIds = new Set(visibleBindings.keys());
      folderSearchAssets = candidates.filter((asset) => visibleIds.has(asset.id));
      if (folderSearchAssets.length === 0) {
        folderError = 'No visible folders matched that name or path.';
      }
    } catch {
      folderSearchAssets = [];
      folderError = 'Folders could not be searched. Nothing has changed.';
    } finally {
      folderSearchLoading = false;
    }
  };

  const loadVisibleEventFolderAssets = async (folderPath: string, limit = 1000) => {
    const matches: AssetResponseDto[] = [];
    let pageNumber = 1;
    for (let pageIndex = 0; pageIndex < 10 && matches.length < limit; pageIndex += 1) {
      const result = await searchAssets({
        metadataSearchDto: { originalPath: folderPath, page: pageNumber, size: 100, withExif: true },
      });
      matches.push(
        ...result.assets.items.filter(
          (asset) => !asset.isTrashed && !asset.isOffline && eventAssetBelongsToFolder(asset, folderPath),
        ),
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
    const uniqueMatches = matches
      .filter((asset, index, items) => items.findIndex((candidate) => candidate.id === asset.id) === index)
      .slice(0, limit);
    const visibleBindings = await getCimmichVisibleMapAssetBindings(uniqueMatches.map((asset) => asset.id));
    const visibleIds = new Set(visibleBindings.keys());
    return uniqueMatches.filter((asset) => visibleIds.has(asset.id));
  };

  const addEventFolder = async (folderPath: string) => {
    if (selectedFolderPaths.includes(folderPath)) {
      const remainingFolders = selectedFolderPaths.filter((path) => path !== folderPath);
      const remainingFolderIds = new Set(remainingFolders.flatMap((path) => folderAssetIds[path] ?? []));
      const removedIds = new Set(folderAssetIds[folderPath]);
      selectedSourceIds = selectedSourceIds.filter((id) => !removedIds.has(id) || remainingFolderIds.has(id));
      selectedFolderPaths = remainingFolders;
      folderAssetIds = Object.fromEntries(Object.entries(folderAssetIds).filter(([path]) => path !== folderPath));
      return;
    }
    folderSearchLoading = true;
    folderError = '';
    try {
      const visible = await loadVisibleEventFolderAssets(folderPath);
      const capacity = Math.max(0, 1000 - selectedSourceIds.length);
      const admission = eventFolderAdmission(visible, {
        alreadyLinkedIds:
          assetPickerPurpose === 'attach'
            ? new Set((selected?.assets ?? []).map((asset) => asset.sourceAssetId).filter(Boolean))
            : new Set<string>(),
        capacity,
        selectedIds: new Set(selectedSourceIds),
      });
      const added = admission.additions;
      if (added.length === 0) {
        folderError = admission.alreadyLinkedCount
          ? `${admission.alreadyLinkedCount.toLocaleString()} ${admission.alreadyLinkedCount === 1 ? 'photo is' : 'photos are'} already in this event. Nothing was reclassified.`
          : capacity === 0
            ? 'The 1,000-item import limit is already reached.'
            : 'No new visible media was found.';
        return;
      }
      libraryAssets = [...libraryAssets, ...added].filter(
        (asset, index, items) => items.findIndex((candidate) => candidate.id === asset.id) === index,
      );
      selectedSourceIds = [...selectedSourceIds, ...added.map((asset) => asset.id)];
      selectedFolderPaths = [...selectedFolderPaths, folderPath];
      folderAssetIds = { ...folderAssetIds, [folderPath]: added.map((asset) => asset.id) };
      if (admission.alreadyLinkedCount > 0) {
        folderError = `Selected ${added.length.toLocaleString()} new ${added.length === 1 ? 'photo' : 'photos'} and skipped ${admission.alreadyLinkedCount.toLocaleString()} already in this event. Existing roles stay unchanged.`;
      } else if (admission.truncatedCount > 0) {
        folderError = `Added the first ${added.length.toLocaleString()} visible items. Refine the folder if you need a narrower memory.`;
      }
    } catch {
      folderError = 'That folder could not be loaded. Nothing has changed.';
    } finally {
      folderSearchLoading = false;
    }
  };

  const loadPhotoLocationAssets = async () => {
    const generation = ++photoLocationGeneration;
    photoLocationLoading = true;
    photoLocationError = '';
    try {
      const [result, mapMarkers] = await Promise.all([
        searchAssets({ metadataSearchDto: { size: 80, withExif: true } }),
        getMapMarkers({}),
      ]);
      const mapPointByAsset = new Map(mapMarkers.map((marker) => [marker.id, marker]));
      const attachedCandidates = (selected?.assets ?? []).flatMap((asset) => {
        const marker = mapPointByAsset.get(asset.sourceAssetId);
        return marker
          ? [
              {
                filename: asset.filename,
                latitude: marker.lat,
                longitude: marker.lon,
                sourceAssetId: asset.sourceAssetId,
              },
            ]
          : [];
      });
      const recentCandidates = result.assets.items.flatMap((asset) => {
        const latitude = asset.exifInfo?.latitude;
        const longitude = asset.exifInfo?.longitude;
        return !asset.isTrashed &&
          !asset.isOffline &&
          typeof latitude === 'number' &&
          Number.isFinite(latitude) &&
          typeof longitude === 'number' &&
          Number.isFinite(longitude)
          ? [
              {
                filename: asset.originalFileName,
                latitude,
                longitude,
                sourceAssetId: asset.id,
              },
            ]
          : [];
      });
      const candidates = [...attachedCandidates, ...recentCandidates]
        .filter(
          (asset, index, assets) =>
            assets.findIndex((candidate) => candidate.sourceAssetId === asset.sourceAssetId) === index,
        )
        .slice(0, 24);
      const attachedIds = new Set(attachedCandidates.map((asset) => asset.sourceAssetId));
      const visibilityResults = await Promise.allSettled(
        candidates.map((candidate) =>
          attachedIds.has(candidate.sourceAssetId)
            ? Promise.resolve()
            : getCimmichAssetEvidence(candidate.sourceAssetId).then(() => undefined),
        ),
      );
      if (generation !== photoLocationGeneration) {
        return;
      }
      const visible = candidates.filter((_, index) => visibilityResults[index]?.status === 'fulfilled');
      photoLocationAssets = visible;
      photoLocationError = visible.length === 0 ? 'No visible recent photos have GPS coordinates.' : '';
    } catch {
      photoLocationAssets = [];
      photoLocationError = 'Photo locations could not be loaded. Nothing has changed.';
    } finally {
      if (generation === photoLocationGeneration) {
        photoLocationLoading = false;
      }
    }
  };

  const openPhotoLocationPicker = () => {
    showPhotoLocationPicker = true;
    void loadPhotoLocationAssets();
  };

  const closePhotoLocationPicker = () => {
    photoLocationGeneration += 1;
    photoLocationLoading = false;
    showPhotoLocationPicker = false;
  };

  const usePhotoLocation = (asset: (typeof photoLocationAssets)[number]) => {
    const point = { lat: asset.latitude, lng: asset.longitude };
    addPlaceMapPoint(point);
    formGeometryProvenance = 'photo_gps';
    formGeometryUncertainty = '';
    placeLocationPhotoName = asset.filename;
    placeSearchCenter = point;
    placeSearchZoom = 17;
    placeSearchQuery = '';
    placeSearchResults = [];
    placeSearchError = '';
    closePhotoLocationPicker();
  };

  const loadNearbyAssets = async (radius = nearbyRadius) => {
    const point = nearbyPlacePoint;
    if (!point) {
      nearbyAssets = [];
      return;
    }

    const generation = ++nearbyGeneration;
    nearbyLoading = true;
    nearbyError = '';
    try {
      const markers = await getMapMarkers({});
      const candidates = markers
        .map((marker) => ({
          distanceMeters: contextPlacePointDistanceMeters(point, {
            latitude: marker.lat,
            longitude: marker.lon,
          }),
          latitude: marker.lat,
          longitude: marker.lon,
          sourceAssetId: marker.id,
        }))
        .filter((candidate) => candidate.distanceMeters <= radius && !selectedAssetIds.has(candidate.sourceAssetId))
        .sort(
          (left, right) =>
            left.distanceMeters - right.distanceMeters || left.sourceAssetId.localeCompare(right.sourceAssetId),
        )
        .slice(0, 160);

      const visible: typeof candidates = [];
      for (let index = 0; index < candidates.length; index += 12) {
        const batch = candidates.slice(index, index + 12);
        const results = await Promise.allSettled(
          batch.map((candidate) => getCimmichAssetEvidence(candidate.sourceAssetId)),
        );
        if (generation !== nearbyGeneration) {
          return;
        }
        for (const [resultIndex, result] of results.entries()) {
          if (result.status === 'fulfilled') {
            const candidate = batch[resultIndex];
            if (candidate) {
              visible.push(candidate);
            }
          }
        }
        if (visible.length >= 100) {
          break;
        }
      }
      nearbyAssets = visible.slice(0, 100);
    } catch {
      nearbyAssets = [];
      nearbyError = 'Nearby media could not be checked. Your library is still available.';
    } finally {
      if (generation === nearbyGeneration) {
        nearbyLoading = false;
      }
    }
  };

  const selectAssetPickerMode = (mode: typeof assetPickerMode) => {
    assetPickerMode = mode;
    assetError = '';
    if (assetPickerPurpose === 'seed-event' && selectedSourceIds.length === 0) {
      associationKind = mode === 'folders' ? 'needs_check' : 'direct';
    }
    if (mode === 'nearby') {
      void loadNearbyAssets();
    } else if ((mode === 'library' || mode === 'folders') && !libraryLoaded) {
      void loadLibrary();
    }
  };

  const selectNearbyRadius = (radius: typeof nearbyRadius) => {
    nearbyRadius = radius;
    void loadNearbyAssets(radius);
  };

  const openAssetPicker = () => {
    assetPickerPurpose = 'attach';
    selectedSourceIds = [];
    libraryQuery = '';
    associationKind = contextAssociationKinds[entityKind][0];
    assetAttachCommandId = createCimmichContextCommandId('asset-attach');
    assetError = '';
    nearbyError = '';
    folderError = '';
    folderQuery = '';
    folderSearchAssets = [];
    folderSearchStarted = false;
    selectedFolderPaths = [];
    folderAssetIds = {};
    showAssetPicker = true;
    assetPickerMode = nearbyPlacePoint ? 'nearby' : 'library';
    if (assetPickerMode === 'nearby') {
      void loadNearbyAssets();
    } else if (!libraryLoaded) {
      void loadLibrary();
    }
  };

  const openEventSeedPicker = () => {
    if (activeFamily !== 'events') {
      openCreate();
      return;
    }
    assetPickerPurpose = 'seed-event';
    selectedSourceIds = [];
    eventSeedSourceIds = [];
    eventSeedAttachCommandId = createCimmichContextCommandId('event-seed-attach');
    selectedFolderPaths = [];
    folderAssetIds = {};
    folderQuery = '';
    folderSearchAssets = [];
    folderSearchStarted = false;
    folderError = '';
    libraryQuery = '';
    associationKind = 'needs_check';
    assetError = '';
    showAssetPicker = true;
    assetPickerMode = 'folders';
    if (!libraryLoaded) {
      void loadLibrary();
    }
  };

  const continueEventSeed = () => {
    if (selectedSourceIds.length === 0) {
      return;
    }
    eventSeedSourceIds = [...selectedSourceIds];
    formSourceFolders = [...selectedFolderPaths];
    showAssetPicker = false;
    openCreate('location', '', '', true);
    formSourceFolders = [...selectedFolderPaths];
  };

  const toggleAsset = (sourceAssetId: string) => {
    if (selectedAssetIds.has(sourceAssetId)) {
      return;
    }
    selectedSourceIds = selectedSourceIds.includes(sourceAssetId)
      ? selectedSourceIds.filter((id) => id !== sourceAssetId)
      : selectedSourceIds.length < (activeFamily === 'events' ? 1000 : 100)
        ? [...selectedSourceIds, sourceAssetId]
        : selectedSourceIds;
  };

  const attachAssets = async () => {
    if (!selected || selectedSourceIds.length === 0) {
      return;
    }
    isSaving = true;
    assetError = '';
    try {
      const evidence =
        activeFamily === 'events'
          ? []
          : await Promise.allSettled(selectedSourceIds.map((id) => getCimmichAssetEvidence(id)));
      const assetIds =
        activeFamily === 'events'
          ? await getVisibleCimmichAssetIds(selectedSourceIds)
          : evidence.flatMap((item) => (item.status === 'fulfilled' ? [item.value.asset_id] : []));
      if (assetIds.length !== selectedSourceIds.length) {
        assetError =
          'One or more selected photos are no longer available in this viewing mode. Refresh the picker and try again.';
        return;
      }
      const result = await attachCimmichContextAssets(
        activeFamily,
        selected.entity.entityId,
        assetAttachCommandId || createCimmichContextCommandId('asset-attach'),
        assetIds.map((assetId) => ({ assetId, associationKind })),
        activeFamily === 'events' && selectedFolderPaths.length > 0 ? selectedFolderPaths : undefined,
      );
      undoDecisionId = result.undo?.eligible ? result.decisionId : null;
      undoCommandId = undoDecisionId ? createCimmichContextCommandId('asset-undo') : '';
      undoLabel = 'Undo media change';
      assetAttachCommandId = '';
      showAssetPicker = false;
      await loadEntities();
      selected = result.detail;
    } catch (error_) {
      assetError = asError(error_).message;
    } finally {
      isSaving = false;
    }
  };

  const refreshEventFolders = async () => {
    if (!selected || activeFamily !== 'events' || !(selected.entity.sourceFolders?.length ?? 0)) {
      return;
    }
    isSaving = true;
    error = null;
    try {
      const gathered: AssetResponseDto[] = [];
      for (const folderPath of selected.entity.sourceFolders ?? []) {
        if (gathered.length >= 1000) {
          break;
        }
        gathered.push(...(await loadVisibleEventFolderAssets(folderPath, 1000 - gathered.length)));
      }
      const currentSourceIds = new Set(selected.assets.map((asset) => asset.sourceAssetId));
      const additions = gathered
        .filter(
          (asset, index, items) =>
            !currentSourceIds.has(asset.id) && items.findIndex((candidate) => candidate.id === asset.id) === index,
        )
        .slice(0, 1000);
      if (additions.length === 0) {
        toastManager.info('Source folders are already up to date.');
        return;
      }
      const assetIds = await getVisibleCimmichAssetIds(additions.map((asset) => asset.id));
      if (assetIds.length !== additions.length) {
        throw new Error('One or more new folder photos are unavailable in this viewing mode. Nothing was added.');
      }
      const result = await attachCimmichContextAssets(
        'events',
        selected.entity.entityId,
        createCimmichContextCommandId('event-folder-refresh'),
        assetIds.map((assetId) => ({ assetId, associationKind: 'needs_check' })),
      );
      undoDecisionId = result.undo?.eligible ? result.decisionId : null;
      undoCommandId = undoDecisionId ? createCimmichContextCommandId('event-folder-refresh-undo') : '';
      undoLabel = 'Undo folder refresh';
      selected = result.detail;
      await loadEntities({ preserveCollection: true });
      eventMediaLane = 'needs_check';
      toastManager.success(`Added ${assetIds.length} new ${assetIds.length === 1 ? 'item' : 'items'} to Needs check.`);
    } catch (error_) {
      error = asError(error_);
    } finally {
      isSaving = false;
    }
  };

  const reclassifyEventAsset = async (
    assetId: string,
    nextAssociationKind: 'context' | 'direct' | 'needs_check' | 'route_stop',
  ) => {
    if (!selected || activeFamily !== 'events') {
      return;
    }
    isSaving = true;
    error = null;
    mediaMenuAssetId = null;
    try {
      const result = await attachCimmichContextAssets(
        'events',
        selected.entity.entityId,
        createCimmichContextCommandId('event-media-reclassify'),
        [{ assetId, associationKind: nextAssociationKind }],
      );
      undoDecisionId = result.undo?.eligible ? result.decisionId : null;
      undoCommandId = undoDecisionId ? createCimmichContextCommandId('event-media-reclassify-undo') : '';
      undoLabel = 'Undo media move';
      selected = result.detail;
      eventMediaLane =
        nextAssociationKind === 'direct'
          ? 'main'
          : nextAssociationKind === 'route_stop'
            ? 'stops'
            : nextAssociationKind === 'context'
              ? 'adjacent'
              : 'needs_check';
      await loadEntities({ preserveCollection: true });
      toastManager.success(`Moved media to ${contextAssociationLabel('event', nextAssociationKind)}.`);
    } catch (error_) {
      error = asError(error_);
    } finally {
      isSaving = false;
    }
  };

  const detachAsset = async (assetId: string) => {
    if (!selected) {
      return;
    }
    isSaving = true;
    error = null;
    const commandId = detachCommandIds[assetId] ?? createCimmichContextCommandId('asset-detach');
    detachCommandIds = { ...detachCommandIds, [assetId]: commandId };
    try {
      const result = await detachCimmichContextAssets(activeFamily, selected.entity.entityId, commandId, [assetId]);
      undoDecisionId = result.undo?.eligible ? result.decisionId : null;
      undoCommandId = undoDecisionId ? createCimmichContextCommandId('asset-undo') : '';
      undoLabel = 'Undo media change';
      const remainingCommands = { ...detachCommandIds };
      delete remainingCommands[assetId];
      detachCommandIds = remainingCommands;
      await loadEntities();
      selected = result.detail;
    } catch (error_) {
      error = asError(error_);
    } finally {
      isSaving = false;
    }
  };

  const selectPlaceMediaLane = (lane: typeof placeMediaLane) => {
    placeMediaLane = lane;
    selectedPlaceAssetIds = [];
    mediaMenuAssetId = null;
  };

  const selectEventMediaLane = (lane: typeof eventMediaLane) => {
    eventMediaLane = lane;
    selectedPlaceAssetIds = [];
    mediaMenuAssetId = null;
  };

  const placeAssetSelected = (assetId: string) => selectedPlaceAssetIds.includes(assetId);

  const togglePlaceAssetSelection = (assetId: string) => {
    if (placeAssetSelected(assetId)) {
      selectedPlaceAssetIds = selectedPlaceAssetIds.filter((candidate) => candidate !== assetId);
      return;
    }
    if (selectedPlaceAssetIds.length >= placeBulkSelectionLimit) {
      toastManager.warning(
        `Maximum ${placeBulkSelectionLimit} photos. Apply or clear your current selection before choosing more.`,
      );
      return;
    }
    selectedPlaceAssetIds = [...selectedPlaceAssetIds, assetId];
  };

  const selectShownPlaceAssets = () => {
    const shownAssetIds = visibleDetailAssets.map((asset) => asset.assetId);
    selectedPlaceAssetIds = shownAssetIds.slice(0, placeBulkSelectionLimit);
    if (shownAssetIds.length > placeBulkSelectionLimit) {
      toastManager.warning(
        `Maximum ${placeBulkSelectionLimit} photos selected. Apply these before selecting the remaining photos.`,
      );
    }
  };

  const refreshSelectedDetail = async () => {
    if (!selected) {
      return;
    }
    if (selectedGeographyGroup) {
      await loadEntities({ preserveCollection: true });
      return;
    }
    const entityId = selected.entity.entityId;
    const includeArchived = selected.entity.status === 'archived';
    await loadEntities({ preserveCollection: true });
    const [detail, plans] = await Promise.all([
      getCimmichContextEntity(activeFamily, entityId, { includeArchived }),
      activeFamily === 'places' && selected.entity.placeRole === 'location'
        ? getCimmichPlacePlans(entityId).then((result) => result.items)
        : Promise.resolve([]),
    ]);
    selected = detail;
    selectedPlacePlans = plans;
  };

  const assignAssetsToPlaceChild = async (assetIds: string[], child: CimmichContextEntity) => {
    if (!selected || activeFamily !== 'places') {
      return false;
    }
    isSaving = true;
    error = null;
    mediaMenuAssetId = null;
    try {
      const result = await assignCimmichPlaceAssetsToChild(selected.entity.entityId, {
        assetIds,
        childEntityId: child.entityId,
        commandId: createCimmichContextCommandId('place-assign-child'),
      });
      undoDecisionId = result.undo?.eligible ? result.decisionId : null;
      undoCommandId = undoDecisionId ? createCimmichContextCommandId('place-assign-child-undo') : '';
      undoLabel = 'Undo last';
      selectedPlaceAssetIds = [];
      await loadEntities({ preserveCollection: true });
      selected = result.detail;
      return true;
    } catch (error_) {
      error = asError(error_);
      return false;
    } finally {
      isSaving = false;
    }
  };

  const assignAssetToPlaceChild = (assetId: string, child: CimmichContextEntity) =>
    assignAssetsToPlaceChild([assetId], child);

  const assignSelectedPlaceAssets = async (targetEntityId: string) => {
    const child = selectedPlaceMoveTargets.find((candidate) => candidate.entity.entityId === targetEntityId)?.entity;
    if (!child || selectedPlaceAssetIds.length === 0) {
      return false;
    }
    return assignAssetsToPlaceChild(selectedPlaceAssetIds, child);
  };

  const savePlaceChildZone = async (child: CimmichContextEntity, geometry: CimmichContextGeometry) => {
    if (!selected || activeFamily !== 'places') {
      return;
    }
    isSaving = true;
    error = null;
    try {
      const result = await updateCimmichContextEntity('places', child.entityId, {
        commandId: createCimmichContextCommandId('place-painted-zone'),
        expectedRevision: child.revision,
        geometry,
        typeKind: 'area',
      });
      if (!result.detail) {
        throw new Error('The painted zone did not return its current Place detail.');
      }
      const updatedChild = result.detail.entity;
      undoDecisionId = result.undo?.eligible ? result.decisionId : null;
      undoCommandId = undoDecisionId ? createCimmichContextCommandId('place-painted-zone-undo') : '';
      undoLabel = `Undo ${child.displayName} outline`;
      entities = entities.map((candidate) => (candidate.entityId === updatedChild.entityId ? updatedChild : candidate));
      selected = await getCimmichContextEntity('places', selected.entity.entityId);
    } catch (error_) {
      const nextError = asError(error_);
      error = nextError;
      throw nextError;
    } finally {
      isSaving = false;
    }
  };

  const saveLocationPlan = async (input: Omit<CimmichPlacePlanSaveInput, 'commandId'>) => {
    if (!selected || activeFamily !== 'places' || selected.entity.placeRole !== 'location') {
      return;
    }
    isSaving = true;
    error = null;
    try {
      const result = await saveCimmichPlacePlan(selected.entity.entityId, {
        ...input,
        commandId: createCimmichContextCommandId('location-plan-save'),
      });
      selected = result.detail;
      selectedPlacePlans = result.plans;
      undoDecisionId = result.undo.eligible ? result.decisionId : null;
      undoCommandId = undoDecisionId ? createCimmichContextCommandId('location-plan-undo') : '';
      undoLabel = 'Undo Plan change';
    } catch (error_) {
      const nextError = asError(error_);
      error = nextError;
      throw nextError;
    } finally {
      isSaving = false;
    }
  };

  const changeContextCover = async (sourceAssetId: string | null) => {
    if (!selected || !['event', 'object', 'place'].includes(selected.entity.entityKind)) {
      return;
    }
    const coverKind = selected.entity.entityKind;
    isSaving = true;
    error = null;
    try {
      const setCover =
        coverKind === 'place'
          ? setCimmichPlaceCover
          : coverKind === 'event'
            ? setCimmichEventCover
            : setCimmichObjectCover;
      const result = await setCover(selected.entity.entityId, {
        commandId: createCimmichContextCommandId(sourceAssetId ? `${coverKind}-cover` : `${coverKind}-cover-auto`),
        expectedRevision: selected.entity.revision,
        sourceAssetId,
      });
      undoDecisionId = result.undo.eligible ? result.decisionId : null;
      undoCommandId = undoDecisionId ? createCimmichContextCommandId(`${coverKind}-cover-undo`) : '';
      undoLabel = 'Undo cover change';
      selected = result.detail;
      entities = entities.map((entity) =>
        entity.entityId === result.detail.entity.entityId ? result.detail.entity : entity,
      );
      mediaMenuAssetId = null;
    } catch (error_) {
      error = asError(error_);
    } finally {
      isSaving = false;
    }
  };

  const undoAssets = async () => {
    if (!undoDecisionId || !selected) {
      return;
    }
    isSaving = true;
    try {
      const selectedEntityId = selected.entity.entityId;
      const result = await undoCimmichContextDecision(
        undoDecisionId,
        undoCommandId || createCimmichContextCommandId('asset-undo'),
      );
      if (!result.detail) {
        throw new Error('Undo did not return the current Place detail.');
      }
      undoDecisionId = null;
      undoCommandId = '';
      undoLabel = 'Undo last change';
      selectedPlaceAssetIds = [];
      await loadEntities({ preserveCollection: true });
      selected =
        result.detail.entity.entityId === selectedEntityId
          ? result.detail
          : await getCimmichContextEntity(activeFamily, selectedEntityId);
      if (activeFamily === 'places' && selected.entity.placeRole === 'location') {
        const plans = await getCimmichPlacePlans(selectedEntityId);
        selectedPlacePlans = plans.items;
      }
    } catch (error_) {
      error = asError(error_);
    } finally {
      isSaving = false;
    }
  };

  const changeArchivedState = async () => {
    if (!selected) {
      return;
    }
    const restoring = selected.entity.status === 'archived';
    if (!restoring && !globalThis.confirm(`Archive ${selected.entity.displayName}? You can restore it later.`)) {
      return;
    }
    statusCommandId ||= createCimmichContextCommandId(restoring ? 'restore' : 'archive');
    isSaving = true;
    error = null;
    try {
      const result = await updateCimmichContextEntity(activeFamily, selected.entity.entityId, {
        commandId: statusCommandId,
        expectedRevision: selected.entity.revision,
        status: restoring ? 'active' : 'archived',
      });
      if (!result.detail) {
        throw new Error('The archive change did not return its current detail projection.');
      }
      undoDecisionId = result.undo?.eligible ? result.decisionId : null;
      undoCommandId = undoDecisionId ? createCimmichContextCommandId(restoring ? 'restore-undo' : 'archive-undo') : '';
      undoLabel = restoring
        ? `Undo restoring ${selected.entity.displayName}`
        : `Undo archiving ${selected.entity.displayName}`;
      statusCommandId = '';
      showEditor = false;
      await loadEntities();
      selected = result.detail;
      toastManager.success(
        restoring
          ? `${result.detail.entity.displayName} is back in ${contextFamilyLabels[activeFamily]}.`
          : `${result.detail.entity.displayName} is archived. Its photos are untouched.`,
      );
    } catch (error_) {
      error = asError(error_);
    } finally {
      isSaving = false;
    }
  };

  const openContextDelete = () => {
    deleteContextError = '';
    deleteContextCommandId = '';
    showDeleteContext = true;
  };

  const confirmContextDelete = async (deleteTags: boolean) => {
    if (!selected || !['object', 'place'].includes(selected.entity.entityKind)) {
      return;
    }
    const deleteKind = selected.entity.entityKind;
    deleteContextCommandId ||= createCimmichContextCommandId(`${deleteKind}-delete`);
    isSaving = true;
    deleteContextError = '';
    try {
      const deleteEntity = deleteKind === 'place' ? deleteCimmichPlace : deleteCimmichObject;
      await deleteEntity(selected.entity.entityId, {
        commandId: deleteContextCommandId,
        deleteTags,
        expectedRevision: selected.entity.revision,
      });
      deleteContextCommandId = '';
      showDeleteContext = false;
      selected = null;
      await loadEntities();
    } catch (error_) {
      deleteContextError = asError(error_).message;
    } finally {
      isSaving = false;
    }
  };

  const targetKindForRelation = (kind: string) => {
    if (kind === 'participant') {
      return 'person' as const;
    }
    if (kind === 'companion') {
      return 'pet' as const;
    }
    if (kind === 'location') {
      return 'place' as const;
    }
    if (kind === 'object') {
      return 'object' as const;
    }
    if (kind === 'parent') {
      return entityKind as 'event' | 'place';
    }
    return relationTargetKind;
  };

  const loadRelationTargets = async () => {
    relationTargetsLoading = true;
    relationError = '';
    relationTargetId = '';
    relationTargetQuery = '';
    const targetKind = targetKindForRelation(relationKind);
    try {
      if (targetKind === 'person') {
        const people = await getCimmichPeople(500);
        relationTargets = people
          .filter((person) => person.subject_kind === 'person')
          .map((person) => ({ id: person.person_id, name: person.display_name }));
      } else if (targetKind === 'pet') {
        const pets = await getCimmichPets({ limit: 500 });
        relationTargets = pets.map((pet) => ({
          id: pet.petId,
          name: pet.displayName,
        }));
      } else {
        const family = `${targetKind}s` as CimmichContextFamily;
        const contextEntities = await getCimmichContextEntities(family, { limit: 500 });
        relationTargets = contextEntities
          .filter(
            (entity) =>
              entity.entityId !== selected?.entity.entityId &&
              !selected?.relations.some(
                (relation) =>
                  relation.targetId === entity.entityId &&
                  relation.targetKind === targetKind &&
                  relation.relationKind === relationKind,
              ) &&
              (relationPickerPurpose !== 'trip-stop' ||
                !selectedEventStops.some((stop) => stop.targetId === entity.entityId)),
          )
          .map((entity) => ({ id: entity.entityId, name: entity.displayName }));
      }
    } catch (error_) {
      relationError = asError(error_).message;
      relationTargets = [];
    } finally {
      relationTargetsLoading = false;
    }
  };

  const openRelationPicker = () => {
    relationPickerPurpose = 'connection';
    const draft = defaultContextRelationDraft(entityKind, relationKinds);
    relationKind = draft.relationKind;
    relationTargetKind = draft.relationTargetKind;
    relationTargetId = '';
    relationTargetQuery = '';
    relationCommandId = createCimmichContextCommandId('relation-attach');
    relationError = '';
    showRelationPicker = true;
    void loadRelationTargets();
  };

  const openTripStopPicker = () => {
    relationPickerPurpose = 'trip-stop';
    relationKind = 'location';
    relationTargetKind = 'place';
    relationTargetId = '';
    relationTargetQuery = '';
    relationCommandId = createCimmichContextCommandId('trip-stop-attach');
    relationError = '';
    showRelationPicker = true;
    void loadRelationTargets();
  };

  const addRelation = async () => {
    if (!selected || !relationTargetId) {
      return;
    }
    isSaving = true;
    relationError = '';
    try {
      const requestedRelations =
        relationPickerPurpose === 'trip-stop'
          ? [
              ...selectedEventStops.map((stop, sortOrder) => ({
                relationKind: 'location',
                sortOrder,
                targetId: stop.targetId,
                targetKind: 'place',
              })),
              {
                relationKind: 'location',
                sortOrder: selectedEventStops.length,
                targetId: relationTargetId,
                targetKind: 'place',
              },
            ]
          : [{ relationKind, targetId: relationTargetId, targetKind: targetKindForRelation(relationKind) }];
      const result = await attachCimmichContextRelations(
        activeFamily,
        selected.entity.entityId,
        relationCommandId || createCimmichContextCommandId('relation-attach'),
        requestedRelations,
      );
      relationCommandId = '';
      undoDecisionId = result.undo?.eligible ? result.decisionId : null;
      undoCommandId = undoDecisionId ? createCimmichContextCommandId('relation-undo') : '';
      undoLabel = 'Undo connection change';
      showRelationPicker = false;
      await loadEntities();
      selected = result.detail;
    } catch (error_) {
      relationError = asError(error_).message;
    } finally {
      isSaving = false;
    }
  };

  const moveTripStop = async (index: number, direction: -1 | 1) => {
    if (!selected) {
      return;
    }
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= selectedEventStops.length) {
      return;
    }
    const reordered = [...selectedEventStops];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
    isSaving = true;
    error = null;
    try {
      const result = await attachCimmichContextRelations(
        activeFamily,
        selected.entity.entityId,
        createCimmichContextCommandId('trip-stops-reorder'),
        reordered.map((relation, sortOrder) => ({
          relationKind: 'location',
          sortOrder,
          targetId: relation.targetId,
          targetKind: 'place',
        })),
      );
      undoDecisionId = result.undo?.eligible ? result.decisionId : null;
      undoCommandId = undoDecisionId ? createCimmichContextCommandId('trip-stops-reorder-undo') : '';
      undoLabel = 'Undo stop order';
      await loadEntities();
      selected = result.detail;
    } catch (error_) {
      error = asError(error_);
    } finally {
      isSaving = false;
    }
  };

  const toggleRecurrenceWeekday = (weekday: number) => {
    formRecurrenceWeekdays = formRecurrenceWeekdays.includes(weekday)
      ? formRecurrenceWeekdays.filter((candidate) => candidate !== weekday)
      : [...formRecurrenceWeekdays, weekday].sort();
  };

  const removeRelation = async (relation: CimmichContextRelation) => {
    if (!selected) {
      return;
    }
    if (relation.direction === 'incoming' && !['event', 'object', 'place'].includes(relation.targetKind)) {
      error = new CimmichServiceError('This connection cannot be changed from the current record.', {
        code: 'CONTEXT_RELATION_OWNER_UNAVAILABLE',
        status: 409,
      });
      return;
    }
    isSaving = true;
    error = null;
    try {
      const selectedEntityId = selected.entity.entityId;
      const ownerFamily =
        relation.direction === 'incoming' ? (`${relation.targetKind}s` as CimmichContextFamily) : activeFamily;
      const ownerEntityId = relation.direction === 'incoming' ? relation.targetId : selectedEntityId;
      const result = await detachCimmichContextRelations(
        ownerFamily,
        ownerEntityId,
        createCimmichContextCommandId('relation-detach'),
        [relation.relationId],
      );
      if (!result.detail) {
        throw new Error('Connection removal did not return its owning record.');
      }
      undoDecisionId = result.undo?.eligible ? result.decisionId : null;
      undoCommandId = undoDecisionId ? createCimmichContextCommandId('relation-undo') : '';
      undoLabel = 'Undo connection change';
      await loadEntities();
      selected =
        result.detail.entity.entityId === selectedEntityId
          ? result.detail
          : await getCimmichContextEntity(activeFamily, selectedEntityId);
    } catch (error_) {
      error = asError(error_);
    } finally {
      isSaving = false;
    }
  };

  const connectionKey = (kind: CimmichContextRelation['targetKind'], id: string) => `${kind}:${id}`;

  // The presentation fan-out is keyed by the visible relation targets, not by
  // the detail object's identity: mutations return fresh detail objects with
  // the same connections, and those must not re-fire the whole request burst.
  const connectionPresentationSignature = (detail: CimmichContextDetail | null) =>
    detail
      ? [...new Set(detail.relations.map((relation) => connectionKey(relation.targetKind, relation.targetId)))]
          .sort()
          .join(',')
      : '';

  const loadConnectionPresentations = async (detail: CimmichContextDetail | null) => {
    const generation = ++connectionPresentationGeneration;
    if (!detail || detail.relations.length === 0) {
      connectionPresentations = {};
      return true;
    }
    const targetKinds = new Set(detail.relations.map((relation) => relation.targetKind));
    const tasks: Array<Promise<Array<[string, { objectPosition: string; sourceAssetId: string | null }]>>> = [];
    if (targetKinds.has('person')) {
      tasks.push(
        getCimmichPeople(500).then((people) =>
          people
            .filter((person) => person.subject_kind === 'person')
            .map((person) => [
              connectionKey('person', person.person_id),
              {
                objectPosition:
                  person.box_x === null || person.box_y === null || person.box_w === null || person.box_h === null
                    ? '50% 50%'
                    : `${(person.box_x + person.box_w / 2) * 100}% ${(person.box_y + person.box_h / 2) * 100}%`,
                sourceAssetId: person.sourceAssetId || null,
              },
            ]),
        ),
      );
    }
    if (targetKinds.has('pet')) {
      const targetPetIds = new Set(
        detail.relations.filter((relation) => relation.targetKind === 'pet').map((relation) => relation.targetId),
      );
      tasks.push(
        getCimmichPets({ limit: 500 }).then(async (pets) =>
          Promise.all(
            pets
              .filter((pet) => targetPetIds.has(pet.petId))
              .map(async (pet) => {
                const previewItems = pet.cover?.sourceAssetId ? [] : await getCimmichPetMedia(pet.petId, 1);
                const preview = previewItems[0];
                return [
                  connectionKey('pet', pet.petId),
                  {
                    objectPosition: '50% 50%',
                    sourceAssetId: pet.cover?.sourceAssetId ?? preview?.sourceAssetId ?? null,
                  },
                ];
              }),
          ),
        ),
      );
    }
    for (const kind of ['event', 'object', 'place'] as const) {
      if (!targetKinds.has(kind)) {
        continue;
      }
      tasks.push(
        getCimmichContextEntities(`${kind}s` as CimmichContextFamily, { limit: 500 }).then((targets) =>
          targets.map((target) => [
            connectionKey(kind, target.entityId),
            { objectPosition: '50% 50%', sourceAssetId: target.coverAssetId },
          ]),
        ),
      );
    }
    const settled = await Promise.allSettled(tasks);
    if (generation !== connectionPresentationGeneration) {
      return false;
    }
    connectionPresentations = Object.fromEntries(
      settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : [])),
    );
    return settled.every((result) => result.status === 'fulfilled');
  };

  const contextRelationRoute = (relation: CimmichContextRelation) => {
    if (relation.targetKind === 'person') {
      return `/cimmich/people/${encodeURIComponent(relation.targetName)}?personId=${encodeURIComponent(relation.targetId)}`;
    }
    if (relation.targetKind === 'pet') {
      return `/cimmich/pets?entityId=${encodeURIComponent(relation.targetId)}`;
    }
    const family = `${relation.targetKind}s` as CimmichContextFamily;
    const root =
      relation.targetKind === 'event'
        ? '/cimmich/events'
        : relation.targetKind === 'object'
          ? '/cimmich/things'
          : '/cimmich/places';
    const search = new SvelteURLSearchParams({ entityId: relation.targetId });
    if (family === 'events') {
      search.set('family', family);
    }
    return `${root}?${search.toString()}`;
  };

  const visitRelated = (relations: CimmichContextRelation[]) => {
    if (!selected || relations.length === 0) {
      return;
    }
    const targetKind = relations[0].targetKind;
    const ids = relations.map((relation) => relation.targetId).join(',');
    const root =
      targetKind === 'person'
        ? '/cimmich/people'
        : targetKind === 'pet'
          ? '/cimmich/pets'
          : targetKind === 'event'
            ? '/cimmich/events'
            : targetKind === 'object'
              ? '/cimmich/things'
              : '/cimmich/places';
    const family = targetKind === 'object' || targetKind === 'place' || targetKind === 'event' ? `${targetKind}s` : '';
    const search = new SvelteURLSearchParams({ relatedFrom: selected.entity.displayName, relatedIds: ids });
    if (family === 'events') {
      search.set('family', family);
    }
    void goto(`${root}?${search.toString()}`);
  };

  $effect(() => {
    const detail = selected;
    const key = `${cimmichVisibilityManager.version}|${connectionPresentationSignature(detail)}`;
    if (key === connectionPresentationKey) {
      return;
    }
    connectionPresentationKey = key;
    void loadConnectionPresentations(detail).then((complete) => {
      // A partial or failed load may retry on the next detail change instead
      // of pinning stale placeholders for the rest of the session.
      if (!complete && connectionPresentationKey === key) {
        connectionPresentationKey = '';
      }
    });
  });

  $effect(() => {
    if (routeLoadSignature) {
      untrack(() => {
        const requestedFamily = resolveRequestedFamily();
        const requestedName = requestedEntityName;
        const requestedEntityId = contextRequestedEntityId(page.url.searchParams, requestedFamily ?? activeFamily);
        if (requestedFamily) {
          activeFamily = requestedFamily;
        }
        detailRequestGeneration += 1;
        entities = [];
        libraryAssets = [];
        libraryLoaded = false;
        selectedSourceIds = [];
        if (showAssetPicker && assetPickerMode === 'library') {
          void loadLibrary();
        }
        if (!requestedEntityId && !requestedName) {
          selected = null;
        }
        void loadEntities();
      });
    }
  });
</script>

<div class="mx-auto w-full max-w-7xl px-5 pb-20 text-immich-fg sm:px-7 dark:text-immich-dark-fg">
  <div class={selected ? 'hidden' : 'py-5'}>
    <div>
      <CimmichSectionHeader icon={iconForFamily(activeFamily)} title={collectionTitle} meta={collectionMeta}>
        {#snippet actions()}
          {#if activeFamily === 'places'}
            <CimmichPlaceCollectionControls
              view={placeCollectionView}
              groupMode={placeGroupMode}
              sortMode={placeSortMode}
              onViewChange={(view) => (placeCollectionView = view)}
              onGroupModeChange={(mode) => (placeGroupMode = mode)}
              onSortModeChange={(mode) => (placeSortMode = mode)}
            />
          {/if}
          {#if !(activeFamily === 'events' && loaded && entities.length === 0 && !query)}
            <form
              class={activeFamily === 'places' ? 'w-full min-w-0 sm:w-40 lg:w-44' : 'w-full min-w-0 sm:w-56 lg:w-64'}
              role="search"
              onsubmit={(event) => {
                event.preventDefault();
                submitCollectionSearch();
              }}
            >
              <label class="relative block">
                <span class="sr-only">Search {contextFamilyLabels[activeFamily]}</span>
                <Icon
                  class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-gray-500"
                  icon={mdiMagnify}
                  size="18"
                />
                <input
                  class="h-11 w-full rounded-xl border border-gray-200 bg-white pr-3 pl-10 text-sm outline-none focus:border-primary dark:border-gray-700 dark:bg-gray-900"
                  bind:value={query}
                  maxlength="500"
                  oninput={queueCollectionSearch}
                  placeholder={`Search ${contextFamilyLabels[activeFamily].toLowerCase()}`}
                />
              </label>
            </form>
            <div class="relative">
              <button
                class="flex size-11 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 hover:text-primary dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                class:text-primary={showArchived || collectionTypeFilter !== 'all'}
                type="button"
                aria-label="Filter collection"
                aria-expanded={showCollectionFilters}
                aria-haspopup="menu"
                title="Filter"
                onclick={() => (showCollectionFilters = !showCollectionFilters)}
              >
                <Icon icon={mdiFilterVariant} size="20" />
              </button>
              {#if showCollectionFilters}
                <div
                  class="absolute top-12 right-0 z-30 grid min-w-52 gap-1 rounded-2xl border border-gray-200 bg-white p-1.5 text-sm font-semibold shadow-xl dark:border-gray-700 dark:bg-gray-900"
                  role="menu"
                  aria-label="Collection filters"
                >
                  <button
                    class="flex min-h-11 items-center justify-between gap-4 rounded-xl px-3 text-left hover:bg-gray-100 focus-visible:bg-gray-100 focus-visible:outline-none dark:hover:bg-gray-800 dark:focus-visible:bg-gray-800"
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={showArchived}
                    onclick={() => {
                      showArchived = !showArchived;
                      showCollectionFilters = false;
                      void loadEntities();
                    }}
                  >
                    <span>{showArchived ? 'Hide archived' : 'Include archived'}</span>
                    {#if showArchived}<Icon icon={mdiCheck} size="18" />{/if}
                  </button>
                  {#if activeFamily !== 'places'}
                    <label class="grid gap-1 border-t border-gray-200 px-3 py-2 dark:border-gray-700">
                      <span class="text-xs text-gray-500 dark:text-gray-400">Type</span>
                      <select
                        class="min-h-10 rounded-xl bg-gray-100 px-3 outline-none dark:bg-gray-800"
                        aria-label={`Filter ${contextFamilyLabels[activeFamily]}`}
                        value={collectionTypeFilter}
                        onchange={(event) => {
                          collectionTypeFilter = (event.currentTarget as HTMLSelectElement).value as ContextTypeFilter;
                          showCollectionFilters = false;
                        }}
                      >
                        {#each collectionTypeFilters as filter (filter.value)}
                          <option value={filter.value}>{filter.label}</option>
                        {/each}
                      </select>
                    </label>
                  {/if}
                </div>
              {/if}
            </div>
          {/if}
          <button
            class="inline-flex size-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-white shadow-sm hover:bg-primary/90"
            type="button"
            aria-label={addLabel}
            title={addLabel}
            onclick={() =>
              openCreate(activeFamily === 'places' && placeCollectionView === 'geography' ? 'geography' : 'location')}
          >
            <Icon icon={mdiPlus} size="18" />
            <span class="sr-only">{addLabel}</span>
          </button>
        {/snippet}
      </CimmichSectionHeader>
    </div>
  </div>

  {#if error}
    <div
      class="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
      role="alert"
    >
      <p class="font-semibold">{error.message}</p>
      <p class="mt-1 text-xs opacity-80">{error.code}</p>
      <button
        class="mt-3 min-h-11 rounded-full px-4 font-semibold ring-1 ring-current"
        type="button"
        onclick={() => void loadEntities()}>Try again</button
      >
    </div>
  {/if}

  {#if selectedLoading}
    <p class="py-16 text-center text-sm text-gray-500" role="status">Loading details…</p>
  {:else if selected}
    <div class="relative mt-5">
      <button
        class="context-hero-control context-hero-back"
        type="button"
        aria-label={`Back to ${contextFamilyLabels[activeFamily]}`}
        onclick={closeDetail}
      >
        <Icon icon={mdiArrowLeft} size="21" />
      </button>

      <!-- One settings control, opposite the back arrow. Record details,
           hierarchy, visibility, archive and delete all live in the same editor. -->
      {#if !selectedIsGeographyGroup}
        <button
          class="context-hero-control context-hero-settings context-profile-settings"
          type="button"
          aria-label={`Settings for ${selected.entity.displayName}`}
          title="Settings"
          onclick={() => openEdit()}
        >
          <Icon icon={mdiCogOutline} size="20" />
        </button>
      {/if}

      <CimmichContextDetailHero
        detail={selected}
        {entities}
        family={activeFamily}
        onOpenPlan={() => selectDetailTab('plan')}
        plans={selectedPlacePlans}
      />
    </div>

    {#if activeFamily === 'places'}
      {#if selectedPlaceLineage.length > 1}
        <nav class="mt-5 flex min-w-0 items-center gap-1.5 overflow-x-auto text-sm" aria-label="Place hierarchy">
          {#each selectedPlaceLineage as place, index (place.entityId)}
            {#if index > 0}<Icon class="shrink-0 text-gray-400" icon={mdiChevronRight} size="16" />{/if}
            {#if index === selectedPlaceLineage.length - 1}
              <span class="shrink-0 font-semibold" aria-current="page">{place.displayName}</span>
            {:else}
              <a
                class="shrink-0 font-semibold text-primary"
                href={getContextDetailHref(page.url, 'places', place.entityId, place.displayName)}
                >{place.displayName}</a
              >
            {/if}
          {/each}
        </nav>
      {/if}

      {#if selectedPlaceChildren.length > 0}
        <section class="mt-6" aria-labelledby="place-subplaces-title">
          <div class="flex items-center justify-between gap-4">
            <h2 class="text-lg font-semibold" id="place-subplaces-title">Inside {selected.entity.displayName}</h2>
            <div class="flex shrink-0 items-center gap-2">
              <span class="text-xs font-semibold text-gray-500"
                >{selectedPlaceChildren.length} {selectedPlaceChildren.length === 1 ? 'subplace' : 'subplaces'}</span
              >
              {#if selected.entity.placeRole === 'geography'}
                <button
                  class="context-secondary-button min-h-9 px-3 text-xs"
                  type="button"
                  onclick={() =>
                    openCreate(
                      'geography',
                      selectedIsGeographyGroup
                        ? (selectedGeographyGroupRoot?.entityId ?? '')
                        : (selected?.entity.entityId ?? ''),
                      selectedIsGeographyGroup ? selectedGeographyGroup : '',
                    )}><Icon icon={mdiPlus} size="16" /> Add subdivision</button
                >
              {/if}
            </div>
          </div>
          <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {#each selectedPlaceChildren as child (child.entityId)}
              {@const childNames = placeChildNames(child.entityId)}
              {@const childCoverAssetId = cimmichPlaceChildCoverAssetId(child, selected.subtreeAssets ?? [])}
              <a
                class="context-place-child-card group relative min-h-44 overflow-hidden rounded-2xl border border-gray-200 bg-gray-100 transition hover:border-primary hover:shadow-md focus-visible:outline-2 focus-visible:outline-primary dark:border-gray-800 dark:bg-gray-900"
                href={getContextDetailHref(page.url, 'places', child.entityId, child.displayName)}
              >
                {#if childCoverAssetId}
                  <img
                    class="absolute inset-0 size-full object-cover transition duration-300 group-hover:scale-[1.03]"
                    src={getAssetMediaUrl({ id: childCoverAssetId, size: AssetMediaSize.Preview })}
                    alt=""
                    loading="lazy"
                  />
                {:else}
                  <span class="absolute inset-0 grid place-items-center text-gray-400 dark:text-gray-500"
                    ><Icon icon={mdiMapMarkerOutline} size="28" /></span
                  >
                {/if}
                <span
                  class={[
                    'pointer-events-none absolute inset-0',
                    childCoverAssetId
                      ? 'bg-linear-to-t from-black/85 via-black/10 to-black/15'
                      : 'bg-linear-to-t from-black/65 via-transparent to-transparent',
                  ]}
                ></span>
                <span
                  class={[
                    'absolute top-3 right-3 rounded-full px-2.5 py-1 text-xs font-semibold backdrop-blur-sm',
                    childCoverAssetId
                      ? 'bg-black/60 text-white'
                      : 'bg-white/80 text-gray-600 dark:bg-black/35 dark:text-gray-300',
                  ]}>{child.subtreeAssetCount ?? child.assetCount} photos</span
                >
                <div class="absolute inset-x-0 bottom-0 p-4 text-white drop-shadow-sm">
                  <h3 class="text-base font-semibold">{child.displayName}</h3>
                  {#if childNames}
                    <p class="mt-0.5 truncate text-xs text-white/75" title={childNames}>{childNames}</p>
                  {/if}
                </div>
              </a>
            {/each}
          </div>
        </section>
      {/if}

      {#if selectedGeographyLocations.length > 0}
        <section class="mt-6" aria-labelledby="geography-locations-title">
          <div class="flex items-end justify-between gap-4">
            <div>
              <h2 class="text-lg font-semibold" id="geography-locations-title">
                Locations in {selected.entity.displayName}
              </h2>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Human places linked to this geography. Their Location hierarchy remains independent.
              </p>
            </div>
            <span class="shrink-0 text-xs font-semibold text-gray-500">{selectedGeographyLocations.length}</span>
          </div>
          <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {#each selectedGeographyLocations as location (location.entityId)}
              <a
                class="rounded-2xl border border-gray-200 bg-white p-4 transition hover:border-primary hover:shadow-sm dark:border-gray-800 dark:bg-gray-900"
                href={getContextDetailHref(page.url, 'places', location.entityId, location.displayName)}
              >
                <span class="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary"
                  ><Icon icon={mdiMapMarkerOutline} size="20" /></span
                >
                <h3 class="mt-3 font-semibold">{location.displayName}</h3>
                <p class="mt-1 text-xs text-gray-500">{location.subtreeAssetCount ?? location.assetCount} photos</p>
              </a>
            {/each}
          </div>
        </section>
      {/if}
    {/if}

    {#if activeFamily === 'events'}
      {#if selectedEventLineage.length > 1}
        <nav class="mt-5 flex min-w-0 items-center gap-1.5 overflow-x-auto text-sm" aria-label="Event hierarchy">
          {#each selectedEventLineage as memory, index (memory.entityId)}
            {#if index > 0}<Icon class="shrink-0 text-gray-400" icon={mdiChevronRight} size="16" />{/if}
            {#if index === selectedEventLineage.length - 1}
              <span class="shrink-0 font-semibold" aria-current="page">{memory.displayName}</span>
            {:else}
              <a
                class="shrink-0 font-semibold text-primary"
                href={getContextDetailHref(page.url, 'events', memory.entityId, memory.displayName)}
                >{memory.displayName}</a
              >
            {/if}
          {/each}
        </nav>
      {/if}
      {#if selectedEventChildren.length > 0}
        <section
          class="mt-6 rounded-3xl border border-gray-200 p-5 dark:border-gray-800"
          aria-labelledby="event-chapters-title"
        >
          <div class="flex items-end justify-between gap-4">
            <div>
              <p class="text-xs font-bold tracking-[0.14em] text-primary uppercase">Inside this memory</p>
              <h2 class="mt-1 text-lg font-semibold" id="event-chapters-title">Chapters and moments</h2>
            </div>
            <span class="text-xs font-semibold text-gray-500">{selectedEventChildren.length}</span>
          </div>
          <div class="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {#each selectedEventChildren as child (child.entityId)}
              {@const nestedItemCount = child.subtreeAssetCount ?? child.assetCount}
              <a
                class="rounded-2xl bg-gray-50 p-4 transition hover:bg-primary/10 dark:bg-gray-800/70"
                href={getContextDetailHref(page.url, 'events', child.entityId, child.displayName)}
              >
                <strong class="block">{child.displayName}</strong>
                <span class="mt-1 block text-xs text-gray-500"
                  >{contextTypeLabel(child.typeKind)} · {child.assetCount} direct
                  {child.assetCount === 1 ? 'item' : 'items'}{#if nestedItemCount > child.assetCount}
                    · {nestedItemCount} including nested moments{/if}</span
                >
              </a>
            {/each}
          </div>
        </section>
      {/if}
    {/if}

    <div class="context-profile-rail mt-6">
      <div
        class="context-profile-tabs"
        role="tablist"
        aria-label={`${selected.entity.displayName} content`}
        use:keyboardTabs
      >
        {#each detailTabs as tab (tab.value)}
          <button
            class:context-profile-tab--active={activeDetailTab === tab.value}
            class="context-profile-tab"
            type="button"
            role="tab"
            aria-selected={activeDetailTab === tab.value}
            tabindex={activeDetailTab === tab.value ? 0 : -1}
            onclick={() => selectDetailTab(tab.value)}
          >
            <Icon icon={tab.icon} size="18" />
            {tab.label}
            {#if tab.value === 'photos'}<span
                >{activeFamily === 'places' ? placeDetailAssetCount : selected.assets.length}</span
              >{/if}
            {#if tab.value === 'connections'}<span>{selected.relations.length}</span>{/if}
            {#if tab.value === 'journey'}<span>{selectedEventStops.length}</span>{/if}
          </button>
        {/each}
      </div>
      <!-- Below 640px these collapse to icon-only 44x44 buttons by hiding the
           label with `display: none` — and display:none content is EXCLUDED from
           the accessible name computation, so on a phone each of these announced
           as an unnamed button. The aria-label carries the name at every width. -->
      {#if activeDetailTab === 'photos'}
        <button
          class="context-secondary-button context-profile-action"
          class:context-profile-action--active={mediaSelectionMode}
          type="button"
          aria-label={mediaSelectionMode ? 'Exit photo selection' : 'Select photos'}
          aria-pressed={mediaSelectionMode}
          onclick={() => {
            mediaSelectionMode = !mediaSelectionMode;
            selectedPlaceAssetIds = [];
          }}
        >
          <Icon icon={mdiSelectAll} size="19" /> <span>{mediaSelectionMode ? 'Done' : 'Select'}</span>
        </button>
        {#if activeFamily === 'places'}
          <div class="context-place-photo-options context-profile-action" aria-label="Photo view options">
            <label title="Sort photos">
              <Icon icon={mdiSortVariant} size="19" />
              <select bind:value={placePhotoSort} aria-label="Sort photos">
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="filename">Filename</option>
              </select>
            </label>
            <label title="Group photos">
              <Icon icon={mdiGroup} size="19" />
              <select bind:value={placePhotoGroup} aria-label="Group photos">
                <option value="none">No grouping</option>
                <option value="year">Year</option>
                {#if selectedPlaceChildren.length > 0}<option value="subsection">Subsection</option>{/if}
              </select>
            </label>
            <label title="Thumbnail size">
              <Icon icon={mdiViewGridOutline} size="19" />
              <select bind:value={placePhotoSize} aria-label="Thumbnail size">
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
              </select>
            </label>
          </div>
        {/if}
        {#if !selectedIsGeographyGroup}
          {#if activeFamily === 'events'}
            {#if (selected.entity.sourceFolders?.length ?? 0) > 0}
              <button
                class="context-secondary-button context-profile-action"
                type="button"
                aria-label="Refresh source folders"
                disabled={isSaving}
                onclick={() => void refreshEventFolders()}
              >
                <Icon icon={mdiFolderMultipleOutline} size="18" /> <span>Refresh folders</span>
              </button>
            {/if}
            <button
              class="context-secondary-button context-profile-action"
              type="button"
              aria-label={`Copy ${selected.entity.displayName} into another event`}
              onclick={openEventCopy}
            >
              <Icon icon={mdiContentCopy} size="18" /> <span>Copy event</span>
            </button>
          {/if}
          <button
            class={[
              'context-profile-action',
              activeFamily === 'places' ? 'context-profile-add-media' : 'context-primary-button',
            ]}
            type="button"
            aria-label="Add media"
            title="Add media"
            onclick={openAssetPicker}
          >
            <Icon icon={mdiLinkPlus} size="19" />
            {#if activeFamily !== 'places'}<span>Add media</span>{/if}
          </button>
        {/if}
      {:else if activeDetailTab === 'journey'}
        <button
          class="context-primary-button context-profile-action"
          type="button"
          aria-label="Add trip stop"
          onclick={openTripStopPicker}
        >
          <Icon icon={mdiMapMarkerOutline} size="19" /> <span>Add stop</span>
        </button>
      {:else if activeDetailTab === 'connections'}
        <button
          class="context-secondary-button context-profile-action"
          type="button"
          aria-label="Add connection"
          onclick={openRelationPicker}
        >
          <Icon icon={mdiLinkPlus} size="19" /> <span>Add connection</span>
        </button>
      {/if}

      {#if undoDecisionId}
        <button
          class="context-secondary-button context-profile-action"
          type="button"
          aria-label={undoLabel}
          disabled={isSaving}
          onclick={() => void undoAssets()}
        >
          <Icon icon={mdiUndoVariant} size="18" />
          <span>{undoLabel}</span>
        </button>
      {/if}
    </div>

    {#if activeDetailTab === 'photos'}
      <div role="tabpanel" aria-label="Photos">
        {#if entityKind === 'event' && selected.assets.length > 0}
          <div class="mt-5 flex max-w-full gap-2 overflow-x-auto pb-1" aria-label="Event media lane">
            {#each [{ label: 'All', value: 'all' }, { label: 'Main', value: 'main' }, { label: 'Stops', value: 'stops' }, { label: 'Adjacent', value: 'adjacent' }, { label: 'Needs check', value: 'needs_check' }] as lane (lane.value)}
              <button
                class="context-detail-lane"
                class:context-detail-lane--active={eventMediaLane === lane.value}
                type="button"
                aria-pressed={eventMediaLane === lane.value}
                onclick={() => selectEventMediaLane(lane.value as typeof eventMediaLane)}
                >{lane.label}
                <span>{eventMediaLaneCounts[lane.value as keyof typeof eventMediaLaneCounts]}</span></button
              >
            {/each}
          </div>
          <p class="context-detail-lane-note">{eventMediaLaneDescription}</p>
        {/if}
        {#if entityKind === 'place' && selectedPlaceChildren.length > 0 && placeDetailAssetCount > 0}
          <div class="mt-5 flex max-w-full gap-2 overflow-x-auto pb-1" aria-label="Place photo sections">
            {#if !selectedIsGeographyGroup}<button
                class="context-detail-lane"
                class:context-detail-lane--active={placeMediaLane === 'all'}
                type="button"
                aria-pressed={placeMediaLane === 'all'}
                onclick={() => selectPlaceMediaLane('all')}>All <span>{placeDetailAssetCount}</span></button
              >
              <button
                class="context-detail-lane"
                class:context-detail-lane--active={placeMediaLane === 'unassigned'}
                type="button"
                aria-pressed={placeMediaLane === 'unassigned'}
                onclick={() => selectPlaceMediaLane('unassigned')}
                >Unassigned <span
                  >{selected.subtreeAssets?.filter(
                    (asset) => asset.directlyAssigned && asset.branchEntityIds.length === 0,
                  ).length ?? selected.assets.length}</span
                ></button
              >{/if}
            {#each selectedPlaceChildren as child (child.entityId)}
              <button
                class="context-detail-lane"
                class:context-detail-lane--active={placeMediaLane === child.entityId}
                type="button"
                aria-pressed={placeMediaLane === child.entityId}
                onclick={() => selectPlaceMediaLane(child.entityId)}
                >{child.displayName}
                <span
                  >{selected.subtreeAssets?.filter((asset) => asset.branchEntityIds.includes(child.entityId)).length ??
                    0}</span
                ></button
              >
            {/each}
          </div>
        {/if}
        <CimmichEntityMediaActions
          currentScope={selectedIsGeographyGroup
            ? null
            : {
                displayName: selected.entity.displayName,
                entityId: selected.entity.entityId,
                family: activeFamily,
              }}
          items={selectedEntityMediaItems}
          moveWithinPlaceTargets={selected.entity.placeRole === 'location'
            ? selectedPlaceMoveTargets.map(({ depth, entity, path }) => ({
                depth,
                entityId: entity.entityId,
                label: entity.displayName,
                path,
              }))
            : []}
          onChanged={refreshSelectedDetail}
          onClear={() => (selectedPlaceAssetIds = [])}
          onMoveWithinPlace={assignSelectedPlaceAssets}
          onSelectShown={visibleDetailAssets.length > 0 ? selectShownPlaceAssets : undefined}
          showControls={mediaSelectionMode}
        />
        {#if (entityKind === 'place' ? placeDetailAssetCount : selected.assets.length) === 0}
          <div
            class="mt-5 rounded-3xl border border-dashed border-gray-300 px-6 py-14 text-center dark:border-gray-700"
          >
            <Icon class="mx-auto text-gray-400" icon={mdiImageMultipleOutline} size="32" />
            <p class="mt-3 font-semibold">No linked media yet</p>
            <p class="mt-1 text-sm text-gray-500">The {entityNoun} stays visible even without photos.</p>
          </div>
        {:else if visibleDetailAssets.length === 0}
          <div
            class="mt-5 rounded-3xl border border-dashed border-gray-300 px-6 py-10 text-center dark:border-gray-700"
          >
            <p class="font-semibold">Nothing in this lane yet</p>
            <p class="mt-1 text-sm text-gray-500">Choose All or add media with this relationship.</p>
          </div>
        {:else}
          {#each groupedDetailAssets as photoGroup (photoGroup.id)}
            <section class="mt-5 grid gap-3">
              {#if photoGroup.label}
                <div class="flex items-center gap-3">
                  <h2 class="text-base font-semibold text-gray-800 dark:text-gray-100">{photoGroup.label}</h2>
                  <span class="text-sm text-gray-500 dark:text-gray-400"
                    >{photoGroup.items.length.toLocaleString()}</span
                  >
                  <div class="h-px flex-1 bg-gray-200 dark:bg-gray-700"></div>
                </div>
              {/if}
              <div
                class={entityKind === 'place'
                  ? placePhotoGridClass(placePhotoSize)
                  : 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4'}
              >
                {#each photoGroup.items as asset (asset.associationId)}
                  {@const directlyAssignedHere = !('directlyAssigned' in asset) || asset.directlyAssigned}
                  {@const placeSectionNames =
                    entityKind === 'place' && 'branchEntityIds' in asset
                      ? cimmichPlaceAssetSectionNames(asset, selectedPlaceChildren)
                      : []}
                  {@const mediaContextLabel =
                    entityKind === 'place'
                      ? placeSectionNames.join(' · ')
                      : contextAssociationLabel(entityKind, asset.associationKind)}
                  <article
                    class="group relative aspect-square overflow-hidden rounded-2xl bg-gray-100 dark:bg-gray-800"
                    class:context-place-photo--selected={placeAssetSelected(asset.assetId)}
                  >
                    <a
                      class="block size-full focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white"
                      href={contextAssetViewerHref(asset.sourceAssetId)}
                      aria-label={`Open ${asset.filename}`}
                      onclick={(event) =>
                        handleCimmichMediaCardClick(event, mediaSelectionMode, () =>
                          togglePlaceAssetSelection(asset.assetId),
                        )}
                    >
                      <img
                        class="size-full object-cover transition duration-200 group-hover:scale-[1.025]"
                        src={getAssetMediaUrl({ id: asset.sourceAssetId, size: AssetMediaSize.Preview })}
                        alt=""
                        loading="lazy"
                      />
                      {#if mediaContextLabel}<span
                          class="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/80 to-transparent p-3 pt-10 text-xs font-semibold text-white"
                          >{mediaContextLabel}</span
                        >{/if}
                    </a>
                    <CimmichDuplicateIndicator sourceAssetId={asset.sourceAssetId} />
                    {#if mediaSelectionMode}
                      <button
                        class="context-place-photo-select"
                        class:context-place-photo-select--active={placeAssetSelected(asset.assetId)}
                        type="button"
                        aria-label={`${placeAssetSelected(asset.assetId) ? 'Deselect' : 'Select'} ${asset.filename}`}
                        aria-pressed={placeAssetSelected(asset.assetId)}
                        disabled={isSaving}
                        onclick={() => togglePlaceAssetSelection(asset.assetId)}
                      >
                        {#if placeAssetSelected(asset.assetId)}<Icon icon={mdiCheck} size="18" />{/if}
                      </button>
                    {/if}
                    {#if selected.entity.coverAssetId === asset.sourceAssetId}
                      <span
                        class="absolute top-10 left-2 z-1 rounded-full bg-black/62 px-2.5 py-1.5 text-[11px] font-bold text-white shadow-sm backdrop-blur-sm"
                        >Cover</span
                      >
                    {/if}
                    <button
                      class="absolute top-2 right-2 z-2 flex size-10 items-center justify-center rounded-full bg-black/55 text-white opacity-100 shadow-sm backdrop-blur-sm transition focus-visible:outline-2 focus-visible:outline-white sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                      type="button"
                      aria-label={`Options for ${asset.filename}`}
                      aria-expanded={mediaMenuAssetId === asset.associationId}
                      aria-haspopup="menu"
                      title={`Options for ${asset.filename}`}
                      disabled={isSaving}
                      onclick={() =>
                        (mediaMenuAssetId = mediaMenuAssetId === asset.associationId ? null : asset.associationId)}
                    >
                      <Icon icon={mdiDotsVertical} size="20" />
                    </button>
                    {#if mediaMenuAssetId === asset.associationId}
                      <div
                        class="absolute top-13 right-2 z-3 grid min-w-44 gap-1 rounded-2xl border border-white/15 bg-black/88 p-1.5 text-left text-xs font-semibold text-white shadow-2xl backdrop-blur-lg"
                        role="menu"
                        aria-label={`Options for ${asset.filename}`}
                      >
                        <button
                          class="min-h-10 rounded-xl px-3 text-left hover:bg-white/12 focus-visible:bg-white/12 focus-visible:outline-none"
                          type="button"
                          role="menuitem"
                          disabled={isSaving}
                          onclick={() => {
                            mediaSelectionMode = true;
                            selectedPlaceAssetIds = [asset.assetId];
                            mediaMenuAssetId = null;
                          }}>Select for actions</button
                        >
                        {#if entityKind === 'place' || entityKind === 'object' || entityKind === 'event'}
                          {#if selected.entity.coverMode === 'explicit' && selected.entity.coverAssetId === asset.sourceAssetId}
                            <button
                              class="min-h-10 rounded-xl px-3 text-left hover:bg-white/12 focus-visible:bg-white/12 focus-visible:outline-none"
                              type="button"
                              role="menuitem"
                              disabled={isSaving}
                              onclick={() => void changeContextCover(null)}>Use automatic cover</button
                            >
                          {:else}
                            <button
                              class="min-h-10 rounded-xl px-3 text-left hover:bg-white/12 focus-visible:bg-white/12 focus-visible:outline-none"
                              type="button"
                              role="menuitem"
                              disabled={isSaving}
                              onclick={() => void changeContextCover(asset.sourceAssetId)}>Use as cover</button
                            >
                          {/if}
                        {/if}
                        {#if entityKind === 'event'}
                          {#if asset.associationKind !== 'direct' && asset.associationKind !== 'manual'}
                            <button
                              class="min-h-10 rounded-xl px-3 text-left hover:bg-white/12 focus-visible:bg-white/12 focus-visible:outline-none"
                              type="button"
                              role="menuitem"
                              disabled={isSaving}
                              onclick={() => void reclassifyEventAsset(asset.assetId, 'direct')}>Promote to Main</button
                            >
                          {/if}
                          {#if asset.associationKind !== 'route_stop'}
                            <button
                              class="min-h-10 rounded-xl px-3 text-left hover:bg-white/12 focus-visible:bg-white/12 focus-visible:outline-none"
                              type="button"
                              role="menuitem"
                              disabled={isSaving}
                              onclick={() => void reclassifyEventAsset(asset.assetId, 'route_stop')}
                              >Move to Stops</button
                            >
                          {/if}
                          {#if asset.associationKind !== 'context'}
                            <button
                              class="min-h-10 rounded-xl px-3 text-left hover:bg-white/12 focus-visible:bg-white/12 focus-visible:outline-none"
                              type="button"
                              role="menuitem"
                              disabled={isSaving}
                              onclick={() => void reclassifyEventAsset(asset.assetId, 'context')}
                              >Move to Adjacent context</button
                            >
                          {/if}
                          {#if asset.associationKind !== 'needs_check'}
                            <button
                              class="min-h-10 rounded-xl px-3 text-left hover:bg-white/12 focus-visible:bg-white/12 focus-visible:outline-none"
                              type="button"
                              role="menuitem"
                              disabled={isSaving}
                              onclick={() => void reclassifyEventAsset(asset.assetId, 'needs_check')}
                              >Move to Needs check</button
                            >
                          {/if}
                        {/if}
                        {#if entityKind === 'place' && selectedPlaceChildren.length > 0}
                          {#each selectedPlaceChildren as child (child.entityId)}
                            <button
                              class="min-h-10 rounded-xl px-3 text-left hover:bg-white/12 focus-visible:bg-white/12 focus-visible:outline-none"
                              type="button"
                              role="menuitem"
                              disabled={isSaving}
                              onclick={() => void assignAssetToPlaceChild(asset.assetId, child)}
                              >Move to {child.displayName}</button
                            >
                          {/each}
                        {/if}
                        {#if directlyAssignedHere}<button
                            class="flex min-h-10 items-center gap-2 rounded-xl px-3 text-left text-red-200 hover:bg-red-500/18 focus-visible:bg-red-500/18 focus-visible:outline-none"
                            type="button"
                            role="menuitem"
                            disabled={isSaving}
                            onclick={() => {
                              mediaMenuAssetId = null;
                              void detachAsset(asset.assetId);
                            }}><Icon icon={mdiTrashCanOutline} size="17" /> Remove from {entityNoun}</button
                          >{/if}
                      </div>
                    {/if}
                  </article>
                {/each}
              </div>
            </section>
          {/each}
        {/if}
      </div>
    {:else if activeDetailTab === 'journey' && selected.entity.typeKind === 'trip'}
      <div class="context-journey" role="tabpanel" aria-label="Journey">
        <div class="context-journey-heading">
          <div>
            <p class="text-xs font-bold tracking-[0.16em] text-primary uppercase">Route</p>
            <h2>Build the journey in order</h2>
            <p>Stops are Places, not text labels—so each one stays useful across your whole library.</p>
          </div>
          <span>{selectedEventStops.length} {selectedEventStops.length === 1 ? 'stop' : 'stops'}</span>
        </div>
        {#if selectedEventStops.length === 0}
          <button class="context-journey-empty" type="button" onclick={openTripStopPicker}>
            <span><Icon icon={mdiMapMarkerOutline} size="24" /></span>
            <strong>Add the first stop</strong>
            <small>Choose a Place now; reorder or remove it at any time.</small>
          </button>
        {:else}
          <ol class="context-stop-list">
            {#each selectedEventStops as stop, index (stop.relationId)}
              <li>
                <div class="context-stop-number" aria-hidden="true">{index + 1}</div>
                <div class="context-stop-copy">
                  <strong>{stop.targetName}</strong>
                  <small
                    >{index === 0
                      ? 'Start'
                      : index === selectedEventStops.length - 1
                        ? 'Final stop'
                        : `Stop ${index + 1}`}</small
                  >
                </div>
                <div class="context-stop-actions">
                  <button
                    type="button"
                    aria-label={`Move ${stop.targetName} earlier`}
                    disabled={isSaving || index === 0}
                    onclick={() => void moveTripStop(index, -1)}><Icon icon={mdiArrowUp} size="18" /></button
                  ><button
                    type="button"
                    aria-label={`Move ${stop.targetName} later`}
                    disabled={isSaving || index === selectedEventStops.length - 1}
                    onclick={() => void moveTripStop(index, 1)}><Icon icon={mdiArrowDown} size="18" /></button
                  ><button
                    class="context-stop-remove"
                    type="button"
                    aria-label={`Remove ${stop.targetName} from trip`}
                    disabled={isSaving}
                    onclick={() => void removeRelation(stop)}><Icon icon={mdiTrashCanOutline} size="18" /></button
                  >
                </div>
              </li>
            {/each}
          </ol>
          <p class="context-journey-note">
            Stop media remains in the separate Stops photo lane, so the defining story never gets muddled with route
            context.
          </p>
        {/if}
      </div>
    {:else if activeDetailTab === 'map' && activeFamily === 'places'}
      <div class="mt-7 grid gap-5" role="tabpanel" aria-label="Map">
        {#if selectedPlaceChildren.length > 0}
          <CimmichPlaceCanvas
            children={selectedPlaceChildren}
            onOpenPlace={openEntity}
            onSaveZone={savePlaceChildZone}
            parent={selected.entity}
          />
        {/if}
        <CimmichContextPlaceMap detail={selected} />
      </div>
    {:else if activeDetailTab === 'plan' && activeFamily === 'places' && selected.entity.placeRole === 'location'}
      <div class="mt-7" role="tabpanel" aria-label="Plan">
        <CimmichPlacePlan
          children={selectedPlaceChildren}
          coverSourceAssetId={selected.entity.coverAssetId}
          onCreateSublocation={createPlanSublocation}
          onOpenPlace={openEntity}
          onSave={saveLocationPlan}
          parent={selected.entity}
          plans={selectedPlacePlans}
        />
      </div>
    {:else if activeDetailTab === 'connections'}
      <div role="tabpanel" aria-label="Connections">
        <div class="mt-7">
          <div>
            <h2 class="text-xl font-semibold">Connected context</h2>
            <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
              People, pets, Places, Things and Events that belong in the same story.
            </p>
          </div>
        </div>
        {#if selected.relations.length === 0}
          <div
            class="mt-4 rounded-3xl border border-gray-200 bg-white p-6 text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400"
          >
            No connections yet.
          </div>
        {:else}
          <div class="mt-4 flex flex-wrap items-start gap-4">
            {#each visibleRelationGroups as group (group.label)}
              <section class="context-relation-group" aria-label={group.label}>
                <div class="context-relation-group-header">
                  <p class="context-relation-group-title">{group.label}</p>
                  <button class="context-relation-visit" type="button" onclick={() => visitRelated(group.relations)}>
                    Visit related
                  </button>
                </div>
                <ul class="context-relation-cards">
                  {#each group.relations as relation (relation.relationId)}
                    {@const presentation =
                      connectionPresentations[connectionKey(relation.targetKind, relation.targetId)]}
                    <li class="context-relation-card">
                      <div class="context-relation-identity">
                        {#if presentation?.sourceAssetId}
                          <img
                            src={getAssetMediaUrl({ id: presentation.sourceAssetId, size: AssetMediaSize.Preview })}
                            alt=""
                            style:object-position={presentation.objectPosition}
                          />
                        {:else}
                          <span aria-hidden="true">{relation.targetName.slice(0, 1).toLocaleUpperCase()}</span>
                        {/if}
                        <p>{relation.targetName}</p>
                      </div>
                      <div class="context-relation-actions">
                        <button type="button" onclick={() => void goto(contextRelationRoute(relation))}>Show</button>
                        <button
                          class="context-relation-remove"
                          type="button"
                          aria-label={`Remove connection to ${relation.targetName}`}
                          title={`Remove connection to ${relation.targetName}`}
                          disabled={isSaving}
                          onclick={() => void removeRelation(relation)}
                          ><Icon icon={mdiTrashCanOutline} size="17" /></button
                        >
                      </div>
                    </li>
                  {/each}
                </ul>
              </section>
            {/each}
          </div>
        {/if}
      </div>
    {:else}
      <div role="tabpanel" aria-label="Documents">
        <div class="mt-7">
          <CimmichDocuments
            heading={`Documents for ${selected.entity.displayName}`}
            subject={{
              id: selected.entity.entityId,
              kind: selected.entity.entityKind,
              name: selected.entity.displayName,
            }}
          />
        </div>
      </div>
    {/if}
  {:else if !loaded}
    <div class="grid gap-4 py-8 sm:grid-cols-2 lg:grid-cols-3">
      {#each Array.from({ length: 6 }) as _, index (index)}
        <div class="h-44 animate-pulse rounded-3xl bg-gray-100 dark:bg-gray-800"></div>
      {/each}
    </div>
  {:else if entities.length === 0 && query}
    <section class="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-4 text-center">
      <span class="flex size-16 items-center justify-center rounded-3xl bg-primary/10 text-primary"
        ><Icon icon={iconForFamily(activeFamily)} size="32" /></span
      >
      <h1 class="mt-6 text-2xl font-semibold">No {contextFamilyLabels[activeFamily].toLowerCase()} found</h1>
      <p class="mt-3 text-sm/6 text-gray-600 dark:text-gray-300">Try another name, alias or description.</p>
      <button
        class="context-secondary-button mt-6"
        type="button"
        onclick={() => {
          query = '';
          void loadEntities();
        }}>Clear search</button
      >
    </section>
  {:else}
    {#if relatedIds.size > 0}
      <div class="context-related-filter" role="status">
        <div>
          <p>Related to {relatedFrom || 'this connection'}</p>
          <span>{displayedEntities.length} shown</span>
        </div>
        <button
          type="button"
          onclick={() => {
            const url = new URL(page.url);
            url.searchParams.delete('relatedIds');
            url.searchParams.delete('relatedFrom');
            void goto(`${url.pathname}${url.search}`);
          }}>Show all</button
        >
      </div>
    {/if}
    <CimmichContextCollection
      family={activeFamily}
      controlledPlaceView={activeFamily === 'places' ? placeCollectionView : undefined}
      controlledPlaceGroupMode={activeFamily === 'places' ? placeGroupMode : undefined}
      controlledPlaceSortMode={activeFamily === 'places' ? placeSortMode : undefined}
      entities={displayedEntities}
      includeNestedPlaces={Boolean(query.trim())}
      controlledTypeFilter={activeFamily === 'places' ? undefined : collectionTypeFilter}
      entityHref={(entity) => getContextDetailHref(page.url, activeFamily, entity.entityId, entity.displayName)}
      geographyGroupHref={(groupName) => getContextGeographyGroupHref(page.url, groupName)}
      onAdd={openCreate}
      onEventStartFromPhotos={activeFamily === 'events' ? openEventSeedPicker : undefined}
      onOpen={openEntity}
      onPlacesChanged={() => loadEntities({ preserveCollection: true })}
    />
  {/if}
</div>

{#if showEditor}
  <div
    class="fixed inset-0 z-100 flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-6"
    role="presentation"
    onkeydown={(event) => {
      if (event.key === 'Escape' && !isSaving) {
        closeEditor();
      }
    }}
    onclick={(event) => {
      if (event.currentTarget === event.target && !isSaving) {
        closeEditor();
      }
    }}
  >
    <div
      class="max-h-[92vh] w-full overflow-y-auto rounded-t-4xl bg-white p-6 text-immich-fg shadow-2xl sm:max-w-2xl sm:rounded-4xl sm:p-8 dark:bg-gray-900 dark:text-immich-dark-fg"
      role="dialog"
      aria-modal="true"
      aria-labelledby="context-editor-title"
      use:focusTrap
    >
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-xs font-bold tracking-[0.16em] text-primary uppercase">{entityNoun}</p>
          <h2 class="mt-1 text-2xl font-semibold" id="context-editor-title">
            {editorMode === 'create'
              ? formGeographyGroupName
                ? `New subdivision in ${formGeographyGroupName}`
                : entityKind === 'event'
                  ? 'New memory'
                  : `New ${entityNoun}`
              : `Settings for ${selected?.entity.displayName}`}
          </h2>
        </div>
        <button class="context-icon-button" type="button" aria-label="Close" disabled={isSaving} onclick={closeEditor}
          ><Icon icon={mdiClose} size="22" /></button
        >
      </div>
      {#if editorMode === 'create' && !editorTypeChosen && entityKind !== 'place'}
        <section class="mt-7" aria-label={`Choose ${entityNoun} type`}>
          <p class="text-sm text-gray-600 dark:text-gray-300">
            {entityKind === 'event' ? 'What kind of memory are you bringing together?' : 'What kind of thing is it?'}
          </p>
          {#if entityKind === 'event' && eventSeedSourceIds.length > 0}
            <div class="context-event-seed-summary">
              <Icon icon={mdiImageMultipleOutline} size="19" />
              <span
                >{eventSeedSourceIds.length}
                {eventSeedSourceIds.length === 1 ? 'photo' : 'photos'} ready for this memory</span
              >
            </div>
          {/if}
          <div class="context-type-choice-grid">
            {#each contextTypeKinds[entityKind] as kind (kind)}
              <button
                class="context-type-choice"
                type="button"
                onclick={() => {
                  if (entityKind === 'event' && formDatePrecision === 'unknown') {
                    formDatePrecision = 'exact';
                  }
                  formType = kind;
                  editorTypeChosen = true;
                }}
              >
                <span><Icon icon={iconForFamily(activeFamily)} size="21" /></span>
                <strong>{contextTypeLabel(kind)}</strong>
                <small>{contextTypeDescription(kind)}</small>
              </button>
            {/each}
          </div>
        </section>
      {:else}
        <form bind:this={editorForm} class="mt-7 grid gap-5" onsubmit={(event) => void saveEntity(event)}>
          <label class="context-field"
            ><span>Name</span><input bind:value={formName} maxlength="160" autocomplete="off" /></label
          >
          {#if entityKind === 'place'}
            <label class="context-field">
              <span>Place role</span>
              <select
                bind:value={formPlaceRole}
                onchange={() => {
                  const parent = entities.find((entity) => entity.entityId === formParentId);
                  if (
                    parent?.placeRole &&
                    parent.placeRole !== 'unclassified' &&
                    formPlaceRole !== 'unclassified' &&
                    parent.placeRole !== formPlaceRole
                  ) {
                    formParentId = '';
                    formDirectoryVisibility = 'listed';
                  }
                  if (formPlaceRole !== 'location') {
                    formGeographyEntityId = '';
                  }
                }}
              >
                <option value="location">Location — home, venue, room or yard</option>
                <option value="geography">Geography — country, region, town or area</option>
                {#if editorMode === 'edit'}<option value="unclassified">Needs classification</option>{/if}
              </select>
            </label>
            <p class="-mt-3 text-xs text-gray-500 dark:text-gray-400">
              Locations describe where life happens. Geography describes where it sits on Earth; the two stay linked
              without becoming the same hierarchy.
            </p>
          {/if}
          {#if entityKind !== 'place'}
            {#if editorMode === 'create'}
              <div class="context-chosen-type">
                <span><Icon icon={iconForFamily(activeFamily)} size="20" /></span>
                <span class="min-w-0 flex-1">
                  <strong>{contextTypeLabel(formType)}</strong>
                  <small>{contextTypeDescription(formType)}</small>
                </span>
                <button type="button" onclick={() => (editorTypeChosen = false)}>Change</button>
              </div>
            {:else}
              <label class="context-field"
                ><span>Type</span><select bind:value={formType}
                  >{#each contextTypeKinds[entityKind] as kind (kind)}<option value={kind}
                      >{contextTypeLabel(kind)}</option
                    >{/each}</select
                ></label
              >
            {/if}
          {/if}
          {#if entityKind === 'object'}
            <div class="context-event-form-guidance">
              <span><Icon icon={iconForFamily(activeFamily)} size="20" /></span>
              <div>
                <strong>When this thing belonged in your life</strong>
                <p>Dates are optional. Use a year or approximation when the exact day is not known.</p>
              </div>
            </div>
            <label class="context-field"
              ><span>Date certainty</span><select bind:value={formDatePrecision}
                ><option value="exact">Exact dates</option><option value="approximate">Approximate</option><option
                  value="month">Known month</option
                ><option value="year">Known year</option><option value="unknown">Not known yet</option></select
              ></label
            >
            <div class="grid gap-4 sm:grid-cols-2">
              <label class="context-field"
                ><span>From <small>Optional</small></span><input type="date" bind:value={formDateStart} /></label
              ><label class="context-field"
                ><span>Until <small>Optional</small></span><input type="date" bind:value={formDateEnd} /></label
              >
            </div>
          {/if}
          {#if entityKind === 'event'}
            <div class="context-event-form-guidance">
              <span><Icon icon={iconForFamily(activeFamily)} size="20" /></span>
              <div>
                <strong>{contextTypeLabel(formType)}</strong>
                <p>{eventCreationGuidance}</p>
                {#if eventSeedSourceIds.length > 0}
                  <small
                    >{eventSeedSourceIds.length}
                    {associationKind === 'needs_check'
                      ? 'selected for review in Needs check'
                      : 'selected as the main memory'}</small
                  >
                {/if}
              </div>
            </div>
            <label class="context-field"
              ><span>Date certainty</span><select bind:value={formDatePrecision}
                ><option value="exact">Exact dates</option><option value="approximate">Approximate</option><option
                  value="month">Known month</option
                ><option value="year">Known year</option><option value="unknown">Not known yet</option></select
              ></label
            >
            <div class="grid gap-4 sm:grid-cols-2">
              <label class="context-field"
                ><span>{eventDateLabels.start} <small>Optional</small></span><input
                  type="date"
                  bind:value={formDateStart}
                /></label
              ><label class="context-field"
                ><span>{eventDateLabels.end} <small>Optional</small></span><input
                  type="date"
                  bind:value={formDateEnd}
                /></label
              >
            </div>
            <label class="context-field">
              <span>Part of <small>Optional</small></span>
              <select bind:value={formParentId}>
                <option value="">No parent memory</option>
                {#each eventParentChoices as parent (parent.entityId)}
                  <option value={parent.entityId}
                    >{eventLineage(parent, entities)
                      .map(({ displayName }) => displayName)
                      .join(' › ')}</option
                  >
                {/each}
              </select>
            </label>
            <p class="-mt-3 text-xs text-gray-500 dark:text-gray-400">
              Use containment for chapters such as Cedar House › 2025 › June. Use Connections after saving for
              overlapping stories such as Space Trip and Research Week.
            </p>
            {#if formSourceFolders.length > 0}
              <section class="rounded-2xl border border-primary/20 bg-primary/5 p-4" aria-label="Source folders">
                <div class="flex items-start gap-3">
                  <Icon class="mt-0.5 shrink-0 text-primary" icon={mdiFolderMultipleOutline} size="20" />
                  <div class="min-w-0">
                    <strong class="block"
                      >{formSourceFolders.length}
                      {formSourceFolders.length === 1 ? 'source folder' : 'source folders'}</strong
                    >
                    <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {formSourceFolders.map((folderPath) => eventFolderLabel(folderPath)).join(' · ')} — remembered for later
                      refresh. New items arrive in Needs check.
                    </p>
                  </div>
                </div>
              </section>
            {/if}
            {#if formType === 'activity'}
              <section class="context-recurrence-card" aria-label="Activity recurrence">
                <label class="context-recurrence-toggle">
                  <input type="checkbox" bind:checked={formRecurrenceEnabled} />
                  <span>
                    <strong>Repeats</strong>
                    <small>Keep one Activity while its rhythm stays explicit.</small>
                  </span>
                </label>
                {#if formRecurrenceEnabled}
                  <div class="context-recurrence-rule">
                    <label class="context-field">
                      <span>Every</span>
                      <input bind:value={formRecurrenceInterval} min="1" max="99" step="1" type="number" />
                    </label>
                    <label class="context-field">
                      <span>Period</span>
                      <select bind:value={formRecurrenceFrequency}>
                        <option value="daily">Day</option>
                        <option value="weekly">Week</option>
                        <option value="monthly">Month</option>
                        <option value="yearly">Year</option>
                      </select>
                    </label>
                  </div>
                  {#if formRecurrenceFrequency === 'weekly'}
                    <fieldset class="context-weekday-picker">
                      <legend>On</legend>
                      <div>
                        {#each [{ value: 1, label: 'M' }, { value: 2, label: 'T' }, { value: 3, label: 'W' }, { value: 4, label: 'T' }, { value: 5, label: 'F' }, { value: 6, label: 'S' }, { value: 0, label: 'S' }] as weekday (weekday.value)}
                          <button
                            class:context-weekday--active={formRecurrenceWeekdays.includes(weekday.value)}
                            type="button"
                            aria-label={`${formRecurrenceWeekdays.includes(weekday.value) ? 'Remove' : 'Add'} ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][weekday.value]}`}
                            aria-pressed={formRecurrenceWeekdays.includes(weekday.value)}
                            onclick={() => toggleRecurrenceWeekday(weekday.value)}>{weekday.label}</button
                          >
                        {/each}
                      </div>
                      {#if formRecurrenceWeekdays.length === 0}
                        <p role="alert">Choose at least one day.</p>
                      {/if}
                    </fieldset>
                  {/if}
                {/if}
              </section>
            {/if}
          {/if}
          {#if entityKind === 'place'}
            {#if formType === 'unlocated'}
              <button class="context-add-map-button" type="button" onclick={() => setPlaceMapMode('point')}>
                <span><Icon icon={mdiMapMarkerOutline} size="20" /></span>
                <strong>Add to map</strong>
              </button>
            {:else}
              <section aria-label="Place geometry">
                <div class="mb-3 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p class="font-semibold">
                      {formType === 'point' ? 'Map pin' : formType === 'area' ? 'Map boundary' : 'Map route'}
                    </p>
                    <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {formType === 'point'
                        ? formMapPoints.length > 0
                          ? 'Drag the marker to put it exactly where you want it.'
                          : 'Click once on the map, or search above. You can drag the marker afterwards.'
                        : formType === 'area'
                          ? 'Drag around the boundary. Cimmich saves the exact outline you paint.'
                          : 'Click points in travel order. This reusable Place route can also be connected to Events.'}
                    </p>
                  </div>
                  <div class="context-map-mode-actions" aria-label="Map shape">
                    <button
                      class:context-map-action--active={formType === 'point'}
                      class="context-map-action"
                      type="button"
                      title="Use one map pin"
                      onclick={() => setPlaceMapMode('point')}>Pin</button
                    >
                    <button
                      class:context-map-action--active={formType === 'area'}
                      class="context-map-action"
                      type="button"
                      title="Draw a boundary"
                      onclick={() => setPlaceMapMode('area')}>Boundary</button
                    >
                    <button
                      class:context-map-action--active={formType === 'route'}
                      class="context-map-action"
                      type="button"
                      title="Draw an ordered route"
                      onclick={() => setPlaceMapMode('route')}>Route</button
                    >
                    {#if formType === 'point' || formMapPoints.length > 0}
                      {#if formType === 'point'}<button
                          class="context-map-action"
                          type="button"
                          onclick={openPhotoLocationPicker}
                          ><Icon icon={mdiImageMultipleOutline} size="16" /> Use photo GPS</button
                        >{/if}
                      {#if formType !== 'point'}<button
                          class="context-map-action"
                          type="button"
                          onclick={undoPlaceMapPoint}>Undo point</button
                        >{/if}
                      <button class="context-map-action" type="button" onclick={clearPlaceMapPoints}>Clear</button>
                    {/if}
                    <button
                      class="context-map-action"
                      type="button"
                      title="Keep this Place without map geometry"
                      onclick={() => setPlaceMapMode('unlocated')}>Remove from map</button
                    >
                  </div>
                </div>
                <div class="context-editor-map-shell">
                  <div class="context-place-search">
                    <label>
                      <span class="sr-only">Search an address, place or coordinates</span>
                      <Icon icon={mdiMagnify} size="19" />
                      <input
                        bind:value={placeSearchQuery}
                        autocomplete="street-address"
                        placeholder="Search an address or place"
                        oninput={queuePlaceSearch}
                        onkeydown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            if (placeSearchTimeout) {
                              globalThis.clearTimeout(placeSearchTimeout);
                              placeSearchTimeout = undefined;
                            }
                            void performPlaceSearch();
                          }
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      aria-label="Search addresses"
                      disabled={placeSearchLoading || !placeSearchQuery.trim()}
                      onclick={() => void performPlaceSearch()}>{placeSearchLoading ? 'Searching…' : 'Search'}</button
                    >
                    {#if placeSearchResults.length > 0}
                      <ul class="context-place-search-results" aria-label="Address results">
                        {#each placeSearchResults as place (place.resultId)}
                          <li>
                            <button type="button" onclick={() => selectPlaceSearchResult(place)}>
                              <strong>{place.label}</strong>
                              <small>{contextPlaceSearchQualityLabel(place)}</small>
                            </button>
                          </li>
                        {/each}
                      </ul>
                    {/if}
                    {#if placeSearchError}<p class="context-place-search-error" role="status">
                        {placeSearchError}
                      </p>{/if}
                    {#if placeSearchAttribution}<a
                        class="context-place-search-attribution"
                        href={placeSearchAttribution.url}
                        target="_blank"
                        rel="noreferrer">{placeSearchAttribution.label}</a
                      >{/if}
                  </div>
                  <div class="context-editor-map">
                    {#await import('$lib/components/shared-components/map/Map.svelte')}
                      <div class="grid size-full place-items-center text-sm text-gray-500">Loading map…</div>
                    {:then { default: Map }}
                      <Map
                        autoFitBounds={false}
                        brushable={formType === 'area' || formType === 'route'}
                        center={formType === 'point' ? placeSearchCenter : draftPlaceMapCenter}
                        clickable={formType === 'point'}
                        draggablePlaceMarker={draftPlaceMarkers[0]}
                        mapMarkers={[]}
                        onBrushPoint={addPlaceMapPoint}
                        onClickPoint={addPlaceMapPoint}
                        onPlaceMarkerDragEnd={addPlaceMapPoint}
                        placeAreas={draftPlaceAreas}
                        placeBrushPoints={draftPlaceBrushPoints}
                        placeMarkersDraggable={formType === 'point'}
                        rounded
                        showSatelliteControl
                        showSettings={false}
                        zoom={placeSearchZoom ??
                          (formType === 'point'
                            ? placeSearchCenter
                              ? 14
                              : undefined
                            : draftPlaceMapCenter
                              ? 14
                              : undefined)}
                      />
                    {/await}
                  </div>
                </div>
                {#if placeLocationPhotoName}<p class="mt-2 text-xs font-semibold text-primary">
                    Using GPS from {placeLocationPhotoName}
                  </p>{/if}
                <button
                  class="mt-3 text-xs font-semibold text-primary"
                  type="button"
                  aria-expanded={showPreciseGeometry}
                  onclick={() => (showPreciseGeometry = !showPreciseGeometry)}
                  >{showPreciseGeometry ? 'Hide precise coordinates' : 'Enter precise coordinates instead'}</button
                >
              </section>
            {/if}
            {#if formType !== 'unlocated'}
              <section
                class="grid gap-4 rounded-2xl bg-gray-50 p-4 sm:grid-cols-2 dark:bg-gray-800/60"
                aria-label="Location confidence"
              >
                <label class="context-field">
                  <span>Location source</span>
                  <select bind:value={formGeometryProvenance}>
                    <option value="manual">Placed manually</option>
                    <option value="photo_gps">From photo GPS</option>
                    <option value="contextual">Estimated from context</option>
                    <option value="confirmed">Confirmed by me</option>
                  </select>
                </label>
                <label class="context-field">
                  <span>Uncertainty <small>Metres, optional</small></span>
                  <input min="0" max="1000000" step="1" type="number" bind:value={formGeometryUncertainty} />
                </label>
                <p class="text-xs text-gray-500 sm:col-span-2 dark:text-gray-400">
                  This records how sure Cimmich is about the Place. It never rewrites the photo's original EXIF.
                </p>
              </section>
            {/if}
            <label class="context-field"
              ><span
                >{formPlaceRole === 'location'
                  ? 'Inside location'
                  : formPlaceRole === 'geography'
                    ? 'Inside geography'
                    : 'Inside'} <small>Optional</small></span
              ><select
                bind:value={formParentId}
                onchange={() => {
                  if (!formParentId) {
                    formDirectoryVisibility = 'listed';
                  }
                }}
                ><option value="">No parent {formPlaceRole === 'unclassified' ? 'place' : formPlaceRole}</option
                >{#each entities.filter((entity) => entity.entityId !== editorTarget?.entityId && (formPlaceRole === 'unclassified' || entity.placeRole === 'unclassified' || entity.placeRole === formPlaceRole)) as entity (entity.entityId)}<option
                    value={entity.entityId}>{entity.displayName}</option
                  >{/each}</select
              ></label
            >
            {#if formPlaceRole === 'location'}
              <label class="context-field">
                <span>Geography <small>Optional</small></span>
                <select bind:value={formGeographyEntityId}>
                  <option value="">
                    {formParentId &&
                    effectiveLocationGeographyId(entities.find((entity) => entity.entityId === formParentId))
                      ? 'Inherit from parent location'
                      : 'Not linked yet'}
                  </option>
                  {#each entities.filter((entity) => entity.placeRole === 'geography') as geography (geography.entityId)}
                    <option value={geography.entityId}>{geography.displayName}</option>
                  {/each}
                </select>
              </label>
            {/if}
            <label class="context-field"
              ><span>{formPlaceRole === 'geography' ? 'Geography page' : 'Locations page'}</span><select
                bind:value={formDirectoryVisibility}
                ><option value="listed"
                  >Show as its own {formPlaceRole === 'geography' ? 'Geography' : 'Location'}</option
                ><option value="nested_only" disabled={!formParentId}
                  >Show only inside its parent {formPlaceRole === 'unclassified' ? 'Place' : formPlaceRole}</option
                ></select
              ></label
            >
            <p class="-mt-2 text-xs text-gray-500 dark:text-gray-400">
              This controls directory placement only. It does not change who can see the Place or its photos.
            </p>
          {/if}
          {#if entityKind === 'place' && showPreciseGeometry && formType === 'point'}
            <div class="grid gap-4 sm:grid-cols-2">
              <label class="context-field"
                ><span>Latitude</span><input
                  inputmode="decimal"
                  bind:value={formLatitude}
                  placeholder="-33.8688"
                /></label
              ><label class="context-field"
                ><span>Longitude</span><input
                  inputmode="decimal"
                  bind:value={formLongitude}
                  placeholder="151.2093"
                /></label
              >
            </div>
          {:else if entityKind === 'place' && showPreciseGeometry && formType === 'area' && formAreaUsesPoints}
            <p class="rounded-2xl bg-gray-100 p-4 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              Painted boundary · {formMapPoints.length} points. Use the map to adjust it without reducing it to a rectangle.
            </p>
          {:else if entityKind === 'place' && showPreciseGeometry && formType === 'area'}
            <div class="grid grid-cols-2 gap-4">
              <label class="context-field"><span>North</span><input inputmode="decimal" bind:value={formNorth} /></label
              ><label class="context-field"><span>East</span><input inputmode="decimal" bind:value={formEast} /></label
              ><label class="context-field"
                ><span>South</span><input inputmode="decimal" bind:value={formSouth} /></label
              ><label class="context-field"><span>West</span><input inputmode="decimal" bind:value={formWest} /></label>
            </div>
          {:else if entityKind === 'place' && showPreciseGeometry && formType === 'route'}
            <label class="context-field"
              ><span>Route points <small>One “latitude, longitude” per line</small></span><textarea
                bind:value={formRoute}
                rows="5"
                placeholder="-33.8688, 151.2093&#10;-33.8568, 151.2153"
              ></textarea></label
            >
          {/if}
          <label class="context-field"
            ><span>About <small>Optional</small></span><textarea bind:value={formDescription} maxlength="4000" rows="3"
            ></textarea></label
          >
          <label class="context-field"
            ><span>Other names <small>Comma separated</small></span><input
              bind:value={formAliases}
              placeholder="Nickname, former name"
            /></label
          >
          {#if editorError}<p
              class="rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200"
              role="alert"
            >
              {editorError}
            </p>{/if}
          {#if editorMode === 'edit' && selected}
            <!-- Visibility, Archive and Delete are all "change this record", so
                 they belong in the one place an owner goes to change it. They
                 used to be a floating pill and a dots menu on the hero, which
                 meant three separate entry points and no way to tell what
                 "Archive" or "Delete" applied to. Said plainly here instead. -->
            <div class="context-editor-record">
              {#if selected.entity.visibility}
                <div class="context-editor-record-row">
                  <div>
                    <p class="context-editor-record-title">Who can see this {entityNoun}</p>
                    <p class="context-editor-record-note">
                      Controls the {entityNoun} profile only. It never changes who can see your photos.
                    </p>
                  </div>
                  <CimmichObjectVisibility
                    object={selected.entity.visibility}
                    objectLabel={contextTargetLabel(selected.entity.entityKind)}
                    onChange={updateSelectedVisibility}
                  />
                </div>
              {/if}

              <div class="context-editor-record-row">
                <div>
                  <p class="context-editor-record-title">
                    {selected.entity.status === 'archived'
                      ? `Restore this ${entityNoun}`
                      : `Archive this ${entityNoun}`}
                  </p>
                  <p class="context-editor-record-note">
                    {selected.entity.status === 'archived'
                      ? `Puts the ${entityNoun} back in the collection.`
                      : `Hides the ${entityNoun} from the collection and search. Your photos are untouched, and you can restore it later.`}
                  </p>
                </div>
                <button
                  class="context-secondary-button"
                  type="button"
                  disabled={isSaving}
                  onclick={() => void changeArchivedState()}
                >
                  {selected.entity.status === 'archived' ? 'Restore' : 'Archive'}
                </button>
              </div>

              {#if entityKind === 'place' || entityKind === 'object'}
                <div class="context-editor-record-row">
                  <div>
                    <p class="context-editor-record-title">Delete this {entityNoun}</p>
                    <p class="context-editor-record-note">
                      Removes the {entityNoun} record, its aliases and its connections from Cimmich for good.
                      <strong>Your photos and videos are not deleted.</strong>
                    </p>
                  </div>
                  <button
                    class="context-editor-danger"
                    type="button"
                    disabled={isSaving}
                    onclick={() => {
                      showEditor = false;
                      openContextDelete();
                    }}>Delete…</button
                  >
                </div>
              {/if}
            </div>
          {/if}

          <div
            class="sticky bottom-0 -mx-2 flex justify-end gap-3 bg-white/95 px-2 py-3 backdrop-blur-sm dark:bg-gray-900/95"
          >
            <button class="context-secondary-button" type="button" disabled={isSaving} onclick={closeEditor}
              >Cancel</button
            >{#if editorMode === 'create' && entityKind === 'event'}<button
                class="context-secondary-button"
                type="button"
                disabled={isSaving || !entityDraftCanSave}
                onclick={() => {
                  continueWithAnotherEvent = true;
                  editorForm?.requestSubmit();
                }}><Icon icon={mdiPlus} size="18" /> Save & add another</button
              >{/if}<button
              class="context-primary-button"
              type="submit"
              disabled={isSaving || !entityDraftCanSave}
              onclick={() => (continueWithAnotherEvent = false)}
              ><Icon icon={mdiCheck} size="19" />
              {isSaving
                ? 'Saving…'
                : editorMode === 'create'
                  ? entityKind === 'event'
                    ? 'Create memory'
                    : `Add ${entityNoun}`
                  : 'Save changes'}</button
            >
          </div>
        </form>
      {/if}
    </div>
  </div>
{/if}

{#if showPhotoLocationPicker}
  <div
    class="fixed inset-0 z-110 flex items-end justify-center bg-black/60 sm:items-center sm:p-6"
    role="presentation"
    onkeydown={(event) => {
      if (event.key === 'Escape') {
        closePhotoLocationPicker();
      }
    }}
  >
    <div
      class="flex max-h-[92vh] w-full flex-col rounded-t-4xl bg-white text-immich-fg shadow-2xl sm:max-w-4xl sm:rounded-4xl dark:bg-gray-900 dark:text-immich-dark-fg"
      role="dialog"
      aria-modal="true"
      aria-labelledby="photo-location-title"
      use:focusTrap
    >
      <div class="flex items-center gap-4 border-b border-gray-200 p-5 sm:p-6 dark:border-gray-800">
        <div class="min-w-0 flex-1">
          <h2 class="text-xl font-semibold" id="photo-location-title">Use a photo’s location</h2>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Choose a recent GPS-tagged photo. You can still drag the pin before saving.
          </p>
        </div>
        <button class="context-icon-button" type="button" aria-label="Close" onclick={closePhotoLocationPicker}
          ><Icon icon={mdiClose} size="22" /></button
        >
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {#if photoLocationLoading}
          <p class="py-16 text-center text-sm text-gray-500" role="status">Finding photos with GPS…</p>
        {:else if photoLocationError}
          <div class="py-16 text-center">
            <Icon class="mx-auto text-gray-400" icon={mdiMapMarkerOutline} size="30" />
            <p class="mt-3 text-sm text-gray-500 dark:text-gray-400">{photoLocationError}</p>
          </div>
        {:else}
          <div class="mb-4 h-52 overflow-hidden rounded-3xl sm:h-64">
            {#await import('$lib/components/shared-components/map/Map.svelte')}
              <div class="grid size-full place-items-center bg-gray-100 text-sm text-gray-500 dark:bg-gray-800">
                Loading map…
              </div>
            {:then { default: Map }}
              <Map mapMarkers={photoLocationMapMarkers} rounded showSettings={false} />
            {/await}
          </div>
          <p class="mb-2 text-xs text-gray-500 dark:text-gray-400">
            Photo pins show where each image was taken. Select from the grid.
          </p>
          <div class="grid grid-cols-3 gap-1 sm:grid-cols-5 lg:grid-cols-7">
            {#each photoLocationAssets as asset (asset.sourceAssetId)}
              <button
                class="group relative aspect-square overflow-hidden rounded-xl bg-gray-100 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:bg-gray-800"
                type="button"
                aria-label={`Use GPS from ${asset.filename}`}
                onclick={() => usePhotoLocation(asset)}
                ><img
                  class="size-full object-cover transition group-hover:scale-105"
                  src={getAssetMediaUrl({ id: asset.sourceAssetId, size: AssetMediaSize.Thumbnail })}
                  alt=""
                  loading="lazy"
                /><span
                  class="absolute inset-x-1 bottom-1 truncate rounded-full bg-black/65 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur-sm"
                  >{asset.filename}</span
                ></button
              >
            {/each}
          </div>
        {/if}
      </div>
      <div class="flex justify-end border-t border-gray-200 p-4 sm:px-6 dark:border-gray-800">
        <button class="context-secondary-button" type="button" onclick={closePhotoLocationPicker}>Cancel</button>
      </div>
    </div>
  </div>
{/if}

{#if showAssetPicker}
  <div
    class="fixed inset-0 z-100 flex items-end justify-center bg-black/55 sm:items-center sm:p-6"
    role="presentation"
    onkeydown={(event) => {
      if (event.key === 'Escape' && !isSaving) {
        showAssetPicker = false;
      }
    }}
  >
    <div
      class="flex max-h-[94vh] w-full flex-col rounded-t-4xl bg-white text-immich-fg shadow-2xl sm:max-w-5xl sm:rounded-4xl dark:bg-gray-900 dark:text-immich-dark-fg"
      role="dialog"
      aria-modal="true"
      aria-labelledby="context-asset-title"
      use:focusTrap
    >
      <div class="flex flex-wrap items-center gap-4 border-b border-gray-200 p-5 sm:p-6 dark:border-gray-800">
        <div class="min-w-0 flex-1">
          <h2 class="text-xl font-semibold" id="context-asset-title">
            {assetPickerPurpose === 'seed-event' ? 'Choose photos for this memory' : 'Add media'}
          </h2>
          <p class="mt-1 text-sm text-gray-500">
            {selectedSourceIds.length}/{activeFamily === 'events' ? '1,000' : '100'} selected{assetPickerPurpose ===
            'seed-event'
              ? associationKind === 'needs_check'
                ? ' · Folder candidates wait for your decision before joining Main.'
                : ' · You are choosing these as the defining memory.'
              : ''}
          </p>
        </div>
        {#if assetPickerPurpose === 'attach'}
          <label class="context-field min-w-40"
            ><span>How it relates</span><select bind:value={associationKind}
              >{#each contextAssociationKinds[entityKind] as kind (kind)}<option value={kind}
                  >{contextAssociationLabel(entityKind, kind)}</option
                >{/each}</select
            ></label
          >
        {:else}
          <label class="context-field min-w-44">
            <span>Start selected media as</span>
            <select bind:value={associationKind}>
              <option value="needs_check">Needs check</option>
              <option value="direct">Main</option>
            </select>
          </label>
        {/if}
        <button
          class="context-icon-button"
          type="button"
          aria-label="Close"
          disabled={isSaving}
          onclick={() => (showAssetPicker = false)}><Icon icon={mdiClose} size="22" /></button
        >
      </div>
      <div class="space-y-3 p-4 sm:px-6">
        {#if nearbyPlacePoint || activeFamily === 'events'}
          <div class="flex gap-1 rounded-full bg-gray-100 p-1 dark:bg-gray-800" aria-label="Choose media source">
            {#if nearbyPlacePoint}<button
                class="min-h-10 flex-1 rounded-full px-4 text-sm font-semibold transition"
                class:bg-white={assetPickerMode === 'nearby'}
                class:text-primary={assetPickerMode === 'nearby'}
                class:shadow-sm={assetPickerMode === 'nearby'}
                class:dark:bg-gray-700={assetPickerMode === 'nearby'}
                type="button"
                aria-pressed={assetPickerMode === 'nearby'}
                onclick={() => selectAssetPickerMode('nearby')}
                ><Icon icon={mdiMapMarkerOutline} size="18" /> Nearby</button
              >{/if}
            {#if activeFamily === 'events'}<button
                class="min-h-10 flex-1 rounded-full px-4 text-sm font-semibold transition"
                class:bg-white={assetPickerMode === 'folders'}
                class:text-primary={assetPickerMode === 'folders'}
                class:shadow-sm={assetPickerMode === 'folders'}
                class:dark:bg-gray-700={assetPickerMode === 'folders'}
                type="button"
                aria-pressed={assetPickerMode === 'folders'}
                onclick={() => selectAssetPickerMode('folders')}
                ><Icon icon={mdiFolderMultipleOutline} size="18" /> Folders</button
              >{/if}<button
              class="min-h-10 flex-1 rounded-full px-4 text-sm font-semibold transition"
              class:bg-white={assetPickerMode === 'library'}
              class:text-primary={assetPickerMode === 'library'}
              class:shadow-sm={assetPickerMode === 'library'}
              class:dark:bg-gray-700={assetPickerMode === 'library'}
              type="button"
              aria-pressed={assetPickerMode === 'library'}
              onclick={() => selectAssetPickerMode('library')}
              ><Icon icon={mdiImageMultipleOutline} size="18" /> Library</button
            >
          </div>
        {/if}
        {#if assetPickerMode === 'nearby' && nearbyPlacePoint}
          <div class="flex items-center justify-between gap-4">
            <p class="text-sm text-gray-500 dark:text-gray-400">Closest GPS-tagged media</p>
            <div class="flex gap-1" aria-label="Nearby distance">
              {#each contextPlaceNearbyRadii as radius (radius.value)}
                <button
                  class="min-h-9 rounded-full px-3 text-sm font-semibold ring-1 ring-gray-300 transition dark:ring-gray-700"
                  class:bg-primary={nearbyRadius === radius.value}
                  class:text-white={nearbyRadius === radius.value}
                  type="button"
                  aria-pressed={nearbyRadius === radius.value}
                  onclick={() => selectNearbyRadius(radius.value)}>{radius.label}</button
                >
              {/each}
            </div>
          </div>
        {:else if assetPickerMode === 'folders'}
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p class="text-sm font-semibold">Browse folders</p>
              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                Recent visible folders are ready below. Search only when you need something else.
              </p>
            </div>
          </div>
          <form
            class="mt-3 flex gap-2"
            onsubmit={(event) => {
              event.preventDefault();
              void searchEventFolders();
            }}
          >
            <label class="relative min-w-0 flex-1"
              ><span class="sr-only">Search folders</span><Icon
                class="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-gray-500"
                icon={mdiMagnify}
                size="19"
              /><input
                class="min-h-11 w-full rounded-full border border-gray-300 pr-4 pl-11 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-gray-700 dark:bg-gray-800"
                bind:value={folderQuery}
                placeholder="Folder name or path — e.g. Space Trip"
              /></label
            ><button class="context-secondary-button shrink-0" type="submit" disabled={folderSearchLoading}
              >{folderSearchLoading ? 'Searching…' : 'Find folders'}</button
            >
          </form>
          {#if selectedFolderPaths.length > 0}
            <div class="flex flex-wrap gap-2" aria-label="Selected folders">
              {#each selectedFolderPaths as folderPath (folderPath)}
                <button
                  class="rounded-full bg-primary/10 px-3 py-2 text-xs font-semibold text-primary"
                  type="button"
                  title={folderPath}
                  aria-label={`Remove folder ${eventFolderLabel(folderPath)}`}
                  onclick={() => void addEventFolder(folderPath)}
                  ><Icon icon={mdiFolderMultipleOutline} size="15" />
                  {eventFolderLabel(folderPath)} ·
                  {(folderAssetIds[folderPath] ?? []).length}
                  <Icon icon={mdiClose} size="14" /></button
                >
              {/each}
            </div>
          {/if}
        {:else}
          <label class="relative block"
            ><span class="sr-only">Filter recent media by filename</span><Icon
              class="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-gray-500"
              icon={mdiMagnify}
              size="19"
            /><input
              class="min-h-11 w-full rounded-full border border-gray-300 pl-11 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-gray-700 dark:bg-gray-800"
              bind:value={libraryQuery}
              placeholder="Filter visible recent items by filename"
            /></label
          >
        {/if}
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-6">
        {#if assetPickerMode === 'nearby' && nearbyPlacePoint}
          {#if nearbyLoading}
            <p class="py-16 text-center text-sm text-gray-500" role="status">Finding nearby media…</p>
          {:else if nearbyError}
            <div class="py-14 text-center">
              <p class="text-sm text-gray-500 dark:text-gray-400">{nearbyError}</p>
              <button
                class="context-secondary-button mt-4"
                type="button"
                onclick={() => selectAssetPickerMode('library')}>Open library</button
              >
            </div>
          {:else if nearbyAssets.length === 0}
            <div class="py-14 text-center">
              <Icon class="mx-auto text-gray-400" icon={mdiMapMarkerOutline} size="30" />
              <p class="mt-3 font-semibold">Nothing nearby yet</p>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Try a wider distance or choose from your library.
              </p>
            </div>
          {:else}
            <div class="mb-4 h-52 overflow-hidden rounded-3xl sm:h-60">
              {#key `${nearbyRadius}:${nearbyAssets.length}`}
                {#await import('$lib/components/shared-components/map/Map.svelte')}
                  <div class="grid size-full place-items-center bg-gray-100 text-sm text-gray-500 dark:bg-gray-800">
                    Loading map…
                  </div>
                {:then { default: Map }}
                  <Map mapMarkers={nearbyMapMarkers} placeMarkers={nearbyPlaceMarkers} rounded showSettings={false} />
                {/await}
              {/key}
            </div>
            <p class="mb-2 text-xs text-gray-500 dark:text-gray-400">
              Photo pins show where each image was taken. Choose from the grid.
            </p>
            <div class="grid grid-cols-3 gap-1 sm:grid-cols-5 lg:grid-cols-8">
              {#each nearbyAssets as asset (asset.sourceAssetId)}
                <button
                  class="relative aspect-square overflow-hidden rounded-xl bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:bg-gray-800"
                  type="button"
                  aria-label={`${selectedSourceIds.includes(asset.sourceAssetId) ? 'Remove' : 'Select'} media ${formatContextPlaceDistance(asset.distanceMeters)} away`}
                  aria-pressed={selectedSourceIds.includes(asset.sourceAssetId)}
                  onclick={() => toggleAsset(asset.sourceAssetId)}
                  ><img
                    class="size-full object-cover"
                    src={getAssetMediaUrl({ id: asset.sourceAssetId, size: AssetMediaSize.Thumbnail })}
                    alt=""
                    loading="lazy"
                  /><span
                    class="absolute bottom-1 left-1 rounded-full bg-black/65 px-2 py-1 text-[11px] font-semibold text-white backdrop-blur-sm"
                    >{formatContextPlaceDistance(asset.distanceMeters)}</span
                  >{#if selectedSourceIds.includes(asset.sourceAssetId)}<span
                      class="absolute inset-0 flex items-center justify-center bg-primary/45 text-white"
                      ><span class="flex size-8 items-center justify-center rounded-full bg-primary"
                        ><Icon icon={mdiCheck} size="19" /></span
                      ></span
                    >{/if}</button
                >
              {/each}
            </div>
          {/if}
        {:else if assetPickerMode === 'folders'}
          {#if folderSearchLoading || (!folderSearchStarted && libraryLoading)}
            <p class="py-16 text-center text-sm text-gray-500" role="status">Searching visible folder paths…</p>
          {:else if folderCandidates.length === 0}
            <div class="py-16 text-center">
              <Icon class="mx-auto text-gray-400" icon={mdiFolderMultipleOutline} size="34" />
              <p class="mt-3 font-semibold">
                {folderSearchStarted ? 'No visible folders matched' : 'Search or browse the folders you already have'}
              </p>
              <p class="mx-auto mt-1 max-w-lg text-sm text-gray-500 dark:text-gray-400">
                {folderSearchStarted
                  ? 'Try another part of the folder name or path. Nothing has changed.'
                  : 'External-library folders appear here automatically. Immich-managed storage paths stay hidden. You can choose several, and subfolders are included.'}
              </p>
            </div>
          {:else}
            <div class="mb-3 flex items-center justify-between gap-3">
              <p class="text-xs font-semibold tracking-[0.12em] text-gray-500 uppercase dark:text-gray-400">
                {folderSearchStarted ? 'Search results' : 'Recent folders'}
              </p>
              {#if folderSearchStarted}<button
                  class="rounded-full px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10"
                  type="button"
                  onclick={() => {
                    folderQuery = '';
                    folderSearchAssets = [];
                    folderSearchStarted = false;
                    folderError = '';
                  }}>Show recent</button
                >{/if}
            </div>
            <div class="grid gap-2 sm:grid-cols-2">
              {#each folderCandidates as folder (folder.path)}
                <button
                  class="flex min-h-20 items-center gap-3 rounded-2xl border border-gray-200 p-4 text-left transition hover:border-primary dark:border-gray-700"
                  class:border-primary={selectedFolderPaths.includes(folder.path)}
                  type="button"
                  title={folder.path}
                  aria-pressed={selectedFolderPaths.includes(folder.path)}
                  onclick={() => void addEventFolder(folder.path)}
                >
                  <span class="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"
                    ><Icon icon={mdiFolderMultipleOutline} size="22" /></span
                  ><span class="min-w-0 flex-1"
                    ><strong class="block truncate">{folder.label}</strong><small
                      class="mt-1 block truncate text-gray-500">{folder.path}</small
                    ></span
                  ><span class="shrink-0 text-xs font-semibold text-gray-500"
                    >{folder.assetCount}{folderSearchStarted ? '+' : ' recent'}</span
                  >
                </button>
              {/each}
            </div>
          {/if}
        {:else if libraryLoading}<p class="py-16 text-center text-sm text-gray-500" role="status">
            Loading your library…
          </p>{:else}<div class="grid grid-cols-3 gap-1 sm:grid-cols-5 lg:grid-cols-8">
            {#each filteredLibraryAssets as asset (asset.id)}<button
                class="relative aspect-square overflow-hidden rounded-xl bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-40 dark:bg-gray-800"
                type="button"
                disabled={selectedAssetIds.has(asset.id)}
                aria-label={`${selectedSourceIds.includes(asset.id) ? 'Remove' : 'Select'} ${asset.originalFileName}`}
                aria-pressed={selectedSourceIds.includes(asset.id)}
                onclick={() => toggleAsset(asset.id)}
                ><img
                  class="size-full object-cover"
                  src={getAssetMediaUrl({ id: asset.id, size: AssetMediaSize.Thumbnail })}
                  alt=""
                  loading="lazy"
                />{#if selectedSourceIds.includes(asset.id)}<span
                    class="absolute inset-0 flex items-center justify-center bg-primary/45 text-white"
                    ><span class="flex size-8 items-center justify-center rounded-full bg-primary"
                      ><Icon icon={mdiCheck} size="19" /></span
                    ></span
                  >{/if}</button
              >{/each}
          </div>{/if}
      </div>
      {#if assetError}<p
          class="mx-5 mb-2 rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200"
          role="alert"
        >
          {assetError}
        </p>{/if}
      {#if folderError}<p
          class="mx-5 mb-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/35 dark:text-amber-100"
          role="status"
        >
          {folderError}
        </p>{/if}
      <div class="flex justify-end gap-3 border-t border-gray-200 p-4 sm:px-6 dark:border-gray-800">
        <button
          class="context-secondary-button"
          type="button"
          disabled={isSaving}
          onclick={() => (showAssetPicker = false)}>Cancel</button
        ><button
          class="context-primary-button"
          type="button"
          disabled={isSaving || selectedSourceIds.length === 0}
          onclick={() => (assetPickerPurpose === 'seed-event' ? continueEventSeed() : void attachAssets())}
          ><Icon icon={assetPickerPurpose === 'seed-event' ? mdiArrowRight : mdiLinkPlus} size="19" />
          {isSaving
            ? 'Adding…'
            : assetPickerPurpose === 'seed-event'
              ? `Continue with ${selectedSourceIds.length} ${selectedSourceIds.length === 1 ? 'photo' : 'photos'}`
              : `Add ${selectedSourceIds.length || ''} media`}</button
        >
      </div>
    </div>
  </div>
{/if}

{#if showRelationPicker}
  <div
    class="fixed inset-0 z-100 flex items-end justify-center bg-black/55 sm:items-center sm:p-6"
    role="presentation"
    onkeydown={(event) => {
      if (event.key === 'Escape' && !isSaving) {
        showRelationPicker = false;
      }
    }}
  >
    <div
      class="w-full rounded-t-4xl bg-white p-6 text-immich-fg shadow-2xl sm:max-w-xl sm:rounded-4xl sm:p-8 dark:bg-gray-900 dark:text-immich-dark-fg"
      role="dialog"
      aria-modal="true"
      aria-labelledby="context-relation-title"
      use:focusTrap
    >
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-xs font-bold tracking-[0.16em] text-primary uppercase">
            {relationPickerPurpose === 'trip-stop' ? 'Journey' : 'Connected context'}
          </p>
          <h2 class="mt-1 text-2xl font-semibold" id="context-relation-title">
            {relationPickerPurpose === 'trip-stop' ? 'Add a stop' : 'Add connection'}
          </h2>
        </div>
        <button
          class="context-icon-button"
          type="button"
          aria-label="Close"
          disabled={isSaving}
          onclick={() => (showRelationPicker = false)}><Icon icon={mdiClose} size="22" /></button
        >
      </div>
      <div class="mt-7 grid gap-5">
        {#if relationPickerPurpose === 'connection'}<label class="context-field"
            ><span>Relationship</span><select
              bind:value={relationKind}
              onchange={() => {
                relationTargetKind = defaultContextRelationDraft(entityKind, [relationKind]).relationTargetKind;
                void loadRelationTargets();
              }}
              >{#each relationKinds as kind (kind)}<option value={kind}>{humanizeContextKind(kind)}</option
                >{/each}</select
            ></label
          >{/if}
        {#if relationKind === 'related'}
          <label class="context-field"
            ><span>Connect to</span><select bind:value={relationTargetKind} onchange={() => void loadRelationTargets()}
              ><option value="person">Person</option><option value="pet">Pet</option><option value="place">Place</option
              ><option value="object">Thing</option><option value="event">Event</option></select
            ></label
          >
        {/if}
        <div class="context-field">
          <span>{contextTargetLabel(targetKindForRelation(relationKind))}</span>
          <div class="context-relation-target-picker">
            <label>
              <Icon icon={mdiMagnify} size="19" />
              <input
                bind:value={relationTargetQuery}
                role="combobox"
                aria-controls="context-relation-target-results"
                aria-expanded={!relationTargetId && filteredRelationTargets.length > 0}
                aria-label={`Search ${contextTargetLabel(targetKindForRelation(relationKind)).toLocaleLowerCase()}`}
                autocomplete="off"
                disabled={relationTargetsLoading || relationTargets.length === 0}
                placeholder={relationTargetsLoading
                  ? 'Loading…'
                  : relationTargets.length === 0
                    ? 'No available records'
                    : `Search ${contextTargetLabel(targetKindForRelation(relationKind)).toLocaleLowerCase()}`}
                oninput={() => (relationTargetId = '')}
              />
            </label>
            {#if selectedRelationTarget && relationTargetId}
              <div class="context-relation-target-selected">
                <span>{selectedRelationTarget.name}</span>
                <button
                  type="button"
                  aria-label={`Clear ${selectedRelationTarget.name}`}
                  onclick={() => {
                    relationTargetId = '';
                    relationTargetQuery = '';
                  }}><Icon icon={mdiClose} size="17" /></button
                >
              </div>
            {:else if relationTargetQuery.trim() && !relationTargetsLoading}
              <div id="context-relation-target-results" class="context-relation-target-results" role="listbox">
                {#each filteredRelationTargets as target (target.id)}
                  <button
                    type="button"
                    role="option"
                    aria-selected="false"
                    onclick={() => {
                      relationTargetId = target.id;
                      relationTargetQuery = '';
                    }}>{target.name}</button
                  >
                {:else}
                  <p>No matching records</p>
                {/each}
              </div>
            {:else if relationTargets.length > 0 && !relationTargetsLoading}
              <p class="context-relation-target-hint">Start typing a name.</p>
            {/if}
          </div>
        </div>
        {#if relationError}<p
            class="rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200"
            role="alert"
          >
            {relationError}
          </p>{/if}
        <div class="flex justify-end gap-3">
          <button
            class="context-secondary-button"
            type="button"
            disabled={isSaving}
            onclick={() => (showRelationPicker = false)}>Cancel</button
          ><button
            class="context-primary-button"
            type="button"
            disabled={isSaving || !relationTargetId}
            onclick={() => void addRelation()}
            ><Icon icon={relationPickerPurpose === 'trip-stop' ? mdiMapMarkerOutline : mdiLinkPlus} size="19" />
            {isSaving ? 'Adding…' : relationPickerPurpose === 'trip-stop' ? 'Add stop' : 'Add connection'}</button
          >
        </div>
      </div>
    </div>
  </div>
{/if}

{#if showDeleteContext && (selected?.entity.entityKind === 'place' || selected?.entity.entityKind === 'object')}
  <CimmichPlaceDeleteDialog
    displayName={selected.entity.displayName}
    entityLabel={selected.entity.entityKind === 'place' ? 'Place' : 'Thing'}
    error={deleteContextError}
    isDeleting={isSaving}
    tagCount={selected.entity.assetCount}
    oncancel={() => {
      if (!isSaving) {
        showDeleteContext = false;
        deleteContextError = '';
        deleteContextCommandId = '';
      }
    }}
    onconfirm={(deleteTags) => void confirmContextDelete(deleteTags)}
  />
{/if}

<style>
  :global(.context-primary-button),
  :global(.context-secondary-button),
  :global(.context-danger-button),
  :global(.context-icon-button) {
    display: inline-flex;
    min-height: 44px;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    border-radius: 9999px;
    font-size: 0.875rem;
    font-weight: 600;
    transition: 150ms;
  }
  :global(.context-primary-button) {
    background: rgb(var(--immich-primary));
    color: white;
    padding: 0 1.1rem;
  }
  :global(.context-primary-button:hover) {
    filter: brightness(0.94);
  }
  :global(.context-primary-button:disabled),
  :global(.context-secondary-button:disabled),
  :global(.context-danger-button:disabled) {
    cursor: not-allowed;
    opacity: 0.5;
  }
  :global(.context-secondary-button) {
    border: 1px solid rgb(209 213 219);
    padding: 0 1.1rem;
  }
  :global(.dark .context-secondary-button) {
    border-color: rgb(75 85 99);
  }
  :global(.context-danger-button) {
    border: 1px solid rgb(252 165 165);
    padding: 0 1.1rem;
    color: rgb(185 28 28);
  }
  :global(.context-danger-button:hover) {
    background: rgb(254 242 242);
  }
  :global(.dark .context-danger-button) {
    border-color: rgb(127 29 29);
    color: rgb(252 165 165);
  }
  :global(.dark .context-danger-button:hover) {
    background: rgb(69 10 10 / 0.35);
  }
  :global(.context-icon-button) {
    width: 44px;
    flex: none;
  }

  /* Two overlay controls only: back, and settings. */
  .context-hero-back,
  .context-hero-settings {
    position: absolute;
    z-index: 12;
    top: 16px;
  }

  .context-hero-back {
    left: 16px;
  }

  .context-hero-settings {
    right: 16px;
  }

  .context-hero-control {
    display: inline-flex;
    width: 42px;
    min-height: 42px;
    flex: none;
    align-items: center;
    justify-content: center;
    gap: 7px;
    border: 1px solid rgb(255 255 255 / 0.2);
    border-radius: 999px;
    background: rgb(15 23 42 / 0.72);
    color: white;
    font-size: 0.82rem;
    font-weight: 700;
    box-shadow: 0 6px 18px rgb(0 0 0 / 0.16);
    backdrop-filter: blur(12px);
  }

  .context-hero-control:hover,
  .context-hero-control:focus-visible {
    background: rgb(15 23 42 / 0.9);
    outline: 2px solid white;
    outline-offset: 2px;
  }
  :global(.context-primary-button:focus-visible),
  :global(.context-secondary-button:focus-visible),
  :global(.context-danger-button:focus-visible),
  :global(.context-icon-button:focus-visible) {
    outline: 2px solid rgb(var(--immich-primary));
    outline-offset: 2px;
  }
  :global(.context-field) {
    display: grid;
    gap: 0.45rem;
    font-size: 0.875rem;
    font-weight: 600;
  }
  :global(.context-field small) {
    margin-left: 0.35rem;
    font-size: 0.75rem;
    font-weight: 400;
    color: rgb(107 114 128);
  }
  :global(.context-field input),
  :global(.context-field select),
  :global(.context-field textarea) {
    min-height: 44px;
    width: 100%;
    border-radius: 0.85rem;
    border: 1px solid rgb(209 213 219);
    background: transparent;
    padding: 0.65rem 0.8rem;
    font-size: 0.875rem;
    font-weight: 400;
    outline: none;
  }
  :global(.dark .context-field input),
  :global(.dark .context-field select),
  :global(.dark .context-field textarea) {
    border-color: rgb(75 85 99);
    background: rgb(31 41 55);
  }
  :global(.context-field input:focus),
  :global(.context-field select:focus),
  :global(.context-field textarea:focus) {
    border-color: rgb(var(--immich-primary));
    box-shadow: 0 0 0 2px rgb(var(--immich-primary) / 0.18);
  }

  .context-type-choice-grid {
    display: grid;
    gap: 12px;
    margin-top: 16px;
  }

  .context-event-seed-summary,
  .context-event-form-guidance {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    border: 1px solid rgb(var(--immich-primary) / 0.22);
    border-radius: 18px;
    background: rgb(var(--immich-primary) / 0.06);
    padding: 14px 16px;
    color: rgb(var(--immich-primary));
  }

  .context-event-seed-summary {
    align-items: center;
    margin-top: 14px;
    font-size: 0.82rem;
    font-weight: 700;
  }

  .context-event-form-guidance > span {
    display: grid;
    width: 38px;
    height: 38px;
    flex: none;
    place-items: center;
    border-radius: 13px;
    background: rgb(var(--immich-primary) / 0.12);
  }

  .context-event-form-guidance strong,
  .context-event-form-guidance p,
  .context-event-form-guidance small {
    display: block;
  }

  .context-event-form-guidance p {
    margin-top: 3px;
    color: rgb(75 85 99);
    font-size: 0.78rem;
    line-height: 1.45;
  }

  .context-event-form-guidance small {
    margin-top: 7px;
    font-size: 0.72rem;
    font-weight: 800;
  }

  :global(.dark) .context-event-form-guidance p {
    color: rgb(209 213 219);
  }

  .context-recurrence-card {
    border: 1px solid rgb(229 231 235);
    border-radius: 20px;
    background: rgb(249 250 251);
    padding: 16px;
  }

  :global(.dark) .context-recurrence-card {
    border-color: rgb(55 65 81);
    background: rgb(31 41 55 / 0.55);
  }

  .context-recurrence-toggle {
    display: flex;
    min-height: 44px;
    cursor: pointer;
    align-items: center;
    gap: 12px;
  }

  .context-recurrence-toggle input {
    width: 20px;
    height: 20px;
    accent-color: rgb(var(--immich-primary));
  }

  .context-recurrence-toggle strong,
  .context-recurrence-toggle small {
    display: block;
  }

  .context-recurrence-toggle small {
    margin-top: 2px;
    color: rgb(107 114 128);
    font-size: 0.75rem;
  }

  .context-recurrence-rule {
    display: grid;
    grid-template-columns: minmax(90px, 0.45fr) minmax(150px, 1fr);
    gap: 12px;
    margin-top: 14px;
  }

  .context-weekday-picker {
    margin-top: 14px;
  }

  .context-weekday-picker legend {
    margin-bottom: 7px;
    color: rgb(75 85 99);
    font-size: 0.72rem;
    font-weight: 700;
  }

  .context-weekday-picker > div {
    display: grid;
    grid-template-columns: repeat(7, minmax(38px, 1fr));
    gap: 6px;
  }

  .context-weekday-picker button {
    min-height: 40px;
    border: 1px solid rgb(209 213 219);
    border-radius: 999px;
    color: rgb(75 85 99);
    font-size: 0.75rem;
    font-weight: 800;
  }

  .context-weekday-picker button:hover,
  .context-weekday-picker button:focus-visible,
  .context-weekday-picker .context-weekday--active {
    border-color: rgb(var(--immich-primary) / 0.55);
    background: rgb(var(--immich-primary) / 0.11);
    color: rgb(var(--immich-primary));
    outline: none;
  }

  .context-weekday-picker p {
    margin-top: 8px;
    color: rgb(185 28 28);
    font-size: 0.75rem;
  }

  :global(.dark) .context-weekday-picker button {
    border-color: rgb(75 85 99);
    color: rgb(209 213 219);
  }

  .context-type-choice {
    display: grid;
    min-height: 116px;
    align-content: center;
    justify-items: start;
    border: 1px solid rgb(209 213 219);
    border-radius: 20px;
    padding: 16px;
    text-align: left;
    transition: 140ms ease;
  }

  :global(.dark) .context-type-choice {
    border-color: rgb(55 65 81);
  }

  .context-type-choice:hover,
  .context-type-choice:focus-visible {
    border-color: rgb(var(--immich-primary) / 0.65);
    background: rgb(var(--immich-primary) / 0.07);
    box-shadow: 0 10px 24px rgb(15 23 42 / 0.1);
    outline: none;
  }

  .context-type-choice > span,
  .context-chosen-type > span:first-child {
    display: grid;
    width: 38px;
    height: 38px;
    place-items: center;
    border-radius: 13px;
    background: rgb(var(--immich-primary) / 0.1);
    color: rgb(var(--immich-primary));
  }

  .context-type-choice strong {
    margin-top: 10px;
    font-size: 0.95rem;
  }

  .context-type-choice small,
  .context-chosen-type small {
    display: block;
    margin-top: 3px;
    color: rgb(107 114 128);
    font-size: 0.75rem;
    font-weight: 450;
    line-height: 1.35;
  }

  .context-chosen-type {
    display: flex;
    align-items: center;
    gap: 12px;
    border: 1px solid rgb(var(--immich-primary) / 0.28);
    border-radius: 18px;
    background: rgb(var(--immich-primary) / 0.06);
    padding: 12px;
  }

  .context-chosen-type button {
    min-height: 36px;
    border-radius: 999px;
    padding: 0 12px;
    color: rgb(var(--immich-primary));
    font-size: 0.75rem;
    font-weight: 700;
  }

  .context-chosen-type button:hover,
  .context-chosen-type button:focus-visible {
    background: rgb(var(--immich-primary) / 0.1);
    outline: none;
  }

  .context-editor-map {
    height: 330px;
    overflow: hidden;
    border: 1px solid rgb(209 213 219);
    border-radius: 20px;
    background: rgb(243 244 246);
  }

  .context-editor-map-shell {
    position: relative;
  }

  .context-place-search {
    position: absolute;
    z-index: 12;
    top: 12px;
    right: 48px;
    left: 48px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    filter: drop-shadow(0 8px 18px rgb(15 23 42 / 0.2));
  }

  .context-place-search > label {
    display: flex;
    min-width: 0;
    height: 42px;
    align-items: center;
    gap: 9px;
    border-radius: 13px 0 0 13px;
    background: rgb(255 255 255 / 0.96);
    padding: 0 12px;
    color: rgb(107 114 128);
    backdrop-filter: blur(12px);
  }

  .context-place-search input {
    min-width: 0;
    flex: 1;
    border: 0;
    background: transparent;
    color: rgb(17 24 39);
    font-size: 0.82rem;
    outline: none;
  }

  .context-place-search > button {
    min-width: 76px;
    border-left: 1px solid rgb(229 231 235);
    border-radius: 0 13px 13px 0;
    background: rgb(255 255 255 / 0.96);
    padding: 0 12px;
    color: rgb(var(--immich-primary));
    font-size: 0.75rem;
    font-weight: 750;
    backdrop-filter: blur(12px);
  }

  .context-place-search > button:disabled {
    color: rgb(156 163 175);
  }

  .context-place-search-results,
  .context-place-search-error {
    grid-column: 1 / -1;
    overflow: hidden;
    border-top: 1px solid rgb(229 231 235);
    border-radius: 0 0 13px 13px;
    background: rgb(255 255 255 / 0.98);
  }

  .context-place-search-results {
    max-height: 210px;
    overflow-y: auto;
  }

  .context-place-search-results button {
    display: grid;
    width: 100%;
    min-height: 50px;
    align-content: center;
    border-bottom: 1px solid rgb(229 231 235);
    padding: 7px 12px;
    color: rgb(17 24 39);
    text-align: left;
  }

  .context-place-search-results button:hover,
  .context-place-search-results button:focus-visible {
    background: rgb(var(--immich-primary) / 0.08);
    outline: none;
  }

  .context-place-search-results strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.78rem;
  }

  .context-place-search-results small {
    margin-top: 2px;
    color: rgb(107 114 128);
    font-size: 0.66rem;
    font-weight: 650;
  }

  .context-place-search-error {
    padding: 9px 12px;
    color: rgb(75 85 99);
    font-size: 0.72rem;
    line-height: 1.4;
  }

  .context-place-search-attribution {
    grid-column: 1 / -1;
    justify-self: end;
    border-radius: 0 0 10px 10px;
    background: rgb(255 255 255 / 0.94);
    padding: 3px 7px;
    color: rgb(75 85 99);
    font-size: 0.58rem;
    text-decoration: none;
  }

  :global(.dark) .context-place-search > label,
  :global(.dark) .context-place-search > button,
  :global(.dark) .context-place-search-results,
  :global(.dark) .context-place-search-error,
  :global(.dark) .context-place-search-attribution {
    border-color: rgb(55 65 81);
    background: rgb(17 24 39 / 0.96);
  }

  :global(.dark) .context-place-search input,
  :global(.dark) .context-place-search-results button {
    color: rgb(243 244 246);
  }

  :global(.dark) .context-place-search-attribution,
  :global(.dark) .context-place-search-results small {
    color: rgb(156 163 175);
  }

  :global(.dark) .context-place-search-results button {
    border-color: rgb(55 65 81);
  }

  :global(.dark) .context-editor-map {
    border-color: rgb(55 65 81);
    background: rgb(17 24 39);
  }

  .context-add-map-button {
    display: flex;
    min-height: 56px;
    width: 100%;
    align-items: center;
    justify-content: center;
    gap: 10px;
    border: 1px dashed rgb(156 163 175);
    border-radius: 18px;
    color: rgb(var(--immich-primary));
  }

  .context-add-map-button:hover,
  .context-add-map-button:focus-visible {
    border-color: rgb(var(--immich-primary));
    background: rgb(var(--immich-primary) / 0.06);
    outline: none;
  }

  .context-map-mode-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }

  .context-map-action {
    display: inline-flex;
    min-height: 36px;
    align-items: center;
    gap: 6px;
    border: 1px solid rgb(209 213 219);
    border-radius: 999px;
    padding: 0 12px;
    color: rgb(75 85 99);
    font-size: 0.75rem;
    font-weight: 700;
  }

  :global(.dark) .context-map-action {
    border-color: rgb(75 85 99);
    color: rgb(209 213 219);
  }

  .context-map-action:hover,
  .context-map-action:focus-visible,
  .context-map-action--active {
    border-color: rgb(var(--immich-primary) / 0.6);
    background: rgb(var(--immich-primary) / 0.08);
    color: rgb(var(--immich-primary));
    outline: none;
  }

  .context-detail-lane {
    min-height: 38px;
    flex: 0 0 auto;
    border: 1px solid rgb(209 213 219);
    border-radius: 999px;
    padding: 0 15px;
    color: rgb(75 85 99);
    font-size: 0.78rem;
    font-weight: 700;
  }

  .context-detail-lane span {
    margin-left: 6px;
    color: rgb(107 114 128);
    font-size: 0.7rem;
  }

  .context-detail-lane-note {
    margin-top: 7px;
    color: rgb(107 114 128);
    font-size: 0.75rem;
  }

  :global(.dark) .context-detail-lane {
    border-color: rgb(55 65 81);
    color: rgb(209 213 219);
  }

  .context-detail-lane:hover,
  .context-detail-lane:focus-visible,
  .context-detail-lane--active {
    border-color: rgb(var(--immich-primary) / 0.45);
    background: rgb(var(--immich-primary) / 0.1);
    color: rgb(var(--immich-primary));
    outline: none;
  }

  .context-journey {
    margin-top: 28px;
  }

  .context-journey-heading {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 24px;
  }

  .context-journey-heading h2 {
    margin-top: 4px;
    font-size: 1.25rem;
    font-weight: 650;
  }

  .context-journey-heading p:not(:first-child),
  .context-journey-note {
    margin-top: 5px;
    max-width: 620px;
    color: rgb(107 114 128);
    font-size: 0.8rem;
    line-height: 1.55;
  }

  .context-journey-heading > span {
    flex: none;
    color: rgb(107 114 128);
    font-size: 0.75rem;
    font-weight: 700;
  }

  .context-journey-empty {
    display: grid;
    width: 100%;
    min-height: 190px;
    margin-top: 18px;
    place-items: center;
    align-content: center;
    border: 1px dashed rgb(209 213 219);
    border-radius: 28px;
    padding: 24px;
    text-align: center;
  }

  .context-journey-empty > span {
    display: grid;
    width: 48px;
    height: 48px;
    place-items: center;
    border-radius: 16px;
    background: rgb(var(--immich-primary) / 0.1);
    color: rgb(var(--immich-primary));
  }

  .context-journey-empty strong {
    margin-top: 12px;
  }

  .context-journey-empty small {
    margin-top: 4px;
    color: rgb(107 114 128);
  }

  .context-journey-empty:hover,
  .context-journey-empty:focus-visible {
    border-color: rgb(var(--immich-primary) / 0.55);
    background: rgb(var(--immich-primary) / 0.035);
    outline: none;
  }

  .context-stop-list {
    display: grid;
    margin-top: 18px;
  }

  .context-stop-list li {
    position: relative;
    display: grid;
    min-height: 72px;
    grid-template-columns: 42px minmax(0, 1fr) auto;
    align-items: center;
    gap: 14px;
  }

  .context-stop-list li:not(:last-child)::after {
    position: absolute;
    top: 57px;
    bottom: -15px;
    left: 20px;
    width: 2px;
    background: rgb(var(--immich-primary) / 0.19);
    content: '';
  }

  .context-stop-number {
    z-index: 1;
    display: grid;
    width: 42px;
    height: 42px;
    place-items: center;
    border: 1px solid rgb(var(--immich-primary) / 0.32);
    border-radius: 14px;
    background: white;
    color: rgb(var(--immich-primary));
    font-size: 0.78rem;
    font-weight: 850;
  }

  :global(.dark) .context-stop-number {
    background: rgb(17 24 39);
  }

  .context-stop-copy strong,
  .context-stop-copy small {
    display: block;
  }

  .context-stop-copy small {
    margin-top: 3px;
    color: rgb(107 114 128);
    font-size: 0.72rem;
  }

  .context-stop-actions {
    display: flex;
    gap: 4px;
  }

  .context-stop-actions button {
    display: grid;
    width: 40px;
    min-height: 40px;
    place-items: center;
    border-radius: 999px;
    color: rgb(75 85 99);
  }

  .context-stop-actions button:hover:not(:disabled),
  .context-stop-actions button:focus-visible:not(:disabled) {
    background: rgb(243 244 246);
    color: rgb(var(--immich-primary));
    outline: none;
  }

  .context-stop-actions button:disabled {
    opacity: 0.28;
  }

  .context-stop-actions .context-stop-remove:hover:not(:disabled) {
    background: rgb(254 242 242);
    color: rgb(185 28 28);
  }

  .context-journey-note {
    margin-top: 18px;
  }

  .context-relation-group {
    width: fit-content;
    max-width: 100%;
    border: 1px solid rgb(229 231 235);
    border-radius: 24px;
    background: white;
    padding: 16px;
  }

  :global(.dark) .context-relation-group {
    border-color: rgb(31 41 55);
    background: rgb(17 24 39);
  }

  .context-relation-group-title {
    padding: 0 4px;
    color: rgb(107 114 128);
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .context-relation-group-header,
  .context-relation-actions,
  .context-related-filter {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .context-relation-visit,
  .context-relation-actions > button:first-child,
  .context-related-filter button {
    min-height: 36px;
    border-radius: 999px;
    padding: 0 12px;
    color: rgb(var(--immich-primary));
    font-size: 0.74rem;
    font-weight: 750;
  }

  .context-relation-visit {
    border: 1px solid rgb(var(--immich-primary) / 0.22);
    background: rgb(var(--immich-primary) / 0.06);
  }

  .context-relation-visit:hover,
  .context-relation-visit:focus-visible,
  .context-relation-actions > button:first-child:hover,
  .context-relation-actions > button:first-child:focus-visible,
  .context-related-filter button:hover,
  .context-related-filter button:focus-visible {
    background: rgb(var(--immich-primary) / 0.1);
    outline: none;
  }

  .context-relation-cards {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 10px;
  }

  .context-relation-card {
    width: min(220px, calc(100vw - 80px));
    flex: 0 1 220px;
    overflow: hidden;
    border: 1px solid rgb(229 231 235);
    border-radius: 18px;
    background: rgb(249 250 251);
  }

  :global(.dark) .context-relation-card {
    border-color: rgb(55 65 81);
    background: rgb(31 41 55 / 0.72);
  }

  .context-relation-identity {
    display: grid;
    grid-template-columns: 48px minmax(0, 1fr);
    min-height: 64px;
    align-items: center;
    gap: 11px;
    padding: 8px 10px;
  }

  .context-relation-identity img,
  .context-relation-identity > span {
    width: 48px;
    height: 48px;
    border-radius: 14px;
  }

  .context-relation-identity img {
    background: rgb(229 231 235);
    object-fit: cover;
  }

  .context-relation-identity > span {
    display: grid;
    place-items: center;
    background: rgb(var(--immich-primary) / 0.12);
    color: rgb(var(--immich-primary));
    font-size: 1rem;
    font-weight: 800;
  }

  .context-relation-identity p {
    overflow: hidden;
    font-size: 0.86rem;
    font-weight: 700;
    line-height: 1.25;
    text-overflow: ellipsis;
  }

  .context-relation-actions {
    min-height: 42px;
    border-top: 1px solid rgb(229 231 235);
    padding: 3px 6px 3px 10px;
  }

  :global(.dark) .context-relation-actions {
    border-color: rgb(55 65 81);
  }

  .context-relation-remove {
    display: grid;
    width: 36px;
    height: 36px;
    place-items: center;
    border-radius: 999px;
    color: rgb(107 114 128);
  }

  .context-relation-remove:hover,
  .context-relation-remove:focus-visible {
    background: rgb(239 68 68 / 0.1);
    color: rgb(220 38 38);
    outline: none;
  }

  .context-relation-target-picker {
    position: relative;
  }

  .context-relation-target-picker > label {
    display: flex;
    min-height: 44px;
    align-items: center;
    gap: 9px;
    border: 1px solid rgb(209 213 219);
    border-radius: 0.85rem;
    padding: 0 12px;
    color: rgb(107 114 128);
  }

  :global(.dark) .context-relation-target-picker > label {
    border-color: rgb(75 85 99);
    background: rgb(31 41 55);
  }

  .context-relation-target-picker input {
    min-width: 0;
    min-height: 42px;
    flex: 1;
    border: 0;
    background: transparent;
    color: inherit;
    font-size: 0.875rem;
    outline: none;
  }

  .context-relation-target-picker > label:focus-within {
    border-color: rgb(var(--immich-primary));
    box-shadow: 0 0 0 2px rgb(var(--immich-primary) / 0.18);
  }

  .context-relation-target-results {
    position: absolute;
    z-index: 4;
    top: calc(100% + 6px);
    right: 0;
    left: 0;
    overflow-y: auto;
    max-height: 240px;
    border: 1px solid rgb(209 213 219);
    border-radius: 16px;
    background: white;
    padding: 6px;
    box-shadow: 0 18px 42px rgb(15 23 42 / 0.2);
  }

  :global(.dark) .context-relation-target-results {
    border-color: rgb(55 65 81);
    background: rgb(17 24 39);
  }

  .context-relation-target-results button,
  .context-relation-target-results p {
    width: 100%;
    min-height: 42px;
    border-radius: 11px;
    padding: 10px 12px;
    text-align: left;
  }

  .context-relation-target-results button:hover,
  .context-relation-target-results button:focus-visible {
    background: rgb(var(--immich-primary) / 0.1);
    color: rgb(var(--immich-primary));
    outline: none;
  }

  .context-relation-target-results p,
  .context-relation-target-hint {
    color: rgb(107 114 128);
    font-size: 0.78rem;
    font-weight: 450;
  }

  .context-relation-target-hint {
    margin-top: 7px;
    padding-left: 3px;
  }

  .context-relation-target-selected {
    display: flex;
    min-height: 40px;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-top: 8px;
    border-radius: 13px;
    background: rgb(var(--immich-primary) / 0.09);
    padding: 0 8px 0 12px;
    color: rgb(var(--immich-primary));
    font-size: 0.82rem;
    font-weight: 700;
  }

  .context-relation-target-selected button {
    display: grid;
    width: 34px;
    height: 34px;
    place-items: center;
    border-radius: 999px;
  }

  .context-relation-target-selected button:hover,
  .context-relation-target-selected button:focus-visible {
    background: rgb(var(--immich-primary) / 0.12);
    outline: none;
  }

  .context-related-filter {
    margin: 24px 0 14px;
    border: 1px solid rgb(var(--immich-primary) / 0.22);
    border-radius: 18px;
    background: rgb(var(--immich-primary) / 0.06);
    padding: 12px 14px;
  }

  .context-related-filter p {
    font-size: 0.86rem;
    font-weight: 750;
  }

  .context-related-filter span {
    display: block;
    margin-top: 2px;
    color: rgb(107 114 128);
    font-size: 0.7rem;
  }

  /* Wraps rather than squeezing. The entity actions moved onto this rail, and
     on a 1024px viewport they plus "Add media" cut the tab strip down to 260px
     when it needs 534 — so "Documents" scrolled out of sight. Letting the action
     cluster drop to its own line keeps every tab reachable, which matters more
     than holding one row. */
  .context-profile-rail {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    align-items: stretch;
    row-gap: 0.5rem;
    border-bottom: 1px solid rgb(229 231 235);
  }

  :global(.dark) .context-profile-rail {
    border-color: rgb(31 41 55);
  }

  .context-profile-tabs {
    display: flex;
    min-width: 0;
    /* Basis set just above the widest tab strip (four tabs with counts measure
       ~534px), so the action cluster wraps to its own line rather than clipping
       a tab. At 24rem the 1280px case sat in between — one row, with
       "Documents" cut off by 6px. Biasing toward a wrap is the safer failure. */
    flex: 1 1 34rem;
    gap: 0.15rem;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .context-profile-tabs::-webkit-scrollbar {
    display: none;
  }

  .context-profile-tab {
    position: relative;
    display: inline-flex;
    min-height: 3.25rem;
    flex: 0 0 auto;
    align-items: center;
    gap: 0.45rem;
    border-bottom: 2px solid transparent;
    padding: 0 0.9rem;
    color: rgb(75 85 99);
    font-size: 0.86rem;
    font-weight: 680;
    white-space: nowrap;
  }

  :global(.dark) .context-profile-tab {
    color: rgb(209 213 219);
  }

  .context-profile-tab:hover {
    color: rgb(var(--immich-primary));
  }

  .context-profile-tab:focus-visible {
    border-radius: 0.7rem 0.7rem 0 0;
    outline: 2px solid rgb(var(--immich-primary));
    outline-offset: -3px;
  }

  .context-profile-tab--active {
    border-bottom-color: rgb(var(--immich-primary));
    color: rgb(var(--immich-primary));
  }

  /* The count inherited the active tab's primary colour over a translucent
     grey pill, measuring 3.28:1 at 10.88px. It now carries its own colour so
     it stays legible on both the active and inactive tab, and is large enough
     to be read at a glance. */
  .context-profile-tab > span {
    display: inline-grid;
    min-width: 1.35rem;
    height: 1.35rem;
    place-items: center;
    border-radius: 999px;
    background: rgb(107 114 128 / 0.18);
    padding: 0 0.35rem;
    color: rgb(55 65 81);
    font-size: 0.75rem;
  }

  :global(.dark) .context-profile-tab > span {
    background: rgb(148 163 184 / 0.22);
    color: rgb(229 231 235);
  }

  .context-profile-action {
    align-self: center;
    flex: 0 0 auto;
    margin-left: 0.75rem;
  }

  .context-profile-add-media {
    display: grid;
    width: 2.75rem;
    height: 2.75rem;
    place-items: center;
    border: 1px solid rgb(229 231 235);
    border-radius: 0.75rem;
    background: white;
    color: rgb(75 85 99);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.05);
    transition:
      background 160ms ease,
      border-color 160ms ease,
      color 160ms ease;
  }

  .context-profile-add-media:hover,
  .context-profile-add-media:focus-visible {
    border-color: rgb(var(--immich-primary) / 0.45);
    background: rgb(243 244 246);
    color: rgb(var(--immich-primary));
    outline: none;
  }

  :global(.dark) .context-profile-add-media {
    border-color: rgb(55 65 81);
    background: rgb(17 24 39);
    color: rgb(209 213 219);
  }

  :global(.dark) .context-profile-add-media:hover,
  :global(.dark) .context-profile-add-media:focus-visible {
    border-color: rgb(var(--immich-primary) / 0.55);
    background: rgb(31 41 55);
    color: rgb(var(--immich-primary));
  }

  .context-place-photo-options {
    display: flex;
    overflow: hidden;
    border: 1px solid rgb(229 231 235);
    border-radius: 0.75rem;
    background: white;
    color: rgb(107 114 128);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.05);
  }

  :global(.dark) .context-place-photo-options {
    border-color: rgb(55 65 81);
    background: rgb(17 24 39);
    color: rgb(156 163 175);
  }

  .context-place-photo-options label {
    position: relative;
    display: inline-grid;
    width: 2.75rem;
    height: 2.75rem;
    cursor: pointer;
    place-items: center;
    transition:
      background 160ms ease,
      color 160ms ease;
  }

  .context-place-photo-options label + label {
    border-left: 1px solid rgb(229 231 235);
  }

  :global(.dark) .context-place-photo-options label + label {
    border-color: rgb(55 65 81);
  }

  .context-place-photo-options label:hover,
  .context-place-photo-options label:focus-within {
    background: rgb(243 244 246);
    color: rgb(var(--immich-primary));
  }

  :global(.dark) .context-place-photo-options label:hover,
  :global(.dark) .context-place-photo-options label:focus-within {
    background: rgb(31 41 55);
  }

  .context-place-photo-options select {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    cursor: pointer;
    opacity: 0;
  }

  .context-editor-record {
    display: grid;
    gap: 0.75rem;
    margin-top: 1.25rem;
    border-top: 1px solid rgb(229 231 235);
    padding-top: 1.25rem;
  }

  :global(.dark) .context-editor-record {
    border-color: rgb(31 41 55);
  }

  .context-editor-record-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .context-editor-record-row > div {
    min-width: 0;
    flex: 1 1 16rem;
  }

  .context-editor-record-title {
    font-size: 0.9rem;
    font-weight: 650;
  }

  .context-editor-record-note {
    margin-top: 2px;
    color: rgb(75 85 99);
    font-size: 0.8rem;
    line-height: 1.45;
  }

  :global(.dark) .context-editor-record-note {
    color: rgb(156 163 175);
  }

  .context-editor-danger {
    display: inline-flex;
    min-height: 2.75rem;
    flex: none;
    align-items: center;
    gap: 0.5rem;
    border: 1px solid rgb(220 38 38 / 0.4);
    border-radius: 0.85rem;
    padding: 0 1rem;
    color: rgb(185 28 28);
    font-size: 0.85rem;
    font-weight: 650;
  }

  .context-editor-danger:hover {
    background: rgb(254 242 242);
  }

  :global(.dark) .context-editor-danger {
    color: rgb(252 165 165);
  }

  :global(.dark) .context-editor-danger:hover {
    background: rgb(127 29 29 / 0.28);
  }

  .context-place-photo--selected {
    outline: 4px solid var(--color-primary);
    outline-offset: -4px;
  }

  .context-place-photo-select {
    position: absolute;
    top: 0.5rem;
    left: 0.5rem;
    z-index: 2;
    display: grid;
    width: 2.5rem;
    height: 2.5rem;
    place-items: center;
    border: 2px solid white;
    border-radius: 999px;
    background: rgb(0 0 0 / 0.55);
    color: white;
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.25);
  }

  .context-place-photo-select--active {
    border-color: var(--color-primary);
    background: var(--color-primary);
  }

  @media (min-width: 640px) {
    .context-type-choice-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-height: 800px) {
    .context-editor-map {
      height: 220px;
    }
  }

  @media (max-width: 520px) {
    :global(.context-profile-settings) {
      width: 2.75rem;
      flex: 0 0 2.75rem;
      padding: 0;
    }

    :global(.context-profile-settings span) {
      display: none;
    }

    .context-profile-tab {
      padding: 0 0.7rem;
      font-size: 0.8rem;
    }

    .context-profile-tab :global(svg) {
      display: none;
    }

    .context-profile-action {
      width: 2.75rem;
      padding: 0;
    }

    .context-profile-action span {
      display: none;
    }

    .context-place-search {
      right: 10px;
      left: 48px;
    }

    .context-place-search > button {
      min-width: 62px;
      padding: 0 9px;
    }
  }
</style>
