import {
  getCimmichIdentityCorrectionDiscovery,
  getCimmichPersonConnections,
  getCimmichPersonPresentation,
  getCimmichVisibilityObject,
  type CimmichIdentityCorrectionDiscovery,
  type CimmichPersonContextConnection,
  type CimmichPersonPresentation,
  type CimmichVisibilityObject,
} from '$lib/services/cimmich.service';

type PersonSecondaryProjectionOptions = {
  includePresentation: boolean;
  isCurrent: () => boolean;
  onConnections: (connections: CimmichPersonContextConnection[]) => void;
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
  projectWhenCurrent(getCimmichPersonConnections(personId), isCurrent, options.onConnections);
  if (subjectKind !== 'person') {
    return;
  }
  projectWhenCurrent(getCimmichVisibilityObject('person', personId), isCurrent, options.onVisibility);
  if (includePresentation) {
    projectWhenCurrent(getCimmichPersonPresentation(personId), isCurrent, options.onPresentation);
  }
};
