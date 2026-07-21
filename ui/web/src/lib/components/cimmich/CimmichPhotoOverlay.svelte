<script lang="ts">
  import { page } from '$app/state';
  import { tick } from 'svelte';
  import { SvelteMap, SvelteSet, SvelteURLSearchParams } from 'svelte/reactivity';
  import type { AssetResponseDto } from '@immich/sdk';
  import { Route } from '$lib/route';
  import { cimmichVisibilityManager } from '$lib/managers/cimmich-visibility-manager.svelte';
  import {
    CimmichServiceError,
    attachCimmichManualObjectRegion,
    attachCimmichContextAssets,
    attachCimmichManualSubjectTag,
    correctCimmichBodyGeometry,
    correctCimmichFaceGeometry,
    createCimmichContextCommandId,
    createCimmichPerson,
    createCimmichPersonCommandId,
    createCimmichIdentityCorrectionCommandId,
    createCimmichManualSubjectTagCommandId,
    createCimmichManualPresenceCommandId,
    createCimmichManualPhotoContextCommandId,
    createCimmichObservationCorrectionCommandId,
    decideCimmichIdentityCandidate,
    detachCimmichContextAssets,
    getCimmichContextEntities,
    getCimmichFaceMatches,
    getCimmichIdentityCorrectionDiscovery,
    getCimmichIdentityCorrectionHistory,
    getCimmichManualSubjectTags,
    getCimmichManualPresences,
    getCimmichPeople,
    getCimmichPets,
    markCimmichBodyNotBody,
    markCimmichFaceNotFace,
    rejectCimmichAcceptedIdentity,
    rejectCimmichManualObjectRegion,
    replaceCimmichManualSubjectTag,
    setCimmichBodySelection,
    setCimmichFaceBucket,
    setCimmichFaceIdentity,
    setCimmichFaceReviewDisposition,
    setCimmichManualPresence,
    setCimmichAssetOwnerSummary,
    undoCimmichIdentityCorrection,
    undoCimmichContextDecision,
    undoCimmichManualSubjectTag,
    undoCimmichManualPresence,
    undoCimmichManualPhotoContextDecision,
    undoCimmichObservationCorrection,
    type CimmichFaceIdentitySelector,
    type CimmichContextEntity,
    type CimmichContextFamily,
    type CimmichFaceOwnerReviewMatch,
    type CimmichManualSubjectTag,
    type CimmichManualSubjectTagType,
    type CimmichManualObjectRegionTag,
    type CimmichManualPresenceAssociation,
  } from '$lib/services/cimmich.service';
  import {
    getCimmichEvidenceForAsset,
    updateCimmichFace,
    type CimmichBodyOverlay,
    type CimmichEvidenceBundle,
    type CimmichFaceOverlay,
    type CimmichPhotoEvidence,
    type CimmichPhotoContext,
    type CimmichStep2Readback,
  } from '$lib/services/cimmich-evidence.service';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import Portal from '$lib/elements/Portal.svelte';
  import { scaleToFit } from '$lib/utils/container-utils';
  import {
    authoredBodyTagRepresentsOverlay,
    getCimmichPersonPhotoContext,
    isNamedBody,
    isNamedFace,
    matchesCimmichPersonPhotoContext,
    placeFaceDetailsPanel,
    placeManualTagPanel,
    projectFaceEditorPersonDraft,
    photoEvidenceLoadErrorMessage,
    projectFaceReviewSimilarity,
    projectPhotoOverlayZoomStyle,
    projectPhotoTagTypes,
    projectNamedPhotoPresence,
    projectTypedManualTagSummary,
    stopPhotoViewerShortcutPropagation,
  } from './photo-viewer-presentation';
  import {
    createManualPhotoTagGeometry,
    createManualPhotoTagPersonSubjects,
    createManualPhotoTagPetSubject,
    findExactManualPhotoTagPerson,
    manualPhotoTagSubjectLabel,
    resizeManualPhotoTagGeometryForType,
    resolveManualPhotoTagPersonConflict,
    type ManualPhotoTagGeometry,
    type ManualPhotoTagSubject,
  } from './manual-photo-tag';
  import { isRenderableBodyPoseOverlay } from './body-pose-presentation';
  import { Icon, Tooltip } from '@immich/ui';
  import {
    mdiAccountMultipleOutline,
    mdiAccountOutline,
    mdiAccountTagOutline,
    mdiCheck,
    mdiChevronDown,
    mdiClose,
    mdiImageOutline,
    mdiPawOutline,
    mdiPencilOutline,
    mdiTagOutline,
    mdiTargetAccount,
    mdiTrashCanOutline,
  } from '@mdi/js';

  interface Props {
    asset: AssetResponseDto;
  }

  type SummaryMode = 'normal' | 'enhanced' | 'evidence';
  type OverlayView = 'context' | 'machinery' | 'off' | 'people';
  type FaceBox = CimmichFaceOverlay['bbox'];
  type BodyBox = CimmichBodyOverlay['bbox'];
  type FaceBoxDragMode = 'e' | 'move' | 'n' | 'ne' | 'nw' | 's' | 'se' | 'sw' | 'w';
  type BodyIdentityMode = 'face_match' | 'implied' | 'unlinked' | 'user_tag';
  type FaceBucketDraft = 'face_only' | 'head' | 'lq' | 'prime' | 'secondary';
  type FaceBoxDragState = {
    faceId: string;
    image: { height: number; width: number };
    mode: FaceBoxDragMode;
    pointerId: number;
    startBox: FaceBox;
    startClientX: number;
    startClientY: number;
  };
  type BodyBoxDragState = {
    bodyId: string;
    image: { height: number; width: number };
    mode: FaceBoxDragMode;
    pointerId: number;
    startBox: BodyBox;
    startClientX: number;
    startClientY: number;
  };

  let { asset }: Props = $props();
  let evidence = $state<CimmichPhotoEvidence>();
  let bundle = $state<CimmichEvidenceBundle>();
  let step2Readback = $state<CimmichStep2Readback>();
  let isLoading = $state(false);
  let loadError = $state('');
  let evidenceLoadGeneration = 0;
  let manualTagReadGeneration = 0;
  let overlayElement = $state<HTMLDivElement>();
  let overlayWidth = $state(0);
  let overlayHeight = $state(0);
  let isBulkFacePanelOpen = $state(false);
  let isTaggingMode = $state(false);
  let manualTagDraft = $state<ManualPhotoTagGeometry>();
  let manualTagEditGeometry = $state<ManualPhotoTagGeometry>();
  let isManualTagRepositioning = $state(false);
  let isTaggingHintVisible = $state(false);
  let manualTagQuery = $state('');
  let manualTagSelectedSubjectId = $state('');
  let manualTagType = $state<CimmichManualSubjectTagType | ''>('');
  let manualTagSubjects = $state<ManualPhotoTagSubject[]>([]);
  let manualPetIcons = $state<Record<string, string>>({});
  let isManualPetIconsLoading = $state(false);
  let manualTagSubjectsError = $state('');
  let isManualTagSubjectsLoading = $state(false);
  let manualTagReadError = $state('');
  let manualTagSaveError = $state('');
  let manualTagActionMessage = $state('');
  let manualTagUndoDecisionId = $state('');
  let selectedManualTagId = $state('');
  let manualTagRemoveConfirmId = $state('');
  let isManualTagSaving = $state(false);
  let isManualPersonCreating = $state(false);
  let manualPersonCreateIntent = $state<{ commandId: string; name: string }>();
  let manualSubjectTagItems = $state<CimmichManualSubjectTag[]>([]);
  let manualPresenceItems = $state<CimmichManualPresenceAssociation[]>([]);
  let isPresencePickerOpen = $state(false);
  let presenceQuery = $state('');
  let presenceSelectedSubjectId = $state('');
  let presenceError = $state('');
  let presenceMessage = $state('');
  let presenceUndoDecisionId = $state('');
  let isPresenceSaving = $state(false);
  let presenceInput = $state<HTMLInputElement>();
  let manualTagInput = $state<HTMLInputElement>();
  let isSummaryVisible = $state(false);
  let isContextEditing = $state(false);
  let isObjectTaggingMode = $state(false);
  let objectRegionDraft = $state<ManualPhotoTagGeometry>();
  let objectRegionQuery = $state('');
  let objectSelectedEntityId = $state('');
  let objectRegionPointer = $state<{ pointerId: number; startX: number; startY: number }>();
  let objectActionError = $state('');
  let objectActionMessage = $state('');
  let objectUndoDecisionId = $state('');
  let isObjectSaving = $state(false);
  let ownerSummaryDraft = $state('');
  let ownerSummaryActionError = $state('');
  let ownerSummaryActionMessage = $state('');
  let ownerSummaryUndoDecisionId = $state('');
  let isOwnerSummarySaving = $state(false);
  let isContextLoading = $state(false);
  let isContextSaving = $state(false);
  let contextOptions = $state<CimmichContextEntity[]>([]);
  let contextQuery = $state('');
  let contextAddKind = $state<'' | 'place' | 'event'>('');
  let contextActionError = $state('');
  let contextActionMessage = $state('');
  let contextUndoDecisionId = $state('');
  const contextAddActions = [
    { kind: 'place' as const, label: 'Place' },
    { kind: 'event' as const, label: 'Event' },
  ];
  let isSidecarVisible = $state(false);
  let isEnhancedMenuOpen = $state(false);
  let isFacesVisible = $state(true);
  let isBodiesVisible = $state(true);
  let showNamedFaces = $state(true);
  let showUntaggedFaces = $state(true);
  let showRejectedFaces = $state(false);
  let showSidecarOnlyFaces = $state(false);
  let showLinkedBodies = $state(true);
  let showUnlinkedBodies = $state(true);
  let summaryMode = $state<SummaryMode>('enhanced');
  let overlayView = $state<OverlayView>('off');
  const isPeopleSurfaceActive = $derived(
    (overlayView === 'people' || overlayView === 'machinery') && !isSidecarVisible,
  );
  const isContextSurfaceActive = $derived(overlayView === 'context' && !isSidecarVisible);
  let isArrivalCueVisible = $state(false);
  let hasStartedArrivalCue = false;
  let isExpanded = $state(false);
  let selectedFaceId = $state('');
  let selectedBodyId = $state('');
  let bodyPersonQuery = $state('');
  let bodySelectedPersonId = $state('');
  let bodyIdentityActionMessage = $state('');
  let bodyIdentityActionError = $state('');
  let isBodyIdentitySaving = $state(false);
  let faceNameDraft = $state('');
  let faceSelectedPersonId = $state('');
  let faceActionMessage = $state('');
  let faceActionError = $state('');
  let identityCorrectionUndoDecisionId = $state('');
  let isFaceActionSaving = $state(false);
  let faceBoxDrafts = $state<Record<string, FaceBox>>({});
  let faceBoxDragState = $state<FaceBoxDragState>();
  let bodyBoxDrafts = $state<Record<string, BodyBox>>({});
  let bodyBoxDragState = $state<BodyBoxDragState>();
  let hoveredFaceId = $state('');
  let hoveredBodyId = $state('');
  let candidateAcceptingFaceId = $state('');
  let observationActionMessage = $state('');
  let observationActionError = $state('');
  let observationUndoDecisionId = $state('');
  let isObservationActionSaving = $state(false);
  let faceBucketDraft = $state<FaceBucketDraft>('face_only');
  let isLaterPickerOpen = $state(false);
  let isEditingFaceName = $state(false);
  let faceMatches = $state<CimmichFaceOwnerReviewMatch[]>([]);
  let faceMatchesError = $state('');
  let faceMatchesLoading = $state(false);
  let faceMatchesForId = $state('');
  let clearIdentityConfirmId = $state('');
  let rejectCandidateConfirmId = $state('');
  let bulkNameDrafts = $state<Record<string, string>>({});
  let bulkActionMessage = $state('');
  let bulkActionError = $state('');
  let isBulkSaving = $state(false);
  let isAddingFace = $state(false);
  let bulkPanelX = $state<number>();
  let bulkPanelY = $state(144);
  let isDraggingBulkPanel = $state(false);
  let bulkPanelDragOffsetX = $state(0);
  let bulkPanelDragOffsetY = $state(0);

  const normalizeName = (value: string | undefined) => (value ?? '').trim().replaceAll(/\s+/g, ' ');
  const personPhotoContext = $derived(getCimmichPersonPhotoContext(page.url));
  const photoContexts = $derived(evidence?.contexts ?? []);
  const thingRegions = $derived(evidence?.thingRegions ?? []);
  const ownerSummary = $derived(evidence?.ownerSummary);
  const displayedPhotoContexts = $derived.by(() => {
    const spatialThings = new Set(thingRegions.map((tag) => tag.entityId));
    return photoContexts.filter((context) => context.entityKind !== 'object' || !spatialThings.has(context.entityId));
  });
  const availableContextOptions = $derived.by(() => {
    const attached = new Set(photoContexts.map((context) => context.entityId));
    const query = normalizeName(contextQuery).toLocaleLowerCase();
    return contextOptions
      .filter((context) => context.entityKind !== 'object')
      .filter((context) => contextAddKind && context.entityKind === contextAddKind)
      .filter((context) => !attached.has(context.entityId))
      .filter(
        (context) =>
          !query ||
          context.displayName.toLocaleLowerCase().includes(query) ||
          context.aliases.some((alias) => alias.toLocaleLowerCase().includes(query)),
      )
      .slice(0, 12);
  });
  const availableObjectOptions = $derived.by(() => {
    const tagged = new Set(thingRegions.map((tag) => tag.entityId));
    const query = normalizeName(objectRegionQuery).toLocaleLowerCase();
    return contextOptions
      .filter((context) => context.entityKind === 'object' && !tagged.has(context.entityId))
      .filter(
        (context) =>
          !query ||
          context.displayName.toLocaleLowerCase().includes(query) ||
          context.aliases.some((alias) => alias.toLocaleLowerCase().includes(query)),
      )
      .slice(0, 12);
  });
  const selectedObjectOption = $derived(
    contextOptions.find((context) => context.entityKind === 'object' && context.entityId === objectSelectedEntityId),
  );

  const people = $derived.by(() => {
    const names = new SvelteSet<string>();
    for (const name of evidence?.summary?.sourcePeople ?? []) {
      names.add(name);
    }
    for (const name of evidence?.summary?.candidatePeople ?? []) {
      names.add(name);
    }
    for (const row of evidence?.stateRows ?? []) {
      if (row.personName) {
        names.add(row.personName);
      }
    }

    return [...names].sort((a, b) => a.localeCompare(b));
  });
  const holdingPeople = $derived(evidence?.holdingPeople ?? []);
  const isCimmichEvidence = $derived(evidence?.provider === 'cimmich');
  const evidenceBrand = $derived(isCimmichEvidence ? 'Cimmich' : 'Imported evidence');

  const candidatePeople = $derived(evidence?.summary?.candidatePeople ?? []);
  const bodyPeople = $derived(evidence?.summary?.bodyContextPeople ?? []);
  const bodyRows = $derived(
    (evidence?.stateRows ?? []).filter((row) => row.family === 'body_context' || row.family === 'body_marker'),
  );

  const faceOverlays = $derived(evidence?.faceOverlays ?? []);
  const bodyOverlays = $derived(evidence?.bodyOverlays ?? []);
  const sourcePresenceOverlays = $derived(evidence?.sourcePresenceOverlays ?? []);
  const selectedFace = $derived(faceOverlays.find((face) => face.id === selectedFaceId));
  const selectedBody = $derived(bodyOverlays.find((body) => body.id === selectedBodyId));
  const bodyPersonOptions = $derived(
    manualTagSubjects
      .filter((subject) => subject.kind === 'person')
      .filter((subject) =>
        normalizeName(subject.name).toLowerCase().includes(normalizeName(bodyPersonQuery).toLowerCase()),
      )
      .slice(0, 6),
  );
  const bodySelectedPerson = $derived(
    manualTagSubjects.find((subject) => subject.kind === 'person' && subject.id === bodySelectedPersonId),
  );
  const step2Item = $derived(step2Readback?.item);
  const step2HasConsequentialReview = $derived(
    Boolean(
      step2Item &&
      (step2Item.captureContext.temporalClashIds.length > 0 ||
        step2Item.contextResolutionRequests.length > 0 ||
        step2Item.identity.clauses.some(
          (clause) =>
            clause.negative_scopes.length > 0 ||
            clause.evidence_class.endsWith('_reviewed_sequence_identity_candidate'),
        ) ||
        step2Item.identity.localFaces.some((face) => face.sequence_identity_candidate?.status === 'reject_candidate')),
    ),
  );
  const step2SummaryText = $derived(
    step2Item
      ? step2Item.enhancedVisualQc?.summary ||
          `${step2Item.summaryInput.event_clause} — ${step2Item.summaryInput.reconciled_scene_correction || step2Item.summaryInput.scene_clause}`
      : '',
  );
  const knownNameOptions = $derived.by(() => {
    const names = new SvelteSet<string>();
    for (const name of evidence?.knownPeople ?? []) {
      names.add(name);
    }
    for (const name of people) {
      names.add(name);
    }
    for (const face of faceOverlays) {
      if (face.name) {
        names.add(face.name);
      }
    }
    for (const photo of Object.values(bundle?.photos ?? {})) {
      for (const name of photo.summary?.sourcePeople ?? []) {
        names.add(name);
      }
      for (const name of photo.summary?.candidatePeople ?? []) {
        names.add(name);
      }
      for (const face of photo.faceOverlays ?? []) {
        if (face.name) {
          names.add(face.name);
        }
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  });

  type OverlayFaceUpdatePayload = Omit<Parameters<typeof updateCimmichFace>[0], 'action'> & {
    action: Parameters<typeof updateCimmichFace>[0]['action'] | 'clear_identity';
  };

  const updateOverlayFace = async (payload: OverlayFaceUpdatePayload) => {
    if (!isCimmichEvidence) {
      if (payload.action === 'clear_identity') {
        throw new Error('Clearing identity is only available in Cimmich');
      }
      return updateCimmichFace(payload as Parameters<typeof updateCimmichFace>[0]);
    }
    if (payload.action === 'clear_identity' && payload.faceId) {
      const face = faceOverlays.find((item) => item.id === payload.faceId);
      if (!face?.identityClaimId) {
        throw new Error('Accepted Cimmich identity claim not found');
      }
      const correction = await rejectCimmichAcceptedIdentity(
        face.identityClaimId,
        createCimmichIdentityCorrectionCommandId('photo-not-this-person'),
      );
      const history = await getCimmichIdentityCorrectionHistory(face.identityClaimId);
      identityCorrectionUndoDecisionId =
        history.items.find(
          (item) => item.decisionId === correction.decisionId && item.undo.eligible && item.undo.decisionId,
        )?.undo.decisionId ?? '';
      const refreshed = await getCimmichEvidenceForAsset(asset);
      if (!refreshed.evidence) {
        throw new Error('Cimmich identity removed but the photo evidence did not reload');
      }
      return {
        bundle: refreshed.bundle,
        evidence: refreshed.evidence,
        event: {
          action: 'clear_identity' as const,
          at: new Date().toISOString(),
          faceId: payload.faceId,
          previousName: face.name,
          scope: 'cimmich',
        },
      };
    }
    if (payload.action === 'reject_name_candidate' && payload.faceId) {
      const face = faceOverlays.find((item) => item.id === payload.faceId);
      if (!face?.candidateClaimId) {
        throw new Error('Cimmich identity candidate not found');
      }
      await decideCimmichIdentityCandidate(face.candidateClaimId, 'reject');
      const refreshed = await getCimmichEvidenceForAsset(asset);
      if (!refreshed.evidence) {
        throw new Error('Candidate rejected but the photo evidence did not reload');
      }
      return {
        bundle: refreshed.bundle,
        evidence: refreshed.evidence,
        event: {
          action: 'reject_name_candidate' as const,
          at: new Date().toISOString(),
          faceId: payload.faceId,
          previousName: face.candidateName,
          scope: 'cimmich',
        },
      };
    }
    if (payload.action !== 'rename' || !payload.faceId || !payload.name) {
      throw new Error('This Cimmich view currently supports existing-Person name reassignment only');
    }
    const normalizedName = normalizeName(payload.name);
    const existingPerson = manualTagSubjects.find(
      (subject) =>
        subject.kind === 'person' &&
        normalizeName(subject.name).toLocaleLowerCase() === normalizedName.toLocaleLowerCase(),
    );
    const knownPersonName = knownNameOptions.find(
      (name) => normalizeName(name).toLocaleLowerCase() === normalizedName.toLocaleLowerCase(),
    );
    const selector: CimmichFaceIdentitySelector = faceSelectedPersonId
      ? { personId: faceSelectedPersonId }
      : existingPerson
        ? { personId: existingPerson.id }
        : knownPersonName
          ? { personName: knownPersonName }
          : { newPersonName: normalizedName };
    const identity = await setCimmichFaceIdentity(payload.faceId, selector);
    const refreshed = await getCimmichEvidenceForAsset(asset);
    if (!refreshed.evidence) {
      throw new Error('Cimmich identity saved but the photo evidence did not reload');
    }
    return {
      bundle: refreshed.bundle,
      evidence: refreshed.evidence,
      event: {
        action: 'rename' as const,
        createdPerson: identity.createdPerson,
        faceId: payload.faceId,
        name: payload.name,
        personId: identity.personId,
        scope: 'cimmich',
      },
    };
  };

  const refreshDetailedEvidence = async () => {
    const refreshed = await getCimmichEvidenceForAsset(asset);
    if (!refreshed.evidence) {
      throw new Error('The detailed photo evidence did not reload');
    }
    evidence = refreshed.evidence;
    bundle = refreshed.bundle;
  };

  const undoAcceptedIdentityCorrection = async () => {
    if (!identityCorrectionUndoDecisionId) {
      return;
    }
    isFaceActionSaving = true;
    faceActionError = '';
    try {
      await undoCimmichIdentityCorrection(
        identityCorrectionUndoDecisionId,
        createCimmichIdentityCorrectionCommandId('photo-not-this-person-undo'),
      );
      identityCorrectionUndoDecisionId = '';
      await refreshDetailedEvidence();
      faceActionMessage = 'Name restored.';
    } catch (error) {
      faceActionError = error instanceof Error ? error.message : 'Unable to undo the identity correction';
    } finally {
      isFaceActionSaving = false;
    }
  };

  const acceptFaceCandidate = async (
    face: CimmichFaceOverlay,
    candidate: NonNullable<CimmichFaceOverlay['candidateMatches']>[number],
  ) => {
    candidateAcceptingFaceId = face.id;
    observationActionError = '';
    observationActionMessage = '';
    try {
      await setCimmichFaceIdentity(face.id, { personId: candidate.personId });
      await refreshDetailedEvidence();
      selectedFaceId = face.id;
      observationActionMessage = `${candidate.personName} accepted for this Face.`;
    } catch (error) {
      observationActionError = error instanceof Error ? error.message : 'Unable to accept this Face match';
    } finally {
      candidateAcceptingFaceId = '';
    }
  };

  const applyFaceReviewDisposition = async (face: CimmichFaceOverlay, disposition: 'active' | 'later' | 'unknown') => {
    isFaceActionSaving = true;
    faceActionError = '';
    try {
      await setCimmichFaceReviewDisposition(
        face.id,
        disposition,
        createCimmichIdentityCorrectionCommandId(`face-review-${disposition}`),
      );
      await refreshDetailedEvidence();
      selectedFaceId = face.id;
      faceActionMessage =
        disposition === 'later'
          ? 'Saved for later review.'
          : disposition === 'unknown'
            ? 'Marked as an unknown person. The Face remains available to review.'
            : 'Returned to active review.';
    } catch (error) {
      faceActionError = error instanceof Error ? error.message : 'Unable to update this Face review';
    } finally {
      isFaceActionSaving = false;
    }
  };

  const restoreRejectedFaceCandidate = async (face: CimmichFaceOverlay) => {
    if (!face.rejectedClaimId) {
      return;
    }
    isFaceActionSaving = true;
    faceActionError = '';
    try {
      await decideCimmichIdentityCandidate(face.rejectedClaimId, 'restore');
      await refreshDetailedEvidence();
      selectedFaceId = face.id;
      faceActionMessage = `${face.rejectedName || 'Suggestion'} restored for review.`;
    } catch (error) {
      faceActionError = error instanceof Error ? error.message : 'Unable to restore this suggestion';
    } finally {
      isFaceActionSaving = false;
    }
  };

  const loadFaceMatches = async (face: CimmichFaceOverlay) => {
    if (!isCimmichEvidence) {
      return;
    }
    faceMatchesForId = face.id;
    faceMatches = [];
    faceMatchesError = '';
    faceMatchesLoading = true;
    try {
      const matches = await getCimmichFaceMatches(face.id, 6);
      if (faceMatchesForId === face.id) {
        faceMatches = matches;
      }
    } catch (error) {
      if (faceMatchesForId === face.id) {
        faceMatchesError = error instanceof Error ? error.message : 'Unable to load closest matches';
      }
    } finally {
      if (faceMatchesForId === face.id) {
        faceMatchesLoading = false;
      }
    }
  };

  const bulkFaces = $derived.by(() =>
    [...faceOverlays]
      .filter((face) => face.status !== 'rejected' || showRejectedFaces || face.bucket === 'reject_manual_not_face')
      .sort((a, b) => {
        const aCenter = (a.bbox.x1 + a.bbox.x2) / 2;
        const bCenter = (b.bbox.x1 + b.bbox.x2) / 2;
        return aCenter - bCenter;
      }),
  );

  const bulkChangedCount = $derived(
    bulkFaces.filter((face) => normalizeName(bulkNameDrafts[face.id]) !== normalizeName(face.name)).length,
  );

  const visibleFaceOverlays = $derived(
    faceOverlays.filter((face) => {
      if (face.id === selectedFaceId) {
        return true;
      }
      if (face.status === 'named') {
        return showNamedFaces;
      }
      if (face.status === 'untagged') {
        return showUntaggedFaces;
      }
      if (face.status === 'rejected') {
        return showRejectedFaces;
      }
      return showSidecarOnlyFaces;
    }),
  );
  const namedPeopleFaceOverlays = $derived(faceOverlays.filter(isNamedFace));
  const manualTagObservationIds = $derived(
    manualSubjectTagItems.flatMap((tag) => (tag.observationId ? [tag.observationId] : [])),
  );
  const taggableFaceOverlays = $derived(
    faceOverlays.filter((face) => face.status !== 'rejected' && !manualTagObservationIds.includes(face.id)),
  );
  const manualPetIcon = (subjectId: string) => manualPetIcons[subjectId] ?? mdiPawOutline;
  const selectedManualTag = $derived(manualSubjectTagItems.find((tag) => tag.tagId === selectedManualTagId));
  const manualTagSelectedSubject = $derived(
    manualTagSubjects.find((subject) => subject.id === manualTagSelectedSubjectId) ??
      (selectedManualTag?.subject.subjectId === manualTagSelectedSubjectId
        ? {
            id: selectedManualTag.subject.subjectId,
            kind: selectedManualTag.subject.subjectKind,
            name: selectedManualTag.subject.displayName,
          }
        : undefined),
  );
  const presenceSelectedSubject = $derived(
    manualTagSubjects.find((subject) => subject.id === presenceSelectedSubjectId),
  );
  const regionlessPresenceItems = $derived(manualPresenceItems.filter((item) => item.geometry === null));
  const presenceSubjectMatches = $derived.by(() => {
    const query = normalizeName(presenceQuery).toLocaleLowerCase();
    return manualTagSubjects
      .filter((subject) => !query || subject.name.toLocaleLowerCase().includes(query))
      .slice(0, 8);
  });
  const manualTagSubjectMatches = $derived.by(() => {
    const query = normalizeName(manualTagQuery).toLocaleLowerCase();
    return manualTagSubjects
      .filter((subject) => !query || subject.name.toLocaleLowerCase().includes(query))
      .slice(0, 8);
  });
  const normalizedManualTagQuery = $derived(normalizeName(manualTagQuery));
  const manualTagExactSubject = $derived(findExactManualPhotoTagPerson(manualTagSubjects, normalizedManualTagQuery));
  const canCreateManualTagPerson = $derived(
    Boolean(
      normalizedManualTagQuery && !manualTagExactSubject && !isManualTagSubjectsLoading && !manualTagSubjectsError,
    ),
  );
  const localizedManualTags = $derived(manualSubjectTagItems.filter((tag) => tag.geometry));
  const localizedManualBodyAndHeadTags = $derived(
    localizedManualTags.filter((tag) => tag.tagType === 'body' || tag.tagType === 'head'),
  );
  const localizedManualOverlayTags = $derived(localizedManualTags.filter((tag) => tag.tagType !== 'presence'));
  const localizedManualPresenceTags = $derived(
    manualSubjectTagItems.filter((tag) => tag.tagType === 'presence' && tag.geometry),
  );
  const manualTagSummary = $derived(projectTypedManualTagSummary(manualSubjectTagItems));
  const manualFaceTagCount = $derived(manualTagSummary.faceCount);
  const manualBodyTagCount = $derived(manualTagSummary.bodyCount);
  const manualHeadTagCount = $derived(manualTagSummary.headCount);
  const manualPresenceTagCount = $derived(manualTagSummary.presenceCount);
  const namedTaggableFaceCount = $derived(taggableFaceOverlays.filter((face) => face.status === 'named').length);
  const unassignedTaggableFaceCount = $derived(taggableFaceOverlays.length - namedTaggableFaceCount);
  const manualPresenceNames = $derived(manualTagSummary.presenceNames);
  const manualPresenceLegendLabel = $derived(
    `Presence ${manualPresenceTagCount}${manualPresenceNames.length > 0 ? ` · ${manualPresenceNames.join(', ')}` : ''}`,
  );

  const visibleBodyOverlays = $derived(
    bodyOverlays.filter((body) => {
      if (body.id === selectedBodyId) {
        return true;
      }
      if (body.status === 'linked') {
        return showLinkedBodies;
      }
      return showUnlinkedBodies;
    }),
  );
  const visibleSpatialBodyOverlays = $derived(visibleBodyOverlays.filter(isRenderableBodyPoseOverlay));
  const visibleBodyOverlayUrls = $derived.by(() => {
    const urls = new SvelteSet<string>();
    for (const body of visibleSpatialBodyOverlays) {
      const hasVectorSkeleton = (body.keypoints ?? []).some(Boolean);
      if (body.overlayUrl && !hasVectorSkeleton) {
        urls.add(body.overlayUrl);
      }
    }
    return [...urls];
  });
  const visibleMatchFaceOverlays = $derived(
    faceOverlays.filter((face) => face.status !== 'rejected' || showRejectedFaces),
  );
  const bodyColorKeys = $derived.by(() => {
    const keys = new SvelteSet<string>();
    for (const body of bodyOverlays) {
      keys.add(bodyColorKey(body));
    }
    return [...keys].sort((a, b) => a.localeCompare(b));
  });
  const bodyByFaceId = $derived.by(() => {
    const linkedBodies = new SvelteMap<string, CimmichBodyOverlay>();
    for (const body of bodyOverlays) {
      if (body.linkedFaceId) {
        linkedBodies.set(body.linkedFaceId, body);
      }
      const sourceFaceId = bodyIdentityEvidence(body).identityLinkEvidence?.sourceId;
      if (sourceFaceId && !linkedBodies.has(sourceFaceId)) {
        linkedBodies.set(sourceFaceId, body);
      }
    }
    return linkedBodies;
  });
  const primaryBodyLabelByIdentity = $derived.by(() => {
    const primaryBodies = new SvelteMap<string, CimmichBodyOverlay>();
    const bodyArea = (body: CimmichBodyOverlay) =>
      Math.max(0, body.bbox.x2 - body.bbox.x1) * Math.max(0, body.bbox.y2 - body.bbox.y1);
    const bodyIdentityScore = (body: CimmichBodyOverlay) => {
      const evidence = bodyIdentityEvidence(body).identityLinkEvidence;
      if (!evidence) {
        return bodyArea(body) / 100_000;
      }

      const numeric = (value: unknown) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
      };

      return (
        numeric(evidence.headIou) * 1000 +
        numeric(evidence.bodyFaceCoverage) * 500 +
        numeric(evidence.headFaceCoverage) * 250 +
        numeric(evidence.score) +
        bodyArea(body) / 100_000
      );
    };

    for (const body of bodyOverlays) {
      if (body.status !== 'linked' || !bodyIdentityName(body)) {
        continue;
      }

      const sourceFaceId = body.linkedFaceId || bodyIdentityEvidence(body).identityLinkEvidence?.sourceId || '';
      const identityKey = sourceFaceId || bodyIdentityName(body).toLowerCase();
      const current = primaryBodies.get(identityKey);
      if (!current || bodyIdentityScore(body) > bodyIdentityScore(current)) {
        primaryBodies.set(identityKey, body);
      }
    }

    return primaryBodies;
  });

  const imageMetrics = $derived.by(() => {
    if (overlayWidth <= 0 || overlayHeight <= 0) {
      return undefined;
    }

    const evidenceImage =
      faceOverlays.find((face) => face.image?.width && face.image?.height)?.image ??
      bodyOverlays.find((body) => body.image?.width && body.image?.height)?.image;
    const imageWidth = evidenceImage?.width || assetViewerManager.imgRef?.naturalWidth || 0;
    const imageHeight = evidenceImage?.height || assetViewerManager.imgRef?.naturalHeight || 0;
    if (imageWidth <= 0 || imageHeight <= 0) {
      return undefined;
    }

    const fitted = scaleToFit(
      { width: imageWidth, height: imageHeight },
      { width: overlayWidth, height: overlayHeight },
    );
    return {
      imageWidth,
      imageHeight,
      offsetX: (overlayWidth - fitted.width) / 2,
      offsetY: (overlayHeight - fitted.height) / 2,
      width: fitted.width,
      height: fitted.height,
    };
  });

  const faceBox = (face: CimmichFaceOverlay) => faceBoxDrafts[face.id] ?? face.bbox;
  const bodyBox = (body: CimmichBodyOverlay) => bodyBoxDrafts[body.id] ?? body.bbox;
  const fittedImageStyle = $derived(
    imageMetrics
      ? `left: ${imageMetrics.offsetX}px; top: ${imageMetrics.offsetY}px; width: ${imageMetrics.width}px; height: ${imageMetrics.height}px;`
      : '',
  );
  const spatialOverlayStyle = $derived(projectPhotoOverlayZoomStyle(assetViewerManager.zoomState));

  const manualTagGeometryStyle = (geometry: ManualPhotoTagGeometry | undefined) => {
    if (!imageMetrics || !geometry) {
      return '';
    }
    return `left: ${imageMetrics.offsetX + geometry.x * imageMetrics.width}px; top: ${imageMetrics.offsetY + geometry.y * imageMetrics.height}px; width: ${geometry.w * imageMetrics.width}px; height: ${geometry.h * imageMetrics.height}px;`;
  };

  const manualTagDraftStyle = $derived(manualTagGeometryStyle(manualTagDraft));
  const manualTagEditGeometryStyle = $derived(manualTagGeometryStyle(manualTagEditGeometry));

  const manualTagPanelPosition = (geometry: { h: number; w: number; x: number; y: number }) => {
    if (!imageMetrics) {
      return '';
    }
    const markerRight = imageMetrics.offsetX + (geometry.x + geometry.w) * imageMetrics.width;
    const markerTop = imageMetrics.offsetY + geometry.y * imageMetrics.height;
    const { left, maxHeight, top, width } = placeManualTagPanel({
      marker: { right: markerRight, top: markerTop },
      overlay: { height: overlayHeight, width: overlayWidth },
    });
    return `left: ${left}px; top: ${top}px; width: ${width}px; max-height: ${maxHeight}px;`;
  };

  const manualTagPanelStyle = $derived(manualTagDraft ? manualTagPanelPosition(manualTagDraft) : '');
  const manualTagDetailsStyle = $derived(
    selectedManualTag ? manualTagPanelPosition(manualTagEditGeometry ?? selectedManualTag.geometry) : '',
  );

  const manualTagEditChanged = $derived.by(() => {
    if (!selectedManualTag || !manualTagEditGeometry || !manualTagSelectedSubject || !manualTagType) {
      return false;
    }
    return (
      manualTagType !== selectedManualTag.tagType ||
      manualTagSelectedSubject.id !== selectedManualTag.subject.subjectId ||
      manualTagSelectedSubject.kind !== selectedManualTag.subject.subjectKind ||
      JSON.stringify(manualTagEditGeometry) !== JSON.stringify(selectedManualTag.geometry)
    );
  });

  const manualSubjectTagMarkerStyle = (tag: CimmichManualSubjectTag) => {
    if (!imageMetrics) {
      return '';
    }
    const centerX = tag.geometry.x + tag.geometry.w / 2;
    const centerY = tag.geometry.y + tag.geometry.h / 2;
    return `left: ${imageMetrics.offsetX + centerX * imageMetrics.width}px; top: ${imageMetrics.offsetY + centerY * imageMetrics.height}px;`;
  };

  const manualTagTypeLabel = (tagType: CimmichManualSubjectTagType) =>
    tagType === 'face' ? 'Face' : tagType === 'body' ? 'Body' : tagType === 'head' ? 'Head' : 'Presence';

  const manualTagMatchingLabel = (tag: CimmichManualSubjectTag) => {
    if (tag.tagType !== 'face') {
      return '';
    }
    if (tag.matchingStatus === 'waiting_for_provider') {
      return 'Matching not processed yet';
    }
    if (tag.matchingStatus === 'processing') {
      return 'Matching is processing';
    }
    if (tag.matchingStatus === 'abstained') {
      return tag.matchingReason || 'Not suitable for matching';
    }
    return 'Matching inactive';
  };

  const faceBoxStyle = (face: CimmichFaceOverlay) => {
    if (!imageMetrics) {
      return '';
    }

    const bbox = faceBox(face);
    const left = imageMetrics.offsetX + (bbox.x1 / imageMetrics.imageWidth) * imageMetrics.width;
    const top = imageMetrics.offsetY + (bbox.y1 / imageMetrics.imageHeight) * imageMetrics.height;
    const width = ((bbox.x2 - bbox.x1) / imageMetrics.imageWidth) * imageMetrics.width;
    const height = ((bbox.y2 - bbox.y1) / imageMetrics.imageHeight) * imageMetrics.height;
    return `left: ${left}px; top: ${top}px; width: ${width}px; height: ${height}px;`;
  };

  const bodyBoxStyle = (body: CimmichBodyOverlay) => {
    if (!imageMetrics) {
      return '';
    }

    const bbox = bodyBox(body);
    const left = imageMetrics.offsetX + (bbox.x1 / imageMetrics.imageWidth) * imageMetrics.width;
    const top = imageMetrics.offsetY + (bbox.y1 / imageMetrics.imageHeight) * imageMetrics.height;
    const width = ((bbox.x2 - bbox.x1) / imageMetrics.imageWidth) * imageMetrics.width;
    const height = ((bbox.y2 - bbox.y1) / imageMetrics.imageHeight) * imageMetrics.height;
    return `left: ${left}px; top: ${top}px; width: ${width}px; height: ${height}px;`;
  };

  const faceLabelStyle = (face: CimmichFaceOverlay) => {
    if (!imageMetrics) {
      return '';
    }

    const bbox = faceBox(face);
    const centerX = imageMetrics.offsetX + ((bbox.x1 + bbox.x2) / 2 / imageMetrics.imageWidth) * imageMetrics.width;
    const top = imageMetrics.offsetY + (bbox.y1 / imageMetrics.imageHeight) * imageMetrics.height;
    const linkedBody = bodyByFaceId.get(face.id);
    const labelIndex = Math.max(
      0,
      visibleFaceOverlays
        .filter((candidate) => candidate.id !== face.id)
        .filter((candidate) => {
          const candidateBox = faceBox(candidate);
          const candidateCenterX =
            imageMetrics.offsetX +
            ((candidateBox.x1 + candidateBox.x2) / 2 / imageMetrics.imageWidth) * imageMetrics.width;
          const candidateTop =
            imageMetrics.offsetY + (candidateBox.y1 / imageMetrics.imageHeight) * imageMetrics.height;
          return (
            Math.abs(candidateCenterX - centerX) < 220 &&
            Math.abs(candidateTop - top) < 48 &&
            candidateCenterX <= centerX
          );
        }).length,
    );
    const laneOffset = Math.min(3, labelIndex) * 18;
    const labelAnchor = top - 8 - laneOffset;
    return `left: ${centerX}px; top: ${Math.max(76, labelAnchor)}px; ${linkedBody ? bodyColorStyle(linkedBody) : ''}`;
  };

  const faceMarkerStyle = (face: CimmichFaceOverlay) => {
    if (!imageMetrics) {
      return '';
    }

    const bbox = faceBox(face);
    const centerX = imageMetrics.offsetX + ((bbox.x1 + bbox.x2) / 2 / imageMetrics.imageWidth) * imageMetrics.width;
    const centerY = imageMetrics.offsetY + ((bbox.y1 + bbox.y2) / 2 / imageMetrics.imageHeight) * imageMetrics.height;
    return `left: ${centerX}px; top: ${centerY}px;`;
  };

  const bodyDetailsStyle = (body: CimmichBodyOverlay) => {
    if (!imageMetrics) {
      return '';
    }

    const bbox = bodyBox(body);
    const centerX = imageMetrics.offsetX + ((bbox.x1 + bbox.x2) / 2 / imageMetrics.imageWidth) * imageMetrics.width;
    const bodyTop = imageMetrics.offsetY + (bbox.y1 / imageMetrics.imageHeight) * imageMetrics.height;
    const bottom = imageMetrics.offsetY + (bbox.y2 / imageMetrics.imageHeight) * imageMetrics.height;
    const left = Math.min(Math.max(12, centerX - 130), Math.max(12, overlayWidth - 272));
    const panelHeight = Math.min(292, Math.max(180, overlayHeight - 96));
    const belowTop = bottom + 10;
    const aboveTop = bodyTop - panelHeight - 10;
    const preferredTop = belowTop + panelHeight <= overlayHeight - 12 ? belowTop : aboveTop;
    const top = Math.min(Math.max(76, preferredTop), Math.max(76, overlayHeight - panelHeight - 12));
    return `left: ${left}px; top: ${top}px; max-height: ${panelHeight}px;`;
  };

  const bodyLabelStyle = (body: CimmichBodyOverlay) => {
    if (!imageMetrics) {
      return '';
    }

    const bbox = bodyBox(body);
    const centerX = imageMetrics.offsetX + ((bbox.x1 + bbox.x2) / 2 / imageMetrics.imageWidth) * imageMetrics.width;
    const bodyAnchorY = bbox.y1 + (bbox.y2 - bbox.y1) * 0.38;
    const top = imageMetrics.offsetY + (bodyAnchorY / imageMetrics.imageHeight) * imageMetrics.height;
    const labelCenterX = Math.min(Math.max(90, centerX), Math.max(90, overlayWidth - 90));
    return `left: ${labelCenterX}px; top: ${Math.max(92, top)}px; ${bodyColorStyle(body)}`;
  };

  const bodyPoint = (point: [number, number]) => {
    if (!imageMetrics) {
      return { x: 0, y: 0 };
    }
    return {
      x: imageMetrics.offsetX + (point[0] / imageMetrics.imageWidth) * imageMetrics.width,
      y: imageMetrics.offsetY + (point[1] / imageMetrics.imageHeight) * imageMetrics.height,
    };
  };

  const bodySkeletonPairs = [
    [5, 6],
    [5, 7],
    [7, 9],
    [6, 8],
    [8, 10],
    [5, 11],
    [6, 12],
    [11, 12],
    [11, 13],
    [13, 15],
    [12, 14],
    [14, 16],
  ] as const;

  const bodySkeletonJointIndexes = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] as const;
  const bodyPalette = [
    '34 211 238',
    '168 85 247',
    '251 146 60',
    '244 114 182',
    '132 204 22',
    '96 165 250',
    '250 204 21',
    '45 212 191',
    '248 113 113',
    '192 132 252',
  ] as const;

  const isGenericBodyLabel = (value: string | undefined) => {
    const normalized = normalizeName(value).toLowerCase();
    return (
      !normalized ||
      normalized === 'linked body' ||
      normalized === 'unlinked body' ||
      normalized === 'body candidate' ||
      /^body\s+\d+$/.test(normalized)
    );
  };

  const bodyIdentityEvidence = (body: CimmichBodyOverlay) =>
    body as CimmichBodyOverlay & {
      continuityTriage?: { candidateNames?: string[] };
      identityLinkEvidence?: {
        bodyFaceCoverage?: number | string;
        candidateType?: string;
        headFaceCoverage?: number | string;
        headIou?: number | string;
        name?: string;
        reason?: string;
        score?: number | string;
        sourceId?: string;
        sourceLabel?: string;
      };
    };

  const bodyIdentityName = (body: CimmichBodyOverlay) => {
    const evidenceBody = bodyIdentityEvidence(body);
    const candidates = [
      body.linkedName,
      isGenericBodyLabel(body.label) ? '' : body.label,
      evidenceBody.identityLinkEvidence?.name,
      evidenceBody.identityLinkEvidence?.sourceLabel,
      body.bodyOutfitReid?.bestName,
      evidenceBody.continuityTriage?.candidateNames?.[0],
    ];
    return normalizeName(candidates.find((name) => !isGenericBodyLabel(name)));
  };

  const bodyIdentityMode = (body: CimmichBodyOverlay): BodyIdentityMode => {
    if (body.status !== 'linked' || !bodyIdentityName(body)) {
      return 'unlinked';
    }

    if (body.linkSource === 'user') {
      return 'user_tag';
    }

    const evidence = bodyIdentityEvidence(body).identityLinkEvidence;
    const faceLinked =
      Boolean(body.linkedFaceId) ||
      body.linkReason.toLowerCase().includes('face') ||
      body.linkStatus === 'linked_to_named_face' ||
      evidence?.candidateType === 'accepted_face';
    return faceLinked ? 'face_match' : 'implied';
  };

  const manualSubjectTagTypes = (subject: ManualPhotoTagSubject) =>
    projectPhotoTagTypes(subject, {
      bodies: [
        ...bodyOverlays.filter((body) => body.status === 'linked').map((body) => ({ name: bodyIdentityName(body) })),
        ...manualSubjectTagItems
          .filter((tag) => tag.tagType === 'body')
          .map((tag) => ({ name: tag.subject.displayName })),
      ],
      faces: [
        ...faceOverlays
          .filter((face) => face.status === 'named')
          .map((face) => ({ name: face.name, subjectId: face.personIdentityKey })),
        ...manualSubjectTagItems
          .filter((tag) => tag.tagType === 'face')
          .map((tag) => ({ name: tag.subject.displayName, subjectId: tag.subject.subjectId })),
      ],
      heads: manualSubjectTagItems
        .filter((tag) => tag.tagType === 'head')
        .map((tag) => ({ name: tag.subject.displayName, subjectId: tag.subject.subjectId })),
      presences: manualSubjectTagItems
        .filter((tag) => tag.tagType === 'presence')
        .map((tag) => ({ subjectId: tag.subject.subjectId })),
    });

  const peopleBodyOverlays = $derived(
    visibleBodyOverlays.filter(
      (body) =>
        isPrimaryBodyLabel(body) &&
        !body.linkedFaceId &&
        bodyIdentityMode(body) !== 'face_match' &&
        !localizedManualBodyAndHeadTags.some(
          (tag) =>
            tag.tagType === 'body' &&
            authoredBodyTagRepresentsOverlay(
              { bbox: body.bbox, image: body.image, name: bodyIdentityName(body) },
              { geometry: tag.geometry, name: tag.subject.displayName },
            ),
        ),
    ),
  );
  const namedPeopleBodyOverlays = $derived(peopleBodyOverlays.filter(isNamedBody));
  const primaryNamedPeopleFaceOverlays = $derived.by(() => {
    const seenPeople = new SvelteSet<string>();
    const faces: CimmichFaceOverlay[] = [];

    for (const face of namedPeopleFaceOverlays) {
      const identityKey = face.personIdentityKey || normalizeName(face.name).toLocaleLowerCase();
      if (!identityKey || seenPeople.has(identityKey)) {
        continue;
      }

      seenPeople.add(identityKey);
      faces.push(face);
    }

    return faces;
  });
  const primaryNamedPeopleBodyOverlays = $derived.by(() => {
    const representedNames = new SvelteSet(
      primaryNamedPeopleFaceOverlays.map((face) => normalizeName(face.name).toLocaleLowerCase()),
    );
    const bodies: CimmichBodyOverlay[] = [];

    for (const body of namedPeopleBodyOverlays) {
      const identityName = normalizeName(bodyIdentityName(body)).toLocaleLowerCase();
      if (!identityName || representedNames.has(identityName)) {
        continue;
      }

      representedNames.add(identityName);
      bodies.push(body);
    }

    return bodies;
  });
  const primaryManualPeopleTags = $derived.by(() => {
    const representedNames = new SvelteSet([
      ...primaryNamedPeopleFaceOverlays.map((face) => normalizeName(face.name).toLocaleLowerCase()),
      ...primaryNamedPeopleBodyOverlays.map((body) => normalizeName(bodyIdentityName(body)).toLocaleLowerCase()),
    ]);
    const tagsBySubject = new SvelteMap<string, CimmichManualSubjectTag>();

    for (const tag of localizedManualBodyAndHeadTags) {
      const subjectName = normalizeName(tag.subject.displayName).toLocaleLowerCase();
      if (!subjectName || representedNames.has(subjectName)) {
        continue;
      }

      const subjectKey = `${tag.subject.subjectKind}:${tag.subject.subjectId || subjectName}`;
      const current = tagsBySubject.get(subjectKey);
      if (!current || (current.tagType === 'body' && tag.tagType === 'head')) {
        tagsBySubject.set(subjectKey, tag);
      }
    }

    return [...tagsBySubject.values()];
  });
  const primarySpatialPeopleNames = $derived([
    ...primaryNamedPeopleFaceOverlays.map((face) => normalizeName(face.name).toLocaleLowerCase()),
    ...primaryNamedPeopleBodyOverlays.map((body) => normalizeName(bodyIdentityName(body)).toLocaleLowerCase()),
    ...primaryManualPeopleTags.map((tag) => normalizeName(tag.subject.displayName).toLocaleLowerCase()),
  ]);
  const primaryLocalizedManualPresenceTags = $derived.by(() => {
    const representedNames = new SvelteSet(primarySpatialPeopleNames);
    return localizedManualPresenceTags.filter((tag) => {
      const subjectName = normalizeName(tag.subject.displayName).toLocaleLowerCase();
      if (!subjectName || representedNames.has(subjectName)) {
        return false;
      }
      representedNames.add(subjectName);
      return true;
    });
  });
  const primaryRegionlessPresenceItems = $derived.by(() => {
    const representedNames = new SvelteSet([
      ...primarySpatialPeopleNames,
      ...primaryLocalizedManualPresenceTags.map((tag) => normalizeName(tag.subject.displayName).toLocaleLowerCase()),
    ]);
    return regionlessPresenceItems.filter((presence) => {
      const subjectName = normalizeName(presence.displayName).toLocaleLowerCase();
      if (!subjectName || representedNames.has(subjectName)) {
        return false;
      }
      representedNames.add(subjectName);
      return true;
    });
  });
  const namedPhotoPresence = $derived(
    projectNamedPhotoPresence(evidence?.stateRows ?? [], [
      ...primarySpatialPeopleNames,
      ...primaryLocalizedManualPresenceTags.map((tag) => tag.subject.displayName),
      ...primaryRegionlessPresenceItems.map((presence) => presence.displayName),
    ]),
  );
  const unlinkedBodyCandidateName = (body: CimmichBodyOverlay) => {
    const evidenceBody = bodyIdentityEvidence(body);
    return normalizeName(
      evidenceBody.identityLinkEvidence?.name ||
        body.bodyOutfitReid?.bestName ||
        evidenceBody.continuityTriage?.candidateNames?.[0],
    );
  };
  const bodyPeopleTagMode = (body: CimmichBodyOverlay) => {
    if (body.status !== 'linked') {
      return unlinkedBodyCandidateName(body) ? 'candidate' : 'unresolved';
    }
    const name = body.status === 'linked' ? bodyIdentityName(body) : unlinkedBodyCandidateName(body);
    if ((bodyIdentityMode(body) === 'implied' || bodyIdentityMode(body) === 'user_tag') && name) {
      return 'body-only';
    }
    if (name) {
      return 'candidate';
    }
    return 'unresolved';
  };
  const bodyPeopleTagLabel = (body: CimmichBodyOverlay) => {
    const mode = bodyPeopleTagMode(body);
    if (mode === 'unresolved') {
      return 'Unlinked body';
    }
    const name = bodyIdentityName(body);
    if (mode === 'body-only') {
      return name;
    }
    if (mode === 'candidate') {
      return `${name}?`;
    }
    return 'Unlinked body';
  };
  const facePeopleTagLabel = (face: CimmichFaceOverlay) => {
    if (face.status === 'named') {
      return face.name || face.label || 'Named person';
    }
    return faceCandidateDisplayName(face) ? `${faceCandidateDisplayName(face)}?` : 'Name / ignore';
  };
  const faceMatchesPersonContext = (face: CimmichFaceOverlay) =>
    matchesCimmichPersonPhotoContext(
      personPhotoContext,
      face.status === 'named' ? face.name || face.label : faceCandidateDisplayName(face),
    );
  const bodyMatchesPersonContext = (body: CimmichBodyOverlay) =>
    matchesCimmichPersonPhotoContext(personPhotoContext, bodyIdentityName(body) || unlinkedBodyCandidateName(body));
  const arrivalCueFace = $derived(namedPeopleFaceOverlays.find((face) => faceMatchesPersonContext(face)));
  const arrivalCueBody = $derived(
    arrivalCueFace
      ? undefined
      : namedPeopleBodyOverlays.find((body) => isRenderableBodyPoseOverlay(body) && bodyMatchesPersonContext(body)),
  );
  const machineFaceLabel = (face: CimmichFaceOverlay, linkedBody?: CimmichBodyOverlay) =>
    linkedBody ? `${facePeopleTagLabel(face)} · face + body` : `Face · ${facePeopleTagLabel(face)}`;
  const bestFaceCandidate = (face: CimmichFaceOverlay) => face.candidateMatches?.find((match) => match.displayEligible);
  const candidateSimilarityLabel = (score: number) => `${Math.round(score * 100)}%`;
  const machineBodyLabel = (body: CimmichBodyOverlay) => {
    const mode = bodyPeopleTagMode(body);
    if (mode === 'body-only') {
      return `${bodyIdentityName(body)} · body only`;
    }
    if (mode === 'candidate') {
      return `${bodyPeopleTagLabel(body)} · body only`;
    }
    return 'Unlinked body';
  };
  const machineFaceColorStyle = (face: CimmichFaceOverlay, linkedBody?: CimmichBodyOverlay) =>
    linkedBody
      ? bodyColorStyle(linkedBody)
      : face.status === 'named'
        ? '--cimmich-body-rgb: 74 222 128;'
        : '--cimmich-body-rgb: 251 191 36;';

  function bodyColorKey(body: CimmichBodyOverlay) {
    return bodyIdentityName(body) || body.id || body.label;
  }
  const bodyColorIndex = (body: CimmichBodyOverlay) => {
    const keyIndex = bodyColorKeys.indexOf(bodyColorKey(body));
    if (keyIndex !== -1) {
      return keyIndex % bodyPalette.length;
    }
    return [...bodyColorKey(body)].reduce((total, char) => total + (char.codePointAt(0) ?? 0), 0) % bodyPalette.length;
  };
  const bodyColorStyle = (body: CimmichBodyOverlay) => `--cimmich-body-rgb: ${bodyPalette[bodyColorIndex(body)]};`;

  const bodySkeletonSegments = (body: CimmichBodyOverlay) =>
    (body.keypointSkeleton?.length ? body.keypointSkeleton : bodySkeletonPairs).flatMap(([start, end]) => {
      const keypoints = body.keypoints ?? [];
      const a = keypoints[start];
      const b = keypoints[end];
      if (!a || !b) {
        return [];
      }
      return [{ a: bodyPoint(a), b: bodyPoint(b), key: `${start}:${end}` }];
    });

  const bodySkeletonJoints = (body: CimmichBodyOverlay) =>
    (body.keypointSkeleton?.length ? (body.keypoints?.map((_, index) => index) ?? []) : bodySkeletonJointIndexes)
      .map((index) => ({ index, point: body.keypoints?.[index] }))
      .filter(({ point }) => Boolean(point))
      .map(({ index, point }) => ({ ...bodyPoint(point!), key: index }));

  const bulkPanelDefaultLeft = $derived.by(() => Math.max(12, overlayWidth - Math.min(448, overlayWidth - 24) - 12));
  const bulkPanelStyle = $derived.by(() => {
    const width = Math.min(448, Math.max(320, overlayWidth - 24));
    const left = Math.min(Math.max(12, bulkPanelX ?? bulkPanelDefaultLeft), Math.max(12, overlayWidth - width - 12));
    const top = Math.min(Math.max(76, bulkPanelY), Math.max(76, overlayHeight - 220));
    return `left: ${left}px; top: ${top}px; width: ${width}px; max-height: calc(100% - ${top + 12}px);`;
  });

  const faceDetailsStyle = (face: CimmichFaceOverlay) => {
    if (!imageMetrics) {
      return '';
    }

    const bbox = faceBox(face);
    const faceLeft = imageMetrics.offsetX + (bbox.x1 / imageMetrics.imageWidth) * imageMetrics.width;
    const faceRight = imageMetrics.offsetX + (bbox.x2 / imageMetrics.imageWidth) * imageMetrics.width;
    const bottom = imageMetrics.offsetY + (bbox.y2 / imageMetrics.imageHeight) * imageMetrics.height;
    const placement = placeFaceDetailsPanel({
      editing: isEditingFaceName,
      face: { bottom, left: faceLeft, right: faceRight },
      overlay: { height: overlayHeight, width: overlayWidth },
      preferredWidth: isEditingFaceName ? 368 : Math.min(360, Math.max(260, 112 + face.label.length * 8)),
    });
    return `left: ${placement.left}px; top: ${placement.top}px; width: ${placement.width}px; max-height: ${placement.maxHeight}px;`;
  };

  const faceLinkedBody = (face: CimmichFaceOverlay) => bodyByFaceId.get(face.id);
  const faceSpatialBody = (face: CimmichFaceOverlay) => {
    const body = faceLinkedBody(face);
    return body && isRenderableBodyPoseOverlay(body) ? body : undefined;
  };
  const isFaceLinkEmphasized = (face: CimmichFaceOverlay) => {
    const linkedBody = faceLinkedBody(face);
    return (
      face.id === selectedFaceId ||
      face.id === hoveredFaceId ||
      Boolean(linkedBody && (linkedBody.id === selectedBodyId || linkedBody.id === hoveredBodyId))
    );
  };
  const isBodyLinkEmphasized = (body: CimmichBodyOverlay) =>
    body.id === selectedBodyId ||
    body.id === hoveredBodyId ||
    Boolean(body.linkedFaceId && (body.linkedFaceId === selectedFaceId || body.linkedFaceId === hoveredFaceId));

  const bodyLabel = (body: CimmichBodyOverlay) => bodyIdentityName(body) || body.label || 'Unlinked body';
  const bodyPersonProfileHref = (body: CimmichBodyOverlay) => {
    const sourceFaceId = body.linkedFaceId || bodyIdentityEvidence(body).identityLinkEvidence?.sourceId || '';
    const personId = faceOverlays.find((face) => face.id === sourceFaceId)?.personIdentityKey;
    return Route.cimmichPerson({ name: bodyIdentityName(body), personId });
  };
  const bodyReviewLabel = (body: CimmichBodyOverlay) => (body.status === 'linked' ? bodyLabel(body) : 'Body candidate');
  const isPrimaryBodyLabel = (body: CimmichBodyOverlay) => {
    if (body.status !== 'linked') {
      return true;
    }

    const sourceFaceId = body.linkedFaceId || bodyIdentityEvidence(body).identityLinkEvidence?.sourceId || '';
    const identityKey = sourceFaceId || bodyIdentityName(body).toLowerCase();
    return primaryBodyLabelByIdentity.get(identityKey)?.id === body.id || body.id === selectedBodyId;
  };
  const bodyLabelTitle = (body: CimmichBodyOverlay) => {
    const mode = bodyIdentityMode(body);
    const evidenceKind =
      mode === 'face_match'
        ? 'face-matched body identity'
        : mode === 'user_tag'
          ? 'user-tagged body identity'
          : mode === 'implied'
            ? 'body/context-implied identity'
            : 'unlinked body';
    return `${bodyReviewLabel(body)} - ${evidenceKind}; ${body.linkStatus.replaceAll('_', ' ')}`;
  };
  const bodyLabelClass = (body: CimmichBodyOverlay) => [
    'cimmich-body-label',
    `cimmich-body-label--${bodyIdentityMode(body).replaceAll('_', '-')}`,
    body.id === selectedBodyId ? 'cimmich-body-label--selected' : '',
  ];
  const faceBoxHandles: Array<{ label: string; mode: FaceBoxDragMode }> = [
    { label: 'Resize top left', mode: 'nw' },
    { label: 'Resize top', mode: 'n' },
    { label: 'Resize top right', mode: 'ne' },
    { label: 'Resize left', mode: 'w' },
    { label: 'Resize right', mode: 'e' },
    { label: 'Resize bottom left', mode: 'sw' },
    { label: 'Resize bottom', mode: 's' },
    { label: 'Resize bottom right', mode: 'se' },
  ];

  const bucketLabel = (bucket: string) => bucket.replace(/^face_/, '').replaceAll('_', ' ');
  const faceBucketFromOverlay = (face: CimmichFaceOverlay): FaceBucketDraft => {
    const bucket = face.bucket.replace(/^face_/, '');
    return bucket === 'head' || bucket === 'lq' || bucket === 'prime' || bucket === 'secondary' ? bucket : 'face_only';
  };
  const faceBucketValue = (bucket: FaceBucketDraft) => (bucket === 'face_only' ? null : bucket);
  const candidateFaceName = (face: CimmichFaceOverlay) => normalizeName(face.candidateName);
  const reviewCandidateFaceName = (face: CimmichFaceOverlay) => normalizeName(face.reviewCandidateName);
  const faceCandidateDisplayName = (face: CimmichFaceOverlay) =>
    candidateFaceName(face) || reviewCandidateFaceName(face);
  const displayGuess = (face: CimmichFaceOverlay) =>
    face.name || faceCandidateDisplayName(face) || (face.status === 'rejected' ? 'Noise' : face.label || 'Unknown');
  const faceDisplayLabel = (face: CimmichFaceOverlay) => {
    if (face.status === 'named') {
      return face.name || face.label || 'Named face';
    }
    if (face.status === 'untagged') {
      return faceCandidateDisplayName(face)
        ? `${faceCandidateDisplayName(face)}?`
        : face.label?.replace(/^Review:\s*/i, 'Candidate: ') || 'Review candidate';
    }
    if (face.status === 'sidecar_only') {
      return faceCandidateDisplayName(face)
        ? `${faceCandidateDisplayName(face)}?`
        : face.name
          ? `Source-only: ${face.name}`
          : face.label || 'Source-only face';
    }
    if (face.status === 'rejected') {
      return 'Noise';
    }
    return face.label || 'Face';
  };
  const faceLabelTitle = (face: CimmichFaceOverlay, linkedBody?: CimmichBodyOverlay) => {
    const evidenceKind =
      face.status === 'named'
        ? 'accepted named face'
        : face.status === 'untagged'
          ? 'review candidate, not accepted tag'
          : face.status;
    const candidateHint =
      face.status !== 'named' && faceCandidateDisplayName(face)
        ? candidateFaceName(face)
          ? '; click to accept or rename'
          : '; review-only candidate, click to name or correct'
        : '';
    return linkedBody
      ? `${faceDisplayLabel(face)} - ${evidenceKind}${candidateHint}; body color matches linked skeleton`
      : `${faceDisplayLabel(face)} - ${evidenceKind}${candidateHint}`;
  };
  const faceEvidenceKindLabel = (face: CimmichFaceOverlay) => (face.bucket === 'head' ? 'Head' : 'Face');
  const nameDistance = (left: string, right: string) => {
    const a = left.toLowerCase();
    const b = right.toLowerCase();
    const costs = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i++) {
      let previous = i;
      for (let j = 1; j <= b.length; j++) {
        const current = costs[j];
        costs[j] = a[i - 1] === b[j - 1] ? previous : Math.min(previous, costs[j - 1], costs[j]) + 1;
        previous = current;
      }
      costs[0] = i;
    }
    return costs[b.length];
  };
  const closestName = (draft: string, current = '') => {
    const value = normalizeName(draft);
    if (value.length < 2) {
      return '';
    }
    const exact = knownNameOptions.find((name) => name.toLowerCase() === value.toLowerCase());
    if (exact) {
      return '';
    }

    const ranked = knownNameOptions
      .filter((name) => name !== current)
      .map((name) => {
        const lowerName = name.toLowerCase();
        const lowerValue = value.toLowerCase();
        const prefixBonus = lowerName.startsWith(lowerValue) ? -6 : lowerName.includes(lowerValue) ? -3 : 0;
        return { name, score: nameDistance(value, name) + prefixBonus };
      })
      .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
    return ranked[0]?.score <= Math.max(2, Math.ceil(value.length * 0.45)) ? ranked[0].name : '';
  };
  const faceNameSuggestion = $derived(closestName(faceNameDraft, selectedFace?.name || ''));
  const normalizedFaceNameDraft = $derived(normalizeName(faceNameDraft));
  const faceDraftExistingPerson = $derived(
    manualTagSubjects.find(
      (subject) =>
        subject.kind === 'person' &&
        normalizeName(subject.name).toLocaleLowerCase() === normalizedFaceNameDraft.toLocaleLowerCase(),
    ),
  );
  const faceDraftKnownPersonName = $derived(
    faceDraftExistingPerson?.name ||
      knownNameOptions.find(
        (name) => normalizeName(name).toLocaleLowerCase() === normalizedFaceNameDraft.toLocaleLowerCase(),
      ) ||
      '',
  );
  const faceDraftCreatesPerson = $derived(
    Boolean(
      normalizedFaceNameDraft && !faceDraftKnownPersonName && !isManualTagSubjectsLoading && !manualTagSubjectsError,
    ),
  );
  const faceDraftNameChanged = $derived(
    Boolean(
      selectedFace &&
      normalizedFaceNameDraft.toLocaleLowerCase() !== normalizeName(selectedFace.name).toLocaleLowerCase(),
    ),
  );
  const faceDraftHasChanges = $derived(
    Boolean(selectedFace && (faceDraftNameChanged || faceBucketDraft !== faceBucketFromOverlay(selectedFace))),
  );
  const showFaceDraftIdentityCue = $derived(
    Boolean(normalizedFaceNameDraft && (!selectedFace?.name || faceDraftNameChanged)),
  );
  const faceBucketOwnerLabel = (bucket: FaceBucketDraft) =>
    ({
      face_only: 'Not used for matching',
      head: 'Head only',
      lq: 'Difficult reference photo',
      prime: 'Best reference photo',
      secondary: 'Useful reference photo',
    })[bucket];
  const bulkNameSuggestion = (face: CimmichFaceOverlay) => closestName(bulkNameDrafts[face.id] ?? '', face.name);
  const sameDrafts = (left: Record<string, string>, right: Record<string, string>) => {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length && leftKeys.every((key) => left[key] === right[key]);
  };

  const setBulkDraft = (faceId: string, value: string) => {
    bulkNameDrafts = { ...bulkNameDrafts, [faceId]: value };
  };

  const startBulkPanelDrag = (event: PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget as HTMLElement;
    const panel = target.closest('[data-cimmich-bulk-panel]') as HTMLElement | null;
    if (!panel || !overlayElement) {
      return;
    }
    const rect = panel.getBoundingClientRect();
    const overlayRect = overlayElement.getBoundingClientRect();
    isDraggingBulkPanel = true;
    bulkPanelDragOffsetX = event.clientX - rect.left;
    bulkPanelDragOffsetY = event.clientY - rect.top;
    bulkPanelX = rect.left - overlayRect.left;
    bulkPanelY = rect.top - overlayRect.top;
    target.setPointerCapture?.(event.pointerId);
  };

  const dragBulkPanel = (event: PointerEvent) => {
    if (!isDraggingBulkPanel || !overlayElement) {
      return;
    }
    event.preventDefault();
    const overlayRect = overlayElement.getBoundingClientRect();
    const width = Math.min(448, Math.max(320, overlayWidth - 24));
    bulkPanelX = Math.min(
      Math.max(12, event.clientX - overlayRect.left - bulkPanelDragOffsetX),
      Math.max(12, overlayWidth - width - 12),
    );
    bulkPanelY = Math.min(
      Math.max(76, event.clientY - overlayRect.top - bulkPanelDragOffsetY),
      Math.max(76, overlayHeight - 220),
    );
  };

  const stopBulkPanelDrag = () => {
    isDraggingBulkPanel = false;
  };

  const clampFaceBox = (box: FaceBox, image: { height: number; width: number }) => {
    const minSize = 24;
    let x1 = Math.round(Math.max(0, Math.min(box.x1, image.width - minSize)));
    let y1 = Math.round(Math.max(0, Math.min(box.y1, image.height - minSize)));
    let x2 = Math.round(Math.max(minSize, Math.min(box.x2, image.width)));
    let y2 = Math.round(Math.max(minSize, Math.min(box.y2, image.height)));

    if (x2 - x1 < minSize) {
      if (box.x1 === x1) {
        x2 = Math.min(image.width, x1 + minSize);
      } else {
        x1 = Math.max(0, x2 - minSize);
      }
    }
    if (y2 - y1 < minSize) {
      if (box.y1 === y1) {
        y2 = Math.min(image.height, y1 + minSize);
      } else {
        y1 = Math.max(0, y2 - minSize);
      }
    }
    return { x1, y1, x2, y2 };
  };

  const boxFromDrag = (
    drag: {
      image: { height: number; width: number };
      mode: FaceBoxDragMode;
      startBox: FaceBox | BodyBox;
      startClientX: number;
      startClientY: number;
    },
    event: PointerEvent,
  ) => {
    if (!imageMetrics) {
      return drag.startBox;
    }
    const deltaX = ((event.clientX - drag.startClientX) / imageMetrics.width) * imageMetrics.imageWidth;
    const deltaY = ((event.clientY - drag.startClientY) / imageMetrics.height) * imageMetrics.imageHeight;
    const box = { ...drag.startBox };
    if (drag.mode === 'move') {
      const width = box.x2 - box.x1;
      const height = box.y2 - box.y1;
      const x1 = Math.max(0, Math.min(drag.image.width - width, drag.startBox.x1 + deltaX));
      const y1 = Math.max(0, Math.min(drag.image.height - height, drag.startBox.y1 + deltaY));
      return {
        x1: Math.round(x1),
        y1: Math.round(y1),
        x2: Math.round(x1 + width),
        y2: Math.round(y1 + height),
      };
    }
    if (drag.mode.includes('w')) {
      box.x1 = drag.startBox.x1 + deltaX;
    }
    if (drag.mode.includes('e')) {
      box.x2 = drag.startBox.x2 + deltaX;
    }
    if (drag.mode.includes('n')) {
      box.y1 = drag.startBox.y1 + deltaY;
    }
    if (drag.mode.includes('s')) {
      box.y2 = drag.startBox.y2 + deltaY;
    }
    return clampFaceBox(box, drag.image);
  };

  const startFaceBoxDrag = (event: PointerEvent, face: CimmichFaceOverlay, mode: FaceBoxDragMode) => {
    if (!imageMetrics) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setSelectedFace(face);
    const image = face.image || { width: imageMetrics.imageWidth, height: imageMetrics.imageHeight };
    faceBoxDragState = {
      faceId: face.id,
      image,
      mode,
      pointerId: event.pointerId,
      startBox: { ...faceBox(face) },
      startClientX: event.clientX,
      startClientY: event.clientY,
    };
    faceActionMessage = 'Drag the square to adjust it.';
    faceActionError = '';
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  const dragFaceBox = (event: PointerEvent) => {
    if (!faceBoxDragState || faceBoxDragState.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    const nextBox = boxFromDrag(faceBoxDragState, event);
    faceBoxDrafts = { ...faceBoxDrafts, [faceBoxDragState.faceId]: nextBox };
  };

  const observationRegion = (box: FaceBox | BodyBox, image: { height: number; width: number }) => ({
    h: (box.y2 - box.y1) / image.height,
    w: (box.x2 - box.x1) / image.width,
    x: box.x1 / image.width,
    y: box.y1 / image.height,
  });

  const saveFaceBox = async (faceId: string, box: FaceBox, image: { height: number; width: number }) => {
    if (!evidence) {
      return;
    }
    isFaceActionSaving = true;
    faceActionMessage = '';
    faceActionError = '';
    identityCorrectionUndoDecisionId = '';
    try {
      if (isCimmichEvidence) {
        const face = faceOverlays.find((item) => item.id === faceId);
        if (!face?.currentRevision) {
          throw new Error('This Face has no correction revision');
        }
        const result = await correctCimmichFaceGeometry(faceId, {
          commandId: createCimmichObservationCorrectionCommandId('face-geometry'),
          expectedDecisionId: face.currentDecisionId ?? null,
          expectedRevision: face.currentRevision,
          region: observationRegion(box, image),
        });
        await refreshDetailedEvidence();
        selectedFaceId = faceId;
        faceBoxDrafts = Object.fromEntries(
          Object.entries(faceBoxDrafts).filter(([draftFaceId]) => draftFaceId !== faceId),
        );
        if (result.changed && result.decisionId) {
          observationUndoDecisionId = result.decisionId;
          observationActionMessage = 'Face position updated. Matching evidence will refresh from the new crop.';
        }
        return;
      }
      const result = await updateOverlayFace({
        action: 'update_box',
        bbox: box,
        faceId,
        filename: evidence.filename,
        image,
        mediaId: evidence.mediaId,
      });
      evidence = result.evidence;
      bundle = result.bundle;
      selectedFaceId = faceId;
      faceBoxDrafts = Object.fromEntries(
        Object.entries(faceBoxDrafts).filter(([draftFaceId]) => draftFaceId !== faceId),
      );
      faceActionMessage = 'Face box saved.';
    } catch (error) {
      faceActionError = error instanceof Error ? error.message : 'Unable to update face box';
    } finally {
      isFaceActionSaving = false;
    }
  };

  const stopFaceBoxDrag = (event?: PointerEvent) => {
    const drag = faceBoxDragState;
    if (!drag || (event && drag.pointerId !== event.pointerId)) {
      return;
    }
    const box = faceBoxDrafts[drag.faceId] ?? drag.startBox;
    faceBoxDragState = undefined;
    if (JSON.stringify(box) === JSON.stringify(drag.startBox)) {
      faceActionMessage = '';
      return;
    }
    void saveFaceBox(drag.faceId, box, drag.image);
  };

  const startBodyBoxDrag = (event: PointerEvent, body: CimmichBodyOverlay, mode: FaceBoxDragMode) => {
    if (!imageMetrics || !isCimmichEvidence) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setSelectedBody(body);
    const image = body.image || { width: imageMetrics.imageWidth, height: imageMetrics.imageHeight };
    bodyBoxDragState = {
      bodyId: body.id,
      image,
      mode,
      pointerId: event.pointerId,
      startBox: { ...bodyBox(body) },
      startClientX: event.clientX,
      startClientY: event.clientY,
    };
    observationActionMessage = 'Drag to adjust this Body.';
    observationActionError = '';
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  const dragBodyBox = (event: PointerEvent) => {
    if (!bodyBoxDragState || bodyBoxDragState.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    const nextBox = boxFromDrag(bodyBoxDragState, event);
    bodyBoxDrafts = { ...bodyBoxDrafts, [bodyBoxDragState.bodyId]: nextBox };
  };

  const saveBodyBox = async (bodyId: string, box: BodyBox, image: { height: number; width: number }) => {
    const body = bodyOverlays.find((item) => item.id === bodyId);
    if (!body?.currentRevision) {
      observationActionError = 'This Body has no correction revision';
      return;
    }
    isObservationActionSaving = true;
    observationActionError = '';
    observationActionMessage = '';
    try {
      const result = await correctCimmichBodyGeometry(bodyId, {
        commandId: createCimmichObservationCorrectionCommandId('body-geometry'),
        expectedDecisionId: body.currentDecisionId ?? null,
        expectedRevision: body.currentRevision,
        region: observationRegion(box, image),
      });
      await refreshDetailedEvidence();
      selectedBodyId = bodyId;
      bodyBoxDrafts = Object.fromEntries(
        Object.entries(bodyBoxDrafts).filter(([draftBodyId]) => draftBodyId !== bodyId),
      );
      if (result.changed && result.decisionId) {
        observationUndoDecisionId = result.decisionId;
        observationActionMessage = 'Body position updated. Pose evidence will refresh for the new region.';
      }
    } catch (error) {
      observationActionError = error instanceof Error ? error.message : 'Unable to update this Body';
    } finally {
      isObservationActionSaving = false;
    }
  };

  const stopBodyBoxDrag = (event?: PointerEvent) => {
    const drag = bodyBoxDragState;
    if (!drag || (event && drag.pointerId !== event.pointerId)) {
      return;
    }
    const box = bodyBoxDrafts[drag.bodyId] ?? drag.startBox;
    bodyBoxDragState = undefined;
    if (JSON.stringify(box) === JSON.stringify(drag.startBox)) {
      observationActionMessage = '';
      return;
    }
    void saveBodyBox(drag.bodyId, box, drag.image);
  };

  const handleWindowPointerMove = (event: PointerEvent) => {
    dragBulkPanel(event);
    dragFaceBox(event);
    dragBodyBox(event);
  };

  const handleWindowPointerUp = (event: PointerEvent) => {
    stopBulkPanelDrag();
    stopFaceBoxDrag(event);
    stopBodyBoxDrag(event);
  };

  const setSelectedFace = (face: CimmichFaceOverlay, options: { editName?: boolean } = {}) => {
    selectedFaceId = face.id;
    selectedBodyId = '';
    faceNameDraft = projectFaceEditorPersonDraft({
      acceptedName: face.name,
      candidateName: faceCandidateDisplayName(face),
    });
    faceSelectedPersonId = face.name ? face.personIdentityKey || '' : '';
    faceActionMessage = '';
    faceActionError = '';
    clearIdentityConfirmId = '';
    rejectCandidateConfirmId = '';
    faceBucketDraft = faceBucketFromOverlay(face);
    isLaterPickerOpen = false;
    isEditingFaceName = Boolean(options.editName);
    if (options.editName) {
      void loadFaceMatches(face);
      void loadManualTagSubjects();
    }
  };

  const setSelectedBody = (body: CimmichBodyOverlay) => {
    selectedBodyId = body.id;
    selectedFaceId = '';
    isEditingFaceName = false;
    faceActionMessage = '';
    faceActionError = '';
    bodyIdentityActionMessage = '';
    bodyIdentityActionError = '';
    bodyPersonQuery = body.linkedName || personPhotoContext?.personName || '';
    bodySelectedPersonId = body.status === 'unlinked' ? personPhotoContext?.personId || '' : '';
    void loadManualTagSubjects();
  };

  const selectBodyPerson = (subject: ManualPhotoTagSubject) => {
    if (subject.kind !== 'person') {
      return;
    }
    bodySelectedPersonId = subject.id;
    bodyPersonQuery = subject.name;
    bodyIdentityActionError = '';
  };

  const assignSelectedBodyPerson = async () => {
    if (!selectedBody || !bodySelectedPersonId || isBodyIdentitySaving) {
      return;
    }
    const bodyId = selectedBody.bodyId || selectedBody.id;
    const personName = bodySelectedPerson?.name || bodyPersonQuery;
    isBodyIdentitySaving = true;
    bodyIdentityActionMessage = '';
    bodyIdentityActionError = '';
    try {
      await setCimmichBodySelection(bodySelectedPersonId, bodyId, true);
      await refreshDetailedEvidence();
      bodyIdentityActionMessage = `${personName} is linked to this Body.`;
    } catch (error) {
      bodyIdentityActionError = error instanceof Error ? error.message : 'Unable to link this Body';
    } finally {
      isBodyIdentitySaving = false;
    }
  };

  const runFaceAction = async (
    action:
      | 'clear_identity'
      | 'confirm_not_face'
      | 'delete_face'
      | 'mark_not_face'
      | 'reject_name_candidate'
      | 'rename'
      | 'restore_face'
      | 'retrigger',
  ) => {
    if (!selectedFace || !evidence) {
      return;
    }

    const faceId = selectedFace.id;
    isFaceActionSaving = true;
    faceActionMessage = '';
    faceActionError = '';

    try {
      let result = await updateOverlayFace({
        action,
        faceId: selectedFace.id,
        filename: evidence.filename,
        mediaId: evidence.mediaId,
        name:
          action === 'retrigger'
            ? selectedFace.name || faceCandidateDisplayName(selectedFace) || faceNameDraft
            : faceNameDraft,
      });
      if (action === 'rename' && isCimmichEvidence) {
        const personId = result.event.personId;
        if (!personId) {
          throw new Error('Name saved, but its Person could not be resolved for the selected bucket');
        }
        const isHoldingSelection = holdingPeople.some(
          (name) => normalizeName(name).toLocaleLowerCase() === normalizeName(faceNameDraft).toLocaleLowerCase(),
        );
        if (!isHoldingSelection && faceBucketDraft !== faceBucketFromOverlay(selectedFace)) {
          await setCimmichFaceBucket(personId, faceId, faceBucketValue(faceBucketDraft));
          const refreshed = await getCimmichEvidenceForAsset(asset);
          if (refreshed.evidence) {
            result = {
              ...result,
              bundle: refreshed.bundle,
              evidence: refreshed.evidence,
            };
          }
        }
      }
      evidence = result.evidence;
      bundle = result.bundle;
      showNamedFaces = true;
      selectedFaceId = faceId;
      const updatedFace = result.evidence.faceOverlays?.find((face) => face.id === faceId);
      faceNameDraft = result.event.action === 'clear_identity' ? '' : updatedFace?.name || faceNameDraft;
      switch (result.event.action) {
        case 'clear_identity': {
          clearIdentityConfirmId = '';
          isEditingFaceName = false;
          faceActionMessage = 'Name removed. Face is ready to identify again.';

          break;
        }
        case 'reject_name_candidate': {
          rejectCandidateConfirmId = '';
          isEditingFaceName = false;
          faceNameDraft = '';
          faceActionMessage = 'Candidate rejected. Face remains unknown.';

          break;
        }
        case 'retrigger': {
          faceActionMessage = `Face-only match recorded: ${result.event.relatedFaceCount ?? 0} linked faces across ${result.event.relatedPhotoCount ?? 0} photos.`;

          break;
        }
        case 'delete_face': {
          selectedFaceId = '';
          faceActionMessage = 'Ignored on this photo.';

          break;
        }
        case 'mark_not_face':
        case 'confirm_not_face': {
          faceActionMessage =
            result.event.action === 'confirm_not_face' ? 'Confirmed as not a face.' : 'Marked as not a face.';

          break;
        }
        case 'restore_face': {
          faceActionMessage = 'Restored as a face candidate.';

          break;
        }
        default: {
          faceActionMessage = result.event.createdPerson
            ? `${result.event.name || faceNameDraft} created and tagged.`
            : 'Name saved.';
          isEditingFaceName = false;
        }
      }
    } catch (error) {
      if (error instanceof CimmichServiceError && error.code === 'PERSON_NAME_CONFLICT') {
        const existingPeople = Array.isArray(error.details?.existingPeople) ? error.details.existingPeople : [];
        const existing = existingPeople.find((person): person is { personId: string; personName: string } =>
          Boolean(
            person &&
            typeof person === 'object' &&
            'personId' in person &&
            typeof person.personId === 'string' &&
            'personName' in person &&
            typeof person.personName === 'string',
          ),
        );
        if (existing) {
          manualTagSubjects = [
            ...manualTagSubjects.filter((subject) => subject.id !== existing.personId),
            { id: existing.personId, kind: 'person', name: existing.personName },
          ];
          faceNameDraft = existing.personName;
          faceSelectedPersonId = existing.personId;
          faceActionError = `${existing.personName} already exists. Selected that Person instead.`;
          return;
        }
      }
      faceActionError = error instanceof Error ? error.message : 'Unable to update face';
    } finally {
      isFaceActionSaving = false;
    }
  };

  const deleteFace = async (face: CimmichFaceOverlay) => {
    setSelectedFace(face);
    await runFaceAction('delete_face');
  };

  const rejectDetailedObservation = async (kind: 'body' | 'face') => {
    const observation = kind === 'face' ? selectedFace : selectedBody;
    if (!observation?.currentRevision) {
      observationActionError = `This ${kind} has no correction revision`;
      return;
    }
    isObservationActionSaving = true;
    observationActionError = '';
    observationActionMessage = '';
    try {
      const input = {
        commandId: createCimmichObservationCorrectionCommandId(kind === 'face' ? 'not-face' : 'not-body'),
        expectedDecisionId: observation.currentDecisionId ?? null,
        expectedRevision: observation.currentRevision,
      };
      const result =
        kind === 'face'
          ? await markCimmichFaceNotFace(observation.id, input)
          : await markCimmichBodyNotBody(observation.id, input);
      await refreshDetailedEvidence();
      selectedFaceId = '';
      selectedBodyId = '';
      if (result.changed && result.decisionId) {
        observationUndoDecisionId = result.decisionId;
        observationActionMessage = kind === 'face' ? 'Marked as not a face.' : 'Marked as not a body.';
      }
    } catch (error) {
      observationActionError = error instanceof Error ? error.message : `Unable to reject this ${kind}`;
    } finally {
      isObservationActionSaving = false;
    }
  };

  const undoDetailedObservationCorrection = async () => {
    if (!observationUndoDecisionId) {
      return;
    }
    isObservationActionSaving = true;
    observationActionError = '';
    try {
      const result = await undoCimmichObservationCorrection(
        observationUndoDecisionId,
        createCimmichObservationCorrectionCommandId('undo'),
      );
      await refreshDetailedEvidence();
      observationUndoDecisionId = '';
      observationActionMessage = result.changed ? 'Last machinery correction undone.' : 'Nothing changed.';
    } catch (error) {
      observationActionError = error instanceof Error ? error.message : 'Unable to undo the last correction';
    } finally {
      isObservationActionSaving = false;
    }
  };

  const runBulkFaceAction = async (
    face: CimmichFaceOverlay,
    action: 'confirm_not_face' | 'mark_not_face' | 'restore_face',
  ) => {
    setSelectedFace(face);
    faceNameDraft = face.name || '';
    await runFaceAction(action);
  };

  const runBulkSave = async () => {
    if (!evidence || bulkChangedCount === 0) {
      return;
    }

    const changes = bulkFaces
      .map((face) => ({ face, name: normalizeName(bulkNameDrafts[face.id]) }))
      .filter(({ face, name }) => name !== normalizeName(face.name));

    isBulkSaving = true;
    bulkActionMessage = '';
    bulkActionError = '';

    try {
      let latestEvidence = evidence;
      let latestBundle = bundle;
      for (const change of changes) {
        const result = await updateOverlayFace({
          action: change.name ? 'rename' : 'clear_identity',
          faceId: change.face.id,
          filename: latestEvidence.filename,
          mediaId: latestEvidence.mediaId,
          name: change.name,
        });
        latestEvidence = result.evidence;
        latestBundle = result.bundle;
      }
      evidence = latestEvidence;
      bundle = latestBundle;
      bulkActionMessage = `Saved ${changes.length} face ${changes.length === 1 ? 'identity change' : 'identity changes'}.`;
    } catch (error) {
      bulkActionError = error instanceof Error ? error.message : 'Unable to save bulk face names';
    } finally {
      isBulkSaving = false;
    }
  };

  const fallbackSummary = $derived.by(() => {
    if (!evidence?.summary) {
      return '';
    }

    const names = [
      ...new Set(
        [
          ...namedPeopleFaceOverlays.map((face) => face.name),
          ...namedPeopleBodyOverlays.map((body) => bodyIdentityName(body)),
          ...localizedManualPresenceTags.map((tag) => tag.subject.displayName),
          ...namedPhotoPresence.map((presence) => presence.name),
        ]
          .map((name) => normalizeName(name))
          .filter(Boolean),
      ),
    ];
    const unresolvedFaceCount = faceOverlays.filter(
      (face) => face.status !== 'named' && face.status !== 'rejected',
    ).length;
    const namedText = names.length > 0 ? `Named here: ${names.join(', ')}.` : 'No one has been named in this photo.';
    const reviewText =
      unresolvedFaceCount > 0
        ? ` ${unresolvedFaceCount} ${unresolvedFaceCount === 1 ? 'Face still needs' : 'Faces still need'} review.`
        : '';
    return `${namedText}${reviewText}`;
  });

  const normalSummary = $derived.by(() => {
    if (!evidence?.summary) {
      return '';
    }

    return evidence.summary.visualCaption || evidence.summary.normalCaption || fallbackSummary;
  });

  const enhancedSummary = $derived.by(() => {
    if (!evidence?.summary) {
      return '';
    }

    return evidence.summary.enhancedCaption || evidence.summary.visualDetailedCaption || fallbackSummary;
  });

  const evidenceSummary = $derived.by(() => {
    if (!evidence?.summary) {
      return '';
    }

    return evidence.summary.evidenceCaption || fallbackSummary;
  });

  const currentSummary = $derived.by(() => {
    if (summaryMode === 'normal') {
      return normalSummary;
    }
    if (summaryMode === 'enhanced') {
      return enhancedSummary || (step2Item ? step2SummaryText : '');
    }
    return evidenceSummary;
  });

  const summaryTitle = $derived.by(() => {
    if (summaryMode === 'normal') {
      return 'Standard image summary';
    }
    if (summaryMode === 'enhanced' && step2Item && !enhancedSummary) {
      if (step2Item.enhancedVisualQc) {
        return 'Enhanced visual summary · reviewed';
      }
      return step2HasConsequentialReview ? 'Step 2 · reviewed summary input' : 'Photo context';
    }
    if (summaryMode === 'enhanced') {
      return 'Enhanced image summary';
    }
    return 'Evidence summary';
  });

  const contextHref = (context: Pick<CimmichPhotoContext, 'entityId' | 'family'>) => {
    const search = new SvelteURLSearchParams({ entityId: context.entityId });
    if (context.family === 'objects') {
      search.set('family', 'objects');
      return `${Route.cimmichPlaces()}?${search.toString()}`;
    }
    return `${context.family === 'events' ? Route.cimmichEvents() : Route.cimmichPlaces()}?${search.toString()}`;
  };

  const contextFamily = (entity: CimmichContextEntity): CimmichContextFamily =>
    entity.entityKind === 'event' ? 'events' : entity.entityKind === 'object' ? 'objects' : 'places';

  const loadContextOptions = async () => {
    if (contextOptions.length > 0 || isContextLoading) {
      return;
    }
    isContextLoading = true;
    contextActionError = '';
    try {
      const [places, events, objects] = await Promise.all([
        getCimmichContextEntities('places', { limit: 500 }),
        getCimmichContextEntities('events', { limit: 500 }),
        getCimmichContextEntities('objects', { limit: 500 }),
      ]);
      contextOptions = [...places, ...events, ...objects].sort(
        (left, right) =>
          left.displayName.localeCompare(right.displayName) || left.entityId.localeCompare(right.entityId),
      );
    } catch (error) {
      contextActionError = error instanceof Error ? error.message : 'Unable to load photo context';
    } finally {
      isContextLoading = false;
    }
  };

  const openObjectTagging = () => {
    isObjectTaggingMode = true;
    objectRegionDraft = undefined;
    objectRegionQuery = '';
    objectSelectedEntityId = '';
    objectActionError = '';
    objectActionMessage = '';
    isContextEditing = false;
    void loadContextOptions();
  };

  const closeObjectTagging = () => {
    isObjectTaggingMode = false;
    objectRegionDraft = undefined;
    objectRegionPointer = undefined;
    objectRegionQuery = '';
    objectSelectedEntityId = '';
    objectActionError = '';
  };

  const objectPointerPosition = (event: PointerEvent, target: HTMLButtonElement) => {
    const rect = target.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  };

  const beginObjectRegion = (event: PointerEvent & { currentTarget: HTMLButtonElement }) => {
    if (event.button !== 0 || isObjectSaving) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const point = objectPointerPosition(event, event.currentTarget);
    event.currentTarget.setPointerCapture(event.pointerId);
    objectRegionPointer = { pointerId: event.pointerId, startX: point.x, startY: point.y };
    objectRegionDraft = { h: 0.001, w: 0.001, x: point.x, y: point.y };
    objectActionError = '';
  };

  const moveObjectRegion = (event: PointerEvent & { currentTarget: HTMLButtonElement }) => {
    if (!objectRegionPointer || objectRegionPointer.pointerId !== event.pointerId) {
      return;
    }
    const point = objectPointerPosition(event, event.currentTarget);
    const x = Math.min(objectRegionPointer.startX, point.x);
    const y = Math.min(objectRegionPointer.startY, point.y);
    objectRegionDraft = {
      h: Math.max(0.001, Math.abs(point.y - objectRegionPointer.startY)),
      w: Math.max(0.001, Math.abs(point.x - objectRegionPointer.startX)),
      x,
      y,
    };
  };

  const finishObjectRegion = (event: PointerEvent & { currentTarget: HTMLButtonElement }) => {
    if (!objectRegionPointer || objectRegionPointer.pointerId !== event.pointerId) {
      return;
    }
    moveObjectRegion(event);
    const point = objectPointerPosition(event, event.currentTarget);
    if (!objectRegionDraft || objectRegionDraft.w < 0.02 || objectRegionDraft.h < 0.02) {
      const w = 0.24;
      const h = 0.24;
      objectRegionDraft = {
        h,
        w,
        x: Math.max(0, Math.min(1 - w, point.x - w / 2)),
        y: Math.max(0, Math.min(1 - h, point.y - h / 2)),
      };
    }
    objectRegionPointer = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const saveObjectRegion = async () => {
    if (!evidence?.summary?.searchRowId || !objectRegionDraft || !selectedObjectOption || isObjectSaving) {
      return;
    }
    isObjectSaving = true;
    objectActionError = '';
    objectActionMessage = '';
    try {
      const result = await attachCimmichManualObjectRegion(evidence.summary.searchRowId, {
        commandId: createCimmichManualPhotoContextCommandId('object-attach'),
        entityId: selectedObjectOption.entityId,
        region: objectRegionDraft,
      });
      objectActionMessage = result.changed
        ? `${selectedObjectOption.displayName} tagged on this photo.`
        : `${selectedObjectOption.displayName} is already tagged here.`;
      objectUndoDecisionId = result.changed ? result.decisionId || '' : '';
      closeObjectTagging();
      retryCurrentEvidence();
    } catch (error) {
      objectActionError = error instanceof Error ? error.message : 'Unable to tag this object';
    } finally {
      isObjectSaving = false;
    }
  };

  const removeObjectRegion = async (tag: CimmichManualObjectRegionTag) => {
    if (isObjectSaving) {
      return;
    }
    isObjectSaving = true;
    objectActionError = '';
    try {
      const result = await rejectCimmichManualObjectRegion(tag.tagId, {
        commandId: createCimmichManualPhotoContextCommandId('object-remove'),
        expectedDecisionId: tag.decisionId,
      });
      objectActionMessage = `${tag.displayName} tag removed.`;
      objectUndoDecisionId = result.decisionId || '';
      retryCurrentEvidence();
    } catch (error) {
      objectActionError = error instanceof Error ? error.message : 'Unable to remove this object tag';
    } finally {
      isObjectSaving = false;
    }
  };

  const saveOwnerSummary = async () => {
    if (!evidence?.summary?.searchRowId || isOwnerSummarySaving) {
      return;
    }
    const text = ownerSummaryDraft.trim();
    isOwnerSummarySaving = true;
    ownerSummaryActionError = '';
    try {
      const result = await setCimmichAssetOwnerSummary(evidence.summary.searchRowId, {
        commandId: createCimmichManualPhotoContextCommandId('summary-set'),
        expectedRevision: ownerSummary?.revision || 0,
        summaryText: text || null,
      });
      ownerSummaryActionMessage = result.changed
        ? text
          ? 'Summary saved.'
          : 'Summary cleared.'
        : 'No changes to save.';
      ownerSummaryUndoDecisionId = result.changed ? result.decisionId || '' : '';
      retryCurrentEvidence();
    } catch (error) {
      ownerSummaryActionError = error instanceof Error ? error.message : 'Unable to save this summary';
    } finally {
      isOwnerSummarySaving = false;
    }
  };

  const undoManualPhotoContextAction = async (decisionId: string) => {
    if (!decisionId || isObjectSaving || isOwnerSummarySaving) {
      return;
    }
    isObjectSaving = true;
    isOwnerSummarySaving = true;
    try {
      const result = await undoCimmichManualPhotoContextDecision(
        decisionId,
        createCimmichManualPhotoContextCommandId('undo'),
      );
      ownerSummaryDraft = result.ownerSummary.summaryText || '';
      objectUndoDecisionId = '';
      ownerSummaryUndoDecisionId = '';
      objectActionMessage = 'Change undone.';
      ownerSummaryActionMessage = 'Change undone.';
      retryCurrentEvidence();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to undo this change';
      objectActionError = message;
      ownerSummaryActionError = message;
    } finally {
      isObjectSaving = false;
      isOwnerSummarySaving = false;
    }
  };

  const addPhotoContext = async (context: CimmichContextEntity) => {
    if (!evidence?.summary?.searchRowId || isContextSaving) {
      return;
    }
    isContextSaving = true;
    contextActionError = '';
    contextActionMessage = '';
    try {
      const result = await attachCimmichContextAssets(
        contextFamily(context),
        context.entityId,
        createCimmichContextCommandId('photo-context-attach'),
        [{ assetId: evidence.summary.searchRowId, associationKind: 'manual' }],
      );
      await refreshDetailedEvidence();
      contextUndoDecisionId = result.undo?.eligible && result.decisionId ? result.decisionId : '';
      contextActionMessage = result.status === 'no_change' ? 'This context is already on the photo.' : 'Context added.';
      contextQuery = '';
      contextAddKind = '';
    } catch (error) {
      contextActionError = error instanceof Error ? error.message : 'Unable to add this context';
    } finally {
      isContextSaving = false;
    }
  };

  const removePhotoContext = async (context: CimmichPhotoContext) => {
    if (!evidence?.summary?.searchRowId || isContextSaving) {
      return;
    }
    isContextSaving = true;
    contextActionError = '';
    contextActionMessage = '';
    try {
      const result = await detachCimmichContextAssets(
        context.family,
        context.entityId,
        createCimmichContextCommandId('photo-context-detach'),
        [evidence.summary.searchRowId],
      );
      await refreshDetailedEvidence();
      contextUndoDecisionId = result.undo?.eligible && result.decisionId ? result.decisionId : '';
      contextActionMessage = result.status === 'no_change' ? 'Nothing changed.' : 'Context removed.';
    } catch (error) {
      contextActionError = error instanceof Error ? error.message : 'Unable to remove this context';
    } finally {
      isContextSaving = false;
    }
  };

  const undoContextAction = async () => {
    if (!contextUndoDecisionId || isContextSaving) {
      return;
    }
    isContextSaving = true;
    contextActionError = '';
    try {
      await undoCimmichContextDecision(contextUndoDecisionId, createCimmichContextCommandId('photo-context-undo'));
      await refreshDetailedEvidence();
      contextUndoDecisionId = '';
      contextActionMessage = 'Context restored.';
    } catch (error) {
      contextActionError = error instanceof Error ? error.message : 'Unable to undo this context change';
    } finally {
      isContextSaving = false;
    }
  };

  const selectOverlayView = (view: OverlayView) => {
    if (view !== 'off') {
      assetViewerManager.closeDetailPanel();
    }
    overlayView = view;
    isSidecarVisible = false;
    isSummaryVisible = false;
    isEnhancedMenuOpen = false;
    selectedFaceId = '';
    selectedBodyId = '';
    isBulkFacePanelOpen = false;
    isTaggingMode = false;
    manualTagDraft = undefined;
    manualTagQuery = '';
    manualTagSelectedSubjectId = '';
    manualTagType = '';
    selectedManualTagId = '';
    closePresencePicker();
    if (view !== 'context') {
      isContextEditing = false;
      closeObjectTagging();
      contextQuery = '';
      contextAddKind = '';
      contextActionError = '';
    }
  };

  const togglePeopleView = () => {
    selectOverlayView(isPeopleSurfaceActive ? 'off' : 'people');
  };

  const toggleContextView = () => {
    if (isContextSurfaceActive) {
      selectOverlayView('off');
      return;
    }
    selectOverlayView('context');
    void loadContextOptions();
  };

  const toggleContextEditing = () => {
    isContextEditing = !isContextEditing;
    closeObjectTagging();
    contextQuery = '';
    contextAddKind = '';
    ownerSummaryDraft = ownerSummary?.summaryText || '';
    ownerSummaryActionError = '';
    ownerSummaryActionMessage = '';
  };

  const loadManualTagSubjects = async () => {
    if (manualTagSubjects.length > 0 || isManualTagSubjectsLoading) {
      return;
    }
    isManualTagSubjectsLoading = true;
    manualTagSubjectsError = '';
    try {
      const [peopleResult, petsResult] = await Promise.all([getCimmichPeople(500), getCimmichPets({ limit: 500 })]);
      const petSubjects = petsResult.map((pet) => createManualPhotoTagPetSubject(pet));
      manualPetIcons = Object.fromEntries(petSubjects.map((pet) => [pet.id, pet.icon || mdiPawOutline]));
      manualTagSubjects = [...createManualPhotoTagPersonSubjects(peopleResult), ...petSubjects];
    } catch (error) {
      manualTagSubjectsError = error instanceof Error ? error.message : 'Unable to load people and pets';
    } finally {
      isManualTagSubjectsLoading = false;
    }
  };

  const createManualTagPerson = async () => {
    const name = normalizeName(manualTagQuery);
    if (!name || manualTagExactSubject || isManualPersonCreating) {
      return;
    }
    if (!manualPersonCreateIntent || manualPersonCreateIntent.name !== name) {
      manualPersonCreateIntent = { commandId: createCimmichPersonCommandId('create'), name };
    }
    const intent = manualPersonCreateIntent;
    isManualPersonCreating = true;
    manualTagSaveError = '';
    try {
      const result = await createCimmichPerson(intent.commandId, { newPersonName: intent.name });
      const subject: ManualPhotoTagSubject = {
        id: result.personId,
        kind: 'person',
        name: result.personName,
      };
      manualTagSubjects = [...manualTagSubjects.filter((item) => item.id !== subject.id), subject].sort((left, right) =>
        left.name.localeCompare(right.name),
      );
      manualPersonCreateIntent = undefined;
      selectManualTagSubject(subject);
      manualTagActionMessage = `${result.personName} created. Choose a tag type and save to attach them here.`;
    } catch (error) {
      if (error instanceof CimmichServiceError && error.code === 'PERSON_NAME_CONFLICT') {
        const conflict = resolveManualPhotoTagPersonConflict(error.details?.existingPeople);
        if (conflict.state === 'single') {
          const existing = conflict.person;
          const subject: ManualPhotoTagSubject = {
            id: existing.personId,
            kind: 'person',
            name: existing.personName,
          };
          manualTagSubjects = [...manualTagSubjects.filter((item) => item.id !== subject.id), subject];
          manualPersonCreateIntent = undefined;
          selectManualTagSubject(subject);
          manualTagActionMessage = `${existing.personName} already exists and is now selected.`;
          return;
        }
        if (conflict.state === 'ambiguous') {
          manualTagSelectedSubjectId = '';
          manualTagSaveError =
            'More than one Person uses this name or alias. Choose the intended existing Person or use a distinct name.';
          return;
        }
      }
      manualTagSaveError = error instanceof Error ? error.message : 'Unable to create this Person';
    } finally {
      isManualPersonCreating = false;
    }
  };

  const loadManualPetIcons = async () => {
    if (Object.keys(manualPetIcons).length > 0 || isManualPetIconsLoading) {
      return;
    }
    isManualPetIconsLoading = true;
    try {
      const pets = await getCimmichPets({ limit: 500 });
      manualPetIcons = Object.fromEntries(
        pets.map((pet) => {
          const subject = createManualPhotoTagPetSubject(pet);
          return [pet.petId, subject.icon || mdiPawOutline];
        }),
      );
    } catch {
      // The stable paw fallback keeps pet tags legible if optional presentation data is unavailable.
    } finally {
      isManualPetIconsLoading = false;
    }
  };

  const cancelManualTagDraft = () => {
    manualTagDraft = undefined;
    manualTagQuery = '';
    manualPersonCreateIntent = undefined;
    manualTagSelectedSubjectId = '';
    manualTagType = '';
    manualTagSaveError = '';
  };

  const closeManualTagEditor = () => {
    selectedManualTagId = '';
    manualTagEditGeometry = undefined;
    isManualTagRepositioning = false;
    manualTagQuery = '';
    manualTagSelectedSubjectId = '';
    manualTagType = '';
    manualTagRemoveConfirmId = '';
    manualTagSaveError = '';
  };

  const stopTagging = () => {
    isTaggingMode = false;
    isTaggingHintVisible = false;
    cancelManualTagDraft();
    closeManualTagEditor();
  };

  const placeManualTag = async (event: MouseEvent & { currentTarget: EventTarget & HTMLButtonElement }) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const clientX = event.detail === 0 ? rect.left + rect.width / 2 : event.clientX;
    const clientY = event.detail === 0 ? rect.top + rect.height / 2 : event.clientY;
    const geometry = createManualPhotoTagGeometry(clientX, clientY, rect);
    if (!geometry) {
      return;
    }
    isTaggingHintVisible = false;
    if (isManualTagRepositioning && selectedManualTag) {
      manualTagEditGeometry = geometry;
      isManualTagRepositioning = false;
      return;
    }
    manualTagDraft = geometry;
    manualTagQuery = '';
    manualTagSelectedSubjectId = '';
    manualTagType = '';
    manualTagSaveError = '';
    selectedManualTagId = '';
    manualTagRemoveConfirmId = '';
    selectedFaceId = '';
    selectedBodyId = '';
    isEditingFaceName = false;
    await tick();
    manualTagInput?.focus();
  };

  const selectManualTagSubject = (subject: ManualPhotoTagSubject) => {
    manualTagSelectedSubjectId = subject.id;
    manualTagQuery = subject.name;
    manualTagSaveError = '';
  };

  const selectSavedManualTag = (tag: CimmichManualSubjectTag) => {
    manualTagDraft = undefined;
    selectedManualTagId = tag.tagId;
    manualTagEditGeometry = { ...tag.geometry };
    manualTagSelectedSubjectId = tag.subject.subjectId;
    manualTagQuery = tag.subject.displayName;
    manualTagType = tag.tagType;
    isManualTagRepositioning = false;
    isTaggingHintVisible = false;
    manualTagRemoveConfirmId = '';
    manualTagSaveError = '';
    void loadManualTagSubjects();
  };

  const loadManualSubjectTagReadback = async (assetId: string) => {
    const generation = ++manualTagReadGeneration;
    if (!assetId) {
      manualSubjectTagItems = [];
      manualPresenceItems = [];
      manualTagReadError = '';
      return;
    }
    try {
      const [result, presences] = await Promise.all([
        getCimmichManualSubjectTags(assetId),
        getCimmichManualPresences(assetId),
      ]);
      if (generation !== manualTagReadGeneration) {
        return;
      }
      manualSubjectTagItems = result.items;
      manualPresenceItems = presences.items;
      if (result.items.some((tag) => tag.subject.subjectKind === 'pet')) {
        void loadManualPetIcons();
      }
      manualTagReadError = '';
    } catch (error) {
      if (generation !== manualTagReadGeneration) {
        return;
      }
      manualSubjectTagItems = [];
      manualPresenceItems = [];
      manualTagReadError = error instanceof Error ? error.message : 'Unable to load manual tags';
    }
  };

  const closePresencePicker = () => {
    isPresencePickerOpen = false;
    presenceQuery = '';
    presenceSelectedSubjectId = '';
    presenceError = '';
  };

  const openPresencePicker = async () => {
    assetViewerManager.closeDetailPanel();
    stopTagging();
    isPresencePickerOpen = true;
    presenceQuery = '';
    presenceSelectedSubjectId = '';
    presenceError = '';
    await loadManualTagSubjects();
    await tick();
    presenceInput?.focus();
  };

  const selectPresenceSubject = (subject: ManualPhotoTagSubject) => {
    presenceSelectedSubjectId = subject.id;
    presenceQuery = subject.name;
    presenceError = '';
  };

  const saveRegionlessPresence = async () => {
    if (!presenceSelectedSubject || !evidence?.summary?.searchRowId || isPresenceSaving) {
      return;
    }
    isPresenceSaving = true;
    presenceError = '';
    presenceMessage = '';
    try {
      const result = await setCimmichManualPresence(evidence.summary.searchRowId, {
        action: 'attach',
        commandId: createCimmichManualPresenceCommandId('photo-presence'),
        geometry: null,
        subjectId: presenceSelectedSubject.id,
        subjectKind: presenceSelectedSubject.kind,
      });
      await loadManualSubjectTagReadback(evidence.summary.searchRowId);
      presenceMessage = result.changed
        ? `${result.subject.displayName} is present in this photo.`
        : `${result.subject.displayName} is already present in this photo.`;
      presenceUndoDecisionId = result.changed ? result.decisionId || '' : '';
      closePresencePicker();
    } catch (error) {
      presenceError = error instanceof Error ? error.message : 'Unable to save Presence';
    } finally {
      isPresenceSaving = false;
    }
  };

  const removeRegionlessPresence = async (presence: CimmichManualPresenceAssociation) => {
    if (!evidence?.summary?.searchRowId || isPresenceSaving) {
      return;
    }
    if (!globalThis.confirm(`Remove ${presence.displayName}'s Presence from this photo?`)) {
      return;
    }
    isPresenceSaving = true;
    presenceError = '';
    presenceMessage = '';
    try {
      const result = await setCimmichManualPresence(evidence.summary.searchRowId, {
        action: 'detach',
        commandId: createCimmichManualPresenceCommandId('photo-presence-remove'),
        subjectId: presence.subjectId,
        subjectKind: presence.subjectKind,
      });
      await loadManualSubjectTagReadback(evidence.summary.searchRowId);
      presenceMessage = result.changed ? `${result.subject.displayName}'s Presence removed.` : 'Nothing changed.';
      presenceUndoDecisionId = result.changed ? result.decisionId || '' : '';
    } catch (error) {
      presenceError = error instanceof Error ? error.message : 'Unable to remove Presence';
    } finally {
      isPresenceSaving = false;
    }
  };

  const undoRegionlessPresence = async () => {
    if (!presenceUndoDecisionId || !evidence?.summary?.searchRowId || isPresenceSaving) {
      return;
    }
    isPresenceSaving = true;
    presenceError = '';
    try {
      const result = await undoCimmichManualPresence(
        presenceUndoDecisionId,
        createCimmichManualPresenceCommandId('photo-presence-undo'),
      );
      await loadManualSubjectTagReadback(evidence.summary.searchRowId);
      presenceMessage = result.action === 'undo' ? 'Presence change undone.' : 'Presence restored.';
      presenceUndoDecisionId = '';
    } catch (error) {
      presenceError = error instanceof Error ? error.message : 'Unable to undo Presence change';
    } finally {
      isPresenceSaving = false;
    }
  };

  const saveManualTag = async () => {
    if (!manualTagDraft || !manualTagSelectedSubject || !manualTagType || !evidence?.summary?.searchRowId) {
      return;
    }
    isManualTagSaving = true;
    manualTagSaveError = '';
    manualTagActionMessage = '';
    const stableAssetId = evidence.summary.searchRowId;
    try {
      const result = await attachCimmichManualSubjectTag(stableAssetId, {
        commandId: createCimmichManualSubjectTagCommandId('photo-tag'),
        region: manualTagDraft,
        subjectId: manualTagSelectedSubject.id,
        subjectKind: manualTagSelectedSubject.kind,
        tagType: manualTagType,
      });
      await loadManualSubjectTagReadback(stableAssetId);
      const refreshed = await getCimmichEvidenceForAsset(asset);
      if (refreshed.evidence) {
        evidence = refreshed.evidence;
        bundle = refreshed.bundle;
      }
      manualTagActionMessage = result.changed
        ? `${result.tag.subject.displayName} saved as ${manualTagTypeLabel(result.tag.tagType)}`
        : `${result.tag.subject.displayName} is already tagged as ${manualTagTypeLabel(result.tag.tagType)}`;
      manualTagUndoDecisionId = result.changed && result.tag.undo.eligible ? result.tag.undo.decisionId || '' : '';
      stopTagging();
    } catch (error) {
      manualTagSaveError = error instanceof Error ? error.message : 'Unable to save this tag';
    } finally {
      isManualTagSaving = false;
    }
  };

  const replaceManualTag = async () => {
    if (!selectedManualTag || !manualTagEditGeometry || !manualTagSelectedSubject || !manualTagType) {
      return;
    }
    isManualTagSaving = true;
    manualTagSaveError = '';
    manualTagActionMessage = '';
    try {
      const result = await replaceCimmichManualSubjectTag(selectedManualTag.tagId, {
        commandId: createCimmichManualSubjectTagCommandId('photo-tag-replace'),
        expectedDecisionId: selectedManualTag.decision.decisionId,
        region: manualTagEditGeometry,
        subjectId: manualTagSelectedSubject.id,
        subjectKind: manualTagSelectedSubject.kind,
        tagType: manualTagType,
      });
      if (evidence?.summary?.searchRowId) {
        await loadManualSubjectTagReadback(evidence.summary.searchRowId);
        const refreshed = await getCimmichEvidenceForAsset(asset);
        if (refreshed.evidence) {
          evidence = refreshed.evidence;
          bundle = refreshed.bundle;
        }
      }
      manualTagActionMessage = result.changed ? `${result.tag.subject.displayName} tag updated` : 'No changes to save';
      manualTagUndoDecisionId = result.changed && result.tag.undo.eligible ? result.tag.undo.decisionId || '' : '';
      selectedManualTagId = result.tag.tagId;
      manualTagEditGeometry = { ...result.tag.geometry };
      manualTagSelectedSubjectId = result.tag.subject.subjectId;
      manualTagQuery = result.tag.subject.displayName;
      manualTagType = result.tag.tagType;
      manualTagRemoveConfirmId = '';
    } catch (error) {
      manualTagSaveError = error instanceof Error ? error.message : 'Unable to update this tag';
    } finally {
      isManualTagSaving = false;
    }
  };

  const undoManualTag = async (decisionId: string) => {
    if (!decisionId || !evidence?.summary?.searchRowId) {
      return;
    }
    isManualTagSaving = true;
    manualTagSaveError = '';
    try {
      const result = await undoCimmichManualSubjectTag(
        decisionId,
        createCimmichManualSubjectTagCommandId('photo-tag-undo'),
      );
      await loadManualSubjectTagReadback(evidence.summary.searchRowId);
      const refreshed = await getCimmichEvidenceForAsset(asset);
      if (refreshed.evidence) {
        evidence = refreshed.evidence;
        bundle = refreshed.bundle;
      }
      stopTagging();
      manualTagActionMessage =
        result.status === 'restored'
          ? `${result.tag.subject.displayName} tag restored`
          : `${result.tag.subject.displayName} tag removed`;
      manualTagUndoDecisionId = '';
    } catch (error) {
      manualTagSaveError = error instanceof Error ? error.message : 'Unable to undo this tag';
    } finally {
      isManualTagSaving = false;
    }
  };

  const undoLastManualTag = () => undoManualTag(manualTagUndoDecisionId);

  const toggleTagging = () => {
    const shouldEnable = !isTaggingMode;
    assetViewerManager.closeDetailPanel();
    isTaggingMode = shouldEnable;
    isTaggingHintVisible = shouldEnable;
    isFacesVisible = true;
    isBodiesVisible = true;
    isEditingFaceName = false;
    faceActionMessage = '';
    faceActionError = '';
    cancelManualTagDraft();
    selectedManualTagId = '';
    manualTagEditGeometry = undefined;
    isManualTagRepositioning = false;
    manualTagRemoveConfirmId = '';
    if (shouldEnable) {
      if (assetViewerManager.zoom > 1) {
        assetViewerManager.resetZoomState();
      }
      void loadManualTagSubjects();
    }
  };

  $effect(() => {
    if (!assetViewerManager.isShowDetailPanel) {
      return;
    }

    overlayView = 'off';
    selectedFaceId = '';
    selectedBodyId = '';
    isBulkFacePanelOpen = false;
    isTaggingMode = false;
    isEditingFaceName = false;
    isExpanded = false;
    manualTagDraft = undefined;
    manualTagQuery = '';
    manualTagSelectedSubjectId = '';
    manualTagType = '';
    selectedManualTagId = '';
  });

  const handleWindowKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && isManualTagRepositioning) {
      event.preventDefault();
      event.stopImmediatePropagation();
      isManualTagRepositioning = false;
      return;
    }
    if (event.key === 'Escape' && isPresencePickerOpen) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closePresencePicker();
      return;
    }
    if (event.key === 'Escape' && selectedManualTag) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeManualTagEditor();
      return;
    }
    if (event.key === 'Escape' && manualTagDraft) {
      event.preventDefault();
      event.stopImmediatePropagation();
      stopTagging();
      return;
    }
    if (event.key === 'Escape' && isTaggingMode) {
      event.preventDefault();
      event.stopImmediatePropagation();
      stopTagging();
      return;
    }
    if (event.key === 'Escape' && isEnhancedMenuOpen) {
      event.preventDefault();
      event.stopImmediatePropagation();
      isEnhancedMenuOpen = false;
      return;
    }
    if (event.key === 'Escape' && (overlayView !== 'off' || isSummaryVisible || isSidecarVisible)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      selectOverlayView('off');
    }
  };

  const sidecarSections = $derived.by(() => {
    if (!evidence?.summary) {
      return [];
    }

    const confirmedPeople = faceOverlays
      .filter((face) => face.status === 'named')
      .map((face) => `${facePeopleTagLabel(face)} · ${faceLinkedBody(face) ? 'face + body' : 'face'}`);
    const bodyOnlyPeople = peopleBodyOverlays
      .filter((body) => bodyPeopleTagMode(body) === 'body-only')
      .map((body) => `${bodyIdentityName(body)} · body/context only`);
    const unresolvedPeople = bodyOverlays.filter((body) => body.status !== 'linked').length;
    const sceneValues = [
      evidence.summary.visualScene ? { label: 'Scene', value: evidence.summary.visualScene } : undefined,
      evidence.summary.visualSetting ? { label: 'Setting', value: evidence.summary.visualSetting } : undefined,
      evidence.summary.visibleActions?.length
        ? { label: 'Visible actions', value: evidence.summary.visibleActions.join(', ') }
        : undefined,
      evidence.summary.visiblePeopleCountEstimate
        ? { label: 'People estimate', value: String(evidence.summary.visiblePeopleCountEstimate) }
        : undefined,
    ].filter((field): field is { label: string; value: string } => Boolean(field?.value));

    return [
      {
        fields: [
          { label: 'Standard', value: normalSummary || 'Not available' },
          { label: 'Enhanced', value: enhancedSummary || step2SummaryText || 'Not available' },
        ],
        title: 'Descriptions',
      },
      {
        fields: [
          ...(confirmedPeople.length > 0 ? [{ label: 'Confirmed', value: confirmedPeople.join(', ') }] : []),
          ...(bodyOnlyPeople.length > 0 ? [{ label: 'Body/context', value: bodyOnlyPeople.join(', ') }] : []),
          ...(unresolvedPeople > 0
            ? [
                {
                  label: 'Needs decision',
                  value: `${unresolvedPeople} unnamed ${unresolvedPeople === 1 ? 'person' : 'people'}`,
                },
              ]
            : []),
        ],
        title: 'People',
      },
      {
        fields: [
          ...(evidence.summary.exifDate ? [{ label: 'Captured', value: evidence.summary.exifDate }] : []),
          ...(evidence.summary.eventContext
            ? [{ label: 'Event / collection', value: evidence.summary.eventContext }]
            : []),
          ...(evidence.summary.visualSetting ? [{ label: 'Place', value: evidence.summary.visualSetting }] : []),
        ],
        title: 'Context',
      },
      ...(sceneValues.length > 0 ? [{ fields: sceneValues, title: 'What is visible' }] : []),
    ].filter((section) => section.fields.length > 0);
  });

  const moreLines = $derived.by(() => {
    if (step2Item) {
      if (!step2HasConsequentialReview && !step2Item.enhancedVisualQc) {
        return [];
      }
      const lines = [`Event: ${step2Item.summaryInput.event_clause}.`];
      if (step2Item.enhancedVisualQc) {
        const enhanced = step2Item.enhancedVisualQc;
        lines.push(
          `Enhanced QC: ${enhanced.terminalOutcome.replaceAll('_', ' ')} · confidence ${enhanced.confidence ?? 'not scored'} · model ${enhanced.modelDigest.slice(0, 12)}…`,
        );
        if (enhanced.visibleEntities.length > 0) {
          lines.push(`Visible entities: ${enhanced.visibleEntities.join(', ')}.`);
        }
        for (const uncertainty of enhanced.additionalUncertainties) {
          lines.push(`Safe unknown: ${uncertainty}.`);
        }
      }
      for (const clause of step2Item.identity.clauses) {
        const subject = clause.subject_scopes.map((scope) => scope.replaceAll('_', ' ')).join(', ');
        const negative = clause.negative_scopes.map((scope) => scope.replaceAll('_', ' ')).join(', ');
        lines.push(
          `${clause.name} · ${clause.evidence_class.replaceAll('_', ' ')} · scope: ${subject}${negative ? ` · does not: ${negative}` : ''}.`,
        );
      }
      for (const face of step2Item.identity.localFaces.filter(
        (candidate) => candidate.sequence_identity_candidate?.status === 'reject_candidate',
      )) {
        lines.push(
          `${face.sequence_identity_candidate?.name} proposal · rejected; ${face.disposition.replaceAll('_', ' ')}.`,
        );
      }
      if (step2Item.visibleText.present) {
        lines.push(
          `Visible text (${step2Item.visibleText.legibility}): ${step2Item.visibleText.visible_text_clues.join(', ')}.`,
        );
      }
      if (step2Item.captureContext.temporalClashIds.length > 0) {
        lines.push(`Unresolved temporal context: ${step2Item.captureContext.temporalClashIds.join(', ')}.`);
      }
      lines.push(
        `Exact v3 ledger · ${step2Readback?.rowCount} rows · digest ${step2Readback?.decisionDigestSha256.slice(0, 12)}…`,
        step2Item.enhancedVisualQc
          ? 'Read-only enhanced visual QC; canonical identity promotion and all source/database writes remain closed.'
          : 'Read-only intermediate evidence; canonical identity promotion and enhanced visual QC remain closed.',
      );
      return lines;
    }
    if (!evidence?.summary) {
      return [];
    }

    const lines: string[] = [];
    if (
      evidence.summary.visualDetailedCaption &&
      evidence.summary.visualDetailedCaption !== evidence.summary.visualCaption
    ) {
      lines.push(evidence.summary.visualDetailedCaption);
    }
    if (evidence.summary.visualScene) {
      lines.push(`Visible scene: ${evidence.summary.visualScene}.`);
    }
    if (evidence.summary.visibleActions?.length) {
      lines.push(`Visible actions: ${evidence.summary.visibleActions.join(', ')}.`);
    }
    if (evidence.summary.visiblePeopleCountEstimate) {
      lines.push(`Visible people estimate: ${evidence.summary.visiblePeopleCountEstimate}.`);
    }
    if (
      evidence.summary.evidenceDetailedCaption &&
      evidence.summary.evidenceDetailedCaption !== evidence.summary.evidenceCaption
    ) {
      lines.push(evidence.summary.evidenceDetailedCaption);
    }
    lines.push(...(evidence.summary.summaryEvidence ?? []));
    if (candidatePeople.length > 0) {
      lines.push(`Model candidates: ${candidatePeople.join(', ')}.`);
    }
    if (sourcePresenceOverlays.length > 0) {
      lines.push(
        `Source-tagged presence needing localization: ${sourcePresenceOverlays.map((presence) => presence.name).join(', ')}.`,
      );
    }
    if (bodyPeople.length > 0) {
      lines.push(`Body/context people: ${bodyPeople.join(', ')}.`);
    }
    if (evidence.summary.localDescription && !lines.includes(evidence.summary.localDescription)) {
      lines.push(evidence.summary.localDescription);
    }
    if (evidence.summary.visionRouteReason) {
      lines.push(evidence.summary.visionRouteReason);
    }
    for (const row of bodyRows.slice(0, 3)) {
      lines.push(
        `${row.personName || 'Body evidence'}: ${row.reason}${row.machineValue ? ` (${row.machineValue})` : ''}`,
      );
    }
    return lines;
  });

  const loadCurrentEvidence = async (generation: number, assetId: string) => {
    isLoading = true;
    loadError = '';
    try {
      const [result, corrections] = await Promise.all([
        getCimmichEvidenceForAsset(asset),
        getCimmichIdentityCorrectionDiscovery({ sourceAssetId: assetId }, { limit: 1, undoEligible: true }),
      ]);
      if (generation !== evidenceLoadGeneration || asset.id !== assetId) {
        return;
      }
      evidence = result.evidence;
      bundle = result.bundle;
      step2Readback = result.step2Readback;
      identityCorrectionUndoDecisionId = corrections.items[0]?.undo.decisionId ?? '';
      await loadManualSubjectTagReadback(result.evidence?.summary?.searchRowId ?? '');
      isFacesVisible = true;
      isBodiesVisible = true;
    } catch (error) {
      if (generation !== evidenceLoadGeneration || asset.id !== assetId) {
        return;
      }
      evidence = undefined;
      loadError = photoEvidenceLoadErrorMessage(error);
    } finally {
      if (generation === evidenceLoadGeneration && asset.id === assetId) {
        isLoading = false;
      }
    }
  };

  const retryCurrentEvidence = () => {
    const generation = ++evidenceLoadGeneration;
    manualTagReadGeneration += 1;
    evidence = undefined;
    bundle = undefined;
    step2Readback = undefined;
    void loadCurrentEvidence(generation, asset.id);
  };

  $effect(() => {
    void cimmichVisibilityManager.version;
    const assetId = asset.id;
    const generation = ++evidenceLoadGeneration;
    manualTagReadGeneration += 1;
    evidence = undefined;
    bundle = undefined;
    step2Readback = undefined;
    isExpanded = false;
    selectedFaceId = '';
    selectedBodyId = '';
    faceActionMessage = '';
    faceActionError = '';
    identityCorrectionUndoDecisionId = '';
    bulkActionMessage = '';
    bulkActionError = '';
    isEditingFaceName = false;
    isTaggingMode = false;
    manualTagDraft = undefined;
    manualTagQuery = '';
    manualTagSelectedSubjectId = '';
    manualTagType = '';
    manualTagActionMessage = '';
    manualTagUndoDecisionId = '';
    selectedManualTagId = '';
    manualTagRemoveConfirmId = '';
    manualSubjectTagItems = [];
    manualPresenceItems = [];
    isPresencePickerOpen = false;
    presenceQuery = '';
    presenceSelectedSubjectId = '';
    presenceError = '';
    presenceMessage = '';
    presenceUndoDecisionId = '';
    isContextEditing = false;
    isObjectTaggingMode = false;
    objectRegionDraft = undefined;
    objectRegionPointer = undefined;
    objectRegionQuery = '';
    objectSelectedEntityId = '';
    objectActionError = '';
    objectActionMessage = '';
    objectUndoDecisionId = '';
    ownerSummaryDraft = '';
    ownerSummaryActionError = '';
    ownerSummaryActionMessage = '';
    ownerSummaryUndoDecisionId = '';
    contextQuery = '';
    contextAddKind = '';
    contextActionError = '';
    contextActionMessage = '';
    contextUndoDecisionId = '';

    void loadCurrentEvidence(generation, assetId);
  });

  $effect(() => {
    const context = personPhotoContext;
    const target = arrivalCueFace ?? arrivalCueBody;
    if (hasStartedArrivalCue || !context || !target || !imageMetrics) {
      return;
    }

    hasStartedArrivalCue = true;
    isArrivalCueVisible = true;
    const timeout = globalThis.window.setTimeout(() => {
      isArrivalCueVisible = false;
    }, 1500);

    return () => {
      globalThis.window.clearTimeout(timeout);
      isArrivalCueVisible = false;
    };
  });

  $effect(() => {
    const nextDrafts: Record<string, string> = {};
    for (const face of faceOverlays) {
      nextDrafts[face.id] = bulkNameDrafts[face.id] ?? face.name ?? faceCandidateDisplayName(face) ?? '';
    }
    if (!sameDrafts(bulkNameDrafts, nextDrafts)) {
      bulkNameDrafts = nextDrafts;
    }
  });
