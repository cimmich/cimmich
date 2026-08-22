<script lang="ts">
  import type { CimmichConnectionSuggestion } from '$lib/services/cimmich-connection-facts.service';
  import CimmichConnectionSuggestions from './CimmichConnectionSuggestions.svelte';

  interface Props {
    error: string;
    onchanged: () => Promise<void> | void;
    onundo: () => void;
    personId: string;
    savingId: string;
    suggestions: CimmichConnectionSuggestion[];
    undoDecisionId: string;
  }

  let { error, onchanged, onundo, personId, savingId, suggestions, undoDecisionId }: Props = $props();
</script>

{#if suggestions.length > 0}
  <CimmichConnectionSuggestions {onchanged} {personId} {suggestions} />
{/if}
{#if error}
  <p
    class="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
    role="alert"
  >
    {error}
  </p>
{/if}
{#if undoDecisionId}
  <div
    class="flex min-h-11 items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-2 text-sm"
    aria-live="polite"
  >
    <span>Connection removed.</span>
    <button
      class="min-h-11 rounded-md px-3 font-semibold text-primary hover:bg-primary/10 disabled:opacity-50"
      type="button"
      disabled={savingId === 'undo'}
      onclick={onundo}>{savingId === 'undo' ? 'Restoring…' : 'Undo'}</button
    >
  </div>
{/if}
