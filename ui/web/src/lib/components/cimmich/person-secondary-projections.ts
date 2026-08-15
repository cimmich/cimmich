import {
  getCimmichIdentityCorrectionDiscovery,
  getCimmichPersonPresentation,
  getCimmichVisibilityObject,
  type CimmichIdentityCorrectionDiscovery,
  type CimmichPersonPresentation,
  type CimmichVisibilityObject,
} from '$lib/services/cimmich.service';

type PersonSecondaryProjectionOptions = {
  includePresentation: boolean;
  isCurrent: () => boolean;
  onCorrections: (corrections: CimmichIdentityCorrectionDiscovery) => void;
  onPresentation: (presentation: CimmichPersonPresentation) => void;
  onVisibility: (visibility: CimmichVisibilityObject) => void;
  personId: string;
  subjectKind: 'person' | 'pet';
};

const projectWhenCurrent = <T>(promise: Promise<T>, isCurrent: () => boolean, project: (value: T) => void) => {
  void promise
    .then((value) => {
      if (isCurrent()) {
        project(value);
      }
    })
    .catch(() => {});
};

export const loadPersonSecondaryProjections = (options: PersonSecondaryProjectionOptions) => {
  const { includePresentation, isCurrent, personId, subjectKind } = options;
  projectWhenCurrent(
    getCimmichIdentityCorrectionDiscovery({ personId }, { limit: 12 }),
    isCurrent,
    options.onCorrections,
  );
  if (subjectKind !== 'person') {
    return;
  }
  projectWhenCurrent(getCimmichVisibilityObject('person', personId), isCurrent, options.onVisibility);
  if (includePresentation) {
    projectWhenCurrent(getCimmichPersonPresentation(personId), isCurrent, options.onPresentation);
  }
};
