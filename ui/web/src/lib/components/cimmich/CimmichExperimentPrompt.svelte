<script lang="ts">
  import { cimmichDiscoverExperiment } from '$lib/stores/cimmich-experience.store';
  import { Icon } from '@immich/ui';
  import { mdiCompassOutline, mdiFlaskOutline } from '@mdi/js';

  interface Props {
    compact?: boolean;
  }

  let { compact = false }: Props = $props();
</script>

<section
  class={[
    'grid place-items-center rounded-3xl border border-amber-200 bg-amber-50/70 text-center dark:border-amber-900 dark:bg-amber-950/20',
    compact ? 'min-h-64 p-6' : 'min-h-112 p-8',
  ]}
  aria-labelledby="discover-experiment-title"
>
  <div class="max-w-xl">
    <span
      class="mx-auto grid size-14 place-items-center rounded-2xl bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100"
    >
      <Icon icon={mdiCompassOutline} size="28" />
    </span>
    <div class="mt-4 flex flex-wrap items-center justify-center gap-2">
      <h2 id="discover-experiment-title" class="text-xl font-semibold">Discover is still experimental</h2>
      <span
        class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900 dark:bg-amber-900 dark:text-amber-100"
      >
        <Icon icon={mdiFlaskOutline} size="15" /> Mid-build
      </span>
    </div>
    <p class="mt-3 text-sm/6 text-gray-600 dark:text-gray-300">
      Discover and Person memory webs explore recorded relationships without changing them. The experience is useful,
      but its graph layout, explanations and navigation are still being refined.
    </p>
    <p class="mt-2 text-xs/5 text-gray-500 dark:text-gray-400">
      Enabling it only reveals these views. Your existing People, Places, Events, Things and relationship data stays
      exactly as it is if you leave it off or turn it off again.
    </p>
    <button
      class="mt-5 inline-flex min-h-11 items-center justify-center rounded-full bg-amber-800 px-5 text-sm font-semibold text-white transition hover:bg-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 dark:bg-amber-200 dark:text-amber-950 dark:hover:bg-amber-100"
      type="button"
      onclick={() => ($cimmichDiscoverExperiment = true)}
    >
      Enable Discover
    </button>
  </div>
</section>
