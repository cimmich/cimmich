import type { CimmichMemoryGraphEdge, CimmichMemoryGraphNode } from '$lib/services/cimmich-discover.service';
import { cimmichMemoryGraphNodeMetrics } from './memory-graph-node-presentation';

export type CimmichMemoryGraphLayoutNode = CimmichMemoryGraphNode & {
  halfHeight: number;
  halfWidth: number;
  radius: number;
  x: number;
  y: number;
};
export type CimmichMemoryGraphSpacing = 'compact' | 'balanced' | 'roomy';
export type CimmichMemoryGraphViewBox = { height: number; width: number; x: number; y: number };

const graphWidth = 1800;
const graphHeight = 1080;
const graphAspect = graphWidth / graphHeight;
const spacingScale: Record<CimmichMemoryGraphSpacing, number> = { compact: 0.82, balanced: 1, roomy: 1.24 };

const hash = (value: string) => {
  let result = 2_166_136_261;
  for (const character of value) {
    result ^= character.codePointAt(0) ?? 0;
    result = Math.imul(result, 16_777_619);
  }
  return result >>> 0;
};
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));
const kindBias = {
  event: { x: -170, y: -170 },
  object: { x: -170, y: 170 },
  person: { x: 0, y: -10 },
  pet: { x: 40, y: 190 },
  place: { x: 190, y: 20 },
} as const;

export const layoutCimmichMemoryGraph = (
  nodes: CimmichMemoryGraphNode[],
  edges: CimmichMemoryGraphEdge[],
  spacing: CimmichMemoryGraphSpacing = 'balanced',
): CimmichMemoryGraphLayoutNode[] => {
  const scale = spacingScale[spacing];
  const centerX = graphWidth / 2;
  const centerY = graphHeight / 2;
  const layout = nodes.map((node) => {
    const seed = hash(node.nodeId);
    const angle = ((seed % 65_521) / 65_521) * Math.PI * 2;
    const distance = (180 + ((seed >>> 10) % 310)) * scale;
    const bias = kindBias[node.kind];
    const radius = 7 + Math.min(7, Math.sqrt(Math.max(1, node.connectionCount)) * 1.65);
    return {
      ...node,
      ...cimmichMemoryGraphNodeMetrics(node, radius),
      radius,
      x: centerX + bias.x * scale + Math.cos(angle) * distance,
      y: centerY + bias.y * scale + Math.sin(angle) * distance,
    };
  });
  const byId = new Map(layout.map((node) => [node.nodeId, node]));
  const connected = edges.flatMap((edge) => {
    const source = byId.get(edge.sourceNodeId);
    const target = byId.get(edge.targetNodeId);
    return source && target ? [{ edge, source, target }] : [];
  });

  // Small visual nodes still own a larger collision radius for readable labels.
  for (let iteration = 0; iteration < 300; iteration += 1) {
    const cooling = Math.max(0.08, 1 - iteration / 315);
    const movement = new Map(layout.map((node) => [node.nodeId, { x: 0, y: 0 }]));
    for (let leftIndex = 0; leftIndex < layout.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < layout.length; rightIndex += 1) {
        const left = layout[leftIndex];
        const right = layout[rightIndex];
        const dx = right.x - left.x || 0.01;
        const dy = right.y - left.y || 0.01;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const collisionDistance =
          Math.max(left.halfWidth, left.halfHeight) + Math.max(right.halfWidth, right.halfHeight) + 38 * scale;
        const charge = Math.min(13, (30_000 * scale * scale) / (distance * distance)) * cooling;
        const force = charge + Math.max(0, collisionDistance - distance) * 0.34;
        const moveX = (dx / distance) * force;
        const moveY = (dy / distance) * force;
        movement.get(left.nodeId)!.x -= moveX;
        movement.get(left.nodeId)!.y -= moveY;
        movement.get(right.nodeId)!.x += moveX;
        movement.get(right.nodeId)!.y += moveY;
      }
    }
    for (const { edge, source, target } of connected) {
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const desired = (185 + Math.min(55, Math.log2(Math.max(1, edge.weight)) * 16)) * scale;
      const force = (distance - desired) * 0.017 * cooling;
      const moveX = (dx / distance) * force;
      const moveY = (dy / distance) * force;
      movement.get(source.nodeId)!.x += moveX;
      movement.get(source.nodeId)!.y += moveY;
      movement.get(target.nodeId)!.x -= moveX;
      movement.get(target.nodeId)!.y -= moveY;
    }
    for (const node of layout) {
      const bias = kindBias[node.kind];
      const move = movement.get(node.nodeId)!;
      move.x += (centerX + bias.x * scale - node.x) * 0.0013 * cooling;
      move.y += (centerY + bias.y * scale - node.y) * 0.0013 * cooling;
      node.x = clamp(node.x + clamp(move.x, -13, 13), 34, graphWidth - 34);
      node.y = clamp(node.y + clamp(move.y, -13, 13), 34, graphHeight - 34);
    }
  }
  return layout;
};

export const cimmichMemoryGraphViewBox = (
  nodes: CimmichMemoryGraphLayoutNode[],
  padding = 90,
): CimmichMemoryGraphViewBox => {
  if (nodes.length === 0) {
    return { height: graphHeight, width: graphWidth, x: 0, y: 0 };
  }
  const left = Math.min(...nodes.map(({ halfWidth, x }) => x - halfWidth)) - padding;
  const right = Math.max(...nodes.map(({ halfWidth, x }) => x + halfWidth)) + padding;
  const top = Math.min(...nodes.map(({ halfHeight, y }) => y - halfHeight)) - padding;
  const bottom = Math.max(...nodes.map(({ halfHeight, y }) => y + halfHeight)) + padding;
  let width = Math.max(320, right - left);
  let height = Math.max(192, bottom - top);
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  if (width / height > graphAspect) {
    height = width / graphAspect;
  } else {
    width = height * graphAspect;
  }
  return { height, width, x: centerX - width / 2, y: centerY - height / 2 };
};

export const cimmichMemoryGraphBounds = { height: graphHeight, width: graphWidth };
