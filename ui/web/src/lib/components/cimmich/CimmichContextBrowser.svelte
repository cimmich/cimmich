<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import CimmichDocuments from './CimmichDocuments.svelte';
  import CimmichContextCollection from './CimmichContextCollection.svelte';
  import CimmichContextDetailHero from './CimmichContextDetailHero.svelte';
  import CimmichContextPlaceMap from './CimmichContextPlaceMap.svelte';
  import CimmichSectionHeader from './CimmichSectionHeader.svelte';
  import CimmichObjectVisibility from './CimmichObjectVisibility.svelte';
  import CimmichPlaceDeleteDialog from './CimmichPlaceDeleteDialog.svelte';
  import { focusTrap } from '$lib/actions/focus-trap';
  import { filterVisibleCimmichAssets } from './asset-picker-visibility';
  import { cimmichVisibilityManager } from '$lib/managers/cimmich-visibility-manager.svelte';
  import {
    CimmichServiceError,
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
    getCimmichPeople,
    getCimmichPetMedia,
    getCimmichPets,
    searchCimmichAddresses,
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
    type CimmichContextTypeKind,
    type CimmichAddressGeocodingItem,
    type CimmichAddressGeocodingResult,
    type CimmichContextRelation,
  } from '$lib/services/cimmich.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize, getMapMarkers, searchAssets, type AssetResponseDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { SvelteURLSearchParams } from 'svelte/reactivity';
  import { untrack } from 'svelte';
  import {
    mdiArrowLeft,
    mdiCalendarBlankOutline,
    mdiCheck,
    mdiClose,
    mdiDotsVertical,
    mdiFileDocumentOutline,
    mdiFilterVariant,
    mdiImageMultipleOutline,
    mdiLinkPlus,
    mdiMagnify,
    mdiMapMarkerOutline,
    mdiMapOutline,
    mdiPackageVariantClosed,
    mdiPencilOutline,
    mdiPlus,
    mdiTrashCanOutline,
    mdiUndoVariant,
  } from '@mdi/js';
  import {
    contextAssociationKinds,
    contextAssociationLabel,
    contextAssetViewerHref,
    contextFamilyKind,
    contextFamilyLabels,
    contextPlaceSearchQualityLabel,
    contextPlaceNearbyRadii,
    contextPlacePointDistanceMeters,
    contextRelationGroups,
    eventTypeFilters,
    objectTypeFilters,
    contextTypeDescription,
    contextTypeKinds,
    defaultContextRelationDraft,
    filterContextRelationTargets,
    formatContextPlaceDistance,
    humanizeContextKind,
    parseContextPlaceCoordinates,
    resolveContextEditorMutation,
    sortContextPlaceSearchResults,
    type ContextTypeFilter,
  } from './context-entity-presentation';

  interface Props {
    families: CimmichContextFamily[];
  }

  let { families }: Props = $props();

  let activeFamily = $state<CimmichContextFamily>(
    untrack(() =>
      families.includes(page.url.searchParams.get('family') as CimmichContextFamily)
        ? (page.url.searchParams.get('family') as CimmichContextFamily)
        : families[0],
    ),
  );
  let entities = $state<CimmichContextEntity[]>([]);
  let error = $state<CimmichServiceError | null>(null);
  let loaded = $state(false);
  let query = $state('');
  let selected = $state<CimmichContextDetail | null>(null);
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
  let assetPickerMode = $state<'library' | 'nearby'>('library');
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
  let associationKind = $state('manual');
  let undoDecisionId = $state<string | null>(null);
  let showArchived = $state(false);
  let editorCommandId = $state('');
  let assetAttachCommandId = $state('');
  let detachCommandIds = $state<Record<string, string>>({});
  let mediaMenuAssetId = $state<string | null>(null);
  let undoCommandId = $state('');
  let undoLabel = $state('Undo last change');
  let statusCommandId = $state('');
  let relationCommandId = $state('');
  let relationKind = $state('related');
  let relationTargetKind = $state<'event' | 'object' | 'person' | 'pet' | 'place'>('place');
  let relationTargetId = $state('');
  let relationTargetQuery = $state('');
  let relationTargets = $state<Array<{ id: string; name: string }>>([]);
  let relationTargetsLoading = $state(false);
  let relationError = $state('');
  let connectionPresentations = $state<Record<string, { objectPosition: string; sourceAssetId: string | null }>>({});
  let connectionPresentationGeneration = 0;
  let eventMediaLane = $state<'all' | 'main' | 'nearby' | 'stops'>('main');
  let showDeleteContext = $state(false);
  let showEntityMenu = $state(false);
  let showCollectionFilters = $state(false);
  let collectionTypeFilter = $state<ContextTypeFilter>('all');
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
  let formType = $state<CimmichContextTypeKind>('unlocated');
  let formDescription = $state('');
  let formAliases = $state('');
  let formDatePrecision = $state<CimmichContextDatePrecision>('unknown');
  let formDateStart = $state('');
  let formDateEnd = $state('');
  let formParentId = $state('');
  let formLatitude = $state('');
  let formLongitude = $state('');
  let formNorth = $state('');
  let formSouth = $state('');
  let formEast = $state('');
  let formWest = $state('');
  let formRoute = $state('');
  let formMapPoints = $state<Array<{ lat: number; lng: number }>>([]);
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
  const addLabel = $derived(activeFamily === 'events' ? 'Add event' : `Add ${entityNoun}`);
  const collectionTitle = $derived(families.length > 1 ? 'Places & Things' : contextFamilyLabels[activeFamily]);
  const collectionMeta = $derived(
    `${entities.length.toLocaleString()} ${
      entities.length === 1
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
  const selectedAssetIds = $derived(new Set(selected?.assets.map((asset) => asset.sourceAssetId)));
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
  const visibleDetailAssets = $derived(
    !selected || entityKind !== 'event' || eventMediaLane === 'all'
      ? (selected?.assets ?? [])
      : selected.assets.filter((asset) =>
          eventMediaLane === 'main'
            ? asset.associationKind === 'direct' || asset.associationKind === 'manual'
            : eventMediaLane === 'stops'
              ? asset.associationKind === 'route_stop'
              : asset.associationKind === 'context',
        ),
  );
  const visibleRelationGroups = $derived(contextRelationGroups(activeFamily, selected?.relations ?? []));
  type ContextDetailTab = 'connections' | 'documents' | 'map' | 'photos';
  const detailTabs = $derived<Array<{ icon: string; label: string; value: ContextDetailTab }>>([
    { icon: mdiImageMultipleOutline, label: 'Photos', value: 'photos' },
    ...(activeFamily === 'places' ? [{ icon: mdiMapOutline, label: 'Map', value: 'map' } as const] : []),
    { icon: mdiLinkPlus, label: 'Connections', value: 'connections' },
    { icon: mdiFileDocumentOutline, label: 'Documents', value: 'documents' },
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

  const loadEntities = async () => {
    const generation = ++listRequestGeneration;
    const selectedEntityId = selected?.entity.entityId;
    loaded = false;
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
        const requestedEntityId = page.url.searchParams.get('entityId') ?? selectedEntityId;
        const requestedEntity = requestedEntityId
          ? next.find((entity) => entity.entityId === requestedEntityId)
          : undefined;
        if (requestedEntity) {
          void openDetail(requestedEntity);
        } else if (selectedEntityId) {
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

  const selectFamily = (family: CimmichContextFamily) => {
    if (activeFamily === family) {
      return;
    }
    query = '';
    collectionTypeFilter = 'all';
    const url = new URL(page.url);
    url.searchParams.set('family', family);
    url.searchParams.delete('entityId');
    url.searchParams.delete('tab');
    void goto(`${url.pathname}${url.search}`);
  };

  const closeDetail = () => {
    selected = null;
    showEntityMenu = false;
    if (!page.url.searchParams.has('entityId')) {
      return;
    }
    const url = new URL(page.url);
    url.searchParams.delete('entityId');
    url.searchParams.delete('tab');
    void goto(`${url.pathname}${url.search}`, { replaceState: true });
  };

  const openDetail = async (entity: CimmichContextEntity) => {
    const generation = ++detailRequestGeneration;
    selectedLoading = true;
    eventMediaLane = 'main';
    showEntityMenu = false;
    error = null;
    try {
      const next = await getCimmichContextEntity(activeFamily, entity.entityId, {
        includeArchived: entity.status === 'archived',
      });
      if (generation === detailRequestGeneration) {
        selected = next;
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

  const openEntity = (entity: CimmichContextEntity) => {
    const url = new URL(page.url);
    url.searchParams.set('family', activeFamily);
    url.searchParams.set('entityId', entity.entityId);
    url.searchParams.delete('tab');
    void goto(`${url.pathname}${url.search}`);
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

  const handleDetailTabKeydown = (event: KeyboardEvent, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? detailTabs.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + detailTabs.length) % detailTabs.length;
    const next = detailTabs[nextIndex];
    selectDetailTab(next.value);
    const currentTarget = event.currentTarget as HTMLButtonElement;
    const tabs = currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    void tabs?.[nextIndex]?.focus();
  };

  const resetForm = () => {
    if (placeSearchTimeout) {
      globalThis.clearTimeout(placeSearchTimeout);
      placeSearchTimeout = undefined;
    }
    placeSearchGeneration += 1;
    formName = '';
    formDescription = '';
    formAliases = '';
    formDateStart = '';
    formDateEnd = '';
    formDatePrecision = 'unknown';
    formParentId = '';
    formLatitude = '';
    formLongitude = '';
    formNorth = '';
    formSouth = '';
    formEast = '';
    formWest = '';
    formRoute = '';
    formMapPoints = [];
    showPreciseGeometry = false;
    placeSearchQuery = '';
    placeSearchResults = [];
    placeSearchLoading = false;
    placeSearchError = '';
    placeSearchCenter = undefined;
    placeSearchZoom = undefined;
    placeSearchAttribution = undefined;
    placeLocationPhotoName = '';
    formType = contextTypeKinds[entityKind][0];
    editorError = '';
  };

  const openCreate = () => {
    editorMode = 'create';
    editorTarget = null;
    resetForm();
    editorTypeChosen = false;
    editorCommandId = createCimmichContextCommandId('create');
    showEditor = true;
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
    formParentId = entity.parentEntityId ?? '';
    formType = entity.typeKind;
    const geometry = entity.geometry;
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

  const numberValue = (value: string, label: string) => {
    const number = Number(value);
    if (!value.trim() || !Number.isFinite(number)) {
      throw new Error(`${label} must be a number.`);
    }
    return number;
  };

  const formGeometry = (): CimmichContextGeometry => {
    if (entityKind !== 'place' || formType === 'unlocated') {
      return null;
    }
    if (formType === 'point') {
      return { latitude: numberValue(formLatitude, 'Latitude'), longitude: numberValue(formLongitude, 'Longitude') };
    }
    if (formType === 'area') {
      return {
        east: numberValue(formEast, 'East'),
        north: numberValue(formNorth, 'North'),
        south: numberValue(formSouth, 'South'),
        west: numberValue(formWest, 'West'),
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
      return { points };
    }
    return null;
  };

  const updateGeometryFromMapPoints = () => {
    if (formType === 'route') {
      formRoute = formMapPoints.map((point) => `${point.lat}, ${point.lng}`).join('\n');
      return;
    }
    if (formType === 'area' && formMapPoints.length > 0) {
      const latitudes = formMapPoints.map((point) => point.lat);
      const longitudes = formMapPoints.map((point) => point.lng);
      formNorth = String(Math.max(...latitudes));
      formSouth = String(Math.min(...latitudes));
      formEast = String(Math.max(...longitudes));
      formWest = String(Math.min(...longitudes));
    }
  };

  const addPlaceMapPoint = ({ lat, lng }: { lat: number; lng: number }) => {
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
    const last = formMapPoints.at(-1);
    if (last && Math.hypot(last.lat - lat, last.lng - lng) < 0.000_02) {
      return;
    }
    formMapPoints = [...formMapPoints, { lat, lng }].slice(-120);
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
    if (entityKind !== 'place' || formType === 'unlocated') {
      return true;
    }
    try {
      const geometry = formGeometry();
      if (formType === 'area' && geometry && 'north' in geometry) {
        return geometry.north > geometry.south && geometry.east > geometry.west;
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
        displayName: formName.trim(),
        geometry,
        parentEntityId: entityKind === 'place' ? formParentId || null : undefined,
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
      undoDecisionId = result.undo?.eligible ? result.decisionId : null;
      undoCommandId = undoDecisionId ? createCimmichContextCommandId(`${editorMode}-undo`) : '';
      undoLabel = editorMode === 'edit' ? 'Undo edit' : 'Undo creation';
      showEditor = false;
      editorCommandId = '';
      editorTarget = null;
      await loadEntities();
      selected = result.detail;
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
      libraryAssets = await filterVisibleCimmichAssets(recent, getCimmichAssetEvidence);
      libraryLoaded = true;
    } catch {
      assetError = 'Your library could not be loaded. Nothing has changed.';
    } finally {
      libraryLoading = false;
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
    if (mode === 'nearby') {
      void loadNearbyAssets();
    } else if (!libraryLoaded) {
      void loadLibrary();
    }
  };

  const selectNearbyRadius = (radius: typeof nearbyRadius) => {
    nearbyRadius = radius;
    void loadNearbyAssets(radius);
  };

  const openAssetPicker = () => {
    selectedSourceIds = [];
    libraryQuery = '';
    associationKind = contextAssociationKinds[entityKind][0];
    assetAttachCommandId = createCimmichContextCommandId('asset-attach');
    assetError = '';
    nearbyError = '';
    showAssetPicker = true;
    assetPickerMode = nearbyPlacePoint ? 'nearby' : 'library';
    if (assetPickerMode === 'nearby') {
      void loadNearbyAssets();
    } else if (!libraryLoaded) {
      void loadLibrary();
    }
  };

  const toggleAsset = (sourceAssetId: string) => {
    if (selectedAssetIds.has(sourceAssetId)) {
      return;
    }
    selectedSourceIds = selectedSourceIds.includes(sourceAssetId)
      ? selectedSourceIds.filter((id) => id !== sourceAssetId)
      : selectedSourceIds.length < 100
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
      const evidence = await Promise.allSettled(selectedSourceIds.map((id) => getCimmichAssetEvidence(id)));
      const assetIds = evidence.flatMap((item) => (item.status === 'fulfilled' ? [item.value.asset_id] : []));
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
      const result = await undoCimmichContextDecision(
        undoDecisionId,
        undoCommandId || createCimmichContextCommandId('asset-undo'),
      );
      undoDecisionId = null;
      undoCommandId = '';
      undoLabel = 'Undo last change';
      await loadEntities();
      selected = result.detail;
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
      statusCommandId = '';
      await loadEntities();
      selected = restoring ? result.detail : null;
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
          .filter((entity) => entity.entityId !== selected?.entity.entityId)
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

  const addRelation = async () => {
    if (!selected || !relationTargetId) {
      return;
    }
    isSaving = true;
    relationError = '';
    try {
      const result = await attachCimmichContextRelations(
        activeFamily,
        selected.entity.entityId,
        relationCommandId || createCimmichContextCommandId('relation-attach'),
        [{ relationKind, targetId: relationTargetId, targetKind: targetKindForRelation(relationKind) }],
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

  const removeRelation = async (relationId: string) => {
    if (!selected) {
      return;
    }
    isSaving = true;
    error = null;
    try {
      const result = await detachCimmichContextRelations(
        activeFamily,
        selected.entity.entityId,
        createCimmichContextCommandId('relation-detach'),
        [relationId],
      );
      undoDecisionId = result.undo?.eligible ? result.decisionId : null;
      undoCommandId = undoDecisionId ? createCimmichContextCommandId('relation-undo') : '';
      undoLabel = 'Undo connection change';
      await loadEntities();
      selected = result.detail;
    } catch (error_) {
      error = asError(error_);
    } finally {
      isSaving = false;
    }
  };

  const connectionKey = (kind: CimmichContextRelation['targetKind'], id: string) => `${kind}:${id}`;

  const loadConnectionPresentations = async (detail: CimmichContextDetail | null) => {
    const generation = ++connectionPresentationGeneration;
    if (!detail || detail.relations.length === 0) {
      connectionPresentations = {};
      return;
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
      return;
    }
    connectionPresentations = Object.fromEntries(
      settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : [])),
    );
  };

  const contextRelationRoute = (relation: CimmichContextRelation) => {
    if (relation.targetKind === 'person') {
      return `/cimmich/people/${encodeURIComponent(relation.targetName)}?personId=${encodeURIComponent(relation.targetId)}`;
    }
    if (relation.targetKind === 'pet') {
      return `/cimmich/pets?entityId=${encodeURIComponent(relation.targetId)}`;
    }
    const family = `${relation.targetKind}s` as CimmichContextFamily;
    const root = relation.targetKind === 'event' ? '/cimmich/events' : '/cimmich/places';
    return `${root}?family=${family}&entityId=${encodeURIComponent(relation.targetId)}`;
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
            : '/cimmich/places';
    const family = targetKind === 'object' || targetKind === 'place' || targetKind === 'event' ? `${targetKind}s` : '';
    const search = new SvelteURLSearchParams({ relatedFrom: selected.entity.displayName, relatedIds: ids });
    if (family) {
      search.set('family', family);
    }
    void goto(`${root}?${search.toString()}`);
  };

  $effect(() => {
    void loadConnectionPresentations(selected);
  });

  $effect(() => {
    const visibilityVersion = cimmichVisibilityManager.version;
    const requestedFamily = page.url.searchParams.get('family') as CimmichContextFamily | null;
    const requestedEntityId = page.url.searchParams.get('entityId');
    if (visibilityVersion >= 0) {
      untrack(() => {
        if (requestedFamily && families.includes(requestedFamily)) {
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
        if (!requestedEntityId) {
          selected = null;
        }
        void loadEntities();
      });
    }
  });
</script>

<div class="mx-auto w-full max-w-7xl px-5 pb-20 text-immich-fg sm:px-7 dark:text-immich-dark-fg">
  <div class={selected ? 'hidden' : 'py-5'}>
    <div class={selected ? 'flex flex-nowrap items-center gap-3' : ''}>
      {#if selected}
        <button
          class="context-icon-button"
          type="button"
          aria-label={`Back to ${contextFamilyLabels[activeFamily]}`}
          onclick={closeDetail}
        >
          <Icon icon={mdiArrowLeft} size="22" />
        </button>
        <div class="min-w-0 flex-1"></div>
        {#if selected.entity.visibility}
          <CimmichObjectVisibility
            object={selected.entity.visibility}
            objectLabel={contextTargetLabel(selected.entity.entityKind)}
            onChange={updateSelectedVisibility}
          />
        {/if}
        {#if undoDecisionId}
          <button class="context-secondary-button" type="button" disabled={isSaving} onclick={() => void undoAssets()}>
            <Icon icon={mdiUndoVariant} size="19" />
            {undoLabel}
          </button>
        {/if}
        <button class="context-secondary-button context-profile-edit" type="button" onclick={openEdit}>
          <Icon icon={mdiPencilOutline} size="19" /> <span>Edit</span>
        </button>
        <div class="relative">
          <button
            class="context-icon-button"
            type="button"
            aria-label={`More actions for ${selected.entity.displayName}`}
            aria-expanded={showEntityMenu}
            aria-haspopup="menu"
            onclick={() => (showEntityMenu = !showEntityMenu)}
          >
            <Icon icon={mdiDotsVertical} size="21" />
          </button>
          {#if showEntityMenu}
            <div
              class="absolute top-12 right-0 z-30 grid min-w-48 gap-1 rounded-2xl border border-gray-200 bg-white p-1.5 text-sm font-semibold shadow-xl dark:border-gray-700 dark:bg-gray-900"
              role="menu"
              aria-label={`More actions for ${selected.entity.displayName}`}
            >
              <button
                class="min-h-10 rounded-xl px-3 text-left hover:bg-gray-100 focus-visible:bg-gray-100 focus-visible:outline-none dark:hover:bg-gray-800 dark:focus-visible:bg-gray-800"
                type="button"
                role="menuitem"
                disabled={isSaving}
                onclick={() => {
                  showEntityMenu = false;
                  void changeArchivedState();
                }}
              >
                {selected.entity.status === 'archived' ? 'Restore' : 'Archive'}
              </button>
              {#if entityKind === 'place' || entityKind === 'object'}
                <button
                  class="min-h-10 rounded-xl px-3 text-left text-red-700 hover:bg-red-50 focus-visible:bg-red-50 focus-visible:outline-none dark:text-red-300 dark:hover:bg-red-950/40 dark:focus-visible:bg-red-950/40"
                  type="button"
                  role="menuitem"
                  disabled={isSaving}
                  onclick={() => {
                    showEntityMenu = false;
                    openContextDelete();
                  }}>Delete permanently</button
                >
              {/if}
            </div>
          {/if}
        </div>
      {:else}
        <CimmichSectionHeader icon={iconForFamily(activeFamily)} title={collectionTitle} meta={collectionMeta}>
          {#snippet actions()}
            {#if families.length > 1}
              <nav class="flex min-h-11 rounded-xl bg-gray-100 p-1 dark:bg-gray-800" aria-label="Context type">
                {#each families as family (family)}
                  <button
                    class="rounded-lg px-4 text-sm font-semibold transition {activeFamily === family
                      ? 'bg-white text-primary shadow-sm dark:bg-gray-700'
                      : 'text-gray-600 hover:text-gray-950 dark:text-gray-300'}"
                    type="button"
                    aria-current={activeFamily === family ? 'page' : undefined}
                    onclick={() => selectFamily(family)}>{contextFamilyLabels[family]}</button
                  >
                {/each}
              </nav>
            {/if}
            <form
              class="w-full min-w-0 sm:w-56 lg:w-64"
              role="search"
              onsubmit={(event) => {
                event.preventDefault();
                void loadEntities();
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
            <button
              class="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white shadow-sm hover:bg-primary/90"
              type="button"
              onclick={openCreate}
            >
              <Icon icon={mdiPlus} size="18" />
              {addLabel}
            </button>
          {/snippet}
        </CimmichSectionHeader>
      {/if}
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

      <div class="context-hero-actions">
        {#if selected.entity.visibility}
          <CimmichObjectVisibility
            object={selected.entity.visibility}
            objectLabel={contextTargetLabel(selected.entity.entityKind)}
            onChange={updateSelectedVisibility}
          />
        {/if}
        {#if undoDecisionId}
          <button
            class="context-hero-control context-hero-control--label"
            type="button"
            disabled={isSaving}
            onclick={() => void undoAssets()}
          >
            <Icon icon={mdiUndoVariant} size="18" />
            <span>{undoLabel}</span>
          </button>
        {/if}
        <button
          class="context-hero-control context-hero-control--label context-profile-edit"
          type="button"
          onclick={openEdit}
        >
          <Icon icon={mdiPencilOutline} size="18" /> <span>Edit</span>
        </button>
        <div class="relative">
          <button
            class="context-hero-control"
            type="button"
            aria-label={`More actions for ${selected.entity.displayName}`}
            aria-expanded={showEntityMenu}
            aria-haspopup="menu"
            onclick={() => (showEntityMenu = !showEntityMenu)}
          >
            <Icon icon={mdiDotsVertical} size="20" />
          </button>
          {#if showEntityMenu}
            <div
              class="absolute top-12 right-0 z-30 grid min-w-48 gap-1 rounded-2xl border border-gray-200 bg-white p-1.5 text-sm font-semibold text-gray-900 shadow-xl dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              role="menu"
              aria-label={`More actions for ${selected.entity.displayName}`}
            >
              <button
                class="min-h-10 rounded-xl px-3 text-left hover:bg-gray-100 focus-visible:bg-gray-100 focus-visible:outline-none dark:hover:bg-gray-800 dark:focus-visible:bg-gray-800"
                type="button"
                role="menuitem"
                disabled={isSaving}
                onclick={() => {
                  showEntityMenu = false;
                  void changeArchivedState();
                }}
              >
                {selected.entity.status === 'archived' ? 'Restore' : 'Archive'}
              </button>
              {#if entityKind === 'place' || entityKind === 'object'}
                <button
                  class="min-h-10 rounded-xl px-3 text-left text-red-700 hover:bg-red-50 focus-visible:bg-red-50 focus-visible:outline-none dark:text-red-300 dark:hover:bg-red-950/40 dark:focus-visible:bg-red-950/40"
                  type="button"
                  role="menuitem"
                  disabled={isSaving}
                  onclick={() => {
                    showEntityMenu = false;
                    openContextDelete();
                  }}>Delete permanently</button
                >
              {/if}
            </div>
          {/if}
        </div>
      </div>
      <CimmichContextDetailHero detail={selected} {entities} family={activeFamily} />
    </div>

    <div class="context-profile-rail mt-6">
      <div class="context-profile-tabs" role="tablist" aria-label={`${selected.entity.displayName} content`}>
        {#each detailTabs as tab, index (tab.value)}
          <button
            class:context-profile-tab--active={activeDetailTab === tab.value}
            class="context-profile-tab"
            type="button"
            role="tab"
            aria-selected={activeDetailTab === tab.value}
            tabindex={activeDetailTab === tab.value ? 0 : -1}
            onkeydown={(event) => handleDetailTabKeydown(event, index)}
            onclick={() => selectDetailTab(tab.value)}
          >
            <Icon icon={tab.icon} size="18" />
            {tab.label}
            {#if tab.value === 'photos'}<span>{selected.assets.length}</span>{/if}
            {#if tab.value === 'connections'}<span>{selected.relations.length}</span>{/if}
          </button>
        {/each}
      </div>
      {#if activeDetailTab === 'photos'}
        <button class="context-primary-button context-profile-action" type="button" onclick={openAssetPicker}>
          <Icon icon={mdiLinkPlus} size="19" /> <span>Add media</span>
        </button>
      {:else if activeDetailTab === 'connections'}
        <button class="context-secondary-button context-profile-action" type="button" onclick={openRelationPicker}>
          <Icon icon={mdiLinkPlus} size="19" /> <span>Add connection</span>
        </button>
      {/if}
    </div>

    {#if activeDetailTab === 'photos'}
      <div role="tabpanel" aria-label="Photos">
        {#if entityKind === 'event' && selected.assets.length > 0}
          <div class="mt-5 flex max-w-full gap-2 overflow-x-auto pb-1" aria-label="Event media lane">
            {#each [{ label: 'All', value: 'all' }, { label: 'Main', value: 'main' }, { label: 'Stops', value: 'stops' }, { label: 'Nearby', value: 'nearby' }] as lane (lane.value)}
              <button
                class="context-detail-lane"
                class:context-detail-lane--active={eventMediaLane === lane.value}
                type="button"
                aria-pressed={eventMediaLane === lane.value}
                onclick={() => (eventMediaLane = lane.value as typeof eventMediaLane)}>{lane.label}</button
              >
            {/each}
          </div>
        {/if}
        {#if selected.assets.length === 0}
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
          <div class="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {#each visibleDetailAssets as asset (asset.associationId)}
              <article class="group relative aspect-square overflow-hidden rounded-2xl bg-gray-100 dark:bg-gray-800">
                <a
                  class="block size-full focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white"
                  href={contextAssetViewerHref(asset.sourceAssetId)}
                  aria-label={`Open ${asset.filename}`}
                >
                  <img
                    class="size-full object-cover transition duration-200 group-hover:scale-[1.025]"
                    src={getAssetMediaUrl({ id: asset.sourceAssetId, size: AssetMediaSize.Preview })}
                    alt=""
                    loading="lazy"
                  />
                  <span
                    class="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/80 to-transparent p-3 pt-10 text-xs font-semibold text-white"
                    >{contextAssociationLabel(entityKind, asset.associationKind)}</span
                  >
                </a>
                {#if selected.entity.coverAssetId === asset.sourceAssetId}
                  <span
                    class="absolute top-2 left-2 z-1 rounded-full bg-black/62 px-2.5 py-1.5 text-[11px] font-bold text-white shadow-sm backdrop-blur-sm"
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
                    <button
                      class="flex min-h-10 items-center gap-2 rounded-xl px-3 text-left text-red-200 hover:bg-red-500/18 focus-visible:bg-red-500/18 focus-visible:outline-none"
                      type="button"
                      role="menuitem"
                      disabled={isSaving}
                      onclick={() => {
                        mediaMenuAssetId = null;
                        void detachAsset(asset.assetId);
                      }}><Icon icon={mdiTrashCanOutline} size="17" /> Remove from {entityNoun}</button
                    >
                  </div>
                {/if}
              </article>
            {/each}
          </div>
        {/if}
      </div>
    {:else if activeDetailTab === 'map' && activeFamily === 'places'}
      <div class="mt-7" role="tabpanel" aria-label="Map">
        <CimmichContextPlaceMap detail={selected} />
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
                          onclick={() => void removeRelation(relation.relationId)}
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
      entities={displayedEntities}
      controlledTypeFilter={activeFamily === 'places' ? undefined : collectionTypeFilter}
      onAdd={openCreate}
      onOpen={openEntity}
    />
  {/if}
</div>

{#if showEditor}
  <div
    class="fixed inset-0 z-100 flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-6"
    role="presentation"
    onkeydown={(event) => {
      if (event.key === 'Escape' && !isSaving) {
        showEditor = false;
      }
    }}
    onclick={(event) => {
      if (event.currentTarget === event.target && !isSaving) {
        showEditor = false;
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
            {editorMode === 'create' ? `New ${entityNoun}` : `Edit ${selected?.entity.displayName}`}
          </h2>
        </div>
        <button
          class="context-icon-button"
          type="button"
          aria-label="Close"
          disabled={isSaving}
          onclick={() => (showEditor = false)}><Icon icon={mdiClose} size="22" /></button
        >
      </div>
      {#if editorMode === 'create' && !editorTypeChosen}
        <section class="mt-7" aria-label={`Choose ${entityNoun} type`}>
          <p class="text-sm text-gray-600 dark:text-gray-300">
            {entityKind === 'place'
              ? 'How does this place exist on the map?'
              : entityKind === 'event'
                ? 'What kind of memory are you bringing together?'
                : 'What kind of thing is it?'}
          </p>
          <div class="context-type-choice-grid">
            {#each contextTypeKinds[entityKind] as kind (kind)}
              <button
                class="context-type-choice"
                type="button"
                onclick={() => {
                  if (entityKind === 'place' && formType !== kind) {
                    clearPlaceMapPoints();
                  }
                  if (entityKind === 'event' && formDatePrecision === 'unknown') {
                    formDatePrecision = 'exact';
                  }
                  formType = kind;
                  editorTypeChosen = true;
                }}
              >
                <span><Icon icon={iconForFamily(activeFamily)} size="21" /></span>
                <strong>{humanizeContextKind(kind)}</strong>
                <small>{contextTypeDescription(kind)}</small>
              </button>
            {/each}
          </div>
        </section>
      {:else}
        <form class="mt-7 grid gap-5" onsubmit={(event) => void saveEntity(event)}>
          <label class="context-field"
            ><span>Name</span><input bind:value={formName} maxlength="160" autocomplete="off" /></label
          >
          {#if editorMode === 'create'}
            <div class="context-chosen-type">
              <span><Icon icon={iconForFamily(activeFamily)} size="20" /></span>
              <span class="min-w-0 flex-1">
                <strong>{humanizeContextKind(formType)}</strong>
                <small>{contextTypeDescription(formType)}</small>
              </span>
              <button type="button" onclick={() => (editorTypeChosen = false)}>Change</button>
            </div>
          {:else}
            <label class="context-field"
              ><span>Type</span><select bind:value={formType}
                >{#each contextTypeKinds[entityKind] as kind (kind)}<option value={kind}
                    >{humanizeContextKind(kind)}</option
                  >{/each}</select
              ></label
            >
          {/if}
          {#if entityKind === 'event'}
            <label class="context-field"
              ><span>Date certainty</span><select bind:value={formDatePrecision}
                ><option value="exact">Exact dates</option><option value="approximate">Approximate</option><option
                  value="month">Known month</option
                ><option value="year">Known year</option><option value="unknown">Not known yet</option></select
              ></label
            >
            <div class="grid gap-4 sm:grid-cols-2">
              <label class="context-field"
                ><span>Starts <small>Optional</small></span><input type="date" bind:value={formDateStart} /></label
              ><label class="context-field"
                ><span>Ends <small>Optional</small></span><input type="date" bind:value={formDateEnd} /></label
              >
            </div>
          {/if}
          {#if entityKind === 'place'}
            {#if formType === 'unlocated'}
              <div class="rounded-2xl border border-dashed border-gray-300 p-5 dark:border-gray-700">
                <p class="font-semibold">Name it now. Locate it later.</p>
                <p class="mt-1 text-sm/6 text-gray-500 dark:text-gray-400">
                  This place will remain searchable and can still hold photos, Events and connections without invented
                  map geometry.
                </p>
              </div>
            {:else}
              <section aria-label="Place geometry">
                <div class="mb-3 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p class="font-semibold">
                      {formType === 'point'
                        ? 'Choose the point'
                        : formType === 'area'
                          ? 'Paint across the area'
                          : 'Draw the route'}
                    </p>
                    <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {formType === 'point'
                        ? formMapPoints.length > 0
                          ? 'Drag the marker to put it exactly where you want it.'
                          : 'Click once on the map, or search above. You can drag the marker afterwards.'
                        : formType === 'area'
                          ? 'Drag across the place. Cimmich saves the honest rectangular boundary supported today.'
                          : 'Drag along the journey in order.'}
                    </p>
                  </div>
                  {#if formType === 'point' || formMapPoints.length > 0}
                    <div class="flex gap-2">
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
                    </div>
                  {/if}
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
            <label class="context-field"
              ><span>Inside <small>Optional</small></span><select bind:value={formParentId}
                ><option value="">No parent place</option
                >{#each entities.filter((entity) => entity.entityId !== selected?.entity.entityId) as entity (entity.entityId)}<option
                    value={entity.entityId}>{entity.displayName}</option
                  >{/each}</select
              ></label
            >
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
          <div
            class="sticky bottom-0 -mx-2 flex justify-end gap-3 bg-white/95 px-2 py-3 backdrop-blur-sm dark:bg-gray-900/95"
          >
            <button
              class="context-secondary-button"
              type="button"
              disabled={isSaving}
              onclick={() => (showEditor = false)}>Cancel</button
            ><button class="context-primary-button" type="submit" disabled={isSaving || !entityDraftCanSave}
              ><Icon icon={mdiCheck} size="19" />
              {isSaving ? 'Saving…' : editorMode === 'create' ? `Add ${entityNoun}` : 'Save changes'}</button
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
          <h2 class="text-xl font-semibold" id="context-asset-title">Add media</h2>
          <p class="mt-1 text-sm text-gray-500">{selectedSourceIds.length}/100 selected</p>
        </div>
        <label class="context-field min-w-40"
          ><span>How it relates</span><select bind:value={associationKind}
            >{#each contextAssociationKinds[entityKind] as kind (kind)}<option value={kind}
                >{contextAssociationLabel(entityKind, kind)}</option
              >{/each}</select
          ></label
        ><button
          class="context-icon-button"
          type="button"
          aria-label="Close"
          disabled={isSaving}
          onclick={() => (showAssetPicker = false)}><Icon icon={mdiClose} size="22" /></button
        >
      </div>
      <div class="space-y-3 p-4 sm:px-6">
        {#if nearbyPlacePoint}
          <div class="flex gap-1 rounded-full bg-gray-100 p-1 dark:bg-gray-800" aria-label="Choose media source">
            <button
              class="min-h-10 flex-1 rounded-full px-4 text-sm font-semibold transition"
              class:bg-white={assetPickerMode === 'nearby'}
              class:text-primary={assetPickerMode === 'nearby'}
              class:shadow-sm={assetPickerMode === 'nearby'}
              class:dark:bg-gray-700={assetPickerMode === 'nearby'}
              type="button"
              aria-pressed={assetPickerMode === 'nearby'}
              onclick={() => selectAssetPickerMode('nearby')}
              ><Icon icon={mdiMapMarkerOutline} size="18" /> Nearby</button
            ><button
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
          onclick={() => void attachAssets()}
          ><Icon icon={mdiLinkPlus} size="19" />
          {isSaving ? 'Adding…' : `Add ${selectedSourceIds.length || ''} media`}</button
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
          <p class="text-xs font-bold tracking-[0.16em] text-primary uppercase">Connected context</p>
          <h2 class="mt-1 text-2xl font-semibold" id="context-relation-title">Add connection</h2>
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
        <label class="context-field"
          ><span>Relationship</span><select
            bind:value={relationKind}
            onchange={() => {
              relationTargetKind = defaultContextRelationDraft(entityKind, [relationKind]).relationTargetKind;
              void loadRelationTargets();
            }}
            >{#each relationKinds as kind (kind)}<option value={kind}>{humanizeContextKind(kind)}</option
              >{/each}</select
          ></label
        >
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
            ><Icon icon={mdiLinkPlus} size="19" /> {isSaving ? 'Adding…' : 'Add connection'}</button
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

  .context-hero-back,
  .context-hero-actions {
    position: absolute;
    z-index: 12;
    top: 16px;
  }

  .context-hero-back {
    left: 16px;
  }

  .context-hero-actions {
    right: 16px;
    display: flex;
    align-items: center;
    gap: 8px;
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

  .context-hero-control--label {
    width: auto;
    padding: 0 14px;
  }

  .context-hero-control:hover,
  .context-hero-control:focus-visible {
    background: rgb(15 23 42 / 0.9);
    outline: 2px solid white;
    outline-offset: 2px;
  }

  .context-hero-actions :global(button:not([role='menuitem'])) {
    border-color: rgb(255 255 255 / 0.2);
    background: rgb(15 23 42 / 0.72);
    color: white;
    box-shadow: 0 6px 18px rgb(0 0 0 / 0.16);
    backdrop-filter: blur(12px);
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
  .context-map-action:focus-visible {
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

  .context-profile-rail {
    display: flex;
    min-width: 0;
    align-items: stretch;
    border-bottom: 1px solid rgb(229 231 235);
  }

  :global(.dark) .context-profile-rail {
    border-color: rgb(31 41 55);
  }

  .context-profile-tabs {
    display: flex;
    min-width: 0;
    flex: 1;
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

  .context-profile-tab > span {
    display: inline-grid;
    min-width: 1.35rem;
    height: 1.35rem;
    place-items: center;
    border-radius: 999px;
    background: rgb(107 114 128 / 0.12);
    padding: 0 0.35rem;
    font-size: 0.68rem;
  }

  .context-profile-action {
    align-self: center;
    flex: 0 0 auto;
    margin-left: 0.75rem;
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
    :global(.context-profile-edit) {
      width: 2.75rem;
      flex: 0 0 2.75rem;
      padding: 0;
    }

    :global(.context-profile-edit span) {
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
