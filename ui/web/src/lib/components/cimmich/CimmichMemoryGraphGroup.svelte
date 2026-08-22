<script lang="ts">
  import { cimmichMemoryGraphGroupMeta, type CimmichMemoryGraphGroupOutline } from './memory-graph-groups';

  interface Props {
    active: boolean;
    dimmed: boolean;
    dragging: boolean;
    group: CimmichMemoryGraphGroupOutline;
    ondragstart: (event: PointerEvent) => void;
    onhover: (hovered: boolean) => void;
    onselect: () => void;
  }

  let { active, dimmed, dragging, group, ondragstart, onhover, onselect }: Props = $props();
  const meta = $derived(cimmichMemoryGraphGroupMeta(group.groupNode));
</script>

<g
  role="button"
  tabindex="0"
  aria-label={`${meta.label} group: ${group.groupNode.displayName}, ${group.memberNodeIds.length} members`}
  class:cursor-grabbing={dragging}
  class="cursor-grab outline-none"
  opacity={dimmed ? 0.14 : 1}
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
  <rect
    x={group.x}
    y={group.y}
    width={group.width}
    height={group.height}
    rx="28"
    fill={meta.color}
    fill-opacity={active ? 0.11 : 0.035}
    stroke={meta.color}
    stroke-opacity={active ? 1 : 0.72}
    stroke-width={active ? 4 : 2}
  ></rect>
  <g class="pointer-events-none">
    <rect x={group.x + 15} y={group.y + group.height - 9} width={group.labelWidth} height="18" rx="9" fill={meta.color}
    ></rect>
    <text x={group.x + 24} y={group.y + group.height + 3} class="fill-[#090b10] text-[6px] font-medium">
      {group.groupNode.displayName} · {meta.label}
    </text>
  </g>
</g>
