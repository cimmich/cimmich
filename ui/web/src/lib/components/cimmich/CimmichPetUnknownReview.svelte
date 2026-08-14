<script lang="ts">
  import {
    CimmichServiceError,
    createCimmichCommandId,
    createCimmichPet,
    getCimmichPets,
    reviewCimmichPetMatchUnknown,
    type CimmichPet,
    type CimmichPetMatchUnknown,
    type CimmichPetSpeciesKind,
  } from '$lib/services/cimmich.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { mdiCheck, mdiImageOffOutline, mdiMagnify, mdiPawOutline, mdiPlus } from '@mdi/js';
  import { Field, Icon, Input, Modal, ModalBody, ModalFooter, Select, Textarea } from '@immich/ui';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import CimmichStatePanel from './CimmichStatePanel.svelte';
  import { getPetPresentation } from './pet-presentation';

  type RetryCommand = { id: string; payload: string } | null;
  type AssignmentMode = 'existing' | 'new';

  type Props = {
    error: CimmichServiceError | null;
    items: CimmichPetMatchUnknown[];
    loaded: boolean;
    onItemsChanged: (items: CimmichPetMatchUnknown[]) => void;
    onPetsChanged: (pets: CimmichPet[]) => void;
    onReload: () => Promise<void> | void;
    pets: CimmichPet[];
    petVisualStyle: (pet: CimmichPet) => string;
    queueState: 'ignored' | 'unknown';
  };

  let { error, items, loaded, onItemsChanged, onPetsChanged, onReload, pets, petVisualStyle, queueState }: Props =
    $props();

  let assignmentMode = $state<AssignmentMode>('existing');
  let assignmentObservations = $state<CimmichPetMatchUnknown[]>([]);
  let assignmentPetId = $state('');
  let assignmentQuery = $state('');
  let assignmentSearchInput = $state<HTMLInputElement | null>(null);
  let createAliases = $state('');
  let createBreedLabel = $state('');
  let createCommand = $state<RetryCommand>(null);
  let createDescription = $state('');
  let createName = $state('');
  let createNameInput = $state<HTMLInputElement | null>(null);
  let createSpeciesKind = $state<CimmichPetSpeciesKind | ''>('');
  let createSpeciesLabel = $state('');
  let formError = $state('');
  let isCreating = $state(false);
  let reviewError = $state<CimmichServiceError | null>(null);
  let reviewing = $state('');

  const unreadableObservations = new SvelteSet<string>();
  const selectedIds = new SvelteSet<string>();
  const reviewCommands = new SvelteMap<string, RetryCommand>();
  const selectionLimit = 100;
  const assignmentObservation = $derived(assignmentObservations[0] ?? null);
  const selectedItems = $derived(items.filter((item) => selectedIds.has(item.observationId)));
  const allShownSelected = $derived(
    items.length > 0 && items.slice(0, selectionLimit).every((item) => selectedIds.has(item.observationId)),
  );
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

  const compatiblePets = $derived.by(() => {
    const value = assignmentQuery.trim().toLocaleLowerCase();
    return pets.filter(
      (pet) =>
        pet.speciesKind === createSpeciesKind &&
        (!value || [pet.displayName, pet.breedLabel, ...pet.aliases].join(' ').toLocaleLowerCase().includes(value)),
    );
  });

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
      case 'PET_MATCH_ALREADY_REVIEWED': {
        return 'That animal detection was already reviewed. The current queue has been refreshed.';
      }
      case 'PET_MATCH_UNKNOWN_NOT_FOUND': {
        return 'That animal detection is no longer in this review queue.';
      }
      case 'PET_MATCH_PET_NOT_FOUND': {
        return 'That Pet is no longer available. Choose another Pet or create a new one.';
      }
      case 'PET_MATCH_SPECIES_CONFLICT': {
        return 'The selected Pet does not use the species you chose. Review both fields and try again.';
      }
      case 'PET_MATCH_SPECIES_INVALID':
      case 'PET_SPECIES_INVALID': {
        return 'Choose a supported species. A custom label is available only for Other.';
      }
      default: {
        return `The local service declined this action (${value.code}).`;
      }
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

  const openAssignment = (observations: CimmichPetMatchUnknown[]) => {
    if (observations.length === 0) {
      return;
    }
    assignmentObservations = observations;
    assignmentMode = 'existing';
    assignmentPetId = '';
    assignmentQuery = '';
    reviewError = null;
    formError = '';
    const detectedSpecies = new Set(observations.map((item) => item.speciesKind));
    resetCreateFields(detectedSpecies.size === 1 ? observations[0].speciesKind : '');
  };

  const closeAssignment = (force = false) => {
    if (!force && (isCreating || reviewing)) {
      return;
    }
    assignmentObservations = [];
    assignmentPetId = '';
    assignmentQuery = '';
    reviewError = null;
    formError = '';
  };

  const selectAssignmentMode = (mode: AssignmentMode) => {
    assignmentMode = mode;
    assignmentPetId = '';
    reviewError = null;
    formError = '';
    if (mode === 'new' && assignmentObservation) {
      resetCreateFields(createSpeciesKind || assignmentObservation.speciesKind);
    }
  };

  const reviewItems = async (
    observations: CimmichPetMatchUnknown[],
    action: 'assign' | 'ignore' | 'reject' | 'restore',
    petId?: string,
    speciesKind?: CimmichPetSpeciesKind,
  ): Promise<boolean> => {
    if (reviewing || observations.length === 0) {
      return false;
    }
    reviewing = action;
    reviewError = null;
    const succeeded = new SvelteSet<string>();
    let firstError: CimmichServiceError | null = null;
    let cursor = 0;
    const worker = async () => {
      while (cursor < observations.length) {
        const observation = observations[cursor++];
        const payload = {
          action,
          observationId: observation.observationId,
          petId: petId ?? null,
          speciesKind: speciesKind ?? null,
        };
        const command = commandFor(
          reviewCommands.get(observation.observationId) ?? null,
          `pet-unknown-${action}`,
          payload,
        );
        reviewCommands.set(observation.observationId, command);
        try {
          await reviewCimmichPetMatchUnknown(observation.observationId, action, command.id, petId, speciesKind);
          succeeded.add(observation.observationId);
        } catch (error_) {
          firstError ??= asServiceError(error_);
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(4, observations.length) }, worker));
      for (const observationId of succeeded) {
        selectedIds.delete(observationId);
      }
      if (succeeded.size === observations.length) {
        for (const observation of observations) {
          reviewCommands.delete(observation.observationId);
        }
      }
      onItemsChanged(items.filter((item) => !succeeded.has(item.observationId)));
      reviewError = firstError;
      if (action === 'assign' && succeeded.size > 0) {
        onPetsChanged(await getCimmichPets({ limit: 500 }));
      }
      await onReload();
      return succeeded.size === observations.length;
    } finally {
      reviewing = '';
    }
  };

  const toggleSelection = (observationId: string) => {
    if (selectedIds.has(observationId)) {
      selectedIds.delete(observationId);
    } else if (selectedItems.length < selectionLimit) {
      selectedIds.add(observationId);
    }
  };

  const toggleAllShown = () => {
    const shown = items.slice(0, selectionLimit);
    if (allShownSelected) {
      selectedIds.clear();
      return;
    }
    selectedIds.clear();
    for (const item of shown) {
      selectedIds.add(item.observationId);
    }
  };

  const submitAssignment = async () => {
    const observations = assignmentObservations;
    if (!assignmentObservation || observations.length === 0 || reviewing || isCreating) {
      return;
    }
    formError = '';
    if (!createSpeciesKind) {
      formError = 'Choose the correct species before assigning this detection.';
      return;
    }
    if (assignmentMode === 'existing') {
      const selectedPet = compatiblePets.find((pet) => pet.petId === assignmentPetId);
      if (!selectedPet) {
        formError = `Choose an existing ${createSpeciesKind.replace('_', ' ')} Pet first.`;
        return;
      }
      if (await reviewItems(observations, 'assign', selectedPet.petId, createSpeciesKind)) {
        closeAssignment();
      }
      return;
    }

    const payload = {
      aliases: parseLabels(createAliases),
      breedLabel: createBreedLabel.trim() || null,
      description: createDescription.trim(),
      displayName: createName.trim(),
      speciesKind: createSpeciesKind,
      speciesLabel: createSpeciesKind === 'other' ? createSpeciesLabel.trim() || null : null,
    };
    if (!payload.displayName) {
      formError = 'Give this Pet a name before creating it.';
      return;
    }
    createCommand = commandFor(createCommand, 'create-from-unknown', {
      observationIds: observations.map((item) => item.observationId).sort(),
      ...payload,
    });
    isCreating = true;
    reviewError = null;
    try {
      const result = await createCimmichPet({ ...payload, commandId: createCommand.id });
      onPetsChanged(
        [...pets.filter((pet) => pet.petId !== result.pet.petId), result.pet].sort((left, right) =>
          left.displayName.localeCompare(right.displayName),
        ),
      );
      if (await reviewItems(observations, 'assign', result.pet.petId, createSpeciesKind)) {
        createCommand = null;
        closeAssignment(true);
      }
    } catch (error_) {
      reviewError = asServiceError(error_);
    } finally {
      isCreating = false;
    }
  };
