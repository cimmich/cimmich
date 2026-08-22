<script lang="ts">
  import {
    dismissCimmichConnectionSuggestion,
    recordCimmichConnectionFact,
    type CimmichConnectionSuggestion,
  } from '$lib/services/cimmich-connection-facts.service';
  import { createCimmichContextCommandId } from '$lib/services/cimmich.service';
  import { toastManager } from '@immich/ui';

  let {
    onchanged,
    personId,
    suggestions,
  }: {
    onchanged: () => void | Promise<void>;
    personId: string;
    suggestions: CimmichConnectionSuggestion[];
  } = $props();

  let errorMessage = $state('');
  let saving = $state('');

  const confirm = async (suggestion: CimmichConnectionSuggestion) => {
    saving = suggestion.suggestionKey;
    errorMessage = '';
    try {
      await recordCimmichConnectionFact(personId, {
        ...suggestion.candidate,
        commandId: createCimmichContextCommandId('connection-confirm'),
        suggestionKey: suggestion.suggestionKey,
      });
      toastManager.success(
        `Recorded ${suggestion.displayLabel.toLocaleLowerCase()} at ${suggestion.target.displayName}`,
      );
      await onchanged();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Unable to confirm this connection';
    } finally {
      saving = '';
    }
  };

  const dismiss = async (suggestion: CimmichConnectionSuggestion) => {
    saving = suggestion.suggestionKey;
    errorMessage = '';
    try {
      await dismissCimmichConnectionSuggestion(
        personId,
        suggestion.suggestionKey,
        createCimmichContextCommandId('connection-dismiss'),
      );
      await onchanged();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Unable to dismiss this connection lead';
    } finally {
      saving = '';
    }
  };
</script>

<section class="grid gap-3" aria-labelledby="connection-leads-heading">
  <div>
    <h3 class="font-semibold" id="connection-leads-heading">Possible connections to confirm</h3>
    <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
      Leads from facts you recorded elsewhere. Nothing is added unless you confirm it.
    </p>
  </div>
  <div class="grid gap-3 lg:grid-cols-2">
    {#each suggestions as suggestion (suggestion.suggestionKey)}
      <article
        class="grid gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30"
      >
        <div>
          <p class="text-xs font-semibold tracking-wide text-amber-800 uppercase dark:text-amber-300">
            Suggested · {suggestion.confidence === 'stronger' ? 'dated evidence' : 'needs confirmation'}
          </p>
          <h4 class="mt-1 font-semibold">{suggestion.displayLabel} at {suggestion.target.displayName}?</h4>
          <p class="mt-1 text-sm text-gray-600 dark:text-gray-300">{suggestion.explanation}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            class="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50 dark:text-black"
            type="button"
            disabled={Boolean(saving)}
            onclick={() => void confirm(suggestion)}
            >{saving === suggestion.suggestionKey ? 'Saving…' : 'Confirm'}</button
          >
          <button
            class="min-h-11 rounded-lg border border-gray-300 px-4 text-sm font-semibold disabled:opacity-50 dark:border-gray-700"
            type="button"
            disabled={Boolean(saving)}
            onclick={() => void dismiss(suggestion)}>Dismiss</button
          >
        </div>
      </article>
    {/each}
  </div>
  {#if errorMessage}
    <p
      class="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
      role="alert"
    >
      {errorMessage}
    </p>
  {/if}
</section>
