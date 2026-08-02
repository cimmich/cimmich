import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(path, 'utf8');

describe('Place, Thing and Event profile information architecture', () => {
  it('keeps each profile destination compact, reloadable and keyboard navigable', async () => {
    const source = await read('src/lib/components/cimmich/CimmichContextBrowser.svelte');

    expect(source).toContain("type ContextDetailTab = 'connections' | 'documents' | 'map' | 'plan' | 'photos';");
    expect(source).toContain("page.url.searchParams.get('tab')");
    expect(source).toContain("url.searchParams.delete('tab')");
    expect(source).toContain("url.searchParams.set('tab', tab)");
    expect(source).toContain('role="tablist"');
    expect(source).toContain("['ArrowLeft', 'ArrowRight', 'Home', 'End']");
    expect(source).toContain("label: 'Map', value: 'map'");
    expect(source).toContain("label: 'Plan', value: 'plan'");
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
    expect(hero).toContain('aria-label="Location view"');
    expect(hero).toContain("placeVisualView = 'map'");
    expect(hero).toContain("placeVisualView = 'plan'");
    expect(hero).toContain('No plan yet');
    expect(map).toContain('The place itself and visible photos that carry location data.');
    expect(map).toContain('Open full map');
    expect(map).toContain('zoom={locatorCenter ? 15 : undefined}');
  });

  it('gives Locations a real normalized Plan workspace instead of reusing map geometry', async () => {
    const browser = await read('src/lib/components/cimmich/CimmichContextBrowser.svelte');
    const plan = await read('src/lib/components/cimmich/CimmichPlacePlan.svelte');

    expect(browser).toContain('<CimmichPlacePlan');
    expect(browser).toContain('saveCimmichPlacePlan');
    expect(plan).toContain('Blank property');
    expect(plan).toContain('Blank floor');
    expect(plan).toContain('Use cover photo');
    expect(plan).toContain("geometry: { h: 0.2, kind: 'rect'");
    expect(plan).toContain('Remove from this plan');
    expect(plan).toContain('Save plan');
    expect(plan).not.toContain('latitude');
    expect(plan).not.toContain('longitude');
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
    expect(browser).not.toContain('Also listed on Places');
    expect(browser).not.toContain('Shown inside this place');
    expect(browser).toContain('{#if selectedPlaceLineage.length > 1}');
    expect(browser).not.toContain('<span class="font-semibold">Geography</span>');
    expect(browser).toContain('const placeChildNames');
    expect(browser).toContain(".join(' · ')");
    expect(browser).toContain('class="mt-1 truncate text-xs text-gray-500"');
    expect(browser).toContain('<CimmichEntityMediaActions');
    expect(browser).toContain("aria-label={mediaSelectionMode ? 'Exit photo selection' : 'Select photos'}");
    expect(browser).toContain('class:context-place-photo--selected={placeAssetSelected(asset.assetId)}');
  });

  it('renders country groups as real aggregate Geography pages without inventing a second taxonomy', async () => {
    const browser = await read('src/lib/components/cimmich/CimmichContextBrowser.svelte');
    const collection = await read('src/lib/components/cimmich/CimmichContextCollection.svelte');
    const controls = await read('src/lib/components/cimmich/CimmichPlaceCollectionControls.svelte');

    expect(collection).not.toContain('Each name is unique');
    expect(browser).toContain('<CimmichPlaceCollectionControls');
    expect(controls).toContain('aria-label="Places view"');
    expect(controls).toContain('aria-label="Group and sort"');
    expect(collection).toContain('geographyGroupHref(section.label)');
    expect(collection).toContain('Add subdivision in ${section.label}');
    expect(browser).toContain("page.url.searchParams.get('geographyGroup')");
    expect(browser).toContain('const geographyGroupMembers');
    expect(browser).toContain('const assetsBySourceId = new SvelteMap<string, CimmichPlaceRollupAsset>()');
    expect(browser).toContain('selectedGeographyGroupEntityIds');
    expect(browser).toContain('Add subdivision');
    expect(browser).toContain('currentScope={selectedIsGeographyGroup');
  });

  it('treats Place geometry as optional map detail and puts routes in Events', async () => {
    const browser = await read('src/lib/components/cimmich/CimmichContextBrowser.svelte');
    const collection = await read('src/lib/components/cimmich/CimmichContextCollection.svelte');
    const hero = await read('src/lib/components/cimmich/CimmichContextDetailHero.svelte');

    expect(browser).toContain("formType = entityKind === 'place' ? 'unlocated'");
    expect(browser).toContain("editorTypeChosen = entityKind === 'place';");
    expect(browser).toContain("editorTypeChosen && entityKind !== 'place'");
    expect(browser).toContain("{#if entityKind !== 'place'}");
    expect(browser).toContain('>Add to map</strong>');
    expect(browser).toContain('>Pin</button');
    expect(browser).toContain('>Boundary</button');
    expect(browser).toContain('>Remove from map</button');
    expect(browser).not.toContain('How does this place exist on the map?');
    expect(collection).toContain('Start with a trip or route');
    expect(collection).not.toContain('Pins, areas and routes will appear here.');
    expect(hero).not.toContain('contextPlaceRoleLabel(detail.entity.placeRole)');
    expect(hero).toContain('!isPlace && detail.entity.aliases.length > 0');
  });

  it('does not promote a legacy role state into a Locations directory heading', async () => {
    const collection = await read('src/lib/components/cimmich/CimmichContextCollection.svelte');

    expect(collection).toContain("if (current.placeRole === 'geography')");
    expect(collection).not.toContain("return 'Needs classification';");
    expect(collection).not.toContain("left.label === 'Needs classification'");
    expect(collection).not.toContain("right.label === 'Needs classification'");
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
