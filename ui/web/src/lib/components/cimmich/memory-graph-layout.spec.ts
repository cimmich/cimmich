import type { CimmichMemoryGraphEdge, CimmichMemoryGraphNode } from '$lib/services/cimmich-discover.service';
import { cimmichMemoryGraphViewBox, layoutCimmichMemoryGraph } from './memory-graph-layout';

const nodes: CimmichMemoryGraphNode[] = [
  {
    connectionCount: 2,
    coverAssetId: null,
    displayName: 'Maya Vale',
    entityId: 'maya',
    kind: 'person',
    nodeId: 'person:maya',
    typeKind: null,
  },
  {
    connectionCount: 1,
    coverAssetId: null,
    displayName: 'Bluewater Weekend',
    entityId: 'weekend',
    kind: 'event',
    nodeId: 'event:weekend',
    typeKind: 'trip',
  },
  {
    connectionCount: 1,
    coverAssetId: null,
    displayName: 'University years',
    entityId: 'university',
    kind: 'event',
    nodeId: 'event:university',
    typeKind: 'life_period',
  },
  {
    connectionCount: 1,
    coverAssetId: null,
    displayName: 'Willow Garden',
    entityId: 'garden',
    kind: 'place',
    nodeId: 'place:garden',
    typeKind: 'property',
  },
];
const edges: CimmichMemoryGraphEdge[] = [
  {
    coverAssetId: null,
    edgeId: 'event:weekend--person:maya',
    photoCount: 0,
    relationKinds: ['participant'],
    sourceNodeId: 'event:weekend',
    targetNodeId: 'person:maya',
    weight: 1.75,
  },
  {
    coverAssetId: null,
    edgeId: 'person:maya--place:garden',
    photoCount: 5,
    relationKinds: ['shared_media'],
    sourceNodeId: 'person:maya',
    targetNodeId: 'place:garden',
    weight: 4.3,
  },
];

describe('Cimmich memory graph layout', () => {
  it('is deterministic, bounded and preserves every multi-kind node', () => {
    const first = layoutCimmichMemoryGraph(structuredClone(nodes), edges);
    const second = layoutCimmichMemoryGraph(structuredClone(nodes), edges);

    expect(first).toEqual(second);
    expect(first.map(({ kind }) => kind).sort()).toEqual(['event', 'event', 'person', 'place']);
    expect(first.every(({ x, y }) => x >= 34 && x <= 1766 && y >= 34 && y <= 1046)).toBe(true);
    expect(new Set(first.map(({ x, y }) => `${x}:${y}`)).size).toBe(first.length);
  });

  it('keeps the hidden Life-period anchor compact so its members can define the enclosure', () => {
    const period = layoutCimmichMemoryGraph(structuredClone(nodes), edges).find(
      ({ typeKind }) => typeKind === 'life_period',
    )!;
    expect(period.halfWidth).toBe(period.radius);
    expect(period.halfHeight).toBe(period.radius);
  });

  it('can expand spacing without making the visual nodes enormous and fits occupied bounds', () => {
    const compact = layoutCimmichMemoryGraph(structuredClone(nodes), edges, 'compact');
    const roomy = layoutCimmichMemoryGraph(structuredClone(nodes), edges, 'roomy');
    const averageEdgeLength = (layout: typeof compact) => {
      const byId = new Map(layout.map((node) => [node.nodeId, node]));
      let total = 0;
      for (const edge of edges) {
        const source = byId.get(edge.sourceNodeId)!;
        const target = byId.get(edge.targetNodeId)!;
        total += Math.hypot(target.x - source.x, target.y - source.y);
      }
      return total / edges.length;
    };

    expect(averageEdgeLength(roomy)).toBeGreaterThan(averageEdgeLength(compact));
    expect(roomy.every(({ radius }) => radius <= 14)).toBe(true);
    expect(cimmichMemoryGraphViewBox(roomy).width).toBeLessThan(1800);
  });
});
