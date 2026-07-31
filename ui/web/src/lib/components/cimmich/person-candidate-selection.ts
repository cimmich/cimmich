export const PERSON_CANDIDATE_SELECTION_LIMIT = 100;

export type PersonCandidateSelectionUpdate = {
  limitReached: boolean;
  selection: string[];
};

export const togglePersonCandidateSelection = (
  selection: string[],
  claimId: string,
): PersonCandidateSelectionUpdate => {
  if (selection.includes(claimId)) {
    return {
      limitReached: false,
      selection: selection.filter((id) => id !== claimId),
    };
  }

  if (selection.length >= PERSON_CANDIDATE_SELECTION_LIMIT) {
    return { limitReached: true, selection: [...selection] };
  }

  return { limitReached: false, selection: [...selection, claimId] };
};

export const selectPersonCandidates = (claimIds: string[]): PersonCandidateSelectionUpdate => {
  const uniqueClaimIds = [...new Set(claimIds)];
  return {
    limitReached: uniqueClaimIds.length > PERSON_CANDIDATE_SELECTION_LIMIT,
    selection: uniqueClaimIds.slice(0, PERSON_CANDIDATE_SELECTION_LIMIT),
  };
};
