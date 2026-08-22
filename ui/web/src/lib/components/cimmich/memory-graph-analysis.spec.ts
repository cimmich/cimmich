import type { CimmichMemoryGraph } from '$lib/services/cimmich-discover.service';
import {
  analyzeCimmichMemoryGraph,
  filterCimmichMemoryGraph,
  isRecordedMemoryGraphEdge,
  shortestCimmichMemoryGraphPath,
} from './memory-graph-analysis';

const graph: CimmichMemoryGraph = {
  schemaVersion: 'cimmich.memory-graph.v1',
  scope: { edgeLimit: 72 },
  countsByKind: { event: 1, object: 0, person: 2, pet: 0, place: 1 },
  nodes: [
    {
      nodeId: 'person:a',
      entityId: 'a',
      displayName: 'Alex',
      kind: 'person',
      typeKind: null,
      coverAssetId: null,
      connectionCount: 2,
    },
    {
      nodeId: 'person:b',
      entityId: 'b',
      displayName: 'Bea',
      kind: 'person',
      typeKind: null,
      coverAssetId: null,
      connectionCount: 2,
    },
    {
      nodeId: 'place:c',
      entityId: 'c',
      displayName: 'Cove',
      kind: 'place',
      typeKind: null,
      coverAssetId: null,
      connectionCount: 2,
    },
    {
      nodeId: 'event:d',
      entityId: 'd',
      displayName: 'Dinner',
      kind: 'event',
      typeKind: null,
      coverAssetId: null,
      connectionCount: 2,
    },
  ],
  edges: [
    {
      edgeId: 'ab',
      sourceNodeId: 'person:a',
      targetNodeId: 'person:b',
      relationKinds: ['shared_media'],
      coverAssetId: null,
      photoCount: 14,
      weight: 4,
    },
    {
      edgeId: 'bc',
      sourceNodeId: 'person:b',
      targetNodeId: 'place:c',
      relationKinds: ['shared_media'],
      coverAssetId: null,
      photoCount: 5,
      weight: 2,
    },
    {
      edgeId: 'cd',
      sourceNodeId: 'place:c',
      targetNodeId: 'event:d',
      relationKinds: ['parent'],
      coverAssetId: null,
      photoCount: 0,
      weight: 1,
    },
    {
      edgeId: 'da',
      sourceNodeId: 'event:d',
      targetNodeId: 'person:a',
      relationKinds: ['participant'],
      coverAssetId: null,
      photoCount: 0,
      weight: 1,
    },
  ],
};

describe('Cimmich memory graph analysis', () => {
  it('finds useful, truthful overview signals', () => {
    const analysis = analyzeCimmichMemoryGraph(graph);
    expect(analysis.topConnector?.displayName).toBe('Alex');
    expect(analysis.strongestPhotoEdge?.edgeId).toBe('ab');
    expect(analysis.topPlace).toMatchObject({ node: { displayName: 'Cove' }, peopleCount: 1 });
    expect(analysis.recordedEdgeCount).toBe(2);
    expect(isRecordedMemoryGraphEdge(graph.edges[0])).toBe(false);
    expect(isRecordedMemoryGraphEdge(graph.edges[2])).toBe(true);
  });

  it('builds purpose-specific lenses and a one-hop focus', () => {
    const kinds = ['event', 'person', 'place'] as const;
    expect(filterCimmichMemoryGraph(graph, 'people', [...kinds]).edges.map(({ edgeId }) => edgeId)).toEqual(['ab']);
    expect(filterCimmichMemoryGraph(graph, 'recorded', [...kinds]).edges.map(({ edgeId }) => edgeId)).toEqual([
      'cd',
      'da',
    ]);
    expect(
      filterCimmichMemoryGraph(graph, 'overview', [...kinds], 'place:c').edges.map(({ edgeId }) => edgeId),
    ).toEqual(['bc', 'cd']);
  });

  it('traces the shortest readable path between two memories', () => {
    expect(shortestCimmichMemoryGraphPath(graph.edges, 'person:b', 'event:d')).toEqual({
      edgeIds: ['ab', 'da'],
      nodeIds: ['person:b', 'person:a', 'event:d'],
    });
    expect(shortestCimmichMemoryGraphPath(graph.edges.slice(0, 1), 'person:a', 'event:d')).toBeNull();
  });
});
