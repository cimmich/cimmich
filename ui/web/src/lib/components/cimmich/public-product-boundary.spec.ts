import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

describe('public Cimmich product boundary', () => {
  it('does not advertise legacy proof labs or private fixture copy from Home', async () => {
    const home = await read('../../../routes/(user)/cimmich/+page.svelte');
    const coverEditor = await read('./CimmichHomeCoverEditor.svelte');
    expect(home).not.toMatch(/Trips lab|Activities lab|Quality control|Legacy overview/);
    expect(home).not.toContain('>Maintenance<');
    expect(home).not.toMatch(/Private Fixture (?:Person|Collection)|Wave[- ]?1/i);
    expect(home).toContain('href={Route.cimmichSetup()}');
    expect(home).toContain("name: 'Documents'");
    expect(home).toContain('Counts and previews follow your current viewing mode.');
    expect(home).not.toContain('Cimmich controls');
    expect(home).not.toContain('Cimmich owns the library experience.');
    expect(home).not.toContain('Immich 3.1.0 remains the media foundation underneath.');
    expect(home).not.toContain('Models & Guided');
    expect(home).toContain('<CimmichHomeCoverEditor');
    expect(home).toContain("onSave={(preference) => saveCoverPreference('hero', preference)}");
    expect(coverEditor).toContain('Change ${label} cover');
    expect(coverEditor).toContain("label: 'Set photo'");
    expect(coverEditor).toContain("label: 'Group of photos'");
    expect(coverEditor).toContain('Rotate through 2–6 photos.');
    expect(coverEditor).toContain("label: 'Random from…'");
    expect(coverEditor).toContain('selectedIds.length >= 2 && selectedIds.length <= 6');
    expect(coverEditor).toContain("label: 'Favourites'");
    expect(coverEditor).toContain("label: 'Visible library'");
    expect(coverEditor).toContain('candidateAssetIds.slice(0, 24)');
    expect(coverEditor).toContain('metadataSearchDto: { size: 40');
  });

  it('uses public Cedar House examples in Smart Search', async () => {
    const search = await read('../../../routes/(user)/cimmich/smart-search/+page.svelte');
    expect(search).toContain('Maya at Cedar House, Bluewater in 2024…');
    expect(search).not.toMatch(/Private Fixture (?:Person|Collection)|Wave[- ]?1/i);
  });

  it('presents visibility-filtered Smart Search Documents as actionable results', async () => {
    const search = await read('../../../routes/(user)/cimmich/smart-search/+page.svelte');
    expect(search).toContain('result.documents');
    expect(search).toContain('Open ${document.displayTitle} in Documents');
    expect(search).toContain('initialQuery={documentLensQuery}');
  });

  it('keeps draft photo text out of shared URLs and wires both search tabpanels', async () => {
    const search = await read('../../../routes/(user)/cimmich/smart-search/+page.svelte');
    expect(search).toContain("nextLens === 'documents' ? documentLensQuery : submittedQuery");
    expect(search).not.toContain('submittedQuery || query.trim()');
    expect(search).toContain('aria-controls="smart-search-photos-panel"');
    expect(search).toContain('aria-controls="smart-search-documents-panel"');
    expect(search).toContain('id="smart-search-photos-panel" role="tabpanel"');
    expect(search).toContain('id="smart-search-documents-panel"');
  });

  it('keeps Smart Search failures recoverable without losing the attempted query', async () => {
    const search = await read('../../../routes/(user)/cimmich/smart-search/+page.svelte');
    expect(search).toContain("let failedQuery = $state('');");
    expect(search).toContain('failedQuery = nextQuery;');
    expect(search).toContain('>Try again</button');
    expect(search).toContain('>Edit search</button');
    expect(search).toContain('Technical details');
    expect(search).not.toContain('result = null;');
    expect(search).toContain('{:else if result}');
  });

  it('projects explicit context relations back onto Person connections', async () => {
    const person = await read(['../../../routes/(user)/cimmich', 'people', '[personName]', '+page.svelte'].join('/'));
    const secondary = await read('../cimmich/person-secondary-projections.ts');
    const service = await read('../../services/cimmich.service.ts');

    expect(service).toContain('/v1/people/${encodeURIComponent(personId)}/connections');
    expect(secondary).not.toContain('getCimmichPersonConnections');
    expect(person).toContain('getCimmichPersonConnections(cimmichPerson.person_id)');
    expect(person).toContain('connection.coverAssetId');
    expect(person).toContain("connection.metaLabel || 'Connected'");
  });

  it('keeps both supported new-Person paths explicit in the photo workflow', async () => {
    const overlay = await read('../cimmich/CimmichPhotoOverlay.svelte');
    expect(overlay).toContain('{ newPersonName: normalizedName }');
    expect(overlay).toContain('New Person · Create');
    expect(overlay).toContain('createCimmichPerson(intent.commandId, { newPersonName: intent.name })');
    expect(overlay).toContain('Creates the Person first.');
  });

  it('keeps the photo workflow task-led and leaves evidence in the existing Info panel', async () => {
    const overlay = await read('../cimmich/CimmichPhotoOverlay.svelte');
    const summary = await read('../cimmich/CimmichSummaryAction.svelte');
    const editActions = await read('../cimmich/CimmichPeopleEditActions.svelte');
    const detailPanel = await read('../asset-viewer/DetailPanel.svelte');
    expect(overlay).toContain('aria-label="People"');
    expect(overlay).toContain('aria-label="Context"');
    expect(overlay).toContain("isTaggingMode ? 'Cancel adding a person or pet' : 'Add a person or pet'");
    expect(overlay).not.toContain('data-testid="cimmich-tag-view"');
    expect(overlay).toContain('data-testid="cimmich-add-tag-action"');
    expect(overlay).toContain('data-testid="cimmich-add-presence-action"');
    expect(overlay).toContain('geometry: null');
    expect(overlay).toContain('<CimmichPeopleEditActions');
    expect(editActions).toContain('data-testid="cimmich-detailed-view"');
    expect(editActions).toContain("bulkOpen ? 'Close all Face tags' : 'Edit all Face tags'");
    expect(overlay).toContain('attachCimmichContextAssets');
    expect(overlay).toContain('detachCimmichContextAssets');
    expect(overlay).toContain('undoCimmichContextDecision');
    expect(overlay).toContain('aria-label="Context on this photo"');
    expect(overlay).toContain("overlayView === 'context' && !isSidecarVisible && !isObjectTaggingMode");
    expect(overlay).toContain("isObjectTaggingMode ? 'Cancel adding an object tag' : 'Add object'");
    expect(overlay).toContain('Drag around the object');
    expect(overlay).toContain('attachCimmichManualObjectRegion');
    expect(overlay).not.toContain('Owner note');
    expect(summary).toContain('setCimmichAssetOwnerSummary');
    expect(summary).toContain('Use Standard');
    expect(summary).toContain('Use Smart');
    expect(summary).toContain('Use Enhanced');
    expect(overlay).toContain("{ kind: 'place' as const, label: 'Place' }");
    expect(overlay).toContain("{ kind: 'event' as const, label: 'Event' }");
    expect(overlay).toContain('onclick={() => void addPhotoContext(option)}');
    expect(overlay).not.toContain("'Add context'");
    expect(overlay).not.toContain('All Places');
    expect(overlay).not.toContain('All Events');
    expect(overlay).not.toContain('All Things');
    expect(overlay).toContain('return `${Route.cimmichPlaces()}?${search.toString()}`;');
    expect(overlay).not.toContain('`${Route.cimmichThings()}?${search.toString()}`');
    expect(overlay).toContain('namedPeopleFaceOverlays.map((face) => face.name)');
    expect(overlay).toContain('namedPeopleBodyOverlays.map((body) => bodyIdentityName(body))');
    expect(overlay).toContain('localizedManualPresenceTags.map((tag) => tag.subject.displayName)');
    expect(overlay).toContain('{#each primaryNamedPeopleFaceOverlays as face (face.id)}');
    expect(overlay).toContain('{#each primaryNamedPeopleBodyOverlays as body (body.id)}');
    expect(overlay).toContain('{#each primaryManualPeopleTags as tag (tag.tagId)}');
    expect(overlay).toContain('<span>{tag.subject.displayName}</span>');
    expect(overlay).toContain('Route.cimmichPet({ name: tag.subject.displayName, petId: tag.subject.subjectId })');
    expect(overlay).toContain("title={`Open ${tag.subject.displayName}'s profile`}");
    expect(overlay).toContain('data-testid="cimmich-manual-evidence-edit-layer"');
    expect(overlay).toContain('data-testid="cimmich-manual-evidence-edit-tag"');
    expect(overlay).toContain('<span>{manualTagTypeLabel(tag.tagType)} · {tag.subject.displayName}</span>');
    expect(overlay).toContain('namedPhotoPresence.map((presence) => presence.name)');
    expect(overlay).not.toContain('const names = people.length > 0 ? people.join');
    expect(overlay).toContain('stopTagging();');
    expect(overlay).toContain("selectedFace.name ? 'Change person' : 'Name this face'");
    expect(overlay).not.toContain('data-testid="cimmich-enhanced-view"');
    expect(detailPanel).toContain('<CimmichAppearancesPanel {asset} compact />');
  });

  it('keeps photo controls touch-sized and respects reduced-motion preferences', async () => {
    const overlay = await read('../cimmich/CimmichPhotoOverlay.svelte');
    const appCss = await read('../../../app.css');

    expect(overlay).not.toMatch(/\b(?:min-h|size)-(?:[1-9]|10)\b/);
    expect(appCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(appCss).toContain('scroll-behavior: auto !important;');
  });

  it('returns the manual-tag toolbar to neutral after decision Undo restores the prior evidence kind', async () => {
    const overlay = await read('../cimmich/CimmichPhotoOverlay.svelte');
    const undoStart = overlay.indexOf('const undoManualTag = async');
    const undoEnd = overlay.indexOf('const undoLastManualTag', undoStart);
    const undoFlow = overlay.slice(undoStart, undoEnd);

    expect(undoFlow).toContain('await undoCimmichManualSubjectTag(');
    expect(undoFlow).toContain('await loadManualSubjectTagReadback');
    expect(undoFlow).toContain('stopTagging();');
    expect(undoFlow.indexOf('stopTagging();')).toBeLessThan(undoFlow.indexOf('manualTagActionMessage ='));
    expect(overlay).toContain("isTaggingMode ? 'Cancel adding a person or pet' : 'Add a person or pet'");
  });

  it('keeps every unavailable legacy route fail-closed and product-neutral', async () => {
    const unavailable = await read('./CimmichUnavailableCapability.svelte');
    expect(unavailable).toContain('does not expose a validated capability');
    expect(unavailable).toMatch(/Nothing has been inferred or\s+changed/);
    expect(unavailable).toContain('Use Cimmich Home to open the supported tools.');
    expect(unavailable).not.toContain('five main sections');
    expect(unavailable).not.toMatch(/Private Fixture (?:Person|Collection)|Wave[- ]?1/i);
  });
});
