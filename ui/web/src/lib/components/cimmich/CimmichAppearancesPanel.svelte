<script lang="ts">
  import type { AssetResponseDto } from '@immich/sdk';
  import { tick } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import CimmichEvidenceRows from '$lib/components/cimmich/CimmichEvidenceRows.svelte';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { cimmichVisibilityManager } from '$lib/managers/cimmich-visibility-manager.svelte';
  import {
    getCimmichEvidenceForAsset,
    type CimmichEvidenceBundle,
    type CimmichPhotoEvidence,
  } from '$lib/services/cimmich-evidence.service';

  interface Props {
    asset?: AssetResponseDto;
    compact?: boolean;
  }

  let { asset = undefined, compact = false }: Props = $props();
  let sectionElement = $state<HTMLElement>();
  let evidence = $state<CimmichPhotoEvidence>();
  let bundle = $state<CimmichEvidenceBundle>();
  let matchedFilename = $state('');
  let isLoading = $state(false);
  let loadError = $state('');
  let loadGeneration = 0;

  const people = $derived.by(() => {
    const names = new SvelteSet<string>();
    for (const name of evidence?.summary?.sourcePeople ?? []) {
      names.add(name);
    }
    for (const name of evidence?.summary?.candidatePeople ?? []) {
      names.add(name);
    }
    for (const name of evidence?.summary?.bodyContextPeople ?? []) {
      names.add(name);
    }
    for (const row of evidence?.stateRows ?? []) {
      if (row.personName) {
        names.add(row.personName);
      }
    }

    return [...names].sort((a, b) => a.localeCompare(b));
  });

  const priorityItems = $derived(evidence?.packetItems ?? []);
  const faceRows = $derived((evidence?.stateRows ?? []).filter((row) => row.family === 'known_person_candidate'));
  const bodyRows = $derived(
    (evidence?.stateRows ?? []).filter((row) => row.family === 'body_context' || row.family === 'body_marker'),
  );
  const otherRows = $derived(
    (evidence?.stateRows ?? []).filter(
      (row) => row.family !== 'known_person_candidate' && row.family !== 'body_context' && row.family !== 'body_marker',
    ),
  );

  $effect(() => {
    if (assetViewerManager.detailPanelTarget !== 'cimmich' || !sectionElement) {
      return;
    }

    void tick().then(() => {
      sectionElement?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      assetViewerManager.clearDetailPanelTarget('cimmich');
    });
  });

  $effect(() => {
    void cimmichVisibilityManager.version;
    const generation = ++loadGeneration;
    evidence = undefined;
    bundle = undefined;
    matchedFilename = '';
    loadError = '';
    if (!asset) {
      isLoading = false;
      return;
    }

    const assetId = asset.id;
    isLoading = true;
    loadError = '';

    void getCimmichEvidenceForAsset(asset)
      .then((result) => {
        if (generation !== loadGeneration || asset?.id !== assetId) {
          return;
        }

        evidence = result.evidence;
        bundle = result.bundle;
        matchedFilename = result.matchedFilename ?? '';
      })
      .catch((error) => {
        if (generation !== loadGeneration || asset?.id !== assetId) {
          return;
        }

        evidence = undefined;
        matchedFilename = '';
        loadError = error instanceof Error ? error.message : 'Unable to load Cimmich evidence';
      })
      .finally(() => {
        if (generation === loadGeneration && asset?.id === assetId) {
          isLoading = false;
        }
      });
  });

  const titleCase = (value: string) => value.replaceAll('_', ' ').replaceAll(/\b\w/g, (letter) => letter.toUpperCase());

  const formatCountMap = (counts: Record<string, number> | undefined) =>
    Object.entries(counts ?? {}).sort((a, b) => b[1] - a[1]);

  const includesPerson = (values: string[] | undefined, person: string) => values?.includes(person) ?? false;
  const hasCandidateEvidence = (person: string) =>
    includesPerson(evidence?.summary?.candidatePeople, person) ||
    (evidence?.packetItems ?? []).some((item) => item.personName === person) ||
    (evidence?.stateRows ?? []).some((row) => row.personName === person && row.confidence !== 'hold');
  const hasStrongEvidence = (person: string) =>
    includesPerson(evidence?.summary?.strongCandidatePeople, person) ||
    (evidence?.stateRows ?? []).some(
      (row) => row.personName === person && (row.confidence === 'strong' || row.confidence === 'review_support'),
    );
  const hasBodyEvidence = (person: string) =>
    includesPerson(evidence?.summary?.bodyContextPeople, person) ||
    bodyRows.some((row) => row.personName === person && row.confidence !== 'hold');

  const priorityClass = (priority: string) =>
    priority === 'P0'
      ? 'border-red-500/40 bg-red-50 text-red-700 dark:border-red-400/30 dark:bg-red-950/30 dark:text-red-200'
      : priority === 'P1'
        ? 'border-amber-500/40 bg-amber-50 text-amber-800 dark:border-amber-400/30 dark:bg-amber-950/30 dark:text-amber-200'
        : 'border-immich-gray/30 bg-white/70 text-gray-700 dark:bg-black/20 dark:text-gray-300';
</script>

<section
  bind:this={sectionElement}
  data-testid="cimmich-appearances-panel"
  class="mx-2 my-4 rounded-lg border border-primary/30 bg-primary/5 p-4 text-immich-fg dark:border-immich-dark-primary/40 dark:bg-immich-dark-primary/10 dark:text-immich-dark-fg"
