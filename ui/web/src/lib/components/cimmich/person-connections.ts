import { SvelteURLSearchParams } from 'svelte/reactivity';
import { Route } from '$lib/route';
import type { CimmichConnectionFact } from '$lib/services/cimmich-connection-facts.service';
import type {
  CimmichMemoryGraph,
  CimmichMemoryGraphEdge,
  CimmichMemoryGraphNodeKind,
} from '$lib/services/cimmich-discover.service';
import { getCimmichContextEntity, type CimmichPerson, type CimmichPersonAsset } from '$lib/services/cimmich.service';
import { cimmichPresentationSquareStyle, cimmichSquareObservationStyle } from '$lib/utils/cimmich-crop';
import type { CimmichPersonConnection, CimmichPersonConnectionGroup } from './person-page-types';

export const cimmichPersonConnectionPortrait = (
  person: CimmichPerson,
): Pick<CimmichPersonConnection, 'portraitStyle' | 'sourceAssetId'> => {
  if (person.presentationFace?.sourceAssetId) {
    return {
      portraitStyle: cimmichPresentationSquareStyle({ ...person.presentationFace, presentationAspect: 1 }),
      sourceAssetId: person.presentationFace.sourceAssetId,
    };
  }
  if (
    person.sourceAssetId &&
    person.box_x !== null &&
    person.box_y !== null &&
    person.box_w !== null &&
    person.box_h !== null
  ) {
    return {
      portraitStyle: cimmichSquareObservationStyle({
        boxH: person.box_h,
        boxW: person.box_w,
        boxX: person.box_x,
        boxY: person.box_y,
        height: person.height ?? 0,
        padding: 1.55,
        width: person.width ?? 0,
      }),
      sourceAssetId: person.sourceAssetId,
    };
  }
  return { portraitStyle: undefined, sourceAssetId: person.sourceAssetId || null };
};

export const formatCimmichConnectionFactWithContexts = (fact: CimmichConnectionFact) => {
  const names = [...new Set((fact.contexts ?? []).map(({ displayName }) => displayName))];
  return names.length > 0 ? `${fact.displayLabel} @ ${names.join(', ')}` : fact.displayLabel;
};

