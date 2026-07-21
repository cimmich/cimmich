<script lang="ts">
  import {
    CimmichServiceError,
    connectCimmichImmich,
    getCimmichPeople,
    getCimmichImmichOnboardingStatus,
    importCimmichImmichOnboarding,
    previewCimmichImmichOnboarding,
    type CimmichImmichOnboardingImportResult,
    type CimmichImmichOnboardingPreview,
    type CimmichImmichOnboardingScope,
    type CimmichImmichOnboardingStatus,
  } from '$lib/services/cimmich.service';
  import { Route } from '$lib/route';
  import { Icon } from '@immich/ui';
  import { mdiCheckCircleOutline, mdiDatabaseImportOutline, mdiRefresh } from '@mdi/js';
  import { onMount } from 'svelte';
  import CimmichImmichPersonResolution from './CimmichImmichPersonResolution.svelte';

  let status = $state<CimmichImmichOnboardingStatus>();
  let preview = $state<CimmichImmichOnboardingPreview>();
  let result = $state<CimmichImmichOnboardingImportResult>();
  let loading = $state(true);
  let busy = $state<'connect' | 'import' | 'preview' | ''>('');
  let error = $state('');
  let notice = $state('');
  let personResolutionReady = $state(true);
  let existingCimmichPeopleCount = $state(0);
  let apiBaseUrl = $state('');
  let credential = $state('');
  let scope = $state<CimmichImmichOnboardingScope>({
    importPeople: true,
    includeHiddenPeople: false,
    mediaKinds: ['image', 'video'],
    providerMode: 'deferred',
    visibilities: ['timeline'],
  });

  const connectionReady = $derived(status?.connection.state === 'ready');
  const completed = $derived(status?.latestRun?.state === 'completed');
  const interrupted = $derived(status?.latestRun?.state === 'importing' || status?.latestRun?.state === 'interrupted');
  const processedAssets = $derived(Number(status?.latestRun?.progress?.processedAssets ?? 0));

  const copyScope = (value: CimmichImmichOnboardingScope): CimmichImmichOnboardingScope => ({
    importPeople: value.importPeople,
    includeHiddenPeople: value.includeHiddenPeople,
    mediaKinds: [...value.mediaKinds],
    providerMode: value.providerMode,
    visibilities: [...value.visibilities],
  });

  const messageFor = (error_: unknown, fallback: string) => {
    if (error_ instanceof CimmichServiceError && error_.code === 'IMMICH_ONBOARDING_PERSON_LABEL_REQUIRED') {
      const count = Number(error_.details?.unlabelledAssignedFaces || 0);
      return `${count} assigned Immich ${count === 1 ? 'Face belongs' : 'Faces belong'} to unnamed People. Name or explicitly resolve those clusters before importing identity truth.`;
    }
    return error_ instanceof Error ? error_.message : fallback;
  };

  const loadStatus = async () => {
    loading = true;
    error = '';
    try {
      const [currentStatus, visiblePeople] = await Promise.all([
        getCimmichImmichOnboardingStatus(),
        getCimmichPeople(500).catch(() => []),
      ]);
      status = currentStatus;
      existingCimmichPeopleCount = visiblePeople.filter((person) => person.subject_kind === 'person').length;
      result = status.latestRun?.result ?? undefined;
      if (interrupted && status.latestRun?.scope) {
        scope = copyScope(status.latestRun.scope);
      }
    } catch (error_) {
      error = messageFor(error_, 'Cimmich could not read setup status.');
    } finally {
      loading = false;
    }
  };

  const connect = async () => {
    if (!apiBaseUrl.trim() || !credential.trim() || busy) {
      return;
    }
    busy = 'connect';
    error = '';
    notice = '';
    try {
      await connectCimmichImmich({
        apiBaseUrl: apiBaseUrl.trim(),
        commandId: `onboarding.connect.${crypto.randomUUID()}`,
        credential,
      });
      credential = '';
      notice = 'Immich is connected. The credential was stored privately and is not returned to this page.';
      await loadStatus();
    } catch (error_) {
      credential = '';
      error = messageFor(error_, 'Cimmich could not connect to Immich.');
    } finally {
      busy = '';
    }
  };

  const toggleMediaKind = (kind: 'image' | 'video') => {
    const has = scope.mediaKinds.includes(kind);
    if (has && scope.mediaKinds.length === 1) {
      return;
    }
    scope = {
      ...scope,
      mediaKinds: has ? scope.mediaKinds.filter((item) => item !== kind) : [...scope.mediaKinds, kind],
    };
    preview = undefined;
  };

  const toggleVisibility = (visibility: 'archive' | 'hidden' | 'timeline') => {
    const has = scope.visibilities.includes(visibility);
    if (visibility === 'timeline' && has && scope.visibilities.length === 1) {
      return;
    }
    scope = {
      ...scope,
      visibilities: has
        ? scope.visibilities.filter((item) => item !== visibility)
        : [...scope.visibilities, visibility],
    };
    preview = undefined;
  };

  const runPreview = async () => {
    if (busy) {
      return;
    }
    busy = 'preview';
    error = '';
    notice = '';
    result = undefined;
    try {
      const currentPreview = await previewCimmichImmichOnboarding(scope);
      preview = currentPreview;
      scope = copyScope(currentPreview.scope);
      personResolutionReady = !scope.importPeople || currentPreview.counts.unlabelledPeople === 0;
      notice = 'Preview is current. Nothing has been imported yet.';
    } catch (error_) {
      preview = undefined;
      error = messageFor(error_, 'Cimmich could not preview this Immich scope.');
    } finally {
      busy = '';
    }
  };

  const runImport = async (resume = false) => {
    if (busy) {
      return;
    }
    busy = 'import';
    error = '';
    notice = '';
    try {
      let activePreview = preview;
      let commandId = `onboarding.import.${crypto.randomUUID()}`;
      if (resume && status?.latestRun) {
        scope = copyScope(status.latestRun.scope);
        activePreview = await previewCimmichImmichOnboarding(scope);
        if (activePreview.previewDigest !== status.latestRun.previewDigest) {
          throw new CimmichServiceError(
            'Immich changed since this import began. Review a new preview before continuing.',
            {
              code: 'IMMICH_ONBOARDING_PREVIEW_STALE',
              status: 409,
            },
          );
        }
        commandId = status.latestRun.commandId;
        preview = activePreview;
      }
      if (!activePreview) {
        return;
      }
      result = await importCimmichImmichOnboarding({
        commandId,
        previewDigest: activePreview.previewDigest,
        scope,
      });
      notice = result.replayed
        ? 'This import was already complete. Cimmich returned the original result without duplicate People or Faces.'
        : result.state === 'no_change'
          ? 'Everything in this exact preview was already current. No People, Faces or assets were duplicated.'
          : 'Import complete. Accepted source labels are presentable now; matching remains separately governed.';
      await loadStatus();
    } catch (error_) {
      const importError = messageFor(error_, 'Cimmich could not complete this import.');
      await loadStatus();
      error = importError;
    } finally {
      busy = '';
    }
  };

  onMount(loadStatus);
