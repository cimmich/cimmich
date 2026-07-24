import type {
  CimmichFaceMatchingOperatorStatus,
  CimmichIntegrationStatus,
  CimmichSourcePackReviewGateNullReason,
} from '$lib/services/cimmich.service';

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
    nextAction: 'Set up the recommended local provider above, then deliberately turn on Enhanced.',
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
  const operatorStatus = status as CimmichFaceMatchingOperatorStatus | undefined;
  const action = operatorStatus?.next?.action;
  const hasPreparedLibrary = Boolean(operatorStatus?.latestPack);
  const copy =
    action === 'await_more_evidence' && hasPreparedLibrary
      ? {
          label: 'Safely held',
          nextAction:
            'Keep this proposal held. Confirm more Faces across different dates and people, then build a new reference library.',
          summary:
            'Cimmich built a proposal, but this library is not yet varied enough for an honest safety check. It remains inactive.',
        }
      : action === 'record_operator_review' && operatorStatus?.latestPack?.reviewGateReceipt
        ? {
            label: 'Decision needed',
            nextAction: 'Review the frozen safety result, then explicitly approve this proposal or keep it held.',
            summary:
              'The safety check is complete. Nothing changes unless you approve this exact result, and approval still does not put it into use.',
          }
        : action === 'activate_source_pack'
          ? {
              label: 'Ready to use',
              nextAction: 'Put the reviewed reference library into use when you are ready.',
              summary:
                'You approved the frozen safety result. The reference library remains inactive until you explicitly choose Use.',
            }
          : stateCopy[state];
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

const journeyActions = [
  'run_recognition',
  'compile_source_pack',
  'evaluate_source_pack',
  'record_operator_review',
  'activate_source_pack',
] as const;

export const referenceLibraryJourney = (status: CimmichFaceMatchingOperatorStatus | undefined) => {
  const action = status?.next.action;
  const held = action === 'await_more_evidence' && Boolean(status?.latestPack);
  const complete = action === 'review_suggestions';
  const activeIndex = complete
    ? 4
    : held
      ? 2
      : Math.max(0, journeyActions.indexOf(action as (typeof journeyActions)[number]));
  const labels = ['Analyse', 'Build', 'Check', 'Decide', 'Use'];

  return {
    activeIndex,
    complete,
    headline: complete
      ? 'Reference library in use'
      : held
        ? 'Safety check unavailable — proposal held'
        : labels[activeIndex],
    held,
    steps: labels.map((label, index) => ({
      label,
      state: complete
        ? 'complete'
        : index < activeIndex
          ? 'complete'
          : index === activeIndex
            ? held
              ? 'held'
              : 'current'
            : 'upcoming',
    })),
  };
};

export const sourcePackReviewGate = (status: CimmichFaceMatchingOperatorStatus | undefined) => ({
  receipt: status?.latestPack?.reviewGateReceipt ?? null,
  reason: status?.latestPack?.reviewGateReceiptNullReason ?? null,
});

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
