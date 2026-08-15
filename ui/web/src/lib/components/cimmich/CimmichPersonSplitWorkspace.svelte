<script lang="ts">
  import {
    getCimmichIdentityFaces,
    getCimmichPeople,
    getCimmichSmartSplitRecommendations,
    setCimmichFaceIdentitiesBatch,
    type CimmichIdentityFace,
    type CimmichPerson,
    type CimmichSmartSplitGroup,
    type CimmichSmartSplitRecommendations,
  } from '$lib/services/cimmich.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { personPhotoGridClass } from './person-photo-gallery';
  import {
    isUncertainSplitBatchFailure,
    replaceSplitSelectionWithShown,
    smartSplitRecommendationsAfterBatch,
    splitSelectionAfterBatch,
  } from './person-split-selection';
  import { cimmichSquareCropBackgroundStyle } from '$lib/utils/cimmich-crop';
  import { AssetMediaSize } from '@immich/sdk';
  import { mdiArrowLeft, mdiAutoFix, mdiCheckCircleOutline, mdiSelectAll } from '@mdi/js';
  import { Icon } from '@immich/ui';
  import { onMount } from 'svelte';

  interface Props {
    onback: () => void;
    onchanged: () => void;
    person: CimmichPerson;
  }

  const selectionLimit = 100;
  let { onback, onchanged, person }: Props = $props();
  let action = $state<'create' | 'move'>('create');
  let error = $state('');
  let faces = $state<CimmichIdentityFace[]>([]);
  let loading = $state(true);
  let movePersonId = $state('');
  let moveQuery = $state('');
  let newPersonName = $state('');
  let notice = $state('');
  let people = $state<CimmichPerson[]>([]);
  let peopleLoading = $state(true);
  let saving = $state(false);
  let search = $state('');
  let selectedFaceIds = $state<string[]>([]);
  let smartGroupId = $state('all');
  let smartLoading = $state(false);
  let smartRecommendations = $state<CimmichSmartSplitRecommendations | null>(null);
  let smartSplitError = $state('');

  const filteredFaces = $derived.by(() => {
    const query = search.trim().toLocaleLowerCase();
    const smartGroup = smartRecommendations?.groups.find(({ groupId }) => groupId === smartGroupId);
    const recommendedFaceIds = smartGroup ? new Set(smartGroup.faceIds) : null;
    return faces.filter(
      (face) =>
        (!recommendedFaceIds || recommendedFaceIds.has(face.face_id)) &&
        (!query ||
          [face.filename, face.capture_time ?? '', face.main_evidence_tier]
            .join(' ')
            .toLocaleLowerCase()
            .includes(query)),
    );
  });
  const moveOptions = $derived.by(() => {
    const query = moveQuery.trim().toLocaleLowerCase();
    if (!query || movePersonId) {
      return [];
    }
    return people
      .filter(
        (row) =>
          row.person_id !== person.person_id &&
          row.subject_kind === 'person' &&
          [row.display_name, ...row.aliases].join(' ').toLocaleLowerCase().includes(query),
      )
      .slice(0, 10);
  });
  const selectedMovePerson = $derived(people.find((row) => row.person_id === movePersonId));

  const loadPeople = async () => {
    peopleLoading = true;
    try {
      people = await getCimmichPeople(500, '', { presentation: false });
    } catch (loadError) {
      error ||= loadError instanceof Error ? loadError.message : 'Unable to load People';
    } finally {
      peopleLoading = false;
    }
  };

  const load = async () => {
    loading = true;
    error = '';
    void loadPeople();
    try {
      faces = await getCimmichIdentityFaces(person.person_id, 5000);
    } catch (loadError) {
      error = loadError instanceof Error ? loadError.message : 'Unable to load faces for splitting';
    } finally {
      loading = false;
    }
  };

  const faceStyle = (face: CimmichIdentityFace) =>
    cimmichSquareCropBackgroundStyle({
      boxH: face.box_h,
      boxW: face.box_w,
      boxX: face.box_x,
      boxY: face.box_y,
      height: face.height,
      padding: 2.4,
      url: getAssetMediaUrl({ id: face.sourceAssetId, size: AssetMediaSize.Thumbnail }),
      width: face.width,
    });

  const captureLabel = (face: CimmichIdentityFace) => {
    if (!face.capture_time) {
      return 'Date unavailable';
    }
    const date = new Date(face.capture_time);
    return Number.isNaN(date.valueOf())
      ? 'Date unavailable'
      : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const recommendationReason = (group: CimmichSmartSplitGroup) => {
    if (group.kind === 'unclear') {
      return 'Ambiguous, isolated or missing reliable match evidence';
    }
    if (group.reason === 'same_photo_separation') {
      return `${group.samePhotoSeparations.toLocaleString()} same-photo separation${group.samePhotoSeparations === 1 ? '' : 's'}`;
    }
    return 'Strongly separated face-match group';
  };

  const recommendationFace = (group: CimmichSmartSplitGroup) =>
    faces.find(({ face_id: faceId }) => faceId === group.representativeFaceId);

  const loadSmartSplit = async () => {
    smartLoading = true;
    smartSplitError = '';
    selectedFaceIds = [];
    try {
      smartRecommendations = await getCimmichSmartSplitRecommendations(person.person_id);
      smartGroupId = smartRecommendations.groups.find(({ kind }) => kind === 'clear')?.groupId ?? 'smart-unclear';
    } catch (loadError) {
      smartSplitError = loadError instanceof Error ? loadError.message : 'Unable to analyse this Person';
    } finally {
      smartLoading = false;
    }
  };

  const showSmartGroup = (groupId: string) => {
    smartGroupId = groupId;
    selectedFaceIds = [];
    error = '';
  };

  const toggleFace = (faceId: string) => {
    if (saving) {
      return;
    }
    if (selectedFaceIds.includes(faceId)) {
      selectedFaceIds = selectedFaceIds.filter((selectedId) => selectedId !== faceId);
      return;
    }
    if (selectedFaceIds.length >= selectionLimit) {
      error = `Move no more than ${selectionLimit} faces at once.`;
      return;
    }
    error = '';
    selectedFaceIds = [...selectedFaceIds, faceId];
  };

  const selectShown = () => {
    // A Smart Split group represents one proposed destination Person. Replace
    // hidden selections from the previous group instead of combining People.
    selectedFaceIds = replaceSplitSelectionWithShown(
      filteredFaces.map(({ face_id: faceId }) => faceId),
      selectionLimit,
    );
    error = filteredFaces.length > selectionLimit ? `Selected the first ${selectionLimit} shown faces.` : '';
  };

  const submit = async () => {
    const name = newPersonName.trim();
    if (selectedFaceIds.length === 0) {
      error = 'Select at least one face.';
      return;
    }
    if (action === 'create' && !name) {
      error = 'Enter a name for the new Person.';
      return;
    }
    if (action === 'move' && !movePersonId) {
      error = 'Choose the Person these faces belong to.';
      return;
    }
    saving = true;
    error = '';
    notice = '';
    try {
      const result = await setCimmichFaceIdentitiesBatch(
        selectedFaceIds.map((faceId) =>
          action === 'create' ? { faceId, newPersonName: name } : { faceId, personId: movePersonId },
        ),
      );
      const assignedIds = new Set(result.assigned.map(({ faceId }) => faceId));
      faces = faces.filter(({ face_id: faceId }) => !assignedIds.has(faceId));
      // Keep only explicit failures. Successful or canonicalized Face IDs must
      // never leak into the next Person's selection.
      selectedFaceIds = splitSelectionAfterBatch(
        faces.map(({ face_id: faceId }) => faceId),
        result.failures.map(({ faceId }) => faceId),
      );
      if (result.assignedCount > 0) {
        const destination = result.assigned[0]?.personName ?? selectedMovePerson?.display_name ?? name;
        const matcherRefresh = result.matcherRefreshes?.find(
          ({ personId }) => personId === result.assigned[0]?.personId,
        );
        const matcherRefreshFailure = result.matcherRefreshFailures?.find(
          ({ personId }) => personId === result.assigned[0]?.personId,
        );
        notice = `${result.assignedCount.toLocaleString()} ${result.assignedCount === 1 ? 'face' : 'faces'} ${action === 'create' ? `moved to new Person ${destination}` : `moved to ${destination}`}.${matcherRefresh ? ` Updated ${matcherRefresh.matcherPhotoCount.toLocaleString()} matcher ${matcherRefresh.matcherPhotoCount === 1 ? 'photo' : 'photos'} and found ${matcherRefresh.candidateCount.toLocaleString()} new ${matcherRefresh.candidateCount === 1 ? 'match' : 'matches'} to check.` : ''}${matcherRefreshFailure ? ' The Person was created, but matching needs to be refreshed from their Checks section.' : ''}`;
        onchanged();
        if (smartRecommendations) {
          smartRecommendations = smartSplitRecommendationsAfterBatch(
            smartRecommendations,
            result.assigned.map(({ faceId }) => faceId),
          );
          smartGroupId = smartRecommendations.groups.find(({ kind }) => kind === 'clear')?.groupId ?? 'smart-unclear';
        }
      }
      if (result.failureCount > 0) {
        const selectedFailure = result.failures[0];
        error = `${result.failureCount.toLocaleString()} ${result.failureCount === 1 ? 'face could' : 'faces could'} not be moved. ${selectedFailure?.error ?? 'Refresh and try again.'}`;
      }
      if (action === 'create' && result.assignedCount > 0) {
        newPersonName = '';
        void loadPeople();
      }
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Unable to split the selected faces';
      if (isUncertainSplitBatchFailure(message)) {
        // A disconnected browser cannot infer rollback: the server may still
        // finish. Force a fresh recommendation before another identity write.
        selectedFaceIds = [];
        smartRecommendations = null;
        smartGroupId = 'all';
        error = `${message}. The selection was cleared because the server may still complete it; wait for the faces to refresh before trying another group.`;
      } else {
        error = message;
      }
    } finally {
      saving = false;
    }
  };

  onMount(() => void load());
</script>

<section class="grid gap-5" aria-labelledby="person-split-title" data-testid="cimmich-person-split-workspace">
  <header
    class="rounded-3xl border border-violet-200 bg-violet-50/60 p-5 sm:p-6 dark:border-violet-900 dark:bg-violet-950/20"
  >
    <button
      class="inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-sm font-semibold text-violet-800 hover:bg-violet-100 dark:text-violet-200 dark:hover:bg-violet-900"
      type="button"
      onclick={onback}
    >
      <Icon icon={mdiArrowLeft} size="18" /> Back to overview
    </button>
    <h2 id="person-split-title" class="mt-4 text-2xl font-semibold">Split {person.display_name}</h2>
    <p class="mt-1 max-w-3xl text-sm/6 text-gray-600 dark:text-gray-300">
      Select the faces belonging to one person, then create a new Person or move them to someone who already exists.
      Repeat for each additional person in this record.
    </p>
  </header>

  {#if error}
    <p
      class="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
      role="alert"
    >
      {error}
    </p>
  {/if}
  {#if notice}
    <p
      class="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
      aria-live="polite"
    >
      {notice}
    </p>
  {/if}

  <section
    class="rounded-3xl border border-violet-200 bg-white p-4 sm:p-5 dark:border-violet-900 dark:bg-immich-dark-bg"
    aria-labelledby="smart-split-title"
  >
    <div class="flex flex-wrap items-start gap-3">
      <div class="mr-auto max-w-3xl">
        <h3 id="smart-split-title" class="text-lg font-semibold">Smart split</h3>
        <p class="mt-1 text-sm/6 text-gray-600 dark:text-gray-300">
          Find only clearly separated face-match groups. Anything ambiguous stays together in Unclear. Recommendations
          never move a face by themselves.
        </p>
      </div>
      <button
        class="inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
        type="button"
        disabled={loading || smartLoading || faces.length === 0}
        onclick={() => void loadSmartSplit()}
      >
        <Icon icon={mdiAutoFix} size="19" />
        {smartLoading ? 'Analysing matches…' : smartRecommendations ? 'Analyse again' : 'Smart split'}
      </button>
    </div>
    {#if smartSplitError}
      <p class="mt-3 text-sm font-medium text-red-700 dark:text-red-300" role="alert">{smartSplitError}</p>
    {/if}
    {#if smartRecommendations}
      <div class="mt-4 flex flex-wrap gap-2" role="group" aria-label="Smart split groups">
        <button
          class="min-h-11 rounded-xl border px-3 text-left text-sm transition"
          class:border-violet-500={smartGroupId === 'all'}
          class:bg-violet-50={smartGroupId === 'all'}
          class:dark:bg-violet-950={smartGroupId === 'all'}
          class:border-gray-200={smartGroupId !== 'all'}
          class:dark:border-gray-700={smartGroupId !== 'all'}
          type="button"
          aria-pressed={smartGroupId === 'all'}
          onclick={() => showSmartGroup('all')}
        >
          <strong class="block">All faces</strong>
          <span class="text-xs text-gray-500">{faces.length.toLocaleString()}</span>
        </button>
        {#each smartRecommendations.groups as group (group.groupId)}
          {@const representative = recommendationFace(group)}
          <button
            class={[
              'grid min-h-16 min-w-52 grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-3 rounded-xl border p-2 text-left transition',
              smartGroupId === group.groupId
                ? group.kind === 'unclear'
                  ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30'
                  : 'border-violet-500 bg-violet-50 dark:bg-violet-950/30'
                : 'border-gray-200 hover:border-violet-300 dark:border-gray-700',
            ]}
            type="button"
            aria-pressed={smartGroupId === group.groupId}
            disabled={group.faceIds.length === 0}
            onclick={() => showSmartGroup(group.groupId)}
          >
            <span
              class="block aspect-square rounded-lg bg-gray-200 bg-cover bg-no-repeat dark:bg-gray-800"
              style={representative ? faceStyle(representative) : ''}
              aria-hidden="true"
            ></span>
            <span class="min-w-0">
              <strong class="block truncate">{group.label}</strong>
              <span class="block text-xs text-gray-500"
                >{group.faceIds.length.toLocaleString()} faces · {recommendationReason(group)}</span
              >
            </span>
          </button>
        {/each}
      </div>
      <p class="mt-3 text-xs text-gray-500">
        Showing {smartRecommendations.summary.clearGroupCount.toLocaleString()} clear
        {smartRecommendations.summary.clearGroupCount === 1 ? 'group' : 'groups'}; choose one above, inspect every face,
        then use Select shown. Unclear is deliberately not guessed.
      </p>
      {#if !smartRecommendations.available}
        <p class="mt-2 text-sm font-medium text-amber-700 dark:text-amber-300">
          Safe automatic grouping is unavailable for this record; all faces remain in Unclear.
        </p>
      {/if}
    {/if}
  </section>

  <section
    class="rounded-3xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-immich-dark-bg"
    aria-label="Split action"
  >
    <div class="flex flex-wrap items-center gap-3">
      <strong>{selectedFaceIds.length.toLocaleString()} selected</strong>
      <span class="mr-auto text-xs text-gray-500">Up to {selectionLimit} faces per move</span>
      <button
        class="inline-flex min-h-10 items-center gap-2 rounded-full border border-gray-300 px-3 text-sm font-semibold dark:border-gray-600"
        type="button"
        disabled={loading || saving || filteredFaces.length === 0}
        onclick={selectShown}
      >
        <Icon icon={mdiSelectAll} size="18" /> Select shown
      </button>
      {#if selectedFaceIds.length > 0}
        <button
          class="min-h-10 rounded-full px-3 text-sm font-semibold hover:bg-gray-100 dark:hover:bg-gray-800"
          type="button"
          disabled={saving}
          onclick={() => (selectedFaceIds = [])}>Clear</button
        >
      {/if}
    </div>

    <div class="mt-4 grid gap-3 lg:grid-cols-[auto_minmax(16rem,1fr)_auto] lg:items-end">
      <div
        class="inline-flex w-fit overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700"
        aria-label="Split destination"
      >
        <button
          class={[
            'min-h-11 px-4 text-sm font-semibold',
            action === 'create'
              ? 'bg-violet-600 text-white'
              : 'bg-white hover:bg-gray-50 dark:bg-immich-dark-bg dark:hover:bg-gray-800',
          ]}
          type="button"
          aria-pressed={action === 'create'}
          disabled={saving}
          onclick={() => (action = 'create')}>Create New</button
        >
        <button
          class={[
            'min-h-11 border-l border-gray-200 px-4 text-sm font-semibold dark:border-gray-700',
            action === 'move'
              ? 'bg-violet-600 text-white'
              : 'bg-white hover:bg-gray-50 dark:bg-immich-dark-bg dark:hover:bg-gray-800',
          ]}
          type="button"
          aria-pressed={action === 'move'}
          disabled={saving}
          onclick={() => (action = 'move')}>Move to</button
        >
      </div>

      {#if action === 'create'}
        <label class="grid gap-1 text-sm font-medium">
          New Person name
          <input
            class="h-11 rounded-xl border border-gray-300 bg-white px-3 outline-none focus:border-violet-500 dark:border-gray-600 dark:bg-immich-dark-bg"
            placeholder="Enter a name"
            bind:value={newPersonName}
            disabled={saving}
          />
        </label>
      {:else}
        <div class="relative">
          <label class="grid gap-1 text-sm font-medium">
            Existing Person
            <input
              class="h-11 rounded-xl border border-gray-300 bg-white px-3 outline-none focus:border-violet-500 dark:border-gray-600 dark:bg-immich-dark-bg"
              type="search"
              placeholder={peopleLoading ? 'Loading People…' : 'Search People'}
              bind:value={moveQuery}
              disabled={saving}
              oninput={() => (movePersonId = '')}
            />
          </label>
          {#if moveOptions.length > 0}
            <div
              class="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-xl border border-gray-200 bg-white p-1 shadow-xl dark:border-gray-700 dark:bg-immich-dark-bg"
              role="listbox"
              aria-label="People to move faces to"
            >
              {#each moveOptions as option (option.person_id)}
                <button
                  class="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
                  type="button"
                  role="option"
                  aria-selected={false}
                  onclick={() => {
                    movePersonId = option.person_id;
                    moveQuery = option.display_name;
                  }}
                >
                  <span class="truncate font-medium">{option.display_name}</span>
                  <span class="shrink-0 text-xs text-gray-500">{option.asset_count.toLocaleString()} photos</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <button
        class="min-h-11 rounded-xl bg-violet-600 px-5 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-45"
        type="button"
        disabled={saving ||
          selectedFaceIds.length === 0 ||
          (action === 'create' ? !newPersonName.trim() : !movePersonId)}
        onclick={() => void submit()}
      >
        {saving ? 'Moving…' : action === 'create' ? 'Create New' : 'Move to'}
      </button>
    </div>
  </section>

  <div class="flex flex-wrap items-center gap-3">
    <label class="min-w-60 flex-1">
      <span class="sr-only">Filter faces</span>
      <input
        class="h-11 w-full rounded-xl border border-gray-200 bg-white px-4 text-sm outline-none focus:border-primary dark:border-gray-700 dark:bg-immich-dark-bg"
        type="search"
        placeholder="Filter by filename, date or evidence type"
        bind:value={search}
      />
    </label>
    <span class="text-sm text-gray-500"
      >{filteredFaces.length.toLocaleString()} of {faces.length.toLocaleString()} faces</span
    >
  </div>

  {#if loading}
    <p class="py-16 text-center text-sm text-gray-500">Loading accepted faces…</p>
  {:else if faces.length === 0}
    <div class="rounded-3xl border border-dashed border-gray-300 p-10 text-center dark:border-gray-700">
      <h3 class="font-semibold">No accepted faces remain in this record</h3>
      <p class="mt-1 text-sm text-gray-500">Return to Overview to review the resulting People.</p>
      <button
        class="mt-4 min-h-10 rounded-full bg-primary px-4 text-sm font-semibold text-white"
        type="button"
        onclick={onback}>Back to overview</button
      >
    </div>
  {:else}
    <div class={personPhotoGridClass('medium')} aria-label="Faces to split">
      {#each filteredFaces as face (face.face_id)}
        {@const selected = selectedFaceIds.includes(face.face_id)}
        <button
          class={[
            'group overflow-hidden rounded-2xl border bg-white text-left transition dark:bg-immich-dark-bg',
            selected
              ? 'border-violet-500 ring-2 ring-violet-500'
              : 'border-gray-200 hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-md dark:border-gray-700',
          ]}
          type="button"
          aria-pressed={selected}
          disabled={saving}
          onclick={() => toggleFace(face.face_id)}
        >
          <span
            class="relative block aspect-square overflow-hidden bg-gray-200 bg-cover bg-no-repeat dark:bg-gray-800"
            style={faceStyle(face)}
          >
            <span
              class={[
                'absolute top-2 right-2 grid size-8 place-items-center rounded-full border-2 border-white shadow-md',
                selected ? 'bg-violet-600 text-white' : 'bg-black/35 text-transparent',
              ]}
              aria-hidden="true"
            >
              <Icon icon={mdiCheckCircleOutline} size="19" />
            </span>
          </span>
          <span class="block p-2.5">
            <span class="block truncate text-xs font-semibold" title={face.filename}>{face.filename}</span>
            <span class="mt-0.5 block truncate text-[11px] text-gray-500">{captureLabel(face)}</span>
          </span>
        </button>
      {/each}
    </div>
  {/if}
</section>
