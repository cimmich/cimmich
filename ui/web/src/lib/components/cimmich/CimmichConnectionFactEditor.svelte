<script lang="ts">
  import {
    createCimmichConnectionModifier,
    createCimmichConnectionType,
    getCimmichConnectionModifiers,
    getCimmichConnectionTypes,
    recordCimmichConnectionFact,
    retractCimmichConnectionFact,
    type CimmichConnectionFact,
    type CimmichConnectionModifier,
    type CimmichConnectionTargetKind,
    type CimmichConnectionType,
  } from '$lib/services/cimmich-connection-facts.service';
  import {
    createCimmichContextCommandId,
    getCimmichContextEntities,
    type CimmichContextEntity,
  } from '$lib/services/cimmich.service';
  import { mdiClose, mdiPlus, mdiTagMultipleOutline, mdiTrashCanOutline } from '@mdi/js';
  import { Icon, toastManager } from '@immich/ui';
  import Combobox, { type ComboBoxOption } from '../shared-components/Combobox.svelte';
  import { formatCimmichConnectionFactLabel } from './connection-fact-label';

  let {
    facts,
    onchanged,
    onclose,
    personId,
    personName,
    targetId,
    targetKind,
    targetName,
  }: {
    facts: CimmichConnectionFact[];
    onchanged: () => void | Promise<void>;
    onclose: () => void;
    personId: string;
    personName: string;
    targetId: string;
    targetKind: CimmichConnectionTargetKind;
    targetName: string;
  } = $props();

  let types = $state<CimmichConnectionType[]>([]);
  let modifiers = $state<CimmichConnectionModifier[]>([]);
  let contexts = $state<CimmichContextEntity[]>([]);
  let selectedTypeId = $state('');
  let selectedModifierIds = $state<string[]>([]);
  let selectedContextIds = $state<string[]>([]);
  let selectedContextOption = $state<ComboBoxOption>();
  let editingFactId = $state('');
  let validity = $state<'current' | 'past'>('current');
  let dateStart = $state('');
  let dateEnd = $state('');
  let note = $state('');
  let errorMessage = $state('');
  let loading = $state(true);
  let saving = $state('');
  let customOpen = $state(false);
  let customLabel = $state('');
  let customInverseLabel = $state('');
  let customModifierOpen = $state(false);
  let customModifierLabel = $state('');

  const selectedType = $derived(types.find(({ typeId }) => typeId === selectedTypeId));
  const selectedModifiers = $derived(modifiers.filter(({ modifierId }) => selectedModifierIds.includes(modifierId)));
  const selectedContexts = $derived(contexts.filter(({ entityId }) => selectedContextIds.includes(entityId)));
  const availableContextOptions = $derived<ComboBoxOption[]>(
    contexts
      .filter(({ entityId }) => !selectedContextIds.includes(entityId))
      .map((context) => ({
        id: context.entityId,
        label: `${context.entityKind === 'place' ? 'Place' : context.entityKind === 'object' ? 'Thing' : context.typeKind === 'life_period' ? 'Life period' : context.typeKind === 'trip' ? 'Trip' : context.typeKind === 'activity' ? 'Activity' : 'Event'} · ${context.displayName}`,
        value: context.entityId,
      })),
  );
  const formerSelected = $derived(selectedModifiers.some(({ behavior }) => behavior === 'historical'));
  const recordLabel = $derived(
    formatCimmichConnectionFactLabel({
      label: selectedType?.label ?? 'connection',
      modifiers: selectedModifiers,
      pastLabel: selectedType?.pastLabel,
      validity: selectedType?.temporalMode === 'current_or_past' ? validity : 'current',
    }),
  );
  const targetFacts = $derived(facts.filter(({ other }) => other.kind === targetKind && other.id === targetId));

  $effect(() => {
    const kind = targetKind;
    loading = true;
    errorMessage = '';
    void Promise.all([
      getCimmichConnectionTypes(kind),
      getCimmichConnectionModifiers(),
      kind === 'person' ? getCimmichContextEntities('places', { limit: 500 }) : Promise.resolve([]),
      kind === 'person' ? getCimmichContextEntities('events', { limit: 500 }) : Promise.resolve([]),
      kind === 'person' ? getCimmichContextEntities('objects', { limit: 500 }) : Promise.resolve([]),
    ])
      .then(([items, modifierItems, places, events, objects]) => {
        if (kind !== targetKind) {
          return;
        }
        types = items;
        modifiers = modifierItems;
        contexts = [...places, ...events, ...objects].sort(
          (left, right) =>
            left.entityKind.localeCompare(right.entityKind) || left.displayName.localeCompare(right.displayName),
        );
        const existingFact = facts.find(({ other }) => other.kind === kind && other.id === targetId);
        if (existingFact) {
          editFact(existingFact);
        } else {
          selectedTypeId = items[0]?.typeId ?? '';
          selectedModifierIds = [];
          selectedContextIds = [];
          selectedContextOption = undefined;
          editingFactId = '';
          validity = 'current';
          dateStart = '';
          dateEnd = '';
          note = '';
        }
      })
      .catch((error) => {
        if (kind === targetKind) {
          errorMessage = error instanceof Error ? error.message : 'Unable to load connection types';
        }
      })
      .finally(() => {
        if (kind === targetKind) {
          loading = false;
        }
      });
  });

  const save = async () => {
    if (!selectedType) {
      return;
    }
    saving = 'save';
    errorMessage = '';
    try {
      await recordCimmichConnectionFact(personId, {
        commandId: createCimmichContextCommandId('connection-fact'),
        dateEnd: targetKind === 'place' || validity === 'past' ? dateEnd || null : null,
        dateStart: targetKind === 'place' || validity === 'past' ? dateStart || null : null,
        note,
        modifierIds: selectedModifierIds,
        contextIds: targetKind === 'person' ? selectedContextIds : undefined,
        targetId,
        targetKind,
        typeId: selectedType.typeId,
        validity: selectedType.temporalMode === 'current_or_past' ? validity : undefined,
      });
      note = '';
      dateStart = '';
      dateEnd = '';
      toastManager.success(
        `${editingFactId ? 'Updated' : 'Recorded'} ${recordLabel.toLocaleLowerCase()} for ${targetName}`,
      );
      editingFactId = '';
      await onchanged();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Unable to record this connection';
    } finally {
      saving = '';
    }
  };

  const remove = async (fact: CimmichConnectionFact) => {
    saving = fact.factId;
    errorMessage = '';
    try {
      await retractCimmichConnectionFact(personId, fact.factId, createCimmichContextCommandId('connection-retract'));
      toastManager.success(`Removed ${fact.displayLabel.toLocaleLowerCase()}`);
      await onchanged();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Unable to remove this recorded connection';
    } finally {
      saving = '';
    }
  };

  const createCustom = async () => {
    const label = customLabel.trim();
    if (!label) {
      return;
    }
    saving = 'custom';
    errorMessage = '';
    try {
      const result = await createCimmichConnectionType({
        commandId: createCimmichContextCommandId('connection-type'),
        inverseLabel: customInverseLabel.trim() || label,
        label,
        symmetric: targetKind === 'person' && (!customInverseLabel.trim() || customInverseLabel.trim() === label),
        targetKind,
        temporalMode: targetKind === 'person' ? 'current_or_past' : 'none',
      });
      types = [...types, result.type].sort((left, right) => left.label.localeCompare(right.label));
      selectedTypeId = result.type.typeId;
      customLabel = '';
      customInverseLabel = '';
      customOpen = false;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Unable to create this connection type';
    } finally {
      saving = '';
    }
  };

  const toggleModifier = (modifier: CimmichConnectionModifier) => {
    const selected = selectedModifierIds.includes(modifier.modifierId);
    selectedModifierIds = selected
      ? selectedModifierIds.filter((modifierId) => modifierId !== modifier.modifierId)
      : [...selectedModifierIds, modifier.modifierId];
    if (modifier.behavior === 'historical') {
      validity = selected ? 'current' : 'past';
      if (selected) {
        dateStart = '';
        dateEnd = '';
      }
    }
  };

  function editFact(fact: CimmichConnectionFact) {
    editingFactId = fact.factId;
    selectedTypeId = fact.typeId;
    selectedModifierIds = fact.modifiers.map(({ modifierId }) => modifierId);
    selectedContextIds = (fact.contexts ?? []).map(({ id }) => id);
    selectedContextOption = undefined;
    validity = fact.validity === 'past' ? 'past' : 'current';
    dateStart = fact.dateStart ?? '';
    dateEnd = fact.dateEnd ?? '';
    note = fact.note ?? '';
  }

  const createCustomModifier = async () => {
    const label = customModifierLabel.trim();
    if (!label) {
      return;
    }
    saving = 'custom-modifier';
    errorMessage = '';
    try {
      const result = await createCimmichConnectionModifier({
        commandId: createCimmichContextCommandId('connection-modifier'),
        label,
      });
      if (!modifiers.some(({ modifierId }) => modifierId === result.modifier.modifierId)) {
        modifiers = [...modifiers, result.modifier].sort((left, right) => left.label.localeCompare(right.label));
      }
      if (!selectedModifierIds.includes(result.modifier.modifierId)) {
        selectedModifierIds = [...selectedModifierIds, result.modifier.modifierId];
      }
      customModifierLabel = '';
      customModifierOpen = false;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Unable to create this modifier';
    } finally {
      saving = '';
    }
  };

  const linkContext = (option?: ComboBoxOption) => {
    if (option && !selectedContextIds.includes(option.value)) {
      selectedContextIds = [...selectedContextIds, option.value];
    }
    selectedContextOption = undefined;
  };
