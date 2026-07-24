import type { CimmichFaceMatchingOperatorStatus } from '$lib/services/cimmich.service';

type EmptyReviewPresentation = {
  actionLabel?: string;
  anchor?: 'face-matching' | 'provider';
  state: 'held' | 'quiet' | 'setup';
  summary: string;
  title: string;
};

const presentations: Record<CimmichFaceMatchingOperatorStatus['next']['action'], EmptyReviewPresentation> = {
  activate_source_pack: {
    actionLabel: 'Review reference library',
    anchor: 'face-matching',
    state: 'setup',
    summary:
      'Its safety result has been approved, but the reference library is not in use yet. Put it into use before Cimmich can suggest identities.',
    title: 'Your reference library is ready to use.',
  },
  await_more_evidence: {
    actionLabel: 'Review the safety hold',
    anchor: 'face-matching',
    state: 'held',
    summary:
      'Cimmich built a proposal, then held it because this library does not yet contain enough varied evidence for an honest safety check. Nothing was activated.',
    title: 'Matching is safely held.',
  },
  compile_source_pack: {
    actionLabel: 'Build reference library',
    anchor: 'face-matching',
    state: 'setup',
    summary:
      'Eligible Faces have been analysed. Build a proposed reference library before Cimmich can produce identity suggestions.',
    title: 'Analysis is complete.',
  },
  configure_provider: {
    actionLabel: 'Connect local provider',
    anchor: 'provider',
    state: 'setup',
    summary:
      'Identity suggestions are off until you connect a compatible local face provider. Existing names and tags are unchanged.',
    title: 'Face matching is not connected.',
  },
  enable_enhanced: {
    actionLabel: 'Open matching setup',
    anchor: 'provider',
    state: 'setup',
    summary:
      'A compatible local provider is available, but Enhanced matching is off. Turn it on deliberately when you are ready.',
    title: 'Face matching is off.',
  },
  evaluate_source_pack: {
    actionLabel: 'Check reference library',
    anchor: 'face-matching',
    state: 'setup',
    summary:
      'A proposed reference library exists, but it must pass a frozen safety check before it can be reviewed or used.',
    title: 'Your reference library needs checking.',
  },
  record_operator_review: {
    actionLabel: 'Review safety result',
    anchor: 'face-matching',
    state: 'setup',
    summary:
      'The frozen safety check is complete. Review its result and explicitly decide whether this exact proposal may proceed.',
    title: 'A reference-library decision is waiting.',
  },
  review_suggestions: {
    state: 'quiet',
    summary:
      'The reviewed matcher is ready, but it has no useful identity questions right now. Cimmich has not accepted an identity automatically.',
    title: 'No useful matching reviews right now.',
  },
  run_recognition: {
    actionLabel: 'Continue processing',
    anchor: 'face-matching',
    state: 'setup',
    summary: 'Eligible accepted Faces still need analysis before Cimmich can build this library’s reference evidence.',
    title: 'Face analysis is not complete.',
  },
};

export const emptyReviewPresentation = (
  status: CimmichFaceMatchingOperatorStatus | undefined,
): EmptyReviewPresentation =>
  status
    ? presentations[status.next.action]
    : {
        actionLabel: 'Open matching setup',
        anchor: 'face-matching',
        state: 'setup',
        summary:
          'Cimmich could not read the current matching stage. Open setup to inspect it; no identity has been accepted automatically.',
        title: 'No matching reviews are ready.',
      };

export const reviewHasVisibleEvidence = (suggestion: { sourceAssetId?: string | null }) =>
  Boolean(suggestion.sourceAssetId?.trim());
