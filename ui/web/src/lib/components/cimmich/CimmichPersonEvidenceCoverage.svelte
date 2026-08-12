<script lang="ts">
  import type {
    CimmichPersonEvidenceCoverage,
    CimmichPersonEvidenceCoverageContext,
  } from '$lib/services/cimmich.service';
  import { Route } from '$lib/route';
  import { getAssetMediaUrl } from '$lib/utils';
  import { cimmichSquareCropBackgroundStyle } from '$lib/utils/cimmich-crop';
  import { AssetMediaSize } from '@immich/sdk';
  import {
    mdiAccountCheckOutline,
    mdiAccountGroupOutline,
    mdiAlertCircleOutline,
    mdiCalendarRange,
    mdiChevronDown,
    mdiHumanGreeting,
    mdiImageMultipleOutline,
    mdiImageSearchOutline,
    mdiMapMarkerOutline,
    mdiPawOutline,
    mdiRun,
    mdiTimelineClockOutline,
  } from '@mdi/js';
  import { Icon } from '@immich/ui';
  import { evidenceCoverageNotes, evidenceCoveragePercent } from './person-evidence-coverage';

  interface Props {
    coverage: CimmichPersonEvidenceCoverage;
    onopenidentity: (filter: 'all' | 'body' | 'candidates') => void;
    onopenphotos: (options?: { futureDates?: boolean }) => void;
  }

  let { coverage, onopenidentity, onopenphotos }: Props = $props();

  const currentYear = new Date().getUTCFullYear();
  const notes = $derived(evidenceCoverageNotes(coverage));
  const actionableNotes = $derived(notes.filter((note) => note.action !== null));
  const timelineSources = $derived(
    [...coverage.sourceSuggestions].sort((left, right) => {
      if (!left.captureTime) {
        return 1;
      }
      if (!right.captureTime) {
        return -1;
      }
      return left.captureTime.localeCompare(right.captureTime) || left.sourceAssetId.localeCompare(right.sourceAssetId);
    }),
  );
  const credibleYears = $derived(coverage.time.years.filter(({ year }) => year <= currentYear));
  const firstYear = $derived(credibleYears.at(0)?.year ?? null);
  const lastYear = $derived(credibleYears.at(-1)?.year ?? null);
  const yearRange = $derived(
    firstYear === null ? 'Dates unavailable' : firstYear === lastYear ? `${firstYear}` : `${firstYear}–${lastYear}`,
  );
  const yearCounts = $derived(new Map(coverage.time.years.map(({ assetCount, year }) => [year, assetCount])));
  const maximumYearCount = $derived(Math.max(1, ...coverage.time.years.map(({ assetCount }) => assetCount)));
  const facePercent = $derived(evidenceCoveragePercent(coverage.assets.face, coverage.assets.total));
  const contextGroups = $derived([
    { icon: mdiMapMarkerOutline, items: coverage.context.places, kind: 'place' as const, label: 'Places' },
    { icon: mdiCalendarRange, items: coverage.context.events, kind: 'event' as const, label: 'Events' },
    { icon: mdiImageMultipleOutline, items: coverage.context.things, kind: 'object' as const, label: 'Things' },
  ]);
  const maximumContextCount = $derived(
    Math.max(1, ...contextGroups.flatMap(({ items }) => items.map(({ assetCount }) => assetCount))),
  );
  const maximumCoSubjectCount = $derived(Math.max(1, ...coverage.coSubjects.map(({ assetCount }) => assetCount)));
  const evidenceRows = $derived([
    {
      count: coverage.assets.face,
      detail: `${coverage.observations.face.toLocaleString()} accepted observations`,
      icon: mdiAccountCheckOutline,
      label: 'Face photos',
    },
    {
      count: coverage.assets.body,
      detail: `${coverage.observations.body.toLocaleString()} accepted Body observations · ${coverage.observations.bodyHints.toLocaleString()} imported Body hints`,
      icon: mdiHumanGreeting,
      label: 'Body photos',
    },
    {
      count: coverage.assets.bodyOnly,
      detail: 'Accepted Body without an accepted Face or Head',
      icon: mdiHumanGreeting,
      label: 'Body-only photos',
    },
    {
      count: coverage.assets.head,
      detail: `${coverage.observations.head.toLocaleString()} standalone Head observations`,
      icon: mdiAccountCheckOutline,
      label: 'Head photos',
    },
    {
      count: coverage.assets.presence,
      detail: `${coverage.observations.presence.toLocaleString()} accepted Presence records`,
      icon: mdiHumanGreeting,
      label: 'Presence photos',
    },
  ]);
  const referenceRows = $derived([
    { count: coverage.references.prime, label: 'Core references' },
    { count: coverage.references.secondary, label: 'Supporting matcher refs' },
    { count: coverage.references.lowQuality, label: 'Low-quality refs' },
    { count: coverage.references.head, label: 'Head references' },
  ]);
  const processingRows = $derived([
    {
      detail: `${coverage.observations.pose.toLocaleString()} of ${coverage.observations.body.toLocaleString()} accepted Body observations`,
      icon: mdiRun,
      label: 'Pose geometry',
      percent: evidenceCoveragePercent(coverage.observations.pose, coverage.observations.body),
    },
    {
      detail: `${coverage.assets.dated.toLocaleString()} of ${coverage.assets.total.toLocaleString()} accepted evidence photos`,
      icon: mdiCalendarRange,
      label: 'Capture dates',
      percent: evidenceCoveragePercent(coverage.assets.dated, coverage.assets.total),
    },
  ]);

  const contextHref = (kind: 'event' | 'object' | 'place', entityId: string) => {
    const root =
      kind === 'event' ? Route.cimmichEvents() : kind === 'object' ? Route.cimmichThings() : Route.cimmichPlaces();
    return `${root}?entityId=${encodeURIComponent(entityId)}`;
  };

  const sourceStyle = (source: CimmichPersonEvidenceCoverage['sourceSuggestions'][number]) => {
    const url = getAssetMediaUrl({ id: source.sourceAssetId, size: AssetMediaSize.Thumbnail });
    if (!source.box) {
      return `background-image: url("${url}"); background-position: center;`;
    }
    return cimmichSquareCropBackgroundStyle({
      boxH: source.box.h,
      boxW: source.box.w,
      boxX: source.box.x,
      boxY: source.box.y,
      height: source.height,
      padding: 2.6,
      url,
      width: source.width,
    });
  };

  const sourceYear = (source: CimmichPersonEvidenceCoverage['sourceSuggestions'][number]) =>
    source.captureTime ? new Date(source.captureTime).getUTCFullYear() : null;
  const yearVolume = (year: number | null) => (year === null ? 0 : (yearCounts.get(year) ?? 0));
  const yearBarHeight = (year: number | null) =>
    `${Math.max(8, Math.round((yearVolume(year) / maximumYearCount) * 100))}%`;
  const contextBarWidth = (item: CimmichPersonEvidenceCoverageContext) =>
    `${Math.max(5, Math.round((item.assetCount / maximumContextCount) * 100))}%`;
  const coSubjectBarWidth = (assetCount: number) =>
    `${Math.max(6, Math.round((assetCount / maximumCoSubjectCount) * 100))}%`;
  const coSubjectHref = (subject: CimmichPersonEvidenceCoverage['coSubjects'][number]) =>
    subject.subjectKind === 'pet'
      ? Route.cimmichPet({ name: subject.displayName, petId: subject.subjectId })
      : Route.cimmichPerson({ name: subject.displayName, personId: subject.subjectId });
  const coSubjectStyle = (subject: CimmichPersonEvidenceCoverage['coSubjects'][number]) => {
    if (!subject.sourceAssetId) {
      return '';
    }
    const image = `background-image: url("${getAssetMediaUrl({ id: subject.sourceAssetId, size: AssetMediaSize.Thumbnail })}")`;
    const crop = subject.crop;
    if (!crop) {
      return `${image}; background-size: cover; background-position: center`;
    }
    const positionX = crop.w >= 1 ? 50 : (crop.x / Math.max(0.0001, 1 - crop.w)) * 100;
    const positionY = crop.h >= 1 ? 50 : (crop.y / Math.max(0.0001, 1 - crop.h)) * 100;
    return `${image}; background-size: ${100 / crop.w}% ${100 / crop.h}%; background-position: ${positionX}% ${positionY}%`;
  };
