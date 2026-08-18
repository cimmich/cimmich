<script lang="ts">
  import {
    checkLatestCimmichDatabaseBackup,
    getCimmichDatabaseBackupStatus,
    setCimmichDatabaseBackupPolicy,
    startCimmichDatabaseBackup,
    type CimmichDatabaseBackupStatus,
  } from '$lib/services/cimmich-archive-integrity.service';
  import { Icon } from '@immich/ui';
  import {
    mdiBackupRestore,
    mdiCheckDecagramOutline,
    mdiClockOutline,
    mdiDatabaseCheckOutline,
    mdiHarddisk,
    mdiRefresh,
    mdiShieldAlertOutline,
  } from '@mdi/js';
  import { onMount } from 'svelte';

  let error = $state('');
  let frequency = $state<'daily' | 'manual' | 'weekly'>('manual');
  let loaded = $state(false);
  let loading = $state(false);
  let retentionCount = $state(3);
  let saving = $state(false);
  let selectedDestinationIds = $state<string[]>([]);
  let status = $state<CimmichDatabaseBackupStatus | null>(null);

  const formatBytes = (value: number | null) => {
    if (!value || value <= 0) {
      return 'Unknown';
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const power = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    const amount = value / 1024 ** power;
    return `${amount >= 10 || power === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[power]}`;
  };
  const dateTime = (value: string | null | undefined) => (value ? new Date(value).toLocaleString() : 'Not yet');
  const isBusy = $derived(
    status?.activeRun?.state === 'queued' ||
      status?.activeRun?.state === 'running' ||
      status?.activeCheck?.state === 'queued' ||
      status?.activeCheck?.state === 'running',
  );
  const selectedDestinations = $derived(
    status?.destinations.filter((destination) => selectedDestinationIds.includes(destination.id)) ?? [],
  );

  const applyStatus = (next: CimmichDatabaseBackupStatus, resetDraft = false) => {
    status = next;
    if (!loaded || resetDraft) {
      frequency = next.policy.frequency;
      retentionCount = next.policy.retentionCount;
      selectedDestinationIds = [...next.policy.destinationIds];
    }
    loaded = true;
  };
  const refresh = async (resetDraft = false) => {
    loading = true;
    error = '';
    try {
      applyStatus(await getCimmichDatabaseBackupStatus(), resetDraft);
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'Cimmich could not read database backup health.';
    } finally {
      loading = false;
    }
  };
  const toggleDestination = (id: string, checked: boolean) => {
    selectedDestinationIds = checked
      ? [...new Set([...selectedDestinationIds, id])]
      : selectedDestinationIds.filter((candidate) => candidate !== id);
  };
  const savePolicy = async () => {
    saving = true;
    error = '';
    try {
      applyStatus(
        await setCimmichDatabaseBackupPolicy({ frequency, retentionCount, destinationIds: selectedDestinationIds }),
        true,
      );
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'Cimmich could not save the database backup schedule.';
    } finally {
      saving = false;
    }
  };
  const backUpNow = async () => {
    error = '';
    try {
      await startCimmichDatabaseBackup(selectedDestinationIds);
      await refresh();
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'Cimmich could not start the database backup.';
    }
  };
  const checkLatest = async () => {
    error = '';
    try {
      await checkLatestCimmichDatabaseBackup(selectedDestinationIds);
      await refresh();
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'Cimmich could not check the latest database backup.';
    }
  };

  onMount(() => {
    void refresh(true);
    const poll = globalThis.setInterval(() => {
      if (isBusy) {
        void refresh();
      }
    }, 2000);
    return () => globalThis.clearInterval(poll);
  });
</script>

<section class="space-y-4" aria-labelledby="database-backup-title">
  {#if error}
    <div
      class="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
    >
      {error}
    </div>
  {/if}

  <article
    class="overflow-hidden rounded-3xl border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
  >
    <header
      class="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-immich-dark-gray"
    >
      <div>
        <h2 id="database-backup-title" class="text-xl font-semibold">Database protection</h2>
        <p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
          Protect Cimmich decisions, people, review work and settings with restorable PostgreSQL backups.
        </p>
      </div>
      <button
        type="button"
        class="inline-flex min-h-10 items-center gap-2 rounded-full border border-gray-300 px-4 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-800"
        disabled={loading || isBusy}
        onclick={() => void refresh(true)}
        title="Reload destination availability and the latest recorded backup"
      >
        <Icon icon={mdiRefresh} size="17" class={loading ? 'animate-spin' : ''} /> Refresh
      </button>
    </header>

    {#if !loaded}
      <div class="grid min-h-40 place-items-center p-5 text-sm font-semibold">Reading database backup health…</div>
    {:else if !status || status.destinations.length === 0}
      <div class="flex gap-4 p-5">
        <span
          class="grid size-11 shrink-0 place-items-center rounded-2xl bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
        >
          <Icon icon={mdiShieldAlertOutline} size="23" />
        </span>
        <div>
          <h3 class="font-semibold">No database backup location configured</h3>
          <p class="mt-1 max-w-3xl text-sm/6 text-gray-600 dark:text-gray-300">
            Connect at least one writable location on an independent storage device. Cimmich will never treat another
            folder on the database disk as protection.
          </p>
          <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Locations are deployment-controlled so this page cannot write a database dump to an arbitrary server path.
          </p>
        </div>
      </div>
    {:else}
      <div class="grid gap-5 p-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div class="space-y-3">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h3 class="font-semibold">Backup locations</h3>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Choose one or more independent destinations.</p>
            </div>
            <span class="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold dark:bg-gray-800">
              {selectedDestinationIds.length} selected
            </span>
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            {#each status.destinations as destination (destination.id)}
              <label
                class="flex cursor-pointer gap-3 rounded-2xl border p-4 {selectedDestinationIds.includes(destination.id)
                  ? 'border-violet-400 bg-violet-50/60 dark:border-violet-700 dark:bg-violet-950/20'
                  : 'border-gray-200 dark:border-immich-dark-gray'}"
                title="{destination.storageDomain} is configured as a separate storage failure domain"
              >
                <input
                  class="mt-1 size-4 accent-violet-700"
                  type="checkbox"
                  checked={selectedDestinationIds.includes(destination.id)}
                  disabled={!destination.available || !destination.writable || isBusy}
                  onchange={(event) => toggleDestination(destination.id, event.currentTarget.checked)}
                />
                <span class="min-w-0">
                  <span class="flex flex-wrap items-center gap-2 font-semibold">
                    {destination.label}
                    <span
                      class="rounded-full px-2 py-0.5 text-[11px] {destination.available && destination.writable
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                        : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200'}"
                    >
                      {destination.available && destination.writable ? 'Ready' : 'Unavailable'}
                    </span>
                  </span>
                  {#if destination.description}
                    <span class="mt-1 block text-xs/5 text-gray-600 dark:text-gray-300">{destination.description}</span>
                  {/if}
                  <span class="mt-2 block text-xs text-gray-500 dark:text-gray-400">
                    {destination.freeBytes === null
                      ? 'Capacity unavailable'
                      : `${formatBytes(destination.freeBytes)} free`}
                  </span>
                </span>
              </label>
            {/each}
          </div>
        </div>

        <div class="space-y-4 rounded-2xl bg-gray-50 p-4 dark:bg-gray-900">
          <label class="block text-sm font-semibold">
            Frequency
            <select
              class="mt-2 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 font-normal dark:border-gray-600 dark:bg-gray-950"
              bind:value={frequency}
              disabled={isBusy}
              title="Scheduled backups run from the latest successful completion"
            >
              <option value="manual">Manual only</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </label>
          <label class="block text-sm font-semibold">
            Keep per location
            <select
              class="mt-2 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 font-normal dark:border-gray-600 dark:bg-gray-950"
              bind:value={retentionCount}
              disabled={isBusy}
              title="Older Cimmich-created database backups are removed only after a newer verified copy exists"
            >
              {#each [1, 2, 3, 5, 7, 14, 30] as count (count)}
                <option value={count}>{count} {count === 1 ? 'backup' : 'backups'}</option>
              {/each}
            </select>
          </label>
          <button
            type="button"
            class="min-h-11 w-full rounded-full bg-violet-700 px-4 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-50"
            disabled={saving || isBusy || (frequency !== 'manual' && selectedDestinationIds.length === 0)}
            onclick={() => void savePolicy()}
            title="Save the selected locations, frequency and retained-copy count"
          >
            {saving ? 'Saving…' : 'Save schedule'}
          </button>
          {#if status.nextDueAt}
            <p class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <Icon icon={mdiClockOutline} size="15" /> Next due {dateTime(status.nextDueAt)}
            </p>
          {/if}
        </div>
      </div>

      <div
        class="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-5 py-4 dark:border-immich-dark-gray"
      >
        <p class="text-sm text-gray-500 dark:text-gray-400">
          {isBusy
            ? status.activeRun?.state === 'running'
              ? 'Creating and verifying the database backup…'
              : status.activeCheck?.state === 'running'
                ? 'Re-reading complete bytes and restore structure…'
                : 'Preparing the requested operation…'
            : 'Back up now creates a new copy. Check latest fully verifies the newest recorded copy.'}
        </p>
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="inline-flex min-h-11 items-center gap-2 rounded-full border border-gray-300 px-4 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-800"
            disabled={isBusy || selectedDestinationIds.length === 0}
            onclick={() => void checkLatest()}
            title="Recalculate SHA-256 and confirm PostgreSQL can read the latest backup catalogue"
          >
            <Icon icon={mdiDatabaseCheckOutline} size="18" /> Check latest
          </button>
          <button
            type="button"
            class="inline-flex min-h-11 items-center gap-2 rounded-full bg-violet-700 px-5 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-50"
            disabled={isBusy ||
              selectedDestinationIds.length === 0 ||
              selectedDestinations.some((item) => !item.available)}
            onclick={() => void backUpNow()}
            title="Create a PostgreSQL custom-format backup in every selected location"
          >
            <Icon icon={mdiBackupRestore} size="18" /> Back up now
          </button>
        </div>
      </div>
    {/if}
  </article>

  {#if status && status.destinations.length > 0}
    <div class="grid gap-3 lg:grid-cols-2" aria-label="Latest database backups">
      {#each status.destinations as destination (destination.id)}
        <article
          class="rounded-2xl border border-gray-200 bg-white p-4 dark:border-immich-dark-gray dark:bg-immich-dark-bg"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="flex min-w-0 gap-3">
              <span
                class="grid size-10 shrink-0 place-items-center rounded-xl {destination.latest?.verificationState ===
                'verified'
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'}"
              >
                <Icon
                  icon={destination.latest?.verificationState === 'verified' ? mdiCheckDecagramOutline : mdiHarddisk}
                  size="21"
                />
              </span>
              <div class="min-w-0">
                <h3 class="truncate font-semibold">{destination.label}</h3>
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {destination.latest ? `Created ${dateTime(destination.latest.createdAt)}` : 'No backup recorded'}
                </p>
              </div>
            </div>
            <span class="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold dark:bg-gray-800">
              {destination.latest?.verificationState === 'verified' ? 'Verified' : 'Needs backup'}
            </span>
          </div>
          {#if destination.latest}
            <dl class="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
              <dt class="text-gray-500 dark:text-gray-400">Size</dt>
              <dd class="text-right font-semibold">{formatBytes(destination.latest.byteLength)}</dd>
              <dt class="text-gray-500 dark:text-gray-400">Schema</dt>
              <dd class="text-right font-semibold">{destination.latest.databaseSchemaVersion}</dd>
              <dt class="text-gray-500 dark:text-gray-400">Checked</dt>
              <dd class="text-right font-semibold">{dateTime(destination.latest.verifiedAt)}</dd>
              <dt class="text-gray-500 dark:text-gray-400">SHA-256</dt>
              <dd class="truncate text-right font-mono" title={destination.latest.contentSha256}>
                {destination.latest.contentSha256.slice(0, 16)}…
              </dd>
            </dl>
            {#if destination.latest.lastError}
              <p class="mt-3 rounded-xl bg-red-50 p-3 text-xs text-red-800 dark:bg-red-950/30 dark:text-red-200">
                {destination.latest.lastError}
              </p>
            {/if}
          {/if}
        </article>
      {/each}
    </div>
  {/if}
</section>
