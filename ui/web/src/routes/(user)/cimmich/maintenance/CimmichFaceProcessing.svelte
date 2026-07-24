<script lang="ts">
  import { runCimmichFaceRecognition } from '$lib/services/cimmich.service';
  import { Icon } from '@immich/ui';
  import { mdiCheckCircleOutline, mdiPauseCircleOutline, mdiPlay, mdiRefresh } from '@mdi/js';
  import { onDestroy, tick } from 'svelte';

  interface Props {
    acceptedFaces: number;
    analysedFaces: number;
    canRun: boolean;
    eligibleFaces: number;
    onRefresh: () => Promise<void>;
    providerEmbeddings: number;
  }

  let { acceptedFaces, analysedFaces, canRun, eligibleFaces, onRefresh, providerEmbeddings }: Props = $props();
  let batches = $state(0);
  let error = $state('');
  let finishedMessage = $state('');
  let running = $state(false);
  let sessionStartingAnalysedFaces = $state(0);
  let sessionRecognitions = $state(0);
  let sessionSize = $state(100);
  let startedAt = $state(0);
  let stoppedAt = $state(0);
  let stopRequested = $state(false);
  let mounted = true;

  const overallPercent = $derived(
    eligibleFaces > 0 ? Math.min(100, Math.round((analysedFaces / eligibleFaces) * 100)) : 0,
  );
  const elapsedSeconds = $derived(
    startedAt > 0 ? Math.max(1, Math.round(((stoppedAt || Date.now()) - startedAt) / 1000)) : 0,
  );
  const recognitionsPerMinute = $derived(
    sessionRecognitions > 0 && elapsedSeconds > 0
      ? Math.max(1, Math.round((sessionRecognitions * 60) / elapsedSeconds))
      : 0,
  );
  const sessionAnalysedFaces = $derived(Math.max(0, analysedFaces - sessionStartingAnalysedFaces));
  const facesPerMinute = $derived(
    sessionAnalysedFaces > 0 && elapsedSeconds > 0
      ? Math.max(1, Math.round((sessionAnalysedFaces * 60) / elapsedSeconds))
      : 0,
  );
  const estimatedMinutes = $derived(
    facesPerMinute > 0 && eligibleFaces > analysedFaces
      ? Math.max(1, Math.ceil((eligibleFaces - analysedFaces) / facesPerMinute))
      : 0,
  );

  const startSession = async () => {
    if (running || !canRun) {
      return;
    }
    batches = 0;
    error = '';
    finishedMessage = '';
    running = true;
    sessionRecognitions = 0;
    sessionStartingAnalysedFaces = analysedFaces;
    startedAt = Date.now();
    stoppedAt = 0;
    stopRequested = false;

    try {
      while (mounted && !stopRequested && sessionRecognitions < sessionSize) {
        const batchLimit = Math.min(25, sessionSize - sessionRecognitions);
        const result = await runCimmichFaceRecognition(batchLimit);
        if (!mounted) {
          return;
        }
        const completed = result.work.recognitions;
        batches += 1;
        sessionRecognitions += completed;
        stoppedAt = Date.now();
        await onRefresh();
        await tick();
        if (!canRun) {
          finishedMessage = 'Analysis is complete for the eligible accepted Faces in this session.';
          break;
        }
        if (completed === 0) {
          finishedMessage =
            result.queue.pending > 0 || result.queue.processing > 0 || result.state === 'budget_exhausted'
              ? 'No Face finished in this batch. Durable queued work is preserved; resume when you are ready.'
              : 'Cimmich found no remaining Faces ready for this processing pass.';
          break;
        }
        if (
          completed < batchLimit &&
          result.state !== 'budget_exhausted' &&
          result.queue.pending === 0 &&
          result.queue.processing === 0
        ) {
          finishedMessage = 'Cimmich reached the currently available end of this library.';
          break;
        }
      }
      if (!finishedMessage) {
        finishedMessage = stopRequested
          ? 'Stopped safely after the current batch. Completed work is preserved.'
          : `Session limit reached. Completed work is preserved; resume whenever you are ready.`;
      }
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'Cimmich could not continue this processing session.';
    } finally {
      stoppedAt = Date.now();
      running = false;
      stopRequested = false;
      if (mounted) {
        await onRefresh();
      }
    }
  };

  onDestroy(() => {
    mounted = false;
    stopRequested = true;
  });
</script>

