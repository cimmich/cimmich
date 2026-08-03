import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(path, 'utf8');

describe('human-first Organise information architecture', () => {
  it('opens with the four accepted library structures and keeps domain directories out', async () => {
    const source = await read('src/routes/(user)/cimmich/organise/+page.svelte');

    expect(source).toContain("title: 'By Timeline'");
    expect(source).toContain("title: 'By Folder'");
    expect(source).toContain("title: 'By Tag'");
    expect(source).toContain("title: 'By Album'");
    expect(source).toContain('href: Route.photos()');
    expect(source).toContain('href: Route.folders()');
    expect(source).toContain('href: Route.tags()');
    expect(source).toContain('href: Route.albums()');
    expect(source).not.toContain('By context');
    expect(source).not.toContain("title: 'By People'");
    expect(source).not.toContain("title: 'By Places'");
    expect(source).not.toContain("title: 'By Events'");
    expect(source).not.toContain("title: 'By Things'");
  });

  it('moves the existing safeguarded engine behind a secondary route', async () => {
    const [hub, bulk, route] = await Promise.all([
      read('src/routes/(user)/cimmich/organise/+page.svelte'),
      read('src/routes/(user)/cimmich/organise/bulk/+page.svelte'),
      read('src/lib/route.ts'),
    ]);

    expect(hub).toContain('Power tool');
    expect(hub).toContain('Open bulk organise');
    expect(hub).not.toContain('<CimmichBulkPhotoSorter');
    expect(bulk).toContain('<CimmichBulkPhotoSorter />');
    expect(bulk).toContain('Back to Organise');
    expect(route).toContain("cimmichOrganiseBulk: () => '/cimmich/organise/bulk'");
  });

  it('makes Event folders browsable before requiring a search', async () => {
    const source = await read('src/lib/components/cimmich/CimmichContextBrowser.svelte');

    expect(source).toContain('Browse folders');
    expect(source).toContain('Recent folders');
    expect(source).toContain('Recent visible folders are ready below. Search only when you need something else.');
    expect(source).toContain('folderSearchStarted ? folderSearchAssets : libraryAssets');
    expect(source).toContain('getCimmichVisibleMapAssetBindings(recent.map((asset) => asset.id))');
    expect(source).not.toContain('Type at least two characters from the folder name or path.');
  });
});
