<script lang="ts">
  import { Route } from '$lib/route';
  import {
    acceptCimmichMachineSuggestion,
    dismissCimmichIdentityAuditItem,
    getCimmichIdentityAudit,
    getCimmichIdentityAuditItems,
    startCimmichIdentityAudit,
    type CimmichIdentityAuditItem,
    type CimmichIdentityAuditReference,
    type CimmichIdentityAuditRun,
  } from '$lib/services/cimmich.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { cimmichSquareObservationStyle } from '$lib/utils/cimmich-crop';
  import { keyboardTabs } from '$lib/components/cimmich/keyboard-tabs';
  import { AssetMediaSize } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import {
    mdiAlertCircleOutline,
    mdiArrowRight,
    mdiChevronLeft,
    mdiChevronRight,
    mdiCheck,
    mdiDatabaseSearchOutline,
    mdiRefresh,
    mdiShieldCheckOutline,
  } from '@mdi/js';

  let run = $state<CimmichIdentityAuditRun | null>(null);
  let kind = $state<CimmichIdentityAuditItem['kind']>('untagged_match');
  let items = $state<CimmichIdentityAuditItem[]>([]);
  let total = $state(0);
  let hasMore = $state(false);
  let loading = $state(true);
  let starting = $state(false);
  let loadingMore = $state(false);
  let busyFaceId = $state('');
  let error = $state('');
  let reviewMode = $state<'focus' | 'browse'>('focus');
  let focusIndex = $state(0);
  let reviewedThisSession = $state<Record<CimmichIdentityAuditItem['kind'], number>>({
    accepted_contradiction: 0,
    untagged_match: 0,
  });
  let pollTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  let loadGeneration = 0;

  const runAge = $derived(
    run?.completedAt
      ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
          new Date(run.completedAt),
        )
      : '',
  );
  const visibleItems = $derived(reviewMode === 'focus' ? items.slice(focusIndex, focusIndex + 1) : items);
  const activeReviewedThisSession = $derived(reviewedThisSession[kind]);

  type ReviewFace = Pick<CimmichIdentityAuditReference, 'box' | 'height' | 'sourceAssetId' | 'width'>;

  const cropImageStyle = (face: ReviewFace, padding = 1.65) =>
    cimmichSquareObservationStyle({
      boxH: face.box.h,
      boxW: face.box.w,
      boxX: face.box.x,
      boxY: face.box.y,
      height: face.sourceAssetId ? (face.height ?? 0) : 0,
      padding,
      width: face.sourceAssetId ? (face.width ?? 0) : 0,
    });

  const itemFace = (item: CimmichIdentityAuditItem): ReviewFace => ({
    box: item.box,
    height: item.height,
    sourceAssetId: item.sourceAssetId,
    width: item.width,
  });

  const loadItems = async (nextKind = kind, append = false) => {
    const generation = ++loadGeneration;
    const offset = append ? items.length : 0;
    const page = await getCimmichIdentityAuditItems(nextKind, offset, 20);
    if (generation !== loadGeneration || kind !== nextKind) {
      return;
    }
    items = append ? [...items, ...page.items] : page.items;
    total = page.total;
    hasMore = page.hasMore;
    if (!append) {
      focusIndex = 0;
    }
  };

  const schedulePoll = () => {
    if (pollTimer) {
      globalThis.clearTimeout(pollTimer);
    }
    if (run?.state !== 'running') {
      return;
    }
    pollTimer = globalThis.setTimeout(() => void refreshPoll(), 2500);
  };

  async function refreshPoll() {
    const generation = loadGeneration;
    try {
      const nextRun = await getCimmichIdentityAudit();
      if (generation !== loadGeneration) {
        return;
      }
      run = nextRun;
      if (run?.state === 'completed') {
        await loadItems();
      }
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'The audit status could not be refreshed.';
    } finally {
      schedulePoll();
    }
  }

  const load = async () => {
    const generation = ++loadGeneration;
    loading = true;
    error = '';
    try {
      const nextRun = await getCimmichIdentityAudit();
      if (generation !== loadGeneration) {
        return;
      }
      run = nextRun;
      if (run?.state === 'completed') {
        await loadItems();
      }
      schedulePoll();
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'The identity audit could not be loaded.';
    } finally {
      loading = false;
    }
  };

  $effect(() => {
    void load();
    return () => {
      if (pollTimer) {
        globalThis.clearTimeout(pollTimer);
      }
    };
  });

  $effect(() => {
    const handleReviewNavigation = (event: KeyboardEvent) => {
      if (
        reviewMode !== 'focus' ||
        busyFaceId ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        void navigateFocus(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        void navigateFocus(1);
      }
    };
    globalThis.addEventListener('keydown', handleReviewNavigation);
    return () => globalThis.removeEventListener('keydown', handleReviewNavigation);
  });

  const start = async () => {
    starting = true;
    error = '';
    try {
      run = await startCimmichIdentityAudit();
      loadGeneration += 1;
      items = [];
      total = 0;
      hasMore = false;
      schedulePoll();
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'The full-library audit could not be started.';
    } finally {
      starting = false;
    }
  };

  const chooseKind = async (nextKind: CimmichIdentityAuditItem['kind']) => {
    if (nextKind === kind) {
      return;
    }
    kind = nextKind;
    items = [];
    total = 0;
    hasMore = false;
    loading = true;
    error = '';
    try {
      await loadItems(nextKind);
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'The audit queue could not be loaded.';
    } finally {
      loading = false;
    }
  };

  const decrementRunCount = (itemKind: CimmichIdentityAuditItem['kind']) => {
    if (!run) {
      return;
    }
    run =
      itemKind === 'accepted_contradiction'
        ? { ...run, contradictionCandidates: Math.max(0, run.contradictionCandidates - 1) }
        : { ...run, untaggedCandidates: Math.max(0, run.untaggedCandidates - 1) };
  };

  const removeItem = (item: CimmichIdentityAuditItem) => {
    items = items.filter((candidate) => candidate.faceId !== item.faceId);
    total = Math.max(0, total - 1);
    decrementRunCount(item.kind);
    reviewedThisSession = {
      ...reviewedThisSession,
      [item.kind]: reviewedThisSession[item.kind] + 1,
    };
    focusIndex = Math.max(0, Math.min(focusIndex, items.length - 1));
  };

  const refillAfterDecision = async () => {
    if (hasMore) {
      await loadItems(kind, true);
    }
  };

  const accept = async (item: CimmichIdentityAuditItem) => {
    busyFaceId = item.faceId;
    error = '';
    try {
      await acceptCimmichMachineSuggestion(item.faceId, item.suggestedPerson.personId);
      removeItem(item);
      await refillAfterDecision();
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'The identity could not be saved.';
    } finally {
      busyFaceId = '';
    }
  };

  const dismiss = async (item: CimmichIdentityAuditItem) => {
    busyFaceId = item.faceId;
    error = '';
    try {
      await dismissCimmichIdentityAuditItem(item.kind, item.faceId);
      removeItem(item);
      await refillAfterDecision();
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'The audit item could not be dismissed.';
    } finally {
      busyFaceId = '';
    }
  };

  const more = async () => {
    loadingMore = true;
    error = '';
    try {
      await loadItems(kind, true);
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'More audit results could not be loaded.';
    } finally {
      loadingMore = false;
    }
  };

  const navigateFocus = async (direction: -1 | 1) => {
    if (direction < 0) {
      focusIndex = Math.max(0, focusIndex - 1);
      return;
    }
    if (focusIndex < items.length - 1) {
      focusIndex += 1;
      return;
    }
    if (!hasMore || loadingMore) {
      return;
    }
    const previousLength = items.length;
    await more();
    if (items.length > previousLength) {
      focusIndex = previousLength;
    }
  };

  const queueTotal = (queueKind: CimmichIdentityAuditItem['kind']) =>
    queueKind === kind
      ? total
      : queueKind === 'accepted_contradiction'
        ? (run?.contradictionCandidates ?? 0)
        : (run?.untaggedCandidates ?? 0);
</script>

<section
  class="overflow-hidden rounded-3xl border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
>
  <div class="flex flex-col gap-5 border-b border-gray-100 p-5 sm:p-7 dark:border-immich-dark-gray">
    <div class="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
      <div class="max-w-2xl">
        <div
          class="flex items-center gap-2 text-xs font-bold tracking-[0.13em] text-indigo-700 uppercase dark:text-indigo-300"
        >
          <Icon icon={mdiDatabaseSearchOutline} size="18" />
          Full library audit
        </div>
        <h2 class="mt-2 text-xl font-semibold tracking-tight text-immich-fg dark:text-immich-dark-fg">
          Check the whole library, not just today’s quick queue
        </h2>
        <p class="mt-2 text-sm/6 text-gray-500 dark:text-gray-400">
          This background check compares every compatible face with the active trusted references. It finds possible
          matches and existing tags worth double-checking. Nothing is renamed automatically.
        </p>
      </div>
      <button
        type="button"
        class="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-immich-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50 dark:bg-immich-dark-primary"
        disabled={starting || run?.state === 'running'}
        onclick={() => void start()}
      >
        <Icon icon={run ? mdiRefresh : mdiDatabaseSearchOutline} size="18" />
        {run?.state === 'running' ? 'Audit running…' : starting ? 'Starting…' : run ? 'Run again' : 'Audit library'}
      </button>
    </div>

    {#if error}
      <div
        class="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-200"
      >
        <Icon icon={mdiAlertCircleOutline} size="18" />
        {error}
      </div>
    {/if}

    {#if run}
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div class="rounded-2xl bg-gray-50 px-4 py-3 dark:bg-gray-900/60">
          <p class="text-[0.68rem] font-bold tracking-[0.12em] text-gray-400 uppercase">Status</p>
          <p class="mt-1 text-sm font-semibold text-immich-fg dark:text-immich-dark-fg">
            {run.state === 'running' ? 'Checking the library' : run.state === 'failed' ? 'Needs attention' : 'Complete'}
          </p>
        </div>
        <div class="rounded-2xl bg-gray-50 px-4 py-3 dark:bg-gray-900/60">
          <p class="text-[0.68rem] font-bold tracking-[0.12em] text-gray-400 uppercase">Coverage</p>
          <p class="mt-1 text-sm font-semibold text-immich-fg dark:text-immich-dark-fg">
            {run.state === 'completed'
              ? `${(run.untaggedEmbeddedFaces + run.acceptedEmbeddedFaces).toLocaleString()} faces`
              : 'Calculating…'}
          </p>
        </div>
        <div class="rounded-2xl bg-gray-50 px-4 py-3 dark:bg-gray-900/60">
          <p class="text-[0.68rem] font-bold tracking-[0.12em] text-gray-400 uppercase">Copies excluded</p>
          <p class="mt-1 text-sm font-semibold text-immich-fg dark:text-immich-dark-fg">
            {run.state === 'completed' ? run.derivativeCandidatesSuppressed.toLocaleString() : 'Checking…'}
          </p>
        </div>
        <div class="rounded-2xl bg-gray-50 px-4 py-3 dark:bg-gray-900/60">
          <p class="text-[0.68rem] font-bold tracking-[0.12em] text-gray-400 uppercase">Last completed</p>
          <p class="mt-1 truncate text-sm font-semibold text-immich-fg dark:text-immich-dark-fg">
            {runAge || 'In progress'}
          </p>
        </div>
      </div>
      {#if run.stale}
        <p class="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-300">
          <Icon icon={mdiAlertCircleOutline} size="16" />
          Trusted references changed after this audit. Run it again before relying on these results.
        </p>
      {/if}
      {#if run.state === 'completed' && (!run.truncationProjectionComplete || run.queryFrontierTruncated || run.independenceVerificationTruncated)}
        <div
          class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"
          role="status"
        >
          <p class="font-semibold">Audit coverage needs attention.</p>
          {#if !run.truncationProjectionComplete}
            <p class="mt-1">
              This run predates owner-visible limit reporting. Run the audit again before treating its queue as
              exhaustive.
            </p>
          {/if}
          {#if run.queryFrontierTruncated}
            <p class="mt-1">
              The strongest {run.queryFrontierLimit.toLocaleString()} queries in each queue were checked from
              {(run.untaggedQueriesEligible + run.contradictionQueriesEligible).toLocaleString()} eligible Faces.
            </p>
          {/if}
          {#if run.independenceVerificationTruncated}
            <p class="mt-1">
              Independent-image verification covered {run.independenceCandidatesVerified.toLocaleString()} of
              {run.independenceCandidatesEligible.toLocaleString()} eligible candidates. Remaining candidates are visible
              for review but are not independently verified.
            </p>
          {/if}
        </div>
      {/if}
    {/if}
  </div>

  {#if run?.state === 'completed'}
    <div class="border-b border-gray-100 px-4 pt-4 sm:px-7 dark:border-immich-dark-gray">
      <div class="flex gap-2" role="tablist" aria-label="Identity audit queues" use:keyboardTabs>
        <button
          type="button"
          role="tab"
          aria-selected={kind === 'untagged_match'}
          tabindex={kind === 'untagged_match' ? 0 : -1}
          class:active-tab={kind === 'untagged_match'}
          class="audit-tab rounded-t-xl px-4 py-3 text-left text-sm font-semibold"
          onclick={() => void chooseKind('untagged_match')}
        >
          Possible matches
          <span class="ml-1.5 text-xs opacity-60">{queueTotal('untagged_match').toLocaleString()}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={kind === 'accepted_contradiction'}
          tabindex={kind === 'accepted_contradiction' ? 0 : -1}
          class:active-tab={kind === 'accepted_contradiction'}
          class="audit-tab rounded-t-xl px-4 py-3 text-left text-sm font-semibold"
          onclick={() => void chooseKind('accepted_contradiction')}
        >
          Tags to double-check
          <span class="ml-1.5 text-xs opacity-60">{queueTotal('accepted_contradiction').toLocaleString()}</span>
        </button>
      </div>
      <div
        class="flex flex-col gap-3 border-t border-gray-100 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-immich-dark-gray"
      >
        <div>
          <p class="text-sm font-semibold text-immich-fg dark:text-immich-dark-fg">
            {total.toLocaleString()}
            {total === 1 ? 'question' : 'questions'} remaining
          </p>
          {#if activeReviewedThisSession > 0}
            <p class="mt-0.5 text-xs text-emerald-700 dark:text-emerald-300">
              {activeReviewedThisSession.toLocaleString()} reviewed this session
            </p>
          {/if}
          <p class="mt-0.5 text-xs text-gray-400">
            Skipping leaves a question open. A decision is remembered on later audits.
          </p>
        </div>
        <div
          class="inline-flex w-fit rounded-xl bg-gray-100 p-1 text-xs font-semibold dark:bg-gray-900"
          role="group"
          aria-label="Review layout"
        >
          <button
            type="button"
            class={`rounded-lg px-3 py-1.5 transition ${
              reviewMode === 'focus' ? 'bg-white text-immich-primary shadow-sm dark:bg-immich-dark-bg' : 'text-gray-500'
            }`}
            onclick={() => {
              reviewMode = 'focus';
              focusIndex = 0;
            }}
          >
            One at a time
          </button>
          <button
            type="button"
            class={`rounded-lg px-3 py-1.5 transition ${
              reviewMode === 'browse'
                ? 'bg-white text-immich-primary shadow-sm dark:bg-immich-dark-bg'
                : 'text-gray-500'
            }`}
            onclick={() => (reviewMode = 'browse')}
          >
            Browse all
          </button>
        </div>
      </div>
    </div>

    <div class="p-4 sm:p-7">
      {#if loading}
        <div class="h-32 animate-pulse rounded-2xl bg-gray-100 dark:bg-gray-900"></div>
      {:else if items.length === 0}
        <div
          class="flex min-h-36 flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 px-6 text-center dark:border-immich-dark-gray"
        >
          <Icon icon={mdiShieldCheckOutline} size="28" class="text-emerald-600" />
          <p class="mt-3 text-sm font-semibold text-immich-fg dark:text-immich-dark-fg">This queue is clear</p>
          <p class="mt-1 text-xs text-gray-500">There are no open questions in this audit result.</p>
        </div>
      {:else}
        {#if reviewMode === 'focus'}
          <div class="mb-3 flex items-center justify-between gap-3">
            <button
              type="button"
              class="flex items-center gap-1 rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-immich-dark-gray dark:text-gray-300 dark:hover:bg-gray-900"
              disabled={focusIndex === 0 || Boolean(busyFaceId)}
              onclick={() => void navigateFocus(-1)}
            >
              <Icon icon={mdiChevronLeft} size="17" />
              Previous
            </button>
            <div class="text-center">
              <p class="text-xs font-semibold text-immich-fg dark:text-immich-dark-fg">
                Question {(focusIndex + 1).toLocaleString()} of {items.length.toLocaleString()} loaded
              </p>
              <p class="mt-0.5 text-[0.68rem] text-gray-400">Use ← and → to move without deciding</p>
            </div>
            <button
              type="button"
              class="flex items-center gap-1 rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-immich-dark-gray dark:text-gray-300 dark:hover:bg-gray-900"
              disabled={(!hasMore && focusIndex >= items.length - 1) || loadingMore || Boolean(busyFaceId)}
              onclick={() => void navigateFocus(1)}
            >
              {loadingMore && focusIndex >= items.length - 1 ? 'Loading…' : 'Skip'}
              <Icon icon={mdiChevronRight} size="17" />
            </button>
          </div>
        {/if}
        <div class="grid gap-3">
          {#each visibleItems as item (item.faceId)}
            <article
              class={reviewMode === 'focus'
                ? 'grid gap-5 rounded-2xl border border-gray-200 p-4 sm:p-5 dark:border-immich-dark-gray'
                : 'grid gap-4 rounded-2xl border border-gray-200 p-3 sm:grid-cols-[minmax(180px,240px)_1fr] sm:items-center lg:grid-cols-[minmax(180px,240px)_1fr_auto] dark:border-immich-dark-gray'}
            >
              <div
                class={`grid gap-2 ${item.assignedPerson ? 'grid-cols-3' : 'grid-cols-2'} ${
                  reviewMode === 'focus' ? 'mx-auto w-full max-w-3xl' : ''
                }`}
              >
                <a
                  href={Route.viewAsset({ id: item.sourceAssetId })}
                  class="relative block aspect-square overflow-hidden rounded-xl bg-gray-100 dark:bg-gray-900"
                  aria-label="Open source photo for detected face"
                >
                  <img
                    src={getAssetMediaUrl({ id: item.sourceAssetId, size: AssetMediaSize.Preview })}
                    alt=""
                    loading="lazy"
                    draggable="false"
                    style={cropImageStyle(itemFace(item))}
                  />
                  <span
                    class="absolute inset-x-1 bottom-1 rounded-md bg-black/70 px-1.5 py-1 text-center text-[0.6rem] font-bold tracking-wide text-white uppercase"
                  >
                    Detected
                  </span>
                </a>
                {#if item.assignedPerson}
                  {#if item.assignedPerson.reference}
                    <a
                      href={Route.viewAsset({ id: item.assignedPerson.reference.sourceAssetId })}
                      class="relative block aspect-square overflow-hidden rounded-xl bg-gray-100 dark:bg-gray-900"
                      aria-label={`Open trusted reference for ${item.assignedPerson.displayName}`}
                    >
                      <img
                        src={getAssetMediaUrl({
                          id: item.assignedPerson.reference.sourceAssetId,
                          size: AssetMediaSize.Preview,
                        })}
                        alt=""
                        loading="lazy"
                        draggable="false"
                        style={cropImageStyle(item.assignedPerson.reference)}
                      />
                      <span
                        class="absolute inset-x-1 bottom-1 rounded-md bg-black/70 px-1.5 py-1 text-center text-[0.6rem] font-bold tracking-wide text-white uppercase"
                      >
                        Current
                      </span>
                    </a>
                  {:else}
                    <div
                      class="flex aspect-square items-center justify-center rounded-xl bg-gray-100 p-2 text-center text-[0.65rem] font-semibold text-gray-400 dark:bg-gray-900"
                    >
                      Current reference unavailable
                    </div>
                  {/if}
                {/if}
                {#if item.suggestedPerson.reference}
                  <a
                    href={Route.viewAsset({ id: item.suggestedPerson.reference.sourceAssetId })}
                    class="relative block aspect-square overflow-hidden rounded-xl bg-indigo-50 ring-1 ring-indigo-200 dark:bg-indigo-950/30 dark:ring-indigo-800"
                    aria-label={`Open trusted reference for ${item.suggestedPerson.displayName}`}
                  >
                    <img
                      src={getAssetMediaUrl({
                        id: item.suggestedPerson.reference.sourceAssetId,
                        size: AssetMediaSize.Preview,
                      })}
                      alt=""
                      loading="lazy"
                      draggable="false"
                      style={cropImageStyle(item.suggestedPerson.reference)}
                    />
                    <span
                      class="absolute inset-x-1 bottom-1 rounded-md bg-indigo-950/85 px-1.5 py-1 text-center text-[0.6rem] font-bold tracking-wide text-white uppercase"
                    >
                      {item.evidenceRoute === 'own_cluster_outlier' ? 'Closest confirmed' : 'Suggested'}
                    </span>
                  </a>
                {:else}
                  <div
                    class="flex aspect-square items-center justify-center rounded-xl bg-indigo-50 p-2 text-center text-[0.65rem] font-semibold text-indigo-400 dark:bg-indigo-950/30"
                  >
                    Suggested reference unavailable
                  </div>
                {/if}
              </div>
              <div class="min-w-0">
                {#if item.assignedPerson}
                  <p class="text-xs font-medium text-gray-500 dark:text-gray-400">
                    {item.evidenceRoute === 'own_cluster_outlier' ? 'Own identity outlier' : 'Currently tagged'}
                  </p>
                  <p class="truncate text-sm font-semibold text-immich-fg dark:text-immich-dark-fg">
                    {item.assignedPerson.displayName}
                    {#if item.evidenceRoute !== 'own_cluster_outlier'}
                      <Icon icon={mdiArrowRight} size="15" class="mx-1 inline" />
                      {item.suggestedPerson.displayName}
                    {/if}
                  </p>
                {:else}
                  <p class="text-xs font-medium text-gray-500 dark:text-gray-400">Possible match</p>
                  <p class="truncate text-sm font-semibold text-immich-fg dark:text-immich-dark-fg">
                    {item.suggestedPerson.displayName}
                  </p>
                {/if}
                <p class="mt-1 text-xs text-gray-400">
                  {item.evidenceRoute === 'own_cluster_outlier'
                    ? `Closest confirmed ${item.suggestedPerson.score.toFixed(2)} · ${item.margin.toFixed(2)} below this Person’s outlier floor`
                    : item.assignedPerson
                      ? `Current ${item.assignedPerson.score.toFixed(2)} · suggested ${item.suggestedPerson.score.toFixed(2)}`
                      : `Similarity ${item.suggestedPerson.score.toFixed(2)}`}
                  {item.evidenceRoute === 'own_cluster_outlier'
                    ? ''
                    : item.margin > item.suggestedPerson.score
                      ? '· only candidate'
                      : `· margin ${item.margin.toFixed(2)}`}
                </p>
                {#if reviewMode === 'focus'}
                  <p class="mt-2 text-xs/5 text-gray-500 dark:text-gray-400">
                    {item.evidenceRoute === 'own_cluster_outlier'
                      ? 'No different Person won. This Face is here because it also failed to resemble the lower-quality confirmed Faces of its current Person.'
                      : item.assignedPerson
                        ? 'Compare the detected face with the current trusted photo and the suggested person before choosing.'
                        : 'Compare the detected face with the independent trusted photo before confirming the name.'}
                  </p>
                {/if}
              </div>
              <div
                class={`flex min-w-0 gap-2 ${
                  reviewMode === 'focus' ? 'justify-end' : 'sm:col-span-2 lg:col-span-1 lg:justify-end'
                }`}
              >
                <button
                  type="button"
                  class="flex min-w-0 items-center rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-immich-dark-gray dark:text-gray-300 dark:hover:bg-gray-900"
                  disabled={Boolean(busyFaceId)}
                  aria-label={item.assignedPerson
                    ? `Keep current tag ${item.assignedPerson.displayName}`
                    : `Reject match with ${item.suggestedPerson.displayName}`}
                  onclick={() => void dismiss(item)}
                >
                  <span class="truncate">
                    {item.assignedPerson ? 'Keep current' : `Not ${item.suggestedPerson.displayName}`}
                  </span>
                </button>
                {#if item.evidenceRoute === 'own_cluster_outlier' && item.assignedPerson}
                  <a
                    class="flex min-w-0 items-center gap-1.5 rounded-xl bg-immich-primary px-3 py-2 text-xs font-semibold text-white hover:brightness-110 dark:bg-immich-dark-primary"
                    href={Route.cimmichPerson({
                      identityReviewCount: 1,
                      name: item.assignedPerson.displayName,
                      personId: item.assignedPerson.personId,
                    })}
                  >
                    Review and reassign
                  </a>
                {:else}
                  <button
                    type="button"
                    class="flex min-w-0 items-center gap-1.5 rounded-xl bg-immich-primary px-3 py-2 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50 dark:bg-immich-dark-primary"
                    disabled={Boolean(busyFaceId)}
                    aria-label={item.assignedPerson
                      ? `Change tag to ${item.suggestedPerson.displayName}`
                      : `Confirm match with ${item.suggestedPerson.displayName}`}
                    onclick={() => void accept(item)}
                  >
                    <Icon icon={mdiCheck} size="15" class="shrink-0" />
                    <span class="truncate">
                      {busyFaceId === item.faceId
                        ? 'Saving…'
                        : item.assignedPerson
                          ? `Use ${item.suggestedPerson.displayName}`
                          : `Tag as ${item.suggestedPerson.displayName}`}
                    </span>
                  </button>
                {/if}
              </div>
            </article>
          {/each}
        </div>
        {#if hasMore && reviewMode === 'browse'}
          <button
            type="button"
            class="mx-auto mt-5 block rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50 dark:border-immich-dark-gray dark:hover:bg-gray-900"
            disabled={loadingMore}
            onclick={() => void more()}
          >
            {loadingMore ? 'Loading…' : `Show more · ${Math.max(0, total - items.length).toLocaleString()} remaining`}
          </button>
        {/if}
      {/if}
    </div>
  {:else if !loading && !run}
    <div class="p-5 text-sm text-gray-500 sm:p-7 dark:text-gray-400">
      No full-library audit has been run yet. The quick review below remains available.
    </div>
  {/if}
</section>

<style>
  .audit-tab {
    color: rgb(107 114 128);
    border: 1px solid transparent;
    border-bottom: 0;
  }
  .audit-tab.active-tab {
    color: rgb(var(--immich-primary));
    border-color: rgb(229 231 235);
    background: rgb(255 255 255);
  }
  :global(.dark) .audit-tab.active-tab {
    border-color: rgb(var(--immich-dark-gray));
    background: rgb(var(--immich-dark-bg));
  }
</style>