<div class="mt-4 rounded-2xl border border-gray-200 p-4 dark:border-immich-dark-gray">
  <div class="flex flex-wrap items-baseline justify-between gap-2">
    <p class="font-semibold">Optional analysis</p>
    <p class="text-sm text-gray-600 tabular-nums dark:text-gray-300">
      {analysedFaces.toLocaleString()} of {eligibleFaces.toLocaleString()} eligible accepted Faces processed
    </p>
  </div>
  <div
    class="mt-3 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-immich-dark-gray"
    role="progressbar"
    aria-label="Optional Face analysis progress"
    aria-valuemin="0"
    aria-valuemax={eligibleFaces}
    aria-valuenow={analysedFaces}
  >
    <div
      class="h-full rounded-full bg-sky-700 transition-[width] dark:bg-sky-300"
      style={`width: ${overallPercent}%`}
    ></div>
  </div>
  <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs/5 text-gray-500 dark:text-gray-400">
    <span>{providerEmbeddings.toLocaleString()} currently usable matching embeddings</span>
    <span>Completed analysis also includes honest no-match results</span>
    {#if acceptedFaces > eligibleFaces}
      <span>
        {(acceptedFaces - eligibleFaces).toLocaleString()} accepted Faces are outside this session's current viewing/source
        scope
      </span>
    {/if}
  </div>

  {#if canRun}
    <div class="mt-5 border-t border-gray-200 pt-4 dark:border-immich-dark-gray">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p class="font-semibold">Processing session</p>
          <p class="mt-1 max-w-2xl text-xs/5 text-gray-500 dark:text-gray-400">
            Runs durable batches while this page stays open. Stop safely after the current batch, close the page, or
            resume later without losing completed work.
          </p>
        </div>
        {#if running}
          <span
            class="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-900 dark:bg-sky-950 dark:text-sky-100"
          >
            Batch {batches + 1}
          </span>
        {/if}
      </div>

      <fieldset class="mt-4" disabled={running}>
        <legend class="text-xs font-semibold text-gray-500 dark:text-gray-400">Stop after at most</legend>
        <div class="mt-2 flex flex-wrap gap-2">
          {#each [25, 100, 500] as size (size)}
            <button
              type="button"
              class={`min-h-10 rounded-full border px-4 text-sm font-semibold ${
                sessionSize === size
                  ? 'border-sky-800 bg-sky-950 text-white dark:border-sky-200 dark:bg-sky-100 dark:text-sky-950'
                  : 'border-gray-300 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-immich-dark-gray'
              }`}
              aria-pressed={sessionSize === size}
              onclick={() => (sessionSize = size)}
            >
              {size} Faces
            </button>
          {/each}
        </div>
      </fieldset>

      <div class="mt-4 flex flex-wrap items-center gap-3">
        {#if running}
          <button
            type="button"
            class="inline-flex min-h-11 items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-4 text-sm font-semibold text-amber-950 hover:bg-amber-100 disabled:opacity-60 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
            disabled={stopRequested}
            onclick={() => (stopRequested = true)}
          >
            <Icon icon={mdiPauseCircleOutline} size="19" />
            {stopRequested ? 'Stopping after this batch…' : 'Stop after this batch'}
          </button>
          <span class="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            <Icon icon={mdiRefresh} size="18" class="animate-spin" />
            {sessionRecognitions} Faces analysed this session
          </span>
        {:else}
          <button
            type="button"
            class="inline-flex min-h-11 items-center gap-2 rounded-full bg-sky-950 px-4 text-sm font-semibold text-white hover:bg-sky-900 dark:bg-sky-100 dark:text-sky-950 dark:hover:bg-white"
            onclick={startSession}
          >
            <Icon icon={mdiPlay} size="18" />
            {analysedFaces > 0 ? 'Resume processing' : 'Start processing'}
          </button>
        {/if}
      </div>

      {#if startedAt > 0 && sessionRecognitions > 0}
        <dl class="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <div class="rounded-xl bg-gray-50 p-3 dark:bg-immich-dark-gray/40">
            <dt class="text-xs text-gray-500 dark:text-gray-400">This session</dt>
            <dd class="mt-1 font-semibold">
              {sessionRecognitions} Faces analysed · {batches}
              {batches === 1 ? 'batch' : 'batches'}
            </dd>
          </div>
          <div class="rounded-xl bg-gray-50 p-3 dark:bg-immich-dark-gray/40">
            <dt class="text-xs text-gray-500 dark:text-gray-400">Measured speed</dt>
            <dd class="mt-1 font-semibold">About {recognitionsPerMinute} Faces/min</dd>
            <dd class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {facesPerMinute > 0 ? `${facesPerMinute} Faces/min` : 'Measuring Face progress'}
            </dd>
          </div>
          <div class="rounded-xl bg-gray-50 p-3 dark:bg-immich-dark-gray/40">
            <dt class="text-xs text-gray-500 dark:text-gray-400">Rough time remaining</dt>
            <dd class="mt-1 font-semibold">{estimatedMinutes > 0 ? `About ${estimatedMinutes} min` : 'Measuring'}</dd>
          </div>
        </dl>
      {/if}

      {#if finishedMessage}
        <p
          class="mt-4 flex gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm/6 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-100"
          role="status"
        >
          <Icon icon={mdiCheckCircleOutline} size="19" class="mt-0.5 shrink-0" />
          {finishedMessage}
        </p>
      {/if}
      {#if error}
        <p
          class="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm/6 text-red-900 dark:bg-red-950/30 dark:text-red-100"
          role="alert"
        >
          {error} Completed batches remain preserved; refresh and resume when ready.
        </p>
      {/if}
    </div>
  {:else if eligibleFaces > 0 && analysedFaces >= eligibleFaces}
    <p class="mt-4 flex items-center gap-2 text-sm font-semibold text-emerald-800 dark:text-emerald-200">
      <Icon icon={mdiCheckCircleOutline} size="19" /> Analysis is complete for the eligible accepted Faces in this session.
    </p>
  {/if}
</div>
