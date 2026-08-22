import { readFile } from 'node:fs/promises';

describe('Cimmich Discover analysis workspace', () => {
  it('renders one canvas-first multi-entity graph with compact lenses and analysis tools', async () => {
    const [
      page,
      graph,
      graphFilters,
      graphEdge,
      graphGroup,
      graphGroups,
      graphNode,
      nodePresentation,
      insights,
      analysis,
      service,
    ] = await Promise.all([
      readFile('src/routes/(user)/cimmich/discover/+page.svelte', 'utf8'),
      readFile('src/lib/components/cimmich/CimmichMemoryGraph.svelte', 'utf8'),
      readFile('src/lib/components/cimmich/CimmichMemoryGraphFilters.svelte', 'utf8'),
      readFile('src/lib/components/cimmich/CimmichMemoryGraphEdgeLine.svelte', 'utf8'),
      readFile('src/lib/components/cimmich/CimmichMemoryGraphGroup.svelte', 'utf8'),
      readFile('src/lib/components/cimmich/memory-graph-groups.ts', 'utf8'),
      readFile('src/lib/components/cimmich/CimmichMemoryGraphNode.svelte', 'utf8'),
      readFile('src/lib/components/cimmich/memory-graph-node-presentation.ts', 'utf8'),
      readFile('src/lib/components/cimmich/CimmichMemoryGraphInsights.svelte', 'utf8'),
      readFile('src/lib/components/cimmich/memory-graph-analysis.ts', 'utf8'),
      readFile('src/lib/services/cimmich-discover.service.ts', 'utf8'),
    ]);

    expect(page).toContain('getCimmichMemoryGraph(72)');
    expect(page).not.toContain('getCimmichPersonConnections');
    expect(page).toContain('<CimmichMemoryGraph {graph} />');
    expect(page).toContain('People, Places, Events, Things and memories');
    expect(page).not.toContain('{#each result.items as connection');
    expect(graph).toContain('{#each renderedEdges as edge');
    expect(graph).toContain('{#each contextGroups as group');
    expect(graph).toContain('{#each renderedLayoutNodes as node');
    expect(graph).toContain('cimmichMemoryGraphMembershipEdgeIds');
    expect(graphGroups).toContain("cimmichMemoryGraphNodeShape(node) === 'group'");
    expect(graphGroup).toContain('`${meta.label} group:');
    expect(graphGroup).toContain('{group.groupNode.displayName} · {meta.label}');
    expect(graphGroup).toContain('ondragstart');
    expect(graph).toContain('showRelationshipLabels = $state(false)');
    expect(graphFilters).toContain('Show the recorded relationship directly on Person-to-Person lines');
    expect(graph).toContain('relationshipLabelVisible={shouldShowRelationshipLabel(edge)}');
    expect(graph).toContain('visibleRelationshipLabelIds');
    expect(graph).toContain('projectedWidth');
    expect(graph).toContain('const collides = occupied.some');
    expect(graph).not.toContain('`${labels[0]} +${labels.length - 1}`');
    expect(graphEdge).toContain('class="pointer-events-none fill-gray-700 text-[5px] font-normal dark:fill-gray-200"');
    expect(graphEdge).toContain('onpointerdown={onselectrelationship}');
    expect(graphEdge).toContain('onclick={onselectrelationship}');
    expect(graphEdge).toContain('pointer-events="stroke"');
    expect(graphEdge).toContain('select to inspect');
    expect(graphNode).toContain('class="fill-gray-900 text-[6.5px] font-normal dark:fill-white"');
    expect(graphNode).not.toContain("shape === 'life-period'");
    expect(graphNode).toContain("shape === 'event'");
    expect(nodePresentation).toContain("node.typeKind === 'life_period' ? 'group'");
    expect(graph).toContain('Drag canvas to pan · Drag memories or group outlines to arrange · Scroll to zoom');
    expect(graphNode).toContain('onpointerdown={ondragstart}');
    expect(graphEdge).toContain('{#if showConnections && !compact && selected');
    expect(graph).toContain('expandableNodeCounts?: Record<string, number>');
    expect(graph).toContain('Explore {selectedHiddenNeighbourCount.toLocaleString()} more');
    expect(graph).toContain('aria-label={`Explore connections from ${selectedNode.displayName}`}');
    expect(graph).not.toContain('Questions worth exploring');
    expect(graphFilters).toContain('Node spacing');
    expect(graph).toContain('showConnections = $state(true)');
    expect(graph).toContain('shouldShowNodeLabel');
    expect(graph).toContain('cimmichMemoryGraphViewBox');
    expect(graph).toContain('cimmichMemoryGraphNodeSemanticLabel(selectedNode');
    expect(graph).toContain('People & bonds');
    expect(graph).toContain('Trace path');
    expect(graph).toContain('<CimmichMemoryGraphInsights');
    expect(insights).toContain('Useful starting points calculated from this view.');
    expect(graph).toContain('compact?: boolean');
    expect(graph).toContain("compact ? 'h-[min(38rem,calc(100vh-17rem))] min-h-120");
    expect(nodePresentation).toContain('Route.cimmichEvents()');
    expect(nodePresentation).toContain('Route.cimmichThings()');
    expect(nodePresentation).toContain('Route.cimmichPlaces()');
    expect(service).toContain('/v1/discover/memory-graph?edgeLimit=');
    expect(service).toContain("schemaVersion: 'cimmich.memory-graph.v1'");
    expect(analysis).toContain('shortestCimmichMemoryGraphPath');
    expect(analysis).toContain('isRecordedMemoryGraphEdge');
  });
});