</script>

<svelte:window
  onkeydowncapture={handleWindowKeyDown}
  onpointermove={handleWindowPointerMove}
  onpointerup={handleWindowPointerUp}
/>

<div
  class="pointer-events-none absolute inset-0 z-50"
  data-testid="cimmich-photo-overlay"
  bind:this={overlayElement}
  bind:clientWidth={overlayWidth}
  bind:clientHeight={overlayHeight}
>
  {#if loadError && !isSummaryVisible && !isSidecarVisible}
    <div class="pointer-events-auto absolute inset-x-4 top-16 z-30 flex justify-center" role="alert">
      <div
        class="flex max-w-xl items-center gap-3 rounded-md border border-red-200/30 bg-black/85 px-4 py-3 text-sm text-red-100 shadow-xl backdrop-blur-sm"
      >
        <span class="min-w-0 flex-1">{loadError}</span>
        <button
          class="shrink-0 rounded-sm border border-current px-3 py-1.5 font-semibold"
          type="button"
          onclick={retryCurrentEvidence}>Retry</button
        >
      </div>
    </div>
  {/if}
  {#if manualTagActionMessage || (manualTagSaveError && !manualTagDraft)}
    <div class="pointer-events-auto absolute inset-x-4 top-20 z-50 flex justify-center">
      <div
        class={[
          'flex min-h-11 max-w-md items-center gap-3 rounded-full border px-4 text-sm font-semibold shadow-xl backdrop-blur-md',
          manualTagSaveError && !manualTagDraft
            ? 'border-red-200/30 bg-red-950/88 text-red-100'
            : 'border-white/20 bg-black/85 text-white',
        ]}
        role={manualTagSaveError && !manualTagDraft ? 'alert' : 'status'}
      >
        <span>{manualTagSaveError && !manualTagDraft ? manualTagSaveError : manualTagActionMessage}</span>
        {#if manualTagUndoDecisionId && !manualTagSaveError}
          <button
            class="min-h-9 rounded-full bg-white/12 px-3 hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50"
            type="button"
            disabled={isManualTagSaving}
            onclick={() => void undoLastManualTag()}
          >
            {isManualTagSaving ? 'Undoing…' : 'Undo'}
          </button>
        {/if}
      </div>
    </div>
  {/if}
  {#if presenceMessage || (presenceError && !isPresencePickerOpen)}
    <div class="pointer-events-auto absolute inset-x-4 top-20 z-50 flex justify-center">
      <div
        class={[
          'flex min-h-11 max-w-md items-center gap-3 rounded-full border px-4 text-sm font-semibold shadow-xl backdrop-blur-md',
          presenceError ? 'border-red-200/30 bg-red-950/88 text-red-100' : 'border-white/20 bg-black/85 text-white',
        ]}
        role={presenceError ? 'alert' : 'status'}
      >
        <span>{presenceError || presenceMessage}</span>
        {#if presenceUndoDecisionId && !presenceError}
          <button
            class="min-h-9 rounded-full bg-white/12 px-3 hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50"
            type="button"
            disabled={isPresenceSaving}
            onclick={() => void undoRegionlessPresence()}
          >
            {isPresenceSaving ? 'Undoing…' : 'Undo'}
          </button>
        {/if}
      </div>
    </div>
  {/if}
  <datalist id="cimmich-known-face-names">
    {#each knownNameOptions as name (name)}
      <option value={name}></option>
    {/each}
  </datalist>

  <Portal target="body">
    <div
      class="pointer-events-auto fixed top-17 left-3 z-100 flex max-w-[calc(100%-1.5rem)] items-center gap-1 overflow-x-auto sm:top-2 sm:left-28 sm:max-w-[calc(100%-8rem)]"
      data-testid="cimmich-top-bar"
    >
      <div class="flex shrink-0 items-center gap-1 text-white drop-shadow-[0_1px_2px_rgb(0_0_0/0.9)]">
        <Tooltip text="People">
          {#snippet child({ props })}
            <button
              {...props}
              class={[
                'flex h-11 items-center justify-center gap-2 rounded-full px-3 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
                isPeopleSurfaceActive
                  ? 'bg-white text-black shadow-sm'
                  : 'text-white/72 hover:bg-white/10 hover:text-white',
              ]}
              type="button"
              aria-label="People"
              aria-pressed={isPeopleSurfaceActive}
              onclick={togglePeopleView}
              data-testid="cimmich-people-view"
            >
              <Icon icon={mdiAccountMultipleOutline} size="20" />
              <span class="text-sm font-medium">People</span>
            </button>
          {/snippet}
        </Tooltip>

        <Tooltip text="Context">
          {#snippet child({ props })}
            <button
              {...props}
              class={[
                'flex h-11 items-center justify-center gap-2 rounded-full px-3 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
                isContextSurfaceActive
                  ? 'bg-white text-black shadow-sm'
                  : 'text-white/72 hover:bg-white/10 hover:text-white',
              ]}
              type="button"
              aria-label="Context"
              aria-pressed={isContextSurfaceActive}
              onclick={toggleContextView}
              data-testid="cimmich-context-view"
            >
              <Icon icon={mdiImageOutline} size="20" />
              <span class="text-sm font-medium">Context</span>
            </button>
          {/snippet}
        </Tooltip>

        {#if isPeopleSurfaceActive}
          <span class="mx-1 h-6 w-px bg-white/20" aria-hidden="true"></span>
          {#if !selectedManualTag}
            <Tooltip text={isTaggingMode ? 'Cancel adding a person or pet' : 'Add a person or pet'}>
              {#snippet child({ props })}
                <button
                  {...props}
                  class={[
                    'flex h-10 items-center justify-center gap-2 rounded-full border px-3 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
                    isTaggingMode
                      ? 'border-white bg-white text-black shadow-sm'
                      : 'border-white/25 bg-black/25 text-white hover:border-white/45 hover:bg-white/10',
                  ]}
                  type="button"
                  aria-label={isTaggingMode ? 'Cancel adding a person or pet' : 'Add a person or pet'}
                  aria-pressed={isTaggingMode}
                  onclick={toggleTagging}
                  data-testid="cimmich-add-tag-action"
                >
                  <Icon icon={mdiAccountTagOutline} size="18" />
                  <span class="text-sm font-medium">{isTaggingMode ? 'Cancel adding' : 'Add person or pet'}</span>
                </button>
              {/snippet}
            </Tooltip>
          {/if}
          <Tooltip text="Mark a person or pet present without drawing a region">
            {#snippet child({ props })}
              <button
                {...props}
                class={[
                  'flex h-10 items-center justify-center gap-2 rounded-full border px-3 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
                  isPresencePickerOpen
                    ? 'border-white bg-white text-black shadow-sm'
                    : 'border-white/25 bg-black/25 text-white hover:border-white/45 hover:bg-white/10',
                ]}
                type="button"
                aria-label="Add Presence without a region"
                aria-pressed={isPresencePickerOpen}
                onclick={() => (isPresencePickerOpen ? closePresencePicker() : void openPresencePicker())}
                data-testid="cimmich-add-presence-action"
              >
                <Icon icon={mdiAccountOutline} size="18" />
                <span class="text-sm font-medium">Presence</span>
              </button>
            {/snippet}
          </Tooltip>
          <Tooltip text={overlayView === 'machinery' ? 'Finish editing' : 'Edit people tags'}>
            {#snippet child({ props })}
              <button
                {...props}
                class={[
                  'flex h-10 items-center justify-center gap-2 rounded-full border px-3 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
                  overlayView === 'machinery'
                    ? 'border-white bg-white text-black shadow-sm'
                    : 'border-white/25 bg-black/25 text-white hover:border-white/45 hover:bg-white/10',
                ]}
                type="button"
                aria-label={overlayView === 'machinery' ? 'Finish editing people tags' : 'Edit people tags'}
                aria-pressed={overlayView === 'machinery'}
                onclick={() => selectOverlayView(overlayView === 'machinery' ? 'people' : 'machinery')}
                data-testid="cimmich-detailed-view"
              >
                <Icon icon={mdiTargetAccount} size="18" />
                <span class="text-sm font-medium">{overlayView === 'machinery' ? 'Done' : 'Edit'}</span>
              </button>
            {/snippet}
          </Tooltip>
        {:else if isContextSurfaceActive}
          <span class="mx-1 h-6 w-px bg-white/20" aria-hidden="true"></span>
          <button
            class={[
              'flex h-10 items-center gap-2 rounded-full border px-3 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
              isObjectTaggingMode
                ? 'border-white bg-white text-black shadow-sm'
                : 'border-white/25 bg-black/25 text-white hover:border-white/45 hover:bg-white/10',
            ]}
            type="button"
            aria-label={isObjectTaggingMode ? 'Cancel adding an object tag' : 'Add object'}
            aria-pressed={isObjectTaggingMode}
            onclick={() => {
              if (isObjectTaggingMode) {
                closeObjectTagging();
              } else {
                openObjectTagging();
              }
            }}
          >
            <Icon icon={mdiTagOutline} size="17" />
            {isObjectTaggingMode ? 'Cancel' : 'Add object'}</button
          >
          <button
            class={[
              'flex h-10 items-center gap-2 rounded-full border px-3 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
              isContextEditing
                ? 'border-white bg-white text-black shadow-sm'
                : 'border-white/25 bg-black/25 text-white hover:border-white/45 hover:bg-white/10',
            ]}
            type="button"
            aria-pressed={isContextEditing}
            onclick={toggleContextEditing}
          >
            <Icon icon={mdiPencilOutline} size="17" />
            {isContextEditing ? 'Done' : 'Edit'}</button
          >
        {/if}
      </div>
    </div>
  </Portal>

  {#if isPresencePickerOpen && isPeopleSurfaceActive}
    <section
      class="pointer-events-auto absolute top-20 left-1/2 z-60 w-[min(24rem,calc(100%-2rem))] -translate-x-1/2 rounded-2xl border border-white/20 bg-black/92 p-4 text-white shadow-2xl backdrop-blur-xl"
      aria-label="Add Presence"
      data-testid="cimmich-presence-picker"
    >
      <div class="flex items-start justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold">Who is in this photo?</h2>
          <p class="mt-1 text-xs text-white/65">Presence records the person or pet without drawing a region.</p>
        </div>
        <button
          class="flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-white/12 focus-visible:outline-2 focus-visible:outline-white"
          type="button"
          aria-label="Close Presence picker"
          onclick={closePresencePicker}
        >
          <Icon icon={mdiClose} size="18" />
        </button>
      </div>
      <label class="mt-4 block text-xs font-semibold text-white/70" for="cimmich-presence-search">Person or pet</label>
      <input
        bind:this={presenceInput}
        bind:value={presenceQuery}
        id="cimmich-presence-search"
        class="mt-1 h-11 w-full rounded-xl border border-white/20 bg-white/10 px-3 text-sm text-white outline-none placeholder:text-white/45 focus:border-white/55"
        placeholder="Search people and pets"
        autocomplete="off"
        oninput={() => {
          if (presenceSelectedSubject?.name !== normalizeName(presenceQuery)) {
            presenceSelectedSubjectId = '';
          }
          presenceError = '';
        }}
        onkeydown={stopPhotoViewerShortcutPropagation}
      />
      {#if isManualTagSubjectsLoading}
        <p class="mt-3 text-sm text-white/60">Loading people and pets…</p>
      {:else if manualTagSubjectsError}
        <p class="mt-3 text-sm text-red-200" role="alert">{manualTagSubjectsError}</p>
      {:else if presenceSubjectMatches.length > 0}
        <div class="mt-2 max-h-48 space-y-1 overflow-y-auto" role="listbox" aria-label="People and pets">
          {#each presenceSubjectMatches as subject (subject.id)}
            <button
              class={[
                'flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm transition focus-visible:outline-2 focus-visible:outline-white',
                presenceSelectedSubjectId === subject.id ? 'bg-white text-black' : 'hover:bg-white/12',
              ]}
              type="button"
              role="option"
              aria-selected={presenceSelectedSubjectId === subject.id}
              onclick={() => selectPresenceSubject(subject)}
            >
              <Icon icon={subject.kind === 'pet' ? manualPetIcon(subject.id) : mdiAccountOutline} size="17" />
              <span class="min-w-0 flex-1 truncate">{subject.name}</span>
              <span class={presenceSelectedSubjectId === subject.id ? 'text-black/55' : 'text-white/45'}>
                {subject.kind === 'pet' ? 'Pet' : 'Person'}
              </span>
            </button>
          {/each}
        </div>
      {:else}
        <p class="mt-3 text-sm text-white/60">No matching people or pets.</p>
      {/if}
      {#if presenceError}
        <p class="mt-3 text-sm text-red-200" role="alert">{presenceError}</p>
      {/if}
      <div class="mt-4 flex justify-end gap-2 border-t border-white/12 pt-3">
        <button
          class="min-h-10 rounded-full px-4 text-sm font-semibold text-white/75 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"
          type="button"
          onclick={closePresencePicker}>Cancel</button
        >
        <button
          class="min-h-10 rounded-full bg-white px-4 text-sm font-semibold text-black hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-45"
          type="button"
          disabled={!presenceSelectedSubject || isPresenceSaving}
          onclick={() => void saveRegionlessPresence()}
        >
          {isPresenceSaving ? 'Saving…' : 'Save Presence'}
        </button>
      </div>
    </section>
  {/if}

  {#if isContextSurfaceActive && imageMetrics}
    {#if isObjectTaggingMode}
      <button
        class="pointer-events-auto absolute z-20 cursor-crosshair border-0 bg-transparent p-0"
        style={fittedImageStyle}
        type="button"
        aria-label="Drag over the object to tag it"
        title="Drag around the object"
        data-testid="cimmich-object-region-canvas"
        onpointerdown={beginObjectRegion}
        onpointermove={moveObjectRegion}
        onpointerup={finishObjectRegion}
        onpointercancel={() => {
          objectRegionPointer = undefined;
          objectRegionDraft = undefined;
        }}
      ></button>
      <div
        class="pointer-events-none absolute top-20 left-1/2 z-40 -translate-x-1/2 rounded-full bg-black/82 px-4 py-2 text-sm font-semibold text-white shadow-xl backdrop-blur-sm"
        role="status"
      >
        {objectRegionDraft ? 'Choose the Thing, then save' : 'Drag around the object'}
      </div>
    {/if}

    <div class="pointer-events-none absolute inset-0 z-30" style={spatialOverlayStyle}>
      {#each thingRegions as tag (tag.tagId)}
        <div
          class="absolute rounded-md border-2 border-white/85 bg-white/5 shadow-[0_0_0_1px_rgb(0_0_0/0.45)]"
          style={manualTagGeometryStyle(tag.region)}
          data-testid="cimmich-object-region"
        >
          <span
            class="absolute -top-9 left-0 max-w-56 truncate rounded-full bg-white px-3 py-1.5 text-xs font-bold text-black shadow-lg"
          >
            {tag.displayName}
          </span>
        </div>
      {/each}
      {#if objectRegionDraft}
        <div
          class="absolute rounded-md border-2 border-cyan-200 bg-cyan-300/12 shadow-[0_0_0_1px_rgb(0_0_0/0.55)]"
          style={manualTagGeometryStyle(objectRegionDraft)}
          data-testid="cimmich-object-region-draft"
        ></div>
      {/if}
    </div>

    {#if isObjectTaggingMode && objectRegionDraft}
      <section
        class="pointer-events-auto absolute z-50 grid gap-3 overflow-y-auto rounded-xl border border-white/20 bg-black/90 p-4 text-white shadow-2xl backdrop-blur-md"
        style={manualTagPanelPosition(objectRegionDraft)}
        aria-label="Tag this object"
        data-testid="cimmich-object-region-panel"
      >
        <div>
          <p class="text-[11px] font-bold tracking-[0.14em] text-white/55 uppercase">Tag this object</p>
          <p class="mt-1 text-sm text-white/75">Choose the Thing inside the region.</p>
        </div>
        <input
          class="min-h-10 rounded-lg border border-white/20 bg-white/8 px-3 text-sm text-white outline-none placeholder:text-white/40 focus:border-white/65"
          placeholder="Find a Thing"
          autocomplete="off"
          bind:value={objectRegionQuery}
          onkeydown={stopPhotoViewerShortcutPropagation}
        />
        <div class="grid max-h-40 gap-1 overflow-y-auto">
          {#each availableObjectOptions as option (option.entityId)}
            <button
              class={[
                'min-h-10 rounded-lg px-3 text-left text-sm font-semibold transition',
                objectSelectedEntityId === option.entityId
                  ? 'bg-white text-black'
                  : 'bg-white/8 text-white hover:bg-white/15',
              ]}
              type="button"
              aria-pressed={objectSelectedEntityId === option.entityId}
              onclick={() => {
                objectSelectedEntityId = option.entityId;
                objectRegionQuery = option.displayName;
              }}>{option.displayName}</button
            >
          {:else}
            <p class="rounded-lg bg-white/8 px-3 py-2 text-xs text-white/60">
              {objectRegionQuery ? 'No visible Thing matches that search.' : 'No untagged Things are available.'}
            </p>
          {/each}
        </div>
        <div class="flex justify-end gap-2">
          <button
            class="min-h-10 rounded-full px-4 text-sm font-semibold text-white/70 hover:bg-white/10"
            type="button"
            onclick={closeObjectTagging}>Cancel</button
          >
          <button
            class="min-h-10 rounded-full bg-white px-4 text-sm font-bold text-black disabled:opacity-45"
            type="button"
            disabled={!selectedObjectOption || isObjectSaving}
            onclick={() => void saveObjectRegion()}>{isObjectSaving ? 'Saving…' : 'Save object tag'}</button
          >
        </div>
        {#if objectActionError}
          <p class="rounded-lg bg-red-400/15 px-3 py-2 text-xs text-red-100" role="alert">{objectActionError}</p>
        {/if}
      </section>
    {/if}
  {/if}

  {#if !isSidecarVisible && !isSummaryVisible && overlayView === 'machinery' && imageMetrics && ((isFacesVisible && visibleMatchFaceOverlays.length > 0) || (isBodiesVisible && visibleSpatialBodyOverlays.length > 0))}
    <div
      class="pointer-events-none absolute inset-0"
      style={spatialOverlayStyle}
      data-testid="cimmich-machinery-overlay-layer"
    >
      {#if isBodiesVisible && visibleSpatialBodyOverlays.length > 0}
        {#each visibleBodyOverlayUrls as overlayUrl (overlayUrl)}
          <img
            src={overlayUrl}
            alt=""
            class="absolute object-contain opacity-45 mix-blend-screen"
            style={fittedImageStyle}
            aria-hidden="true"
            loading="lazy"
          />
        {/each}
        <svg class="absolute inset-0 size-full" aria-hidden="true">
          {#each visibleSpatialBodyOverlays as body (body.id)}
            <g
              class:cimmich-body-skeleton--emphasized={isBodyLinkEmphasized(body)}
              class:cimmich-body-skeleton--muted={!isBodyLinkEmphasized(body) &&
                Boolean(selectedFaceId || hoveredFaceId)}
              data-testid="cimmich-body-skeleton"
              data-body-id={body.id}
            >
              {#each bodySkeletonSegments(body) as segment (segment.key)}
                <line
                  class="cimmich-body-skeleton-line"
                  style={bodyColorStyle(body)}
                  x1={segment.a.x}
                  y1={segment.a.y}
                  x2={segment.b.x}
                  y2={segment.b.y}
                />
              {/each}
              {#each bodySkeletonJoints(body) as joint (joint.key)}
                <circle
                  class="cimmich-body-skeleton-joint"
                  style={bodyColorStyle(body)}
                  cx={joint.x}
                  cy={joint.y}
                  r="3.2"
                />
              {/each}
            </g>
          {/each}
        </svg>
      {/if}

      {#if isBodiesVisible}
        {#each visibleSpatialBodyOverlays as body (body.id)}
          <button
            class={[
              'cimmich-machine-body',
              'cimmich-machine-body--pose',
              `cimmich-machine-body--${body.status}`,
              isBodyLinkEmphasized(body) ? 'cimmich-machine-body--emphasized' : '',
              body.id === selectedBodyId ? 'cimmich-machine-body--selected' : '',
            ]}
            style={`${bodyBoxStyle(body)} ${bodyColorStyle(body)}`}
            data-testid="cimmich-machine-body"
            data-body-id={body.id}
            title={body.id === selectedBodyId ? 'Drag to move this Body' : bodyLabelTitle(body)}
            type="button"
            onmouseenter={() => (hoveredBodyId = body.id)}
            onmouseleave={() => (hoveredBodyId = '')}
            onpointerdown={(event) => {
              if (body.id === selectedBodyId) {
                startBodyBoxDrag(event, body, 'move');
              } else {
                event.stopPropagation();
              }
            }}
            onclick={(event) => {
              event.stopPropagation();
              setSelectedBody(body);
            }}
          ></button>
          {#if body.id === selectedBodyId}
            <div class="cimmich-observation-handles" style={bodyBoxStyle(body)} aria-label="Resize Body">
              {#each faceBoxHandles as handle (handle.mode)}
                <button
                  class={`cimmich-face-box-handle cimmich-face-box-handle--${handle.mode}`}
                  type="button"
                  aria-label={handle.label.replace('Resize', 'Resize Body')}
                  onpointerdown={(event) => startBodyBoxDrag(event, body, handle.mode)}
                ></button>
              {/each}
            </div>
          {/if}
        {/each}
      {/if}

      {#if isFacesVisible}
        {#each visibleMatchFaceOverlays as face (face.id)}
          {@const linkedBody = faceSpatialBody(face)}
          {@const bestCandidate = bestFaceCandidate(face)}
          <button
            class={[
              'cimmich-machine-face',
              `cimmich-machine-face--${face.status.replaceAll('_', '-')}`,
              faceMatchesPersonContext(face) ? 'cimmich-machine-face--context' : '',
              isFaceLinkEmphasized(face) ? 'cimmich-machine-face--linked-focus' : '',
              face.id === selectedFaceId ? 'cimmich-machine-face--selected' : '',
            ]}
            data-context-person={faceMatchesPersonContext(face) ? 'true' : undefined}
            style={`${faceBoxStyle(face)} ${machineFaceColorStyle(face, linkedBody)}`}
            title={faceLabelTitle(face, linkedBody)}
            type="button"
            onmouseenter={() => (hoveredFaceId = face.id)}
            onmouseleave={() => (hoveredFaceId = '')}
            onpointerdown={(event) => {
              if (face.id === selectedFaceId && isCimmichEvidence) {
                startFaceBoxDrag(event, face, 'move');
              } else {
                event.stopPropagation();
              }
            }}
            onclick={(event) => {
              event.stopPropagation();
              setSelectedFace(face, { editName: face.status !== 'named' });
            }}
          ></button>
          <div
            class={[
              'cimmich-machine-face-label',
              bestCandidate ? 'cimmich-machine-face-label--candidate' : '',
              faceMatchesPersonContext(face) ? 'cimmich-machine-face-label--context' : '',
            ]}
            data-context-person={faceMatchesPersonContext(face) ? 'true' : undefined}
            data-testid={bestCandidate ? 'cimmich-machine-face-candidate' : undefined}
            data-face-id={face.id}
            role="group"
            style={`${faceLabelStyle(face)} ${machineFaceColorStyle(face, linkedBody)}`}
            title={faceLabelTitle(face, linkedBody)}
            onmouseenter={() => (hoveredFaceId = face.id)}
            onmouseleave={() => (hoveredFaceId = '')}
          >
            <button
              class="cimmich-machine-face-label-main"
              type="button"
              onpointerdown={(event) => event.stopPropagation()}
              onclick={(event) => {
                event.stopPropagation();
                setSelectedFace(face, { editName: face.status !== 'named' });
              }}
            >
              {bestCandidate
                ? `${bestCandidate.personName} · ${candidateSimilarityLabel(bestCandidate.rawScore)}`
                : machineFaceLabel(face, linkedBody)}
            </button>
            {#if bestCandidate}
              <button
                class="cimmich-machine-candidate-accept"
                data-testid="cimmich-machine-candidate-accept"
                type="button"
                aria-label={`Accept ${bestCandidate.personName} for this Face`}
                title={`Accept ${bestCandidate.personName}`}
                disabled={candidateAcceptingFaceId === face.id}
                onpointerdown={(event) => event.stopPropagation()}
                onclick={(event) => {
                  event.stopPropagation();
                  void acceptFaceCandidate(face, bestCandidate);
                }}
              >
                <Icon icon={mdiCheck} size="14" />
              </button>
              <div class="cimmich-machine-candidate-list" aria-label="Candidate matches">
                {#each face.candidateMatches ?? [] as candidate (candidate.personId)}
                  <span>
                    <span>{candidate.personName} · {candidateSimilarityLabel(candidate.rawScore)}</span>
                    <button
                      type="button"
                      aria-label={`Accept ${candidate.personName} for this Face`}
                      title={`Accept ${candidate.personName}`}
                      disabled={candidateAcceptingFaceId === face.id}
                      onpointerdown={(event) => event.stopPropagation()}
                      onclick={(event) => {
                        event.stopPropagation();
                        void acceptFaceCandidate(face, candidate);
                      }}
                    >
                      <Icon icon={mdiCheck} size="13" />
                    </button>
                  </span>
                {/each}
              </div>
            {/if}
          </div>
          {#if face.id === selectedFaceId && isCimmichEvidence}
            <div class="cimmich-observation-handles" style={faceBoxStyle(face)} aria-label="Resize Face">
              {#each faceBoxHandles as handle (handle.mode)}
                <button
                  class={`cimmich-face-box-handle cimmich-face-box-handle--${handle.mode}`}
                  type="button"
                  aria-label={handle.label.replace('Resize', 'Resize Face')}
                  onpointerdown={(event) => startFaceBoxDrag(event, face, handle.mode)}
                ></button>
              {/each}
            </div>
          {/if}
        {/each}
      {/if}

      {#if isBodiesVisible}
        {#each visibleSpatialBodyOverlays as body (body.id)}
          {#if isPrimaryBodyLabel(body) && (!body.linkedFaceId || isBodyLinkEmphasized(body))}
            <button
              class={[
                bodyLabelClass(body),
                isBodyLinkEmphasized(body) ? 'cimmich-body-label--selected' : '',
                bodyMatchesPersonContext(body) ? 'cimmich-body-label--context' : '',
              ]}
              data-context-person={bodyMatchesPersonContext(body) ? 'true' : undefined}
              style={bodyLabelStyle(body)}
              title={bodyLabelTitle(body)}
              type="button"
              onmouseenter={() => (hoveredBodyId = body.id)}
              onmouseleave={() => (hoveredBodyId = '')}
              onpointerdown={(event) => event.stopPropagation()}
              onclick={(event) => {
                event.stopPropagation();
                setSelectedBody(body);
              }}
            >
              {machineBodyLabel(body)}
            </button>
          {/if}
        {/each}
      {/if}
    </div>
  {/if}

  {#if !isSidecarVisible && !isSummaryVisible && overlayView === 'machinery' && !isTaggingMode && imageMetrics}
    <div
      class="pointer-events-none absolute inset-0 z-30"
      style={spatialOverlayStyle}
      data-testid="cimmich-manual-evidence-edit-layer"
    >
      {#each localizedManualOverlayTags as tag (tag.tagId)}
        <button
          class={[
            'cimmich-manual-presence-label cimmich-manual-presence-label--tagging pointer-events-auto',
            `cimmich-manual-presence-label--${tag.tagType}`,
          ]}
          style={manualSubjectTagMarkerStyle(tag)}
          title={`Edit ${manualTagTypeLabel(tag.tagType)} · ${tag.subject.displayName}`}
          aria-label={`Edit ${manualTagTypeLabel(tag.tagType)} · ${tag.subject.displayName}`}
          data-testid="cimmich-manual-evidence-edit-tag"
          type="button"
          onpointerdown={(event) => event.stopPropagation()}
          onclick={(event) => {
            event.stopPropagation();
            isTaggingMode = true;
            selectSavedManualTag(tag);
          }}
        >
          {#if (tag.tagType !== 'body' && tag.tagType !== 'head') || tag.subject.subjectKind === 'pet'}
            <Icon
              icon={tag.subject.subjectKind === 'pet' ? manualPetIcon(tag.subject.subjectId) : mdiAccountOutline}
              size="14"
            />
          {/if}
          <span>{manualTagTypeLabel(tag.tagType)} · {tag.subject.displayName}</span>
        </button>
      {/each}
    </div>
  {/if}

  {#if isArrivalCueVisible && overlayView === 'off' && personPhotoContext && imageMetrics}
    <div
      class="pointer-events-none absolute inset-0"
      style={spatialOverlayStyle}
      aria-label={`${personPhotoContext.personName} is here`}
      data-testid="cimmich-person-arrival-cue"
      role="status"
    >
      {#if arrivalCueFace}
        {@const linkedBody = faceSpatialBody(arrivalCueFace)}
        <span
          class="cimmich-person-tag cimmich-person-tag--confirmed cimmich-person-tag--context cimmich-person-tag--arrival"
          style={`${faceLabelStyle(arrivalCueFace)} ${linkedBody ? bodyColorStyle(linkedBody) : ''}`}
        >
          {personPhotoContext.personName}
        </span>
      {:else if arrivalCueBody}
        <span
          class="cimmich-person-tag cimmich-person-tag--body-only cimmich-person-tag--context cimmich-person-tag--arrival"
          style={bodyLabelStyle(arrivalCueBody)}
        >
          {personPhotoContext.personName}
        </span>
      {/if}
    </div>
  {/if}

  {#if !isSidecarVisible && !isSummaryVisible && overlayView === 'people' && isFacesVisible && imageMetrics}
    <div
      class="pointer-events-none absolute inset-0"
      style={spatialOverlayStyle}
      data-testid="cimmich-people-overlay-layer"
    >
      {#each primaryNamedPeopleFaceOverlays as face (face.id)}
        {@const linkedBody = faceSpatialBody(face)}
        <div
          class={[
            'cimmich-person-tag',
            'cimmich-person-tag--actionable',
            'cimmich-person-tag--confirmed',
            faceMatchesPersonContext(face) ? 'cimmich-person-tag--context' : '',
            face.id === selectedFaceId ? 'cimmich-person-tag--selected' : '',
          ]}
          data-context-person={faceMatchesPersonContext(face) ? 'true' : undefined}
          aria-current={faceMatchesPersonContext(face) ? 'true' : undefined}
          style={`${faceLabelStyle(face)} ${linkedBody ? bodyColorStyle(linkedBody) : ''}`}
          title={faceLabelTitle(face, linkedBody)}
        >
          <a
            class="cimmich-person-tag__name"
            href={Route.cimmichPerson({ name: face.name, personId: face.personIdentityKey })}
            title={`Open ${face.name}'s profile`}
            onpointerdown={(event) => event.stopPropagation()}
            onclick={(event) => event.stopPropagation()}
          >
            {facePeopleTagLabel(face)}
          </a>
          <button
            class="cimmich-person-tag__edit"
            type="button"
            aria-label={`Edit ${face.name}'s Face on this photo`}
            title={`Edit ${face.name}'s Face`}
            onpointerdown={(event) => event.stopPropagation()}
            onclick={(event) => {
              event.stopPropagation();
              setSelectedFace(face, { editName: true });
            }}
          >
            <Icon icon={mdiPencilOutline} size="15" />
          </button>
        </div>
      {/each}

      {#each primaryNamedPeopleBodyOverlays as body (body.id)}
        {#if isRenderableBodyPoseOverlay(body)}
          <div
            class={[
              'cimmich-person-tag',
              'cimmich-person-tag--actionable',
              'cimmich-person-tag--body-only',
              bodyMatchesPersonContext(body) ? 'cimmich-person-tag--context' : '',
              body.id === selectedBodyId ? 'cimmich-person-tag--selected' : '',
            ]}
            data-context-person={bodyMatchesPersonContext(body) ? 'true' : undefined}
            aria-current={bodyMatchesPersonContext(body) ? 'true' : undefined}
            style={bodyLabelStyle(body)}
            title={bodyLabelTitle(body)}
          >
            <a
              class="cimmich-person-tag__name"
              href={bodyPersonProfileHref(body)}
              title={`Open ${bodyIdentityName(body)}'s profile`}
              onpointerdown={(event) => event.stopPropagation()}
              onclick={(event) => event.stopPropagation()}
            >
              {bodyPeopleTagLabel(body)}
            </a>
            <button
              class="cimmich-person-tag__edit"
              type="button"
              aria-label={`Edit ${bodyIdentityName(body)}'s Body on this photo`}
              title={`Edit ${bodyIdentityName(body)}'s Body`}
              onpointerdown={(event) => event.stopPropagation()}
              onclick={(event) => {
                event.stopPropagation();
                setSelectedBody(body);
              }}
            >
              <Icon icon={mdiPencilOutline} size="15" />
            </button>
          </div>
        {/if}
      {/each}

      {#each primaryManualPeopleTags as tag (tag.tagId)}
        <div
          class="cimmich-person-tag cimmich-person-tag--actionable cimmich-person-tag--body-only"
          style={manualSubjectTagMarkerStyle(tag)}
          title={`${manualTagTypeLabel(tag.tagType)} · manually tagged on this photo`}
          data-testid="cimmich-manual-subject-tag"
        >
          <a
            class="cimmich-person-tag__name"
            href={tag.subject.subjectKind === 'pet'
              ? Route.cimmichPet({ petId: tag.subject.subjectId })
              : Route.cimmichPerson({
                  name: tag.subject.displayName,
                  personId: tag.subject.subjectId,
                })}
            title={`Open ${tag.subject.displayName}'s profile`}
            onpointerdown={(event) => event.stopPropagation()}
            onclick={(event) => event.stopPropagation()}
          >
            {#if tag.subject.subjectKind === 'pet'}
              <Icon icon={manualPetIcon(tag.subject.subjectId)} size="14" />
            {/if}
            <span>{tag.subject.displayName}</span>
          </a>
          <button
            class="cimmich-person-tag__edit"
            type="button"
            aria-label={`Edit ${tag.subject.displayName}'s ${manualTagTypeLabel(tag.tagType)} on this photo`}
            title={`Edit ${tag.subject.displayName}'s ${manualTagTypeLabel(tag.tagType)}`}
            onpointerdown={(event) => event.stopPropagation()}
            onclick={(event) => {
              event.stopPropagation();
              isTaggingMode = true;
              selectSavedManualTag(tag);
            }}
          >
            <Icon icon={mdiPencilOutline} size="15" />
          </button>
        </div>
      {/each}
    </div>
  {/if}

  {#if !isSidecarVisible && !isSummaryVisible && overlayView === 'people' && (namedPhotoPresence.length > 0 || primaryLocalizedManualPresenceTags.length > 0 || primaryRegionlessPresenceItems.length > 0)}
    <div
      class="pointer-events-none absolute inset-x-3 bottom-6 z-30 flex flex-wrap justify-center gap-2"
      data-testid="cimmich-named-presence"
      aria-label="Named people and pets associated with this photo"
    >
      {#each namedPhotoPresence as presence (`${presence.kind}:${presence.name}`)}
        <div
          class="flex min-h-9 items-center gap-2 rounded-full border border-white/25 bg-black/78 px-3 text-xs font-semibold text-white shadow-lg backdrop-blur-sm"
          title={presence.kind === 'pet'
            ? 'Named Pet associated with this photo'
            : 'Named person associated with this photo'}
        >
          <Icon icon={presence.kind === 'pet' ? mdiPawOutline : mdiAccountOutline} size="16" />
          <span>{presence.name}</span>
        </div>
      {/each}
      {#each primaryLocalizedManualPresenceTags as tag (tag.tagId)}
        <button
          class="pointer-events-auto flex min-h-9 items-center gap-2 rounded-full border border-emerald-200/35 bg-black/78 px-3 text-xs font-semibold text-white shadow-lg backdrop-blur-sm hover:bg-black/90 focus-visible:outline-2 focus-visible:outline-white"
          title="Presence · manually tagged on this photo"
          aria-label={`Presence · ${tag.subject.displayName}`}
          type="button"
          data-testid="cimmich-manual-presence-summary"
          onclick={() => {
            isTaggingMode = true;
            selectSavedManualTag(tag);
          }}
        >
          <Icon
            icon={tag.subject.subjectKind === 'pet' ? manualPetIcon(tag.subject.subjectId) : mdiAccountOutline}
            size="16"
          />
          <span>Presence · {tag.subject.displayName}</span>
        </button>
      {/each}
      {#each primaryRegionlessPresenceItems as presence (presence.associationId)}
        <div
          class="pointer-events-auto flex min-h-9 items-center gap-2 rounded-full border border-white/25 bg-black/78 pr-1 pl-3 text-xs font-semibold text-white shadow-lg backdrop-blur-sm"
          title="Presence · associated with this whole photo"
          data-testid="cimmich-regionless-presence-summary"
        >
          <Icon
            icon={presence.subjectKind === 'pet' ? manualPetIcon(presence.subjectId) : mdiAccountOutline}
            size="16"
          />
          <span>{presence.displayName}</span>
          <button
            class="flex size-8 items-center justify-center rounded-full text-white/60 hover:bg-white/12 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
            type="button"
            aria-label={`Remove ${presence.displayName}'s Presence`}
            title="Remove Presence"
            onclick={() => void removeRegionlessPresence(presence)}
          >
            <Icon icon={mdiClose} size="15" />
          </button>
        </div>
      {/each}
    </div>
  {/if}

  {#if isTaggingMode && imageMetrics}
    <button
      class="cimmich-manual-tag-canvas pointer-events-auto absolute z-20 border-0 bg-transparent p-0"
      style={fittedImageStyle}
      type="button"
      aria-label={manualTagDraft ? 'Move the new manual tag on the photo' : 'Place a new manual tag on the photo'}
      title={manualTagDraft ? 'Click elsewhere to move the tag' : 'Click a person or pet to place a tag'}
      data-testid="cimmich-manual-tag-canvas"
      onclick={(event) => void placeManualTag(event)}
    ></button>

    {#if isTaggingHintVisible || isManualTagRepositioning}
      <div
        class="cimmich-tagging-hint pointer-events-none absolute top-20 left-1/2 z-40 -translate-x-1/2"
        role="status"
      >
        {isManualTagRepositioning
          ? 'Choose the new location'
          : 'Choose a dot to name it · Choose anywhere else to add a tag'}
      </div>
    {/if}

    <div
      class="pointer-events-none absolute inset-0 z-30"
      style={spatialOverlayStyle}
      data-testid="cimmich-tagging-layer"
    >
      {#each localizedManualOverlayTags as tag (tag.tagId)}
        <button
          class={[
            'cimmich-manual-presence-label cimmich-manual-presence-label--tagging pointer-events-auto',
            `cimmich-manual-presence-label--${tag.tagType}`,
            tag.tagId === selectedManualTagId ? 'cimmich-manual-presence-label--selected' : '',
          ]}
          style={manualSubjectTagMarkerStyle(tag)}
          title={`${manualTagTypeLabel(tag.tagType)} · ${tag.subject.displayName}`}
          aria-label={`${manualTagTypeLabel(tag.tagType)} · ${tag.subject.displayName}`}
          data-testid="cimmich-manual-subject-tag"
          type="button"
          onpointerdown={(event) => event.stopPropagation()}
          onclick={(event) => {
            event.stopPropagation();
            isTaggingHintVisible = false;
            selectSavedManualTag(tag);
          }}
        >
          {#if (tag.tagType !== 'body' && tag.tagType !== 'head') || tag.subject.subjectKind === 'pet'}
            <Icon
              icon={tag.subject.subjectKind === 'pet' ? manualPetIcon(tag.subject.subjectId) : mdiAccountOutline}
              size="14"
            />
          {/if}
          <span>{manualTagTypeLabel(tag.tagType)} · {tag.subject.displayName}</span>
        </button>
      {/each}
      {#each taggableFaceOverlays as face (face.id)}
        <button
          class={[
            'cimmich-matching-unknown cimmich-tagging-dot',
            face.status === 'named' ? 'cimmich-tagging-dot--named' : 'cimmich-tagging-dot--unresolved',
            face.id === selectedFaceId ? 'cimmich-matching-unknown--selected' : '',
          ]}
          style={faceMarkerStyle(face)}
          title={face.status === 'named' ? `Face · ${face.name}` : 'Face · unassigned'}
          aria-label={face.status === 'named' ? `Face · ${face.name}` : 'Face · unassigned'}
          type="button"
          data-testid="cimmich-tagging-dot"
          onpointerdown={(event) => event.stopPropagation()}
          onclick={(event) => {
            event.stopPropagation();
            isTaggingHintVisible = false;
            setSelectedFace(face, { editName: true });
          }}
        >
          <span>{face.status === 'named' ? `Face · ${face.name}` : 'Face · unassigned'}</span>
        </button>
      {/each}

      <div
        class="cimmich-tagging-legend"
        aria-label={`${namedTaggableFaceCount + manualFaceTagCount} named faces, ${unassignedTaggableFaceCount} unassigned faces, ${manualBodyTagCount} body tags, ${manualHeadTagCount} head tags, ${manualPresenceTagCount} presence tags`}
        data-testid="cimmich-tagging-legend"
      >
        <span
          ><i class="cimmich-tagging-key cimmich-tagging-key--named"></i>Named {namedTaggableFaceCount +
            manualFaceTagCount}</span
        >
        <span
          ><i class="cimmich-tagging-key cimmich-tagging-key--unassigned"></i>Unassigned {unassignedTaggableFaceCount}</span
        >
        {#if manualBodyTagCount > 0}<span
            ><i class="cimmich-tagging-key cimmich-tagging-key--body"></i>Body {manualBodyTagCount}</span
          >{/if}
        {#if manualHeadTagCount > 0}<span
            ><i class="cimmich-tagging-key cimmich-tagging-key--head"></i>Head {manualHeadTagCount}</span
          >{/if}
        <span><i class="cimmich-tagging-key cimmich-tagging-key--presence"></i>{manualPresenceLegendLabel}</span>
      </div>
    </div>

    {#if localizedManualPresenceTags.length > 0}
      <div class="pointer-events-none absolute inset-x-3 bottom-16 z-30 flex flex-wrap justify-center gap-2">
        {#each localizedManualPresenceTags as tag (tag.tagId)}
          <button
            class="pointer-events-auto flex min-h-11 items-center gap-2 rounded-full border border-emerald-200/35 bg-black/78 px-3 text-xs font-semibold text-white shadow-lg backdrop-blur-sm hover:bg-black/90 focus-visible:outline-2 focus-visible:outline-white"
            title="Presence · manually tagged on this photo"
            aria-label={`Edit Presence · ${tag.subject.displayName}`}
            type="button"
            data-testid="cimmich-tagging-presence"
            onclick={() => selectSavedManualTag(tag)}
          >
            <Icon
              icon={tag.subject.subjectKind === 'pet' ? manualPetIcon(tag.subject.subjectId) : mdiAccountOutline}
              size="16"
            />
            <span>{tag.subject.displayName}</span>
          </button>
        {/each}
      </div>
    {/if}

    {#if manualTagReadError}
      <p
        class="pointer-events-auto absolute bottom-16 left-1/2 z-40 -translate-x-1/2 rounded-lg border border-red-300/25 bg-red-950/90 px-3 py-2 text-xs text-red-100"
        role="alert"
      >
        Manual tags unavailable: {manualTagReadError}
      </p>
    {/if}

    {#if manualTagDraft}
      <div
        class="cimmich-manual-tag-region pointer-events-none absolute z-30"
        style={manualTagDraftStyle}
        data-testid="cimmich-manual-tag-region"
        aria-hidden="true"
      >
        <span></span>
      </div>

      <section
        class="pointer-events-auto absolute z-40 grid gap-3 overflow-y-auto overscroll-contain rounded-xl border border-white/20 bg-black/88 p-3 text-xs text-white shadow-2xl backdrop-blur-md"
        style={manualTagPanelStyle}
        aria-label="New manual tag"
        data-testid="cimmich-manual-tag-panel"
      >
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-sm font-semibold text-white">Who is here?</p>
            <p class="text-white/55">Choose a type, then a person or pet</p>
          </div>
          <button
            class="flex min-h-9 items-center rounded-lg px-2 text-white/65 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
            type="button"
            onclick={stopTagging}
          >
            Cancel
          </button>
        </div>

        <div class="grid gap-1.5" role="radiogroup" aria-label="Tag type">
          <span class="font-semibold text-white/70">What are you tagging?</span>
          <div class="grid grid-cols-4 gap-1 rounded-lg bg-white/8 p-1">
            {#each ['face', 'body', 'head', 'presence'] as tagType (tagType)}
              {@const typedTagType = tagType as CimmichManualSubjectTagType}
              <button
                class={[
                  'min-h-10 rounded-md px-2 font-semibold focus-visible:outline-2 focus-visible:outline-white',
                  manualTagType === typedTagType
                    ? 'bg-cyan-300 text-black'
                    : 'text-white/70 hover:bg-white/10 hover:text-white',
                ]}
                type="button"
                role="radio"
                aria-checked={manualTagType === typedTagType}
                onclick={() => {
                  manualTagType = typedTagType;
                  if (manualTagDraft) {
                    manualTagDraft = resizeManualPhotoTagGeometryForType(manualTagDraft, typedTagType);
                  }
                  manualTagSaveError = '';
                }}
              >
                {manualTagTypeLabel(typedTagType)}
              </button>
            {/each}
          </div>
        </div>

        <label class="grid gap-1">
          <span class="sr-only">Search people and pets</span>
          <input
            bind:this={manualTagInput}
            bind:value={manualTagQuery}
            class="min-h-11 rounded-lg border border-white/20 bg-white/10 px-3 text-sm text-white outline-none placeholder:text-white/40 focus:border-cyan-300"
            placeholder="Search people and pets"
            type="search"
            onkeydown={stopPhotoViewerShortcutPropagation}
            oninput={() => {
              manualPersonCreateIntent = undefined;
              if (manualTagSelectedSubject?.name !== normalizeName(manualTagQuery)) {
                manualTagSelectedSubjectId = '';
              }
            }}
          />
        </label>

        {#if isManualTagSubjectsLoading}
          <p class="px-1 py-2 text-white/55">Loading names…</p>
        {:else if manualTagSubjectsError}
          <div class="grid gap-2 rounded-lg border border-red-300/25 bg-red-400/10 p-2 text-red-100" role="alert">
            <span>{manualTagSubjectsError}</span>
            <button
              class="justify-self-start rounded-md border border-current px-2 py-1 font-semibold"
              type="button"
              onclick={() => void loadManualTagSubjects()}>Retry</button
            >
          </div>
        {:else if manualTagSubjectMatches.length > 0}
          <div class="grid max-h-52 gap-1 overflow-y-auto" role="listbox" aria-label="People and pets">
            {#each manualTagSubjectMatches as subject (subject.id)}
              {@const existingTypes = manualSubjectTagTypes(subject)}
              <button
                class={[
                  'flex min-h-11 items-center gap-3 rounded-lg px-3 text-left hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white',
                  manualTagSelectedSubjectId === subject.id ? 'bg-cyan-300 text-black' : 'text-white',
                ]}
                type="button"
                role="option"
                aria-selected={manualTagSelectedSubjectId === subject.id}
                onclick={() => selectManualTagSubject(subject)}
              >
                <Icon icon={subject.kind === 'pet' ? subject.icon || mdiPawOutline : mdiAccountOutline} size="18" />
                <span class="min-w-0 flex-1 truncate font-semibold">{subject.name}</span>
                <span
                  class={[
                    'shrink-0 text-right text-[11px]',
                    manualTagSelectedSubjectId === subject.id ? 'text-black/60' : 'text-white/50',
                  ]}
                  >{manualPhotoTagSubjectLabel(subject)}{existingTypes.length > 0
                    ? ` · ${existingTypes.join(' + ')}`
                    : ''}</span
                >
              </button>
            {/each}
          </div>
        {:else}
          <p class="px-1 py-2 text-white/55">No matching person or pet.</p>
        {/if}

        {#if canCreateManualTagPerson}
          <div class="grid gap-1 rounded-lg border border-emerald-300/25 bg-emerald-300/10 p-2">
            <button
              class="min-h-11 rounded-md bg-white px-3 text-left font-semibold text-black disabled:opacity-50"
              type="button"
              disabled={isManualPersonCreating}
              onclick={() => void createManualTagPerson()}
            >
              {isManualPersonCreating ? 'Creating Person…' : `Create Person “${normalizedManualTagQuery}”`}
            </button>
            <p class="px-1 text-[11px]/4 text-white/55">
              Creates the Person first. Your {manualTagType ? manualTagTypeLabel(manualTagType) : 'photo tag'} saves separately.
            </p>
          </div>
        {/if}

        <div class="flex items-center justify-end gap-2 border-t border-white/10 pt-3">
          <button
            class="min-h-11 rounded-lg bg-white px-4 font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            disabled={!manualTagSelectedSubject || !manualTagType || isManualTagSaving}
            onclick={() => void saveManualTag()}
          >
            {isManualTagSaving
              ? 'Saving…'
              : manualTagType
                ? `Save ${manualTagTypeLabel(manualTagType)}`
                : 'Choose type'}
          </button>
        </div>

        {#if manualTagSaveError}
          <p class="rounded-lg border border-red-300/25 bg-red-400/10 px-3 py-2 text-red-100" role="alert">
            {manualTagSaveError}
          </p>
        {/if}
      </section>
    {/if}

    {#if selectedManualTag && manualTagEditGeometry}
      <div
        class="cimmich-manual-tag-region pointer-events-none absolute z-30"
        style={manualTagEditGeometryStyle}
        data-testid="cimmich-manual-tag-edit-region"
        aria-hidden="true"
      >
        <span></span>
      </div>

      <section
        class="pointer-events-auto absolute z-40 grid gap-3 overflow-y-auto overscroll-contain rounded-xl border border-white/20 bg-black/88 p-3 text-xs text-white shadow-2xl backdrop-blur-md"
        style={manualTagDetailsStyle}
        aria-label="Saved manual tag"
        data-testid="cimmich-manual-tag-details"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="truncate text-sm font-semibold text-white">Edit tag</p>
            <p class="truncate text-white/55">{selectedManualTag.subject.displayName}</p>
          </div>
          <button
            class="flex min-h-9 items-center rounded-lg px-2 text-white/65 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
            type="button"
            onclick={closeManualTagEditor}
          >
            Close
          </button>
        </div>

        <div class="grid gap-1.5" role="radiogroup" aria-label="Tag type">
          <span class="font-semibold text-white/70">What is tagged?</span>
          <div class="grid grid-cols-4 gap-1 rounded-lg bg-white/8 p-1">
            {#each ['face', 'body', 'head', 'presence'] as tagType (tagType)}
              {@const typedTagType = tagType as CimmichManualSubjectTagType}
              <button
                class={[
                  'min-h-10 rounded-md px-2 font-semibold focus-visible:outline-2 focus-visible:outline-white',
                  manualTagType === typedTagType
                    ? 'bg-cyan-300 text-black'
                    : 'text-white/70 hover:bg-white/10 hover:text-white',
                ]}
                type="button"
                role="radio"
                aria-checked={manualTagType === typedTagType}
                onclick={() => {
                  manualTagType = typedTagType;
                  manualTagSaveError = '';
                }}
              >
                {manualTagTypeLabel(typedTagType)}
              </button>
            {/each}
          </div>
        </div>

        <label class="grid gap-1">
          <span class="font-semibold text-white/70">Who is it?</span>
          <input
            bind:value={manualTagQuery}
            class="min-h-11 rounded-lg border border-white/20 bg-white/10 px-3 text-sm text-white outline-none placeholder:text-white/40 focus:border-cyan-300"
            placeholder="Search people and pets"
            type="search"
            onkeydown={stopPhotoViewerShortcutPropagation}
            oninput={() => {
              manualPersonCreateIntent = undefined;
              if (manualTagSelectedSubject?.name !== normalizeName(manualTagQuery)) {
                manualTagSelectedSubjectId = '';
              }
            }}
          />
        </label>

        {#if isManualTagSubjectsLoading}
          <p class="px-1 py-2 text-white/55">Loading names…</p>
        {:else if manualTagSubjectsError}
          <p class="rounded-lg border border-red-300/25 bg-red-400/10 p-2 text-red-100" role="alert">
            {manualTagSubjectsError}
          </p>
        {:else if manualTagSubjectMatches.length > 0}
          <div class="grid max-h-40 gap-1 overflow-y-auto" role="listbox" aria-label="People and pets">
            {#each manualTagSubjectMatches as subject (subject.id)}
              <button
                class={[
                  'flex min-h-11 items-center gap-3 rounded-lg px-3 text-left hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white',
                  manualTagSelectedSubjectId === subject.id ? 'bg-cyan-300 text-black' : 'text-white',
                ]}
                type="button"
                role="option"
                aria-selected={manualTagSelectedSubjectId === subject.id}
                onclick={() => selectManualTagSubject(subject)}
              >
                <Icon icon={subject.kind === 'pet' ? subject.icon || mdiPawOutline : mdiAccountOutline} size="18" />
                <span class="min-w-0 flex-1 truncate font-semibold">{subject.name}</span>
                <span class="shrink-0 text-[11px] opacity-55">{manualPhotoTagSubjectLabel(subject)}</span>
              </button>
            {/each}
          </div>
        {:else}
          <p class="px-1 py-2 text-white/55">No matching person or pet.</p>
        {/if}

        {#if canCreateManualTagPerson}
          <div class="grid gap-1 rounded-lg border border-emerald-300/25 bg-emerald-300/10 p-2">
            <button
              class="min-h-11 rounded-md bg-white px-3 text-left font-semibold text-black disabled:opacity-50"
              type="button"
              disabled={isManualPersonCreating}
              onclick={() => void createManualTagPerson()}
            >
              {isManualPersonCreating ? 'Creating Person…' : `Create Person “${normalizedManualTagQuery}”`}
            </button>
            <p class="px-1 text-[11px]/4 text-white/55">Creates the Person first. The replacement saves separately.</p>
          </div>
        {/if}

        <button
          class={[
            'flex min-h-11 items-center justify-center rounded-lg border px-3 font-semibold focus-visible:outline-2 focus-visible:outline-white',
            isManualTagRepositioning
              ? 'border-cyan-200 bg-cyan-300 text-black'
              : 'border-white/20 text-white/75 hover:bg-white/10 hover:text-white',
          ]}
          type="button"
          onclick={() => {
            isManualTagRepositioning = !isManualTagRepositioning;
            isTaggingHintVisible = false;
          }}
        >
          {isManualTagRepositioning ? 'Cancel repositioning' : 'Move tag on photo'}
        </button>

        {#if manualTagType === 'face'}
          <p class="rounded-lg bg-white/8 px-3 py-2 text-white/60">{manualTagMatchingLabel(selectedManualTag)}</p>
        {/if}

        <div class="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
          <button
            class="min-h-11 rounded-lg px-3 font-semibold text-white/55 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            disabled={!selectedManualTag.undo.eligible || !selectedManualTag.undo.decisionId || isManualTagSaving}
            onclick={() => {
              if (manualTagRemoveConfirmId === selectedManualTag.tagId && selectedManualTag.undo.decisionId) {
                void undoManualTag(selectedManualTag.undo.decisionId);
              } else {
                manualTagRemoveConfirmId = selectedManualTag.tagId;
              }
            }}
          >
            {isManualTagSaving
              ? 'Working…'
              : manualTagRemoveConfirmId === selectedManualTag.tagId
                ? 'Confirm undo'
                : 'Undo last change'}
          </button>
          <button
            class="min-h-11 rounded-lg bg-white px-4 font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            disabled={!manualTagEditChanged || isManualTagRepositioning || isManualTagSaving}
            onclick={() => void replaceManualTag()}
          >
            {isManualTagSaving ? 'Saving…' : 'Save changes'}
          </button>
        </div>

        {#if manualTagSaveError}
          <p class="rounded-lg border border-red-300/25 bg-red-400/10 px-3 py-2 text-red-100" role="alert">
            {manualTagSaveError}
          </p>
        {/if}
      </section>
    {/if}
  {/if}

  {#if isBulkFacePanelOpen && imageMetrics}
    <div class="pointer-events-none absolute inset-0" data-testid="cimmich-face-bulk-marker-layer">
      {#each bulkFaces as face, index (face.id)}
        <button
          class={['cimmich-face-marker', face.id === selectedFaceId ? 'cimmich-face-marker--selected' : '']}
          style={faceMarkerStyle(face)}
          title={`${index + 1}. ${displayGuess(face)}`}
          type="button"
          onpointerdown={(event) => event.stopPropagation()}
          onclick={(event) => {
            event.stopPropagation();
            setSelectedFace(face, { editName: face.status !== 'named' });
          }}
        >
          {index + 1}
        </button>
      {/each}
    </div>
  {/if}

  {#if isBulkFacePanelOpen && evidence}
    <aside
      class="pointer-events-auto absolute grid gap-3 overflow-y-auto rounded-md bg-black/82 p-3 text-xs text-white shadow-xl backdrop-blur-sm"
      style={bulkPanelStyle}
      data-cimmich-bulk-panel
      data-testid="cimmich-face-bulk-panel"
    >
      <div
        class="flex cursor-move touch-none items-start justify-between gap-3 border-b border-white/15 pb-2"
        onpointerdown={startBulkPanelDrag}
        role="presentation"
      >
        <div>
          <p class="font-semibold text-white">Add tag</p>
          <p class="text-white/55">{bulkFaces.length} detected faces on this photo</p>
        </div>
        <button
          class="rounded-sm border border-white/25 px-2 py-1 text-white/70"
          type="button"
          onpointerdown={(event) => event.stopPropagation()}
          onclick={() => (isBulkFacePanelOpen = false)}
        >
          Close
        </button>
      </div>

      {#if !isCimmichEvidence}
        <div class="flex flex-wrap items-center gap-2">
          <button
            class={[
              'rounded-sm px-3 py-1.5 font-semibold',
              isAddingFace ? 'bg-white text-black' : 'border border-white/25 text-white/75',
            ]}
            disabled={isBulkSaving}
            type="button"
            onclick={() => (isAddingFace = !isAddingFace)}
          >
            {isAddingFace ? 'Click missed face' : 'Add missed face'}
          </button>
          {#if isAddingFace}
            <span class="text-white/55">Click the centre of the missed face on the photo.</span>
          {/if}
        </div>
      {/if}

      {#if bulkFaces.length === 0}
        <p class="rounded-lg bg-white/8 p-3 text-sm text-white/70">No detected faces are available to tag.</p>
      {/if}

      <div class="grid gap-1">
        {#each bulkFaces as face, index (face.id)}
          {@const suggestion = bulkNameSuggestion(face)}
          <div
            class={[
              'grid grid-cols-[2rem_1fr_auto] items-start gap-2 rounded-sm px-2 py-1.5',
              selectedFaceId === face.id ? 'bg-white/18' : 'bg-white/8',
            ]}
          >
            <button
              class="grid size-6 place-items-center rounded-full bg-white/12 text-[11px] font-bold text-white"
              type="button"
              onclick={() => setSelectedFace(face)}
            >
              {index + 1}
            </button>
            <label class="grid gap-1">
              <span class="truncate text-white/55"
                >{displayGuess(face)} · {bucketLabel(face.bucket || face.status)}</span
              >
              <input
                class="rounded-sm border border-white/15 bg-black/30 px-2 py-1.5 text-sm text-white outline-none focus:border-white/60"
                list="cimmich-known-face-names"
                placeholder="Waiting to be named"
                type="text"
                value={bulkNameDrafts[face.id] ?? ''}
                oninput={(event) => setBulkDraft(face.id, event.currentTarget.value)}
                onfocus={() => setSelectedFace(face)}
              />
              {#if suggestion}
                <button
                  class="justify-self-start rounded-sm bg-white/12 px-2 py-1 text-white/75"
                  type="button"
                  onclick={() => setBulkDraft(face.id, suggestion)}
                >
                  Use {suggestion}
                </button>
              {/if}
              {#if isCimmichEvidence && holdingPeople.length > 0}
                <select
                  class="justify-self-start rounded-sm border border-violet-300/50 bg-violet-400/15 px-2 py-1 text-xs text-violet-100"
                  value=""
                  aria-label="Move face to Holding"
                  onchange={(event) => {
                    const name = event.currentTarget.value;
                    event.currentTarget.value = '';
                    if (name) {
                      setBulkDraft(face.id, name);
                    }
                  }}
                >
                  <option value="">Hold…</option>
                  {#each holdingPeople as name (name)}
                    <option value={name}>{name}</option>
                  {/each}
                </select>
              {/if}
            </label>
            <div class="flex flex-col gap-1">
              <button
                class="rounded-sm border border-white/25 px-2 py-1 text-white/75 disabled:opacity-40"
                disabled={normalizeName(bulkNameDrafts[face.id]) === normalizeName(face.name) || isBulkSaving}
                type="button"
                onclick={() => {
                  setSelectedFace(face);
                  faceNameDraft = bulkNameDrafts[face.id] ?? '';
                  void runFaceAction(normalizeName(faceNameDraft) ? 'rename' : 'clear_identity');
                }}
              >
                Save
              </button>
              {#if isCimmichEvidence}
                {#if face.name}
                  <button
                    class="rounded-sm border border-red-300/35 px-2 py-1 text-red-100 disabled:opacity-40"
                    disabled={isBulkSaving}
                    type="button"
                    onclick={() => setBulkDraft(face.id, '')}
                  >
                    Remove name
                  </button>
                {/if}
              {:else if face.status === 'rejected'}
                <button
                  class="rounded-sm border border-white/20 px-2 py-1 text-white/60 disabled:opacity-40"
                  disabled={isBulkSaving}
                  type="button"
                  onclick={() => void runBulkFaceAction(face, 'confirm_not_face')}
                >
                  Confirm not face
                </button>
                <button
                  class="rounded-sm border border-white/20 px-2 py-1 text-white/60 disabled:opacity-40"
                  disabled={isBulkSaving}
                  type="button"
                  onclick={() => void runBulkFaceAction(face, 'restore_face')}
                >
                  Restore face
                </button>
              {:else}
                <button
                  class="rounded-sm border border-white/20 px-2 py-1 text-white/60 disabled:opacity-40"
                  disabled={isBulkSaving}
                  type="button"
                  onclick={() => void runBulkFaceAction(face, 'mark_not_face')}
                >
                  Not a face
                </button>
              {/if}
              {#if !isCimmichEvidence}
                <button
                  class="rounded-sm border border-red-300/35 px-2 py-1 text-red-100 disabled:opacity-40"
                  disabled={isFaceActionSaving}
                  type="button"
                  onclick={() => void deleteFace(face)}
                >
                  Delete
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>

      <div class="flex flex-wrap items-center gap-2 border-t border-white/15 pt-3">
        <button
          class="rounded-sm bg-white px-3 py-1.5 font-semibold text-black disabled:opacity-50"
          disabled={bulkChangedCount === 0 || isBulkSaving}
          type="button"
          onclick={() => void runBulkSave()}
        >
          {isBulkSaving ? 'Saving...' : `Save tags (${bulkChangedCount})`}
        </button>
      </div>

      {#if bulkActionMessage}
        <p class="rounded-sm bg-emerald-400/15 px-2 py-1 text-emerald-100">{bulkActionMessage}</p>
      {/if}
      {#if bulkActionError}
        <p class="rounded-sm bg-red-400/15 px-2 py-1 text-red-100">{bulkActionError}</p>
      {/if}
    </aside>
  {/if}

  {#if isFacesVisible && imageMetrics && selectedFace && !isBulkFacePanelOpen}
    <section
      class="pointer-events-auto absolute z-40 grid gap-2 overflow-y-auto overscroll-contain rounded-md bg-black/80 p-3 text-xs text-white shadow-xl backdrop-blur-sm"
      style={faceDetailsStyle(selectedFace)}
      data-testid="cimmich-face-detail"
    >
      <div class="flex items-start justify-between gap-3">
        {#if isEditingFaceName}
          <div class="min-w-0">
            <h2 class="text-base font-semibold text-white">Edit Face</h2>
          </div>
        {:else if selectedFace.name}
          <a
            class="min-w-0 font-semibold wrap-break-word text-white hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            href={Route.cimmichPerson({
              name: selectedFace.name,
              personId: selectedFace.personIdentityKey,
            })}
            title={`View ${selectedFace.name}'s profile`}
          >
            {selectedFace.label}
          </a>
        {:else}
          <p class="min-w-0 font-semibold wrap-break-word text-white">{selectedFace.label}</p>
        {/if}
        <div class="flex shrink-0 items-center gap-1">
          {#if selectedFace.name && selectedFace.identityClaimId}
            <Tooltip text={clearIdentityConfirmId === selectedFace.id ? 'Confirm remove name' : 'Remove name'}>
              {#snippet child({ props })}
                <button
                  {...props}
                  class={[
                    'flex size-9 shrink-0 items-center justify-center rounded-sm transition disabled:opacity-50',
                    clearIdentityConfirmId === selectedFace.id
                      ? 'bg-red-500 text-white hover:bg-red-400'
                      : 'text-white/55 hover:bg-white/10 hover:text-red-200',
                  ]}
                  disabled={isFaceActionSaving}
                  type="button"
                  aria-label={clearIdentityConfirmId === selectedFace.id ? 'Confirm remove name' : 'Remove name'}
                  onclick={() => {
                    if (clearIdentityConfirmId === selectedFace.id) {
                      void runFaceAction('clear_identity');
                    } else {
                      clearIdentityConfirmId = selectedFace.id;
                    }
                  }}
                >
                  <Icon icon={mdiTrashCanOutline} size="18" />
                </button>
              {/snippet}
            </Tooltip>
          {/if}
          {#if isEditingFaceName}
            <button
              class="flex size-9 items-center justify-center rounded-sm text-white/65 transition hover:bg-white/10 hover:text-white"
              type="button"
              aria-label="Close Face editor"
              onclick={() => {
                selectedFaceId = '';
                isEditingFaceName = false;
                isLaterPickerOpen = false;
              }}
            >
              <Icon icon={mdiClose} size="19" />
            </button>
          {/if}
        </div>
      </div>

      <p
        class="w-fit rounded-full bg-white/12 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-white/75 uppercase"
      >
        {faceEvidenceKindLabel(selectedFace)} evidence
      </p>

      {#if isEditingFaceName}
        <form
          class="grid gap-2"
          onsubmit={(event) => {
            event.preventDefault();
            void runFaceAction('rename');
          }}
        >
          <label class="grid gap-1">
            <span class="font-semibold text-white/65">Person</span>
            <span class="relative">
              <input
                bind:value={faceNameDraft}
                class="cimmich-person-choice w-full rounded-sm border border-white/20 bg-white/10 py-2 pr-8 pl-2 text-sm text-white outline-none focus:border-white/60"
                list="cimmich-known-face-names"
                placeholder="Choose or create a Person"
                type="text"
                oninput={() => (faceSelectedPersonId = '')}
              />
              <span
                class="pointer-events-none absolute inset-y-0 right-2 flex items-center text-white/45"
                aria-hidden="true"
              >
                <Icon icon={mdiChevronDown} size="18" />
              </span>
            </span>
          </label>
          {#if isManualTagSubjectsLoading}
            <p class="text-white/50">Checking People…</p>
          {:else if manualTagSubjectsError}
            <p class="text-red-200" role="alert">People are unavailable. Close and try again.</p>
          {:else if showFaceDraftIdentityCue}
            <p class={faceDraftCreatesPerson ? 'text-emerald-200' : 'text-white/55'}>
              {#if faceDraftCreatesPerson}
                New Person · Create “{normalizedFaceNameDraft}”
              {:else}
                Existing Person · {faceDraftKnownPersonName}
              {/if}
            </p>
          {/if}
          {#if isCimmichEvidence}
            <div class="overflow-hidden rounded-sm border border-white/15 bg-black/35">
              <p
                class="flex items-center justify-between gap-3 border-b border-white/10 px-2 py-1 text-[10px] font-semibold tracking-wide text-white/45 uppercase"
              >
                <span>Closest matches</span>
                <span>Similarity score</span>
              </p>
              {#if faceMatchesLoading}
                <p class="p-2 text-white/50">Finding matches…</p>
              {:else if faceMatchesError}
                <p class="p-2 text-red-200">{faceMatchesError}</p>
              {:else if faceMatches.length > 0}
                <div class="grid">
                  {#each faceMatches as match (match.person_id)}
                    <button
                      class="flex items-center justify-between gap-3 border-b border-white/10 px-2 py-1.5 text-left last:border-b-0 hover:bg-white/10"
                      type="button"
                      onclick={() => {
                        faceNameDraft = match.display_name;
                        faceSelectedPersonId = match.person_id;
                      }}
                    >
                      <span class="min-w-0">
                        <span class="block truncate">{match.display_name}</span>
                        {#if match.current_identity}
                          <span class="block text-[10px] font-semibold tracking-wide text-emerald-200 uppercase"
                            >Currently assigned</span
                          >
                        {:else if match.accepted_example_count}
                          <span class="block text-[10px] text-white/40"
                            >{match.accepted_example_count} reference
                            {match.accepted_example_count === 1 ? 'photo' : 'photos'}</span
                          >
                        {/if}
                        {#if match.unavailable_reason}
                          <span class="block text-[10px] text-white/40">No comparable reference in this view</span>
                        {/if}
                      </span>
                      <span class="max-w-24 shrink-0 text-right text-white/50 tabular-nums">
                        {projectFaceReviewSimilarity(match.similarity ?? match.prime_score)}
                      </span>
                    </button>
                  {/each}
                </div>
                <p class="border-t border-white/10 px-2 py-1.5 text-[10px] text-white/40">
                  Raw same-model similarity; higher is closer. This is not a confidence percentage.
                </p>
              {:else}
                <p class="p-2 text-white/50">No compatible reference photos yet.</p>
              {/if}
            </div>
          {/if}
          {#if faceNameSuggestion}
            <button
              class="justify-self-start rounded-sm bg-white/12 px-2 py-1 text-white/75"
              type="button"
              onclick={() => {
                faceNameDraft = faceNameSuggestion;
                faceSelectedPersonId = '';
              }}
            >
              Use {faceNameSuggestion}
            </button>
          {/if}
          <details class="group rounded-sm border border-white/15 bg-white/5">
            <summary
              class="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 font-semibold text-white/80 marker:content-none"
            >
              <span>Matching reference</span>
              <span class="text-right text-[10px] font-normal tracking-wide text-white/45 uppercase"
                >{faceBucketOwnerLabel(faceBucketDraft)}</span
              >
            </summary>
            <div class="grid gap-2 border-t border-white/10 p-3">
              <p class="text-white/55">
                Choose whether this photo should help compare future Faces. It never changes anyone automatically.
              </p>
              <label class="grid gap-1">
                <span class="font-semibold text-white/65">Evidence kind</span>
                <select
                  class="min-h-10 rounded-sm border border-white/20 bg-black/80 px-2 text-white outline-none focus:border-white/60"
                  value={faceBucketDraft === 'head' ? 'head' : 'face'}
                  onchange={(event) => {
                    faceBucketDraft = event.currentTarget.value === 'head' ? 'head' : 'face_only';
                  }}
                >
                  <option value="face">Face</option>
                  <option value="head">Head · no usable Face</option>
                </select>
              </label>
              {#if faceBucketDraft !== 'head'}
                <label class="grid gap-1">
                  <span class="font-semibold text-white/65">Reference quality</span>
                  <select
                    bind:value={faceBucketDraft}
                    class="min-h-10 rounded-sm border border-white/20 bg-black/80 px-2 text-white outline-none focus:border-white/60"
                  >
                    <option value="face_only">Don't use this photo for matching</option>
                    <option value="prime">Best reference photo</option>
                    <option value="secondary">Useful reference photo</option>
                    <option value="lq">Difficult but useful reference</option>
                  </select>
                </label>
              {:else}
                <p class="text-white/55">
                  Head evidence is kept as identity truth but is not used as a Face reference.
                </p>
              {/if}
            </div>
          </details>
          {#if selectedFace.reviewDisposition === 'later'}
            <p class="rounded-sm bg-sky-400/15 px-2 py-1 text-sky-100">Saved for later review.</p>
          {:else if selectedFace.reviewDisposition === 'unknown'}
            <p class="rounded-sm bg-slate-400/15 px-2 py-1 text-slate-100">Marked as an unknown person.</p>
          {/if}
          {#if selectedFace.rejectedClaimId}
            <div class="flex items-center justify-between gap-3 rounded-sm bg-amber-400/15 px-2 py-1.5 text-amber-100">
              <span>Previously rejected · {selectedFace.rejectedName || 'Suggestion'}</span>
              <button
                class="shrink-0 rounded-sm border border-amber-200/45 px-2 py-1 font-semibold disabled:opacity-50"
                disabled={isFaceActionSaving}
                type="button"
                onclick={() => void restoreRejectedFaceCandidate(selectedFace)}>Restore suggestion</button
              >
            </div>
          {/if}
          <div class="grid grid-cols-2 gap-2">
            <button
              class="col-span-2 min-h-11 w-full rounded-sm bg-white px-3 text-sm font-semibold text-black disabled:opacity-50"
              disabled={isFaceActionSaving ||
                !normalizedFaceNameDraft ||
                !faceDraftHasChanges ||
                isManualTagSubjectsLoading ||
                Boolean(manualTagSubjectsError)}
              type="submit"
            >
              {isFaceActionSaving ? 'Saving...' : faceDraftCreatesPerson ? 'Create Person and save' : 'Save changes'}
            </button>
            <button
              class="min-h-10 w-full rounded-sm border border-white/20 px-3 font-semibold text-white/75 hover:bg-white/10 disabled:opacity-50"
              disabled={isFaceActionSaving || selectedFace.reviewDisposition === 'later'}
              type="button"
              onclick={() => void applyFaceReviewDisposition(selectedFace, 'later')}>Review later</button
            >
            {#if holdingPeople.length > 0}
              <div class="relative">
                <button
                  class="min-h-10 w-full rounded-sm border border-violet-300/50 bg-violet-400/15 px-3 font-semibold text-violet-100 hover:bg-violet-400/25"
                  type="button"
                  aria-expanded={isLaterPickerOpen}
                  onclick={() => (isLaterPickerOpen = !isLaterPickerOpen)}
                >
                  Keep in Holding…
                </button>
                {#if isLaterPickerOpen}
                  <div
                    class="absolute bottom-full left-0 z-10 mb-1 grid min-w-52 overflow-hidden rounded-lg border border-white/15 bg-slate-950 p-1 shadow-xl"
                    aria-label="Choose where to keep this face"
                  >
                    {#each holdingPeople as name (name)}
                      <button
                        class="min-h-10 rounded-md px-3 text-left text-white/80 hover:bg-white/10 hover:text-white"
                        type="button"
                        onclick={() => {
                          faceNameDraft = name;
                          faceSelectedPersonId = '';
                          faceBucketDraft = 'face_only';
                          isLaterPickerOpen = false;
                        }}
                      >
                        {name}
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
            <button
              class="min-h-10 w-full rounded-sm border border-white/20 px-3 font-semibold text-white/75 hover:bg-white/10 disabled:opacity-50"
              disabled={isFaceActionSaving || selectedFace.reviewDisposition === 'unknown'}
              type="button"
              onclick={() => void applyFaceReviewDisposition(selectedFace, 'unknown')}>Unknown person</button
            >
            {#if selectedFace.reviewDisposition && selectedFace.reviewDisposition !== 'active'}
              <button
                class="min-h-10 w-full rounded-sm border border-white/20 px-3 font-semibold text-white/75 hover:bg-white/10 disabled:opacity-50"
                disabled={isFaceActionSaving}
                type="button"
                onclick={() => void applyFaceReviewDisposition(selectedFace, 'active')}>Resume review</button
              >
            {/if}
            {#if !selectedFace.name && selectedFace.candidateClaimId}
              <button
                class="rounded-sm border border-amber-300/50 px-3 py-1.5 font-semibold text-amber-100 disabled:opacity-50"
                disabled={isFaceActionSaving}
                type="button"
                onclick={() => {
                  if (rejectCandidateConfirmId === selectedFace.id) {
                    void runFaceAction('reject_name_candidate');
                  } else {
                    rejectCandidateConfirmId = selectedFace.id;
                  }
                }}
              >
                {rejectCandidateConfirmId === selectedFace.id
                  ? 'Confirm reject suggestion'
                  : `Reject ${selectedFace.candidateName || 'suggestion'}`}
              </button>
            {/if}
          </div>
        </form>
      {:else}
        <button
          class="justify-self-start rounded-sm bg-white px-3 py-1.5 font-semibold text-black disabled:opacity-50"
          disabled={isFaceActionSaving}
          type="button"
          onclick={() => {
            isEditingFaceName = true;
            void loadFaceMatches(selectedFace);
          }}
        >
          {selectedFace.name ? 'Change person' : 'Name this face'}
        </button>
      {/if}

      <div class="flex flex-wrap gap-2">
        {#if isCimmichEvidence && overlayView === 'machinery'}
          <button
            class="rounded-sm border border-red-300/40 px-2 py-1 text-red-100 disabled:opacity-50"
            disabled={isObservationActionSaving}
            type="button"
            onclick={() => void rejectDetailedObservation('face')}
          >
            Not a face
          </button>
        {:else if !isCimmichEvidence}
          <button
            class="rounded-sm border border-white/25 px-2 py-1 text-white/75 disabled:opacity-50"
            disabled={isFaceActionSaving}
            type="button"
            onclick={() => void runFaceAction('retrigger')}
          >
            Retrigger face match
          </button>
          <button
            class="rounded-sm border border-red-300/40 px-2 py-1 text-red-100 disabled:opacity-50"
            disabled={isFaceActionSaving}
            type="button"
            onclick={() => void runFaceAction('delete_face')}
          >
            Ignore this person
          </button>
        {/if}
      </div>

      {#if faceActionMessage || identityCorrectionUndoDecisionId}
        <div class="flex items-center justify-between gap-2 rounded-sm bg-emerald-400/15 px-2 py-1 text-emerald-100">
          <p>{faceActionMessage || 'A recent identity correction can still be undone.'}</p>
          {#if identityCorrectionUndoDecisionId}
            <button
              class="rounded-sm border border-emerald-200/40 px-2 py-1 font-semibold disabled:opacity-50"
              disabled={isFaceActionSaving}
              type="button"
              onclick={() => void undoAcceptedIdentityCorrection()}
            >
              Undo
            </button>
          {/if}
        </div>
      {/if}
      {#if faceActionError}
        <p class="rounded-sm bg-red-400/15 px-2 py-1 text-red-100">{faceActionError}</p>
      {/if}
    </section>
  {/if}

  {#if isBodiesVisible && imageMetrics && selectedBody && !selectedFace && !isBulkFacePanelOpen}
    <section
      class="pointer-events-auto absolute z-40 grid w-[260px] gap-2 overflow-y-auto overscroll-contain rounded-md bg-black/80 p-3 text-xs text-white shadow-xl backdrop-blur-sm"
      style={bodyDetailsStyle(selectedBody)}
      data-testid="cimmich-body-detail"
    >
      <div class="flex items-start justify-between gap-2">
        <div>
          <p class="font-semibold text-white">{bodyLabel(selectedBody)}</p>
          <p class="text-white/60">{selectedBody.status === 'linked' ? 'Linked body' : 'Unlinked body'}</p>
        </div>
        <button
          class="rounded-sm border border-white/25 px-2 py-1 text-white/70"
          type="button"
          onclick={() => (selectedBodyId = '')}
        >
          Close
        </button>
      </div>

      {#if selectedBody.status === 'unlinked'}
        <div class="grid gap-1.5 rounded-sm bg-white/10 p-2">
          <label class="font-semibold text-white" for="cimmich-body-person">Who is this?</label>
          <div class="flex gap-1.5">
            <input
              id="cimmich-body-person"
              class="min-w-0 flex-1 rounded-sm border border-white/20 bg-black/35 px-2 py-1.5 text-white outline-none placeholder:text-white/45 focus:border-white/60"
              value={bodyPersonQuery}
              placeholder="Search People"
              autocomplete="off"
              onkeydown={stopPhotoViewerShortcutPropagation}
              oninput={(event) => {
                bodyPersonQuery = event.currentTarget.value;
                bodySelectedPersonId = '';
                bodyIdentityActionError = '';
              }}
            />
            <button
              class="rounded-sm bg-white px-3 py-1.5 font-semibold text-black disabled:opacity-45"
              type="button"
              disabled={!bodySelectedPersonId || isBodyIdentitySaving}
              onclick={() => void assignSelectedBodyPerson()}
            >
              {isBodyIdentitySaving ? 'Linking…' : 'Link'}
            </button>
          </div>
          {#if bodyPersonQuery.trim() && !bodySelectedPersonId}
            {#if isManualTagSubjectsLoading}
              <p class="text-white/60">Loading People…</p>
            {:else if manualTagSubjectsError}
              <p class="text-red-100">{manualTagSubjectsError}</p>
            {:else if bodyPersonOptions.length > 0}
              <div
                class="max-h-36 overflow-y-auto rounded-sm border border-white/15 bg-black/45 p-1"
                role="listbox"
                aria-label="People"
              >
                {#each bodyPersonOptions as subject (subject.id)}
                  <button
                    class="flex min-h-9 w-full items-center rounded-sm px-2 text-left font-medium hover:bg-white/12 focus-visible:bg-white/12"
                    type="button"
                    role="option"
                    aria-selected="false"
                    onclick={() => selectBodyPerson(subject)}
                  >
                    {subject.name}
                  </button>
                {/each}
              </div>
            {:else}
              <p class="text-white/60">No matching Person.</p>
            {/if}
          {:else if bodySelectedPersonId}
            <p class="text-white/60">Link this Body to {bodySelectedPerson?.name || bodyPersonQuery}.</p>
          {/if}
        </div>
      {/if}

      {#if bodyIdentityActionMessage}
        <p class="rounded-sm bg-emerald-400/15 px-2 py-1 text-emerald-100" role="status">
          {bodyIdentityActionMessage}
        </p>
      {/if}
      {#if bodyIdentityActionError}
        <p class="rounded-sm bg-red-400/15 px-2 py-1 text-red-100" role="alert">{bodyIdentityActionError}</p>
      {/if}

      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-white/15 pt-2 text-white/70">
        <dt>Link</dt>
        <dd>{selectedBody.linkStatus.replaceAll('_', ' ')}</dd>
        <dt>Reason</dt>
        <dd>{selectedBody.linkReason}</dd>
        <dt>Source</dt>
        <dd>{selectedBody.linkSource?.replaceAll('_', ' ') || 'n/a'}</dd>
        <dt>Face</dt>
        <dd>{selectedBody.linkedName || 'n/a'}</dd>
        <dt>Pose</dt>
        <dd>{selectedBody.poseQuality || 'n/a'}</dd>
        <dt>Pose model</dt>
        <dd>{selectedBody.keypointSource || 'not retained'}</dd>
        <dt>Confidence</dt>
        <dd>{selectedBody.confidence || 'n/a'}</dd>
      </dl>

      {#if selectedBody.maskStatus}
        <p class="rounded-sm bg-white/10 px-2 py-1 text-white/65">
          Mask: {selectedBody.maskStatus}{selectedBody.maskUse ? ` · ${selectedBody.maskUse}` : ''}
        </p>
      {/if}

      {#if isCimmichEvidence && overlayView === 'machinery'}
        <button
          class="justify-self-start rounded-sm border border-red-300/40 px-2 py-1 text-red-100 disabled:opacity-50"
          disabled={isObservationActionSaving}
          type="button"
          onclick={() => void rejectDetailedObservation('body')}
        >
          Not a body
        </button>
      {/if}
    </section>
  {/if}

  {#if overlayView === 'machinery' && (observationActionMessage || observationActionError)}
    <div
      class="pointer-events-auto absolute bottom-16 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/15 bg-black/88 px-3 py-2 text-xs text-white shadow-xl backdrop-blur-md"
      role={observationActionError ? 'alert' : 'status'}
    >
      <span class={observationActionError ? 'text-red-100' : 'text-white/85'}>
        {observationActionError || observationActionMessage}
      </span>
      {#if observationUndoDecisionId && !observationActionError}
        <button
          class="min-h-8 rounded-full bg-white px-3 font-semibold text-black disabled:opacity-50"
          disabled={isObservationActionSaving}
          type="button"
          onclick={() => void undoDetailedObservationCorrection()}
        >
          Undo
        </button>
      {/if}
    </div>
  {/if}

  {#if isSidecarVisible}
    <div
      class="pointer-events-auto absolute inset-x-5 top-14 bottom-5 z-20 flex items-start justify-center overflow-y-auto"
    >
      <article
        class="w-full max-w-4xl rounded-2xl border border-white/15 bg-black/82 p-4 text-white shadow-2xl backdrop-blur-xl"
        data-testid="cimmich-sidecar-overlay"
      >
        <header class="mb-3 flex items-start justify-between gap-4 border-b border-white/12 pb-3">
          <div>
            <p class="text-[11px] font-bold tracking-[0.16em] text-cyan-200/75 uppercase">{evidenceBrand} fields</p>
            <h2 class="mt-1 text-lg font-semibold">Sidecar preview</h2>
            <p class="mt-1 text-xs text-white/55">
              What {evidenceBrand} adds now—or will add when sidecar export is enabled. Immich metadata is excluded.
            </p>
          </div>
          <span
            class="shrink-0 rounded-full border border-white/15 bg-white/8 px-3 py-1.5 text-[11px] font-semibold text-white/65"
          >
            Preview · no source write
          </span>
        </header>

        {#if isLoading}
          <p class="rounded-xl bg-white/8 p-4 text-sm text-white/70">Loading {evidenceBrand} fields…</p>
        {:else if loadError}
          <p class="rounded-xl bg-red-400/12 p-4 text-sm text-red-100">{loadError}</p>
        {:else if sidecarSections.length > 0}
          <div class="grid gap-3 md:grid-cols-2">
            {#each sidecarSections as section (section.title)}
              <section
                class={[
                  'rounded-xl border border-white/10 bg-white/5.5 p-3',
                  section.title === 'Descriptions' ? 'md:col-span-2' : '',
                ]}
              >
                <h3 class="mb-2 text-xs font-bold tracking-[0.12em] text-white/55 uppercase">{section.title}</h3>
                <dl class="grid gap-2.5">
                  {#each section.fields as field (field.label)}
                    <div class="grid gap-0.5">
                      <dt class="text-[10px] font-bold tracking-wide text-cyan-200/60 uppercase">{field.label}</dt>
                      <dd class="text-sm/snug text-white/88">{field.value}</dd>
                    </div>
                  {/each}
                </dl>
              </section>
            {/each}
          </div>
        {:else}
          <p class="rounded-xl bg-white/8 p-4 text-sm text-white/70">
            No {evidenceBrand} sidecar fields are available for this photo.
          </p>
        {/if}

        <footer
          class="mt-3 flex flex-wrap gap-1.5 border-t border-white/12 pt-3 text-[10px] font-semibold text-white/55"
        >
          <span class="rounded-full bg-white/8 px-2 py-1">Descriptions</span>
          <span class="rounded-full bg-white/8 px-2 py-1">People links</span>
          <span class="rounded-full bg-white/8 px-2 py-1">Place / event context</span>
          <span class="rounded-full bg-white/8 px-2 py-1">Visible scene and actions</span>
          <span class="rounded-full bg-white/8 px-2 py-1">Review state</span>
        </footer>
      </article>
    </div>
  {/if}

  {#if overlayView === 'context' && !isSidecarVisible && !isObjectTaggingMode}
    <div class="pointer-events-auto absolute inset-x-3 bottom-6 flex justify-center">
      <article
        class={[
          'w-full border border-white/15 bg-black/82 text-sm text-white shadow-2xl backdrop-blur-md',
          isContextEditing
            ? 'max-h-[min(70vh,42rem)] max-w-2xl overflow-y-auto rounded-xl px-4 py-3'
            : 'max-w-4xl rounded-full px-3 py-2',
        ]}
        data-testid="cimmich-context-overlay"
      >
        {#if ownerSummary?.summaryText}
          <p class={[isContextEditing ? 'mb-3' : 'mr-1', 'font-medium text-white/90']}>
            {ownerSummary.summaryText}
          </p>
        {/if}

        <div class="flex flex-wrap gap-1.5" aria-label="Context on this photo">
          {#each displayedPhotoContexts as context (`${context.family}:${context.entityId}`)}
            <div
              class={[
                'flex items-center overflow-hidden rounded-full border border-white/18 bg-white/10',
                isContextEditing ? 'min-h-10' : 'min-h-8',
              ]}
            >
              <a
                class={[
                  'flex items-center gap-1.5 px-3 font-semibold hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white',
                  isContextEditing ? 'min-h-10' : 'min-h-8',
                ]}
                href={contextHref(context)}
              >
                <span class="text-[10px] tracking-wide text-white/55 uppercase">
                  {context.entityKind === 'event' ? 'Event' : 'Place'}
                </span>
                <span>{context.displayName}</span>
              </a>
              {#if isContextEditing}
                <button
                  class="min-h-10 border-l border-white/15 px-3 text-xs font-semibold text-red-100 hover:bg-red-400/15 disabled:opacity-50"
                  type="button"
                  disabled={isContextSaving}
                  aria-label={`Remove ${context.displayName} from this photo`}
                  onclick={() => void removePhotoContext(context)}>Remove</button
                >
              {/if}
            </div>
          {/each}
          {#if displayedPhotoContexts.length === 0 && thingRegions.length === 0}
            <p class="rounded-lg bg-white/8 px-3 py-2 text-white/65">No context has been added yet.</p>
          {/if}
          {#each thingRegions as tag (tag.tagId)}
            <div
              class={[
                'flex items-center overflow-hidden rounded-full border border-white/18 bg-white/10',
                isContextEditing ? 'min-h-10' : 'min-h-8',
              ]}
            >
              <a
                class={[
                  'flex items-center gap-1.5 px-3 font-semibold hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white',
                  isContextEditing ? 'min-h-10' : 'min-h-8',
                ]}
                href={`/cimmich/places?family=objects&entityId=${encodeURIComponent(tag.entityId)}`}
              >
                <span class="text-[10px] tracking-wide text-white/55 uppercase">Object</span>
                <span>{tag.displayName}</span>
              </a>
              {#if isContextEditing}
                <button
                  class="min-h-10 border-l border-white/15 px-3 text-xs font-semibold text-red-100 hover:bg-red-400/15 disabled:opacity-50"
                  type="button"
                  disabled={isObjectSaving}
                  aria-label={`Remove ${tag.displayName} object tag`}
                  onclick={() => void removeObjectRegion(tag)}>Remove</button
                >
              {/if}
            </div>
          {/each}
        </div>

        {#if isContextEditing}
          <div class="mt-3 grid gap-3 border-t border-white/12 pt-3">
            <label class="grid gap-1.5 text-xs font-semibold text-white/70" for="cimmich-photo-owner-summary">
              Photo summary
              <textarea
                id="cimmich-photo-owner-summary"
                class="min-h-20 resize-y rounded-lg border border-white/20 bg-black/35 px-3 py-2 text-sm font-normal text-white outline-none placeholder:text-white/40 focus:border-white/60"
                placeholder="What matters about this photo?"
                maxlength="2000"
                bind:value={ownerSummaryDraft}
                onkeydown={stopPhotoViewerShortcutPropagation}
              ></textarea>
            </label>
            <div class="flex items-center justify-between gap-3">
              <span class="text-[11px] text-white/45">Owner-written · {ownerSummaryDraft.length}/2000</span>
              <button
                class="min-h-9 rounded-full bg-white px-4 text-xs font-bold text-black disabled:opacity-45"
                type="button"
                disabled={isOwnerSummarySaving || ownerSummaryDraft.trim() === (ownerSummary?.summaryText || '')}
                onclick={() => void saveOwnerSummary()}>{isOwnerSummarySaving ? 'Saving…' : 'Save summary'}</button
              >
            </div>
            <div class="grid gap-2">
              <p class="text-xs font-semibold text-white/70">Add context</p>
              <div class="flex flex-wrap gap-2">
                {#each contextAddActions as action (action.kind)}
                  <button
                    class={[
                      'min-h-9 rounded-full border px-3 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-white',
                      contextAddKind === action.kind
                        ? 'border-white bg-white text-black'
                        : 'border-white/20 bg-white/8 text-white hover:border-white/45 hover:bg-white/15',
                    ]}
                    type="button"
                    aria-pressed={contextAddKind === action.kind}
                    onclick={() => {
                      contextAddKind = contextAddKind === action.kind ? '' : action.kind;
                      contextQuery = '';
                    }}
                  >
                    + {action.label}
                  </button>
                {/each}
              </div>
            </div>
            {#if contextAddKind}
              <label class="grid gap-1.5 text-xs font-semibold text-white/70" for="cimmich-photo-context-search">
                Find a {contextAddKind === 'place' ? 'Place' : 'Event'}
                <input
                  id="cimmich-photo-context-search"
                  class="min-h-10 rounded-lg border border-white/20 bg-black/35 px-3 font-normal text-white outline-none placeholder:text-white/40 focus:border-white/60"
                  placeholder={`Search ${contextAddKind === 'place' ? 'Places' : 'Events'}`}
                  autocomplete="off"
                  value={contextQuery}
                  onkeydown={stopPhotoViewerShortcutPropagation}
                  oninput={(event) => (contextQuery = event.currentTarget.value)}
                />
              </label>
              {#if isContextLoading}
                <p class="text-xs text-white/60">Loading your {contextAddKind === 'place' ? 'Places' : 'Events'}…</p>
              {:else if availableContextOptions.length > 0}
                <div class="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto" aria-label="Add context to this photo">
                  {#each availableContextOptions as option (option.entityId)}
                    <button
                      class="min-h-9 rounded-full border border-white/20 bg-white/8 px-3 text-left text-xs font-semibold text-white transition hover:border-white/45 hover:bg-white/15 disabled:opacity-45"
                      type="button"
                      disabled={isContextSaving}
                      aria-label={`Add ${option.displayName} to this photo`}
                      onclick={() => void addPhotoContext(option)}
                    >
                      + {option.displayName}
                    </button>
                  {/each}
                </div>
              {:else}
                <p class="text-xs text-white/60">
                  {contextQuery
                    ? `No visible ${contextAddKind === 'place' ? 'Place' : 'Event'} matches that search.`
                    : `Every visible ${contextAddKind === 'place' ? 'Place' : 'Event'} is already connected.`}
                </p>
              {/if}
            {/if}
            {#if ownerSummaryActionMessage || ownerSummaryActionError}
              <div
                class={[
                  'flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs',
                  ownerSummaryActionError ? 'bg-red-400/15 text-red-100' : 'bg-white/8 text-white/75',
                ]}
                role={ownerSummaryActionError ? 'alert' : 'status'}
              >
                <span>{ownerSummaryActionError || ownerSummaryActionMessage}</span>
                {#if ownerSummaryUndoDecisionId && !ownerSummaryActionError}
                  <button
                    class="min-h-8 rounded-full bg-white/12 px-3 font-semibold hover:bg-white/20"
                    type="button"
                    onclick={() => void undoManualPhotoContextAction(ownerSummaryUndoDecisionId)}>Undo</button
                  >
                {/if}
              </div>
            {/if}
          </div>
        {/if}

        {#if contextActionMessage || contextActionError}
          <div
            class={[
              'mt-3 flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs',
              contextActionError ? 'bg-red-400/15 text-red-100' : 'bg-white/8 text-white/75',
            ]}
            role={contextActionError ? 'alert' : 'status'}
          >
            <span>{contextActionError || contextActionMessage}</span>
            {#if contextUndoDecisionId && !contextActionError}
              <button
                class="min-h-8 rounded-full bg-white/12 px-3 font-semibold hover:bg-white/20 disabled:opacity-50"
                type="button"
                disabled={isContextSaving}
                onclick={() => void undoContextAction()}>Undo</button
              >
            {/if}
          </div>
        {/if}
        {#if objectActionMessage && !isObjectTaggingMode}
          <div
            class="mt-3 flex items-center justify-between gap-3 rounded-lg bg-white/8 px-3 py-2 text-xs text-white/75"
            role="status"
          >
            <span>{objectActionMessage}</span>
            {#if objectUndoDecisionId}
              <button
                class="min-h-8 rounded-full bg-white/12 px-3 font-semibold hover:bg-white/20"
                type="button"
                onclick={() => void undoManualPhotoContextAction(objectUndoDecisionId)}>Undo</button
              >
            {/if}
          </div>
        {/if}
      </article>
    </div>
  {/if}

  {#if isSummaryVisible && !isSidecarVisible}
    <div class="pointer-events-auto absolute inset-x-3 bottom-6 flex justify-center">
      <article
        class="w-full max-w-3xl rounded-md bg-black/75 px-4 py-3 text-sm text-white shadow-xl backdrop-blur-sm"
        data-testid="cimmich-summary-overlay"
      >
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-xs font-semibold tracking-wide text-white/60 uppercase">
              {summaryTitle}
            </p>
            {#if isLoading}
              <p class="mt-1 font-medium">Loading summary...</p>
            {:else if loadError}
              <p class="mt-1 font-medium text-red-100">{loadError}</p>
            {:else if evidence}
              <p class="mt-1 font-medium">{currentSummary}</p>
            {:else if bundle}
              <p class="mt-1 font-medium">No {evidenceBrand} summary for {asset.originalFileName}</p>
            {/if}
          </div>
          {#if evidence && moreLines.length > 0}
            <button
              class="shrink-0 rounded-sm border border-white/30 px-2 py-1 text-xs"
              type="button"
              onclick={() => (isExpanded = !isExpanded)}
            >
              {isExpanded ? 'Less' : 'More'}
            </button>
          {/if}
        </div>

        {#if isExpanded}
          <div class="mt-3 grid gap-2 border-t border-white/15 pt-3 text-xs text-white/75">
            {#each moreLines as line (line)}
              <p>{line}</p>
            {/each}
          </div>
        {/if}
      </article>
    </div>
  {/if}
</div>

<style>
  .cimmich-person-choice {
    appearance: none;
  }

  .cimmich-person-choice::-webkit-calendar-picker-indicator {
    display: none !important;
    opacity: 0;
  }

  .cimmich-step2-region {
    position: absolute;
    border: 2px solid rgb(52 211 153 / 0.94);
    border-radius: 5px;
    box-shadow:
      0 0 0 1px rgb(0 0 0 / 0.72),
      inset 0 0 0 1px rgb(255 255 255 / 0.18);
  }

  .cimmich-step2-label {
    position: absolute;
    transform: translate(-50%, -100%);
    max-width: 210px;
    overflow: hidden;
    border: 1px solid rgb(52 211 153 / 0.78);
    border-radius: 5px;
    background: rgb(2 44 34 / 0.9);
    padding: 4px 7px;
    color: rgb(236 253 245);
    font-size: 11px;
    font-weight: 700;
    line-height: 1.15;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cimmich-step2-region-rejected {
    border-color: rgb(251 191 36 / 0.9);
    border-style: dashed;
  }

  .cimmich-step2-label-rejected {
    border-color: rgb(251 191 36 / 0.78);
    background: rgb(69 26 3 / 0.92);
    color: rgb(254 243 199);
  }

  .cimmich-body-label {
    position: absolute;
    pointer-events: auto;
    transform: translate(-50%, -100%);
    max-width: 180px;
    overflow: hidden;
    margin: 0;
    border: 1px solid rgb(var(--cimmich-body-rgb) / 0.68);
    border-radius: 5px;
    background: rgb(0 0 0 / 0.76);
    padding: 3px 6px;
    color: white;
    font-size: 11px;
    font-weight: 700;
    line-height: 1.1;
    text-overflow: ellipsis;
    text-shadow: 0 1px 1px rgb(0 0 0 / 0.8);
    white-space: nowrap;
  }

  .cimmich-body-label--face-match {
    border-color: rgb(var(--cimmich-body-rgb) / 0.82);
    box-shadow:
      inset 3px 0 0 rgb(var(--cimmich-body-rgb) / 0.95),
      0 0 0 1px rgb(0 0 0 / 0.35),
      0 8px 18px rgb(0 0 0 / 0.22);
  }

  .cimmich-body-label--implied {
    border-color: rgb(var(--cimmich-body-rgb) / 0.5);
    background: rgb(0 0 0 / 0.62);
    padding-bottom: 6px;
    color: rgb(255 255 255 / 0.92);
    font-weight: 650;
    box-shadow:
      0 0 0 1px rgb(0 0 0 / 0.35),
      0 8px 18px rgb(0 0 0 / 0.18);
  }

  .cimmich-body-label--implied::after {
    position: absolute;
    right: 6px;
    bottom: 2px;
    left: 6px;
    height: 3px;
    border-radius: 999px;
    background: rgb(var(--cimmich-body-rgb) / 0.95);
    content: '';
  }

  .cimmich-body-label:hover,
  .cimmich-body-label--selected {
    background: rgb(var(--cimmich-body-rgb) / 0.92);
    color: black;
    text-shadow: none;
  }

  .cimmich-body-skeleton-line {
    filter: drop-shadow(0 1px 1px rgb(0 0 0 / 0.85));
    opacity: 0.98;
    stroke: rgb(var(--cimmich-body-rgb) / 0.96);
    stroke-linecap: round;
    stroke-width: 4.5;
    vector-effect: non-scaling-stroke;
  }

  .cimmich-body-skeleton-joint {
    fill: rgb(var(--cimmich-body-rgb) / 0.95);
    filter: drop-shadow(0 1px 1px rgb(0 0 0 / 0.9));
    stroke: rgb(0 0 0 / 0.72);
    stroke-width: 1.25;
    vector-effect: non-scaling-stroke;
  }

  [data-testid='cimmich-body-skeleton'] {
    opacity: 0.52;
    transition: opacity 120ms ease;
  }

  .cimmich-body-skeleton--emphasized {
    opacity: 1;
  }

  .cimmich-body-skeleton--muted {
    opacity: 0.14;
  }

  .cimmich-person-tag {
    position: absolute;
    z-index: 10;
    pointer-events: auto;
    transform: translate(-50%, -100%) scale(var(--cimmich-overlay-inverse-zoom, 1));
    transform-origin: bottom center;
    max-width: 190px;
    overflow: hidden;
    margin: 0;
    border: 1px solid rgb(255 255 255 / 0.74);
    border-radius: 999px;
    background: rgb(0 0 0 / 0.82);
    padding: 5px 9px;
    color: white;
    font-size: 12px;
    font-weight: 750;
    line-height: 1;
    text-overflow: ellipsis;
    text-shadow: 0 1px 1px rgb(0 0 0 / 0.82);
    white-space: nowrap;
    box-shadow: 0 7px 18px rgb(0 0 0 / 0.28);
  }

  .cimmich-person-tag--actionable {
    display: flex;
    min-height: 36px;
    max-width: 240px;
    align-items: stretch;
    padding: 0;
  }

  .cimmich-person-tag__name {
    display: flex;
    min-width: 0;
    align-items: center;
    overflow: hidden;
    padding: 7px 11px 7px 13px;
    color: inherit;
    font-size: 13px;
    line-height: 1;
    text-decoration: none;
    text-overflow: ellipsis;
  }

  .cimmich-person-tag__edit {
    display: flex;
    width: 36px;
    flex: 0 0 36px;
    align-items: center;
    justify-content: center;
    border: 0;
    border-left: 1px solid rgb(15 23 42 / 0.14);
    background: transparent;
    color: inherit;
  }

  .cimmich-person-tag__name:hover,
  .cimmich-person-tag__name:focus-visible,
  .cimmich-person-tag__edit:hover,
  .cimmich-person-tag__edit:focus-visible {
    background: rgb(15 23 42 / 0.1);
    outline: none;
  }

  .cimmich-person-tag--confirmed {
    z-index: 30;
    border-color: rgb(255 255 255 / 0.9);
    background: rgb(255 255 255 / 0.94);
    color: rgb(15 23 42);
    text-shadow: none;
  }

  .cimmich-person-tag--body-only {
    border-color: rgb(255 255 255 / 0.96);
    border-style: solid;
    background-color: rgb(255 255 255 / 0.94);
    background-image:
      repeating-linear-gradient(45deg, rgb(71 85 105 / 0.1) 0 1px, transparent 1px 7px),
      repeating-linear-gradient(-45deg, rgb(71 85 105 / 0.1) 0 1px, transparent 1px 7px);
    color: rgb(15 23 42);
    text-shadow: none;
    box-shadow: 0 7px 18px rgb(0 0 0 / 0.28);
  }

  .cimmich-person-tag--candidate {
    border-color: rgb(251 191 36 / 0.96);
    border-style: dashed;
    background: rgb(69 26 3 / 0.88);
    color: rgb(254 243 199);
  }

  .cimmich-person-tag--unresolved {
    border-color: rgb(255 255 255 / 0.76);
    border-style: dashed;
    background: rgb(15 23 42 / 0.88);
  }

  .cimmich-person-tag--arrival {
    pointer-events: none;
    animation: cimmich-person-arrival 1500ms ease-out both;
  }

  @keyframes cimmich-person-arrival {
    0% {
      opacity: 0;
      filter: blur(2px);
    }

    15%,
    65% {
      opacity: 1;
      filter: blur(0);
    }

    100% {
      opacity: 0;
      filter: blur(0);
    }
  }

  .cimmich-person-tag:hover,
  .cimmich-person-tag:focus-within,
  .cimmich-person-tag--selected {
    z-index: 40;
    outline: 2px solid rgb(255 255 255 / 0.92);
    outline-offset: 2px;
  }

  .cimmich-manual-presence-label {
    position: absolute;
    z-index: 32;
    display: flex;
    align-items: center;
    gap: 5px;
    transform: translate(-50%, -100%) scale(var(--cimmich-overlay-inverse-zoom, 1));
    transform-origin: bottom center;
    max-width: 190px;
    overflow: hidden;
    margin: 0;
    border: 1px solid rgb(103 232 249 / 0.92);
    border-radius: 999px;
    background: rgb(8 47 73 / 0.9);
    padding: 5px 9px;
    color: white;
    font-size: 12px;
    font-weight: 750;
    line-height: 1;
    text-overflow: ellipsis;
    white-space: nowrap;
    box-shadow: 0 7px 18px rgb(0 0 0 / 0.32);
    cursor: pointer;
  }

  .cimmich-manual-presence-label--tagging {
    border-color: rgb(110 231 183 / 0.95);
    border-style: dashed;
    background: rgb(6 78 59 / 0.88);
  }

  .cimmich-manual-presence-label--face {
    border-color: rgb(103 232 249 / 0.95);
    border-style: solid;
    background: rgb(8 47 73 / 0.92);
  }

  .cimmich-manual-presence-label--body,
  .cimmich-manual-presence-label--head {
    border-color: rgb(255 255 255 / 0.96);
    border-style: solid;
    background-color: rgb(255 255 255 / 0.94);
    background-image:
      repeating-linear-gradient(45deg, rgb(71 85 105 / 0.1) 0 1px, transparent 1px 7px),
      repeating-linear-gradient(-45deg, rgb(71 85 105 / 0.1) 0 1px, transparent 1px 7px);
    color: rgb(15 23 42);
    text-shadow: none;
  }

  .cimmich-manual-presence-label--presence {
    border-color: rgb(110 231 183 / 0.95);
    border-style: dotted;
    background: rgb(6 78 59 / 0.88);
  }

  .cimmich-manual-presence-label:hover,
  .cimmich-manual-presence-label--selected {
    z-index: 40;
    outline: 2px solid rgb(255 255 255 / 0.92);
    outline-offset: 2px;
  }

  .cimmich-tagging-legend {
    position: absolute;
    bottom: 24px;
    left: 16px;
    z-index: 35;
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    max-width: calc(100% - 32px);
    border: 1px solid rgb(255 255 255 / 0.14);
    border-radius: 999px;
    background: rgb(2 6 23 / 0.78);
    padding: 5px;
    color: rgb(255 255 255 / 0.82);
    font-size: 10px;
    font-weight: 750;
    line-height: 1;
    box-shadow: 0 7px 20px rgb(0 0 0 / 0.3);
    backdrop-filter: blur(10px);
  }

  .cimmich-tagging-legend > span {
    display: flex;
    align-items: center;
    gap: 5px;
    min-height: 24px;
    border-radius: 999px;
    background: rgb(255 255 255 / 0.06);
    padding: 0 8px;
  }

  .cimmich-tagging-hint {
    max-width: calc(100% - 32px);
    border: 1px solid rgb(255 255 255 / 0.18);
    border-radius: 999px;
    background: rgb(2 6 23 / 0.78);
    padding: 8px 13px;
    color: rgb(255 255 255 / 0.9);
    font-size: 11px;
    font-weight: 700;
    line-height: 1.2;
    text-align: center;
    white-space: nowrap;
    box-shadow: 0 7px 20px rgb(0 0 0 / 0.28);
    backdrop-filter: blur(10px);
  }

  .cimmich-tagging-key {
    display: inline-block;
    width: 9px;
    height: 9px;
    flex: none;
  }

  .cimmich-tagging-key--named {
    border: 2px solid white;
    border-radius: 999px;
    background: rgb(34 211 238 / 0.9);
  }

  .cimmich-tagging-key--unassigned {
    border: 2px solid rgb(254 243 199 / 0.95);
    border-radius: 999px;
    background: rgb(245 158 11 / 0.9);
  }

  .cimmich-tagging-key--body,
  .cimmich-tagging-key--head {
    border: 1px solid rgb(255 255 255 / 0.9);
    border-radius: 2px;
    background-color: rgb(255 255 255 / 0.92);
    background-image: repeating-linear-gradient(45deg, rgb(71 85 105 / 0.32) 0 1px, transparent 1px 4px);
  }

  .cimmich-tagging-key--presence {
    transform: rotate(45deg);
    border: 2px solid rgb(167 243 208 / 0.95);
    border-radius: 50% 50% 50% 0;
    background: rgb(16 185 129 / 0.7);
  }

  .cimmich-matching-unknown {
    position: absolute;
    pointer-events: auto;
    width: 9px;
    height: 9px;
    transform: translate(-50%, -50%);
    overflow: visible;
    margin: 0;
    border: 1px solid rgb(255 255 255 / 0.45);
    border-radius: 999px;
    background: rgb(255 255 255 / 0.14);
    padding: 0;
    box-shadow: 0 0 0 1px rgb(0 0 0 / 0.36);
    transition:
      background 120ms ease,
      border-color 120ms ease,
      box-shadow 120ms ease;
  }

  .cimmich-tagging-dot {
    width: 44px;
    height: 44px;
    border: 0;
    background: transparent;
    cursor: pointer;
    box-shadow: none;
  }

  .cimmich-tagging-dot::before {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 13px;
    height: 13px;
    border: 2px solid;
    border-radius: 999px;
    content: '';
    transform: translate(-50%, -50%);
    box-shadow:
      0 0 0 2px rgb(0 0 0 / 0.62),
      0 5px 12px rgb(0 0 0 / 0.34);
    transition:
      transform 120ms ease,
      box-shadow 120ms ease;
  }

  .cimmich-tagging-dot--named::before {
    border-color: rgb(255 255 255 / 0.98);
    background: rgb(34 211 238 / 0.9);
  }

  .cimmich-tagging-dot--unresolved::before {
    border-color: rgb(254 243 199 / 0.95);
    background: rgb(245 158 11 / 0.9);
  }

  .cimmich-tagging-dot:hover,
  .cimmich-tagging-dot:focus-visible,
  .cimmich-tagging-dot.cimmich-matching-unknown--selected {
    border: 0;
    background: transparent;
    box-shadow: none;
    outline: none;
  }

  .cimmich-tagging-dot:hover::before,
  .cimmich-tagging-dot:focus-visible::before,
  .cimmich-tagging-dot.cimmich-matching-unknown--selected::before {
    transform: translate(-50%, -50%) scale(1.25);
    box-shadow:
      0 0 0 3px rgb(255 255 255 / 0.28),
      0 7px 18px rgb(0 0 0 / 0.38);
  }

  .cimmich-tagging-dot span {
    top: 6px;
  }

  .cimmich-manual-tag-canvas {
    cursor: crosshair;
  }

  .cimmich-manual-tag-canvas:focus-visible {
    outline: 2px solid rgb(103 232 249 / 0.95);
    outline-offset: -3px;
  }

  .cimmich-manual-tag-region {
    min-width: 30px;
    min-height: 36px;
    border: 2px dashed rgb(103 232 249 / 0.98);
    border-radius: 12px;
    background: rgb(6 182 212 / 0.08);
    box-shadow:
      0 0 0 1px rgb(0 0 0 / 0.65),
      0 0 24px rgb(34 211 238 / 0.28);
  }

  .cimmich-manual-tag-region span,
  .cimmich-manual-tag-region span::before {
    position: absolute;
    left: 50%;
    top: 50%;
    display: block;
    content: '';
    background: rgb(255 255 255 / 0.96);
    box-shadow: 0 0 0 1px rgb(0 0 0 / 0.6);
    transform: translate(-50%, -50%);
  }

  .cimmich-manual-tag-region span {
    width: 18px;
    height: 2px;
  }

  .cimmich-manual-tag-region span::before {
    width: 2px;
    height: 18px;
  }

  .cimmich-matching-unknown span {
    position: absolute;
    left: 50%;
    top: -7px;
    transform: translate(-50%, -100%);
    opacity: 0;
    width: max-content;
    border: 1px dashed rgb(255 255 255 / 0.88);
    border-radius: 999px;
    background: rgb(15 23 42 / 0.94);
    padding: 4px 8px;
    color: white;
    font-size: 11px;
    font-weight: 800;
    line-height: 1;
    pointer-events: none;
    transition: opacity 120ms ease;
  }

  .cimmich-matching-unknown:hover,
  .cimmich-matching-unknown:focus-visible,
  .cimmich-matching-unknown--selected {
    border-color: rgb(255 255 255 / 0.95);
    background: rgb(255 255 255 / 0.72);
    box-shadow:
      0 0 0 4px rgb(255 255 255 / 0.16),
      0 7px 18px rgb(0 0 0 / 0.28);
    outline: none;
  }

  .cimmich-matching-unknown:hover span,
  .cimmich-matching-unknown:focus-visible span,
  .cimmich-matching-unknown--selected span {
    opacity: 1;
  }

  .cimmich-machine-face {
    position: absolute;
    pointer-events: auto;
    margin: 0;
    border: 3px solid rgb(var(--cimmich-body-rgb) / 0.98);
    border-radius: 50%;
    background: rgb(var(--cimmich-body-rgb) / 0.08);
    padding: 0;
    box-shadow:
      0 0 0 1px rgb(0 0 0 / 0.7),
      0 0 18px rgb(var(--cimmich-body-rgb) / 0.34);
  }

  .cimmich-machine-face--untagged,
  .cimmich-machine-face--sidecar-only {
    border-style: dashed;
  }

  .cimmich-machine-face:hover,
  .cimmich-machine-face--selected {
    background: rgb(var(--cimmich-body-rgb) / 0.2);
    box-shadow:
      0 0 0 2px rgb(255 255 255 / 0.95),
      0 0 24px rgb(var(--cimmich-body-rgb) / 0.58);
  }

  .cimmich-machine-face--selected {
    cursor: move;
    touch-action: none;
  }

  .cimmich-machine-face {
    z-index: 15;
  }

  .cimmich-machine-face--linked-focus {
    z-index: 21;
  }

  .cimmich-machine-body {
    position: absolute;
    z-index: 8;
    pointer-events: auto;
    margin: 0;
    border: 2px solid rgb(var(--cimmich-body-rgb) / 0.5);
    border-radius: 10px;
    background: rgb(var(--cimmich-body-rgb) / 0.025);
    padding: 0;
    opacity: 0.42;
    transition:
      background 120ms ease,
      border-color 120ms ease,
      opacity 120ms ease;
  }

  .cimmich-machine-body--unlinked {
    border-style: dashed;
  }

  .cimmich-machine-body--pose {
    border-color: transparent;
    background: transparent;
    opacity: 1;
    box-shadow: none;
  }

  .cimmich-machine-body--pose:hover,
  .cimmich-machine-body--pose.cimmich-machine-body--emphasized,
  .cimmich-machine-body--pose.cimmich-machine-body--selected {
    border-color: transparent;
    background: transparent;
    opacity: 1;
    box-shadow: none;
  }

  .cimmich-machine-body:hover,
  .cimmich-machine-body--emphasized,
  .cimmich-machine-body--selected {
    z-index: 20;
    border-color: rgb(var(--cimmich-body-rgb) / 0.96);
    background: rgb(var(--cimmich-body-rgb) / 0.08);
    opacity: 1;
    box-shadow:
      0 0 0 1px rgb(0 0 0 / 0.58),
      0 0 20px rgb(var(--cimmich-body-rgb) / 0.22);
  }

  .cimmich-machine-body--selected {
    cursor: move;
    touch-action: none;
  }

  .cimmich-observation-handles {
    position: absolute;
    z-index: 36;
    pointer-events: none;
  }

  .cimmich-machine-face--context {
    border-color: rgb(34 211 238 / 0.98);
    box-shadow:
      0 0 0 3px rgb(255 255 255 / 0.92),
      0 0 0 7px rgb(34 211 238 / 0.42),
      0 0 24px rgb(34 211 238 / 0.5);
  }

  .cimmich-machine-face-label {
    position: absolute;
    z-index: 25;
    pointer-events: auto;
    transform: translate(-50%, -100%);
    max-width: 190px;
    display: flex;
    overflow: visible;
    margin: 0;
    border: 1px solid rgb(var(--cimmich-body-rgb) / 0.92);
    border-radius: 999px;
    background: rgb(0 0 0 / 0.8);
    padding: 0;
    color: white;
    font-size: 11px;
    font-weight: 750;
    line-height: 1;
    text-overflow: ellipsis;
    white-space: nowrap;
    box-shadow: inset 3px 0 0 rgb(var(--cimmich-body-rgb) / 0.96);
  }

  .cimmich-machine-face-label-main {
    min-width: 0;
    overflow: hidden;
    border: 0;
    border-radius: inherit;
    background: transparent;
    padding: 4px 8px;
    color: inherit;
    font: inherit;
    line-height: inherit;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cimmich-machine-face-label--candidate {
    border-color: rgb(251 191 36 / 0.95);
    background: rgb(69 26 3 / 0.92);
    color: rgb(254 243 199);
    box-shadow: inset 3px 0 0 rgb(251 191 36 / 0.96);
  }

  .cimmich-machine-candidate-accept {
    display: grid;
    width: 28px;
    min-height: 24px;
    flex: none;
    place-items: center;
    border: 0;
    border-left: 1px solid rgb(251 191 36 / 0.35);
    border-radius: 0 999px 999px 0;
    background: rgb(251 191 36 / 0.14);
    color: rgb(254 243 199);
  }

  .cimmich-machine-candidate-accept:hover,
  .cimmich-machine-candidate-accept:focus-visible {
    background: rgb(251 191 36 / 0.96);
    color: black;
    outline: none;
  }

  .cimmich-machine-candidate-list {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 60;
    display: none;
    min-width: 220px;
    overflow: hidden;
    border: 1px solid rgb(255 255 255 / 0.16);
    border-radius: 10px;
    background: rgb(2 6 23 / 0.94);
    padding: 4px;
    color: white;
    box-shadow: 0 14px 34px rgb(0 0 0 / 0.48);
    backdrop-filter: blur(12px);
  }

  .cimmich-machine-face-label--candidate:hover .cimmich-machine-candidate-list,
  .cimmich-machine-face-label--candidate:focus-within .cimmich-machine-candidate-list {
    display: grid;
  }

  .cimmich-machine-candidate-list > span {
    display: flex;
    min-height: 34px;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    border-radius: 7px;
    padding-left: 9px;
  }

  .cimmich-machine-candidate-list > span:hover {
    background: rgb(255 255 255 / 0.08);
  }

  .cimmich-machine-candidate-list button {
    display: grid;
    width: 32px;
    min-height: 32px;
    flex: none;
    place-items: center;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: rgb(253 230 138);
  }

  .cimmich-machine-candidate-list button:hover,
  .cimmich-machine-candidate-list button:focus-visible {
    background: rgb(251 191 36 / 0.92);
    color: black;
    outline: none;
  }

  .cimmich-source-presence-box {
    position: absolute;
    border: 2px dashed rgb(251 191 36 / 0.94);
    border-radius: 8px;
    background: rgb(251 191 36 / 0.08);
    box-shadow:
      0 0 0 1px rgb(0 0 0 / 0.55),
      0 10px 24px rgb(0 0 0 / 0.22);
  }

  .cimmich-source-presence-label {
    position: absolute;
    transform: translate(-50%, -100%);
    max-width: 190px;
    overflow: hidden;
    border: 1px solid rgb(251 191 36 / 0.78);
    border-radius: 5px;
    background: rgb(0 0 0 / 0.78);
    padding: 3px 6px;
    color: rgb(254 243 199);
    font-size: 11px;
    font-weight: 800;
    line-height: 1.1;
    text-overflow: ellipsis;
    text-shadow: 0 1px 1px rgb(0 0 0 / 0.8);
    white-space: nowrap;
  }

  .cimmich-face-box {
    position: absolute;
    pointer-events: auto;
    cursor: move;
    touch-action: none;
    margin: 0;
    background: transparent;
    border: 2px solid rgb(255 255 255 / 0.9);
    border-radius: 8px;
    padding: 0;
    box-shadow:
      0 0 0 1px rgb(0 0 0 / 0.55),
      0 10px 24px rgb(0 0 0 / 0.25);
    text-align: left;
  }

  .cimmich-match-face-marker {
    position: absolute;
    pointer-events: auto;
    width: 12px;
    height: 12px;
    transform: translate(-50%, -50%);
    margin: 0;
    border: 2px solid rgb(255 255 255 / 0.92);
    border-radius: 999px;
    background: rgb(255 255 255 / 0.28);
    padding: 0;
    box-shadow:
      0 0 0 1px rgb(0 0 0 / 0.72),
      0 2px 7px rgb(0 0 0 / 0.38);
  }

  .cimmich-match-face-marker--named {
    border-color: rgb(255 255 255 / 0.94);
    background: rgb(255 255 255 / 0.35);
  }

  .cimmich-match-face-marker--untagged {
    width: 10px;
    height: 10px;
    border-color: rgb(251 191 36 / 0.94);
    background: rgb(251 191 36 / 0.22);
  }

  .cimmich-match-face-marker--sidecar-only {
    width: 10px;
    height: 10px;
    border-color: rgb(96 165 250 / 0.94);
    background: rgb(96 165 250 / 0.22);
  }

  .cimmich-match-face-marker--rejected {
    width: 9px;
    height: 9px;
    border-color: rgb(248 113 113 / 0.94);
    border-style: dashed;
    background: rgb(248 113 113 / 0.2);
  }

  .cimmich-match-face-marker--body-linked {
    border-color: rgb(var(--cimmich-body-rgb) / 0.92);
    background: rgb(var(--cimmich-body-rgb) / 0.28);
    box-shadow:
      0 0 0 1px rgb(0 0 0 / 0.72),
      0 0 0 4px rgb(var(--cimmich-body-rgb) / 0.16),
      0 2px 7px rgb(0 0 0 / 0.38);
  }

  .cimmich-match-candidate-label {
    position: absolute;
    pointer-events: auto;
    transform: translate(-50%, -100%);
    max-width: 180px;
    overflow: hidden;
    margin: 0;
    border: 1px solid rgb(251 191 36 / 0.88);
    border-radius: 5px;
    background: rgb(20 13 0 / 0.82);
    padding: 3px 6px;
    color: rgb(254 243 199);
    font-size: 11px;
    font-weight: 800;
    line-height: 1.1;
    text-overflow: ellipsis;
    text-shadow: 0 1px 1px rgb(0 0 0 / 0.86);
    white-space: nowrap;
    box-shadow:
      0 0 0 1px rgb(0 0 0 / 0.55),
      0 8px 18px rgb(0 0 0 / 0.22);
  }

  .cimmich-match-candidate-label:hover,
  .cimmich-match-candidate-label:focus-visible {
    background: rgb(251 191 36 / 0.92);
    color: black;
    text-shadow: none;
    outline: none;
  }

  .cimmich-match-face-marker:hover,
  .cimmich-match-face-marker--selected {
    background: rgb(var(--cimmich-body-rgb, 255 255 255) / 0.78);
    box-shadow:
      0 0 0 1px rgb(0 0 0 / 0.68),
      0 0 0 5px rgb(var(--cimmich-body-rgb, 255 255 255) / 0.24),
      0 8px 22px rgb(0 0 0 / 0.22);
  }

  .cimmich-face-box-handle {
    position: absolute;
    width: 12px;
    height: 12px;
    margin: 0;
    border: 1px solid rgb(0 0 0 / 0.72);
    border-radius: 9999px;
    background: rgb(255 255 255 / 0.96);
    box-shadow: 0 2px 5px rgb(0 0 0 / 0.42);
    padding: 0;
    pointer-events: auto;
    touch-action: none;
  }

  .cimmich-face-box-handle:hover,
  .cimmich-face-box-handle:focus-visible {
    outline: 2px solid rgb(255 255 255 / 0.95);
    outline-offset: 2px;
  }

  .cimmich-face-box-handle--nw {
    top: -7px;
    left: -7px;
    cursor: nwse-resize;
  }

  .cimmich-face-box-handle--n {
    top: -7px;
    left: 50%;
    cursor: ns-resize;
    transform: translateX(-50%);
  }

  .cimmich-face-box-handle--ne {
    top: -7px;
    right: -7px;
    cursor: nesw-resize;
  }

  .cimmich-face-box-handle--w {
    top: 50%;
    left: -7px;
    cursor: ew-resize;
    transform: translateY(-50%);
  }

  .cimmich-face-box-handle--e {
    top: 50%;
    right: -7px;
    cursor: ew-resize;
    transform: translateY(-50%);
  }

  .cimmich-face-box-handle--sw {
    bottom: -7px;
    left: -7px;
    cursor: nesw-resize;
  }

  .cimmich-face-box-handle--s {
    bottom: -7px;
    left: 50%;
    cursor: ns-resize;
    transform: translateX(-50%);
  }

  .cimmich-face-box-handle--se {
    right: -7px;
    bottom: -7px;
    cursor: nwse-resize;
  }

  .cimmich-face-label {
    position: absolute;
    pointer-events: auto;
    transform: translate(-50%, -100%);
    max-width: 180px;
    overflow: hidden;
    margin: 0;
    border: 1px solid rgb(255 255 255 / 0.22);
    border-radius: 5px;
    background: rgb(0 0 0 / 0.78);
    padding: 3px 6px;
    color: white;
    font-size: 11px;
    font-weight: 700;
    line-height: 1.1;
    text-overflow: ellipsis;
    text-shadow: 0 1px 1px rgb(0 0 0 / 0.8);
    white-space: nowrap;
  }

  .cimmich-face-leader {
    position: absolute;
    width: 2px;
    min-height: 6px;
    transform: translateX(-50%);
    border-radius: 999px;
    background: rgb(255 255 255 / 0.78);
    box-shadow: 0 0 0 1px rgb(0 0 0 / 0.6);
    pointer-events: none;
  }

  .cimmich-face-leader::after {
    position: absolute;
    bottom: -2px;
    left: 50%;
    width: 6px;
    height: 6px;
    transform: translateX(-50%);
    border-radius: 999px;
    background: currentColor;
    box-shadow: 0 0 0 1px rgb(0 0 0 / 0.72);
    content: '';
  }

  .cimmich-face-leader--named {
    color: rgb(74 222 128);
    background: rgb(74 222 128 / 0.84);
  }

  .cimmich-face-leader--untagged {
    color: rgb(253 186 116);
    background: rgb(253 186 116 / 0.84);
  }

  .cimmich-face-leader--sidecar-only {
    color: rgb(251 191 36);
    background: rgb(251 191 36 / 0.84);
  }

  .cimmich-face-leader--rejected {
    color: rgb(248 113 113);
    background: rgb(248 113 113 / 0.84);
  }

  .cimmich-face-leader--body-linked {
    color: rgb(var(--cimmich-body-rgb));
    background: rgb(var(--cimmich-body-rgb) / 0.88);
  }

  .cimmich-face-label:hover,
  .cimmich-face-label--selected {
    background: rgb(255 255 255 / 0.92);
    color: black;
    text-shadow: none;
  }

  .cimmich-face-label--named {
    border-color: rgb(74 222 128 / 0.72);
    box-shadow:
      inset 3px 0 0 rgb(74 222 128 / 0.95),
      0 0 0 1px rgb(0 0 0 / 0.35);
  }

  .cimmich-face-label--untagged {
    border-color: rgb(250 204 21 / 0.75);
    background: rgb(63 52 12 / 0.84);
    color: rgb(254 249 195);
    font-weight: 650;
  }

  .cimmich-face-label--sidecar-only {
    border-color: rgb(147 197 253 / 0.72);
    color: rgb(219 234 254);
  }

  .cimmich-face-label--rejected {
    border-color: rgb(248 113 113 / 0.75);
    color: rgb(254 226 226);
    text-decoration: line-through;
  }

  .cimmich-face-label--body-linked {
    border-color: rgb(var(--cimmich-body-rgb) / 0.8);
    box-shadow:
      inset 3px 0 0 rgb(var(--cimmich-body-rgb) / 0.95),
      0 0 0 1px rgb(0 0 0 / 0.35);
  }

  .cimmich-face-label--body-linked:hover,
  .cimmich-face-label--body-linked.cimmich-face-label--selected {
    background: rgb(var(--cimmich-body-rgb) / 0.92);
    border-color: rgb(var(--cimmich-body-rgb) / 1);
    color: black;
    text-shadow: none;
  }

  .cimmich-face-label:focus-visible {
    outline: 2px solid white;
    outline-offset: 3px;
  }

  .cimmich-face-marker {
    position: absolute;
    pointer-events: auto;
    display: grid;
    width: 18px;
    height: 18px;
    transform: translate(-50%, -50%);
    place-items: center;
    border: 1px solid rgb(255 255 255 / 0.32);
    border-radius: 9999px;
    background: rgb(0 0 0 / 0.34);
    color: rgb(255 255 255 / 0.68);
    font-size: 10px;
    font-weight: 800;
    line-height: 1;
    text-shadow: 0 1px 1px rgb(0 0 0 / 0.8);
  }

  .cimmich-face-marker:hover,
  .cimmich-face-marker--selected {
    border-color: rgb(255 255 255 / 0.9);
    background: rgb(255 255 255 / 0.9);
    color: black;
    text-shadow: none;
  }

  .cimmich-face-marker:focus-visible {
    outline: 2px solid white;
    outline-offset: 3px;
  }

  .cimmich-face-box--named {
    border-color: rgb(74 222 128 / 0.95);
  }

  .cimmich-face-box--untagged {
    border-color: rgb(250 204 21 / 0.95);
    border-style: dashed;
  }

  .cimmich-face-box--rejected {
    border-color: rgb(248 113 113 / 0.9);
    border-style: dotted;
  }

  .cimmich-face-box--sidecar {
    border-color: rgb(147 197 253 / 0.9);
    border-style: dashed;
  }

  .cimmich-face-box--selected {
    border-width: 3px;
    box-shadow:
      0 0 0 2px rgb(255 255 255 / 0.75),
      0 14px 28px rgb(0 0 0 / 0.3);
  }

  .cimmich-person-tag--context,
  .cimmich-machine-face-label--context,
  .cimmich-body-label--context {
    z-index: 45;
    outline: 3px solid rgb(34 211 238 / 0.96);
    outline-offset: 3px;
    box-shadow:
      0 0 0 7px rgb(34 211 238 / 0.16),
      0 10px 24px rgb(0 0 0 / 0.38);
  }
</style>
