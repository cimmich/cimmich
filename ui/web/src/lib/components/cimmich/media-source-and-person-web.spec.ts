import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import type { CimmichMemoryGraph } from '$lib/services/cimmich-discover.service';
import { filterCimmichMemoryGraphEventTypes, memoryGraphEventType } from './memory-graph-sections';

const graph: CimmichMemoryGraph = {
  countsByKind: { event: 3, object: 0, person: 1, pet: 0, place: 1 },
  edges: [
    {
      coverAssetId: null,
      edgeId: 'person-event',
      photoCount: 0,
      relationKinds: ['participant'],
      sourceNodeId: 'person:maya',
      targetNodeId: 'event:school',
      weight: 1,
    },
    {
      coverAssetId: null,
      edgeId: 'person-place',
      photoCount: 0,
      relationKinds: ['lived_at'],
      sourceNodeId: 'person:maya',
      targetNodeId: 'place:willow',
      weight: 1,
    },
  ],
  nodes: [
    {
      connectionCount: 2,
      coverAssetId: null,
      displayName: 'Maya',
      entityId: 'maya',
      kind: 'person',
      nodeId: 'person:maya',
      typeKind: 'person',
    },
    {
      connectionCount: 1,
      coverAssetId: null,
      displayName: 'School years',
      entityId: 'school',
      kind: 'event',
      nodeId: 'event:school',
      typeKind: 'life_period',
    },
    {
      connectionCount: 0,
      coverAssetId: null,
      displayName: 'Birthday',
      entityId: 'birthday',
      kind: 'event',
      nodeId: 'event:birthday',
      typeKind: 'event',
    },
    {
      connectionCount: 0,
      coverAssetId: null,
      displayName: 'Unclassified memory',
      entityId: 'unclassified',
      kind: 'event',
      nodeId: 'event:unclassified',
      typeKind: null,
    },
    {
      connectionCount: 1,
      coverAssetId: null,
      displayName: 'Willow House',
      entityId: 'willow',
      kind: 'place',
      nodeId: 'place:willow',
      typeKind: 'property',
    },
  ],
  schemaVersion: 'cimmich.memory-graph.v1',
  scope: { edgeLimit: 72 },
};

describe('media sources and Person Discover controls', () => {
  it('opens albums and folders for image review without selecting their contents automatically', async () => {
    const source = await readFile('src/lib/components/cimmich/CimmichContextBrowser.svelte', 'utf8');

    expect(source).toContain("assetPickerMode = $state<'albums' | 'folders' | 'library' | 'nearby'>");
    expect(source).toContain("selectAssetPickerMode('folders')");
    expect(source).toContain("selectAssetPickerMode('albums')");
    expect(source).toContain('getAllAlbums({})');
    expect(source).toContain('metadataSearchDto: { albumIds: [albumId]');
    expect(source).toContain('getCimmichVisibleMapAssetBindings(uniqueMatches.map((asset) => asset.id))');
    expect(source).toContain('!asset.isTrashed && !asset.isOffline');
    expect(source).toContain('const openAssetFolder = async (folderPath: string)');
    expect(source).toContain('const openAssetAlbum = async (albumId: string)');
    expect(source).toContain('Nothing is selected automatically.');
    expect(source).toContain('aria-label="Folder media"');
    expect(source).toContain('aria-label="Album media"');
    expect(source).toContain('setVisiblePickerAssetsSelected(activeAlbumAssets, true)');
    expect(source).not.toContain('selectedSourceIds = [...selectedSourceIds, ...added.map((asset) => asset.id)]');
    expect(source.match(/class="flex min-h-10 flex-1 items-center justify-center gap-2 rounded-full/g)).toHaveLength(4);
    expect(source).not.toContain('id: album.albumThumbnailAssetId');
    expect(source).not.toContain("{#if activeFamily === 'events'}<button");
  });

  it('keeps graph section filtering shared while giving the Person web a collapsible side rail', async () => {
    const [source, filters] = await Promise.all([
      readFile('src/lib/components/cimmich/CimmichMemoryGraph.svelte', 'utf8'),
      readFile('src/lib/components/cimmich/CimmichMemoryGraphFilters.svelte', 'utf8'),
    ]);

    expect(source).toContain('filterCimmichMemoryGraphEventTypes(graph, hiddenEventTypes)');
    expect(source).toContain('aria-labelledby="compact-web-contents-heading"');
    expect(source).toContain('Open a section, show or hide it, or jump to a memory.');
    expect(source).toContain('{#each memoryGraphSectionKinds as kind');
    expect(source).toContain('{#each memoryGraphEventTypes as type');
    expect(source).toContain('aria-label="Event and period types"');
    expect(filters).toContain('hidden={compact}');
  });

  it('can hide life-period outlines without removing People, Places, or ordinary Events', () => {
    const filtered = filterCimmichMemoryGraphEventTypes(graph, ['life_period']);

    expect(filtered.nodes.map(({ nodeId }) => nodeId)).toEqual([
      'person:maya',
      'event:birthday',
      'event:unclassified',
      'place:willow',
    ]);
    expect(filtered.edges.map(({ edgeId }) => edgeId)).toEqual(['person-place']);
    expect(filtered.countsByKind.event).toBe(2);
    expect(memoryGraphEventType(graph.nodes[3])).toBe('event');
  });
});
