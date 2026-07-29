import type { CimmichPet, CimmichPetMedia } from '$lib/services/cimmich.service';
import {
  getPetCollectionHref,
  getPetConnectionHref,
  getPetContentHref,
  getPetContentKeyboardTarget,
  getPetContentView,
  getPetDetailHref,
  getPetMediaEvidence,
  getPetMediaFocusCrop,
  getPetMediaTimeframe,
  getPetPresentation,
  getPetRelatedConnectionsHref,
  getVisiblePetAliases,
  groupPetConnections,
  sortPets,
} from './pet-presentation';

const pet = (displayName: string, aliases: string[] = [], description = ''): CimmichPet => ({
  aliases,
  breedLabel: null,
  confirmedMediaCount: 0,
  connections: [],
  cover: null,
  description,
  displayName,
  documentCount: 0,
  petId: `pet-${displayName}`,
  projection: { revision: 1, state: 'current' },
  speciesKind: null,
  speciesLabel: null,
  status: 'active',
  visibility: {
    decisionId: null,
    explicit: false,
    objectId: `pet-${displayName}`,
    objectScope: 'pet',
    revision: 0,
    visibilityTier: 'standard',
  },
});

describe('Pet presentation', () => {
  it('does not infer species from a Pet name', () => {
    expect(getPetPresentation(pet('Cafe')).label).toBe('Pet');
    expect(getPetPresentation(pet('Freya Hart')).label).toBe('Pet');
  });

  it('prefers an explicit descriptive species hint', () => {
    expect(getPetPresentation(pet('Pepper', [], 'Small rescue rabbit')).label).toBe('Rabbit');
  });

  it('uses a neutral icon when no species hint exists', () => {
    expect(getPetPresentation(pet('Pepper')).label).toBe('Pet');
  });

  it('prefers the typed species projection over legacy presentation hints', () => {
    expect(getPetPresentation({ ...pet('Cafe'), speciesKind: 'cat' }).label).toBe('Cat');
    expect(getPetPresentation({ ...pet('Quinn'), speciesKind: 'other', speciesLabel: 'Axolotl' }).label).toBe(
      'Axolotl',
    );
  });

  it('hides aliases that only repeat the display name', () => {
    expect(getVisiblePetAliases(pet('Cafe', ['Cafe', 'Café']))).toEqual(['Café']);
    expect(getVisiblePetAliases(pet('Freya Hart', ['Freya Hart']))).toEqual([]);
  });

  it('sorts by name without mutating the Pet projection', () => {
    const pets = [pet('Zulu'), pet('alpha')];

    expect(sortPets(pets, 'name-asc').map(({ displayName }) => displayName)).toEqual(['alpha', 'Zulu']);
    expect(pets.map(({ displayName }) => displayName)).toEqual(['Zulu', 'alpha']);
  });

  it('sorts by media count with name as a stable tie-breaker', () => {
    const cafe = { ...pet('Cafe'), confirmedMediaCount: 4 };
    const freya = { ...pet('Freya'), confirmedMediaCount: 12 };
    const miso = { ...pet('Miso'), confirmedMediaCount: 4 };

    expect(sortPets([miso, cafe, freya], 'media-desc').map(({ displayName }) => displayName)).toEqual([
      'Freya',
      'Cafe',
      'Miso',
    ]);
  });

  it('describes a single-day and multi-year Pet photo timeframe', () => {
    const media = (capture_time: string | null): CimmichPetMedia => ({
      asset_id: `asset-${capture_time}`,
      association_types: ['presence'],
      capture_time,
      filename: 'pet.jpg',
      height: 100,
      media_kind: 'image',
      pet_face: null,
      sourceAssetId: `source-${capture_time}`,
      width: 100,
    });

    expect(getPetMediaTimeframe([media('2018-01-27T12:00:00Z')], 'en-AU')).toBe('27 Jan 2018');
    expect(getPetMediaTimeframe([media('2018-01-27T12:00:00Z'), media('2024-06-03T12:00:00Z')], 'en-AU')).toBe(
      '2018–2024',
    );
    expect(getPetMediaTimeframe([media(null)], 'en-AU')).toBeNull();
  });

  it('turns accepted Pet face geometry into a padded 4:3 presentation crop', () => {
    const media: CimmichPetMedia = {
      asset_id: 'asset-cafe',
      association_types: ['face'],
      capture_time: '2018-01-27T12:00:00Z',
      filename: 'cafe.jpg',
      height: 3024,
      media_kind: 'image',
      pet_face: {
        box_h: 0.1,
        box_w: 0.06,
        box_x: 0.86,
        box_y: 0.78,
        face_id: 'face-cafe',
      },
      sourceAssetId: 'source-cafe',
      width: 4032,
    };

    // Default target is square, for the circular portraits and the picker.
    const crop = getPetMediaFocusCrop(media);
    expect(crop?.w).toBeCloseTo(0.32);
    expect(crop?.h).toBeCloseTo(0.4267, 3);
    expect(crop?.x).toBeCloseTo(0.68);
    expect(crop?.y).toBeCloseTo(0.5733, 3);

    // The invariant that actually matters: the crop must be square in PIXELS for
    // a square frame, otherwise the background axes scale unequally and the
    // animal is stretched. Normalised w and h differ precisely because the
    // source is 4:3.
    expect(crop!.w * media.width).toBeCloseTo(crop!.h * media.height, 0);

    // The hero banner is 12/5, so its crop must be wider than tall in pixels.
    const banner = getPetMediaFocusCrop(media, 12 / 5);
    expect((banner!.w * media.width) / (banner!.h * media.height)).toBeCloseTo(12 / 5, 1);

    expect(getPetMediaFocusCrop({ ...media, pet_face: null })).toBeNull();
  });

  it('names the Pet in its own route the way People does, while preserving collection context', () => {
    const collection = new URL('http://localhost/cimmich/pets?relatedIds=pet-juniper%2Cpet-pixel');
    const detail = getPetDetailHref(collection, 'pet-juniper', 'Juniper');

    expect(detail).toBe('/cimmich/pets/Juniper?relatedIds=pet-juniper%2Cpet-pixel&petId=pet-juniper');
    expect(getPetCollectionHref(new URL(detail, collection))).toBe('/cimmich/pets?relatedIds=pet-juniper%2Cpet-pixel');
  });

  it('encodes Pet names that are not URL-safe', () => {
    const collection = new URL('http://localhost/cimmich/pets');

    expect(getPetDetailHref(collection, 'pet-1', 'Mr Bigglesworth III/IV')).toBe(
      '/cimmich/pets/Mr%20Bigglesworth%20III%2FIV?petId=pet-1',
    );
  });

  it('makes every Pet profile tab reloadable without polluting the default Photos URL', () => {
    const profile = new URL('http://localhost/cimmich/pets/Juniper?petId=pet-juniper');

    const details = getPetContentHref(profile, 'details');
    expect(details).toBe('/cimmich/pets/Juniper?petId=pet-juniper&tab=details');
    expect(getPetContentView(new URL(details, profile))).toBe('details');
    const display = getPetContentHref(profile, 'display');
    expect(display).toBe('/cimmich/pets/Juniper?petId=pet-juniper&tab=display');
    expect(getPetContentView(new URL(display, profile))).toBe('display');
    expect(getPetContentHref(new URL(details, profile), 'photos')).toBe('/cimmich/pets/Juniper?petId=pet-juniper');
    expect(getPetContentView(new URL('/cimmich/pets/Juniper?petId=pet-juniper&tab=unknown', profile))).toBe('photos');
  });

  it('clears stale tab state when opening or closing a Pet profile', () => {
    const details = new URL('http://localhost/cimmich/pets/Old?petId=pet-old&tab=details&relatedFrom=Maya');

    expect(getPetDetailHref(details, 'pet-juniper', 'Juniper')).toBe(
      '/cimmich/pets/Juniper?petId=pet-juniper&relatedFrom=Maya',
    );
    expect(getPetCollectionHref(details)).toBe('/cimmich/pets?relatedFrom=Maya');
  });

  it('still returns to the collection from a pre-route ?entityId= link', () => {
    const legacy = new URL('http://localhost/cimmich/pets?entityId=pet-juniper&tab=details&relatedFrom=Maya');

    expect(getPetCollectionHref(legacy)).toBe('/cimmich/pets?relatedFrom=Maya');
  });

  it('supports the complete keyboard model for the Pet profile tablist', () => {
    expect(getPetContentKeyboardTarget('photos', 'ArrowRight')).toBe('review');
    expect(getPetContentKeyboardTarget('photos', 'ArrowLeft')).toBe('documents');
    expect(getPetContentKeyboardTarget('connections', 'Home')).toBe('photos');
    expect(getPetContentKeyboardTarget('details', 'End')).toBe('documents');
    expect(getPetContentKeyboardTarget('connections', 'ArrowRight')).toBe('display');
    expect(getPetContentKeyboardTarget('display', 'ArrowRight')).toBe('documents');
    expect(getPetContentKeyboardTarget('details', 'Enter')).toBeNull();
  });

  it('groups Pet connections into the owner-facing Places, Events and Things order', () => {
    const connections = [
      {
        coverAssetId: 'source-bike',
        direction: 'incoming',
        displayName: 'Moss',
        relationType: 'related',
        targetId: 'object-moss',
        targetKind: 'object',
        typeKind: 'vehicle',
      },
      {
        coverAssetId: 'source-garden',
        direction: 'incoming',
        displayName: 'Willow Community Garden',
        relationType: 'visited',
        targetId: 'place-willow',
        targetKind: 'place',
        typeKind: 'point',
      },
    ] as const;

    expect(groupPetConnections([...connections]).map(({ label }) => label)).toEqual(['Places', 'Things']);
    expect(getPetConnectionHref(connections[0])).toBe('/cimmich/places?entityId=object-moss&family=objects');
    expect(getPetRelatedConnectionsHref('Juniper', [...connections], 'object')).toBe(
      '/cimmich/places?family=objects&relatedFrom=Juniper&relatedIds=object-moss',
    );
  });

  it('describes manual Pet evidence without falsely calling every tag Presence', () => {
    expect(getPetMediaEvidence(['body'])).toEqual({
      description: 'You linked this Pet to the photo. The Cimmich association is reversible and does not alter it.',
      label: 'Linked by you',
      origin: 'user',
    });
    expect(getPetMediaEvidence(['presence'])).toMatchObject({ label: 'Linked by you', origin: 'user' });
    expect(getPetMediaEvidence(['face'])).toEqual({
      description: 'Cimmich currently links this photo to the Pet. The photo itself is unchanged.',
      label: 'Linked appearance',
      origin: 'system',
    });
  });
});
