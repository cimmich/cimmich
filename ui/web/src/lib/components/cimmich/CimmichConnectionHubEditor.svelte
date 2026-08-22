<script lang="ts">
  import {
    getCimmichConnectionModifiers,
    getCimmichConnectionTypes,
    recordCimmichConnectionHub,
    type CimmichConnectionHubKind,
    type CimmichConnectionModifier,
    type CimmichConnectionType,
  } from '$lib/services/cimmich-connection-facts.service';
  import {
    createCimmichContextCommandId,
    getCimmichContextEntities,
    getCimmichPeople,
    type CimmichContextEntity,
    type CimmichPerson,
  } from '$lib/services/cimmich.service';
  import { mdiAccountGroupOutline, mdiBriefcaseOutline, mdiClose, mdiHomeOutline } from '@mdi/js';
  import { Icon, toastManager } from '@immich/ui';
  import { onMount } from 'svelte';
  import { formatCimmichConnectionFactLabel } from './connection-fact-label';

  interface Props {
    onchanged: () => Promise<void> | void;
    onclose: () => void;
    personId: string;
    personName: string;
  }

  type MemberDraft = {
    dateEnd: string;
    dateStart: string;
    modifierIds: string[];
    typeId: string;
    validity: 'current' | 'past';
  };

  const hubMeta: Record<
    CimmichConnectionHubKind,
    { family: 'objects' | 'places'; icon: string; label: string; role: string; targetKind: 'object' | 'place' }
  > = {
    employer: {
      family: 'objects',
      icon: mdiBriefcaseOutline,
      label: 'Employer',
      role: 'works_for',
      targetKind: 'object',
    },
    group: {
      family: 'objects',
      icon: mdiAccountGroupOutline,
      label: 'Group',
      role: 'member_of',
      targetKind: 'object',
    },
    home: { family: 'places', icon: mdiHomeOutline, label: 'Home', role: 'lives_at', targetKind: 'place' },
  };
  const hubKinds = Object.keys(hubMeta) as CimmichConnectionHubKind[];

  let { onchanged, onclose, personId, personName }: Props = $props();
  let hubKind = $state<CimmichConnectionHubKind>('home');
  let mode = $state<'existing' | 'new'>('new');
  let displayName = $state('');
  let hubEntityId = $state('');
  let people = $state<CimmichPerson[]>([]);
  let hubs = $state<CimmichContextEntity[]>([]);
  let types = $state<CimmichConnectionType[]>([]);
  let modifiers = $state<CimmichConnectionModifier[]>([]);
  let selectedPersonIds = $state<string[]>([personId]);
  let drafts = $state<Record<string, MemberDraft>>({});
  let query = $state('');
  let loading = $state(true);
  let busy = $state(false);
  let reviewing = $state(false);
  let errorMessage = $state('');
  let generation = 0;

  const currentMeta = $derived(hubMeta[hubKind]);
  const selectedPeople = $derived(
    selectedPersonIds
      .map((id) =>
        id === personId
          ? (people.find(({ person_id }) => person_id === id) ??
            ({ display_name: personName, person_id: id } as CimmichPerson))
          : people.find(({ person_id }) => person_id === id),
      )
      .filter(Boolean) as CimmichPerson[],
  );
  const visiblePeople = $derived(
    people
      .filter(({ person_id: id, subject_kind }) => id !== personId && subject_kind === 'person')
      .filter(({ display_name }) => display_name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
      .slice(0, 12),
  );
  const qualifierModifiers = $derived(modifiers.filter(({ behavior }) => behavior === 'qualifier'));
  const selectedHub = $derived(hubs.find(({ entityId }) => entityId === hubEntityId));

  const defaultTypeId = () =>
    types.find(({ semanticKind }) => semanticKind === currentMeta.role)?.typeId ?? types[0]?.typeId ?? '';
  const draftFor = (id: string) =>
    drafts[id] ?? {
      dateEnd: '',
      dateStart: '',
      modifierIds: [],
      typeId: defaultTypeId(),
      validity: 'current' as const,
    };
  const draftLabel = (draft: MemberDraft, type: CimmichConnectionType | undefined) =>
    formatCimmichConnectionFactLabel({
      label: type?.label ?? 'Connection',
      modifiers: draft.modifierIds
        .map((id) => modifiers.find(({ modifierId }) => modifierId === id))
        .filter((modifier): modifier is CimmichConnectionModifier => modifier !== undefined),
      pastLabel: type?.pastLabel,
      validity: draft.validity,
    });
  const updateDraft = (id: string, value: Partial<MemberDraft>) => {
    drafts = { ...drafts, [id]: { ...draftFor(id), ...value } };
  };
  const resetDrafts = () => {
    drafts = Object.fromEntries(selectedPersonIds.map((id) => [id, { ...draftFor(id), typeId: defaultTypeId() }]));
  };

  const loadHubOptions = async (kind: CimmichConnectionHubKind) => {
    const requestGeneration = ++generation;
    loading = true;
    errorMessage = '';
    try {
      const meta = hubMeta[kind];
      const [nextPeople, nextHubs, nextTypes, nextModifiers] = await Promise.all([
        people.length > 0 ? Promise.resolve(people) : getCimmichPeople(500),
        getCimmichContextEntities(meta.family, { limit: 500 }),
        getCimmichConnectionTypes(meta.targetKind),
        modifiers.length > 0 ? Promise.resolve(modifiers) : getCimmichConnectionModifiers(),
      ]);
      if (requestGeneration !== generation) {
        return;
      }
      people = nextPeople;
      hubs = nextHubs.filter(({ typeKind }) =>
        kind === 'home' ? true : typeKind === (kind === 'employer' ? 'organisation' : 'group'),
      );
      types = nextTypes;
      modifiers = nextModifiers;
      hubEntityId = hubs[0]?.entityId ?? '';
      resetDrafts();
    } catch (error) {
      if (requestGeneration === generation) {
        errorMessage = error instanceof Error ? error.message : 'Unable to load connection hubs';
      }
    } finally {
      if (requestGeneration === generation) {
        loading = false;
      }
    }
  };

  const chooseHubKind = (kind: CimmichConnectionHubKind) => {
    hubKind = kind;
    reviewing = false;
    displayName = '';
    hubEntityId = '';
    void loadHubOptions(kind);
  };
  const togglePerson = (id: string) => {
    if (selectedPersonIds.includes(id)) {
      selectedPersonIds = selectedPersonIds.filter((personId_) => personId_ !== id);
      const { [id]: _, ...remaining } = drafts;
      drafts = remaining;
    } else {
      selectedPersonIds = [...selectedPersonIds, id];
      updateDraft(id, { typeId: defaultTypeId() });
    }
    reviewing = false;
  };
  const toggleModifier = (id: string, modifierId: string) => {
    const draft = draftFor(id);
    updateDraft(id, {
      modifierIds: draft.modifierIds.includes(modifierId)
        ? draft.modifierIds.filter((candidate) => candidate !== modifierId)
        : [...draft.modifierIds, modifierId],
    });
  };
  const validate = () => {
    if (mode === 'new' ? !displayName.trim() : !hubEntityId) {
      return `Choose or name the ${currentMeta.label.toLowerCase()}.`;
    }
    if (selectedPeople.length < 2) {
      return 'Choose at least one other Person.';
    }
    for (const person of selectedPeople) {
      const draft = draftFor(person.person_id);
      if (!draft.typeId) {
        return `Choose ${person.display_name}'s role.`;
      }
      if (draft.dateStart && draft.dateEnd && draft.dateEnd < draft.dateStart) {
        return `${person.display_name}'s end date cannot be before the start date.`;
      }
    }
    return '';
  };
  const openReview = () => {
    errorMessage = validate();
    if (!errorMessage) {
      reviewing = true;
    }
  };
  const save = async () => {
    errorMessage = validate();
    if (errorMessage) {
      return;
    }
    busy = true;
    try {
      const result = await recordCimmichConnectionHub({
        commandId: createCimmichContextCommandId('connection-hub'),
        ...(mode === 'new' ? { displayName: displayName.trim() } : { hubEntityId }),
        hubKind,
        members: selectedPeople.map((person) => {
          const draft = draftFor(person.person_id);
          return {
            dateEnd: draft.dateEnd || null,
            dateStart: draft.dateStart || null,
            modifierIds: draft.modifierIds,
            personId: person.person_id,
            typeId: draft.typeId,
            validity: draft.validity,
          };
        }),
      });
      toastManager.success(`Connected ${result.members.length} people through ${result.hub.displayName}`);
      await onchanged();
      onclose();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Unable to record this shared connection';
    } finally {
      busy = false;
    }
  };

  onMount(() => void loadHubOptions(hubKind));
</script>

<section
  class="grid gap-4 rounded-3xl border border-primary/30 bg-primary/5 p-4 sm:p-5"
  aria-label="Add several people to a shared context"
>
  <header class="flex items-start gap-3">
    <div class="min-w-0 flex-1">
      <h2 class="text-base font-normal">Add several people</h2>
      <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
        Link people to the same home, employer or group, then review once.
      </p>
    </div>
    <button
      class="flex size-10 items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10"
      type="button"
      aria-label="Close shared hub editor"
      onclick={onclose}><Icon icon={mdiClose} size="20" /></button
    >
  </header>

  <div class="flex flex-wrap gap-2" aria-label="Hub type">
    {#each hubKinds as kind (kind)}
      <button
        class={[
          'inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 text-sm font-semibold',
          hubKind === kind
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-immich-dark-bg',
        ]}
        type="button"
        aria-pressed={hubKind === kind}
        onclick={() => chooseHubKind(kind)}><Icon icon={hubMeta[kind].icon} size="19" />{hubMeta[kind].label}</button
      >
    {/each}
  </div>

  {#if loading}
    <p class="text-sm text-gray-500">Loading people and roles…</p>
  {:else if !reviewing}
    <div class="grid gap-4">
      <div class="flex gap-2" role="tablist" aria-label="Hub source">
        <button
          class={[
            'min-h-10 rounded-xl px-4 text-sm font-semibold',
            mode === 'new' ? 'bg-primary text-white dark:text-black' : 'bg-white dark:bg-immich-dark-bg',
          ]}
          type="button"
          role="tab"
          aria-selected={mode === 'new'}
          onclick={() => (mode = 'new')}>Create new</button
        >
        <button
          class={[
            'min-h-10 rounded-xl px-4 text-sm font-semibold',
            mode === 'existing' ? 'bg-primary text-white dark:text-black' : 'bg-white dark:bg-immich-dark-bg',
          ]}
          type="button"
          role="tab"
          aria-selected={mode === 'existing'}
          onclick={() => (mode = 'existing')}>Use existing</button
        >
      </div>
      {#if mode === 'new'}
        <label class="grid gap-1 text-sm font-medium"
          >{currentMeta.label} name<input
            class="min-h-11 rounded-xl border border-gray-300 bg-white px-3 outline-none focus:border-primary dark:border-gray-700 dark:bg-immich-dark-bg"
            bind:value={displayName}
            maxlength="160"
            placeholder={hubKind === 'home'
              ? 'For example, 14 Rose Street'
              : hubKind === 'employer'
                ? 'For example, Community Studio'
                : 'For example, School friends'}
          /></label
        >
      {:else}
        <label class="grid gap-1 text-sm font-medium"
          >Existing {currentMeta.label.toLowerCase()}<select
            class="min-h-11 rounded-xl border border-gray-300 bg-white px-3 dark:border-gray-700 dark:bg-immich-dark-bg"
            bind:value={hubEntityId}
            ><option value="">Choose…</option>{#each hubs as hub (hub.entityId)}<option value={hub.entityId}
                >{hub.displayName}</option
              >{/each}</select
          ></label
        >
      {/if}

      <section class="grid gap-2" aria-labelledby="hub-people-heading">
        <div>
          <h3 class="font-semibold" id="hub-people-heading">People</h3>
          <p class="text-xs text-gray-500">{personName} is included. Choose everyone else who shares this hub.</p>
        </div>
        <input
          class="min-h-11 rounded-xl border border-gray-300 bg-white px-3 outline-none focus:border-primary dark:border-gray-700 dark:bg-immich-dark-bg"
          bind:value={query}
          aria-label="Search people for shared hub"
          placeholder="Search People"
        />
        <div
          class="grid max-h-52 gap-1 overflow-auto rounded-2xl border border-gray-200 bg-white p-2 sm:grid-cols-2 dark:border-gray-700 dark:bg-immich-dark-bg"
        >
          {#each visiblePeople as person (person.person_id)}
            <label
              class="flex min-h-10 cursor-pointer items-center gap-2 rounded-xl px-2 hover:bg-gray-100 dark:hover:bg-white/10"
              ><input
                type="checkbox"
                checked={selectedPersonIds.includes(person.person_id)}
                onchange={() => togglePerson(person.person_id)}
              /><span class="truncate text-sm font-medium">{person.display_name}</span></label
            >
          {/each}
        </div>
      </section>

      <section class="grid gap-3" aria-labelledby="hub-roles-heading">
        <div>
          <h3 class="font-semibold" id="hub-roles-heading">Roles and history</h3>
          <p class="text-xs text-gray-500">Each Person can have their own role, dates and modifiers.</p>
        </div>
        {#each selectedPeople as person (person.person_id)}
          {@const draft = draftFor(person.person_id)}
          <article
            class="grid gap-3 rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-immich-dark-bg"
          >
            <div class="flex items-center justify-between gap-2">
              <strong class="truncate text-sm">{person.display_name}</strong>{#if person.person_id === personId}<span
                  class="text-xs text-primary">Profile Person</span
                >{:else}<button
                  class="text-xs font-semibold text-red-600"
                  type="button"
                  onclick={() => togglePerson(person.person_id)}>Remove</button
                >{/if}
            </div>
            <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <label class="grid gap-1 text-xs font-medium"
                >Role<select
                  class="min-h-10 rounded-xl border border-gray-300 bg-white px-3 text-sm dark:border-gray-700 dark:bg-[#11141b]"
                  value={draft.typeId}
                  onchange={(event) => updateDraft(person.person_id, { typeId: event.currentTarget.value })}
                  >{#each types as type (type.typeId)}<option value={type.typeId}>{type.label}</option>{/each}</select
                ></label
              >
              <button
                class={[
                  'mt-auto min-h-10 rounded-xl border px-3 text-sm font-semibold',
                  draft.validity === 'past'
                    ? 'border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    : 'border-gray-300 dark:border-gray-700',
                ]}
                type="button"
                aria-pressed={draft.validity === 'past'}
                onclick={() =>
                  updateDraft(person.person_id, { validity: draft.validity === 'past' ? 'current' : 'past' })}
                >{draft.validity === 'past' ? 'Former' : 'Current'}</button
              >
            </div>
            <div class="grid gap-2 sm:grid-cols-2">
              <label class="grid gap-1 text-xs font-medium"
                >From<input
                  class="min-h-10 rounded-xl border border-gray-300 bg-white px-3 dark:border-gray-700 dark:bg-[#11141b]"
                  type="date"
                  value={draft.dateStart}
                  oninput={(event) => updateDraft(person.person_id, { dateStart: event.currentTarget.value })}
                /></label
              ><label class="grid gap-1 text-xs font-medium"
                >To<input
                  class="min-h-10 rounded-xl border border-gray-300 bg-white px-3 dark:border-gray-700 dark:bg-[#11141b]"
                  type="date"
                  value={draft.dateEnd}
                  oninput={(event) => updateDraft(person.person_id, { dateEnd: event.currentTarget.value })}
                /></label
              >
            </div>
            {#if qualifierModifiers.length > 0}<div
                class="flex flex-wrap gap-1.5"
                aria-label={`Modifiers for ${person.display_name}`}
              >
                {#each qualifierModifiers as modifier (modifier.modifierId)}<button
                    class={[
                      'min-h-8 rounded-full border px-2.5 text-xs font-medium',
                      draft.modifierIds.includes(modifier.modifierId)
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-gray-300 dark:border-gray-700',
                    ]}
                    type="button"
                    aria-pressed={draft.modifierIds.includes(modifier.modifierId)}
                    onclick={() => toggleModifier(person.person_id, modifier.modifierId)}>{modifier.label}</button
                  >{/each}
              </div>{/if}
          </article>
        {/each}
      </section>
      <button
        class="min-h-11 justify-self-end rounded-xl bg-primary px-5 text-sm font-semibold text-white disabled:opacity-50 dark:text-black"
        type="button"
        disabled={selectedPeople.length < 2}
        onclick={openReview}>Review {selectedPeople.length} connections</button
      >
    </div>
  {:else}
    <section
      class="grid gap-3 rounded-2xl border border-primary/25 bg-white p-4 dark:bg-immich-dark-bg"
      aria-labelledby="hub-review-heading"
    >
      <div>
        <h3 class="font-semibold" id="hub-review-heading">Review before recording</h3>
        <p class="text-sm text-gray-500">
          {mode === 'new' ? displayName.trim() : selectedHub?.displayName} · {currentMeta.label}
        </p>
      </div>
      <div class="grid gap-2">
        {#each selectedPeople as person (person.person_id)}{@const draft = draftFor(person.person_id)}{@const type =
            types.find(({ typeId }) => typeId === draft.typeId)}
          <div
            class="flex flex-wrap items-baseline justify-between gap-2 rounded-xl bg-gray-50 px-3 py-2 text-sm dark:bg-white/5"
          >
            <strong>{person.display_name}</strong><span class="text-gray-600 dark:text-gray-300"
              >{draftLabel(draft, type)}{draft.dateStart || draft.dateEnd
                ? ` · ${draft.dateStart || '…'}–${draft.dateEnd || (draft.validity === 'past' ? '…' : 'now')}`
                : ''}</span
            >
          </div>{/each}
      </div>
      <p class="text-xs text-gray-500">
        One confirmation records this complete set atomically. If any row is invalid, none are saved.
      </p>
      <div class="flex justify-end gap-2">
        <button
          class="min-h-11 rounded-xl px-4 text-sm font-semibold hover:bg-gray-100 dark:hover:bg-white/10"
          type="button"
          disabled={busy}
          onclick={() => (reviewing = false)}>Back</button
        ><button
          class="min-h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-white disabled:opacity-50 dark:text-black"
          type="button"
          disabled={busy}
          onclick={() => void save()}
          >{busy
            ? 'Recording…'
            : `${mode === 'new' ? 'Create hub and connect' : 'Connect'} ${selectedPeople.length} people`}</button
        >
      </div>
    </section>
  {/if}
  {#if errorMessage}<p
      class="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
      role="alert"
    >
      {errorMessage}
    </p>{/if}
</section>
