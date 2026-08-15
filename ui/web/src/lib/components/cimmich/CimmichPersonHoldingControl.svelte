<script lang="ts">
  import { mediaQueryManager } from '$lib/stores/media-query-manager.svelte';

  interface Props {
    disabled?: boolean;
    onchange: () => void | Promise<void>;
    onreview?: () => void;
    selected?: boolean;
    variant: 'badge' | 'banner' | 'setting';
  }

  let { disabled = false, onchange, onreview = () => {}, selected = false, variant }: Props = $props();

  const changeHolding = async () => {
    await onchange();
    if (variant !== 'setting') {
      requestAnimationFrame(() =>
        document.querySelector('#cimmich-holding-category')?.scrollIntoView({
          behavior: mediaQueryManager.reducedMotion ? 'auto' : 'smooth',
          block: 'center',
        }),
      );
    }
  };
</script>

{#if variant === 'badge'}
  <button
    class="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-violet-200 px-3 py-1 text-xs font-semibold text-violet-950 transition hover:bg-violet-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
    type="button"
    aria-label="Change Holding"
    title="Change Holding"
    onclick={() => void changeHolding()}
  >
    Holding
    <span class="font-medium opacity-70">Change</span>
  </button>
{:else if variant === 'banner'}
  <div
    class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50 p-3 dark:border-violet-900 dark:bg-violet-950/35"
  >
    <div>
      <p class="text-sm font-semibold">Choose a match for each held face</p>
      <p class="mt-0.5 text-xs text-violet-700 dark:text-violet-300">
        Move each face to the right Person, or change Holding for this record.
      </p>
    </div>
    <div class="flex flex-wrap gap-2">
      <button
        class="min-h-9 rounded-md bg-violet-700 px-3 text-xs font-semibold text-white hover:bg-violet-800"
        type="button"
        onclick={onreview}>Held faces</button
      >
      <button
        class="min-h-9 rounded-md border border-violet-300 px-3 text-xs font-semibold text-violet-900 hover:bg-violet-100 dark:border-violet-700 dark:text-violet-100 dark:hover:bg-violet-950"
        type="button"
        onclick={() => void changeHolding()}>Change Holding</button
      >
    </div>
  </div>
{:else}
  <button
    id="cimmich-holding-category"
    class={[
      'mt-4 flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50',
      selected
        ? 'border-violet-400 bg-violet-50 text-violet-950 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-100'
        : 'border-gray-200 hover:bg-gray-50 dark:border-immich-dark-gray dark:hover:bg-immich-dark-gray',
    ]}
    type="button"
    aria-pressed={selected}
    {disabled}
    onclick={() => void changeHolding()}
  >
    <span>
      <span class="block font-semibold">Holding</span>
      <span class="block text-xs opacity-70">Mixed people; match and move each face individually.</span>
    </span>
    <span class="font-semibold">{selected ? 'On' : 'Off'}</span>
  </button>
{/if}
