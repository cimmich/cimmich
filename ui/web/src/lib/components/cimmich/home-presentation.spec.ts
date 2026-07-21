import { describe, expect, it } from 'vitest';
import type { CimmichContextEntity, CimmichPerson } from '$lib/services/cimmich.service';
import {
  chooseCimmichHomeFeature,
  chooseCimmichHomeDistinctMedia,
  cimmichHomeContextPreviewId,
  cimmichHomeEntityHref,
  cimmichHomeFaceFocus,
  cimmichHomePreviewNames,
  cimmichHomeReviewLabel,
  collectCimmichHomeHeroAssets,
} from './home-presentation';

const entity = (value: Partial<CimmichContextEntity>): CimmichContextEntity => ({
  aliases: [],
  assetCount: 1,
  coverAssetId: null,
  dateEnd: null,
  datePrecision: 'unknown',
  dateStart: null,
  description: null,
  displayName: 'Context',
  entityId: 'context_1',
  entityKind: 'event',
  geometry: null,
  parentEntityId: null,
  revision: 1,
  status: 'active',
  typeKind: 'event',
  ...value,
});

const subject = (value: Partial<CimmichPerson>): CimmichPerson => ({
  accepted_faces: 1,
  aliases: [],
  asset_count: 1,
  bodyPreview: null,
  box_h: null,
  box_w: null,
  box_x: null,
  box_y: null,
  candidate_faces: 0,
  categories: [],
  display_name: 'Maya Chen',
  filename: 'maya.jpg',
  head_faces: 0,
  needs_holding: false,
  needs_sort: false,
  person_id: 'person_1',
  prime_faces: 0,
  representative_asset_id: 'asset_1',
  representative_face_id: 'face_1',
  secondary_faces: 0,
  sourceAssetId: 'source_person',
  status: 'active',
  subject_kind: 'person',
  ...value,
});

describe('Cimmich Home presentation', () => {
  it('features an owner-curated photographed story before an alphabetically earlier bare event', () => {
    const bare = entity({ displayName: 'Bare event' });
    const photographed = entity({
      coverAssetId: 'cover',
      coverMode: 'explicit',
      description: 'A real story.',
      displayName: 'Willow',
    });
    expect(chooseCimmichHomeFeature([bare, photographed])).toBe(photographed);
  });

  it('uses explicit cover, latest revision and stable name order instead of incoming alphabetical order', () => {
    const alphabetical = entity({
      coverAssetId: 'cover-a',
      description: 'First only by name.',
      displayName: 'Alpha',
      revision: 9,
    });
    const curatedOlder = entity({
      coverAssetId: 'cover-z',
      coverMode: 'explicit',
      description: 'Owner curated.',
      displayName: 'Zulu',
      revision: 2,
    });
    const curatedNewer = entity({
      coverAssetId: 'cover-m',
      coverMode: 'explicit',
      description: 'Owner curated and later revised.',
      displayName: 'Middle',
      revision: 3,
    });
    expect(chooseCimmichHomeFeature([alphabetical, curatedOlder, curatedNewer])).toBe(curatedNewer);
  });

  it('leads with the owner-selected cover and builds a bounded deduplicated media mosaic', () => {
    const events = [entity({ coverAssetId: 'event-cover', previewAssetIds: ['event-cover', 'event-two'] })];
    const places = [entity({ coverAssetId: 'place-cover', entityKind: 'place' })];
    const objects = [entity({ coverAssetId: 'object-cover', entityKind: 'object' })];
    expect(collectCimmichHomeHeroAssets(events, places, objects, [subject({})], 4)).toEqual([
      'event-cover',
      'event-two',
      'place-cover',
      'object-cover',
    ]);
    expect(cimmichHomeContextPreviewId(events[0])).toBe('event-cover');
  });

  it('keeps the ordinary photo crop focused on the representative Face without manufacturing missing truth', () => {
    expect(
      cimmichHomeFaceFocus(
        subject({
          box_h: 0.2,
          box_w: 0.2,
          box_x: 0.7,
          box_y: 0.1,
        }),
      ),
    ).toEqual({
      backgroundPosition: '80% 20%',
      backgroundSize: 'cover',
      sourceAssetId: 'source_person',
    });
    expect(cimmichHomeFaceFocus(subject({ box_h: null }))).toBeNull();
    expect(cimmichHomeFaceFocus(subject({ sourceAssetId: undefined }))).toBeNull();
  });

  it('keeps entity links and owner-facing summaries compact', () => {
    expect(cimmichHomeEntityHref('events', 'event with spaces')).toBe('/cimmich/events?entityId=event%20with%20spaces');
    expect(cimmichHomePreviewNames(['Maya', 'Theo', 'Nora', 'Alex'])).toBe('Maya · Theo · Nora +1');
    expect(cimmichHomePreviewNames([])).toBe('Ready to explore');
    expect(cimmichHomeReviewLabel(0)).toBe('Nothing waiting');
    expect(cimmichHomeReviewLabel(1)).toBe('1 suggestion ready');
    expect(cimmichHomeReviewLabel(3)).toBe('3 suggestions ready');
  });

  it('prefers a distinct visible image for every portal without inventing missing media', () => {
    expect(
      chooseCimmichHomeDistinctMedia(
        [['hero', 'person-two'], ['pet'], ['hero', 'place-two'], ['thing'], ['hero', 'event-two'], ['document']],
        ['hero'],
      ),
    ).toEqual(['person-two', 'pet', 'place-two', 'thing', 'event-two', 'document']);
    expect(chooseCimmichHomeDistinctMedia([['only'], ['only'], []])).toEqual(['only', 'only', null]);
  });
});
