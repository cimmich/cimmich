<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import CimmichDocuments from '$lib/components/cimmich/CimmichDocuments.svelte';
  import CimmichEntityMediaActions from '$lib/components/cimmich/CimmichEntityMediaActions.svelte';
  import { handleCimmichMediaCardClick } from '$lib/components/cimmich/media-card-selection';
  import CimmichObjectVisibility from '$lib/components/cimmich/CimmichObjectVisibility.svelte';
  import CimmichSectionHeader from '$lib/components/cimmich/CimmichSectionHeader.svelte';
  import CimmichStatePanel from '$lib/components/cimmich/CimmichStatePanel.svelte';
  import { filterVisibleCimmichAssets } from '$lib/components/cimmich/asset-picker-visibility';
  import {
    ENTITY_MEDIA_SELECTION_LIMIT,
    type CimmichEntityMediaItem,
  } from '$lib/components/cimmich/entity-media-actions';
  import {
    getPetPresentation,
    getPetCollectionHref,
    getPetConnectionHref,
    getPetContentHref,
    getPetContentKeyboardTarget,
    getPetContentView,
    getPetDetailHref,
    getPetMediaFocusCrop,
    getPetMediaTimeframe,
    getPetRelatedConnectionsHref,
    getVisiblePetAliases,
    groupPetConnections,
    petPhotoGridClass,
    sortPets,
    type PetContentView,
    type PetPhotoSize,
    type PetSortMode,
  } from '$lib/components/cimmich/pet-presentation';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import { cimmichVisibilityManager } from '$lib/managers/cimmich-visibility-manager.svelte';
  import { Route } from '$lib/route';
  import {
    CimmichServiceError,
    createCimmichCommandId,
    createCimmichPet,
    getCimmichAssetEvidence,
    getCimmichPetMatchUnknown,
    getCimmichPetMatchSuggestions,
    getCimmichPetMedia,
    getCimmichPetPresentation,
    getCimmichPets,
    reviewCimmichPetMatchUnknown,
    reviewCimmichPetMatch,
    setCimmichPetMedia,
    setCimmichPetPresentation,
    undoCimmichPetDecision,
    updateCimmichPet,
    type CimmichPet,
    type CimmichPetMatchSuggestion,
    type CimmichPetMatchUnknown,
    type CimmichPetMedia,
    type CimmichPetPresentation,
    type CimmichPetPresentationSlot,
    type CimmichPetSpeciesKind,
    type CimmichPersonPresentationMedia,
  } from '$lib/services/cimmich.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize, searchAssets, type AssetResponseDto } from '@immich/sdk';
  import {
    mdiArrowLeft,
    mdiCalendarBlankOutline,
    mdiCheck,
    mdiCrop,
    mdiFileDocumentOutline,
    mdiImageMultipleOutline,
    mdiImageEditOutline,
    mdiImageOffOutline,
    mdiImagePlusOutline,
    mdiLinkOff,
    mdiMagnify,
    mdiMapMarkerOutline,
    mdiPackageVariantClosed,
    mdiPawOutline,
    mdiPencilOutline,
    mdiPlus,
    mdiShieldCheckOutline,
    mdiSelectAll,
    mdiSortAlphabeticalAscending,
    mdiSortAlphabeticalDescending,
    mdiSortNumericAscending,
    mdiSortNumericDescending,
    mdiSortVariant,
    mdiUndoVariant,
    mdiViewGridOutline,
  } from '@mdi/js';
  import {
    ContextMenuButton,
    Field,
    FormModal,
    Icon,
    Input,
    Modal,
    ModalBody,
    ModalFooter,
    Select,
    Textarea,
    Tooltip,
    toastManager,
    type ActionItem,
  } from '@immich/ui';
  import { SvelteSet } from 'svelte/reactivity';
  import { t } from 'svelte-i18n';
  import { untrack } from 'svelte';

  type RetryCommand = { id: string; payload: string } | null;
  type UndoReceipt = { decisionId: string; petName: string } | null;
  type UnknownAssignmentMode = 'existing' | 'new';
  type PetPresentationFrame = { centerX: number; centerY: number; zoom: number };
  type PetPresentationDrag = {
    pointerId: number;
    slotKind: CimmichPetPresentationSlot;
    x: number;
    y: number;
  };

  let aboutCommand = $state<RetryCommand>(null);
  let aboutDescription = $state('');
  let aboutInput = $state<HTMLTextAreaElement | null>(null);
  let attachCommand = $state<RetryCommand>(null);
  let archiveCommand = $state<RetryCommand>(null);
  let coverCommand = $state<RetryCommand>(null);
  let coverEditorMedia = $state<CimmichPetMedia | null>(null);
  let coverFocusX = $state(50);
  let coverFocusY = $state(50);
  let coverZoom = $state(1);
  let coverZoomInput = $state<HTMLInputElement | null>(null);
  let connectionsTab = $state<HTMLButtonElement | null>(null);
  let createAliases = $state('');
  let createBreedLabel = $state('');
  let createCommand = $state<RetryCommand>(null);
  let createDescription = $state('');
  let createName = $state('');
  let createNameInput = $state<HTMLInputElement | null>(null);
  let createSpeciesKind = $state<CimmichPetSpeciesKind | ''>('');
  let createSpeciesLabel = $state('');
  let error = $state<CimmichServiceError | null>(null);
  let isCreating = $state(false);
  let isEditingAbout = $state(false);
  let isLoadingLibrary = $state(false);
  let isMutating = $state(false);
  let isUpdating = $state(false);
  let libraryAssets = $state<AssetResponseDto[]>([]);
  let libraryQuery = $state('');
  let librarySearchInput = $state<HTMLInputElement | null>(null);
  let loaded = $state(false);
  let mediaError = $state<CimmichServiceError | null>(null);
  let mediaLoaded = $state(false);
  let mediaCommand = $state<RetryCommand>(null);
  let detailsTab = $state<HTMLButtonElement | null>(null);
  let displayTab = $state<HTMLButtonElement | null>(null);
  let documentsTab = $state<HTMLButtonElement | null>(null);
  let petMedia = $state<CimmichPetMedia[]>([]);
  let petMediaSelectionMode = $state(false);
  let selectedPetMediaIds = $state<string[]>([]);
  let petMatchError = $state<CimmichServiceError | null>(null);
  let petMatches = $state<CimmichPetMatchSuggestion[]>([]);
  let petMatchesLoaded = $state(false);
  let petMatchReviewing = $state('');
  let petUnknown = $state<CimmichPetMatchUnknown[]>([]);
  let petUnknownAssignmentMode = $state<UnknownAssignmentMode>('existing');
  let petUnknownAssignmentObservation = $state<CimmichPetMatchUnknown | null>(null);
  let petUnknownAssignmentPetId = $state('');
  let petUnknownAssignmentQuery = $state('');
  let petUnknownAssignmentSearchInput = $state<HTMLInputElement | null>(null);
  let petUnknownError = $state<CimmichServiceError | null>(null);
  let petUnknownLoaded = $state(false);
  let petUnknownReviewCommand = $state<RetryCommand>(null);
  let petUnknownReviewing = $state('');
  let petPresentation = $state<CimmichPetPresentation>();
  let petPresentationDrag = $state<PetPresentationDrag>();
  let petPresentationFrames = $state<Record<CimmichPetPresentationSlot, PetPresentationFrame>>({
    face: { centerX: 50, centerY: 50, zoom: 1 },
    hero: { centerX: 50, centerY: 50, zoom: 1 },
  });
  let petPresentationPickerSlot = $state<CimmichPetPresentationSlot | ''>('');
  let petPresentationSaving = $state<CimmichPetPresentationSlot | ''>('');
  let petPreviewMedia = $state<Record<string, CimmichPetMedia>>({});
  let pets = $state<CimmichPet[]>([]);
  let petsLoadGeneration = 0;
  let mediaLoadGeneration = 0;
  let petMatchesLoadGeneration = 0;
  let petUnknownLoadGeneration = 0;
  let libraryLoadGeneration = 0;
  let pickerError = $state('');
  let pickerSelectedIds = $state<string[]>([]);
  let photosTab = $state<HTMLButtonElement | null>(null);
  let reviewTab = $state<HTMLButtonElement | null>(null);
  let query = $state('');
  let selectedPet = $state<CimmichPet | null>(null);
  let showCoverEditor = $state(false);
  let showCoverPicker = $state(false);
  let showCreate = $state(false);
  let showEdit = $state(false);
  let showMediaPicker = $state(false);
  type PetViewMode = 'pets' | 'unknown';
  const petViewModes: Array<{ id: PetViewMode; label: string }> = [
    { id: 'pets', label: 'Pets' },
    { id: 'unknown', label: 'Unknown' },
  ];
  // Unknown is a sibling view, never a panel stacked above the collection —
  // an unbounded review queue must not displace the owner's own Pets.
  let petViewMode = $state<PetViewMode>('pets');
  let petThumbnailSize = $state<'large' | 'medium' | 'small'>('medium');
  let petPhotoSize = $state<PetPhotoSize>('medium');
  // A failed thumbnail must not fall back to the browser's alt-text rendering:
  // the raw source filename then overflows the frame and collides with the badge.
  const unreadableObservations = new SvelteSet<string>();
  const markObservationUnreadable = (observationId: string) => {
    if (!unreadableObservations.has(observationId)) {
      unreadableObservations.add(observationId);
    }
  };
  let sortMode = $state<PetSortMode>('name-asc');
  let undoReceipt = $state<UndoReceipt>(null);
  let undoCommand = $state<RetryCommand>(null);
  let updateAliases = $state('');
  let updateBreedLabel = $state('');
  let updateCommand = $state<RetryCommand>(null);
  let updateDescription = $state('');
  let updateName = $state('');
  let updateNameInput = $state<HTMLInputElement | null>(null);
  let updateSpeciesKind = $state<CimmichPetSpeciesKind | ''>('');
  let updateSpeciesLabel = $state('');
  const relatedPetIds = $derived(new Set((page.url.searchParams.get('relatedIds') ?? '').split(',').filter(Boolean)));
  const relatedFrom = $derived(page.url.searchParams.get('relatedFrom') ?? '');
  // The named /cimmich/pets/[petName] route is canonical; ?entityId= remains
  // supported so links shared before the route existed still resolve.
  const requestedPetName = $derived((page.data as { petName?: string }).petName ?? '');
  const requestedPetId = $derived(
    page.url.searchParams.get('petId') || page.url.searchParams.get('entityId') || (requestedPetName ? '' : null),
  );
  const requestedPetContent = $derived(getPetContentView(page.url));
  let activePetContent = $derived<PetContentView>(requestedPetContent);
  const connectionGroups = $derived(selectedPet ? groupPetConnections(selectedPet.connections) : []);

  const speciesOptions = [
    { label: 'Not set', value: '' },
    { label: 'Dog', value: 'dog' },
    { label: 'Cat', value: 'cat' },
    { label: 'Bird', value: 'bird' },
    { label: 'Rabbit', value: 'rabbit' },
    { label: 'Fish', value: 'fish' },
    { label: 'Reptile', value: 'reptile' },
    { label: 'Small mammal', value: 'small_mammal' },
    { label: 'Other', value: 'other' },
  ];

  const visiblePets = $derived.by(() => {
    const value = query.trim().toLocaleLowerCase();
    return sortPets(
      pets.filter(
        (pet) =>
          (relatedPetIds.size === 0 || relatedPetIds.has(pet.petId)) &&
          (!value || [pet.displayName, pet.description, ...pet.aliases].join(' ').toLocaleLowerCase().includes(value)),
      ),
      sortMode,
    );
  });

  const compatibleUnknownPets = $derived.by(() => {
    if (!petUnknownAssignmentObservation) {
      return [];
    }
    const value = petUnknownAssignmentQuery.trim().toLocaleLowerCase();
    return pets.filter(
      (pet) =>
        pet.speciesKind === petUnknownAssignmentObservation?.speciesKind &&
        (!value || [pet.displayName, pet.breedLabel, ...pet.aliases].join(' ').toLocaleLowerCase().includes(value)),
    );
  });

  const sortLabel = $derived(
    {
      'media-asc': 'Fewest media',
      'media-desc': 'Most media',
      'name-asc': 'Name A to Z',
      'name-desc': 'Name Z to A',
    }[sortMode],
  );

  const sortActions = $derived.by(
    () =>
      [
        {
          title: 'Name A to Z',
          icon: sortMode === 'name-asc' ? mdiCheck : mdiSortAlphabeticalAscending,
          onAction: () => (sortMode = 'name-asc'),
        },
        {
          title: 'Name Z to A',
          icon: sortMode === 'name-desc' ? mdiCheck : mdiSortAlphabeticalDescending,
          onAction: () => (sortMode = 'name-desc'),
        },
        {
          title: 'Most media',
          icon: sortMode === 'media-desc' ? mdiCheck : mdiSortNumericDescending,
          onAction: () => (sortMode = 'media-desc'),
        },
        {
          title: 'Fewest media',
          icon: sortMode === 'media-asc' ? mdiCheck : mdiSortNumericAscending,
          onAction: () => (sortMode = 'media-asc'),
        },
      ] satisfies ActionItem[],
  );

  const visibleLibraryAssets = $derived.by(() => {
    const value = libraryQuery.trim().toLocaleLowerCase();
    return libraryAssets.filter(
      (asset) =>
        !value ||
        [asset.originalFileName, asset.exifInfo?.city, asset.exifInfo?.country]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase()
          .includes(value),
    );
  });

  const attachedSourceIds = $derived(new Set(petMedia.map((item) => item.sourceAssetId)));
  const photoTimeframe = $derived(getPetMediaTimeframe(petMedia));
  const selectablePetPresentationMedia = $derived(
    petMedia.filter((item) => Boolean(item.pet_face || item.pet_body) || item.association_types.includes('presence')),
  );
  const selectedPetMediaItems = $derived<CimmichEntityMediaItem[]>(
    petMedia
      .filter((item) => selectedPetMediaIds.includes(item.asset_id))
      .map((item) => ({
        assetId: item.asset_id,
        filename: item.filename,
        sourceAssetId: item.sourceAssetId,
      })),
  );

  const parseLabels = (value: string) =>
    [
      ...new Set(
        value
          .split(',')
          .map((label) => label.trim())
          .filter(Boolean),
      ),
    ].slice(0, 30);

  const commandFor = (current: RetryCommand, kind: string, payload: unknown) => {
    const serialized = JSON.stringify(payload);
    return current?.payload === serialized ? current : { id: createCimmichCommandId(kind), payload: serialized };
  };

  const asServiceError = (value: unknown) =>
    value instanceof CimmichServiceError
      ? value
      : new CimmichServiceError('The Pets workspace could not complete that request', {
          code: 'CIMMICH_REQUEST_FAILED',
          status: 0,
        });

  const errorCopy = (value: CimmichServiceError) => {
    switch (value.code) {
      case 'CIMMICH_UNAVAILABLE': {
        return 'The local Cimmich service is unavailable. Your library has not been changed.';
      }
      case 'CIMMICH_TIMEOUT': {
        return 'The local service took too long to respond. You can safely retry this command.';
      }
      case 'PET_COMMAND_CONFLICT': {
        return 'This retry token was already used for a different Pet change. Review the fields and try again.';
      }
      case 'PET_COMMAND_ID_INVALID': {
        return 'Cimmich could not verify the retry token for this change.';
      }
      case 'PET_PERSON_ISOLATION': {
        return 'People and Pets are separate subject types and cannot be combined.';
      }
      case 'PET_ASSET_NOT_FOUND': {
        return 'At least one media ID is not an active Cimmich asset. Remove it and try again.';
      }
      case 'PET_ASSET_IDS_INVALID': {
        return 'Attach or detach between 1 and 100 stable Cimmich asset IDs.';
      }
      case 'PET_UNDO_NOT_AVAILABLE':
      case 'PET_UNDO_SUPERSEDED': {
        return 'That change can no longer be undone because newer Pet evidence exists.';
      }
      case 'PET_NOT_FOUND': {
        return 'That Pet is no longer available in the current projection.';
      }
      case 'PET_ALIASES_INVALID': {
        return 'Use no more than 30 short alias labels.';
      }
      case 'PET_SPECIES_INVALID': {
        return 'Choose a supported species. A custom label is available only for Other.';
      }
      case 'PET_BREED_INVALID': {
        return 'Breed must be 120 characters or fewer.';
      }
      case 'PET_DOCUMENT_COMMAND_CONFLICT': {
        return 'This retry token was already used for a different document change. Review the selection and try again.';
      }
      case 'PET_DOCUMENT_PET_NOT_FOUND': {
        return 'That Pet is no longer available in the current projection.';
      }
      case 'PET_DOCUMENT_ASSET_NOT_FOUND': {
        return 'At least one selected item is not an active Cimmich asset.';
      }
      case 'PET_DOCUMENT_KIND_INVALID': {
        return 'Choose a supported document type.';
      }
      case 'PET_DOCUMENT_LABEL_INVALID': {
        return 'The document label must be 120 characters or fewer.';
      }
      case 'PET_DOCUMENT_ITEMS_INVALID': {
        return 'Choose between 1 and 100 unique documents.';
      }
      case 'PET_DOCUMENT_UNDO_NOT_AVAILABLE':
      case 'PET_DOCUMENT_UNDO_SUPERSEDED': {
        return 'That document change can no longer be undone because a newer decision exists.';
      }
      case 'PET_UPDATE_EMPTY': {
        return 'Change at least one field before saving.';
      }
      case 'PET_MATCH_ALREADY_REVIEWED': {
        return 'That suggestion was already reviewed. The current queue has been refreshed.';
      }
      case 'PET_MATCH_SUGGESTION_NOT_FOUND': {
        return 'That suggestion is no longer in the review queue.';
      }
      case 'PET_MATCH_UNKNOWN_NOT_FOUND': {
        return 'That animal detection is no longer in the Unknown queue.';
      }
      case 'PET_MATCH_PET_NOT_FOUND': {
        return 'That Pet is no longer available. Choose another Pet or create a new one.';
      }
      case 'PET_MATCH_SPECIES_CONFLICT': {
        return 'Choose a Pet with the same detected species. If the detector is wrong, dismiss this detection instead.';
      }
      default: {
        return `The local service declined this action (${value.code}).`;
      }
    }
  };

  const petCoverStyle = (pet: CimmichPet) => {
    if (!pet.cover?.sourceAssetId) {
      return '';
    }
    const image = `background-image: url("${getAssetMediaUrl({ id: pet.cover.sourceAssetId, size: AssetMediaSize.Preview })}")`;
    const crop = pet.cover.crop;
    if (!crop) {
      return `${image}; background-size: cover; background-position: center`;
    }
    const positionX = crop.w >= 1 ? 50 : (crop.x / Math.max(0.0001, 1 - crop.w)) * 100;
    const positionY = crop.h >= 1 ? 50 : (crop.y / Math.max(0.0001, 1 - crop.h)) * 100;
    return `${image}; background-size: ${100 / crop.w}% ${100 / crop.h}%; background-position: ${positionX}% ${positionY}%`;
  };

  const mediaBackgroundStyle = (sourceAssetId: string, crop: NonNullable<CimmichPet['cover']>['crop'] = null) => {
    const image = `background-image: url("${getAssetMediaUrl({ id: sourceAssetId, size: AssetMediaSize.Preview })}")`;
    if (!crop) {
      return `${image}; background-size: cover; background-position: center`;
    }
    const positionX = crop.w >= 1 ? 50 : (crop.x / Math.max(0.0001, 1 - crop.w)) * 100;
    const positionY = crop.h >= 1 ? 50 : (crop.y / Math.max(0.0001, 1 - crop.h)) * 100;
    return `${image}; background-size: ${100 / crop.w}% ${100 / crop.h}%; background-position: ${positionX}% ${positionY}%`;
  };

  // frameAspect must match the frame this style is painted into: 1 for the
  // circular portraits, 12/5 for the hero banner. A mismatched aspect scales the
  // background axes unequally and distorts the animal.
  const petVisualStyle = (pet: CimmichPet, frameAspect = 1) => {
    if (pet.cover?.sourceAssetId) {
      return petCoverStyle(pet);
    }
    const preview = petPreviewMedia[pet.petId];
    return preview?.sourceAssetId
      ? mediaBackgroundStyle(preview.sourceAssetId, getPetMediaFocusCrop(preview, frameAspect))
      : '';
  };

  const petPresentationImageUrl = (media: CimmichPersonPresentationMedia | null | undefined) =>
    media?.sourceAssetId ? getAssetMediaUrl({ id: media.sourceAssetId, size: AssetMediaSize.Preview }) : '';

  const petPresentationTargetAspect: Record<CimmichPetPresentationSlot, number> = {
    face: 1,
    hero: 12 / 5,
  };

  const petPresentationBaseCrop = (
    slotKind: CimmichPetPresentationSlot,
    media: CimmichPersonPresentationMedia | null,
  ) => {
    const sourceAspect = media?.width && media.height ? media.width / media.height : 1;
    const targetAspect = petPresentationTargetAspect[slotKind];
    return sourceAspect > targetAspect
      ? { h: 1, w: targetAspect / sourceAspect }
      : { h: sourceAspect / targetAspect, w: 1 };
  };

  const petPresentationFrameFromCrop = (
    slotKind: CimmichPetPresentationSlot,
    media: CimmichPersonPresentationMedia | null,
  ): PetPresentationFrame => {
    const crop = media?.crop ?? null;
    if (!crop) {
      const source = petMedia.find((item) => item.asset_id === media?.assetId);
      const face = source?.pet_face;
      const body = source?.pet_body;
      const focus = face ?? body;
      return {
        centerX: focus ? Math.max(0, Math.min(100, (focus.box_x + focus.box_w / 2) * 100)) : 50,
        centerY: focus ? Math.max(0, Math.min(100, (focus.box_y + focus.box_h / 2) * 100)) : 50,
        zoom: 1,
      };
    }
    const base = petPresentationBaseCrop(slotKind, media);
    return {
      centerX: Math.max(0, Math.min(100, (crop.x + crop.w / 2) * 100)),
      centerY: Math.max(0, Math.min(100, (crop.y + crop.h / 2) * 100)),
      zoom: Math.max(1, Math.min(4, Math.max(base.w / crop.w, base.h / crop.h))),
    };
  };

  const syncPetPresentationFrames = (presentation: CimmichPetPresentation) => {
    petPresentationFrames = {
      face: petPresentationFrameFromCrop('face', presentation.face),
      hero: petPresentationFrameFromCrop('hero', presentation.hero),
    };
  };

  const petPresentationCropFromFrame = (
    slotKind: CimmichPetPresentationSlot,
    media: CimmichPersonPresentationMedia | null,
  ) => {
    const frame = petPresentationFrames[slotKind];
    const base = petPresentationBaseCrop(slotKind, media);
    const w = base.w / frame.zoom;
    const h = base.h / frame.zoom;
    return {
      h,
      w,
      x: Math.max(0, Math.min(1 - w, frame.centerX / 100 - w / 2)),
      y: Math.max(0, Math.min(1 - h, frame.centerY / 100 - h / 2)),
    };
  };

  const petPresentationImageStyle = (
    slotKind: CimmichPetPresentationSlot,
    media: CimmichPersonPresentationMedia | null,
  ) => {
    if (!media) {
      return '';
    }
    const crop = petPresentationCropFromFrame(slotKind, media);
    return [
      'position: absolute',
      `width: ${100 / crop.w}%`,
      'height: auto',
      'max-width: none',
      `left: ${(-crop.x / crop.w) * 100}%`,
      `top: ${(-crop.y / crop.h) * 100}%`,
    ].join('; ');
  };

  const adjustPetPresentationFrame = (slotKind: CimmichPetPresentationSlot, delta: Partial<PetPresentationFrame>) => {
    const frame = petPresentationFrames[slotKind];
    petPresentationFrames = {
      ...petPresentationFrames,
      [slotKind]: {
        centerX: Math.max(0, Math.min(100, frame.centerX + (delta.centerX ?? 0))),
        centerY: Math.max(0, Math.min(100, frame.centerY + (delta.centerY ?? 0))),
        zoom: Math.max(1, Math.min(4, frame.zoom + (delta.zoom ?? 0))),
      },
    };
  };

  const startPetPresentationDrag = (event: PointerEvent, slotKind: CimmichPetPresentationSlot) => {
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    petPresentationDrag = { pointerId: event.pointerId, slotKind, x: event.clientX, y: event.clientY };
  };

  const movePetPresentationDrag = (event: PointerEvent, slotKind: CimmichPetPresentationSlot) => {
    if (
      !petPresentationDrag ||
      petPresentationDrag.pointerId !== event.pointerId ||
      petPresentationDrag.slotKind !== slotKind
    ) {
      return;
    }
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const frame = petPresentationFrames[slotKind];
    adjustPetPresentationFrame(slotKind, {
      centerX: (-(event.clientX - petPresentationDrag.x) / Math.max(1, bounds.width) / frame.zoom) * 100,
      centerY: (-(event.clientY - petPresentationDrag.y) / Math.max(1, bounds.height) / frame.zoom) * 100,
    });
    petPresentationDrag = { ...petPresentationDrag, x: event.clientX, y: event.clientY };
  };

  const endPetPresentationDrag = (event: PointerEvent) => {
    if (petPresentationDrag?.pointerId === event.pointerId) {
      petPresentationDrag = undefined;
    }
  };

  const zoomPetPresentation = (event: WheelEvent, slotKind: CimmichPetPresentationSlot) => {
    event.preventDefault();
    adjustPetPresentationFrame(slotKind, { zoom: event.deltaY < 0 ? 0.15 : -0.15 });
  };

  const keyPetPresentation = (event: KeyboardEvent, slotKind: CimmichPetPresentationSlot) => {
    const step = event.shiftKey ? 5 : 2;
    const delta: Record<string, Partial<PetPresentationFrame>> = {
      '+': { zoom: 0.1 },
      '-': { zoom: -0.1 },
      '=': { zoom: 0.1 },
      ArrowDown: { centerY: step },
      ArrowLeft: { centerX: -step },
      ArrowRight: { centerX: step },
      ArrowUp: { centerY: -step },
    };
    if (!delta[event.key]) {
      return;
    }
    event.preventDefault();
    adjustPetPresentationFrame(slotKind, delta[event.key]);
  };

  const formatCaptureDate = (value: string | null) => {
    if (!value) {
      return 'Date unavailable';
    }
    return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(
      new Date(value),
    );
  };

  const cropForEditor = () => {
    if (!coverEditorMedia) {
      return null;
    }
    const sourceAspect = Math.max(0.01, coverEditorMedia.width / Math.max(1, coverEditorMedia.height));
    const targetAspect = 4 / 3;
    const base =
      sourceAspect > targetAspect ? { h: 1, w: targetAspect / sourceAspect } : { h: sourceAspect / targetAspect, w: 1 };
    const w = base.w / coverZoom;
    const h = base.h / coverZoom;
    return {
      h,
      w,
      x: (Math.max(0, 1 - w) * coverFocusX) / 100,
      y: (Math.max(0, 1 - h) * coverFocusY) / 100,
    };
  };

  const coverEditorStyle = () => {
    if (!coverEditorMedia) {
      return '';
    }
    const crop = cropForEditor();
    if (!crop) {
      return mediaBackgroundStyle(coverEditorMedia.sourceAssetId);
    }
    const positionX = crop.w >= 1 ? 50 : (crop.x / Math.max(0.0001, 1 - crop.w)) * 100;
    const positionY = crop.h >= 1 ? 50 : (crop.y / Math.max(0.0001, 1 - crop.h)) * 100;
    return `background-image: url("${getAssetMediaUrl({ id: coverEditorMedia.sourceAssetId, size: AssetMediaSize.Preview })}"); background-size: ${100 / crop.w}% ${100 / crop.h}%; background-position: ${positionX}% ${positionY}%`;
  };

  const loadPetPreviews = async (items: CimmichPet[], generation: number) => {
    const missing = items.filter((pet) => !pet.cover?.sourceAssetId && !petPreviewMedia[pet.petId]).slice(0, 24);
    const results = await Promise.allSettled(
      missing.map(async (pet) => {
        const media = await getCimmichPetMedia(pet.petId, 1);
        return { media: media[0], petId: pet.petId };
      }),
    );
    if (generation !== petsLoadGeneration) {
      return;
    }
    const next = { ...petPreviewMedia };
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.media) {
        next[result.value.petId] = result.value.media;
      }
    }
    petPreviewMedia = next;
  };

  const loadPets = async (selectedPetId: string | null, selectedPetName = '') => {
    const generation = ++petsLoadGeneration;
    loaded = false;
    error = null;
    pets = [];
    petPreviewMedia = {};
    try {
      const nextPets = await getCimmichPets({ limit: 500 });
      if (generation !== petsLoadGeneration) {
        return;
      }
      pets = nextPets;
      void loadPetPreviews(nextPets, generation);
      const name = selectedPetName.trim().toLocaleLowerCase();
      const nextSelectedPet =
        (selectedPetId ? nextPets.find((pet) => pet.petId === selectedPetId) : undefined) ||
        (name ? nextPets.find((pet) => pet.displayName.trim().toLocaleLowerCase() === name) : undefined) ||
        null;
      selectedPet = nextSelectedPet;
      petMediaSelectionMode = false;
      selectedPetMediaIds = [];
      return nextSelectedPet;
    } catch (error_) {
      if (generation !== petsLoadGeneration) {
        return;
      }
      error = asServiceError(error_);
      return null;
    } finally {
      if (generation === petsLoadGeneration) {
        loaded = true;
      }
    }
  };

  const loadMedia = async (pet: CimmichPet) => {
    const generation = ++mediaLoadGeneration;
    mediaLoaded = false;
    mediaError = null;
    petMedia = [];
    try {
      const [nextMedia, nextPresentation] = await Promise.all([
        getCimmichPetMedia(pet.petId),
        getCimmichPetPresentation(pet.petId),
      ]);
      if (generation !== mediaLoadGeneration || selectedPet?.petId !== pet.petId) {
        return;
      }
      petMedia = nextMedia;
      petPresentation = nextPresentation;
      syncPetPresentationFrames(nextPresentation);
      if (nextMedia[0]) {
        petPreviewMedia = { ...petPreviewMedia, [pet.petId]: nextMedia[0] };
      }
    } catch (error_) {
      if (generation !== mediaLoadGeneration) {
        return;
      }
      mediaError = asServiceError(error_);
    } finally {
      if (generation === mediaLoadGeneration) {
        mediaLoaded = true;
      }
    }
  };

  const petMediaSelected = (assetId: string) => selectedPetMediaIds.includes(assetId);

  const togglePetMediaSelection = (assetId: string) => {
    if (petMediaSelected(assetId)) {
      selectedPetMediaIds = selectedPetMediaIds.filter((id) => id !== assetId);
      return;
    }
    if (selectedPetMediaIds.length >= ENTITY_MEDIA_SELECTION_LIMIT) {
      toastManager.warning(`Maximum ${ENTITY_MEDIA_SELECTION_LIMIT} photos. Apply or clear this selection first.`);
      return;
    }
    selectedPetMediaIds = [...selectedPetMediaIds, assetId];
  };

  const selectShownPetMedia = () => {
    selectedPetMediaIds = petMedia.slice(0, ENTITY_MEDIA_SELECTION_LIMIT).map(({ asset_id }) => asset_id);
    if (petMedia.length > ENTITY_MEDIA_SELECTION_LIMIT) {
      toastManager.warning(`Maximum ${ENTITY_MEDIA_SELECTION_LIMIT} photos selected. Apply these before continuing.`);
    }
  };

  const refreshSelectedPetMedia = async () => {
    if (selectedPet) {
      await loadMedia(selectedPet);
    }
  };

  const loadPetMatches = async (pet: CimmichPet) => {
    const generation = ++petMatchesLoadGeneration;
    petMatchesLoaded = false;
    petMatchError = null;
    try {
      const result = await getCimmichPetMatchSuggestions(pet.petId);
      if (generation !== petMatchesLoadGeneration || selectedPet?.petId !== pet.petId) {
        return;
      }
      petMatches = result.items;
    } catch (error_) {
      if (generation !== petMatchesLoadGeneration || selectedPet?.petId !== pet.petId) {
        return;
      }
      petMatchError = asServiceError(error_);
    } finally {
      if (generation === petMatchesLoadGeneration && selectedPet?.petId === pet.petId) {
        petMatchesLoaded = true;
      }
    }
  };

  const loadUnknownPets = async () => {
    const generation = ++petUnknownLoadGeneration;
    petUnknownLoaded = false;
    petUnknownError = null;
    try {
      const result = await getCimmichPetMatchUnknown(200);
      if (generation !== petUnknownLoadGeneration) {
        return;
      }
      petUnknown = result.items;
    } catch (error_) {
      if (generation !== petUnknownLoadGeneration) {
        return;
      }
      petUnknownError = asServiceError(error_);
    } finally {
      if (generation === petUnknownLoadGeneration) {
        petUnknownLoaded = true;
      }
    }
  };

  const reviewUnknownPet = async (
    observation: CimmichPetMatchUnknown,
    action: 'assign' | 'reject',
    petId?: string,
  ): Promise<boolean> => {
    if (petUnknownReviewing) {
      return false;
    }
    const payload = { action, observationId: observation.observationId, petId: petId ?? null };
    petUnknownReviewCommand = commandFor(petUnknownReviewCommand, `pet-unknown-${action}`, payload);
    petUnknownReviewing = observation.observationId;
    petUnknownError = null;
    try {
      await reviewCimmichPetMatchUnknown(observation.observationId, action, petUnknownReviewCommand.id, petId);
      petUnknownReviewCommand = null;
      petUnknown = petUnknown.filter((item) => item.observationId !== observation.observationId);
      if (action === 'assign' && petId) {
        const pet = pets.find((item) => item.petId === petId);
        if (pet) {
          const nextPets = await getCimmichPets({ limit: 500 });
          pets = nextPets;
          void loadPetPreviews(nextPets, petsLoadGeneration);
        }
      }
      return true;
    } catch (error_) {
      petUnknownError = asServiceError(error_);
      if (
        petUnknownError.code === 'PET_MATCH_ALREADY_REVIEWED' ||
        petUnknownError.code === 'PET_MATCH_UNKNOWN_NOT_FOUND'
      ) {
        await loadUnknownPets();
      }
      return false;
    } finally {
      petUnknownReviewing = '';
    }
  };

  const resetCreateFields = (speciesKind: CimmichPetSpeciesKind | '' = '') => {
    createName = '';
    createBreedLabel = '';
    createSpeciesKind = speciesKind;
    createSpeciesLabel = '';
    createAliases = '';
    createDescription = '';
    createCommand = null;
  };

  const openUnknownAssignment = (observation: CimmichPetMatchUnknown) => {
    petUnknownAssignmentObservation = observation;
    petUnknownAssignmentMode = 'existing';
    petUnknownAssignmentPetId = '';
    petUnknownAssignmentQuery = '';
    petUnknownReviewCommand = null;
    petUnknownError = null;
    resetCreateFields(observation.speciesKind);
  };

  const closeUnknownAssignment = (force = false) => {
    if (!force && (isCreating || petUnknownReviewing)) {
      return;
    }
    petUnknownAssignmentObservation = null;
    petUnknownAssignmentPetId = '';
    petUnknownAssignmentQuery = '';
    petUnknownReviewCommand = null;
    petUnknownError = null;
  };

  const selectUnknownAssignmentMode = (mode: UnknownAssignmentMode) => {
    petUnknownAssignmentMode = mode;
    petUnknownAssignmentPetId = '';
    petUnknownError = null;
    if (mode === 'new' && petUnknownAssignmentObservation) {
      resetCreateFields(petUnknownAssignmentObservation.speciesKind);
    }
  };

  const submitUnknownAssignment = async (event: SubmitEvent) => {
    event.preventDefault();
    const observation = petUnknownAssignmentObservation;
    if (!observation || petUnknownReviewing || isCreating) {
      return;
    }

    if (petUnknownAssignmentMode === 'existing') {
      if (!petUnknownAssignmentPetId) {
        return;
      }
      if (await reviewUnknownPet(observation, 'assign', petUnknownAssignmentPetId)) {
        closeUnknownAssignment();
      }
      return;
    }

    const payload = {
      aliases: parseLabels(createAliases),
      breedLabel: createBreedLabel.trim() || null,
      description: createDescription.trim(),
      displayName: createName.trim(),
      speciesKind: observation.speciesKind,
      speciesLabel: null,
    };
    if (!payload.displayName) {
      return;
    }
    createCommand = commandFor(createCommand, 'create-from-unknown', {
      observationId: observation.observationId,
      ...payload,
    });
    isCreating = true;
    petUnknownError = null;
    try {
      const result = await createCimmichPet({ ...payload, commandId: createCommand.id });
      pets = [...pets.filter((pet) => pet.petId !== result.pet.petId), result.pet].sort((left, right) =>
        left.displayName.localeCompare(right.displayName),
      );
      if (await reviewUnknownPet(observation, 'assign', result.pet.petId)) {
        createCommand = null;
        closeUnknownAssignment(true);
      }
    } catch (error_) {
      petUnknownError = asServiceError(error_);
    } finally {
      isCreating = false;
    }
  };

  const reviewPetMatch = async (suggestion: CimmichPetMatchSuggestion, action: 'confirm' | 'reject') => {
    if (!selectedPet || petMatchReviewing) {
      return;
    }
    petMatchReviewing = suggestion.suggestionId;
    petMatchError = null;
    try {
      await reviewCimmichPetMatch(suggestion.suggestionId, action, createCimmichCommandId(`pet-match-${action}`));
      petMatches = petMatches.filter((item) => item.suggestionId !== suggestion.suggestionId);
      if (action === 'confirm') {
        await loadMedia(selectedPet);
      }
    } catch (error_) {
      petMatchError = asServiceError(error_);
      if (
        petMatchError.code === 'PET_MATCH_ALREADY_REVIEWED' ||
        petMatchError.code === 'PET_MATCH_SUGGESTION_NOT_FOUND'
      ) {
        await loadPetMatches(selectedPet);
      }
    } finally {
      petMatchReviewing = '';
    }
  };

  const openPet = (pet: CimmichPet) => {
    selectedPet = pet;
    activePetContent = 'photos';
    isEditingAbout = false;
    aboutCommand = null;
    showEdit = false;
    petPresentation = undefined;
    petPresentationPickerSlot = '';
    undoReceipt = null;
    attachCommand = null;
    archiveCommand = null;
    mediaCommand = null;
    undoCommand = null;
    const href = getPetDetailHref(page.url, pet.petId, pet.displayName);
    if (`${page.url.pathname}${page.url.search}` === href) {
      void loadMedia(pet);
      void loadPetMatches(pet);
    } else {
      void goto(href);
    }
  };

  const selectPetContent = (view: PetContentView) => {
    activePetContent = view;
    const href = getPetContentHref(page.url, view);
    if (`${page.url.pathname}${page.url.search}` !== href) {
      void goto(href, { keepFocus: true, noScroll: true, replaceState: true });
    }
  };

  const handlePetContentKeydown = (event: KeyboardEvent, current: PetContentView) => {
    const target = getPetContentKeyboardTarget(current, event.key);
    if (!target) {
      return;
    }

    event.preventDefault();
    selectPetContent(target);
    requestAnimationFrame(() => {
      ({
        connections: connectionsTab,
        details: detailsTab,
        display: displayTab,
        documents: documentsTab,
        photos: photosTab,
        review: reviewTab,
      })[target]?.focus();
    });
  };

  const connectionGroupIcon = (kind: 'event' | 'object' | 'place') =>
    kind === 'event' ? mdiCalendarBlankOutline : kind === 'place' ? mdiMapMarkerOutline : mdiPackageVariantClosed;

  const closePet = () => {
    selectedPet = null;
    activePetContent = 'photos';
    isEditingAbout = false;
    aboutCommand = null;
    petMedia = [];
    petMatches = [];
    petMatchesLoaded = false;
    petMatchError = null;
    petPresentation = undefined;
    petPresentationPickerSlot = '';
    mediaError = null;
    undoReceipt = null;
    archiveCommand = null;
    mediaCommand = null;
    undoCommand = null;
    if (page.url.searchParams.has('entityId')) {
      void goto(getPetCollectionHref(page.url), { replaceState: true });
    }
  };

  const beginCreate = () => {
    resetCreateFields();
    error = null;
    showCreate = true;
  };

  const submitCreate = async (event: SubmitEvent) => {
    event.preventDefault();
    const payload = {
      aliases: parseLabels(createAliases),
      breedLabel: createBreedLabel.trim() || null,
      description: createDescription.trim(),
      displayName: createName.trim(),
      speciesKind: createSpeciesKind || null,
      speciesLabel: createSpeciesKind === 'other' ? createSpeciesLabel.trim() || null : null,
    };
    createCommand = commandFor(createCommand, 'create', payload);
    isCreating = true;
    error = null;
    try {
      const result = await createCimmichPet({ ...payload, commandId: createCommand.id });
      pets = [...pets.filter((pet) => pet.petId !== result.pet.petId), result.pet].sort((left, right) =>
        left.displayName.localeCompare(right.displayName),
      );
      showCreate = false;
      openPet(result.pet);
    } catch (error_) {
      error = asServiceError(error_);
    } finally {
      isCreating = false;
    }
  };

  const beginEdit = () => {
    if (!selectedPet) {
      return;
    }
    updateName = selectedPet.displayName;
    updateBreedLabel = selectedPet.breedLabel || '';
    updateSpeciesKind = selectedPet.speciesKind || '';
    updateSpeciesLabel = selectedPet.speciesLabel || '';
    updateAliases = selectedPet.aliases.join(', ');
    updateDescription = selectedPet.description;
    updateCommand = null;
    error = null;
    showEdit = true;
  };

  const submitUpdate = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!selectedPet) {
      return;
    }
    const payload = {
      aliases: parseLabels(updateAliases),
      breedLabel: updateBreedLabel.trim() || null,
      description: updateDescription.trim(),
      displayName: updateName.trim(),
      speciesKind: updateSpeciesKind || null,
      speciesLabel: updateSpeciesKind === 'other' ? updateSpeciesLabel.trim() || null : null,
    };
    updateCommand = commandFor(updateCommand, 'update', { petId: selectedPet.petId, ...payload });
    isUpdating = true;
    error = null;
    try {
      const result = await updateCimmichPet(selectedPet.petId, { ...payload, commandId: updateCommand.id });
      selectedPet = result.pet;
      pets = pets.map((pet) => (pet.petId === result.pet.petId ? result.pet : pet));
      showEdit = false;
    } catch (error_) {
      error = asServiceError(error_);
    } finally {
      isUpdating = false;
    }
  };

  const beginAboutEdit = () => {
    if (!selectedPet) {
      return;
    }
    aboutDescription = selectedPet.description;
    aboutCommand = null;
    error = null;
    isEditingAbout = true;
    requestAnimationFrame(() => aboutInput?.focus());
  };

  const cancelAboutEdit = () => {
    isEditingAbout = false;
    aboutCommand = null;
    error = null;
  };

  const submitAbout = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!selectedPet) {
      return;
    }
    const payload = { description: aboutDescription.trim(), petId: selectedPet.petId };
    aboutCommand = commandFor(aboutCommand, 'about', payload);
    isUpdating = true;
    error = null;
    try {
      const result = await updateCimmichPet(selectedPet.petId, {
        commandId: aboutCommand.id,
        description: payload.description,
      });
      selectedPet = result.pet;
      pets = pets.map((pet) => (pet.petId === result.pet.petId ? result.pet : pet));
      isEditingAbout = false;
      aboutCommand = null;
    } catch (error_) {
      error = asServiceError(error_);
    } finally {
      isUpdating = false;
    }
  };

  const archivePet = async () => {
    if (!selectedPet || !confirm(`Hide ${selectedPet.displayName}? Their manual evidence stays intact.`)) {
      return;
    }
    archiveCommand = commandFor(archiveCommand, 'archive', { petId: selectedPet.petId, status: 'hidden' });
    isUpdating = true;
    error = null;
    try {
      await updateCimmichPet(selectedPet.petId, { commandId: archiveCommand.id, status: 'hidden' });
      archiveCommand = null;
      pets = pets.filter((pet) => pet.petId !== selectedPet?.petId);
      closePet();
    } catch (error_) {
      error = asServiceError(error_);
    } finally {
      isUpdating = false;
    }
  };

  const getMediaActions = (item: CimmichPetMedia): ActionItem[] => [
    {
      title: petPresentation?.face?.assetId === item.asset_id ? 'Current profile photo' : 'Use as profile photo',
      icon: mdiCrop,
      onAction: () => void choosePetPresentation('face', item),
    },
    {
      title: petPresentation?.hero?.assetId === item.asset_id ? 'Current hero photo' : 'Use as hero photo',
      icon: mdiImageEditOutline,
      onAction: () => void choosePetPresentation('hero', item),
    },
    {
      title: 'Remove from Pet',
      icon: mdiLinkOff,
      color: 'danger',
      onAction: () => detachMedia(item),
    },
  ];

  const changeMedia = async (assetIds: string[], selected: boolean): Promise<boolean> => {
    if (!selectedPet || assetIds.length === 0) {
      return false;
    }
    const payload = { assetIds, petId: selectedPet.petId, selected };
    const command = commandFor(selected ? attachCommand : mediaCommand, selected ? 'attach' : 'detach', payload);
    if (selected) {
      attachCommand = command;
    } else {
      mediaCommand = command;
    }
    isMutating = true;
    mediaError = null;
    try {
      const result = await setCimmichPetMedia(selectedPet.petId, {
        assetIds,
        commandId: command.id,
        selected,
      });
      selectedPet = result.pet;
      pets = pets.map((pet) => (pet.petId === result.pet.petId ? result.pet : pet));
      attachCommand = null;
      mediaCommand = null;
      undoReceipt = result.undo?.eligible ? { decisionId: result.decisionId, petName: result.pet.displayName } : null;
      undoCommand = null;
      await loadMedia(result.pet);
      return true;
    } catch (error_) {
      mediaError = asServiceError(error_);
      return false;
    } finally {
      isMutating = false;
    }
  };

  const detachMedia = async (item: CimmichPetMedia) => {
    await changeMedia([item.asset_id], false);
  };

  const loadLibraryAssets = async () => {
    const generation = ++libraryLoadGeneration;
    isLoadingLibrary = true;
    pickerError = '';
    try {
      const result = await searchAssets({ metadataSearchDto: { size: 80, withExif: true } });
      const recent = result.assets.items.filter((asset) => !asset.isTrashed && !asset.isOffline);
      const visible = await filterVisibleCimmichAssets(recent, getCimmichAssetEvidence);
      if (generation !== libraryLoadGeneration) {
        return;
      }
      libraryAssets = visible;
    } catch {
      if (generation !== libraryLoadGeneration) {
        return;
      }
      pickerError = 'Your photo library could not be loaded. No Pet evidence has changed.';
    } finally {
      if (generation === libraryLoadGeneration) {
        isLoadingLibrary = false;
      }
    }
  };

  const openMediaPicker = () => {
    pickerSelectedIds = [];
    libraryQuery = '';
    pickerError = '';
    showMediaPicker = true;
    if (libraryAssets.length === 0) {
      void loadLibraryAssets();
    }
  };

  const togglePickerAsset = (sourceAssetId: string) => {
    if (attachedSourceIds.has(sourceAssetId)) {
      return;
    }
    pickerSelectedIds = pickerSelectedIds.includes(sourceAssetId)
      ? pickerSelectedIds.filter((id) => id !== sourceAssetId)
      : pickerSelectedIds.length < 100
        ? [...pickerSelectedIds, sourceAssetId]
        : pickerSelectedIds;
  };

  const attachSelectedLibraryMedia = async () => {
    if (pickerSelectedIds.length === 0) {
      return;
    }
    pickerError = '';
    isMutating = true;
    const resolved = await Promise.allSettled(
      pickerSelectedIds.map((sourceAssetId) => getCimmichAssetEvidence(sourceAssetId)),
    );
    const assetIds = resolved.flatMap((result) => (result.status === 'fulfilled' ? [result.value.asset_id] : []));
    const unavailable = resolved.length - assetIds.length;
    isMutating = false;
    if (unavailable > 0) {
      pickerError =
        'One or more selected photos are no longer available in this viewing mode. Refresh the picker and try again.';
      return;
    }
    if (await changeMedia(assetIds, true)) {
      showMediaPicker = false;
      pickerSelectedIds = [];
    }
  };

  const openCoverEditor = (item: CimmichPetMedia) => {
    coverEditorMedia = item;
    coverZoom = 1;
    coverFocusX = 50;
    coverFocusY = 50;
    const crop = selectedPet?.cover?.assetId === item.asset_id ? selectedPet.cover.crop : null;
    if (crop) {
      const sourceAspect = Math.max(0.01, item.width / Math.max(1, item.height));
      const targetAspect = 4 / 3;
      const baseWidth = sourceAspect > targetAspect ? targetAspect / sourceAspect : 1;
      coverZoom = Math.min(3, Math.max(1, baseWidth / Math.max(0.0001, crop.w)));
      coverFocusX = crop.w >= 1 ? 50 : Math.min(100, Math.max(0, (crop.x / (1 - crop.w)) * 100));
      coverFocusY = crop.h >= 1 ? 50 : Math.min(100, Math.max(0, (crop.y / (1 - crop.h)) * 100));
    }
    coverCommand = null;
    showCoverEditor = true;
  };

  const chooseCoverMedia = (item: CimmichPetMedia) => {
    showCoverPicker = false;
    openCoverEditor(item);
  };

  const saveCover = async () => {
    if (!selectedPet || !coverEditorMedia) {
      return;
    }
    const payload = {
      coverAssetId: coverEditorMedia.asset_id,
      coverCrop: cropForEditor(),
      petId: selectedPet.petId,
    };
    coverCommand = commandFor(coverCommand, 'cover', payload);
    isUpdating = true;
    error = null;
    try {
      const result = await updateCimmichPet(selectedPet.petId, {
        commandId: coverCommand.id,
        coverAssetId: payload.coverAssetId,
        coverCrop: payload.coverCrop,
      });
      selectedPet = result.pet;
      pets = pets.map((pet) => (pet.petId === result.pet.petId ? result.pet : pet));
      showCoverEditor = false;
      coverCommand = null;
    } catch (error_) {
      error = asServiceError(error_);
    } finally {
      isUpdating = false;
    }
  };

  const petPresentationEvidence = (item: CimmichPetMedia) => {
    if (item.pet_face) {
      return { observationId: item.pet_face.face_id, observationKind: 'face' as const };
    }
    if (item.pet_body) {
      return { observationId: item.pet_body.body_id, observationKind: 'body' as const };
    }
    if (item.association_types.includes('presence')) {
      return { observationId: null, observationKind: 'presence' as const };
    }
    return null;
  };

  const choosePetPresentation = async (slotKind: CimmichPetPresentationSlot, item: CimmichPetMedia) => {
    if (!selectedPet) {
      return;
    }
    const evidence = petPresentationEvidence(item);
    if (!evidence) {
      return;
    }
    petPresentationSaving = slotKind;
    mediaError = null;
    try {
      petPresentation = await setCimmichPetPresentation(selectedPet.petId, slotKind, {
        assetId: item.asset_id,
        crop: slotKind === 'face' ? getPetMediaFocusCrop(item) : null,
        ...evidence,
      });
      syncPetPresentationFrames(petPresentation);
      petPresentationPickerSlot = '';
    } catch (error_) {
      mediaError = asServiceError(error_);
    } finally {
      petPresentationSaving = '';
    }
  };

  const savePetPresentationFrame = async (slotKind: CimmichPetPresentationSlot) => {
    if (!selectedPet) {
      return;
    }
    const media = petPresentation?.[slotKind] ?? null;
    if (!media) {
      return;
    }
    petPresentationSaving = slotKind;
    mediaError = null;
    try {
      petPresentation = await setCimmichPetPresentation(selectedPet.petId, slotKind, {
        assetId: media.assetId,
        crop: petPresentationCropFromFrame(slotKind, media),
        observationId: media.observationId,
        observationKind: media.observationKind,
      });
      syncPetPresentationFrames(petPresentation);
    } catch (error_) {
      mediaError = asServiceError(error_);
    } finally {
      petPresentationSaving = '';
    }
  };

  const clearPetPresentation = async (slotKind: CimmichPetPresentationSlot) => {
    if (!selectedPet) {
      return;
    }
    petPresentationSaving = slotKind;
    mediaError = null;
    try {
      petPresentation = await setCimmichPetPresentation(selectedPet.petId, slotKind, { assetId: null });
      syncPetPresentationFrames(petPresentation);
    } catch (error_) {
      mediaError = asServiceError(error_);
    } finally {
      petPresentationSaving = '';
    }
  };

  const undoLastMediaChange = async () => {
    if (!undoReceipt || !selectedPet) {
      return;
    }
    undoCommand = commandFor(undoCommand, 'undo', { decisionId: undoReceipt.decisionId });
    isMutating = true;
    mediaError = null;
    try {
      const result = await undoCimmichPetDecision(undoReceipt.decisionId, undoCommand.id);
      selectedPet = result.pet;
      pets = pets.map((pet) => (pet.petId === result.pet.petId ? result.pet : pet));
      undoReceipt = null;
      undoCommand = null;
      await loadMedia(result.pet);
    } catch (error_) {
      mediaError = asServiceError(error_);
    } finally {
      isMutating = false;
    }
  };

  $effect(() => {
    const visibilityVersion = cimmichVisibilityManager.version;
    const petId = requestedPetId;
    const petName = requestedPetName;
    if (visibilityVersion >= 0) {
      untrack(() => {
        mediaLoadGeneration += 1;
        petMedia = [];
        petMatches = [];
        petMatchesLoaded = false;
        petMatchError = null;
        libraryAssets = [];
        pickerSelectedIds = [];
        if (showMediaPicker) {
          void loadLibraryAssets();
        }
        if (!petId && !petName) {
          selectedPet = null;
        }
        void loadPets(petId, petName).then((pet) => {
          if (pet) {
            void loadMedia(pet);
            void loadPetMatches(pet);
          } else {
            void loadUnknownPets();
          }
        });
      });
    }
  });
