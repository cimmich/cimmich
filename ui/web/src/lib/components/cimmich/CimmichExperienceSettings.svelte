<script lang="ts">
  import { cimmichExperience, cimmichLocalAiExperiment } from '$lib/stores/cimmich-experience.store';
  import { Icon } from '@immich/ui';
  import { mdiCreationOutline, mdiFlaskOutline, mdiViewDashboardOutline, mdiViewListOutline } from '@mdi/js';

  const useFrontier = () => ($cimmichExperience = 'frontier');
  const useCompanion = () => ($cimmichExperience = 'companion');
  const toggleLocalAi = () => ($cimmichLocalAiExperiment = !$cimmichLocalAiExperiment);
</script>

<section
  class="overflow-hidden rounded-3xl border border-primary/25 bg-linear-to-br from-primary/10 via-white to-indigo-50 shadow-sm dark:from-primary/15 dark:via-immich-dark-bg dark:to-indigo-950/20"
  aria-labelledby="cimmich-experience-title"
>
  <div class="grid gap-6 p-6 lg:grid-cols-[1fr_auto] lg:items-center lg:p-8">
    <div class="max-w-3xl">
      <div class="flex flex-wrap items-center gap-2">
        <span class="grid size-11 place-items-center rounded-2xl bg-primary text-white shadow-sm">
          <Icon icon={mdiCreationOutline} size="23" />
        </span>
        <span class="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold tracking-[0.12em] text-primary uppercase">
          Experimental
        </span>
        {#if $cimmichExperience === 'frontier'}
          <span
            class="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
          >
            On
          </span>
        {/if}
      </div>

      <h2 id="cimmich-experience-title" class="mt-5 text-2xl font-semibold tracking-tight sm:text-3xl">
        Frontier Workspace
      </h2>
      <p class="mt-3 max-w-2xl text-sm/6 text-gray-700 sm:text-base/7 dark:text-gray-200">
        Give Cimmich its own focused Home, Library, Browse, Review and Settings navigation. It uses the same library and
        features as the familiar sidebar, and you can switch back at any time.
      </p>
    </div>

    {#if $cimmichExperience === 'frontier'}
      <button
        type="button"
        class="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-gray-300 bg-white px-6 text-sm font-semibold text-gray-800 shadow-sm transition hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:border-gray-600 dark:bg-immich-dark-gray dark:text-white"
        onclick={useCompanion}
      >
        <Icon icon={mdiViewListOutline} size="20" />
        Use familiar sidebar
      </button>
    {:else}
      <button
        type="button"
        class="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-primary px-6 text-sm font-semibold text-white shadow-md transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        onclick={useFrontier}
      >
        <Icon icon={mdiViewDashboardOutline} size="20" />
        Use Frontier Workspace
      </button>
    {/if}
  </div>
</section>

<section
  class="flex flex-col justify-between gap-5 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center dark:border-immich-dark-gray dark:bg-immich-dark-bg"
  aria-labelledby="local-ai-experiment-title"
>
  <div class="flex min-w-0 items-start gap-3">
    <span
      class="grid size-11 shrink-0 place-items-center rounded-2xl bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
    >
      <Icon icon={mdiFlaskOutline} size="22" />
    </span>
    <div>
      <div class="flex flex-wrap items-center gap-2">
        <h2 id="local-ai-experiment-title" class="font-semibold">Local AI review controls</h2>
        <span
          class="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold tracking-wide text-amber-800 uppercase dark:bg-amber-950 dark:text-amber-200"
        >
          Experimental
        </span>
      </div>
      <p class="mt-1 max-w-2xl text-sm/6 text-gray-600 dark:text-gray-300">
        Show optional Local AI actions on eligible photos. This only reveals the controls; models and the Local AI
        runtime must still be installed and enabled separately.
      </p>
    </div>
  </div>

  <button
    type="button"
    class="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full px-5 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary {$cimmichLocalAiExperiment
      ? 'bg-amber-100 text-amber-900 hover:bg-amber-200 dark:bg-amber-950 dark:text-amber-100'
      : 'border border-gray-300 bg-white text-gray-800 hover:border-primary hover:text-primary dark:border-gray-600 dark:bg-immich-dark-gray dark:text-white'}"
    aria-pressed={$cimmichLocalAiExperiment}
    onclick={toggleLocalAi}
  >
    {$cimmichLocalAiExperiment ? 'Hide Local AI controls' : 'Show Local AI controls'}
  </button>
</section>
