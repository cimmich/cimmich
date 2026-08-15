import { describe, expect, it } from 'vitest';
import { groupCimmichPersonConnections } from './person-connections';
import type { CimmichPersonConnection } from './person-page-types';

describe('Person connections', () => {
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
        sourceAssetId: null,
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
            sourceAssetId: 'source-shared-photo',
            typeKind: 'person',
          },
        ],
      },
    ]);
  });
});
