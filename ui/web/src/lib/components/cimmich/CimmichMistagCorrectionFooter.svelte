<script lang="ts">
  let {
    accepted = false,
    busy = false,
    label,
    onClose,
    onSubmit,
    saving = false,
    targetSelected = false,
  }: {
    accepted?: boolean;
    busy?: boolean;
    label: string;
    onClose: () => void;
    onSubmit: () => void;
    saving?: boolean;
    targetSelected?: boolean;
  } = $props();
</script>

{#if accepted}
  <button
    class="min-h-10 rounded-md bg-amber-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
    type="button"
    disabled={busy || !targetSelected}
    onclick={onSubmit}
  >
    {saving ? 'Saving…' : label}
  </button>
{/if}
<div class="flex items-center justify-end border-t border-gray-200 pt-2 dark:border-gray-700">
  <button
    class="min-h-9 rounded-md px-3 text-xs font-semibold text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
    type="button"
    onclick={onClose}
  >
    {accepted ? 'Close' : 'Cancel'}
  </button>
</div>
