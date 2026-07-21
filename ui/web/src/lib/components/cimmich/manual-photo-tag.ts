import { getPetPresentation } from '$lib/components/cimmich/pet-presentation';
import type { CimmichPerson, CimmichPet } from '$lib/services/cimmich.service';

export type ManualPhotoTagGeometry = {
  h: number;
  w: number;
  x: number;
  y: number;
};

export type ManualPhotoTagType = 'body' | 'face' | 'head' | 'presence';

export type ManualPhotoTagSubject = {
  icon?: string;
  id: string;
  kind: 'person' | 'pet';
  name: string;
  speciesLabel?: string;
};

export type ManualPhotoTagPersonConflict = {
  personId: string;
  personName: string;
};

export type ManualPhotoTagPersonConflictResolution =
  | { state: 'ambiguous' }
  | { state: 'none' }
  | { person: ManualPhotoTagPersonConflict; state: 'single' };

export const createManualPhotoTagPetSubject = (pet: CimmichPet): ManualPhotoTagSubject => {
  const presentation = getPetPresentation(pet);
  return {
    icon: presentation.icon,
    id: pet.petId,
    kind: 'pet',
    name: pet.displayName,
    speciesLabel: presentation.label,
  };
};

export const createManualPhotoTagPersonSubjects = (
  people: Array<Pick<CimmichPerson, 'display_name' | 'person_id' | 'subject_kind'>>,
): ManualPhotoTagSubject[] =>
  people
    .filter((person) => person.subject_kind === 'person')
    .map((person) => ({ id: person.person_id, kind: 'person', name: person.display_name }));

export const manualPhotoTagSubjectLabel = (subject: Pick<ManualPhotoTagSubject, 'kind' | 'speciesLabel'>) =>
  subject.kind === 'pet' ? `Pet · ${subject.speciesLabel?.trim() || 'Species not set'}` : 'Person';

const normalizedSubjectName = (value: string) => value.trim().replaceAll(/\s+/g, ' ').toLocaleLowerCase();

export const findExactManualPhotoTagPerson = (
  subjects: ManualPhotoTagSubject[],
  name: string,
): ManualPhotoTagSubject | undefined => {
  const normalizedName = normalizedSubjectName(name);
  if (!normalizedName) {
    return undefined;
  }
  return subjects.find(
    (subject) => subject.kind === 'person' && normalizedSubjectName(subject.name) === normalizedName,
  );
};

export const resolveManualPhotoTagPersonConflict = (value: unknown): ManualPhotoTagPersonConflictResolution => {
  if (!Array.isArray(value)) {
    return { state: 'none' };
  }
  const people = value.filter((candidate): candidate is ManualPhotoTagPersonConflict =>
    Boolean(
      candidate &&
      typeof candidate === 'object' &&
      'personId' in candidate &&
      typeof candidate.personId === 'string' &&
      candidate.personId.trim() &&
      'personName' in candidate &&
      typeof candidate.personName === 'string' &&
      candidate.personName.trim(),
    ),
  );
  if (people.length === 1) {
    return { person: people[0], state: 'single' };
  }
  return { state: people.length > 1 ? 'ambiguous' : 'none' };
};

type ImageRect = {
  height: number;
  left: number;
  top: number;
  width: number;
};

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

export const createManualPhotoTagGeometry = (
  clientX: number,
  clientY: number,
  imageRect: ImageRect,
  size: { h?: number; w?: number } = {},
): ManualPhotoTagGeometry | undefined => {
  if (imageRect.width <= 0 || imageRect.height <= 0) {
    return undefined;
  }

  const centerX = (clientX - imageRect.left) / imageRect.width;
  const centerY = (clientY - imageRect.top) / imageRect.height;
  if (centerX < 0 || centerX > 1 || centerY < 0 || centerY > 1) {
    return undefined;
  }

  const w = clamp(size.w ?? 0.1, 0.02, 1);
  const h = clamp(size.h ?? 0.16, 0.02, 1);
  return {
    h,
    w,
    x: clamp(centerX - w / 2, 0, 1 - w),
    y: clamp(centerY - h / 2, 0, 1 - h),
  };
};

const manualPhotoTagSize = (tagType: ManualPhotoTagType) => {
  switch (tagType) {
    case 'body': {
      return { h: 0.82, w: 0.5 };
    }
    case 'head': {
      return { h: 0.28, w: 0.2 };
    }
    case 'face': {
      return { h: 0.18, w: 0.12 };
    }
    case 'presence': {
      return { h: 0.16, w: 0.1 };
    }
  }
};

export const resizeManualPhotoTagGeometryForType = (
  geometry: ManualPhotoTagGeometry,
  tagType: ManualPhotoTagType,
): ManualPhotoTagGeometry => {
  const centerX = geometry.x + geometry.w / 2;
  const centerY = geometry.y + geometry.h / 2;
  const { h, w } = manualPhotoTagSize(tagType);
  return {
    h,
    w,
    x: clamp(centerX - w / 2, 0, 1 - w),
    y: clamp(centerY - h / 2, 0, 1 - h),
  };
};
