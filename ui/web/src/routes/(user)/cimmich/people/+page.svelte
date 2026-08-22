<script lang="ts">
  import { page } from '$app/state';
  import CimmichPossiblePeople from '$lib/components/cimmich/CimmichPossiblePeople.svelte';
  import CimmichExploreFilters from '$lib/components/cimmich/CimmichExploreFilters.svelte';
  import CimmichSectionHeader from '$lib/components/cimmich/CimmichSectionHeader.svelte';
  import CimmichStatePanel from '$lib/components/cimmich/CimmichStatePanel.svelte';
  import {
    cimmichExploreFilterCount,
    cimmichExploreFilterKey,
    cimmichExploreFiltersFromUrl,
    cimmichExploreFiltersUrl,
    withCimmichExploreFilters,
  } from '$lib/components/cimmich/explore-filters';
  import {
    chooseInitialPeopleView,
    comparePeople,
    comparePeopleByReviewCount,
    defaultPeopleSort,
    nextPeopleSort,
    type PeopleSortKey,
    type PeopleSortState,
    type PeopleViewMode,
  } from '$lib/components/cimmich/people-presentation';
  import { readPeopleWorkspaceCache, writePeopleWorkspaceCache } from '$lib/components/cimmich/people-workspace-cache';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import { cimmichVisibilityManager } from '$lib/managers/cimmich-visibility-manager.svelte';
  import { Route } from '$lib/route';
  import {
    decideCimmichIdentityCandidate,
    getCimmichIdentityCandidates,
    getCimmichExploreFacets,
    getCimmichPersonCandidateSummary,
    getCimmichPeople,
    type CimmichIdentityCandidate,
    type CimmichExploreFacetResult,
    type CimmichExploreFilters as CimmichExploreFilterState,
    type CimmichPerson,
    type CimmichPersonCandidateSummary,
  } from '$lib/services/cimmich.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import {
    cimmichPresentationSquareStyle,
    cimmichSquareCropBackgroundStyle,
    cimmichSquareObservationStyle,
  } from '$lib/utils/cimmich-crop';
  import { AssetMediaSize } from '@immich/sdk';
  import {
    mdiAccountMultipleOutline,
    mdiCheck,
    mdiClose,
    mdiFilterVariant,
    mdiImageOffOutline,
    mdiMagnify,
    mdiSortVariant,
    mdiViewGridOutline,
  } from '@mdi/js';
  import { ContextMenuButton, Icon, MenuItemType, Tooltip, type ActionItem } from '@immich/ui';
  type PersonViewMode = PeopleViewMode;
  type PeopleThumbnailSize = 'large' | 'medium' | 'small';
  type PeopleCategory =
    | 'acquaintances'
    | 'all'
    | 'close-friends'
    | 'co-workers'
    | 'family'
    | 'friends'
    | 'holding'
    | 'me'
    | 'others'
    | 'sort';
  const relatedPersonIds = $derived(
    new Set((page.url.searchParams.get('relatedIds') ?? '').split(',').filter(Boolean)),
  );
  const relatedFrom = $derived(page.url.searchParams.get('relatedFrom') ?? '');

  let cimmichCandidates = $state<CimmichIdentityCandidate[]>([]);
  let cimmichCandidateSummary = $state<CimmichPersonCandidateSummary | null>(null);
  let cimmichError = $state('');
  let cimmichLoaded = $state(false);
  let cimmichLoadGeneration = 0;
  let cimmichMessage = $state('');
  let exploreError = $state('');
  let exploreFilters = $state<CimmichExploreFilterState>(cimmichExploreFiltersFromUrl(page.url));
  let exploreGeneration = 0;
  let exploreLoading = $state(false);
  let exploreResult = $state<CimmichExploreFacetResult | null>(null);
  let cimmichPeople = $state<CimmichPerson[]>([]);
  let cimmichSavingClaimId = $state('');
  let ignoredPossiblePeopleCount = $state(0);
  let initialViewChosen = $state(false);
  let minimumPhotos = $state(0);
  let peopleCategory = $state<PeopleCategory>('all');
  let peopleQuery = $state('');
  let peopleSort = $state<PeopleSortState>({ ...defaultPeopleSort });
  let peopleThumbnailSize = $state<PeopleThumbnailSize>('medium');
  let viewMode = $state<PersonViewMode>('faces');

  const viewModes: Array<{ id: PersonViewMode; label: string; tooltip: string }> = [
    { id: 'faces', label: 'People', tooltip: 'Browse people with accepted photos' },
    { id: 'candidates', label: 'Suggestions', tooltip: 'People with new identity suggestions to review' },
    { id: 'possible', label: 'Possible people', tooltip: 'Review unassigned faces that may belong together' },
    { id: 'needsFace', label: 'Needs attention', tooltip: 'People with unresolved sorting or identity work' },
  ];
  const sortOptions: Array<{ id: PeopleSortKey; label: string }> = [
    { id: 'photos', label: '# of Photos' },
    { id: 'names', label: 'Names A - Z' },
  ];
  const sortDirectionArrow = (sortKey: PeopleSortKey) => {
    const direction = peopleSort.key === sortKey ? peopleSort.direction : sortKey === 'photos' ? 'desc' : 'asc';
    return direction === 'asc' ? '↑' : '↓';
  };
  const photoThresholds = [
    { label: 'Any photo count', value: 0 },
    { label: '10+ photos', value: 10 },
    { label: '50+ photos', value: 50 },
    { label: '100+ photos', value: 100 },
  ];
  const peopleCategories: Array<{ id: PeopleCategory; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'family', label: 'Family' },
    { id: 'close-friends', label: 'Close friends' },
    { id: 'friends', label: 'Friends' },
    { id: 'acquaintances', label: 'Acquaintances' },
    { id: 'co-workers', label: 'Co-workers' },
    { id: 'me', label: 'Me' },
    { id: 'others', label: 'Others' },
    { id: 'sort', label: 'Needs sorting' },
    { id: 'holding', label: '↳ Holding' },
  ];
  const selectablePeopleCategories = peopleCategories.filter(
    (category) => category.id !== 'sort' && category.id !== 'holding',
  );
  const personInCategory = (person: CimmichPerson, category: PeopleCategory) => {
    if (category === 'all') {
      return true;
    }
    if (category === 'others') {
      return !person.categories.some((item) => item.category_kind === 'relationship');
    }
    return person.categories.some((item) => item.slug === category);
  };
  const peopleCategoryCounts = $derived.by(
    () =>
      Object.fromEntries(
        peopleCategories.map((category) => [
          category.id,
          cimmichPeople.filter((person) => personInCategory(person, category.id)).length,
        ]),
      ) as Record<PeopleCategory, number>,
  );

  const cimmichFaceBackedCount = $derived(cimmichPeople.length);
  const cimmichNeedsFaceCount = $derived(
    cimmichPeople.filter((person) => person.needs_holding || person.needs_sort).length + ignoredPossiblePeopleCount,
  );
  const cimmichCandidateCounts = $derived(
    new Map((cimmichCandidateSummary?.items ?? []).map((item) => [item.personId, item.suggestionCount])),
  );
  const personMachineSuggestionCount = (personId: string) => cimmichCandidateCounts.get(personId) ?? 0;
  const personHasSuggestions = (person: CimmichPerson) => personMachineSuggestionCount(person.person_id) > 0;
  const cimmichCandidateCount = $derived(cimmichCandidateSummary?.totalPeople ?? 0);
  const faceBackedCount = $derived(cimmichFaceBackedCount);
  const needsFaceCount = $derived(cimmichNeedsFaceCount);
  const exploreActive = $derived(cimmichExploreFilterCount(exploreFilters) > 0);
  const exploreApplies = $derived(exploreActive && viewMode === 'faces');
  const explorePeopleCounts = $derived(
    new Map((exploreResult?.people ?? []).map((item) => [item.personId, item.assetCount])),
  );

  const visibleCimmichPeople = $derived.by(() => {
    const query = peopleQuery.trim().toLowerCase();
    return cimmichPeople
      .map((person) =>
        exploreApplies && exploreResult
          ? { ...person, asset_count: explorePeopleCounts.get(person.person_id) ?? 0 }
          : person,
      )
      .filter((person) => !exploreApplies || !exploreResult || explorePeopleCounts.has(person.person_id))
      .filter((person) => relatedPersonIds.size === 0 || relatedPersonIds.has(person.person_id))
      .filter((person) =>
        viewMode === 'faces'
          ? true
          : viewMode === 'candidates'
            ? personHasSuggestions(person)
            : person.needs_holding || person.needs_sort,
      )
      .filter(
        (person) =>
          !query || [person.display_name, ...person.aliases].some((name) => name.toLowerCase().includes(query)),
      )
      .filter((person) => personInCategory(person, peopleCategory))
      .filter((person) => person.asset_count >= minimumPhotos)
      .sort((a, b) =>
        viewMode === 'candidates'
          ? comparePeopleByReviewCount(a, b, cimmichCandidateCounts, peopleSort)
          : comparePeople(a, b, peopleSort),
      );
  });

  const peopleSortActions = $derived.by(() =>
    sortOptions.map(
      (option) =>
        ({
          title: `${option.label} ${sortDirectionArrow(option.id)}`,
          description:
            peopleSort.key === option.id
              ? option.id === 'photos'
                ? peopleSort.direction === 'desc'
                  ? 'Most photos first · choose again to reverse'
                  : 'Fewest photos first · choose again to reverse'
                : peopleSort.direction === 'asc'
                  ? 'A–Z · choose again to reverse'
                  : 'Z–A · choose again to reverse'
              : option.id === 'photos'
                ? 'Sort by photo count'
                : 'Sort alphabetically',
          icon: peopleSort.key === option.id ? mdiCheck : undefined,
          onAction: () => (peopleSort = nextPeopleSort(peopleSort, option.id)),
        }) satisfies ActionItem,
    ),
  );
  const peopleFilterActions = $derived.by(() => [
    ...selectablePeopleCategories.map(
      (category) =>
        ({
          title: `${category.id === 'all' ? 'All categories' : category.label} (${peopleCategoryCounts[category.id]})`,
          description: 'Category',
          icon: peopleCategory === category.id ? mdiCheck : undefined,
          onAction: () => (peopleCategory = category.id),
        }) satisfies ActionItem,
    ),
    MenuItemType.Divider,
    ...photoThresholds.map(
      (threshold) =>
        ({
          title: threshold.label,
          description: 'Minimum photo count',
          icon: minimumPhotos === threshold.value ? mdiCheck : undefined,
          onAction: () => (minimumPhotos = threshold.value),
        }) satisfies ActionItem,
    ),
  ]);

  const initials = (name: string) =>
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?';
  const cimmichCandidateCropStyle = (candidate: CimmichIdentityCandidate, padding = 2.4) => {
    if (!candidate.sourceAssetId) {
      return '';
    }
    return cimmichSquareCropBackgroundStyle({
      boxH: candidate.box_h,
      boxW: candidate.box_w,
      boxX: candidate.box_x,
      boxY: candidate.box_y,
      height: candidate.height ?? 0,
      padding,
      url: getAssetMediaUrl({ id: candidate.sourceAssetId, size: AssetMediaSize.Preview }),
      width: candidate.width ?? 0,
    });
  };

  const cimmichPersonCropStyle = (person: CimmichPerson) => {
    if (
      !person.sourceAssetId ||
      person.box_x === null ||
      person.box_y === null ||
      person.box_w === null ||
      person.box_h === null
    ) {
      return '';
    }
    return cimmichSquareObservationStyle({
      boxH: person.box_h,
      boxW: person.box_w,
      boxX: person.box_x,
      boxY: person.box_y,
      height: person.height ?? 0,
      padding: 1.55,
      width: person.width ?? 0,
    });
  };

  const cimmichBodyPreviewCropStyle = (preview: NonNullable<CimmichPerson['bodyPreview']>) =>
    cimmichSquareObservationStyle({
      boxH: preview.box_h,
      boxW: preview.box_w,
      boxX: preview.box_x,
      boxY: preview.box_y,
      height: preview.height ?? 0,
      padding: 1.2,
      width: preview.width ?? 0,
    });

  const cimmichPresentationSquareCropStyle = (
    media: NonNullable<CimmichPerson['presentationBody'] | CimmichPerson['presentationFace']>,
    presentationAspect: number,
  ) => cimmichPresentationSquareStyle({ ...media, presentationAspect });

  const cimmichPresentationBodyCropStyle = (media: NonNullable<CimmichPerson['presentationBody']>) =>
    cimmichPresentationSquareCropStyle(media, 3 / 4);

  const cimmichPresentationFaceCropStyle = (media: NonNullable<CimmichPerson['presentationFace']>) =>
    cimmichPresentationSquareCropStyle(media, 1);

  const peopleWorkspaceCacheKey = () => cimmichVisibilityManager.viewingMode;

  const persistPeopleWorkspace = () =>
    writePeopleWorkspaceCache(peopleWorkspaceCacheKey(), {
      candidateSummary: cimmichCandidateSummary,
      candidates: cimmichCandidates,
      people: cimmichPeople,
    });

  const loadCimmichReview = async (preserveCurrent = false) => {
    const generation = ++cimmichLoadGeneration;
    if (!preserveCurrent) {
      cimmichLoaded = false;
      cimmichCandidates = [];
      cimmichCandidateSummary = null;
      cimmichPeople = [];
    }
    try {
      const identities = await getCimmichPeople(500, '', { presentation: true });
      if (generation !== cimmichLoadGeneration) {
        return;
      }
      cimmichPeople = identities.filter((identity) => identity.subject_kind === 'person');
      if (!initialViewChosen) {
        viewMode = chooseInitialPeopleView(cimmichPeople);
        initialViewChosen = true;
      }
      cimmichError = '';
      persistPeopleWorkspace();
      void Promise.all([getCimmichIdentityCandidates(5), getCimmichPersonCandidateSummary()])
        .then(([candidates, candidateSummary]) => {
          if (generation === cimmichLoadGeneration) {
            cimmichCandidates = candidates;
            cimmichCandidateSummary = candidateSummary;
            persistPeopleWorkspace();
          }
        })
        .catch(() => {
          // The People grid is independently useful. Review counts can retry
          // on the next visit without holding or replacing the primary view.
        });
    } catch (error) {
      if (generation !== cimmichLoadGeneration) {
        return;
      }
      cimmichError = error instanceof Error ? error.message : 'Unable to load Cimmich';
    } finally {
      if (generation === cimmichLoadGeneration) {
        cimmichLoaded = true;
      }
    }
  };

  const loadExploreFacets = async () => {
    const generation = ++exploreGeneration;
    exploreLoading = true;
    exploreError = '';
    try {
      const result = await getCimmichExploreFacets(exploreFilters);
      if (generation === exploreGeneration) {
        exploreResult = result;
      }
    } catch (error) {
      if (generation === exploreGeneration) {
        exploreError = error instanceof Error ? error.message : 'Unable to filter People';
      }
    } finally {
      if (generation === exploreGeneration) {
        exploreLoading = false;
      }
    }
  };

  const setExploreFilters = (filters: CimmichExploreFilterState) => {
    exploreFilters = filters;
    globalThis.history.pushState(
      globalThis.history.state,
      '',
      cimmichExploreFiltersUrl(new URL(globalThis.location.href), filters),
    );
  };

  const restoreExploreFiltersFromHistory = () => {
    exploreFilters = cimmichExploreFiltersFromUrl(new URL(globalThis.location.href));
  };

  const runCimmichDecision = async (candidate: CimmichIdentityCandidate, action: 'accept' | 'reject') => {
    cimmichSavingClaimId = candidate.identity_claim_id;
    cimmichError = '';
    cimmichMessage = '';
    try {
      const result = await decideCimmichIdentityCandidate(candidate.identity_claim_id, action);
      cimmichMessage = result.changed
        ? `${candidate.display_name} ${result.state} for this face. Suggestions have been refreshed.`
        : `This face was already ${result.state}.`;
      await loadCimmichReview();
    } catch (error) {
      cimmichError = error instanceof Error ? error.message : 'Unable to save Cimmich decision';
    } finally {
      cimmichSavingClaimId = '';
    }
  };

  $effect(() => {
    void cimmichVisibilityManager.version;
    const cached = readPeopleWorkspaceCache(peopleWorkspaceCacheKey());
    if (cached) {
      cimmichPeople = cached.people;
      cimmichCandidates = cached.candidates;
      cimmichCandidateSummary = cached.candidateSummary;
      cimmichLoaded = true;
      cimmichError = '';
      if (!initialViewChosen) {
        viewMode = chooseInitialPeopleView(cimmichPeople);
        initialViewChosen = true;
      }
      void loadCimmichReview(true);
      return;
    }
    void loadCimmichReview();
  });

  $effect(() => {
    void cimmichVisibilityManager.version;
    void cimmichExploreFilterKey(exploreFilters);
    if (cimmichExploreFilterCount(exploreFilters) > 0) {
      void loadExploreFacets();
    } else {
      exploreResult = null;
      exploreError = '';
      exploreLoading = false;
    }
  });
