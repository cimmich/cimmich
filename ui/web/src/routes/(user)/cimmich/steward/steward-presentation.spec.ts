import { describe, expect, it } from 'vitest';
import type { CimmichFaceMatchingOperatorStatus } from '$lib/services/cimmich.service';
import { emptyReviewPresentation, reviewHasVisibleEvidence } from './steward-presentation';

const statusAt = (action: CimmichFaceMatchingOperatorStatus['next']['action']) =>
  ({ next: { action, reason: 'TEST' } }) as CimmichFaceMatchingOperatorStatus;

describe('Memory Steward presentation', () => {
  it('explains a safety hold instead of guessing at generic causes', () => {
    expect(emptyReviewPresentation(statusAt('await_more_evidence'))).toEqual({
      actionLabel: 'Review the safety hold',
      anchor: 'face-matching',
      state: 'held',
      summary:
        'Cimmich built a proposal, then held it because this library does not yet contain enough varied evidence for an honest safety check. Nothing was activated.',
      title: 'Matching is safely held.',
    });
  });

  it('distinguishes a quiet ready matcher from incomplete setup', () => {
    const ready = emptyReviewPresentation(statusAt('review_suggestions'));
    expect(ready.title).toBe('No useful matching reviews right now.');
    expect(ready.actionLabel).toBeUndefined();
    expect(emptyReviewPresentation(statusAt('configure_provider'))).toMatchObject({
      actionLabel: 'Connect local provider',
      anchor: 'provider',
      title: 'Face matching is not connected.',
    });
  });

  it.each([
    ['run_recognition', 'Continue processing'],
    ['compile_source_pack', 'Build reference library'],
    ['evaluate_source_pack', 'Check reference library'],
    ['record_operator_review', 'Review safety result'],
    ['activate_source_pack', 'Review reference library'],
  ] as const)('routes %s to a concrete next action', (action, actionLabel) => {
    expect(emptyReviewPresentation(statusAt(action))).toMatchObject({ actionLabel });
  });

  it('requires source media before presenting an identity decision', () => {
    expect(reviewHasVisibleEvidence({ sourceAssetId: 'asset-1' })).toBe(true);
    expect(reviewHasVisibleEvidence({ sourceAssetId: '' })).toBe(false);
    expect(reviewHasVisibleEvidence({ sourceAssetId: null })).toBe(false);
  });
});