export const groupCimmichPersonConnections = (
  connections: CimmichPersonConnection[],
): CimmichPersonConnectionGroup[] => {
  const merged = new Map<string, CimmichPersonConnection>();
  for (const connection of connections) {
    const key = `${connection.entityKind}:${connection.entityId}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...connection });
      continue;
    }
    existing.contextCount = (existing.contextCount ?? 0) + (connection.contextCount ?? 0);
    existing.photoCount = Math.max(existing.photoCount, connection.photoCount);
    if (connection.portraitStyle && connection.sourceAssetId) {
      existing.portraitStyle = connection.portraitStyle;
      existing.sourceAssetId = connection.sourceAssetId;
    } else {
      existing.sourceAssetId ||= connection.sourceAssetId;
    }
    if (connection.recordedFacts?.length) {
      existing.recordedFacts = [...(existing.recordedFacts ?? []), ...connection.recordedFacts];
    }
    if (existing.recordedFacts?.length) {
      existing.metaLabel = [
        ...new Set(existing.recordedFacts.map((fact) => formatCimmichConnectionFactWithContexts(fact))),
      ].join(' · ');
    }
    if (existing.metaLabel === 'Appears together' && connection.metaLabel !== 'Appears together') {
      existing.metaLabel = connection.metaLabel;
    }
    existing.directRelations = [...(existing.directRelations ?? []), ...(connection.directRelations ?? [])];
  }
  return (
    [
      { id: 'person', label: 'People' },
      { id: 'event', label: 'Events' },
      { id: 'place', label: 'Places' },
      { id: 'object', label: 'Things' },
    ] as const
  ).map((group) => ({
    ...group,
    items: [...merged.values()].filter((connection) => connection.entityKind === group.id),
  }));
};

const connectionNodeKind = (kind: CimmichPersonConnection['entityKind']): CimmichMemoryGraphNodeKind =>
  kind === 'object' ? 'object' : kind;

export type CimmichPersonGraphView = 'activity' | 'event' | 'life_period' | 'object' | 'people' | 'place' | 'trip';

export type CimmichPersonGraphViewOption = {
  count: number;
  label: string;
  value: CimmichPersonGraphView;
};

const personGraphViewMatches = (node: CimmichMemoryGraph['nodes'][number], view: CimmichPersonGraphView) => {
  if (node.kind === 'person') {
    return true;
  }
  if (view === 'people') {
    return false;
  }
  if (view === 'place' || view === 'object') {
    return node.kind === view;
  }
  return node.kind === 'event' && node.typeKind === view;
};

export const cimmichPersonGraphViewOptions = (graph: CimmichMemoryGraph): CimmichPersonGraphViewOption[] => {
  const definitions: Array<Omit<CimmichPersonGraphViewOption, 'count'>> = [
    { label: 'People', value: 'people' },
    { label: 'Life periods', value: 'life_period' },
    { label: 'Events', value: 'event' },
    { label: 'Trips', value: 'trip' },
    { label: 'Activities', value: 'activity' },
    { label: 'Places', value: 'place' },
    { label: 'Things', value: 'object' },
  ];
  return definitions
    .map((definition) => ({
      ...definition,
      count:
        definition.value === 'people'
          ? graph.nodes.filter((node) => node.kind === 'person').length
          : graph.nodes.filter((node) => node.kind !== 'person' && personGraphViewMatches(node, definition.value))
              .length,
    }))
    .filter(({ count, value }) => value === 'people' || count > 0);
};

export const projectCimmichPersonGraphView = (
  graph: CimmichMemoryGraph,
  view: CimmichPersonGraphView,
): CimmichMemoryGraph => {
  const visibleNodeIds = new Set(
    graph.nodes.filter((node) => personGraphViewMatches(node, view)).map(({ nodeId }) => nodeId),
  );
  const edges = graph.edges.filter(
    ({ sourceNodeId, targetNodeId }) => visibleNodeIds.has(sourceNodeId) && visibleNodeIds.has(targetNodeId),
  );
  const connectionCounts = new Map<string, number>();
  for (const edge of edges) {
    connectionCounts.set(edge.sourceNodeId, (connectionCounts.get(edge.sourceNodeId) ?? 0) + 1);
    connectionCounts.set(edge.targetNodeId, (connectionCounts.get(edge.targetNodeId) ?? 0) + 1);
  }
  const nodes = graph.nodes
    .filter(({ nodeId }) => visibleNodeIds.has(nodeId))
    .map((node) => ({ ...node, connectionCount: connectionCounts.get(node.nodeId) ?? 0 }));
  const countsByKind: CimmichMemoryGraph['countsByKind'] = { event: 0, object: 0, person: 0, pet: 0, place: 0 };
  for (const node of nodes) {
    countsByKind[node.kind] += 1;
  }
  return { ...graph, countsByKind, edges, nodes };
};

export const buildCimmichPersonConnectionGraph = ({
  connections,
  personId,
  personName,
  sourcePortraitStyle,
  sourceAssetId,
}: {
  connections: CimmichPersonConnection[];
  personId: string;
  personName: string;
  sourcePortraitStyle?: string;
  sourceAssetId: string | null;
}): CimmichMemoryGraph => {
  const rootNodeId = `person:${personId}`;
  const nodes: CimmichMemoryGraph['nodes'] = [
    {
      connectionCount: connections.length,
      coverAssetId: sourceAssetId,
      displayName: personName,
      entityId: personId,
      kind: 'person',
      nodeId: rootNodeId,
      portraitStyle: sourcePortraitStyle,
      typeKind: null,
    },
  ];
  const edges: CimmichMemoryGraphEdge[] = [];

  for (const connection of connections) {
    const kind = connectionNodeKind(connection.entityKind);
    const targetNodeId = `${kind}:${connection.entityId}`;
    nodes.push({
      connectionCount: 1,
      coverAssetId: connection.sourceAssetId,
      displayName: connection.displayName,
      entityId: connection.entityId,
      kind,
      nodeId: targetNodeId,
      portraitStyle: connection.portraitStyle,
      typeKind: connection.typeKind,
    });
    const relationKinds = new Set<string>();
    if (connection.recordedFacts?.length) {
      for (const fact of connection.recordedFacts) {
        relationKinds.add(formatCimmichConnectionFactWithContexts(fact));
      }
    } else if (
      connection.entityKind === 'person' &&
      ((connection.directRelations?.length ?? 0) > 0 || (connection.contextCount ?? 0) > 0)
    ) {
      relationKinds.add('shared_context');
    } else if (connection.entityKind === 'person') {
      relationKinds.add(connection.photoCount > 0 ? 'coappears' : 'related');
    } else if (connection.directRelations?.length) {
      for (const relation of connection.directRelations) {
        relationKinds.add(relation.relationType);
      }
    } else if (connection.metaLabel === 'Appears together') {
      relationKinds.add('coappears');
    } else if (connection.metaLabel) {
      relationKinds.add(connection.metaLabel);
    }
    if (connection.photoCount > 0) {
      relationKinds.add('shared_media');
    }
    if (relationKinds.size === 0) {
      relationKinds.add('related');
    }
    edges.push({
      coverAssetId: connection.sourceAssetId,
      edgeId: `person-connection:${personId}:${kind}:${connection.entityId}`,
      photoCount: connection.photoCount,
      relationKinds: [...relationKinds],
      sourceNodeId: rootNodeId,
      targetNodeId,
      weight: Math.max(1, connection.photoCount, connection.contextCount ?? 0),
    });
  }

  const countsByKind: CimmichMemoryGraph['countsByKind'] = { event: 0, object: 0, person: 0, pet: 0, place: 0 };
  for (const node of nodes) {
    countsByKind[node.kind] += 1;
  }
  return {
    countsByKind,
    edges,
    nodes,
    schemaVersion: 'cimmich.memory-graph.v1',
    scope: { edgeLimit: Math.max(24, connections.length) },
  };
};

const cimmichMemoryGraphEdgeKey = ({ sourceNodeId, targetNodeId }: CimmichMemoryGraphEdge) =>
  [sourceNodeId, targetNodeId].sort().join('--');

const mergeCimmichMemoryGraphEdge = (
  existing: CimmichMemoryGraphEdge | undefined,
  incoming: CimmichMemoryGraphEdge,
): CimmichMemoryGraphEdge =>
  existing
    ? {
        ...existing,
        coverAssetId: existing.coverAssetId ?? incoming.coverAssetId,
        photoCount: Math.max(existing.photoCount, incoming.photoCount),
        relationKinds: [...new Set([...existing.relationKinds, ...incoming.relationKinds])],
        weight: Math.max(existing.weight, incoming.weight),
      }
    : { ...incoming, relationKinds: [...incoming.relationKinds] };

export const buildCimmichPersonDrilldownGraph = ({
  archiveGraph,
  baseGraph,
  expandedNodeIds,
}: {
  archiveGraph: CimmichMemoryGraph | null;
  baseGraph: CimmichMemoryGraph;
  expandedNodeIds: string[];
}): CimmichMemoryGraph => {
  if (!archiveGraph) {
    return baseGraph;
  }
  const visibleNodeIds = new Set(baseGraph.nodes.map(({ nodeId }) => nodeId));
  const expanded = new Set(expandedNodeIds);
  for (const edge of archiveGraph.edges) {
    if (expanded.has(edge.sourceNodeId) || expanded.has(edge.targetNodeId)) {
      visibleNodeIds.add(edge.sourceNodeId);
      visibleNodeIds.add(edge.targetNodeId);
    }
  }

  const edges = new Map<string, CimmichMemoryGraphEdge>();
  for (const edge of baseGraph.edges) {
    const key = cimmichMemoryGraphEdgeKey(edge);
    edges.set(key, mergeCimmichMemoryGraphEdge(edges.get(key), edge));
  }
  // Close the visible web over archive truth. This reveals relationships
  // between root neighbours (for example Alex ↔ Samira) without pulling their
  // otherwise unrelated neighbourhood into the Person's initial view.
  for (const edge of archiveGraph.edges) {
    if (!visibleNodeIds.has(edge.sourceNodeId) || !visibleNodeIds.has(edge.targetNodeId)) {
      continue;
    }
    const key = cimmichMemoryGraphEdgeKey(edge);
    edges.set(key, mergeCimmichMemoryGraphEdge(edges.get(key), edge));
  }

  const archiveNodeById = new Map(archiveGraph.nodes.map((node) => [node.nodeId, node]));
  const nodes = new Map<string, CimmichMemoryGraph['nodes'][number]>();
  for (const node of baseGraph.nodes) {
    nodes.set(node.nodeId, { ...archiveNodeById.get(node.nodeId), ...node });
  }
  for (const nodeId of visibleNodeIds) {
    const node = archiveNodeById.get(nodeId);
    if (node && !nodes.has(nodeId)) {
      nodes.set(nodeId, { ...node });
    }
  }
  const connectionCounts = new Map<string, number>();
  for (const edge of edges.values()) {
    connectionCounts.set(edge.sourceNodeId, (connectionCounts.get(edge.sourceNodeId) ?? 0) + 1);
    connectionCounts.set(edge.targetNodeId, (connectionCounts.get(edge.targetNodeId) ?? 0) + 1);
  }
  const projectedNodes = [...nodes.values()].map((node) => ({
    ...node,
    connectionCount: connectionCounts.get(node.nodeId) ?? 0,
  }));
  const countsByKind: CimmichMemoryGraph['countsByKind'] = { event: 0, object: 0, person: 0, pet: 0, place: 0 };
  for (const node of projectedNodes) {
    countsByKind[node.kind] += 1;
  }
  return {
    countsByKind,
    edges: [...edges.values()],
    nodes: projectedNodes,
    schemaVersion: 'cimmich.memory-graph.v1',
    scope: { edgeLimit: archiveGraph.scope.edgeLimit },
  };
};

export const getCimmichPersonHiddenNeighbourCounts = ({
  archiveGraph,
  graph,
  initialNodeId,
}: {
  archiveGraph: CimmichMemoryGraph | null;
  graph: CimmichMemoryGraph;
  initialNodeId: string;
}) => {
  if (!archiveGraph) {
    return {};
  }
  const visibleNodeIds = new Set(graph.nodes.map(({ nodeId }) => nodeId));
  const hiddenByNode = new Map<string, Set<string>>();
  for (const edge of archiveGraph.edges) {
    const sourceVisible = visibleNodeIds.has(edge.sourceNodeId);
    const targetVisible = visibleNodeIds.has(edge.targetNodeId);
    if (sourceVisible === targetVisible) {
      continue;
    }
    const visibleNodeId = sourceVisible ? edge.sourceNodeId : edge.targetNodeId;
    if (visibleNodeId === initialNodeId) {
      continue;
    }
    const hiddenNodeId = sourceVisible ? edge.targetNodeId : edge.sourceNodeId;
    const hidden = hiddenByNode.get(visibleNodeId) ?? new Set<string>();
    hidden.add(hiddenNodeId);
    hiddenByNode.set(visibleNodeId, hidden);
  }
  return Object.fromEntries([...hiddenByNode].map(([nodeId, hidden]) => [nodeId, hidden.size]));
};

export const mergeCimmichRecordedConnectionFacts = (
  connections: Map<string, CimmichPersonConnection & { assetIds: Set<string> }>,
  facts: CimmichConnectionFact[],
  people: CimmichPerson[],
) => {
  for (const fact of facts) {
    const key = `${fact.other.kind}:${fact.other.id}`;
    const existing = connections.get(key);
    if (existing) {
      existing.recordedFacts = [...(existing.recordedFacts ?? []), fact];
      existing.metaLabel = [
        ...new Set(existing.recordedFacts.map((fact) => formatCimmichConnectionFactWithContexts(fact))),
      ].join(' · ');
      continue;
    }
    const connectedPerson =
      fact.other.kind === 'person' ? people.find(({ person_id }) => person_id === fact.other.id) : undefined;
    const portrait = connectedPerson ? cimmichPersonConnectionPortrait(connectedPerson) : undefined;
    connections.set(key, {
      assetIds: new Set(),
      displayName: fact.other.displayName,
      entityId: fact.other.id,
      entityKind: fact.other.kind,
      metaLabel: formatCimmichConnectionFactWithContexts(fact),
      photoCount: 0,
      portraitStyle: portrait?.portraitStyle,
      recordedFacts: [fact],
      sourceAssetId: portrait?.sourceAssetId ?? null,
      typeKind: fact.other.typeKind ?? fact.other.kind,
    });
  }
};

export const getCimmichPersonConnectionHref = (
  { entityId, entityKind }: CimmichPersonConnection,
  people: CimmichPerson[],
) => {
  if (entityKind === 'person') {
    const person = people.find((row) => row.person_id === entityId);
    return person
      ? Route.cimmichPerson({ name: person.display_name, personId: person.person_id })
      : Route.cimmichPeople();
  }
  const search = new SvelteURLSearchParams({ entityId });
  if (entityKind === 'object') {
    search.set('family', 'objects');
    return `${Route.cimmichPlaces()}?${search.toString()}`;
  }
  return `${entityKind === 'event' ? Route.cimmichEvents() : Route.cimmichPlaces()}?${search.toString()}`;
};

export const loadCimmichPeopleConnections = async (
  personId: string,
  assets: CimmichPersonAsset[],
  people: CimmichPerson[],
) => {
  const contextCounts = new Map<string, number>();
  for (const asset of assets) {
    for (const context of asset.contexts) {
      contextCounts.set(context.entityId, (contextCounts.get(context.entityId) ?? 0) + 1);
    }
  }
  // Uncapped, this fired one request per unique context tag across the
  // person's assets. Rank first so only the strongest 32 enter the lane.
  const contexts = [
    ...new Map(assets.flatMap((asset) => asset.contexts).map((context) => [context.entityId, context])).values(),
  ]
    .sort((left, right) => (contextCounts.get(right.entityId) ?? 0) - (contextCounts.get(left.entityId) ?? 0))
    .slice(0, 32);
  const details: (Awaited<ReturnType<typeof getCimmichContextEntity>> | null)[] = Array.from(
    { length: contexts.length },
    () => null,
  );
  let nextContextIndex = 0;
  const contextWorker = async () => {
    while (nextContextIndex < contexts.length) {
      const index = nextContextIndex++;
      const context = contexts[index];
      details[index] = await getCimmichContextEntity(
        context.entityKind === 'event' ? 'events' : context.entityKind === 'object' ? 'objects' : 'places',
        context.entityId,
      ).catch(() => null);
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, contexts.length) }, () => contextWorker()));
  const linked = new Map<string, CimmichPersonConnection & { contextIds: Set<string> }>();
  for (const detail of details) {
    if (!detail) {
      continue;
    }
    for (const relation of detail.relations) {
      if (relation.targetKind !== 'person' || relation.targetId === personId) {
        continue;
      }
      const person = people.find((row) => row.person_id === relation.targetId);
      if (!person?.sourceAssetId) {
        continue;
      }
      const existing = linked.get(person.person_id);
      if (existing) {
        existing.contextIds.add(detail.entity.entityId);
        existing.contextCount = existing.contextIds.size;
        continue;
      }
      linked.set(person.person_id, {
        contextCount: 1,
        contextIds: new Set([detail.entity.entityId]),
        displayName: person.display_name,
        entityId: person.person_id,
        entityKind: 'person',
        metaLabel: 'Shared context',
        photoCount: 0,
        ...cimmichPersonConnectionPortrait(person),
        typeKind: relation.relationKind,
      });
    }
  }
  return [...linked.values()].sort((left, right) => left.displayName.localeCompare(right.displayName));
};
