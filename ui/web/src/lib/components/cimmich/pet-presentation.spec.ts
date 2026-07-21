import type { CimmichPet, CimmichPetMedia } from '$lib/services/cimmich.service';
import {
  getPetCollectionHref,
  getPetConnectionHref,
  getPetContentHref,
  getPetContentKeyboardTarget,
  getPetContentView,
  getPetDetailHref,
  getPetMediaEvidence,
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
  it('uses the confirmed name fallbacks for the current Pets', () => {
    expect(getPetPresentation(pet('Cafe')).label).toBe('Dog');
    expect(getPetPresentation(pet('Freya Hart')).label).toBe('Cat');
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
      sourceAssetId: `source-${capture_time}`,
      width: 100,
    });

    expect(getPetMediaTimeframe([media('2018-01-27T12:00:00Z')], 'en-AU')).toBe('27 Jan 2018');
    expect(getPetMediaTimeframe([media('2018-01-27T12:00:00Z'), media('2024-06-03T12:00:00Z')], 'en-AU')).toBe(
      '2018–2024',
    );
    expect(getPetMediaTimeframe([media(null)], 'en-AU')).toBeNull();
  });

  it('binds Pet detail navigation to a stable query while preserving collection context', () => {
    const collection = new URL('http://localhost/cimmich/pets?relatedIds=pet-juniper%2Cpet-pixel');
    const detail = getPetDetailHref(collection, 'pet-juniper');

    expect(detail).toBe('/cimmich/pets?relatedIds=pet-juniper%2Cpet-pixel&entityId=pet-juniper');
    expect(getPetCollectionHref(new URL(detail, collection))).toBe('/cimmich/pets?relatedIds=pet-juniper%2Cpet-pixel');
  });

  it('makes every Pet profile tab reloadable without polluting the default Photos URL', () => {
    const profile = new URL('http://localhost/cimmich/pets?entityId=pet-juniper');

    const details = getPetContentHref(profile, 'details');
    expect(details).toBe('/cimmich/pets?entityId=pet-juniper&tab=details');
    expect(getPetContentView(new URL(details, profile))).toBe('details');
    expect(getPetContentHref(new URL(details, profile), 'photos')).toBe('/cimmich/pets?entityId=pet-juniper');
    expect(getPetContentView(new URL('/cimmich/pets?entityId=pet-juniper&tab=unknown', profile))).toBe('photos');
  });

  it('clears stale tab state when opening or closing a Pet profile', () => {
    const details = new URL('http://localhost/cimmich/pets?entityId=pet-old&tab=details&relatedFrom=Maya');

    expect(getPetDetailHref(details, 'pet-juniper')).toBe('/cimmich/pets?entityId=pet-juniper&relatedFrom=Maya');
    expect(getPetCollectionHref(details)).toBe('/cimmich/pets?relatedFrom=Maya');
  });

  it('supports the complete keyboard model for the Pet profile tablist', () => {
    expect(getPetContentKeyboardTarget('photos', 'ArrowRight')).toBe('details');
    expect(getPetContentKeyboardTarget('photos', 'ArrowLeft')).toBe('documents');
    expect(getPetContentKeyboardTarget('connections', 'Home')).toBe('photos');
    expect(getPetContentKeyboardTarget('details', 'End')).toBe('documents');
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