</script>

<UserPageLayout>
  <div class="mx-auto flex w-full max-w-7xl flex-col gap-3 p-4 text-immich-fg sm:p-5 dark:text-immich-dark-fg">
    {#if !selectedPet}
      <CimmichSectionHeader
        icon={mdiPawOutline}
        title="Pets"
        meta={loaded
          ? `${pets.length.toLocaleString()} ${pets.length === 1 ? 'pet' : 'pets'}`
          : 'Loading current projection'}
      >
        {#snippet actions()}
          <div
            class="flex min-h-11 w-full max-w-full items-center overflow-x-auto rounded-xl bg-gray-100 p-1 sm:w-auto dark:bg-immich-dark-gray"
            role="toolbar"
            aria-label="Pet views and categories"
          >
            {#each petViewModes as mode (mode.id)}
              <button
                class={[
                  'inline-flex h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:gap-1.5 sm:px-3 sm:text-sm',
                  petViewMode === mode.id
                    ? 'bg-white text-primary shadow-sm dark:bg-black/25 dark:text-immich-dark-primary'
                    : 'text-gray-500 hover:text-immich-fg dark:text-gray-400 dark:hover:text-immich-dark-fg',
                ]}
                type="button"
                aria-pressed={petViewMode === mode.id}
                onclick={() => (petViewMode = mode.id)}
              >
                {mode.label}
                <span class="text-xs opacity-65">
                  {mode.id === 'pets' ? pets.length : petUnknownLoaded ? petUnknown.length : ''}
                </span>
              </button>
              {#if mode.id === 'pets'}
                <span class="mx-1 h-6 w-px shrink-0 bg-gray-300 dark:bg-gray-600" aria-hidden="true"></span>
              {/if}
            {/each}
          </div>
          <label
            class="flex h-11 w-full min-w-0 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm focus-within:border-primary sm:w-56 lg:w-64 dark:border-immich-dark-gray dark:bg-immich-dark-bg"
          >
            <Icon icon={mdiMagnify} size="18" class="text-gray-500" />
            <input
              bind:value={query}
              class="min-w-0 flex-1 bg-transparent outline-none"
              placeholder="Search pets and aliases"
              type="search"
            />
          </label>
          <div
            class="flex min-w-max items-center overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-immich-dark-gray dark:bg-immich-dark-bg"
            aria-label="Pet view options"
          >
            <Tooltip text={`Sort pets — ${sortLabel}`}>
              {#snippet child({ props })}
                <ContextMenuButton
                  {...props}
                  class="size-10"
                  icon={mdiSortVariant}
                  items={sortActions}
                  position="top-right"
                  aria-label={`Sort pets. Current: ${sortLabel}`}
                />
              {/snippet}
            </Tooltip>
            <label
              class="relative inline-flex size-10 cursor-pointer items-center justify-center border-l border-gray-200 text-gray-500 transition hover:bg-gray-100 hover:text-gray-950 dark:border-immich-dark-gray dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
              title="Thumbnail size"
            >
              <Icon icon={mdiViewGridOutline} size="19" />
              <select
                class="absolute inset-0 size-full cursor-pointer opacity-0"
                bind:value={petThumbnailSize}
                aria-label="Thumbnail size"
              >
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
              </select>
            </label>
          </div>
          <button
            class="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white shadow-sm hover:bg-primary/90"
            type="button"
            onclick={beginCreate}
          >
            <Icon icon={mdiPlus} size="18" />
            Add pet
          </button>
        {/snippet}
      </CimmichSectionHeader>
    {/if}

    {#if relatedPetIds.size > 0 && !selectedPet}
      <div
        class="flex items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm"
      >
        <span><strong>Related to {relatedFrom || 'this connection'}</strong> · {visiblePets.length} shown</span>
        <a class="rounded-full px-3 py-2 font-semibold text-primary hover:bg-primary/10" href="/cimmich/pets"
          >Show all</a
        >
      </div>
    {/if}

    {#if error && !showCreate && !showEdit}
      <div
        class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
        role="alert"
      >
        <span>{errorCopy(error)}</span>
        <button
          class="rounded-md border border-current px-3 py-1.5 font-semibold"
          type="button"
          onclick={() => void loadPets(requestedPetId)}
        >
          Retry
        </button>
      </div>
    {/if}

    {#if selectedPet}
      <section class="min-w-0" data-testid="cimmich-pet-detail">
        <div class="flex min-w-0 flex-col gap-5">
          <section
            class="relative min-h-100 overflow-hidden rounded-[1.75rem] bg-slate-950 text-white shadow-2xl ring-1 ring-white/10"
            data-testid="cimmich-pet-hero"
          >
            {#if petPresentation?.hero}
              <span
                class="absolute inset-x-0 top-0 block aspect-12/5 overflow-hidden"
                data-testid="cimmich-pet-hero-photo-frame"
                aria-hidden="true"
              >
                <img
                  class="max-w-none"
                  src={petPresentationImageUrl(petPresentation.hero)}
                  style={petPresentationImageStyle('hero', petPresentation.hero)}
                  alt=""
                />
              </span>
            {:else if petVisualStyle(selectedPet, 12 / 5)}
              <span
                class="absolute inset-0 block bg-cover bg-center"
                style={petVisualStyle(selectedPet, 12 / 5)}
                aria-hidden="true"
              ></span>
            {:else}
              <span
                class="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgb(91_80_125),rgb(30_41_59)_58%,rgb(2_6_23))]"
                aria-hidden="true"
              ></span>
            {/if}
            <div class="absolute inset-0 bg-linear-to-r from-black/92 via-black/60 to-black/18"></div>
            <div class="absolute inset-0 bg-linear-to-t from-black/92 via-transparent to-black/45"></div>

            <button
              class="absolute top-5 left-5 z-10 inline-flex min-h-10 items-center gap-2 rounded-full border border-white/15 bg-black/35 px-3 text-sm font-semibold text-white/80 backdrop-blur-md transition hover:bg-black/55 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:top-7 sm:left-7"
              type="button"
              onclick={closePet}
            >
              <Icon icon={mdiArrowLeft} size="16" />
              Pets
            </button>

            <button
              class="absolute top-5 right-5 z-10 inline-flex size-9 items-center justify-center rounded-full border border-white/20 bg-black/35 text-white/80 shadow-lg backdrop-blur-md transition hover:bg-black/55 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:top-7 sm:right-7"
              type="button"
              data-testid="cimmich-pet-display-shortcut"
              onclick={() => selectPetContent('display')}
              aria-label="Edit display photos"
              title="Edit display photos"
            >
              <Icon icon={mdiPencilOutline} size="16" />
            </button>

            <div
              class="relative flex min-h-100 min-w-0 flex-col justify-end gap-5 px-5 pt-20 pb-5 sm:flex-row sm:items-end sm:p-7 lg:p-8"
            >
              {#if petPresentation?.face}
                <span
                  class="relative block size-28 shrink-0 overflow-hidden rounded-full bg-slate-700 shadow-2xl ring-4 ring-white/90 sm:size-32"
                  aria-label={selectedPet.displayName}
                >
                  <img
                    class="max-w-none"
                    src={petPresentationImageUrl(petPresentation.face)}
                    style={petPresentationImageStyle('face', petPresentation.face)}
                    alt=""
                  />
                </span>
              {:else if petVisualStyle(selectedPet)}
                <span
                  class="block size-28 shrink-0 rounded-full bg-slate-700 bg-cover bg-center shadow-2xl ring-4 ring-white/90 sm:size-32"
                  style={petVisualStyle(selectedPet)}
                  role="img"
                  aria-label={selectedPet.displayName}
                ></span>
              {:else}
                <span
                  class="flex size-28 shrink-0 items-center justify-center rounded-full bg-white/15 text-white shadow-2xl ring-4 ring-white/70 backdrop-blur-md sm:size-32"
                  role="img"
                  aria-label={selectedPet.displayName}
                >
                  <Icon icon={mdiPawOutline} size="52" />
                </span>
              {/if}

              <div class="min-w-0 flex-1">
                <div class="flex min-w-0 flex-wrap items-center gap-2">
                  <h1
                    class="max-w-full text-4xl font-semibold tracking-[-0.035em] text-balance sm:text-5xl lg:text-6xl"
                  >
                    {selectedPet.displayName}
                  </h1>
                </div>

                {#if isEditingAbout}
                  <form
                    class="mt-4 max-w-3xl rounded-2xl border border-white/15 bg-black/35 p-3 backdrop-blur-md"
                    onsubmit={submitAbout}
                  >
                    <Textarea
                      bind:value={aboutDescription}
                      bind:ref={aboutInput}
                      maxlength={2000}
                      placeholder={`What makes ${selectedPet.displayName} special?`}
                    />
                    <div class="mt-2 flex justify-end gap-2">
                      <button
                        class="h-9 rounded-lg px-3 text-sm font-semibold text-white/80 hover:bg-white/10 hover:text-white"
                        type="button"
                        onclick={cancelAboutEdit}>Cancel</button
                      >
                      <button
                        class="h-9 rounded-lg bg-white px-3 text-sm font-semibold text-slate-950 disabled:opacity-50"
                        type="submit"
                        disabled={isUpdating}>{isUpdating ? 'Saving…' : 'Save'}</button
                      >
                    </div>
                  </form>
                {:else if selectedPet.description}
                  <div class="mt-4 flex max-w-3xl items-start gap-2">
                    <p class="text-base/7 text-pretty whitespace-pre-wrap text-white/85 sm:text-lg/8">
                      {selectedPet.description}
                    </p>
                    <button
                      class="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-white/55 hover:bg-white/10 hover:text-white"
                      type="button"
                      onclick={beginAboutEdit}
                      aria-label={`Edit About for ${selectedPet.displayName}`}
                    >
                      <Icon icon={mdiPencilOutline} size="15" />
                    </button>
                  </div>
                {:else}
                  <button
                    class="mt-4 inline-flex min-h-9 items-center gap-2 rounded-full border border-dashed border-white/25 bg-black/25 px-3 text-sm font-semibold text-white/70 backdrop-blur-md hover:bg-black/45 hover:text-white"
                    type="button"
                    onclick={beginAboutEdit}><Icon icon={mdiPlus} size="16" /> Add about</button
                  >
                {/if}

                <div class="mt-4 flex flex-wrap items-center gap-2 text-sm text-white">
                  <span
                    class="inline-flex min-h-9 items-center rounded-full border border-white/15 bg-black/30 px-3 font-semibold backdrop-blur-md"
                    role="img"
                    aria-label={selectedPet.speciesKind ? getPetPresentation(selectedPet).label : 'Species not set'}
                    title={selectedPet.speciesKind ? getPetPresentation(selectedPet).label : 'Species not set'}
                  >
                    <Icon
                      icon={selectedPet.speciesKind ? getPetPresentation(selectedPet).icon : mdiPawOutline}
                      size="20"
                    />
                  </span>
                  {#if selectedPet.breedLabel}
                    <span
                      class="inline-flex min-h-9 items-center gap-2 rounded-full border border-white/15 bg-black/30 px-3 font-semibold backdrop-blur-md"
                    >
                      <span class="font-medium text-white/55">Breed</span>
                      {selectedPet.breedLabel}
                    </span>
                  {/if}
                  {#if getVisiblePetAliases(selectedPet).length > 0}
                    <span
                      class="inline-flex min-h-9 max-w-full items-center gap-2 rounded-full border border-white/15 bg-black/30 px-3 font-semibold backdrop-blur-md"
                    >
                      <span class="font-medium text-white/55">Also known as</span>
                      <span class="truncate">{getVisiblePetAliases(selectedPet).join(', ')}</span>
                    </span>
                  {/if}
                  <span
                    class="inline-flex min-h-9 items-center gap-2 rounded-full border border-white/15 bg-black/30 px-3 font-semibold backdrop-blur-md"
                  >
                    <span class="font-medium text-white/55">Photo history</span>
                    {photoTimeframe || 'Date unavailable'}
                  </span>
                </div>
              </div>
            </div>
          </section>

          {#if undoReceipt}
            <div
              class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
              aria-live="polite"
              role="status"
            >
              <div>
                <p class="text-sm font-semibold">Media evidence updated</p>
                <p class="mt-0.5 text-xs opacity-75">The source media was not changed.</p>
              </div>
              <button
                class="inline-flex items-center gap-2 rounded-lg border border-current px-3 py-1.5 text-sm font-semibold"
                type="button"
                onclick={undoLastMediaChange}
                disabled={isMutating}
              >
                <Icon icon={mdiUndoVariant} size="17" /> Undo
              </button>
            </div>
          {/if}

          <div class="flex min-w-0 items-center border-b border-gray-200 dark:border-immich-dark-gray">
            <div class="min-w-0 flex-1 overflow-x-auto">
              <div class="flex w-max min-w-full" role="tablist" aria-label="Pet content">
                <button
                  bind:this={photosTab}
                  class={`inline-flex h-12 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-semibold sm:px-4 ${activePetContent === 'photos' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-immich-fg dark:text-gray-400 dark:hover:text-immich-dark-fg'}`}
                  type="button"
                  role="tab"
                  id="pet-photos-tab"
                  aria-controls="pet-photos-panel"
                  aria-selected={activePetContent === 'photos'}
                  tabindex={activePetContent === 'photos' ? 0 : -1}
                  onclick={() => selectPetContent('photos')}
                  onkeydown={(event) => handlePetContentKeydown(event, 'photos')}
                >
                  Photos
                  <span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs dark:bg-immich-dark-gray"
                    >{selectedPet.confirmedMediaCount.toLocaleString()}</span
                  >
                </button>
                <button
                  bind:this={reviewTab}
                  class={`inline-flex h-12 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-semibold sm:px-4 ${activePetContent === 'review' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-immich-fg dark:text-gray-400 dark:hover:text-immich-dark-fg'}`}
                  type="button"
                  role="tab"
                  id="pet-review-tab"
                  aria-controls="pet-review-panel"
                  aria-selected={activePetContent === 'review'}
                  tabindex={activePetContent === 'review' ? 0 : -1}
                  onclick={() => selectPetContent('review')}
                  onkeydown={(event) => handlePetContentKeydown(event, 'review')}
                >
                  Review
                  {#if petMatches.length > 0}
                    <span class="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
                      >{petMatches.length.toLocaleString()}</span
                    >
                  {/if}
                </button>
                <button
                  bind:this={detailsTab}
                  class={`inline-flex h-12 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-semibold sm:px-4 ${activePetContent === 'details' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-immich-fg dark:text-gray-400 dark:hover:text-immich-dark-fg'}`}
                  type="button"
                  role="tab"
                  id="pet-details-tab"
                  aria-controls="pet-details-panel"
                  aria-selected={activePetContent === 'details'}
                  tabindex={activePetContent === 'details' ? 0 : -1}
                  onclick={() => selectPetContent('details')}
                  onkeydown={(event) => handlePetContentKeydown(event, 'details')}
                >
                  Details
                </button>
                <button
                  bind:this={connectionsTab}
                  class={`inline-flex h-12 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-semibold sm:px-4 ${activePetContent === 'connections' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-immich-fg dark:text-gray-400 dark:hover:text-immich-dark-fg'}`}
                  type="button"
                  role="tab"
                  id="pet-connections-tab"
                  aria-controls="pet-connections-panel"
                  aria-selected={activePetContent === 'connections'}
                  tabindex={activePetContent === 'connections' ? 0 : -1}
                  onclick={() => selectPetContent('connections')}
                  onkeydown={(event) => handlePetContentKeydown(event, 'connections')}
                >
                  Connections
                </button>
                <button
                  bind:this={displayTab}
                  class={`inline-flex h-12 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-semibold sm:px-4 ${activePetContent === 'display' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-immich-fg dark:text-gray-400 dark:hover:text-immich-dark-fg'}`}
                  type="button"
                  role="tab"
                  id="pet-display-tab"
                  aria-controls="pet-display-panel"
                  aria-selected={activePetContent === 'display'}
                  tabindex={activePetContent === 'display' ? 0 : -1}
                  onclick={() => selectPetContent('display')}
                  onkeydown={(event) => handlePetContentKeydown(event, 'display')}
                >
                  Display
                </button>
                <button
                  bind:this={documentsTab}
                  class={`inline-flex h-12 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-semibold sm:px-4 ${activePetContent === 'documents' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-immich-fg dark:text-gray-400 dark:hover:text-immich-dark-fg'}`}
                  type="button"
                  role="tab"
                  id="pet-documents-tab"
                  aria-controls="pet-documents-panel"
                  aria-selected={activePetContent === 'documents'}
                  tabindex={activePetContent === 'documents' ? 0 : -1}
                  onclick={() => selectPetContent('documents')}
                  onkeydown={(event) => handlePetContentKeydown(event, 'documents')}
                >
                  Documents
                </button>
              </div>
            </div>
            {#if activePetContent === 'photos'}
              <div
                class="flex shrink-0 items-center border-l border-gray-200 bg-white pl-2 dark:border-immich-dark-gray dark:bg-immich-dark-bg"
              >
                <button
                  class="mr-1 inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-gray-600 transition hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                  class:text-primary={petMediaSelectionMode}
                  type="button"
                  aria-label={petMediaSelectionMode ? 'Exit photo selection' : 'Select photos'}
                  aria-pressed={petMediaSelectionMode}
                  onclick={() => {
                    petMediaSelectionMode = !petMediaSelectionMode;
                    selectedPetMediaIds = [];
                  }}
                >
                  <Icon icon={mdiSelectAll} size="19" />
                  <span class="hidden sm:inline">{petMediaSelectionMode ? 'Done' : 'Select'}</span>
                </button>
                <label
                  class="relative mr-2 inline-flex size-10 cursor-pointer items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-950 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
                  title="Photo size"
                >
                  <Icon icon={mdiViewGridOutline} size="19" />
                  <select
                    class="absolute inset-0 size-full cursor-pointer opacity-0"
                    bind:value={petPhotoSize}
                    aria-label="Photo size"
                  >
                    <option value="small">Small</option>
                    <option value="medium">Medium</option>
                    <option value="large">Large</option>
                  </select>
                </label>
                <Tooltip text={$t('add_photos')}>
                  {#snippet child({ props })}
                    <button
                      {...props}
                      class="inline-flex size-11 items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-white shadow-sm hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:w-auto sm:px-4"
                      type="button"
                      onclick={openMediaPicker}
                      aria-label={$t('add_photos')}
                    >
                      <Icon icon={mdiImagePlusOutline} size="18" />
                      <span class="hidden sm:inline">{$t('add_photos')}</span>
                    </button>
                  {/snippet}
                </Tooltip>
              </div>
            {/if}
          </div>

          {#if activePetContent === 'photos'}
            <div
              class="flex min-w-0 flex-col gap-5"
              role="tabpanel"
              id="pet-photos-panel"
              aria-labelledby="pet-photos-tab"
              tabindex="0"
            >
              {#if mediaError}
                <CimmichStatePanel
                  tone="error"
                  title="Media action did not complete"
                  description={errorCopy(mediaError)}
                >
                  {#snippet action()}
                    <button
                      class="rounded-md border border-current px-3 py-1.5 text-sm font-semibold"
                      type="button"
                      onclick={() => selectedPet && loadMedia(selectedPet)}>Retry media</button
                    >
                  {/snippet}
                </CimmichStatePanel>
              {:else if !mediaLoaded}
                <CimmichStatePanel
                  tone="loading"
                  title="Loading confirmed media"
                  description="Reading the current Pet projection."
                />
              {:else if petMedia.length === 0}
                <CimmichStatePanel
                  title={`Add the first photo of ${selectedPet.displayName}`}
                  description="Choose photos visually from your private library. One action can add up to 100 items and can be undone."
                >
                  {#snippet action()}
                    <button
                      class="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white"
                      type="button"
                      onclick={openMediaPicker}>Choose photos</button
                    >
                  {/snippet}
                </CimmichStatePanel>
              {:else}
                {#if petMediaSelectionMode}
                  <div
                    class="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-immich-dark-gray"
                  >
                    <strong>{selectedPetMediaIds.length} selected</strong>
                    <span class="mr-auto text-xs text-gray-500">Up to {ENTITY_MEDIA_SELECTION_LIMIT} photos.</span>
                    <button
                      class="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold dark:border-gray-600"
                      type="button"
                      onclick={selectShownPetMedia}>Select shown</button
                    >
                    {#if selectedPetMediaIds.length > 0}<button
                        class="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold dark:border-gray-600"
                        type="button"
                        onclick={() => (selectedPetMediaIds = [])}>Clear</button
                      >{/if}
                  </div>
                {/if}
                <CimmichEntityMediaActions
                  currentSubject={{
                    displayName: selectedPet.displayName,
                    subjectId: selectedPet.petId,
                    subjectKind: 'pet',
                  }}
                  items={selectedPetMediaItems}
                  onChanged={refreshSelectedPetMedia}
                  onClear={() => (selectedPetMediaIds = [])}
                  showControls={petMediaSelectionMode}
                />
                <div class={petPhotoGridClass(petPhotoSize)}>
                  {#each petMedia as item (item.asset_id)}
                    <article
                      class="group relative aspect-square overflow-hidden rounded-sm bg-gray-200 dark:bg-gray-800"
                      class:ring-4={petMediaSelected(item.asset_id)}
                      class:ring-primary={petMediaSelected(item.asset_id)}
                    >
                      <a
                        class="block size-full focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                        href={Route.viewCimmichPetAsset({
                          id: item.sourceAssetId,
                          petId: selectedPet.petId,
                          petName: selectedPet.displayName,
                        })}
                        aria-label={`Open ${formatCaptureDate(item.capture_time)} photo of ${selectedPet.displayName}`}
                        title={item.filename || undefined}
                        onclick={(event) =>
                          handleCimmichMediaCardClick(event, petMediaSelectionMode, () =>
                            togglePetMediaSelection(item.asset_id),
                          )}
                      >
                        <img
                          class="size-full object-cover transition-transform group-hover:scale-[1.02] motion-reduce:transform-none motion-reduce:transition-none"
                          src={getAssetMediaUrl({ id: item.sourceAssetId, size: AssetMediaSize.Thumbnail })}
                          alt={item.filename || `${selectedPet.displayName} media`}
                          loading="lazy"
                        />
                        <span
                          class="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-black/75 to-transparent px-3 pt-10 pb-2 text-xs font-medium text-white opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
                        >
                          <span class="line-clamp-1">{formatCaptureDate(item.capture_time)}</span>
                        </span>
                      </a>
                      {#if petMediaSelectionMode}
                        <button
                          class="absolute top-2 right-2 z-10 grid size-9 place-items-center rounded-full border-2 border-white bg-black/55 text-white shadow-lg"
                          class:bg-primary={petMediaSelected(item.asset_id)}
                          type="button"
                          aria-label={`${petMediaSelected(item.asset_id) ? 'Deselect' : 'Select'} ${item.filename}`}
                          aria-pressed={petMediaSelected(item.asset_id)}
                          onclick={() => togglePetMediaSelection(item.asset_id)}
                        >
                          {#if petMediaSelected(item.asset_id)}<Icon icon={mdiCheck} size="19" />{/if}
                        </button>
                      {/if}
                      {#if petPresentation?.face?.assetId === item.asset_id || petPresentation?.hero?.assetId === item.asset_id}
                        <span
                          class="pointer-events-none absolute top-2 left-2 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur-sm"
                          >{petPresentation?.face?.assetId === item.asset_id &&
                          petPresentation?.hero?.assetId === item.asset_id
                            ? 'Profile + Hero'
                            : petPresentation?.face?.assetId === item.asset_id
                              ? 'Profile'
                              : 'Hero'}</span
                        >
                      {/if}
                      {#if !petMediaSelectionMode}
                        <ContextMenuButton
                          class="absolute top-1 right-1 size-9 bg-black/60 text-white opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-black/80"
                          items={getMediaActions(item)}
                          position="top-right"
                          aria-label={`Photo actions for ${formatCaptureDate(item.capture_time)}`}
                          disabled={isMutating}
                        />
                      {/if}
                    </article>
                  {/each}
                </div>
              {/if}
            </div>
          {:else if activePetContent === 'review'}
            <div class="grid gap-5" role="tabpanel" id="pet-review-panel" aria-labelledby="pet-review-tab" tabindex="0">
              <header class="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 class="text-xl font-semibold">Is this {selectedPet.displayName}?</h2>
                  <p class="mt-1 max-w-3xl text-sm text-gray-500 dark:text-gray-400">
                    These are model suggestions, not existing tags. Confirming one adds it to
                    {selectedPet.displayName}’s photos; rejecting it only removes this suggestion.
                  </p>
                </div>
                {#if petMatchesLoaded && petMatches.length > 0}
                  <p class="text-sm font-medium text-gray-500 dark:text-gray-400">
                    {petMatches.length.toLocaleString()} to review
                  </p>
                {/if}
              </header>

              {#if petMatchError}
                <CimmichStatePanel
                  tone="error"
                  title="Pet suggestions could not be updated"
                  description={errorCopy(petMatchError)}
                >
                  {#snippet action()}
                    <button
                      class="rounded-md border border-current px-3 py-1.5 text-sm font-semibold"
                      type="button"
                      onclick={() => selectedPet && loadPetMatches(selectedPet)}>Refresh suggestions</button
                    >
                  {/snippet}
                </CimmichStatePanel>
              {:else if !petMatchesLoaded}
                <CimmichStatePanel
                  tone="loading"
                  title="Loading Pet suggestions"
                  description="Reading non-authoritative model evidence."
                />
              {:else if petMatches.length === 0}
                <CimmichStatePanel
                  title={`Nothing waiting for ${selectedPet.displayName}`}
                  description="No model suggestions currently need your decision. Existing Pet photos remain in Photos."
                />
              {:else}
                <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {#each petMatches as suggestion (suggestion.suggestionId)}
                    <article
                      class="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-immich-dark-gray dark:bg-immich-dark-bg"
                    >
                      <a
                        class="group relative block aspect-4/3 overflow-hidden bg-gray-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary dark:bg-immich-dark-gray"
                        href={Route.viewCimmichPetAsset({
                          id: suggestion.sourceAssetId,
                          petId: selectedPet.petId,
                          petName: selectedPet.displayName,
                        })}
                        aria-label={`Open suggested photo of ${selectedPet.displayName}`}
                      >
                        <img
                          class="size-full object-contain transition-transform duration-300 group-hover:scale-[1.015] motion-reduce:transition-none"
                          src={getAssetMediaUrl({ id: suggestion.sourceAssetId, size: AssetMediaSize.Preview })}
                          alt={suggestion.filename || `Suggested ${selectedPet.displayName} photo`}
                          loading="lazy"
                        />
                        <span
                          class="pointer-events-none absolute rounded-lg border-2 border-dashed border-white/90 bg-primary/5 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
                          style={`left:${suggestion.box.x * 100}%;top:${suggestion.box.y * 100}%;width:${suggestion.box.w * 100}%;height:${suggestion.box.h * 100}%`}
                          aria-hidden="true"
                        ></span>
                        <span
                          class="absolute top-3 left-3 rounded-full bg-black/65 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm"
                        >
                          {suggestion.lane === 'face' ? 'Face match' : 'Whole-animal match'}
                        </span>
                      </a>
                      <div class="grid gap-3 p-4">
                        <div class="flex items-start justify-between gap-3">
                          <div>
                            <p class="font-semibold">Suggested as {selectedPet.displayName}</p>
                            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                              Compared with {suggestion.galleryCount.toLocaleString()}
                              {suggestion.galleryCount === 1 ? ' confirmed photo' : ' confirmed photos'}
                            </p>
                          </div>
                          <span
                            class="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 dark:bg-immich-dark-gray dark:text-gray-300"
                            title={`${suggestion.modelFamily} ${suggestion.modelVersion}`}
                          >
                            Similarity {suggestion.score.toFixed(2)}
                          </span>
                        </div>
                        <div class="grid grid-cols-2 gap-2">
                          <button
                            class="min-h-11 rounded-xl bg-primary px-3 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
                            type="button"
                            disabled={Boolean(petMatchReviewing)}
                            onclick={() => reviewPetMatch(suggestion, 'confirm')}
                          >
                            {petMatchReviewing === suggestion.suggestionId
                              ? 'Saving…'
                              : `Confirm ${selectedPet.displayName}`}
                          </button>
                          <button
                            class="min-h-11 rounded-xl border border-gray-300 px-3 text-sm font-semibold hover:border-primary hover:text-primary disabled:opacity-60 dark:border-immich-dark-gray"
                            type="button"
                            disabled={Boolean(petMatchReviewing)}
                            onclick={() => reviewPetMatch(suggestion, 'reject')}
                          >
                            Not {selectedPet.displayName}
                          </button>
                        </div>
                      </div>
                    </article>
                  {/each}
                </div>
              {/if}
            </div>
          {:else if activePetContent === 'details'}
            <div
              class="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(17rem,0.6fr)]"
              role="tabpanel"
              id="pet-details-panel"
              aria-labelledby="pet-details-tab"
              tabindex="0"
            >
              <section
                class="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6 dark:border-immich-dark-gray dark:bg-immich-dark-bg"
              >
                <div class="flex items-start justify-between gap-4">
                  <div>
                    <h2 class="text-xl font-semibold">Profile details</h2>
                    <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      The everyday details that make {selectedPet.displayName} easy to find and recognise.
                    </p>
                  </div>
                  <span
                    class="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
                  >
                    <Icon
                      icon={selectedPet.speciesKind ? getPetPresentation(selectedPet).icon : mdiPawOutline}
                      size="21"
                    />
                  </span>
                </div>

                <dl class="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-2">
                  <div class="border-b border-gray-100 pb-4 dark:border-immich-dark-gray">
                    <dt class="text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
                      Species
                    </dt>
                    <dd class="mt-1.5 text-base font-semibold">
                      {selectedPet.speciesKind ? getPetPresentation(selectedPet).label : 'Not set'}
                    </dd>
                  </div>
                  <div class="border-b border-gray-100 pb-4 dark:border-immich-dark-gray">
                    <dt class="text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
                      Breed
                    </dt>
                    <dd class="mt-1.5 text-base font-semibold">{selectedPet.breedLabel || 'Not set'}</dd>
                  </div>
                  <div class="border-b border-gray-100 pb-4 dark:border-immich-dark-gray">
                    <dt class="text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
                      Other names
                    </dt>
                    <dd class="mt-1.5 text-base font-semibold">
                      {getVisiblePetAliases(selectedPet).join(', ') || 'None added'}
                    </dd>
                  </div>
                  <div class="border-b border-gray-100 pb-4 dark:border-immich-dark-gray">
                    <dt class="text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
                      Photo history
                    </dt>
                    <dd class="mt-1.5 text-base font-semibold">{photoTimeframe || 'Date unavailable'}</dd>
                  </div>
                </dl>
              </section>

              <aside class="grid content-start gap-4">
                <section
                  class="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-immich-dark-gray dark:bg-immich-dark-bg"
                >
                  <div class="flex items-center justify-between gap-3">
                    <div>
                      <h2 class="font-semibold">Profile controls</h2>
                      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        Edit details or change who can see this Pet.
                      </p>
                    </div>
                    <CimmichObjectVisibility
                      object={selectedPet.visibility}
                      objectLabel="Pet"
                      onChange={(visibility) => {
                        const nextPet = { ...selectedPet!, visibility };
                        selectedPet = nextPet;
                        pets = pets.map((pet) => (pet.petId === nextPet.petId ? nextPet : pet));
                      }}
                    />
                  </div>
                  <div class="mt-4 flex flex-wrap gap-2">
                    <button
                      class="min-h-10 rounded-lg border border-gray-300 px-3 text-sm font-semibold hover:border-primary hover:text-primary dark:border-immich-dark-gray"
                      type="button"
                      onclick={beginEdit}>Edit profile</button
                    >
                    <button
                      class="min-h-10 rounded-lg px-3 text-sm font-semibold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                      type="button"
                      onclick={archivePet}>Hide pet</button
                    >
                  </div>
                </section>
                <section
                  class="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-immich-dark-gray dark:bg-immich-dark-bg"
                >
                  <h2 class="font-semibold">Care and records</h2>
                  <p class="mt-2 text-sm/6 text-gray-500 dark:text-gray-400">
                    Keep vaccinations, vet records, registration, insurance and adoption paperwork together.
                  </p>
                  <button
                    class="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg border border-gray-300 px-3 text-sm font-semibold hover:border-primary hover:text-primary dark:border-immich-dark-gray"
                    type="button"
                    onclick={() => selectPetContent('documents')}
                  >
                    <Icon icon={mdiFileDocumentOutline} size="17" />
                    Open documents
                  </button>
                </section>
              </aside>
            </div>
          {:else if activePetContent === 'connections'}
            <div role="tabpanel" id="pet-connections-panel" aria-labelledby="pet-connections-tab" tabindex="0">
              {#if selectedPet.connections.length === 0}
                <CimmichStatePanel
                  title="No connections yet"
                  description={`When ${selectedPet.displayName} is connected to a Place, Thing or Event, it will appear here with its cover photo.`}
                />
              {:else}
                <div class="grid gap-8">
                  <header>
                    <h2 class="text-xl font-semibold">Part of {selectedPet.displayName}’s story</h2>
                    <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      Places, Things and Events already connected to this Pet.
                    </p>
                  </header>
                  {#each connectionGroups as group (group.kind)}
                    <section aria-labelledby={`pet-connections-${group.kind}`}>
                      <div class="mb-3 flex items-center justify-between gap-3">
                        <h3
                          class="inline-flex items-center gap-2 text-sm font-semibold"
                          id={`pet-connections-${group.kind}`}
                        >
                          <Icon icon={connectionGroupIcon(group.kind)} size="18" class="text-primary" />
                          {group.label}
                          <span class="text-xs font-normal text-gray-500">{group.items.length}</span>
                        </h3>
                        <a
                          class="rounded-lg px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                          href={getPetRelatedConnectionsHref(selectedPet.displayName, group.items, group.kind)}
                          >Visit related</a
                        >
                      </div>
                      <ul class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {#each group.items as connection (`${connection.targetKind}:${connection.targetId}`)}
                          <li
                            class="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md motion-reduce:transform-none motion-reduce:transition-none dark:border-immich-dark-gray dark:bg-immich-dark-bg"
                          >
                            <div class="aspect-3/2 overflow-hidden bg-gray-100 dark:bg-immich-dark-gray">
                              {#if connection.coverAssetId}
                                <img
                                  class="size-full object-cover"
                                  src={getAssetMediaUrl({
                                    id: connection.coverAssetId,
                                    size: AssetMediaSize.Preview,
                                  })}
                                  alt=""
                                  loading="lazy"
                                />
                              {:else}
                                <span
                                  class="flex size-full items-center justify-center text-gray-400"
                                  aria-hidden="true"
                                >
                                  <Icon icon={connectionGroupIcon(group.kind)} size="36" />
                                </span>
                              {/if}
                            </div>
                            <div class="flex items-center justify-between gap-3 p-4">
                              <p class="min-w-0 truncate font-semibold" title={connection.displayName}>
                                {connection.displayName}
                              </p>
                              <a
                                class="shrink-0 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:border-immich-dark-gray"
                                href={getPetConnectionHref(connection)}>Show</a
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
          {:else if activePetContent === 'display'}
            <div
              class="grid gap-4"
              role="tabpanel"
              id="pet-display-panel"
              aria-labelledby="pet-display-tab"
              tabindex="0"
              aria-label="Display photo choices"
            >
              <div class="grid gap-3 sm:grid-cols-2">
                {#each [{ id: 'face', label: 'Profile photo' }, { id: 'hero', label: 'Hero photo' }] as slot (slot.id)}
                  {@const slotKind = slot.id as CimmichPetPresentationSlot}
                  {@const media = petPresentation?.[slotKind] ?? null}
                  <article
                    class="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
                  >
                    <div
                      class={[
                        'relative aspect-4/3 overflow-hidden bg-slate-950 select-none',
                        petPresentationDrag?.slotKind === slotKind ? 'cursor-grabbing' : 'cursor-grab',
                      ]}
                    >
                      {#if media}
                        <button
                          class="absolute inset-0 size-full touch-none overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
                          type="button"
                          aria-label={`${slot.label} framing editor. Drag the photo, use the mouse wheel to zoom, or use arrow and plus or minus keys.`}
                          onpointerdown={(event) => startPetPresentationDrag(event, slotKind)}
                          onpointermove={(event) => movePetPresentationDrag(event, slotKind)}
                          onpointerup={endPetPresentationDrag}
                          onpointercancel={endPetPresentationDrag}
                          onwheel={(event) => zoomPetPresentation(event, slotKind)}
                          onkeydown={(event) => keyPetPresentation(event, slotKind)}
                        >
                          <img
                            class="pointer-events-none absolute inset-0 size-full object-contain p-3 opacity-70"
                            src={petPresentationImageUrl(media)}
                            alt=""
                            draggable="false"
                          />
                          <span
                            class={[
                              'pointer-events-none absolute top-1/2 left-1/2 -translate-1/2 overflow-hidden border-2 border-white shadow-[0_0_0_999px_rgba(2,6,23,0.62),0_0_0_1px_rgba(0,0,0,0.55)]',
                              slotKind === 'face'
                                ? 'aspect-square h-[76%] rounded-full'
                                : 'aspect-12/5 w-[94%] rounded-lg',
                            ]}
                            aria-hidden="true"
                          >
                            <img
                              class="max-w-none"
                              src={petPresentationImageUrl(media)}
                              style={petPresentationImageStyle(slotKind, media)}
                              alt=""
                              draggable="false"
                            />
                          </span>
                        </button>
                        <div class="absolute inset-x-2 top-2 z-10 flex items-start justify-between gap-2">
                          <span
                            class="rounded-md bg-black/70 px-2 py-1 text-[11px] font-semibold text-white shadow-sm backdrop-blur-sm"
                          >
                            Final {slotKind === 'face' ? 'circle' : 'banner'}
                          </span>
                          <button
                            class={[
                              'min-h-9 rounded-md border px-3 py-2 text-xs font-semibold shadow-sm backdrop-blur-sm',
                              petPresentationPickerSlot === slotKind
                                ? 'border-white bg-white text-gray-950'
                                : 'border-white/30 bg-black/65 text-white hover:bg-black/80',
                            ]}
                            type="button"
                            aria-pressed={petPresentationPickerSlot === slotKind}
                            onclick={() =>
                              (petPresentationPickerSlot = petPresentationPickerSlot === slotKind ? '' : slotKind)}
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
                              onclick={() => adjustPetPresentationFrame(slotKind, { zoom: -0.1 })}>−</button
                            >
                            <span class="min-w-12 px-1 text-center text-[11px] font-semibold">
                              {petPresentationFrames[slotKind].zoom.toFixed(1)}×
                            </span>
                            <button
                              class="flex size-9 items-center justify-center text-lg hover:bg-white/15"
                              type="button"
                              aria-label={`Zoom ${slot.label} in`}
                              onclick={() => adjustPetPresentationFrame(slotKind, { zoom: 0.1 })}>+</button
                            >
                            <button
                              class="min-h-9 border-l border-white/20 px-3 text-xs font-semibold hover:bg-white/15 disabled:opacity-50"
                              type="button"
                              disabled={Boolean(petPresentationSaving)}
                              onclick={() => void savePetPresentationFrame(slotKind)}
                            >
                              {petPresentationSaving === slotKind ? 'Saving…' : 'Save'}
                            </button>
                          </div>
                        </div>
                      {:else}
                        <div class="flex size-full items-center justify-center p-4">
                          <button
                            class="min-h-10 rounded-md bg-white px-4 text-sm font-semibold text-gray-950"
                            type="button"
                            onclick={() => (petPresentationPickerSlot = slotKind)}>Choose photo</button
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
                          disabled={Boolean(petPresentationSaving)}
                          onclick={() => void clearPetPresentation(slotKind)}>Use automatic</button
                        >
                      {/if}
                    </div>
                  </article>
                {/each}
              </div>

              {#if petPresentationPickerSlot}
                <section
                  class="grid gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-immich-dark-gray dark:bg-black/10"
                  aria-labelledby="pet-presentation-picker-heading"
                >
                  <div class="flex items-center justify-between gap-3">
                    <div>
                      <h3 id="pet-presentation-picker-heading" class="font-semibold">
                        Choose {petPresentationPickerSlot === 'face' ? 'Profile photo' : 'Hero photo'}
                      </h3>
                      <p class="text-xs text-gray-500 dark:text-gray-400">
                        Select from {selectedPet.displayName}’s confirmed photos.
                      </p>
                    </div>
                    <button
                      class="min-h-9 rounded-md px-3 text-xs font-semibold hover:bg-white dark:hover:bg-immich-dark-gray"
                      type="button"
                      onclick={() => (petPresentationPickerSlot = '')}>Cancel</button
                    >
                  </div>
                  <div class="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">
                    {#each selectablePetPresentationMedia.slice(0, 20) as item (item.asset_id)}
                      <button
                        class="group overflow-hidden rounded-lg border border-gray-200 bg-white text-left hover:border-gray-500 disabled:opacity-50 dark:border-immich-dark-gray dark:bg-immich-dark-bg"
                        type="button"
                        disabled={Boolean(petPresentationSaving)}
                        title={item.filename}
                        onclick={() =>
                          void choosePetPresentation(petPresentationPickerSlot as CimmichPetPresentationSlot, item)}
                      >
                        <span
                          class="block aspect-square bg-gray-200 bg-cover bg-center transition group-hover:scale-[1.02] dark:bg-gray-800"
                          style={mediaBackgroundStyle(item.sourceAssetId, getPetMediaFocusCrop(item))}
                        ></span>
                        <span class="block truncate px-2 py-1.5 text-[11px] font-medium">{item.filename}</span>
                      </button>
                    {:else}
                      <p class="col-span-full py-6 text-center text-sm text-gray-500">
                        No confirmed Pet photos are available.
                      </p>
                    {/each}
                  </div>
                </section>
              {/if}
            </div>
          {:else}
            <div
              class="grid gap-5"
              role="tabpanel"
              id="pet-documents-panel"
              aria-labelledby="pet-documents-tab"
              tabindex="0"
            >
              {#key selectedPet.petId}
                <CimmichDocuments
                  heading={`Documents for ${selectedPet.displayName}`}
                  subject={{ id: selectedPet.petId, kind: 'pet', name: selectedPet.displayName }}
                />
              {/key}
            </div>
          {/if}
        </div>
      </section>
    {:else}
      {#if petViewMode === 'unknown'}
        <section
          class="grid gap-4 rounded-2xl border border-gray-200 bg-gray-50/70 p-4 sm:p-5 dark:border-immich-dark-gray dark:bg-immich-dark-bg/50"
          aria-labelledby="unknown-pets-heading"
        >
          <header class="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="unknown-pets-heading" class="text-xl font-semibold">Unknown pets</h2>
              <p class="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
                The detector found an animal, but matching did not find a safe identity. Assign only the ones you know.
              </p>
            </div>
            {#if petUnknownLoaded && petUnknown.length > 0}
              <p class="text-sm font-medium text-gray-500 dark:text-gray-400">
                {petUnknown.length.toLocaleString()} to review
              </p>
            {/if}
          </header>

          {#if petUnknownError}
            <CimmichStatePanel
              tone="error"
              title="Unknown pets could not be updated"
              description={errorCopy(petUnknownError)}
            >
              {#snippet action()}
                <button
                  class="rounded-md border border-current px-3 py-1.5 text-sm font-semibold"
                  type="button"
                  onclick={loadUnknownPets}>Refresh unknown pets</button
                >
              {/snippet}
            </CimmichStatePanel>
          {:else if !petUnknownLoaded}
            <CimmichStatePanel
              tone="loading"
              title="Loading unknown pets"
              description="Reading animal detections that did not clear the identity threshold."
            />
          {:else if petUnknown.length === 0}
            <CimmichStatePanel
              title="No unknown pets waiting"
              description="Every imported animal detection has been classified or dismissed."
            />
          {:else}
            <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {#each petUnknown as observation (observation.observationId)}
                <article
                  class="min-w-0 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-immich-dark-gray dark:bg-immich-dark-bg"
                >
                  <a
                    class="group relative block aspect-4/3 overflow-hidden bg-gray-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary dark:bg-immich-dark-gray"
                    href={`/photos/${observation.sourceAssetId}`}
                    aria-label={`Open ${observation.filename || 'unknown Pet photo'}`}
                  >
                    {#if unreadableObservations.has(observation.observationId)}
                      <span
                        class="flex size-full flex-col items-center justify-center gap-2 text-gray-400 dark:text-gray-500"
                      >
                        <Icon icon={mdiImageOffOutline} size="28" />
                        <span class="px-4 text-center text-xs">Preview unavailable</span>
                      </span>
                    {:else}
                      <img
                        class="size-full object-contain transition-transform duration-300 group-hover:scale-[1.015] motion-reduce:transition-none"
                        src={getAssetMediaUrl({ id: observation.sourceAssetId, size: AssetMediaSize.Preview })}
                        alt=""
                        loading="lazy"
                        onerror={() => markObservationUnreadable(observation.observationId)}
                      />
                      <span
                        class="pointer-events-none absolute rounded-lg border-2 border-dashed border-white/90 bg-primary/5 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
                        style={`left:${observation.box.x * 100}%;top:${observation.box.y * 100}%;width:${observation.box.w * 100}%;height:${observation.box.h * 100}%`}
                        aria-hidden="true"
                      ></span>
                    {/if}
                    <span
                      class="absolute top-3 left-3 rounded-full bg-black/65 px-2.5 py-1 text-xs font-semibold text-white capitalize backdrop-blur-sm"
                    >
                      Possible {observation.speciesKind.replace('_', ' ')}
                    </span>
                  </a>
                  <div class="grid min-w-0 gap-3 p-4">
                    <div class="min-w-0">
                      <p class="truncate font-semibold" title={observation.filename || 'Photo'}>
                        {observation.filename || 'Photo'}
                      </p>
                      <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        No identity cleared the matching threshold
                      </p>
                      <p class="mt-2 text-sm text-gray-600 dark:text-gray-300">
                        Choose an existing {observation.speciesKind.replace('_', ' ')} or create a new Pet.
                      </p>
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                      <button
                        class="min-h-10 rounded-xl bg-primary px-3 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
                        type="button"
                        disabled={Boolean(petUnknownReviewing)}
                        onclick={() => openUnknownAssignment(observation)}
                      >
                        {petUnknownReviewing === observation.observationId ? 'Saving…' : 'Assign pet'}
                      </button>
                      <button
                        class="min-h-10 rounded-xl border border-gray-300 px-3 text-sm font-semibold hover:border-primary hover:text-primary disabled:opacity-60 dark:border-immich-dark-gray"
                        type="button"
                        disabled={Boolean(petUnknownReviewing)}
                        onclick={() => void reviewUnknownPet(observation, 'reject')}
                      >
                        Not a {observation.speciesKind.replace('_', ' ')}
                      </button>
                    </div>
                  </div>
                </article>
              {/each}
            </div>
          {/if}
        </section>
      {:else if !loaded}
        <CimmichStatePanel
          tone="loading"
          title="Loading Pets"
          description="Reading the current typed Pet projection."
        />
      {:else if visiblePets.length === 0 && query}
        <CimmichStatePanel title="No matching pets" description="Try another name or alias." />
      {:else if visiblePets.length === 0}
        <CimmichStatePanel
          title="Create your first pet"
          description="Give them a name now; you can attach media and refine details next."
        >
          {#snippet action()}
            <button
              class="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white"
              type="button"
              onclick={beginCreate}
            >
              Add pet
            </button>
          {/snippet}
        </CimmichStatePanel>
      {:else}
        <section
          class={[
            'grid',
            petThumbnailSize === 'small'
              ? 'grid-cols-4 gap-x-4 gap-y-6 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-9 xl:grid-cols-10'
              : petThumbnailSize === 'large'
                ? 'grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'
                : 'grid-cols-3 gap-x-5 gap-y-8 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7',
          ]}
          data-testid="cimmich-pets"
        >
          {#each visiblePets as pet (pet.petId)}
            <a
              class="group flex min-w-0 flex-col items-center gap-3 text-center"
              data-testid="cimmich-pet-card"
              href={Route.cimmichPet({ name: pet.displayName, petId: pet.petId })}
            >
              <span
                class={[
                  'relative block w-full rounded-full',
                  petThumbnailSize === 'small' ? 'max-w-24' : petThumbnailSize === 'large' ? 'max-w-48' : 'max-w-36',
                ]}
              >
                <span
                  class="relative block aspect-square w-full rounded-full shadow-sm transition-transform duration-500 group-hover:scale-[1.02] motion-reduce:transition-none"
                >
                  <span class="absolute inset-0 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                    {#if petVisualStyle(pet)}
                      <span class="block size-full bg-cover bg-center" style={petVisualStyle(pet)}></span>
                    {:else}
                      <span
                        class="flex size-full items-center justify-center text-gray-500 dark:bg-immich-dark-gray dark:text-gray-300"
                        aria-label={`${pet.displayName} portrait unavailable in this viewing mode`}
                      >
                        <Icon icon={getPetPresentation(pet).icon} size="32" />
                      </span>
                    {/if}
                  </span>
                  {#if petVisualStyle(pet)}
                    <span
                      class="absolute right-1 bottom-1 z-10 flex size-8 items-center justify-center rounded-full border-2 border-white bg-gray-800 text-white shadow-sm dark:border-gray-950"
                      role="img"
                      aria-label={getPetPresentation(pet).label}
                      title={getPetPresentation(pet).label}
                    >
                      <Icon icon={getPetPresentation(pet).icon} size="16" />
                    </span>
                  {/if}
                </span>
              </span>
              <span class="w-full truncate text-sm font-medium">{pet.displayName}</span>
              {#if pet.breedLabel}
                <span class="-mt-2 w-full truncate text-xs text-gray-500 dark:text-gray-400">{pet.breedLabel}</span>
              {/if}
              <span class="w-full truncate text-xs text-gray-500 dark:text-gray-400">
                {#if pet.confirmedMediaCount === 0}
                  No photos yet
                {:else}
                  {pet.confirmedMediaCount.toLocaleString()}
                  {pet.confirmedMediaCount === 1 ? 'photo' : 'photos'}
                {/if}
              </span>
            </a>
          {/each}
        </section>
      {/if}
    {/if}
  </div>

  {#if showMediaPicker && selectedPet}
    <Modal
      title={`Choose photos of ${selectedPet.displayName}`}
      icon={mdiImageMultipleOutline}
      size="giant"
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        requestAnimationFrame(() => librarySearchInput?.focus());
      }}
      onClose={() => (showMediaPicker = false)}
    >
      <ModalBody class="flex min-h-0 flex-col overflow-hidden px-0!">
        <p class="px-4 pt-4 pb-3 text-sm text-gray-500 sm:px-6">Select up to 100. Nothing changes until you confirm.</p>

        <div
          class="flex flex-col gap-3 border-b border-gray-200 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:border-immich-dark-gray"
        >
          <label
            class="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm focus-within:border-primary dark:border-immich-dark-gray dark:bg-immich-dark-gray/50"
          >
            <Icon icon={mdiMagnify} size="18" class="text-gray-500" />
            <input
              bind:value={libraryQuery}
              bind:this={librarySearchInput}
              class="min-w-0 flex-1 bg-transparent outline-none"
              placeholder="Search these recent photos"
              type="search"
            />
          </label>
          <div class="flex items-center justify-between gap-3 sm:justify-end">
            <span class="text-sm font-medium text-gray-600 dark:text-gray-300" aria-live="polite"
              >{pickerSelectedIds.length}/100 selected</span
            >
            <button
              class="text-sm font-semibold text-primary disabled:opacity-40"
              type="button"
              onclick={() => (pickerSelectedIds = [])}
              disabled={pickerSelectedIds.length === 0}>{$t('clear')}</button
            >
          </div>
        </div>

        <div class="min-h-64 flex-1 overflow-y-auto p-4 sm:p-6">
          {#if pickerError}
            <p
              class="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
              role="alert"
            >
              {pickerError}
            </p>
          {/if}
          {#if isLoadingLibrary}
            <CimmichStatePanel
              tone="loading"
              title="Loading your library"
              description="Reading recent photos allowed by this viewing mode."
            />
          {:else if visibleLibraryAssets.length === 0}
            <CimmichStatePanel
              title="No photos found"
              description={libraryQuery ? 'Try another filename or place.' : 'No recent library media is available.'}
            />
          {:else}
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {#each visibleLibraryAssets as asset (asset.id)}
                {@const selected = pickerSelectedIds.includes(asset.id)}
                {@const attached = attachedSourceIds.has(asset.id)}
                <button
                  class={`group relative aspect-square overflow-hidden rounded-xl bg-gray-100 text-left ring-offset-2 transition dark:bg-immich-dark-gray dark:ring-offset-immich-dark-bg ${selected ? 'ring-3 ring-primary' : 'hover:ring-2 hover:ring-primary/50'} ${attached ? 'cursor-default opacity-55' : ''}`}
                  type="button"
                  onclick={() => togglePickerAsset(asset.id)}
                  disabled={attached}
                  aria-pressed={attached ? undefined : selected}
                  aria-label={attached
                    ? `${asset.originalFileName} is already attached`
                    : `${selected ? 'Deselect' : 'Select'} ${asset.originalFileName}`}
                >
                  <img
                    class="size-full object-cover transition-transform duration-300 group-hover:scale-[1.025] motion-reduce:transform-none motion-reduce:transition-none"
                    src={getAssetMediaUrl({ id: asset.id, cacheKey: asset.thumbhash, size: AssetMediaSize.Thumbnail })}
                    alt=""
                    loading="lazy"
                  />
                  <span
                    class="absolute inset-x-0 bottom-0 truncate bg-linear-to-t from-black/75 px-2 pt-6 pb-2 text-xs text-white"
                    >{attached ? 'Already attached' : asset.originalFileName}</span
                  >
                  {#if selected || attached}
                    <span
                      class={`absolute top-2 right-2 flex size-6 items-center justify-center rounded-full text-white shadow-sm ${attached ? 'bg-emerald-600' : 'bg-primary'}`}
                      ><Icon icon={mdiCheck} size="16" /></span
                    >
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </ModalBody>
      <ModalFooter class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tooltip text="Adds reversible manual Presence evidence. Source photos stay untouched.">
          {#snippet child({ props })}
            <button
              {...props}
              class="flex size-11 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:hover:bg-immich-dark-gray"
              type="button"
              aria-label="About adding photos to a Pet"
            >
              <Icon icon={mdiShieldCheckOutline} size="19" />
            </button>
          {/snippet}
        </Tooltip>
        <div class="flex justify-end gap-2">
          <button
            class="rounded-lg px-4 py-2 text-sm font-semibold hover:bg-gray-100 dark:hover:bg-immich-dark-gray"
            type="button"
            onclick={() => (showMediaPicker = false)}>{$t('cancel')}</button
          >
          <button
            class="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
            type="button"
            onclick={attachSelectedLibraryMedia}
            disabled={isMutating || pickerSelectedIds.length === 0}
          >
            <Icon icon={mdiImageMultipleOutline} size="18" />
            {isMutating ? 'Adding…' : $t('add_photos')}
          </button>
        </div>
      </ModalFooter>
    </Modal>
  {/if}

  {#if showCoverEditor && selectedPet && coverEditorMedia}
    <Modal
      title={`Frame ${selectedPet.displayName}`}
      icon={mdiCrop}
      size="giant"
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        requestAnimationFrame(() => coverZoomInput?.focus());
      }}
      onClose={() => (showCoverEditor = false)}
    >
      <ModalBody>
        <div class="grid gap-6 py-4 md:grid-cols-[minmax(0,1.35fr)_minmax(15rem,0.65fr)]">
          <div>
            <div class="aspect-4/3 overflow-hidden rounded-2xl bg-gray-100 shadow-inner dark:bg-immich-dark-gray">
              <span class="block size-full bg-no-repeat" style={coverEditorStyle()}></span>
            </div>
            <p class="mt-2 truncate text-xs text-gray-500">{coverEditorMedia.filename}</p>
          </div>
          <div class="grid content-start gap-5">
            <label class="grid gap-2 text-sm font-semibold">
              Zoom <span class="font-normal text-gray-500">{coverZoom.toFixed(1)}×</span>
              <input
                bind:this={coverZoomInput}
                class="accent-primary"
                type="range"
                min="1"
                max="3"
                step="0.05"
                bind:value={coverZoom}
              />
            </label>
            <label class="grid gap-2 text-sm font-semibold">
              Horizontal focus
              <input class="accent-primary" type="range" min="0" max="100" step="1" bind:value={coverFocusX} />
            </label>
            <label class="grid gap-2 text-sm font-semibold">
              Vertical focus
              <input class="accent-primary" type="range" min="0" max="100" step="1" bind:value={coverFocusY} />
            </label>
            <button
              class="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold hover:border-primary dark:border-immich-dark-gray"
              type="button"
              onclick={() => {
                coverZoom = 1;
                coverFocusX = 50;
                coverFocusY = 50;
              }}>Reset framing</button
            >
          </div>
        </div>

        {#if error}
          <p
            class="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
            role="alert"
          >
            {errorCopy(error)}
          </p>
        {/if}
      </ModalBody>
      <ModalFooter class="flex justify-end gap-2">
        <button
          class="rounded-lg px-4 py-2 text-sm font-semibold hover:bg-gray-100 dark:hover:bg-immich-dark-gray"
          type="button"
          onclick={() => (showCoverEditor = false)}>{$t('cancel')}</button
        >
        <button
          class="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
          type="button"
          onclick={saveCover}
          disabled={isUpdating}><Icon icon={mdiCrop} size="18" /> {isUpdating ? 'Saving…' : 'Use as cover'}</button
        >
      </ModalFooter>
    </Modal>
  {/if}

  {#if showCoverPicker && selectedPet}
    <Modal
      title={`Choose a cover for ${selectedPet.displayName}`}
      icon={mdiImageEditOutline}
      size="giant"
      onClose={() => (showCoverPicker = false)}
    >
      <ModalBody>
        <div class="grid grid-cols-2 gap-3 py-4 sm:grid-cols-3 md:grid-cols-4">
          {#each petMedia as item (item.asset_id)}
            {@const isCover = selectedPet.cover?.assetId === item.asset_id}
            <button
              class={`group relative aspect-4/3 overflow-hidden rounded-xl bg-gray-100 text-left ring-offset-2 transition motion-reduce:transition-none dark:bg-immich-dark-gray dark:ring-offset-immich-dark-bg ${isCover ? 'ring-3 ring-primary' : 'hover:ring-2 hover:ring-primary/60 focus-visible:ring-3 focus-visible:ring-primary'}`}
              type="button"
              onclick={() => chooseCoverMedia(item)}
              aria-label={`${isCover ? 'Adjust current cover from' : 'Choose'} ${item.filename || 'this photo'}`}
            >
              <img
                class="size-full object-cover transition-transform duration-300 group-hover:scale-[1.025] motion-reduce:transform-none motion-reduce:transition-none"
                src={getAssetMediaUrl({ id: item.sourceAssetId, size: AssetMediaSize.Preview })}
                alt=""
                loading="lazy"
              />
              <span
                class="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-linear-to-t from-black/80 px-3 pt-10 pb-2.5 text-left text-xs font-semibold text-white"
              >
                <span class="truncate">{formatCaptureDate(item.capture_time)}</span>
                <span
                  class="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/20 px-2 py-1 backdrop-blur-sm"
                >
                  <Icon icon={isCover ? mdiCheck : mdiCrop} size="13" />
                  {isCover ? 'Current' : 'Frame'}
                </span>
              </span>
            </button>
          {/each}
        </div>
      </ModalBody>
    </Modal>
  {/if}

  {#if petUnknownAssignmentObservation}
    <Modal
      title={`Assign possible ${petUnknownAssignmentObservation.speciesKind.replace('_', ' ')}`}
      icon={mdiPawOutline}
      size="medium"
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        requestAnimationFrame(() => petUnknownAssignmentSearchInput?.focus());
      }}
      onClose={closeUnknownAssignment}
    >
      <form onsubmit={submitUnknownAssignment}>
        <ModalBody>
          <div class="grid gap-5 py-4">
            <div
              class="grid gap-4 rounded-2xl border border-gray-200 bg-gray-50 p-3 sm:grid-cols-[9rem_minmax(0,1fr)] dark:border-immich-dark-gray dark:bg-immich-dark-gray/35"
            >
              <a
                class="relative block aspect-4/3 overflow-hidden rounded-xl bg-gray-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:bg-gray-800"
                href={`/photos/${petUnknownAssignmentObservation.sourceAssetId}`}
                aria-label={`Open ${petUnknownAssignmentObservation.filename || 'unknown Pet photo'}`}
              >
                <img
                  class="size-full object-contain"
                  src={getAssetMediaUrl({
                    id: petUnknownAssignmentObservation.sourceAssetId,
                    size: AssetMediaSize.Preview,
                  })}
                  alt=""
                />
                <span
                  class="pointer-events-none absolute rounded-md border-2 border-dashed border-white/90 bg-primary/5 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
                  style={`left:${petUnknownAssignmentObservation.box.x * 100}%;top:${petUnknownAssignmentObservation.box.y * 100}%;width:${petUnknownAssignmentObservation.box.w * 100}%;height:${petUnknownAssignmentObservation.box.h * 100}%`}
                  aria-hidden="true"
                ></span>
              </a>
              <div class="min-w-0 self-center">
                <p class="truncate font-semibold" title={petUnknownAssignmentObservation.filename}>
                  {petUnknownAssignmentObservation.filename || 'Photo'}
                </p>
                <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  The detector found a {petUnknownAssignmentObservation.speciesKind.replace('_', ' ')}. You decide the
                  identity.
                </p>
              </div>
            </div>

            <div
              class="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1 dark:bg-immich-dark-gray"
              role="tablist"
              aria-label="Pet assignment destination"
            >
              <button
                class={[
                  'min-h-10 rounded-lg px-3 text-sm font-semibold transition-colors',
                  petUnknownAssignmentMode === 'existing'
                    ? 'bg-white text-primary shadow-sm dark:bg-black/25 dark:text-immich-dark-primary'
                    : 'text-gray-500 hover:text-immich-fg dark:text-gray-400 dark:hover:text-immich-dark-fg',
                ]}
                type="button"
                role="tab"
                aria-selected={petUnknownAssignmentMode === 'existing'}
                onclick={() => {
                  selectUnknownAssignmentMode('existing');
                  requestAnimationFrame(() => petUnknownAssignmentSearchInput?.focus());
                }}>Move to</button
              >
              <button
                class={[
                  'min-h-10 rounded-lg px-3 text-sm font-semibold transition-colors',
                  petUnknownAssignmentMode === 'new'
                    ? 'bg-white text-primary shadow-sm dark:bg-black/25 dark:text-immich-dark-primary'
                    : 'text-gray-500 hover:text-immich-fg dark:text-gray-400 dark:hover:text-immich-dark-fg',
                ]}
                type="button"
                role="tab"
                aria-selected={petUnknownAssignmentMode === 'new'}
                onclick={() => {
                  selectUnknownAssignmentMode('new');
                  requestAnimationFrame(() => createNameInput?.focus());
                }}>Create new</button
              >
            </div>

            {#if petUnknownAssignmentMode === 'existing'}
              <div class="grid gap-3" role="tabpanel">
                <label
                  class="flex min-h-11 items-center gap-2 rounded-xl border border-gray-200 px-3 focus-within:border-primary dark:border-immich-dark-gray"
                >
                  <Icon icon={mdiMagnify} size="18" class="text-gray-500" />
                  <input
                    bind:this={petUnknownAssignmentSearchInput}
                    bind:value={petUnknownAssignmentQuery}
                    class="min-w-0 flex-1 bg-transparent text-sm outline-none"
                    type="search"
                    placeholder="Search compatible pets"
                    aria-label="Search compatible pets"
                  />
                </label>
                <div class="grid max-h-72 gap-2 overflow-y-auto pr-1">
                  {#each compatibleUnknownPets as pet (pet.petId)}
                    <button
                      class={[
                        'flex min-h-16 items-center gap-3 rounded-xl border p-2 text-left transition-colors',
                        petUnknownAssignmentPetId === pet.petId
                          ? 'border-primary bg-primary/5 ring-1 ring-primary'
                          : 'border-gray-200 hover:border-primary/60 dark:border-immich-dark-gray',
                      ]}
                      type="button"
                      aria-pressed={petUnknownAssignmentPetId === pet.petId}
                      onclick={() => (petUnknownAssignmentPetId = pet.petId)}
                    >
                      <span class="flex size-12 shrink-0 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                        {#if petVisualStyle(pet)}
                          <span class="block size-full bg-cover bg-center" style={petVisualStyle(pet)}></span>
                        {:else}
                          <span class="flex size-full items-center justify-center text-gray-500 dark:text-gray-300">
                            <Icon icon={getPetPresentation(pet).icon} size="23" />
                          </span>
                        {/if}
                      </span>
                      <span class="min-w-0 flex-1">
                        <span class="block truncate font-semibold">{pet.displayName}</span>
                        <span class="block truncate text-xs text-gray-500 dark:text-gray-400">
                          {pet.breedLabel || `${pet.confirmedMediaCount.toLocaleString()} photos`}
                        </span>
                      </span>
                      {#if petUnknownAssignmentPetId === pet.petId}
                        <span
                          class="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-white"
                        >
                          <Icon icon={mdiCheck} size="17" />
                        </span>
                      {/if}
                    </button>
                  {:else}
                    <CimmichStatePanel
                      title={petUnknownAssignmentQuery ? 'No matching pets' : 'No compatible pets yet'}
                      description={petUnknownAssignmentQuery
                        ? 'Try another name or switch to Create new.'
                        : `Create the first ${petUnknownAssignmentObservation.speciesKind.replace('_', ' ')} Pet for this photo.`}
                    />
                  {/each}
                </div>
              </div>
            {:else}
              <div class="grid gap-4" role="tabpanel">
                <Field label={$t('name')}>
                  <Input bind:value={createName} bind:ref={createNameInput} required maxlength={160} />
                </Field>
                <div
                  class="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-immich-dark-gray dark:bg-immich-dark-gray/35"
                >
                  <p class="text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">Species</p>
                  <p class="mt-1 text-sm font-semibold capitalize">
                    {petUnknownAssignmentObservation.speciesKind.replace('_', ' ')}
                  </p>
                  <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Kept with the detection so the assignment remains consistent.
                  </p>
                </div>
                <Field label="Aliases" description="Optional · comma-separated">
                  <Input bind:value={createAliases} placeholder="Nickname, former name" />
                </Field>
                <Field label="Breed" description="Optional · entered by you">
                  <Input bind:value={createBreedLabel} maxlength={120} placeholder="For example, Border Collie" />
                </Field>
                <Field label="About" description="Optional">
                  <Textarea
                    bind:value={createDescription}
                    maxlength={2000}
                    placeholder="A detail that helps you tell them apart"
                  />
                </Field>
              </div>
            {/if}

            {#if petUnknownError}
              <p
                class="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
                role="alert"
              >
                {errorCopy(petUnknownError)}
              </p>
            {/if}
          </div>
        </ModalBody>
        <ModalFooter class="flex justify-end gap-2">
          <button
            class="rounded-lg px-4 py-2 text-sm font-semibold hover:bg-gray-100 dark:hover:bg-immich-dark-gray"
            type="button"
            onclick={() => closeUnknownAssignment()}
            disabled={isCreating || Boolean(petUnknownReviewing)}>Cancel</button
          >
          <button
            class="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
            type="submit"
            disabled={isCreating ||
              Boolean(petUnknownReviewing) ||
              (petUnknownAssignmentMode === 'existing' ? !petUnknownAssignmentPetId : !createName.trim())}
          >
            <Icon icon={petUnknownAssignmentMode === 'existing' ? mdiCheck : mdiPlus} size="18" />
            {isCreating || petUnknownReviewing
              ? 'Saving…'
              : petUnknownAssignmentMode === 'existing'
                ? 'Assign pet'
                : 'Create and assign'}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  {/if}

  {#if showCreate}
    <FormModal
      title="Add pet"
      icon={mdiPawOutline}
      size="small"
      onClose={() => (showCreate = false)}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        requestAnimationFrame(() => createNameInput?.focus());
      }}
      onSubmit={submitCreate}
      submitText={isCreating ? 'Creating…' : 'Create pet'}
      disabled={isCreating || !createName.trim()}
    >
      <div class="my-4 grid gap-4">
        <Field label={$t('name')}>
          <Input bind:value={createName} bind:ref={createNameInput} required maxlength={160} />
        </Field>
        <Field label="Aliases" description="Optional · comma-separated">
          <Input bind:value={createAliases} placeholder="Nickname, former name" />
        </Field>
        <Field label="Species" description="Optional · you can change this later">
          <Select bind:value={createSpeciesKind} options={speciesOptions} />
        </Field>
        {#if createSpeciesKind === 'other'}
          <Field label="Species name" description="Optional">
            <Input bind:value={createSpeciesLabel} maxlength={80} placeholder="For example, axolotl" />
          </Field>
        {/if}
        <Field label="Breed" description="Optional · entered by you">
          <Input bind:value={createBreedLabel} maxlength={120} placeholder="For example, Border Collie" />
        </Field>
        <Field label="About" description="Optional">
          <Textarea
            bind:value={createDescription}
            maxlength={2000}
            placeholder="A detail that helps you tell them apart"
          />
        </Field>
        {#if error}
          <p
            class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
            role="alert"
          >
            {errorCopy(error)}
          </p>
        {/if}
      </div>
    </FormModal>
  {/if}

  {#if showEdit && selectedPet}
    <FormModal
      title={`Edit ${selectedPet.displayName}`}
      icon={mdiPencilOutline}
      size="small"
      onClose={() => (showEdit = false)}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        requestAnimationFrame(() => updateNameInput?.focus());
      }}
      onSubmit={submitUpdate}
      submitText={isUpdating ? 'Saving…' : 'Save changes'}
      disabled={isUpdating || !updateName.trim()}
    >
      <div class="my-4 grid gap-4">
        <Field label={$t('name')}>
          <Input bind:value={updateName} bind:ref={updateNameInput} required maxlength={160} />
        </Field>
        <Field label="Aliases" description="Optional · comma-separated">
          <Input bind:value={updateAliases} />
        </Field>
        <Field label="Species">
          <Select bind:value={updateSpeciesKind} options={speciesOptions} />
        </Field>
        {#if updateSpeciesKind === 'other'}
          <Field label="Species name" description="Optional">
            <Input bind:value={updateSpeciesLabel} maxlength={80} placeholder="For example, axolotl" />
          </Field>
        {/if}
        <Field label="Breed" description="Optional · entered by you">
          <Input bind:value={updateBreedLabel} maxlength={120} placeholder="For example, Border Collie" />
        </Field>
        <Field label="About" description="Optional">
          <Textarea bind:value={updateDescription} maxlength={2000} />
        </Field>
        {#if error}
          <p
            class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
            role="alert"
          >
            {errorCopy(error)}
          </p>
        {/if}
      </div>
    </FormModal>
  {/if}
</UserPageLayout>
