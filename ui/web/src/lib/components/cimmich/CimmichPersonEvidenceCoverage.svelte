<script lang="ts">
  import type { CimmichPersonEvidenceCoverage } from '$lib/services/cimmich.service';
  import { Route } from '$lib/route';
  import { getAssetMediaUrl } from '$lib/utils';
  import { cimmichSquareCropBackgroundStyle } from '$lib/utils/cimmich-crop';
  import { AssetMediaSize } from '@immich/sdk';
  import {
    mdiAccountCheckOutline,
    mdiAlertCircleOutline,
    mdiCalendarRange,
    mdiChevronDown,
    mdiHumanGreeting,
    mdiImageSearchOutline,
    mdiMapMarkerOutline,
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

  const notes = $derived(evidenceCoverageNotes(coverage));
  const actionableNotes = $derived(notes.filter((note) => note.action !== null));
  const orderedSourceSuggestions = $derived(
    [...coverage.sourceSuggestions].sort((left, right) => {
      if (!left.captureTime) {
        return 1;
      }
      if (!right.captureTime) {
        return -1;
      }
      return left.captureTime.localeCompare(right.captureTime) || left.faceId.localeCompare(right.faceId);
    }),
  );
  const maximumYearCount = $derived(Math.max(1, ...coverage.time.years.map(({ assetCount }) => assetCount)));
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

  const sourceStyle = (source: CimmichPersonEvidenceCoverage['sourceSuggestions'][number]) =>
    cimmichSquareCropBackgroundStyle({
      boxH: source.box.h,
      boxW: source.box.w,
      boxX: source.box.x,
      boxY: source.box.y,
      height: source.height,
      padding: 2.2,
      url: getAssetMediaUrl({ id: source.sourceAssetId, size: AssetMediaSize.Thumbnail }),
      width: source.width,
    });

  const sourceYear = (source: CimmichPersonEvidenceCoverage['sourceSuggestions'][number]) => {
    if (!source.captureTime) {
      return 'Date unknown';
    }
    return new Date(source.captureTime).getUTCFullYear().toString();
  };
</script>

<section class="grid gap-8" aria-labelledby="person-evidence-coverage-title">
  <header class="flex flex-wrap items-end justify-between gap-4">
    <div>
      <h2 id="person-evidence-coverage-title" class="text-2xl font-semibold">
        {coverage.person.displayName} in Cimmich
      </h2>
      <p class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
        <span>{coverage.assets.total.toLocaleString()} available photos</span>
      </p>
    </div>
    <button
      class="min-h-11 text-sm font-semibold text-primary hover:underline"
      type="button"
      onclick={() => onopenphotos()}
    >
      View all photos
    </button>
  </header>

  <section aria-labelledby="coverage-examples-title">
    <div class="mb-3">
      <h3 id="coverage-examples-title" class="text-xl font-semibold">Recognition examples</h3>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
        One strong accepted Face from each available year, shown oldest first.
      </p>
    </div>
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {#each orderedSourceSuggestions as source (source.faceId)}
        <a
          class="group overflow-hidden rounded-2xl border border-gray-200 bg-white transition hover:-translate-y-0.5 hover:shadow-md dark:border-gray-700 dark:bg-immich-dark-bg"
          href={Route.viewCimmichPersonAsset({
            faceId: source.faceId,
            id: source.sourceAssetId,
            overlay: 'machinery',
            personId: coverage.person.personId,
            personName: coverage.person.displayName,
          })}
        >
          <span
            class="block aspect-square bg-gray-200 bg-cover bg-no-repeat dark:bg-gray-800"
            style={sourceStyle(source)}
          ></span>
          <span class="block p-3">
            <span class="block text-xs font-semibold">{sourceYear(source)}</span>
            <span class="mt-1 block truncate text-xs text-gray-500 dark:text-gray-400">{source.filename}</span>
          </span>
        </a>
      {:else}
        <p
          class="col-span-full rounded-xl border border-dashed border-gray-300 p-5 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400"
        >
          No example photo is available yet.
        </p>
      {/each}
    </div>
  </section>

  <section aria-labelledby="coverage-recognition-title">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 id="coverage-recognition-title" class="text-xl font-semibold">
          How Cimmich recognises {coverage.person.displayName}
        </h3>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Face is strongest. Body keeps useful photos when a clear face is not available.
        </p>
      </div>
      <button
        class="min-h-11 text-sm font-semibold text-primary hover:underline"
        type="button"
        onclick={() => onopenidentity('all')}
      >
        See recognition evidence
      </button>
    </div>
    <div class="mt-4 grid gap-3 sm:grid-cols-2">
      <article class="rounded-2xl border border-gray-200 p-5 dark:border-gray-700">
        <div class="flex items-center gap-2 font-semibold">
          <span class="grid size-9 place-items-center rounded-full bg-primary/10 text-primary"
            ><Icon icon={mdiAccountCheckOutline} size="20" /></span
          >
          Face visible
        </div>
        <strong class="mt-5 block text-3xl tabular-nums">{coverage.assets.face.toLocaleString()}</strong>
        <span class="mt-1 block text-sm text-gray-500 dark:text-gray-400">photos</span>
      </article>
      <article class="rounded-2xl border border-gray-200 p-5 dark:border-gray-700">
        <div class="flex items-center gap-2 font-semibold">
          <span class="grid size-9 place-items-center rounded-full bg-primary/10 text-primary"
            ><Icon icon={mdiHumanGreeting} size="20" /></span
          >
          Body connected
        </div>
        <div class="mt-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <strong class="block text-3xl tabular-nums">{coverage.assets.body.toLocaleString()}</strong>
            <span class="mt-1 block text-sm text-gray-500 dark:text-gray-400">photos</span>
          </div>
          <div class="text-right">
            <strong class="block text-xl tabular-nums">{coverage.assets.bodyOnly.toLocaleString()}</strong>
            <span class="mt-1 block text-xs text-gray-500 dark:text-gray-400">Body only</span>
          </div>
        </div>
        <button
          class="mt-4 min-h-11 text-sm font-semibold text-primary hover:underline"
          type="button"
          onclick={() => onopenidentity('body')}
        >
          Review Body evidence
        </button>
      </article>
    </div>
    <details class="mt-3 text-sm text-gray-600 dark:text-gray-300">
      <summary class="min-h-11 cursor-pointer py-3 font-medium text-primary">Why do these numbers overlap?</summary>
      <p class="max-w-2xl pb-2 text-sm/6">
        A photo can show both a face and a body. “Body only” is the smaller set connected without an accepted Face or
        Head.
      </p>
    </details>
  </section>

  <section
    class="rounded-2xl border border-gray-200 p-5 dark:border-gray-700"
    aria-labelledby="coverage-timeline-title"
  >
    <div class="flex items-center gap-2">
      <Icon icon={mdiTimelineClockOutline} size="21" />
      <h3 id="coverage-timeline-title" class="text-xl font-semibold">When these photos were taken</h3>
    </div>
    <div class="mt-5 grid gap-x-8 gap-y-2 xl:grid-cols-2">
      {#each coverage.time.years as year (year.year)}
        <div class="grid grid-cols-[3.5rem_minmax(0,1fr)_4.5rem] items-center gap-3 text-sm">
          <span class="font-medium tabular-nums">{year.year}</span>
          <span class="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
            <span
              class="block h-full rounded-full bg-primary/75"
              style={`width: ${Math.max(2, Math.round((year.assetCount / maximumYearCount) * 100))}%`}
            ></span>
          </span>
          <span class="text-right text-gray-500 tabular-nums dark:text-gray-400"
            >{year.assetCount.toLocaleString()}</span
          >
        </div>
      {:else}
        <p class="text-sm text-gray-500 dark:text-gray-400">No photo has a capture date yet.</p>
      {/each}
    </div>
  </section>

  <div class="grid gap-6 lg:grid-cols-2">
    <section
      class="rounded-2xl border border-gray-200 p-5 dark:border-gray-700"
      aria-labelledby="coverage-context-title"
    >
      <div class="flex items-center gap-2">
        <Icon icon={mdiMapMarkerOutline} size="21" />
        <h3 id="coverage-context-title" class="text-xl font-semibold">Where {coverage.person.displayName} appears</h3>
      </div>
      {#each [{ items: coverage.context.places, kind: 'place' as const, label: 'Places' }, { items: coverage.context.events, kind: 'event' as const, label: 'Events' }, { items: coverage.context.things, kind: 'object' as const, label: 'Things' }] as group (group.label)}
        {#if group.items.length > 0}
          <div class="mt-4">
            <h4 class="text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
              {group.label}
            </h4>
            <div class="mt-2 flex flex-wrap gap-2">
              {#each group.items as item (item.entityId)}
                <a
                  class="rounded-full bg-gray-100 px-3 py-1.5 text-sm transition hover:bg-primary/10 hover:text-primary dark:bg-immich-dark-gray"
                  href={contextHref(group.kind, item.entityId)}
                >
                  {item.displayName} <span class="text-gray-500">{item.assetCount.toLocaleString()}</span>
                </a>
              {/each}
            </div>
          </div>
        {/if}
      {/each}
    </section>

    <section class="rounded-2xl border border-gray-200 p-5 dark:border-gray-700" aria-labelledby="coverage-notes-title">
      <div class="flex items-center gap-2">
        <Icon icon={mdiAlertCircleOutline} size="21" />
        <h3 id="coverage-notes-title" class="text-xl font-semibold">Needs your attention</h3>
      </div>
      <div class="mt-4 grid gap-3">
        {#each actionableNotes as note (note.title)}
          <article class="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
            <div class="flex gap-3">
              <Icon icon={mdiAlertCircleOutline} size="19" class="text-amber-600" />
              <div class="min-w-0">
                <h4 class="font-semibold">{note.title}</h4>
                <p class="mt-1 text-sm/5 text-gray-600 dark:text-gray-300">{note.detail}</p>
                <button
                  class="mt-2 min-h-9 text-sm font-semibold text-primary hover:underline"
                  type="button"
                  onclick={() =>
                    note.action === 'candidates' ? onopenidentity('candidates') : onopenphotos({ futureDates: true })}
                >
                  {note.action === 'candidates' ? 'Review proposed Faces' : 'Show affected photos'}
                </button>
              </div>
            </div>
          </article>
        {:else}
          <p class="rounded-xl bg-primary/5 p-4 text-sm text-gray-700 dark:text-gray-200">
            Nothing needs review right now.
          </p>
        {/each}
      </div>
    </section>
  </div>

  <details class="group rounded-2xl border border-gray-200 dark:border-gray-700">
    <summary class="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 font-semibold">
      Advanced evidence details
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
