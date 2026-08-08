<script lang="ts">
  import CimmichPersonDetails from '$lib/components/cimmich/CimmichPersonDetails.svelte';
  import CimmichEntityMediaActions from '$lib/components/cimmich/CimmichEntityMediaActions.svelte';
  import { handleCimmichMediaCardClick } from '$lib/components/cimmich/media-card-selection';
  import { keyboardTabs } from '$lib/components/cimmich/keyboard-tabs';
  import CimmichDocuments from '$lib/components/cimmich/CimmichDocuments.svelte';
  import CimmichObjectVisibility from '$lib/components/cimmich/CimmichObjectVisibility.svelte';
  import CimmichStatePanel from '$lib/components/cimmich/CimmichStatePanel.svelte';
  import CimmichSamePhotoCollisionReview from '$lib/components/cimmich/CimmichSamePhotoCollisionReview.svelte';
  import CimmichReviewPhotoMedia from '$lib/components/cimmich/CimmichReviewPhotoMedia.svelte';
  import CimmichUnknownPersonAction from '$lib/components/cimmich/CimmichUnknownPersonAction.svelte';
  import { CimmichIdentityAuditCorrectionController } from '$lib/components/cimmich/identity-audit-correction-controller.svelte';
  import { fitIdentityReviewCrop } from '$lib/components/cimmich/identity-review-crop';
  import { CimmichPhotoReviewController } from '$lib/components/cimmich/photo-review-controller.svelte';
  import { preparePersonCandidates } from '$lib/components/cimmich/person-candidate-review';
  import {
    personAwaitingCounts,
    personIdentityAuditGroups,
    samePhotoCollisionReview,
    type CimmichPersonReviewItem,
  } from '$lib/components/cimmich/same-photo-collision-review';
  import {
    ENTITY_MEDIA_SELECTION_LIMIT,
    type CimmichEntityMediaItem,
  } from '$lib/components/cimmich/entity-media-actions';
  import {
    PERSON_CANDIDATE_SELECTION_LIMIT,
    selectPersonCandidates,
    togglePersonCandidateSelection,
  } from '$lib/components/cimmich/person-candidate-selection';
  import { machineSuggestionsForPerson } from '$lib/components/cimmich/person-machine-suggestions';
  import {
    groupPersonPhotos,
    personPhotoDateLabel,
    personPhotoGridClass,
    preparePersonPhotos,
    type PersonPhotoGroup,
    type PersonPhotoSize,
    type PersonPhotoSort,
  } from '$lib/components/cimmich/person-photo-gallery';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import { cimmichVisibilityManager } from '$lib/managers/cimmich-visibility-manager.svelte';
  import { mediaQueryManager } from '$lib/stores/media-query-manager.svelte';
  import { Route } from '$lib/route';
  import {
    acceptCimmichMachineSuggestion,
    addCimmichPersonAlias,
    bulkAcceptCimmichPersonCandidates,
    bulkRejectCimmichPersonCandidates,
    CimmichServiceError,
    createCimmichContextCommandId,
    createCimmichIdentityCorrectionCommandId,
    createCimmichObservationCorrectionCommandId,
    createCimmichPersonMergeIntentTracker,
    decideCimmichFaceModifierProposal,
    decideCimmichIdentityCandidate,
    detachCimmichContextRelations,
    dismissCimmichIdentityAuditItem,
    dismissCimmichIdentityAuditItemsBatch,
    getCimmichFaceMatches,
    getCimmichContextEntity,
    getCimmichHoldingMatchesBatch,
    getCimmichIdentityFacesPage,
    getCimmichIdentityCorrectionDiscovery,
    getCimmichIdentityCorrectionHistory,
    getCimmichIdentityAuditItems,
    getCimmichMergePreview,
    getCimmichMachineSuggestions,
    getCimmichPeople,
    getCimmichPersonDetailsDisplay,
    getCimmichPersonDetailsDisplayDefaults,
    getCimmichPersonAssetsPage,
    getCimmichPersonByName,
    getCimmichPersonConnections,
    getCimmichPersonCandidates,
    getCimmichPersonProfile,
    getCimmichPersonPresentation,
    getCimmichPersonProfileDisplay,
    getCimmichPersonProfileDisplayDefaults,
    getCimmichPersonSetup,
    getCimmichVisibilityObject,
    mergeCimmichPeople,
    markCimmichFaceNotFace,
    moveCimmichIdentityFace,
    rejectCimmichAcceptedIdentity,
    rescanCimmichHeadEvidence,
    removeCimmichPersonAlias,
    setCimmichFaceBucket,
    setCimmichFaceIdentitiesBatch,
    setCimmichFaceModifier,
    setCimmichFaceReviewDisposition,
    setCimmichPersonCategory,
    setCimmichPersonPresentation,
    setCimmichPersonSubjectKind,
    unmergeCimmichPeople,
    undoCimmichContextDecision,
    undoCimmichIdentityCorrection,
    type CimmichContextFamily,
    type CimmichIdentityCandidate,
    type CimmichIdentityAuditItem,
    type CimmichIdentityCorrectionDiscovery,
    type CimmichIdentityFace,
    type CimmichIdentityFaceSummary,
    type CimmichFaceMatch,
    type CimmichFaceOwnerReviewMatch,
    type CimmichMergePreview,
    type CimmichMachineSuggestion,
    type CimmichPerson,
    type CimmichPersonAsset,
    type CimmichPersonContextConnection,
    type CimmichPersonDetailsDisplay,
    type CimmichPersonDetailsDisplayDefaults,
    type CimmichPersonProfileDisplay,
    type CimmichPersonProfileDisplayDefaults,
    type CimmichPersonProfileFieldKey,
    type CimmichPersonProfileProjection,
    type CimmichPersonPresentation,
    type CimmichPersonPresentationSlot,
    type CimmichPersonSetup,
    type CimmichVisibilityObject,
  } from '$lib/services/cimmich.service';
  import {
    buildCimmichPeopleIndex,
    resolveCimmichAssetsByFilename,
    updateCimmichFace,
    type CimmichEvidenceBundle,
    type CimmichFaceOverlay,
    type CimmichPackQcIndex,
    type CimmichPersonFeatureFace,
    type CimmichPersonPhoto,
    type CimmichPersonProfile,
    type CimmichResolvedAsset,
  } from '$lib/services/cimmich-evidence.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { cimmichSquareCropBackgroundStyle } from '$lib/utils/cimmich-crop';
  import { AssetMediaSize } from '@immich/sdk';
  import {
    mdiAccount,
    mdiAccountMultipleOutline,
    mdiArrowLeft,
    mdiCalendarAlertOutline,
    mdiCalendarRange,
    mdiCheckCircleOutline,
    mdiChevronRight,
    mdiGenderFemale,
    mdiGenderMale,
    mdiGenderMaleFemaleVariant,
    mdiGenderNonBinary,
    mdiGroup,
    mdiImageMultipleOutline,
    mdiMapMarkerOutline,
    mdiPencilOutline,
    mdiShapeOutline,
    mdiSelectAll,
    mdiSortVariant,
    mdiTagMultipleOutline,
    mdiTrashCanOutline,
    mdiViewGridOutline,
  } from '@mdi/js';
  import { Icon, Tooltip, toastManager } from '@immich/ui';
  import { SvelteMap, SvelteSet, SvelteURLSearchParams } from 'svelte/reactivity';
  import type { PageData } from './$types';
  interface Props {
    data: PageData;
  }

  type CountRow = { count: number; label: string };
  type CimmichIdentityFilter =
    | 'all'
    | 'body'
    | 'candidates'
    | 'head'
    | 'lq'
    | 'needs_qc'
    | 'presentation'
    | 'presence'
    | 'prime'
    | 'references'
    | 'secondary';
  type CimmichPersonMode = 'connections' | 'details' | 'documents' | 'identity' | 'photos' | 'setup';
  type CimmichMoveMode = 'existing' | 'new';
  type CimmichIdentityMoveUndo = {
    bodyId?: string;
    destinationPersonId: string;
    faceId: string;
    moveBody: boolean;
    originalPersonId: string;
  };
  const identityMoveUndoKey = (personId: string) => `cimmich.identity-move-undo.v1.${personId}`;
  const storeIdentityMoveUndo = (personId: string, receipt: CimmichIdentityMoveUndo | null) => {
    try {
      const key = identityMoveUndoKey(personId);
      if (!receipt) {
        globalThis.localStorage.removeItem(key);
        return;
      }
      globalThis.localStorage.setItem(key, JSON.stringify({ receipt, savedAt: Date.now() }));
    } catch {
      // The move remains durable even when this browser refuses local storage;
      // only the convenience affordance is unavailable after a reload.
    }
  };
  const restoreIdentityMoveUndo = (personId: string): CimmichIdentityMoveUndo | null => {
    try {
      const raw = globalThis.localStorage.getItem(identityMoveUndoKey(personId));
      if (!raw) {
        return null;
      }
      const value = JSON.parse(raw) as { receipt?: Partial<CimmichIdentityMoveUndo>; savedAt?: number };
      const receipt = value.receipt;
      if (
        !Number.isFinite(value.savedAt) ||
        Date.now() - Number(value.savedAt) > 24 * 60 * 60 * 1000 ||
        !receipt ||
        !receipt.destinationPersonId ||
        !receipt.faceId ||
        receipt.originalPersonId !== personId ||
        typeof receipt.moveBody !== 'boolean'
      ) {
        storeIdentityMoveUndo(personId, null);
        return null;
      }
      return receipt as CimmichIdentityMoveUndo;
    } catch {
      storeIdentityMoveUndo(personId, null);
      return null;
    }
  };
  type CimmichPersonConnection = {
    directRelations?: Array<{ relationId: string; relationType: string }>;
    displayName: string;
    entityId: string;
    entityKind: 'event' | 'object' | 'person' | 'place';
    metaLabel: string;
    photoCount: number;
    sourceAssetId: string | null;
    typeKind: string;
  };
  type PhotoFilter = 'all' | 'body' | 'face' | 'needs';
  type PersonTab = 'identity' | 'maintenance' | 'photos' | 'places' | 'signals' | 'story' | 'with';
  type FaceConfirmationCandidate = {
    asset?: CimmichResolvedAsset;
    evidenceKind: 'candidate' | 'source';
    face: CimmichFaceOverlay;
    filename: string;
    id: string;
    mediaId: string;
    photo: CimmichPersonPhoto;
    proposedName: string;
  };
  type CimmichHeroField = {
    fieldKey: CimmichPersonProfileFieldKey;
    label: string;
    value: string;
  };
  type CimmichPresentationFrame = {
    centerX: number;
    centerY: number;
    zoom: number;
  };
  type CimmichPresentationDrag = {
    pointerId: number;
    slotKind: CimmichPersonPresentationSlot;
    x: number;
    y: number;
  };
  let { data }: Props = $props();
  let activeTab = $state<PersonTab>('photos');
  let cimmichPhotoGroup = $state<PersonPhotoGroup>('none');
  let cimmichPhotoSize = $state<PersonPhotoSize>('medium');
  let cimmichPhotoSort = $state<PersonPhotoSort>('newest');
  let cimmichAssets = $state<CimmichPersonAsset[]>([]);
  let cimmichPhotoSelectionMode = $state(false);
  let cimmichSelectedPhotoIds = $state<string[]>([]);
  let cimmichAssetsLoadingMore = $state(false);
  let cimmichAssetsNextCursor = $state<string | null>(null);
  let cimmichCandidates = $state<CimmichIdentityCandidate[]>([]);
  let cimmichIdentityError = $state('');
  let cimmichIdentityAuditEvidenceExpanded = $state<string[]>([]);
  let cimmichIdentityCollisionAssetIds = $state<string[]>([]);
  let cimmichIdentityAuditConfirmAction = $state<'' | 'accept' | 'dismiss'>('');
  let cimmichIdentityAuditItems = $state<CimmichIdentityAuditItem[]>([]);
  let cimmichIdentityAuditLoadingKind = $state<CimmichIdentityAuditItem['kind'] | ''>('');
  let cimmichIdentityAuditProgress = $state({ completed: 0, total: 0 });
  let cimmichIdentityAuditSavingId = $state('');
  let cimmichIdentityAuditSelection = $state<string[]>([]);
  const cimmichPhotoReview = new CimmichPhotoReviewController((message) => toastManager.danger(message));
  let cimmichIdentityAuditTotals = $state<Record<CimmichIdentityAuditItem['kind'], number>>({
    accepted_contradiction: 0,
    untagged_match: 0,
  });
  let cimmichIdentityMessage = $state('');
  let cimmichIdentityUndoDecisionId = $state('');
  let cimmichIdentityCorrections = $state<CimmichIdentityCorrectionDiscovery['items']>([]);
  let cimmichIdentityFaces = $state<CimmichIdentityFace[]>([]);
  let cimmichIdentityBucketLoading = $state<CimmichIdentityFilter | ''>('');
  let cimmichIdentityBucketNextCursors = $state<Record<string, string | null>>({});
  let cimmichIdentityFacesLoadingMore = $state(false);
  let cimmichIdentityFaceSummary = $state<CimmichIdentityFaceSummary>({
    all: 0,
    head: 0,
    lowQuality: 0,
    prime: 0,
    secondary: 0,
  });
  let cimmichHoldingMatches = $state<Record<string, CimmichFaceMatch | CimmichFaceOwnerReviewMatch | undefined>>({});
  let cimmichHoldingMatchesLoading = $state<Record<string, boolean>>({});
  let cimmichIdentityFilter = $state<CimmichIdentityFilter>('all');
  let cimmichIdentityLoaded = $state(false);
  let cimmichIdentityLoading = $state(false);
  let cimmichIdentityNextCursor = $state<string | null>(null);
  let cimmichIdentityRejectConfirmId = $state('');
  let cimmichIdentityMoveBody = $state(false);
  let cimmichIdentityMoveFaceId = $state('');
  let cimmichIdentityMoveMode = $state<CimmichMoveMode>('existing');
  let cimmichIdentityMoveNewName = $state('');
  let cimmichIdentityMovePersonId = $state('');
  let cimmichIdentityMoveQuery = $state('');
  let cimmichIdentityMoveSuggestion = $state<CimmichFaceMatch | CimmichFaceOwnerReviewMatch>();
  let cimmichIdentityMoveUndo = $state<CimmichIdentityMoveUndo | null>(null);
  let cimmichIdentitySavingId = $state('');
  let cimmichHeadRescanSaving = $state(false);
  let cimmichIdentitySectionLimits = $state<Record<string, number>>({});
  let cimmichMachineSuggestionConfirm = $state(false);
  let cimmichMachineSuggestionSaving = $state(false);
  let cimmichMachineSuggestionSelection = $state<string[]>([]);
  let cimmichMachineSuggestions = $state<CimmichMachineSuggestion[]>([]);
  let cimmichPresentation = $state<CimmichPersonPresentation>();
  let cimmichPresentationPickerSlot = $state<CimmichPersonPresentationSlot | ''>('');
  let cimmichPresentationFrames = $state<Record<CimmichPersonPresentationSlot, CimmichPresentationFrame>>({
    body: { centerX: 50, centerY: 50, zoom: 1 },
    face: { centerX: 50, centerY: 50, zoom: 1 },
    hero: { centerX: 50, centerY: 50, zoom: 1 },
  });
  let cimmichPresentationDrag = $state<CimmichPresentationDrag>();
  let cimmichPresentationSaving = $state<CimmichPersonPresentationSlot | ''>('');
  let cimmichLoadError = $state('');
  let cimmichMode = $state<CimmichPersonMode>('photos');
  let cimmichPerson = $state<CimmichPerson>();
  let cimmichPhotoSelectionPersonId = '';
  let cimmichTabsCanScrollRight = $state(false);
  let cimmichTabsScroller = $state<HTMLDivElement>();
  let personProjectionGeneration = 0;
  let cimmichProfile = $state<CimmichPersonProfileProjection>();
  let cimmichProfileDefaults = $state<CimmichPersonProfileDisplayDefaults>();
  let cimmichProfileDisplay = $state<CimmichPersonProfileDisplay>();
  let cimmichDetailsDefaults = $state<CimmichPersonDetailsDisplayDefaults>();
  let cimmichDetailsDisplay = $state<CimmichPersonDetailsDisplay>();
  let cimmichPersonVisibility = $state<CimmichVisibilityObject>();
  let cimmichPeopleConnections = $state<CimmichPersonConnection[]>([]);
  let cimmichDirectContextConnections = $state<CimmichPersonContextConnection[]>([]);
  let cimmichConnectionError = $state('');
  let cimmichConnectionSavingId = $state('');
  let cimmichConnectionUndoDecisionId = $state('');
  let cimmichProfileError = $state('');
  let cimmichSetup = $state<CimmichPersonSetup>();
  let cimmichSetupAliasDraft = $state('');
  let cimmichSetupAliasKind = $state<'former_name' | 'imported' | 'nickname'>('nickname');
  let cimmichSetupError = $state('');
  let cimmichSetupLoading = $state(false);
  let cimmichSetupMergePersonId = $state('');
  let cimmichSetupMergeQuery = $state('');
  let cimmichSetupMergePreview = $state<CimmichMergePreview>();
  const cimmichSetupMergeIntents = createCimmichPersonMergeIntentTracker();
  let cimmichSetupPeople = $state<CimmichPerson[]>([]);
  const cimmichIdentityAuditCorrection = new CimmichIdentityAuditCorrectionController(
    () => cimmichSetupPeople,
    () => cimmichPerson?.person_id ?? '',
    (message) => (cimmichIdentityError = message),
  );
  let cimmichSetupSaving = $state('');
  let cimmichSetupSubjectConfirm = $state<'person' | 'pet'>();
  let loadError = $state('');
  let people = $state<CimmichPersonProfile[]>([]);
  let person = $state<CimmichPersonProfile>();
  let faceCandidateDrafts = $state<Record<string, string>>({});
  let faceCandidateError = $state('');
  let faceCandidateMessage = $state('');
  let faceCandidateSavingId = $state('');
  let packIndexes = $state<CimmichPackQcIndex[]>([]);
  let photoFilter = $state<PhotoFilter>('all');
  let resolvedAssets = $state<Record<string, CimmichResolvedAsset>>({});
  let assetResolveRun = 0;

  const photoFilters: Array<{ id: PhotoFilter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'face', label: 'Face' },
    { id: 'body', label: 'Body' },
    { id: 'needs', label: 'Needs check' },
  ];

  const updateCimmichTabsOverflow = () => {
    if (!cimmichTabsScroller) {
      return;
    }
    const visibleRight = cimmichTabsScroller.scrollLeft + cimmichTabsScroller.clientWidth;
    cimmichTabsCanScrollRight = [...cimmichTabsScroller.querySelectorAll<HTMLElement>('[data-person-tab]')].some(
      (tab) => tab.offsetLeft + tab.offsetWidth > visibleRight + 4,
    );
  };

  const scrollCimmichTabIntoView = (tab: HTMLElement) => {
    if (!cimmichTabsScroller) {
      return;
    }
    const visibleLeft = cimmichTabsScroller.scrollLeft;
    const visibleRight = visibleLeft + cimmichTabsScroller.clientWidth;
    const tabRight = tab.offsetLeft + tab.offsetWidth;
    const left =
      tab.offsetLeft < visibleLeft
        ? tab.offsetLeft
        : tabRight > visibleRight
          ? tabRight - cimmichTabsScroller.clientWidth
          : visibleLeft;
    cimmichTabsScroller.scrollTo({ behavior: mediaQueryManager.reducedMotion ? 'auto' : 'smooth', left });
  };

  const scrollCimmichTabs = () => {
    if (!cimmichTabsScroller) {
      return;
    }
    const visibleRight = cimmichTabsScroller.scrollLeft + cimmichTabsScroller.clientWidth;
    const nextTab = [...cimmichTabsScroller.querySelectorAll<HTMLElement>('[data-person-tab]')].find(
      (tab) => tab.offsetLeft + tab.offsetWidth > visibleRight + 4,
    );
    if (nextTab) {
      scrollCimmichTabIntoView(nextTab);
    }
  };

  $effect(() => {
    const mode = cimmichMode;
    const personId = cimmichPerson?.person_id;
    const scroller = cimmichTabsScroller;
    if (!personId || !scroller) {
      return;
    }
    requestAnimationFrame(() => {
      const selectedTab = scroller.querySelector<HTMLElement>(`[data-person-tab="${mode}"]`);
      if (selectedTab) {
        scrollCimmichTabIntoView(selectedTab);
      }
      updateCimmichTabsOverflow();
    });
  });
  const cimmichIdentityFilters: Array<{
    id: CimmichIdentityFilter;
    label: string;
    description: string;
  }> = [
    { id: 'all', label: 'Identity observations', description: 'Faces currently accepted as this person' },
    { id: 'references', label: 'Face evidence', description: 'Core and supporting identity evidence' },
    { id: 'needs_qc', label: 'Needs attention', description: 'Quality flags in the loaded observations' },
  ];
  const cimmichIdentityAdvancedFilters: Array<{
    id: CimmichIdentityFilter;
    label: string;
    description: string;
  }> = [
    { id: 'prime', label: 'Core', description: 'Selected to cover the person for matching' },
    { id: 'secondary', label: 'Supporting', description: 'Remaining usable Face evidence' },
    { id: 'lq', label: 'Low quality', description: 'Condition-routed Face evidence' },
    { id: 'head', label: 'Head references', description: 'Face-derived, not manual tags' },
    { id: 'body', label: 'Body', description: 'Body-only evidence without a usable Face or Head' },
    { id: 'presence', label: 'Presence', description: 'Known appearance without usable person geometry' },
  ];
  const cimmichModifierOptions = ['Helmet', 'Sunglasses', 'Mask', 'Profile', 'Low light', 'Occluded'];

  const tabs: Array<{ id: PersonTab; label: string }> = [
    { id: 'photos', label: 'Photos' },
    { id: 'story', label: 'Story' },
    { id: 'identity', label: 'Identity' },
    { id: 'with', label: 'With' },
    { id: 'places', label: 'Places' },
    { id: 'signals', label: 'Signals' },
    { id: 'maintenance', label: 'Maintenance' },
  ];

  const resolveFilenames = $derived(
    [person?.featureFace?.filename, ...(person?.photos.map((photo) => photo.filename) ?? [])].filter(
      (filename): filename is string => typeof filename === 'string',
    ),
  );
  const visibleCimmichAssets = $derived(preparePersonPhotos(cimmichAssets, 'all', cimmichPhotoSort));
  const cimmichPersonConnections = $derived.by(() => {
    const connections = new SvelteMap<string, CimmichPersonConnection & { assetIds: Set<string> }>();
    for (const connection of cimmichDirectContextConnections) {
      const relation = connection.relationId
        ? [{ relationId: connection.relationId, relationType: connection.relationType }]
        : [];
      const existing = connections.get(connection.targetId);
      if (existing) {
        existing.directRelations = [...(existing.directRelations ?? []), ...relation];
        existing.metaLabel = [...new Set(existing.directRelations.map((item) => item.relationType))]
          .sort()
          .join(' · ')
          .replaceAll('_', ' ');
        existing.sourceAssetId ||= connection.coverAssetId;
        continue;
      }
      connections.set(connection.targetId, {
        assetIds: new Set(),
        directRelations: relation,
        displayName: connection.displayName,
        entityId: connection.targetId,
        entityKind: connection.targetKind,
        metaLabel: connection.relationType.replaceAll('_', ' '),
        photoCount: 0,
        sourceAssetId: connection.coverAssetId,
        typeKind: connection.typeKind ?? connection.targetKind,
      });
    }
    for (const asset of cimmichAssets) {
      for (const context of asset.contexts) {
        const existing = connections.get(context.entityId);
        if (existing) {
          existing.assetIds.add(asset.asset_id);
          existing.photoCount = existing.assetIds.size;
          existing.sourceAssetId ||= asset.sourceAssetId;
          continue;
        }
        connections.set(context.entityId, {
          assetIds: new Set([asset.asset_id]),
          displayName: context.displayName,
          entityId: context.entityId,
          entityKind: context.entityKind,
          metaLabel: '',
          photoCount: 1,
          sourceAssetId: asset.sourceAssetId,
          typeKind: context.typeKind,
        });
      }
    }
    return [...connections.values()].sort(
      (left, right) =>
        left.entityKind.localeCompare(right.entityKind) || left.displayName.localeCompare(right.displayName),
    );
  });
  const cimmichPersonConnectionGroups = $derived(
    [
      { id: 'person', label: 'People' },
      { id: 'event', label: 'Events' },
      { id: 'place', label: 'Places' },
      { id: 'object', label: 'Things' },
    ]
      .map((group) => ({
        ...group,
        items: [...cimmichPeopleConnections, ...cimmichPersonConnections].filter(
          (connection) => connection.entityKind === group.id,
        ),
      }))
      .filter((group) => group.items.length > 0),
  );
  const cimmichPersonConnectionHref = ({ entityId, entityKind }: CimmichPersonConnection) => {
    if (entityKind === 'person') {
      const person = cimmichSetupPeople.find((row) => row.person_id === entityId);
      return person
        ? Route.cimmichPerson({ name: person.display_name, personId: person.person_id })
        : Route.cimmichPeople();
    }
    const search = new SvelteURLSearchParams({ entityId });
    if (entityKind === 'object') {
      search.set('family', 'objects');
      return `${Route.cimmichPlaces()}?${search.toString()}`;
    }
    return `${entityKind === 'event' ? Route.cimmichEvents() : Route.cimmichPlaces()}?${search.toString()}`;
  };
  const removeCimmichPersonConnection = async (connection: CimmichPersonConnection) => {
    if (!cimmichPerson || !connection.directRelations?.length || connection.entityKind === 'person') {
      return;
    }
    cimmichConnectionSavingId = connection.entityId;
    cimmichConnectionError = '';
    try {
      const result = await detachCimmichContextRelations(
        `${connection.entityKind}s` as CimmichContextFamily,
        connection.entityId,
        createCimmichContextCommandId('person-connection-detach'),
        connection.directRelations.map((relation) => relation.relationId),
      );
      cimmichDirectContextConnections = await getCimmichPersonConnections(cimmichPerson.person_id);
      cimmichConnectionUndoDecisionId = result.undo?.eligible ? (result.decisionId ?? '') : '';
      toastManager.success(`Removed connection to ${connection.displayName}`);
    } catch (error) {
      cimmichConnectionError = error instanceof Error ? error.message : 'Unable to remove this connection';
    } finally {
      cimmichConnectionSavingId = '';
    }
  };
  const undoCimmichPersonConnection = async () => {
    if (!cimmichPerson || !cimmichConnectionUndoDecisionId) {
      return;
    }
    cimmichConnectionSavingId = 'undo';
    cimmichConnectionError = '';
    try {
      await undoCimmichContextDecision(
        cimmichConnectionUndoDecisionId,
        createCimmichContextCommandId('person-connection-undo'),
      );
      cimmichDirectContextConnections = await getCimmichPersonConnections(cimmichPerson.person_id);
      cimmichConnectionUndoDecisionId = '';
      toastManager.success('Connection restored');
    } catch (error) {
      cimmichConnectionError = error instanceof Error ? error.message : 'Unable to restore this connection';
    } finally {
      cimmichConnectionSavingId = '';
    }
  };
  const loadCimmichPeopleConnections = async (
    personId: string,
    assets: CimmichPersonAsset[],
    people: CimmichPerson[],
  ) => {
    const contextCounts = new SvelteMap<string, number>();
    for (const asset of assets) {
      for (const context of asset.contexts) {
        contextCounts.set(context.entityId, (contextCounts.get(context.entityId) ?? 0) + 1);
      }
    }
    // Uncapped, this fired one request per unique context tag across the
    // person's assets — hundreds on a well-tagged archive person. Rank by
    // shared-asset count so the strongest connections win the budget.
    const contexts = [
      ...new SvelteMap(
        assets.flatMap((asset) => asset.contexts).map((context) => [context.entityId, context]),
      ).values(),
    ]
      .sort((a, b) => (contextCounts.get(b.entityId) ?? 0) - (contextCounts.get(a.entityId) ?? 0))
      .slice(0, 32);
    const details: (Awaited<ReturnType<typeof getCimmichContextEntity>> | null)[] = Array.from(
      { length: contexts.length },
      () => null,
    );
    let nextContextIndex = 0;
    const contextWorker = async () => {
      while (nextContextIndex < contexts.length) {
        const index = nextContextIndex++;
        const context = contexts[index];
        details[index] = await getCimmichContextEntity(
          context.entityKind === 'event' ? 'events' : context.entityKind === 'object' ? 'objects' : 'places',
          context.entityId,
        ).catch(() => null);
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, contexts.length) }, () => contextWorker()));
    const linked = new SvelteMap<string, CimmichPersonConnection & { contextIds: Set<string> }>();
    for (const detail of details) {
      if (!detail) {
        continue;
      }
      for (const relation of detail.relations) {
        if (relation.targetKind !== 'person' || relation.targetId === personId) {
          continue;
        }
        const person = people.find((row) => row.person_id === relation.targetId);
        if (!person?.sourceAssetId) {
          continue;
        }
        const existing = linked.get(person.person_id);
        if (existing) {
          existing.contextIds.add(detail.entity.entityId);
          existing.photoCount = existing.contextIds.size;
          continue;
        }
        linked.set(person.person_id, {
          contextIds: new Set([detail.entity.entityId]),
          displayName: person.display_name,
          entityId: person.person_id,
          entityKind: 'person',
          metaLabel:
            person.categories
              .filter((category) => category.category_kind === 'relationship')
              .sort((left, right) => left.sort_order - right.sort_order)
              .map((category) => category.name)
              .join(' · ') || 'Connected person',
          photoCount: 1,
          sourceAssetId: person.sourceAssetId,
          typeKind: relation.relationKind,
        });
      }
    }
    return [...linked.values()].sort((left, right) => left.displayName.localeCompare(right.displayName));
  };
  const visibleCimmichCandidates = $derived(preparePersonCandidates(cimmichCandidates));
  const cimmichIdentityAuditFaceIds = $derived(new Set(cimmichIdentityAuditItems.map(({ faceId }) => faceId)));
  const cimmichCandidateReviewItems = $derived<CimmichPersonReviewItem[]>(
    visibleCimmichCandidates.map((candidate) => {
      const matchScore = candidate.source_score ?? candidate.calibrated_confidence ?? candidate.match_score ?? null;
      const margin = candidate.source_margin;
      const currentPerson =
        candidate.current_person_id && candidate.current_person_name
          ? {
              displayName: candidate.current_person_name,
              personId: candidate.current_person_id,
              reference: null,
              score: 1,
            }
          : null;
      return {
        assetId: candidate.asset_id,
        assignedPerson: currentPerson,
        box: { h: candidate.box_h, w: candidate.box_w, x: candidate.box_x, y: candidate.box_y },
        candidateClaimId: candidate.identity_claim_id,
        candidateEvidence: {
          detectorConfidence: candidate.detection_confidence,
          margin,
          matchScore,
          // A sole-candidate lead carries margin = score + 1 (matcherPolicyMargin
          // with no runner-up), so a real second-best score only exists when the
          // margin does not exceed the winning score.
          secondBestScore: matchScore !== null && margin !== null && margin <= matchScore ? matchScore - margin : null,
        },
        captureTime: candidate.capture_time,
        currentDecisionId: candidate.current_decision_id,
        currentRevision: candidate.current_revision,
        detectionConfidence: candidate.detection_confidence,
        faceId: candidate.face_id,
        filename: candidate.filename,
        height: candidate.height,
        kind:
          currentPerson && currentPerson.personId !== candidate.person_id
            ? ('accepted_contradiction' as const)
            : ('untagged_match' as const),
        margin: margin ?? 0,
        mediaKind: candidate.media_kind,
        qualityMeasurements: candidate.quality_measurements,
        samePhotoAcceptedCount: candidate.same_photo_accepted_count ?? 0,
        sourceAssetId: candidate.sourceAssetId,
        suggestedPerson: {
          displayName: candidate.display_name,
          personId: candidate.person_id,
          reference: null,
          score: matchScore ?? 0,
        },
        width: candidate.width,
      };
    }),
  );
  const cimmichPersonReviewItems = $derived.by<CimmichPersonReviewItem[]>(() => {
    const merged = new SvelteMap<string, CimmichPersonReviewItem>(
      cimmichIdentityAuditItems.map((item) => [item.faceId, item]),
    );
    for (const candidate of cimmichCandidateReviewItems) {
      const audited = merged.get(candidate.faceId);
      merged.set(
        candidate.faceId,
        audited
          ? {
              ...audited,
              candidateClaimId: candidate.candidateClaimId,
              candidateEvidence: candidate.candidateEvidence,
              currentDecisionId: candidate.currentDecisionId,
              currentRevision: candidate.currentRevision,
              samePhotoAcceptedCount: candidate.samePhotoAcceptedCount,
            }
          : candidate,
      );
    }
    return [...merged.values()];
  });
  const cimmichSamePhotoCollisions = $derived(
    samePhotoCollisionReview(cimmichPersonReviewItems, new Set(cimmichIdentityCollisionAssetIds)),
  );
  const cimmichSamePhotoCollisionGroups = $derived(cimmichSamePhotoCollisions.groups);
  const cimmichSamePhotoCollisionFaceIds = $derived(cimmichSamePhotoCollisions.faceIds);
  const visibleCimmichMachineSuggestions = $derived(
    machineSuggestionsForPerson(cimmichMachineSuggestions, cimmichPerson?.person_id ?? '', cimmichCandidates).filter(
      ({ face_id }) => !cimmichIdentityAuditFaceIds.has(face_id),
    ),
  );
  const cimmichCandidateOnlyReviewItems = $derived(
    cimmichCandidateReviewItems.filter(({ faceId }) => !cimmichIdentityAuditFaceIds.has(faceId)),
  );
  const cimmichAwaitingCounts = $derived(
    personAwaitingCounts(
      cimmichIdentityAuditTotals,
      cimmichCandidateOnlyReviewItems,
      visibleCimmichMachineSuggestions.length,
    ),
  );
  const cimmichIdentityAuditGroups = $derived(
    personIdentityAuditGroups({
      auditTotals: cimmichIdentityAuditTotals,
      candidateOnlyItems: cimmichCandidateOnlyReviewItems,
      collisionFaceIds: cimmichSamePhotoCollisionFaceIds,
      personName: cimmichPerson?.display_name ?? 'this person',
      reviewItems: cimmichPersonReviewItems,
    }),
  );
  const groupedCimmichAssets = $derived(groupPersonPhotos(visibleCimmichAssets, cimmichPhotoGroup));
  const selectedCimmichPhotoItems = $derived<CimmichEntityMediaItem[]>(
    cimmichAssets
      .filter((asset) => cimmichSelectedPhotoIds.includes(asset.asset_id) && Boolean(asset.sourceAssetId))
      .map((asset) => ({
        assetId: asset.asset_id,
        filename: asset.filename,
        sourceAssetId: asset.sourceAssetId,
      })),
  );

  $effect(() => {
    const personId = cimmichPerson?.person_id ?? '';
    if (personId !== cimmichPhotoSelectionPersonId) {
      cimmichPhotoSelectionPersonId = personId;
      cimmichPhotoSelectionMode = false;
      cimmichSelectedPhotoIds = [];
    }
  });
  const cimmichMergeOptions = $derived(
    cimmichSetupPeople.filter(
      (row) => row.person_id !== cimmichPerson?.person_id && row.subject_kind === cimmichPerson?.subject_kind,
    ),
  );
  const filteredCimmichMergeOptions = $derived.by(() => {
    const query = cimmichSetupMergeQuery.trim().toLocaleLowerCase();
    if (!query) {
      return [];
    }
    return cimmichMergeOptions
      .filter((row) => [row.display_name, ...row.aliases].join(' ').toLocaleLowerCase().includes(query))
      .slice(0, 12);
  });
  const selectedCimmichMerge = $derived(
    cimmichMergeOptions.find((option) => option.person_id === cimmichSetupMergePersonId),
  );
  const cimmichMoveOptions = $derived(
    cimmichSetupPeople.filter(
      (row) =>
        row.person_id !== cimmichPerson?.person_id &&
        row.subject_kind === 'person' &&
        (!cimmichPerson?.needs_holding || !row.needs_holding),
    ),
  );
  const filteredCimmichMoveOptions = $derived.by(() => {
    const query = cimmichIdentityMoveQuery.trim().toLocaleLowerCase();
    if (!query) {
      return [];
    }
    return cimmichMoveOptions
      .filter((row) => [row.display_name, ...row.aliases].join(' ').toLocaleLowerCase().includes(query))
      .slice(0, 8);
  });
  const cimmichMainBucket = (face: CimmichIdentityFace) => face.main_evidence_tier;
  const cimmichMatchingBucket = (face: CimmichIdentityFace) => face.matching_reference_tier;
  const cimmichBodyAssets = $derived(
    cimmichAssets.filter(
      ({ association_types }) => association_types.includes('body') || association_types.includes('body_candidate'),
    ),
  );
  const cimmichPresenceAssets = $derived(
    cimmichAssets.filter(({ association_types }) => association_types.includes('presence')),
  );
  const cimmichSelectedAppearanceAssets = $derived(
    cimmichIdentityFilter === 'body'
      ? cimmichBodyAssets
      : cimmichIdentityFilter === 'presence'
        ? cimmichPresenceAssets
        : [],
  );
  const cimmichPresentationSelectionCount = $derived(
    [cimmichPresentation?.face, cimmichPresentation?.body, cimmichPresentation?.hero].filter(Boolean).length,
  );
  const cimmichPresentationPickerFaces = $derived(
    cimmichPresentationPickerSlot === 'body'
      ? cimmichIdentityFaces.filter((face) => Boolean(face.body_id))
      : cimmichIdentityFaces,
  );
  const cimmichIdentityWorkspaceGroups = $derived([
    {
      id: 'references',
      label: 'Face evidence',
      filters: [
        { id: 'all', label: 'All confirmed', count: cimmichIdentityFaceSummary.all.toLocaleString() },
        { id: 'prime', label: 'Core matching set', count: cimmichIdentityFaceSummary.prime.toLocaleString() },
        { id: 'secondary', label: 'Supporting', count: cimmichIdentityFaceSummary.secondary.toLocaleString() },
        { id: 'lq', label: 'Low quality', count: cimmichIdentityFaceSummary.lowQuality.toLocaleString() },
      ],
    },
    {
      id: 'appearance',
      label: 'Appearance',
      filters: [
        { id: 'head', label: 'Head', count: cimmichIdentityFaceSummary.head.toLocaleString() },
        { id: 'body', label: 'Body', count: cimmichBodyAssets.length.toLocaleString() },
        { id: 'presence', label: 'Presence', count: cimmichPresenceAssets.length.toLocaleString() },
      ],
    },
    {
      id: 'display',
      label: 'Display',
      filters: [{ id: 'presentation', label: 'Photos', count: `${cimmichPresentationSelectionCount}/3` }],
    },
    {
      id: 'review',
      label: 'Review',
      filters: [
        {
          id: 'candidates',
          label: 'Checks',
          count: `${cimmichAwaitingCounts.newMatches.toLocaleString()} new · ${cimmichAwaitingCounts.possibleMistags.toLocaleString()} mistags`,
        },
      ],
    },
  ]);
  const cimmichIdentitySectionBatchSize = (section: string) =>
    section.startsWith('identity-audit:') || section === 'machine-suggestions' ? 50 : 20;
  const cimmichIdentitySectionLimit = (section: string) =>
    cimmichIdentitySectionLimits[section] ?? cimmichIdentitySectionBatchSize(section);
  const showMoreCimmichIdentitySection = (section: string) => {
    cimmichIdentitySectionLimits = {
      ...cimmichIdentitySectionLimits,
      [section]: cimmichIdentitySectionLimit(section) + cimmichIdentitySectionBatchSize(section),
    };
  };
  const cimmichIdentityServerBucket = (
    filter: CimmichIdentityFilter,
  ): 'head' | 'lq' | 'prime' | 'secondary' | undefined =>
    filter === 'head' || filter === 'lq' || filter === 'prime' || filter === 'secondary' ? filter : undefined;
  const loadCimmichIdentityBucket = async (filter: CimmichIdentityFilter, append = false) => {
    const bucket = cimmichIdentityServerBucket(filter);
    if (!bucket || !cimmichPerson || cimmichIdentityBucketLoading) {
      return;
    }
    const cursor = append ? (cimmichIdentityBucketNextCursors[bucket] ?? undefined) : undefined;
    cimmichIdentityBucketLoading = filter;
    cimmichIdentityError = '';
    try {
      const page = await getCimmichIdentityFacesPage(cimmichPerson.person_id, 120, cursor, bucket);
      const retained = append
        ? cimmichIdentityFaces
        : cimmichIdentityFaces.filter((face) => cimmichMainBucket(face) !== bucket);
      const merged = new SvelteMap(retained.map((face) => [face.face_id, face]));
      for (const face of page.items) {
        merged.set(face.face_id, face);
      }
      cimmichIdentityFaces = [...merged.values()];
      cimmichIdentityFaceSummary = page.summary;
      cimmichIdentityBucketNextCursors = {
        ...cimmichIdentityBucketNextCursors,
        [bucket]: page.nextCursor,
      };
    } catch (error) {
      cimmichIdentityError = error instanceof Error ? error.message : `Unable to load ${bucket} evidence`;
    } finally {
      cimmichIdentityBucketLoading = '';
    }
  };
  const selectCimmichIdentityWorkspace = (filter: CimmichIdentityFilter) => {
    cimmichIdentityFilter = filter;
    if (filter !== 'presentation') {
      cimmichPresentationPickerSlot = '';
    }
    const bucket = cimmichIdentityServerBucket(filter);
    if (
      bucket &&
      cimmichIdentityFaces.filter((face) => cimmichMainBucket(face) === bucket).length <
        (bucket === 'lq' ? cimmichIdentityFaceSummary.lowQuality : cimmichIdentityFaceSummary[bucket])
    ) {
      void loadCimmichIdentityBucket(filter);
    }
  };
  const visibleCimmichIdentityFaces = $derived.by(() => {
    if (cimmichIdentityFilter === 'references') {
      return cimmichIdentityFaces.filter((face) => {
        const bucket = cimmichMainBucket(face);
        return bucket === 'prime' || bucket === 'secondary';
      });
    }
    if (
      cimmichIdentityFilter === 'prime' ||
      cimmichIdentityFilter === 'secondary' ||
      cimmichIdentityFilter === 'lq' ||
      cimmichIdentityFilter === 'head'
    ) {
      return cimmichIdentityFaces.filter((face) => cimmichMainBucket(face) === cimmichIdentityFilter);
    }
    if (
      cimmichIdentityFilter === 'candidates' ||
      cimmichIdentityFilter === 'body' ||
      cimmichIdentityFilter === 'presence' ||
      cimmichIdentityFilter === 'presentation'
    ) {
      return [];
    }
    if (cimmichIdentityFilter === 'needs_qc') {
      return cimmichIdentityFaces.filter((face) => cimmichMainBucket(face) === 'head' || face.qc_flags.length > 0);
    }
    return cimmichIdentityFaces;
  });
  const renderedCimmichIdentityFaces = $derived(
    visibleCimmichIdentityFaces.slice(0, cimmichIdentitySectionLimit(cimmichIdentityFilter)),
  );
  const cimmichIdentityBucketLabel = (face: CimmichIdentityFace) => {
    const bucket = cimmichMainBucket(face);
    if (bucket === 'prime') {
      return 'Core matching evidence';
    }
    if (bucket === 'secondary') {
      return cimmichMatchingBucket(face) === 'secondary' ? 'Supporting matcher reference' : 'Supporting evidence only';
    }
    if (bucket === 'lq') {
      return 'Low quality';
    }
    if (bucket === 'head') {
      return 'Head reference';
    }
    return 'Supporting evidence only';
  };

  const visibleCimmichAliases = $derived(
    cimmichPerson?.aliases.filter(
      (alias) => alias.trim().toLocaleLowerCase() !== cimmichPerson?.display_name.trim().toLocaleLowerCase(),
    ) ?? [],
  );
  const cimmichRelationshipLabels = $derived(
    cimmichPerson?.categories.filter((category) => category.category_kind === 'relationship').map(({ name }) => name) ??
      [],
  );
  const cimmichPhotoDates = $derived.by(() =>
    cimmichAssets
      .flatMap(({ capture_time }) => {
        if (!capture_time) {
          return [];
        }
        const date = new Date(capture_time);
        return Number.isNaN(date.getTime()) ? [] : [date];
      })
      .sort((left, right) => left.getTime() - right.getTime()),
  );
  const cimmichFuturePhotoDateCount = $derived(
    cimmichPerson?.photo_history?.futureCaptureDateCount ??
      cimmichPhotoDates.filter((date) => date.getTime() > Date.now()).length,
  );
  const cimmichPhotoTimeframe = $derived.by(() => {
    const now = Date.now();
    const aggregate = cimmichPerson?.photo_history;
    const dates = aggregate
      ? [aggregate.minCaptureTime, aggregate.maxCaptureTime]
          .flatMap((captureTime) => {
            if (!captureTime) {
              return [];
            }
            const date = new Date(captureTime);
            return Number.isNaN(date.getTime()) ? [] : [date];
          })
          .sort((left, right) => left.getTime() - right.getTime())
      : cimmichPhotoDates.filter((date) => date.getTime() <= now);
    const first = dates[0];
    const last = dates.at(-1);
    if (!first || !last) {
      return cimmichFuturePhotoDateCount > 0 ? 'Dates need review' : 'Date unavailable';
    }
    const fullDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    if (first.toDateString() === last.toDateString()) {
      return fullDate.format(first);
    }
    if (first.getFullYear() === last.getFullYear()) {
      const shortDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
      return `${shortDate.format(first)}–${fullDate.format(last)}`;
    }
    return `${first.getFullYear()}–${last.getFullYear()}`;
  });
  const cimmichPhotoTimeframeLabel = $derived(
    cimmichPerson?.photo_history || !cimmichAssetsNextCursor ? 'Photo history' : 'Loaded date range',
  );
  const cimmichGenderLabel = $derived(
    cimmichProfile?.profile.genderIdentityKind === 'self_described'
      ? cimmichProfile.profile.genderIdentityLabel
      : cimmichProfile?.profile.genderIdentityKind === 'non_binary'
        ? 'Non-binary'
        : cimmichProfile?.profile.genderIdentityKind === 'woman'
          ? 'Woman'
          : cimmichProfile?.profile.genderIdentityKind === 'man'
            ? 'Man'
            : null,
  );
  const cimmichGenderIcon = $derived(
    cimmichProfile?.profile.genderIdentityKind === 'woman'
      ? mdiGenderFemale
      : cimmichProfile?.profile.genderIdentityKind === 'man'
        ? mdiGenderMale
        : cimmichProfile?.profile.genderIdentityKind === 'non_binary'
          ? mdiGenderNonBinary
          : cimmichProfile?.profile.genderIdentityKind === 'self_described'
            ? mdiGenderMaleFemaleVariant
            : null,
  );
  const cimmichHeroFields = $derived.by(() => {
    if (!cimmichProfile || !cimmichProfileDisplay) {
      return [];
    }
    const importantDates = cimmichProfile.items.filter(({ kind }) => kind === 'important_date');
    const work = cimmichProfile.items.filter(({ kind }) => kind === 'work');
    const values: Record<CimmichPersonProfileFieldKey, string> = {
      about: cimmichProfile.profile.about ?? '',
      aliases: visibleCimmichAliases.join(', '),
      gender_identity: cimmichGenderLabel ?? '',
      important_dates: importantDates
        .map((item) => {
          const date = new Intl.DateTimeFormat(undefined, {
            day: 'numeric',
            month: 'short',
            timeZone: 'UTC',
            year: 'numeric',
          }).format(new Date(`${item.dateValue}T00:00:00Z`));
          return `${item.label}: ${date}`;
        })
        .join(' · '),
      photo_history: cimmichPhotoTimeframe,
      pronouns: cimmichProfile.profile.pronounsLabel ?? '',
      relationships: cimmichProfile.relationships.map(({ name }) => name).join(', '),
      work: work
        .map((item) => [item.value, item.secondaryValue].filter(Boolean).join(' · '))
        .filter(Boolean)
        .join(' · '),
    };
    const labels: Record<CimmichPersonProfileFieldKey, string> = {
      about: 'About',
      aliases: 'Also known as',
      gender_identity: 'Gender identity',
      important_dates: 'Important dates',
      photo_history: cimmichPhotoTimeframeLabel,
      pronouns: 'Pronouns',
      relationships: 'Relationship',
      work: 'Work',
    };
    return cimmichProfileDisplay.fields
      .filter(({ effectiveVisible, fieldKey }) => effectiveVisible && values[fieldKey])
      .sort((left, right) => left.order - right.order)
      .map<CimmichHeroField>(({ fieldKey }) => ({ fieldKey, label: labels[fieldKey], value: values[fieldKey] }));
  });

  const clampPercent = (value: number) => Math.max(0, Math.min(100, value));

  const cimmichQcLabel = (face: CimmichIdentityFace, flag: CimmichIdentityFace['qc_flags'][number]) => {
    if (flag === 'tiny_face') {
      return `${Math.min(face.face_pixel_width, face.face_pixel_height)}px`;
    }
    if (flag === 'low_detection_confidence') {
      return 'Low confidence';
    }
    if (flag === 'low_quality') {
      return 'Low quality';
    }
    if (flag === 'nearby_face') {
      return face.nearby_face_count > 1 ? `${face.nearby_face_count} nearby faces` : 'Nearby face';
    }
    return `Imported #${face.source_instance_suffix}`;
  };

  const countRows = (counts: Record<string, number>, limit = 8): CountRow[] =>
    Object.entries(counts)
      .map(([label, count]) => ({ count, label }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, limit);

  const bucketLabel = (bucket: string) =>
    bucket
      .replace(/^face_/, '')
      .replace(/^reject_/, '')
      .replaceAll('_', ' ');
  const normalizeName = (value: string | undefined) => (value ?? '').trim().replaceAll(/\s+/g, ' ');
  const sameName = (left: string | undefined, right: string | undefined) =>
    normalizeName(left).toLowerCase() === normalizeName(right).toLowerCase();
  const nameInList = (names: string[] | undefined, name: string | undefined) =>
    (names ?? []).some((row) => sameName(row, name));

  const personNamesForPhoto = (photo: CimmichPersonPhoto) => {
    const names = new SvelteSet<string>();
    for (const name of photo.evidence.summary?.sourcePeople ?? []) {
      names.add(name);
    }
    for (const name of photo.evidence.summary?.candidatePeople ?? []) {
      names.add(name);
    }
    for (const face of photo.evidence.faceOverlays ?? []) {
      if (face.status === 'named') {
        names.add(face.name);
      }
    }
    for (const body of photo.evidence.bodyOverlays ?? []) {
      if (body.status === 'linked') {
        names.add(body.linkedName);
      }
    }
    return [...names].filter((name) => name && name !== person?.name);
  };

  const unresolvedFaceCount = (photo: CimmichPersonPhoto) =>
    photo.evidence.faceOverlays?.filter((face) => face.status === 'sidecar_only' || face.status === 'untagged')
      .length ?? 0;

  const photoEvidenceLabels = (photo: CimmichPersonPhoto) => {
    const labels: string[] = [];
    const isSource = photo.evidence.summary?.sourcePeople?.includes(person?.name ?? '');
    const isCandidate = photo.evidence.summary?.candidatePeople?.includes(person?.name ?? '');
    const bodyObservationCount = photo.evidence.bodyOverlays?.length ?? 0;
    if (photo.faceOverlays.length > 0) {
      labels.push(`${photo.faceOverlays.length} face`);
    }
    if (photo.bodyLinks.length > 0) {
      labels.push(`${photo.bodyLinks.length} body`);
    } else if (bodyObservationCount > 0) {
      labels.push(`${bodyObservationCount} body obs`);
    }
    if (isSource) {
      labels.push('source');
    } else if (isCandidate) {
      labels.push('candidate');
    }
    if (photo.qcStatus && photo.qcStatus !== 'ready_for_cimmich') {
      labels.push(photo.qcStatus.replaceAll('_', ' '));
    }
    const unresolved = unresolvedFaceCount(photo);
    if (unresolved > 0) {
      labels.push(`${unresolved} unresolved`);
    }
    return labels;
  };

  const filteredPhotos = $derived.by(() => {
    const photos = person?.photos ?? [];
    if (photoFilter === 'face') {
      return photos.filter((photo) => photo.faceOverlays.length > 0);
    }
    if (photoFilter === 'body') {
      return photos.filter((photo) => photo.bodyLinks.length > 0 || (photo.evidence.bodyOverlays?.length ?? 0) > 0);
    }
    if (photoFilter === 'needs') {
      return photos.filter((photo) => unresolvedFaceCount(photo) > 0 || photo.faceOverlays.length === 0);
    }
    return photos;
  });

  const years = $derived.by(() => {
    const counts: Record<string, number> = {};
    for (const photo of person?.photos ?? []) {
      const rawDate = photo.evidence.summary?.exifDate || '';
      const year = rawDate.match(/\d{4}/)?.[0] || 'Unknown';
      counts[year] = (counts[year] ?? 0) + 1;
    }
    return countRows(counts, 8);
  });

  const peopleWith = $derived.by(() => {
    const counts: Record<string, number> = {};
    for (const photo of person?.photos ?? []) {
      for (const name of personNamesForPhoto(photo)) {
        counts[name] = (counts[name] ?? 0) + 1;
      }
    }
    return countRows(counts, 18);
  });

  const topPlace = $derived(countRows(person?.knownPlaces ?? {}, 1)[0]?.label ?? 'Place pending');
  const topEvent = $derived(countRows(person?.eventCounts ?? {}, 1)[0]?.label ?? 'Event pending');
  const topSignal = $derived(
    [...countRows(person?.knownObjects ?? {}, 1), ...countRows(person?.knownActions ?? {}, 1)][0]?.label ??
      'Signals pending',
  );
  const archiveProvenanceRows = $derived(countRows(person?.packCounts ?? {}, 4));
  const featureAsset = $derived(person?.featureFace ? resolvedAssets[person.featureFace.filename] : undefined);
  const needsCheckCount = $derived(
    person?.photos.filter((photo) => unresolvedFaceCount(photo) > 0 || photo.faceOverlays.length === 0).length ?? 0,
  );
  const signalRows = $derived([
    ...countRows(person?.knownObjects ?? {}, 8),
    ...countRows(person?.knownActions ?? {}, 16),
  ]);
  const rejectedFaceCandidate = (photo: CimmichPersonPhoto, faceId: string, name: string) =>
    (photo.evidence.faceEditLog ?? []).some(
      (event) => event.action === 'reject_name_candidate' && event.faceId === faceId && sameName(event.name, name),
    );

  const faceConfirmationCandidates = $derived.by<FaceConfirmationCandidate[]>(() => {
    if (!person) {
      return [];
    }

    const candidates: FaceConfirmationCandidate[] = [];
    for (const photo of person.photos) {
      const proposedName = person.name;
      const isSourceTagged = nameInList(photo.evidence.summary?.sourcePeople, proposedName);
      const isCandidateTagged =
        nameInList(photo.evidence.summary?.candidatePeople, proposedName) ||
        nameInList(photo.evidence.summary?.strongCandidatePeople, proposedName);
      if (!isCandidateTagged) {
        continue;
      }

      const alreadyNamed = (photo.evidence.faceOverlays ?? []).some(
        (face) => face.status === 'named' && sameName(face.name, proposedName),
      );
      if (alreadyNamed) {
        continue;
      }

      const openFaces = (photo.evidence.faceOverlays ?? [])
        .filter((face) => face.status === 'untagged' || face.status === 'sidecar_only')
        .sort((a, b) => a.bbox.x1 - b.bbox.x1 || a.bbox.y1 - b.bbox.y1);

      for (const face of openFaces) {
        if (rejectedFaceCandidate(photo, face.id, proposedName)) {
          continue;
        }
        candidates.push({
          asset: resolvedAssets[photo.filename],
          evidenceKind: isSourceTagged ? 'source' : 'candidate',
          face,
          filename: photo.filename,
          id: `${photo.filename}:${face.id}:${proposedName}`,
          mediaId: photo.mediaId,
          photo,
          proposedName,
        });
      }
    }

    return candidates;
  });

  const faceCropStyle = (
    asset: CimmichResolvedAsset | undefined,
    featureFace: CimmichPersonFeatureFace | undefined,
  ) => {
    if (!asset) {
      return featureFace?.cropUrl
        ? `background-image: url("${featureFace.cropUrl}"); background-size: cover; background-position: center;`
        : '';
    }
    if (!featureFace?.image) {
      return `background-image: url("${asset.thumbnailUrl}"); background-size: cover; background-position: center;`;
    }

    const imageWidth = featureFace.image.width || 1;
    const imageHeight = featureFace.image.height || 1;
    const boxWidth = Math.max(1, featureFace.bbox.x2 - featureFace.bbox.x1);
    const boxHeight = Math.max(1, featureFace.bbox.y2 - featureFace.bbox.y1);
    const sizeX = (imageWidth / boxWidth) * 100;
    const sizeY = (imageHeight / boxHeight) * 100;
    const positionX = clampPercent((featureFace.bbox.x1 / Math.max(1, imageWidth - boxWidth)) * 100);
    const positionY = clampPercent((featureFace.bbox.y1 / Math.max(1, imageHeight - boxHeight)) * 100);

    return [
      `background-image: url("${asset.previewUrl}")`,
      `background-size: ${sizeX}% ${sizeY}%`,
      `background-position: ${positionX}% ${positionY}%`,
    ].join('; ');
  };

  const faceOverlayCropStyle = (asset: CimmichResolvedAsset | undefined, face: CimmichFaceOverlay | undefined) => {
    if (!asset) {
      return '';
    }
    if (!face?.image) {
      return `background-image: url("${asset.thumbnailUrl}"); background-size: cover; background-position: center;`;
    }

    const imageWidth = face.image.width || 1;
    const imageHeight = face.image.height || 1;
    const boxWidth = Math.max(1, face.bbox.x2 - face.bbox.x1);
    const boxHeight = Math.max(1, face.bbox.y2 - face.bbox.y1);
    const sizeX = (imageWidth / boxWidth) * 100;
    const sizeY = (imageHeight / boxHeight) * 100;
    const positionX = clampPercent((face.bbox.x1 / Math.max(1, imageWidth - boxWidth)) * 100);
    const positionY = clampPercent((face.bbox.y1 / Math.max(1, imageHeight - boxHeight)) * 100);

    return [
      `background-image: url("${asset.previewUrl}")`,
      `background-size: ${sizeX}% ${sizeY}%`,
      `background-position: ${positionX}% ${positionY}%`,
    ].join('; ');
  };

  const cimmichPersonCropStyle = (row: CimmichPerson) => {
    if (!row.sourceAssetId || row.box_x === null || row.box_y === null || row.box_w === null || row.box_h === null) {
      return '';
    }
    return cimmichSquareCropBackgroundStyle({
      boxH: row.box_h,
      boxW: row.box_w,
      boxX: row.box_x,
      boxY: row.box_y,
      height: row.height ?? 0,
      padding: 1.15,
      url: getAssetMediaUrl({ id: row.sourceAssetId, size: AssetMediaSize.Preview }),
      width: row.width ?? 0,
    });
  };

  const cimmichPersonHeroStyle = (row: CimmichPerson) => {
    if (!row.sourceAssetId) {
      return '';
    }
    const centerX = row.box_x === null || row.box_w === null ? 50 : clampPercent((row.box_x + row.box_w / 2) * 100);
    const centerY = row.box_y === null || row.box_h === null ? 42 : clampPercent((row.box_y + row.box_h / 2) * 100);
    return [
      `background-image: url("${getAssetMediaUrl({ id: row.sourceAssetId, size: AssetMediaSize.Preview })}")`,
      'background-size: cover',
      `background-position: ${centerX}% ${centerY}%`,
    ].join('; ');
  };

  const cimmichObservationCrop = (face: CimmichIdentityFace, kind: 'body' | 'face') => {
    const boxX = kind === 'body' ? face.body_box_x : face.box_x;
    const boxY = kind === 'body' ? face.body_box_y : face.box_y;
    const boxW = kind === 'body' ? face.body_box_w : face.box_w;
    const boxH = kind === 'body' ? face.body_box_h : face.box_h;
    if (boxX === null || boxY === null || boxW === null || boxH === null) {
      return null;
    }
    const padding = kind === 'face' ? 2.4 : 1.12;
    const cropW = Math.min(1, Math.max(boxW * padding, 0.01));
    const cropH = Math.min(1, Math.max(boxH * padding, 0.01));
    const centerX = boxX + boxW / 2;
    const centerY = boxY + boxH / 2;
    const cropX = Math.max(0, Math.min(1 - cropW, centerX - cropW / 2));
    const cropY = Math.max(0, Math.min(1 - cropH, centerY - cropH / 2));
    return { h: cropH, w: cropW, x: cropX, y: cropY };
  };

  const cimmichObservationCropStyle = (face: CimmichIdentityFace, kind: 'body' | 'face') => {
    if (!face.sourceAssetId) {
      return '';
    }
    const crop = cimmichObservationCrop(face, kind);
    if (!crop) {
      return '';
    }
    const { h: cropH, w: cropW, x: cropX, y: cropY } = crop;
    const positionX = clampPercent((cropX / Math.max(0.0001, 1 - cropW)) * 100);
    const positionY = clampPercent((cropY / Math.max(0.0001, 1 - cropH)) * 100);
    return [
      `background-image: url("${getAssetMediaUrl({ id: face.sourceAssetId, size: AssetMediaSize.Preview })}")`,
      `background-size: ${100 / cropW}% ${100 / cropH}%`,
      `background-position: ${positionX}% ${positionY}%`,
    ].join('; ');
  };

  const cimmichAuditCropStyle = (
    item:
      | Pick<CimmichIdentityAuditItem, 'box' | 'height' | 'sourceAssetId' | 'width'>
      | CimmichIdentityAuditItem['suggestedPerson']['reference'],
  ) => {
    if (!item?.sourceAssetId) {
      return '';
    }
    const crop = fitIdentityReviewCrop(item);
    const positionX = clampPercent((crop.x / Math.max(0.0001, 1 - crop.w)) * 100);
    const positionY = clampPercent((crop.y / Math.max(0.0001, 1 - crop.h)) * 100);
    return [
      `background-image: url("${getAssetMediaUrl({ id: item.sourceAssetId, size: AssetMediaSize.Preview })}")`,
      `background-size: ${100 / crop.w}% ${100 / crop.h}%`,
      `background-position: ${positionX}% ${positionY}%`,
    ].join('; ');
  };

  const cimmichPresentationImageUrl = (slot: CimmichPersonPresentation['face']) =>
    slot?.sourceAssetId ? getAssetMediaUrl({ id: slot.sourceAssetId, size: AssetMediaSize.Preview }) : '';

  const cimmichPresentationTargetAspect: Record<CimmichPersonPresentationSlot, number> = {
    body: 3 / 4,
    face: 1,
    hero: 12 / 5,
  };

  const cimmichPresentationBaseCrop = (
    slotKind: CimmichPersonPresentationSlot,
    media: CimmichPersonPresentation['face'],
  ) => {
    const sourceAspect = media?.width && media.height ? media.width / media.height : 1;
    const targetAspect = cimmichPresentationTargetAspect[slotKind];
    return sourceAspect > targetAspect
      ? { h: 1, w: targetAspect / sourceAspect }
      : { h: sourceAspect / targetAspect, w: 1 };
  };

  const cimmichPresentationFrameFromCrop = (
    slotKind: CimmichPersonPresentationSlot,
    media: CimmichPersonPresentation['face'],
  ): CimmichPresentationFrame => {
    const crop = media?.crop ?? null;
    const observationCenter =
      media?.selectionMode === 'automatic' &&
      media.observationId &&
      media.observationId === cimmichPerson?.representative_face_id &&
      cimmichPerson.box_x !== null &&
      cimmichPerson.box_y !== null &&
      cimmichPerson.box_w !== null &&
      cimmichPerson.box_h !== null
        ? {
            centerX: clampPercent((cimmichPerson.box_x + cimmichPerson.box_w / 2) * 100),
            centerY: clampPercent((cimmichPerson.box_y + cimmichPerson.box_h / 2) * 100),
          }
        : media?.selectionMode === 'automatic' &&
            media.observationId &&
            media.observationId === cimmichPerson?.bodyPreview?.bodyId &&
            cimmichPerson.bodyPreview
          ? {
              centerX: clampPercent((cimmichPerson.bodyPreview.box_x + cimmichPerson.bodyPreview.box_w / 2) * 100),
              centerY: clampPercent((cimmichPerson.bodyPreview.box_y + cimmichPerson.bodyPreview.box_h / 2) * 100),
            }
          : null;
    if (!crop) {
      return { centerX: observationCenter?.centerX ?? 50, centerY: observationCenter?.centerY ?? 50, zoom: 1 };
    }
    const base = cimmichPresentationBaseCrop(slotKind, media);
    return {
      centerX: observationCenter?.centerX ?? clampPercent((crop.x + crop.w / 2) * 100),
      centerY: observationCenter?.centerY ?? clampPercent((crop.y + crop.h / 2) * 100),
      zoom: Math.max(1, Math.min(4, Math.max(base.w / crop.w, base.h / crop.h))),
    };
  };

  const syncCimmichPresentationFrames = (presentation: CimmichPersonPresentation) => {
    cimmichPresentationFrames = {
      body: cimmichPresentationFrameFromCrop('body', presentation.body),
      face: cimmichPresentationFrameFromCrop('face', presentation.face),
      hero: cimmichPresentationFrameFromCrop('hero', presentation.hero),
    };
  };

  const cimmichPresentationCropFromFrame = (
    slotKind: CimmichPersonPresentationSlot,
    media: CimmichPersonPresentation['face'],
  ) => {
    const frame = cimmichPresentationFrames[slotKind];
    const base = cimmichPresentationBaseCrop(slotKind, media);
    const cropW = base.w / frame.zoom;
    const cropH = base.h / frame.zoom;
    return {
      h: cropH,
      w: cropW,
      x: Math.max(0, Math.min(1 - cropW, frame.centerX / 100 - cropW / 2)),
      y: Math.max(0, Math.min(1 - cropH, frame.centerY / 100 - cropH / 2)),
    };
  };

  const cimmichPresentationImageStyle = (
    slotKind: CimmichPersonPresentationSlot,
    media: CimmichPersonPresentation['face'],
  ) => {
    if (!media) {
      return '';
    }
    const crop = cimmichPresentationCropFromFrame(slotKind, media);
    return [
      'position: absolute',
      `width: ${100 / crop.w}%`,
      'height: auto',
      'max-width: none',
      `left: ${(-crop.x / crop.w) * 100}%`,
      `top: ${(-crop.y / crop.h) * 100}%`,
    ].join('; ');
  };

  const setCimmichPresentationFrame = (
    slotKind: CimmichPersonPresentationSlot,
    field: keyof CimmichPresentationFrame,
    value: number,
  ) => {
    const boundedValue = field === 'zoom' ? Math.max(1, Math.min(4, value)) : Math.max(0, Math.min(100, value));
    cimmichPresentationFrames = {
      ...cimmichPresentationFrames,
      [slotKind]: {
        ...cimmichPresentationFrames[slotKind],
        [field]: boundedValue,
      },
    };
  };

  const adjustCimmichPresentationFrame = (
    slotKind: CimmichPersonPresentationSlot,
    delta: Partial<CimmichPresentationFrame>,
  ) => {
    const frame = cimmichPresentationFrames[slotKind];
    setCimmichPresentationFrame(slotKind, 'centerX', frame.centerX + (delta.centerX ?? 0));
    setCimmichPresentationFrame(slotKind, 'centerY', frame.centerY + (delta.centerY ?? 0));
    setCimmichPresentationFrame(slotKind, 'zoom', frame.zoom + (delta.zoom ?? 0));
  };

  const startCimmichPresentationDrag = (event: PointerEvent, slotKind: CimmichPersonPresentationSlot) => {
    const button = (event.target as HTMLElement).closest('button');
    if (button && button !== event.currentTarget) {
      return;
    }
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    cimmichPresentationDrag = {
      pointerId: event.pointerId,
      slotKind,
      x: event.clientX,
      y: event.clientY,
    };
  };

  const moveCimmichPresentationDrag = (event: PointerEvent, slotKind: CimmichPersonPresentationSlot) => {
    if (
      !cimmichPresentationDrag ||
      cimmichPresentationDrag.pointerId !== event.pointerId ||
      cimmichPresentationDrag.slotKind !== slotKind
    ) {
      return;
    }
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const frame = cimmichPresentationFrames[slotKind];
    const deltaX = event.clientX - cimmichPresentationDrag.x;
    const deltaY = event.clientY - cimmichPresentationDrag.y;
    adjustCimmichPresentationFrame(slotKind, {
      centerX: (-deltaX / Math.max(1, bounds.width) / frame.zoom) * 100,
      centerY: (-deltaY / Math.max(1, bounds.height) / frame.zoom) * 100,
    });
    cimmichPresentationDrag = {
      ...cimmichPresentationDrag,
      x: event.clientX,
      y: event.clientY,
    };
  };

  const endCimmichPresentationDrag = (event: PointerEvent) => {
    if (cimmichPresentationDrag?.pointerId === event.pointerId) {
      cimmichPresentationDrag = undefined;
    }
  };

  const zoomCimmichPresentation = (event: WheelEvent, slotKind: CimmichPersonPresentationSlot) => {
    const button = (event.target as HTMLElement).closest('button');
    if (button && button !== event.currentTarget) {
      return;
    }
    event.preventDefault();
    adjustCimmichPresentationFrame(slotKind, { zoom: event.deltaY < 0 ? 0.15 : -0.15 });
  };

  const keyCimmichPresentation = (event: KeyboardEvent, slotKind: CimmichPersonPresentationSlot) => {
    const step = event.shiftKey ? 5 : 2;
    const deltas: Record<string, Partial<CimmichPresentationFrame>> = {
      '+': { zoom: 0.1 },
      '-': { zoom: -0.1 },
      ArrowDown: { centerY: step },
      ArrowLeft: { centerX: -step },
      ArrowRight: { centerX: step },
      ArrowUp: { centerY: -step },
      '=': { zoom: 0.1 },
    };
    const delta = deltas[event.key];
    if (!delta) {
      return;
    }
    event.preventDefault();
    adjustCimmichPresentationFrame(slotKind, delta);
  };

  const machineSuggestionSelected = (faceId: string) => cimmichMachineSuggestionSelection.includes(faceId);

  const toggleCimmichAuditEvidence = (faceId: string) => {
    cimmichIdentityAuditEvidenceExpanded = cimmichIdentityAuditEvidenceExpanded.includes(faceId)
      ? cimmichIdentityAuditEvidenceExpanded.filter((id) => id !== faceId)
      : [...cimmichIdentityAuditEvidenceExpanded, faceId];
  };

  const cimmichAuditSelected = (faceId: string) => cimmichIdentityAuditSelection.includes(faceId);

  const showCandidateSelectionLimit = () => {
    toastManager.warning(
      `Maximum ${PERSON_CANDIDATE_SELECTION_LIMIT} faces. Accept or clear your current selection before choosing more.`,
    );
  };

  const toggleCimmichAuditSelection = (faceId: string, event?: MouseEvent) => {
    const item = cimmichPersonReviewItems.find((candidate) => candidate.faceId === faceId);
    const sameQueueSelection = item
      ? cimmichIdentityAuditSelection.filter((selectedFaceId) =>
          cimmichPersonReviewItems.some(
            (candidate) => candidate.faceId === selectedFaceId && candidate.kind === item.kind,
          ),
        )
      : cimmichIdentityAuditSelection;
    if (!cimmichAuditSelected(faceId) && sameQueueSelection.length >= PERSON_CANDIDATE_SELECTION_LIMIT) {
      event?.preventDefault();
      showCandidateSelectionLimit();
      cimmichIdentityAuditConfirmAction = '';
      return;
    }
    const update = togglePersonCandidateSelection(sameQueueSelection, faceId);
    cimmichIdentityAuditSelection = update.selection;
    if (update.limitReached) {
      showCandidateSelectionLimit();
    }
    cimmichIdentityAuditConfirmAction = '';
  };

  const cimmichAuditSelectionCount = (kind: CimmichIdentityAuditItem['kind']) =>
    cimmichPersonReviewItems.filter((item) => item.kind === kind && cimmichIdentityAuditSelection.includes(item.faceId))
      .length;

  const selectShownCimmichAuditItems = (kind: CimmichIdentityAuditItem['kind'], items: CimmichPersonReviewItem[]) => {
    const sectionId = `identity-audit:${kind}`;
    const update = selectPersonCandidates(
      items.slice(0, cimmichIdentitySectionLimit(sectionId)).map(({ faceId }) => faceId),
    );
    cimmichIdentityAuditSelection = update.selection;
    if (update.limitReached) {
      showCandidateSelectionLimit();
    }
    cimmichIdentityAuditConfirmAction = '';
  };

  const clearCimmichAuditSelection = () => {
    cimmichIdentityAuditSelection = [];
    cimmichIdentityAuditConfirmAction = '';
  };

  const loadCimmichIdentityAuditQueues = async (personId: string) => {
    const [untaggedAudit, contradictionAudit] = await Promise.all([
      getCimmichIdentityAuditItems('untagged_match', 0, 50, personId),
      getCimmichIdentityAuditItems('accepted_contradiction', 0, 50, personId),
    ]);
    cimmichIdentityAuditItems = [...untaggedAudit.items, ...contradictionAudit.items];
    cimmichIdentityAuditTotals = {
      accepted_contradiction: contradictionAudit.total,
      untagged_match: untaggedAudit.total,
    };
    void cimmichPhotoReview.load(cimmichIdentityAuditItems.map(({ assetId }) => assetId));
  };

  const showMoreCimmichIdentityAudit = async (
    kind: CimmichIdentityAuditItem['kind'],
    loadedItems: CimmichPersonReviewItem[],
  ) => {
    if (!cimmichPerson || cimmichIdentityAuditLoadingKind) {
      return;
    }
    const sectionId = `identity-audit:${kind}`;
    const nextLimit = cimmichIdentitySectionLimit(sectionId) + cimmichIdentitySectionBatchSize(sectionId);
    const loadedAuditCount = cimmichIdentityAuditItems.filter((item) => item.kind === kind).length;
    const auditTotal = cimmichIdentityAuditTotals[kind];
    if (nextLimit > loadedItems.length && loadedAuditCount < auditTotal) {
      cimmichIdentityAuditLoadingKind = kind;
      try {
        const page = await getCimmichIdentityAuditItems(
          kind,
          loadedAuditCount,
          Math.min(50, auditTotal - loadedAuditCount),
          cimmichPerson.person_id,
        );
        const seen = new Set(cimmichIdentityAuditItems.map((item) => `${item.kind}:${item.faceId}`));
        cimmichIdentityAuditItems = [
          ...cimmichIdentityAuditItems,
          ...page.items.filter((item) => !seen.has(`${item.kind}:${item.faceId}`)),
        ];
        void cimmichPhotoReview.load(page.items.map(({ assetId }) => assetId));
        cimmichIdentityAuditTotals = { ...cimmichIdentityAuditTotals, [kind]: page.total };
      } catch (error) {
        cimmichIdentityError = error instanceof Error ? error.message : 'Unable to load more identity checks';
        return;
      } finally {
        cimmichIdentityAuditLoadingKind = '';
      }
    }
    cimmichIdentitySectionLimits = {
      ...cimmichIdentitySectionLimits,
      [sectionId]: nextLimit,
    };
  };

  const toggleMachineSuggestion = (faceId: string) => {
    cimmichMachineSuggestionSelection = machineSuggestionSelected(faceId)
      ? cimmichMachineSuggestionSelection.filter((id) => id !== faceId)
      : [...cimmichMachineSuggestionSelection, faceId];
    cimmichMachineSuggestionConfirm = false;
  };

  const selectAllMachineSuggestions = () => {
    cimmichMachineSuggestionSelection = visibleCimmichMachineSuggestions.map((suggestion) => suggestion.face_id);
    cimmichMachineSuggestionConfirm = false;
  };

  const resetCimmichAssetsPagination = async (personId: string, generation = personProjectionGeneration) => {
    const page = await getCimmichPersonAssetsPage(personId, 120);
    if (generation !== personProjectionGeneration) {
      return;
    }
    cimmichAssets = page.items;
    cimmichAssetsNextCursor = page.nextCursor;
  };

  const cimmichPhotoSelected = (assetId: string) => cimmichSelectedPhotoIds.includes(assetId);

  const toggleCimmichPhotoSelection = (assetId: string) => {
    if (cimmichPhotoSelected(assetId)) {
      cimmichSelectedPhotoIds = cimmichSelectedPhotoIds.filter((id) => id !== assetId);
      return;
    }
    if (cimmichSelectedPhotoIds.length >= ENTITY_MEDIA_SELECTION_LIMIT) {
      toastManager.warning(`Maximum ${ENTITY_MEDIA_SELECTION_LIMIT} photos. Apply or clear this selection first.`);
      return;
    }
    cimmichSelectedPhotoIds = [...cimmichSelectedPhotoIds, assetId];
  };

  const selectShownCimmichPhotos = () => {
    const shown = visibleCimmichAssets.filter((asset) => Boolean(asset.sourceAssetId));
    cimmichSelectedPhotoIds = shown.slice(0, ENTITY_MEDIA_SELECTION_LIMIT).map(({ asset_id }) => asset_id);
    if (shown.length > ENTITY_MEDIA_SELECTION_LIMIT) {
      toastManager.warning(`Maximum ${ENTITY_MEDIA_SELECTION_LIMIT} photos selected. Apply these before continuing.`);
    }
  };

  const refreshCimmichPersonMedia = async () => {
    if (cimmichPerson) {
      await resetCimmichAssetsPagination(cimmichPerson.person_id);
    }
  };

  const loadMoreCimmichAssets = async () => {
    if (!cimmichPerson || !cimmichAssetsNextCursor || cimmichAssetsLoadingMore) {
      return;
    }
    const personId = cimmichPerson.person_id;
    const generation = personProjectionGeneration;
    const cursor = cimmichAssetsNextCursor;
    cimmichAssetsLoadingMore = true;
    cimmichLoadError = '';
    try {
      const page = await getCimmichPersonAssetsPage(personId, 120, cursor);
      if (generation !== personProjectionGeneration) {
        return;
      }
      const seen = new Set(cimmichAssets.map(({ asset_id }) => asset_id));
      cimmichAssets = [...cimmichAssets, ...page.items.filter(({ asset_id }) => !seen.has(asset_id))];
      cimmichAssetsNextCursor = page.nextCursor;
    } catch (error) {
      if (error instanceof CimmichServiceError && error.code === 'PERSON_PAGE_CURSOR_INVALID') {
        await resetCimmichAssetsPagination(personId);
        cimmichLoadError = 'Viewing mode changed. Photos restarted from the first page.';
      } else {
        cimmichLoadError = error instanceof Error ? error.message : 'Unable to load more photos';
      }
    } finally {
      cimmichAssetsLoadingMore = false;
    }
  };

  const loadMoreCimmichIdentityFaces = async () => {
    if (!cimmichPerson || !cimmichIdentityNextCursor || cimmichIdentityFacesLoadingMore) {
      return;
    }
    const personId = cimmichPerson.person_id;
    const generation = personProjectionGeneration;
    const cursor = cimmichIdentityNextCursor;
    cimmichIdentityFacesLoadingMore = true;
    cimmichIdentityError = '';
    try {
      const page = await getCimmichIdentityFacesPage(personId, 120, cursor);
      if (generation !== personProjectionGeneration) {
        return;
      }
      const seen = new Set(cimmichIdentityFaces.map(({ face_id }) => face_id));
      cimmichIdentityFaces = [...cimmichIdentityFaces, ...page.items.filter(({ face_id }) => !seen.has(face_id))];
      cimmichIdentityFaceSummary = page.summary;
      cimmichIdentityNextCursor = page.nextCursor;
    } catch (error) {
      if (error instanceof CimmichServiceError && error.code === 'PERSON_PAGE_CURSOR_INVALID') {
        const page = await getCimmichIdentityFacesPage(personId, 120);
        if (generation === personProjectionGeneration) {
          cimmichIdentityFaces = page.items;
          cimmichIdentityFaceSummary = page.summary;
          cimmichIdentityNextCursor = page.nextCursor;
          cimmichIdentityError = 'Identity evidence changed. Loaded the latest results.';
        }
      } else {
        cimmichIdentityError = error instanceof Error ? error.message : 'Unable to load more identity evidence';
      }
    } finally {
      if (generation === personProjectionGeneration) {
        cimmichIdentityFacesLoadingMore = false;
      }
    }
  };

  const confirmSelectedMachineSuggestions = async () => {
    if (!cimmichPerson || cimmichMachineSuggestionSelection.length === 0) {
      return;
    }
    if (!cimmichMachineSuggestionConfirm) {
      cimmichMachineSuggestionConfirm = true;
      return;
    }
    const generation = personProjectionGeneration;
    const personId = cimmichPerson.person_id;
    const selectedFaceIds = [...cimmichMachineSuggestionSelection];
    cimmichMachineSuggestionSaving = true;
    try {
      const batch = await setCimmichFaceIdentitiesBatch(selectedFaceIds.map((faceId) => ({ faceId, personId })));
      if (batch.failureCount > 0) {
        throw new Error(
          `${batch.failureCount} ${batch.failureCount === 1 ? 'match' : 'matches'} could not be confirmed: ${batch.failures[0].error}`,
        );
      }
      const [machineSuggestions, candidates, assetsPage, people] = await Promise.all([
        getCimmichMachineSuggestions(80, personId),
        getCimmichPersonCandidates(personId),
        getCimmichPersonAssetsPage(personId, 120),
        getCimmichPeople(500),
      ]);
      if (generation !== personProjectionGeneration) {
        return;
      }
      cimmichMachineSuggestions = machineSuggestions;
      cimmichCandidates = candidates;
      cimmichAssets = assetsPage.items;
      cimmichAssetsNextCursor = assetsPage.nextCursor;
      cimmichMachineSuggestionSelection = [];
      cimmichMachineSuggestionConfirm = false;
      cimmichIdentityLoaded = false;
      cimmichIdentityFaces = [];
      cimmichIdentityFaceSummary = { all: 0, head: 0, lowQuality: 0, prime: 0, secondary: 0 };
      cimmichIdentityNextCursor = null;
      cimmichHoldingMatches = {};
      cimmichHoldingMatchesLoading = {};
      const refreshed = people.find((row) => row.person_id === personId);
      if (refreshed) {
        cimmichPerson = refreshed;
      }
      await openCimmichIdentity(generation);
      cimmichIdentityFilter = 'candidates';
    } catch (error) {
      // Keep the selection so the operator can retry; a silent stop here left
      // no trace that the batch never saved.
      cimmichMachineSuggestionConfirm = false;
      cimmichIdentityError = error instanceof Error ? error.message : 'Unable to confirm the selected suggestions';
    } finally {
      if (generation === personProjectionGeneration) {
        cimmichMachineSuggestionSaving = false;
      }
    }
  };

  const retainCimmichCollisionAsset = (item: CimmichPersonReviewItem) => {
    if (
      cimmichSamePhotoCollisionGroups.some(
        ({ assetId, items }) => assetId === item.assetId && items.some(({ faceId }) => faceId === item.faceId),
      ) &&
      !cimmichIdentityCollisionAssetIds.includes(item.assetId)
    ) {
      cimmichIdentityCollisionAssetIds = [...cimmichIdentityCollisionAssetIds, item.assetId];
    }
  };

  const finishCimmichAuditDecision = (item: CimmichPersonReviewItem) => {
    if (!cimmichPerson) {
      return;
    }
    retainCimmichCollisionAsset(item);
    const wasAuditItem = cimmichIdentityAuditItems.some(
      ({ faceId, kind }) => faceId === item.faceId && kind === item.kind,
    );
    cimmichIdentityAuditItems = cimmichIdentityAuditItems.filter(({ faceId }) => faceId !== item.faceId);
    if (wasAuditItem) {
      cimmichIdentityAuditTotals = {
        ...cimmichIdentityAuditTotals,
        [item.kind]: Math.max(0, cimmichIdentityAuditTotals[item.kind] - 1),
      };
    }
    if (item.candidateClaimId) {
      cimmichCandidates = cimmichCandidates.filter(
        ({ identity_claim_id }) => identity_claim_id !== item.candidateClaimId,
      );
    }
    cimmichIdentityAuditSelection = cimmichIdentityAuditSelection.filter((faceId) => faceId !== item.faceId);
    cimmichIdentityAuditCorrection.finish(item);
    void Promise.all([
      refreshCimmichIdentityAfterReview(),
      loadCimmichIdentityAuditQueues(cimmichPerson.person_id),
    ]).catch((error) => {
      cimmichIdentityError =
        error instanceof Error ? error.message : 'Saved the decision, but could not refresh the review queue';
    });
  };

  const confirmCimmichAuditPerson = async (item: CimmichPersonReviewItem) => {
    if (!cimmichPerson || cimmichIdentityAuditSavingId) {
      return;
    }
    const personId = cimmichPerson.person_id;
    const personName = cimmichPerson.display_name;
    cimmichIdentityAuditSavingId = `confirm:${item.faceId}`;
    cimmichIdentityError = '';
    cimmichIdentityMessage = '';
    try {
      await (item.candidateClaimId
        ? decideCimmichIdentityCandidate(item.candidateClaimId, 'accept')
        : item.assignedPerson?.personId === personId
          ? dismissCimmichIdentityAuditItem(item.kind, item.faceId)
          : acceptCimmichMachineSuggestion(item.faceId, personId));
      cimmichIdentityMessage = `Confirmed this face as ${personName}.`;
      finishCimmichAuditDecision(item);
    } catch (error) {
      cimmichIdentityError = error instanceof Error ? error.message : 'Unable to save this identity decision';
    } finally {
      cimmichIdentityAuditSavingId = '';
    }
  };

  const changeCimmichAuditPerson = async (item: CimmichPersonReviewItem) => {
    if (!cimmichPerson || cimmichIdentityAuditSavingId) {
      return;
    }
    const { targetPersonId, target } = cimmichIdentityAuditCorrection.decision(item);
    if (!targetPersonId || !target) {
      cimmichIdentityError = 'Choose one of the closest People before changing this identity.';
      return;
    }
    cimmichIdentityAuditSavingId = `change:${item.faceId}`;
    cimmichIdentityError = '';
    cimmichIdentityMessage = '';
    try {
      if (item.candidateClaimId) {
        if (targetPersonId === item.suggestedPerson.personId) {
          await decideCimmichIdentityCandidate(item.candidateClaimId, 'accept');
        } else if (item.assignedPerson?.personId === targetPersonId) {
          await decideCimmichIdentityCandidate(item.candidateClaimId, 'reject');
        } else {
          await acceptCimmichMachineSuggestion(item.faceId, targetPersonId);
          await decideCimmichIdentityCandidate(item.candidateClaimId, 'reject');
        }
      } else {
        await (item.assignedPerson?.personId === targetPersonId
          ? dismissCimmichIdentityAuditItem(item.kind, item.faceId)
          : acceptCimmichMachineSuggestion(item.faceId, targetPersonId));
      }
      cimmichIdentityMessage =
        targetPersonId === item.assignedPerson?.personId
          ? `Left this face as ${target.display_name}.`
          : `Changed this face to ${target.display_name}.`;
      finishCimmichAuditDecision(item);
    } catch (error) {
      cimmichIdentityError = error instanceof Error ? error.message : 'Unable to change this identity';
    } finally {
      cimmichIdentityAuditSavingId = '';
    }
  };

  const deferCimmichAuditBoxFix = async (item: CimmichPersonReviewItem) => {
    if (cimmichIdentityAuditSavingId) {
      return;
    }
    cimmichIdentityAuditSavingId = `fix-box:${item.faceId}`;
    cimmichIdentityError = '';
    cimmichIdentityMessage = '';
    try {
      await setCimmichFaceReviewDisposition(
        item.faceId,
        'later',
        createCimmichIdentityCorrectionCommandId('collision-fix-box-later'),
        'geometry',
      );
      cimmichIdentityMessage = 'Saved this Face in Box fixes.';
      finishCimmichAuditDecision(item);
    } catch (error) {
      cimmichIdentityError = error instanceof Error ? error.message : 'Unable to save this Face for a box fix';
    } finally {
      cimmichIdentityAuditSavingId = '';
    }
  };

  const markCimmichAuditFaceNotFace = async (item: CimmichPersonReviewItem) => {
    if (cimmichIdentityAuditSavingId) {
      return;
    }
    if (typeof item.currentRevision !== 'number') {
      cimmichIdentityError = 'Reload this review before marking the region as not a Face.';
      return;
    }
    cimmichIdentityAuditSavingId = `not-face:${item.faceId}`;
    cimmichIdentityError = '';
    cimmichIdentityMessage = '';
    try {
      await markCimmichFaceNotFace(item.faceId, {
        commandId: createCimmichObservationCorrectionCommandId('collision-not-face'),
        expectedDecisionId: item.currentDecisionId ?? null,
        expectedRevision: item.currentRevision,
      });
      cimmichIdentityMessage = 'Marked this region as not a Face.';
      finishCimmichAuditDecision(item);
    } catch (error) {
      cimmichIdentityError = error instanceof Error ? error.message : 'Unable to mark this region as not a Face';
    } finally {
      cimmichIdentityAuditSavingId = '';
    }
  };

  const decideSelectedCimmichAuditItems = async (
    kind: CimmichIdentityAuditItem['kind'],
    action: 'accept' | 'dismiss',
  ) => {
    const selectedItems = cimmichPersonReviewItems.filter(
      (item) => item.kind === kind && cimmichIdentityAuditSelection.includes(item.faceId),
    );
    if (!cimmichPerson || selectedItems.length === 0 || cimmichIdentityAuditSavingId) {
      return;
    }
    if (cimmichIdentityAuditConfirmAction !== action) {
      cimmichIdentityAuditConfirmAction = action;
      return;
    }
    cimmichIdentityAuditConfirmAction = '';
    cimmichIdentityAuditSavingId = `bulk:${action}`;
    cimmichIdentityAuditProgress = { completed: 0, total: selectedItems.length };
    cimmichIdentityError = '';
    cimmichIdentityMessage = '';
    const completedFaceIds: string[] = [];
    try {
      const candidateItems = selectedItems.filter(
        (item): item is CimmichPersonReviewItem & { candidateClaimId: string } => Boolean(item.candidateClaimId),
      );
      const auditItems = selectedItems.filter((item) => !item.candidateClaimId);

      if (action === 'accept' && candidateItems.length > 0) {
        await bulkAcceptCimmichPersonCandidates(
          cimmichPerson.person_id,
          candidateItems.map((item) => item.candidateClaimId),
        );
        completedFaceIds.push(...candidateItems.map((item) => item.faceId));
        cimmichIdentityAuditProgress = {
          completed: completedFaceIds.length,
          total: selectedItems.length,
        };
      }

      const remainingItems = action === 'accept' ? auditItems : selectedItems;
      if (action === 'accept' && remainingItems.length > 0) {
        const batch = await setCimmichFaceIdentitiesBatch(
          remainingItems.map((item) => ({ faceId: item.faceId, personId: item.suggestedPerson.personId })),
        );
        completedFaceIds.push(...batch.assigned.map((result) => result.faceId));
        cimmichIdentityAuditProgress = {
          completed: completedFaceIds.length,
          total: selectedItems.length,
        };
        if (batch.failureCount > 0) {
          throw new Error(
            `${batch.failureCount} ${batch.failureCount === 1 ? 'match' : 'matches'} could not be confirmed: ${batch.failures[0].error}`,
          );
        }
      } else if (action === 'dismiss') {
        const candidateRejectItems = remainingItems.filter(
          (item): item is CimmichPersonReviewItem & { candidateClaimId: string } => Boolean(item.candidateClaimId),
        );
        const dismissItems = remainingItems.filter((item) => !item.candidateClaimId);
        if (candidateRejectItems.length > 0) {
          await bulkRejectCimmichPersonCandidates(
            cimmichPerson.person_id,
            candidateRejectItems.map((item) => item.candidateClaimId),
          );
          completedFaceIds.push(...candidateRejectItems.map((item) => item.faceId));
          cimmichIdentityAuditProgress = {
            completed: completedFaceIds.length,
            total: selectedItems.length,
          };
        }
        if (dismissItems.length > 0) {
          await dismissCimmichIdentityAuditItemsBatch(
            dismissItems.map((item) => ({ faceId: item.faceId, kind: item.kind })),
          );
          completedFaceIds.push(...dismissItems.map((item) => item.faceId));
          cimmichIdentityAuditProgress = {
            completed: completedFaceIds.length,
            total: selectedItems.length,
          };
        }
      }
      cimmichIdentityMessage =
        action === 'accept'
          ? `${completedFaceIds.length} selected ${completedFaceIds.length === 1 ? 'match' : 'matches'} confirmed.`
          : `${completedFaceIds.length} selected ${completedFaceIds.length === 1 ? 'suggestion' : 'suggestions'} dismissed.`;
      if (action === 'accept') {
        await refreshCimmichIdentityAfterReview();
      }
    } catch (error) {
      cimmichIdentityError =
        error instanceof Error ? error.message : 'Unable to finish the selected identity decisions';
    } finally {
      if (completedFaceIds.length > 0) {
        try {
          const [candidates] = await Promise.all([
            getCimmichPersonCandidates(cimmichPerson.person_id),
            loadCimmichIdentityAuditQueues(cimmichPerson.person_id),
          ]);
          cimmichCandidates = candidates;
        } catch (error) {
          cimmichIdentityError ||= error instanceof Error ? error.message : 'Unable to refresh identity checks';
        }
      }
      cimmichIdentityAuditSelection = cimmichIdentityAuditSelection.filter(
        (faceId) => !completedFaceIds.includes(faceId),
      );
      cimmichIdentityAuditConfirmAction = '';
      cimmichIdentityAuditProgress = { completed: 0, total: 0 };
      cimmichIdentityAuditSavingId = '';
    }
  };

  const refreshCimmichIdentityAfterReview = async () => {
    if (!cimmichPerson) {
      return;
    }
    const generation = personProjectionGeneration;
    const [page, row] = await Promise.all([
      getCimmichIdentityFacesPage(cimmichPerson.person_id, 120),
      getCimmichPersonByName(data.personName, data.personId),
    ]);
    if (generation !== personProjectionGeneration) {
      return;
    }
    cimmichIdentityFaces = page.items;
    cimmichIdentityFaceSummary = page.summary;
    cimmichIdentityNextCursor = page.nextCursor;
    cimmichIdentityLoaded = true;
    if (row) {
      cimmichPerson = row;
    }
  };

  const refreshCimmichIdentity = async () => {
    if (!cimmichPerson) {
      return;
    }
    const generation = personProjectionGeneration;
    const [page, row, corrections] = await Promise.all([
      getCimmichIdentityFacesPage(cimmichPerson.person_id, 24),
      getCimmichPersonByName(data.personName, data.personId),
      getCimmichIdentityCorrectionDiscovery({ personId: cimmichPerson.person_id }, { limit: 12 }),
    ]);
    if (generation !== personProjectionGeneration) {
      return;
    }
    cimmichIdentityFaces = page.items;
    cimmichIdentityFaceSummary = page.summary;
    cimmichIdentityNextCursor = page.nextCursor;
    cimmichIdentityLoaded = true;
    cimmichIdentityCorrections = corrections.items;
    cimmichIdentityUndoDecisionId = corrections.items.find((item) => item.undo.eligible)?.undo.decisionId ?? '';
    if (row) {
      cimmichPerson = row;
    }
    cimmichHoldingMatches = {};
    cimmichHoldingMatchesLoading = {};
    if (row?.needs_holding) {
      void loadCimmichHoldingMatches(page.items);
    }
  };

  const loadCimmichHoldingMatch = async (face: CimmichIdentityFace) => {
    const generation = personProjectionGeneration;
    if (cimmichHoldingMatchesLoading[face.face_id]) {
      return;
    }
    cimmichHoldingMatchesLoading = { ...cimmichHoldingMatchesLoading, [face.face_id]: true };
    try {
      const [match] = await getCimmichFaceMatches(face.face_id, 1);
      if (generation !== personProjectionGeneration) {
        return;
      }
      cimmichHoldingMatches = { ...cimmichHoldingMatches, [face.face_id]: match };
    } catch {
      if (generation !== personProjectionGeneration) {
        return;
      }
      cimmichHoldingMatches = { ...cimmichHoldingMatches, [face.face_id]: undefined };
    } finally {
      if (generation === personProjectionGeneration) {
        cimmichHoldingMatchesLoading = { ...cimmichHoldingMatchesLoading, [face.face_id]: false };
      }
    }
  };

  const loadCimmichHoldingMatches = async (faces: CimmichIdentityFace[]) => {
    const generation = personProjectionGeneration;
    if (!cimmichPerson) {
      return;
    }
    const faceIds = [...new Set(faces.map(({ face_id }) => face_id))].slice(0, 24);
    if (faceIds.length === 0) {
      return;
    }
    cimmichHoldingMatchesLoading = {
      ...cimmichHoldingMatchesLoading,
      ...Object.fromEntries(faceIds.map((faceId) => [faceId, true])),
    };
    try {
      const result = await getCimmichHoldingMatchesBatch(cimmichPerson.person_id, faceIds);
      if (generation !== personProjectionGeneration) {
        return;
      }
      cimmichHoldingMatches = {
        ...cimmichHoldingMatches,
        ...Object.fromEntries(result.items.map(({ faceId, matches }) => [faceId, matches[0]])),
      };
    } catch {
      if (generation !== personProjectionGeneration) {
        return;
      }
      cimmichHoldingMatches = {
        ...cimmichHoldingMatches,
        ...Object.fromEntries(faceIds.map((faceId) => [faceId, undefined])),
      };
    } finally {
      if (generation === personProjectionGeneration) {
        cimmichHoldingMatchesLoading = {
          ...cimmichHoldingMatchesLoading,
          ...Object.fromEntries(faceIds.map((faceId) => [faceId, false])),
        };
      }
    }
  };

  const openCimmichIdentity = async (generation = personProjectionGeneration) => {
    cimmichMode = 'identity';
    if (!cimmichPerson || cimmichIdentityLoaded || cimmichIdentityLoading) {
      return;
    }
    cimmichIdentityLoading = true;
    cimmichIdentityError = '';
    try {
      const personId = cimmichPerson.person_id;
      const [facesPage, assetsPage, candidates, presentation, untaggedAudit, contradictionAudit] = await Promise.all([
        getCimmichIdentityFacesPage(personId, 120),
        getCimmichPersonAssetsPage(personId, 120),
        getCimmichPersonCandidates(personId),
        getCimmichPersonPresentation(personId),
        getCimmichIdentityAuditItems('untagged_match', 0, 50, personId),
        getCimmichIdentityAuditItems('accepted_contradiction', 0, 50, personId),
      ]);
      const machineSuggestions =
        untaggedAudit.run?.state === 'completed' ? [] : await getCimmichMachineSuggestions(80, personId);
      if (generation !== personProjectionGeneration) {
        return;
      }
      cimmichIdentityFaces = facesPage.items;
      cimmichIdentityFaceSummary = facesPage.summary;
      cimmichIdentityNextCursor = facesPage.nextCursor;
      cimmichIdentityLoaded = true;
      cimmichAssets = assetsPage.items;
      cimmichAssetsNextCursor = assetsPage.nextCursor;
      cimmichCandidates = candidates;
      cimmichMachineSuggestions = machineSuggestions;
      cimmichIdentityAuditItems = [...untaggedAudit.items, ...contradictionAudit.items];
      cimmichIdentityAuditTotals = {
        accepted_contradiction: contradictionAudit.total,
        untagged_match: untaggedAudit.total,
      };
      cimmichIdentityAuditEvidenceExpanded = [];
      cimmichIdentityAuditSelection = [];
      cimmichIdentityAuditConfirmAction = '';
      void cimmichPhotoReview.load([
        ...untaggedAudit.items.map(({ assetId }) => assetId),
        ...contradictionAudit.items.map(({ assetId }) => assetId),
        ...machineSuggestions.map(({ asset_id }) => asset_id),
        ...candidates.map(({ asset_id }) => asset_id),
      ]);
      cimmichIdentityAuditCorrection.reset();
      cimmichIdentityCollisionAssetIds = [];
      cimmichMachineSuggestionSelection = [];
      cimmichMachineSuggestionConfirm = false;
      cimmichPresentation = presentation;
      syncCimmichPresentationFrames(presentation);
      cimmichIdentitySectionLimits = {};
      cimmichIdentityFilter = 'prime';
      if (cimmichPerson.needs_holding) {
        cimmichHoldingMatches = {};
        void loadCimmichHoldingMatches(cimmichIdentityFaces);
      }
    } catch (error) {
      if (generation === personProjectionGeneration) {
        cimmichIdentityError = error instanceof Error ? error.message : 'Unable to load identity photos';
      }
    } finally {
      if (generation === personProjectionGeneration) {
        cimmichIdentityLoading = false;
      }
    }
  };

  const openCimmichDisplay = async () => {
    await openCimmichIdentity();
    cimmichIdentityFilter = 'presentation';
    cimmichPresentationPickerSlot = '';
    requestAnimationFrame(() =>
      document.querySelector('#cimmich-identity-workspace')?.scrollIntoView({
        behavior: mediaQueryManager.reducedMotion ? 'auto' : 'smooth',
        block: 'start',
      }),
    );
  };

  const refreshCimmichSetup = async () => {
    if (!cimmichPerson) {
      return;
    }
    const personId = cimmichPerson.person_id;
    const [setup, people, assetsPage] = await Promise.all([
      getCimmichPersonSetup(personId),
      getCimmichPeople(500),
      getCimmichPersonAssetsPage(personId, 120),
    ]);
    cimmichSetup = setup;
    cimmichSetupPeople = people;
    cimmichAssets = assetsPage.items;
    cimmichAssetsNextCursor = assetsPage.nextCursor;
    cimmichIdentityLoaded = false;
    cimmichIdentityLoading = false;
    cimmichIdentityFaces = [];
    cimmichIdentityFaceSummary = { all: 0, head: 0, lowQuality: 0, prime: 0, secondary: 0 };
    cimmichIdentityNextCursor = null;
    cimmichMachineSuggestions = [];
    cimmichIdentityAuditItems = [];
    cimmichIdentityAuditTotals = { accepted_contradiction: 0, untagged_match: 0 };
    cimmichIdentityAuditLoadingKind = '';
    cimmichIdentityAuditEvidenceExpanded = [];
    cimmichIdentityAuditSelection = [];
    cimmichIdentityAuditConfirmAction = '';
    cimmichIdentityAuditCorrection.reset();
    cimmichIdentityCollisionAssetIds = [];
    cimmichIdentityAuditSavingId = '';
    cimmichMachineSuggestionSelection = [];
    cimmichMachineSuggestionConfirm = false;
    cimmichMachineSuggestionSaving = false;
    cimmichHoldingMatches = {};
    cimmichHoldingMatchesLoading = {};
    if (cimmichPerson.subject_kind === 'person') {
      cimmichProfile = await getCimmichPersonProfile(personId);
    }
    const refreshed = people.find((row) => row.person_id === personId);
    if (refreshed) {
      cimmichPerson = refreshed;
    }
  };

  const openCimmichSetup = async () => {
    cimmichMode = 'setup';
    cimmichSetupError = '';
    cimmichSetupMergePersonId = '';
    cimmichSetupMergeQuery = '';
    cimmichSetupMergePreview = undefined;
    cimmichSetupMergeIntents.clearMerge();
    cimmichSetupSubjectConfirm = undefined;
    if (cimmichSetupLoading || !cimmichPerson) {
      return;
    }
    cimmichSetupLoading = true;
    try {
      await refreshCimmichSetup();
    } catch (error) {
      cimmichSetupError = error instanceof Error ? error.message : 'Unable to load identity setup';
    } finally {
      cimmichSetupLoading = false;
    }
  };

  const openCimmichDetails = () => {
    cimmichMode = 'details';
  };

  const addSetupAlias = async () => {
    if (!cimmichPerson || !cimmichSetupAliasDraft.trim()) {
      return;
    }
    cimmichSetupSaving = 'alias:add';
    cimmichSetupError = '';
    try {
      await addCimmichPersonAlias(cimmichPerson.person_id, cimmichSetupAliasDraft, cimmichSetupAliasKind);
      cimmichSetupAliasDraft = '';
      await refreshCimmichSetup();
    } catch (error) {
      cimmichSetupError = error instanceof Error ? error.message : 'Unable to add name';
    } finally {
      cimmichSetupSaving = '';
    }
  };

  const removeSetupAlias = async (aliasId: string) => {
    if (!cimmichPerson) {
      return;
    }
    cimmichSetupSaving = `alias:${aliasId}`;
    cimmichSetupError = '';
    try {
      await removeCimmichPersonAlias(cimmichPerson.person_id, aliasId);
      await refreshCimmichSetup();
    } catch (error) {
      cimmichSetupError = error instanceof Error ? error.message : 'Unable to remove name';
    } finally {
      cimmichSetupSaving = '';
    }
  };

  const toggleSetupCategory = async (categoryId: string) => {
    if (!cimmichPerson || !cimmichSetup) {
      return;
    }
    const selected = cimmichSetup.categories.some((category) => category.category_id === categoryId);
    cimmichSetupSaving = `category:${categoryId}`;
    cimmichSetupError = '';
    try {
      await setCimmichPersonCategory(cimmichPerson.person_id, categoryId, !selected);
      await refreshCimmichSetup();
    } catch (error) {
      cimmichSetupError = error instanceof Error ? error.message : 'Unable to update category';
    } finally {
      cimmichSetupSaving = '';
    }
  };

  const saveSetupSubjectKind = async () => {
    if (!cimmichPerson || !cimmichSetupSubjectConfirm) {
      return;
    }
    cimmichSetupSaving = 'subject-kind';
    cimmichSetupError = '';
    try {
      await setCimmichPersonSubjectKind(cimmichPerson.person_id, cimmichSetupSubjectConfirm);
      cimmichSetupSubjectConfirm = undefined;
      cimmichSetupMergePersonId = '';
      cimmichSetupMergeQuery = '';
      cimmichSetupMergePreview = undefined;
      cimmichSetupMergeIntents.clearMerge();
      await refreshCimmichSetup();
    } catch (error) {
      cimmichSetupError = error instanceof Error ? error.message : 'Unable to update identity type';
    } finally {
      cimmichSetupSaving = '';
    }
  };

  const previewSetupMerge = async () => {
    if (!cimmichPerson || !cimmichSetupMergePersonId) {
      return;
    }
    cimmichSetupSaving = 'merge:preview';
    cimmichSetupError = '';
    try {
      cimmichSetupMergePreview = await getCimmichMergePreview(cimmichSetupMergePersonId, cimmichPerson.person_id);
    } catch (error) {
      cimmichSetupMergePreview = undefined;
      cimmichSetupError = error instanceof Error ? error.message : 'Unable to preview merge';
    } finally {
      cimmichSetupSaving = '';
    }
  };

  const confirmSetupMerge = async () => {
    if (!cimmichPerson || !cimmichSetupMergePreview) {
      return;
    }
    cimmichSetupSaving = 'merge:confirm';
    cimmichSetupError = '';
    try {
      const sourcePersonId = cimmichSetupMergePreview.source.person_id;
      const targetPersonId = cimmichPerson.person_id;
      const commandId = cimmichSetupMergeIntents.mergeCommandId(sourcePersonId, targetPersonId);
      await mergeCimmichPeople(sourcePersonId, targetPersonId, commandId);
      cimmichSetupMergeIntents.completeMerge(sourcePersonId, targetPersonId);
      cimmichSetupMergePersonId = '';
      cimmichSetupMergeQuery = '';
      cimmichSetupMergePreview = undefined;
      cimmichIdentityLoaded = false;
      await refreshCimmichSetup();
    } catch (error) {
      cimmichSetupError = error instanceof Error ? error.message : 'Unable to merge identities';
    } finally {
      cimmichSetupSaving = '';
    }
  };

  const undoSetupMerge = async (mergeOperationId: string) => {
    cimmichSetupSaving = `unmerge:${mergeOperationId}`;
    cimmichSetupError = '';
    try {
      const commandId = cimmichSetupMergeIntents.unmergeCommandId(mergeOperationId);
      await unmergeCimmichPeople(mergeOperationId, commandId);
      cimmichSetupMergeIntents.completeUnmerge(mergeOperationId);
      cimmichIdentityLoaded = false;
      await refreshCimmichSetup();
    } catch (error) {
      cimmichSetupError = error instanceof Error ? error.message : 'Unable to undo merge';
    } finally {
      cimmichSetupSaving = '';
    }
  };

  const selectCimmichFaceBucket = async (
    face: CimmichIdentityFace,
    bucketKind: 'head' | 'lq' | 'prime' | 'secondary' | null,
  ) => {
    if (!cimmichPerson || cimmichMatchingBucket(face) === bucketKind) {
      return;
    }
    cimmichIdentitySavingId = `face:${face.face_id}`;
    cimmichIdentityError = '';
    try {
      await setCimmichFaceBucket(cimmichPerson.person_id, face.face_id, bucketKind);
      await refreshCimmichIdentity();
    } catch (error) {
      cimmichIdentityError = error instanceof Error ? error.message : 'Unable to update face bucket';
    } finally {
      cimmichIdentitySavingId = '';
    }
  };

  const rescanCimmichHeads = async () => {
    if (!cimmichPerson || cimmichHeadRescanSaving) {
      return;
    }
    cimmichHeadRescanSaving = true;
    cimmichIdentityError = '';
    cimmichIdentityMessage = '';
    try {
      const result = await rescanCimmichHeadEvidence(cimmichPerson.person_id);
      if (result.totalCount === 0) {
        cimmichIdentityMessage = 'There are no Head references to rescan.';
      } else if (result.movedCount === 0) {
        cimmichIdentityMessage = `Checked ${result.totalCount.toLocaleString()} Head ${result.totalCount === 1 ? 'reference' : 'references'}. None yet match ${cimmichPerson.display_name} strongly enough to re-enter matching evidence.`;
      } else {
        const destinations = [
          result.tierCounts.prime ? `${result.tierCounts.prime} Core` : '',
          result.tierCounts.secondary ? `${result.tierCounts.secondary} Supporting` : '',
          result.tierCounts.lq ? `${result.tierCounts.lq} Low quality` : '',
        ].filter(Boolean);
        cimmichIdentityMessage = `Rescanned ${result.totalCount.toLocaleString()} Head ${result.totalCount === 1 ? 'reference' : 'references'} and moved ${result.movedCount.toLocaleString()} to ${destinations.join(', ')}.`;
      }
      await refreshCimmichIdentityAfterReview();
      await loadCimmichIdentityBucket('head');
    } catch (error) {
      cimmichIdentityError = error instanceof Error ? error.message : 'Unable to rescan Head evidence';
    } finally {
      cimmichHeadRescanSaving = false;
    }
  };

  const chooseCimmichPresentation = async (
    slotKind: CimmichPersonPresentationSlot,
    face: CimmichIdentityFace,
    observationKind: 'body' | 'face',
  ) => {
    if (!cimmichPerson) {
      return;
    }
    const observationId = observationKind === 'body' ? face.body_id : face.face_id;
    if (!observationId) {
      return;
    }
    cimmichPresentationSaving = slotKind;
    cimmichIdentityError = '';
    try {
      cimmichPresentation = await setCimmichPersonPresentation(cimmichPerson.person_id, slotKind, {
        assetId: face.asset_id,
        crop: slotKind === 'hero' ? null : cimmichObservationCrop(face, observationKind),
        observationId,
        observationKind,
      });
      syncCimmichPresentationFrames(cimmichPresentation);
      cimmichPresentationPickerSlot = '';
    } catch (error) {
      cimmichIdentityError = error instanceof Error ? error.message : 'Unable to update presentation photo';
    } finally {
      cimmichPresentationSaving = '';
    }
  };

  const saveCimmichPresentationFrame = async (slotKind: CimmichPersonPresentationSlot) => {
    if (!cimmichPerson) {
      return;
    }
    const media = cimmichPresentation?.[slotKind];
    if (!media) {
      return;
    }
    cimmichPresentationSaving = slotKind;
    cimmichIdentityError = '';
    try {
      cimmichPresentation = await setCimmichPersonPresentation(cimmichPerson.person_id, slotKind, {
        assetId: media.assetId,
        crop: cimmichPresentationCropFromFrame(slotKind, media),
        observationId: media.observationId,
        observationKind: media.observationKind,
      });
      syncCimmichPresentationFrames(cimmichPresentation);
    } catch (error) {
      cimmichIdentityError = error instanceof Error ? error.message : 'Unable to save presentation framing';
    } finally {
      cimmichPresentationSaving = '';
    }
  };

  const clearCimmichPresentation = async (slotKind: CimmichPersonPresentationSlot) => {
    if (!cimmichPerson) {
      return;
    }
    cimmichPresentationSaving = slotKind;
    cimmichIdentityError = '';
    try {
      cimmichPresentation = await setCimmichPersonPresentation(cimmichPerson.person_id, slotKind, {
        assetId: null,
      });
      syncCimmichPresentationFrames(cimmichPresentation);
    } catch (error) {
      cimmichIdentityError = error instanceof Error ? error.message : 'Unable to clear presentation photo';
    } finally {
      cimmichPresentationSaving = '';
    }
  };

  const toggleCimmichFaceModifier = async (face: CimmichIdentityFace, modifierName: string, selected: boolean) => {
    if (!cimmichPerson || !modifierName) {
      return;
    }
    cimmichIdentitySavingId = `modifier:${face.face_id}:${modifierName}`;
    cimmichIdentityError = '';
    try {
      await setCimmichFaceModifier(cimmichPerson.person_id, face.face_id, modifierName, selected);
      await refreshCimmichIdentity();
    } catch (error) {
      cimmichIdentityError = error instanceof Error ? error.message : 'Unable to update face modifier';
    } finally {
      cimmichIdentitySavingId = '';
    }
  };

  const decideCimmichModifierProposal = async (proposalId: string, action: 'accept' | 'reject') => {
    if (!cimmichPerson) {
      return;
    }
    cimmichIdentitySavingId = `modifier-proposal:${proposalId}`;
    cimmichIdentityError = '';
    try {
      await decideCimmichFaceModifierProposal(cimmichPerson.person_id, proposalId, action);
      await refreshCimmichIdentity();
    } catch (error) {
      cimmichIdentityError = error instanceof Error ? error.message : 'Unable to review modifier suggestion';
    } finally {
      cimmichIdentitySavingId = '';
    }
  };

  const rejectCimmichIdentity = async (face: CimmichIdentityFace) => {
    if (cimmichIdentityRejectConfirmId !== face.face_id) {
      cimmichIdentityRejectConfirmId = face.face_id;
      return;
    }
    cimmichIdentitySavingId = `reject:${face.face_id}`;
    cimmichIdentityError = '';
    try {
      const correction = await rejectCimmichAcceptedIdentity(
        face.identity_claim_id,
        createCimmichIdentityCorrectionCommandId('person-not-this-person'),
      );
      const history = await getCimmichIdentityCorrectionHistory(face.identity_claim_id);
      cimmichIdentityUndoDecisionId =
        history.items.find(
          (item) => item.decisionId === correction.decisionId && item.undo.eligible && item.undo.decisionId,
        )?.undo.decisionId ?? '';
      cimmichIdentityRejectConfirmId = '';
      cimmichIdentityMessage = 'Identity removed. The Face is ready to identify again.';
      await refreshCimmichIdentity();
    } catch (error) {
      cimmichIdentityError = error instanceof Error ? error.message : 'Unable to remove identity';
    } finally {
      cimmichIdentitySavingId = '';
    }
  };

  const undoRejectedCimmichIdentity = async (decisionId = cimmichIdentityUndoDecisionId) => {
    if (!decisionId) {
      return;
    }
    cimmichIdentitySavingId = 'undo:identity';
    cimmichIdentityError = '';
    try {
      await undoCimmichIdentityCorrection(
        decisionId,
        createCimmichIdentityCorrectionCommandId('person-not-this-person-undo'),
      );
      cimmichIdentityUndoDecisionId = '';
      cimmichIdentityMessage = 'Identity restored.';
      await refreshCimmichIdentity();
    } catch (error) {
      cimmichIdentityError = error instanceof Error ? error.message : 'Unable to undo the identity correction';
    } finally {
      cimmichIdentitySavingId = '';
    }
  };

  const openCimmichIdentityMove = (
    face: CimmichIdentityFace,
    suggestion?: CimmichFaceMatch | CimmichFaceOwnerReviewMatch,
  ) => {
    if (cimmichIdentityMoveFaceId === face.face_id) {
      cimmichIdentityMoveFaceId = '';
      return;
    }
    cimmichIdentityMoveBody =
      face.body_selected &&
      !(face.body_link_origin === 'face_body_linkage' && face.body_supporting_face_id === face.face_id);
    cimmichIdentityMoveFaceId = face.face_id;
    cimmichIdentityMoveMode = 'existing';
    cimmichIdentityMoveNewName = '';
    cimmichIdentityMoveSuggestion = suggestion;
    cimmichIdentityMovePersonId = suggestion?.person_id ?? '';
    cimmichIdentityMoveQuery = suggestion?.display_name ?? '';
    cimmichIdentityError = '';
    if (cimmichSetupPeople.length === 0) {
      void getCimmichPeople(500)
        .then((people) => (cimmichSetupPeople = people))
        .catch((error) => {
          cimmichIdentityError = error instanceof Error ? error.message : 'Unable to load People';
        });
    }
  };

  const submitCimmichIdentityMove = async (face: CimmichIdentityFace) => {
    if (!cimmichPerson) {
      return;
    }
    if (cimmichIdentityMoveMode === 'existing' && !cimmichIdentityMovePersonId) {
      return;
    }
    if (cimmichIdentityMoveMode === 'new' && !cimmichIdentityMoveNewName.trim()) {
      return;
    }
    cimmichIdentitySavingId = `move:${face.face_id}`;
    cimmichIdentityError = '';
    cimmichIdentityMessage = '';
    try {
      const result = await moveCimmichIdentityFace(cimmichPerson.person_id, face.face_id, {
        ...(cimmichIdentityMoveBody && face.body_id ? { bodyId: face.body_id } : {}),
        moveBody: cimmichIdentityMoveBody,
        ...(cimmichIdentityMoveMode === 'new'
          ? { newPersonName: cimmichIdentityMoveNewName.trim() }
          : { targetPersonId: cimmichIdentityMovePersonId }),
      });
      cimmichIdentityMoveUndo =
        result.changed && result.previousPersonId
          ? {
              ...(result.movedBody && face.body_id ? { bodyId: face.body_id } : {}),
              destinationPersonId: result.personId,
              faceId: result.faceId,
              moveBody: Boolean(result.movedBody),
              originalPersonId: result.previousPersonId,
            }
          : null;
      storeIdentityMoveUndo(cimmichPerson.person_id, cimmichIdentityMoveUndo);
      cimmichIdentityMessage = `${result.createdPerson ? 'Created' : 'Moved to'} ${result.personName}${result.movedBody ? ' with its selected body' : ''}.`;
      cimmichIdentityMoveFaceId = '';
      cimmichIdentityMoveQuery = '';
      cimmichSetupPeople = await getCimmichPeople(500);
      await refreshCimmichIdentity();
    } catch (error) {
      cimmichIdentityError = error instanceof Error ? error.message : 'Unable to move identity';
    } finally {
      cimmichIdentitySavingId = '';
    }
  };

  const undoCimmichIdentityMove = async () => {
    const receipt = cimmichIdentityMoveUndo;
    if (!receipt) {
      return;
    }
    cimmichIdentitySavingId = 'undo:move';
    cimmichIdentityError = '';
    try {
      const result = await moveCimmichIdentityFace(receipt.destinationPersonId, receipt.faceId, {
        ...(receipt.moveBody && receipt.bodyId ? { bodyId: receipt.bodyId, moveBody: true } : {}),
        targetPersonId: receipt.originalPersonId,
      });
      if (!result.changed) {
        throw new Error('The face is already assigned to its earlier Person. Refresh to see the current evidence.');
      }
      cimmichIdentityMoveUndo = null;
      storeIdentityMoveUndo(receipt.originalPersonId, null);
      cimmichIdentityMessage = `Moved back to ${result.personName}.`;
      cimmichSetupPeople = await getCimmichPeople(500);
      await refreshCimmichIdentity();
    } catch (error) {
      cimmichIdentityError = error instanceof Error ? error.message : 'Unable to undo the identity move';
    } finally {
      cimmichIdentitySavingId = '';
    }
  };

  const applyUpdatedEvidenceBundle = (bundle: CimmichEvidenceBundle, packs = packIndexes) => {
    people = buildCimmichPeopleIndex(bundle, packs);
    person = people.find((row) => row.name === data.personName);
    loadError = person ? '' : `No Cimmich person named ${data.personName}`;
  };

  const faceCandidateDraft = (candidate: FaceConfirmationCandidate) =>
    normalizeName(faceCandidateDrafts[candidate.id] ?? candidate.proposedName);

  const runFaceCandidateAction = async (
    candidate: FaceConfirmationCandidate,
    action: 'confirm' | 'reject' | 'rename',
  ) => {
    const name = action === 'rename' ? faceCandidateDraft(candidate) : candidate.proposedName;
    if (action !== 'reject' && !name) {
      faceCandidateError = 'Name is required';
      return;
    }

    faceCandidateSavingId = `${candidate.id}:${action}`;
    faceCandidateError = '';
    faceCandidateMessage = '';
    try {
      const result = await updateCimmichFace({
        action: action === 'reject' ? 'reject_name_candidate' : 'rename',
        faceId: candidate.face.id,
        filename: candidate.filename,
        mediaId: candidate.mediaId,
        name,
      });
      applyUpdatedEvidenceBundle(result.bundle);
      faceCandidateMessage =
        action === 'reject' ? `Skipped ${candidate.proposedName} for this face.` : `Bound ${name} to this face.`;
    } catch (error) {
      faceCandidateError = error instanceof Error ? error.message : 'Unable to update face candidate';
    } finally {
      faceCandidateSavingId = '';
    }
  };

  const loadPersonProjection = async (generation: number) => {
    try {
      const row = await getCimmichPersonByName(data.personName, data.personId);
      if (generation !== personProjectionGeneration) {
        return;
      }
      if (!row) {
        throw new Error(`No person named ${data.personName}`);
      }
      cimmichPerson = row;
      cimmichIdentityMoveUndo = restoreIdentityMoveUndo(row.person_id);
      const assetsPromise = getCimmichPersonAssetsPage(row.person_id, 120);
      const directConnectionsPromise = getCimmichPersonConnections(row.person_id);
      const peoplePromise = getCimmichPeople(500);
      const correctionsPromise = getCimmichIdentityCorrectionDiscovery({ personId: row.person_id }, { limit: 12 });
      const presentationPromise =
        row.subject_kind === 'person'
          ? getCimmichPersonPresentation(row.person_id).catch(() => undefined)
          : Promise.resolve(undefined);
      const visibilityPromise =
        row.subject_kind === 'person'
          ? getCimmichVisibilityObject('person', row.person_id)
          : Promise.resolve(undefined);
      const profilePromise =
        row.subject_kind === 'person'
          ? Promise.all([
              getCimmichPersonProfile(row.person_id),
              getCimmichPersonProfileDisplayDefaults(),
              getCimmichPersonProfileDisplay(row.person_id),
              getCimmichPersonDetailsDisplayDefaults(),
              getCimmichPersonDetailsDisplay(row.person_id),
            ]).catch((error) => {
              if (generation === personProjectionGeneration) {
                cimmichProfileError = error instanceof Error ? error.message : 'Unable to load profile details';
              }
              return null;
            })
          : Promise.resolve(null);
      const assetsPage = await assetsPromise;
      if (generation !== personProjectionGeneration) {
        return;
      }
      cimmichAssets = assetsPage.items;
      cimmichAssetsNextCursor = assetsPage.nextCursor;
      cimmichLoadError = '';
      const [profileProjection, corrections, personVisibility, setupPeople, presentation, directConnections] =
        await Promise.all([
          profilePromise,
          correctionsPromise,
          visibilityPromise,
          peoplePromise,
          presentationPromise,
          directConnectionsPromise,
        ]);
      if (generation !== personProjectionGeneration) {
        return;
      }
      cimmichSetupPeople = setupPeople;
      cimmichDirectContextConnections = directConnections;
      cimmichIdentityCorrections = corrections.items;
      cimmichIdentityUndoDecisionId = corrections.items.find((item) => item.undo.eligible)?.undo.decisionId ?? '';
      cimmichPersonVisibility = personVisibility;
      if (presentation) {
        cimmichPresentation = presentation;
        syncCimmichPresentationFrames(presentation);
      }
      if (profileProjection) {
        const [profile, defaults, display, detailsDefaults, detailsDisplay] = profileProjection;
        cimmichProfile = profile;
        cimmichProfileDefaults = defaults;
        cimmichProfileDisplay = display;
        cimmichDetailsDefaults = detailsDefaults;
        cimmichDetailsDisplay = detailsDisplay;
        cimmichProfileError = '';
      }
      // Connections fan out one request per ranked context; let the dossier
      // paint from the state above and fill the graph in when it resolves.
      const peopleConnections = await loadCimmichPeopleConnections(row.person_id, assetsPage.items, setupPeople);
      if (generation !== personProjectionGeneration) {
        return;
      }
      cimmichPeopleConnections = peopleConnections;
      if (row.needs_holding || cimmichMode === 'identity') {
        await openCimmichIdentity(generation);
      }
      if (generation === personProjectionGeneration) {
        cimmichLoadError = '';
      }
    } catch (error) {
      if (generation === personProjectionGeneration) {
        cimmichLoadError = error instanceof Error ? error.message : 'Unable to load person';
      }
    }
  };

  $effect(() => {
    void cimmichVisibilityManager.version;
    const generation = ++personProjectionGeneration;
    cimmichPerson = undefined;
    cimmichPersonVisibility = undefined;
    cimmichPeopleConnections = [];
    cimmichDirectContextConnections = [];
    cimmichConnectionError = '';
    cimmichConnectionSavingId = '';
    cimmichConnectionUndoDecisionId = '';
    cimmichAssets = [];
    cimmichAssetsNextCursor = null;
    cimmichIdentityLoaded = false;
    cimmichIdentityLoading = false;
    cimmichIdentityFaces = [];
    cimmichIdentityFaceSummary = { all: 0, head: 0, lowQuality: 0, prime: 0, secondary: 0 };
    cimmichIdentityNextCursor = null;
    cimmichCandidates = [];
    cimmichMachineSuggestions = [];
    cimmichMachineSuggestionSelection = [];
    cimmichMachineSuggestionConfirm = false;
    cimmichHoldingMatches = {};
    cimmichHoldingMatchesLoading = {};
    cimmichIdentityUndoDecisionId = '';
    cimmichIdentityMoveUndo = null;
    cimmichIdentityCorrections = [];
    cimmichProfile = undefined;
    cimmichProfileDefaults = undefined;
    cimmichProfileDisplay = undefined;
    cimmichDetailsDefaults = undefined;
    cimmichDetailsDisplay = undefined;
    cimmichLoadError = '';
    void loadPersonProjection(generation);
  });

  $effect(() => {
    const filenames = [...new Set(resolveFilenames)];
    const run = ++assetResolveRun;
    if (filenames.length === 0) {
      resolvedAssets = {};
      return;
    }

    void resolveCimmichAssetsByFilename(filenames).then((assets) => {
      if (run === assetResolveRun) {
        resolvedAssets = assets;
      }
    });
  });
</script>

<svelte:window onresize={updateCimmichTabsOverflow} />

<UserPageLayout>
  <div class="mx-auto flex w-full max-w-7xl flex-col gap-3 p-4 text-immich-fg sm:p-5 dark:text-immich-dark-fg">
    {#if cimmichPerson}
      <section
        class="relative min-h-100 overflow-hidden rounded-[1.75rem] bg-slate-950 text-white shadow-2xl ring-1 ring-white/10"
        data-testid="cimmich-person-hero"
      >
        {#if cimmichPresentation?.hero}
          <img
            class="absolute max-w-none"
            src={cimmichPresentationImageUrl(cimmichPresentation.hero)}
            style={cimmichPresentationImageStyle('hero', cimmichPresentation.hero)}
            alt=""
          />
        {:else if cimmichPerson.sourceAssetId}
          <div class="absolute inset-0 bg-cover bg-no-repeat" style={cimmichPersonHeroStyle(cimmichPerson)}></div>
        {:else}
          <div
            class="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgb(71_85_105),rgb(15_23_42)_58%,rgb(2_6_23))]"
          ></div>
        {/if}
        <div class="absolute inset-0 bg-linear-to-r from-black/92 via-black/60 to-black/18"></div>
        <div class="absolute inset-0 bg-linear-to-t from-black/92 via-transparent to-black/45"></div>
        <a
          class="absolute top-5 left-5 z-10 inline-flex min-h-10 items-center gap-2 rounded-full border border-white/15 bg-black/35 px-3 text-sm font-semibold text-white/80 backdrop-blur-md transition hover:bg-black/55 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:top-7 sm:left-7"
          href={cimmichPerson.subject_kind === 'pet' ? Route.cimmichPets() : Route.cimmichPeople()}
        >
          <Icon icon={mdiArrowLeft} size="16" />
          {cimmichPerson.subject_kind === 'pet' ? 'Pets & Things' : 'People'}
        </a>
        <button
          class="absolute top-5 right-5 z-10 inline-flex size-9 items-center justify-center rounded-full border border-white/20 bg-black/35 text-white/80 shadow-lg backdrop-blur-md transition hover:bg-black/55 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:top-7 sm:right-7"
          type="button"
          data-testid="cimmich-person-display-shortcut"
          aria-label={cimmichPerson.subject_kind === 'person' ? 'Edit display photos' : 'Edit details'}
          title={cimmichPerson.subject_kind === 'person' ? 'Edit display photos' : 'Edit details'}
          onclick={() =>
            cimmichPerson?.subject_kind === 'person' ? void openCimmichDisplay() : void openCimmichSetup()}
        >
          <Icon icon={mdiPencilOutline} size="16" />
        </button>
        <div
          class="relative flex min-h-100 min-w-0 flex-col justify-end gap-5 px-5 pt-20 pb-5 sm:flex-row sm:items-end sm:p-7 lg:p-8"
        >
          {#if cimmichPresentation?.face}
            <span
              class="relative block size-28 shrink-0 overflow-hidden rounded-full bg-slate-700 shadow-2xl ring-4 ring-white/90 sm:size-32"
              aria-label={cimmichPerson.display_name}
            >
              <img
                class="max-w-none"
                src={cimmichPresentationImageUrl(cimmichPresentation.face)}
                style={cimmichPresentationImageStyle('face', cimmichPresentation.face)}
                alt=""
              />
            </span>
          {:else if cimmichPerson.sourceAssetId}
            <span
              class="block size-28 shrink-0 rounded-full bg-slate-700 bg-cover bg-center shadow-2xl ring-4 ring-white/90 sm:size-32"
              style={cimmichPersonCropStyle(cimmichPerson)}
              aria-label={cimmichPerson.display_name}
            ></span>
          {:else}
            <span
              class="flex size-28 shrink-0 items-center justify-center rounded-full bg-white/15 text-white shadow-2xl ring-4 ring-white/70 backdrop-blur-md sm:size-32"
            >
              <Icon icon={mdiAccount} size="52" />
            </span>
          {/if}
          <div class="min-w-0 flex-1">
            <div class="min-w-0">
              <div class="flex min-w-0 flex-wrap items-center gap-2">
                <h1 class="max-w-full text-4xl font-semibold tracking-[-0.035em] text-balance sm:text-5xl lg:text-6xl">
                  {cimmichPerson.display_name}
                </h1>
                {#if cimmichPerson.subject_kind === 'pet'}
                  <span
                    class="rounded-full border border-white/20 bg-black/35 px-3 py-1 text-xs font-semibold text-white backdrop-blur-md"
                    >Pet</span
                  >
                {/if}
                {#if cimmichPerson.needs_holding}
                  <span class="rounded-full bg-violet-200 px-3 py-1 text-xs font-semibold text-violet-950">Holding</span
                  >
                {:else if cimmichPerson.needs_sort}
                  <span class="rounded-full bg-amber-200 px-3 py-1 text-xs font-semibold text-amber-950"
                    >Needs sorting</span
                  >
                {/if}
              </div>
              {#if !cimmichProfile && visibleCimmichAliases.length > 0}
                <p class="mt-2 truncate text-sm text-white/65">
                  Also known as {visibleCimmichAliases.join(', ')}
                </p>
              {/if}
            </div>

            {#if cimmichProfile && cimmichProfileDisplay}
              {#if cimmichHeroFields.length > 0}
                <dl class="mt-4 flex flex-wrap gap-2 text-sm text-white">
                  {#each cimmichHeroFields as field (field.fieldKey)}
                    <div class={field.fieldKey === 'about' ? 'mb-1 basis-full' : ''}>
                      <dt class="sr-only">{field.label}</dt>
                      <dd
                        class={field.fieldKey === 'about'
                          ? 'max-w-3xl text-base/7 font-normal text-pretty whitespace-pre-wrap text-white/85 sm:text-lg/8'
                          : 'inline-flex min-h-9 items-center gap-2 rounded-full border border-white/15 bg-black/30 px-3 font-semibold backdrop-blur-md'}
                      >
                        {#if field.fieldKey !== 'about' && field.fieldKey !== 'gender_identity'}
                          <span class="font-medium text-white/55">{field.label}</span>
                        {/if}
                        {#if field.fieldKey === 'gender_identity'}
                          <span class="sr-only">{field.label}: {field.value}</span>
                          <Icon icon={cimmichGenderIcon ?? mdiGenderMaleFemaleVariant} size="20" />
                        {:else}
                          <span>{field.value}</span>
                        {/if}
                        {#if field.fieldKey === 'photo_history' && cimmichFuturePhotoDateCount > 0}
                          <Tooltip
                            text={`${cimmichFuturePhotoDateCount.toLocaleString()} ${cimmichFuturePhotoDateCount === 1 ? 'photo has a future date' : 'photos have future dates'} and ${cimmichFuturePhotoDateCount === 1 ? 'is' : 'are'} excluded from this range.`}
                          >
                            {#snippet child({ props })}
                              <span
                                {...props}
                                class="-my-1 -mr-1 inline-flex min-h-7 items-center gap-1.5 rounded-full bg-amber-300/15 px-2 text-xs font-semibold text-amber-100"
                                aria-label={`${cimmichFuturePhotoDateCount.toLocaleString()} photo dates need review`}
                              >
                                <Icon icon={mdiCalendarAlertOutline} size="16" />
                                {cimmichFuturePhotoDateCount.toLocaleString()}
                                {cimmichFuturePhotoDateCount === 1 ? 'date needs' : 'dates need'} review
                              </span>
                            {/snippet}
                          </Tooltip>
                        {/if}
                      </dd>
                    </div>
                  {/each}
                </dl>
              {/if}
            {:else}
              <dl class="mt-4 flex flex-wrap gap-2 text-sm text-white">
                <div
                  class="inline-flex min-h-9 items-center gap-2 rounded-full border border-white/15 bg-black/30 px-3 backdrop-blur-md"
                >
                  <dt class="font-medium text-white/55">{cimmichPhotoTimeframeLabel}</dt>
                  <dd class="font-semibold">{cimmichPhotoTimeframe}</dd>
                </div>
                <div
                  class="inline-flex min-h-9 items-center gap-2 rounded-full border border-white/15 bg-black/30 px-3 backdrop-blur-md"
                >
                  <dt class="font-medium text-white/55">Relationship</dt>
                  <dd class="font-semibold">
                    {cimmichRelationshipLabels.length > 0 ? cimmichRelationshipLabels.join(', ') : 'Not set'}
                  </dd>
                </div>
              </dl>
            {/if}
          </div>
        </div>
      </section>

      <div class="relative min-w-0 border-b border-gray-200 dark:border-immich-dark-gray">
        <div
          class="min-w-0 overflow-x-auto"
          class:mr-20={cimmichTabsCanScrollRight}
          bind:this={cimmichTabsScroller}
          onscroll={updateCimmichTabsOverflow}
        >
          <div class="flex min-w-max items-stretch sm:min-w-full">
            <div class="flex shrink-0" role="tablist" aria-label="Person content" use:keyboardTabs>
              <button
                class={`inline-flex h-12 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-semibold sm:px-4 ${cimmichMode === 'photos' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-immich-fg dark:text-gray-400 dark:hover:text-immich-dark-fg'}`}
                data-person-tab="photos"
                type="button"
                role="tab"
                aria-selected={cimmichMode === 'photos'}
                tabindex={cimmichMode === 'photos' ? 0 : -1}
                onclick={() => (cimmichMode = 'photos')}
              >
                Photos
                <span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs dark:bg-immich-dark-gray"
                  >{cimmichPerson.asset_count.toLocaleString()}</span
                >
              </button>
              {#if cimmichPerson.subject_kind === 'person'}
                <button
                  class={`inline-flex h-12 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-semibold sm:px-4 ${cimmichMode === 'details' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-immich-fg dark:text-gray-400 dark:hover:text-immich-dark-fg'}`}
                  data-person-tab="details"
                  type="button"
                  role="tab"
                  aria-selected={cimmichMode === 'details'}
                  tabindex={cimmichMode === 'details' ? 0 : -1}
                  onclick={openCimmichDetails}
                >
                  Details
                </button>
                <button
                  class={`inline-flex h-12 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-semibold sm:px-4 ${cimmichMode === 'connections' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-immich-fg dark:text-gray-400 dark:hover:text-immich-dark-fg'}`}
                  data-person-tab="connections"
                  type="button"
                  role="tab"
                  aria-selected={cimmichMode === 'connections'}
                  tabindex={cimmichMode === 'connections' ? 0 : -1}
                  onclick={() => (cimmichMode = 'connections')}
                >
                  Connections
                  {#if cimmichPeopleConnections.length + cimmichPersonConnections.length > 0}
                    <span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs dark:bg-immich-dark-gray">
                      {(cimmichPeopleConnections.length + cimmichPersonConnections.length).toLocaleString()}
                    </span>
                  {/if}
                </button>
              {/if}
              <button
                class={`inline-flex h-12 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-semibold sm:px-4 ${cimmichMode === 'identity' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-immich-fg dark:text-gray-400 dark:hover:text-immich-dark-fg'}`}
                data-person-tab="identity"
                type="button"
                role="tab"
                aria-selected={cimmichMode === 'identity'}
                tabindex={cimmichMode === 'identity' ? 0 : -1}
                onclick={() => void openCimmichIdentity()}
              >
                Identity
                {#if cimmichAwaitingCounts.newMatches > 0}
                  <span
                    class="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-900 dark:text-amber-100"
                  >
                    {cimmichAwaitingCounts.newMatches.toLocaleString()} new
                  </span>
                {/if}
                {#if cimmichAwaitingCounts.possibleMistags > 0}
                  <span
                    class="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800 dark:bg-red-950 dark:text-red-200"
                  >
                    {cimmichAwaitingCounts.possibleMistags.toLocaleString()} mistags
                  </span>
                {/if}
              </button>
              <button
                class={`inline-flex h-12 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-semibold sm:px-4 ${cimmichMode === 'documents' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-immich-fg dark:text-gray-400 dark:hover:text-immich-dark-fg'}`}
                data-person-tab="documents"
                type="button"
                role="tab"
                aria-selected={cimmichMode === 'documents'}
                tabindex={cimmichMode === 'documents' ? 0 : -1}
                onclick={() => (cimmichMode = 'documents')}
              >
                Documents
              </button>
            </div>

            {#if cimmichMode === 'photos'}
              <div class="my-2 w-px shrink-0 bg-gray-300 dark:bg-gray-700" aria-hidden="true"></div>
              <div
                class="ml-auto flex min-w-max items-center overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-immich-dark-bg"
                aria-label="Photo view options"
              >
                <button
                  class="inline-flex min-h-10 items-center gap-2 px-3 text-sm font-semibold text-gray-600 transition hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                  class:text-primary={cimmichPhotoSelectionMode}
                  type="button"
                  aria-label={cimmichPhotoSelectionMode ? 'Exit photo selection' : 'Select photos'}
                  aria-pressed={cimmichPhotoSelectionMode}
                  onclick={() => {
                    cimmichPhotoSelectionMode = !cimmichPhotoSelectionMode;
                    cimmichSelectedPhotoIds = [];
                  }}
                >
                  <Icon icon={mdiSelectAll} size="19" />
                  <span>{cimmichPhotoSelectionMode ? 'Done' : 'Select'}</span>
                </button>
                <label
                  class="relative inline-flex size-10 cursor-pointer items-center justify-center text-gray-500 transition hover:bg-gray-100 hover:text-gray-950 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
                  title="Sort photos"
                >
                  <Icon icon={mdiSortVariant} size="19" />
                  <select
                    class="absolute inset-0 size-full cursor-pointer opacity-0"
                    bind:value={cimmichPhotoSort}
                    aria-label="Sort photos"
                  >
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                    <option value="filename">Filename</option>
                  </select>
                </label>
                <label
                  class="relative inline-flex size-10 cursor-pointer items-center justify-center border-l border-gray-200 text-gray-500 transition hover:bg-gray-100 hover:text-gray-950 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
                  title="Group photos"
                >
                  <Icon icon={mdiGroup} size="19" />
                  <select
                    class="absolute inset-0 size-full cursor-pointer opacity-0"
                    bind:value={cimmichPhotoGroup}
                    aria-label="Group photos"
                  >
                    <option value="none">No grouping</option>
                    <option value="year">Year</option>
                    <option value="place">Place</option>
                    <option value="event">Event</option>
                    <option value="object">Thing</option>
                  </select>
                </label>
                <label
                  class="relative inline-flex size-10 cursor-pointer items-center justify-center border-l border-gray-200 text-gray-500 transition hover:bg-gray-100 hover:text-gray-950 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
                  title="Thumbnail size"
                >
                  <Icon icon={mdiViewGridOutline} size="19" />
                  <select
                    class="absolute inset-0 size-full cursor-pointer opacity-0"
                    bind:value={cimmichPhotoSize}
                    aria-label="Thumbnail size"
                  >
                    <option value="small">Small</option>
                    <option value="medium">Medium</option>
                    <option value="large">Large</option>
                  </select>
                </label>
              </div>
            {/if}
          </div>
        </div>

        {#if cimmichTabsCanScrollRight}
          <button
            class="absolute top-1/2 right-1 z-10 inline-flex min-h-9 -translate-y-1/2 items-center gap-1 rounded-full border border-gray-200 bg-white/95 px-2.5 text-xs font-semibold shadow-md backdrop-blur-sm sm:hidden dark:border-gray-700 dark:bg-immich-dark-bg/95"
            type="button"
            aria-label="Show more person sections"
            onclick={scrollCimmichTabs}
          >
            More
            <Icon icon={mdiChevronRight} size="17" />
          </button>
        {/if}
      </div>

      {#if cimmichMode === 'photos'}
        <section id="cimmich-identity-workspace" class="grid scroll-mt-4 gap-4">
          {#if cimmichPhotoSelectionMode}
            <div
              class="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-immich-dark-gray"
            >
              <strong>{cimmichSelectedPhotoIds.length} selected</strong>
              <span class="mr-auto text-xs text-gray-500">Up to {ENTITY_MEDIA_SELECTION_LIMIT} shown photos.</span>
              <button
                class="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold dark:border-gray-600"
                type="button"
                onclick={selectShownCimmichPhotos}>Select shown</button
              >
              {#if cimmichSelectedPhotoIds.length > 0}<button
                  class="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold dark:border-gray-600"
                  type="button"
                  onclick={() => (cimmichSelectedPhotoIds = [])}>Clear</button
                >{/if}
            </div>
          {/if}
          <CimmichEntityMediaActions
            currentSubject={{
              displayName: cimmichPerson.display_name,
              subjectId: cimmichPerson.person_id,
              subjectKind: cimmichPerson.subject_kind,
            }}
            items={selectedCimmichPhotoItems}
            onChanged={refreshCimmichPersonMedia}
            onClear={() => (cimmichSelectedPhotoIds = [])}
            showControls={cimmichPhotoSelectionMode}
          />
          {#each groupedCimmichAssets as group (group.id)}
            {#if group.label}
              <div class="flex items-center gap-3">
                <h2 class="text-base font-semibold text-gray-800 dark:text-gray-100">{group.label}</h2>
                {#if group.kindLabel}
                  <span
                    class="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-immich-dark-gray dark:text-gray-300"
                  >
                    {group.kindLabel}
                  </span>
                {/if}
                <span class="text-sm text-gray-500 dark:text-gray-400">{group.items.length.toLocaleString()}</span>
                <div class="h-px flex-1 bg-gray-200 dark:bg-gray-700"></div>
              </div>
            {/if}
            <div class={personPhotoGridClass(cimmichPhotoSize)}>
              {#each group.items as asset (asset.asset_id)}
                {#if asset.sourceAssetId}
                  <article
                    class="group relative aspect-square overflow-hidden rounded-sm bg-gray-200 dark:bg-gray-800"
                    class:ring-4={cimmichPhotoSelected(asset.asset_id)}
                    class:ring-primary={cimmichPhotoSelected(asset.asset_id)}
                  >
                    <a
                      href={Route.viewCimmichPersonAsset({
                        id: asset.sourceAssetId,
                        personId: cimmichPerson.person_id,
                        personName: cimmichPerson.display_name,
                      })}
                      class="block size-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      title={asset.filename}
                      onclick={(event) =>
                        handleCimmichMediaCardClick(event, cimmichPhotoSelectionMode, () =>
                          toggleCimmichPhotoSelection(asset.asset_id),
                        )}
                    >
                      <img
                        src={getAssetMediaUrl({ id: asset.sourceAssetId, size: AssetMediaSize.Thumbnail })}
                        alt={asset.filename}
                        class="size-full object-cover transition-transform group-hover:scale-[1.02]"
                        loading="lazy"
                      />
                      <span
                        class="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-black/75 to-transparent px-3 pt-10 pb-2 text-xs font-medium text-white opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
                      >
                        <span class="line-clamp-1">{asset.filename}</span>
                        {#if personPhotoDateLabel(asset)}
                          <span class="mt-0.5 block font-normal text-white/80">{personPhotoDateLabel(asset)}</span>
                        {/if}
                      </span>
                    </a>
                    {#if cimmichPhotoSelectionMode}
                      <button
                        class="absolute top-2 right-2 z-10 grid size-9 place-items-center rounded-full border-2 border-white bg-black/55 text-white shadow-lg"
                        class:bg-primary={cimmichPhotoSelected(asset.asset_id)}
                        type="button"
                        aria-label={`${cimmichPhotoSelected(asset.asset_id) ? 'Deselect' : 'Select'} ${asset.filename}`}
                        aria-pressed={cimmichPhotoSelected(asset.asset_id)}
                        onclick={() => toggleCimmichPhotoSelection(asset.asset_id)}
                      >
                        {#if cimmichPhotoSelected(asset.asset_id)}<Icon icon={mdiCheckCircleOutline} size="20" />{/if}
                      </button>
                    {/if}
                  </article>
                {:else}
                  <div
                    class="flex aspect-square items-end rounded-sm bg-gray-200 p-3 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                  >
                    <span class="line-clamp-3">{asset.filename || asset.asset_id}</span>
                  </div>
                {/if}
              {/each}
            </div>
          {:else}
            <div class="rounded-xl border border-dashed border-gray-300 px-5 py-12 text-center dark:border-gray-700">
              <p class="font-medium text-gray-700 dark:text-gray-200">No photos yet</p>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Try All photos, or use Tags to review how photos are connected to {cimmichPerson.display_name}.
              </p>
            </div>
          {/each}

          {#if cimmichAssetsNextCursor}
            <button
              class="mx-auto min-h-11 rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50 dark:bg-immich-dark-gray dark:text-gray-200"
              type="button"
              disabled={cimmichAssetsLoadingMore}
              onclick={() => void loadMoreCimmichAssets()}
            >
              {cimmichAssetsLoadingMore ? 'Loading…' : 'Load 120 more'}
            </button>
          {/if}

          {#if cimmichIdentityError}
            <p
              class="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
            >
              {cimmichIdentityError}
            </p>
          {/if}
        </section>
      {:else if cimmichMode === 'connections'}
        <section class="grid gap-4" aria-label="Connections">
          {#if cimmichConnectionError}
            <p
              class="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
              role="alert"
            >
              {cimmichConnectionError}
            </p>
          {/if}
          {#if cimmichConnectionUndoDecisionId}
            <div
              class="flex min-h-11 items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-2 text-sm"
              aria-live="polite"
            >
              <span>Connection removed.</span>
              <button
                class="min-h-11 rounded-md px-3 font-semibold text-primary hover:bg-primary/10 disabled:opacity-50"
                type="button"
                disabled={cimmichConnectionSavingId === 'undo'}
                onclick={() => void undoCimmichPersonConnection()}
                >{cimmichConnectionSavingId === 'undo' ? 'Restoring…' : 'Undo'}</button
              >
            </div>
          {/if}
          {#if cimmichPersonConnectionGroups.length > 0}
            <div class="grid gap-7">
              {#each cimmichPersonConnectionGroups as group (group.id)}
                <section class="grid gap-3" aria-labelledby={`person-connections-${group.id}`}>
                  <div class="flex items-baseline gap-2 border-b border-gray-200 pb-2 dark:border-gray-800">
                    <h3 class="text-sm font-semibold tracking-wide uppercase" id={`person-connections-${group.id}`}>
                      {group.label}
                    </h3>
                    <span class="text-xs text-gray-400">{group.items.length.toLocaleString()}</span>
                  </div>
                  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {#each group.items as connection (connection.entityId)}
                      <div class="relative">
                        <a
                          class="group grid min-h-28 grid-cols-[7rem_1fr] overflow-hidden rounded-2xl border border-gray-200 bg-white transition hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:border-immich-dark-gray dark:bg-immich-dark-bg dark:hover:border-gray-600"
                          href={cimmichPersonConnectionHref(connection)}
                        >
                          {#if connection.sourceAssetId}
                            <img
                              class="size-full object-cover transition duration-200 group-hover:scale-[1.03]"
                              src={getAssetMediaUrl({ id: connection.sourceAssetId, size: AssetMediaSize.Thumbnail })}
                              alt=""
                            />
                          {:else}
                            <span
                              class="flex size-full items-center justify-center bg-primary/10 text-primary"
                              aria-hidden="true"
                            >
                              <Icon icon={mdiShapeOutline} size="30" />
                            </span>
                          {/if}
                          <span class="flex min-w-0 flex-col justify-center p-4 pr-12">
                            <span class="text-xs font-semibold tracking-wide text-gray-400 uppercase">
                              {connection.entityKind === 'person'
                                ? connection.metaLabel
                                : connection.typeKind.replaceAll('_', ' ')}
                            </span>
                            <span class="mt-1 truncate font-semibold">{connection.displayName}</span>
                            <span class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                              {#if connection.entityKind === 'person'}
                                {connection.photoCount.toLocaleString()} shared
                                {connection.photoCount === 1 ? 'context' : 'contexts'}
                              {:else if connection.photoCount > 0}
                                {connection.photoCount.toLocaleString()}
                                {connection.photoCount === 1 ? 'photo' : 'photos'}
                              {:else}
                                {connection.metaLabel || 'Connected'}
                              {/if}
                            </span>
                          </span>
                        </a>
                        {#if connection.directRelations?.length}
                          <button
                            class="absolute top-2 right-2 flex size-11 items-center justify-center rounded-full bg-white/90 text-gray-600 shadow-sm hover:bg-red-50 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50 dark:bg-immich-dark-gray/90 dark:text-gray-300 dark:hover:bg-red-950 dark:hover:text-red-200"
                            type="button"
                            aria-label={`Remove linked roles from ${connection.displayName}`}
                            title={`Remove linked roles from ${connection.displayName}`}
                            disabled={cimmichConnectionSavingId === connection.entityId}
                            onclick={() => void removeCimmichPersonConnection(connection)}
                            ><Icon icon={mdiTrashCanOutline} size="18" /></button
                          >
                        {/if}
                      </div>
                    {/each}
                  </div>
                </section>
              {/each}
            </div>
          {:else}
            <CimmichStatePanel
              title="No connections yet"
              description={`People, events, places and things linked to ${cimmichPerson.display_name}'s photo stories will appear here.`}
            />
          {/if}
        </section>
      {:else if cimmichMode === 'documents'}
        <CimmichDocuments
          heading=""
          subject={{ id: cimmichPerson.person_id, kind: cimmichPerson.subject_kind, name: cimmichPerson.display_name }}
        />
      {:else if cimmichMode === 'details'}
        {#if cimmichProfile && cimmichProfileDefaults && cimmichProfileDisplay && cimmichDetailsDefaults && cimmichDetailsDisplay}
          <CimmichPersonDetails
            aliases={visibleCimmichAliases}
            compact
            defaults={cimmichProfileDefaults}
            detailsDefaults={cimmichDetailsDefaults}
            detailsDisplay={cimmichDetailsDisplay}
            display={cimmichProfileDisplay}
            profile={cimmichProfile}
            railManaged
            ondefaultschange={(value) => (cimmichProfileDefaults = value)}
            ondetailsdefaultschange={(value) => (cimmichDetailsDefaults = value)}
            ondetailsdisplaychange={(value) => (cimmichDetailsDisplay = value)}
            ondisplaychange={(value) => (cimmichProfileDisplay = value)}
            onprofilechange={(value) => (cimmichProfile = value)}
            onopenidentitysettings={() => void openCimmichSetup()}
          />
        {:else if cimmichProfileError}
          <p
            class="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
            role="alert"
          >
            {cimmichProfileError}
          </p>
        {:else}
          <p class="text-sm text-gray-500 dark:text-gray-400">Loading details…</p>
        {/if}
      {:else if cimmichMode === 'identity'}
        <section class="grid gap-4">
          <div class="grid gap-3">
            {#if cimmichPerson.needs_holding}
              <p class="text-sm font-semibold">Choose a match for each held face</p>
            {:else}
              <nav class="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-4 lg:grid-cols-8" aria-label="Identity tools">
                {#each cimmichIdentityWorkspaceGroups as group (group.id)}
                  <section
                    class={[
                      'grid min-w-0 content-start gap-1.5',
                      group.id === 'references'
                        ? 'sm:col-span-4 lg:col-span-4'
                        : group.id === 'appearance'
                          ? 'sm:col-span-2 lg:col-span-2 lg:border-l lg:border-gray-200 lg:pl-3 dark:lg:border-immich-dark-gray'
                          : 'sm:col-span-1 lg:col-span-1 lg:border-l lg:border-gray-200 lg:pl-3 dark:lg:border-immich-dark-gray',
                    ]}
                    aria-label={group.label}
                  >
                    <p
                      class="px-0.5 text-[10px] font-bold tracking-[0.14em] text-gray-400 uppercase dark:text-gray-500"
                    >
                      {group.label}
                    </p>
                    <div
                      class={[
                        'grid gap-2',
                        group.id === 'references'
                          ? 'grid-cols-2 sm:grid-cols-4'
                          : group.id === 'appearance'
                            ? 'grid-cols-2'
                            : 'grid-cols-1',
                      ]}
                    >
                      {#each group.filters as filter (filter.id)}
                        <button
                          class={[
                            'grid min-h-14 min-w-0 content-center gap-0.5 rounded-lg border p-2 text-left transition-colors',
                            cimmichIdentityFilter === filter.id
                              ? 'border-gray-950 bg-gray-950 text-white shadow-sm dark:border-white dark:bg-white dark:text-black'
                              : 'border-gray-200 bg-white hover:border-gray-400 dark:border-immich-dark-gray dark:bg-immich-dark-bg dark:hover:border-gray-500',
                          ]}
                          type="button"
                          aria-pressed={cimmichIdentityFilter === filter.id}
                          onclick={() => selectCimmichIdentityWorkspace(filter.id as CimmichIdentityFilter)}
                        >
                          <span class="text-xs/tight font-semibold sm:text-[11px] lg:text-xs">
                            {filter.label}
                          </span>
                          <span class="text-xs opacity-60">{filter.count}</span>
                        </button>
                      {/each}
                    </div>
                  </section>
                {/each}
              </nav>
              <div
                class="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 pt-3 dark:border-immich-dark-gray"
              >
                <div>
                  <p class="text-sm font-semibold">
                    {cimmichIdentityFilter === 'presentation'
                      ? 'Display photos'
                      : cimmichIdentityFilter === 'candidates'
                        ? 'Awaiting confirmation'
                        : [...cimmichIdentityFilters, ...cimmichIdentityAdvancedFilters].find(
                            (filter) => filter.id === cimmichIdentityFilter,
                          )?.label}
                  </p>
                  <p class="text-xs text-gray-500 dark:text-gray-400" aria-live="polite">
                    {cimmichIdentityFilter === 'body' || cimmichIdentityFilter === 'presence'
                      ? `${cimmichSelectedAppearanceAssets.length.toLocaleString()} confirmed`
                      : cimmichIdentityFilter === 'presentation'
                        ? `${cimmichPresentationSelectionCount} of 3 selected`
                        : cimmichIdentityFilter === 'candidates'
                          ? `${cimmichAwaitingCounts.newMatches.toLocaleString()} new matches · ${cimmichAwaitingCounts.possibleMistags.toLocaleString()} possible mistags`
                          : cimmichIdentityFilter === 'all'
                            ? `${cimmichIdentityFaces.length.toLocaleString()} accepted Face observations`
                            : `${renderedCimmichIdentityFaces.length.toLocaleString()} confirmed`}
                  </p>
                </div>
                <div class="flex max-w-xl flex-wrap items-center justify-end gap-2">
                  <p class="text-left text-xs text-gray-500 sm:text-right dark:text-gray-400">
                    {cimmichIdentityFilter === 'body'
                      ? 'Body-only evidence is used when no usable Face or Head represents this person.'
                      : cimmichIdentityFilter === 'presence'
                        ? 'Presence records that the person is known to appear without usable Face, Head, or Body geometry.'
                        : cimmichIdentityFilter === 'presentation'
                          ? 'Drag each photo to frame it. Scroll or use the controls to zoom.'
                          : cimmichIdentityFilter === 'candidates'
                            ? 'Suggestions are evidence only. Nothing changes until you confirm.'
                            : cimmichIdentityFilter === 'prime'
                              ? 'Selected by the machinery to cover different appearances for matching; this is not a best-photo gallery.'
                              : cimmichIdentityFilter === 'secondary'
                                ? 'Accepted Face evidence outside Core. Cards distinguish evidence-only photos from guarded matcher references.'
                                : cimmichIdentityFilter === 'head'
                                  ? 'Faces retained as identity evidence but excluded from matching.'
                                  : 'Audit what the machinery believes. Open Review face to correct its class, tags, identity, or display role.'}
                  </p>
                  {#if cimmichIdentityFilter === 'head'}
                    <button
                      class="min-h-9 shrink-0 rounded-md border border-gray-300 px-3 text-xs font-semibold hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-800"
                      type="button"
                      disabled={cimmichHeadRescanSaving || cimmichIdentityFaceSummary.head === 0}
                      onclick={() => void rescanCimmichHeads()}
                    >
                      {cimmichHeadRescanSaving ? 'Rescanning…' : 'Rescan Heads'}
                    </button>
                  {/if}
                </div>
              </div>
            {/if}
          </div>

          {#if cimmichIdentityError}
            <p
              class="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
            >
              {cimmichIdentityError}
            </p>
          {/if}
          {#if cimmichIdentityMessage || cimmichIdentityUndoDecisionId || cimmichIdentityMoveUndo}
            <div
              class="flex items-center justify-between gap-3 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
            >
              <p>{cimmichIdentityMessage || 'A recent identity correction can still be undone.'}</p>
              {#if cimmichIdentityMoveUndo}
                <button
                  class="shrink-0 rounded-md border border-green-300 px-3 py-1.5 font-semibold disabled:opacity-50 dark:border-green-800"
                  disabled={Boolean(cimmichIdentitySavingId)}
                  type="button"
                  onclick={() => void undoCimmichIdentityMove()}
                >
                  {cimmichIdentitySavingId === 'undo:move' ? 'Undoing…' : 'Undo move'}
                </button>
              {:else if cimmichIdentityUndoDecisionId}
                <button
                  class="shrink-0 rounded-md border border-green-300 px-3 py-1.5 font-semibold disabled:opacity-50 dark:border-green-800"
                  disabled={Boolean(cimmichIdentitySavingId)}
                  type="button"
                  onclick={() => void undoRejectedCimmichIdentity()}
                >
                  {cimmichIdentitySavingId === 'undo:identity' ? 'Undoing…' : 'Undo'}
                </button>
              {/if}
            </div>
          {/if}

          {#if cimmichIdentityCorrections.length > 0}
            <details
              class="rounded-xl border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
            >
              <summary
                class="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold marker:content-none"
              >
                <span>Recent identity changes</span>
                <span class="text-xs font-normal text-gray-500 dark:text-gray-400">
                  {cimmichIdentityCorrections.length.toLocaleString()} shown
                </span>
              </summary>
              <div class="grid gap-2 border-t border-gray-200 p-3 dark:border-immich-dark-gray">
                {#each cimmichIdentityCorrections as correction (correction.decisionId)}
                  <div
                    class="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-immich-dark-gray/50"
                  >
                    <div>
                      <p class="font-semibold">Removed an incorrect identity</p>
                      <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        {new Date(correction.createdAt).toLocaleString()} · Face remains available to identify again
                      </p>
                    </div>
                    {#if correction.undo.eligible}
                      <button
                        class="min-h-9 rounded-md border border-gray-300 px-3 text-xs font-semibold hover:bg-white disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-700"
                        type="button"
                        disabled={Boolean(cimmichIdentitySavingId)}
                        onclick={() => void undoRejectedCimmichIdentity(correction.undo.decisionId)}>Undo</button
                      >
                    {:else}
                      <span class="max-w-64 text-right text-xs text-gray-500 dark:text-gray-400">
                        Undo unavailable because this Face has changed since that decision.
                      </span>
                    {/if}
                  </div>
                {/each}
              </div>
            </details>
          {/if}

          {#if cimmichIdentityLoading}
            <p class="py-10 text-center text-sm text-gray-500 dark:text-gray-400">Loading matching evidence…</p>
          {:else if cimmichIdentityFilter === 'candidates'}
            <section class="grid gap-6" aria-label="Awaiting confirmation">
              {#if cimmichSamePhotoCollisionGroups.length > 0}
                <CimmichSamePhotoCollisionReview
                  correction={cimmichIdentityAuditCorrection}
                  groups={cimmichSamePhotoCollisionGroups}
                  onChangePerson={(item) => void changeCimmichAuditPerson(item)}
                  onConfirm={(item) => void confirmCimmichAuditPerson(item)}
                  onFixBoxLater={(item) => void deferCimmichAuditBoxFix(item)}
                  onNotFace={(item) => void markCimmichAuditFaceNotFace(item)}
                  onUnknownChanged={(item) => {
                    cimmichIdentityMessage = 'Marked as unknown. Identity suggestions are paused.';
                    finishCimmichAuditDecision(item);
                  }}
                  onUnknownError={(message) => (cimmichIdentityError = message)}
                  onUnknownSaving={(item, saving) => (cimmichIdentityAuditSavingId = saving ? item.faceId : '')}
                  personId={cimmichPerson.person_id}
                  personName={cimmichPerson.display_name}
                  photoReview={cimmichPhotoReview}
                  savingId={cimmichIdentityAuditSavingId}
                />
              {/if}
              {#each cimmichIdentityAuditGroups as auditGroup (auditGroup.kind)}
                {#if auditGroup.total > 0}
                  <section
                    class={[
                      'grid gap-4 rounded-2xl border p-4',
                      auditGroup.kind === 'untagged_match'
                        ? 'border-violet-200 bg-violet-50/40 dark:border-violet-900 dark:bg-violet-950/15'
                        : 'border-gray-200 bg-gray-50/60 dark:border-immich-dark-gray dark:bg-immich-dark-gray/15',
                    ]}
                    aria-labelledby={`${auditGroup.id}-heading`}
                  >
                    <div class="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div class="flex flex-wrap items-center gap-2">
                          <h4 id={`${auditGroup.id}-heading`} class="font-semibold">{auditGroup.title}</h4>
                          <span
                            class={[
                              'rounded-full px-2 py-0.5 text-xs font-semibold',
                              auditGroup.kind === 'untagged_match'
                                ? 'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-100'
                                : 'bg-gray-200 text-gray-700 dark:bg-immich-dark-gray dark:text-gray-200',
                            ]}
                          >
                            {auditGroup.total.toLocaleString()}
                          </span>
                        </div>
                        <p class="mt-0.5 max-w-2xl text-xs/5 text-gray-600 dark:text-gray-300">
                          {auditGroup.description}
                        </p>
                      </div>
                      <div class="flex flex-wrap items-center gap-2">
                        <button
                          class="min-h-10 rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold disabled:opacity-40 dark:border-gray-600"
                          type="button"
                          disabled={Boolean(cimmichIdentityAuditSavingId)}
                          onclick={() => selectShownCimmichAuditItems(auditGroup.kind, auditGroup.items)}
                          >Select shown</button
                        >
                        {#if cimmichAuditSelectionCount(auditGroup.kind) > 0}
                          <button
                            class="min-h-10 rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold disabled:opacity-40 dark:border-gray-600"
                            type="button"
                            disabled={Boolean(cimmichIdentityAuditSavingId)}
                            onclick={clearCimmichAuditSelection}>Clear</button
                          >
                          <button
                            class={[
                              'min-h-10 rounded-md px-3 py-2 text-sm font-semibold text-white disabled:opacity-40',
                              cimmichIdentityAuditConfirmAction === 'accept' ? 'bg-amber-600' : 'bg-immich-primary',
                            ]}
                            type="button"
                            disabled={Boolean(cimmichIdentityAuditSavingId)}
                            onclick={() => void decideSelectedCimmichAuditItems(auditGroup.kind, 'accept')}
                          >
                            {cimmichIdentityAuditSavingId === 'bulk:accept'
                              ? `Saving ${cimmichIdentityAuditProgress.completed} of ${cimmichIdentityAuditProgress.total}…`
                              : cimmichIdentityAuditConfirmAction === 'accept'
                                ? auditGroup.kind === 'untagged_match'
                                  ? `Confirm ${cimmichAuditSelectionCount(auditGroup.kind)} as ${cimmichPerson.display_name}`
                                  : `Move ${cimmichAuditSelectionCount(auditGroup.kind)} to suggested People`
                                : auditGroup.kind === 'untagged_match'
                                  ? `Confirm as ${cimmichPerson.display_name} (${cimmichAuditSelectionCount(auditGroup.kind)})`
                                  : `Apply suggested changes (${cimmichAuditSelectionCount(auditGroup.kind)})`}
                          </button>
                          <button
                            class={[
                              'min-h-10 rounded-md border px-3 py-2 text-sm font-semibold disabled:opacity-40',
                              cimmichIdentityAuditConfirmAction === 'dismiss'
                                ? auditGroup.kind === 'untagged_match'
                                  ? 'border-red-700 bg-red-700 text-white'
                                  : 'border-gray-800 bg-gray-800 text-white dark:border-gray-200 dark:bg-gray-200 dark:text-gray-900'
                                : auditGroup.kind === 'untagged_match'
                                  ? 'border-red-300 text-red-700 dark:border-red-900 dark:text-red-300'
                                  : 'border-gray-300 text-gray-700 dark:border-gray-600 dark:text-gray-200',
                            ]}
                            type="button"
                            disabled={Boolean(cimmichIdentityAuditSavingId)}
                            onclick={() => void decideSelectedCimmichAuditItems(auditGroup.kind, 'dismiss')}
                          >
                            {cimmichIdentityAuditSavingId === 'bulk:dismiss'
                              ? `Dismissing ${cimmichIdentityAuditProgress.completed} of ${cimmichIdentityAuditProgress.total}…`
                              : cimmichIdentityAuditConfirmAction === 'dismiss'
                                ? auditGroup.kind === 'untagged_match'
                                  ? `Confirm not ${cimmichPerson.display_name}`
                                  : `Keep ${cimmichAuditSelectionCount(auditGroup.kind)} current identities`
                                : auditGroup.kind === 'untagged_match'
                                  ? `Not ${cimmichPerson.display_name} (${cimmichAuditSelectionCount(auditGroup.kind)})`
                                  : `Keep current identities (${cimmichAuditSelectionCount(auditGroup.kind)})`}
                          </button>
                        {/if}
                        <a
                          class="min-h-10 rounded-md px-3 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-950/30"
                          href={Route.cimmichSteward()}>Open full review</a
                        >
                      </div>
                    </div>
                    <div class="grid items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {#each auditGroup.items.slice(0, cimmichIdentitySectionLimit(`identity-audit:${auditGroup.kind}`)) as item (`${item.kind}:${item.faceId}`)}
                        {@const photoContext = cimmichPhotoReview.context(item.assetId)}
                        <article
                          class={[
                            'flex h-full min-w-0 flex-col overflow-hidden rounded-xl border-2 bg-white shadow-sm dark:bg-immich-dark-bg',
                            cimmichAuditSelected(item.faceId)
                              ? 'border-immich-primary'
                              : 'border-gray-200 dark:border-immich-dark-gray',
                          ]}
                        >
                          <CimmichReviewPhotoMedia
                            busy={Boolean(cimmichIdentityAuditSavingId || cimmichPhotoReview.savingId)}
                            contextLabel={cimmichPhotoReview.label(item)}
                            filename={item.filename}
                            href={item.sourceAssetId
                              ? Route.viewCimmichPersonAsset({
                                  faceId: item.faceId,
                                  id: item.sourceAssetId,
                                  overlay: 'machinery',
                                  personId: cimmichPerson.person_id,
                                  personName: cimmichPerson.display_name,
                                })
                              : undefined}
                            image={item}
                            onRotate={(direction) => void cimmichPhotoReview.rotate(item.assetId, direction)}
                            onToggle={(event) => toggleCimmichAuditSelection(item.faceId, event)}
                            onUndo={photoContext?.rotationDecisionId
                              ? () => void cimmichPhotoReview.undo(item.assetId, photoContext.rotationDecisionId ?? '')
                              : undefined}
                            rotationQuarterTurns={photoContext?.rotationQuarterTurns ?? 0}
                            selected={cimmichAuditSelected(item.faceId)}
                            sourceAssetId={item.sourceAssetId}
                          />
                          <div class="flex min-w-0 flex-1 flex-col gap-3 p-3">
                            <div class="min-w-0">
                              <div class="flex flex-wrap items-center gap-2">
                                <span
                                  class="rounded-full bg-violet-100 px-2 py-1 text-[11px] font-semibold text-violet-800 dark:bg-violet-900 dark:text-violet-100"
                                >
                                  {item.kind === 'untagged_match' ? 'Previously untagged' : 'Existing tag disputed'}
                                </span>
                                <span class="text-xs text-gray-500 dark:text-gray-400">
                                  Match {item.suggestedPerson.score.toFixed(2)} · {item.margin >
                                  item.suggestedPerson.score
                                    ? 'no competing person'
                                    : `${item.margin.toFixed(2)} ahead of the next person`}
                                </span>
                              </div>
                              <p class="mt-2 line-clamp-2 min-w-0 text-sm/5 font-semibold break-all">{item.filename}</p>
                              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                                {item.kind === 'accepted_contradiction'
                                  ? `Currently ${item.assignedPerson?.displayName ?? 'another person'} · Matcher suggests ${item.suggestedPerson.displayName}`
                                  : `Matcher suggests ${item.suggestedPerson.displayName}`}
                              </p>
                            </div>
                            {#if item.suggestedPerson.reference || item.candidateEvidence}
                              <button
                                class="w-fit text-xs font-semibold text-violet-700 hover:underline dark:text-violet-300"
                                type="button"
                                aria-expanded={cimmichIdentityAuditEvidenceExpanded.includes(item.faceId)}
                                onclick={() => toggleCimmichAuditEvidence(item.faceId)}
                              >
                                {cimmichIdentityAuditEvidenceExpanded.includes(item.faceId)
                                  ? 'Hide matching evidence'
                                  : 'Why this match?'}
                              </button>
                              {#if cimmichIdentityAuditEvidenceExpanded.includes(item.faceId)}
                                {#if item.suggestedPerson.reference}
                                  <div
                                    class="grid grid-cols-[5rem_1fr] items-center gap-3 rounded-lg bg-violet-50 p-2 dark:bg-violet-950/30"
                                  >
                                    <a
                                      href={Route.viewAsset({ id: item.suggestedPerson.reference.sourceAssetId })}
                                      class="block aspect-square rounded-md bg-gray-200 bg-cover"
                                      style={cimmichAuditCropStyle(item.suggestedPerson.reference)}
                                      aria-label={`Open confirmed reference for ${item.suggestedPerson.displayName}`}
                                    ></a>
                                    <p class="text-xs/5 text-gray-600 dark:text-gray-300">
                                      Compared with a confirmed {item.suggestedPerson.displayName} photo.
                                    </p>
                                  </div>
                                {:else if item.candidateEvidence}
                                  <div class="grid gap-2 rounded-lg bg-violet-50 p-3 text-xs/5 dark:bg-violet-950/30">
                                    <p class="font-semibold text-violet-900 dark:text-violet-100">
                                      Matched against {item.suggestedPerson.displayName}’s current Core reference
                                      library.
                                    </p>
                                    <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-gray-600 dark:text-gray-300">
                                      <span>Best similarity</span>
                                      <span class="font-medium text-gray-900 dark:text-white">
                                        {item.candidateEvidence.matchScore?.toFixed(3) ?? 'Unavailable'}
                                      </span>
                                      <span>Next-best similarity</span>
                                      <span class="font-medium text-gray-900 dark:text-white">
                                        {item.candidateEvidence.secondBestScore?.toFixed(3) ?? 'Unavailable'}
                                      </span>
                                      <span>Separation</span>
                                      <span class="font-medium text-gray-900 dark:text-white">
                                        {item.candidateEvidence.margin?.toFixed(3) ?? 'Unavailable'}
                                      </span>
                                      <span>Face detector</span>
                                      <span class="font-medium text-gray-900 dark:text-white">
                                        {Math.round(item.candidateEvidence.detectorConfidence * 100)}%
                                      </span>
                                    </div>
                                    <p class="text-gray-500 dark:text-gray-400">
                                      Similarity and separation explain the matcher’s ranking; neither is an identity
                                      probability.
                                    </p>
                                  </div>
                                {/if}
                              {/if}
                            {/if}
                            <div class="mt-auto grid min-w-0 grid-cols-2 gap-2">
                              {#if item.kind === 'accepted_contradiction'}
                                <div class="col-span-2 grid min-w-0 grid-cols-[minmax(0,1fr)_2.5rem] gap-2">
                                  <button
                                    class="min-h-10 min-w-0 rounded-md bg-amber-600 p-2 text-sm/5 font-semibold whitespace-normal text-white disabled:opacity-40"
                                    type="button"
                                    disabled={Boolean(cimmichIdentityAuditSavingId) ||
                                      !cimmichIdentityAuditCorrection.decision(item).target}
                                    onclick={() => void changeCimmichAuditPerson(item)}
                                  >
                                    {cimmichIdentityAuditSavingId === `change:${item.faceId}`
                                      ? 'Saving…'
                                      : cimmichIdentityAuditCorrection.decision(item).label}
                                  </button>
                                  <button
                                    class="min-h-10 rounded-md border border-gray-300 text-lg font-bold disabled:opacity-40 dark:border-gray-600"
                                    type="button"
                                    aria-label={`Choose a different person for ${item.filename}`}
                                    aria-expanded={cimmichIdentityAuditCorrection.faceId === item.faceId}
                                    disabled={Boolean(cimmichIdentityAuditSavingId)}
                                    onclick={() => cimmichIdentityAuditCorrection.toggle(item)}>…</button
                                  >
                                </div>
                                <button
                                  class="col-span-2 min-h-10 min-w-0 rounded-md border border-gray-300 p-2 text-sm/5 font-semibold whitespace-normal disabled:opacity-40 dark:border-gray-600"
                                  type="button"
                                  disabled={Boolean(cimmichIdentityAuditSavingId)}
                                  onclick={() => void confirmCimmichAuditPerson(item)}
                                >
                                  {cimmichIdentityAuditSavingId === `confirm:${item.faceId}`
                                    ? 'Saving…'
                                    : `Leave as ${item.assignedPerson?.displayName ?? cimmichPerson.display_name}`}
                                </button>
                              {:else}
                                <button
                                  class="col-span-2 min-h-10 min-w-0 rounded-md bg-immich-primary p-2 text-sm/5 font-semibold whitespace-normal text-white disabled:opacity-40"
                                  type="button"
                                  disabled={Boolean(cimmichIdentityAuditSavingId)}
                                  onclick={() => void confirmCimmichAuditPerson(item)}
                                >
                                  {cimmichIdentityAuditSavingId === `confirm:${item.faceId}`
                                    ? 'Saving…'
                                    : `Confirm ${cimmichPerson.display_name}`}
                                </button>
                                <CimmichUnknownPersonAction
                                  busy={Boolean(cimmichIdentityAuditSavingId)}
                                  faceId={item.faceId}
                                  onChanged={() => {
                                    cimmichIdentityMessage = 'Marked as unknown. Identity suggestions are paused.';
                                    finishCimmichAuditDecision(item);
                                  }}
                                  onError={(message) => (cimmichIdentityError = message)}
                                  onSaving={(saving) => (cimmichIdentityAuditSavingId = saving ? item.faceId : '')}
                                />
                                <button
                                  class="min-h-10 rounded-md border border-gray-300 px-3 text-sm font-semibold hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:hover:bg-gray-800"
                                  type="button"
                                  aria-expanded={cimmichIdentityAuditCorrection.faceId === item.faceId}
                                  disabled={Boolean(cimmichIdentityAuditSavingId)}
                                  onclick={() => cimmichIdentityAuditCorrection.toggle(item)}
                                >
                                  {cimmichIdentityAuditCorrection.faceId === item.faceId
                                    ? 'Close change'
                                    : 'Someone else…'}
                                </button>
                              {/if}
                              {#if cimmichIdentityAuditCorrection.faceId === item.faceId}
                                <div
                                  class="col-span-2 grid min-w-0 gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2.5 dark:border-gray-700 dark:bg-black/10"
                                >
                                  <label class="grid min-w-0 gap-1 text-[11px] font-semibold text-gray-500">
                                    Likely matches
                                    <select
                                      aria-label="Likely identity matches"
                                      class="min-h-10 min-w-0 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-immich-dark-gray dark:text-white"
                                      value={cimmichIdentityAuditCorrection.decision(item).targetPersonId}
                                      disabled={Boolean(cimmichIdentityAuditSavingId)}
                                      onchange={(event) =>
                                        cimmichIdentityAuditCorrection.setTarget(item, event.currentTarget.value)}
                                    >
                                      {#if !cimmichIdentityAuditCorrection.decision(item).targetPersonId}
                                        <option value="">Choose a person</option>
                                      {/if}
                                      {#each cimmichIdentityAuditCorrection.options(item) as option (option.personId)}
                                        <option value={option.personId}>{option.label}</option>
                                      {/each}
                                    </select>
                                  </label>
                                  <label class="grid min-w-0 gap-1 text-[11px] font-semibold text-gray-500">
                                    Someone else
                                    <input
                                      class="min-h-10 min-w-0 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 dark:border-gray-600 dark:bg-immich-dark-gray dark:text-white"
                                      value={cimmichIdentityAuditCorrection.query(item)}
                                      placeholder="Type a name"
                                      disabled={Boolean(cimmichIdentityAuditSavingId)}
                                      oninput={(event) =>
                                        cimmichIdentityAuditCorrection.setQuery(item, event.currentTarget.value)}
                                    />
                                  </label>
                                  {#if cimmichIdentityAuditCorrection.searchResults(item).length > 0}
                                    <div class="grid gap-1" aria-label="Matching People">
                                      {#each cimmichIdentityAuditCorrection.searchResults(item) as person (person.person_id)}
                                        <button
                                          class="min-h-9 rounded-md bg-white px-3 text-left text-sm font-medium hover:bg-gray-100 dark:bg-immich-dark-gray dark:hover:bg-gray-700"
                                          type="button"
                                          onclick={() =>
                                            cimmichIdentityAuditCorrection.selectSearchResult(
                                              item,
                                              person.person_id,
                                              person.display_name,
                                            )}
                                        >
                                          {person.display_name}
                                        </button>
                                      {/each}
                                    </div>
                                  {:else if cimmichIdentityAuditCorrection.query(item).trim()}
                                    <p class="text-xs text-gray-500">No matching Person. Try another spelling.</p>
                                  {/if}
                                  <div
                                    class="flex items-center justify-end border-t border-gray-200 pt-2 dark:border-gray-700"
                                  >
                                    <button
                                      class="min-h-9 rounded-md px-3 text-xs font-semibold text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                                      type="button"
                                      onclick={() => cimmichIdentityAuditCorrection.toggle(item)}
                                    >
                                      {item.kind === 'accepted_contradiction' ? 'Close' : 'Cancel'}
                                    </button>
                                  </div>
                                  {#if cimmichIdentityAuditCorrection.loading(item)}
                                    <p class="text-[11px] text-gray-500 dark:text-gray-400">
                                      Loading the closest matches…
                                    </p>
                                  {/if}
                                </div>
                              {/if}
                            </div>
                          </div>
                        </article>
                      {/each}
                    </div>
                    {#if auditGroup.total > cimmichIdentitySectionLimit(`identity-audit:${auditGroup.kind}`)}
                      <button
                        class="mx-auto min-h-11 rounded-md bg-white px-4 py-2 text-sm font-medium dark:bg-immich-dark-gray"
                        type="button"
                        disabled={Boolean(cimmichIdentityAuditLoadingKind)}
                        onclick={() => void showMoreCimmichIdentityAudit(auditGroup.kind, auditGroup.items)}
                      >
                        {cimmichIdentityAuditLoadingKind === auditGroup.kind ? 'Loading…' : 'Show 50 more'}
                      </button>
                    {/if}
                  </section>
                {/if}
              {/each}

              {#if visibleCimmichMachineSuggestions.length > 0}
                <section
                  class="grid gap-3 rounded-2xl border border-sky-200 bg-sky-50/70 p-4 dark:border-sky-900 dark:bg-sky-950/20"
                  aria-labelledby="matching-suggestions-heading"
                >
                  <div class="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h4 id="matching-suggestions-heading" class="font-semibold">Suggested by matching</h4>
                      <p class="mt-0.5 text-xs/5 text-gray-600 dark:text-gray-300">
                        The local matcher ranks {cimmichPerson.display_name} first. Similarity orders the evidence; it is
                        not identity proof.
                      </p>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                      <a
                        class="min-h-10 rounded-md border border-sky-300 px-3 py-2 text-sm font-semibold hover:bg-white dark:border-sky-800 dark:hover:bg-black/20"
                        href={Route.cimmichSteward()}>Review alternatives</a
                      >
                      <button
                        class="min-h-10 rounded-md border border-sky-300 px-3 py-2 text-sm font-semibold disabled:opacity-40 dark:border-sky-800"
                        type="button"
                        disabled={cimmichMachineSuggestionSaving}
                        onclick={selectAllMachineSuggestions}
                      >
                        Select matching
                      </button>
                      <button
                        class="min-h-10 rounded-md bg-immich-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
                        type="button"
                        disabled={cimmichMachineSuggestionSelection.length === 0 || cimmichMachineSuggestionSaving}
                        onclick={() => void confirmSelectedMachineSuggestions()}
                      >
                        {cimmichMachineSuggestionSaving
                          ? 'Confirming…'
                          : cimmichMachineSuggestionConfirm
                            ? `Confirm ${cimmichMachineSuggestionSelection.length} as ${cimmichPerson.display_name}`
                            : `Confirm selected (${cimmichMachineSuggestionSelection.length})`}
                      </button>
                    </div>
                  </div>
                  <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {#each visibleCimmichMachineSuggestions.slice(0, cimmichIdentitySectionLimit('machine-suggestions')) as suggestion (suggestion.face_id)}
                      {@const selected = machineSuggestionSelected(suggestion.face_id)}
                      {@const lead = suggestion.candidates[0]}
                      {@const photoContext = cimmichPhotoReview.context(suggestion.asset_id)}
                      <article
                        class={[
                          'overflow-hidden rounded-xl border-2 bg-white dark:bg-immich-dark-bg',
                          selected ? 'border-primary' : 'border-sky-200 dark:border-sky-900',
                        ]}
                      >
                        <CimmichReviewPhotoMedia
                          busy={Boolean(cimmichPhotoReview.savingId)}
                          contextLabel={cimmichPhotoReview.label({
                            assetId: suggestion.asset_id,
                            captureTime: suggestion.capture_time,
                          })}
                          filename={suggestion.filename}
                          href={suggestion.sourceAssetId
                            ? Route.viewCimmichPersonAsset({
                                faceId: suggestion.face_id,
                                id: suggestion.sourceAssetId,
                                overlay: 'machinery',
                                personId: cimmichPerson.person_id,
                                personName: cimmichPerson.display_name,
                              })
                            : undefined}
                          image={{
                            box: {
                              h: suggestion.box_h,
                              w: suggestion.box_w,
                              x: suggestion.box_x,
                              y: suggestion.box_y,
                            },
                            height: suggestion.height,
                            width: suggestion.width,
                          }}
                          onRotate={(direction) => void cimmichPhotoReview.rotate(suggestion.asset_id, direction)}
                          onUndo={photoContext?.rotationDecisionId
                            ? () =>
                                void cimmichPhotoReview.undo(suggestion.asset_id, photoContext.rotationDecisionId ?? '')
                            : undefined}
                          rotationQuarterTurns={photoContext?.rotationQuarterTurns ?? 0}
                          sourceAssetId={suggestion.sourceAssetId}
                          targetAspect={4 / 5}
                        />
                        <label class="grid min-h-16 cursor-pointer grid-cols-[auto_1fr] items-start gap-2 p-3 text-sm">
                          <input
                            class="mt-0.5 size-4 accent-immich-primary"
                            type="checkbox"
                            checked={selected}
                            disabled={cimmichMachineSuggestionSaving}
                            onchange={() => toggleMachineSuggestion(suggestion.face_id)}
                          />
                          <span class="min-w-0">
                            <span class="block truncate font-semibold">{suggestion.filename}</span>
                            <span class="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                              Similarity {lead?.prime_score.toFixed(2) ?? '—'} ·
                              {suggestion.candidates.length - 1}
                              {suggestion.candidates.length === 2 ? ' alternative' : ' alternatives'}
                            </span>
                          </span>
                        </label>
                      </article>
                    {/each}
                  </div>
                  {#if visibleCimmichMachineSuggestions.length > cimmichIdentitySectionLimit('machine-suggestions')}
                    <button
                      class="mx-auto min-h-11 rounded-md bg-white px-4 py-2 text-sm font-medium dark:bg-immich-dark-gray"
                      type="button"
                      onclick={() => showMoreCimmichIdentitySection('machine-suggestions')}>Show 50 more</button
                    >
                  {/if}
                </section>
              {/if}

              {#if cimmichAwaitingCounts.total === 0}
                <p
                  class="rounded-xl border border-dashed border-gray-300 px-5 py-10 text-center text-sm text-gray-500 dark:border-gray-700"
                >
                  No suggestions for {cimmichPerson.display_name} are waiting.
                </p>
              {/if}
            </section>
          {:else if cimmichIdentityFilter === 'presentation'}
            <section class="grid gap-4" aria-label="Display photo choices">
              <div class="grid gap-3 sm:grid-cols-3">
                {#each [{ id: 'face', label: 'Face photo' }, { id: 'body', label: 'Body photo' }, { id: 'hero', label: 'Hero photo' }] as slot (slot.id)}
                  {@const slotKind = slot.id as CimmichPersonPresentationSlot}
                  {@const media = cimmichPresentation?.[slotKind] ?? null}
                  <article
                    class="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
                  >
                    <div
                      class={[
                        'relative aspect-4/3 overflow-hidden bg-slate-950 select-none',
                        cimmichPresentationDrag?.slotKind === slotKind ? 'cursor-grabbing' : 'cursor-grab',
                      ]}
                    >
                      {#if media}
                        <button
                          class="absolute inset-0 size-full touch-none overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
                          type="button"
                          aria-label={`${slot.label} framing editor. Drag the photo, use the mouse wheel to zoom, or use arrow and plus or minus keys.`}
                          onpointerdown={(event) => startCimmichPresentationDrag(event, slotKind)}
                          onpointermove={(event) => moveCimmichPresentationDrag(event, slotKind)}
                          onpointerup={endCimmichPresentationDrag}
                          onpointercancel={endCimmichPresentationDrag}
                          onwheel={(event) => zoomCimmichPresentation(event, slotKind)}
                          onkeydown={(event) => keyCimmichPresentation(event, slotKind)}
                        >
                          <img
                            class="pointer-events-none absolute inset-0 size-full object-contain p-3 opacity-70"
                            src={cimmichPresentationImageUrl(media)}
                            alt=""
                            draggable="false"
                          />
                          <span
                            class={[
                              'pointer-events-none absolute top-1/2 left-1/2 -translate-1/2 overflow-hidden border-2 border-white shadow-[0_0_0_999px_rgba(2,6,23,0.62),0_0_0_1px_rgba(0,0,0,0.55)]',
                              slotKind === 'face'
                                ? 'aspect-square h-[76%] rounded-full'
                                : slotKind === 'body'
                                  ? 'aspect-3/4 h-[84%] rounded-xl'
                                  : 'aspect-12/5 w-[94%] rounded-lg',
                            ]}
                            aria-hidden="true"
                          >
                            <img
                              class="max-w-none"
                              src={cimmichPresentationImageUrl(media)}
                              style={cimmichPresentationImageStyle(slotKind, media)}
                              alt=""
                              draggable="false"
                            />
                          </span>
                        </button>
                        <div class="absolute inset-x-2 top-2 z-10 flex items-start justify-between gap-2">
                          <span
                            class="rounded-md bg-black/70 px-2 py-1 text-[11px] font-semibold text-white shadow-sm backdrop-blur-sm"
                          >
                            Final {slotKind === 'face' ? 'circle' : slotKind === 'hero' ? 'banner' : 'portrait'}
                          </span>
                          <button
                            class={[
                              'min-h-9 rounded-md border px-3 py-2 text-xs font-semibold shadow-sm backdrop-blur-sm',
                              cimmichPresentationPickerSlot === slotKind
                                ? 'border-white bg-white text-gray-950'
                                : 'border-white/30 bg-black/65 text-white hover:bg-black/80',
                            ]}
                            type="button"
                            aria-pressed={cimmichPresentationPickerSlot === slotKind}
                            onclick={() =>
                              (cimmichPresentationPickerSlot =
                                cimmichPresentationPickerSlot === slotKind ? '' : slotKind)}
                          >
                            Change
                          </button>
                        </div>
                        <div class="absolute inset-x-2 bottom-2 z-10 flex flex-wrap items-center justify-between gap-2">
                          <span
                            class="rounded-md bg-black/70 px-2 py-1 text-[11px] text-white/90 shadow-sm backdrop-blur-sm"
                          >
                            Drag · Wheel · Arrow keys
                          </span>
                          <div
                            class="flex items-center overflow-hidden rounded-md border border-white/25 bg-black/70 text-white shadow-sm backdrop-blur-sm"
                          >
                            <button
                              class="flex size-9 items-center justify-center text-lg hover:bg-white/15"
                              type="button"
                              aria-label={`Zoom ${slot.label} out`}
                              onclick={() => adjustCimmichPresentationFrame(slotKind, { zoom: -0.1 })}>−</button
                            >
                            <span class="min-w-12 px-1 text-center text-[11px] font-semibold">
                              {cimmichPresentationFrames[slotKind].zoom.toFixed(1)}×
                            </span>
                            <button
                              class="flex size-9 items-center justify-center text-lg hover:bg-white/15"
                              type="button"
                              aria-label={`Zoom ${slot.label} in`}
                              onclick={() => adjustCimmichPresentationFrame(slotKind, { zoom: 0.1 })}>+</button
                            >
                            <button
                              class="min-h-9 border-l border-white/20 px-3 text-xs font-semibold hover:bg-white/15 disabled:opacity-50"
                              type="button"
                              disabled={Boolean(cimmichPresentationSaving)}
                              onclick={() => void saveCimmichPresentationFrame(slotKind)}
                            >
                              {cimmichPresentationSaving === slotKind ? 'Saving…' : 'Save'}
                            </button>
                          </div>
                        </div>
                      {:else}
                        <div class="flex size-full items-center justify-center p-4">
                          <button
                            class="min-h-10 rounded-md bg-white px-4 text-sm font-semibold text-gray-950"
                            type="button"
                            onclick={() => (cimmichPresentationPickerSlot = slotKind)}>Choose photo</button
                          >
                        </div>
                      {/if}
                    </div>
                    <div class="flex min-w-0 items-center justify-between gap-2 p-3">
                      <div class="min-w-0">
                        <p class="text-sm font-semibold">{slot.label}</p>
                        <p class="truncate text-xs text-gray-500 dark:text-gray-400">
                          {media?.filename ?? 'Not selected'}
                        </p>
                      </div>
                      {#if media?.selectionMode === 'explicit'}
                        <button
                          class="min-h-9 shrink-0 rounded-md px-3 py-2 text-xs font-semibold text-gray-500 hover:bg-gray-50 disabled:opacity-50 dark:hover:bg-immich-dark-gray"
                          type="button"
                          disabled={Boolean(cimmichPresentationSaving)}
                          onclick={() => void clearCimmichPresentation(slotKind)}>Use automatic</button
                        >
                      {/if}
                    </div>
                  </article>
                {/each}
              </div>

              {#if cimmichPresentationPickerSlot}
                <section
                  class="grid gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-immich-dark-gray dark:bg-black/10"
                  aria-labelledby="presentation-picker-heading"
                >
                  <div class="flex items-center justify-between gap-3">
                    <div>
                      <h3 id="presentation-picker-heading" class="font-semibold">
                        Choose
                        {cimmichPresentationPickerSlot === 'face'
                          ? 'Face photo'
                          : cimmichPresentationPickerSlot === 'body'
                            ? 'Body photo'
                            : 'Hero photo'}
                      </h3>
                      <p class="text-xs text-gray-500 dark:text-gray-400">
                        Select from this person's confirmed evidence.
                      </p>
                    </div>
                    <button
                      class="min-h-9 rounded-md px-3 text-xs font-semibold hover:bg-white dark:hover:bg-immich-dark-gray"
                      type="button"
                      onclick={() => (cimmichPresentationPickerSlot = '')}>Cancel</button
                    >
                  </div>
                  <div class="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">
                    {#each cimmichPresentationPickerFaces.slice(0, 20) as face (face.face_id)}
                      <button
                        class="group overflow-hidden rounded-lg border border-gray-200 bg-white text-left hover:border-gray-500 disabled:opacity-50 dark:border-immich-dark-gray dark:bg-immich-dark-bg"
                        type="button"
                        disabled={Boolean(cimmichPresentationSaving)}
                        title={face.filename}
                        onclick={() =>
                          void chooseCimmichPresentation(
                            cimmichPresentationPickerSlot as CimmichPersonPresentationSlot,
                            face,
                            cimmichPresentationPickerSlot === 'body' ? 'body' : 'face',
                          )}
                      >
                        <span
                          class="block aspect-square bg-gray-200 bg-cover transition group-hover:scale-[1.02] dark:bg-gray-800"
                          style={cimmichObservationCropStyle(
                            face,
                            cimmichPresentationPickerSlot === 'body' ? 'body' : 'face',
                          )}
                        ></span>
                        <span class="block truncate px-2 py-1.5 text-[11px] font-medium">{face.filename}</span>
                      </button>
                    {:else}
                      <p class="col-span-full py-6 text-center text-sm text-gray-500">
                        No confirmed {cimmichPresentationPickerSlot === 'body' ? 'body' : 'face'} evidence is available.
                      </p>
                    {/each}
                  </div>
                </section>
              {/if}
            </section>
          {:else if cimmichIdentityFilter === 'body' || cimmichIdentityFilter === 'presence'}
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {#each cimmichSelectedAppearanceAssets.slice(0, cimmichIdentitySectionLimit(cimmichIdentityFilter)) as asset (asset.asset_id)}
                {@const hasBody = asset.association_types.includes('body')}
                {@const needsBodyPlacement = asset.association_types.includes('body_candidate')}
                {@const hasPresence = asset.association_types.includes('presence')}
                <article
                  class="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
                >
                  <a
                    href={Route.viewCimmichPersonAsset({
                      id: asset.sourceAssetId,
                      overlay: 'people',
                      personId: cimmichPerson.person_id,
                      personName: cimmichPerson.display_name,
                    })}
                    class="group relative block aspect-4/5 overflow-hidden bg-gray-200 dark:bg-gray-800"
                    title={asset.filename}
                  >
                    <img
                      class="size-full object-cover transition duration-200 group-hover:scale-[1.02]"
                      src={getAssetMediaUrl({ id: asset.sourceAssetId, size: AssetMediaSize.Thumbnail })}
                      alt={asset.filename}
                    />
                    <div class="pointer-events-none absolute right-2 bottom-2 flex flex-wrap justify-end gap-1">
                      {#if hasBody}
                        <span class="rounded-sm bg-black/75 px-2 py-1 text-[10px] font-semibold text-white">Body</span>
                      {:else if needsBodyPlacement}
                        <span class="rounded-sm bg-amber-950/80 px-2 py-1 text-[10px] font-semibold text-white"
                          >Place body</span
                        >
                      {/if}
                      {#if hasPresence}
                        <span class="rounded-sm bg-black/75 px-2 py-1 text-[10px] font-semibold text-white"
                          >Presence</span
                        >
                      {/if}
                    </div>
                  </a>
                  <div class="grid gap-1 p-2.5">
                    <p class="text-xs font-semibold">
                      {[
                        hasBody ? 'Body' : '',
                        needsBodyPlacement ? 'Body placement needed' : '',
                        hasPresence ? 'Presence' : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    <p class="truncate text-[11px] text-gray-500 dark:text-gray-400" title={asset.filename}>
                      {asset.filename}
                    </p>
                  </div>
                </article>
              {/each}
            </div>
            {#if cimmichSelectedAppearanceAssets.length === 0}
              <CimmichStatePanel
                title={cimmichIdentityFilter === 'body' ? 'No Body evidence' : 'No Presence evidence'}
                description={cimmichIdentityFilter === 'body'
                  ? 'Body-only tags for this person will appear here.'
                  : 'Whole-photo Presence tags for this person will appear here.'}
              />
            {/if}
            {#if cimmichSelectedAppearanceAssets.length > cimmichIdentitySectionLimit(cimmichIdentityFilter)}
              <button
                class="mx-auto min-h-11 rounded-md bg-gray-100 px-4 py-2 text-sm font-medium dark:bg-immich-dark-gray"
                type="button"
                onclick={() => showMoreCimmichIdentitySection(cimmichIdentityFilter)}>Show 20 more</button
              >
            {/if}
          {:else}
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {#each renderedCimmichIdentityFaces as face (face.face_id)}
                {@const holdingMatch = cimmichHoldingMatches[face.face_id]}
                {@const bodyOwnedElsewhere = Boolean(
                  face.body_assigned_person_id && face.body_assigned_person_id !== cimmichPerson.person_id,
                )}
                <article
                  class="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
                >
                  <a
                    href={face.sourceAssetId
                      ? Route.viewCimmichPersonAsset({
                          faceId: face.face_id,
                          id: face.sourceAssetId,
                          overlay: 'machinery',
                          personId: cimmichPerson.person_id,
                          personName: cimmichPerson.display_name,
                        })
                      : undefined}
                    class="group relative block aspect-4/5 overflow-hidden bg-gray-200 dark:bg-gray-800"
                    title={face.filename}
                  >
                    <span
                      class="absolute inset-0 bg-cover transition duration-200 group-hover:scale-[1.02] group-hover:opacity-0"
                      style={cimmichObservationCropStyle(face, 'face')}
                      aria-label={`Face in ${face.filename}`}
                    ></span>
                    {#if face.body_id}
                      <span
                        class="absolute inset-0 bg-cover opacity-0 transition duration-200 group-hover:scale-[1.02] group-hover:opacity-100"
                        style={cimmichObservationCropStyle(face, 'body')}
                        aria-label={`Body in ${face.filename}`}
                      ></span>
                      <span
                        class="pointer-events-none absolute bottom-2 left-2 rounded-sm bg-black/70 px-2 py-1 text-[11px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        {face.body_linked ? 'Linked full body' : 'Body in frame'}
                      </span>
                    {/if}
                    <div class="pointer-events-none absolute top-2 right-2 flex flex-wrap justify-end gap-1">
                      {#each face.modifiers.slice(0, 2) as modifier (modifier.modifierKey)}
                        <span class="rounded-sm bg-black/70 px-2 py-1 text-[10px] font-semibold text-white">
                          {modifier.modifierLabel}
                        </span>
                      {/each}
                      {#each face.modifier_proposals.slice(0, Math.max(0, 2 - face.modifiers.length)) as proposal (proposal.proposalId)}
                        <span
                          class="rounded-sm border border-amber-300 bg-amber-50/95 px-2 py-1 text-[10px] font-semibold text-amber-950"
                        >
                          {proposal.modifierLabel}? · {Math.round(proposal.confidence * 100)}%
                        </span>
                      {/each}
                      {#each face.capture_contexts.slice(0, 1) as context (context.contextId)}
                        <span class="rounded-sm bg-sky-950/80 px-2 py-1 text-[10px] font-semibold text-white">
                          {context.contextKind === 'rapid_burst'
                            ? 'Burst'
                            : context.contextKind === 'same_moment'
                              ? 'Same moment'
                              : 'Sequence'}
                          · {context.memberCount}
                        </span>
                      {/each}
                    </div>
                    {#if face.qc_flags.length > 0}
                      <div class="pointer-events-none absolute top-2 left-2 flex max-w-[72%] flex-wrap gap-1">
                        {#each face.qc_flags.slice(0, 2) as flag (flag)}
                          <span class="rounded-sm bg-amber-400/90 px-2 py-1 text-[10px] font-semibold text-black">
                            {cimmichQcLabel(face, flag)}
                          </span>
                        {/each}
                        {#if face.qc_flags.length > 2}
                          <span class="rounded-sm bg-black/70 px-2 py-1 text-[10px] font-semibold text-white">
                            +{face.qc_flags.length - 2}
                          </span>
                        {/if}
                      </div>
                    {/if}
                  </a>

                  <div class="grid gap-2 p-2.5">
                    <div class="flex min-w-0 items-center justify-between gap-2">
                      <span class="truncate text-xs font-semibold">{cimmichIdentityBucketLabel(face)}</span>
                      <span
                        class="max-w-[48%] truncate text-[11px] text-gray-500 dark:text-gray-400"
                        title={face.filename}>{face.filename}</span
                      >
                    </div>
                    {#if cimmichPerson.needs_holding}
                      {#if holdingMatch}
                        <button
                          class="grid rounded-md border border-violet-300 bg-violet-50 px-2.5 py-2 text-left hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950/50 dark:hover:bg-violet-950"
                          type="button"
                          disabled={Boolean(cimmichIdentitySavingId)}
                          onclick={() => openCimmichIdentityMove(face, holdingMatch)}
                        >
                          <span class="truncate text-sm font-semibold">{holdingMatch.display_name}</span>
                          <span class="text-[11px] text-violet-700 dark:text-violet-300"
                            >Closest · {'similarity' in holdingMatch
                              ? (holdingMatch.similarity?.toFixed(3) ?? 'not available')
                              : holdingMatch.prime_score.toFixed(3)}</span
                          >
                        </button>
                      {:else}
                        <button
                          class="rounded-md border border-gray-200 px-2.5 py-2 text-left text-xs font-semibold hover:bg-gray-50 disabled:opacity-50 dark:border-immich-dark-gray dark:hover:bg-immich-dark-gray"
                          type="button"
                          disabled={cimmichHoldingMatchesLoading[face.face_id] || Boolean(cimmichIdentitySavingId)}
                          onclick={() => void loadCimmichHoldingMatch(face)}
                        >
                          {cimmichHoldingMatchesLoading[face.face_id] ? 'Finding closest…' : 'Find closest match'}
                        </button>
                      {/if}
                    {:else}
                      <details
                        class="rounded-lg border border-gray-200 bg-gray-50 dark:border-immich-dark-gray dark:bg-black/10"
                      >
                        <summary class="flex min-h-11 cursor-pointer items-center px-3 text-xs font-semibold">
                          Review face
                        </summary>
                        <div class="grid gap-2 border-t border-gray-200 p-2.5 dark:border-immich-dark-gray">
                          <label
                            class="grid gap-1 text-[11px] font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400"
                          >
                            Face matching role
                            <select
                              class="min-w-0 rounded-md border border-gray-200 bg-white p-2 text-sm font-medium tracking-normal text-immich-fg normal-case outline-none focus:border-primary disabled:opacity-60 dark:border-immich-dark-gray dark:bg-immich-dark-gray dark:text-immich-dark-fg"
                              value={cimmichMatchingBucket(face) ?? ''}
                              disabled={cimmichIdentitySavingId === `face:${face.face_id}`}
                              onchange={(event) => {
                                const value = event.currentTarget.value;
                                void selectCimmichFaceBucket(
                                  face,
                                  value === 'prime' || value === 'secondary' || value === 'lq' || value === 'head'
                                    ? value
                                    : null,
                                );
                              }}
                            >
                              <option value="">Supporting evidence only</option>
                              <option value="prime">Core matching set</option>
                              <option value="secondary">Supporting matcher reference</option>
                              <option value="lq">Low-quality Face evidence</option>
                              <option value="head">Head reference (Face-derived)</option>
                            </select>
                          </label>

                          <div class="grid grid-cols-2 gap-1.5 text-xs">
                            <button
                              class="rounded-md border border-gray-200 p-2 font-semibold hover:bg-white disabled:opacity-50 dark:border-immich-dark-gray dark:hover:bg-white/10"
                              type="button"
                              disabled={Boolean(cimmichPresentationSaving)}
                              onclick={() => void chooseCimmichPresentation('face', face, 'face')}
                              >Use as Face photo</button
                            >
                            <button
                              class="rounded-md border border-gray-200 p-2 font-semibold hover:bg-white disabled:opacity-50 dark:border-immich-dark-gray dark:hover:bg-white/10"
                              type="button"
                              disabled={Boolean(cimmichPresentationSaving)}
                              onclick={() => void chooseCimmichPresentation('hero', face, 'face')}
                              >Use as Hero photo</button
                            >
                            {#if face.body_id && (face.body_selected || face.body_linked)}
                              <button
                                class="col-span-2 rounded-md border border-gray-200 p-2 font-semibold hover:bg-white disabled:opacity-50 dark:border-immich-dark-gray dark:hover:bg-white/10"
                                type="button"
                                disabled={Boolean(cimmichPresentationSaving)}
                                onclick={() => void chooseCimmichPresentation('body', face, 'body')}
                                >Use as Body photo</button
                              >
                            {/if}
                          </div>

                          <div class="grid gap-1.5">
                            {#if face.modifiers.length > 0 || face.modifier_proposals.length > 0 || face.capture_contexts.length > 0}
                              <div class="flex flex-wrap gap-1">
                                {#each face.modifiers as modifier (modifier.modifierKey)}
                                  <button
                                    class="rounded-full bg-violet-100 px-2 py-1 text-[11px] font-medium text-violet-800 hover:bg-violet-200 disabled:opacity-50 dark:bg-violet-950 dark:text-violet-200"
                                    type="button"
                                    title={`Remove ${modifier.modifierLabel}`}
                                    disabled={cimmichIdentitySavingId.startsWith(`modifier:${face.face_id}:`)}
                                    onclick={() => void toggleCimmichFaceModifier(face, modifier.modifierLabel, false)}
                                  >
                                    {modifier.modifierLabel} ×
                                  </button>
                                {/each}
                                {#each face.modifier_proposals as proposal (proposal.proposalId)}
                                  <span
                                    class="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 p-0.5 pl-2 text-[11px] font-medium text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
                                    title={`Suggested with ${Math.round(proposal.confidence * 100)}% confidence`}
                                  >
                                    {proposal.modifierLabel}?
                                    <button
                                      class="rounded-full bg-amber-200 px-1.5 py-0.5 font-semibold hover:bg-amber-300 disabled:opacity-50 dark:bg-amber-900 dark:hover:bg-amber-800"
                                      type="button"
                                      disabled={cimmichIdentitySavingId === `modifier-proposal:${proposal.proposalId}`}
                                      onclick={() => void decideCimmichModifierProposal(proposal.proposalId, 'accept')}
                                    >
                                      Add
                                    </button>
                                    <button
                                      class="rounded-full px-1.5 py-0.5 hover:bg-amber-100 disabled:opacity-50 dark:hover:bg-amber-950"
                                      type="button"
                                      aria-label={`Reject ${proposal.modifierLabel} suggestion`}
                                      disabled={cimmichIdentitySavingId === `modifier-proposal:${proposal.proposalId}`}
                                      onclick={() => void decideCimmichModifierProposal(proposal.proposalId, 'reject')}
                                    >
                                      ×
                                    </button>
                                  </span>
                                {/each}
                                {#each face.capture_contexts as context (context.contextId)}
                                  <span
                                    class="rounded-full bg-sky-100 px-2 py-1 text-[11px] font-medium text-sky-800 dark:bg-sky-950 dark:text-sky-200"
                                    title={context.label || 'Shared capture context'}
                                  >
                                    {context.contextKind === 'rapid_burst'
                                      ? 'Burst'
                                      : context.contextKind === 'same_moment'
                                        ? 'Same moment'
                                        : 'Sequence'}
                                    · {context.memberCount}
                                  </span>
                                {/each}
                              </div>
                            {/if}
                            <select
                              class="min-w-0 rounded-md border border-gray-200 bg-white p-2 text-sm text-immich-fg outline-none focus:border-primary disabled:opacity-60 dark:border-immich-dark-gray dark:bg-immich-dark-gray dark:text-immich-dark-fg"
                              value=""
                              aria-label="Add modifier"
                              disabled={cimmichIdentitySavingId.startsWith(`modifier:${face.face_id}:`)}
                              onchange={(event) => {
                                const modifierName = event.currentTarget.value;
                                event.currentTarget.value = '';
                                if (modifierName) {
                                  void toggleCimmichFaceModifier(face, modifierName, true);
                                }
                              }}
                            >
                              <option value="">Add modifier…</option>
                              {#each cimmichModifierOptions.filter((name) => !face.modifiers.some((modifier) => modifier.modifierLabel === name)) as modifierName (modifierName)}
                                <option value={modifierName}>{modifierName}</option>
                              {/each}
                            </select>
                          </div>
                        </div>
                      </details>
                    {/if}

                    {#if face.body_linked}
                      <p
                        class="rounded-md border border-sky-200 bg-sky-50 p-2 text-sm font-medium text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200"
                      >
                        Linked full body
                      </p>
                    {:else if bodyOwnedElsewhere}
                      <p
                        class="rounded-md border border-gray-200 p-2 text-sm text-gray-500 dark:border-immich-dark-gray"
                      >
                        Nearby body belongs elsewhere
                      </p>
                    {:else if face.body_id}
                      <p
                        class="rounded-md border border-gray-200 p-2 text-sm text-gray-500 dark:border-immich-dark-gray"
                      >
                        Body detected · not linked
                      </p>
                    {/if}

                    {#if cimmichIdentityMoveFaceId === face.face_id}
                      <div
                        class="grid gap-2 rounded-md border border-blue-200 bg-blue-50 p-2.5 dark:border-blue-900 dark:bg-blue-950/40"
                      >
                        <div class="grid grid-cols-2 gap-1 rounded-md bg-white/70 p-1 text-xs dark:bg-black/20">
                          {#each [{ id: 'existing', label: 'Existing Person' }, { id: 'new', label: 'New Person' }] as mode (mode.id)}
                            <button
                              class={[
                                'rounded-sm px-2 py-1.5 font-semibold',
                                cimmichIdentityMoveMode === mode.id
                                  ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-black'
                                  : 'text-gray-600 dark:text-gray-300',
                              ]}
                              type="button"
                              aria-pressed={cimmichIdentityMoveMode === mode.id}
                              onclick={() => (cimmichIdentityMoveMode = mode.id as CimmichMoveMode)}
                              >{mode.label}</button
                            >
                          {/each}
                        </div>
                        {#if cimmichIdentityMoveMode === 'existing'}
                          <div class="grid gap-1.5">
                            <input
                              class="min-w-0 rounded-md border border-gray-200 bg-white p-2 text-sm outline-none focus:border-blue-500 dark:border-immich-dark-gray dark:bg-immich-dark-gray"
                              value={cimmichIdentityMoveQuery}
                              placeholder="Search People"
                              aria-label="Search for the Person to receive this face"
                              oninput={(event) => {
                                cimmichIdentityMoveQuery = event.currentTarget.value;
                                cimmichIdentityMovePersonId = '';
                              }}
                            />
                            {#if cimmichIdentityMoveQuery.trim() && filteredCimmichMoveOptions.length > 0}
                              <div
                                class="max-h-44 overflow-y-auto rounded-md border border-gray-200 bg-white p-1 dark:border-immich-dark-gray dark:bg-immich-dark-gray"
                                role="listbox"
                                aria-label="Matching People"
                              >
                                {#each filteredCimmichMoveOptions as option (option.person_id)}
                                  <button
                                    class="flex min-h-10 w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-blue-600 dark:hover:bg-white/10"
                                    type="button"
                                    role="option"
                                    aria-selected={cimmichIdentityMovePersonId === option.person_id}
                                    onclick={() => {
                                      cimmichIdentityMovePersonId = option.person_id;
                                      cimmichIdentityMoveQuery = option.display_name;
                                    }}
                                  >
                                    <span class="truncate font-medium">{option.display_name}</span>
                                    <span class="shrink-0 text-xs text-gray-500">{option.asset_count} photos</span>
                                  </button>
                                {/each}
                              </div>
                            {:else if cimmichIdentityMoveQuery.trim() && !cimmichIdentityMovePersonId}
                              <p class="px-1 text-xs text-gray-500">No matching People.</p>
                            {/if}
                            {#if cimmichIdentityMovePersonId}
                              <p class="px-1 text-xs font-medium text-blue-700 dark:text-blue-300">
                                Selected: {cimmichMoveOptions.find(
                                  (option) => option.person_id === cimmichIdentityMovePersonId,
                                )?.display_name ?? cimmichIdentityMoveSuggestion?.display_name}
                              </p>
                            {/if}
                          </div>
                        {:else}
                          <input
                            class="min-w-0 rounded-md border border-gray-200 bg-white p-2 text-sm outline-none dark:border-immich-dark-gray dark:bg-immich-dark-gray"
                            bind:value={cimmichIdentityMoveNewName}
                            placeholder="New Person name"
                            aria-label="New Person name"
                          />
                        {/if}
                        {#if face.body_selected && face.body_link_origin === 'face_body_linkage' && face.body_supporting_face_id === face.face_id}
                          <p class="text-xs text-gray-600 dark:text-gray-300">
                            Linked body follows this face automatically.
                          </p>
                        {:else if face.body_selected}
                          <label class="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                            <input type="checkbox" bind:checked={cimmichIdentityMoveBody} />
                            Move selected body too
                          </label>
                        {/if}
                        <div class="grid grid-cols-[1fr_auto] gap-1.5">
                          <button
                            class="rounded-md bg-blue-700 p-2 text-sm font-semibold text-white disabled:opacity-50"
                            type="button"
                            disabled={Boolean(cimmichIdentitySavingId) ||
                              (cimmichIdentityMoveMode === 'existing'
                                ? !cimmichIdentityMovePersonId
                                : !cimmichIdentityMoveNewName.trim())}
                            onclick={() => void submitCimmichIdentityMove(face)}
                          >
                            {cimmichIdentitySavingId === `move:${face.face_id}`
                              ? 'Moving…'
                              : cimmichIdentityMoveMode === 'new'
                                ? 'Create and split'
                                : 'Move face'}
                          </button>
                          <button
                            class="rounded-md p-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/10"
                            type="button"
                            disabled={Boolean(cimmichIdentitySavingId)}
                            onclick={() => (cimmichIdentityMoveFaceId = '')}>Cancel</button
                          >
                        </div>
                      </div>
                    {:else}
                      <button
                        class="rounded-md px-2 py-1.5 text-left text-xs font-medium text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950"
                        type="button"
                        disabled={Boolean(cimmichIdentitySavingId)}
                        onclick={() => void openCimmichIdentityMove(face)}
                        >{cimmichPerson.needs_holding ? 'Choose person' : 'Move / split'}</button
                      >
                    {/if}

                    {#if cimmichIdentityRejectConfirmId === face.face_id}
                      <div class="grid grid-cols-[1fr_auto] gap-1.5">
                        <button
                          class="rounded-md bg-red-600 p-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                          type="button"
                          disabled={Boolean(cimmichIdentitySavingId)}
                          onclick={() => void rejectCimmichIdentity(face)}
                        >
                          {cimmichIdentitySavingId === `reject:${face.face_id}` ? 'Removing…' : 'Confirm removal'}
                        </button>
                        <button
                          class="rounded-md bg-gray-100 p-2 text-sm font-medium hover:bg-gray-200 dark:bg-immich-dark-gray"
                          type="button"
                          disabled={Boolean(cimmichIdentitySavingId)}
                          onclick={() => (cimmichIdentityRejectConfirmId = '')}
                        >
                          Cancel
                        </button>
                      </div>
                    {:else}
                      <button
                        class="rounded-md px-2 py-1.5 text-left text-xs font-medium text-gray-500 hover:bg-red-50 hover:text-red-700 dark:text-gray-400 dark:hover:bg-red-950 dark:hover:text-red-200"
                        type="button"
                        disabled={Boolean(cimmichIdentitySavingId)}
                        onclick={() => void rejectCimmichIdentity(face)}
                      >
                        Not this person
                      </button>
                    {/if}
                  </div>
                </article>
              {/each}
            </div>
            {#if renderedCimmichIdentityFaces.length === 0}
              <CimmichStatePanel
                title={cimmichIdentityBucketLoading === cimmichIdentityFilter
                  ? 'Loading matching evidence…'
                  : !cimmichIdentityServerBucket(cimmichIdentityFilter) && cimmichIdentityNextCursor
                    ? 'Nothing in the loaded results'
                    : cimmichIdentityFilter === 'needs_qc'
                      ? 'Nothing needs review'
                      : cimmichIdentityFilter === 'head'
                        ? 'No Face-derived Head references'
                        : 'This bucket is empty'}
                description={cimmichIdentityBucketLoading === cimmichIdentityFilter
                  ? 'Loading this complete evidence category from the archive.'
                  : !cimmichIdentityServerBucket(cimmichIdentityFilter) && cimmichIdentityNextCursor
                    ? 'Load more identity faces to continue checking this filter.'
                    : cimmichIdentityFilter === 'needs_qc'
                      ? 'This person has no currently flagged identity evidence.'
                      : cimmichIdentityFilter === 'head'
                        ? 'Manual Head tags remain visible on photos and are intentionally not counted in this reference library.'
                        : 'Choose another view or assign a matching role from Identity observations.'}
              />
            {/if}
            {#if visibleCimmichIdentityFaces.length > renderedCimmichIdentityFaces.length}
              <button
                class="mx-auto min-h-11 rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50 dark:bg-immich-dark-gray dark:text-gray-200"
                type="button"
                onclick={() => showMoreCimmichIdentitySection(cimmichIdentityFilter)}
              >
                Show 20 more
              </button>
            {:else if cimmichIdentityServerBucket(cimmichIdentityFilter) && cimmichIdentityBucketNextCursors[cimmichIdentityFilter]}
              <button
                class="mx-auto min-h-11 rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50 dark:bg-immich-dark-gray dark:text-gray-200"
                type="button"
                disabled={Boolean(cimmichIdentityBucketLoading)}
                onclick={() => void loadCimmichIdentityBucket(cimmichIdentityFilter, true)}
              >
                {cimmichIdentityBucketLoading === cimmichIdentityFilter ? 'Loading…' : 'Load 120 more'}
              </button>
            {:else if !cimmichIdentityServerBucket(cimmichIdentityFilter) && cimmichIdentityNextCursor}
              <button
                class="mx-auto min-h-11 rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50 dark:bg-immich-dark-gray dark:text-gray-200"
                type="button"
                disabled={cimmichIdentityFacesLoadingMore}
                onclick={() => void loadMoreCimmichIdentityFaces()}
              >
                {cimmichIdentityFacesLoadingMore ? 'Loading…' : 'Load 120 more'}
              </button>
            {/if}
          {/if}
        </section>
      {:else}
        <section class="grid gap-4 lg:grid-cols-2" data-testid="cimmich-person-setup">
          {#if cimmichSetupError}
            <p
              class="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 lg:col-span-2 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
            >
              {cimmichSetupError}
            </p>
          {/if}

          {#if cimmichSetupLoading || !cimmichSetup}
            <p class="py-10 text-sm text-gray-500 lg:col-span-2 dark:text-gray-400">Loading setup…</p>
          {:else}
            <article
              class="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-gray-200 p-4 lg:col-span-2 dark:border-immich-dark-gray"
            >
              <div>
                <h2 class="text-lg font-semibold">Profile settings</h2>
                <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Control this Person's visibility. Duplicate identity tools remain below.
                </p>
              </div>
              {#if cimmichPersonVisibility}
                <CimmichObjectVisibility
                  object={cimmichPersonVisibility}
                  objectLabel="Person"
                  onChange={(value) => (cimmichPersonVisibility = value)}
                />
              {/if}
            </article>
            <article class="rounded-lg border border-gray-200 p-4 dark:border-immich-dark-gray">
              <h2 class="text-lg font-semibold">Names</h2>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Keep one display name and every name this identity is known by.
              </p>

              <div class="mt-4 flex flex-wrap gap-2">
                <span
                  class="rounded-full bg-gray-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-gray-100 dark:text-black"
                >
                  {cimmichSetup.display_name} · display
                </span>
                {#each cimmichSetup.alias_items as alias (alias.alias_id)}
                  <span
                    class="inline-flex items-center gap-1 rounded-full bg-gray-100 py-1 pr-1 pl-3 text-sm dark:bg-immich-dark-gray"
                  >
                    <span>{alias.label} · {alias.alias_kind.replace('_', ' ')}</span>
                    <button
                      class="rounded-full px-2 py-0.5 text-gray-500 hover:bg-red-100 hover:text-red-700 disabled:opacity-50 dark:hover:bg-red-950 dark:hover:text-red-200"
                      type="button"
                      aria-label={`Remove ${alias.label}`}
                      disabled={Boolean(cimmichSetupSaving)}
                      onclick={() => void removeSetupAlias(alias.alias_id)}>×</button
                    >
                  </span>
                {/each}
              </div>

              <div class="mt-4 grid gap-2 sm:grid-cols-[1fr_150px_auto]">
                <input
                  class="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary dark:border-immich-dark-gray dark:bg-immich-dark-gray"
                  placeholder="Add another name"
                  bind:value={cimmichSetupAliasDraft}
                  onkeydown={(event) => {
                    if (event.key === 'Enter') {
                      void addSetupAlias();
                    }
                  }}
                />
                <select
                  class="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary dark:border-immich-dark-gray dark:bg-immich-dark-gray"
                  bind:value={cimmichSetupAliasKind}
                >
                  <option value="nickname">Nickname</option>
                  <option value="former_name">Former name</option>
                  <option value="imported">Imported name</option>
                </select>
                <button
                  class="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black disabled:opacity-50 dark:bg-gray-100 dark:text-black"
                  type="button"
                  disabled={!cimmichSetupAliasDraft.trim() || Boolean(cimmichSetupSaving)}
                  onclick={() => void addSetupAlias()}>{cimmichSetupSaving === 'alias:add' ? 'Adding…' : 'Add'}</button
                >
              </div>
            </article>

            <article class="rounded-lg border border-gray-200 p-4 dark:border-immich-dark-gray">
              <h2 class="text-lg font-semibold">Categories</h2>
              <div class="mt-4 flex flex-wrap gap-2">
                {#each cimmichSetup.category_catalog.filter((category) => category.category_kind === 'relationship') as category (category.category_id)}
                  {@const selected = cimmichSetup.categories.some((item) => item.category_id === category.category_id)}
                  <button
                    class={[
                      'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50',
                      selected
                        ? 'border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-black'
                        : 'border-gray-200 hover:bg-gray-50 dark:border-immich-dark-gray dark:hover:bg-immich-dark-gray',
                    ]}
                    type="button"
                    aria-pressed={selected}
                    disabled={Boolean(cimmichSetupSaving)}
                    onclick={() => void toggleSetupCategory(category.category_id)}>{category.name}</button
                  >
                {/each}
              </div>
              <p class="mt-3 text-xs text-gray-500 dark:text-gray-400">No relationship selected appears in Others.</p>
              {#each cimmichSetup.category_catalog.filter((category) => category.slug === 'sort') as category (category.category_id)}
                {@const selected = cimmichSetup.categories.some((item) => item.category_id === category.category_id)}
                {@const holdingSelected = cimmichSetup.categories.some((item) => item.slug === 'holding')}
                <button
                  class={[
                    'mt-4 flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50',
                    selected
                      ? 'border-amber-400 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100'
                      : 'border-gray-200 hover:bg-gray-50 dark:border-immich-dark-gray dark:hover:bg-immich-dark-gray',
                  ]}
                  type="button"
                  aria-pressed={selected}
                  disabled={Boolean(cimmichSetupSaving) || (selected && holdingSelected)}
                  onclick={() => void toggleSetupCategory(category.category_id)}
                >
                  <span>
                    <span class="block font-semibold">Needs sorting</span>
                    <span class="block text-xs opacity-70"
                      >Keep matches visible, but treat this identity as review-only.</span
                    >
                  </span>
                  <span class="font-semibold">{selected ? 'On' : 'Off'}</span>
                </button>
              {/each}
              {#each cimmichSetup.category_catalog.filter((category) => category.slug === 'holding') as category (category.category_id)}
                {@const selected = cimmichSetup.categories.some((item) => item.category_id === category.category_id)}
                <button
                  class={[
                    'mt-2 ml-4 flex w-[calc(100%-1rem)] items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50',
                    selected
                      ? 'border-violet-400 bg-violet-50 text-violet-950 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-100'
                      : 'border-gray-200 hover:bg-gray-50 dark:border-immich-dark-gray dark:hover:bg-immich-dark-gray',
                  ]}
                  type="button"
                  aria-pressed={selected}
                  disabled={Boolean(cimmichSetupSaving)}
                  onclick={() => void toggleSetupCategory(category.category_id)}
                >
                  <span>
                    <span class="block font-semibold">Holding</span>
                    <span class="block text-xs opacity-70">Mixed people; match and move each face individually.</span>
                  </span>
                  <span class="font-semibold">{selected ? 'On' : 'Off'}</span>
                </button>
              {/each}
            </article>

            <article class="rounded-lg border border-gray-200 p-4 dark:border-immich-dark-gray">
              <h2 class="text-lg font-semibold">Identity type</h2>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Pets stay out of human face matching and move to Pets & Things. Pet matching is not active yet.
              </p>
              <div class="mt-4 grid grid-cols-2 gap-2">
                {#each [{ id: 'person', label: 'Person' }, { id: 'pet', label: 'Pet' }] as kind (kind.id)}
                  <button
                    class={[
                      'rounded-md border px-4 py-3 text-left text-sm font-medium',
                      cimmichSetup.subject_kind === kind.id
                        ? 'border-primary bg-primary/10 text-primary dark:border-immich-dark-primary dark:text-immich-dark-primary'
                        : 'border-gray-200 hover:bg-gray-50 dark:border-immich-dark-gray dark:hover:bg-immich-dark-gray',
                    ]}
                    type="button"
                    aria-pressed={cimmichSetup.subject_kind === kind.id}
                    disabled={Boolean(cimmichSetupSaving)}
                    onclick={() => {
                      if (cimmichSetup?.subject_kind !== kind.id) {
                        cimmichSetupSubjectConfirm = kind.id as 'person' | 'pet';
                      }
                    }}>{kind.label}</button
                  >
                {/each}
              </div>
              {#if cimmichSetupSubjectConfirm}
                <div
                  class="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100"
                >
                  <p class="font-medium">
                    Mark {cimmichSetup.display_name} as {cimmichSetupSubjectConfirm === 'pet' ? 'a pet' : 'a person'}?
                  </p>
                  <p class="mt-1 text-xs opacity-80">
                    {cimmichSetupSubjectConfirm === 'pet'
                      ? 'Human core, supporting and low-quality matching references will be retired. Modifiers and existing evidence stay recoverable.'
                      : 'Human reference galleries will be rebuilt from accepted face evidence.'}
                  </p>
                  <div class="mt-3 flex gap-2">
                    <button
                      class="rounded-md bg-amber-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-amber-100 dark:text-amber-950"
                      type="button"
                      disabled={Boolean(cimmichSetupSaving)}
                      onclick={() => void saveSetupSubjectKind()}
                      >{cimmichSetupSaving === 'subject-kind' ? 'Saving…' : 'Confirm'}</button
                    >
                    <button
                      class="rounded-md px-3 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/10"
                      type="button"
                      disabled={Boolean(cimmichSetupSaving)}
                      onclick={() => (cimmichSetupSubjectConfirm = undefined)}>Cancel</button
                    >
                  </div>
                </div>
              {/if}
            </article>

            <article
              id="cimmich-merge-identities"
              class="scroll-mt-20 rounded-lg border border-gray-200 p-4 lg:col-span-2 dark:border-immich-dark-gray"
            >
              <h2 class="text-lg font-semibold">Merge identities</h2>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Select a duplicate to merge into {cimmichSetup.display_name}. This identity stays; the duplicate becomes
                a reversible redirect.
              </p>
              <div class="relative mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
                <label class="grid gap-1 text-sm font-medium">
                  Find a duplicate
                  <input
                    class="h-11 min-w-0 rounded-md border border-gray-200 bg-white px-3 text-sm outline-none focus:border-primary dark:border-immich-dark-gray dark:bg-immich-dark-gray"
                    type="search"
                    placeholder={`Search ${cimmichSetup.subject_kind === 'pet' ? 'pets' : 'people'} by name`}
                    bind:value={cimmichSetupMergeQuery}
                    disabled={Boolean(cimmichSetupSaving)}
                    oninput={() => {
                      cimmichSetupMergePersonId = '';
                      cimmichSetupMergePreview = undefined;
                      cimmichSetupMergeIntents.clearMerge();
                    }}
                  />
                </label>
                <button
                  class="h-11 self-end rounded-md bg-gray-100 px-4 text-sm font-medium hover:bg-gray-200 disabled:opacity-50 dark:bg-immich-dark-gray"
                  type="button"
                  disabled={!cimmichSetupMergePersonId || Boolean(cimmichSetupSaving)}
                  onclick={() => void previewSetupMerge()}
                  >{cimmichSetupSaving === 'merge:preview' ? 'Checking…' : 'Preview merge'}</button
                >
                {#if cimmichSetupMergeQuery.trim() && !selectedCimmichMerge}
                  <div
                    class="max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white p-1 shadow-lg sm:col-span-1 dark:border-immich-dark-gray dark:bg-immich-dark-bg"
                    role="listbox"
                    aria-label="Duplicate people"
                  >
                    {#each filteredCimmichMergeOptions as option (option.person_id)}
                      <button
                        class="flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-immich-dark-gray"
                        type="button"
                        role="option"
                        aria-selected={false}
                        onclick={() => {
                          cimmichSetupMergePersonId = option.person_id;
                          cimmichSetupMergeQuery = option.display_name;
                          cimmichSetupMergePreview = undefined;
                          cimmichSetupMergeIntents.clearMerge();
                        }}
                      >
                        <span class="truncate font-medium">{option.display_name}</span>
                        <span class="shrink-0 text-xs text-gray-500">{option.asset_count.toLocaleString()} photos</span>
                      </button>
                    {:else}
                      <p class="p-3 text-sm text-gray-500">No matching people.</p>
                    {/each}
                  </div>
                {/if}
              </div>

              {#if selectedCimmichMerge}
                <p class="mt-2 text-sm text-gray-600 dark:text-gray-300">
                  Selected <span class="font-semibold">{selectedCimmichMerge.display_name}</span> · {selectedCimmichMerge.asset_count.toLocaleString()}
                  photos
                </p>
              {/if}

              {#if cimmichSetupMergePreview}
                <div
                  class="mt-4 grid gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
                >
                  <div class="grid gap-3 sm:grid-cols-2">
                    <div>
                      <p class="text-xs font-semibold tracking-wide uppercase opacity-70">Merge duplicate</p>
                      <p class="mt-1 font-semibold">{cimmichSetupMergePreview.source.display_name}</p>
                      <p class="mt-1 text-xs opacity-80">
                        {cimmichSetupMergePreview.source.assets} photos · {cimmichSetupMergePreview.source
                          .accepted_faces} faces · {cimmichSetupMergePreview.source.aliases} aliases
                      </p>
                    </div>
                    <div>
                      <p class="text-xs font-semibold tracking-wide uppercase opacity-70">Keep</p>
                      <p class="mt-1 font-semibold">{cimmichSetupMergePreview.target.display_name}</p>
                      <p class="mt-1 text-xs opacity-80">
                        {cimmichSetupMergePreview.target.assets} photos · {cimmichSetupMergePreview.target
                          .accepted_faces} faces · {cimmichSetupMergePreview.target.aliases} aliases
                      </p>
                    </div>
                  </div>
                  {#if cimmichSetupMergePreview.conflicts.shared_assets > 0 || cimmichSetupMergePreview.conflicts.duplicate_presence > 0}
                    <p class="text-xs font-medium">
                      {cimmichSetupMergePreview.conflicts.shared_assets} shared photos · {cimmichSetupMergePreview
                        .conflicts.duplicate_presence} duplicate presence tags will be deduplicated.
                    </p>
                  {/if}
                  <button
                    class="w-fit rounded-md bg-red-700 px-4 py-2 font-medium text-white hover:bg-red-800 disabled:opacity-50"
                    type="button"
                    disabled={Boolean(cimmichSetupSaving)}
                    onclick={() => void confirmSetupMerge()}
                    >{cimmichSetupSaving === 'merge:confirm'
                      ? 'Merging…'
                      : `Merge ${cimmichSetupMergePreview.source.display_name} into ${cimmichSetupMergePreview.target.display_name}`}</button
                  >
                </div>
              {/if}

              {#if cimmichSetup.merges.length > 0}
                <div class="mt-5 border-t border-gray-200 pt-4 dark:border-immich-dark-gray">
                  <h3 class="text-sm font-semibold">Merged into this identity</h3>
                  <div class="mt-2 grid gap-2">
                    {#each cimmichSetup.merges as merge (merge.merge_operation_id)}
                      <div
                        class="flex flex-wrap items-center justify-between gap-3 rounded-md bg-gray-50 px-3 py-2 text-sm dark:bg-immich-dark-gray"
                      >
                        <span>{merge.source_display_name}</span>
                        <button
                          class="rounded-md px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-white hover:text-gray-950 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
                          type="button"
                          disabled={Boolean(cimmichSetupSaving)}
                          onclick={() => void undoSetupMerge(merge.merge_operation_id)}
                          >{cimmichSetupSaving === `unmerge:${merge.merge_operation_id}`
                            ? 'Restoring…'
                            : 'Undo merge'}</button
                        >
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}
            </article>
          {/if}
        </section>
      {/if}
    {:else if cimmichLoadError}
      <p
        class="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
      >
        {cimmichLoadError}
      </p>
    {:else if loadError}
      <p
        class="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
      >
        {loadError}
      </p>
    {:else if !person}
      <p class="text-sm text-gray-500 dark:text-gray-400">Loading person...</p>
    {:else}
      <section
        class="flex flex-wrap items-center justify-between gap-5 border-b border-gray-200 pb-5 dark:border-immich-dark-gray"
      >
        <div class="flex min-w-0 flex-wrap items-center gap-5">
          {#if featureAsset || person.featureFace?.cropUrl}
            <span
              class="block size-32 rounded-full bg-gray-200 bg-cover bg-center shadow-sm dark:bg-gray-700"
              style={faceCropStyle(featureAsset, person.featureFace)}
              aria-label={person.name}
            ></span>
          {:else}
            <span
              class="flex size-32 items-center justify-center rounded-full bg-gray-200 text-gray-700 shadow-sm dark:bg-immich-dark-gray dark:text-gray-200"
            >
              <Icon icon={mdiAccount} size="56" />
            </span>
          {/if}
          <div class="min-w-0">
            <h1 class="truncate text-3xl font-semibold">{person.name}</h1>
            <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
              {person.photos.length} photos · {person.faceCount} confirmed faces · {person.bodyLinks} body links
            </p>
            <div class="mt-3 flex flex-wrap gap-2 text-xs">
              <span
                class="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2.5 py-1.5 dark:bg-immich-dark-gray"
              >
                <Icon icon={mdiCalendarRange} size="16" />
                {topEvent}
              </span>
              <span
                class="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2.5 py-1.5 dark:bg-immich-dark-gray"
              >
                <Icon icon={mdiMapMarkerOutline} size="16" />
                {topPlace}
              </span>
              <span
                class="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2.5 py-1.5 dark:bg-immich-dark-gray"
              >
                <Icon icon={mdiShapeOutline} size="16" />
                {topSignal}
              </span>
            </div>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div class="min-w-24 rounded-md border border-gray-200 px-3 py-2 dark:border-immich-dark-gray">
            <p class="text-gray-500 dark:text-gray-400">Face</p>
            <p class="text-xl font-semibold">{person.faceCount}</p>
          </div>
          <div class="min-w-24 rounded-md border border-gray-200 px-3 py-2 dark:border-immich-dark-gray">
            <p class="text-gray-500 dark:text-gray-400">Body</p>
            <p class="text-xl font-semibold">{person.bodyLinks}</p>
          </div>
          <div class="min-w-24 rounded-md border border-gray-200 px-3 py-2 dark:border-immich-dark-gray">
            <p class="text-gray-500 dark:text-gray-400">Needs</p>
            <p class="text-xl font-semibold">{needsCheckCount}</p>
          </div>
          <div class="min-w-24 rounded-md border border-gray-200 px-3 py-2 dark:border-immich-dark-gray">
            <p class="text-gray-500 dark:text-gray-400">With</p>
            <p class="text-xl font-semibold">{peopleWith.length}</p>
          </div>
        </div>
      </section>

      <datalist id="cimmich-people-names">
        {#each people as row (row.name)}
          <option value={row.name}></option>
        {/each}
      </datalist>

      {#if faceConfirmationCandidates.length > 0}
        <section class="grid gap-3 border-b border-gray-200 pb-5 dark:border-immich-dark-gray">
          <div class="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 class="text-lg font-semibold">Tagged Face Confirmations</h2>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {faceConfirmationCandidates.length} waiting face crops from photos already tagged as {person.name}.
              </p>
            </div>
            {#if faceCandidateMessage}
              <p
                class="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-100"
              >
                {faceCandidateMessage}
              </p>
            {/if}
            {#if faceCandidateError}
              <p class="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-200">
                {faceCandidateError}
              </p>
            {/if}
          </div>

          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {#each faceConfirmationCandidates as candidate (candidate.id)}
              <article class="grid gap-3 rounded-md border border-gray-200 p-3 dark:border-immich-dark-gray">
                <div class="flex items-center gap-3">
                  <span
                    class="block size-20 shrink-0 rounded-full bg-gray-200 bg-cover bg-center dark:bg-gray-700"
                    style={faceOverlayCropStyle(candidate.asset, candidate.face)}
                    aria-label={candidate.proposedName}
                  ></span>
                  <div class="min-w-0">
                    <p class="truncate font-medium">{candidate.proposedName}</p>
                    <p class="truncate text-xs text-gray-500 dark:text-gray-400">
                      {candidate.evidenceKind === 'source' ? 'source tag' : 'candidate'} · {candidate.filename}
                    </p>
                  </div>
                </div>
                <label class="grid gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                  Change to
                  <input
                    class="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-immich-fg outline-none focus:border-primary dark:border-immich-dark-gray dark:bg-immich-dark-gray dark:text-immich-dark-fg"
                    list="cimmich-people-names"
                    value={faceCandidateDrafts[candidate.id] ?? candidate.proposedName}
                    oninput={(event) => {
                      faceCandidateDrafts = {
                        ...faceCandidateDrafts,
                        [candidate.id]: event.currentTarget.value,
                      };
                    }}
                  />
                </label>
                <div class="grid grid-cols-3 gap-2">
                  <button
                    class="rounded-md bg-primary p-2 text-xs font-medium text-white disabled:opacity-60 dark:bg-immich-dark-primary dark:text-black"
                    disabled={Boolean(faceCandidateSavingId)}
                    type="button"
                    onclick={() => void runFaceCandidateAction(candidate, 'confirm')}
                  >
                    {faceCandidateSavingId === `${candidate.id}:confirm` ? 'Saving...' : 'Correct'}
                  </button>
                  <button
                    class="rounded-md bg-gray-100 p-2 text-xs font-medium hover:bg-gray-200 disabled:opacity-60 dark:bg-immich-dark-gray"
                    disabled={Boolean(faceCandidateSavingId)}
                    type="button"
                    onclick={() => void runFaceCandidateAction(candidate, 'rename')}
                  >
                    {faceCandidateSavingId === `${candidate.id}:rename` ? 'Saving...' : 'Change'}
                  </button>
                  <button
                    class="rounded-md bg-gray-100 p-2 text-xs font-medium hover:bg-gray-200 disabled:opacity-60 dark:bg-immich-dark-gray"
                    disabled={Boolean(faceCandidateSavingId)}
                    type="button"
                    onclick={() => void runFaceCandidateAction(candidate, 'reject')}
                  >
                    {faceCandidateSavingId === `${candidate.id}:reject` ? 'Saving...' : 'No'}
                  </button>
                </div>
              </article>
            {/each}
          </div>
        </section>
      {/if}

      <nav
        class="flex gap-2 overflow-x-auto border-b border-gray-200 pb-3 dark:border-immich-dark-gray"
        aria-label="Cimmich person sections"
      >
        {#each tabs as tab (tab.id)}
          <button
            class={[
              'rounded-md px-3 py-2 text-sm font-medium',
              activeTab === tab.id
                ? 'bg-primary text-white dark:bg-immich-dark-primary dark:text-black'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-immich-dark-gray dark:text-gray-200',
            ]}
            type="button"
            aria-pressed={activeTab === tab.id}
            onclick={() => (activeTab = tab.id)}
          >
            {tab.label}
          </button>
        {/each}
      </nav>

      {#if activeTab === 'photos'}
        <section class="grid gap-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex flex-wrap gap-2">
              {#each photoFilters as filter (filter.id)}
                <button
                  class={[
                    'rounded-md px-3 py-2 text-sm font-medium',
                    photoFilter === filter.id
                      ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-black'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-immich-dark-gray dark:text-gray-200',
                  ]}
                  type="button"
                  aria-pressed={photoFilter === filter.id}
                  onclick={() => (photoFilter = filter.id)}
                >
                  {filter.label}
                </button>
              {/each}
            </div>
            <p class="text-sm text-gray-500 dark:text-gray-400">{filteredPhotos.length} shown</p>
          </div>

          <div
            class="grid grid-cols-3 gap-1 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8"
          >
            {#each filteredPhotos as photo (photo.filename)}
              {@const asset = resolvedAssets[photo.filename]}
              {#if asset}
                <a
                  href={Route.viewAsset(asset.asset)}
                  class="group relative aspect-square overflow-hidden bg-gray-200 dark:bg-gray-800"
                >
                  <img
                    src={asset.thumbnailUrl}
                    alt={photo.filename}
                    class="size-full object-cover transition-transform group-hover:scale-[1.02]"
                    loading="lazy"
                  />
                  <span
                    class="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-black/80 via-black/55 to-transparent px-2 pt-10 pb-2 text-left text-white"
                  >
                    <span class="block truncate text-[11px]/4 font-semibold"
                      >{photoEvidenceLabels(photo).slice(0, 3).join(' · ') || 'context'}</span
                    >
                    <span class="mt-0.5 line-clamp-2 block text-[11px]/4 text-white/85">
                      {photo.normalCaption || photo.enhancedCaption || photo.filename}
                    </span>
                  </span>
                </a>
              {:else}
                <div
                  class="flex aspect-square flex-col justify-end gap-2 bg-gray-200 p-3 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                >
                  <span class="line-clamp-3 text-left leading-5"
                    >{photo.normalCaption || photo.enhancedCaption || photo.filename}</span
                  >
                  <span class="truncate font-medium text-gray-900 dark:text-gray-100">{photo.filename}</span>
                </div>
              {/if}
            {:else}
              <p
                class="col-span-full rounded-md border border-gray-200 p-4 text-sm text-gray-500 dark:border-immich-dark-gray dark:text-gray-400"
              >
                No photos match this filter.
              </p>
            {/each}
          </div>
        </section>
      {:else if activeTab === 'story'}
        <section class="grid gap-4 lg:grid-cols-2">
          <div class="rounded-md border border-gray-200 p-4 dark:border-immich-dark-gray">
            <h2 class="text-lg font-semibold">Timeline</h2>
            <div class="mt-4 grid gap-3">
              {#each years as row (row.label)}
                <div class="grid grid-cols-[80px_minmax(0,1fr)_48px] items-center gap-3 text-sm">
                  <span>{row.label}</span>
                  <span class="h-2 rounded-full bg-gray-100 dark:bg-immich-dark-gray">
                    <span
                      class="block h-2 rounded-full bg-primary dark:bg-immich-dark-primary"
                      style={`width: ${Math.max(8, (row.count / Math.max(1, person.photos.length)) * 100)}%`}
                    ></span>
                  </span>
                  <span class="text-right font-medium">{row.count}</span>
                </div>
              {/each}
            </div>
          </div>
          <div class="rounded-md border border-gray-200 p-4 dark:border-immich-dark-gray">
            <h2 class="text-lg font-semibold">Current Read</h2>
            <p class="mt-3 text-sm/6 text-gray-600 dark:text-gray-300">
              {person.name} appears most strongly in {topEvent}. The current read model most often places them around {topPlace},
              with visible signals led by {topSignal}.
            </p>
          </div>
        </section>
      {:else if activeTab === 'identity'}
        <section class="grid gap-4 lg:grid-cols-2">
          <div class="rounded-md border border-gray-200 p-4 dark:border-immich-dark-gray">
            <h2 class="text-lg font-semibold">Face Buckets</h2>
            <div class="mt-4 grid gap-2">
              {#each countRows(person.buckets, 10) as row (row.label)}
                <div class="flex justify-between gap-3 text-sm">
                  <span class="truncate">{bucketLabel(row.label)}</span>
                  <span class="font-medium">{row.count}</span>
                </div>
              {:else}
                <p class="text-sm text-gray-500 dark:text-gray-400">No face buckets yet.</p>
              {/each}
            </div>
          </div>
          <div class="rounded-md border border-gray-200 p-4 dark:border-immich-dark-gray">
            <h2 class="text-lg font-semibold">Aliases</h2>
            <div class="mt-4 flex flex-wrap gap-2 text-sm">
              {#each person.aliases as alias (alias)}
                <span class="rounded-md bg-gray-100 px-2.5 py-1.5 dark:bg-immich-dark-gray">{alias}</span>
              {:else}
                <p class="text-gray-500 dark:text-gray-400">No alias source is attached yet.</p>
              {/each}
            </div>
          </div>
        </section>
      {:else if activeTab === 'with'}
        <section class="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {#each peopleWith as row (row.label)}
            <a
              class="rounded-md border border-gray-200 p-4 hover:bg-gray-50 dark:border-immich-dark-gray dark:hover:bg-immich-dark-gray"
              href={Route.cimmichPerson({ name: row.label })}
            >
              <span class="block truncate font-medium">{row.label}</span>
              <span class="mt-1 block text-sm text-gray-500 dark:text-gray-400">{row.count} photos together</span>
            </a>
          {:else}
            <p class="col-span-full text-sm text-gray-500 dark:text-gray-400">No co-appearance evidence yet.</p>
          {/each}
        </section>
      {:else if activeTab === 'places'}
        <section class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {#each countRows(person.knownPlaces, 18) as row (row.label)}
            <div class="rounded-md border border-gray-200 p-4 dark:border-immich-dark-gray">
              <span class="inline-flex items-center gap-2 font-medium"
                ><Icon icon={mdiMapMarkerOutline} size="18" /> {row.label}</span
              >
              <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">{row.count} appearances</p>
            </div>
          {:else}
            <p class="text-sm text-gray-500 dark:text-gray-400">No place evidence yet.</p>
          {/each}
        </section>
      {:else if activeTab === 'signals'}
        <section class="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {#each signalRows as row (row.label)}
            <div class="rounded-md border border-gray-200 p-4 dark:border-immich-dark-gray">
              <span class="inline-flex items-center gap-2 font-medium"
                ><Icon icon={mdiTagMultipleOutline} size="18" /> {row.label}</span
              >
              <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">{row.count} photos</p>
            </div>
          {:else}
            <p class="col-span-full text-sm text-gray-500 dark:text-gray-400">No thing or action evidence yet.</p>
          {/each}
        </section>
      {:else if activeTab === 'maintenance'}
        <section class="grid gap-4 lg:grid-cols-2">
          <div class="rounded-md border border-gray-200 p-4 dark:border-immich-dark-gray">
            <h2 class="text-lg font-semibold">Evidence Health</h2>
            <div class="mt-4 grid gap-2 text-sm">
              <div class="flex justify-between gap-3">
                <span>Source-tag photos</span><span class="font-medium">{person.sourcePhotos}</span>
              </div>
              <div class="flex justify-between gap-3">
                <span>Candidate-only photos</span><span class="font-medium">{person.candidatePhotos}</span>
              </div>
              <div class="flex justify-between gap-3">
                <span>Confirmed face overlays</span><span class="font-medium">{person.faceCount}</span>
              </div>
              <div class="flex justify-between gap-3">
                <span>Body links</span><span class="font-medium">{person.bodyLinks}</span>
              </div>
              <div class="flex justify-between gap-3">
                <span>Unresolved nearby faces</span><span class="font-medium">{person.unresolvedFaces}</span>
              </div>
            </div>
          </div>
          <div class="rounded-md border border-gray-200 p-4 dark:border-immich-dark-gray">
            <h2 class="text-lg font-semibold">Next Checks</h2>
            <div class="mt-4 grid gap-2 text-sm text-gray-600 dark:text-gray-300">
              <p>
                <Icon icon={mdiCheckCircleOutline} size="16" class="inline" /> Confirm weak/context-only photos before promoting
                them.
              </p>
              <p>
                <Icon icon={mdiAccountMultipleOutline} size="16" class="inline" /> Review high-count People With links for
                relationship/event quality.
              </p>
              <p>
                <Icon icon={mdiImageMultipleOutline} size="16" class="inline" /> Add true aliases and stable profile facts
                when the read model has them.
              </p>
            </div>
          </div>
          <div class="rounded-md border border-gray-200 p-4 lg:col-span-2 dark:border-immich-dark-gray">
            <h2 class="text-lg font-semibold">Archive Provenance</h2>
            <div class="mt-4 grid gap-2 text-sm sm:grid-cols-2">
              {#each archiveProvenanceRows as row (row.label)}
                <div class="flex justify-between gap-3 rounded-md bg-gray-50 px-3 py-2 dark:bg-immich-dark-gray">
                  <span class="truncate">{row.label}</span>
                  <span class="font-medium">{row.count}</span>
                </div>
              {:else}
                <p class="text-gray-500 dark:text-gray-400">No archive provenance yet.</p>
              {/each}
            </div>
          </div>
        </section>
      {/if}
    {/if}
  </div>
</UserPageLayout>
