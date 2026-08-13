import type { CimmichIdentityCandidate } from '$lib/services/cimmich.service';

const finite = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;

export const hasUsefulCandidateSeparation = (candidate: CimmichIdentityCandidate) =>
  finite(candidate.source_margin) > 0 || candidate.origin === 'cluster_propagation';

const candidateLane = (candidate: CimmichIdentityCandidate) =>
  finite(candidate.source_margin) > 0 ? 0 : candidate.origin === 'cluster_propagation' ? 1 : 2;

export const preparePersonCandidates = (candidates: CimmichIdentityCandidate[]) =>
  candidates
    .filter((candidate) => hasUsefulCandidateSeparation(candidate))
    .slice()
    .sort(
      (left, right) =>
        candidateLane(left) - candidateLane(right) ||
        finite(right.match_score) - finite(left.match_score) ||
        finite(right.source_margin) - finite(left.source_margin) ||
        right.detection_confidence - left.detection_confidence ||
        left.identity_claim_id.localeCompare(right.identity_claim_id),
    )
    .filter(
      (candidate, index, ranked) =>
        ranked.findIndex(
          (other) => (other.physical_face_id || other.face_id) === (candidate.physical_face_id || candidate.face_id),
        ) === index,
    );
