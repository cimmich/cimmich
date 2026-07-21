import type { CimmichIntegrationStatus, CimmichSourcePackReviewGateNullReason } from '$lib/services/cimmich.service';

type FaceMatchingStatus = CimmichIntegrationStatus['faceMatching'] | undefined;

const stateCopy: Record<
  NonNullable<FaceMatchingStatus>['state'],
  { label: string; nextAction: string; summary: string }
> = {
  needs_operator_review: {
    label: 'Review needed',
    nextAction: 'Review the proposed reference library and its frozen evaluation before choosing Use.',
    summary:
      'Your provider has built a proposed reference library. It cannot influence suggestions until you approve it.',
  },
  needs_review_policy: {
    label: 'Policy needed',
    nextAction: 'Complete the reviewed score and margin policy for the active pack.',
    summary: 'The current reference library is missing a complete reviewed suggestion policy, so matching remains off.',
  },
  needs_source_pack: {
    label: 'Build references',
    nextAction: 'Analyse this library, then build a proposed reference library from accepted names and Face evidence.',
    summary:
      'The local provider is connected. Cimmich now needs references derived from this library—not a bundled pack.',
  },
  provider_disabled: {
    label: 'Provider off',
    nextAction: 'Choose a local provider below, obtain its models from the publisher and validate the configuration.',
    summary:
      'Your existing names and tags remain intact. Matching starts only after you connect a provider you choose.',
  },
  ready: {
    label: 'Ready',
    nextAction: 'Review suggestions as they appear. Cimmich never accepts an identity automatically.',
    summary: 'One exact provider and reviewed reference library are ready for human-review suggestions.',
  },
};

export const faceMatchingPresentation = (status: FaceMatchingStatus) => {
  const state = status?.state ?? 'provider_disabled';
  const copy = stateCopy[state];
  const providerLabel =
    status?.provider.configured === true
      ? `${status.provider.providerId} · ${status.provider.modelVersion}`
      : 'No local provider configured';

  return {
    ...copy,
    activePackLabel:
      status?.sourcePack.activePassed === 1
        ? '1 reviewed build in use'
        : `${status?.sourcePack.activePassed ?? 0} reviewed builds in use`,
    awaitingReviewLabel:
      status?.sourcePack.awaitingReview === 1
        ? '1 build awaiting review'
        : `${status?.sourcePack.awaitingReview ?? 0} builds awaiting review`,
    providerLabel,
    ready: state === 'ready',
    state,
  };
};

const reviewHoldCopy: Record<CimmichSourcePackReviewGateNullReason, string> = {
  CALIBRATION_KNOWN_COHORT_MISSING: 'The calibration set has no known-person examples to measure.',
  CALIBRATION_UNKNOWN_COHORT_MISSING: 'The calibration set has no identity-disjoint unknown examples to measure.',
  EVALUATION_ARTIFACT_INVALID: 'The frozen evaluation artifact did not pass integrity validation.',
  EVALUATION_REQUIRED: 'Check this reference library before reviewing it.',
  HOLDOUT_KNOWN_COHORT_MISSING: 'The untouched holdout has no known-person examples to verify.',
  INSUFFICIENT_VERIFIED_UNKNOWNS: 'The evaluation has fewer than 100 verified unknown examples.',
  LEAKAGE_OR_PROVENANCE_CHECK_FAILED: 'The evaluation found evidence leakage or invalid provenance.',
  NO_USEFUL_REVIEW_COVERAGE: 'The evaluation could not measure useful known-person coverage.',
  REVIEW_GATE_NOT_DERIVED: 'Cimmich could not derive a frozen review gate from this evaluation.',
};

export const faceMatchingReviewHoldCopy = (reason: CimmichSourcePackReviewGateNullReason | null | undefined) =>
  reason ? reviewHoldCopy[reason] : 'This evaluation is not ready for human review.';
