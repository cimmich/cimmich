<script lang="ts">
  import type { CimmichMemoryGraphLayoutNode } from './memory-graph-layout';
  import { cimmichMemoryGraphNodeSemanticLabel, cimmichMemoryGraphNodeShape } from './memory-graph-node-presentation';

  interface Props {
    active: boolean;
    color: string;
    dimmed: boolean;
    dragging: boolean;
    node: CimmichMemoryGraphLayoutNode;
    ondragstart: (event: PointerEvent) => void;
    onhover: (hovered: boolean) => void;
    onselect: () => void;
    pathNode: boolean;
    showLabel: boolean;
    singular: string;
  }

  let { active, color, dimmed, dragging, node, ondragstart, onhover, onselect, pathNode, showLabel, singular }: Props =
    $props();
  const shape = $derived(cimmichMemoryGraphNodeShape(node));
  const semanticLabel = $derived(cimmichMemoryGraphNodeSemanticLabel(node, singular));
  const initials = $derived(
    node.displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?',
  );
  const halo = $derived(active || pathNode ? 6 : 3);
</script>

<g
  role="button"
  tabindex="0"
  aria-label={`${semanticLabel}: ${node.displayName}, ${node.connectionCount} connections`}
  class:cursor-grabbing={dragging}
  class="cursor-grab outline-none"
  opacity={dimmed ? 0.18 : 1}
  onpointerdown={ondragstart}
  onpointerenter={() => onhover(true)}
  onpointerleave={() => onhover(false)}
  onkeydown={(event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onselect();
    }
  }}
>
  {#if shape === 'event'}
    <polygon
      points={`${node.x},${node.y - node.halfHeight - halo} ${node.x + node.halfWidth + halo},${node.y} ${node.x},${node.y + node.halfHeight + halo} ${node.x - node.halfWidth - halo},${node.y}`}
      fill={pathNode ? '#6366f1' : color}
      fill-opacity={active || pathNode ? 0.3 : 0.13}
    ></polygon>
    <polygon
      points={`${node.x},${node.y - node.halfHeight} ${node.x + node.halfWidth},${node.y} ${node.x},${node.y + node.halfHeight} ${node.x - node.halfWidth},${node.y}`}
      fill={color}
      stroke={active || pathNode ? '#ffffff' : color}
      stroke-width={active || pathNode ? 4 : 1.5}
    ></polygon>
    <text x={node.x} y={node.y + 2} text-anchor="middle" class="fill-[#090b10] text-[5.5px] font-medium"
      >{initials}</text
    >
  {:else}
    <circle
      cx={node.x}
      cy={node.y}
      r={node.radius + halo}
      fill={pathNode ? '#6366f1' : color}
      fill-opacity={active || pathNode ? 0.3 : 0.13}
    ></circle>
    <circle
      cx={node.x}
      cy={node.y}
      r={node.radius}
      fill={color}
      stroke={active || pathNode ? '#ffffff' : color}
      stroke-width={active || pathNode ? 4 : 1.5}
    ></circle>
    <text x={node.x} y={node.y + 2} text-anchor="middle" class="fill-[#090b10] text-[5.5px] font-medium"
      >{initials}</text
    >
  {/if}
  {#if showLabel}
    <text
      x={node.x}
      y={node.y + node.halfHeight + 11}
      text-anchor="middle"
      class="fill-gray-900 text-[6.5px] font-normal dark:fill-white"
      style="paint-order: stroke; stroke: var(--immich-bg, #fff); stroke-width: 2.75px; stroke-linejoin: round;"
      >{node.displayName.length > 28 ? `${node.displayName.slice(0, 26)}…` : node.displayName}</text
    >
  {/if}
</g>
