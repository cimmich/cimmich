<script lang="ts">
  import { focusTrap } from '$lib/actions/focus-trap';
  import { portal } from '$lib/elements/Portal.svelte';
  import {
    getCimmichAssetEvidence,
    getCimmichLocalAiJob,
    getCimmichLocalAiStatus,
    startCimmichLocalAiJob,
    type CimmichAssetEvidence,
    type CimmichGeneratedSummaryAnalysis,
    type CimmichLocalAiJob,
    type CimmichLocalAiStatus,
  } from '$lib/services/cimmich.service';
  import { ocrManager } from '$lib/stores/ocr.svelte';
  import type { AssetResponseDto } from '@immich/sdk';
  import { Icon, Tooltip, TooltipProvider } from '@immich/ui';
  import { mdiClose, mdiTextBoxSearchOutline } from '@mdi/js';
  import { onDestroy } from 'svelte';
  import { cimmichSummaryQc, compileCimmichModelSummary, compileCimmichStandardSummary } from './cimmich-photo-summary';

  type Mode = 'standard' | 'smart' | 'enhanced';

  interface Props {
    asset: AssetResponseDto;
    canRun?: boolean;
  }

  let { asset, canRun = false }: Props = $props();
  let open = $state(false);
  let loading = $state(false);
  let evidence = $state<CimmichAssetEvidence>();
  let localAi = $state<CimmichLocalAiStatus>();
  let mode = $state<Mode>('standard');
  let job = $state<CimmichLocalAiJob>();
  let error = $state('');
  let stopped = false;

  const analysis = $derived(
    mode === 'smart'
      ? evidence?.generatedSummaries?.smart
      : mode === 'enhanced'
        ? evidence?.generatedSummaries?.enhanced
        : null,
  );
  const standardText = $derived(
    evidence ? compileCimmichStandardSummary({ asset, evidence, ocr: ocrManager.data }) : '',
  );
  const summaryText = $derived(
    analysis && evidence
      ? compileCimmichModelSummary({ analysis, asset, evidence, ocr: ocrManager.data })
      : standardText,
  );
  const qc = $derived(evidence ? cimmichSummaryQc(evidence, analysis) : null);
  const running = $derived(job?.state === 'queued' || job?.state === 'running');
  const capability = $derived(
    mode === 'smart'
      ? localAi?.capabilities.summarySmart
      : mode === 'enhanced'
        ? localAi?.capabilities.summaryEnhanced
        : true,
  );
  const profile = $derived(mode === 'smart' ? localAi?.summaryProfiles.smart : localAi?.summaryProfiles.enhanced);
  const needsRun = $derived(mode !== 'standard' && (!analysis || !analysis.current));

  const load = async () => {
    loading = true;
    error = '';
    try {
      const [nextEvidence, nextLocalAi] = await Promise.all([
        getCimmichAssetEvidence(asset.id),
        getCimmichLocalAiStatus().catch(() => undefined),
      ]);
      evidence = nextEvidence;
      localAi = nextLocalAi;
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'Summary could not be loaded';
    } finally {
      loading = false;
    }
  };

  const show = () => {
    open = true;
    mode = 'standard';
    void load();
  };

  const waitForJob = async (initial: CimmichLocalAiJob) => {
    let current = initial;
    while (!stopped && (current.state === 'queued' || current.state === 'running')) {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 700));
      if (stopped) {
        return;
      }
      current = await getCimmichLocalAiJob(current.jobId);
      job = current;
    }
    if (current.state === 'completed' || current.state === 'partial') {
      evidence = await getCimmichAssetEvidence(asset.id);
    } else if (current.state === 'failed') {
      error = current.error?.message || 'The summary model could not finish';
    }
  };

  const run = async () => {
    if (!canRun || !needsRun || !capability || running || mode === 'standard') {
      return;
    }
    error = '';
    try {
      const started = await startCimmichLocalAiJob(mode === 'smart' ? 'summary-smart' : 'summary-enhanced', [asset.id]);
      job = started;
      await waitForJob(started);
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'Summary generation could not start';
    }
  };

  const close = () => {
    if (!running) {
      open = false;
    }
  };

  const facts = (item: CimmichGeneratedSummaryAnalysis | null | undefined) => {
    if (!item) {
      return [];
    }
    return [
      ...item.visualFacts.activities,
      ...item.visualFacts.objects,
      ...item.visualFacts.visibleText.map((value) => `Text: ${value}`),
    ].slice(0, 12);
  };

  onDestroy(() => (stopped = true));