</script>

<section class="grid gap-6" aria-label="Identity overview">
  <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Library snapshot">
    <article class="relative overflow-hidden rounded-3xl bg-primary p-5 text-white shadow-sm">
      <div class="absolute -top-6 -right-6 size-28 rounded-full bg-white/10"></div>
      <div class="flex items-center gap-2 text-sm font-semibold text-white/80">
        <Icon icon={mdiImageMultipleOutline} size="19" /> Photos
      </div>
      <strong class="mt-5 block text-4xl tabular-nums">{coverage.assets.total.toLocaleString()}</strong>
      <button
        class="mt-3 min-h-10 text-sm font-semibold underline decoration-white/50 underline-offset-4"
        type="button"
        onclick={() => onopenphotos()}
      >
        View all photos
      </button>
    </article>

    <article
      class="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-immich-dark-bg"
    >
      <div class="flex items-center gap-2 text-sm font-semibold text-gray-500 dark:text-gray-400">
        <Icon icon={mdiTimelineClockOutline} size="19" /> Years represented
      </div>
      <strong class="mt-5 block text-4xl tabular-nums">{credibleYears.length.toLocaleString()}</strong>
      <span class="mt-2 block text-sm text-gray-500 dark:text-gray-400">{yearRange}</span>
    </article>

    <button
      class="rounded-3xl border border-gray-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md dark:border-gray-700 dark:bg-immich-dark-bg"
      type="button"
      onclick={() => onopenidentity('all')}
    >
      <span class="flex items-center gap-2 text-sm font-semibold text-gray-500 dark:text-gray-400">
        <Icon icon={mdiAccountCheckOutline} size="19" /> Face visible
      </span>
      <span class="mt-5 flex items-end justify-between gap-3">
        <strong class="text-4xl tabular-nums">{coverage.assets.face.toLocaleString()}</strong>
        <span class="pb-1 text-sm font-semibold text-primary">{facePercent}%</span>
      </span>
      <span class="mt-3 block h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700" aria-hidden="true">
        <span class="block h-full rounded-full bg-primary" style={`width: ${facePercent}%`}></span>
      </span>
    </button>

    <button
      class="rounded-3xl border border-gray-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md dark:border-gray-700 dark:bg-immich-dark-bg"
      type="button"
      onclick={() => onopenidentity('body')}
    >
      <span class="flex items-center gap-2 text-sm font-semibold text-gray-500 dark:text-gray-400">
        <Icon icon={mdiHumanGreeting} size="19" /> Body-only photos
      </span>
      <strong class="mt-5 block text-4xl tabular-nums">{coverage.assets.bodyOnly.toLocaleString()}</strong>
      <span class="mt-2 block text-sm font-semibold text-primary">Open this set</span>
    </button>
  </section>

  <section
    class="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-immich-dark-bg"
    aria-labelledby="coverage-timeline-title"
  >
    <header class="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-4 sm:px-6 sm:pt-6">
      <h2 id="coverage-timeline-title" class="text-xl font-semibold">Timeline evolution</h2>
      <span class="text-xs font-medium text-gray-500 dark:text-gray-400">Scroll through time →</span>
    </header>

    <div
      class="flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-6 sm:px-6"
      aria-label="One photo per represented year"
    >
      {#each timelineSources as source (source.sourceAssetId)}
        {@const year = sourceYear(source)}
        <a
          class="group w-36 shrink-0 snap-start overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md dark:border-gray-700 dark:bg-immich-dark-gray"
          href={Route.viewCimmichPersonAsset({
            id: source.sourceAssetId,
            personId: coverage.person.personId,
            personName: coverage.person.displayName,
          })}
        >
          <span class="relative block aspect-4/5 overflow-hidden bg-gray-200 dark:bg-gray-800">
            <span
              class="absolute inset-0 bg-cover bg-no-repeat transition duration-300 group-hover:scale-[1.03]"
              style={sourceStyle(source)}
            ></span>
            {#if year !== null && year > currentYear}
              <span
                class="absolute top-2 right-2 rounded-full bg-amber-500 px-2 py-1 text-[10px] font-bold text-white shadow-sm"
                >Check date</span
              >
            {/if}
          </span>
          <span class="grid grid-cols-[1fr_1.25rem] gap-2 p-3">
            <span>
              <strong class="block text-base tabular-nums">{year ?? 'Unknown'}</strong>
              <span class="mt-0.5 block text-xs text-gray-500 dark:text-gray-400"
                >{yearVolume(year).toLocaleString()} photos</span
              >
            </span>
            <span class="flex h-9 items-end rounded-full bg-gray-200 px-1 dark:bg-gray-700" aria-hidden="true">
              <span class="block w-full rounded-full bg-primary/80" style={`height: ${yearBarHeight(year)}`}></span>
            </span>
          </span>
        </a>
      {:else}
        <p
          class="w-full rounded-2xl border border-dashed border-gray-300 p-5 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400"
        >
          No dated photo is available for the timeline yet.
        </p>
      {/each}
    </div>
  </section>

  <div class="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
    <section
      class="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6 dark:border-gray-700 dark:bg-immich-dark-bg"
      aria-labelledby="coverage-context-title"
    >
      <div class="flex items-center gap-2">
        <span class="grid size-10 place-items-center rounded-full bg-primary/10 text-primary"
          ><Icon icon={mdiMapMarkerOutline} size="21" /></span
        >
        <div>
          <h2 id="coverage-context-title" class="text-xl font-semibold">Places & stories</h2>
          <p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">The strongest connections across these photos.</p>
        </div>
      </div>

      <div class="mt-5 grid gap-6 md:grid-cols-2">
        {#each contextGroups as group (group.label)}
          <section class={group.kind === 'place' ? 'md:col-span-2' : ''}>
            <h3
              class="flex items-center gap-2 text-xs font-bold tracking-wide text-gray-500 uppercase dark:text-gray-400"
            >
              <Icon icon={group.icon} size="16" />
              {group.label}
            </h3>
            <div class={['mt-3 grid gap-2', group.kind === 'place' && 'sm:grid-cols-2']}>
              {#each group.items as item (item.entityId)}
                <a
                  class="group relative overflow-hidden rounded-xl bg-gray-50 px-3 py-2.5 dark:bg-immich-dark-gray"
                  href={contextHref(group.kind, item.entityId)}
                >
                  <span
                    class="absolute inset-y-0 left-0 bg-primary/10 transition group-hover:bg-primary/20"
                    style={`width: ${contextBarWidth(item)}`}
                  ></span>
                  <span class="relative flex items-center justify-between gap-3 text-sm">
                    <span class="min-w-0 font-medium text-pretty">{item.displayName}</span>
                    <strong class="tabular-nums">{item.assetCount.toLocaleString()}</strong>
                  </span>
                </a>
              {:else}
                <span class="text-sm text-gray-400">Nothing linked yet</span>
              {/each}
            </div>
          </section>
        {/each}
      </div>
    </section>

    <section
      class="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6 dark:border-gray-700 dark:bg-immich-dark-bg"
      aria-labelledby="coverage-co-subjects-title"
    >
      <div class="flex items-center gap-2">
        <span class="grid size-10 place-items-center rounded-full bg-primary/10 text-primary"
          ><Icon icon={mdiAccountGroupOutline} size="21" /></span
        >
        <div>
          <h2 id="coverage-co-subjects-title" class="text-xl font-semibold">People & pets</h2>
          <p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">Most frequent</p>
        </div>
      </div>
      <div class="mt-5 grid gap-2.5">
        {#each coverage.coSubjects as subject (subject.subjectId)}
          <a
            class="group relative grid min-h-16 grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 overflow-hidden rounded-2xl bg-gray-50 p-2.5 transition hover:-translate-y-0.5 hover:shadow-sm dark:bg-immich-dark-gray"
            href={coSubjectHref(subject)}
          >
            <span
              class="absolute inset-y-0 left-0 bg-primary/10 transition group-hover:bg-primary/15"
              style={`width: ${coSubjectBarWidth(subject.assetCount)}`}
              aria-hidden="true"
            ></span>
            <span
              class="relative grid size-12 place-items-center overflow-hidden rounded-full bg-gray-200 bg-cover bg-center text-gray-500 dark:bg-gray-700 dark:text-gray-300"
              style={coSubjectStyle(subject)}
            >
              {#if !subject.sourceAssetId}
                <Icon icon={subject.subjectKind === 'pet' ? mdiPawOutline : mdiAccountGroupOutline} size="22" />
              {/if}
            </span>
            <span class="relative min-w-0">
              <strong class="block truncate text-sm">{subject.displayName}</strong>
              <span class="mt-0.5 block text-xs text-gray-500 capitalize dark:text-gray-400">{subject.subjectKind}</span
              >
            </span>
            <span class="relative pr-1 text-right">
              <strong class="block text-base tabular-nums">{subject.assetCount.toLocaleString()}</strong>
              <span class="block text-[11px] text-gray-500 dark:text-gray-400">photos</span>
            </span>
          </a>
        {:else}
          <p class="rounded-2xl bg-gray-50 p-5 text-sm text-gray-500 dark:bg-immich-dark-gray dark:text-gray-400">
            No one else appears often enough yet.
          </p>
        {/each}
      </div>
    </section>
  </div>

  <section
    class="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6 dark:border-gray-700 dark:bg-immich-dark-bg"
    aria-labelledby="coverage-notes-title"
  >
    <div class="flex items-center gap-2">
      <span class="grid size-10 place-items-center rounded-full bg-amber-500/10 text-amber-600"
        ><Icon icon={mdiAlertCircleOutline} size="21" /></span
      >
      <div>
        <h2 id="coverage-notes-title" class="text-xl font-semibold">Review queue</h2>
        <p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
          Items where your decision would improve the library.
        </p>
      </div>
    </div>
    <div class="mt-5 grid gap-3 lg:grid-cols-2">
      {#each actionableNotes as note (note.title)}
        <article
          class="flex flex-col justify-between gap-4 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 sm:flex-row sm:items-center dark:border-amber-900 dark:bg-amber-950/20"
        >
          <div>
            <h3 class="font-semibold">{note.title}</h3>
            <p class="mt-1 text-sm/5 text-gray-600 dark:text-gray-300">{note.detail}</p>
          </div>
          <button
            class="min-h-10 shrink-0 rounded-full bg-primary px-4 text-sm font-semibold text-white transition hover:bg-primary/90"
            type="button"
            onclick={() =>
              note.action === 'candidates' ? onopenidentity('candidates') : onopenphotos({ futureDates: true })}
          >
            {note.action === 'candidates' ? 'Review proposed Faces' : 'Show affected photos'}
          </button>
        </article>
      {:else}
        <div
          class="rounded-2xl bg-emerald-50 p-5 text-sm text-emerald-800 lg:col-span-2 dark:bg-emerald-950/30 dark:text-emerald-200"
        >
          Nothing needs review right now.
        </div>
      {/each}
    </div>
  </section>

  <details
    class="group rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-immich-dark-bg"
  >
    <summary class="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 font-semibold">
      Technical details
      <Icon icon={mdiChevronDown} size="20" class="transition-transform group-open:rotate-180" />
    </summary>
    <div class="grid gap-6 border-t border-gray-200 p-5 dark:border-gray-700">
      <section class="grid gap-3 sm:grid-cols-2" aria-label="Processing coverage">
        {#each processingRows as row (row.label)}
          <article class="rounded-2xl border border-gray-200 p-4 dark:border-gray-700">
            <div class="flex items-center gap-2 text-sm font-semibold">
              <span class="grid size-8 place-items-center rounded-full bg-primary/10 text-primary"
                ><Icon icon={row.icon} size="18" /></span
              >
              {row.label}
            </div>
            <p class="mt-3 text-sm text-gray-600 dark:text-gray-300">{row.detail}</p>
            <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700" aria-hidden="true">
              <span class="block h-full rounded-full bg-primary" style={`width: ${row.percent}%`}></span>
            </div>
          </article>
        {/each}
      </section>

      <section aria-labelledby="coverage-records-title">
        <h3 id="coverage-records-title" class="text-lg font-semibold">Accepted records</h3>
        <div class="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {#each evidenceRows as row (row.label)}
            <article class="rounded-xl bg-gray-50 p-4 dark:bg-immich-dark-gray">
              <div class="flex items-center gap-2 text-sm font-semibold">
                <Icon icon={row.icon} size="18" />{row.label}
              </div>
              <strong class="mt-4 block text-2xl tabular-nums">{row.count.toLocaleString()}</strong>
              <span class="mt-1 block text-xs/5 text-gray-500 dark:text-gray-400">{row.detail}</span>
            </article>
          {/each}
        </div>
      </section>

      <section aria-labelledby="coverage-reference-title">
        <div class="flex items-center gap-2">
          <Icon icon={mdiImageSearchOutline} size="21" />
          <h3 id="coverage-reference-title" class="text-lg font-semibold">Recognition reference gallery</h3>
        </div>
        <dl class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {#each referenceRows as row (row.label)}
            <div class="rounded-xl bg-gray-50 p-3 dark:bg-immich-dark-gray">
              <dt class="text-xs text-gray-500 dark:text-gray-400">{row.label}</dt>
              <dd class="mt-1 text-xl font-semibold tabular-nums">{row.count.toLocaleString()}</dd>
            </div>
          {/each}
        </dl>
      </section>

      <section aria-labelledby="coverage-terms-title">
        <h3 id="coverage-terms-title" class="text-lg font-semibold">What these terms mean</h3>
        <dl class="mt-3 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt class="font-semibold">Observation</dt>
            <dd class="mt-1 text-gray-600 dark:text-gray-300">
              One accepted marked region. A photo can contain more than one.
            </dd>
          </div>
          <div>
            <dt class="font-semibold">Imported Body hint</dt>
            <dd class="mt-1 text-gray-600 dark:text-gray-300">
              A pre-Cimmich Body tag retained unless stronger Face or Head evidence replaces it.
            </dd>
          </div>
          <div>
            <dt class="font-semibold">Pose geometry</dt>
            <dd class="mt-1 text-gray-600 dark:text-gray-300">
              Saved body-joint positions used to place and compare a Body observation.
            </dd>
          </div>
          <div>
            <dt class="font-semibold">Reference gallery</dt>
            <dd class="mt-1 text-gray-600 dark:text-gray-300">
              Selected examples the matcher uses for recognition, grouped by usefulness.
            </dd>
          </div>
        </dl>
      </section>
    </div>
  </details>
</section>
