<script lang="ts">
  import { page } from '$app/state';
  import CimmichSectionHeader from '$lib/components/cimmich/CimmichSectionHeader.svelte';
  import CimmichStatePanel from '$lib/components/cimmich/CimmichStatePanel.svelte';
  import {
    chooseInitialPeopleView,
    comparePeople,
    defaultPeopleSort,
    nextPeopleSort,
    type PeopleSortKey,
    type PeopleSortState,
    type PeopleViewMode,
  } from '$lib/components/cimmich/people-presentation';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import { cimmichVisibilityManager } from '$lib/managers/cimmich-visibility-manager.svelte';
  import { Route } from '$lib/route';
  import {
    decideCimmichIdentityCandidate,
    getCimmichIdentityCandidates,
    getCimmichPeople,
    type CimmichIdentityCandidate,
    type CimmichPerson,
  } from '$lib/services/cimmich.service';
  import { getAssetMediaUrl } from '$lib/utils';
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
  let cimmichError = $state('');
  let cimmichLoaded = $state(false);
  let cimmichLoadGeneration = 0;
  let cimmichMessage = $state('');
  let cimmichPeople = $state<CimmichPerson[]>([]);
  let cimmichSavingClaimId = $state('');
  let initialViewChosen = $state(false);
  let minimumPhotos = $state(0);
  let peopleCategory = $state<PeopleCategory>('all');
  let peopleQuery = $state('');
  let peopleSort = $state<PeopleSortState>({ ...defaultPeopleSort });
  let peopleThumbnailSize = $state<PeopleThumbnailSize>('medium');
  let viewMode = $state<PersonViewMode>('faces');

  const viewModes: Array<{ id: PersonViewMode; label: string }> = [
    { id: 'faces', label: 'People' },
    { id: 'candidates', label: 'Suggestions' },
    { id: 'needsFace', label: 'Review list' },
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
    { id: 'sort', label: 'Review list' },
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
    cimmichPeople.filter((person) => person.needs_holding || person.needs_sort).length,
  );
  const cimmichCandidateCount = $derived(cimmichPeople.filter((person) => person.candidate_faces > 0).length);
  const faceBackedCount = $derived(cimmichFaceBackedCount);
  const needsFaceCount = $derived(cimmichNeedsFaceCount);

  const visibleCimmichPeople = $derived.by(() => {
    const query = peopleQuery.trim().toLowerCase();
    return cimmichPeople
      .filter((person) => relatedPersonIds.size === 0 || relatedPersonIds.has(person.person_id))
      .filter((person) =>
        viewMode === 'faces'
          ? true
          : viewMode === 'candidates'
            ? person.candidate_faces > 0
            : person.needs_holding || person.needs_sort,
      )
      .filter(
        (person) =>
          !query || [person.display_name, ...person.aliases].some((name) => name.toLowerCase().includes(query)),
      )
      .filter((person) => personInCategory(person, peopleCategory))
      .filter((person) => person.asset_count >= minimumPhotos)
      .sort((a, b) => comparePeople(a, b, peopleSort));
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
  const clampPercent = (value: number) => Math.max(0, Math.min(100, value));

  const cimmichCandidateCropStyle = (candidate: CimmichIdentityCandidate, padding = 2.4) => {
    if (!candidate.sourceAssetId) {
      return '';
    }
    const cropWidth = Math.max(0.01, Math.min(1, candidate.box_w * padding));
    const cropHeight = Math.max(0.01, Math.min(1, candidate.box_h * padding));
    const cropSize = Math.min(1, Math.max(cropWidth, cropHeight));
    const centerX = candidate.box_x + candidate.box_w / 2;
    const centerY = candidate.box_y + candidate.box_h / 2;
    const cropX = Math.max(0, Math.min(1 - cropSize, centerX - cropSize / 2));
    const cropY = Math.max(0, Math.min(1 - cropSize, centerY - cropSize / 2));
    const positionX = clampPercent((cropX / Math.max(0.0001, 1 - cropSize)) * 100);
    const positionY = clampPercent((cropY / Math.max(0.0001, 1 - cropSize)) * 100);
    return [
      `background-image: url("${getAssetMediaUrl({ id: candidate.sourceAssetId, size: AssetMediaSize.Preview })}")`,
      `background-size: ${100 / cropSize}% ${100 / cropSize}%`,
      `background-position: ${positionX}% ${positionY}%`,
    ].join('; ');
  };

  const cimmichSquareObservationStyle = ({
    boxH,
    boxW,
    boxX,
    boxY,
    height,
    padding,
    width,
  }: {
    boxH: number;
    boxW: number;
    boxX: number;
    boxY: number;
    height: number;
    padding: number;
    width: number;
  }) => {
    if (!width || !height) {
      return 'position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;';
    }
    const cropPixels = Math.min(width, height, Math.max(boxW * width * padding, boxH * height * padding, 1));
    const cropW = cropPixels / width;
    const cropH = cropPixels / height;
    const centerX = boxX + boxW / 2;
    const centerY = boxY + boxH / 2;
    const cropX = Math.max(0, Math.min(1 - cropW, centerX - cropW / 2));
    const cropY = Math.max(0, Math.min(1 - cropH, centerY - cropH / 2));
    return [
      'position: absolute',
      `width: ${100 / cropW}%`,
      'height: auto',
      'max-width: none',
      `left: ${(-cropX / cropW) * 100}%`,
      `top: ${(-cropY / cropH) * 100}%`,
    ].join('; ');
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
  ) => {
    if (!media.width || !media.height) {
      return 'position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;';
    }
    const sourceAspect = media.width / media.height;
    const presentationBase =
      sourceAspect > presentationAspect
        ? { h: 1, w: presentationAspect / sourceAspect }
        : { h: sourceAspect / presentationAspect, w: 1 };
    const crop = media.crop ?? {
      h: presentationBase.h,
      w: presentationBase.w,
      x: (1 - presentationBase.w) / 2,
      y: (1 - presentationBase.h) / 2,
    };
    const zoom = Math.max(1, Math.max(presentationBase.w / crop.w, presentationBase.h / crop.h));
    const squareBase = sourceAspect > 1 ? { h: 1, w: 1 / sourceAspect } : { h: sourceAspect, w: 1 };
    const cropW = squareBase.w / zoom;
    const cropH = squareBase.h / zoom;
    const centerX = crop.x + crop.w / 2;
    const centerY = crop.y + crop.h / 2;
    const cropX = Math.max(0, Math.min(1 - cropW, centerX - cropW / 2));
    const cropY = Math.max(0, Math.min(1 - cropH, centerY - cropH / 2));
    return [
      'position: absolute',
      `width: ${100 / cropW}%`,
      'height: auto',
      'max-width: none',
      `left: ${(-cropX / cropW) * 100}%`,
      `top: ${(-cropY / cropH) * 100}%`,
    ].join('; ');
  };

  const cimmichPresentationBodyCropStyle = (media: NonNullable<CimmichPerson['presentationBody']>) =>
    cimmichPresentationSquareCropStyle(media, 3 / 4);

  const cimmichPresentationFaceCropStyle = (media: NonNullable<CimmichPerson['presentationFace']>) =>
    cimmichPresentationSquareCropStyle(media, 1);

  const loadCimmichReview = async () => {
    const generation = ++cimmichLoadGeneration;
    cimmichLoaded = false;
    cimmichCandidates = [];
    cimmichPeople = [];
    try {
      const [candidates, identities] = await Promise.all([getCimmichIdentityCandidates(5), getCimmichPeople(500)]);
      if (generation !== cimmichLoadGeneration) {
        return;
      }
      cimmichCandidates = candidates;
      cimmichPeople = identities.filter((identity) => identity.subject_kind === 'person');
      if (!initialViewChosen) {
        viewMode = chooseInitialPeopleView(cimmichPeople);
        initialViewChosen = true;
      }
      cimmichError = '';
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
    void loadCimmichReview();
  });
</script>

<UserPageLayout>
  <div class="mx-auto flex w-full max-w-7xl flex-col gap-6 p-5 text-immich-fg dark:text-immich-dark-fg">
    <CimmichSectionHeader
      icon={mdiAccountMultipleOutline}
      title="People"
      meta={cimmichLoaded
        ? `${cimmichPeople.length.toLocaleString()} ${cimmichPeople.length === 1 ? 'person' : 'people'}`
        : 'Loading people'}
    >
      {#snippet actions()}
        <div
          class="flex min-h-11 w-full max-w-full items-center overflow-x-auto rounded-xl bg-gray-100 p-1 sm:w-auto dark:bg-immich-dark-gray"
          role="toolbar"
          aria-label="People views and categories"
        >
          {#each viewModes as mode (mode.id)}
            {@const count =
              mode.id === 'faces' ? faceBackedCount : mode.id === 'candidates' ? cimmichCandidateCount : needsFaceCount}
            <button
              class={[
                'inline-flex h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:gap-1.5 sm:px-3 sm:text-sm',
                viewMode === mode.id
                  ? 'bg-white text-primary shadow-sm dark:bg-black/25 dark:text-immich-dark-primary'
                  : 'text-gray-500 hover:text-immich-fg dark:text-gray-400 dark:hover:text-immich-dark-fg',
              ]}
              type="button"
              aria-pressed={viewMode === mode.id}
              onclick={() => (viewMode = mode.id)}
            >
              {mode.label}
              <span class="text-xs opacity-65">{count}</span>
            </button>
            {#if mode.id === 'faces'}
              <span class="mx-1 h-6 w-px shrink-0 bg-gray-300 dark:bg-gray-600" aria-hidden="true"></span>
            {/if}
          {/each}
        </div>
        <label
          class="flex h-11 w-full min-w-0 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm focus-within:border-primary sm:w-56 lg:w-64 dark:border-immich-dark-gray dark:bg-immich-dark-bg"
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
        <div
          class="flex min-w-max items-center overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-immich-dark-bg"
          aria-label="People view options"
        >
          <Tooltip text="Sort people">
            {#snippet child({ props })}
              <ContextMenuButton
                {...props}
                class="size-10"
                icon={mdiSortVariant}
                items={peopleSortActions}
                position="top-right"
                aria-label="Sort people"
              />
            {/snippet}
          </Tooltip>
          <Tooltip text="Filter people">
            {#snippet child({ props })}
              <ContextMenuButton
                {...props}
                class="size-10 border-l border-gray-200 dark:border-gray-700"
                icon={mdiFilterVariant}
                items={peopleFilterActions}
                position="top-right"
                aria-label="Filter people"
              />
            {/snippet}
          </Tooltip>
          <label
            class="relative inline-flex size-10 cursor-pointer items-center justify-center border-l border-gray-200 text-gray-500 transition hover:bg-gray-100 hover:text-gray-950 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
            title="Thumbnail size"
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
        </div>
      {/snippet}
    </CimmichSectionHeader>

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

    {#if viewMode === 'candidates' && cimmichCandidates.length > 0}
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
            href={Route.cimmichPerson({ name: person.display_name, personId: person.person_id })}
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
                      draggable="false"
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
                      draggable="false"
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
                >Review list</span
              >
            {:else if viewMode === 'candidates' && person.candidate_faces > 0}
              <span
                class="-mt-2 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-900 dark:bg-sky-950 dark:text-sky-100"
              >
                {person.candidate_faces.toLocaleString()}
                {person.candidate_faces === 1 ? 'candidate' : 'candidates'}
              </span>
            {/if}
            <span class="w-full truncate text-xs text-gray-500 dark:text-gray-400">
              {#if person.asset_count === 0}
                No photos in this view
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
                  ? 'No suggestions to review'
                  : viewMode === 'needsFace'
                    ? 'No people need attention'
                    : 'No people to show'}
              description={peopleQuery
                ? 'Try another name or clear the current filters.'
                : viewMode === 'candidates'
                  ? 'New ranked suggestions will appear here when they are ready.'
                  : viewMode === 'needsFace'
                    ? 'No one is currently waiting in Review list or Holding.'
                    : 'People will appear here when the current projection contains them.'}
            />
          </div>
        {/each}
      </section>
    {/if}
  </div>
</UserPageLayout>
