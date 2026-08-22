<script lang="ts">
  import {
    attachCimmichContextRelations,
    createCimmichContextCommandId,
    createCimmichContextEntity,
    getCimmichContextEntities,
    type CimmichContextEntity,
    type CimmichContextFamily,
    type CimmichContextTypeKind,
  } from '$lib/services/cimmich.service';
  import {
    getCimmichConnectionTypes,
    recordCimmichConnectionFact,
    type CimmichConnectionType,
  } from '$lib/services/cimmich-connection-facts.service';
  import { mdiClose, mdiPlus } from '@mdi/js';
  import { Icon } from '@immich/ui';
  import Combobox, { type ComboBoxOption } from '../shared-components/Combobox.svelte';

  export type CimmichPersonConnectionAddKind = 'activity' | 'event' | 'life_period' | 'object' | 'place' | 'trip';

  interface Props {
    onchanged: (personId: string) => Promise<void> | void;
    open?: boolean;
    personId: string;
    personName: string;
    selectedKind?: CimmichPersonConnectionAddKind;
    showTrigger?: boolean;
  }

  const addKinds: Array<{
    family: CimmichContextFamily;
    id: CimmichPersonConnectionAddKind;
    label: string;
    typeKind: CimmichContextTypeKind;
  }> = [
    { family: 'events', id: 'event', label: 'Event', typeKind: 'event' },
    { family: 'events', id: 'life_period', label: 'Life period', typeKind: 'life_period' },
    { family: 'events', id: 'trip', label: 'Trip', typeKind: 'trip' },
    { family: 'events', id: 'activity', label: 'Activity', typeKind: 'activity' },
    { family: 'places', id: 'place', label: 'Place', typeKind: 'point' },
    { family: 'objects', id: 'object', label: 'Thing', typeKind: 'other' },
  ];

  let {
    onchanged,
    open = $bindable(false),
    personId,
    personName,
    selectedKind = $bindable('event'),
    showTrigger = true,
  }: Props = $props();
  let busy = $state(false);
  let createDateEnd = $state('');
  let createDateStart = $state('');
  let createName = $state('');
  let entities = $state<CimmichContextEntity[]>([]);
  let connectionTypes = $state<CimmichConnectionType[]>([]);
  let entitiesLoading = $state(false);
  let errorMessage = $state('');
  let entityLoadGeneration = 0;
  let mode = $state<'existing' | 'new'>('existing');
  let selectedEntityId = $state('');
  let selectedEntityOption = $state<ComboBoxOption>();
  let selectedConnectionTypeId = $state('');
  let selectedConnectionTypeOption = $state<ComboBoxOption>();
  let successMessage = $state('');
  let pendingCreated = $state<{ entityId: string; family: CimmichContextFamily; key: string }>();
  let loadedKind = $state('');

  const kind = $derived(addKinds.find(({ id }) => id === selectedKind) ?? addKinds[0]);
  const matchingEntities = $derived(
    entities.filter(({ typeKind }) => ['object', 'place'].includes(kind.id) || typeKind === kind.typeKind),
  );
  const entityOptions = $derived<ComboBoxOption[]>(
    matchingEntities.map(({ displayName, entityId }) => ({ id: entityId, label: displayName, value: entityId })),
  );
  const connectionTypeOptions = $derived<ComboBoxOption[]>(
    connectionTypes.map(({ label, typeId }) => ({ id: typeId, label, value: typeId })),
  );
  const usesConnectionFact = $derived(kind.id === 'place' || kind.id === 'object');
  const kindArticle = $derived(['activity', 'event'].includes(kind.id) ? 'an' : 'a');
  const creationKey = () =>
    [kind.family, kind.typeKind, createName.trim(), createDateStart, createDateEnd].join('\u0000');

  const loadEntities = async () => {
    const generation = ++entityLoadGeneration;
    const requestedKind = kind;
    entitiesLoading = true;
    errorMessage = '';
    try {
      const [result, typeResult] = await Promise.all([
        getCimmichContextEntities(requestedKind.family, { limit: 500 }),
        requestedKind.id === 'place' || requestedKind.id === 'object'
          ? getCimmichConnectionTypes(requestedKind.id)
          : Promise.resolve([]),
      ]);
      if (generation !== entityLoadGeneration) {
        return;
      }
      entities = result;
      connectionTypes = typeResult;
      const firstEntity = result.find(
        ({ typeKind }) => ['object', 'place'].includes(requestedKind.id) || typeKind === requestedKind.typeKind,
      );
      selectedEntityId = firstEntity?.entityId ?? '';
      selectedEntityOption = firstEntity
        ? { id: firstEntity.entityId, label: firstEntity.displayName, value: firstEntity.entityId }
        : undefined;
      const firstType = typeResult[0];
      selectedConnectionTypeId = firstType?.typeId ?? '';
      selectedConnectionTypeOption = firstType
        ? { id: firstType.typeId, label: firstType.label, value: firstType.typeId }
        : undefined;
    } catch (error) {
      if (generation === entityLoadGeneration) {
        errorMessage = error instanceof Error ? error.message : 'Unable to load connections';
      }
    } finally {
      if (generation === entityLoadGeneration) {
        entitiesLoading = false;
      }
    }
  };

  const selectKind = (value: CimmichPersonConnectionAddKind) => {
    selectedKind = value;
    loadedKind = value;
    selectedEntityId = '';
    selectedEntityOption = undefined;
    selectedConnectionTypeId = '';
    selectedConnectionTypeOption = undefined;
    pendingCreated = undefined;
    successMessage = '';
    void loadEntities();
  };

  const addConnection = async () => {
    if (mode === 'new' && !createName.trim()) {
      errorMessage = `Name the new ${kind.label.toLocaleLowerCase()}.`;
      return;
    }
    if (mode === 'existing' && !selectedEntityId) {
      errorMessage = `Choose an existing ${kind.label.toLocaleLowerCase()}.`;
      return;
    }
    if (usesConnectionFact && !selectedConnectionTypeId) {
      errorMessage = `Choose how ${personName} is connected to this ${kind.label.toLocaleLowerCase()}.`;
      return;
    }
    if (createDateStart && createDateEnd && createDateEnd < createDateStart) {
      errorMessage = 'End date cannot be before start date.';
      return;
    }
    if (createDateEnd && !createDateStart) {
      errorMessage = 'Choose a start date before adding an end date.';
      return;
    }
    busy = true;
    errorMessage = '';
    successMessage = '';
    try {
      let entityId = selectedEntityId;
      if (mode === 'new') {
        const key = creationKey();
        if (pendingCreated?.key === key && pendingCreated.family === kind.family) {
          entityId = pendingCreated.entityId;
        } else {
          const created = await createCimmichContextEntity(kind.family, {
            commandId: createCimmichContextCommandId(`person-${kind.id}-create`),
            ...(kind.family === 'events'
              ? {
                  dateEnd: createDateEnd || null,
                  datePrecision: createDateStart ? ('exact' as const) : ('unknown' as const),
                  dateStart: createDateStart || null,
                }
              : {}),
            displayName: createName.trim(),
            ...(kind.family === 'places' ? { placeRole: 'location' as const } : {}),
            typeKind: kind.typeKind,
          });
          entityId = created.detail?.entity.entityId ?? '';
          if (!entityId) {
            throw new Error(`The new ${kind.label.toLocaleLowerCase()} was created without a usable record`);
          }
          pendingCreated = { entityId, family: kind.family, key };
        }
      }
      await (kind.id === 'place' || kind.id === 'object'
        ? recordCimmichConnectionFact(personId, {
            commandId: createCimmichContextCommandId(`person-${kind.id}-connect`),
            targetId: entityId,
            targetKind: kind.id,
            typeId: selectedConnectionTypeId,
          })
        : attachCimmichContextRelations(
            kind.family,
            entityId,
            createCimmichContextCommandId(`person-${kind.id}-attach`),
            [{ relationKind: 'participant', targetId: personId, targetKind: 'person' }],
          ));
      await onchanged(personId);
      successMessage = `${personName} added to ${mode === 'new' ? createName.trim() : matchingEntities.find(({ entityId: id }) => id === entityId)?.displayName || kind.label}.`;
      createName = '';
      createDateStart = '';
      createDateEnd = '';
      pendingCreated = undefined;
      await loadEntities();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Unable to add this connection';
    } finally {
      busy = false;
    }
  };

  const show = () => {
    open = true;
    loadedKind = selectedKind;
    successMessage = '';
    errorMessage = '';
    void loadEntities();
  };

  $effect(() => {
    const requestedKind = open ? selectedKind : '';
    if (!requestedKind) {
      loadedKind = '';
    } else if (loadedKind !== requestedKind) {
      loadedKind = requestedKind;
      void loadEntities();
    }
  });
