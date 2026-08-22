<script lang="ts">
  import type { CimmichMemoryGraphEdge } from '$lib/services/cimmich-discover.service';
  import { isRecordedMemoryGraphEdge } from './memory-graph-analysis';
  import type { CimmichMemoryGraphLayoutNode } from './memory-graph-layout';

  interface Props {
    compact: boolean;
    edge: CimmichMemoryGraphEdge;
    edgeText: string;
    lineLabel: string;
    linePathId: string;
    onselectrelationship: (event: MouseEvent | PointerEvent | KeyboardEvent) => void;
    pathActive: boolean;
    pathVisible: boolean;
    relationshipLabelVisible: boolean;
    selected: boolean;
    selectedEdgeCount: number;
    selectedEdgeIndex: number;
    selectedNodeVisible: boolean;
    showConnections: boolean;
    showRelationshipLabels: boolean;
    source: CimmichMemoryGraphLayoutNode;
    sourceName: string;
    target: CimmichMemoryGraphLayoutNode;
    targetName: string;
    viewWidth: number;
  }

  let {
    compact,
    edge,
    edgeText,
    lineLabel,
    linePathId,
    onselectrelationship,
    pathActive,
    pathVisible,
    relationshipLabelVisible,
    selected,
    selectedEdgeCount,
    selectedEdgeIndex,
    selectedNodeVisible,
    showConnections,
    showRelationshipLabels,
    source,
    sourceName,
    target,
    targetName,
    viewWidth,
  }: Props = $props();

  const lineStart = $derived(source.x <= target.x ? source : target);
  const lineEnd = $derived(source.x <= target.x ? target : source);
</script>

<line
  x1={source.x}
  y1={source.y}
  x2={target.x}
  y2={target.y}
  stroke={pathActive ? '#6366f1' : selected ? '#cdd8ff' : isRecordedMemoryGraphEdge(edge) ? '#d39b37' : '#8290ad'}
  stroke-dasharray={isRecordedMemoryGraphEdge(edge) ? undefined : '8 7'}
  stroke-opacity={showConnections
    ? pathVisible
      ? pathActive
        ? 1
        : 0.08
      : selectedNodeVisible
        ? selected
          ? 0.9
          : 0.08
        : Math.min(0.6, 0.18 + edge.weight * 0.025)
    : 0}
  stroke-width={pathActive
    ? 5.5
    : selected
      ? Math.min(6, 1.8 + edge.weight * 0.24)
      : Math.min(4, 0.8 + edge.weight * 0.14)}><title>{edgeText}</title></line
>

{#if relationshipLabelVisible}
  <g class="cursor-pointer">
    <line
      x1={source.x}
      y1={source.y}
      x2={target.x}
      y2={target.y}
      stroke="transparent"
      stroke-width="18"
      pointer-events="stroke"
      role="button"
      tabindex="0"
      aria-label={`Relationship between ${sourceName} and ${targetName}: ${lineLabel}. Select to inspect.`}
      onpointerdown={onselectrelationship}
      onclick={onselectrelationship}
      onkeydown={onselectrelationship}
    ></line>
    <path id={linePathId} d={`M ${lineStart.x} ${lineStart.y} L ${lineEnd.x} ${lineEnd.y}`} fill="none"></path>
    <text
      class="pointer-events-none fill-gray-700 text-[5px] font-normal dark:fill-gray-200"
      dy="-3"
      style="paint-order: stroke; stroke: var(--immich-bg, #fff); stroke-width: 2px; stroke-linejoin: round;"
    >
      <textPath href={`#${linePathId}`} startOffset="50%" text-anchor="middle">{lineLabel}</textPath>
      <title>{lineLabel} · select to inspect</title></text
    >
  </g>
{/if}

{#if showConnections && !compact && selected && selectedEdgeCount <= 4 && viewWidth < 1100 && (!showRelationshipLabels || !lineLabel)}
  <text
    x={(source.x + target.x) / 2}
    y={(source.y + target.y) / 2 + (selectedEdgeIndex - (selectedEdgeCount - 1) / 2) * 15 - 6}
    text-anchor="middle"
    class="fill-gray-600 text-[6px] font-normal dark:fill-gray-300"
    style="paint-order: stroke; stroke: var(--immich-bg, #fff); stroke-width: 2.5px;">{edgeText}</text
  >
{/if}
