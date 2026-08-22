<script lang="ts">
  import type {
    CimmichMemoryGraph,
    CimmichMemoryGraphEdge,
    CimmichMemoryGraphNodeKind,
  } from '$lib/services/cimmich-discover.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import {
    mdiAccount,
    mdiAccountMultipleOutline,
    mdiArrowLeft,
    mdiCalendarBlankOutline,
    mdiChevronDown,
    mdiClose,
    mdiCubeOutline,
    mdiGraphOutline,
    mdiEyeOffOutline,
    mdiEyeOutline,
    mdiImageMultipleOutline,
    mdiLinkVariant,
    mdiMapMarkerOutline,
    mdiMapSearchOutline,
    mdiOpenInNew,
    mdiPawOutline,
    mdiTargetVariant,
    mdiVectorPolyline,
  } from '@mdi/js';
  import { Icon } from '@immich/ui';
  import CimmichMemoryGraphEdgeLine from './CimmichMemoryGraphEdgeLine.svelte';
  import CimmichMemoryGraphGroup from './CimmichMemoryGraphGroup.svelte';
  import CimmichMemoryGraphNode from './CimmichMemoryGraphNode.svelte';
  import CimmichMemoryGraphInsights from './CimmichMemoryGraphInsights.svelte';
  import CimmichMemoryGraphFilters from './CimmichMemoryGraphFilters.svelte';
  import CimmichMemoryGraphToolbar from './CimmichMemoryGraphToolbar.svelte';
  import CimmichMemoryGraphFocusNotice from './CimmichMemoryGraphFocusNotice.svelte';
  import CimmichMemoryGraphZoomControls from './CimmichMemoryGraphZoomControls.svelte';
  import {
    analyzeCimmichMemoryGraph,
    filterCimmichMemoryGraph,
    shortestCimmichMemoryGraphPath,
    type CimmichMemoryGraphLens,
  } from './memory-graph-analysis';
  import {
    cimmichMemoryGraphGroupContextNodeIds,
    cimmichMemoryGraphGroupOutlines,
    cimmichMemoryGraphMembershipEdgeIds,
  } from './memory-graph-groups';
  import {
    cimmichMemoryGraphBounds,
    cimmichMemoryGraphViewBox,
    layoutCimmichMemoryGraph,
    type CimmichMemoryGraphLayoutNode,
    type CimmichMemoryGraphSpacing,
  } from './memory-graph-layout';
  import {
    cimmichMemoryGraphNodeDetailLabel,
    cimmichMemoryGraphNodeHref,
    cimmichMemoryGraphNodeSemanticLabel,
  } from './memory-graph-node-presentation';
  import {
    memoryGraphEdgeLabel as edgeLabel,
    memoryGraphRelationshipLineLabel,
    memoryGraphRelationshipPathId as relationshipLinePathId,
  } from './memory-graph-relationships';
  import {
    filterCimmichMemoryGraphEventTypes,
    memoryGraphEventType,
    memoryGraphEventTypes,
    memoryGraphSectionKinds,
    memoryGraphSectionNodes,
  } from './memory-graph-sections';

  interface Props {
    compact?: boolean;
    expandableNodeCounts?: Record<string, number>;
    graph: CimmichMemoryGraph;
    groupContextNodes?: boolean;
    initialNodeId?: string;
    onexpand?: (nodeId: string) => void;
    subjectName?: string;
  }

  const kindMeta: Record<CimmichMemoryGraphNodeKind, { color: string; icon: string; label: string; singular: string }> =
    {
      event: { color: '#f59e0b', icon: mdiCalendarBlankOutline, label: 'Events & periods', singular: 'Event' },
      object: { color: '#c084fc', icon: mdiCubeOutline, label: 'Things', singular: 'Thing' },
      person: { color: '#84a7ff', icon: mdiAccount, label: 'People', singular: 'Person' },
      pet: { color: '#fb7185', icon: mdiPawOutline, label: 'Pets', singular: 'Pet' },
      place: { color: '#4ade80', icon: mdiMapMarkerOutline, label: 'Places', singular: 'Place' },
    };
  const graphKinds = Object.keys(kindMeta) as CimmichMemoryGraphNodeKind[];
  const lensMeta: Record<CimmichMemoryGraphLens, { description: string; icon: string; label: string }> = {
    overview: { description: 'Every visible connection in this web', icon: mdiGraphOutline, label: 'Overview' },
    people: {
      description: 'Connections between People and Pets',
      icon: mdiAccountMultipleOutline,
      label: 'People & bonds',
    },
    places: { description: 'Who and what each Place connects', icon: mdiMapSearchOutline, label: 'Places' },
    recorded: {
      description: 'Relationships and hierarchy you explicitly recorded',
      icon: mdiLinkVariant,
      label: 'Recorded',
    },
  };

  let {
    compact = false,
    expandableNodeCounts = {},
    graph,
    groupContextNodes = false,
    initialNodeId = '',
    onexpand,
    subjectName = '',
  }: Props = $props();
  const availableKinds = $derived(graphKinds.filter((kind) => graph.countsByKind[kind] > 0));
  // Keep every kind enabled in compact mode even before drill-down adds it.
  // Discover uses a stable graph and narrows this list through its lenses.
  let activeKinds = $state<CimmichMemoryGraphNodeKind[]>([...graphKinds]);
  let activeLens = $state<CimmichMemoryGraphLens>('overview');
  let query = $state('');
  // `initialNodeId` seeds the compact person graph; later selection is deliberately local.
  // svelte-ignore state_referenced_locally
  let selectedNodeId = $state(initialNodeId);
  let focusNodeId = $state('');
  let pathStartNodeId = $state('');
  let pathTargetNodeId = $state('');
  let viewX = $state(0);
  let viewY = $state(0);
  let viewWidth = $state(cimmichMemoryGraphBounds.width);
  let viewHeight = $state(cimmichMemoryGraphBounds.height);
  let panning = $state(false);
  let showRelationshipLabels = $state(false);
  let showConnections = $state(true);
  let graphSpacing = $state<CimmichMemoryGraphSpacing>('balanced');
  let analysisOpen = $state(false);
  let hiddenEventTypes = $state<string[]>([]);
  let openCompactSections = $state<CimmichMemoryGraphNodeKind[]>(['event']);
  let hoveredNodeId = $state('');
  let draggingNodeId = $state('');
  let draggingGroupNodeIds = $state<string[]>([]);
  let nodePositions = $state<Record<string, { x: number; y: number }>>({});
  let nodeDragMoved = false;
  let panMoved = false;
  let panClientX = 0;
  let panClientY = 0;
  let svgElement: SVGSVGElement;
  let fittedGraphKey = '';

  const analysis = $derived(analyzeCimmichMemoryGraph(graph));
  const graphNodeById = $derived(new Map(graph.nodes.map((node) => [node.nodeId, node])));
  const typeFilteredGraph = $derived(filterCimmichMemoryGraphEventTypes(graph, hiddenEventTypes));
  const visibleGraph = $derived(filterCimmichMemoryGraph(typeFilteredGraph, activeLens, activeKinds, focusNodeId));
  const visibleNodes = $derived(visibleGraph.nodes);
  const visibleEdges = $derived(visibleGraph.edges);
  const visibleNodeIds = $derived(new Set(visibleNodes.map(({ nodeId }) => nodeId)));
  const layoutNodes = $derived(
    layoutCimmichMemoryGraph(visibleNodes, visibleEdges, graphSpacing).map((node) => {
      const position = nodePositions[node.nodeId];
      return position ? { ...node, ...position } : node;
    }),
  );
  const layoutById = $derived(new Map(layoutNodes.map((node) => [node.nodeId, node])));
  const forcedGroupNodeIds = $derived(
    new Set(groupContextNodes ? visibleNodes.filter((node) => node.kind !== 'person').map(({ nodeId }) => nodeId) : []),
  );
  const contextGroups = $derived(cimmichMemoryGraphGroupOutlines(layoutNodes, visibleEdges, forcedGroupNodeIds));
  const groupNodeIds = $derived(new Set(contextGroups.map(({ groupNode }) => groupNode.nodeId)));
  const membershipEdgeIds = $derived(
    cimmichMemoryGraphMembershipEdgeIds(layoutNodes, visibleEdges, forcedGroupNodeIds),
  );
  const renderedEdges = $derived(visibleEdges.filter(({ edgeId }) => !membershipEdgeIds.has(edgeId)));
  const renderedLayoutNodes = $derived(layoutNodes.filter(({ nodeId }) => !groupNodeIds.has(nodeId)));
  const selectedNode = $derived(layoutById.get(selectedNodeId));
  const selectedHiddenNeighbourCount = $derived(selectedNode ? (expandableNodeCounts[selectedNode.nodeId] ?? 0) : 0);
  const selectedEdges = $derived(
    selectedNode
      ? visibleEdges
          .filter((edge) => edge.sourceNodeId === selectedNode.nodeId || edge.targetNodeId === selectedNode.nodeId)
          .sort((left, right) => right.weight - left.weight || left.edgeId.localeCompare(right.edgeId))
      : [],
  );
  const selectedRenderedEdges = $derived(selectedEdges.filter(({ edgeId }) => !membershipEdgeIds.has(edgeId)));
  const selectedNeighbourIds = $derived(
    new Set(selectedEdges.flatMap(({ sourceNodeId, targetNodeId }) => [sourceNodeId, targetNodeId])),
  );
  const hoveredNeighbourIds = $derived(
    new Set(
      visibleEdges
        .filter((edge) => edge.sourceNodeId === hoveredNodeId || edge.targetNodeId === hoveredNodeId)
        .flatMap(({ sourceNodeId, targetNodeId }) => [sourceNodeId, targetNodeId]),
    ),
  );
  const selectedGroupContextNodeIds = $derived(cimmichMemoryGraphGroupContextNodeIds(contextGroups, selectedNodeId));
  const hoveredGroupContextNodeIds = $derived(cimmichMemoryGraphGroupContextNodeIds(contextGroups, hoveredNodeId));
  const path = $derived(
    pathStartNodeId && pathTargetNodeId
      ? shortestCimmichMemoryGraphPath(visibleEdges, pathStartNodeId, pathTargetNodeId)
      : null,
  );
  const pathNodeIds = $derived(new Set(path?.nodeIds));
  const pathEdgeIds = $derived(new Set(path?.edgeIds));
  const visibleRelationshipLabelIds = $derived.by(() => {
    if (!showConnections || !showRelationshipLabels) {
      return new Set<string>();
    }

    const candidates = renderedEdges
      .filter((edge) => {
        const hasLabel = Boolean(memoryGraphRelationshipLineLabel(edge, graphNodeById));
        const locallyRelevant =
          edge.sourceNodeId === selectedNodeId ||
          edge.targetNodeId === selectedNodeId ||
          edge.sourceNodeId === hoveredNodeId ||
          edge.targetNodeId === hoveredNodeId ||
          pathEdgeIds.has(edge.edgeId);
        return hasLabel && (viewWidth < 980 || locallyRelevant);
      })
      .sort((left, right) => {
        const priority = (edge: CimmichMemoryGraphEdge) =>
          (pathEdgeIds.has(edge.edgeId) ? 4 : 0) +
          (edge.sourceNodeId === hoveredNodeId || edge.targetNodeId === hoveredNodeId ? 2 : 0) +
          (edge.sourceNodeId === selectedNodeId || edge.targetNodeId === selectedNodeId ? 1 : 0);
        return (
          priority(right) - priority(left) || right.weight - left.weight || left.edgeId.localeCompare(right.edgeId)
        );
      });
    const occupied: Array<{ bottom: number; left: number; right: number; top: number }> = [];
    const visible: string[] = [];

    for (const edge of candidates) {
      const source = layoutById.get(edge.sourceNodeId);
      const target = layoutById.get(edge.targetNodeId);
      if (!source || !target) {
        continue;
      }
      const label = memoryGraphRelationshipLineLabel(edge, graphNodeById);
      const angle = Math.atan2(target.y - source.y, target.x - source.x);
      const textWidth = Math.min(300, label.length * 3.1 + 12);
      const textHeight = 11;
      const projectedWidth = Math.abs(Math.cos(angle)) * textWidth + Math.abs(Math.sin(angle)) * textHeight;
      const projectedHeight = Math.abs(Math.sin(angle)) * textWidth + Math.abs(Math.cos(angle)) * textHeight;
      const centerX = (source.x + target.x) / 2;
      const centerY = (source.y + target.y) / 2;
      const margin = 7;
      const box = {
        bottom: centerY + projectedHeight / 2 + margin,
        left: centerX - projectedWidth / 2 - margin,
        right: centerX + projectedWidth / 2 + margin,
        top: centerY - projectedHeight / 2 - margin,
      };
      const collides = occupied.some(
        (candidate) =>
          box.left < candidate.right &&
          box.right > candidate.left &&
          box.top < candidate.bottom &&
          box.bottom > candidate.top,
      );
      if (!collides) {
        occupied.push(box);
        visible.push(edge.edgeId);
      }
    }

    return new Set(visible);
  });
  const strongestVisibleEdges = $derived(
    [...visibleEdges]
      .sort(
        (left, right) =>
          right.photoCount - left.photoCount || right.weight - left.weight || left.edgeId.localeCompare(right.edgeId),
      )
      .slice(0, 7),
  );
  const compactSectionNodes = $derived(
    Object.fromEntries(memoryGraphSectionKinds.map((kind) => [kind, memoryGraphSectionNodes(graph, kind)])) as Record<
      CimmichMemoryGraphNodeKind,
      CimmichMemoryGraph['nodes']
    >,
  );

  $effect(() => {
    if (selectedNodeId && !visibleNodeIds.has(selectedNodeId)) {
      selectedNodeId = '';
    }
    if (
      (pathStartNodeId && !visibleNodeIds.has(pathStartNodeId)) ||
      (pathTargetNodeId && !visibleNodeIds.has(pathTargetNodeId))
    ) {
      pathStartNodeId = '';
      pathTargetNodeId = '';
    }
  });

  $effect(() => {
    const graphKey = `${activeLens}|${activeKinds.join(',')}|${focusNodeId}|${visibleNodes.map(({ nodeId }) => nodeId).join(',')}`;
    if (graphKey !== fittedGraphKey) {
      fittedGraphKey = graphKey;
      requestAnimationFrame(fitGraph);
    }
  });

  const relationshipLineLabel = (edge: CimmichMemoryGraphEdge) => memoryGraphRelationshipLineLabel(edge, graphNodeById);
  const oppositeNode = (edge: CimmichMemoryGraphEdge) =>
    layoutById.get(edge.sourceNodeId === selectedNodeId ? edge.targetNodeId : edge.sourceNodeId);
  const isSelectedEdge = (edge: CimmichMemoryGraphEdge) =>
    Boolean(selectedNode && (edge.sourceNodeId === selectedNode.nodeId || edge.targetNodeId === selectedNode.nodeId));
  const resetPath = () => {
    pathStartNodeId = '';
    pathTargetNodeId = '';
  };
  const fitGraph = () => {
    const fitted = cimmichMemoryGraphViewBox(layoutNodes, compact ? 72 : 110);
    viewX = fitted.x;
    viewY = fitted.y;
    viewWidth = fitted.width;
    viewHeight = fitted.height;
  };
  const selectNode = (nodeId: string) => {
    if (pathStartNodeId && !pathTargetNodeId && nodeId !== pathStartNodeId) {
      pathTargetNodeId = nodeId;
    }
    selectedNodeId = nodeId;
    analysisOpen = !compact;
    const node = layoutById.get(nodeId);
    if (!node) {
      return;
    }
    if (viewWidth > 760) {
      viewWidth = 760;
      viewHeight = (760 / cimmichMemoryGraphBounds.width) * cimmichMemoryGraphBounds.height;
    }
    viewX = node.x - viewWidth / 2;
    viewY = node.y - viewHeight / 2;
  };
  const selectSearchResult = () => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) {
      return;
    }
    const match = visibleNodes
      .filter((node) => node.displayName.toLocaleLowerCase().includes(normalized))
      .sort(
        (left, right) =>
          Number(right.displayName.toLocaleLowerCase() === normalized) -
            Number(left.displayName.toLocaleLowerCase() === normalized) || right.connectionCount - left.connectionCount,
      )[0];
    if (match) {
      selectNode(match.nodeId);
    }
  };
  const toggleKind = (kind: CimmichMemoryGraphNodeKind) => {
    if (compact && graphNodeById.get(initialNodeId)?.kind === kind) {
      return;
    }
    if (activeKinds.includes(kind)) {
      if (availableKinds.filter((candidate) => activeKinds.includes(candidate)).length > 1) {
        activeKinds = activeKinds.filter((candidate) => candidate !== kind);
      }
    } else {
      activeKinds = [...activeKinds, kind];
    }
    focusNodeId = '';
    resetPath();
  };
  const toggleCompactSection = (kind: CimmichMemoryGraphNodeKind) => {
    openCompactSections = openCompactSections.includes(kind)
      ? openCompactSections.filter((candidate) => candidate !== kind)
      : [...openCompactSections, kind];
  };
  const toggleEventType = (typeKind: string) => {
    hiddenEventTypes = hiddenEventTypes.includes(typeKind)
      ? hiddenEventTypes.filter((candidate) => candidate !== typeKind)
      : [...hiddenEventTypes, typeKind];
    focusNodeId = '';
    resetPath();
  };
  const selectCompactSectionNode = (nodeId: string) => {
    const node = graphNodeById.get(nodeId);
    if (!node) {
      return;
    }
    if (!activeKinds.includes(node.kind)) {
      activeKinds = [...activeKinds, node.kind];
    }
    if (node.kind === 'event') {
      hiddenEventTypes = hiddenEventTypes.filter((typeKind) => typeKind !== memoryGraphEventType(node));
    }
    requestAnimationFrame(() => selectNode(nodeId));
  };
  const applyLens = (lens: CimmichMemoryGraphLens) => {
    activeLens = lens;
    activeKinds = [...availableKinds];
    selectedNodeId = '';
    focusNodeId = '';
    resetPath();
    requestAnimationFrame(fitGraph);
  };
  const revealNode = (nodeId: string, lens: CimmichMemoryGraphLens = 'overview') => {
    applyLens(lens);
    selectNode(nodeId);
  };
  const revealEdge = (edge: CimmichMemoryGraphEdge, lens: CimmichMemoryGraphLens = 'overview') => {
    applyLens(lens);
    pathStartNodeId = edge.sourceNodeId;
    pathTargetNodeId = edge.targetNodeId;
    selectNode(edge.sourceNodeId);
  };
  const selectRelationshipEdge = (event: MouseEvent | PointerEvent | KeyboardEvent, edge: CimmichMemoryGraphEdge) => {
    if (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    pathStartNodeId = edge.sourceNodeId;
    pathTargetNodeId = edge.targetNodeId;
    selectNode(edge.sourceNodeId);
  };
  const focusSelectedNode = () => {
    if (!selectedNodeId) {
      return;
    }
    focusNodeId = selectedNodeId;
    resetPath();
    requestAnimationFrame(fitGraph);
  };
  const arrangeGraph = () => {
    nodePositions = {};
    requestAnimationFrame(fitGraph);
  };
  const setGraphSpacing = (spacing: CimmichMemoryGraphSpacing) => {
    graphSpacing = spacing;
    nodePositions = {};
  };
  const shouldShowNodeLabel = (node: CimmichMemoryGraphLayoutNode) =>
    node.nodeId === selectedNodeId ||
    node.nodeId === hoveredNodeId ||
    selectedNeighbourIds.has(node.nodeId) ||
    hoveredNeighbourIds.has(node.nodeId) ||
    selectedGroupContextNodeIds.has(node.nodeId) ||
    hoveredGroupContextNodeIds.has(node.nodeId) ||
    pathNodeIds.has(node.nodeId) ||
    viewWidth < 1040 ||
    (viewWidth < 1450 && node.connectionCount > 1) ||
    node.connectionCount >= 5;
  const shouldShowRelationshipLabel = (edge: CimmichMemoryGraphEdge) => visibleRelationshipLabelIds.has(edge.edgeId);
  const startPath = () => {
    pathStartNodeId = selectedNodeId;
    pathTargetNodeId = '';
  };
  const scaleView = (factor: number, centerX = viewX + viewWidth / 2, centerY = viewY + viewHeight / 2) => {
    const nextWidth = Math.max(320, Math.min(2200, viewWidth * factor));
    const nextHeight = (nextWidth / cimmichMemoryGraphBounds.width) * cimmichMemoryGraphBounds.height;
    const ratioX = (centerX - viewX) / viewWidth;
    const ratioY = (centerY - viewY) / viewHeight;
    viewX = centerX - nextWidth * ratioX;
    viewY = centerY - nextHeight * ratioY;
    viewWidth = nextWidth;
    viewHeight = nextHeight;
  };
  const zoomGraph = (event: WheelEvent) => {
    event.preventDefault();
    const bounds = svgElement.getBoundingClientRect();
    const centerX = viewX + ((event.clientX - bounds.left) / bounds.width) * viewWidth;
    const centerY = viewY + ((event.clientY - bounds.top) / bounds.height) * viewHeight;
    scaleView(event.deltaY < 0 ? 0.84 : 1.18, centerX, centerY);
  };
  const beginPan = (event: PointerEvent) => {
    if (event.button !== 0) {
      return;
    }
    panning = true;
    panMoved = false;
    panClientX = event.clientX;
    panClientY = event.clientY;
  };
  const beginNodeDrag = (event: PointerEvent, nodeId: string) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    draggingNodeId = nodeId;
    draggingGroupNodeIds = [];
    nodeDragMoved = false;
    panClientX = event.clientX;
    panClientY = event.clientY;
  };
  const beginGroupDrag = (event: PointerEvent, groupNodeId: string, memberNodeIds: string[]) => {
    beginNodeDrag(event, groupNodeId);
    draggingGroupNodeIds = [groupNodeId, ...memberNodeIds];
  };
  const moveGraph = (event: PointerEvent) => {
    if (draggingNodeId) {
      const bounds = svgElement.getBoundingClientRect();
      const deltaClientX = event.clientX - panClientX;
      const deltaClientY = event.clientY - panClientY;
      const draggedNodeIds = draggingGroupNodeIds.length > 0 ? draggingGroupNodeIds : [draggingNodeId];
      if (draggedNodeIds.some((nodeId) => layoutById.has(nodeId))) {
        nodeDragMoved ||= Math.hypot(deltaClientX, deltaClientY) > 2;
        const nextPositions = { ...nodePositions };
        for (const nodeId of draggedNodeIds) {
          const node = layoutById.get(nodeId);
          if (node) {
            nextPositions[nodeId] = {
              x: Math.max(
                24,
                Math.min(cimmichMemoryGraphBounds.width - 24, node.x + (deltaClientX / bounds.width) * viewWidth),
              ),
              y: Math.max(
                24,
                Math.min(cimmichMemoryGraphBounds.height - 24, node.y + (deltaClientY / bounds.height) * viewHeight),
              ),
            };
          }
        }
        nodePositions = nextPositions;
      }
      panClientX = event.clientX;
      panClientY = event.clientY;
      return;
    }
    if (!panning) {
      return;
    }
    const bounds = svgElement.getBoundingClientRect();
    panMoved ||= Math.hypot(event.clientX - panClientX, event.clientY - panClientY) > 2;
    viewX -= ((event.clientX - panClientX) / bounds.width) * viewWidth;
    viewY -= ((event.clientY - panClientY) / bounds.height) * viewHeight;
    panClientX = event.clientX;
    panClientY = event.clientY;
  };
  const endGraphPointer = () => {
    if (draggingNodeId && !nodeDragMoved) {
      selectNode(draggingNodeId);
    }
    if (panning && !panMoved) {
      selectedNodeId = compact ? initialNodeId : '';
      analysisOpen = false;
      resetPath();
    }
    draggingNodeId = '';
    draggingGroupNodeIds = [];
    panning = false;
  };
