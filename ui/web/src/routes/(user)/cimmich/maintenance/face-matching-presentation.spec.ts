import { describe, expect, it } from 'vitest';
import type { CimmichFaceMatchingOperatorStatus } from '$lib/services/cimmich.service';
import {
  faceMatchingPresentation,
  faceMatchingReviewHoldCopy,
  referenceLibraryJourney,
  sourcePackReviewGate,
} from './face-matching-presentation';

describe('Face matching owner presentation', () => {
  it('keeps a disabled provider distinct from missing identity truth', () => {
    expect(
      faceMatchingPresentation({
        automaticIdentityAuthority: 'none',
        basicIdentityTruthRetainedWhenDisabled: true,
        provider: { configured: false },
        review: {
          enabled: false,
          humanAcceptanceRequired: true,
          marginFloor: null,
          policyVersion: 'cimmich-best-prime-v1',
          scoreFloor: null,
        },
        schemaVersion: 'cimmich.face-matching-status.v1',
        sourcePack: { activePassed: 0, awaitingReview: 0 },
        state: 'provider_disabled',
      }),
    ).toMatchObject({
      label: 'Provider off',
      providerLabel: 'No local provider configured',
      ready: false,
    });
  });

  it('explains that references come from the connected owner library', () => {
    expect(
      faceMatchingPresentation({
        automaticIdentityAuthority: 'none',
        basicIdentityTruthRetainedWhenDisabled: true,
        provider: {
          configured: true,
          modelFamily: 'opencv-sface',
          modelVersion: '2021dec',
          providerId: 'opencv-yunet-sface-cpu',
        },
        review: {
          enabled: false,
          humanAcceptanceRequired: true,
          marginFloor: null,
          policyVersion: 'cimmich-best-prime-v1',
          scoreFloor: null,
        },
        schemaVersion: 'cimmich.face-matching-status.v1',
        sourcePack: { activePassed: 0, awaitingReview: 0 },
        state: 'needs_source_pack',
      }),
    ).toMatchObject({
      label: 'Build references',
      providerLabel: 'opencv-yunet-sface-cpu · 2021dec',
      ready: false,
    });
  });

  it('presents a reviewed active pack as review-only readiness', () => {
    expect(
      faceMatchingPresentation({
        automaticIdentityAuthority: 'none',
        basicIdentityTruthRetainedWhenDisabled: true,
        provider: {
          configured: true,
          modelFamily: 'opencv-sface',
          modelVersion: '2021dec',
          providerId: 'opencv-yunet-sface-cpu',
        },
        review: {
          enabled: true,
          humanAcceptanceRequired: true,
          marginFloor: 0.02,
          policyVersion: 'cimmich-best-prime-v1',
          scoreFloor: 0.8,
        },
        schemaVersion: 'cimmich.face-matching-status.v1',
        sourcePack: { activePassed: 1, awaitingReview: 0 },
        state: 'ready',
      }),
    ).toMatchObject({
      activePackLabel: '1 reviewed build in use',
      label: 'Ready',
      ready: true,
    });
  });

  it('turns closed review-gate holds into owner language', () => {
    expect(faceMatchingReviewHoldCopy('INSUFFICIENT_VERIFIED_UNKNOWNS')).toBe(
      'The evaluation has fewer than 100 verified unknown examples.',
    );
    expect(faceMatchingReviewHoldCopy('LEAKAGE_OR_PROVENANCE_CHECK_FAILED')).toBe(
      'The evaluation found evidence leakage or invalid provenance.',
    );
    expect(faceMatchingReviewHoldCopy(null)).toBe('This evaluation is not ready for human review.');
  });

  it('ends an uncheckable proposal at a visible safety hold', () => {
    const status = {
      provider: {
        configured: true,
        modelFamily: 'opencv-sface',
        modelVersion: '2021dec',
        providerId: 'opencv-yunet-sface-cpu',
      },
      next: { action: 'await_more_evidence', reason: 'INSUFFICIENT_BALANCED_OPEN_SET_HOLDOUT' },
      latestPack: {
        packId: 'pack-held',
      },
      sourcePack: { activePassed: 0, awaitingReview: 1 },
      state: 'needs_operator_review',
    } as CimmichFaceMatchingOperatorStatus;

    expect(referenceLibraryJourney(status)).toMatchObject({
      activeIndex: 2,
      headline: 'Safety check unavailable — proposal held',
      held: true,
      steps: [
        { label: 'Analyse', state: 'complete' },
        { label: 'Build', state: 'complete' },
        { label: 'Check', state: 'held' },
        { label: 'Decide', state: 'upcoming' },
        { label: 'Use', state: 'upcoming' },
      ],
    });
    expect(faceMatchingPresentation(status)).toMatchObject({
      label: 'Safely held',
      ready: false,
    });
  });

  it('does not invent a held proposal when a clean library only needs evidence', () => {
    const status = {
      provider: {
        configured: true,
        modelFamily: 'opencv-sface',
        modelVersion: '2021dec',
        providerId: 'opencv-yunet-sface-cpu',
      },
      next: { action: 'await_more_evidence', reason: 'NO_ELIGIBLE_ACCEPTED_FACES' },
      sourcePack: { activePassed: 0, awaitingReview: 0 },
      state: 'needs_source_pack',
    } as CimmichFaceMatchingOperatorStatus;

    expect(referenceLibraryJourney(status)).toMatchObject({
      activeIndex: 0,
      headline: 'Analyse',
      held: false,
    });
    expect(faceMatchingPresentation(status)).toMatchObject({
      awaitingReviewLabel: '0 builds awaiting review',
      label: 'Build references',
      ready: false,
    });
  });

  it('reads the frozen review receipt from the projected SourcePack', () => {
    const receipt = { status: 'passed' } as const;
    const status = {
      latestPack: {
        reviewGateReceipt: receipt,
        reviewGateReceiptNullReason: null,
      },
    } as CimmichFaceMatchingOperatorStatus;

    expect(sourcePackReviewGate(status)).toEqual({ receipt, reason: null });
  });

  it('distinguishes a reviewed proposal from one still needing a decision', () => {
    const base = {
      provider: {
        configured: true,
        modelFamily: 'opencv-sface',
        modelVersion: '2021dec',
        providerId: 'opencv-yunet-sface-cpu',
      },
      sourcePack: { activePassed: 0, awaitingReview: 1 },
      state: 'needs_operator_review',
    };

    expect(
      faceMatchingPresentation({
        ...base,
        latestPack: { reviewGateReceipt: { status: 'passed' } },
        next: { action: 'record_operator_review' },
      } as CimmichFaceMatchingOperatorStatus),
    ).toMatchObject({ label: 'Decision needed' });
    expect(
      faceMatchingPresentation({
        ...base,
        next: { action: 'activate_source_pack' },
      } as CimmichFaceMatchingOperatorStatus),
    ).toMatchObject({
      label: 'Ready to use',
      nextAction: 'Put the reviewed reference library into use when you are ready.',
    });
  });

  it('marks every journey step complete once the reviewed library is in use', () => {
    expect(
      referenceLibraryJourney({
        next: { action: 'review_suggestions', reason: 'MATCHING_READY' },
      } as CimmichFaceMatchingOperatorStatus),
    ).toMatchObject({
      complete: true,
      headline: 'Reference library in use',
      steps: [
        { state: 'complete' },
        { state: 'complete' },
        { state: 'complete' },
        { state: 'complete' },
        { state: 'complete' },
      ],
    });
  });
});
