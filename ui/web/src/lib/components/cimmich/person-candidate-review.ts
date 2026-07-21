import type { CimmichIdentityCandidate } from '$lib/services/cimmich.service';

export type PersonCandidateReviewMode = 'all' | 'useful';

const finite = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;

export const hasUsefulCandidateSeparation = (candidate: CimmichIdentityCandidate) =>
  finite(candidate.source_margin) > 0;

export const preparePersonCandidates = (candidates: CimmichIdentityCandidate[], mode: PersonCandidateReviewMode) =>
  candidates
    .filter((candidate) => mode === 'all' || hasUsefulCandidateSeparation(candidate))
    .slice()
    .sort(
      (left, right) =>
        finite(right.source_margin) - finite(left.source_margin) ||
        finite(right.match_score) - finite(left.match_score) ||
        right.detection_confidence - left.detection_confidence ||
        left.identity_claim_id.localeCompare(right.identity_claim_id),
    );

export const rawSimilarityLabel = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value.toFixed(3) : 'Not available';
