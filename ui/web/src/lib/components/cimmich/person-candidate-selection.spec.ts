import { describe, expect, it } from 'vitest';
import {
  PERSON_CANDIDATE_SELECTION_LIMIT,
  selectPersonCandidates,
  togglePersonCandidateSelection,
} from './person-candidate-selection';

describe('person candidate selection', () => {
  it('adds candidates until the 100-face boundary', () => {
    const selection = Array.from({ length: PERSON_CANDIDATE_SELECTION_LIMIT - 1 }, (_, index) => `claim-${index}`);
    const result = togglePersonCandidateSelection(selection, 'claim-100');

    expect(result).toEqual({
      limitReached: false,
      selection: [...selection, 'claim-100'],
    });
  });

  it('blocks the 101st candidate without changing the selection', () => {
    const selection = Array.from({ length: PERSON_CANDIDATE_SELECTION_LIMIT }, (_, index) => `claim-${index}`);
    const result = togglePersonCandidateSelection(selection, 'claim-101');

    expect(result).toEqual({ limitReached: true, selection });
    expect(result.selection).not.toBe(selection);
  });

  it('still allows deselection at the limit', () => {
    const selection = Array.from({ length: PERSON_CANDIDATE_SELECTION_LIMIT }, (_, index) => `claim-${index}`);
    const result = togglePersonCandidateSelection(selection, 'claim-42');

    expect(result.limitReached).toBe(false);
    expect(result.selection).toHaveLength(PERSON_CANDIDATE_SELECTION_LIMIT - 1);
    expect(result.selection).not.toContain('claim-42');
  });

  it('caps Select all at 100 unique candidates and reports the boundary', () => {
    const result = selectPersonCandidates([...Array.from({ length: 120 }, (_, index) => `claim-${index}`), 'claim-20']);

    expect(result.limitReached).toBe(true);
    expect(result.selection).toHaveLength(PERSON_CANDIDATE_SELECTION_LIMIT);
    expect(result.selection.at(-1)).toBe('claim-99');
  });
});
