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
    onopenidentity: () => void;
    onopenphotos: () => void;
  }

  let { coverage, onopenidentity, onopenphotos }: Props = $props();

  const notes = $derived(evidenceCoverageNotes(coverage));
  const maximumYearCount = $derived(Math.max(1, ...coverage.time.years.map(({ assetCount }) => assetCount)));
  const coverageRows = $derived([
    {
      detail: `${coverage.assets.face.toLocaleString()} photos`,
      icon: mdiAccountCheckOutline,
      label: 'Face observed',
      percent: evidenceCoveragePercent(coverage.assets.face, coverage.assets.total),
    },
    {
      detail: `${coverage.assets.body.toLocaleString()} photos`,
      icon: mdiHumanGreeting,
      label: 'Body observed',
      percent: evidenceCoveragePercent(coverage.assets.body, coverage.assets.total),
    },
    {
      detail: `${coverage.observations.pose.toLocaleString()} of ${coverage.observations.body.toLocaleString()} Bodies`,
      icon: mdiRun,
      label: 'Pose geometry',
      percent: evidenceCoveragePercent(coverage.observations.pose, coverage.observations.body),
    },
    {
      detail: `${coverage.assets.dated.toLocaleString()} photos`,
      icon: mdiCalendarRange,
      label: 'Capture date',
      percent: evidenceCoveragePercent(coverage.assets.dated, coverage.assets.total),
    },
  ]);
  const referenceRows = $derived([
    { count: coverage.references.prime, label: 'Core' },
    { count: coverage.references.secondary, label: 'Supporting' },
    { count: coverage.references.lowQuality, label: 'Low quality' },
    { count: coverage.references.head, label: 'Head bucket' },
  ]);

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
      A read-only map of what Cimmich has actually accepted for {coverage.person.displayName}. Bars show where evidence
      is observed; they are not identity confidence or a completeness score.
    </p>
  </header>

  <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    {#each coverageRows as row (row.label)}
      <article class="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-immich-dark-bg">
        <div class="flex items-center gap-2 text-sm font-semibold">
          <span class="grid size-8 place-items-center rounded-full bg-primary/10 text-primary"
            ><Icon icon={row.icon} size="18" /></span
          >
          {row.label}
        </div>
        <div class="mt-5 flex items-end justify-between gap-3">
          <strong class="text-2xl tabular-nums">{row.percent}%</strong>
          <span class="text-xs text-gray-500 dark:text-gray-400">{row.detail}</span>
        </div>
        <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700" aria-hidden="true">
          <span class="block h-full rounded-full bg-primary" style={`width: ${row.percent}%`}></span>
        </div>
      </article>
    {/each}
  </div>

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
        <h3 id="coverage-reference-title" class="text-lg font-semibold">Reference roles</h3>
      </div>
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
        onclick={onopenidentity}
      >
        Open Identity evidence
      </button>
    </section>
  </div>

  <section aria-labelledby="coverage-sources-title">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h3 id="coverage-sources-title" class="text-lg font-semibold">Source suggestions</h3>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          One strong accepted Face from different years, for covers or closer review.
        </p>
      </div>
      <button class="min-h-11 text-sm font-semibold text-primary hover:underline" type="button" onclick={onopenphotos}
        >Open all photos</button
      >
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
      {#each [{ items: coverage.context.places, label: 'Places' }, { items: coverage.context.events, label: 'Events' }, { items: coverage.context.things, label: 'Things' }] as group (group.label)}
        <div class="mt-4">
          <h4 class="text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">{group.label}</h4>
          <div class="mt-2 flex flex-wrap gap-2">
            {#each group.items as item (item.entityId)}
              <span class="rounded-full bg-gray-100 px-3 py-1.5 text-sm dark:bg-immich-dark-gray">
                {item.displayName} <span class="text-gray-500">{item.assetCount.toLocaleString()}</span>
              </span>
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
                    onclick={note.action === 'identity' ? onopenidentity : onopenphotos}
                  >
                    {note.action === 'identity' ? 'Review Identity' : 'Review photos'}
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
