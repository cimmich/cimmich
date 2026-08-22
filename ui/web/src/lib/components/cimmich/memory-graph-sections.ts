import type {
  CimmichMemoryGraph,
  CimmichMemoryGraphNode,
  CimmichMemoryGraphNodeKind,
} from '$lib/services/cimmich-discover.service';

export const memoryGraphSectionKinds: CimmichMemoryGraphNodeKind[] = ['person', 'event', 'place', 'object', 'pet'];

export const memoryGraphEventTypes = [
  { label: 'Events', value: 'event' },
  { label: 'Life periods', value: 'life_period' },
  { label: 'Trips & routes', value: 'trip' },
  { label: 'Activities', value: 'activity' },
] as const;

export const memoryGraphEventType = (node: Pick<CimmichMemoryGraphNode, 'kind' | 'typeKind'>) =>
  node.kind === 'event' && memoryGraphEventTypes.some(({ value }) => value === node.typeKind)
    ? (node.typeKind as (typeof memoryGraphEventTypes)[number]['value'])
    : 'event';

export const filterCimmichMemoryGraphEventTypes = (graph: CimmichMemoryGraph, hiddenTypes: string[]) => {
  if (hiddenTypes.length === 0) {
    return graph;
  }
  const hidden = new Set(hiddenTypes);
  const nodes = graph.nodes.filter((node) => node.kind !== 'event' || !hidden.has(memoryGraphEventType(node)));
  const nodeIds = new Set(nodes.map(({ nodeId }) => nodeId));
  const edges = graph.edges.filter(
    ({ sourceNodeId, targetNodeId }) => nodeIds.has(sourceNodeId) && nodeIds.has(targetNodeId),
  );
  const countsByKind = {
    ...graph.countsByKind,
    event: nodes.filter(({ kind }) => kind === 'event').length,
  };
  return { ...graph, countsByKind, edges, nodes };
};

export const memoryGraphSectionNodes = (graph: CimmichMemoryGraph, kind: CimmichMemoryGraphNodeKind) =>
  graph.nodes
    .filter((node) => node.kind === kind)
    .sort(
      (left, right) =>
        right.connectionCount - left.connectionCount || left.displayName.localeCompare(right.displayName),
    );
