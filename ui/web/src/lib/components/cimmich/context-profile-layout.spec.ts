import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(path, 'utf8');

describe('Place, Thing and Event profile information architecture', () => {
  it('keeps each profile destination compact, reloadable and keyboard navigable', async () => {
    const source = await read('src/lib/components/cimmich/CimmichContextBrowser.svelte');

    expect(source).toContain("type ContextDetailTab = 'connections' | 'documents' | 'map' | 'photos';");
    expect(source).toContain("page.url.searchParams.get('tab')");
    expect(source).toContain("url.searchParams.delete('tab')");
    expect(source).toContain("url.searchParams.set('tab', tab)");
    expect(source).toContain('role="tablist"');
    expect(source).toContain("['ArrowLeft', 'ArrowRight', 'Home', 'End']");
    expect(source).toContain("label: 'Map', value: 'map'");
    expect(source).toContain("label: 'Connections', value: 'connections'");
    expect(source).toContain("label: 'Documents', value: 'documents'");
  });

  it('puts tab-specific work beside the tab rail and maintenance in overflow', async () => {
    const source = await read('src/lib/components/cimmich/CimmichContextBrowser.svelte');

    expect(source).toContain('class="context-profile-rail');
    expect(source).toContain('<span>Add media</span>');
    expect(source).toContain('<span>Add connection</span>');
    expect(source).toContain('class:flex-nowrap={Boolean(selected)}');
    expect(source).toContain('context-profile-edit');
    expect(source).toContain('aria-label={`More actions for ${selected.entity.displayName}`}');
    expect(source).toContain('Delete permanently');
    expect(source).toContain("activeFamily === 'events' ? 'Add event'");
  });

  it('gives Places a focused map tab while retaining a photo-led hero', async () => {
    const browser = await read('src/lib/components/cimmich/CimmichContextBrowser.svelte');
    const hero = await read('src/lib/components/cimmich/CimmichContextDetailHero.svelte');
    const map = await read('src/lib/components/cimmich/CimmichContextPlaceMap.svelte');

    expect(browser).toContain('<CimmichContextPlaceMap detail={selected} />');
    expect(hero).toContain('detail.entity.coverAssetId');
    expect(map).toContain('The place itself and visible photos that carry location data.');
    expect(map).toContain('Open full map');
    expect(map).toContain('zoom={locatorCenter ? 15 : undefined}');
  });

  it('makes Documents a first-class sidebar destination with URL-stable detail', async () => {
    const sidebar = await read('src/lib/components/shared-components/side-bar/UserSidebar.svelte');
    const route = await read('src/routes/(user)/cimmich/documents/+page.svelte');
    const server = await read('src/routes/(user)/cimmich/documents/+page.ts');

    expect(sidebar).toContain("{ title: 'Documents', href: Route.cimmichDocuments()");
    expect(sidebar.indexOf("title: 'Documents'")).toBeLessThan(sidebar.indexOf("title: 'Smart Search'"));
    expect(route).toContain("page.url.searchParams.get('documentId')");
    expect(route).toContain('initialDocumentId={requestedDocumentId}');
    expect(route).toContain('onDocumentChange={selectDocument}');
    expect(server).not.toContain('redirect(');
  });
});
