<script lang="ts">
  import { Route } from '$lib/route';
  import type {
    CimmichArchiveBackupScan,
    CimmichArchiveBackupScanItem,
    CimmichArchiveBackupTarget,
    CimmichArchiveBackupProofItem,
    CimmichArchiveBackupProofPage,
  } from '$lib/services/cimmich-archive-integrity.service';
  import {
    getCimmichArchiveBackupScan,
    getCimmichArchiveBackupTargets,
    startCimmichArchiveBackupScan,
  } from '$lib/services/cimmich-archive-integrity.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import {
    mdiArrowRight,
    mdiCheckDecagramOutline,
    mdiFileAlertOutline,
    mdiFolderAlertOutline,
    mdiHarddisk,
    mdiPlay,
    mdiShieldAlertOutline,
    mdiShieldCheckOutline,
  } from '@mdi/js';
  import { onMount } from 'svelte';
  import type { ArchiveVariantGroup } from './archive-variant-groups';

  interface Props {
    error: string;
    exactGroupCount: number;
    groups: ArchiveVariantGroup[];
    items: Map<string, CimmichArchiveBackupProofItem>;
    loaded: boolean;
    loading: boolean;
    summary: CimmichArchiveBackupProofPage['summary'];
  }

  let { error, exactGroupCount, groups, items, loaded, loading, summary }: Props = $props();
  let visibleCount = $state(12);
  let scan = $state<CimmichArchiveBackupScan | null>(null);
  let scanError = $state('');
  let scanFilter = $state<'all' | CimmichArchiveBackupScanItem['kind']>('all');
  let scanLoading = $state(false);
  let selectedTargetId = $state('');
  let targets = $state<CimmichArchiveBackupTarget[]>([]);
  let targetsLoaded = $state(false);
  let candidates = $derived(groups.filter((group) => group.canonicalPlan.status === 'candidate'));
  let visibleCandidates = $derived(candidates.slice(0, visibleCount));

  const formatBytes = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) {
      return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const power = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    const amount = value / 1024 ** power;
    return `${amount >= 10 || power === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[power]}`;
  };
  const thumbnail = (sourceAssetId: string) => getAssetMediaUrl({ id: sourceAssetId, size: AssetMediaSize.Thumbnail });
  const changeLabel = (change: CimmichArchiveBackupScanItem['changes'][number]) =>
    change === 'size'
      ? 'Size changed'
      : change === 'modified_time'
        ? 'Modified time changed'
        : change === 'filename_ambiguous'
          ? 'Filename is ambiguous'
          : 'Content or embedded metadata changed';
  const loadTargets = async () => {
    try {
      const page = await getCimmichArchiveBackupTargets();
      targets = page.items;
      selectedTargetId = page.items.find((target) => target.available)?.id ?? page.items[0]?.id ?? '';
    } catch (error_) {
      scanError = error_ instanceof Error ? error_.message : 'Cimmich could not read backup destinations.';
    } finally {
      targetsLoaded = true;
    }
  };
  const refreshScan = async () => {
    if (!scan) {
      return;
    }
    scan = await getCimmichArchiveBackupScan(scan.id, { kind: scanFilter, limit: 100 });
  };
  const loadMoreScanItems = async () => {
    if (!scan || scan.nextOffset === null || scan.nextOffset === undefined) {
      return;
    }
    const current = scan;
    const page = await getCimmichArchiveBackupScan(scan.id, {
      kind: scanFilter,
      limit: 100,
      offset: scan.nextOffset,
    });
    scan = { ...page, items: [...current.items, ...page.items] };
  };
  const startScan = async () => {
    if (!selectedTargetId) {
      return;
    }
    scanLoading = true;
    scanError = '';
    scanFilter = 'all';
    try {
      scan = await startCimmichArchiveBackupScan(selectedTargetId);
    } catch (error_) {
      scanError = error_ instanceof Error ? error_.message : 'Cimmich could not start the backup scan.';
    } finally {
      scanLoading = false;
    }
  };

  onMount(() => {
    void loadTargets();
    const poll = globalThis.setInterval(() => {
      if (scan?.status === 'queued' || scan?.status === 'scanning') {
        void refreshScan().catch((error_) => {
          scanError = error_ instanceof Error ? error_.message : 'Cimmich could not refresh the backup scan.';
        });
      }
    }, 2000);
    return () => globalThis.clearInterval(poll);
  });
</script>