>
  <div class="flex items-start justify-between gap-3">
    <div>
      <p class="text-sm font-semibold text-primary dark:text-immich-dark-primary">Cimmich appearances</p>
      <h2 class={compact ? 'mt-1 text-base font-medium' : 'mt-1 text-xl font-medium'}>Cimmich evidence</h2>
      {#if evidence}
        <p class="mt-1 text-xs text-gray-600 dark:text-gray-300">{evidence.mediaId || matchedFilename}</p>
      {/if}
    </div>
    <span class="rounded-full border border-immich-gray/30 px-2 py-1 text-xs text-gray-600 dark:text-gray-300">
      read-only
    </span>
  </div>

  {#if isLoading}
    <p class="mt-4 text-sm text-gray-600 dark:text-gray-300">Loading Cimmich evidence...</p>
  {:else if loadError}
    <p class="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-200">{loadError}</p>
  {:else if !evidence}
    <div class="mt-4 rounded-md bg-white/70 p-3 text-sm dark:bg-black/20">
      <p class="font-medium">No Cimmich evidence found</p>
      <p class="mt-1 text-gray-600 dark:text-gray-300">
        {asset?.originalFileName ?? 'This asset'} has no indexed Cimmich evidence in the current viewing mode.
      </p>
      {#if bundle}
        <p class="mt-3 text-xs text-gray-500 dark:text-gray-400">
          Bundle loaded: {bundle.globalSummary.stateRowCount} model rows, {bundle.globalSummary.actionRowCount} action rows,
          {bundle.globalSummary.blanketReapprovalRows} blanket reapproval rows.
        </p>
      {/if}
    </div>
  {:else}
    {#if evidence.summary}
      <div class="mt-4 rounded-md bg-white/70 p-3 text-sm dark:bg-black/20">
        <p class="font-medium">Photo model summary</p>
        <p class="mt-1 text-gray-600 dark:text-gray-300">{evidence.summary.localDescription}</p>
        {#if evidence.summary.visionRouteReason}
          <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">{evidence.summary.visionRouteReason}</p>
        {/if}
      </div>
    {/if}

    {#if priorityItems.length > 0}
      <div class="mt-4">
        <p class="text-sm font-semibold">Model flags</p>
        <div class="mt-2 grid gap-3">
          {#each priorityItems as item (item.packetId)}
            <article class={`rounded-md border p-3 text-sm ${priorityClass(item.priority)}`}>
              <div class="flex items-center justify-between gap-2">
                <p class="font-medium">{item.personName}</p>
                <span class="rounded-full border border-current/30 px-2 py-0.5 text-xs">{item.priority}</span>
              </div>
              <p class="mt-1 text-xs">{titleCase(item.queueFamily)}</p>
              <p class="mt-2 text-xs">Machine state: {titleCase(item.recommendedAction)}</p>
              {#if item.visualUrl}
                <img class="mt-3 max-h-56 w-full rounded-md object-contain" src={item.visualUrl} alt="" />
              {/if}
            </article>
          {/each}
        </div>
      </div>
    {/if}

    {#if people.length > 0}
      <div class="mt-4">
        <p class="text-sm font-semibold">People and buckets</p>
        <div class="mt-2 grid gap-2">
          {#each people as person (person)}
            <div class="rounded-md bg-white/70 p-3 text-sm dark:bg-black/20">
              <p class="font-medium">{person}</p>
              <div class="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-300">
                <label class="flex items-center gap-2">
                  <input type="checkbox" checked={includesPerson(evidence.summary?.sourcePeople, person)} disabled />
                  Source tag
                </label>
                <label class="flex items-center gap-2">
                  <input type="checkbox" checked={hasCandidateEvidence(person)} disabled />
                  Candidate
                </label>
                <label class="flex items-center gap-2">
                  <input type="checkbox" checked={hasStrongEvidence(person)} disabled />
                  Strong
                </label>
                <label class="flex items-center gap-2">
                  <input type="checkbox" checked={hasBodyEvidence(person)} disabled />
                  Body-linked
                </label>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <div class="mt-4 grid gap-3">
      {#if formatCountMap(evidence.summary?.faceBucketCounts).length > 0}
        <div class="rounded-md bg-white/70 p-3 text-sm dark:bg-black/20">
          <p class="font-medium">Face buckets</p>
          <div class="mt-2 flex flex-wrap gap-1">
            {#each formatCountMap(evidence.summary?.faceBucketCounts) as [bucket, count] (bucket)}
              <span class="rounded-full border border-immich-gray/30 px-2 py-0.5 text-xs">
                {titleCase(bucket)}: {count}
              </span>
            {/each}
          </div>
        </div>
      {/if}

      {#if formatCountMap(evidence.summary?.bodyStateCounts).length > 0}
        <div class="rounded-md bg-white/70 p-3 text-sm dark:bg-black/20">
          <p class="font-medium">Body states</p>
          <div class="mt-2 flex flex-wrap gap-1">
            {#each formatCountMap(evidence.summary?.bodyStateCounts) as [bucket, count] (bucket)}
              <span class="rounded-full border border-immich-gray/30 px-2 py-0.5 text-xs">
                {titleCase(bucket)}: {count}
              </span>
            {/each}
          </div>
        </div>
      {/if}
    </div>

    {#if bodyRows.length > 0}
      <CimmichEvidenceRows title="Bodies, masks, markers" rows={bodyRows} />
    {/if}

    {#if faceRows.length > 0}
      <CimmichEvidenceRows title="Face candidates" rows={faceRows} />
    {/if}

    {#if otherRows.length > 0}
      <CimmichEvidenceRows title="Other model output" rows={otherRows} />
    {/if}
  {/if}

  {#if asset}
    <dl class="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-gray-300">
      <dt>Immich asset</dt>
      <dd class="truncate">{asset.id}</dd>
      <dt>File</dt>
      <dd class="truncate">{asset.originalFileName}</dd>
    </dl>
  {/if}
</section>
