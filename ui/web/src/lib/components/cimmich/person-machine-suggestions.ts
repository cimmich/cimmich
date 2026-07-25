import type { CimmichIdentityCandidate, CimmichMachineSuggestion } from '$lib/services/cimmich.service';

export const machineSuggestionCountsByLead = (suggestions: CimmichMachineSuggestion[]) => {
  const counts = new Map<string, number>();
  for (const suggestion of suggestions) {
    const personId = suggestion.candidates[0]?.person_id;
    if (personId) {
      counts.set(personId, (counts.get(personId) ?? 0) + 1);
    }
  }
  return counts;
};

export const machineSuggestionsForPerson = (
  suggestions: CimmichMachineSuggestion[],
  personId: string,
  candidates: Pick<CimmichIdentityCandidate, 'face_id'>[] = [],
) => {
  const persistedFaceIds = new Set(candidates.map((candidate) => candidate.face_id));
  return suggestions.filter(
    (suggestion) => suggestion.candidates[0]?.person_id === personId && !persistedFaceIds.has(suggestion.face_id),
  );
};
