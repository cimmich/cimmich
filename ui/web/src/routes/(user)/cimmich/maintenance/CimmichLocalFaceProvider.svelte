<script lang="ts">
  import type {
    CimmichFaceMatchingOperatorStatus,
    CimmichIntegrationSettingsPack,
  } from '$lib/services/cimmich.service';
  import { Icon } from '@immich/ui';
  import {
    mdiArrowTopRight,
    mdiCheck,
    mdiCheckCircleOutline,
    mdiContentCopy,
    mdiDownloadOutline,
    mdiFaceRecognition,
    mdiRefresh,
  } from '@mdi/js';

  interface Props {
    loading?: boolean;
    onRefresh: () => void;
    provider?: CimmichFaceMatchingOperatorStatus['providerValidation'];
    settings?: CimmichIntegrationSettingsPack;
  }

  let { loading = false, onRefresh, provider, settings }: Props = $props();
  let copied = $state(false);
  const installCommand = './tools/companion.sh face-provider install-recommended';
  const connectedProvider = $derived(provider?.state === 'ready' ? provider : undefined);
  const ready = $derived(Boolean(connectedProvider));
  const recommended = $derived(
    settings?.faceRecognition.examples.find((example) => example.adapter === 'opencv-yunet-sface-cpu'),
  );

  const copyInstallCommand = async () => {
    await navigator.clipboard.writeText(installCommand);
    copied = true;
    globalThis.setTimeout(() => (copied = false), 1800);
  };

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
</script>

<section
  id="face-provider-setup"
  aria-labelledby="cimmich-provider-title"
  class={`rounded-[1.75rem] border p-6 ${
    ready
      ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20'
      : 'border-sky-200 bg-sky-50/60 dark:border-sky-900 dark:bg-sky-950/20'
  }`}
