<script lang="ts">
  import { refreshCimmichPersonMatches } from '$lib/services/cimmich.service';

  type ChecksView = 'mistags' | 'multiple' | 'new';

  interface Props {
    counts: { mistags: number; multiple: number; new: number };
    onerror: (message: string) => void;
    onmessage: (message: string) => void;
    onreload: () => Promise<void>;
    onviewchange: (view: ChecksView) => void;
    personId: string;
    view: ChecksView;
  }

  let { counts, onerror, onmessage, onreload, onviewchange, personId, view }: Props = $props();
  let saving = $state(false);

  const refresh = async () => {
    if (saving) {
      return;
    }
    const requestedPersonId = personId;
    saving = true;
    try {
      const result = await refreshCimmichPersonMatches(requestedPersonId);
      if (personId === requestedPersonId) {
        await onreload();
      }
      if (personId === requestedPersonId) {
        onviewchange('new');
        onmessage(
          `Found ${result.candidateCount.toLocaleString()} new matches. Rechecked ${result.reviewedHeadCount.toLocaleString()} Heads and ${result.reviewedMistagCount.toLocaleString()} mistags.`,
        );
      }
    } catch (error) {
      if (personId === requestedPersonId) {
        onerror(error instanceof Error ? error.message : 'Unable to refresh matcher photos and matches');
      }
    } finally {
      if (personId === requestedPersonId) {
        saving = false;
      }
    }
  };
</script>

<div
  class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-gray-50/60 p-4 dark:border-gray-700 dark:bg-immich-dark-gray/15"
>
  <p class="text-sm text-gray-500 dark:text-gray-400">Recheck this Person’s tags.</p>
  <button
    class="inline-flex min-h-10 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:cursor-wait disabled:opacity-60"
    disabled={saving}
    type="button"
    onclick={() => void refresh()}
  >
    {saving ? 'Refreshing…' : 'Refresh matches'}
  </button>
</div>

<nav class="flex flex-wrap gap-2" aria-label="Check type">
  {#each [{ id: 'new', label: 'New matches', count: counts.new }, { id: 'multiple', label: 'Multiple in one photo', count: counts.multiple }, { id: 'mistags', label: 'Possible mistags', count: counts.mistags }] as check (check.id)}
    <button
      class={[
        'inline-flex min-h-10 items-center gap-2 rounded-full border px-3 text-sm font-semibold',
        view === check.id
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-gray-200 bg-white hover:border-gray-400 dark:border-gray-700 dark:bg-immich-dark-bg',
      ]}
      type="button"
      aria-pressed={view === check.id}
      onclick={() => onviewchange(check.id as ChecksView)}
    >
      {check.label}<span class="text-xs opacity-70">{check.count.toLocaleString()}</span>
    </button>
  {/each}
</nav>
