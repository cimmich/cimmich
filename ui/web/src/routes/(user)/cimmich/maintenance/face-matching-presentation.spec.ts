import { describe, expect, it } from 'vitest';
import { faceMatchingPresentation, faceMatchingReviewHoldCopy } from './face-matching-presentation';

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
});
