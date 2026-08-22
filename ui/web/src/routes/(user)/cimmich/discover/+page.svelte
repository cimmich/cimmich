<script lang="ts">
  import CimmichMemoryGraph from '$lib/components/cimmich/CimmichMemoryGraph.svelte';
  import CimmichStatePanel from '$lib/components/cimmich/CimmichStatePanel.svelte';
  import CimmichExperimentPrompt from '$lib/components/cimmich/CimmichExperimentPrompt.svelte';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import { cimmichVisibilityManager } from '$lib/managers/cimmich-visibility-manager.svelte';
  import { cimmichDiscoverExperiment } from '$lib/stores/cimmich-experience.store';
  import {
    getCimmichMemoryGraph,
    type CimmichMemoryGraph as MemoryGraph,
  } from '$lib/services/cimmich-discover.service';
  import { mdiCompassOutline, mdiGraphOutline } from '@mdi/js';
  import { Icon } from '@immich/ui';

  let errorMessage = $state('');
  let graph = $state<MemoryGraph>();
  let loaded = $state(false);
  let loadGeneration = 0;

  const load = async () => {
    const generation = ++loadGeneration;
    loaded = false;
    errorMessage = '';
    try {
      const next = await getCimmichMemoryGraph(72);
      if (generation === loadGeneration) {
        graph = next;
      }
    } catch (error) {
      if (generation === loadGeneration) {
        errorMessage = error instanceof Error ? error.message : 'Unable to load the memory web';
      }
    } finally {
      if (generation === loadGeneration) {
        loaded = true;
      }
    }
  };

  $effect(() => {
    void cimmichVisibilityManager.version;
    if (!$cimmichDiscoverExperiment) {
      loadGeneration += 1;
      graph = undefined;
      errorMessage = '';
      loaded = false;
      return;
    }
    void load();
  });
</script>

<UserPageLayout title="Discover">
  <div class="mx-auto w-full max-w-[1920px] px-3 pb-4 sm:px-4 lg:px-5">
    <header
      class="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 py-3 dark:border-gray-800"
    >
      <div class="flex items-center gap-3">
        <span class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon icon={mdiCompassOutline} size="21" />
        </span>
        <div>
          <h1 class="text-xl font-semibold tracking-tight sm:text-2xl">Discover</h1>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            Explore the web of People, Places, Events, Things and memories across your archive.
          </p>
        </div>
      </div>
      {#if graph}
        <div class="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <Icon icon={mdiGraphOutline} size="20" />
          {graph.nodes.length.toLocaleString()} nodes · {graph.edges.length.toLocaleString()} connections
        </div>
      {/if}
    </header>

    <section class="mt-2 grid gap-2" aria-label="Explore connections">
      {#if !$cimmichDiscoverExperiment}
        <CimmichExperimentPrompt />
      {:else if !loaded}
        <CimmichStatePanel
          title="Building your memory web…"
          description="Joining visible People, Places, Events, Things and their current evidence."
          tone="loading"
        />
      {:else if errorMessage}
        <CimmichStatePanel title="Memory web unavailable" description={errorMessage} tone="error">
          {#snippet action()}
            <button
              class="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-white dark:text-black"
              type="button"
              onclick={() => void load()}>Try again</button
            >
          {/snippet}
        </CimmichStatePanel>
      {:else if !graph?.nodes.length}
        <CimmichStatePanel
          title="No connected memories yet"
          description="The web grows from accepted shared photos and recorded Person, Place, Event and Thing connections."
        />
      {:else}
        <CimmichMemoryGraph {graph} />
      {/if}
    </section>
  </div>
</UserPageLayout>
