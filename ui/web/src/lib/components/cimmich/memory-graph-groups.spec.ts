import { describe, expect, it } from 'vitest';
import type { CimmichMemoryGraphEdge } from '$lib/services/cimmich-discover.service';
import {
  cimmichMemoryGraphGroupContextNodeIds,
  cimmichMemoryGraphGroupMeta,
  cimmichMemoryGraphGroupOutlines,
  cimmichMemoryGraphMembershipEdgeIds,
} from './memory-graph-groups';
import type { CimmichMemoryGraphLayoutNode } from './memory-graph-layout';

const node = (
  nodeId: string,
  kind: CimmichMemoryGraphLayoutNode['kind'],
  x: number,
  y: number,
  typeKind: string | null = null,
): CimmichMemoryGraphLayoutNode => ({
  connectionCount: 1,
  coverAssetId: null,
  displayName: nodeId.split(':')[1] ?? nodeId,
  entityId: nodeId,
  halfHeight: 10,
  halfWidth: 10,
  kind,
  nodeId,
  radius: 10,
  typeKind,
  x,
  y,
});

const nodes = [
  node('event:school', 'event', 100, 100, 'life_period'),
  node('event:party', 'event', 480, 480, 'event'),
  node('person:maya', 'person', 180, 160),
  node('person:lee', 'person', 340, 280),
];
const edges: CimmichMemoryGraphEdge[] = [
  {
    coverAssetId: null,
    edgeId: 'school-maya',
    photoCount: 0,
    relationKinds: ['participant'],
    sourceNodeId: 'event:school',
    targetNodeId: 'person:maya',
    weight: 1,
  },
  {
    coverAssetId: null,
    edgeId: 'school-lee',
    photoCount: 0,
    relationKinds: ['participant'],
    sourceNodeId: 'person:lee',
    targetNodeId: 'event:school',
    weight: 1,
  },
  {
    coverAssetId: null,
    edgeId: 'party-maya',
    photoCount: 0,
    relationKinds: ['participant'],
    sourceNodeId: 'event:party',
    targetNodeId: 'person:maya',
    weight: 1,
  },
];

describe('memory graph group outlines', () => {
  it('derives one padded Life-period enclosure from its members', () => {
    const [group] = cimmichMemoryGraphGroupOutlines(nodes, edges);
    expect(group.groupNode.nodeId).toBe('event:school');
    expect(group.memberNodeIds.sort()).toEqual(['person:lee', 'person:maya']);
    expect(group.x).toBeLessThan(170);
    expect(group.x + group.width).toBeGreaterThan(350);
    expect(group.y).toBeLessThan(150);
    expect(group.y + group.height).toBeGreaterThan(290);
  });

  it('hides only membership spokes owned by a group', () => {
    expect([...cimmichMemoryGraphMembershipEdgeIds(nodes, edges)].sort()).toEqual(['school-lee', 'school-maya']);
  });

  it('treats selecting either a period or one of its members as group context', () => {
    const groups = cimmichMemoryGraphGroupOutlines(nodes, edges);
    expect([...cimmichMemoryGraphGroupContextNodeIds(groups, 'event:school')].sort()).toEqual([
      'person:lee',
      'person:maya',
    ]);
    expect([...cimmichMemoryGraphGroupContextNodeIds(groups, 'person:maya')].sort()).toEqual([
      'person:lee',
      'person:maya',
    ]);
  });

  it('turns a Place into a labelled enclosure when the Person view explicitly focuses Places', () => {
    const place = node('place:willow', 'place', 520, 240, 'point');
    const placeEdge: CimmichMemoryGraphEdge = {
      coverAssetId: null,
      edgeId: 'willow-maya',
      photoCount: 0,
      relationKinds: ['Lives here'],
      sourceNodeId: place.nodeId,
      targetNodeId: 'person:maya',
      weight: 1,
    };
    const forced = new Set([place.nodeId]);
    const group = cimmichMemoryGraphGroupOutlines([...nodes, place], [...edges, placeEdge], forced).find(
      ({ groupNode }) => groupNode.nodeId === place.nodeId,
    );

    expect(group).toBeDefined();
    expect(cimmichMemoryGraphGroupMeta(place)).toEqual({ color: '#4ade80', label: 'Place' });
    expect(group?.memberNodeIds).toEqual(['person:maya']);
    expect(cimmichMemoryGraphMembershipEdgeIds([...nodes, place], [...edges, placeEdge], forced)).toContain(
      'willow-maya',
    );
  });
});