</script>

<section
  class="grid gap-4 rounded-2xl border border-primary/30 bg-primary/5 p-4 sm:p-5 dark:bg-primary/10"
  aria-label={`Describe ${targetName}'s connection to ${personName}`}
>
  <header class="flex items-start gap-3">
    <span class="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
      <Icon icon={mdiTagMultipleOutline} size="22" />
    </span>
    <div class="min-w-0 flex-1">
      <h3 class="font-semibold">How is {targetName} connected to {personName}?</h3>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
        Record one or more facts. These labels appear here, on the other profile, and in Discover.
      </p>
    </div>
    <button
      class="flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10"
      type="button"
      aria-label="Close connection editor"
      onclick={onclose}><Icon icon={mdiClose} size="20" /></button
    >
  </header>

  {#if targetFacts.length > 0}
    <div class="flex flex-wrap gap-2" aria-label="Recorded connections">
      {#each targetFacts as fact (fact.factId)}
        <span
          class="inline-flex min-h-10 items-center gap-2 rounded-full border border-primary/30 bg-white px-3 text-sm font-medium dark:bg-immich-dark-bg"
        >
          <button
            class="min-h-8 rounded-full text-left hover:text-primary"
            type="button"
            aria-label={`Edit ${fact.displayLabel}`}
            onclick={() => editFact(fact)}
          >
            {fact.displayLabel}
            {#if fact.contexts && fact.contexts.length > 0}
              <span class="font-normal text-gray-500"
                >at {fact.contexts.map(({ displayName }) => displayName).join(', ')}</span
              >
            {/if}
            {#if fact.dateStart || fact.dateEnd}
              <span class="font-normal text-gray-500">{fact.dateStart || '…'}–{fact.dateEnd || 'now'}</span>
            {/if}
          </button>
          <button
            class="flex size-8 items-center justify-center rounded-full text-gray-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-50 dark:hover:bg-red-950"
            type="button"
            aria-label={`Remove ${fact.displayLabel}`}
            disabled={Boolean(saving)}
            onclick={() => void remove(fact)}><Icon icon={mdiTrashCanOutline} size="16" /></button
          >
        </span>
      {/each}
    </div>
  {/if}

  {#if loading}
    <p class="text-sm text-gray-500">Loading connection types…</p>
  {:else}
    <div class="flex flex-wrap gap-2" aria-label="Connection type">
      {#each types as type (type.typeId)}
        <button
          class={`min-h-10 rounded-full border px-3 text-sm font-medium transition ${
            selectedTypeId === type.typeId
              ? 'border-primary bg-primary text-white dark:text-black'
              : 'border-gray-300 bg-white hover:border-primary dark:border-gray-700 dark:bg-immich-dark-bg'
          }`}
          type="button"
          aria-pressed={selectedTypeId === type.typeId}
          onclick={() => {
            selectedTypeId = type.typeId;
            editingFactId = '';
          }}>{type.label}</button
        >
      {/each}
      <button
        class="inline-flex min-h-10 items-center gap-1 rounded-full border border-dashed border-gray-400 px-3 text-sm font-medium hover:border-primary hover:text-primary"
        type="button"
        aria-expanded={customOpen}
        onclick={() => (customOpen = !customOpen)}><Icon icon={mdiPlus} size="17" /> Create your own</button
      >
    </div>

    {#if customOpen}
      <div
        class="grid gap-3 rounded-xl border border-gray-200 bg-white p-3 sm:grid-cols-2 dark:border-gray-700 dark:bg-immich-dark-bg"
      >
        <label class="grid gap-1 text-sm font-medium">
          Label from {personName}
          <input
            class="min-h-11 rounded-lg border border-gray-300 bg-transparent px-3 dark:border-gray-700"
            bind:value={customLabel}
            placeholder="e.g. Mentor"
            maxlength="80"
          />
        </label>
        <label class="grid gap-1 text-sm font-medium">
          Label from {targetName} <span class="font-normal text-gray-500">(optional)</span>
          <input
            class="min-h-11 rounded-lg border border-gray-300 bg-transparent px-3 dark:border-gray-700"
            bind:value={customInverseLabel}
            placeholder="Same label"
            maxlength="80"
          />
        </label>
        <button
          class="min-h-11 rounded-lg bg-gray-900 px-4 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2 sm:justify-self-start dark:bg-white dark:text-black"
          type="button"
          disabled={!customLabel.trim() || Boolean(saving)}
          onclick={() => void createCustom()}
        >
          {saving === 'custom' ? 'Creating…' : 'Create and select'}
        </button>
      </div>
    {/if}

    <div class="grid gap-2">
      <div>
        <p class="text-sm font-medium">Modifiers <span class="font-normal text-gray-500">(optional)</span></p>
        <p class="text-xs text-gray-500 dark:text-gray-400">
          Add reusable context without creating another relationship type.
        </p>
      </div>
      <div class="flex flex-wrap gap-2" aria-label="Connection modifiers">
        {#each modifiers.filter(({ behavior }) => targetKind === 'person' || behavior !== 'historical') as modifier (modifier.modifierId)}
          <button
            class={`min-h-10 rounded-full border px-3 text-sm font-medium transition ${
              selectedModifierIds.includes(modifier.modifierId)
                ? 'border-primary bg-primary/15 text-primary'
                : 'border-gray-300 bg-white hover:border-primary dark:border-gray-700 dark:bg-immich-dark-bg'
            }`}
            type="button"
            aria-label={modifier.behavior === 'historical' ? 'Former relationship' : `${modifier.label} modifier`}
            aria-pressed={selectedModifierIds.includes(modifier.modifierId)}
            onclick={() => toggleModifier(modifier)}>{modifier.label}</button
          >
        {/each}
        <button
          class="inline-flex min-h-10 items-center gap-1 rounded-full border border-dashed border-gray-400 px-3 text-sm font-medium hover:border-primary hover:text-primary"
          type="button"
          aria-expanded={customModifierOpen}
          onclick={() => (customModifierOpen = !customModifierOpen)}
          ><Icon icon={mdiPlus} size="17" /> Create modifier</button
        >
      </div>
    </div>

    {#if customModifierOpen}
      <div
        class="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-immich-dark-bg"
      >
        <label class="grid min-w-52 flex-1 gap-1 text-sm font-medium">
          Modifier name
          <input
            class="min-h-11 rounded-lg border border-gray-300 bg-transparent px-3 dark:border-gray-700"
            bind:value={customModifierLabel}
            placeholder="e.g. Childhood or School"
            maxlength="64"
          />
        </label>
        <button
          class="min-h-11 rounded-lg bg-gray-900 px-4 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
          type="button"
          disabled={!customModifierLabel.trim() || Boolean(saving)}
          onclick={() => void createCustomModifier()}
        >
          {saving === 'custom-modifier' ? 'Creating…' : 'Create and apply'}
        </button>
      </div>
    {/if}

    {#if targetKind === 'person'}
      <div class="grid gap-2">
        <div>
          <p class="text-sm font-medium">Linked context <span class="font-normal text-gray-500">(optional)</span></p>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            Record where or during what this relationship applied. The same context can connect several People.
          </p>
        </div>
        {#if selectedContexts.length > 0}
          <div class="flex flex-wrap gap-2" aria-label="Linked relationship contexts">
            {#each selectedContexts as context (context.entityId)}
              <span
                class="inline-flex min-h-10 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 pr-1 pl-3 text-sm font-medium"
              >
                {context.displayName}
                <button
                  class="flex size-8 items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10"
                  type="button"
                  aria-label={`Unlink ${context.displayName}`}
                  onclick={() => (selectedContextIds = selectedContextIds.filter((id) => id !== context.entityId))}
                  ><Icon icon={mdiClose} size="16" /></button
                >
              </span>
            {/each}
          </div>
        {/if}
        <div class="sm:max-w-xl">
          <Combobox
            label="Link a Place, event, life period or thing"
            options={availableContextOptions}
            bind:selectedOption={selectedContextOption}
            placeholder={availableContextOptions.length === 0
              ? 'No more contexts available'
              : 'Type to find a context…'}
            disabled={availableContextOptions.length === 0}
            clearSelectionOnInput
            onSelect={linkContext}
          />
        </div>
      </div>
    {/if}

    {#if selectedType?.temporalMode === 'current_or_past' && (targetKind === 'place' || formerSelected)}
      <div
        class={targetKind === 'person'
          ? 'grid gap-3 sm:grid-cols-2'
          : 'grid gap-3 sm:grid-cols-[auto_1fr_1fr] sm:items-end'}
      >
        {#if targetKind === 'place'}
          <fieldset
            class="grid min-h-11 grid-cols-2 items-stretch gap-1 rounded-lg border border-gray-300 p-1 dark:border-gray-700"
          >
            <legend class="sr-only">Relationship time</legend>
            <button
              class={`min-h-9 rounded-md px-3 text-left text-sm transition ${validity === 'current' ? 'bg-primary text-white dark:text-black' : 'hover:bg-black/5 dark:hover:bg-white/10'}`}
              type="button"
              aria-label={`Current: ${selectedType.label}`}
              aria-pressed={validity === 'current'}
              onclick={() => (validity = 'current')}
            >
              <span class="block text-[11px] font-medium tracking-wide uppercase opacity-75">Current</span>
              <span class="block font-medium whitespace-nowrap">{selectedType.label}</span>
            </button>
            <button
              class={`min-h-9 rounded-md px-3 text-left text-sm transition ${validity === 'past' ? 'bg-primary text-white dark:text-black' : 'hover:bg-black/5 dark:hover:bg-white/10'}`}
              type="button"
              aria-label={`Past: ${selectedType.pastLabel || selectedType.label}`}
              aria-pressed={validity === 'past'}
              onclick={() => (validity = 'past')}
            >
              <span class="block text-[11px] font-medium tracking-wide uppercase opacity-75">Past</span>
              <span class="block font-medium whitespace-nowrap">{selectedType.pastLabel || selectedType.label}</span>
            </button>
          </fieldset>
        {/if}
        {#if targetKind === 'place' || formerSelected}
          <label class="grid gap-1 text-xs font-medium text-gray-500"
            >From <input
              class="min-h-11 rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-black dark:border-gray-700 dark:text-white"
              type="date"
              bind:value={dateStart}
            /></label
          >
          <label class="grid gap-1 text-xs font-medium text-gray-500"
            >To <input
              class="min-h-11 rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-black dark:border-gray-700 dark:text-white"
              type="date"
              bind:value={dateEnd}
            /></label
          >
        {/if}
      </div>
      {#if targetKind === 'person' && formerSelected}
        <p class="text-xs text-gray-500 dark:text-gray-400">
          Former makes this relationship historical. Dates are optional.
        </p>
      {/if}
    {/if}

    <label class="grid gap-1 text-sm font-medium">
      Note <span class="font-normal text-gray-500">(optional)</span>
      <input
        class="min-h-11 rounded-lg border border-gray-300 bg-white px-3 dark:border-gray-700 dark:bg-immich-dark-bg"
        bind:value={note}
        maxlength="500"
        placeholder="Anything useful about this connection"
      />
    </label>

    <button
      class="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50 sm:justify-self-start dark:text-black"
      type="button"
      disabled={!selectedType || Boolean(saving)}
      onclick={() => void save()}
      >{saving === 'save'
        ? editingFactId
          ? 'Updating…'
          : 'Recording…'
        : `${editingFactId ? 'Update' : 'Record'} ${recordLabel}`}</button
    >
  {/if}

  {#if errorMessage}
    <p
      class="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
      role="alert"
    >
      {errorMessage}
    </p>
  {/if}
</section>