<section class="space-y-4" aria-labelledby="backup-proof-title">
  {#if scanError}
    <div
      class="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
    >
      {scanError}
    </div>
  {/if}

  <article class="rounded-3xl border border-gray-200 bg-white p-4 dark:border-immich-dark-gray dark:bg-immich-dark-bg">
    <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 id="backup-proof-title" class="text-xl font-semibold">Compare an independent backup</h2>
        <p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
          Read-only check using complete-file SHA-256 and byte length.
        </p>
      </div>
      <span
        class="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"
        title="Cimmich reads the backup but does not modify it"
      >
        Nothing is changed
      </span>
    </div>
    {#if !targetsLoaded}
      <p class="text-sm font-semibold">Reading backup destinations…</p>
    {:else if targets.length === 0}
      <div class="flex items-start gap-4">
        <span
          class="grid size-11 shrink-0 place-items-center rounded-2xl bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
          ><Icon icon={mdiHarddisk} size="23" /></span
        >
        <div>
          <h3 class="font-semibold">No independent backup connected</h3>
          <p class="mt-1 max-w-3xl text-sm/6 text-gray-600 dark:text-gray-300">
            Connect a read-only backup on a different physical storage device to compare it with this archive.
          </p>
          <details class="mt-3 text-sm text-gray-600 dark:text-gray-300">
            <summary class="cursor-pointer font-semibold text-primary">What counts as an independent backup?</summary>
            <ul class="mt-2 space-y-1.5 text-sm/6">
              <li>It is mounted read-only for Cimmich.</li>
              <li>It lives on a different physical storage device.</li>
              <li>A different folder or partition on the archive disk does not count.</li>
              <li>The scan compares complete-file SHA-256 and byte length.</li>
            </ul>
          </details>
        </div>
      </div>
    {:else}
      <div class="flex flex-wrap items-end justify-between gap-4">
        <label class="min-w-64 flex-1 text-sm font-semibold">
          Destination
          <select
            class="mt-2 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 font-normal dark:border-gray-600 dark:bg-gray-900"
            bind:value={selectedTargetId}
          >
            {#each targets as target (target.id)}
              <option value={target.id} disabled={!target.available}
                >{target.label}{target.available ? '' : ' (unavailable)'}</option
              >
            {/each}
          </select>
        </label>
        <button
          type="button"
          class="inline-flex min-h-11 items-center gap-2 rounded-full bg-violet-700 px-5 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-50"
          disabled={!selectedTargetId || scanLoading || scan?.status === 'queued' || scan?.status === 'scanning'}
          onclick={() => void startScan()}
        >
          <Icon icon={mdiPlay} size="18" />
          {scanLoading ? 'Starting…' : 'Run scan'}
        </button>
      </div>
    {/if}
  </article>

  {#if targetsLoaded && targets.length > 0}
    {#if scan}
      <article
        class="overflow-hidden rounded-3xl border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
      >
        <header
          class="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-immich-dark-gray"
        >
          <div>
            <h3 class="font-semibold">{scan.target.label}</h3>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Started {new Date(scan.startedAt).toLocaleString()}
            </p>
          </div>
          <span class="rounded-full bg-gray-100 px-3 py-1.5 text-xs font-semibold dark:bg-gray-800"
            >{scan.status === 'complete'
              ? 'Complete'
              : scan.status === 'failed'
                ? 'Failed'
                : `${scan.progress.phase}…`}</span
          >
        </header>
        {#if scan.status === 'queued' || scan.status === 'scanning'}
          <div class="p-5">
            <p class="text-sm font-semibold">
              {scan.progress.filesHashed.toLocaleString()} of {scan.progress.filesDiscovered.toLocaleString()} discovered
              files hashed
            </p>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {formatBytes(scan.progress.bytesHashed)} read from the backup; originals are untouched.
            </p>
            {#if scan.progress.filesDiscovered > 0}<progress
                class="mt-4 h-2 w-full accent-violet-600"
                max={scan.progress.filesDiscovered}
                value={scan.progress.filesHashed}
              ></progress>{/if}
          </div>
        {:else if scan.status === 'failed'}
          <p class="p-5 text-sm text-red-700 dark:text-red-300">{scan.error}</p>
        {:else if scan.summary}
          <div class="grid gap-px bg-gray-100 sm:grid-cols-2 xl:grid-cols-4 dark:bg-immich-dark-gray">
            {#each [[mdiCheckDecagramOutline, scan.summary.exactItems, 'Exact matches', 'Complete bytes match'], [mdiFileAlertOutline, scan.summary.changedFiles, 'Changed files', 'Same filename; bytes differ'], [mdiFolderAlertOutline, scan.summary.archiveOnlyItems, 'Archive only', 'No matching backup file'], [mdiHarddisk, scan.summary.backupOnlyFiles, 'Backup only', 'No archive filename or bytes']] as metric (metric[2])}
              <div class="bg-white p-5 dark:bg-immich-dark-bg">
                <Icon icon={metric[0] as string} size="21" class="text-violet-600" />
                <p class="mt-3 text-2xl font-semibold">{Number(metric[1]).toLocaleString()}</p>
                <p class="text-sm font-semibold">{metric[2]}</p>
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{metric[3]}</p>
              </div>
            {/each}
          </div>
          <div class="border-t border-gray-100 p-4 dark:border-immich-dark-gray">
            <div class="flex flex-wrap gap-1 rounded-full bg-gray-100 p-1 dark:bg-gray-900">
              {#each [['all', 'All'], ['changed', 'Changed'], ['archive_only', 'Archive only'], ['backup_only', 'Backup only'], ['exact', 'Exact']] as option (option[0])}
                <button
                  type="button"
                  class="min-h-9 rounded-full px-3 text-xs font-semibold {scanFilter === option[0]
                    ? 'bg-white shadow-sm dark:bg-gray-700'
                    : 'text-gray-500 dark:text-gray-400'}"
                  onclick={() => {
                    scanFilter = option[0] as typeof scanFilter;
                    void refreshScan();
                  }}>{option[1]}</button
                >
              {/each}
            </div>
            <div class="mt-4 divide-y divide-gray-100 dark:divide-immich-dark-gray">
              {#each scan.items as item, index (`${item.kind}:${item.backup?.relativePath ?? item.archive?.contentDigest}:${index}`)}
                <div class="grid gap-2 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div class="min-w-0">
                    <p class="truncate font-semibold" title={item.backup?.relativePath ?? item.archive?.filenames[0]}>
                      {item.backup?.relativePath ?? item.archive?.filenames[0] ?? 'Unknown file'}
                    </p>
                    <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {item.kind === 'exact'
                        ? 'Exact complete-file bytes'
                        : item.kind === 'archive_only'
                          ? 'Archive content has no exact destination match'
                          : item.kind === 'backup_only'
                            ? 'Destination file is not present in archive evidence'
                            : item.changes.map((change) => changeLabel(change)).join(' · ')}
                    </p>
                  </div>
                  <p class="text-xs font-semibold text-gray-500 dark:text-gray-400">
                    {formatBytes(item.backup?.byteLength ?? item.archive?.byteLength ?? 0)}
                  </p>
                </div>
              {/each}
            </div>
            {#if scan.nextOffset !== null && scan.nextOffset !== undefined}
              <div class="flex justify-center pt-4">
                <button
                  type="button"
                  class="min-h-10 rounded-full border border-gray-300 px-4 text-sm font-semibold hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
                  onclick={() => void loadMoreScanItems()}>Show 100 more results</button
                >
              </div>
            {/if}
          </div>
        {/if}
      </article>
    {/if}

    <div class="flex flex-wrap items-end justify-between gap-4 px-1 pt-3">
      <div>
        <p class="text-xs font-semibold tracking-[0.14em] text-rose-700 uppercase dark:text-rose-300">
          Retirement safety gate
        </p>
        <h2 class="mt-1 text-xl font-semibold">Independent backup proof</h2>
      </div>
      <p class="text-sm text-gray-500 dark:text-gray-400">No file is retirement-ready</p>
    </div>

    {#if error}
      <div
        class="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
      >
        {error}
      </div>
    {/if}

    <article
      class="overflow-hidden rounded-3xl border border-rose-200 bg-white dark:border-rose-950 dark:bg-immich-dark-bg"
    >
      <div class="grid gap-5 p-5 lg:grid-cols-[auto_1fr_auto] lg:items-center">
        <span
          class="grid size-12 place-items-center rounded-2xl bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200"
        >
          <Icon icon={mdiShieldAlertOutline} size="25" />
        </span>
        <div>
          <h3 class="font-semibold">Independent destination evidence is required</h3>
          <p class="mt-1 max-w-3xl text-sm/6 text-gray-600 dark:text-gray-300">
            Cimmich has byte authority for {summary.byteVerifiedItems.toLocaleString()} media objects, but their active copies
            resolve through {summary.sourceSystemCount.toLocaleString()}
            {summary.sourceSystemCount === 1 ? 'source system' : 'source systems'} on the same storage domain. Duplicate paths
            and Immich records protect against neither disk failure nor archive loss.
          </p>
        </div>
        <div class="rounded-2xl bg-rose-50 px-4 py-3 text-left lg:text-right dark:bg-rose-950/30">
          <p class="text-2xl font-semibold text-rose-800 dark:text-rose-200">0</p>
          <p class="text-xs font-semibold tracking-wide text-rose-700 uppercase dark:text-rose-300">Retirement-ready</p>
        </div>
      </div>
      <footer
        class="border-t border-rose-100 bg-rose-50/60 px-5 py-3 text-xs/5 text-rose-900 dark:border-rose-950 dark:bg-rose-950/20 dark:text-rose-200"
      >
        {exactGroupCount.toLocaleString()} exact-copy groups and {candidates.length.toLocaleString()} preferred canonical
        candidates remain blocked until matching bytes are verified on a distinct failure domain.
      </footer>
    </article>

    <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4" aria-label="Independent backup requirements">
      {#each [['Exact bytes', 'The destination must independently reproduce the complete-file SHA-256 and byte length.'], ['Distinct failure domain', 'A different folder, Immich UUID or partition on the same physical disk does not count.'], ['Fresh observation', 'Proof must come from a bounded verifier run, not a remembered copy or filename match.'], ['Sidecars travel too', 'Future retirement also requires the owner-approved sidecar set to verify beside the media.']] as requirement (requirement[0])}
        <div
          class="rounded-2xl border border-gray-200 bg-white p-4 dark:border-immich-dark-gray dark:bg-immich-dark-bg"
        >
          <Icon
            icon={requirement[0] === 'Exact bytes' ? mdiShieldCheckOutline : mdiHarddisk}
            size="20"
            class="text-emerald-600"
          />
          <h3 class="mt-3 text-sm font-semibold">{requirement[0]}</h3>
          <p class="mt-1 text-sm/6 text-gray-600 dark:text-gray-300">{requirement[1]}</p>
        </div>
      {/each}
    </div>

    <div class="flex flex-wrap items-end justify-between gap-3 px-1 pt-2">
      <div>
        <p class="text-xs font-semibold tracking-[0.14em] text-amber-700 uppercase dark:text-amber-300">
          Canonical candidates
        </p>
        <h3 class="mt-1 text-xl font-semibold">Awaiting independent proof</h3>
      </div>
      <p class="text-sm text-gray-500 dark:text-gray-400">
        {candidates.length.toLocaleString()} candidates · {formatBytes(summary.byteVerifiedBytes)} archive scope
      </p>
    </div>

    {#if loading && !loaded}
      <div
        class="grid min-h-48 place-items-center rounded-3xl border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
      >
        <div class="text-center">
          <Icon icon={mdiHarddisk} size="34" class="mx-auto animate-pulse text-rose-500" />
          <p class="mt-3 text-sm font-semibold">Checking independent storage evidence…</p>
        </div>
      </div>
    {:else}
      <div class="grid gap-4 lg:grid-cols-2">
        {#each visibleCandidates as group (group.duplicateId)}
          {@const preferred = group.assets.find((asset) => asset.id === group.canonicalPlan.preferredAssetId)}
          {@const proof = preferred ? items.get(preferred.id) : undefined}
          {#if preferred}
            <article
              class="grid overflow-hidden rounded-3xl border border-gray-200 bg-white sm:grid-cols-[10rem_1fr] dark:border-immich-dark-gray dark:bg-immich-dark-bg"
            >
              <a
                class="relative block min-h-40 bg-gray-100 dark:bg-gray-900"
                href={Route.viewAsset({ id: preferred.id })}
              >
                <img class="size-full object-cover" src={thumbnail(preferred.id)} alt="" loading="lazy" />
                <span
                  class="absolute top-3 left-3 rounded-full bg-black/70 px-2.5 py-1 text-xs font-semibold text-white"
                >
                  Not proven
                </span>
              </a>
              <div class="space-y-3 p-4">
                <div>
                  <p class="truncate text-sm font-semibold" title={preferred.originalFileName}>
                    {preferred.originalFileName}
                  </p>
                  <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {formatBytes(proof?.byteLength ?? preferred.exifInfo?.fileSizeInByte ?? 0)} ·
                    {proof ? `SHA-256 ${proof.contentDigest.slice(0, 12)}…` : 'Byte proof unavailable'}
                  </p>
                </div>
                <p class="text-xs/5 text-gray-600 dark:text-gray-300">
                  {proof
                    ? `${proof.sourceSystemCount} ${proof.sourceSystemCount === 1 ? 'source system' : 'source systems'}; 0 verified independent destinations.`
                    : 'Waiting for the archive evidence read.'}
                </p>
                <a
                  class="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-primary hover:underline"
                  href={Route.viewAsset({ id: preferred.id })}
                >
                  Inspect candidate <Icon icon={mdiArrowRight} size="17" />
                </a>
              </div>
            </article>
          {/if}
        {/each}
      </div>
    {/if}

    {#if visibleCount < candidates.length}
      <div class="flex justify-center">
        <button
          type="button"
          class="min-h-11 rounded-full border border-gray-300 px-5 text-sm font-semibold hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
          onclick={() => (visibleCount += 12)}
        >
          Show 12 more candidates
        </button>
      </div>
    {/if}
  {/if}
</section>
