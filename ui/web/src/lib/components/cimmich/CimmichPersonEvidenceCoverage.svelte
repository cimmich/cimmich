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
    mdiCheckCircleOutline,
    mdiHumanGreeting,
    mdiImageSearchOutline,
    mdiMapMarkerOutline,
    mdiRun,
    mdiTimelineClockOutline,
  } from '@mdi/js';
  import { Icon } from '@immich/ui';
  import { evidenceCoverageNotes, evidenceCoveragePercent, evidenceSourceReason } from './person-evidence-coverage';

  interface Props {
    coverage: CimmichPersonEvidenceCoverage;
    onopenidentity: (filter: 'all' | 'candidates') => void;
    onopenphotos: (options?: { futureDates?: boolean }) => void;
    profileAssetCount: number;
  }

  let { coverage, onopenidentity, onopenphotos, profileAssetCount }: Props = $props();

  const notes = $derived(evidenceCoverageNotes(coverage));
  const outsideEvidenceCount = $derived(Math.max(0, profileAssetCount - coverage.assets.total));
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
</script>

<section class="grid gap-7" aria-labelledby="person-evidence-coverage-title">
  <header class="max-w-3xl">
    <p class="text-xs font-semibold tracking-[0.18em] text-primary uppercase">Accepted records</p>
    <h2 id="person-evidence-coverage-title" class="mt-2 text-2xl font-semibold">Evidence &amp; coverage</h2>
    <p class="mt-2 text-sm/6 text-gray-600 dark:text-gray-300">
      A read-only map of what Cimmich has actually accepted for {coverage.person.displayName}. Counts distinguish
      photos, observations and matcher references; none is an identity-confidence score.
    </p>
  </header>

  <dl class="grid gap-3 rounded-2xl border border-gray-200 p-4 sm:grid-cols-3 dark:border-gray-700">
    <div>
      <dt class="text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">Profile photos</dt>
      <dd class="mt-1 text-2xl font-semibold tabular-nums">{profileAssetCount.toLocaleString()}</dd>
    </div>
    <div>
      <dt class="text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
        Accepted evidence photos
      </dt>
      <dd class="mt-1 text-2xl font-semibold tabular-nums">{coverage.assets.total.toLocaleString()}</dd>
    </div>
    <div>
      <dt class="text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">Outside this map</dt>
      <dd class="mt-1 text-2xl font-semibold tabular-nums">{outsideEvidenceCount.toLocaleString()}</dd>
      <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
        Profile photos without accepted Face, Head, Body or Presence evidence.
      </p>
    </div>
  </dl>

  <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
    {#each evidenceRows as row (row.label)}
      <article class="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-immich-dark-bg">
        <div class="flex items-center gap-2 text-sm font-semibold">
          <span class="grid size-8 place-items-center rounded-full bg-primary/10 text-primary"
            ><Icon icon={row.icon} size="18" /></span
          >
          {row.label}
        </div>
        <strong class="mt-5 block text-2xl tabular-nums">{row.count.toLocaleString()}</strong>
        <span class="mt-1 block text-xs/5 text-gray-500 dark:text-gray-400">{row.detail}</span>
      </article>
    {/each}
  </div>

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

  <div class="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
    <section
      class="rounded-2xl border border-gray-200 p-5 dark:border-gray-700"
      aria-labelledby="coverage-timeline-title"
    >
      <div class="flex items-center gap-2">
        <Icon icon={mdiTimelineClockOutline} size="21" />
        <h3 id="coverage-timeline-title" class="text-lg font-semibold">Time coverage</h3>
      </div>
      <div class="mt-5 grid gap-2">
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
          <p class="text-sm text-gray-500 dark:text-gray-400">No accepted photo has a capture date.</p>
        {/each}
      </div>
    </section>

    <section
      class="rounded-2xl border border-gray-200 p-5 dark:border-gray-700"
      aria-labelledby="coverage-reference-title"
    >
      <div class="flex items-center gap-2">
        <Icon icon={mdiImageSearchOutline} size="21" />
        <h3 id="coverage-reference-title" class="text-lg font-semibold">Matcher reference gallery</h3>
      </div>
      <p class="mt-2 text-xs/5 text-gray-500 dark:text-gray-400">
        These are explicit gallery memberships, not every accepted Face shown as Supporting in Identity.
      </p>
      <dl class="mt-5 grid grid-cols-2 gap-3">
        {#each referenceRows as row (row.label)}
          <div class="rounded-xl bg-gray-50 p-3 dark:bg-immich-dark-gray">
            <dt class="text-xs text-gray-500 dark:text-gray-400">{row.label}</dt>
            <dd class="mt-1 text-xl font-semibold tabular-nums">{row.count.toLocaleString()}</dd>
          </div>
        {/each}
      </dl>
      <button
        class="mt-4 min-h-11 text-sm font-semibold text-primary hover:underline"
        type="button"
        onclick={() => onopenidentity('all')}
      >
        Open all Identity evidence
      </button>
    </section>
  </div>

  <section aria-labelledby="coverage-sources-title">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h3 id="coverage-sources-title" class="text-lg font-semibold">Representative evidence</h3>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          One accepted Face from different years. Open a card to inspect its recorded Face and Body evidence.
        </p>
      </div>
      <button
        class="min-h-11 text-sm font-semibold text-primary hover:underline"
        type="button"
        onclick={() => onopenphotos()}
      >
        View all person photos
      </button>
    </div>
    <div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {#each coverage.sourceSuggestions as source (source.faceId)}
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
            <span class="block text-xs font-semibold">{evidenceSourceReason(source)}</span>
            <span class="mt-1 block truncate text-xs text-gray-500 dark:text-gray-400">{source.filename}</span>
          </span>
        </a>
      {:else}
        <p
          class="col-span-full rounded-xl border border-dashed border-gray-300 p-5 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400"
        >
          No accepted Face source is available for suggestion.
        </p>
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
        <h3 id="coverage-context-title" class="text-lg font-semibold">Context observed</h3>
      </div>
      {#each [{ items: coverage.context.places, kind: 'place' as const, label: 'Places' }, { items: coverage.context.events, kind: 'event' as const, label: 'Events' }, { items: coverage.context.things, kind: 'object' as const, label: 'Things' }] as group (group.label)}
        <div class="mt-4">
          <h4 class="text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">{group.label}</h4>
          <div class="mt-2 flex flex-wrap gap-2">
            {#each group.items as item (item.entityId)}
              <a
                class="rounded-full bg-gray-100 px-3 py-1.5 text-sm transition hover:bg-primary/10 hover:text-primary dark:bg-immich-dark-gray"
                href={contextHref(group.kind, item.entityId)}
              >
                {item.displayName} <span class="text-gray-500">{item.assetCount.toLocaleString()}</span>
              </a>
            {:else}
              <span class="text-sm text-gray-500 dark:text-gray-400">None observed</span>
            {/each}
          </div>
        </div>
      {/each}
    </section>

    <section class="rounded-2xl border border-gray-200 p-5 dark:border-gray-700" aria-labelledby="coverage-notes-title">
      <div class="flex items-center gap-2">
        <Icon icon={mdiAlertCircleOutline} size="21" />
        <h3 id="coverage-notes-title" class="text-lg font-semibold">Coverage notes</h3>
      </div>
      <div class="mt-4 grid gap-3">
        {#each notes as note (note.title)}
          <article class="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
            <div class="flex gap-3">
              <Icon
                icon={note.kind === 'ready' ? mdiCheckCircleOutline : mdiAlertCircleOutline}
                size="19"
                class={note.kind === 'attention' ? 'text-amber-600' : 'text-primary'}
              />
              <div class="min-w-0">
                <h4 class="font-semibold">{note.title}</h4>
                <p class="mt-1 text-sm/5 text-gray-600 dark:text-gray-300">{note.detail}</p>
                {#if note.action}
                  <button
                    class="mt-2 min-h-9 text-sm font-semibold text-primary hover:underline"
                    type="button"
                    onclick={() =>
                      note.action === 'candidates' ? onopenidentity('candidates') : onopenphotos({ futureDates: true })}
                  >
                    {note.action === 'candidates' ? 'Review proposed Faces' : 'Show affected photos'}
                  </button>
                {/if}
              </div>
            </div>
          </article>
        {/each}
      </div>
    </section>
  </div>
</section>
