<script lang="ts">
  import { Icon } from '@immich/ui';
  import { mdiAlertCircleOutline, mdiUndoVariant } from '@mdi/js';
  import type { BulkPhotoSorterOperationReceipt } from './bulk-photo-sorter';

  interface Props {
    busy: boolean;
    error: string;
    ondismiss: () => void;
    onundo: () => void;
    progress: string;
    receipt: BulkPhotoSorterOperationReceipt | null;
    undoing: boolean;
  }

  let { busy, error, ondismiss, onundo, progress, receipt, undoing }: Props = $props();
</script>

<div class="mt-6" aria-live="polite">
  {#if progress}<p class="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm font-medium">
      {progress}
    </p>{/if}
  {#if error}
    <p
      class="mt-3 flex gap-2 rounded-2xl border border-red-400/30 bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/25 dark:text-red-200"
    >
      <Icon icon={mdiAlertCircleOutline} size="20" />
      {error}
    </p>
  {/if}
</div>

{#if receipt}
  <section class="mt-6 rounded-3xl border border-emerald-500/25 bg-emerald-50/60 p-5 sm:p-7 dark:bg-emerald-950/15">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p class="text-sm font-semibold tracking-[0.14em] text-emerald-700 uppercase dark:text-emerald-300">
          {receipt.partial ? 'Partial receipt' : 'Operation receipt'}
        </p>
        <h2 class="mt-2 text-xl font-semibold">{receipt.label}</h2>
        <p class="mt-2 text-sm opacity-75">
          Selected {receipt.selected.toLocaleString()} · changed {receipt.applied.toLocaleString()} · unchanged or unavailable
          {receipt.skipped.toLocaleString()} · {new Date(receipt.completedAt).toLocaleTimeString()} · saved on this device
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        {#if receipt.undo}
          <button
            class="inline-flex items-center gap-2 rounded-full border border-emerald-700/30 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-500/10 disabled:opacity-50 dark:text-emerald-200"
            type="button"
            onclick={onundo}
            disabled={busy || undoing}><Icon icon={mdiUndoVariant} size="19" /> {undoing ? 'Undoing…' : 'Undo'}</button
          >
        {/if}
        <button
          class="rounded-full px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-500/10 disabled:opacity-50 dark:text-emerald-200"
          type="button"
          onclick={ondismiss}
          disabled={busy || undoing}>{receipt.undo ? 'Keep changes' : 'Dismiss receipt'}</button
        >
      </div>
    </div>
  </section>
{/if}
