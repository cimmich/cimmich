import type {
  CimmichMemoryGraph,
  CimmichMemoryGraphEdge,
  CimmichMemoryGraphNode,
  CimmichMemoryGraphNodeKind,
} from '$lib/services/cimmich-discover.service';

export type CimmichMemoryGraphLens = 'overview' | 'people' | 'places' | 'recorded';

export type CimmichMemoryGraphPath = {
  edgeIds: string[];
  nodeIds: string[];
};

export type CimmichMemoryGraphAnalysis = {
  recordedEdgeCount: number;
  strongestPhotoEdge: CimmichMemoryGraphEdge | null;
  topConnector: CimmichMemoryGraphNode | null;
  topPlace: { node: CimmichMemoryGraphNode; peopleCount: number } | null;
};

const inferredRelationKinds = new Set(['coappears', 'shared_media']);

export const isRecordedMemoryGraphEdge = (edge: CimmichMemoryGraphEdge) =>
  edge.relationKinds.some((relationKind) => !inferredRelationKinds.has(relationKind));

export const memoryGraphEdgeMatchesLens = (edge: CimmichMemoryGraphEdge, lens: CimmichMemoryGraphLens) => {
  if (lens === 'recorded') {
    return isRecordedMemoryGraphEdge(edge);
  }
  if (lens === 'places') {
    return edge.sourceNodeId.startsWith('place:') || edge.targetNodeId.startsWith('place:');
  }
  if (lens === 'people') {
    const isPersonLike = (nodeId: string) => nodeId.startsWith('person:') || nodeId.startsWith('pet:');
    return isPersonLike(edge.sourceNodeId) && isPersonLike(edge.targetNodeId);
  }
  return true;
};

export const filterCimmichMemoryGraph = (
  graph: CimmichMemoryGraph,
  lens: CimmichMemoryGraphLens,
  activeKinds: CimmichMemoryGraphNodeKind[],
  focusNodeId = '',
) => {
  const activeKindSet = new Set(activeKinds);
  const kindNodeIds = new Set(graph.nodes.filter(({ kind }) => activeKindSet.has(kind)).map(({ nodeId }) => nodeId));
  const lensEdges = graph.edges.filter(
    (edge) =>
      kindNodeIds.has(edge.sourceNodeId) &&
      kindNodeIds.has(edge.targetNodeId) &&
      memoryGraphEdgeMatchesLens(edge, lens),
  );
  let edges = lensEdges;
  let nodeIds = new Set(lensEdges.flatMap(({ sourceNodeId, targetNodeId }) => [sourceNodeId, targetNodeId]));

  if (lens === 'overview') {
    for (const nodeId of kindNodeIds) {
      nodeIds.add(nodeId);
    }
  }

  if (focusNodeId && nodeIds.has(focusNodeId)) {
    edges = lensEdges.filter((edge) => edge.sourceNodeId === focusNodeId || edge.targetNodeId === focusNodeId);
    nodeIds = new Set(edges.flatMap(({ sourceNodeId, targetNodeId }) => [sourceNodeId, targetNodeId]));
    nodeIds.add(focusNodeId);
  }

  return {
    edges,
    nodes: graph.nodes.filter(({ nodeId }) => nodeIds.has(nodeId)),
  };
};

export const analyzeCimmichMemoryGraph = (graph: CimmichMemoryGraph): CimmichMemoryGraphAnalysis => {
  const nodeById = new Map(graph.nodes.map((node) => [node.nodeId, node]));
  const peopleByPlace = new Map<string, Set<string>>();

  for (const edge of graph.edges) {
    const source = nodeById.get(edge.sourceNodeId);
    const target = nodeById.get(edge.targetNodeId);
    if (source?.kind === 'place' && target?.kind === 'person') {
      const people = peopleByPlace.get(source.nodeId) ?? new Set<string>();
      people.add(target.nodeId);
      peopleByPlace.set(source.nodeId, people);
    }
    if (target?.kind === 'place' && source?.kind === 'person') {
      const people = peopleByPlace.get(target.nodeId) ?? new Set<string>();
      people.add(source.nodeId);
      peopleByPlace.set(target.nodeId, people);
    }
  }

  const topPlaceEntry = [...peopleByPlace.entries()].sort(
    ([leftId, leftPeople], [rightId, rightPeople]) =>
      rightPeople.size - leftPeople.size ||
      (nodeById.get(leftId)?.displayName ?? '').localeCompare(nodeById.get(rightId)?.displayName ?? ''),
  )[0];
  const topPlace = topPlaceEntry ? { node: nodeById.get(topPlaceEntry[0])!, peopleCount: topPlaceEntry[1].size } : null;
  const topConnector = [...graph.nodes].sort(
    (left, right) => right.connectionCount - left.connectionCount || left.displayName.localeCompare(right.displayName),
  )[0];
  const strongestPhotoEdge = [...graph.edges]
    .filter(({ photoCount }) => photoCount > 0)
    .sort(
      (left, right) =>
        right.photoCount - left.photoCount || right.weight - left.weight || left.edgeId.localeCompare(right.edgeId),
    )[0];

  return {
    recordedEdgeCount: graph.edges.filter((edge) => isRecordedMemoryGraphEdge(edge)).length,
    strongestPhotoEdge: strongestPhotoEdge ?? null,
    topConnector: topConnector ?? null,
    topPlace,
  };
};

export const shortestCimmichMemoryGraphPath = (
  edges: CimmichMemoryGraphEdge[],
  sourceNodeId: string,
  targetNodeId: string,
): CimmichMemoryGraphPath | null => {
  if (sourceNodeId === targetNodeId) {
    return { edgeIds: [], nodeIds: [sourceNodeId] };
  }
  const adjacency = new Map<string, { edgeId: string; nodeId: string }[]>();
  for (const edge of edges) {
    adjacency.set(edge.sourceNodeId, [
      ...(adjacency.get(edge.sourceNodeId) ?? []),
      { edgeId: edge.edgeId, nodeId: edge.targetNodeId },
    ]);
    adjacency.set(edge.targetNodeId, [
      ...(adjacency.get(edge.targetNodeId) ?? []),
      { edgeId: edge.edgeId, nodeId: edge.sourceNodeId },
    ]);
  }
  const queue = [sourceNodeId];
  const previous = new Map<string, { edgeId: string; nodeId: string }>();
  const visited = new Set(queue);
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    for (const next of adjacency.get(nodeId) ?? []) {
      if (visited.has(next.nodeId)) {
        continue;
      }
      visited.add(next.nodeId);
      previous.set(next.nodeId, { edgeId: next.edgeId, nodeId });
      if (next.nodeId === targetNodeId) {
        const nodeIds = [targetNodeId];
        const edgeIds: string[] = [];
        let cursor = targetNodeId;
        while (cursor !== sourceNodeId) {
          const step = previous.get(cursor)!;
          edgeIds.unshift(step.edgeId);
          nodeIds.unshift(step.nodeId);
          cursor = step.nodeId;
        }
        return { edgeIds, nodeIds };
      }
      queue.push(next.nodeId);
    }
  }
  return null;
};
