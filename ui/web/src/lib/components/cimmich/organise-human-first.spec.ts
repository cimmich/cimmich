import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(path, 'utf8');

describe('human-first Library information architecture', () => {
  it('opens directly in Photos and keeps the expanded library views one switch away', async () => {
    const [libraryLoad, legacyLoad, source] = await Promise.all([
      read('src/routes/(user)/cimmich/library/+page.ts'),
      read('src/routes/(user)/cimmich/organise/+page.ts'),
      read('src/lib/components/cimmich/CimmichOrganiseModeSwitch.svelte'),
    ]);

    expect(libraryLoad).toContain('redirect(307, Route.photos({ organise: 1 }))');
    expect(legacyLoad).toContain('redirect(307, Route.cimmichLibrary())');
    expect(source).toContain("label: 'Photos'");
    expect(source).toContain("label: 'Recent'");
    expect(source).toContain("label: 'Favourites'");
    expect(source).toContain("label: 'Folders'");
    expect(source).toContain("label: 'Tags'");
    expect(source).toContain("label: 'Albums'");
    expect(source).toContain('Route.photos({ organise: 1 })');
    expect(source).toContain('Route.recentlyAdded({ organise: 1 })');
    expect(source).toContain('Route.favorites({ organise: 1 })');
    expect(source).toContain('Route.folders({ organise: 1 })');
    expect(source).toContain('Route.tags({ organise: 1 })');
    expect(source).toContain('Route.albums({ organise: 1 })');
    expect(source).toContain('aria-label="Library views"');
    expect(source).not.toContain('People');
    expect(source).not.toContain('Places');
    expect(source).not.toContain('Events');
    expect(source).not.toContain('Things');
  });

  it('keeps the switch persistent in every native mode and preserves folder paths and tag hierarchy', async () => {
    const [photos, recent, favorites, folders, tags, albums, sidebar] = await Promise.all([
      read('src/routes/(user)/photos/[[assetId=id]]/+page.svelte'),
      read('src/routes/(user)/recently-added/[[photos=photos]]/[[assetId=id]]/+page.svelte'),
      read('src/routes/(user)/favorites/[[photos=photos]]/[[assetId=id]]/+page.svelte'),
      read('src/routes/(user)/folders/[[photos=photos]]/[[assetId=id]]/+page.svelte'),
      read('src/routes/(user)/tags/[[photos=photos]]/[[assetId=id]]/+page.svelte'),
      read('src/routes/(user)/albums/+page.svelte'),
      read('src/lib/components/shared-components/side-bar/CimmichSidebar.svelte'),
    ]);

    for (const mode of [photos, recent, favorites, folders, tags, albums]) {
      expect(mode).toContain("page.url.searchParams.has('organise')");
      expect(mode).toContain('<CimmichOrganiseModeSwitch />');
    }
    expect(folders).toContain('Route.folders({');
    expect(folders).toContain('organise: isOrganiseContext ? 1 : undefined');
    expect(folders).toContain('cimmichContext: isCimmichContext ? 1 : undefined');
    expect(folders).toContain('isMeaningfulEventFolder(child.path)');
    expect(folders).toContain('No original folders here');
    expect(folders).toContain('href={Route.libraries()}');
    expect(tags).toContain('<CimmichTagBrowser {tags} initialPath={data.path} />');
    expect(await read('src/lib/components/cimmich/tag-browser.ts')).toContain('label: tag.value');
    expect(sidebar).toContain('href={Route.cimmichLibrary()}');
    expect(photos).toContain('Future photo dates need review');
    expect(photos).toContain('getCimmichSummary');
    expect(photos).toContain('choose Change date');
  });

  it('does not fetch an entire Person library for an exact photo viewer route', async () => {
    const source = await read('src/routes/(user)/photos/[[assetId=id]]/+page.svelte');

    expect(source).toContain("const cimmichAssetId = $derived(page.params.assetId || '')");
    expect(source).toContain('cimmichSubjectId && !cimmichAssetId ? { assetFilter: cimmichSubjectAssetIds } : {}');
    expect(source).toContain('cimmichSubjectAssetIds = new Set(assetId ? [assetId] : [])');
    expect(source).toContain('cimmichSubjectAssetsReady = !subjectId || Boolean(assetId)');
    expect(source).toContain('getCimmichPersonAssetNeighbors(personId, assetId)');
    expect(source).toContain(': getCimmichPersonAssets(personId)');
  });

  it('keeps the existing safeguarded engine behind a secondary route', async () => {
    const [switcher, bulk, legacyBulk, route, sorter] = await Promise.all([
      read('src/lib/components/cimmich/CimmichOrganiseModeSwitch.svelte'),
      read('src/routes/(user)/cimmich/library/bulk/+page.svelte'),
      read('src/routes/(user)/cimmich/organise/bulk/+page.ts'),
      read('src/lib/route.ts'),
      read('src/lib/components/cimmich/CimmichBulkPhotoSorter.svelte'),
    ]);

    expect(switcher).toContain('Open Bulk tools');
    expect(switcher).not.toContain('<CimmichBulkPhotoSorter');
    expect(bulk).toContain('<CimmichBulkPhotoSorter />');
    expect(bulk).toContain('Back to Library');
    expect(legacyBulk).toContain('redirect(307, Route.cimmichLibraryBulk())');
    expect(route).toContain("cimmichLibraryBulk: () => '/cimmich/library/bulk'");
    expect(route).toContain("cimmichOrganiseBulk: () => '/cimmich/organise/bulk'");
    expect(sorter).toContain('const bindings = await getCimmichVisibleMapAssetBindings');
    expect(sorter).toContain('if (!bindings.has(asset.id)');
    expect(sorter).not.toContain('title={asset.originalPath}');
  });

  it('makes Event folders browsable and reviewable before requiring a search or selection', async () => {
    const source = await read('src/lib/components/cimmich/CimmichContextBrowser.svelte');

    expect(source).toContain('Browse folders');
    expect(source).toContain('Recent folders');
    expect(source).toContain('Open a folder to review its visible images before choosing anything.');
    expect(source).toContain('Opening a folder never selects its media.');
    expect(source).toContain('aria-label="Folder media"');
    expect(source).toContain('folderSearchStarted ? folderSearchAssets : libraryAssets');
    expect(source).toContain('getCimmichVisibleMapAssetBindings(recent.map((asset) => asset.id))');
    expect(source).not.toContain('Type at least two characters from the folder name or path.');
  });
});
