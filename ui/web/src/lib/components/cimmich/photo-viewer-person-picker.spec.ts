import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const readPhotoOverlay = () => readFile('src/lib/components/cimmich/CimmichPhotoOverlay.svelte', 'utf8');
const readPhotoOverlayStyles = () => readFile('src/lib/components/cimmich/CimmichPhotoOverlay.css', 'utf8');
const readCimmichService = async () => {
  const files = await Promise.all([
    readFile('src/lib/services/cimmich.service.ts', 'utf8'),
    readFile('src/lib/services/cimmich-face-review-comparison-client.ts', 'utf8'),
  ]);
  return files.join('\n');
};
const readCimmichEvidenceService = () => readFile('src/lib/services/cimmich-evidence.service.ts', 'utf8');

describe('photo viewer Person picker', () => {
  it('shows a bounded ranked shortlist without opening the entire People directory', async () => {
    const source = await readPhotoOverlay();

    expect(source).toContain('await getCimmichFaceMatches(face.id, 5)');
    expect(source).toContain('faceMatches = matches;');
    expect(source).toContain('Up to five strongest matches. Type any other name above.');
    expect(source).toContain('placeholder="Type a name or choose a match"');
    expect(source).not.toContain('cimmich-known-face-names');
    expect(source).not.toContain('<datalist');
    expect(source).toContain("page.url.searchParams.get('cimmichOverlay') === 'people'");
  });

  it('keeps typed existing-Person selection separate from explicit Person creation', async () => {
    const source = await readPhotoOverlay();

    expect(source).toContain('searchManualPhotoTagPeople(manualTagSubjects, normalizedFaceNameDraft, 8)');
    expect(source).toContain('role="combobox"');
    expect(source).toContain('role="listbox"');
    expect(source).toContain('Existing People matching the typed name');
    expect(source).toContain('Create a new Person named “{normalizedFaceNameDraft}” instead');
    expect(source).toContain(
      "faceActionError = 'Choose an existing Person, or explicitly choose to create a new one.'",
    );
    expect(source).toContain("faceEvidenceKindDraft !== 'body' && !faceDraftHasIdentityTarget");
  });

  it('shows marginal detector evidence without hiding the machine candidate', async () => {
    const source = await readPhotoOverlay();

    expect(source).toContain('candidatePresentationLabel(face, bestCandidate)');
    expect(source).toContain('Face signal ${Math.round(detection * 100)}%');
    expect(source).toContain('Match ${candidateSimilarityLabel(candidate.rawScore)}');
    expect(source).not.toContain('detection >= 0.4 ? bestCandidate');
  });

  it('defensively limits a larger API response to the requested shortlist', async () => {
    const source = await readCimmichService();

    expect(source).toContain('return result.items.slice(0, boundedLimit);');
  });

  it('renders imported locators as a linked Person tag and a single edit dot, never as a model box', async () => {
    const [overlay, styles, evidenceService] = await Promise.all([
      readPhotoOverlay(),
      readPhotoOverlayStyles(),
      readCimmichEvidenceService(),
    ]);

    expect(evidenceService).toContain('(asset.identity_locators ?? []).map');
    expect(evidenceService).toContain('personIdentityKey: locator.person_id');
    expect(evidenceService).toContain('label: locator.display_name');
    expect(overlay).toContain('data-testid="cimmich-imported-identity-locator"');
    expect(overlay).toContain('sourcePresenceMarkerStyle(presence)');
    expect(overlay).toContain('cimmich-tagging-dot--named');
    expect(overlay).toContain('cimmich-tagging-dot--tagged');
    expect(styles).toContain('.cimmich-matching-unknown.cimmich-tagging-dot--tagged span');
    expect(styles.indexOf('.cimmich-matching-unknown.cimmich-tagging-dot--tagged span')).toBeGreaterThan(
      styles.indexOf('.cimmich-matching-unknown span'),
    );
    expect(overlay).toContain('<span>Tagged · {presence.name}</span>');
    expect(overlay).not.toContain('sourcePresenceBoxStyle(presence)');
    expect(overlay).not.toContain('cimmich-source-presence-box');
    expect(overlay).toContain("overlayView === 'people' && !isTaggingMode");
    expect(overlay).toContain('editImportedIdentityLocator(presence)');
    expect(overlay).toContain('{#if !manualTagSourceLocatorId}');
    // The locator id is client-side UI state only: schema 102 dropped the
    // locator table and the attach validator rejects unknown keys, so the
    // request body must never carry it.
    expect(overlay).not.toContain('locatorId: manualTagSourceLocatorId');
  });
});
