<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import CimmichDocuments from '$lib/components/cimmich/CimmichDocuments.svelte';
  import CimmichObjectVisibility from '$lib/components/cimmich/CimmichObjectVisibility.svelte';
  import CimmichSectionHeader from '$lib/components/cimmich/CimmichSectionHeader.svelte';
  import CimmichStatePanel from '$lib/components/cimmich/CimmichStatePanel.svelte';
  import { filterVisibleCimmichAssets } from '$lib/components/cimmich/asset-picker-visibility';
  import {
    getPetPresentation,
    getPetCollectionHref,
    getPetConnectionHref,
    getPetContentHref,
    getPetContentKeyboardTarget,
    getPetContentView,
    getPetDetailHref,
    getPetMediaTimeframe,
    getPetRelatedConnectionsHref,
    getVisiblePetAliases,
    groupPetConnections,
    sortPets,
    type PetContentView,
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
    getCimmichPetMedia,
    getCimmichPets,
    setCimmichPetMedia,
    undoCimmichPetDecision,
    updateCimmichPet,
    type CimmichPet,
    type CimmichPetMedia,
    type CimmichPetSpeciesKind,
  } from '$lib/services/cimmich.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize, searchAssets, type AssetResponseDto } from '@immich/sdk';
  import {
    mdiAccountGroupOutline,
    mdiArchiveOutline,
    mdiArrowLeft,
    mdiCalendarBlankOutline,
    mdiCheck,
    mdiCrop,
    mdiFileDocumentOutline,
    mdiImageMultipleOutline,
    mdiImageEditOutline,
    mdiImagePlusOutline,
    mdiInformationOutline,
    mdiLinkOff,
    mdiMagnify,
    mdiMapMarkerOutline,
    mdiPackageVariantClosed,
    mdiPawOutline,
    mdiPencilOutline,
    mdiPlus,
    mdiShieldCheckOutline,
    mdiSortAlphabeticalAscending,
    mdiSortAlphabeticalDescending,
    mdiSortNumericAscending,
    mdiSortNumericDescending,
    mdiSortVariant,
    mdiUndoVariant,
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
    type ActionItem,
  } from '@immich/ui';
  import { t } from 'svelte-i18n';
  import { untrack } from 'svelte';

  type RetryCommand = { id: string; payload: string } | null;
  type UndoReceipt = { decisionId: string; petName: string } | null;

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
  let documentsTab = $state<HTMLButtonElement | null>(null);
  let petMedia = $state<CimmichPetMedia[]>([]);
  let petPreviewMedia = $state<Record<string, CimmichPetMedia>>({});
  let pets = $state<CimmichPet[]>([]);
  let petsLoadGeneration = 0;
  let mediaLoadGeneration = 0;
  let pickerError = $state('');
  let pickerSelectedIds = $state<string[]>([]);
  let photosTab = $state<HTMLButtonElement | null>(null);
  let query = $state('');
  let selectedPet = $state<CimmichPet | null>(null);
  let showCoverEditor = $state(false);
  let showCoverPicker = $state(false);
  let showCreate = $state(false);
  let showEdit = $state(false);
  let showMediaPicker = $state(false);
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
  const requestedPetId = $derived(page.url.searchParams.get('entityId'));
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

  const mediaBackgroundStyle = (sourceAssetId: string) =>
    `background-image: url("${getAssetMediaUrl({ id: sourceAssetId, size: AssetMediaSize.Preview })}"); background-size: cover; background-position: center`;

  const petVisualStyle = (pet: CimmichPet) => {
    if (pet.cover?.sourceAssetId) {
      return petCoverStyle(pet);
    }
    const preview = petPreviewMedia[pet.petId];
    return preview?.sourceAssetId ? mediaBackgroundStyle(preview.sourceAssetId) : '';
  };

  const formatCaptureDate = (value: string | null) => {
    if (!value) {
      return 'Date unavailable';
    }
    return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(
      new Date(value),
    );
  };

  const currentCoverMedia = () =>
    petMedia.find((item) => item.asset_id === selectedPet?.cover?.assetId) || petMedia[0] || null;

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

  const loadPets = async (selectedPetId: string | null) => {
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
      const nextSelectedPet = nextPets.find((pet) => pet.petId === selectedPetId) || null;
      selectedPet = nextSelectedPet;
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
      const nextMedia = await getCimmichPetMedia(pet.petId);
      if (generation !== mediaLoadGeneration || selectedPet?.petId !== pet.petId) {
        return;
      }
      petMedia = nextMedia;
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

  const openPet = (pet: CimmichPet) => {
    selectedPet = pet;
    activePetContent = 'photos';
    isEditingAbout = false;
    aboutCommand = null;
    showEdit = false;
    undoReceipt = null;
    attachCommand = null;
    archiveCommand = null;
    mediaCommand = null;
    undoCommand = null;
    const href = getPetDetailHref(page.url, pet.petId);
    if (`${page.url.pathname}${page.url.search}` === href) {
      void loadMedia(pet);
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
      ({ connections: connectionsTab, details: detailsTab, documents: documentsTab, photos: photosTab })[
        target
      ]?.focus();
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
    createName = '';
    createBreedLabel = '';
    createSpeciesKind = '';
    createSpeciesLabel = '';
    createAliases = '';
    createDescription = '';
    createCommand = null;
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

  const getPetActions = (): ActionItem[] => {
    const actions: ActionItem[] = [];
    if (petMedia.length > 0) {
      if (selectedPet?.cover && currentCoverMedia()) {
        actions.push({ title: 'Adjust cover', icon: mdiCrop, onAction: openCurrentCoverEditor });
      }
      actions.push({
        title: selectedPet?.cover ? 'Change cover' : 'Choose cover',
        icon: mdiImageEditOutline,
        onAction: openCoverPicker,
      });
    }
    actions.push({
      title: selectedPet ? `Hide ${selectedPet.displayName}` : 'Hide pet',
      icon: mdiArchiveOutline,
      onAction: archivePet,
    });
    return actions;
  };

  const getMediaActions = (item: CimmichPetMedia): ActionItem[] => [
    {
      title: selectedPet?.cover?.assetId === item.asset_id ? 'Adjust cover' : 'Use as cover',
      icon: mdiCrop,
      onAction: () => openCoverEditor(item),
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
    isLoadingLibrary = true;
    pickerError = '';
    try {
      const result = await searchAssets({ metadataSearchDto: { size: 80, withExif: true } });
      const recent = result.assets.items.filter((asset) => !asset.isTrashed && !asset.isOffline);
      libraryAssets = await filterVisibleCimmichAssets(recent, getCimmichAssetEvidence);
    } catch {
      pickerError = 'Your photo library could not be loaded. No Pet evidence has changed.';
    } finally {
      isLoadingLibrary = false;
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

  const openCoverPicker = () => {
    if (petMedia.length === 0) {
      return;
    }
    showCoverPicker = true;
  };

  const chooseCoverMedia = (item: CimmichPetMedia) => {
    showCoverPicker = false;
    openCoverEditor(item);
  };

  const openCurrentCoverEditor = () => {
    const item = currentCoverMedia();
    if (item) {
      openCoverEditor(item);
    }
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
    if (visibilityVersion >= 0) {
      untrack(() => {
        mediaLoadGeneration += 1;
        petMedia = [];
        libraryAssets = [];
        pickerSelectedIds = [];
        if (showMediaPicker) {
          void loadLibraryAssets();
        }
        if (!petId) {
          selectedPet = null;
        }
        void loadPets(petId).then((pet) => {
          if (pet) {
            void loadMedia(pet);
          }
        });
      });
    }
  });
</script>

<UserPageLayout>
  <div class="mx-auto flex w-full max-w-7xl flex-col gap-6 p-5 text-immich-fg sm:p-7 dark:text-immich-dark-fg">
    {#if !selectedPet}
      <CimmichSectionHeader
        icon={mdiPawOutline}
        title="Pets"
        meta={loaded
          ? `${pets.length.toLocaleString()} active ${pets.length === 1 ? 'pet' : 'pets'}`
          : 'Loading current projection'}
      >
        {#snippet actions()}
          <label
            class="flex h-11 w-full min-w-0 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm focus-within:border-primary sm:w-72 lg:w-80 dark:border-immich-dark-gray dark:bg-immich-dark-bg"
          >
            <Icon icon={mdiMagnify} size="18" class="text-gray-500" />
            <input
              bind:value={query}
              class="min-w-0 flex-1 bg-transparent outline-none"
              placeholder="Search pets and aliases"
              type="search"
            />
          </label>
          <Tooltip text={`Sort pets — ${sortLabel}`}>
            {#snippet child({ props })}
              <ContextMenuButton
                {...props}
                class="size-11 border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
                icon={mdiSortVariant}
                items={sortActions}
                position="top-right"
                aria-label={`Sort pets. Current: ${sortLabel}`}
              />
            {/snippet}
          </Tooltip>
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
          <div
            class="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-immich-dark-gray dark:bg-immich-dark-bg"
          >
            <div class="grid sm:grid-cols-[minmax(15rem,42%)_minmax(0,1fr)]">
              <div
                class="group relative aspect-4/3 overflow-hidden bg-linear-to-br from-primary/20 via-violet-100 to-amber-50 sm:aspect-auto sm:min-h-72 dark:from-primary/20 dark:via-violet-950 dark:to-immich-dark-gray"
              >
                {#if petVisualStyle(selectedPet)}
                  <span
                    class="block size-full bg-cover bg-center transition-transform duration-500 group-hover:scale-[1.015] motion-reduce:transform-none motion-reduce:transition-none"
                    style={petVisualStyle(selectedPet)}
                  ></span>
                {:else}
                  <span class="flex size-full flex-col items-center justify-center gap-2 text-gray-500">
                    <Icon icon={mdiPawOutline} size="62" />
                    <span class="text-sm">Add photos to bring {selectedPet.displayName} to life</span>
                  </span>
                {/if}
                <span
                  class="absolute top-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white shadow-sm backdrop-blur-sm"
                  aria-label={`${selectedPet.confirmedMediaCount} photos`}
                >
                  <Icon icon={mdiImageMultipleOutline} size="15" />
                  {selectedPet.confirmedMediaCount.toLocaleString()}
                </span>
              </div>
              <div class="flex min-w-0 flex-col p-6 sm:p-8">
                <button
                  class="mb-4 inline-flex min-h-9 w-fit items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-gray-500 hover:bg-gray-100 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:text-gray-400 dark:hover:bg-immich-dark-gray"
                  type="button"
                  onclick={closePet}
                >
                  <Icon icon={mdiArrowLeft} size="17" />
                  Pets
                </button>
                <div class="flex flex-col items-start justify-between gap-4 sm:flex-row">
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <h1 class="truncate text-3xl font-semibold tracking-tight sm:text-4xl">
                        {selectedPet.displayName}
                      </h1>
                      <span
                        class="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
                        role="img"
                        aria-label={selectedPet.speciesKind ? getPetPresentation(selectedPet).label : 'Species not set'}
                        title={selectedPet.speciesKind ? getPetPresentation(selectedPet).label : 'Species not set'}
                      >
                        <Icon
                          icon={selectedPet.speciesKind ? getPetPresentation(selectedPet).icon : mdiPawOutline}
                          size="18"
                        />
                      </span>
                    </div>
                    <p class="mt-2 text-sm font-semibold text-gray-600 dark:text-gray-300">
                      {selectedPet.speciesKind ? getPetPresentation(selectedPet).label : 'Species not set'}
                      {#if selectedPet.breedLabel}
                        <span class="px-1.5 text-gray-300 dark:text-gray-600" aria-hidden="true">·</span>
                        {selectedPet.breedLabel}
                      {/if}
                    </p>
                    {#if getVisiblePetAliases(selectedPet).length > 0}
                      <p class="mt-2 truncate text-sm text-gray-500 dark:text-gray-400">
                        Also known as {getVisiblePetAliases(selectedPet).join(', ')}
                      </p>
                    {/if}
                  </div>
                  <div class="flex w-full shrink-0 items-center justify-between gap-1 sm:w-auto sm:justify-start">
                    <CimmichObjectVisibility
                      object={selectedPet.visibility}
                      objectLabel="Pet"
                      onChange={(visibility) => {
                        const nextPet = { ...selectedPet!, visibility };
                        selectedPet = nextPet;
                        pets = pets.map((pet) => (pet.petId === nextPet.petId ? nextPet : pet));
                      }}
                    />
                    <button
                      class="inline-flex h-11 items-center gap-2 rounded-lg border border-gray-300 px-3 text-sm font-semibold hover:border-primary dark:border-immich-dark-gray"
                      type="button"
                      onclick={beginEdit}
                      aria-label={`Edit ${selectedPet.displayName}`}
                    >
                      <Icon icon={mdiPencilOutline} size="17" />
                      <span class="hidden sm:inline">Edit profile</span>
                    </button>
                    <ContextMenuButton
                      class="size-11"
                      items={getPetActions()}
                      position="top-right"
                      aria-label={`More actions for ${selectedPet.displayName}`}
                    />
                  </div>
                </div>

                <div class="mt-6 min-w-0 border-t border-gray-200 pt-5 dark:border-immich-dark-gray">
                  <div class="flex items-center justify-between gap-3">
                    <h2 class="text-sm font-semibold">About</h2>
                    {#if !isEditingAbout && selectedPet.description}
                      <button
                        class="flex size-11 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-primary dark:hover:bg-immich-dark-gray"
                        type="button"
                        onclick={beginAboutEdit}
                        aria-label={`Edit About for ${selectedPet.displayName}`}
                      >
                        <Icon icon={mdiPencilOutline} size="16" />
                      </button>
                    {/if}
                  </div>
                  {#if isEditingAbout}
                    <form class="mt-2" onsubmit={submitAbout}>
                      <Textarea
                        bind:value={aboutDescription}
                        bind:ref={aboutInput}
                        maxlength={2000}
                        placeholder={`What makes ${selectedPet.displayName} special?`}
                      />
                      <div class="mt-2 flex justify-end gap-2">
                        <button
                          class="h-9 rounded-lg px-3 text-sm font-semibold hover:bg-gray-100 dark:hover:bg-immich-dark-gray"
                          type="button"
                          onclick={cancelAboutEdit}>Cancel</button
                        >
                        <button
                          class="h-9 rounded-lg bg-primary px-3 text-sm font-semibold text-white disabled:opacity-50"
                          type="submit"
                          disabled={isUpdating}>{isUpdating ? 'Saving…' : 'Save'}</button
                        >
                      </div>
                    </form>
                  {:else if selectedPet.description}
                    <p class="mt-2 max-w-2xl text-sm/6 text-gray-600 dark:text-gray-300">
                      {selectedPet.description}
                    </p>
                  {:else}
                    <button
                      class="mt-3 inline-flex h-11 items-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 text-sm font-semibold text-gray-600 hover:border-primary hover:text-primary dark:border-immich-dark-gray dark:text-gray-300"
                      type="button"
                      onclick={beginAboutEdit}><Icon icon={mdiPlus} size="17" /> Add about</button
                    >
                  {/if}
                </div>
              </div>
            </div>
          </div>

          {#if undoReceipt}
            <section
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
            </section>
          {/if}

          <div class="flex min-w-0 items-center border-b border-gray-200 dark:border-immich-dark-gray">
            <div class="min-w-0 flex-1 overflow-x-auto">
              <div class="flex w-max min-w-full" role="tablist" aria-label="Pet content">
                <button
                  bind:this={photosTab}
                  class={`inline-flex h-12 items-center gap-2 border-b-2 px-2 text-sm font-semibold sm:px-4 ${activePetContent === 'photos' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-immich-fg dark:text-gray-400 dark:hover:text-immich-dark-fg'}`}
                  type="button"
                  role="tab"
                  id="pet-photos-tab"
                  aria-controls="pet-photos-panel"
                  aria-selected={activePetContent === 'photos'}
                  tabindex={activePetContent === 'photos' ? 0 : -1}
                  onclick={() => selectPetContent('photos')}
                  onkeydown={(event) => handlePetContentKeydown(event, 'photos')}
                >
                  <span class="hidden sm:inline-flex"><Icon icon={mdiImageMultipleOutline} size="18" /></span>
                  Photos
                  <span class="hidden rounded-full bg-gray-100 px-2 py-0.5 text-xs sm:inline dark:bg-immich-dark-gray"
                    >{selectedPet.confirmedMediaCount.toLocaleString()}</span
                  >
                </button>
                <button
                  bind:this={detailsTab}
                  class={`inline-flex h-12 items-center gap-2 border-b-2 px-2 text-sm font-semibold sm:px-4 ${activePetContent === 'details' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-immich-fg dark:text-gray-400 dark:hover:text-immich-dark-fg'}`}
                  type="button"
                  role="tab"
                  id="pet-details-tab"
                  aria-controls="pet-details-panel"
                  aria-selected={activePetContent === 'details'}
                  tabindex={activePetContent === 'details' ? 0 : -1}
                  onclick={() => selectPetContent('details')}
                  onkeydown={(event) => handlePetContentKeydown(event, 'details')}
                >
                  <span class="hidden sm:inline-flex"><Icon icon={mdiInformationOutline} size="18" /></span>
                  Details
                </button>
                <button
                  bind:this={connectionsTab}
                  class={`inline-flex h-12 items-center gap-2 border-b-2 px-2 text-sm font-semibold sm:px-4 ${activePetContent === 'connections' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-immich-fg dark:text-gray-400 dark:hover:text-immich-dark-fg'}`}
                  type="button"
                  role="tab"
                  id="pet-connections-tab"
                  aria-controls="pet-connections-panel"
                  aria-selected={activePetContent === 'connections'}
                  tabindex={activePetContent === 'connections' ? 0 : -1}
                  onclick={() => selectPetContent('connections')}
                  onkeydown={(event) => handlePetContentKeydown(event, 'connections')}
                >
                  <span class="hidden sm:inline-flex"><Icon icon={mdiAccountGroupOutline} size="18" /></span>
                  Connections
                </button>
                <button
                  bind:this={documentsTab}
                  class={`inline-flex h-12 items-center gap-2 border-b-2 px-2 text-sm font-semibold sm:px-4 ${activePetContent === 'documents' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-immich-fg dark:text-gray-400 dark:hover:text-immich-dark-fg'}`}
                  type="button"
                  role="tab"
                  id="pet-documents-tab"
                  aria-controls="pet-documents-panel"
                  aria-selected={activePetContent === 'documents'}
                  tabindex={activePetContent === 'documents' ? 0 : -1}
                  onclick={() => selectPetContent('documents')}
                  onkeydown={(event) => handlePetContentKeydown(event, 'documents')}
                >
                  <span class="hidden sm:inline-flex"><Icon icon={mdiFileDocumentOutline} size="18" /></span>
                  <span class="sm:hidden">Docs</span><span class="hidden sm:inline">Documents</span>
                </button>
              </div>
            </div>
            {#if activePetContent === 'photos'}
              <div
                class="flex shrink-0 items-center border-l border-gray-200 bg-white pl-2 dark:border-immich-dark-gray dark:bg-immich-dark-bg"
              >
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
                <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {#each petMedia as item (item.asset_id)}
                    <article
                      class="group overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md motion-reduce:transform-none motion-reduce:transition-none dark:border-immich-dark-gray dark:bg-immich-dark-bg"
                    >
                      <div class="relative aspect-4/3 overflow-hidden bg-gray-100 dark:bg-immich-dark-gray">
                        <a
                          class="block size-full focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                          href={Route.viewCimmichPetAsset({
                            id: item.sourceAssetId,
                            petId: selectedPet.petId,
                            petName: selectedPet.displayName,
                          })}
                          aria-label={`Open ${formatCaptureDate(item.capture_time)} photo of ${selectedPet.displayName}`}
                        >
                          <img
                            class="size-full object-cover transition-transform duration-300 group-hover:scale-[1.025] motion-reduce:transform-none motion-reduce:transition-none"
                            src={getAssetMediaUrl({ id: item.sourceAssetId, size: AssetMediaSize.Preview })}
                            alt={item.filename || `${selectedPet.displayName} media`}
                            loading="lazy"
                          />
                        </a>
                        {#if selectedPet.cover?.assetId === item.asset_id}
                          <span
                            class="absolute top-2 left-2 rounded-full bg-black/65 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm"
                            >Cover</span
                          >
                        {/if}
                        <ContextMenuButton
                          class="absolute top-2 right-2 size-11 bg-black/60 text-white shadow-sm backdrop-blur-sm hover:bg-black/80"
                          items={getMediaActions(item)}
                          position="top-right"
                          aria-label={`Photo actions for ${formatCaptureDate(item.capture_time)}`}
                          disabled={isMutating}
                        />
                      </div>
                      <div class="p-3">
                        <p class="text-sm font-semibold">{formatCaptureDate(item.capture_time)}</p>
                        <p
                          class="mt-1 truncate text-xs text-gray-400 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 dark:text-gray-500"
                        >
                          {item.filename || item.asset_id}
                        </p>
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
      {#if !loaded}
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
        <section class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="cimmich-pets">
          {#each visiblePets as pet (pet.petId)}
            <button
              class="group overflow-hidden rounded-xl border border-gray-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary hover:shadow-md motion-reduce:transform-none motion-reduce:transition-none dark:border-immich-dark-gray dark:bg-immich-dark-bg"
              data-testid="cimmich-pet-card"
              type="button"
              onclick={() => openPet(pet)}
            >
              <span class="relative block aspect-4/3 overflow-hidden bg-gray-100 dark:bg-immich-dark-gray">
                {#if petVisualStyle(pet)}
                  <span
                    class="block size-full bg-cover bg-center transition-transform duration-300 group-hover:scale-[1.025] motion-reduce:transform-none motion-reduce:transition-none"
                    style={petVisualStyle(pet)}
                  ></span>
                {:else}
                  <span class="flex size-full items-center justify-center text-gray-400">
                    <Icon icon={mdiPawOutline} size="48" />
                  </span>
                {/if}
                <span
                  class="absolute top-3 left-3 flex size-9 items-center justify-center rounded-full bg-black/60 text-white shadow-sm backdrop-blur-sm"
                  role="img"
                  aria-label={getPetPresentation(pet).label}
                  title={getPetPresentation(pet).label}
                >
                  <Icon icon={getPetPresentation(pet).icon} size="19" />
                </span>
                <span
                  class="absolute top-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white shadow-sm backdrop-blur-sm"
                  aria-label={`${pet.confirmedMediaCount} media`}
                >
                  <Icon icon={mdiImageMultipleOutline} size="14" />
                  {pet.confirmedMediaCount.toLocaleString()}
                </span>
              </span>
              <span class="block p-4">
                <span class="block truncate text-lg font-semibold">{pet.displayName}</span>
                {#if pet.description}
                  <span class="mt-3 line-clamp-2 block text-sm/5 text-gray-600 dark:text-gray-300"
                    >{pet.description}</span
                  >
                {:else if getVisiblePetAliases(pet).length > 0}
                  <span class="mt-3 block truncate text-sm text-gray-500"
                    >Also known as {getVisiblePetAliases(pet).join(', ')}</span
                  >
                {/if}
              </span>
            </button>
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