</script>

<svelte:window onpointermove={moveGraph} onpointerup={endGraphPointer} />

<div class="grid gap-4">
  {#if !compact}
    <CimmichMemoryGraphToolbar
      {activeLens}
      {analysisOpen}
      {lensMeta}
      onanalysis={() => (analysisOpen = !analysisOpen)}
      onlens={applyLens}
      visibleEdges={visibleEdges.length}
      visibleNodes={visibleNodes.length}
    />
  {/if}

  {#if focusNodeId || (pathStartNodeId && !pathTargetNodeId)}
    <CimmichMemoryGraphFocusNotice
      focusNodeName={graphNodeById.get(focusNodeId)?.displayName}
      lensLabel={lensMeta[activeLens].label}
      onclearfocus={() => {
        focusNodeId = '';
        fitGraph();
      }}
      onresetpath={resetPath}
      pathStartName={graphNodeById.get(pathStartNodeId)?.displayName}
    />
  {/if}

  <div class={compact ? 'grid gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]' : 'relative'}>
    <div
      class={[
        'relative overflow-hidden rounded-3xl border border-gray-200 bg-[#f8f9fc] shadow-inner dark:border-immich-dark-gray dark:bg-[#090b10]',
        compact ? 'h-[min(38rem,calc(100vh-17rem))] min-h-120' : 'h-[min(72rem,calc(100vh-11.5rem))] min-h-[700px]',
      ]}
    >
      <CimmichMemoryGraphFilters
        {activeKinds}
        {availableKinds}
        {compact}
        countsByKind={graph.countsByKind}
        {graphSpacing}
        initialNodeKind={graphNodeById.get(initialNodeId)?.kind}
        {kindMeta}
        nodes={visibleNodes}
        onarrange={arrangeGraph}
        onkind={toggleKind}
        onquery={(value) => (query = value)}
        onsearch={selectSearchResult}
        onspacing={setGraphSpacing}
        ontoggleconnections={() => (showConnections = !showConnections)}
        ontogglerelationshiplabels={() => (showRelationshipLabels = !showRelationshipLabels)}
        {query}
        {showConnections}
        {showRelationshipLabels}
      />

      <CimmichMemoryGraphZoomControls
        onfit={fitGraph}
        onzoomin={() => scaleView(0.82)}
        onzoomout={() => scaleView(1.2)}
      />

      <svg
        class:cursor-grabbing={panning}
        class="size-full cursor-grab touch-none select-none"
        bind:this={svgElement}
        viewBox={`${viewX} ${viewY} ${viewWidth} ${viewHeight}`}
        aria-label={`${lensMeta[activeLens].label} memory graph with ${visibleNodes.length} memories and ${visibleEdges.length} connections`}
        onwheel={zoomGraph}
      >
        <rect
          width="2400"
          height="1440"
          x="-600"
          y="-360"
          fill="transparent"
          role="application"
          aria-label="Drag to pan the memory graph"
          onpointerdown={beginPan}
        ></rect>
        <g>
          {#each contextGroups as group (group.groupNode.nodeId)}
            {@const active = selectedNodeId === group.groupNode.nodeId}
            {@const selectedContext = active || group.memberNodeIds.includes(selectedNodeId)}
            {@const hoveredContext =
              hoveredNodeId === group.groupNode.nodeId || group.memberNodeIds.includes(hoveredNodeId)}
            {@const pathContext =
              pathNodeIds.has(group.groupNode.nodeId) || group.memberNodeIds.some((nodeId) => pathNodeIds.has(nodeId))}
            <CimmichMemoryGraphGroup
              {active}
              dimmed={path?.nodeIds.length
                ? !pathContext
                : selectedNode
                  ? !selectedContext
                  : Boolean(hoveredNodeId && !hoveredContext)}
              dragging={draggingNodeId === group.groupNode.nodeId}
              {group}
              ondragstart={(event) => beginGroupDrag(event, group.groupNode.nodeId, group.memberNodeIds)}
              onhover={(hovered) => (hoveredNodeId = hovered ? group.groupNode.nodeId : '')}
              onselect={() => selectNode(group.groupNode.nodeId)}
            />
          {/each}
        </g>
        <g>
          {#each renderedEdges as edge (edge.edgeId)}
            {@const source = layoutById.get(edge.sourceNodeId)}
            {@const target = layoutById.get(edge.targetNodeId)}
            {@const pathEdge = pathEdgeIds.has(edge.edgeId)}
            {#if source && target}
              <CimmichMemoryGraphEdgeLine
                {compact}
                {edge}
                edgeText={edgeLabel(edge)}
                lineLabel={relationshipLineLabel(edge)}
                linePathId={relationshipLinePathId(edge)}
                onselectrelationship={(event) => selectRelationshipEdge(event, edge)}
                pathActive={pathEdge}
                pathVisible={Boolean(path?.nodeIds.length)}
                relationshipLabelVisible={shouldShowRelationshipLabel(edge)}
                selected={isSelectedEdge(edge)}
                selectedEdgeCount={selectedRenderedEdges.length}
                selectedEdgeIndex={selectedRenderedEdges.findIndex((candidate) => candidate.edgeId === edge.edgeId)}
                selectedNodeVisible={Boolean(selectedNode)}
                {showConnections}
                {showRelationshipLabels}
                {source}
                sourceName={graphNodeById.get(edge.sourceNodeId)?.displayName ?? 'Person'}
                {target}
                targetName={graphNodeById.get(edge.targetNodeId)?.displayName ?? 'Person'}
                {viewWidth}
              />
            {/if}
          {/each}
        </g>
        <g>
          {#each renderedLayoutNodes as node (node.nodeId)}
            {@const active = selectedNodeId === node.nodeId}
            {@const neighbour = selectedNeighbourIds.has(node.nodeId) || selectedGroupContextNodeIds.has(node.nodeId)}
            {@const pathNode = pathNodeIds.has(node.nodeId)}
            <CimmichMemoryGraphNode
              {active}
              color={kindMeta[node.kind].color}
              dimmed={path?.nodeIds.length ? !pathNode : Boolean(selectedNode && !active && !neighbour)}
              dragging={draggingNodeId === node.nodeId}
              {node}
              ondragstart={(event) => beginNodeDrag(event, node.nodeId)}
              onhover={(hovered) => (hoveredNodeId = hovered ? node.nodeId : '')}
              onselect={() => selectNode(node.nodeId)}
              {pathNode}
              showLabel={shouldShowNodeLabel(node)}
              singular={kindMeta[node.kind].singular}
            />
          {/each}
        </g>
      </svg>

      <div
        class="pointer-events-none absolute bottom-4 left-4 z-10 flex max-w-[calc(100%-13rem)] flex-wrap gap-x-4 gap-y-1 rounded-xl bg-white/80 px-3 py-2 text-xs text-gray-500 backdrop-blur-sm dark:bg-[#11141b]/80 dark:text-gray-400"
      >
        <span><span class="mr-1 inline-block w-5 border-t-2 border-[#d39b37]"></span>Recorded</span>
        <span><span class="mr-1 inline-block w-5 border-t-2 border-dashed border-[#8290ad]"></span>Photo evidence</span>
        <span><span class="mr-1 inline-block h-2 w-5 rounded-sm border border-[#f59e0b]"></span>Context outline</span>
        <span>Drag canvas to pan · Drag memories or group outlines to arrange · Scroll to zoom</span>
      </div>
    </div>

    {#if compact || analysisOpen || selectedNode || pathStartNodeId}
      <aside
        class={[
          'grid content-start gap-3 border border-gray-200 bg-white p-4 shadow-xl dark:border-gray-700 dark:bg-[#11141b]',
          compact
            ? 'max-h-[min(38rem,calc(100vh-17rem))] overflow-y-auto rounded-3xl shadow-sm'
            : 'absolute inset-y-3 right-3 z-30 w-[min(22rem,calc(100%-1.5rem))] overflow-y-auto rounded-2xl bg-white/95 backdrop-blur-md dark:bg-[#11141b]/95',
        ]}
        aria-label={compact && subjectName ? `${subjectName}'s connection web` : 'Memory web analysis'}
      >
        {#if compact}
          <section aria-labelledby="compact-web-contents-heading">
            <div class="mb-2 flex items-end justify-between gap-3">
              <div>
                <h3 class="text-xs font-normal" id="compact-web-contents-heading">In this web</h3>
                <p class="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                  Open a section, show or hide it, or jump to a memory.
                </p>
              </div>
              <span class="shrink-0 text-[10px] text-gray-400">{visibleNodes.length} shown</span>
            </div>
            <div class="grid gap-1.5">
              {#each memoryGraphSectionKinds as kind (kind)}
                {#if compactSectionNodes[kind].length > 0}
                  {@const sectionOpen = openCompactSections.includes(kind)}
                  {@const sectionActive = activeKinds.includes(kind)}
                  {@const centralKind = graphNodeById.get(initialNodeId)?.kind === kind}
                  <section class="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
                    <div class="grid grid-cols-[1fr_auto] items-center">
                      <button
                        class="flex min-h-10 min-w-0 items-center gap-2 px-2.5 text-left hover:bg-gray-50 dark:hover:bg-white/5"
                        type="button"
                        aria-expanded={sectionOpen}
                        onclick={() => toggleCompactSection(kind)}
                      >
                        <Icon
                          class={`shrink-0 text-gray-400 transition ${sectionOpen ? 'rotate-0' : '-rotate-90'}`}
                          icon={mdiChevronDown}
                          size="16"
                        />
                        <span style:color={kindMeta[kind].color}><Icon icon={kindMeta[kind].icon} size="16" /></span>
                        <span class="min-w-0 flex-1 truncate text-xs font-normal">{kindMeta[kind].label}</span>
                        <span class="text-[10px] text-gray-400">{compactSectionNodes[kind].length}</span>
                      </button>
                      <button
                        class="grid size-10 place-items-center border-l border-gray-200 text-gray-500 hover:bg-gray-50 disabled:cursor-default disabled:opacity-45 dark:border-gray-700 dark:hover:bg-white/5"
                        class:text-primary={sectionActive}
                        type="button"
                        disabled={centralKind}
                        aria-label={`${sectionActive ? 'Hide' : 'Show'} ${kindMeta[kind].label}`}
                        aria-pressed={sectionActive}
                        title={centralKind ? 'The central Person stays visible' : undefined}
                        onclick={() => toggleKind(kind)}
                        ><Icon icon={sectionActive ? mdiEyeOutline : mdiEyeOffOutline} size="17" /></button
                      >
                    </div>
                    {#if sectionOpen}
                      <div class="border-t border-gray-200 p-1.5 dark:border-gray-700">
                        {#if kind === 'event'}
                          <div class="mb-1.5 grid grid-cols-2 gap-1" aria-label="Event and period types">
                            {#each memoryGraphEventTypes as type (type.value)}
                              {@const typeCount = compactSectionNodes.event.filter(
                                (node) => memoryGraphEventType(node) === type.value,
                              ).length}
                              {#if typeCount > 0}
                                <button
                                  class={[
                                    'flex min-h-8 items-center justify-between gap-1 rounded-lg px-2 text-[11px] transition',
                                    hiddenEventTypes.includes(type.value)
                                      ? 'bg-gray-100 opacity-55 dark:bg-white/10'
                                      : 'bg-primary/10 text-primary',
                                  ]}
                                  type="button"
                                  aria-pressed={!hiddenEventTypes.includes(type.value)}
                                  onclick={() => toggleEventType(type.value)}
                                  ><span>{type.label}</span><span class="opacity-65">{typeCount}</span></button
                                >
                              {/if}
                            {/each}
                          </div>
                        {/if}
                        <div class="max-h-40 overflow-y-auto">
                          {#each compactSectionNodes[kind] as node (node.nodeId)}
                            {@const nodeVisible =
                              sectionActive &&
                              (node.kind !== 'event' || !hiddenEventTypes.includes(memoryGraphEventType(node)))}
                            <button
                              class="flex min-h-8 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-gray-100 dark:hover:bg-white/10"
                              class:opacity-45={!nodeVisible}
                              type="button"
                              onclick={() => selectCompactSectionNode(node.nodeId)}
                            >
                              <span
                                class="size-1.5 shrink-0 rounded-full"
                                style:background-color={kindMeta[node.kind].color}
                              ></span>
                              <span class="min-w-0 flex-1 truncate text-[11px]">{node.displayName}</span>
                              <span class="text-[10px] text-gray-400">{node.connectionCount}</span>
                            </button>
                          {/each}
                        </div>
                      </div>
                    {/if}
                  </section>
                {/if}
              {/each}
            </div>
          </section>
        {/if}

        {#if pathStartNodeId && pathTargetNodeId}
          <section class="rounded-2xl bg-primary/5 p-3" aria-labelledby="path-heading">
            <div class="flex items-center justify-between gap-2">
              <h3 class="flex items-center gap-2 text-sm font-semibold" id="path-heading">
                <Icon class="text-primary" icon={mdiVectorPolyline} size="20" />Connection path
              </h3>
              <button
                class="flex size-9 items-center justify-center rounded-xl hover:bg-primary/10"
                type="button"
                aria-label="Clear path"
                onclick={resetPath}><Icon icon={mdiClose} size="18" /></button
              >
            </div>
            {#if path}
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {path.edgeIds.length}
                {path.edgeIds.length === 1 ? 'step' : 'steps'} in the current lens
              </p>
              <div class="mt-2 grid gap-1">
                {#each path.nodeIds as nodeId, index (nodeId)}
                  {@const pathNode = graphNodeById.get(nodeId)}
                  {#if pathNode}
                    <button
                      class="flex min-h-10 items-center gap-2 rounded-xl px-2 text-left hover:bg-white dark:hover:bg-white/10"
                      type="button"
                      onclick={() => selectNode(nodeId)}
                    >
                      <span
                        class="flex size-7 items-center justify-center rounded-lg text-[#090b10]"
                        style:background-color={kindMeta[pathNode.kind].color}
                        ><Icon icon={kindMeta[pathNode.kind].icon} size="15" /></span
                      >
                      <span class="min-w-0 flex-1 truncate text-sm font-semibold">{pathNode.displayName}</span>
                      {#if index < path.nodeIds.length - 1}<span class="text-xs text-gray-400">→</span>{/if}
                    </button>
                  {/if}
                {/each}
              </div>
            {:else}
              <p class="mt-2 text-sm">No path connects these memories in the current lens.</p>
            {/if}
          </section>
        {/if}

        {#if selectedNode}
          <section aria-labelledby="selected-memory-heading">
            <div class="flex items-start gap-3">
              {#if selectedNode.coverAssetId}
                <span class="relative size-16 shrink-0 overflow-hidden rounded-2xl bg-gray-200 dark:bg-gray-700">
                  <img
                    class={selectedNode.portraitStyle ? 'max-w-none' : 'size-full object-cover'}
                    src={getAssetMediaUrl({ id: selectedNode.coverAssetId, size: AssetMediaSize.Thumbnail })}
                    style={selectedNode.portraitStyle}
                    alt=""
                  />
                </span>
              {:else}
                <span
                  class="flex size-16 shrink-0 items-center justify-center rounded-2xl text-[#090b10]"
                  style:background-color={kindMeta[selectedNode.kind].color}
                  ><Icon icon={kindMeta[selectedNode.kind].icon} size="28" /></span
                >
              {/if}
              <div class="min-w-0 flex-1">
                <p
                  class="text-[10px] font-normal tracking-wide uppercase"
                  style:color={kindMeta[selectedNode.kind].color}
                >
                  {cimmichMemoryGraphNodeDetailLabel(selectedNode, kindMeta[selectedNode.kind].singular)}
                </p>
                <h3 class="mt-1 text-sm font-normal" id="selected-memory-heading">{selectedNode.displayName}</h3>
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {selectedEdges.length.toLocaleString()} visible {selectedEdges.length === 1
                    ? 'connection'
                    : 'connections'}
                </p>
              </div>
              {#if !compact || selectedNode.nodeId !== initialNodeId}<button
                  class="flex size-9 shrink-0 items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-white/10"
                  type="button"
                  aria-label={compact && subjectName ? `Back to ${subjectName}` : 'Close details'}
                  onclick={() => {
                    selectedNodeId = compact ? initialNodeId : '';
                    analysisOpen = false;
                    resetPath();
                  }}><Icon icon={compact ? mdiArrowLeft : mdiClose} size="19" /></button
                >{/if}
            </div>
            {#if !compact}<div class="mt-3 grid grid-cols-2 gap-2">
                <button
                  class="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-primary/10 px-3 text-sm font-semibold text-primary"
                  type="button"
                  onclick={focusSelectedNode}><Icon icon={mdiTargetVariant} size="18" />Focus</button
                >
                <button
                  class="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-gray-100 px-3 text-sm font-semibold dark:bg-white/10"
                  type="button"
                  onclick={startPath}><Icon icon={mdiVectorPolyline} size="18" />Trace path</button
                >
              </div>{/if}
            {#if compact && onexpand && selectedNode.nodeId !== initialNodeId && selectedHiddenNeighbourCount > 0}
              <button
                class="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary/10 px-3 text-sm font-semibold text-primary hover:bg-primary/15"
                type="button"
                aria-label={`Explore connections from ${selectedNode.displayName}`}
                onclick={() => onexpand?.(selectedNode.nodeId)}
              >
                <Icon icon={mdiGraphOutline} size="18" />Explore {selectedHiddenNeighbourCount.toLocaleString()} more
                {selectedHiddenNeighbourCount === 1 ? 'connection' : 'connections'}
              </button>
            {/if}
            {#if !compact || selectedNode.nodeId !== initialNodeId}<a
                class="mt-2 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 text-sm font-semibold text-white dark:text-black"
                href={cimmichMemoryGraphNodeHref(selectedNode)}
                >Open {cimmichMemoryGraphNodeSemanticLabel(selectedNode, kindMeta[selectedNode.kind].singular)}<Icon
                  icon={mdiOpenInNew}
                  size="17"
                /></a
              >{/if}
          </section>

          <section
            class="border-t border-gray-200 pt-3 dark:border-gray-700"
            aria-labelledby="visible-connections-heading"
          >
            <h3 class="mb-1 flex items-center gap-2 text-xs font-normal" id="visible-connections-heading">
              <Icon icon={mdiLinkVariant} size="16" />Visible connections
            </h3>
            <div class="grid gap-1">
              {#each selectedEdges as edge (edge.edgeId)}
                {@const neighbour = oppositeNode(edge)}
                {#if neighbour}
                  <button
                    class="grid min-h-12 grid-cols-[2rem_1fr_auto] items-center gap-2 rounded-xl px-2 text-left hover:bg-gray-100 dark:hover:bg-white/10"
                    type="button"
                    onclick={() => selectNode(neighbour.nodeId)}
                  >
                    <span
                      class="flex size-8 items-center justify-center rounded-lg text-[#090b10]"
                      style:background-color={kindMeta[neighbour.kind].color}
                      ><Icon icon={kindMeta[neighbour.kind].icon} size="16" /></span
                    >
                    <span class="min-w-0"
                      ><span class="block truncate text-xs font-normal">{neighbour.displayName}</span><span
                        class="block truncate text-[11px] text-gray-500 dark:text-gray-400">{edgeLabel(edge)}</span
                      ></span
                    >
                    {#if edge.photoCount > 0}<span class="inline-flex items-center gap-1 text-xs text-gray-400"
                        ><Icon icon={mdiImageMultipleOutline} size="15" />{edge.photoCount}</span
                      >{/if}
                  </button>
                {/if}
              {/each}
            </div>
          </section>
        {:else if !compact}
          <CimmichMemoryGraphInsights
            {activeLens}
            {analysis}
            nodeById={graphNodeById}
            onclose={() => (analysisOpen = false)}
            onlens={applyLens}
            onrevealedge={revealEdge}
            onrevealnode={revealNode}
            strongestEdges={strongestVisibleEdges}
          />
        {/if}
        <p class="border-t border-gray-200 pt-3 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {compact && subjectName ? `${subjectName}'s web:` : 'Showing'}
          {visibleNodes.length.toLocaleString()} memories · {visibleEdges.length.toLocaleString()}
          connections{compact ? '.' : ' in this bounded web.'}
        </p>
      </aside>
    {/if}
  </div>
</div>
