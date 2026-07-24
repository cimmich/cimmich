<script lang="ts">
  import type { CimmichIntegrationSettingsPack, CimmichIntegrationStatus } from '$lib/services/cimmich.service';
  import { Icon } from '@immich/ui';
  import {
    mdiArrowTopRight,
    mdiCheckCircleOutline,
    mdiDownloadOutline,
    mdiRobotOutline,
    mdiShieldCheckOutline,
  } from '@mdi/js';

  interface Props {
    loading?: boolean;
    settings?: CimmichIntegrationSettingsPack;
    status?: CimmichIntegrationStatus['bodyDetection'];
  }

  let { loading = false, settings, status }: Props = $props();
  const recommended = $derived(
    settings?.bodyDetection.examples.find((example) => example.adapter === 'ultralytics-yolo-body'),
  );
  const tested = $derived(recommended?.testedSettings);
  const hasEvidence = $derived(Boolean(status?.activeConfigurations || status?.analyzedAssets));
  const remainingAssets = $derived(Math.max(0, (status?.assets ?? 0) - (status?.analyzedAssets ?? 0)));
  const stateLabel = $derived.by(() => {
    if (loading) {
      return 'Checking';
    }
    if (status?.state === 'complete') {
      return 'Complete';
    }
    if (status?.state === 'partial') {
      return 'Partly analysed';
    }
    return 'Not started';
  });

  const downloadBodyContract = () => {
    if (!settings) {
      return;
    }
    const bodyContract = {
      bodyDetection: settings.bodyDetection,
      policy: settings.policy,
      schemaVersion: settings.schemaVersion,
    };
    const url = URL.createObjectURL(
      new Blob([`${JSON.stringify(bodyContract, null, 2)}\n`], { type: 'application/json' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'cimmich-body-provider-settings-v1.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };
</script>

<article
  id="body-provider"
  aria-labelledby="body-evidence-title"
  class="scroll-mt-24 rounded-[1.75rem] border border-gray-200 bg-white p-6 dark:border-immich-dark-gray dark:bg-immich-dark-bg"
>
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div class="flex min-w-0 items-start gap-3">
      <span
        class="grid size-11 shrink-0 place-items-center rounded-2xl bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200"
      >
        <Icon icon={mdiRobotOutline} size="23" />
      </span>
      <div class="min-w-0">
        <p class="text-xs font-semibold tracking-[0.14em] text-sky-700 uppercase dark:text-sky-300">
          Optional local analysis
        </p>
        <h2 id="body-evidence-title" class="mt-1 text-xl font-semibold">Body evidence</h2>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Local provider · never automatic identity</p>
      </div>
    </div>
    <span
      class={`rounded-full px-3 py-1 text-xs font-semibold ${
        status?.state === 'complete'
          ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100'
          : status?.state === 'partial'
            ? 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-100'
            : 'bg-gray-100 dark:bg-immich-dark-gray'
      }`}
    >
      {stateLabel}
    </span>
  </div>

  <div class="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
    <div class="rounded-2xl bg-gray-50 p-3 dark:bg-immich-dark-gray/40">
      <p class="text-2xl font-semibold">{status?.analyzedAssets ?? '—'}</p>
      <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">of {status?.assets ?? '—'} analysed</p>
    </div>
    <div class="rounded-2xl bg-gray-50 p-3 dark:bg-immich-dark-gray/40">
      <p class="text-2xl font-semibold">{status?.bodyObservations ?? '—'}</p>
      <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Bodies</p>
    </div>
    <div class="rounded-2xl bg-gray-50 p-3 dark:bg-immich-dark-gray/40">
      <p class="text-2xl font-semibold">{status?.linkedBodies ?? '—'}</p>
      <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Linked safely</p>
    </div>
    <div class="rounded-2xl bg-gray-50 p-3 dark:bg-immich-dark-gray/40">
      <p class="text-2xl font-semibold">{status?.noBodyAssets ?? '—'}</p>
      <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">No Body found</p>
    </div>
  </div>

  <section
    aria-labelledby="body-provider-title"
    class="mt-5 rounded-2xl border border-sky-200 bg-sky-50/70 p-5 dark:border-sky-900 dark:bg-sky-950/20"
  >
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-xs font-semibold tracking-[0.12em] text-sky-700 uppercase dark:text-sky-300">Provider</p>
        <h3 id="body-provider-title" class="mt-1 font-semibold">
          {recommended ? 'YOLO11 local Body detection' : 'Compatible local Body provider'}
        </h3>
        <p class="mt-1 text-sm/6 text-gray-700 dark:text-gray-200">
          {#if hasEvidence}
            Current evidence comes from {status?.activeConfigurations ?? 0}
            {(status?.activeConfigurations ?? 0) === 1 ? 'validated configuration' : 'validated configurations'}.
            {#if remainingAssets > 0}
              {remainingAssets} supported {remainingAssets === 1 ? 'asset remains' : 'assets remain'} to analyse.
            {/if}
          {:else}
            No Body evidence has been recorded yet. Connect a compatible local provider to begin.
          {/if}
        </p>
      </div>
      <span
        class="rounded-full bg-white px-3 py-1 text-xs font-semibold text-sky-900 dark:bg-immich-dark-bg dark:text-sky-100"
      >
        {hasEvidence ? 'Evidence connected' : 'Ready to configure'}
      </span>
    </div>

    {#if recommended}
      <dl class="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div class="rounded-xl bg-white/80 p-3 dark:bg-immich-dark-bg/70">
          <dt class="text-xs text-gray-500 dark:text-gray-400">Provider</dt>
          <dd class="mt-1 font-semibold">{recommended.adapter}</dd>
        </div>
        <div class="rounded-xl bg-white/80 p-3 dark:bg-immich-dark-bg/70">
          <dt class="text-xs text-gray-500 dark:text-gray-400">Tested model</dt>
          <dd class="mt-1 font-semibold">{tested?.modelId ?? 'Operator selected'}</dd>
        </div>
        <div class="rounded-xl bg-white/80 p-3 dark:bg-immich-dark-bg/70">
          <dt class="text-xs text-gray-500 dark:text-gray-400">Tested locally</dt>
          <dd class="mt-1 font-semibold">
            {tested ? `${tested.device.toUpperCase()} · ${tested.imageSize}px · ${tested.threshold} threshold` : 'Yes'}
          </dd>
        </div>
      </dl>
      <div class="mt-4 flex flex-wrap gap-2">
        {#if recommended.modelSource}
          <a
            class="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-sky-300 bg-white px-3 text-sm font-semibold hover:bg-sky-50 dark:border-sky-800 dark:bg-immich-dark-bg dark:hover:bg-sky-950/40"
            href={recommended.modelSource}
            target="_blank"
            rel="noreferrer"
          >
            Model source <Icon icon={mdiArrowTopRight} size="16" />
          </a>
        {/if}
        {#if recommended.providerSource}
          <a
            class="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-sky-300 bg-white px-3 text-sm font-semibold hover:bg-sky-50 dark:border-sky-800 dark:bg-immich-dark-bg dark:hover:bg-sky-950/40"
            href={recommended.providerSource}
            target="_blank"
            rel="noreferrer"
          >
            Provider source <Icon icon={mdiArrowTopRight} size="16" />
          </a>
        {/if}
        <button
          type="button"
          class="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-sky-300 bg-white px-3 text-sm font-semibold hover:bg-sky-50 disabled:opacity-50 dark:border-sky-800 dark:bg-immich-dark-bg dark:hover:bg-sky-950/40"
          disabled={!settings}
          onclick={downloadBodyContract}
        >
          <Icon icon={mdiDownloadOutline} size="16" /> Download Body contract
        </button>
      </div>
    {/if}

    <details class="mt-4 border-t border-sky-200 pt-3 text-sm dark:border-sky-900">
      <summary class="cursor-pointer font-semibold">Advanced provider details</summary>
      <dl class="mt-3 grid gap-2 text-xs text-gray-600 sm:grid-cols-2 dark:text-gray-300">
        <div>
          <dt>Evidence contract</dt>
          <dd class="mt-1 font-mono break-all">{settings?.bodyDetection.accepts ?? 'Unavailable'}</dd>
        </div>
        <div>
          <dt>Local operator</dt>
          <dd class="mt-1 font-mono break-all">
            {settings?.bodyDetection.evidenceIntake.operatorEntrypoint ?? 'Unavailable'}
          </dd>
        </div>
      </dl>
      <p class="mt-3 text-xs/5 text-gray-500 dark:text-gray-400">
        Cimmich ships the provider contract and tested settings, not model weights. The operator supplies the local
        model and remains responsible for its licence.
      </p>
    </details>
  </section>

  <div
    class="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm/6 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
  >
    <div class="flex gap-2">
      <Icon icon={hasEvidence ? mdiCheckCircleOutline : mdiShieldCheckOutline} size="20" class="mt-0.5 shrink-0" />
      Body evidence is optional context. It never identifies anyone by itself.
    </div>
  </div>
</article>
