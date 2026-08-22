import type { CimmichMemoryGraphEdge, CimmichMemoryGraphNode } from '$lib/services/cimmich-discover.service';

const relationLabels: Record<string, string> = {
  coappears: 'Appears together',
  companion: 'Companion',
  location: 'Location',
  object: 'Thing',
  parent: 'Inside',
  participant: 'Participant',
  related: 'Related',
  shared_context: 'Shared context',
  shared_media: 'Shared photos',
};

const nonRelationshipLineKinds = new Set(Object.keys(relationLabels));

export const memoryGraphRelationLabel = (relation: string) => relationLabels[relation] ?? relation.replaceAll('_', ' ');

export const memoryGraphEdgeLabel = (edge: CimmichMemoryGraphEdge) => {
  const reasons = edge.relationKinds
    .filter((relation) => relation !== 'shared_media' && relation !== 'coappears')
    .map((relation) => memoryGraphRelationLabel(relation));
  if (edge.photoCount > 0) {
    reasons.unshift(`${edge.photoCount.toLocaleString()} photos`);
  }
  return reasons.join(' · ') || 'Connected';
};

export const memoryGraphRelationshipLineLabel = (
  edge: CimmichMemoryGraphEdge,
  nodeById: Map<string, CimmichMemoryGraphNode>,
) => {
  const source = nodeById.get(edge.sourceNodeId);
  const target = nodeById.get(edge.targetNodeId);
  if (source?.kind !== 'person' || target?.kind !== 'person') {
    return '';
  }
  return edge.relationKinds
    .filter((relation) => !nonRelationshipLineKinds.has(relation))
    .map((relation) => memoryGraphRelationLabel(relation))
    .join(' · ');
};

export const memoryGraphRelationshipPathId = (edge: CimmichMemoryGraphEdge) =>
  `relationship-line-${edge.edgeId.replaceAll(/[^a-zA-Z0-9_-]/g, '-')}`;