>
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div class="flex min-w-0 items-start gap-3">
      <span
        class={`grid size-11 shrink-0 place-items-center rounded-2xl ${
          ready
            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
            : 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200'
        }`}
      >
        <Icon icon={ready ? mdiCheckCircleOutline : mdiFaceRecognition} size="23" />
      </span>
      <div class="min-w-0">
        <p class="text-xs font-semibold tracking-[0.14em] text-gray-500 uppercase dark:text-gray-400">
          Optional face matching
        </p>
        <h2 id="cimmich-provider-title" class="mt-1 text-xl font-semibold">
          {ready ? 'Local provider connected' : 'Set up local matching'}
        </h2>
        <p class="mt-2 max-w-3xl text-sm/6 text-gray-700 dark:text-gray-200">
          {#if ready}
            Cimmich can analyse accepted Faces locally through bounded, owner-started passes. Every suggested identity
            still requires your review.
          {:else}
            Core is already ready. Add the recommended local provider only if you want Cimmich to rank possible Face
            matches for your review.
          {/if}
        </p>
      </div>
    </div>
    <span
      class={`rounded-full px-3 py-1 text-xs font-semibold ${
        ready
          ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100'
          : 'bg-white text-gray-700 dark:bg-immich-dark-bg dark:text-gray-200'
      }`}
    >
      {loading ? 'Checking' : ready ? 'Connected' : 'Not configured'}
    </span>
  </div>

  {#if ready}
    <dl class="mt-5 grid gap-3 text-sm sm:grid-cols-3">
      <div class="rounded-2xl bg-white/80 p-4 dark:bg-immich-dark-bg/70">
        <dt class="text-xs text-gray-500 dark:text-gray-400">Provider</dt>
        <dd class="mt-1 font-semibold">{connectedProvider?.providerId}</dd>
      </div>
      <div class="rounded-2xl bg-white/80 p-4 dark:bg-immich-dark-bg/70">
        <dt class="text-xs text-gray-500 dark:text-gray-400">Model</dt>
        <dd class="mt-1 font-semibold">{connectedProvider?.modelFamily} · {connectedProvider?.modelVersion}</dd>
      </div>
      <div class="rounded-2xl bg-white/80 p-4 dark:bg-immich-dark-bg/70">
        <dt class="text-xs text-gray-500 dark:text-gray-400">Runs</dt>
        <dd class="mt-1 font-semibold">Locally on this computer</dd>
      </div>
    </dl>
    <p class="mt-4 text-sm/6 text-gray-700 dark:text-gray-200">
      Review Enhanced and the current processing state below.
    </p>
  {:else}
    <div class="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]">
      <div class="rounded-2xl bg-white/80 p-5 dark:bg-immich-dark-bg/70">
        <p class="font-semibold">Recommended · OpenCV YuNet + SFace</p>
        <ul class="mt-3 space-y-2 text-sm/6 text-gray-700 dark:text-gray-200">
          <li class="flex gap-2"><Icon icon={mdiCheck} size="18" class="mt-0.5 shrink-0" /> Runs locally on CPU</li>
          <li class="flex gap-2">
            <Icon icon={mdiCheck} size="18" class="mt-0.5 shrink-0" /> Downloads only checksum-verified publisher files
          </li>
          <li class="flex gap-2">
            <Icon icon={mdiCheck} size="18" class="mt-0.5 shrink-0" /> Never uploads photos or confirms an identity
          </li>
        </ul>
      </div>
      <div class="rounded-2xl bg-slate-950 p-5 text-white">
        <p class="text-xs font-semibold tracking-[0.12em] text-sky-300 uppercase">From the release folder</p>
        <code class="mt-3 block text-sm/6 break-all text-slate-100">{installCommand}</code>
        <div class="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            class="inline-flex min-h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-slate-950 hover:bg-slate-100"
            onclick={copyInstallCommand}
          >
            <Icon icon={copied ? mdiCheck : mdiContentCopy} size="17" />
            {copied ? 'Copied' : 'Copy command'}
          </button>
          <button
            type="button"
            class="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/25 px-4 text-sm font-semibold hover:bg-white/10 disabled:opacity-50"
            disabled={loading}
            onclick={onRefresh}
          >
            <Icon icon={mdiRefresh} size="17" class={loading ? 'animate-spin' : ''} /> Refresh status
          </button>
        </div>
      </div>
    </div>
    <p class="mt-4 text-xs/5 text-gray-600 dark:text-gray-300">
      The command asks Docker to download and verify two official OpenCV model files. Matching remains off afterward
      until you explicitly turn on Enhanced.
    </p>
  {/if}

  <details class="mt-5 border-t border-black/10 pt-4 dark:border-white/10">
    <summary class="cursor-pointer text-sm font-semibold">Advanced provider options</summary>
    <div class="mt-4 flex flex-wrap items-start justify-between gap-4">
      <p class="max-w-3xl text-sm/6 text-gray-600 dark:text-gray-300">
        Bring a compatible provider only if you need a different model or runtime. Cimmich validates its evidence
        contract; you remain responsible for its licence and model files.
      </p>
      <button
        type="button"
        class="inline-flex min-h-10 items-center gap-2 rounded-full border border-gray-300 px-4 text-sm font-semibold hover:bg-white disabled:opacity-50 dark:border-gray-600 dark:hover:bg-immich-dark-bg"
        disabled={!settings}
        onclick={downloadSettings}
      >
        <Icon icon={mdiDownloadOutline} size="17" /> Download contract JSON
      </button>
    </div>
    {#if recommended}
      <div class="mt-4 flex flex-wrap gap-2 text-sm">
        {#if recommended.modelSource}
          <a
            class="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-gray-300 px-3 font-semibold hover:bg-white dark:border-gray-600 dark:hover:bg-immich-dark-bg"
            href={recommended.modelSource}
            target="_blank"
            rel="noreferrer"
          >
            OpenCV model source <Icon icon={mdiArrowTopRight} size="16" />
          </a>
        {/if}
        {#if recommended.providerSource}
          <a
            class="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-gray-300 px-3 font-semibold hover:bg-white dark:border-gray-600 dark:hover:bg-immich-dark-bg"
            href={recommended.providerSource}
            target="_blank"
            rel="noreferrer"
          >
            OpenCV provider source <Icon icon={mdiArrowTopRight} size="16" />
          </a>
        {/if}
      </div>
    {/if}
  </details>
</section>