</script>

<svelte:window onpopstate={restoreExploreFiltersFromHistory} />

<UserPageLayout>
  <div class="mx-auto flex w-full max-w-7xl flex-col gap-6 p-5 text-immich-fg dark:text-immich-dark-fg">
    <CimmichSectionHeader
      icon={mdiAccountMultipleOutline}
      title="People"
      meta={cimmichLoaded
        ? `${cimmichPeople.length.toLocaleString()} ${cimmichPeople.length === 1 ? 'person' : 'people'} in directory`
        : 'Loading people'}
    >
      {#snippet actions()}
        <div class="flex w-full min-w-0 flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-nowrap">
          <div
            class="flex min-h-11 w-full max-w-full items-center overflow-x-auto rounded-xl bg-gray-100 p-1 sm:w-auto dark:bg-immich-dark-gray"
            role="toolbar"
            aria-label="People views and categories"
          >
            {#each viewModes as mode (mode.id)}
              {@const count =
                mode.id === 'faces'
                  ? faceBackedCount
                  : mode.id === 'candidates'
                    ? cimmichCandidateCount
                    : mode.id === 'needsFace'
                      ? needsFaceCount
                      : null}
              <Tooltip text={mode.tooltip}>
                {#snippet child({ props })}
                  <button
                    {...props}
                    class={[
                      'inline-flex h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:gap-1.5',
                      viewMode === mode.id
                        ? 'bg-white text-primary shadow-sm dark:bg-black/25 dark:text-immich-dark-primary'
                        : 'text-gray-500 hover:text-immich-fg dark:text-gray-400 dark:hover:text-immich-dark-fg',
                    ]}
                    type="button"
                    aria-pressed={viewMode === mode.id}
                    onclick={() => (viewMode = mode.id)}
                  >
                    {mode.label}
                    {#if count !== null}
                      <span class="text-xs opacity-65">{count}</span>
                    {/if}
                  </button>
                {/snippet}
              </Tooltip>
              {#if mode.id === 'faces'}
                <span class="mx-1 h-6 w-px shrink-0 bg-gray-300 dark:bg-gray-600" aria-hidden="true"></span>
              {/if}
            {/each}
          </div>
          {#if viewMode !== 'possible'}
            <Tooltip text="Search names in the current People mode">
              {#snippet child({ props })}
                <label
                  {...props}
                  class="flex h-11 w-full min-w-0 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm focus-within:border-primary sm:w-36 lg:w-44 dark:border-immich-dark-gray dark:bg-immich-dark-bg"
                >
                  <Icon icon={mdiMagnify} size="18" class="text-gray-500" />
                  <input
                    bind:value={peopleQuery}
                    class="w-full bg-transparent outline-none"
                    placeholder="Search people"
                    aria-label="Search people"
                    type="search"
                  />
                </label>
              {/snippet}
            </Tooltip>
            <div
              class="flex min-w-max items-center overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-immich-dark-bg"
              aria-label="People view options"
            >
              <Tooltip text={viewMode === 'candidates' ? 'Sort equal review counts' : 'Sort people'}>
                {#snippet child({ props })}
                  <ContextMenuButton
                    {...props}
                    class="size-10"
                    icon={mdiSortVariant}
                    items={peopleSortActions}
                    position="top-right"
                    aria-label={viewMode === 'candidates' ? 'Sort equal review counts' : 'Sort people'}
                  />
                {/snippet}
              </Tooltip>
              <Tooltip text="Filter names and photo count">
                {#snippet child({ props })}
                  <ContextMenuButton
                    {...props}
                    class="size-10 border-l border-gray-200 dark:border-gray-700"
                    icon={mdiFilterVariant}
                    items={peopleFilterActions}
                    position="top-right"
                    aria-label="Filter names and photo count"
                  />
                {/snippet}
              </Tooltip>
              <Tooltip text="Thumbnail size">
                {#snippet child({ props })}
                  <label
                    {...props}
                    class="relative inline-flex size-10 cursor-pointer items-center justify-center border-l border-gray-200 text-gray-500 transition hover:bg-gray-100 hover:text-gray-950 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
                  >
                    <Icon icon={mdiViewGridOutline} size="19" />
                    <select
                      class="absolute inset-0 size-full cursor-pointer opacity-0"
                      bind:value={peopleThumbnailSize}
                      aria-label="Thumbnail size"
                    >
                      <option value="small">Small</option>
                      <option value="medium">Medium</option>
                      <option value="large">Large</option>
                    </select>
                  </label>
                {/snippet}
              </Tooltip>
            </div>
          {/if}
        </div>
      {/snippet}
    </CimmichSectionHeader>

    {#if viewMode === 'faces'}
      <CimmichExploreFilters
        error={exploreError}
        filters={exploreFilters}
        loading={exploreLoading}
        onchange={setExploreFilters}
        onexpand={() => void loadExploreFacets()}
        result={exploreResult}
      />
    {/if}

    {#if relatedPersonIds.size > 0}
      <div
        class="flex items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm"
      >
        <span><strong>Related to {relatedFrom || 'this connection'}</strong> · {visibleCimmichPeople.length} shown</span
        >
        <a class="rounded-full px-3 py-2 font-semibold text-primary hover:bg-primary/10" href="/cimmich/people"
          >Show all</a
        >
      </div>
    {/if}

    {#if cimmichError}
      <div
        class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        role="alert"
      >
        <span>{cimmichError}</span>
        <button
          class="rounded-md border border-current px-3 py-1.5 font-semibold"
          type="button"
          onclick={() => void loadCimmichReview()}>Retry</button
        >
      </div>
    {/if}

    {#if cimmichMessage}
      <p
        class="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
        role="status"
      >
        {cimmichMessage}
      </p>
    {/if}

    {#if viewMode === 'needsFace' && cimmichCandidates.length > 0}
      <section
        class="grid gap-3 rounded-xl border border-immich-primary/20 bg-white p-4 shadow-sm md:grid-cols-5 dark:border-immich-dark-primary/30 dark:bg-immich-dark-gray"
      >
        {#each cimmichCandidates as candidate (candidate.identity_claim_id)}
          <article
            class="flex min-w-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-black/15"
          >
            <div
              class="aspect-square bg-gray-200 bg-cover bg-center dark:bg-black/30"
              style={cimmichCandidateCropStyle(candidate)}
            >
              {#if !candidate.sourceAssetId}
                <span class="flex size-full items-center justify-center px-3 text-center text-xs text-gray-500"
                  >Preview unavailable</span
                >
              {/if}
            </div>
            <div class="flex flex-1 flex-col gap-2 p-3">
              <div class="min-w-0">
                <p class="truncate text-sm font-semibold">{candidate.display_name}</p>
                <p class="truncate text-xs text-gray-500 dark:text-gray-400">
                  {candidate.filename || candidate.asset_id}
                </p>
              </div>
              <div class="flex flex-wrap gap-1 text-[11px] text-gray-600 dark:text-gray-300">
                <span class="rounded-sm bg-white px-1.5 py-0.5 dark:bg-white/10"
                  >det {Math.round(candidate.detection_confidence * 100)}%</span
                >
                {#if typeof candidate.quality_measurements.quality_bucket === 'string'}
                  <span class="rounded-sm bg-white px-1.5 py-0.5 dark:bg-white/10">
                    {String(candidate.quality_measurements.quality_bucket).replaceAll('_', ' ')}
                  </span>
                {/if}
              </div>
              <div class="mt-auto grid grid-cols-2 gap-2 pt-1">
                <button
                  class="flex items-center justify-center gap-1 rounded-md bg-immich-primary px-2 py-1.5 text-xs font-semibold text-white disabled:opacity-50 dark:bg-immich-dark-primary dark:text-black"
                  disabled={Boolean(cimmichSavingClaimId)}
                  onclick={() => runCimmichDecision(candidate, 'accept')}
                  type="button"
                >
                  <Icon icon={mdiCheck} size="15" /> Accept
                </button>
                <button
                  class="flex items-center justify-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs font-semibold disabled:opacity-50 dark:border-white/20 dark:bg-white/5"
                  disabled={Boolean(cimmichSavingClaimId)}
                  onclick={() => runCimmichDecision(candidate, 'reject')}
                  type="button"
                >
                  <Icon icon={mdiClose} size="15" /> Reject
                </button>
              </div>
            </div>
          </article>
        {/each}
      </section>
    {/if}

    {#if !cimmichLoaded}
      <CimmichStatePanel tone="loading" title="Loading people" description="Reading the current People projection." />
    {:else if !cimmichError}
      {#if viewMode === 'possible'}
        <CimmichPossiblePeople mode="active" onignoredcount={(count) => (ignoredPossiblePeopleCount = count)} />
      {:else}
        {#if viewMode === 'candidates'}
          <div class="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p class="text-xs font-semibold tracking-[0.14em] text-gray-500 uppercase dark:text-gray-400">
                Known people
              </p>
              <h2 class="mt-1 text-xl font-semibold">People with suggestions</h2>
              <p class="mt-1 text-sm text-gray-600 dark:text-gray-300">
                {cimmichCandidateSummary?.totalCandidates.toLocaleString() ?? '0'} matched faces from a saved evaluated reference
                library, grouped by the known person they may belong to. Nothing changes until you confirm.
              </p>
            </div>
            <span
              class="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-900 dark:bg-sky-950 dark:text-sky-100"
            >
              {cimmichCandidateCount.toLocaleString()}
              {cimmichCandidateCount === 1 ? ' person' : ' people'}
            </span>
          </div>
        {/if}
        <section
          class={[
            'grid',
            peopleThumbnailSize === 'small'
              ? 'grid-cols-4 gap-x-4 gap-y-6 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-9 xl:grid-cols-10'
              : peopleThumbnailSize === 'large'
                ? 'grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'
                : 'grid-cols-3 gap-x-5 gap-y-8 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7',
          ]}
        >
          {#each visibleCimmichPeople as person (person.person_id)}
            <a
              class="group flex min-w-0 flex-col items-center gap-3 text-center"
              href={withCimmichExploreFilters(
                Route.cimmichPerson({
                  identityReviewCount:
                    viewMode === 'candidates' ? personMachineSuggestionCount(person.person_id) : undefined,
                  name: person.display_name,
                  personId: person.person_id,
                }),
                exploreFilters,
              )}
            >
              <span
                class={[
                  'relative block w-full rounded-full perspective-[900px]',
                  peopleThumbnailSize === 'small'
                    ? 'max-w-24'
                    : peopleThumbnailSize === 'large'
                      ? 'max-w-48'
                      : 'max-w-36',
                ]}
              >
                <span
                  class={[
                    'relative block aspect-square w-full rounded-full shadow-sm transition-transform duration-500 transform-3d motion-reduce:transition-none',
                    person.presentationBody || person.bodyPreview
                      ? 'group-hover:transform-[rotateY(180deg)] group-focus-visible:transform-[rotateY(180deg)]'
                      : 'group-hover:scale-[1.02]',
                  ]}
                >
                  <span
                    class="absolute inset-0 overflow-hidden rounded-full bg-gray-200 backface-hidden dark:bg-gray-700"
                  >
                    {#if person.presentationFace?.sourceAssetId || person.sourceAssetId}
                      <img
                        class="max-w-none"
                        src={getAssetMediaUrl({
                          id: person.presentationFace?.sourceAssetId ?? person.sourceAssetId,
                          size: AssetMediaSize.Preview,
                        })}
                        style={person.presentationFace
                          ? cimmichPresentationFaceCropStyle(person.presentationFace)
                          : cimmichPersonCropStyle(person)}
                        alt={person.display_name}
                        decoding="async"
                        draggable="false"
                        loading="lazy"
                      />
                    {:else}
                      <span
                        class="flex size-full items-center justify-center text-xl font-semibold text-gray-700 dark:bg-immich-dark-gray dark:text-gray-200"
                        aria-label={`${person.display_name} portrait unavailable in this viewing mode`}
                      >
                        {initials(person.display_name)}
                      </span>
                    {/if}
                  </span>
                  {#if !person.presentationFace?.sourceAssetId && !person.sourceAssetId}
                    <span
                      class="absolute right-1 bottom-1 z-10 flex size-8 items-center justify-center rounded-full border-2 border-white bg-gray-800 text-white shadow-sm dark:border-gray-950"
                      title="Portrait unavailable in this viewing mode"
                      aria-hidden="true"
                    >
                      <Icon icon={mdiImageOffOutline} size="16" />
                    </span>
                  {/if}
                  {#if person.presentationBody || person.bodyPreview}
                    <span
                      class="absolute inset-0 transform-[rotateY(180deg)] overflow-hidden rounded-full bg-gray-200 backface-hidden dark:bg-gray-700"
                      aria-hidden="true"
                    >
                      <img
                        class="max-w-none"
                        src={getAssetMediaUrl({
                          id: person.presentationBody?.sourceAssetId ?? person.bodyPreview?.sourceAssetId ?? '',
                          size: AssetMediaSize.Preview,
                        })}
                        style={person.presentationBody
                          ? cimmichPresentationBodyCropStyle(person.presentationBody)
                          : cimmichBodyPreviewCropStyle(person.bodyPreview!)}
                        alt=""
                        decoding="async"
                        draggable="false"
                        loading="lazy"
                      />
                    </span>
                  {/if}
                </span>
              </span>
              <span class="w-full truncate text-sm font-medium">{person.display_name}</span>
              {#if viewMode === 'needsFace' && person.needs_holding}
                <span
                  class="-mt-2 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-900 dark:bg-violet-950 dark:text-violet-100"
                  >Holding</span
                >
              {:else if viewMode === 'needsFace' && person.needs_sort}
                <span
                  class="-mt-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-100"
                  >Needs sorting</span
                >
              {:else if viewMode === 'candidates' && personHasSuggestions(person)}
                <span
                  class="-mt-2 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-900 dark:bg-sky-950 dark:text-sky-100"
                >
                  {personMachineSuggestionCount(person.person_id).toLocaleString()}
                  {personMachineSuggestionCount(person.person_id) === 1 ? 'photo to review' : 'photos to review'}
                </span>
              {/if}
              <span class="w-full truncate text-xs text-gray-500 dark:text-gray-400">
                {#if person.asset_count === 0}
                  No photos visible in this viewing mode
                {:else}
                  {person.asset_count.toLocaleString()}
                  {person.asset_count === 1 ? 'photo' : 'photos'}
                {/if}
              </span>
            </a>
          {:else}
            <div class="col-span-full">
              <CimmichStatePanel
                title={peopleQuery
                  ? 'No matching people'
                  : viewMode === 'candidates'
                    ? 'No known-Person suggestions'
                    : viewMode === 'needsFace'
                      ? 'No people need attention'
                      : 'No people to show'}
                description={peopleQuery
                  ? 'Try another name or clear the current filters.'
                  : viewMode === 'candidates'
                    ? 'No saved evaluated reference library has open face suggestions for known people.'
                    : viewMode === 'needsFace'
                      ? 'No one currently needs sorting or Holding.'
                      : 'People will appear here when the current projection contains them.'}
              />
            </div>
          {/each}
        </section>

        {#if viewMode === 'needsFace'}
          <CimmichPossiblePeople mode="ignored" onignoredcount={(count) => (ignoredPossiblePeopleCount = count)} />
        {/if}
      {/if}
    {/if}
  </div>
</UserPageLayout>
