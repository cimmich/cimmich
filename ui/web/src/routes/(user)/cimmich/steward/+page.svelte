<script lang="ts">
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import { cimmichVisibilityManager } from '$lib/managers/cimmich-visibility-manager.svelte';
  import { Route } from '$lib/route';
  import {
    acceptCimmichMachineSuggestion,
    getCimmichMachineSuggestions,
    getCimmichStewardPlan,
    markCimmichMachineSuggestionUnknown,
    type CimmichMachineSuggestion,
    type CimmichStewardPlan,
  } from '$lib/services/cimmich.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiArrowRight, mdiCheck, mdiEyeOutline, mdiLockOutline, mdiRefresh, mdiSkipNext } from '@mdi/js';

  let suggestions = $state<CimmichMachineSuggestion[]>([]);
  let plan = $state<CimmichStewardPlan>();
  let loading = $state(true);
  let error = $state('');
  let busyFaceId = $state('');
  let selectedPeople = $state<Record<string, string>>({});
  let skippedFaceIds = $state<string[]>([]);
  let resultMessage = $state('');
  let loadGeneration = 0;

  const visibleSuggestions = $derived.by(() => {
    const available = suggestions.filter((item) => !skippedFaceIds.includes(item.face_id));
    if (!plan?.focusFaceIds.length) {
      return available;
    }
    const priority = new Map(plan.focusFaceIds.map((faceId, index) => [faceId, index]));
    return [...available].sort(
      (a, b) =>
        (priority.get(a.face_id) ?? Number.MAX_SAFE_INTEGER) - (priority.get(b.face_id) ?? Number.MAX_SAFE_INTEGER) ||
        b.quality_score - a.quality_score,
    );
  });
  const active = $derived(visibleSuggestions[0]);
  const activePersonId = $derived(
    active ? selectedPeople[active.face_id] || active.candidates[0]?.person_id || '' : '',
  );
  const activeCandidate = $derived(active?.candidates.find((candidate) => candidate.person_id === activePersonId));
  const planModeLabel = 'Local plan';
  const planBoundaryLabel = 'Deterministic local planning only';

  const load = async () => {
    const generation = ++loadGeneration;
    loading = true;
    error = '';
    plan = undefined;
    suggestions = [];
    selectedPeople = {};
    skippedFaceIds = [];
    try {
      const [nextPlan, nextSuggestions] = await Promise.all([
        getCimmichStewardPlan(),
        getCimmichMachineSuggestions(24),
      ]);
      if (generation !== loadGeneration) {
        return;
      }
      plan = nextPlan;
      suggestions = nextSuggestions;
      skippedFaceIds = [];
      selectedPeople = Object.fromEntries(
        nextSuggestions
          .filter((item) => item.candidates[0])
          .map((item) => [item.face_id, item.candidates[0].person_id]),
      );
    } catch (error_) {
      if (generation !== loadGeneration) {
        return;
      }
      error = error_ instanceof Error ? error_.message : 'Cimmich could not prepare the review.';
    } finally {
      if (generation === loadGeneration) {
        loading = false;
      }
    }
  };

  $effect(() => {
    void cimmichVisibilityManager.version;
    void load();
  });

  const clampPercent = (value: number) => Math.max(0, Math.min(100, value));
  const cropStyle = (item: CimmichMachineSuggestion) => {
    if (!item.sourceAssetId) {
      return '';
    }
    const cropSize = Math.min(1, Math.max(item.box_w * 2.8, item.box_h * 2.8, 0.01));
    const centerX = item.box_x + item.box_w / 2;
    const centerY = item.box_y + item.box_h / 2;
    const cropX = Math.max(0, Math.min(1 - cropSize, centerX - cropSize / 2));
    const cropY = Math.max(0, Math.min(1 - cropSize, centerY - cropSize / 2));
    const positionX = clampPercent((cropX / Math.max(0.0001, 1 - cropSize)) * 100);
    const positionY = clampPercent((cropY / Math.max(0.0001, 1 - cropSize)) * 100);
    return [
      `background-image: url("${getAssetMediaUrl({ id: item.sourceAssetId, size: AssetMediaSize.Preview })}")`,
      `background-size: ${100 / cropSize}% ${100 / cropSize}%`,
      `background-position: ${positionX}% ${positionY}%`,
    ].join('; ');
  };

  const reasonLabel = (reason: CimmichMachineSuggestion['review_reason']) =>
    reason === 'close_alternatives' ? 'Close call' : reason === 'weak_face' ? 'Hard photo' : 'Clear lead';

  const choosePerson = (faceId: string, personId: string) => {
    selectedPeople = { ...selectedPeople, [faceId]: personId };
  };

  const finishDecision = (faceId: string, message: string) => {
    suggestions = suggestions.filter((item) => item.face_id !== faceId);
    resultMessage = message;
    globalThis.setTimeout(() => {
      if (resultMessage === message) {
        resultMessage = '';
      }
    }, 4200);
  };

  const confirmActive = async () => {
    if (!active || !activeCandidate || busyFaceId) {
      return;
    }
    busyFaceId = active.face_id;
    error = '';
    try {
      const result = await acceptCimmichMachineSuggestion(active.face_id, activeCandidate.person_id);
      finishDecision(
        active.face_id,
        result.maintenancePending
          ? `Learned ${activeCandidate.display_name}. Refreshing their matching evidence.`
          : `Learned ${activeCandidate.display_name}.`,
      );
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'The identity could not be saved.';
    } finally {
      busyFaceId = '';
    }
  };

  const markUnknown = async () => {
    if (!active || busyFaceId) {
      return;
    }
    busyFaceId = active.face_id;
    error = '';
    try {
      await markCimmichMachineSuggestionUnknown(active.face_id);
      finishDecision(active.face_id, 'Left unknown. This matcher version will not ask again.');
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'The review could not be saved.';
    } finally {
      busyFaceId = '';
    }
  };

  const skipActive = () => {
    if (!active) {
      return;
    }
    skippedFaceIds = [...skippedFaceIds, active.face_id];
    resultMessage = 'Skipped for this visit.';
  };