</script>

<section
  aria-labelledby="cimmich-first-run-title"
  class="rounded-[1.75rem] border border-gray-200 bg-white p-6 dark:border-immich-dark-gray dark:bg-immich-dark-bg"
>
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div class="flex min-w-0 items-start gap-3">
      <span
        class="grid size-11 shrink-0 place-items-center rounded-2xl bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200"
      >
        <Icon icon={mdiDatabaseImportOutline} size="23" />
      </span>
      <div>
        <p class="text-xs font-semibold tracking-[0.14em] text-indigo-700 uppercase dark:text-indigo-300">First run</p>
        <h2 id="cimmich-first-run-title" class="mt-1 text-xl font-semibold">Connect your existing Immich library</h2>
        <p class="mt-1 max-w-3xl text-sm/6 text-gray-600 dark:text-gray-300">
          Preview first, choose what Cimmich may admit, then import current Immich names as source-proven human truth.
          Core remains useful if you do this later. Cimmich never writes to the Immich database or source files.
        </p>
      </div>
    </div>
    <span
      class={`rounded-full px-3 py-1 text-xs font-semibold ${
        completed
          ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100'
          : connectionReady
            ? 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-100'
            : 'bg-gray-100 dark:bg-immich-dark-gray'
      }`}
    >
      {loading ? 'Checking' : completed ? 'Imported' : connectionReady ? 'Connected' : 'Not connected'}
    </span>
  </div>

  {#if error}
    <div role="alert" class="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm/6 text-red-900">
      {error}
    </div>
  {/if}
  {#if notice}
    <div class="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm/6 text-emerald-950">
      {notice}
    </div>
  {/if}

  {#if !loading && !connectionReady}
    <form
      class="mt-6 grid gap-4 md:grid-cols-2"
      onsubmit={(event) => {
        event.preventDefault();
        void connect();
      }}
    >
      <label class="grid gap-1.5 text-sm font-semibold">
        Immich server
        <input
          class="min-h-11 rounded-xl border border-gray-300 bg-transparent px-3 font-normal dark:border-gray-600"
          autocomplete="url"
          inputmode="url"
          placeholder="http://immich.example:2283"
          required
          bind:value={apiBaseUrl}
        />
      </label>
      <label class="grid gap-1.5 text-sm font-semibold">
        Read-only API key
        <input
          class="min-h-11 rounded-xl border border-gray-300 bg-transparent px-3 font-normal dark:border-gray-600"
          autocomplete="off"
          placeholder="Paste once"
          required
          type="password"
          bind:value={credential}
        />
      </label>
      <p class="text-xs/5 text-gray-500 md:col-span-2 dark:text-gray-400">
        Required permissions: asset read/download, Face read, Person read and current-user read. The key is write-only,
        never returned, and must not grant asset upload or mutation.
      </p>
      <div class="md:col-span-2">
        <button
          type="submit"
          class="inline-flex min-h-11 items-center gap-2 rounded-full bg-immich-primary px-5 text-sm font-semibold text-white disabled:opacity-50 dark:bg-immich-dark-primary dark:text-black"
          disabled={busy === 'connect'}
        >
          <Icon icon={mdiRefresh} size="18" class={busy === 'connect' ? 'animate-spin' : ''} />
          {busy === 'connect' ? 'Verifying…' : 'Verify and connect'}
        </button>
      </div>
    </form>
  {:else if connectionReady && status}
    <dl class="mt-6 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <div class="rounded-2xl bg-gray-50 p-4 dark:bg-immich-dark-gray/40">
        <dt class="text-xs text-gray-500 dark:text-gray-400">Immich version</dt>
        <dd class="mt-1 font-semibold">{status.connection.immichVersion}</dd>
      </div>
      <div class="rounded-2xl bg-gray-50 p-4 dark:bg-immich-dark-gray/40">
        <dt class="text-xs text-gray-500 dark:text-gray-400">Principal</dt>
        <dd class="mt-1 truncate font-mono text-xs">{status.connection.principal?.userId}</dd>
      </div>
      <div class="rounded-2xl bg-gray-50 p-4 dark:bg-immich-dark-gray/40">
        <dt class="text-xs text-gray-500 dark:text-gray-400">Permissions</dt>
        <dd class="mt-1 font-semibold">Assets · Faces · People · media read</dd>
      </div>
      <div class="rounded-2xl bg-gray-50 p-4 dark:bg-immich-dark-gray/40">
        <dt class="text-xs text-gray-500 dark:text-gray-400">Locked library</dt>
        <dd class="mt-1 font-semibold">Excluded</dd>
        <dd class="mt-1 text-xs text-gray-500 dark:text-gray-400">Requires an interactive elevated Immich session.</dd>
      </div>
    </dl>

    <div
      class="mt-5 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm/6 text-sky-950 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100"
    >
      <p class="font-semibold">
        Your {existingCimmichPeopleCount.toLocaleString()} existing Cimmich
        {existingCimmichPeopleCount === 1 ? 'Person is' : 'People are'} preserved.
      </p>
      <p class="mt-1">
        This optional preview reads separate upstream Immich face groups. Its labelled and unnamed counts do not
        describe, replace or remove the People already in Cimmich.
      </p>
    </div>

    {#if interrupted}
      <div class="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm/6 text-amber-950">
        <p class="font-semibold">An import can be resumed safely.</p>
        <p class="mt-1">
          {processedAssets.toLocaleString()} assets were processed before the run stopped. Cimmich will re-check the principal,
          scope and current preview before continuing.
        </p>
        <button
          type="button"
          class="mt-3 inline-flex min-h-10 items-center gap-2 rounded-full bg-amber-950 px-4 font-semibold text-white disabled:opacity-50"
          disabled={busy === 'import'}
          onclick={() => void runImport(true)}
        >
          <Icon icon={mdiRefresh} size="17" class={busy === 'import' ? 'animate-spin' : ''} /> Resume import
        </button>
      </div>
    {/if}

    <fieldset class="mt-6">
      <legend class="text-base font-semibold">Choose what to admit</legend>
      <p class="mt-1 text-sm/6 text-gray-600 dark:text-gray-300">The ordinary timeline is the recommended default.</p>
      <div class="mt-4 grid gap-4 md:grid-cols-3">
        <div class="rounded-2xl border border-gray-200 p-4 dark:border-immich-dark-gray">
          <p class="text-sm font-semibold">Media</p>
          {#each ['image', 'video'] as kind (kind)}
            <label class="mt-3 flex min-h-10 items-center gap-3 text-sm capitalize">
              <input
                type="checkbox"
                checked={scope.mediaKinds.includes(kind as 'image' | 'video')}
                onchange={() => toggleMediaKind(kind as 'image' | 'video')}
              />
              {kind === 'image' ? 'Photos' : 'Videos'}
            </label>
          {/each}
        </div>
        <div class="rounded-2xl border border-gray-200 p-4 dark:border-immich-dark-gray">
          <p class="text-sm font-semibold">Visibility lanes</p>
          {#each ['timeline', 'archive', 'hidden'] as lane (lane)}
            <label class="mt-3 flex min-h-10 items-center gap-3 text-sm capitalize">
              <input
                type="checkbox"
                checked={scope.visibilities.includes(lane as 'archive' | 'hidden' | 'timeline')}
                onchange={() => toggleVisibility(lane as 'archive' | 'hidden' | 'timeline')}
              />
              {lane}
            </label>
          {/each}
          <p class="mt-3 text-xs/5 text-gray-500 dark:text-gray-400">Locked is not available to background setup.</p>
        </div>
        <div class="rounded-2xl border border-gray-200 p-4 dark:border-immich-dark-gray">
          <p class="text-sm font-semibold">Identity and analysis</p>
          <label class="mt-3 flex min-h-10 items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={scope.importPeople}
              onchange={() => {
                scope = { ...scope, importPeople: !scope.importPeople };
                preview = undefined;
              }}
            />
            Import People and Face labels
          </label>
          <label class="mt-3 grid gap-1.5 text-sm">
            Local provider
            <select
              class="min-h-10 rounded-xl border border-gray-300 bg-transparent px-3 dark:border-gray-600"
              value={scope.providerMode}
              onchange={(event) => {
                scope = { ...scope, providerMode: event.currentTarget.value as 'configured' | 'deferred' };
                preview = undefined;
              }}
            >
              <option value="deferred">Set up later</option>
              <option value="configured">Already configured</option>
            </select>
          </label>
        </div>
      </div>
    </fieldset>

    <div class="mt-5 flex flex-wrap gap-3">
      <button
        type="button"
        class="inline-flex min-h-11 items-center gap-2 rounded-full bg-immich-primary px-5 text-sm font-semibold text-white disabled:opacity-50 dark:bg-immich-dark-primary dark:text-black"
        disabled={Boolean(busy)}
        onclick={() => void runPreview()}
      >
        <Icon icon={mdiRefresh} size="18" class={busy === 'preview' ? 'animate-spin' : ''} />
        {busy === 'preview' ? 'Reading…' : 'Preview this scope'}
      </button>
      <a
        class="inline-flex min-h-11 items-center rounded-full border border-gray-300 px-5 text-sm font-semibold hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-immich-dark-gray"
        href={Route.cimmichHome()}
      >
        Not now — continue using Cimmich
      </a>
      <span class="self-center text-xs/5 text-gray-500 dark:text-gray-400">Nothing changes until you import.</span>
    </div>

    {#if preview}
      <div
        class="mt-6 rounded-3xl border border-indigo-200 bg-indigo-50/70 p-5 dark:border-indigo-900 dark:bg-indigo-950/20"
      >
        <div class="flex items-start gap-3">
          <Icon icon={mdiCheckCircleOutline} size="22" class="mt-0.5 shrink-0 text-indigo-700 dark:text-indigo-300" />
          <div>
            <h3 class="font-semibold">Current preview</h3>
            <p class="mt-1 text-sm/6 text-gray-700 dark:text-gray-200">
              {preview.counts.assets} supported media · {preview.counts.images} photos · {preview.counts.videos} videos ·
              {preview.counts.labelledPeople} labelled Immich People · {preview.counts.unlabelledPeople} unnamed Immich face
              groups · {preview.counts.assignedFaces} Faces assigned upstream · {preview.counts.unassignedFaces}
              unassigned upstream Faces
            </p>
            <dl class="mt-3 flex flex-wrap gap-2 text-xs">
              {#each ['timeline', 'archive', 'hidden', 'locked'] as lane (lane)}
                <div class="rounded-full bg-white/80 px-3 py-1.5 dark:bg-immich-dark-bg/80">
                  <dt class="inline font-semibold capitalize">{lane}</dt>
                  <dd class="ml-1 inline tabular-nums">
                    {#if lane === 'locked'}
                      Excluded
                    {:else if preview.coverage.visibilityLanes[lane as 'archive' | 'hidden' | 'timeline']}
                      {preview.counts.visibilityLanes[lane as 'archive' | 'hidden' | 'timeline']?.toLocaleString() ?? 0}
                    {:else}
                      Not included
                    {/if}
                  </dd>
                </div>
              {/each}
            </dl>
            <p class="mt-2 text-xs/5 text-gray-500 dark:text-gray-400">
              Albums, generic tags and EXIF are not imported by this contract. Locked remains excluded. Existing source
              labels become presentable human/source truth, never automatic matching authority.
            </p>
          </div>
        </div>
        <button
          type="button"
          class="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-indigo-950 px-5 text-sm font-semibold text-white disabled:opacity-50 dark:bg-indigo-100 dark:text-indigo-950"
          disabled={Boolean(busy) || !personResolutionReady}
          onclick={() => void runImport()}
        >
          <Icon icon={mdiDatabaseImportOutline} size="18" />
          {busy === 'import' ? 'Importing…' : 'Import this preview'}
        </button>
        {#if !personResolutionReady}
          <p class="mt-2 text-sm/6 font-medium text-indigo-950 dark:text-indigo-100">
            Import stays safely unavailable until every upstream face group below is explicitly resolved. You can leave
            this setup now and continue using your existing Cimmich People.
          </p>
        {/if}
        {#if preview.counts.unlabelledPeople > 0 && scope.importPeople}
          <CimmichImmichPersonResolution
            {scope}
            onreadiness={(ready) => {
              personResolutionReady = ready;
            }}
          />
        {/if}
      </div>
    {/if}

    {#if result}
      <div
        class="mt-6 rounded-3xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900 dark:bg-emerald-950/20"
      >
        <h3 class="font-semibold">Setup summary</h3>
        <p class="mt-2 text-sm/6">
          {result.state === 'no_change'
            ? 'No changes were needed'
            : `${(result.inventory?.activeAssets ?? 0).toLocaleString()} assets admitted`}
          · {(result.import.projectedPeople ?? 0).toLocaleString()} People ·
          {result.import.assignedFaces.toLocaleString()} assigned Faces ·
          {(result.import.reviewItems ?? 0).toLocaleString()} items need review.
        </p>
        {#if (result.import.personConflicts ?? 0) > 0 || (result.import.ambiguous ?? 0) > 0}
          <p class="mt-2 text-sm/6 text-amber-900 dark:text-amber-200">
            {(result.import.personConflicts ?? 0).toLocaleString()} name conflicts ·
            {(result.import.ambiguous ?? 0).toLocaleString()} ambiguous Face links were held for review rather than guessed.
          </p>
        {/if}
        <p class="mt-2 text-xs/5 text-gray-600 dark:text-gray-300">
          Next: {result.next.action === 'resume_provider_analysis'
            ? 'Analyse current library evidence.'
            : 'Choose a local provider later, or continue with Core now.'}
          No reference library was activated and automatic identity remains off.
        </p>
      </div>
    {/if}
  {/if}
</section>
