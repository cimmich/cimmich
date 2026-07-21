import { describe, expect, it, vi } from 'vitest';
import {
  authoredBodyTagRepresentsOverlay,
  getCimmichPersonPhotoContext,
  getCimmichPetPhotoContext,
  isNamedBody,
  isNamedFace,
  isCimmichViewingSurface,
  matchesCimmichPersonPhotoContext,
  placeFaceDetailsPanel,
  placeManualTagPanel,
  projectFaceEditorPersonDraft,
  projectFaceReviewSimilarity,
  photoEvidenceLoadErrorMessage,
  projectPhotoTagTypes,
  projectPhotoOverlayZoomStyle,
  projectNamedPhotoPresence,
  projectTypedManualTagSummary,
  stopPhotoViewerShortcutPropagation,
} from './photo-viewer-presentation';

describe('photo viewer presentation context', () => {
  it('never preselects an unaccepted Person suggestion in the Face editor', () => {
    expect(projectFaceEditorPersonDraft({ acceptedName: '', candidateName: 'Alex Okafor' })).toBe('');
    expect(projectFaceEditorPersonDraft({ acceptedName: ' Maya Chen ', candidateName: 'Alex Okafor' })).toBe(
      'Maya Chen',
    );
  });

  it('does not present a missing Face comparison as a zero-percent match', () => {
    expect(projectFaceReviewSimilarity(null)).toBe('No comparison');
    expect(projectFaceReviewSimilarity(undefined)).toBe('No comparison');
    expect(projectFaceReviewSimilarity(Number.NaN)).toBe('No comparison');
    expect(projectFaceReviewSimilarity(0)).toBe('0.00');
    expect(projectFaceReviewSimilarity(0.346)).toBe('0.35');
  });

  it('lets an overlapping authored Body tag own the People label for the same person', () => {
    expect(
      authoredBodyTagRepresentsOverlay(
        {
          bbox: { x1: 75, x2: 752, y1: 177, y2: 1533 },
          image: { width: 1024, height: 1536 },
          name: 'Maya Chen',
        },
        { geometry: { x: 0.19, y: 0.05, w: 0.55, h: 0.9 }, name: 'Maya Chen' },
      ),
    ).toBe(true);
    expect(
      authoredBodyTagRepresentsOverlay(
        {
          bbox: { x1: 75, x2: 752, y1: 177, y2: 1533 },
          image: { width: 1024, height: 1536 },
          name: 'Another Person',
        },
        { geometry: { x: 0.19, y: 0.05, w: 0.55, h: 0.9 }, name: 'Maya Chen' },
      ),
    ).toBe(false);
    expect(
      authoredBodyTagRepresentsOverlay(
        { bbox: { x1: 0.02, x2: 0.2, y1: 0.05, y2: 0.3 }, name: 'Maya Chen' },
        { geometry: { x: 0.6, y: 0.5, w: 0.3, h: 0.45 }, name: 'Maya Chen' },
      ),
    ).toBe(false);
  });

  it('projects the same translation and scale used by the Immich zoom target', () => {
    expect(projectPhotoOverlayZoomStyle({ currentPositionX: -320, currentPositionY: -180, currentZoom: 2 })).toBe(
      '--cimmich-overlay-inverse-zoom: 0.5; transform-origin: 0 0; transform: translate(-320px, -180px) scale(2);',
    );
  });

  it('recognises a complete Cimmich Person entry context', () => {
    const context = getCimmichPersonPhotoContext(
      new URL('http://localhost/photos/asset-1?cimmichPersonId=person-1&cimmichPersonName=Maya+Chen'),
    );

    expect(context).toEqual({ personId: 'person-1', personName: 'Maya Chen' });
    expect(matchesCimmichPersonPhotoContext(context, ' maya   chen ')).toBe(true);
  });

  it('does not create a highlight context for normal photo entry', () => {
    expect(getCimmichPersonPhotoContext(new URL('http://localhost/photos/asset-1'))).toBeUndefined();
  });

  it('keeps Private active across Cimmich pages and their Person or Pet photo viewer', () => {
    expect(isCimmichViewingSurface(new URL('http://localhost/cimmich/people/Maya'))).toBe(true);
    expect(
      isCimmichViewingSurface(
        new URL('http://localhost/photos/asset-1?cimmichPersonId=person-1&cimmichPersonName=Maya+Chen'),
      ),
    ).toBe(true);
    expect(
      isCimmichViewingSurface(new URL('http://localhost/photos/asset-1?cimmichPetId=pet-1&cimmichPetName=Juniper')),
    ).toBe(true);
    expect(isCimmichViewingSurface(new URL('http://localhost/photos/asset-1'))).toBe(false);
  });

  it('recognises Pet viewer context without treating it as a Person highlight', () => {
    const url = new URL('http://localhost/photos/asset-1?cimmichPetId=pet-1&cimmichPetName=Juniper');

    expect(getCimmichPetPhotoContext(url)).toEqual({ petId: 'pet-1', petName: 'Juniper' });
    expect(getCimmichPersonPhotoContext(url)).toBeUndefined();
  });

  it('requires both the stable Person ID and display name', () => {
    expect(
      getCimmichPersonPhotoContext(new URL('http://localhost/photos/asset-1?cimmichPersonName=Maya+Chen')),
    ).toBeUndefined();
  });

  it('does not highlight another person', () => {
    const context = getCimmichPersonPhotoContext(
      new URL('http://localhost/photos/asset-1?cimmichPersonId=person-1&cimmichPersonName=Maya+Chen'),
    );

    expect(matchesCimmichPersonPhotoContext(context, 'Another Person')).toBe(false);
  });

  it('shows only confirmed named Face and Body associations', () => {
    expect(isNamedFace({ name: 'Maya Chen', status: 'named' })).toBe(true);
    expect(isNamedFace({ name: 'Maya Chen', status: 'untagged' })).toBe(false);
    expect(isNamedFace({ name: '', status: 'named' })).toBe(false);
    expect(isNamedBody({ linkedName: 'Maya Chen', status: 'linked' })).toBe(true);
    expect(isNamedBody({ linkedName: 'Maya Chen', status: 'unlinked' })).toBe(false);
  });

  it('shows every existing tag type for a stable subject without inventing a tag', () => {
    expect(
      projectPhotoTagTypes(
        { id: 'person-1', name: 'Test Person' },
        {
          bodies: [{ name: ' test   person ' }],
          faces: [{ name: 'Test Person', subjectId: 'person-1' }],
          heads: [{ name: 'Test Person', subjectId: 'person-1' }],
          presences: [{ subjectId: 'person-1' }],
        },
      ),
    ).toEqual(['Face', 'Body', 'Head', 'Presence']);
    expect(
      projectPhotoTagTypes(
        { id: 'person-2', name: 'No Existing Tag' },
        { bodies: [], faces: [], heads: [], presences: [] },
      ),
    ).toEqual([]);
  });

  it('projects typed counts and stable Presence names for the photo strip', () => {
    expect(
      projectTypedManualTagSummary([
        { subject: { displayName: 'Maya' }, tagType: 'face' },
        { subject: { displayName: 'Maya' }, tagType: 'body' },
        { subject: { displayName: 'Maya' }, tagType: 'head' },
        { subject: { displayName: 'Maya' }, tagType: 'presence' },
        { subject: { displayName: '  maya ' }, tagType: 'presence' },
      ]),
    ).toEqual({ bodyCount: 1, faceCount: 1, headCount: 1, presenceCount: 2, presenceNames: ['Maya'] });
  });

  it('projects accepted unlocalised people and manual Pets without duplicating represented names', () => {
    expect(
      projectNamedPhotoPresence(
        [
          { kind: 'accepted_presence', personName: 'Cafe', reason: 'manual_pet' },
          { kind: 'accepted_presence', personName: 'Maya Chen', reason: 'manual_presence' },
          { kind: 'candidate_presence', personName: 'Maybe Person', reason: 'machine' },
        ],
        ['Maya Chen'],
      ),
    ).toEqual([{ kind: 'pet', name: 'Cafe' }]);
  });

  it('keeps an editing panel and its actions inside a short desktop viewport', () => {
    const placement = placeFaceDetailsPanel({
      editing: true,
      face: { bottom: 342, left: 535, right: 625 },
      overlay: { height: 720, width: 1280 },
    });

    expect(placement).toEqual({ left: 635, maxHeight: 600, top: 108, width: 260 });
    expect(placement.top + placement.maxHeight).toBeLessThanOrEqual(708);
  });

  it('fits the wider owner Face editor beside the selected Face', () => {
    const placement = placeFaceDetailsPanel({
      editing: true,
      face: { bottom: 342, left: 535, right: 625 },
      overlay: { height: 720, width: 1280 },
      preferredWidth: 368,
    });

    expect(placement).toEqual({ left: 635, maxHeight: 600, top: 108, width: 368 });
    expect(placement.left + placement.width).toBeLessThanOrEqual(1268);
  });

  it('fits the correction panel inside the established narrow viewer width', () => {
    const placement = placeFaceDetailsPanel({
      editing: true,
      face: { bottom: 300, left: 100, right: 150 },
      overlay: { height: 720, width: 260.61 },
    });

    expect(placement.left).toBe(12);
    expect(placement.width).toBeCloseTo(236.61);
    expect(placement.left + placement.width).toBeLessThanOrEqual(248.61);
    expect(placement.top + placement.maxHeight).toBeLessThanOrEqual(708);
  });

  it('keeps the compact evidence panel near the selected face when it already fits', () => {
    expect(
      placeFaceDetailsPanel({
        editing: false,
        face: { bottom: 342, left: 535, right: 625 },
        overlay: { height: 720, width: 1280 },
      }),
    ).toEqual({ left: 635, maxHeight: 356, top: 352, width: 260 });
  });

  it('expands a selected Face panel for a long Person name while keeping it in the viewer', () => {
    const placement = placeFaceDetailsPanel({
      editing: false,
      face: { bottom: 342, left: 535, right: 625 },
      overlay: { height: 720, width: 1280 },
      preferredWidth: 360,
    });

    expect(placement).toEqual({ left: 635, maxHeight: 356, top: 352, width: 360 });
    expect(placement.left + placement.width).toBeLessThanOrEqual(1268);
  });

  it('keeps manual tag search keystrokes out of photo navigation shortcuts', () => {
    const stopPropagation = vi.fn();

    stopPhotoViewerShortcutPropagation({ stopPropagation });

    expect(stopPropagation).toHaveBeenCalledOnce();
  });

  it('explains visibility-filtered evidence without exposing projection plumbing', () => {
    expect(photoEvidenceLoadErrorMessage({ code: 'ASSET_DISPLAY_NOT_FOUND' })).toBe(
      'Cimmich details are not available in this viewing mode.',
    );
    expect(
      photoEvidenceLoadErrorMessage(
        new Error('Cimmich asset display mapping not found', { cause: { code: 'ASSET_DISPLAY_NOT_FOUND' } }),
      ),
    ).toBe('Cimmich details are not available in this viewing mode.');
    expect(photoEvidenceLoadErrorMessage(new Error('Cimmich service is unavailable'))).toBe(
      'Cimmich service is unavailable',
    );
  });

  it('keeps the typed manual tag panel and Save action reachable on mobile', () => {
    const placement = placeManualTagPanel({
      marker: { right: 46, top: 500 },
      overlay: { height: 844, width: 390 },
    });

    expect(placement).toEqual({ left: 58, maxHeight: 508, top: 324, width: 320 });
    expect(placement.left + placement.width).toBeLessThanOrEqual(378);
    expect(placement.top + placement.maxHeight).toBeLessThanOrEqual(832);
  });

  it('reserves room for the taller typed tag panel on a short desktop viewer', () => {
    const placement = placeManualTagPanel({
      marker: { right: 688, top: 420 },
      overlay: { height: 720, width: 1280 },
    });

    expect(placement).toEqual({ left: 700, maxHeight: 508, top: 200, width: 320 });
    expect(placement.top + placement.maxHeight).toBeLessThanOrEqual(708);
  });
});
