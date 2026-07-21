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
    runCimmichFaceRecognition,
    updateCimmichEnhancedComponent,
    type CimmichEnhancedComponentStatus,
    type CimmichFaceMatchingOperatorStatus,
    type CimmichIntegrationSettingsPack,
    type CimmichIntegrationStatus,
  } from '$lib/services/cimmich.service';
  import { Icon } from '@immich/ui';
  import {
    mdiArrowTopRight,
    mdiCheckCircleOutline,
    mdiCodeJson,
    mdiDownloadOutline,
    mdiFaceRecognition,
    mdiHistory,
    mdiPower,
    mdiRefresh,
    mdiRobotOutline,
    mdiShieldCheckOutline,
    mdiUpdate,
  } from '@mdi/js';
  import { onMount } from 'svelte';
  import type { PageData } from './$types';
  import CimmichImmichSetup from './CimmichImmichSetup.svelte';
  import { faceMatchingPresentation, faceMatchingReviewHoldCopy } from './face-matching-presentation';
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
  let settings = $state<CimmichIntegrationSettingsPack>();
  let status = $state<CimmichIntegrationStatus>();
  const faceMatching = $derived(faceMatchingPresentation(faceOperator ?? status?.faceMatching));
  const guided = $derived(guidedPresentation(status?.guided));
  const enhanced = $derived<CimmichEnhancedComponentStatus | null | undefined>(status?.enhanced);

  const load = async () => {
    loading = true;
    error = '';
    try {
      [status, settings] = await Promise.all([getCimmichIntegrationStatus(), getCimmichIntegrationSettingsPack()]);
      try {
        faceOperator = await getCimmichFaceMatchingOperatorStatus();
        faceOperatorAvailable = true;
      } catch {
        faceOperator = undefined;
        faceOperatorAvailable = false;
      }
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'Cimmich could not read integration status.';
    } finally {
      loading = false;
    }
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
    if (faceOperator.next.action === 'record_operator_review' && faceOperator.reviewGateReceipt) {
      const disposition = faceOperator.reviewGateReceipt.status === 'passed' ? 'approve' : 'hold';
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
      if (faceOperator.next.action === 'run_recognition') {
        const result = await runCimmichFaceRecognition(10);
        faceActionMessage = `${result.work.recognitions} recognition jobs completed. Cimmich will keep working in bounded passes.`;
      } else if (faceOperator.next.action === 'compile_source_pack') {
        const result = await compileCimmichSourcePack();
        faceActionMessage = result.plan?.reason
          ? 'Cimmich prepared a reference library, but it needs more time-separated evidence before review.'
          : `Reference library prepared from ${result.plan?.referencePeople ?? 0} people and ${result.plan?.referenceEvidence ?? 0} accepted references.`;
      } else if (faceOperator.next.action === 'evaluate_source_pack' && faceOperator.latestPack) {
        const result = await evaluateCimmichSourcePack(faceOperator.latestPack.packId);
        faceActionMessage = result.reviewGateReceipt
          ? 'Evaluation is frozen and ready for your explicit review.'
          : faceMatchingReviewHoldCopy(result.reviewGateReceiptNullReason);
      } else if (
        faceOperator.next.action === 'record_operator_review' &&
        faceOperator.latestPack &&
        faceOperator.reviewGateReceipt
      ) {
        const result = await reviewCimmichSourcePack(faceOperator.latestPack.packId, faceOperator.reviewGateReceipt);
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
    if (faceOperator.next.action === 'run_recognition') {
      return 'Analyse 10 photos';
    }
    if (faceOperator.next.action === 'compile_source_pack') {
      return 'Build reference library';
    }
    if (faceOperator.next.action === 'evaluate_source_pack') {
      return 'Check reference library';
    }
    if (faceOperator.next.action === 'record_operator_review' && faceOperator.reviewGateReceipt) {
      return faceOperator.reviewGateReceipt.status === 'passed'
        ? 'Approve checked reference library'
        : 'Record evaluation hold';
    }
    if (faceOperator.next.action === 'activate_source_pack') {
      return 'Use reviewed reference library';
    }
    return null;
  });

  const downloadSettings = () => {
    if (!settings) {
      return;
    }
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(settings, null, 2)}\n`], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'cimmich-provider-settings-v1.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  onMount(load);
</script>

<UserPageLayout title={data.meta.title} scrollbar={false}>
  <div class="mx-auto w-full max-w-6xl space-y-6 px-4 pt-4 pb-16 sm:px-6 lg:px-8">
    <header class="rounded-4xl bg-slate-950 px-6 py-7 text-white shadow-sm sm:px-8 sm:py-9">
      <div class="flex flex-wrap items-start justify-between gap-5">
        <div class="max-w-3xl">
          <p class="text-xs font-semibold tracking-[0.18em] text-sky-300 uppercase">Local intelligence</p>
          <h1 class="mt-2 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Models & Guided</h1>
          <p class="mt-3 max-w-2xl text-sm/6 text-slate-300 sm:text-base/7">
            Connect the models you choose. Cimmich validates their evidence, connects it to your library and keeps every
            identity decision with you.
          </p>
        </div>
        <button
          type="button"
          class="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 text-sm font-semibold hover:bg-white/15 disabled:opacity-50"
          disabled={loading}
          onclick={load}
        >
          <Icon icon={mdiRefresh} size="18" class={loading ? 'animate-spin' : ''} /> Refresh status
        </button>
      </div>
    </header>

    {#if error}
      <div
        class="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
      >
        {error}
      </div>
    {/if}

    <CimmichImmichSetup />

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
        Enhanced component updates are separate from Cimmich app updates. Model files come only from the provider links
        below and are never bundled into Cimmich.
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
            <h2 class="text-xl font-semibold">Face matching</h2>
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
          <div
            class="mt-4 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm/6 text-sky-950 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100"
          >
            <p class="font-semibold">Next</p>
            <p class="mt-1">{faceMatching.nextAction}</p>
            {#if faceOperator?.next.action === 'record_operator_review' && faceOperator.reviewGateReceipt}
              <dl class="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div class="rounded-xl bg-white/70 p-3 dark:bg-sky-950/60">
                  <dt class="text-sky-700 dark:text-sky-300">Precision</dt>
                  <dd class="mt-1 text-base font-semibold">
                    {faceOperator.reviewGateReceipt.metrics.decisionPrecisionPercent}%
                  </dd>
                  <dd>needs ≥ {faceOperator.reviewGateReceipt.thresholds.minimumDecisionPrecisionPercent}%</dd>
                </div>
                <div class="rounded-xl bg-white/70 p-3 dark:bg-sky-950/60">
                  <dt class="text-sky-700 dark:text-sky-300">Coverage</dt>
                  <dd class="mt-1 text-base font-semibold">
                    {faceOperator.reviewGateReceipt.metrics.knownCorrectCoveragePercent}%
                  </dd>
                  <dd>known people measured</dd>
                </div>
                <div class="rounded-xl bg-white/70 p-3 dark:bg-sky-950/60">
                  <dt class="text-sky-700 dark:text-sky-300">Unknown false accepts</dt>
                  <dd class="mt-1 text-base font-semibold">
                    {faceOperator.reviewGateReceipt.metrics.unknownFalseAcceptRatePercent}%
                  </dd>
                  <dd>needs ≤ {faceOperator.reviewGateReceipt.thresholds.maximumUnknownFalseAcceptRatePercent}%</dd>
                </div>
                <div class="rounded-xl bg-white/70 p-3 dark:bg-sky-950/60">
                  <dt class="text-sky-700 dark:text-sky-300">Verified unknowns</dt>
                  <dd class="mt-1 text-base font-semibold">
                    {faceOperator.reviewGateReceipt.metrics.verifiedUnknowns}
                  </dd>
                  <dd>needs ≥ {faceOperator.reviewGateReceipt.thresholds.minimumVerifiedUnknowns}</dd>
                </div>
              </dl>
              <p class="mt-3 text-xs/5">
                These results and thresholds are frozen by the evaluator. Review records this exact receipt unchanged;
                it does not put the reference library into use.
              </p>
            {/if}
            {#if !faceOperatorAvailable && !loading}
              <p class="mt-3 text-xs/5">
                This runtime does not expose the owner matching workflow yet. Existing names and tags remain available.
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
                {faceMatchingReviewHoldCopy(faceOperator.reviewGateReceiptNullReason)} This reference library remains inactive,
                and accepted names are unchanged.
              </p>
            {:else if faceOperator?.next.action === 'configure_provider'}
              <a class="mt-3 inline-flex min-h-10 items-center font-semibold underline" href="#provider-settings">
                View provider options
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
            <dt class="text-xs text-gray-500 dark:text-gray-400">Review queue</dt>
            <dd class="mt-1 font-semibold">{faceMatching.awaitingReviewLabel}</dd>
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
                {faceOperator.evidence?.providerEmbeddings ?? 0} of {faceOperator.evidence?.acceptedFaces ?? 0} accepted Faces
                analysed
              </dd>
              {#if faceOperator.latestPack}
                <dd class="mt-1 text-xs/5 text-gray-500 dark:text-gray-400">
                  Latest build: {faceOperator.latestPack.evidence.references} references across
                  {faceOperator.latestPack.evidence.people} people · {faceOperator.latestPack.evaluation.status}
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

      <ol class="mt-5 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-5">
        <li class="rounded-2xl border border-gray-200 p-4 dark:border-immich-dark-gray">
          <span class="text-xs font-semibold text-gray-500 dark:text-gray-400">1 · Analyse</span>
          <p class="mt-1 font-semibold">Analyse the current library</p>
        </li>
        <li class="rounded-2xl border border-gray-200 p-4 dark:border-immich-dark-gray">
          <span class="text-xs font-semibold text-gray-500 dark:text-gray-400">2 · Build</span>
          <p class="mt-1 font-semibold">Build a reference library</p>
        </li>
        <li class="rounded-2xl border border-gray-200 p-4 dark:border-immich-dark-gray">
          <span class="text-xs font-semibold text-gray-500 dark:text-gray-400">3 · Check</span>
          <p class="mt-1 font-semibold">Check held-out results</p>
        </li>
        <li class="rounded-2xl border border-gray-200 p-4 dark:border-immich-dark-gray">
          <span class="text-xs font-semibold text-gray-500 dark:text-gray-400">4 · Decide</span>
          <p class="mt-1 font-semibold">Explicitly approve or hold</p>
        </li>
        <li class="rounded-2xl border border-gray-200 p-4 dark:border-immich-dark-gray">
          <span class="text-xs font-semibold text-gray-500 dark:text-gray-400">5 · Use</span>
          <p class="mt-1 font-semibold">Use it—or restore the previous one</p>
        </li>
      </ol>
    </section>

    <section class="grid gap-5 lg:grid-cols-2">
      <article
        class="rounded-[1.75rem] border border-gray-200 bg-white p-6 dark:border-immich-dark-gray dark:bg-immich-dark-bg"
      >
        <div class="flex items-start justify-between gap-4">
          <div class="flex items-center gap-3">
            <span
              class="grid size-11 place-items-center rounded-2xl bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200"
            >
              <Icon icon={mdiRobotOutline} size="23" />
            </span>
            <div>
              <h2 class="text-xl font-semibold">Body evidence</h2>
              <p class="text-sm text-gray-500 dark:text-gray-400">Any compatible local provider</p>
            </div>
          </div>
          <span class="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold capitalize dark:bg-immich-dark-gray">
            {status?.bodyDetection.state?.replace('_', ' ') ?? (loading ? 'Loading' : 'Unavailable')}
          </span>
        </div>

        <div class="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div class="rounded-2xl bg-gray-50 p-3 dark:bg-immich-dark-gray/40">
            <p class="text-2xl font-semibold">{status?.bodyDetection.analyzedAssets ?? '—'}</p>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              of {status?.bodyDetection.assets ?? '—'} analysed
            </p>
          </div>
          <div class="rounded-2xl bg-gray-50 p-3 dark:bg-immich-dark-gray/40">
            <p class="text-2xl font-semibold">{status?.bodyDetection.bodyObservations ?? '—'}</p>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Bodies</p>
          </div>
          <div class="rounded-2xl bg-gray-50 p-3 dark:bg-immich-dark-gray/40">
            <p class="text-2xl font-semibold">{status?.bodyDetection.linkedBodies ?? '—'}</p>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Linked safely</p>
          </div>
          <div class="rounded-2xl bg-gray-50 p-3 dark:bg-immich-dark-gray/40">
            <p class="text-2xl font-semibold">{status?.bodyDetection.noBodyAssets ?? '—'}</p>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Honest no-body</p>
          </div>
        </div>

        <div
          class="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm/6 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
        >
          <div class="flex gap-2">
            <Icon icon={mdiShieldCheckOutline} size="20" class="mt-0.5 shrink-0" /> Provider output is evidence, never automatic
            identity truth.
          </div>
        </div>
      </article>

      <article
        class="rounded-[1.75rem] border border-gray-200 bg-white p-6 dark:border-immich-dark-gray dark:bg-immich-dark-bg"
      >
        <div class="flex items-start justify-between gap-4">
          <div class="flex items-center gap-3">
            <span
              class="grid size-11 place-items-center rounded-2xl bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200"
            >
              <Icon icon={mdiCodeJson} size="23" />
            </span>
            <div>
              <h2 class="text-xl font-semibold">Guided access</h2>
              <p class="text-sm text-gray-500 dark:text-gray-400">Codex, a local model, or any HTTP client</p>
            </div>
          </div>
          <span class="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold dark:bg-immich-dark-gray">
            {status?.guided.enabled ? 'Ready' : 'Off'}
          </span>
        </div>

        <p class="mt-5 text-sm/6 text-gray-600 dark:text-gray-300">
          Guided is one neutral HTTP/JSON access point for the client you choose. The operator decides whether its
          dedicated credential may only read or may use Cimmich's existing operations, and sets the highest viewing tier
          it can request. Every identity decision still follows the same Cimmich validation, replay and Undo laws.
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
    </section>

    <section
      id="provider-settings"
      class="rounded-[1.75rem] border border-gray-200 bg-white p-6 dark:border-immich-dark-gray dark:bg-immich-dark-bg"
    >
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="max-w-2xl">
          <h2 class="text-xl font-semibold">Provider settings</h2>
          <p class="mt-2 text-sm/6 text-gray-600 dark:text-gray-300">
            Contracts, tested settings and official upstream links—not model files. Choose and download the model you
            want from its publisher, then adapt its output to the Cimmich contract.
          </p>
        </div>
        <button
          type="button"
          class="inline-flex min-h-11 items-center gap-2 rounded-full bg-immich-primary px-4 text-sm font-semibold text-white hover:bg-immich-primary/90 disabled:opacity-50 dark:bg-immich-dark-primary dark:text-black"
          disabled={!settings}
          onclick={downloadSettings}
        >
          <Icon icon={mdiDownloadOutline} size="18" /> Download settings JSON
        </button>
      </div>

      <div class="mt-6 grid gap-4 md:grid-cols-2">
        {#each settings?.faceRecognition.examples ?? [] as example (example.adapter)}
          <article class="rounded-2xl border border-gray-200 p-4 dark:border-immich-dark-gray">
            <div class="flex items-center gap-2">
              <Icon icon={mdiFaceRecognition} size="19" class="text-amber-700 dark:text-amber-300" />
              <h3 class="font-semibold">{example.adapter}</h3>
            </div>
            <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Face recognition · {example.role.replaceAll('_', ' ')}
            </p>
            {#if example.models?.length}
              <ul class="mt-3 space-y-2 text-xs text-gray-600 dark:text-gray-300">
                {#each example.models as model (model.id)}
                  <li
                    class="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-gray-50 px-3 py-2 dark:bg-immich-dark-gray/40"
                  >
                    <span>{model.id} · {model.licence}</span>
                    <a
                      class="font-semibold text-immich-primary hover:underline dark:text-immich-dark-primary"
                      href={model.source}
                      target="_blank"
                      rel="noreferrer">Download from publisher</a
                    >
                  </li>
                {/each}
              </ul>
            {/if}
            <div class="mt-4 flex flex-wrap gap-2">
              {#if example.modelSource}
                <a
                  class="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-gray-300 px-3 text-sm font-semibold hover:bg-gray-50 dark:border-immich-dark-gray dark:hover:bg-immich-dark-gray/40"
                  href={example.modelSource}
                  target="_blank"
                  rel="noreferrer"
                >
                  Model source <Icon icon={mdiArrowTopRight} size="16" />
                </a>
              {/if}
              {#if example.providerSource}
                <a
                  class="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-gray-300 px-3 text-sm font-semibold hover:bg-gray-50 dark:border-immich-dark-gray dark:hover:bg-immich-dark-gray/40"
                  href={example.providerSource}
                  target="_blank"
                  rel="noreferrer"
                >
                  Provider source <Icon icon={mdiArrowTopRight} size="16" />
                </a>
              {/if}
            </div>
            {#if example.installEntrypoint}
              <p class="mt-3 text-xs/5 text-gray-500 dark:text-gray-400">
                Verified installer: <span class="font-mono break-all">{example.installEntrypoint}</span>
              </p>
            {/if}
          </article>
        {/each}

        {#each settings?.bodyDetection.examples ?? [] as example (example.adapter)}
          <article class="rounded-2xl border border-gray-200 p-4 dark:border-immich-dark-gray">
            <div class="flex items-center gap-2">
              <Icon icon={mdiCheckCircleOutline} size="19" class="text-emerald-600 dark:text-emerald-300" />
              <h3 class="font-semibold">{example.adapter}</h3>
            </div>
            <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
              {example.role.replaceAll('_', ' ')} · {example.licence.replaceAll('_', ' ')}
            </p>
            <div class="mt-4 flex flex-wrap gap-2">
              {#if example.modelSource}
                <a
                  class="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-gray-300 px-3 text-sm font-semibold hover:bg-gray-50 dark:border-immich-dark-gray dark:hover:bg-immich-dark-gray/40"
                  href={example.modelSource}
                  target="_blank"
                  rel="noreferrer"
                >
                  Model source <Icon icon={mdiArrowTopRight} size="16" />
                </a>
              {/if}
              {#if example.providerSource}
                <a
                  class="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-gray-300 px-3 text-sm font-semibold hover:bg-gray-50 dark:border-immich-dark-gray dark:hover:bg-immich-dark-gray/40"
                  href={example.providerSource}
                  target="_blank"
                  rel="noreferrer"
                >
                  Provider source <Icon icon={mdiArrowTopRight} size="16" />
                </a>
              {/if}
            </div>
          </article>
        {/each}
      </div>

      <p class="mt-5 text-xs/5 text-gray-500 dark:text-gray-400">
        {settings?.policy.statement ??
          'Cimmich publishes governed evidence contracts and tested settings without bundling model artifacts.'}
      </p>
    </section>
  </div>
</UserPageLayout>
