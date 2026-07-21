import { describe, expect, it } from 'vitest';
import type { CimmichPet } from '$lib/services/cimmich.service';
import {
  createManualPhotoTagGeometry,
  createManualPhotoTagPersonSubjects,
  createManualPhotoTagPetSubject,
  findExactManualPhotoTagPerson,
  manualPhotoTagSubjectLabel,
  resizeManualPhotoTagGeometryForType,
  resolveManualPhotoTagPersonConflict,
} from './manual-photo-tag';

const rect = { height: 500, left: 100, top: 50, width: 1000 };

describe('createManualPhotoTagGeometry', () => {
  it('centres a normalized region on the pointer', () => {
    expect(createManualPhotoTagGeometry(600, 300, rect)).toEqual({ h: 0.16, w: 0.1, x: 0.45, y: 0.42 });
  });

  it('keeps the region inside the image at its edges', () => {
    expect(createManualPhotoTagGeometry(100, 50, rect)).toEqual({ h: 0.16, w: 0.1, x: 0, y: 0 });
    expect(createManualPhotoTagGeometry(1100, 550, rect)).toEqual({ h: 0.16, w: 0.1, x: 0.9, y: 0.84 });
  });

  it('rejects pointer positions outside the fitted image', () => {
    expect(createManualPhotoTagGeometry(99, 300, rect)).toBeUndefined();
    expect(createManualPhotoTagGeometry(600, 551, rect)).toBeUndefined();
  });

  it('rejects an image with no rendered area', () => {
    expect(createManualPhotoTagGeometry(0, 0, { ...rect, width: 0 })).toBeUndefined();
  });
});

describe('resizeManualPhotoTagGeometryForType', () => {
  const point = { h: 0.16, w: 0.1, x: 0.45, y: 0.42 };

  it('turns a point placement into a useful full-body draft without moving its centre', () => {
    const geometry = resizeManualPhotoTagGeometryForType(point, 'body');
    expect(geometry).toMatchObject({ h: 0.82, w: 0.5, x: 0.25 });
    expect(geometry.y).toBeCloseTo(0.09);
  });

  it('uses distinct honest starting regions for Face, Head and Presence', () => {
    const face = resizeManualPhotoTagGeometryForType(point, 'face');
    const head = resizeManualPhotoTagGeometryForType(point, 'head');
    expect(face).toMatchObject({ h: 0.18, w: 0.12, x: 0.44 });
    expect(face.y).toBeCloseTo(0.41);
    expect(head).toMatchObject({ h: 0.28, w: 0.2, x: 0.4 });
    expect(head.y).toBeCloseTo(0.36);
    expect(resizeManualPhotoTagGeometryForType(point, 'presence')).toEqual(point);
  });

  it('keeps a large Body draft inside the photo at an edge', () => {
    const geometry = resizeManualPhotoTagGeometryForType({ h: 0.16, w: 0.1, x: 0.9, y: 0.84 }, 'body');
    expect(geometry).toMatchObject({ h: 0.82, w: 0.5, x: 0.5 });
    expect(geometry.y).toBeCloseTo(0.18);
  });
});

describe('manualPhotoTagSubjectLabel', () => {
  it('announces Pets as Pets with their species', () => {
    expect(manualPhotoTagSubjectLabel({ kind: 'pet', speciesLabel: 'Cat' })).toBe('Pet · Cat');
    expect(manualPhotoTagSubjectLabel({ kind: 'pet' })).toBe('Pet · Species not set');
  });

  it('keeps people labelled as Person', () => {
    expect(manualPhotoTagSubjectLabel({ kind: 'person' })).toBe('Person');
  });

  it.each([
    ['Juniper', 'dog', 'Pet · Dog'],
    ['Pixel', 'cat', 'Pet · Cat'],
  ] as const)('preserves the typed species for %s in attachment choices', (displayName, speciesKind, label) => {
    const pet: CimmichPet = {
      aliases: [],
      breedLabel: null,
      confirmedMediaCount: 0,
      connections: [],
      cover: null,
      description: '',
      displayName,
      documentCount: 0,
      petId: `pet-${displayName.toLocaleLowerCase()}`,
      projection: { revision: 1, state: 'current' },
      speciesKind,
      speciesLabel: null,
      status: 'active',
      visibility: {
        decisionId: null,
        explicit: false,
        objectId: `pet-${displayName.toLocaleLowerCase()}`,
        objectScope: 'pet',
        revision: 0,
        visibilityTier: 'standard',
      },
    };

    const subject = createManualPhotoTagPetSubject(pet);

    expect(subject).toMatchObject({ kind: 'pet', name: displayName, speciesLabel: label.replace('Pet · ', '') });
    expect(manualPhotoTagSubjectLabel(subject)).toBe(label);
  });
});

describe('createManualPhotoTagPersonSubjects', () => {
  it('excludes Pet-backed rows from the People projection before typed Pets are appended', () => {
    expect(
      createManualPhotoTagPersonSubjects([
        { display_name: 'Maya Chen', person_id: 'person-maya', subject_kind: 'person' },
        { display_name: 'Juniper', person_id: 'pet-juniper', subject_kind: 'pet' },
      ]),
    ).toEqual([{ id: 'person-maya', kind: 'person', name: 'Maya Chen' }]);
  });
});

describe('findExactManualPhotoTagPerson', () => {
  const subjects = [
    { id: 'pet-alex', kind: 'pet' as const, name: 'Alex' },
    { id: 'person-maya', kind: 'person' as const, name: 'Maya Chen' },
  ];

  it('does not let a same-name Pet suppress valid Person creation', () => {
    expect(findExactManualPhotoTagPerson(subjects, 'Alex')).toBeUndefined();
  });

  it('finds an existing Person with normalized exact-name semantics', () => {
    expect(findExactManualPhotoTagPerson(subjects, '  maya   chen ')).toMatchObject({
      id: 'person-maya',
      kind: 'person',
    });
  });
});

describe('resolveManualPhotoTagPersonConflict', () => {
  it('returns the one existing Person only when the conflict is unambiguous', () => {
    expect(resolveManualPhotoTagPersonConflict([{ personId: 'person-alex', personName: 'Alex' }])).toEqual({
      person: { personId: 'person-alex', personName: 'Alex' },
      state: 'single',
    });
  });

  it('fails closed when more than one Person owns the name or alias', () => {
    expect(
      resolveManualPhotoTagPersonConflict([
        { personId: 'person-alex-one', personName: 'Alex One' },
        { personId: 'person-alex-two', personName: 'Alex Two' },
      ]),
    ).toEqual({ state: 'ambiguous' });
  });
});
