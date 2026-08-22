<script lang="ts">
  import { Route } from '$lib/route';
  import { cimmichDiscoverExperiment } from '$lib/stores/cimmich-experience.store';
  import {
    getCimmichMemoryGraph,
    type CimmichMemoryGraph as CimmichMemoryGraphData,
  } from '$lib/services/cimmich-discover.service';
  import { mdiRefresh } from '@mdi/js';
  import { Icon } from '@immich/ui';
  import CimmichMemoryGraph from './CimmichMemoryGraph.svelte';
  import CimmichExperimentPrompt from './CimmichExperimentPrompt.svelte';
  import {
    buildCimmichPersonDrilldownGraph,
    cimmichPersonGraphViewOptions,
    getCimmichPersonHiddenNeighbourCounts,
    projectCimmichPersonGraphView,
    type CimmichPersonGraphView,
  } from './person-connections';

  interface Props {
    graph: CimmichMemoryGraphData;
    personId: string;
    personName: string;
  }

  let { graph, personId, personName }: Props = $props();
  const initialNodeId = $derived(`person:${personId}`);
  let archiveGraph = $state<CimmichMemoryGraphData | null>(null);
  let expandedNodeIds = $state<string[]>([]);
  let graphView = $state<CimmichPersonGraphView>('people');
  let loading = $state(true);
  let error = $state('');
  let loadGeneration = 0;
  const drilldownGraph = $derived(
    buildCimmichPersonDrilldownGraph({ archiveGraph, baseGraph: graph, expandedNodeIds }),
  );
  const graphViewOptions = $derived(cimmichPersonGraphViewOptions(drilldownGraph));
  const projectedGraph = $derived(projectCimmichPersonGraphView(drilldownGraph, graphView));
  const projectedArchiveGraph = $derived(archiveGraph ? projectCimmichPersonGraphView(archiveGraph, graphView) : null);
  const hiddenNeighbourCounts = $derived(
    getCimmichPersonHiddenNeighbourCounts({
      archiveGraph: projectedArchiveGraph,
      graph: projectedGraph,
      initialNodeId,
    }),
  );
  const activeGraphView = $derived(graphViewOptions.find(({ value }) => value === graphView) ?? graphViewOptions[0]);

  const loadDrilldownGraph = async () => {
    const generation = ++loadGeneration;
    loading = true;
    error = '';
    try {
      const next = await getCimmichMemoryGraph(120);
      if (generation === loadGeneration) {
        archiveGraph = next;
      }
    } catch (error_) {
      if (generation === loadGeneration) {
        error = error_ instanceof Error ? error_.message : 'Deeper connections are unavailable.';
      }
    } finally {
      if (generation === loadGeneration) {
        loading = false;
      }
    }
  };
  const expandNode = (nodeId: string) => {
    if (!expandedNodeIds.includes(nodeId)) {
      expandedNodeIds = [...expandedNodeIds, nodeId];
    }
  };
  const resetWeb = () => {
    expandedNodeIds = [];
  };

  $effect(() => {
    if (!$cimmichDiscoverExperiment) {
      loadGeneration += 1;
      archiveGraph = null;
      loading = false;
      error = '';
      return;
    }
    void loadDrilldownGraph();
  });
</script>

{#if !$cimmichDiscoverExperiment}
  <CimmichExperimentPrompt compact />
{:else}
  <section class="grid gap-3" aria-labelledby="person-connection-web-heading">
    <div class="flex flex-wrap items-end justify-between gap-2 px-1">
      <div>
        <h2 class="text-sm font-normal" id="person-connection-web-heading">{personName}'s connection web</h2>
        <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          {graphView === 'people'
            ? 'People are the only points. Switch views to see contexts as labelled outlines.'
            : `People stay as points; ${activeGraphView?.label ?? 'contexts'} are shown as labelled outlines.`}
        </p>
      </div>
      <div class="flex min-h-10 items-center gap-3">
        {#if expandedNodeIds.length > 0}
          <button class="text-sm font-semibold text-primary hover:underline" type="button" onclick={resetWeb}>
            Reset to {personName}
          </button>
        {/if}
        <a class="text-sm font-semibold text-primary hover:underline" href={Route.cimmichDiscover()}
          >Open full Discover</a
        >
      </div>
    </div>
    {#if loading}
      <p class="px-1 text-xs text-gray-500 dark:text-gray-400" aria-live="polite">Finding connected relationships…</p>
    {:else if error}
      <div class="flex items-center gap-2 px-1 text-xs text-amber-700 dark:text-amber-300" role="status">
        <span>Direct connections are shown, but deeper relationships could not load.</span>
        <button
          class="inline-flex min-h-9 items-center gap-1 font-semibold hover:underline"
          type="button"
          onclick={loadDrilldownGraph}
        >
          <Icon icon={mdiRefresh} size="16" /> Retry
        </button>
      </div>
    {/if}
    <div class="flex min-w-0 items-center gap-1 overflow-x-auto px-1 pb-0.5" role="group" aria-label="Graph view">
      <span class="mr-1 shrink-0 text-[10px] font-normal tracking-wide text-gray-400 uppercase">View</span>
      {#each graphViewOptions as option (option.value)}
        <button
          class={[
            'inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-normal transition',
            graphView === option.value
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300',
          ]}
          type="button"
          aria-pressed={graphView === option.value}
          onclick={() => {
            graphView = option.value;
            expandedNodeIds = [];
          }}
        >
          <span>{option.label}</span><span class="text-[10px] opacity-60">{option.count}</span>
        </button>
      {/each}
    </div>
    {#key `${personId}:${graphView}`}
      <CimmichMemoryGraph
        compact
        expandableNodeCounts={hiddenNeighbourCounts}
        graph={projectedGraph}
        groupContextNodes={graphView !== 'people'}
        {initialNodeId}
        onexpand={expandNode}
        subjectName={personName}
      />
    {/key}
  </section>
{/if}
