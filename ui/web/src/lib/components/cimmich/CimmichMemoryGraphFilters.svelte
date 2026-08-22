<script lang="ts">
  import type { CimmichMemoryGraphNode, CimmichMemoryGraphNodeKind } from '$lib/services/cimmich-discover.service';
  import { Icon } from '@immich/ui';
  import { mdiGraphOutline, mdiLinkVariant, mdiMagnify, mdiRefresh, mdiTuneVariant } from '@mdi/js';
  import type { CimmichMemoryGraphSpacing } from './memory-graph-layout';

  interface Props {
    activeKinds: CimmichMemoryGraphNodeKind[];
    availableKinds: CimmichMemoryGraphNodeKind[];
    compact: boolean;
    countsByKind: Record<CimmichMemoryGraphNodeKind, number>;
    graphSpacing: CimmichMemoryGraphSpacing;
    initialNodeKind?: CimmichMemoryGraphNodeKind;
    kindMeta: Record<CimmichMemoryGraphNodeKind, { color: string; icon: string; label: string; singular: string }>;
    nodes: CimmichMemoryGraphNode[];
    onarrange: () => void;
    onkind: (kind: CimmichMemoryGraphNodeKind) => void;
    onquery: (query: string) => void;
    onsearch: () => void;
    onspacing: (spacing: CimmichMemoryGraphSpacing) => void;
    ontoggleconnections: () => void;
    ontogglerelationshiplabels: () => void;
    query: string;
    showConnections: boolean;
    showRelationshipLabels: boolean;
  }

  let {
    activeKinds,
    availableKinds,
    compact,
    countsByKind,
    graphSpacing,
    initialNodeKind,
    kindMeta,
    nodes,
    onarrange,
    onkind,
    onquery,
    onsearch,
    onspacing,
    ontoggleconnections,
    ontogglerelationshiplabels,
    query,
    showConnections,
    showRelationshipLabels,
  }: Props = $props();
  const spacings: CimmichMemoryGraphSpacing[] = ['compact', 'balanced', 'roomy'];
</script>

<div class="absolute top-4 left-4 z-20 grid max-w-[calc(100%-2rem)] gap-2">
  <div
    hidden={compact}
    class="flex max-w-xl items-center gap-2 rounded-2xl border border-gray-200 bg-white/95 p-2 shadow-lg backdrop-blur-sm dark:border-gray-700 dark:bg-[#11141b]/95"
  >
    <Icon class="ml-1 text-gray-400" icon={mdiMagnify} size="20" />
    <input
      class="min-h-9 min-w-0 flex-1 bg-transparent px-1 text-sm outline-none"
      list="memory-graph-node-options"
      placeholder="Find within this view"
      value={query}
      oninput={(event) => onquery(event.currentTarget.value)}
      onkeydown={(event) => event.key === 'Enter' && onsearch()}
    />
    <button
      class="min-h-9 rounded-xl bg-primary px-3 text-sm font-semibold text-white dark:text-black"
      type="button"
      onclick={onsearch}>Find</button
    >
    <datalist id="memory-graph-node-options">
      {#each nodes as node (node.nodeId)}<option value={node.displayName}></option>{/each}
    </datalist>
  </div>
  <div
    hidden={compact}
    class="flex max-w-full flex-wrap gap-1.5 rounded-2xl border border-gray-200 bg-white/90 p-2 shadow-md backdrop-blur-sm dark:border-gray-700 dark:bg-[#11141b]/90"
    aria-label="Memory types"
  >
    {#each availableKinds as kind (kind)}
      <button
        class={[
          'inline-flex min-h-8 items-center gap-1.5 rounded-xl border px-2 text-[11px] font-normal transition',
          activeKinds.includes(kind) ? 'border-transparent' : 'bg-gray-100 opacity-50 dark:bg-white/10',
        ]}
        style:background-color={activeKinds.includes(kind) ? `${kindMeta[kind].color}22` : undefined}
        style:color={activeKinds.includes(kind) ? kindMeta[kind].color : undefined}
        type="button"
        disabled={compact && initialNodeKind === kind}
        aria-pressed={activeKinds.includes(kind)}
        title={compact && initialNodeKind === kind ? 'The central Person stays visible' : undefined}
        onclick={() => onkind(kind)}
      >
        <Icon icon={kindMeta[kind].icon} size="16" />
        {kindMeta[kind].label}
        <span class="opacity-70">{countsByKind[kind]}</span>
      </button>
    {/each}
    <span hidden={compact} class="mx-0.5 h-6 border-l border-gray-200 dark:border-gray-700"></span>
    <div hidden={compact} class="flex items-center gap-0.5" aria-label="Node spacing">
      <Icon class="mx-1 text-gray-400" icon={mdiTuneVariant} size="15" />
      {#each spacings as spacing (spacing)}
        <button
          class={[
            'min-h-7 rounded-lg px-1.5 text-[10px] capitalize transition',
            graphSpacing === spacing
              ? 'bg-gray-900 text-white dark:bg-white dark:text-black'
              : 'hover:bg-gray-100 dark:hover:bg-white/10',
          ]}
          type="button"
          aria-pressed={graphSpacing === spacing}
          onclick={() => onspacing(spacing)}>{spacing}</button
        >
      {/each}
    </div>
    <button
      class={[
        'inline-flex min-h-8 items-center gap-1.5 rounded-xl border px-2 text-[11px] font-normal transition',
        showConnections
          ? 'border-primary/30 bg-primary/10 text-primary'
          : 'border-gray-200 bg-white/70 text-gray-600 dark:border-gray-700 dark:bg-white/5 dark:text-gray-300',
      ]}
      type="button"
      aria-pressed={showConnections}
      onclick={ontoggleconnections}
    >
      <Icon icon={mdiGraphOutline} size="16" />Lines
    </button>
    <button
      class={[
        'inline-flex min-h-8 items-center gap-1.5 rounded-xl border px-2 text-[11px] font-normal transition',
        showRelationshipLabels
          ? 'border-primary/40 bg-primary/10 text-primary'
          : 'border-gray-200 bg-white/70 text-gray-600 dark:border-gray-700 dark:bg-white/5 dark:text-gray-300',
      ]}
      type="button"
      aria-label={`${showRelationshipLabels ? 'Hide' : 'Show'} relationship labels`}
      aria-pressed={showRelationshipLabels}
      title="Show the recorded relationship directly on Person-to-Person lines"
      onclick={ontogglerelationshiplabels}
    >
      <Icon icon={mdiLinkVariant} size="16" />Relationships
    </button>
    <button
      hidden={compact}
      class="flex size-8 items-center justify-center rounded-xl border border-gray-200 bg-white/70 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10"
      type="button"
      title="Arrange graph again"
      aria-label="Arrange graph again"
      onclick={onarrange}><Icon icon={mdiRefresh} size="16" /></button
    >
  </div>
</div>
