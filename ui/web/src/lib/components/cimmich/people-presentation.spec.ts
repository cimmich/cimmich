import { describe, expect, it } from 'vitest';
import { chooseInitialPeopleView } from './people-presentation';

const person = (
  overrides: Partial<Parameters<typeof chooseInitialPeopleView>[0][number]> = {},
): Parameters<typeof chooseInitialPeopleView>[0][number] => ({
  accepted_faces: 0,
  candidate_faces: 0,
  needs_holding: false,
  needs_sort: false,
  sourceAssetId: '',
  ...overrides,
});

describe('chooseInitialPeopleView', () => {
  it('keeps the collection on People even when every person is waiting for workflow attention', () => {
    expect(chooseInitialPeopleView(Array.from({ length: 7 }, () => person({ needs_sort: true })))).toBe('faces');
  });

  it('prefers normal People when accepted photo-backed people are available', () => {
    expect(
      chooseInitialPeopleView([
        person({ accepted_faces: 1, sourceAssetId: 'asset-1' }),
        person({ accepted_faces: 2, sourceAssetId: 'asset-2' }),
        person({ needs_sort: true }),
      ]),
    ).toBe('faces');
  });

  it('keeps normal People ahead of suggestions when accepted photo-backed truth exists', () => {
    expect(chooseInitialPeopleView([person({ accepted_faces: 1, candidate_faces: 2, sourceAssetId: 'asset-1' })])).toBe(
      'faces',
    );
  });

  it('does not turn a privacy-withheld portrait into workflow attention', () => {
    expect(chooseInitialPeopleView([person({ accepted_faces: 0, sourceAssetId: '' })])).toBe('faces');
  });
});