</script>

<UserPageLayout title="Memory Steward">
  <div class="steward-shell mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:py-10">
    <header
      class:steward-hero-compact={Boolean(active)}
      class="steward-hero overflow-hidden rounded-4xl px-6 py-7 text-white sm:p-9"
    >
      <div class="relative z-10 flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
        <div class="max-w-2xl">
          <div
            class="steward-kicker mb-5 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[0.68rem] font-semibold tracking-[0.18em] text-white/85 uppercase backdrop-blur-sm"
          >
            <Icon icon={mdiLockOutline} size="15" /> Local-first identity
          </div>
          <h1 class="steward-title text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-5xl">
            Teach your archive. Keep the truth.
          </h1>
          {#if !active}
            <p class="mt-4 max-w-xl text-sm/6 text-white/70 sm:text-base">
              Cimmich brings forward reviewable local evidence when it exists. You confirm every identity decision.
            </p>
          {/if}
        </div>
        <div
          class="flex shrink-0 items-center gap-3 rounded-2xl border border-white/15 bg-black/10 px-4 py-3 backdrop-blur-sm"
        >
          <span class="size-2.5 rounded-full bg-emerald-300"></span>
          <div>
            <p class="text-xs font-semibold text-white">
              {planModeLabel}
            </p>
            <p class="mt-0.5 text-[0.68rem] text-white/55">Identity authority stays with you</p>
          </div>
        </div>
      </div>
    </header>

    {#if error}
      <div
        class="flex items-center justify-between gap-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
      >
        <span>{error}</span>
        <button type="button" class="font-semibold underline underline-offset-4" onclick={() => void load()}
          >Try again</button
        >
      </div>
    {/if}

    {#if resultMessage}
      <div
        class="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100"
      >
        <Icon icon={mdiCheck} size="18" />
        {resultMessage}
      </div>
    {/if}

    {#if loading}
      <section
        class="grid min-h-120 animate-pulse overflow-hidden rounded-4xl border border-gray-200 bg-white lg:grid-cols-[1.05fr_0.95fr] dark:border-immich-dark-gray dark:bg-immich-dark-gray/30"
      >
        <div class="bg-gray-200 dark:bg-gray-800"></div>
        <div class="space-y-5 p-7 sm:p-10">
          <div class="h-3 w-24 rounded-sm bg-gray-200 dark:bg-gray-700"></div>
          <div class="h-9 w-4/5 rounded-sm bg-gray-200 dark:bg-gray-700"></div>
          <div class="h-20 rounded-2xl bg-gray-100 dark:bg-gray-800"></div>
          <div class="h-20 rounded-2xl bg-gray-100 dark:bg-gray-800"></div>
        </div>
      </section>
    {:else if active}
      <section
        class="review-stage grid overflow-hidden rounded-4xl border border-gray-200 bg-white shadow-sm lg:grid-cols-[1.05fr_0.95fr] dark:border-immich-dark-gray dark:bg-immich-dark-bg"
      >
        <a
          class="group relative min-h-92 overflow-hidden bg-gray-100 bg-cover bg-no-repeat lg:min-h-136 dark:bg-gray-900"
          href={Route.viewAsset({ id: active.sourceAssetId })}
          aria-label="Open the full photo"
        >
          <div
            class="absolute inset-0 scale-[1.015] bg-cover bg-no-repeat transition duration-500 group-hover:scale-[1.05]"
            style={cropStyle(active)}
          ></div>
          <div
            class="absolute inset-x-0 bottom-0 flex items-end justify-between bg-linear-to-t from-black/70 via-black/20 to-transparent p-5 pt-24 text-white"
          >
            <div>
              <p class="text-xs font-semibold tracking-[0.16em] text-white/60 uppercase">
                Review {suggestions.length - visibleSuggestions.length + 1} of {suggestions.length}
              </p>
              <p class="mt-1 text-sm font-medium">Open full photo</p>
            </div>
            <span class="rounded-full bg-white/15 p-2.5 backdrop-blur-sm transition group-hover:bg-white/25"
              ><Icon icon={mdiArrowRight} size="20" /></span
            >
          </div>
        </a>

        <div class="flex flex-col p-6 sm:p-9 lg:p-10">
          <div class="flex items-center justify-between gap-3">
            <span
              class="rounded-full bg-amber-50 px-3 py-1 text-[0.7rem] font-bold tracking-[0.13em] text-amber-800 uppercase dark:bg-amber-950/40 dark:text-amber-200"
            >
              {reasonLabel(active.review_reason)}
            </span>
            <span class="text-xs text-gray-400">{Math.round(active.box_w * Math.max(1, active.width))} px face</span>
          </div>

          <h2 class="mt-6 text-2xl font-semibold tracking-tight text-immich-fg dark:text-immich-dark-fg">
            Who is this?
          </h2>
          <p class="mt-2 text-sm/6 text-gray-500 dark:text-gray-400">
            Choose the best local match. Similarity helps order the options; it is not identity proof.
          </p>

          <div class="mt-7 flex flex-col gap-2.5">
            {#each active.candidates as candidate (candidate.person_id)}
              <button
                type="button"
                class:selected-candidate={candidate.person_id === activePersonId}
                class="candidate-row group flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left transition"
                onclick={() => choosePerson(active.face_id, candidate.person_id)}
              >
                <span class="candidate-radio flex size-5 shrink-0 items-center justify-center rounded-full border-2">
                  {#if candidate.person_id === activePersonId}<span class="size-2 rounded-full bg-current"></span>{/if}
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-semibold text-immich-fg dark:text-immich-dark-fg"
                    >{candidate.display_name}</span
                  >
                  <span class="mt-1 block h-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                    <span
                      class="block h-full rounded-full bg-current opacity-50"
                      style={`width: ${Math.max(0, Math.min(100, candidate.prime_score * 100))}%`}
                    ></span>
                  </span>
                </span>
                <span class="text-xs text-gray-400 tabular-nums">{candidate.prime_score.toFixed(2)}</span>
              </button>
            {/each}
          </div>

          <div class="mt-auto pt-8">
            <button
              type="button"
              class="flex w-full items-center justify-center gap-2 rounded-2xl bg-immich-primary px-5 py-3.5 text-sm font-bold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-immich-dark-primary"
              disabled={!activeCandidate || busyFaceId === active.face_id}
              onclick={() => void confirmActive()}
            >
              <Icon icon={mdiCheck} size="19" />
              {busyFaceId === active.face_id ? 'Saving…' : `Confirm ${activeCandidate?.display_name ?? 'person'}`}
            </button>
            <div class="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                class="flex items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 dark:border-immich-dark-gray dark:text-gray-200 dark:hover:bg-gray-900"
                disabled={Boolean(busyFaceId)}
                onclick={() => void markUnknown()}><Icon icon={mdiEyeOutline} size="18" /> Unknown</button
              >
              <button
                type="button"
                class="flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-gray-500 transition hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-900"
                disabled={Boolean(busyFaceId)}
                onclick={skipActive}><Icon icon={mdiSkipNext} size="18" /> Later</button
              >
            </div>
          </div>
        </div>
      </section>

      {#if visibleSuggestions.length > 1}
        <div class="flex items-center justify-between gap-4 px-1">
          <p class="text-sm text-gray-500 dark:text-gray-400">
            <strong class="text-immich-fg dark:text-immich-dark-fg">{visibleSuggestions.length - 1}</strong> useful checks
            remain
          </p>
          <div class="flex -space-x-2" aria-label="Upcoming face reviews">
            {#each visibleSuggestions.slice(1, 6) as item (item.face_id)}
              <span
                class="size-9 rounded-full border-2 border-white bg-gray-200 bg-cover bg-center dark:border-immich-dark-bg"
                style={cropStyle(item)}
              ></span>
            {/each}
          </div>
        </div>
      {/if}
    {:else}
      <section
        class="flex min-h-96 flex-col items-center justify-center rounded-4xl border border-dashed border-gray-300 bg-white px-6 text-center dark:border-immich-dark-gray dark:bg-immich-dark-bg"
      >
        <span
          class="flex size-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
          ><Icon icon={mdiCheck} size="28" /></span
        >
        <h2 class="mt-5 text-xl font-semibold text-immich-fg dark:text-immich-dark-fg">
          No identity reviews are ready.
        </h2>
        <p class="mt-2 max-w-md text-sm/6 text-gray-500 dark:text-gray-400">
          No compatible provider may be enabled, processing may still be pending, evidence may have abstained, or no
          result met the review threshold. Cimmich has not inferred or accepted an identity.
        </p>
        <button
          type="button"
          class="mt-6 flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold dark:border-immich-dark-gray"
          onclick={() => void load()}><Icon icon={mdiRefresh} size="18" /> Check again</button
        >
      </section>
    {/if}

    {#if plan}
      <footer
        class="grid gap-4 rounded-2xl bg-gray-50 px-5 py-4 text-xs text-gray-500 sm:grid-cols-[1fr_auto] sm:items-center dark:bg-gray-900/50 dark:text-gray-400"
      >
        <div>
          <p class="font-semibold text-gray-700 dark:text-gray-200">{plan.headline}</p>
          <p class="mt-1 leading-5">{plan.summary}</p>
        </div>
        <div class="flex items-center gap-2 text-[0.7rem]">
          <Icon icon={mdiLockOutline} size="15" />
          {planBoundaryLabel}
        </div>
      </footer>
    {/if}
  </div>
</UserPageLayout>

<style>
  .steward-shell {
    --steward-ink: 16 24 39;
  }
  .steward-hero {
    position: relative;
    background:
      radial-gradient(circle at 85% 20%, rgb(244 157 76 / 0.42), transparent 32%),
      radial-gradient(circle at 20% 100%, rgb(68 138 148 / 0.4), transparent 42%),
      linear-gradient(135deg, rgb(15 25 42), rgb(30 48 63));
  }
  .steward-hero::after {
    position: absolute;
    inset: 0;
    content: '';
    opacity: 0.15;
    background-image:
      linear-gradient(rgb(255 255 255 / 0.12) 1px, transparent 1px),
      linear-gradient(90deg, rgb(255 255 255 / 0.12) 1px, transparent 1px);
    background-size: 32px 32px;
    mask-image: linear-gradient(to right, transparent, black);
  }
  .steward-hero-compact {
    padding-block: 1.25rem;
  }
  .steward-hero-compact .steward-kicker {
    margin-bottom: 0.6rem;
  }
  .steward-hero-compact .steward-title {
    font-size: 1.65rem;
    line-height: 1.1;
  }
  .candidate-row {
    border-color: rgb(229 231 235);
    color: rgb(156 163 175);
  }
  .candidate-row:hover {
    border-color: rgb(156 163 175);
  }
  .candidate-row.selected-candidate {
    border-color: rgb(var(--immich-primary));
    background: rgb(var(--immich-primary) / 0.055);
    color: rgb(var(--immich-primary));
    box-shadow: 0 0 0 1px rgb(var(--immich-primary) / 0.08);
  }
  .candidate-radio {
    border-color: currentColor;
  }
  :global(.dark) .candidate-row {
    border-color: rgb(55 65 81);
  }
  :global(.dark) .candidate-row.selected-candidate {
    border-color: rgb(var(--immich-dark-primary));
    color: rgb(var(--immich-dark-primary));
    background: rgb(var(--immich-dark-primary) / 0.09);
  }
</style>
