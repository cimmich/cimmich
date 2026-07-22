export type PeopleViewMode = 'candidates' | 'faces' | 'needsFace';
export type PeopleSortKey = 'names' | 'photos';
export type PeopleSortDirection = 'asc' | 'desc';
export type PeopleSortState = { direction: PeopleSortDirection; key: PeopleSortKey };

type SortablePerson = {
  asset_count: number;
  display_name: string;
};

export const defaultPeopleSort: PeopleSortState = { direction: 'desc', key: 'photos' };

export const nextPeopleSort = (current: PeopleSortState, key: PeopleSortKey): PeopleSortState => {
  if (current.key === key) {
    return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  }
  return { key, direction: key === 'photos' ? 'desc' : 'asc' };
};

export const comparePeople = (left: SortablePerson, right: SortablePerson, sort: PeopleSortState) => {
  if (sort.key === 'photos') {
    const difference = left.asset_count - right.asset_count;
    return (sort.direction === 'asc' ? difference : -difference) || left.display_name.localeCompare(right.display_name);
  }

  const difference = left.display_name.localeCompare(right.display_name);
  return sort.direction === 'asc' ? difference : -difference;
};

type PersonViewEvidence = {
  accepted_faces: number;
  candidate_faces: number;
  needs_holding: boolean;
  needs_sort: boolean;
  sourceAssetId: string;
};

export const chooseInitialPeopleView = (people: PersonViewEvidence[]): PeopleViewMode => {
  const counts: Record<PeopleViewMode, number> = {
    faces: people.length,
    candidates: people.filter((person) => person.candidate_faces > 0).length,
    needsFace: people.filter((person) => person.needs_holding || person.needs_sort).length,
  };

  let best: PeopleViewMode = 'faces';
  for (const candidate of ['needsFace', 'candidates'] as const) {
    if (counts[candidate] > counts[best]) {
      best = candidate;
    }
  }
  return best;
};
