<script lang="ts">
  let {
    newMatches,
    possibleMistags,
    waitingHint,
  }: { newMatches: number; possibleMistags: number; waitingHint: number } = $props();
</script>

{#if newMatches > 0}
  <span class="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-900 dark:text-amber-100">
    {newMatches.toLocaleString()} new
  </span>
{/if}
{#if possibleMistags > 0}
  <span class="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800 dark:bg-red-950 dark:text-red-200">
    {possibleMistags.toLocaleString()} mistags
  </span>
{/if}
{#if waitingHint > 0}
  <span class="rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-900 dark:bg-sky-950 dark:text-sky-100">
    {waitingHint.toLocaleString()} waiting
  </span>
{/if}
