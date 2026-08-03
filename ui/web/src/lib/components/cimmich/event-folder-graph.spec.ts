import { describe, expect, it } from 'vitest';
import type { CimmichContextEntity } from '$lib/services/cimmich.service';
import {
  eventAssetBelongsToFolder,
  eventAssetFolder,
  eventCopyName,
  eventFolderCandidates,
  isMeaningfulEventFolder,
  eventLineage,
} from './event-folder-graph';

const asset = (originalPath: string) => ({ originalPath });
const event = (entityId: string, displayName: string, parentEntityId: string | null = null) =>
  ({ entityId, displayName, parentEntityId }) as CimmichContextEntity;

describe('event folder and graph helpers', () => {
  it('normalizes Windows and POSIX paths into honest folder candidates', () => {
    expect(eventAssetFolder(asset(String.raw`D:\Photos\Space Trip\IMG_1.jpg`))).toBe('D:/Photos/Space Trip');
    expect(
      eventFolderCandidates([
        asset('/archive/Cedar House/2025/June/a.jpg'),
        asset('/archive/Cedar House/2025/June/b.jpg'),
        asset('/archive/Research Week/c.jpg'),
      ]),
    ).toEqual([
      { assetCount: 2, label: 'June', path: '/archive/Cedar House/2025/June' },
      { assetCount: 1, label: 'Research Week', path: '/archive/Research Week' },
    ]);
  });

  it('includes descendants when a person chooses a parent folder', () => {
    expect(eventAssetBelongsToFolder(asset('/archive/Cedar House/2025/June/a.jpg'), '/archive/Cedar House')).toBe(true);
    expect(eventAssetBelongsToFolder(asset('/archive/Cedar House Annex/a.jpg'), '/archive/Cedar House')).toBe(false);
  });

  it('hides Immich content-addressed storage while keeping human folders', () => {
    expect(
      isMeaningfulEventFolder('/data/upload/cbf95a38-35cf-4186-8631-4e7055e15e59/66/05'),
    ).toBe(false);
    expect(isMeaningfulEventFolder('/archive/Manila Trip/TTR Consulting')).toBe(true);
    expect(
      eventFolderCandidates([
        asset('/data/upload/cbf95a38-35cf-4186-8631-4e7055e15e59/66/05/internal.jpg'),
        asset('/archive/Pink Palace/2015/June/quad-safari.jpg'),
      ]),
    ).toEqual([{ assetCount: 1, label: 'June', path: '/archive/Pink Palace/2015/June' }]);
  });

  it('projects bounded Event containment without looping on corrupt input', () => {
    const root = event('event_root', 'Cedar House');
    const year = event('event_year', 'Cedar House 2025', root.entityId);
    const month = event('event_month', 'Cedar House June 2025', year.entityId);
    expect(eventLineage(month, [month, root, year]).map(({ displayName }) => displayName)).toEqual([
      'Cedar House',
      'Cedar House 2025',
      'Cedar House June 2025',
    ]);
    expect(eventCopyName('ATV Trail Ride')).toBe('ATV Trail Ride — another');
  });
});
