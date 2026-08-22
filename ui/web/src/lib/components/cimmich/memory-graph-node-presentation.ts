import { Route } from '$lib/route';
import type { CimmichMemoryGraphNode } from '$lib/services/cimmich-discover.service';

export type CimmichMemoryGraphNodeShape = 'circle' | 'event' | 'group';

export const cimmichMemoryGraphNodeShape = (node: CimmichMemoryGraphNode): CimmichMemoryGraphNodeShape =>
  node.kind === 'event' ? (node.typeKind === 'life_period' ? 'group' : 'event') : 'circle';

export const cimmichMemoryGraphNodeSemanticLabel = (node: CimmichMemoryGraphNode, fallback: string) =>
  cimmichMemoryGraphNodeShape(node) === 'group' ? 'Life period' : fallback;

export const cimmichMemoryGraphNodeDetailLabel = (node: CimmichMemoryGraphNode, fallback: string) => {
  if (cimmichMemoryGraphNodeShape(node) === 'group') {
    return 'Life period';
  }
  return node.typeKind ? `${fallback} · ${node.typeKind.replaceAll('_', ' ')}` : fallback;
};

export const cimmichMemoryGraphNodeHref = (node: CimmichMemoryGraphNode) => {
  if (node.kind === 'person') {
    return Route.cimmichPerson({ name: node.displayName, personId: node.entityId });
  }
  if (node.kind === 'pet') {
    return Route.cimmichPet({ name: node.displayName, petId: node.entityId });
  }
  const search = new URLSearchParams({ entityId: node.entityId });
  const root =
    node.kind === 'event'
      ? Route.cimmichEvents()
      : node.kind === 'object'
        ? Route.cimmichThings()
        : Route.cimmichPlaces();
  return `${root}?${search.toString()}`;
};

export const cimmichMemoryGraphNodeMetrics = (node: CimmichMemoryGraphNode, radius: number) => {
  const shape = cimmichMemoryGraphNodeShape(node);
  if (shape === 'event') {
    return { halfHeight: radius * 1.12, halfWidth: radius * 1.12 };
  }
  return { halfHeight: radius, halfWidth: radius };
};
