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
        const headSummary = result.headRescan.totalCount
          ? ` Rescanned ${result.headRescan.totalCount.toLocaleString()} of their Heads; ${result.headRescan.movedCount.toLocaleString()} re-entered Face matching.`
          : ' No assigned Heads needed rescanning.';
        const mistagSummary = result.mistagRefresh.reevaluatedCount
          ? ` Rechecked ${result.mistagRefresh.reevaluatedCount.toLocaleString()} mistags in their lane; ${result.mistagRefresh.resolvedCount.toLocaleString()} no longer qualify.`
          : ' No current mistags needed rechecking.';
        onmessage(
          `Updated ${result.matcherPhotoCount.toLocaleString()} matcher ${result.matcherPhotoCount === 1 ? 'photo' : 'photos'} and found ${result.candidateCount.toLocaleString()} new ${result.candidateCount === 1 ? 'match' : 'matches'} to check.${headSummary}${mistagSummary} Nothing was confirmed.`,
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
  <div class="grid gap-1">
    <h3 class="font-semibold">Refresh matching</h3>
    <p class="text-sm text-gray-500 dark:text-gray-400">
      Recheck this Person’s assigned Heads and current mistags, update matcher photos from confirmed Faces, then look
      across unassigned Faces and People marked Needs attention for more likely matches. Empty Head and mistag lanes are
      skipped before scoring.
    </p>
  </div>
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
