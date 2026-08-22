import type { CimmichMemoryGraphEdge } from '$lib/services/cimmich-discover.service';
import type { CimmichMemoryGraphLayoutNode } from './memory-graph-layout';
import { cimmichMemoryGraphNodeShape } from './memory-graph-node-presentation';

export type CimmichMemoryGraphGroupOutline = {
  groupNode: CimmichMemoryGraphLayoutNode;
  height: number;
  labelWidth: number;
  memberNodeIds: string[];
  width: number;
  x: number;
  y: number;
};

export const cimmichMemoryGraphGroupMeta = (node: CimmichMemoryGraphLayoutNode) => {
  if (node.kind === 'place') {
    return { color: '#4ade80', label: 'Place' };
  }
  if (node.kind === 'object') {
    return { color: '#c084fc', label: 'Thing' };
  }
  if (node.kind === 'event') {
    const label =
      node.typeKind === 'life_period'
        ? 'Life period'
        : node.typeKind === 'trip'
          ? 'Trip'
          : node.typeKind === 'activity'
            ? 'Activity'
            : 'Event';
    return { color: '#f59e0b', label };
  }
  return { color: '#84a7ff', label: 'Context' };
};

const groupPadding = 34;

export const cimmichMemoryGraphGroupOutlines = (
  nodes: CimmichMemoryGraphLayoutNode[],
  edges: CimmichMemoryGraphEdge[],
  forcedGroupNodeIds: ReadonlySet<string> = new Set(),
): CimmichMemoryGraphGroupOutline[] => {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const groupNodes = nodes.filter(
    (node) => forcedGroupNodeIds.has(node.nodeId) || cimmichMemoryGraphNodeShape(node) === 'group',
  );
  const groupNodeIds = new Set(groupNodes.map(({ nodeId }) => nodeId));

  const outlines = groupNodes.flatMap((groupNode) => {
    const memberNodeIds = [
      ...new Set(
        edges.flatMap((edge) => {
          if (edge.sourceNodeId === groupNode.nodeId && !groupNodeIds.has(edge.targetNodeId)) {
            return [edge.targetNodeId];
          }
          if (edge.targetNodeId === groupNode.nodeId && !groupNodeIds.has(edge.sourceNodeId)) {
            return [edge.sourceNodeId];
          }
          return [];
        }),
      ),
    ];
    const members = memberNodeIds.flatMap((nodeId) => (byId.get(nodeId) ? [byId.get(nodeId)!] : []));
    if (members.length === 0) {
      return [];
    }

    let left = Math.min(...members.map((node) => node.x - node.halfWidth)) - groupPadding;
    let right = Math.max(...members.map((node) => node.x + node.halfWidth)) + groupPadding;
    const top = Math.min(...members.map((node) => node.y - node.halfHeight)) - groupPadding;
    const bottom = Math.max(...members.map((node) => node.y + node.halfHeight)) + groupPadding;
    const labelWidth = Math.max(76, Math.min(170, 58 + groupNode.displayName.length * 4.2));
    const minimumWidth = labelWidth + 28;
    if (right - left < minimumWidth) {
      const center = (left + right) / 2;
      left = center - minimumWidth / 2;
      right = center + minimumWidth / 2;
    }

    return [{ groupNode, height: bottom - top, labelWidth, memberNodeIds, width: right - left, x: left, y: top }];
  });

  // Several contexts can contain the same People. Nest identical membership
  // sets instead of drawing indistinguishable outlines and labels on top of
  // one another.
  const membershipDepth = new Map<string, number>();
  return outlines
    .sort(
      (left, right) =>
        left.memberNodeIds.join('|').localeCompare(right.memberNodeIds.join('|')) ||
        left.groupNode.displayName.localeCompare(right.groupNode.displayName),
    )
    .map((outline) => {
      const membershipKey = [...outline.memberNodeIds].sort().join('|');
      const depth = membershipDepth.get(membershipKey) ?? 0;
      membershipDepth.set(membershipKey, depth + 1);
      if (depth === 0) {
        return outline;
      }
      const inset = depth * 22;
      return {
        ...outline,
        height: outline.height + inset * 2,
        width: outline.width + inset * 2,
        x: outline.x - inset,
        y: outline.y - inset,
      };
    });
};

export const cimmichMemoryGraphMembershipEdgeIds = (
  nodes: CimmichMemoryGraphLayoutNode[],
  edges: CimmichMemoryGraphEdge[],
  forcedGroupNodeIds: ReadonlySet<string> = new Set(),
) => {
  const groupNodeIds = new Set(
    nodes
      .filter((node) => forcedGroupNodeIds.has(node.nodeId) || cimmichMemoryGraphNodeShape(node) === 'group')
      .map(({ nodeId }) => nodeId),
  );
  return new Set(
    edges
      .filter((edge) => groupNodeIds.has(edge.sourceNodeId) || groupNodeIds.has(edge.targetNodeId))
      .map(({ edgeId }) => edgeId),
  );
};

export const cimmichMemoryGraphGroupContextNodeIds = (groups: CimmichMemoryGraphGroupOutline[], nodeId: string) =>
  new Set(
    groups
      .filter(({ groupNode, memberNodeIds }) => groupNode.nodeId === nodeId || memberNodeIds.includes(nodeId))
      .flatMap(({ memberNodeIds }) => memberNodeIds),
  );
