import {
  getCimmichPersonDetailsDisplay,
  getCimmichPersonDetailsDisplayDefaults,
  getCimmichPersonProfile,
  getCimmichPersonProfileDisplay,
  getCimmichPersonProfileDisplayDefaults,
} from '$lib/services/cimmich.service';

export const loadPersonDetailsProjection = (personId: string) =>
  Promise.all([
    getCimmichPersonProfile(personId),
    getCimmichPersonProfileDisplayDefaults(),
    getCimmichPersonProfileDisplay(personId),
    getCimmichPersonDetailsDisplayDefaults(),
    getCimmichPersonDetailsDisplay(personId),
  ]);