</script>

<section
  class="grid gap-4 rounded-2xl border border-gray-200 bg-gray-50/70 p-4 sm:p-5 dark:border-immich-dark-gray dark:bg-immich-dark-bg/50"
  aria-labelledby="pet-review-heading"
>
  <header class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <h2 id="pet-review-heading" class="text-xl font-semibold">
        {queueState === 'unknown' ? 'Unknown pets' : 'Ignored pets'}
      </h2>
      <p class="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
        {queueState === 'unknown'
          ? 'Assign known animals, temporarily ignore uncertain ones, or mark detector errors as False Matches.'
          : 'Ignored detections stay out of the review queue until you restore or mark them as False Matches.'}
      </p>
    </div>
    {#if loaded && items.length > 0}
      <p class="text-sm font-medium text-gray-500 dark:text-gray-400">
        {items.length.toLocaleString()}
        {queueState === 'unknown' ? 'to review' : 'ignored'}
      </p>
    {/if}
  </header>

  {#if error}
    <CimmichStatePanel tone="error" title="Pet review could not be updated" description={errorCopy(error)}>
      {#snippet action()}
        <button
          class="rounded-md border border-current px-3 py-1.5 text-sm font-semibold"
          type="button"
          onclick={onReload}>Refresh Pet review</button
        >
      {/snippet}
    </CimmichStatePanel>
  {:else if !loaded}
    <CimmichStatePanel
      tone="loading"
      title={queueState === 'unknown' ? 'Loading unknown pets' : 'Loading ignored pets'}
      description="Reading owner-reviewable animal detections."
    />
  {:else if items.length === 0}
    <CimmichStatePanel
      title={queueState === 'unknown' ? 'No unknown pets waiting' : 'No ignored pets'}
      description={queueState === 'unknown'
        ? 'Every imported animal detection has been assigned, ignored, or marked as a False Match.'
        : 'Ignored detections will appear here and can be restored at any time.'}
    />
  {:else}
    <div
      class="flex flex-wrap items-center gap-2 rounded-2xl border border-gray-200 bg-white p-3 dark:border-immich-dark-gray dark:bg-immich-dark-bg"
      role="toolbar"
      aria-label={`${queueState === 'unknown' ? 'Unknown' : 'Ignored'} Pet bulk actions`}
    >
      <label class="mr-auto inline-flex min-h-10 items-center gap-2 px-1 text-sm font-semibold">
        <input type="checkbox" checked={allShownSelected} onchange={toggleAllShown} />
        {allShownSelected ? 'Clear all' : `Select ${Math.min(items.length, selectionLimit)}`}
      </label>
      <span class="text-sm text-gray-500 dark:text-gray-400" aria-live="polite">
        {selectedItems.length.toLocaleString()} selected
      </span>
      {#if queueState === 'unknown'}
        <button
          class="min-h-10 rounded-xl bg-primary px-3 text-sm font-semibold text-white disabled:opacity-45"
          type="button"
          disabled={selectedItems.length === 0 || Boolean(reviewing)}
          onclick={() => openAssignment(selectedItems)}>Assign</button
        >
        <button
          class="min-h-10 rounded-xl border border-gray-300 px-3 text-sm font-semibold disabled:opacity-45 dark:border-immich-dark-gray"
          type="button"
          disabled={selectedItems.length === 0 || Boolean(reviewing)}
          onclick={() => void reviewItems(selectedItems, 'ignore')}>Ignore</button
        >
      {:else}
        <button
          class="min-h-10 rounded-xl bg-primary px-3 text-sm font-semibold text-white disabled:opacity-45"
          type="button"
          disabled={selectedItems.length === 0 || Boolean(reviewing)}
          onclick={() => void reviewItems(selectedItems, 'restore')}>Restore</button
        >
      {/if}
      <button
        class="min-h-10 rounded-xl border border-red-300 px-3 text-sm font-semibold text-red-700 disabled:opacity-45 dark:border-red-900 dark:text-red-300"
        type="button"
        disabled={selectedItems.length === 0 || Boolean(reviewing)}
        onclick={() => void reviewItems(selectedItems, 'reject')}>False Match</button
      >
    </div>

    {#if reviewError}
      <p
        class="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
        role="alert"
      >
        {errorCopy(reviewError)}
      </p>
    {/if}

    <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {#each items as observation (observation.observationId)}
        <article
          class={[
            'relative min-w-0 overflow-hidden rounded-2xl border bg-white shadow-sm dark:bg-immich-dark-bg',
            selectedIds.has(observation.observationId)
              ? 'border-primary ring-2 ring-primary/30'
              : 'border-gray-200 dark:border-immich-dark-gray',
          ]}
        >
          <label
            class="absolute top-3 right-3 z-10 flex size-10 cursor-pointer items-center justify-center rounded-full bg-black/65 text-white backdrop-blur-sm"
          >
            <input
              type="checkbox"
              checked={selectedIds.has(observation.observationId)}
              aria-label={`Select ${observation.filename || 'Pet detection'}`}
              onchange={() => toggleSelection(observation.observationId)}
            />
          </label>
          <a
            class="group relative block aspect-4/3 overflow-hidden bg-gray-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary dark:bg-immich-dark-gray"
            href={`/photos/${observation.sourceAssetId}`}
            aria-label={`Open ${observation.filename || 'unknown Pet photo'}`}
          >
            {#if unreadableObservations.has(observation.observationId)}
              <span class="flex size-full flex-col items-center justify-center gap-2 text-gray-400 dark:text-gray-500">
                <Icon icon={mdiImageOffOutline} size="28" />
                <span class="px-4 text-center text-xs">Preview unavailable</span>
              </span>
            {:else}
              <img
                class="size-full object-contain transition-transform duration-300 group-hover:scale-[1.015] motion-reduce:transition-none"
                src={getAssetMediaUrl({ id: observation.sourceAssetId, size: AssetMediaSize.Preview })}
                alt=""
                loading="lazy"
                onerror={() => unreadableObservations.add(observation.observationId)}
              />
              <span
                class="pointer-events-none absolute rounded-lg border-2 border-dashed border-white/90 bg-primary/5 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
                style={`left:${observation.box.x * 100}%;top:${observation.box.y * 100}%;width:${observation.box.w * 100}%;height:${observation.box.h * 100}%`}
                aria-hidden="true"
              ></span>
            {/if}
            <span
              class="absolute top-3 left-3 rounded-full bg-black/65 px-2.5 py-1 text-xs font-semibold text-white capitalize backdrop-blur-sm"
              >Possible {observation.speciesKind.replace('_', ' ')}</span
            >
          </a>
          <div class="grid min-w-0 gap-3 p-4">
            <div class="min-w-0">
              <p class="truncate font-semibold" title={observation.filename || 'Photo'}>
                {observation.filename || 'Photo'}
              </p>
              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {queueState === 'unknown' ? 'No identity cleared the matching threshold' : 'Ignored by you'}
              </p>
              <p class="mt-2 text-sm text-gray-600 dark:text-gray-300">
                {queueState === 'unknown'
                  ? 'Assign, ignore for later, or mark this detector result as a False Match.'
                  : 'Restore this detection to Unknown when you are ready to review it.'}
              </p>
            </div>
            {#if queueState === 'unknown'}
              <div class="grid grid-cols-3 gap-2">
                <button
                  class="min-h-10 rounded-xl bg-primary px-2 text-sm font-semibold text-white disabled:opacity-60"
                  type="button"
                  disabled={Boolean(reviewing)}
                  onclick={() => openAssignment([observation])}>Assign</button
                >
                <button
                  class="min-h-10 rounded-xl border border-gray-300 px-2 text-sm font-semibold disabled:opacity-60 dark:border-immich-dark-gray"
                  type="button"
                  disabled={Boolean(reviewing)}
                  onclick={() => void reviewItems([observation], 'ignore')}>Ignore</button
                >
                <button
                  class="min-h-10 rounded-xl border border-red-300 px-2 text-sm font-semibold text-red-700 disabled:opacity-60 dark:border-red-900 dark:text-red-300"
                  type="button"
                  disabled={Boolean(reviewing)}
                  onclick={() => void reviewItems([observation], 'reject')}>False Match</button
                >
              </div>
            {:else}
              <div class="grid grid-cols-2 gap-2">
                <button
                  class="min-h-10 rounded-xl bg-primary px-3 text-sm font-semibold text-white disabled:opacity-60"
                  type="button"
                  disabled={Boolean(reviewing)}
                  onclick={() => void reviewItems([observation], 'restore')}>Restore</button
                >
                <button
                  class="min-h-10 rounded-xl border border-red-300 px-3 text-sm font-semibold text-red-700 disabled:opacity-60 dark:border-red-900 dark:text-red-300"
                  type="button"
                  disabled={Boolean(reviewing)}
                  onclick={() => void reviewItems([observation], 'reject')}>False Match</button
                >
              </div>
            {/if}
          </div>
        </article>
      {/each}
    </div>
  {/if}
</section>

{#if assignmentObservation}
  <Modal
    title={assignmentObservations.length === 1
      ? `Assign possible ${assignmentObservation.speciesKind.replace('_', ' ')}`
      : `Assign ${assignmentObservations.length.toLocaleString()} detections`}
    icon={mdiPawOutline}
    size="medium"
    onOpenAutoFocus={(event) => {
      event.preventDefault();
      requestAnimationFrame(() => assignmentSearchInput?.focus());
    }}
    onClose={closeAssignment}
  >
    <ModalBody>
      <div class="grid gap-5 py-4">
        <div
          class="grid gap-4 rounded-2xl border border-gray-200 bg-gray-50 p-3 sm:grid-cols-[9rem_minmax(0,1fr)] dark:border-immich-dark-gray dark:bg-immich-dark-gray/35"
        >
          <a
            class="relative block aspect-4/3 overflow-hidden rounded-xl bg-gray-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:bg-gray-800"
            href={`/photos/${assignmentObservation.sourceAssetId}`}
            aria-label={`Open ${assignmentObservation.filename || 'unknown Pet photo'}`}
          >
            <img
              class="size-full object-contain"
              src={getAssetMediaUrl({ id: assignmentObservation.sourceAssetId, size: AssetMediaSize.Preview })}
              alt=""
            />
            <span
              class="pointer-events-none absolute rounded-md border-2 border-dashed border-white/90 bg-primary/5 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
              style={`left:${assignmentObservation.box.x * 100}%;top:${assignmentObservation.box.y * 100}%;width:${assignmentObservation.box.w * 100}%;height:${assignmentObservation.box.h * 100}%`}
              aria-hidden="true"
            ></span>
          </a>
          <div class="min-w-0 self-center">
            <p class="truncate font-semibold" title={assignmentObservation.filename}>
              {assignmentObservation.filename || 'Photo'}
            </p>
            <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {assignmentObservations.length === 1
                ? `The detector found a ${assignmentObservation.speciesKind.replace('_', ' ')}. You decide the identity.`
                : `This preview represents ${assignmentObservations.length.toLocaleString()} selected detections. They will all be assigned to the same Pet.`}
            </p>
          </div>
        </div>

        <Field
          label="Species"
          description={assignmentObservations.length === 1
            ? `Detected as ${assignmentObservation.speciesKind.replace('_', ' ')} · change this if the detector is wrong`
            : 'Choose the owner-correct species for every selected detection'}
        >
          <Select bind:value={createSpeciesKind} options={speciesOptions} />
        </Field>

        <div
          class="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1 dark:bg-immich-dark-gray"
          role="tablist"
          aria-label="Pet assignment destination"
        >
          <button
            class={[
              'min-h-10 rounded-lg px-3 text-sm font-semibold transition-colors',
              assignmentMode === 'existing'
                ? 'bg-white text-primary shadow-sm dark:bg-black/25 dark:text-immich-dark-primary'
                : 'text-gray-500 hover:text-immich-fg dark:text-gray-400 dark:hover:text-immich-dark-fg',
            ]}
            type="button"
            role="tab"
            aria-selected={assignmentMode === 'existing'}
            onclick={() => {
              selectAssignmentMode('existing');
              requestAnimationFrame(() => assignmentSearchInput?.focus());
            }}>Move to</button
          >
          <button
            class={[
              'min-h-10 rounded-lg px-3 text-sm font-semibold transition-colors',
              assignmentMode === 'new'
                ? 'bg-white text-primary shadow-sm dark:bg-black/25 dark:text-immich-dark-primary'
                : 'text-gray-500 hover:text-immich-fg dark:text-gray-400 dark:hover:text-immich-dark-fg',
            ]}
            type="button"
            role="tab"
            aria-selected={assignmentMode === 'new'}
            onclick={() => {
              selectAssignmentMode('new');
              requestAnimationFrame(() => createNameInput?.focus());
            }}>Create new</button
          >
        </div>

        {#if assignmentMode === 'existing'}
          <div class="grid gap-3" role="tabpanel">
            <label
              class="flex min-h-11 items-center gap-2 rounded-xl border border-gray-200 px-3 focus-within:border-primary dark:border-immich-dark-gray"
            >
              <Icon icon={mdiMagnify} size="18" class="text-gray-500" />
              <input
                bind:this={assignmentSearchInput}
                bind:value={assignmentQuery}
                class="min-w-0 flex-1 bg-transparent text-sm outline-none"
                type="search"
                placeholder="Search compatible pets"
                aria-label="Search compatible pets"
              />
            </label>
            <div class="grid max-h-72 gap-2 overflow-y-auto pr-1">
              {#each compatiblePets as pet (pet.petId)}
                <button
                  class={[
                    'flex min-h-16 items-center gap-3 rounded-xl border p-2 text-left transition-colors',
                    assignmentPetId === pet.petId
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'border-gray-200 hover:border-primary/60 dark:border-immich-dark-gray',
                  ]}
                  type="button"
                  aria-pressed={assignmentPetId === pet.petId}
                  onclick={() => (assignmentPetId = pet.petId)}
                >
                  <span class="flex size-12 shrink-0 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                    {#if petVisualStyle(pet)}<span
                        class="block size-full bg-cover bg-center"
                        style={petVisualStyle(pet)}
                      ></span>{:else}<span
                        class="flex size-full items-center justify-center text-gray-500 dark:text-gray-300"
                        ><Icon icon={getPetPresentation(pet).icon} size="23" /></span
                      >{/if}
                  </span>
                  <span class="min-w-0 flex-1"
                    ><span class="block truncate font-semibold">{pet.displayName}</span><span
                      class="block truncate text-xs text-gray-500 dark:text-gray-400"
                      >{pet.breedLabel || `${pet.confirmedMediaCount.toLocaleString()} photos`}</span
                    ></span
                  >
                  {#if assignmentPetId === pet.petId}<span
                      class="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-white"
                      ><Icon icon={mdiCheck} size="17" /></span
                    >{/if}
                </button>
              {:else}
                <CimmichStatePanel
                  title={assignmentQuery ? 'No matching pets' : 'No compatible pets yet'}
                  description={assignmentQuery
                    ? 'Try another name or switch to Create new.'
                    : `Create the first ${(createSpeciesKind || assignmentObservation.speciesKind).replace('_', ' ')} Pet for this selection.`}
                />
              {/each}
            </div>
          </div>
        {:else}
          <div class="grid gap-4" role="tabpanel">
            <Field label="Name"
              ><Input bind:value={createName} bind:ref={createNameInput} required maxlength={160} /></Field
            >
            {#if createSpeciesKind === 'other'}<Field label="Species name" description="Optional"
                ><Input bind:value={createSpeciesLabel} maxlength={80} placeholder="For example, axolotl" /></Field
              >{/if}
            <Field label="Aliases" description="Optional · comma-separated"
              ><Input bind:value={createAliases} placeholder="Nickname, former name" /></Field
            >
            <Field label="Breed" description="Optional · entered by you"
              ><Input bind:value={createBreedLabel} maxlength={120} placeholder="For example, Border Collie" /></Field
            >
            <Field label="About" description="Optional"
              ><Textarea
                bind:value={createDescription}
                maxlength={2000}
                placeholder="A detail that helps you tell them apart"
              /></Field
            >
          </div>
        {/if}

        {#if formError}<p
            class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
            role="alert"
          >
            {formError}
          </p>{/if}
        {#if reviewError}<p
            class="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
            role="alert"
          >
            {errorCopy(reviewError)}
          </p>{/if}
      </div>
    </ModalBody>
    <ModalFooter class="flex justify-end gap-2">
      <button
        class="rounded-lg px-4 py-2 text-sm font-semibold hover:bg-gray-100 dark:hover:bg-immich-dark-gray"
        type="button"
        onclick={() => closeAssignment()}
        disabled={isCreating || Boolean(reviewing)}>Cancel</button
      >
      <button
        class="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
        type="button"
        disabled={isCreating || Boolean(reviewing)}
        onclick={() => void submitAssignment()}
      >
        <Icon icon={assignmentMode === 'existing' ? mdiCheck : mdiPlus} size="18" />
        {isCreating || reviewing
          ? 'Saving…'
          : assignmentMode === 'existing'
            ? assignmentObservations.length === 1
              ? 'Assign'
              : `Assign ${assignmentObservations.length}`
            : assignmentObservations.length === 1
              ? 'Create and assign'
              : `Create and assign ${assignmentObservations.length}`}
      </button>
    </ModalFooter>
  </Modal>
{/if}
