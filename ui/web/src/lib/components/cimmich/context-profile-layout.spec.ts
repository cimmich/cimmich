import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(path, 'utf8');

describe('Place, Thing and Event profile information architecture', () => {
  it('keeps each profile destination compact, reloadable and keyboard navigable', async () => {
    const source = await read('src/lib/components/cimmich/CimmichContextBrowser.svelte');

    expect(source).toContain(
      "type ContextDetailTab = 'connections' | 'documents' | 'journey' | 'map' | 'plan' | 'photos';",
    );
    expect(source).toContain("page.url.searchParams.get('tab')");
    expect(source).toContain("url.searchParams.delete('tab')");
    expect(source).toContain("url.searchParams.set('tab', tab)");
    expect(source).toContain('role="tablist"');
    expect(source).toContain("['ArrowLeft', 'ArrowRight', 'Home', 'End']");
    expect(source).toContain("label: 'Map', value: 'map'");
    expect(source).toContain("label: 'Plan', value: 'plan'");
    expect(source).toContain("label: 'Journey', value: 'journey'");
    expect(source).toContain("label: 'Connections', value: 'connections'");
    expect(source).toContain("label: 'Documents', value: 'documents'");
    expect(source).toContain(
      "mutation.kind === 'create' && finalResult.detail && activeFamily !== 'events' && !createdFromGeographyGroup",
    );
    expect(source).toContain(
      'getContextDetailHref(\n            page.url,\n            activeFamily,\n            finalResult.detail.entity.entityId',
    );
    expect(source).toContain('result.detail.entity.parentEntityId !== (base.parentEntityId ?? null)');
    expect(source).toContain('openDetailById(requestedEntityId, true)');
    expect(source).toContain('Its photos are untouched.');
    expect(source).toContain('editorTypeChosen = true;');
    expect(source).toContain('formType = reusableEventDefaults.type;');
    expect(source).toContain('formParentId = reusableEventDefaults.parentId;');
    expect(source).toContain('formRecurrenceEnabled = reusableEventDefaults.recurrenceEnabled;');
    expect(source).toContain('When this thing belonged in your life');
    expect(source).toContain('<span>From <small>Optional</small></span>');
    expect(source).toContain("relation.direction === 'incoming'");
    expect(source).toContain('await getCimmichContextEntity(activeFamily, selectedEntityId)');
    expect(source).toContain('onclick={() => void removeRelation(relation)}');
    expect(source).not.toContain("{#if relation.direction !== 'incoming'}");
  });

  it('keeps folder admission additive and removes the indistinguishable legacy Main choice', async () => {
    const browser = await read('src/lib/components/cimmich/CimmichContextBrowser.svelte');
    const presentation = await read('src/lib/components/cimmich/context-entity-presentation.ts');

    expect(browser).toContain('eventFolderAdmission(visible');
    expect(browser).toContain('new Set((selected?.assets ?? []).map((asset) => asset.sourceAssetId).filter(Boolean))');
    expect(browser).toContain('Existing roles stay unchanged.');
    expect(presentation).toContain("manual: 'Legacy main'");
    expect(presentation).toContain("event: ['direct', 'route_stop', 'context', 'needs_check']");
  });

  it('puts tab-specific work beside the tab rail and record maintenance in the editor', async () => {
    const source = await read('src/lib/components/cimmich/CimmichContextBrowser.svelte');

    expect(source).toContain('class="context-profile-rail');
    expect(source).toContain("activeFamily === 'places' ? 'context-profile-add-media' : 'context-primary-button'");
    expect(source).toContain("{#if activeFamily !== 'places'}<span>Add media</span>{/if}");
    expect(source).toContain('title="Add media"');
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

  it('renders Place subsections as full-bleed image cards with overlaid labels', async () => {
    const source = await read('src/lib/components/cimmich/CimmichContextBrowser.svelte');

    expect(source).toContain('class="context-place-child-card group relative');
    expect(source).toContain('class="absolute inset-0 size-full object-cover');
    expect(source).toContain("'bg-linear-to-t from-black/85 via-black/10 to-black/15'");
    expect(source).toContain('class="absolute inset-x-0 bottom-0 p-4 text-white drop-shadow-sm"');
    expect(source).not.toContain('class="relative h-28 overflow-hidden bg-gray-100 dark:bg-gray-800"');
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
    const hero = await read('src/lib/components/cimmich/CimmichContextDetailHero.svelte');
    const plan = await read('src/lib/components/cimmich/CimmichPlacePlan.svelte');

    expect(browser).toContain('<CimmichPlacePlan');
    expect(browser).toContain('saveCimmichPlacePlan');
    expect(plan).toContain('Blank property');
    expect(plan).toContain('Blank floor');
    expect(plan).toContain('Use satellite');
    expect(plan).toContain('Use cover photo');
    expect(plan).toContain('<CimmichPlanSatellite');
    expect(plan).toContain("'satellite'");
    expect(plan).toContain('const finishPaint');
    expect(plan).toContain("paintingMode === 'outline'");
    expect(plan).toContain("const geometry = { kind: 'polygon' as const, points }");
    expect(plan).toContain("geometry: { kind: 'paint' as const, strokes: [stroke] }");
    expect(plan).toContain("item.geometry.kind === 'paint' ? [...item.geometry.strokes, stroke] : [stroke]");
    expect(plan).toContain('updateSatelliteViewport');
    expect(plan).toContain('Reset satellite position and zoom');
    expect(plan).toContain('mdiBrush');
    expect(plan).toContain('mdiPencil');
    expect(plan).toContain("url('/cimmich/cursors/plan-pencil.svg')");
    expect(plan).toContain("url('/cimmich/cursors/plan-brush.svg')");
    expect(plan).not.toContain('cursor: crosshair');
    expect(plan).toContain('Brush size');
    expect(plan).toContain('preparePlacePlanGeometryForSave(geometry)');
    expect(plan).toContain('const cloneGeometry');
    expect(plan).not.toContain('geometry: structuredClone(item.geometry)');
    expect(plan).toContain('class="place-plan__outline-zone"');
    expect(plan).toContain('place-plan-paint-outline-');
    expect(plan).toContain('fill="currentColor" mask={`url(#${maskId})`}');
    expect(plan).toContain('fill: none;');
    expect(plan).toContain('geometryArea(right.geometry) - geometryArea(left.geometry)');
    expect(hero).toContain('class="context-detail-plan-outline"');
    expect(hero).toContain('context-detail-plan-paint-outline-');
    expect(plan).toContain('aria-label={`Outline ${child.displayName}`}');
    expect(plan).toContain('aria-label={`Paint ${child.displayName}`}');
    expect(plan).toContain('Brush ${paintingChild.displayName} · size ${brushSizeLabel}');
    expect(plan).toContain("paintingMode === 'paint' ? 'Done painting' : 'Cancel outline'");
    expect(plan).toContain('Add sublocation');
    expect(plan).toContain('aria-label="Sublocation name"');
    expect(browser).toContain('onCreateSublocation={createPlanSublocation}');
    expect(browser).toContain("directoryVisibility: 'nested_only'");
    expect(browser).toContain("placeRole: 'location'");
    expect(browser).toContain("typeKind: 'unlocated'");
    expect(browser).not.toContain('openPlanChildCreate');
    expect(browser).toContain('entity.entityId !== editorTarget?.entityId');
    expect(plan).toContain('Remove from this plan');
    expect(plan).toContain('Save plan');
    const satellite = await read('src/lib/components/cimmich/CimmichPlanSatellite.svelte');
    const map = await read('src/lib/components/shared-components/map/Map.svelte');
    expect(satellite).toContain('satelliteOnly');
    expect(satellite).toContain('showSimpleControls={interactive}');
    expect(satellite).toContain('{onViewportChange}');
    expect(satellite).toContain('maxZoom={22}');
    expect(map).toContain('maxzoom: 18');
    expect(map).toContain('event.setMaxZoom(maxZoom)');
    expect(map).toContain("event.on('moveend'");
    expect(satellite).toContain('Satellite © Esri');
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
    const hero = await read('src/lib/components/cimmich/CimmichContextDetailHero.svelte');

    expect(browser).toContain('Settings for ${selected?.entity.displayName}');
    expect(browser).not.toContain('Move this {selected.entity.placeRole');
    expect(browser).not.toContain('Changes this hierarchy only, not its photos.');
    expect(browser).not.toContain('Open a subsection or use it to organise');
    expect(browser).not.toContain('Also listed on Places');
    expect(browser).not.toContain('Shown inside this place');
    expect(browser).toContain('{#if selectedPlaceLineage.length > 1}');
    expect(browser).not.toContain('<span class="font-semibold">Geography</span>');
    expect(browser).toContain('const placeChildNames');
    expect(browser).toContain('cimmichPlaceChildCoverAssetId(child, selected.subtreeAssets ?? [])');
    expect(browser).toContain('src={getAssetMediaUrl({ id: childCoverAssetId, size: AssetMediaSize.Preview })}');
    expect(browser).toContain('cimmichPlaceAssetSectionNames(asset, selectedPlaceChildren)');
    expect(browser).toContain('>Select for actions</button');
    expect(browser).toContain('onclick={() => void changeContextCover(asset.sourceAssetId)}>Use as cover</button');
    expect(browser).not.toContain(
      "directlyAssignedHere && (entityKind === 'place' || entityKind === 'object' || entityKind === 'event')",
    );
    expect(browser).not.toContain('>{contextAssociationLabel(entityKind, asset.associationKind)}</span');
    expect(browser).toContain(".join(' · ')");
    expect(browser).toContain('class="mt-0.5 truncate text-xs text-white/75"');
    expect(browser).toContain('<CimmichEntityMediaActions');
    expect(browser).toContain("aria-label={mediaSelectionMode ? 'Exit photo selection' : 'Select photos'}");
    expect(browser).toContain('class:context-place-photo--selected={placeAssetSelected(asset.assetId)}');
    expect(browser).toContain('handleCimmichMediaCardClick(event, mediaSelectionMode');
    expect(browser).toContain('aria-label="Photo view options"');
    expect(browser).toContain('aria-label="Sort photos"');
    expect(browser).toContain('aria-label="Group photos"');
    expect(browser).toContain('<option value="subsection">Subsection</option>');
    expect(browser).toContain('aria-label="Thumbnail size"');
    expect(browser).toContain('groupPlacePhotos(presentedDetailAssets, placePhotoGroup, selectedPlaceChildren)');
    expect(browser).toContain('placePhotoGridClass(placePhotoSize)');
    expect(hero).toContain("family === 'places' ? (detail.subtreeAssets ?? detail.assets) : detail.assets");
    expect(hero).toContain('heroAssets.find((asset) => asset.sourceAssetId === detail.entity.coverAssetId)');
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

  it('uses a full-width clustered Immich map without a permanent hierarchy rail', async () => {
    const collection = await read('src/lib/components/cimmich/CimmichContextCollection.svelte');
    const map = await read('src/lib/components/shared-components/map/Map.svelte');
    const nativeMap = await read('src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/+page.svelte');

    expect(collection).toContain('height: clamp(520px, calc(100dvh - 190px), 760px);');
    expect(collection).toContain('grid-template-columns: minmax(0, 1fr);');
    expect(collection).toContain('grid-template-rows: minmax(0, 1fr);');
    expect(collection).toContain('.context-atlas-map {\n      height: 100%;\n      min-height: 0;');
    expect(collection).toContain('placeMarkerLabelMinZoom={12}');
    expect(collection).not.toContain('aria-label="Place hierarchy"');
    expect(collection).not.toContain('class="context-place-row"');
    expect(map).toContain('cluster={{ radius: 42, maxZoom: 15 }}');
    expect(map).toContain('handlePlaceClusterClick(event.feature, map)');
    expect(map).toContain('mapSource.getClusterExpansionZoom(clusterId)');
    expect(map).toContain('showPlaceMarkerLabels && currentMapZoom >= placeMarkerLabelMinZoom');
    expect(map).toContain('<span class="sr-only">{feature.properties?.name}</span>');
    expect(nativeMap).toContain('placeMarkerLabelMinZoom={12}');
  });

  it('treats Place geometry as optional map detail and exposes reusable routes alongside Event trips', async () => {
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
    expect(browser).toContain('>Route</button');
    expect(browser).toContain("onclick={() => setPlaceMapMode('route')}");
    expect(browser).toContain('aria-label="Location confidence"');
    expect(browser).toContain('From photo GPS');
    expect(browser).toContain('Estimated from context');
    expect(browser).toContain('Confirmed by me');
    expect(browser).toContain("String(formGeometryUncertainty ?? '').trim()");
    expect(browser).toContain("String(value ?? '').trim()");
    expect(browser).toContain("It never rewrites the photo's original EXIF.");
    expect(browser).toContain('>Remove from map</button');
    expect(browser).not.toContain('How does this place exist on the map?');
    expect(collection).toContain('Trip or route');
    expect(collection).not.toContain('Pins, areas and routes will appear here.');
    expect(hero).not.toContain('contextPlaceRoleLabel(detail.entity.placeRole)');
    expect(hero).toContain('!isPlace && detail.entity.aliases.length > 0');
  });

  it('builds Events from evidence first and preserves relationship meaning after creation', async () => {
    const browser = await read('src/lib/components/cimmich/CimmichContextBrowser.svelte');
    const collection = await read('src/lib/components/cimmich/CimmichContextCollection.svelte');

    expect(collection).toContain('Bring the first memory together');
    expect(collection).toContain('onEventStartFromPhotos');
    expect(collection).toContain('groupContextEventsByYear(filteredEntities)');
    expect(browser).toContain("assetPickerPurpose = $state<'attach' | 'seed-event'>('attach')");
    expect(browser).toContain("createCimmichContextCommandId('event-seed-attach')");
    expect(browser).toContain("associationKind = 'needs_check';");
    expect(browser).toContain("assetIds.map((assetId) => ({ assetId, associationKind: 'needs_check' }))");
    expect(browser).toContain('Start selected media as');
    expect(browser).toContain('Folder candidates wait for your decision before joining Main.');
    expect(browser).toContain('>Promote to Main</button');
    expect(browser).toContain("createCimmichContextCommandId('event-media-reclassify')");
    expect(browser).toContain("undoLabel = 'Undo media move';");
    expect(browser).toContain('Choose photos for this memory');
    expect(browser).toContain('Create memory');
    expect(browser).toContain('eventDateLabels.start');
    expect(browser).toContain('eventMediaLaneDescription');
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

  it('moves keyboard focus to the newly selected tab without depending on a detail reload', async () => {
    const browser = await read('src/lib/components/cimmich/CimmichContextBrowser.svelte');

    expect(browser).toContain('bind:this={detailTabRail}');
    expect(browser).toContain('onclick={() => selectDetailTab(tab.value, true)}');
    expect(browser).toContain('selectDetailTab(next.value, true)');
    expect(browser).toContain(
      'const tab = rail.querySelector<HTMLButtonElement>(\'[role="tab"][aria-selected="true"]\')',
    );
    expect(browser).toContain('if (document.activeElement === tab) {');
    expect(browser).not.toContain('if (active && active !== document.body) {');
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
