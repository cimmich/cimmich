<script lang="ts">
  import { focusTrap } from '$lib/actions/focus-trap';
  import { portal } from '$lib/elements/Portal.svelte';
  import {
    cancelCimmichLocalAiJob,
    getCimmichLocalAiArtifact,
    getCimmichLocalAiJob,
    getCimmichLocalAiStatus,
    startCimmichLocalAiJob,
    type CimmichLocalAiJob,
    type CimmichLocalAiOperation,
    type CimmichLocalAiStatus,
  } from '$lib/services/cimmich.service';
  import { Icon } from '@immich/ui';
  import { mdiAutoFix, mdiCheckCircleOutline, mdiClose, mdiImageSearchOutline, mdiShieldCheckOutline } from '@mdi/js';
  import { onDestroy } from 'svelte';

  interface Props {
    sourceAssetIds: string[];
    variant?: 'overlay' | 'toolbar';
  }

  let { sourceAssetIds, variant = 'overlay' }: Props = $props();
  let open = $state(false);
  let loading = $state(false);
  let status = $state<CimmichLocalAiStatus>();
  let job = $state<CimmichLocalAiJob>();
  let selected = $state<CimmichLocalAiOperation>('quick');
  let error = $state('');
  let artifactUrls = $state<Array<{ label: string; url: string }>>([]);
  let stopped = false;
  const selectionAllowed = $derived(!status || sourceAssetIds.length <= status.limits.maxAssets);

  const operations = $derived([
    {
      id: 'quick' as const,
      available: selectionAllowed && (status?.capabilities.quick ?? false),
      title: 'Upscale · Quick',
      detail: 'A fast, full-photo 2x upscale with conservative sharpening. Your original stays untouched.',
    },
    {
      id: 'best' as const,
      available: selectionAllowed && (status?.capabilities.best ?? false),
      title: 'Upscale · Best',
      detail: 'A full-photo 2x AI reconstruction. Slow on CPU; live tile progress appears below.',
    },
    {
      id: 'faces' as const,
      available: selectionAllowed && (status?.capabilities.faces ?? false),
      title: 'Look for missed Faces',
      detail: 'Runs a fresh local detector and compares it with saved Face boxes.',
    },
    {
      id: 'context' as const,
      available: selectionAllowed && (status?.capabilities.context ?? false) && sourceAssetIds.length > 1,
      title: 'Add Context',
      detail:
        sourceAssetIds.length > 1
          ? 'Uses accepted identity anchors across this small selection. Suggestions still require review.'
          : 'Choose a small sequence of photos to use Context.',
    },
    {
      id: 'bodies' as const,
      available: selectionAllowed && (status?.capabilities.bodies ?? false),
      title: 'Look for missed Bodies',
      detail: 'Runs the high-detail local detector and compares it with saved Body boxes.',
    },
    {
      id: 'scene-text' as const,
      available: selectionAllowed && (status?.capabilities.sceneText ?? false),
      title: 'Read Scene & Text',
      detail: 'Requires a separately configured loopback-only vision model.',
    },
  ]);

  const running = $derived(job?.state === 'queued' || job?.state === 'running');
  const finished = $derived(job && ['cancelled', 'completed', 'failed', 'partial'].includes(job.state));
  const selectedAvailable = $derived(operations.find((operation) => operation.id === selected)?.available ?? false);
  const progressText = $derived.by(() => {
    const progress = job?.progress;
    if (!progress) {
      return '';
    }
    const model = progress.model;
    if (!model) {
      return progress.phase.replaceAll('-', ' ');
    }
    if (model.stage === 'upscaling' && model.totalTiles) {
      return `Upscaling · ${model.completedTiles ?? 0} of ${model.totalTiles} tiles`;
    }
    const labels: Record<string, string> = {
      'checking-result': 'Checking the reconstructed image',
      complete: 'Finishing the review artifact',
      encoding: 'Writing the review image',
      resampling: 'Upscaling the full photo',
      sharpening: 'Applying conservative sharpening',
    };
    return labels[model.stage] ?? model.stage.replaceAll('-', ' ');
  });
  const faceSummary = $derived.by(() => {
    const assets = job?.result?.assets ?? [];
    const detected = assets.reduce((sum, asset) => sum + (asset.operations?.faces?.faces?.length ?? 0), 0);
    const added = assets.reduce((sum, asset) => sum + (asset.baselineComparison?.faces?.added?.length ?? 0), 0);
    return { added, detected };
  });
  const bodySummary = $derived.by(() => {
    const assets = job?.result?.assets ?? [];
    const detected = assets.reduce((sum, asset) => sum + (asset.operations?.bodies?.bodies?.length ?? 0), 0);
    const added = assets.reduce((sum, asset) => sum + (asset.baselineComparison?.bodies?.added?.length ?? 0), 0);
    const failed = assets.some((asset) => asset.operations?.bodies?.state === 'failed');
    return { added, detected, failed };
  });

  const revokeArtifacts = () => {
    for (const artifact of artifactUrls) {
      URL.revokeObjectURL(artifact.url);
    }
    artifactUrls = [];
  };

  const loadArtifacts = async (nextJob: CimmichLocalAiJob) => {
    revokeArtifacts();
    const loaded = await Promise.all(
      nextJob.artifactTokens.map(async (token) => ({
        label: token.endsWith(':overlay')
          ? 'Review overlay'
          : token.endsWith(':quick')
            ? 'Quick upscale'
            : 'Best preview',
        url: URL.createObjectURL(await getCimmichLocalAiArtifact(nextJob.jobId, token)),
      })),
    );
    artifactUrls = loaded;
  };

  const show = async () => {
    open = true;
    error = '';
    if (status) {
      return;
    }
    loading = true;
    try {
      status = await getCimmichLocalAiStatus();
      const first = operations.find((operation) => operation.available);
      if (first) {
        selected = first.id;
      }
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'Local AI status could not be loaded';
    } finally {
      loading = false;
    }
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
      await loadArtifacts(current);
    }
  };

  const run = async () => {
    if (!selectedAvailable || running) {
      return;
    }
    error = '';
    revokeArtifacts();
    try {
      const started = await startCimmichLocalAiJob(selected, sourceAssetIds);
      job = started;
      await waitForJob(started);
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'Local AI could not start';
    }
  };

  const cancel = async () => {
    if (!job || !running) {
      return;
    }
    try {
      job = await cancelCimmichLocalAiJob(job.jobId);
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'Local AI could not be cancelled';
    }
  };

  const close = () => {
    if (running) {
      return;
    }
    open = false;
    revokeArtifacts();
  };

  onDestroy(() => {
    stopped = true;
    revokeArtifacts();
  });