</script>

{#if !open && showTrigger}
  <button
    class="inline-flex min-h-11 w-fit items-center gap-2 justify-self-end rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary/90 dark:text-black"
    type="button"
    onclick={show}
  >
    <Icon icon={mdiPlus} size="18" />
    Add to
  </button>
{:else if open}
  <section
    class="grid w-full gap-4 rounded-2xl border border-gray-200 bg-white p-5 dark:border-immich-dark-gray dark:bg-immich-dark-bg"
    aria-labelledby="person-add-to-heading"
  >
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2 class="text-lg font-semibold" id="person-add-to-heading">Add {personName} to</h2>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Connect an existing context or create a new one here.
        </p>
      </div>
      <button
        class="flex size-11 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10"
        type="button"
        aria-label="Close Add to"
        onclick={() => (open = false)}><Icon icon={mdiClose} size="20" /></button
      >
    </div>

    <div class="flex flex-wrap gap-2" aria-label="Connection type">
      {#each addKinds as option (option.id)}
        <button
          class={`min-h-11 rounded-full border px-4 text-sm font-semibold ${selectedKind === option.id ? 'border-primary bg-primary/10 text-primary' : 'border-gray-300 hover:border-gray-500 dark:border-immich-dark-gray'}`}
          type="button"
          aria-pressed={selectedKind === option.id}
          onclick={() => selectKind(option.id)}>{option.label}</button
        >
      {/each}
    </div>

    <div
      class="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1 sm:w-fit dark:bg-white/5"
      role="tablist"
      aria-label="Add to method"
    >
      <button
        class={`min-h-11 rounded-lg px-4 text-sm font-semibold ${mode === 'existing' ? 'bg-white text-primary shadow-sm dark:bg-gray-800' : 'text-gray-600 dark:text-gray-300'}`}
        type="button"
        role="tab"
        aria-selected={mode === 'existing'}
        onclick={() => (mode = 'existing')}>Choose existing</button
      >
      <button
        class={`min-h-11 rounded-lg px-4 text-sm font-semibold ${mode === 'new' ? 'bg-white text-primary shadow-sm dark:bg-gray-800' : 'text-gray-600 dark:text-gray-300'}`}
        type="button"
        role="tab"
        aria-selected={mode === 'new'}
        onclick={() => (mode = 'new')}>Create new</button
      >
    </div>

    {#if mode === 'existing'}
      <div class="grid gap-3 sm:max-w-xl">
        <Combobox
          label={`Existing ${kind.label.toLocaleLowerCase()}`}
          options={entityOptions}
          bind:selectedOption={selectedEntityOption}
          placeholder={entitiesLoading
            ? 'Loading…'
            : matchingEntities.length === 0
              ? `No existing ${kind.label.toLocaleLowerCase()}s`
              : `Type to find ${kindArticle} ${kind.label.toLocaleLowerCase()}…`}
          disabled={entitiesLoading || matchingEntities.length === 0}
          defaultFirstOption
          clearSelectionOnInput
          onSelect={(option) => (selectedEntityId = option?.value ?? '')}
        />
      </div>
    {:else}
      <div class="grid gap-3 sm:max-w-2xl sm:grid-cols-2">
        <label class="grid gap-2 text-sm font-semibold sm:col-span-2">
          {kind.label} name
          <input
            class="min-h-11 rounded-lg border border-gray-300 bg-transparent px-3 font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-immich-dark-gray"
            maxlength="200"
            bind:value={createName}
            oninput={() => {
              errorMessage = '';
              pendingCreated = undefined;
            }}
          />
        </label>
        {#if kind.family === 'events'}
          <label class="grid gap-2 text-sm font-semibold">
            Start date <span class="font-normal text-gray-400">optional</span>
            <input
              class="min-h-11 rounded-lg border border-gray-300 bg-transparent px-3 font-normal dark:border-immich-dark-gray"
              type="date"
              bind:value={createDateStart}
              onchange={() => (pendingCreated = undefined)}
            />
          </label>
          <label class="grid gap-2 text-sm font-semibold">
            End date <span class="font-normal text-gray-400">optional</span>
            <input
              class="min-h-11 rounded-lg border border-gray-300 bg-transparent px-3 font-normal dark:border-immich-dark-gray"
              type="date"
              bind:value={createDateEnd}
              onchange={() => (pendingCreated = undefined)}
            />
          </label>
        {/if}
      </div>
    {/if}

    {#if usesConnectionFact}
      <div class="grid gap-1 sm:max-w-xl">
        <Combobox
          label={`How ${personName} is connected`}
          options={connectionTypeOptions}
          bind:selectedOption={selectedConnectionTypeOption}
          placeholder={entitiesLoading ? 'Loading…' : 'Type to find a relationship…'}
          disabled={entitiesLoading || connectionTypes.length === 0}
          defaultFirstOption
          clearSelectionOnInput
          onSelect={(option) => (selectedConnectionTypeId = option?.value ?? '')}
        />
        <p class="text-xs text-gray-500 dark:text-gray-400">
          You can add dates, modifiers, or a custom relationship from Connections after recording it.
        </p>
      </div>
    {/if}

    {#if errorMessage}<p class="text-sm font-medium text-red-600 dark:text-red-300" role="alert">{errorMessage}</p>{/if}
    {#if successMessage}<p class="text-sm font-medium text-emerald-700 dark:text-emerald-300" role="status">
        {successMessage}
      </p>{/if}

    <div class="flex justify-end">
      <button
        class="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50 dark:text-black"
        type="button"
        disabled={busy || entitiesLoading}
        onclick={() => void addConnection()}
      >
        {busy
          ? 'Adding…'
          : mode === 'new'
            ? `Create ${kind.label.toLocaleLowerCase()} & add`
            : `Add to ${kind.label.toLocaleLowerCase()}`}
      </button>
    </div>
  </section>
{/if}
