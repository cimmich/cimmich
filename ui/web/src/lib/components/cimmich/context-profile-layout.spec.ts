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

  it('puts tab-specific work beside the tab rail and record maintenance in the editor', async () => {
    const source = await read('src/lib/components/cimmich/CimmichContextBrowser.svelte');

    expect(source).toContain('class="context-profile-rail');
    expect(source).toContain('<span>Add media</span>');
    expect(source).toContain('<span>Add connection</span>');
    expect(source).toContain("activeFamily === 'events'");
    expect(source).toContain("? 'Add event'");

    // The hero carries one control per side: back, and a settings gear.
    // Details, hierarchy, visibility, Archive/Restore and Delete all belong
    // inside that single record-settings surface.
    expect(source).toContain('context-hero-settings');
    expect(source).toContain('context-profile-settings');
    expect(source).toContain('aria-label={`Settings for ${selected.entity.displayName}`}');
    expect(source).toContain('<Icon icon={mdiCogOutline}');
    expect(source).toContain('class="context-editor-record"');
    expect(source).toContain('Delete…');
    expect(source).not.toContain('More actions for');
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

  it('supports subsection painting and bounded bulk photo assignment without hidden limits', async () => {
    const browser = await read('src/lib/components/cimmich/CimmichContextBrowser.svelte');
    const canvas = await read('src/lib/components/cimmich/CimmichPlaceCanvas.svelte');
    const map = await read('src/lib/components/shared-components/map/Map.svelte');

    expect(browser).toContain('<CimmichPlaceCanvas');
    expect(browser).toContain('const placeBulkSelectionLimit = ENTITY_MEDIA_SELECTION_LIMIT;');
    expect(browser).toContain('if (selectedPlaceAssetIds.length >= placeBulkSelectionLimit)');
    expect(browser).toContain('toastManager.warning(');
    expect(browser).toContain('assignSelectedPlaceAssets');
    expect(browser).toContain("moveWithinPlaceTargets={selected.entity.placeRole === 'location'");
    expect(browser).toContain('onMoveWithinPlace={assignSelectedPlaceAssets}');
    expect(browser).toContain('onSelectShown={visibleDetailAssets.length > 0 ? selectShownPlaceAssets : undefined}');
    expect(browser).not.toContain('aria-label="Move unassigned photos"');
    expect(canvas).toContain('satelliteInitiallyEnabled');
    expect(canvas).toContain('Paint outline');
    expect(canvas).toContain('Save zone');
    expect(canvas).toContain('GPS can suggest a zone later');
    expect(map).toContain('onPlaceAreaSelect');
  });

  it('keeps hierarchy maintenance in settings and selected-photo actions on the photo rail', async () => {
    const browser = await read('src/lib/components/cimmich/CimmichContextBrowser.svelte');

    expect(browser).toContain('Settings for ${selected?.entity.displayName}');
    expect(browser).not.toContain('Move this {selected.entity.placeRole');
    expect(browser).not.toContain('Changes this hierarchy only, not its photos.');
    expect(browser).not.toContain('Open a subsection or use it to organise');
    expect(browser).toContain('<CimmichEntityMediaActions');
    expect(browser).toContain("aria-label={mediaSelectionMode ? 'Exit photo selection' : 'Select photos'}");
    expect(browser).toContain('class:context-place-photo--selected={placeAssetSelected(asset.assetId)}');
  });

  it('caps the card body track so a long location line cannot widen the whole card', async () => {
    const collection = await read('src/lib/components/cimmich/CimmichContextCollection.svelte');

    // A grid item's automatic minimum size is its MIN-CONTENT width, so the nowrap
    // truncated location line grew the track past the card (194px box, 249.25px
    // track) and every sibling was clipped by the card's overflow:hidden — while
    // `truncate` never engaged, because the track had already grown to fit.
    const cardBodies = collection.match(/<div class="grid grid-cols-\[minmax\(0,1fr\)\] gap-2 p-4 text-left">/g);
    expect(cardBodies).toHaveLength(2); // places and things share the grammar
    expect(collection).not.toContain('<div class="grid gap-2 p-4 text-left">');
    expect(collection).toContain('class="flex min-w-0 items-center gap-1.5 text-xs');
  });

  it('tells the hero strip map where to look, so it cannot sit at the style default', async () => {
    const hero = await read('src/lib/components/cimmich/CimmichContextDetailHero.svelte');

    // Immich's Map only auto-fits to its markers when no `zoom` is given, and only
    // honours jumpTo when a `center` is given. The hero passes `zoom`, so without a
    // `center` BOTH paths are off and the map renders open ocean with no marker.
    expect(hero).toContain('const locatorCenter = $derived(');
    expect(hero).toMatch(/<Map\b[\s\S]*?center=\{locatorCenter\}[\s\S]*?zoom=\{13\}/);
  });

  it('returns focus to the selected tab, which the rail rebuild would otherwise drop', async () => {
    const browser = await read('src/lib/components/cimmich/CimmichContextBrowser.svelte');

    // Changing tab re-renders the detail and destroys the rail's buttons, so the
    // focused tab node stops existing and focus falls to <body>: arrow keys then
    // work exactly once, and a click leaves focus nowhere. Restoration must survive
    // SEVERAL rebuilds, so the latch stays armed and only reclaims focus when
    // nothing owns it.
    expect(browser).toContain('bind:this={detailTabRail}');
    expect(browser).toContain('onclick={() => selectDetailTab(tab.value, true)}');
    expect(browser).toContain('selectDetailTab(next.value, true)');
    expect(browser).toContain('rail.querySelector<HTMLButtonElement>(\'[role="tab"][aria-selected="true"]\')?.focus()');
    expect(browser).toContain('if (active && active !== document.body) {');
    // The old one-shot attempt focused a node that the pending navigation was
    // about to throw away.
    expect(browser).not.toContain('void tabs?.[nextIndex]?.focus();');
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