</script>

<button
  class="local-ai-trigger"
  class:toolbar-trigger={variant === 'toolbar'}
  type="button"
  aria-label="Open Local AI review"
  title="Local AI"
  onclick={() => void show()}
>
  <Icon icon={mdiAutoFix} size="23" />
</button>

{#if open}
  <div
    class="local-ai-backdrop"
    role="presentation"
    use:portal={'body'}
    onkeydown={(event) => {
      if (event.key === 'Escape' && !running) {
        close();
      }
    }}
  >
    <div
      class="local-ai-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="local-ai-title"
      aria-describedby="local-ai-boundary"
      use:focusTrap
    >
      <button class="close" type="button" aria-label="Close Local AI" disabled={running} onclick={close}>
        <Icon icon={mdiClose} size="22" />
      </button>
      <div class="heading-icon" aria-hidden="true"><Icon icon={mdiImageSearchOutline} size="24" /></div>
      <p class="eyebrow">On-device photo lab</p>
      <h2 id="local-ai-title">Local AI</h2>
      <p id="local-ai-boundary" class="boundary">
        Review-only results for {sourceAssetIds.length === 1
          ? 'this photo'
          : `${sourceAssetIds.length} selected photos`}. Nothing is written into identity or Context data until you
        explicitly review it.
      </p>
      {#if status && !selectionAllowed}
        <p class="selection-limit" role="alert">
          Choose at most {status.limits.maxAssets} photos for one local run. This keeps the review fast and bounded.
        </p>
      {/if}

      {#if loading}
        <p class="status" role="status">Checking local models…</p>
      {:else if status}
        <div class="choices" role="radiogroup" aria-label="Local AI operation">
          {#each operations as operation (operation.id)}
            <label class:unavailable={!operation.available} class:selected={selected === operation.id}>
              <input
                type="radio"
                name="local-ai-operation"
                value={operation.id}
                checked={selected === operation.id}
                disabled={!operation.available || running}
                onchange={() => (selected = operation.id)}
              />
              <span><strong>{operation.title}</strong><small>{operation.detail}</small></span>
              <span class="capability">{operation.available ? 'Ready' : 'Unavailable'}</span>
            </label>
          {/each}
        </div>
      {/if}

      {#if job}
        <div class="run-card" aria-live="polite">
          <strong
            >{job.state === 'partial'
              ? 'Review ready · some providers unavailable'
              : job.state.replace('-', ' ')}</strong
          >
          <span>{progressText}</span>
          {#if running}
            {#if job.progress.model}
              <progress
                aria-label={progressText}
                max={job.progress.model.totalUnits}
                value={job.progress.model.completedUnits}
              ></progress>
            {:else if job.progress.phase === 'running-model'}
              <progress aria-label="Preparing the local model"></progress>
            {:else}
              <progress
                aria-label={progressText}
                max={Math.max(1, job.progress.totalAssets)}
                value={job.progress.completedAssets}
              ></progress>
            {/if}
          {/if}
          {#if job.result?.originalsUnchanged}
            <span class="verified"><Icon icon={mdiShieldCheckOutline} size="18" /> Original verified unchanged</span>
          {/if}
          {#if job.operation === 'faces' && finished && job.result}
            <span>{faceSummary.detected} detected · {faceSummary.added} not in the saved Face boxes</span>
          {/if}
          {#if job.operation === 'bodies' && finished && job.result}
            {#if bodySummary.failed}
              <span role="alert">Body detection did not complete. No detections were accepted; run it again.</span>
            {:else}
              <span>{bodySummary.detected} detected · {bodySummary.added} not in the saved Body boxes</span>
            {/if}
          {/if}
          {#if job.result?.summary?.text && job.operation === 'context'}
            <p>{job.result.summary.text}</p>
          {/if}
        </div>
      {/if}

      {#if artifactUrls.length > 0}
        <div class="previews">
          {#each artifactUrls as artifact (artifact.url)}
            <figure>
              <img src={artifact.url} alt={artifact.label} />
              <figcaption><Icon icon={mdiCheckCircleOutline} size="17" /> {artifact.label}</figcaption>
            </figure>
          {/each}
        </div>
      {/if}

      {#if error}<p class="error" role="alert">{error}</p>{/if}

      <div class="actions">
        {#if running}
          <button class="secondary" type="button" onclick={() => void cancel()}>Cancel run</button>
        {:else}
          <button class="secondary" type="button" onclick={close}>Close</button>
          <button class="primary" type="button" disabled={!selectedAvailable || loading} onclick={() => void run()}>
            <Icon icon={mdiAutoFix} size="19" /> Run locally
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .local-ai-trigger {
    display: grid;
    width: 40px;
    height: 40px;
    place-items: center;
    border-radius: 999px;
    color: white;
    transition: background 150ms ease;
  }
  .local-ai-trigger:hover {
    background: rgb(255 255 255 / 0.15);
  }
  .local-ai-trigger:focus-visible {
    outline: 2px solid white;
  }
  .toolbar-trigger {
    width: 34px;
    height: 34px;
    color: rgb(51 65 85);
  }
  .toolbar-trigger:hover {
    background: rgb(226 232 240);
  }
  .toolbar-trigger:focus-visible {
    outline-color: rgb(2 132 199);
  }
  .local-ai-backdrop {
    position: fixed;
    z-index: 1200;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 18px;
    background: rgb(0 0 0 / 0.72);
    color: rgb(17 24 39);
  }
  .local-ai-dialog {
    position: relative;
    width: min(100%, 720px);
    max-height: min(90vh, 900px);
    overflow: auto;
    border: 1px solid rgb(226 232 240);
    border-radius: 26px;
    padding: 28px;
    background: rgb(255 255 255);
    box-shadow: 0 34px 100px rgb(0 0 0 / 0.4);
  }
  .close {
    position: absolute;
    top: 18px;
    right: 18px;
    display: grid;
    width: 40px;
    height: 40px;
    place-items: center;
    border-radius: 999px;
    color: rgb(71 85 105);
  }
  .close:hover,
  .close:focus-visible {
    background: rgb(241 245 249);
    outline: none;
  }
  .heading-icon {
    display: grid;
    width: 46px;
    height: 46px;
    place-items: center;
    border-radius: 15px;
    background: rgb(224 242 254);
    color: rgb(3 105 161);
  }
  .eyebrow {
    margin-top: 16px;
    color: rgb(3 105 161);
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.09em;
    text-transform: uppercase;
  }
  h2 {
    margin-top: 4px;
    font-size: 1.75rem;
    font-weight: 760;
    line-height: 1.1;
  }
  .boundary {
    margin-top: 9px;
    max-width: 62ch;
    color: rgb(71 85 105);
    font-size: 0.92rem;
    line-height: 1.5;
  }
  .selection-limit {
    margin-top: 14px;
    border-radius: 12px;
    padding: 11px 12px;
    background: rgb(254 243 199);
    color: rgb(146 64 14);
    font-size: 0.84rem;
    font-weight: 650;
  }
  .choices {
    display: grid;
    gap: 9px;
    margin-top: 22px;
  }
  .choices label {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 12px;
    align-items: start;
    border: 1px solid rgb(226 232 240);
    border-radius: 16px;
    padding: 13px 14px;
    cursor: pointer;
  }
  .choices label.selected {
    border-color: rgb(14 165 233);
    background: rgb(240 249 255);
    box-shadow: 0 0 0 1px rgb(14 165 233 / 0.18);
  }
  .choices label.unavailable {
    background: rgb(248 250 252);
    color: rgb(100 116 139);
    cursor: not-allowed;
  }
  .choices input {
    margin-top: 3px;
    accent-color: rgb(2 132 199);
  }
  .choices strong,
  .choices small {
    display: block;
  }
  .choices small {
    margin-top: 3px;
    color: rgb(100 116 139);
    font-size: 0.78rem;
    line-height: 1.35;
  }
  .capability {
    border-radius: 999px;
    padding: 3px 8px;
    background: rgb(226 232 240);
    color: rgb(71 85 105);
    font-size: 0.67rem;
    font-weight: 750;
    text-transform: uppercase;
  }
  .selected .capability {
    background: rgb(186 230 253);
    color: rgb(3 105 161);
  }
  .run-card {
    display: grid;
    gap: 7px;
    margin-top: 18px;
    border-radius: 16px;
    padding: 15px;
    background: rgb(241 245 249);
    color: rgb(51 65 85);
    font-size: 0.84rem;
  }
  .run-card > strong {
    color: rgb(15 23 42);
    text-transform: capitalize;
  }
  progress {
    width: 100%;
    accent-color: rgb(2 132 199);
  }
  .verified {
    display: flex;
    gap: 6px;
    align-items: center;
    color: rgb(21 128 61);
    font-weight: 650;
  }
  .previews {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    gap: 12px;
    margin-top: 16px;
  }
  figure {
    overflow: hidden;
    border: 1px solid rgb(226 232 240);
    border-radius: 15px;
    background: rgb(15 23 42);
  }
  figure img {
    display: block;
    width: 100%;
    max-height: 360px;
    object-fit: contain;
  }
  figcaption {
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 10px 12px;
    background: white;
    color: rgb(30 41 59);
    font-size: 0.8rem;
    font-weight: 650;
  }
  .status,
  .error {
    margin-top: 18px;
    border-radius: 12px;
    padding: 12px;
    font-size: 0.86rem;
  }
  .status {
    background: rgb(241 245 249);
  }
  .error {
    background: rgb(254 226 226);
    color: rgb(153 27 27);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 22px;
  }
  .actions button {
    display: inline-flex;
    min-height: 42px;
    align-items: center;
    gap: 7px;
    border-radius: 999px;
    padding: 0 18px;
    font-weight: 720;
  }
  .secondary {
    border: 1px solid rgb(203 213 225);
    color: rgb(51 65 85);
  }
  .primary {
    background: rgb(2 132 199);
    color: white;
  }
  .primary:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  @media (max-width: 560px) {
    .local-ai-dialog {
      padding: 22px 18px;
      border-radius: 20px;
    }
    .choices label {
      grid-template-columns: auto 1fr;
    }
    .capability {
      grid-column: 2;
      justify-self: start;
    }
  }
</style>
