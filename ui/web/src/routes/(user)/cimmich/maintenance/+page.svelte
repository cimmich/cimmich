<script lang="ts">
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import {
    activateCimmichSourcePack,
    compileCimmichSourcePack,
    createCimmichEnhancedCommandId,
    evaluateCimmichSourcePack,
    getCimmichFaceMatchingOperatorStatus,
    getCimmichIntegrationSettingsPack,
    getCimmichIntegrationStatus,
    reviewCimmichSourcePack,
    rollbackCimmichSourcePack,
    updateCimmichEnhancedComponent,
    type CimmichEnhancedComponentStatus,
    type CimmichFaceMatchingOperatorStatus,
    type CimmichIntegrationSettingsPack,
    type CimmichIntegrationStatus,
  } from '$lib/services/cimmich.service';
  import { Icon } from '@immich/ui';
  import {
    mdiCodeJson,
    mdiCheck,
    mdiFaceRecognition,
    mdiHistory,
    mdiLockOutline,
    mdiPauseCircleOutline,
    mdiPower,
    mdiRefresh,
    mdiUpdate,
  } from '@mdi/js';
  import { onMount } from 'svelte';
  import type { PageData } from './$types';
  import CimmichFaceProcessing from './CimmichFaceProcessing.svelte';
  import CimmichImmichSetup from './CimmichImmichSetup.svelte';
  import CimmichLocalBodyProvider from './CimmichLocalBodyProvider.svelte';
  import CimmichLocalFaceProvider from './CimmichLocalFaceProvider.svelte';
  import {
    faceMatchingPresentation,
    faceMatchingReviewHoldCopy,
    referenceLibraryJourney,
    sourcePackReviewGate,
  } from './face-matching-presentation';
  import { guidedPresentation } from './guided-presentation';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
  let error = $state('');
  let enhancedActionBusy = $state(false);
  let enhancedActionMessage = $state('');
  let faceActionBusy = $state(false);
  let faceActionMessage = $state('');
  let faceOperator = $state<CimmichFaceMatchingOperatorStatus>();
  let faceOperatorAvailable = $state(false);
  let loading = $state(true);
  let setupRefreshRevision = $state(0);
  let settings = $state<CimmichIntegrationSettingsPack>();
  let status = $state<CimmichIntegrationStatus>();
  const faceMatching = $derived(faceMatchingPresentation(faceOperator ?? status?.faceMatching));
  const referenceJourney = $derived(referenceLibraryJourney(faceOperator));
  const reviewGate = $derived(sourcePackReviewGate(faceOperator));
  const faceNextAction = $derived.by(() => {
    if (faceOperator?.next.action === 'run_recognition') {
      return 'Process the eligible accepted Faces in durable batches, then build a proposed reference library.';
    }
    if (faceOperator?.next.action === 'compile_source_pack') {
      return 'Analysis is complete for this session. Build a proposed reference library from the eligible accepted evidence.';
    }
    return faceMatching.nextAction;
  });
  const guided = $derived(guidedPresentation(status?.guided));
  const enhanced = $derived<CimmichEnhancedComponentStatus | null | undefined>(status?.enhanced);

  const refreshFaceOperator = async () => {
    try {
      faceOperator = await getCimmichFaceMatchingOperatorStatus();
      faceOperatorAvailable = true;
    } catch {
      faceOperator = undefined;
      faceOperatorAvailable = false;
    }
  };

  const load = async () => {
    loading = true;
    error = '';
    try {
      [status, settings] = await Promise.all([getCimmichIntegrationStatus(), getCimmichIntegrationSettingsPack()]);
      await refreshFaceOperator();
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'Cimmich could not read integration status.';
    } finally {
      loading = false;
    }
  };

  const refreshAll = () => {
    setupRefreshRevision += 1;
    void load();
  };

  const rollbackFacePack = async () => {
    const pack = faceOperator?.latestPack;
    if (!pack?.rollbackAvailable || !pack.predecessorPackId || faceActionBusy) {
      return;
    }
    if (
      !globalThis.confirm(
        'Restore the previous reviewed reference library? Your accepted names and tags will not change.',
      )
    ) {
      return;
    }
    faceActionBusy = true;
    faceActionMessage = '';
    error = '';
    try {
      const result = await rollbackCimmichSourcePack(pack.packId, pack.predecessorPackId);
      faceActionMessage = result.rolledBack
        ? 'The previous reviewed reference library is in use again. Accepted names and tags were unchanged.'
        : 'The previous reviewed reference library was already in use; no library state changed.';
      await load();
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'Cimmich could not restore the previous reference library.';
    } finally {
      faceActionBusy = false;
    }
  };

  const runEnhancedAction = async (action: 'disable' | 'enable' | 'rollback' | 'update') => {
    if (!enhanced || enhancedActionBusy) {
      return;
    }
    const prompts = {
      disable:
        'Turn Enhanced off? Existing names, tags and accepted identity truth stay intact. Matching suggestions will pause.',
      enable:
        'Turn Enhanced on using the locally available component? It will not download model weights, activate a reference library or name anyone automatically.',
      rollback:
        'Restore the previous Enhanced component? Cimmich will first verify compatibility with the current reviewed reference library.',
      update:
        'Update the Enhanced component separately from the Cimmich app? Cimmich will verify compatibility before switching versions.',
    };
    if (!globalThis.confirm(prompts[action])) {
      return;
    }
    enhancedActionBusy = true;
    enhancedActionMessage = '';
    error = '';
    try {
      const result = await updateCimmichEnhancedComponent({
        action,
        commandId: createCimmichEnhancedCommandId(action),
        expectedRevision: enhanced.currentRevision,
        ...((action === 'enable' || action === 'update') && enhanced.available?.version
          ? { targetVersion: enhanced.available.version }
          : {}),
      });
      enhancedActionMessage = result.changed
        ? action === 'disable'
          ? 'Enhanced is off. Core names, tags and accepted identity truth are unchanged.'
          : action === 'rollback'
            ? `Enhanced ${result.active?.version ?? 'previous version'} is active again. No identity decision changed.`
            : `Enhanced ${result.active?.version ?? 'component'} is ready. Matching still requires the five owner-governed steps below.`
        : 'That Enhanced state was already current; nothing changed.';
      await load();
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'Cimmich could not change Enhanced.';
    } finally {
      enhancedActionBusy = false;
    }
  };

  const runFaceAction = async () => {
    if (!faceOperator || faceActionBusy) {
      return;
    }
    if (faceOperator.next.action === 'record_operator_review' && reviewGate.receipt) {
      const disposition = reviewGate.receipt.status === 'passed' ? 'approve' : 'hold';
      if (
        !globalThis.confirm(
          `Record this frozen evaluation as ${disposition}? This records the human review but does not put the reference library into use or change accepted names.`,
        )
      ) {
        return;
      }
    }
    faceActionBusy = true;
    faceActionMessage = '';
    error = '';
    try {
      if (faceOperator.next.action === 'compile_source_pack' || faceOperator.next.action === 'await_more_evidence') {
        const result = await compileCimmichSourcePack();
        faceActionMessage = result.plan?.reason
          ? 'Cimmich prepared a reference library, but it needs more time-separated evidence before review.'
          : `Reference library prepared from ${result.plan?.referencePeople ?? 0} people and ${result.plan?.referenceEvidence ?? 0} accepted references.`;
      } else if (faceOperator.next.action === 'evaluate_source_pack' && faceOperator.latestPack) {
        const result = await evaluateCimmichSourcePack(faceOperator.latestPack.packId);
        faceActionMessage = result.evaluation?.reviewGateReceipt
          ? 'Evaluation is frozen and ready for your explicit review.'
          : faceMatchingReviewHoldCopy(result.evaluation?.reviewGateReceiptNullReason);
      } else if (
        faceOperator.next.action === 'record_operator_review' &&
        faceOperator.latestPack &&
        reviewGate.receipt
      ) {
        const result = await reviewCimmichSourcePack(faceOperator.latestPack.packId, reviewGate.receipt);
        faceActionMessage =
          result.disposition === 'passed'
            ? 'Your review is recorded. The reference library remains inactive until you explicitly choose Use.'
            : 'Your review hold is recorded. Accepted names and current matching remain unchanged.';
      } else if (
        faceOperator.next.action === 'activate_source_pack' &&
        faceOperator.latestPack?.evaluation.evaluationId
      ) {
        const result = await activateCimmichSourcePack({
          expectedCurrentPackId: faceOperator.latestPack.predecessorPackId,
          expectedEvaluationId: faceOperator.latestPack.evaluation.evaluationId,
          packId: faceOperator.latestPack.packId,
        });
        faceActionMessage = result.activated
          ? 'The reviewed reference library is in use. Suggestions remain human-review only.'
          : 'This reviewed reference library was already in use; no library state changed.';
      }
      await load();
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'Cimmich could not complete this matching step.';
    } finally {
      faceActionBusy = false;
    }
  };

  const faceActionLabel = $derived.by(() => {
    if (!faceOperator) {
      return null;
    }
    if (faceOperator.next.action === 'compile_source_pack') {
      return 'Build reference library';
    }
    if (faceOperator.next.action === 'evaluate_source_pack') {
      return 'Check reference library';
    }
    if (faceOperator.next.action === 'record_operator_review' && reviewGate.receipt) {
      return reviewGate.receipt.status === 'passed' ? 'Approve checked reference library' : 'Record evaluation hold';
    }
    if (faceOperator.next.action === 'activate_source_pack') {
      return 'Use reviewed reference library';
    }
    return null;
  });

  onMount(load);
