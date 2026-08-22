import { request } from './cimmich.service';

export type CimmichMemoryGraphNodeKind = 'event' | 'object' | 'person' | 'pet' | 'place';

export type CimmichMemoryGraphNode = {
  connectionCount: number;
  coverAssetId: string | null;
  displayName: string;
  entityId: string;
  kind: CimmichMemoryGraphNodeKind;
  nodeId: string;
  portraitStyle?: string;
  typeKind: string | null;
};

export type CimmichMemoryGraphEdge = {
  coverAssetId: string | null;
  edgeId: string;
  photoCount: number;
  relationKinds: string[];
  sourceNodeId: string;
  targetNodeId: string;
  weight: number;
};

export type CimmichMemoryGraph = {
  countsByKind: Record<CimmichMemoryGraphNodeKind, number>;
  edges: CimmichMemoryGraphEdge[];
  nodes: CimmichMemoryGraphNode[];
  schemaVersion: 'cimmich.memory-graph.v1';
  scope: { edgeLimit: number };
};

export const getCimmichMemoryGraph = (edgeLimit = 72) =>
  request<CimmichMemoryGraph>(
    `/v1/discover/memory-graph?edgeLimit=${Math.max(24, Math.min(120, Math.floor(edgeLimit)))}`,
  );
