<script lang="ts">
  import CimmichFileLocationActions from '$lib/components/cimmich/CimmichFileLocationActions.svelte';
  import { Route } from '$lib/route';
  import {
    getCimmichArchiveMissingFiles,
    getCimmichArchiveMissingFileScan,
    removeAllCimmichArchiveTrashedFiles,
    removeCimmichArchiveMissingFiles,
    startCimmichArchiveMissingFileScan,
    type CimmichArchiveMissingFile,
    type CimmichArchiveMissingFileScan,
    type CimmichArchiveMissingFilesPage,
  } from '$lib/services/cimmich-archive-integrity.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { createCimmichUuid } from '$lib/utils/cimmich-uuid';
  import { getParentPath } from '$lib/utils/tree-utils';
  import { AssetMediaSize, getAssetInfo } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import {
    mdiAlertOutline,
    mdiArrowRight,
    mdiDatabaseSearchOutline,
    mdiDeleteOutline,
    mdiImageOffOutline,
    mdiRefresh,
  } from '@mdi/js';
  import { onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';

  interface Props {
    refreshRevision?: number;
  }

  let { refreshRevision = 0 }: Props = $props();
  let observedRefreshRevision = $state(refreshRevision);
  let items = $state<CimmichArchiveMissingFile[]>([]);
  let summary = $state<CimmichArchiveMissingFilesPage['summary']>({
    missing: 0,
    total: 0,
    trashed: 0,
  });
  let nextOffset = $state<number | null>(null);
  let scan = $state<CimmichArchiveMissingFileScan>();
  let selected = $state<string[]>([]);
  let confirming = $state(false);
  let confirmingAllTrashed = $state(false);
  let loading = $state(true);
  let loadingMore = $state(false);
  let removing = $state(false);
  let removingAllTrashed = $state(false);
  let error = $state('');
  let notice = $state('');
  let assetLocations = $state<Map<string, { originalFileName: string; originalPath: string } | null>>(new Map());
  let failedPreviews = $state<string[]>([]);
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  const assetLocationRequests = new SvelteSet<string>();

  const itemKey = (item: Pick<CimmichArchiveMissingFile, 'sourceAssetId' | 'sourceId'>) =>
    `${item.sourceId}:${item.sourceAssetId}`;
  const selectedCount = $derived(selected.length);
  const scanRunning = $derived(scan?.state === 'running');
  const selectedSourceId = $derived(items.find((item) => selected.includes(itemKey(item)))?.sourceId ?? '');
  const selectableSourceId = $derived(selectedSourceId || items[0]?.sourceId || '');
  const selectableItems = $derived(items.filter((item) => item.sourceId === selectableSourceId));
  const trashedSourceId = $derived(items.find((item) => item.state === 'trashed')?.sourceId ?? '');
  const allVisibleSelected = $derived(
    selectableItems.length > 0 && selectableItems.every((item) => selected.includes(itemKey(item))),
  );
  const date = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
      : 'Unknown';
  const friendlyError = (error_: unknown, fallback: string) =>
    (error_ instanceof Error ? error_.message : '').replace(/\s*\([^)]*\)\s*$/, '').trim() || fallback;
  const viewerHref = (item: CimmichArchiveMissingFile) =>
    item.state === 'trashed'
      ? Route.viewTrashedAsset({ id: item.sourceAssetId })
      : Route.viewAsset({ id: item.sourceAssetId });
  const thumbnail = (sourceAssetId: string) => getAssetMediaUrl({ id: sourceAssetId, size: AssetMediaSize.Thumbnail });
  const failPreview = (sourceAssetId: string) => {
    if (!failedPreviews.includes(sourceAssetId)) {
      failedPreviews = [...failedPreviews, sourceAssetId];
    }
  };
  const loadAssetLocations = async (nextItems: CimmichArchiveMissingFile[]) => {
    const pending = nextItems
      .map((item) => item.sourceAssetId)
      .filter((sourceAssetId) => !assetLocations.has(sourceAssetId) && !assetLocationRequests.has(sourceAssetId));
    for (const sourceAssetId of pending) {
      assetLocationRequests.add(sourceAssetId);
    }
    let cursor = 0;
    const updates: Array<[string, { originalFileName: string; originalPath: string } | null]> = [];
    const worker = async () => {
      while (cursor < pending.length) {
        const sourceAssetId = pending[cursor++];
        if (!sourceAssetId) {
          continue;
        }
        const asset = await getAssetInfo({ id: sourceAssetId }).catch(() => null);
        updates.push([
          sourceAssetId,
          asset?.originalPath
            ? {
                originalFileName: asset.originalFileName || asset.originalPath.split('/').at(-1) || '',
                originalPath: asset.originalPath,
              }
            : null,
        ]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, pending.length) }, () => worker()));
    if (updates.length > 0) {
      assetLocations = new Map([...assetLocations, ...updates]);
    }
  };

  const load = async ({ append = false } = {}) => {
    if (append) {
      loadingMore = true;
    } else {
      loading = true;
    }
    error = '';
    try {
      const page = await getCimmichArchiveMissingFiles({ limit: 50, offset: append ? (nextOffset ?? 0) : 0 });
      const nextItems = append ? [...items, ...page.items] : page.items;
      items = nextItems;
      summary = page.summary;
      nextOffset = page.nextOffset;
      selected = selected.filter((id) => nextItems.some((item) => itemKey(item) === id));
      void loadAssetLocations(page.items);
    } catch (error_) {
      error = friendlyError(error_, 'Cimmich could not read missing-file evidence.');
    } finally {
      loading = false;
      loadingMore = false;
    }
  };

  const schedulePoll = () => {
    if (pollTimer) {
      clearTimeout(pollTimer);
    }
    pollTimer = setTimeout(() => void pollScan(), 1500);
  };

  const pollScan = async () => {
    const prior = scan?.state;
    try {
      const status = await getCimmichArchiveMissingFileScan();
      scan = status.scan;
      if (scan.state === 'running') {
        schedulePoll();
      } else if (prior === 'running') {
        await load();
        if (scan.state === 'complete') {
          notice =
            summary.total > 0
              ? `Immich status is current. ${summary.total.toLocaleString()} ${summary.total === 1 ? 'record is' : 'records are'} outside the active library.`
              : 'Immich status is current. No inactive Immich records were found.';
        } else {
          error = scan.error?.message || 'The Immich catalogue check failed. Existing Cimmich records were unchanged.';
        }
      }
    } catch (error_) {
      error = friendlyError(error_, 'Cimmich could not read catalogue-check status.');
    }
  };

  const startScan = async () => {
    error = '';
    notice = '';
    try {
      const result = await startCimmichArchiveMissingFileScan();
      scan = result.scan;
      if (scan.state === 'running') {
        schedulePoll();
      } else {
        await load();
      }
    } catch (error_) {
      error = friendlyError(error_, 'Cimmich could not start the Immich catalogue check.');
    }
  };

  const toggle = (item: CimmichArchiveMissingFile) => {
    const key = itemKey(item);
    selected = selected.includes(key) ? selected.filter((id) => id !== key) : [...selected, key];
    confirming = false;
  };

  const toggleAll = () => {
    selected = allVisibleSelected ? [] : selectableItems.map((item) => itemKey(item));
    confirming = false;
  };

  const removeSelected = async () => {
    if (!confirming) {
      confirming = true;
      return;
    }
    removing = true;
    error = '';
    notice = '';
    try {
      const selectedItems = items.filter((item) => selected.includes(itemKey(item)));
      const sourceIds = [...new Set(selectedItems.map((item) => item.sourceId))];
      let removedCount = 0;
      for (const sourceId of sourceIds) {
        const sourceAssetIds = selectedItems
          .filter((item) => item.sourceId === sourceId)
          .map((item) => item.sourceAssetId);
        const result = await removeCimmichArchiveMissingFiles(
          sourceId,
          sourceAssetIds,
          `archive-missing-${createCimmichUuid()}`,
        );
        removedCount += result.removedSourceAssetIds.length;
      }
      notice = `${removedCount.toLocaleString()} missing Immich ${removedCount === 1 ? 'record was' : 'records were'} removed from current Cimmich management.`;
      selected = [];
      confirming = false;
      await load();
    } catch (error_) {
      error = friendlyError(error_, 'Cimmich could not remove the selected missing records.');
    } finally {
      removing = false;
    }
  };

  const removeAllTrashed = async () => {
    if (!confirmingAllTrashed) {
      confirmingAllTrashed = true;
      return;
    }
    const expectedCount = summary.trashed;
    removingAllTrashed = true;
    error = '';
    notice = '';
    try {
      const result = await removeAllCimmichArchiveTrashedFiles(
        trashedSourceId,
        expectedCount,
        `archive-trash-all-${createCimmichUuid()}`,
      );
      notice = `${result.removedSourceAssetIds.length.toLocaleString()} Immich trash ${result.removedSourceAssetIds.length === 1 ? 'record was' : 'records were'} removed from current Cimmich management. No Immich media or source files were changed.`;
      selected = [];
      confirming = false;
      confirmingAllTrashed = false;
      await load();
    } catch (error_) {
      error = friendlyError(error_, 'Cimmich could not remove all Immich trash records.');
    } finally {
      removingAllTrashed = false;
    }
  };

  $effect(() => {
    if (refreshRevision === observedRefreshRevision) {
      return;
    }
    observedRefreshRevision = refreshRevision;
    void load();
  });

  onMount(() => {
    void load();
    void startScan();
    return () => {
      if (pollTimer) {
        clearTimeout(pollTimer);
      }
    };
  });
