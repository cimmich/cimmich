import { describe, expect, it } from 'vitest';
import type { CimmichContextEntity } from '$lib/services/cimmich.service';
import {
  eventAssetBelongsToFolder,
  eventAssetFolder,
  eventCopyName,
  eventFolderCandidates,
  eventLineage,
} from './event-folder-graph';

const asset = (originalPath: string) => ({ originalPath });
const event = (entityId: string, displayName: string, parentEntityId: string | null = null) =>
  ({ entityId, displayName, parentEntityId }) as CimmichContextEntity;

describe('event folder and graph helpers', () => {
  it('normalizes Windows and POSIX paths into honest folder candidates', () => {
    expect(eventAssetFolder(asset(String.raw`D:\Photos\Manila Trip\IMG_1.jpg`))).toBe('D:/Photos/Manila Trip');
    expect(
      eventFolderCandidates([
        asset('/archive/Pink Palace/2015/June/a.jpg'),
        asset('/archive/Pink Palace/2015/June/b.jpg'),
        asset('/archive/TTR Consulting/c.jpg'),
      ]),
    ).toEqual([
      { assetCount: 2, label: 'June', path: '/archive/Pink Palace/2015/June' },
      { assetCount: 1, label: 'TTR Consulting', path: '/archive/TTR Consulting' },
    ]);
  });

  it('includes descendants when a person chooses a parent folder', () => {
    expect(eventAssetBelongsToFolder(asset('/archive/Pink Palace/2015/June/a.jpg'), '/archive/Pink Palace')).toBe(true);
    expect(eventAssetBelongsToFolder(asset('/archive/Pink Palace Annex/a.jpg'), '/archive/Pink Palace')).toBe(false);
  });

  it('projects bounded Event containment without looping on corrupt input', () => {
    const root = event('event_root', 'Pink Palace');
    const year = event('event_year', 'Pink Palace 2015', root.entityId);
    const month = event('event_month', 'Pink Palace June 2015', year.entityId);
    expect(eventLineage(month, [month, root, year]).map(({ displayName }) => displayName)).toEqual([
      'Pink Palace',
      'Pink Palace 2015',
      'Pink Palace June 2015',
    ]);
    expect(eventCopyName('Quad Safari')).toBe('Quad Safari — another');
  });
});
