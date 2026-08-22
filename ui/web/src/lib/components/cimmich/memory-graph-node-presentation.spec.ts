import { describe, expect, it } from 'vitest';
import type { CimmichMemoryGraphNode } from '$lib/services/cimmich-discover.service';
import {
  cimmichMemoryGraphNodeDetailLabel,
  cimmichMemoryGraphNodeHref,
  cimmichMemoryGraphNodeMetrics,
  cimmichMemoryGraphNodeSemanticLabel,
  cimmichMemoryGraphNodeShape,
} from './memory-graph-node-presentation';

const eventNode = (typeKind: string): CimmichMemoryGraphNode => ({
  connectionCount: 1,
  coverAssetId: null,
  displayName: 'Ben',
  entityId: 'ben',
  kind: 'event',
  nodeId: 'event:ben',
  typeKind,
});

describe('memory graph node presentation', () => {
  it('classifies a life period as a derived group rather than a rendered point', () => {
    const node = eventNode('life_period');
    expect(cimmichMemoryGraphNodeShape(node)).toBe('group');
    expect(cimmichMemoryGraphNodeSemanticLabel(node, 'Event')).toBe('Life period');
    expect(cimmichMemoryGraphNodeDetailLabel(node, 'Event')).toBe('Life period');
    expect(cimmichMemoryGraphNodeMetrics(node, 9)).toEqual({ halfHeight: 9, halfWidth: 9 });
  });

  it('keeps a discrete Event visually distinct from circular memories', () => {
    expect(cimmichMemoryGraphNodeShape(eventNode('event'))).toBe('event');
    expect(cimmichMemoryGraphNodeShape({ ...eventNode('trip'), kind: 'person' })).toBe('circle');
    expect(cimmichMemoryGraphNodeDetailLabel(eventNode('trip'), 'Event')).toBe('Event · trip');
  });

  it('links each graph memory to its owning surface', () => {
    expect(cimmichMemoryGraphNodeHref(eventNode('event'))).toContain('/cimmich/events?entityId=ben');
    expect(cimmichMemoryGraphNodeHref({ ...eventNode('event'), kind: 'person' })).toContain('personId=ben');
  });
});
