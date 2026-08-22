<script lang="ts">
  import type { CimmichMemoryGraphEdge, CimmichMemoryGraphNode } from '$lib/services/cimmich-discover.service';
  import { mdiClose, mdiEyeOutline, mdiVectorPolyline } from '@mdi/js';
  import { Icon } from '@immich/ui';
  import type { CimmichMemoryGraphAnalysis, CimmichMemoryGraphLens } from './memory-graph-analysis';
  import { memoryGraphEdgeLabel } from './memory-graph-relationships';

  interface Props {
    activeLens: CimmichMemoryGraphLens;
    analysis: CimmichMemoryGraphAnalysis;
    nodeById: Map<string, CimmichMemoryGraphNode>;
    onclose: () => void;
    onlens: (lens: CimmichMemoryGraphLens) => void;
    onrevealedge: (edge: CimmichMemoryGraphEdge, lens: CimmichMemoryGraphLens) => void;
    onrevealnode: (nodeId: string, lens?: CimmichMemoryGraphLens) => void;
    strongestEdges: CimmichMemoryGraphEdge[];
  }

  let { activeLens, analysis, nodeById, onclose, onlens, onrevealedge, onrevealnode, strongestEdges }: Props = $props();
</script>

<section aria-labelledby="analysis-heading">
  <div class="flex items-center justify-between gap-2">
    <h3 class="flex items-center gap-2 text-sm font-normal" id="analysis-heading">
      <Icon class="text-primary" icon={mdiEyeOutline} size="18" />Insights
    </h3>
    <button
      class="flex size-8 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-white/10"
      type="button"
      aria-label="Close insights"
      onclick={onclose}><Icon icon={mdiClose} size="17" /></button
    >
  </div>
  <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Useful starting points calculated from this view.</p>
  <div class="mt-2 grid gap-1 border-b border-gray-200 pb-3 dark:border-gray-700">
    {#if analysis.topConnector}
      <button
        class="rounded-xl p-2 text-left hover:bg-gray-100 dark:hover:bg-white/10"
        type="button"
        onclick={() => onrevealnode(analysis.topConnector!.nodeId)}
      >
        <span class="block text-[10px] text-gray-500 dark:text-gray-400">Who connects the archive?</span>
        <span class="block truncate text-xs font-normal">{analysis.topConnector.displayName}</span>
      </button>
    {/if}
    {#if analysis.topPlace}
      <button
        class="rounded-xl p-2 text-left hover:bg-gray-100 dark:hover:bg-white/10"
        type="button"
        onclick={() => onrevealnode(analysis.topPlace!.node.nodeId, 'places')}
      >
        <span class="block text-[10px] text-gray-500 dark:text-gray-400">Which Place brings People together?</span>
        <span class="block truncate text-xs font-normal">{analysis.topPlace.node.displayName}</span>
      </button>
    {/if}
    <button
      class="rounded-xl p-2 text-left hover:bg-gray-100 dark:hover:bg-white/10"
      type="button"
      onclick={() => onlens('recorded')}
    >
      <span class="block text-[10px] text-gray-500 dark:text-gray-400">What is explicitly recorded?</span>
      <span class="block text-xs font-normal">{analysis.recordedEdgeCount} recorded links</span>
    </button>
  </div>
  <p class="mt-1 text-[10px] tracking-wide text-gray-500 uppercase dark:text-gray-400">Strongest visible links</p>
  <div class="grid gap-1">
    {#each strongestEdges as edge (edge.edgeId)}
      <button
        class="grid min-h-14 grid-cols-[1fr_auto] items-center gap-2 rounded-xl px-2 text-left hover:bg-gray-100 dark:hover:bg-white/10"
        type="button"
        onclick={() => onrevealedge(edge, activeLens)}
      >
        <span class="min-w-0">
          <span class="block truncate text-xs font-normal">
            {nodeById.get(edge.sourceNodeId)?.displayName} ↔ {nodeById.get(edge.targetNodeId)?.displayName}
          </span>
          <span class="block truncate text-xs text-gray-500 dark:text-gray-400">{memoryGraphEdgeLabel(edge)}</span>
        </span>
        <Icon class="text-gray-400" icon={mdiVectorPolyline} size="18" />
      </button>
    {/each}
  </div>
</section>