</script>

<UserPageLayout title={data.meta.title} scrollbar={false}>
  <div class="mx-auto w-full max-w-6xl space-y-6 px-4 pt-4 pb-16 sm:px-6 lg:px-8">
    <header class="rounded-4xl bg-slate-950 px-6 py-7 text-white shadow-sm sm:px-8 sm:py-9">
      <div class="flex flex-wrap items-start justify-between gap-5">
        <div class="max-w-3xl">
          <p class="text-xs font-semibold tracking-[0.18em] text-sky-300 uppercase">Setup & local intelligence</p>
          <h1 class="mt-2 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Models & Guided</h1>
          <p class="mt-3 max-w-2xl text-sm/6 text-slate-300 sm:text-base/7">
            Connect your library, manage optional local analysis, and control how external clients can use Cimmich.
          </p>
        </div>
        <button
          type="button"
          class="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 text-sm font-semibold hover:bg-white/15 disabled:opacity-50"
          disabled={loading}
          onclick={refreshAll}
        >
          <Icon icon={mdiRefresh} size="18" class={loading ? 'animate-spin' : ''} /> Refresh status
        </button>
      </div>
    </header>

    <nav
      aria-label="Maintenance sections"
      class="flex flex-wrap items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm dark:border-immich-dark-gray dark:bg-immich-dark-bg"
    >
      <span class="mr-1 text-xs font-semibold tracking-[0.12em] text-gray-500 uppercase dark:text-gray-400"
        >Jump to</span
      >
      <a
        class="rounded-full px-3 py-2 font-semibold hover:bg-gray-100 dark:hover:bg-immich-dark-gray"
        href="#library-connection"
      >
        Library
      </a>
      <a
        class="rounded-full px-3 py-2 font-semibold hover:bg-gray-100 dark:hover:bg-immich-dark-gray"
        href="#matching-workflow"
      >
        Face matching
      </a>
      <a
        class="rounded-full px-3 py-2 font-semibold hover:bg-gray-100 dark:hover:bg-immich-dark-gray"
        href="#body-provider"
      >
        Body analysis
      </a>
      <a
        class="rounded-full px-3 py-2 font-semibold hover:bg-gray-100 dark:hover:bg-immich-dark-gray"
        href="#guided-access"
      >
        Guided
      </a>
    </nav>

    {#if error}
      <div
        class="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
      >
        {error}
      </div>
    {/if}

    <CimmichImmichSetup onChanged={load} refreshRevision={setupRefreshRevision} />

    <section id="matching-workflow" aria-labelledby="matching-workflow-title" class="scroll-mt-24 space-y-5">
      <div class="px-1">
        <p class="text-xs font-semibold tracking-[0.14em] text-violet-700 uppercase dark:text-violet-300">
          Optional workflow
        </p>
        <h2 id="matching-workflow-title" class="mt-1 text-2xl font-semibold">Local Face matching</h2>
        <p class="mt-1 max-w-3xl text-sm/6 text-gray-600 dark:text-gray-300">
          Connect a provider, turn on Enhanced, analyse accepted Faces, then govern the reference library.
        </p>
      </div>

      <CimmichLocalFaceProvider {loading} onRefresh={load} provider={faceOperator?.providerValidation} {settings} />

      <section
        class="rounded-[1.75rem] border border-gray-200 bg-white p-6 dark:border-immich-dark-gray dark:bg-immich-dark-bg"
        aria-labelledby="cimmich-enhanced-title"
      >
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="flex min-w-0 items-start gap-3">
            <span
              class="grid size-11 shrink-0 place-items-center rounded-2xl bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200"
            >
              <Icon icon={mdiPower} size="23" />
            </span>
            <div class="min-w-0">
              <p class="text-xs font-semibold tracking-[0.14em] text-violet-700 uppercase dark:text-violet-300">
                Optional local component
              </p>
              <h2 id="cimmich-enhanced-title" class="mt-1 text-xl font-semibold">Enhanced matching</h2>
              <p class="mt-1 max-w-3xl text-sm/6 text-gray-600 dark:text-gray-300">
                Core remains fully usable when this is off. Enhanced ranks possible matches using local providers; it
                never trains on your library, names anyone automatically or activates a reference library for you.
              </p>
            </div>
          </div>
          <span
            class={`rounded-full px-3 py-1 text-xs font-semibold ${
              enhanced?.state === 'ready'
                ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100'
                : enhanced?.state === 'incompatible'
                  ? 'bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-100'
                  : 'bg-gray-100 dark:bg-immich-dark-gray'
            }`}
          >
            {loading
              ? 'Checking'
              : enhanced?.state === 'ready'
                ? 'On'
                : enhanced?.state === 'incompatible'
                  ? 'Action needed'
                  : enhanced
                    ? 'Off'
                    : 'Not available'}
          </span>
        </div>

        <div class="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <dl class="grid gap-3 text-sm sm:grid-cols-3">
            <div class="rounded-2xl bg-gray-50 p-4 dark:bg-immich-dark-gray/40">
              <dt class="text-xs text-gray-500 dark:text-gray-400">Installed component</dt>
              <dd class="mt-1 font-semibold">{enhanced?.active?.version ?? 'None active'}</dd>
            </div>
            <div class="rounded-2xl bg-gray-50 p-4 dark:bg-immich-dark-gray/40">
              <dt class="text-xs text-gray-500 dark:text-gray-400">Available component</dt>
              <dd class="mt-1 font-semibold">{enhanced?.available?.version ?? 'No local release found'}</dd>
            </div>
            <div class="rounded-2xl bg-gray-50 p-4 dark:bg-immich-dark-gray/40">
              <dt class="text-xs text-gray-500 dark:text-gray-400">Authority</dt>
              <dd class="mt-1 font-semibold">Human decisions only</dd>
            </div>
          </dl>
          {#if enhanced}
            <div class="flex flex-wrap gap-2 lg:justify-end">
              {#if enhanced.enabled}
                <button
                  type="button"
                  class="inline-flex min-h-11 items-center gap-2 rounded-full border border-gray-300 px-4 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-immich-dark-gray"
                  disabled={enhancedActionBusy}
                  onclick={() => void runEnhancedAction('disable')}
                >
                  <Icon icon={mdiPower} size="18" /> Turn off
                </button>
              {:else}
                <button
                  type="button"
                  class="inline-flex min-h-11 items-center gap-2 rounded-full bg-violet-900 px-4 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-50 dark:bg-violet-100 dark:text-violet-950"
                  disabled={enhancedActionBusy || !enhanced.available}
                  onclick={() => void runEnhancedAction('enable')}
                >
                  <Icon icon={mdiPower} size="18" /> Turn on Enhanced
                </button>
              {/if}
              {#if enhanced.updateAvailable}
                <button
                  type="button"
                  class="inline-flex min-h-11 items-center gap-2 rounded-full border border-gray-300 px-4 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-immich-dark-gray"
                  disabled={enhancedActionBusy}
                  onclick={() => void runEnhancedAction('update')}
                >
                  <Icon icon={mdiUpdate} size="18" /> Update Enhanced
                </button>
              {/if}
              {#if enhanced.rollbackAvailable}
                <button
                  type="button"
                  class="inline-flex min-h-11 items-center gap-2 rounded-full border border-gray-300 px-4 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-immich-dark-gray"
                  disabled={enhancedActionBusy}
                  onclick={() => void runEnhancedAction('rollback')}
                >
                  <Icon icon={mdiHistory} size="18" /> Restore previous Enhanced
                </button>
              {/if}
            </div>
          {/if}
        </div>
        <p class="mt-4 text-xs/5 text-gray-500 dark:text-gray-400">
          Enhanced component updates are separate from Cimmich app updates. Model files come only from the source links
          in Advanced provider options above and are never bundled into Cimmich.
        </p>
        {#if enhancedActionMessage}
          <p
            class="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm/6 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
            role="status"
          >
            {enhancedActionMessage}
          </p>
        {/if}
      </section>

      <section
        aria-labelledby="cimmich-face-matching-title"
        class="rounded-[1.75rem] border border-gray-200 bg-white p-6 dark:border-immich-dark-gray dark:bg-immich-dark-bg"
      >
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="flex min-w-0 items-start gap-3">
            <span
              class="grid size-11 shrink-0 place-items-center rounded-2xl bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
            >
              <Icon icon={mdiFaceRecognition} size="23" />
            </span>
            <div class="min-w-0">
              <h2 id="cimmich-face-matching-title" class="text-xl font-semibold">Face matching</h2>
              <p class="mt-1 text-sm wrap-break-word text-gray-500 dark:text-gray-400">{faceMatching.providerLabel}</p>
            </div>
          </div>
          <span
            class={`rounded-full px-3 py-1 text-xs font-semibold ${
              faceMatching.ready
                ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100'
                : 'bg-gray-100 dark:bg-immich-dark-gray dark:text-gray-100'
            }`}
          >
            {loading ? 'Loading' : faceMatching.label}
          </span>
        </div>

        <div class="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)]">
          <div>
            <p class="text-sm/6 text-gray-700 dark:text-gray-200">{faceMatching.summary}</p>
            {#if faceOperator}
              <CimmichFaceProcessing
                acceptedFaces={faceOperator.evidence.acceptedFaces}
                analysedFaces={faceOperator.evidence.analysedFaces}
                canRun={faceOperator.next.action === 'run_recognition'}
                eligibleFaces={faceOperator.evidence.eligibleFaces}
                onRefresh={refreshFaceOperator}
                providerEmbeddings={faceOperator.evidence.providerEmbeddings}
              />
            {/if}
            <div
              class={`mt-4 rounded-2xl border p-5 text-sm/6 ${
                referenceJourney.complete
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100'
                  : referenceJourney.held
                    ? 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100'
                    : 'border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100'
              }`}
            >
              <div class="flex items-start gap-3">
                <span class="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-white/80 dark:bg-black/20">
                  <Icon
                    icon={referenceJourney.complete
                      ? mdiCheck
                      : referenceJourney.held
                        ? mdiPauseCircleOutline
                        : mdiFaceRecognition}
                    size="20"
                  />
                </span>
                <div>
                  <p class="text-xs font-semibold tracking-[0.12em] uppercase">
                    {referenceJourney.complete ? 'Complete' : referenceJourney.held ? 'Safety hold' : 'Current step'}
                  </p>
                  <p class="mt-0.5 text-base font-semibold">{referenceJourney.headline}</p>
                  <p class="mt-1">{faceNextAction}</p>
                </div>
              </div>
              {#if faceOperator?.next.action === 'record_operator_review' && reviewGate.receipt}
                <details class="mt-4 rounded-xl bg-white/70 p-3 text-xs dark:bg-black/20">
                  <summary class="cursor-pointer font-semibold">How Cimmich checked this</summary>
                  <dl class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div>
                      <dt>Precision</dt>
                      <dd class="font-semibold">{reviewGate.receipt.metrics.decisionPrecisionPercent}%</dd>
                    </div>
                    <div>
                      <dt>Known coverage</dt>
                      <dd class="font-semibold">{reviewGate.receipt.metrics.knownCorrectCoveragePercent}%</dd>
                    </div>
                    <div>
                      <dt>Unknown false accepts</dt>
                      <dd class="font-semibold">
                        {reviewGate.receipt.metrics.unknownFalseAcceptRatePercent}%
                      </dd>
                    </div>
                    <div>
                      <dt>Verified unknowns</dt>
                      <dd class="font-semibold">{reviewGate.receipt.metrics.verifiedUnknowns}</dd>
                    </div>
                  </dl>
                </details>
              {/if}
              {#if !faceOperatorAvailable && !loading}
                <p class="mt-3 text-xs/5">
                  This runtime does not expose the owner matching workflow yet. Existing names and tags remain
                  available.
                </p>
              {:else if faceActionLabel}
                <button
                  type="button"
                  class="mt-3 inline-flex min-h-10 items-center gap-2 rounded-full bg-sky-950 px-4 text-sm font-semibold text-white hover:bg-sky-900 disabled:opacity-50 dark:bg-sky-100 dark:text-sky-950 dark:hover:bg-white"
                  disabled={faceActionBusy}
                  onclick={runFaceAction}
                >
                  <Icon icon={mdiRefresh} size="17" class={faceActionBusy ? 'animate-spin' : ''} />
                  {faceActionBusy ? 'Working…' : faceActionLabel}
                </button>
              {:else if faceOperator?.next.action === 'record_operator_review'}
                <p class="mt-3 text-xs/5">
                  {faceMatchingReviewHoldCopy(reviewGate.reason)} This reference library remains inactive, and accepted names
                  are unchanged.
                </p>
              {:else if faceOperator?.next.action === 'await_more_evidence'}
                <div class="mt-4 flex items-center gap-2 text-xs/5 font-medium">
                  <Icon icon={mdiLockOutline} size="17" />
                  Nothing is in use. Names, tags and current suggestions are unchanged.
                </div>
                {#if faceOperator.latestPack}
                  <button
                    type="button"
                    class="mt-3 inline-flex min-h-10 items-center gap-2 rounded-full border border-current px-4 text-sm font-semibold hover:bg-white/50 disabled:opacity-50 dark:hover:bg-black/20"
                    disabled={faceActionBusy}
                    onclick={runFaceAction}
                  >
                    <Icon icon={mdiRefresh} size="17" class={faceActionBusy ? 'animate-spin' : ''} />
                    {faceActionBusy ? 'Building…' : 'Build again after adding evidence'}
                  </button>
                {:else}
                  <p class="mt-3 max-w-2xl text-xs/5">
                    {faceOperator.next.reason === 'NO_ELIGIBLE_ACCEPTED_FACES'
                      ? 'Confirm at least one visible Face before building a reference library.'
                      : 'The provider completed this evidence without a usable embedding. Add or confirm another clear Face before trying again.'}
                  </p>
                {/if}
              {:else if faceOperator?.next.action === 'configure_provider'}
                <a class="mt-3 inline-flex min-h-10 items-center font-semibold underline" href="#face-provider-setup">
                  Set up local matching
                </a>
              {:else if faceOperator?.next.action === 'enable_enhanced' && enhanced}
                <button
                  type="button"
                  class="mt-3 inline-flex min-h-10 items-center gap-2 rounded-full bg-sky-950 px-4 text-sm font-semibold text-white hover:bg-sky-900 disabled:opacity-50 dark:bg-sky-100 dark:text-sky-950"
                  disabled={enhancedActionBusy}
                  onclick={() => void runEnhancedAction('enable')}
                >
                  <Icon icon={mdiPower} size="17" /> Turn on Enhanced first
                </button>
              {/if}
            </div>
            {#if faceActionMessage}
              <p
                class="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm/6 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
              >
                {faceActionMessage}
              </p>
            {/if}
          </div>

          <dl class="grid grid-cols-2 gap-3 text-sm">
            <div class="rounded-2xl bg-gray-50 p-4 dark:bg-immich-dark-gray/40">
              <dt class="text-xs text-gray-500 dark:text-gray-400">Reference library</dt>
              <dd class="mt-1 font-semibold">{faceMatching.activePackLabel}</dd>
            </div>
            <div class="rounded-2xl bg-gray-50 p-4 dark:bg-immich-dark-gray/40">
              <dt class="text-xs text-gray-500 dark:text-gray-400">Prepared library</dt>
              <dd class="mt-1 font-semibold">
                {referenceJourney.held && faceOperator?.latestPack
                  ? '1 proposal safely held'
                  : faceOperator?.next.action === 'activate_source_pack'
                    ? '1 reviewed proposal ready'
                    : faceMatching.awaitingReviewLabel}
              </dd>
            </div>
            <div class="col-span-2 rounded-2xl bg-gray-50 p-4 dark:bg-immich-dark-gray/40">
              <dt class="text-xs text-gray-500 dark:text-gray-400">Identity authority</dt>
              <dd class="mt-1 font-semibold">Human review only</dd>
              <dd class="mt-1 text-xs/5 text-gray-500 dark:text-gray-400">
                Matching may rank suggestions. It never names a Person automatically.
              </dd>
            </div>
            {#if faceOperator}
              <div class="col-span-2 rounded-2xl bg-gray-50 p-4 dark:bg-immich-dark-gray/40">
                <dt class="text-xs text-gray-500 dark:text-gray-400">This library</dt>
                <dd class="mt-1 font-semibold">
                  {faceOperator.evidence?.analysedFaces ?? 0} of {faceOperator.evidence?.eligibleFaces ?? 0} eligible accepted
                  Faces processed
                </dd>
                <dd class="mt-1 text-xs/5 text-gray-500 dark:text-gray-400">
                  {faceOperator.evidence?.providerEmbeddings ?? 0} currently usable matching embeddings.
                </dd>
                {#if faceOperator.evidence.acceptedFaces > faceOperator.evidence.eligibleFaces}
                  <dd class="mt-1 text-xs/5 text-gray-500 dark:text-gray-400">
                    {faceOperator.evidence.acceptedFaces - faceOperator.evidence.eligibleFaces} accepted Faces are outside
                    this viewing/source scope.
                  </dd>
                {/if}
                {#if faceOperator.latestPack}
                  <dd class="mt-1 text-xs/5 text-gray-500 dark:text-gray-400">
                    Latest build: {faceOperator.latestPack.evidence.references} references across
                    {faceOperator.latestPack.evidence.people} people ·
                    {referenceJourney.held ? 'held safely' : faceOperator.latestPack.evaluation.status}
                  </dd>
                  <dd class="mt-3 flex flex-wrap items-center gap-2 text-xs/5 text-gray-500 dark:text-gray-400">
                    <span class="rounded-full bg-white px-2.5 py-1 font-semibold capitalize dark:bg-immich-dark-bg">
                      {faceOperator.latestPack.state}
                    </span>
                    {#if faceOperator.latestPack.rollbackAvailable && faceOperator.latestPack.predecessorPackId}
                      <button
                        type="button"
                        class="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-gray-300 px-3 font-semibold text-gray-700 hover:bg-white disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-immich-dark-bg"
                        disabled={faceActionBusy}
                        onclick={rollbackFacePack}
                      >
                        <Icon icon={mdiHistory} size="16" /> Restore previous
                      </button>
                    {/if}
                  </dd>
                {/if}
              </div>
            {/if}
          </dl>
        </div>

        <ol
          class="mt-5 grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-5 sm:gap-2"
          aria-label="Reference library progress"
        >
          {#each referenceJourney.steps as step, index (step.label)}
            <li class="min-w-0">
              <div
                class={`mb-2 h-1.5 rounded-full ${
                  step.state === 'complete'
                    ? 'bg-emerald-500'
                    : step.state === 'held'
                      ? 'bg-amber-500'
                      : step.state === 'current'
                        ? 'bg-sky-500'
                        : 'bg-gray-200 dark:bg-immich-dark-gray'
                }`}
              ></div>
              <div class="flex items-center gap-1.5">
                {#if step.state === 'complete'}
                  <Icon icon={mdiCheck} size="15" class="shrink-0 text-emerald-600" />
                {:else if step.state === 'held'}
                  <Icon icon={mdiPauseCircleOutline} size="15" class="shrink-0 text-amber-600" />
                {:else}
                  <span class="text-xs text-gray-400">{index + 1}</span>
                {/if}
                <span
                  class={`min-w-0 text-xs/tight font-semibold text-balance ${
                    step.state === 'upcoming' ? 'text-gray-400' : 'text-gray-800 dark:text-gray-100'
                  }`}
                >
                  {step.label}
                </span>
              </div>
            </li>
          {/each}
        </ol>
      </section>
    </section>

    <section id="other-integrations" aria-labelledby="other-integrations-title" class="scroll-mt-24 space-y-5">
      <div class="px-1">
        <p class="text-xs font-semibold tracking-[0.14em] text-sky-700 uppercase dark:text-sky-300">More local tools</p>
        <h2 id="other-integrations-title" class="mt-1 text-2xl font-semibold">Body analysis & external access</h2>
        <p class="mt-1 max-w-3xl text-sm/6 text-gray-600 dark:text-gray-300">
          Manage optional local Body evidence and inspect the current access contract for local clients.
        </p>
      </div>
      <div class="grid gap-5 lg:grid-cols-2">
        <CimmichLocalBodyProvider {loading} {settings} status={status?.bodyDetection} />

        <article
          id="guided-access"
          aria-labelledby="guided-access-title"
          class="scroll-mt-24 rounded-[1.75rem] border border-gray-200 bg-white p-6 dark:border-immich-dark-gray dark:bg-immich-dark-bg"
        >
          <div class="flex items-start justify-between gap-4">
            <div class="flex items-center gap-3">
              <span
                class="grid size-11 place-items-center rounded-2xl bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200"
              >
                <Icon icon={mdiCodeJson} size="23" />
              </span>
              <div>
                <h2 id="guided-access-title" class="text-xl font-semibold">Guided access</h2>
                <p class="text-sm text-gray-500 dark:text-gray-400">Codex, a local model, or any HTTP client</p>
              </div>
            </div>
            <span class="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold dark:bg-immich-dark-gray">
              {status?.guided.enabled ? 'Ready' : 'Off'}
            </span>
          </div>

          <p class="mt-5 text-sm/6 text-gray-600 dark:text-gray-300">
            Guided is one neutral HTTP/JSON access point for the client you choose. The operator decides whether its
            dedicated credential may only read or may use Cimmich's existing operations, and sets the highest viewing
            tier it can request. Every identity decision still follows the same Cimmich validation, replay and Undo
            laws.
          </p>

          <dl class="mt-5 space-y-3 text-sm">
            <div class="rounded-2xl bg-gray-50 p-4 dark:bg-immich-dark-gray/40">
              <dt class="font-semibold">1. Discover the machine contract</dt>
              <dd class="mt-1 font-mono text-xs break-all text-gray-600 dark:text-gray-300">
                {guided.bootstrapEndpoint}
              </dd>
            </div>
            <div class="rounded-2xl bg-gray-50 p-4 dark:bg-immich-dark-gray/40">
              <dt class="font-semibold">2. Use the authority the operator granted</dt>
              <dd class="mt-1 text-xs text-gray-600 dark:text-gray-300">
                {guided.authorityLabel} · {guided.ceilingLabel}. The server derives the actor from the token and rejects
                uncatalogued routes.
              </dd>
            </div>
            <div class="rounded-2xl bg-gray-50 p-4 dark:bg-immich-dark-gray/40">
              <dt class="font-semibold">3. Keep credentials and disclosure explicit</dt>
              <dd class="mt-1 text-xs text-gray-600 dark:text-gray-300">
                The Guided token is never a provider or Immich credential. Cimmich sends nothing to a model provider;
                connected software may disclose anything it retrieves, and its operator accepts that risk.
              </dd>
            </div>
          </dl>

          <p class="mt-4 text-xs/5 text-gray-500 dark:text-gray-400">
            Compatibility clients may still use the forced-Standard, read/propose-only V1 endpoint at
            <span class="font-mono break-all">{guided.legacyCapabilitiesEndpoint}</span>.
          </p>
        </article>
      </div>
    </section>
  </div>
</UserPageLayout>
