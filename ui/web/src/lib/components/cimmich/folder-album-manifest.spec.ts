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
    expect(folderAlbumTitle('/library/Cedar_House/Photos/2011_August - CH')).toBe('CH Aug 2011');
  });

  it('keeps nested period context and a human qualifier', () => {
    expect(folderAlbumTitle('/library/Cedar_House/Photos/2015 - CH/September/Week 1')).toBe('CH Sep 2015 · Week 1');
  });

  it('renders combined month folders as an intentional date range', () => {
    expect(folderAlbumTitle('/library/Cedar_House/Photos/2012 - CH WH/JanMarch')).toBe('CH WH Jan–Mar 2012');
    expect(folderAlbumTitle('/library/Cedar_House/Photos/2012 - CH WH/NovDec')).toBe('CH WH Nov–Dec 2012');
  });

  it('preserves unknown owner acronyms instead of inventing meanings', () => {
    expect(folderAlbumTitle('/library/Cedar_House/Photos/2014_WH')).toBe('WH 2014');
    expect(folderAlbumTitle('/library/Cedar_House/Photos/WH')).toBe('WH');
  });

  it('visibly qualifies repeated titles without merging folders', () => {
    const rows = resolveFolderAlbumTitleCollisions(
      [
        {
          assetIds: ['a'],
          include: true,
          sourcePath: '/library/Cedar_House/2011_August - CH',
          title: 'CH Aug 2011',
        },
        {
          assetIds: ['b'],
          include: true,
          sourcePath: '/library/Willow_House/2011_August - CH',
          title: 'CH Aug 2011',
        },
      ],
      '/library',
    );
    expect(rows.map(({ title }) => title)).toEqual(['CH Aug 2011 · Cedar House', 'CH Aug 2011 · Willow House']);
    expect(rows.every(({ collisionSource }) => collisionSource)).toBe(true);
  });

  it('uses stable branch and leaf context instead of chained collision suffixes', () => {
    const rows = resolveFolderAlbumTitleCollisions(
      [
        {
          assetIds: ['north'],
          include: true,
          sourcePath: '/library/Archive/Cedar_House/Photos/2011_August - CH',
          title: 'CH Aug 2011',
        },
        {
          assetIds: ['one'],
          include: true,
          sourcePath: '/library/Archive/Orchard_House/Photos/2011 - CH/August_1',
          title: 'CH Aug 2011',
        },
        {
          assetIds: ['two'],
          include: true,
          sourcePath: '/library/Archive/Orchard_House/Photos/2011 - CH/August_2',
          title: 'CH Aug 2011',
        },
        {
          assetIds: ['media'],
          include: true,
          sourcePath: '/library/Media/Archive/Cedar_House/Photos/2011_August - CH',
          title: 'CH Aug 2011',
        },
      ],
      '/library',
    );
    expect(rows.map(({ title }) => title)).toEqual([
      'CH Aug 2011 · Cedar House',
      'CH Aug 2011 · Orchard House · August 1',
      'CH Aug 2011 · Orchard House · August 2',
      'CH Aug 2011 · Media · Cedar House',
    ]);
  });

  it('keeps unknown collection acronyms without repeating the date', () => {
    const rows = resolveFolderAlbumTitleCollisions(
      [
        {
          assetIds: ['north'],
          include: true,
          sourcePath: '/library/Archive/Cedar_House/Photos/2012 - CH WH/JanMarch',
          title: 'CH Jan–Mar 2012',
        },
        {
          assetIds: ['other'],
          include: true,
          sourcePath: '/library/Archive/Orchard_House/Photos/2012 - CH/JanMarch',
          title: 'CH Jan–Mar 2012',
        },
      ],
      '/library',
    );
    expect(rows.map(({ title }) => title)).toEqual([
      'CH Jan–Mar 2012 · Cedar House · WH',
      'CH Jan–Mar 2012 · Orchard House',
    ]);
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