</script>

<TooltipProvider delayDuration={120}>
  <Tooltip text="Summary">
    {#snippet child({ props })}
      <button {...props} class="trigger" type="button" aria-label="Open photo summary" onclick={show}>
        <Icon icon={mdiTextBoxSearchOutline} size="23" />
      </button>
    {/snippet}
  </Tooltip>
</TooltipProvider>

{#if open}
  <div
    class="backdrop"
    role="presentation"
    use:portal={'body'}
    onkeydown={(event) => event.key === 'Escape' && close()}
  >
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="summary-title" use:focusTrap>
      <header>
        <div>
          <p>Photo understanding</p>
          <h2 id="summary-title">Summary</h2>
        </div>
        <button class="close" type="button" aria-label="Close Summary" disabled={running} onclick={close}>
          <Icon icon={mdiClose} size="22" />
        </button>
      </header>

      <nav aria-label="Summary type">
        {#each ['standard', 'smart', 'enhanced'] as item (item)}
          <button class:active={mode === item} type="button" onclick={() => (mode = item as Mode)}>
            {item[0].toUpperCase() + item.slice(1)}
          </button>
        {/each}
      </nav>

      {#if loading}
        <div class="empty" role="status">Building Standard summary…</div>
      {:else if evidence}
        <article class="summary-card">
          <div class="summary-heading">
            <strong>{mode[0].toUpperCase() + mode.slice(1)}</strong>
            {#if mode === 'standard'}
              <span>Live</span>
            {:else if analysis?.current}
              <span>Current</span>
            {:else if analysis}
              <span class="warning">Needs refresh</span>
            {:else}
              <span>Not run</span>
            {/if}
          </div>
          <p class="summary-text">{summaryText}</p>

          {#if analysis}
            <div class="facts" aria-label="Visual facts">
              {#each facts(analysis) as fact (fact)}<span>{fact}</span>{/each}
            </div>
            <p class="lineage">
              {analysis.model.name} · {new Date(analysis.createdAt).toLocaleDateString()}
            </p>
          {/if}
        </article>

        {#if mode === 'standard'}
          <p class="explanation">Instant · rebuilds from current people, Context, date, place and OCR.</p>
        {:else}
          <p class="explanation">
            {mode === 'smart'
              ? 'Fast local visual pass for scene detail and basic QC.'
              : 'Heavy first visual pass. Later names and Context update without rerunning it.'}
          </p>
          {#if profile?.provider === 'apple-vision'}
            <p class="provider-note">Mac default · Apple Vision · no model download</p>
          {:else if profile?.provider === 'ollama' && profile.model}
            <p class="provider-note">Custom local model · {profile.model}</p>
          {/if}
          {#if profile?.model && !profile.dedicated}
            <p class="notice">Using the shared scene model; a dedicated {mode} profile is not configured.</p>
          {/if}
          {#if !capability}
            <p class="notice">No compatible local {mode} model is configured.</p>
          {/if}
        {/if}

        {#if qc && mode !== 'standard' && analysis}
          <div class="qc">
            <strong>QC leads</strong>
            <span>{qc.missingFaces || 0} possible missing Faces · {qc.missingBodies || 0} possible missing Bodies</span>
            {#if qc.flags.length > 0}<span>{qc.flags.join(' · ')}</span>{/if}
            <small>Leads only. Nothing is added to People without review.</small>
          </div>
        {/if}

        <div class="owner-note">
          <strong>Owner note</strong>
          <span>{evidence.ownerSummary?.summaryText || 'No owner note.'}</span>
        </div>
      {/if}

      {#if running}
        <div class="progress" role="status">
          <span>{mode === 'smart' ? 'Building Smart summary…' : 'Building Enhanced summary…'}</span>
          <progress></progress>
        </div>
      {/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}

      <footer>
        <button class="secondary" type="button" disabled={running} onclick={close}>Close</button>
        {#if mode !== 'standard'}
          <button class="primary" type="button" disabled={!canRun || !needsRun || !capability || running} onclick={run}>
            {analysis?.current ? 'Up to date' : analysis ? `Refresh ${mode}` : `Run ${mode}`}
          </button>
        {/if}
      </footer>
    </div>
  </div>
{/if}

<style>
  .trigger {
    display: grid;
    width: 44px;
    height: 44px;
    place-items: center;
    border-radius: 999px;
    color: white;
  }
  .trigger:hover {
    background: rgb(255 255 255 / 0.14);
  }
  .trigger:focus-visible,
  button:focus-visible {
    outline: 2px solid white;
    outline-offset: 2px;
  }
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 10010;
    display: grid;
    place-items: center;
    padding: 20px;
    background: rgb(0 0 0 / 0.64);
    backdrop-filter: blur(7px);
  }
  .dialog {
    width: min(620px, 100%);
    max-height: min(780px, calc(100vh - 40px));
    overflow: auto;
    border: 1px solid rgb(255 255 255 / 0.16);
    border-radius: 22px;
    background: #171717;
    color: white;
    box-shadow: 0 28px 90px rgb(0 0 0 / 0.55);
  }
  header,
  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 20px 22px;
  }
  header p {
    margin: 0 0 3px;
    color: rgb(255 255 255 / 0.48);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  h2 {
    margin: 0;
    font-size: 24px;
  }
  .close {
    display: grid;
    width: 44px;
    height: 44px;
    place-items: center;
    border-radius: 999px;
    background: rgb(255 255 255 / 0.08);
  }
  nav {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 5px;
    margin: 0 22px;
    padding: 4px;
    border-radius: 13px;
    background: rgb(255 255 255 / 0.06);
  }
  nav button {
    min-height: 40px;
    border-radius: 10px;
    color: rgb(255 255 255 / 0.58);
    font-size: 13px;
    font-weight: 700;
  }
  nav button.active {
    background: rgb(255 255 255 / 0.13);
    color: white;
  }
  .summary-card,
  .qc,
  .owner-note,
  .notice,
  .progress,
  .error,
  .empty {
    margin: 16px 22px 0;
    border-radius: 14px;
  }
  .summary-card {
    padding: 18px;
    background: rgb(255 255 255 / 0.07);
  }
  .summary-heading {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    color: rgb(255 255 255 / 0.55);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .summary-heading strong {
    color: white;
  }
  .warning {
    color: #fbbf24;
  }
  .summary-text {
    margin: 12px 0 0;
    font-size: 16px;
    line-height: 1.55;
  }
  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 14px;
  }
  .facts span {
    padding: 5px 8px;
    border-radius: 999px;
    background: rgb(255 255 255 / 0.08);
    color: rgb(255 255 255 / 0.7);
    font-size: 11px;
  }
  .lineage,
  .explanation,
  .provider-note {
    margin: 12px 22px 0;
    color: rgb(255 255 255 / 0.45);
    font-size: 11px;
  }
  .provider-note {
    color: rgb(186 230 253 / 0.78);
  }
  .summary-card .lineage {
    margin-inline: 0;
  }
  .notice {
    padding: 10px 12px;
    background: rgb(251 191 36 / 0.1);
    color: #fde68a;
    font-size: 12px;
  }
  .qc,
  .owner-note {
    display: grid;
    gap: 5px;
    padding: 13px 15px;
    background: rgb(255 255 255 / 0.045);
    color: rgb(255 255 255 / 0.7);
    font-size: 12px;
  }
  .qc strong,
  .owner-note strong {
    color: white;
  }
  .qc small {
    color: rgb(255 255 255 / 0.4);
  }
  .progress {
    display: grid;
    gap: 8px;
    font-size: 12px;
  }
  progress {
    width: 100%;
  }
  .error {
    padding: 10px 12px;
    background: rgb(248 113 113 / 0.14);
    color: #fecaca;
    font-size: 12px;
  }
  .empty {
    padding: 38px;
    text-align: center;
    color: rgb(255 255 255 / 0.55);
  }
  footer {
    justify-content: flex-end;
  }
  footer button {
    min-height: 44px;
    padding: 0 17px;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 750;
  }
  .secondary {
    background: rgb(255 255 255 / 0.08);
  }
  .primary {
    background: white;
    color: #171717;
  }
  .primary:disabled,
  .secondary:disabled {
    opacity: 0.38;
  }
  @media (max-width: 640px) {
    .backdrop {
      padding: 0;
      align-items: end;
    }
    .dialog {
      max-height: 92vh;
      border-radius: 22px 22px 0 0;
    }
  }
</style>
