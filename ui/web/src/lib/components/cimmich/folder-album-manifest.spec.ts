import { describe, expect, it } from 'vitest';
import {
  folderAlbumManifestFingerprint,
  folderAlbumManifestIssues,
  folderAlbumTitle,
  resolveFolderAlbumTitleCollisions,
  type FolderAlbumManifestRow,
} from './folder-album-manifest';

describe('folder album manifest', () => {
  it('keeps an unknown collection acronym beside the humanized month', () => {
    expect(folderAlbumTitle('/library/Set_One/Photos/2011_August - PP')).toBe('PP Aug 2011');
  });

  it('keeps nested period context and a human qualifier', () => {
    expect(folderAlbumTitle('/library/Set_One/Photos/2015 - PP/September/Week 1')).toBe('PP Sep 2015 · Week 1');
  });

  it('renders combined month folders as an intentional date range', () => {
    expect(folderAlbumTitle('/library/Set_One/Photos/2012 - PP AC/JanMarch')).toBe('PP AC Jan–Mar 2012');
    expect(folderAlbumTitle('/library/Set_One/Photos/2012 - PP AC/NovDec')).toBe('PP AC Nov–Dec 2012');
  });

  it('preserves unknown owner acronyms instead of inventing meanings', () => {
    expect(folderAlbumTitle('/library/Set_One/Photos/2014_AC')).toBe('AC 2014');
    expect(folderAlbumTitle('/library/Set_One/Photos/AC')).toBe('AC');
  });

  it('visibly qualifies repeated titles without merging folders', () => {
    const rows = resolveFolderAlbumTitleCollisions(
      [
        {
          assetIds: ['a'],
          include: true,
          sourcePath: '/library/Set_One/2011_August - PP',
          title: 'PP Aug 2011',
        },
        {
          assetIds: ['b'],
          include: true,
          sourcePath: '/library/Set_Two/2011_August - PP',
          title: 'PP Aug 2011',
        },
      ],
      '/library',
    );
    expect(rows.map(({ title }) => title)).toEqual(['PP Aug 2011 · Set One', 'PP Aug 2011 · Set Two']);
    expect(rows.every(({ collisionSource }) => collisionSource)).toBe(true);
  });

  it('uses stable branch and leaf context instead of chained collision suffixes', () => {
    const rows = resolveFolderAlbumTitleCollisions(
      [
        {
          assetIds: ['north'],
          include: true,
          sourcePath: '/library/Archive/Set_One/Photos/2011_August - PP',
          title: 'PP Aug 2011',
        },
        {
          assetIds: ['one'],
          include: true,
          sourcePath: '/library/Archive/Set_Archive/Photos/2011 - PP/August_1',
          title: 'PP Aug 2011',
        },
        {
          assetIds: ['two'],
          include: true,
          sourcePath: '/library/Archive/Set_Archive/Photos/2011 - PP/August_2',
          title: 'PP Aug 2011',
        },
        {
          assetIds: ['media'],
          include: true,
          sourcePath: '/library/Media/Archive/Set_One/Photos/2011_August - PP',
          title: 'PP Aug 2011',
        },
      ],
      '/library',
    );
    expect(rows.map(({ title }) => title)).toEqual([
      'PP Aug 2011 · Set One',
      'PP Aug 2011 · Set Archive · August 1',
      'PP Aug 2011 · Set Archive · August 2',
      'PP Aug 2011 · Media · Set One',
    ]);
  });

  it('keeps unknown collection acronyms without repeating the date', () => {
    const rows = resolveFolderAlbumTitleCollisions(
      [
        {
          assetIds: ['north'],
          include: true,
          sourcePath: '/library/Archive/Set_One/Photos/2012 - PP AC/JanMarch',
          title: 'PP Jan–Mar 2012',
        },
        {
          assetIds: ['other'],
          include: true,
          sourcePath: '/library/Archive/Set_Archive/Photos/2012 - PP/JanMarch',
          title: 'PP Jan–Mar 2012',
        },
      ],
      '/library',
    );
    expect(rows.map(({ title }) => title)).toEqual(['PP Jan–Mar 2012 · Set One · AC', 'PP Jan–Mar 2012 · Set Archive']);
  });

  it('blocks empty and duplicate included titles but ignores excluded rows', () => {
    const rows: FolderAlbumManifestRow[] = [
      { assetIds: ['a'], collisionSource: false, include: true, sourcePath: '/a', title: 'Same' },
      { assetIds: ['b'], collisionSource: false, include: true, sourcePath: '/b', title: 'same' },
      { assetIds: ['c'], collisionSource: false, include: true, sourcePath: '/c', title: ' ' },
      { assetIds: ['d'], collisionSource: false, include: false, sourcePath: '/d', title: '' },
    ];
    expect(folderAlbumManifestIssues(rows)).toEqual({ duplicateTitles: ['same'], emptyTitles: ['/c'] });
  });

  it('fingerprints identically without browser secure-context crypto', async () => {
    const rows: FolderAlbumManifestRow[] = [
      { assetIds: ['b', 'a'], collisionSource: false, include: true, sourcePath: '/archive/a', title: 'A' },
      { assetIds: ['ignored'], collisionSource: false, include: false, sourcePath: '/archive/b', title: 'B' },
    ];
    const originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
    try {
      expect(await folderAlbumManifestFingerprint(rows)).toBe(
        '6460dec6203794c5fc59817522510d0cc5bc6a7ffb3ac2435c18559485d1c2ed',
      );
    } finally {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto });
    }
  });
});
