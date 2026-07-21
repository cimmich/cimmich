export type PeopleViewMode = 'candidates' | 'faces' | 'needsFace';

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
