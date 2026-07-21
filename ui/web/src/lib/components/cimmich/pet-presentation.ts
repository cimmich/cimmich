import { mdiBird, mdiCat, mdiDog, mdiFish, mdiPawOutline, mdiRabbit, mdiRodent, mdiSnake } from '@mdi/js';
import type { CimmichPet, CimmichPetConnection, CimmichPetMedia } from '$lib/services/cimmich.service';

export type PetSortMode = 'media-asc' | 'media-desc' | 'name-asc' | 'name-desc';
export type PetContentView = 'connections' | 'details' | 'documents' | 'photos';

const petContentViews: PetContentView[] = ['photos', 'details', 'connections', 'documents'];
const petContentViewSet = new Set(petContentViews);

const presentations = {
  bird: { icon: mdiBird, label: 'Bird' },
  cat: { icon: mdiCat, label: 'Cat' },
  dog: { icon: mdiDog, label: 'Dog' },
  fish: { icon: mdiFish, label: 'Fish' },
  other: { icon: mdiPawOutline, label: 'Pet' },
  rabbit: { icon: mdiRabbit, label: 'Rabbit' },
  reptile: { icon: mdiSnake, label: 'Reptile' },
  small_mammal: { icon: mdiRodent, label: 'Small mammal' },
} as const;

type PetPresentationKind = keyof typeof presentations;

const keywordKinds: Array<[PetPresentationKind, RegExp]> = [
  ['dog', /\b(dog|puppy|canine)\b/],
  ['cat', /\b(cat|kitten|feline)\b/],
  ['rabbit', /\b(rabbit|bunny)\b/],
  ['bird', /\b(bird|parrot|budgie|cockatiel)\b/],
  ['fish', /\b(fish|goldfish|betta)\b/],
];

// Presentation-only compatibility for the current schema-29 records. A typed
// species field should replace these confirmed name fallbacks when available.
const nameFallbacks: Record<string, PetPresentationKind> = {
  cafe: 'dog',
  'freya hart': 'cat',
};

export const getPetPresentation = (pet: CimmichPet) => {
  if (pet.speciesKind) {
    const presentation = presentations[pet.speciesKind];
    return pet.speciesKind === 'other' && pet.speciesLabel
      ? { ...presentation, label: pet.speciesLabel }
      : presentation;
  }

  const hint = [pet.description, ...pet.aliases].join(' ').toLocaleLowerCase();
  const keywordMatch = keywordKinds.find(([, pattern]) => pattern.test(hint))?.[0];
  return presentations[keywordMatch || nameFallbacks[pet.displayName.toLocaleLowerCase()] || 'other'];
};

export const getVisiblePetAliases = (pet: CimmichPet) => {
  const displayName = pet.displayName.trim().toLocaleLowerCase();
  return pet.aliases.filter((alias) => alias.trim().toLocaleLowerCase() !== displayName);
};

export const sortPets = (pets: CimmichPet[], mode: PetSortMode) => {
  const direction = mode.endsWith('desc') ? -1 : 1;
  return [...pets].sort((left, right) => {
    if (mode.startsWith('media')) {
      const mediaDifference = left.confirmedMediaCount - right.confirmedMediaCount;
      if (mediaDifference !== 0) {
        return mediaDifference * direction;
      }
    }

    const nameDifference = left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' });
    return mode.startsWith('media') ? nameDifference : nameDifference * direction;
  });
};

export const getPetMediaTimeframe = (media: CimmichPetMedia[], locale?: string) => {
  const dates = media
    .flatMap(({ capture_time }) => {
      if (!capture_time) {
        return [];
      }
      const date = new Date(capture_time);
      return Number.isNaN(date.getTime()) ? [] : [date];
    })
    .sort((left, right) => left.getTime() - right.getTime());

  const first = dates[0];
  const last = dates.at(-1);
  if (!first || !last) {
    return null;
  }

  const fullDate = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  if (first.toDateString() === last.toDateString()) {
    return fullDate.format(first);
  }

  if (first.getFullYear() === last.getFullYear()) {
    const shortDate = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
    return `${shortDate.format(first)}–${fullDate.format(last)}`;
  }

  return `${first.getFullYear()}–${last.getFullYear()}`;
};

export const getPetDetailHref = (currentUrl: URL, petId: string) => {
  const url = new URL(currentUrl);
  url.searchParams.set('entityId', petId);
  url.searchParams.delete('tab');
  return `${url.pathname}${url.search}`;
};

export const getPetCollectionHref = (currentUrl: URL) => {
  const url = new URL(currentUrl);
  url.searchParams.delete('entityId');
  url.searchParams.delete('tab');
  return `${url.pathname}${url.search}`;
};

export const getPetContentView = (currentUrl: URL): PetContentView => {
  const value = currentUrl.searchParams.get('tab') as PetContentView | null;
  return value && petContentViewSet.has(value) ? value : 'photos';
};

export const getPetContentHref = (currentUrl: URL, view: PetContentView) => {
  const url = new URL(currentUrl);
  if (view === 'photos') {
    url.searchParams.delete('tab');
  } else {
    url.searchParams.set('tab', view);
  }
  return `${url.pathname}${url.search}`;
};

export const getPetContentKeyboardTarget = (current: PetContentView, key: string): PetContentView | null => {
  if (key === 'Home') {
    return petContentViews[0];
  }
  if (key === 'End') {
    return petContentViews.at(-1) ?? null;
  }
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') {
    return null;
  }

  const direction = key === 'ArrowRight' ? 1 : -1;
  const index = petContentViews.indexOf(current);
  return petContentViews[(index + direction + petContentViews.length) % petContentViews.length] ?? null;
};

const petConnectionKinds = [
  { kind: 'place', label: 'Places' },
  { kind: 'event', label: 'Events' },
  { kind: 'object', label: 'Things' },
] as const;

export const groupPetConnections = (connections: CimmichPetConnection[]) =>
  petConnectionKinds.flatMap(({ kind, label }) => {
    const items = connections.filter((connection) => connection.targetKind === kind);
    return items.length > 0 ? [{ items, kind, label }] : [];
  });

export const getPetConnectionHref = (connection: CimmichPetConnection) => {
  const family = `${connection.targetKind}s`;
  const root = connection.targetKind === 'event' ? '/cimmich/events' : '/cimmich/places';
  const search = new URLSearchParams({ entityId: connection.targetId, family });
  return `${root}?${search.toString()}`;
};

export const getPetRelatedConnectionsHref = (
  petName: string,
  connections: CimmichPetConnection[],
  kind: CimmichPetConnection['targetKind'],
) => {
  const family = `${kind}s`;
  const root = kind === 'event' ? '/cimmich/events' : '/cimmich/places';
  const search = new URLSearchParams({
    family,
    relatedFrom: petName,
    relatedIds: connections
      .filter((connection) => connection.targetKind === kind)
      .map((connection) => connection.targetId)
      .join(','),
  });
  return `${root}?${search.toString()}`;
};

export const getPetMediaEvidence = (associationTypes: CimmichPetMedia['association_types']) => {
  const userLinked = associationTypes.some((type) => type === 'body' || type === 'head' || type === 'presence');
  return userLinked
    ? {
        description: 'You linked this Pet to the photo. The Cimmich association is reversible and does not alter it.',
        label: 'Linked by you',
        origin: 'user' as const,
      }
    : {
        description: 'Cimmich currently links this photo to the Pet. The photo itself is unchanged.',
        label: 'Linked appearance',
        origin: 'system' as const,
      };
};
