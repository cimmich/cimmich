import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(path, 'utf8');

describe('human-first Organise information architecture', () => {
  it('opens directly in Timeline and keeps all four structural modes one switch away', async () => {
    const [load, source] = await Promise.all([
      read('src/routes/(user)/cimmich/organise/+page.ts'),
      read('src/lib/components/cimmich/CimmichOrganiseModeSwitch.svelte'),
    ]);

    expect(load).toContain('redirect(307, Route.photos({ organise: 1 }))');
    expect(source).toContain("label: 'Timeline'");
    expect(source).toContain("label: 'Folders'");
    expect(source).toContain("label: 'Tags'");
    expect(source).toContain("label: 'Albums'");
    expect(source).toContain('Route.photos({ organise: 1 })');
    expect(source).toContain('Route.folders({ organise: 1 })');
    expect(source).toContain('Route.tags({ organise: 1 })');
    expect(source).toContain('Route.albums({ organise: 1 })');
    expect(source).not.toContain('People');
    expect(source).not.toContain('Places');
    expect(source).not.toContain('Events');
    expect(source).not.toContain('Things');
  });

  it('keeps the switch persistent in every native mode and preserves folder paths and tag hierarchy', async () => {
    const [photos, folders, tags, albums, sidebar] = await Promise.all([
      read('src/routes/(user)/photos/[[assetId=id]]/+page.svelte'),
      read('src/routes/(user)/folders/[[photos=photos]]/[[assetId=id]]/+page.svelte'),
      read('src/routes/(user)/tags/[[photos=photos]]/[[assetId=id]]/+page.svelte'),
      read('src/routes/(user)/albums/+page.svelte'),
      read('src/lib/components/shared-components/side-bar/UserSidebar.svelte'),
    ]);

    for (const mode of [photos, folders, tags, albums]) {
      expect(mode).toContain("page.url.searchParams.has('organise')");
      expect(mode).toContain('<CimmichOrganiseModeSwitch />');
    }
    expect(folders).toContain('Route.folders({ path, organise: isOrganiseContext ? 1 : undefined })');
    expect(folders).toContain('isMeaningfulEventFolder(child.path)');
    expect(folders).toContain('No original folders here');
    expect(folders).toContain('href={Route.libraries()}');
    expect(tags).toContain('<CimmichTagBrowser {tags} initialPath={data.path} />');
    expect(await read('src/lib/components/cimmich/tag-browser.ts')).toContain('label: tag.value');
    expect(sidebar).toContain('isActive: () => isOrganiseContext()');
    expect(photos).toContain('Future photo dates need review');
    expect(photos).toContain('getCimmichSummary');
    expect(photos).toContain('choose Change date');
  });

  it('keeps the existing safeguarded engine behind a secondary route', async () => {
    const [switcher, bulk, route] = await Promise.all([
      read('src/lib/components/cimmich/CimmichOrganiseModeSwitch.svelte'),
      read('src/routes/(user)/cimmich/organise/bulk/+page.svelte'),
      read('src/lib/route.ts'),
    ]);

    expect(switcher).toContain('Open Bulk organise');
    expect(switcher).not.toContain('<CimmichBulkPhotoSorter');
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