</script>

<section class="space-y-4" aria-label="Missing files">
  <div class="rounded-3xl border border-amber-200 bg-amber-50/70 p-5 dark:border-amber-900 dark:bg-amber-950/20">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="max-w-3xl">
        <div class="flex items-center gap-2">
          <Icon icon={mdiDatabaseSearchOutline} size="22" class="text-amber-700 dark:text-amber-300" />
          <h2 class="text-lg font-semibold">Missing from Immich</h2>
        </div>
        <p class="mt-2 text-sm/6 text-gray-700 dark:text-gray-200">
          Cimmich checks the active Immich source automatically. Anything in Immich trash or no longer found in that
          current Immich catalogue appears here and can be removed from Cimmich immediately.
        </p>
        <p class="mt-2 text-xs/5 text-gray-600 dark:text-gray-300">
          A disconnected source folder, an Immich offline flag, or Immich being unavailable never qualifies a record for
          removal. This action changes Cimmich only; it never deletes source media or writes to Immich.
        </p>
      </div>
      <div
        class="inline-flex min-h-10 items-center gap-2 rounded-full bg-white/80 px-4 text-sm font-semibold text-amber-950 dark:bg-amber-950/60 dark:text-amber-100"
      >
        <Icon
          icon={scanRunning ? mdiRefresh : mdiDatabaseSearchOutline}
          size="17"
          class={scanRunning ? 'animate-spin' : ''}
        />
        {scanRunning ? 'Refreshing Immich status…' : 'Immich status checked automatically'}
      </div>
    </div>
  </div>

  {#if error}
    <div
      class="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
    >
      {error}
    </div>
  {/if}
  {#if notice}
    <div
      class="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
    >
      {notice}
    </div>
  {/if}

  <div class="grid gap-3 sm:grid-cols-3">
    <div class="rounded-2xl border border-gray-200 bg-white p-4 dark:border-immich-dark-gray dark:bg-immich-dark-bg">
      <p class="text-2xl font-semibold">{summary.total.toLocaleString()}</p>
      <p class="text-sm text-gray-500 dark:text-gray-400">Ready to remove</p>
    </div>
    <div class="rounded-2xl border border-amber-300 bg-white p-4 dark:border-amber-800 dark:bg-immich-dark-bg">
      <p class="text-2xl font-semibold">{summary.trashed.toLocaleString()}</p>
      <p class="text-sm text-gray-500 dark:text-gray-400">In Immich trash</p>
      {#if summary.trashed > 0}
        <div class="mt-3 space-y-2">
          {#if confirmingAllTrashed}
            <p class="text-xs/5 text-red-700 dark:text-red-300">
              Remove all {summary.trashed.toLocaleString()} trash links from Cimmich management? This does not delete Immich
              media or source files.
            </p>
          {/if}
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="inline-flex min-h-9 items-center gap-2 rounded-full bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
              disabled={!trashedSourceId || removingAllTrashed}
              onclick={() => void removeAllTrashed()}
            >
              <Icon icon={mdiDeleteOutline} size="17" />
              {removingAllTrashed
                ? 'Removing trash links…'
                : confirmingAllTrashed
                  ? `Confirm remove all ${summary.trashed.toLocaleString()}`
                  : `Remove all ${summary.trashed.toLocaleString()} from Cimmich`}
            </button>
            {#if confirmingAllTrashed}
              <button
                type="button"
                class="min-h-9 rounded-full px-3 text-sm font-semibold hover:bg-gray-100 dark:hover:bg-gray-800"
                onclick={() => (confirmingAllTrashed = false)}
              >
                Cancel
              </button>
            {/if}
          </div>
        </div>
      {/if}
    </div>
    <div class="rounded-2xl border border-gray-200 bg-white p-4 dark:border-immich-dark-gray dark:bg-immich-dark-bg">
      <p class="text-2xl font-semibold">{summary.missing.toLocaleString()}</p>
      <p class="text-sm text-gray-500 dark:text-gray-400">Not found in current Immich</p>
    </div>
  </div>

  {#if loading}
    <div
      class="rounded-3xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500 dark:border-immich-dark-gray dark:bg-immich-dark-bg"
    >
      Reading missing-file evidence…
    </div>
  {:else if items.length === 0}
    <div
      class="rounded-3xl border border-gray-200 bg-white p-8 text-center dark:border-immich-dark-gray dark:bg-immich-dark-bg"
    >
      <p class="font-semibold">Everything Cimmich knows is active in Immich</p>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
        Cimmich refreshes this view automatically when you open it.
      </p>
    </div>
  {:else}
    <div
      class="overflow-hidden rounded-3xl border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
    >
      <div
        class="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-immich-dark-gray"
      >
        <label class="inline-flex min-h-9 items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={allVisibleSelected} onchange={toggleAll} />
          Select visible
        </label>
        <div class="flex flex-wrap items-center gap-2">
          {#if confirming}
            <span class="inline-flex items-center gap-1 text-sm font-medium text-red-700 dark:text-red-300">
              <Icon icon={mdiAlertOutline} size="17" /> Confirm removal from Cimmich
            </span>
          {/if}
          <button
            type="button"
            class="inline-flex min-h-9 items-center gap-2 rounded-full bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
            disabled={selectedCount === 0 || removing}
            onclick={() => void removeSelected()}
          >
            <Icon icon={mdiDeleteOutline} size="17" />
            {removing
              ? 'Removing…'
              : confirming
                ? `Confirm remove ${selectedCount}`
                : `Remove from Cimmich (${selectedCount})`}
          </button>
          {#if confirming}
            <button
              type="button"
              class="min-h-9 rounded-full px-3 text-sm font-semibold hover:bg-gray-100 dark:hover:bg-gray-800"
              onclick={() => (confirming = false)}
            >
              Cancel
            </button>
          {/if}
        </div>
      </div>
      <ul class="divide-y divide-gray-100 dark:divide-immich-dark-gray">
        {#each items as item (itemKey(item))}
          {@const location = assetLocations.get(item.sourceAssetId)}
          {@const locationLoaded = assetLocations.has(item.sourceAssetId)}
          {@const folderPath = location?.originalPath ? getParentPath(location.originalPath) : ''}
          <li class="flex items-start gap-3 p-4">
            <input
              type="checkbox"
              class="mt-1"
              aria-label={`Select ${item.filename}`}
              checked={selected.includes(itemKey(item))}
              disabled={Boolean(selectedSourceId) && item.sourceId !== selectedSourceId}
              onchange={() => toggle(item)}
            />
            <div class="grid min-w-0 flex-1 gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
              <a
                class="group relative block aspect-4/3 overflow-hidden rounded-2xl bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:bg-gray-900"
                href={viewerHref(item)}
                aria-label={`Open ${item.filename} ${item.state === 'trashed' ? 'in Immich trash' : 'in Immich'}`}
              >
                {#if !failedPreviews.includes(item.sourceAssetId)}
                  <img
                    class="size-full object-cover transition duration-200 group-hover:scale-[1.02]"
                    src={thumbnail(item.sourceAssetId)}
                    alt={`Preview of ${item.filename}`}
                    loading="lazy"
                    onerror={() => failPreview(item.sourceAssetId)}
                  />
                {:else}
                  <span
                    class="grid size-full place-items-center gap-1 p-3 text-center text-gray-500 dark:text-gray-400"
                  >
                    <span>
                      <Icon icon={mdiImageOffOutline} size="28" />
                    </span>
                    <span class="text-xs font-semibold">Preview unavailable</span>
                  </span>
                {/if}
              </a>
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <a
                    class="min-w-0 truncate font-semibold text-primary hover:underline"
                    href={viewerHref(item)}
                    title={item.filename}>{item.filename}</a
                  >
                  <span
                    class="rounded-full px-2 py-0.5 text-xs font-semibold {item.state === 'trashed'
                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
                      : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200'}"
                  >
                    {item.state === 'trashed' ? 'In Immich trash' : 'Not found in current Immich'}
                  </span>
                </div>
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Last seen {date(item.lastSeenAt)} · {item.people.toLocaleString()}
                  {item.people === 1 ? 'person' : 'people'} ·
                  {item.assignments.toLocaleString()} accepted {item.assignments === 1 ? 'assignment' : 'assignments'}
                </p>
                <div class="mt-3 rounded-xl bg-gray-50 px-3 py-2.5 text-xs dark:bg-gray-900/70">
                  <p class="font-semibold text-gray-950 dark:text-white">Local address</p>
                  {#if location?.originalPath && folderPath}
                    <a
                      class="mt-1 block font-semibold break-all text-primary hover:underline"
                      href={Route.viewFolderAsset({ cimmich: 1, id: item.sourceAssetId, path: folderPath })}
                      title={`Open ${location.originalPath} in Folder view`}
                    >
                      {location.originalPath}
                    </a>
                    <CimmichFileLocationActions asset={location} variant="detail" />
                  {:else if locationLoaded}
                    <p class="mt-1 text-gray-500 dark:text-gray-400">
                      Unavailable: this record is not in the current Immich catalogue.
                    </p>
                  {:else}
                    <p class="mt-1 text-gray-500 dark:text-gray-400">Reading local address…</p>
                  {/if}
                </div>
                <p class="mt-2 text-[0.7rem] break-all text-gray-400 dark:text-gray-500">
                  Immich record {item.sourceAssetId} · source {item.sourceId}
                </p>
                <a
                  class="mt-2 inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
                  href={viewerHref(item)}
                >
                  {item.state === 'trashed' ? 'Open in Immich trash' : 'Open Immich record'}
                  <Icon icon={mdiArrowRight} size="16" />
                </a>
              </div>
            </div>
          </li>
        {/each}
      </ul>
    </div>
    {#if nextOffset !== null}
      <div class="flex justify-center">
        <button
          type="button"
          class="min-h-10 rounded-full border border-gray-300 px-5 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-800"
          disabled={loadingMore}
          onclick={() => void load({ append: true })}
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      </div>
    {/if}
  {/if}
</section>
