import { describe, expect, it } from 'vitest';
import type { CimmichMemoryGraph } from '$lib/services/cimmich-discover.service';
import type { CimmichPerson } from '$lib/services/cimmich.service';
import {
  buildCimmichPersonConnectionGraph,
  buildCimmichPersonDrilldownGraph,
  cimmichPersonConnectionPortrait,
  cimmichPersonGraphViewOptions,
  getCimmichPersonHiddenNeighbourCounts,
  groupCimmichPersonConnections,
  projectCimmichPersonGraphView,
  formatCimmichConnectionFactWithContexts,
} from './person-connections';
import type { CimmichPersonConnection } from './person-page-types';

describe('Person connections', () => {
  it('uses the selected face presentation instead of the full representative photo', () => {
    const portrait = cimmichPersonConnectionPortrait({
      presentationFace: {
        assetId: 'asset-selected-face',
        crop: { h: 0.25, w: 0.2, x: 0.4, y: 0.3 },
        filename: 'group.jpg',
        height: 800,
        observationId: 'face-selected',
        observationKind: 'face',
        selectionMode: 'explicit',
        slotKind: 'face',
        sourceAssetId: 'source-selected-face',
        updatedAt: '2026-08-22T00:00:00.000Z',
        width: 1200,
      },
      sourceAssetId: 'source-representative-photo',
    } as CimmichPerson);

    expect(portrait.sourceAssetId).toBe('source-selected-face');
    expect(portrait.portraitStyle).toContain('position: absolute');
    expect(portrait.portraitStyle).toContain('max-width: none');
  });

  it('keeps relationship modifiers attached while naming their shared context', () => {
    expect(
      formatCimmichConnectionFactWithContexts({
        contexts: [{ displayName: 'Willow House', id: 'place-willow', kind: 'place', typeKind: 'point' }],
        dateEnd: null,
        dateStart: null,
        direction: 'outgoing',
        displayLabel: 'Housemate (Former)',
        factId: 'fact-housemate',
        modifiers: [],
        note: null,
        other: { displayName: 'Alex', id: 'person-alex', kind: 'person', typeKind: null },
        semanticKind: 'housemate',
        typeId: 'connectiontype-housemate',
        validity: 'past',
      }),
    ).toBe('Housemate (Former) @ Willow House');
  });

  it('never turns a Person category or shared life period into a pairwise relationship', () => {
    const graph = buildCimmichPersonConnectionGraph({
      connections: [
        {
          displayName: 'Nora',
          entityId: 'person-nora',
          entityKind: 'person',
          metaLabel: 'Cedar House Years',
          photoCount: 1,
          sourceAssetId: 'source-nora',
          typeKind: 'person',
        },
        {
          contextCount: 1,
          directRelations: [{ relationId: 'life-period-cedar', relationType: 'participant' }],
          displayName: 'Theo',
          entityId: 'person-theo',
          entityKind: 'person',
          metaLabel: 'Cedar House Years',
          photoCount: 0,
          sourceAssetId: 'source-theo',
          typeKind: 'participant',
        },
      ],
      personId: 'person-maya',
      personName: 'Maya',
      sourceAssetId: null,
    });

    expect(graph.edges.map(({ relationKinds }) => relationKinds)).toEqual([
      ['coappears', 'shared_media'],
      ['shared_context'],
    ]);
    expect(graph.edges.flatMap(({ relationKinds }) => relationKinds)).not.toContain('Cedar House Years');
  });

  it('merges shared photos and shared contexts for the same Person', () => {
    const connections: CimmichPersonConnection[] = [
      {
        displayName: 'Noah Vale',
        entityId: 'person-noah',
        entityKind: 'person',
        metaLabel: 'Appears together',
        photoCount: 2,
        sourceAssetId: 'source-shared-photo',
        typeKind: 'person',
      },
      {
        contextCount: 1,
        displayName: 'Noah Vale',
        entityId: 'person-noah',
        entityKind: 'person',
        metaLabel: 'Friend',
        photoCount: 0,
        portraitStyle: 'position: absolute; left: -100%',
        sourceAssetId: 'source-selected-face',
        typeKind: 'participant',
      },
    ];

    expect(groupCimmichPersonConnections(connections)).toEqual([
      {
        id: 'person',
        label: 'People',
        items: [
          {
            contextCount: 1,
            directRelations: [],
            displayName: 'Noah Vale',
            entityId: 'person-noah',
            entityKind: 'person',
            metaLabel: 'Friend',
            photoCount: 2,
            portraitStyle: 'position: absolute; left: -100%',
            sourceAssetId: 'source-selected-face',
            typeKind: 'person',
          },
        ],
      },
      { id: 'event', items: [], label: 'Events' },
      { id: 'place', items: [], label: 'Places' },
      { id: 'object', items: [], label: 'Things' },
    ]);
  });

  it('keeps every connection category visible when it is empty', () => {
    expect(groupCimmichPersonConnections([])).toEqual([
      { id: 'person', items: [], label: 'People' },
      { id: 'event', items: [], label: 'Events' },
      { id: 'place', items: [], label: 'Places' },
      { id: 'object', items: [], label: 'Things' },
    ]);
  });

  it('builds one scoped web from the same connections shown in the list', () => {
    const graph = buildCimmichPersonConnectionGraph({
      connections: [
        {
          displayName: 'Noah Vale',
          entityId: 'person-noah',
          entityKind: 'person',
          metaLabel: 'Friend (Former, Childhood)',
          photoCount: 2,
          sourceAssetId: 'source-noah',
          typeKind: 'person',
        },
        {
          directRelations: [{ relationId: 'relation-trip', relationType: 'participant' }],
          displayName: 'School trip',
          entityId: 'event-trip',
          entityKind: 'event',
          metaLabel: 'participant',
          photoCount: 0,
          sourceAssetId: null,
          typeKind: 'trip',
        },
      ],
      personId: 'person-maya',
      personName: 'Maya Chen',
      sourcePortraitStyle: 'position: absolute; left: -50%',
      sourceAssetId: 'source-maya',
    });

    expect(graph.countsByKind).toEqual({ event: 1, object: 0, person: 2, pet: 0, place: 0 });
    expect(graph.nodes.map(({ nodeId }) => nodeId)).toEqual([
      'person:person-maya',
      'person:person-noah',
      'event:event-trip',
    ]);
    expect(graph.nodes[0]?.portraitStyle).toBe('position: absolute; left: -50%');
    expect(graph.edges).toEqual([
      expect.objectContaining({
        photoCount: 2,
        relationKinds: ['coappears', 'shared_media'],
        sourceNodeId: 'person:person-maya',
        targetNodeId: 'person:person-noah',
      }),
      expect.objectContaining({
        relationKinds: ['participant'],
        sourceNodeId: 'person:person-maya',
        targetNodeId: 'event:event-trip',
      }),
    ]);
  });

  it('keeps People as the only point layer and separates each context into an explicit view', () => {
    const graph = buildCimmichPersonConnectionGraph({
      connections: [
        {
          displayName: 'Samira',
          entityId: 'person-samira',
          entityKind: 'person',
          metaLabel: 'Friend',
          photoCount: 0,
          sourceAssetId: null,
          typeKind: 'person',
        },
        {
          directRelations: [{ relationId: 'period-cedar', relationType: 'participant' }],
          displayName: 'Cedar House Years',
          entityId: 'period-cedar',
          entityKind: 'event',
          metaLabel: 'participant',
          photoCount: 0,
          sourceAssetId: null,
          typeKind: 'life_period',
        },
        {
          displayName: 'Willow House',
          entityId: 'place-willow',
          entityKind: 'place',
          metaLabel: 'Lives here',
          photoCount: 0,
          sourceAssetId: null,
          typeKind: 'point',
        },
      ],
      personId: 'person-maya',
      personName: 'Maya',
      sourceAssetId: null,
    });

    expect(cimmichPersonGraphViewOptions(graph)).toEqual([
      { count: 2, label: 'People', value: 'people' },
      { count: 1, label: 'Life periods', value: 'life_period' },
      { count: 1, label: 'Places', value: 'place' },
    ]);
    const people = projectCimmichPersonGraphView(graph, 'people');
    expect(people.nodes.map(({ nodeId }) => nodeId)).toEqual(['person:person-maya', 'person:person-samira']);
    expect(people.edges).toHaveLength(1);
    expect(people.countsByKind).toEqual({ event: 0, object: 0, person: 2, pet: 0, place: 0 });

    const places = projectCimmichPersonGraphView(graph, 'place');
    expect(places.nodes.map(({ nodeId }) => nodeId)).toEqual([
      'person:person-maya',
      'person:person-samira',
      'place:place-willow',
    ]);
    expect(places.edges).toHaveLength(2);
    expect(places.countsByKind.place).toBe(1);
  });

  it('closes the initial web over relationships between visible neighbours', () => {
    const baseGraph = buildCimmichPersonConnectionGraph({
      connections: [
        {
          displayName: 'Alex',
          entityId: 'person-alex',
          entityKind: 'person',
          metaLabel: 'Friend',
          photoCount: 1,
          sourceAssetId: null,
          typeKind: 'person',
        },
        {
          displayName: 'Samira',
          entityId: 'person-samira',
          entityKind: 'person',
          metaLabel: 'Friend',
          photoCount: 0,
          sourceAssetId: null,
          typeKind: 'person',
        },
      ],
      personId: 'person-maya',
      personName: 'Maya',
      sourceAssetId: null,
    });
    const archiveGraph: CimmichMemoryGraph = {
      countsByKind: { event: 0, object: 0, person: 3, pet: 0, place: 1 },
      edges: [
        {
          coverAssetId: null,
          edgeId: 'alex-samira',
          photoCount: 0,
          relationKinds: ['Partner', 'Friend'],
          sourceNodeId: 'person:person-alex',
          targetNodeId: 'person:person-samira',
          weight: 2,
        },
        {
          coverAssetId: null,
          edgeId: 'alex-house',
          photoCount: 0,
          relationKinds: ['Lives here'],
          sourceNodeId: 'person:person-alex',
          targetNodeId: 'place:place-cedar-house',
          weight: 1,
        },
        {
          coverAssetId: null,
          edgeId: 'samira-house',
          photoCount: 0,
          relationKinds: ['Lives here'],
          sourceNodeId: 'person:person-samira',
          targetNodeId: 'place:place-cedar-house',
          weight: 1,
        },
      ],
      nodes: [
        {
          connectionCount: 2,
          coverAssetId: null,
          displayName: 'Alex',
          entityId: 'person-alex',
          kind: 'person',
          nodeId: 'person:person-alex',
          typeKind: null,
        },
        {
          connectionCount: 2,
          coverAssetId: null,
          displayName: 'Samira',
          entityId: 'person-samira',
          kind: 'person',
          nodeId: 'person:person-samira',
          typeKind: null,
        },
        {
          connectionCount: 2,
          coverAssetId: null,
          displayName: 'Cedar House',
          entityId: 'place-cedar-house',
          kind: 'place',
          nodeId: 'place:place-cedar-house',
          typeKind: 'property',
        },
      ],
      schemaVersion: 'cimmich.memory-graph.v1',
      scope: { edgeLimit: 120 },
    };

    const initial = buildCimmichPersonDrilldownGraph({ archiveGraph, baseGraph, expandedNodeIds: [] });
    expect(initial.nodes.map(({ nodeId }) => nodeId)).toEqual([
      'person:person-maya',
      'person:person-alex',
      'person:person-samira',
    ]);
    expect(initial.edges).toHaveLength(3);
    expect(initial.edges).toContainEqual(expect.objectContaining({ edgeId: 'alex-samira' }));
    expect(
      getCimmichPersonHiddenNeighbourCounts({
        archiveGraph,
        graph: initial,
        initialNodeId: 'person:person-maya',
      }),
    ).toEqual({ 'person:person-alex': 1, 'person:person-samira': 1 });

    const expanded = buildCimmichPersonDrilldownGraph({
      archiveGraph,
      baseGraph,
      expandedNodeIds: ['person:person-alex'],
    });
    expect(expanded.nodes.map(({ nodeId }) => nodeId)).toContain('place:place-cedar-house');
    expect(expanded.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ edgeId: 'alex-house' }),
        expect.objectContaining({ edgeId: 'samira-house' }),
      ]),
    );
    expect(expanded.countsByKind.place).toBe(1);
  });
});
