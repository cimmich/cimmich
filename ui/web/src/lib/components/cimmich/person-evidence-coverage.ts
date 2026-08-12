import type { CimmichPersonEvidenceCoverage } from '$lib/services/cimmich.service';

export type PersonEvidenceCoverageNote = {
  action: 'identity' | 'photos' | null;
  detail: string;
  kind: 'attention' | 'coverage' | 'ready';
  title: string;
};

export const evidenceCoveragePercent = (observed: number, total: number) =>
  total <= 0 ? 0 : Math.min(100, Math.max(0, Math.round((observed / total) * 100)));

export const evidenceCoverageNotes = (coverage: CimmichPersonEvidenceCoverage): PersonEvidenceCoverageNote[] => {
  const notes: PersonEvidenceCoverageNote[] = [];
  if (coverage.review.futureDates > 0) {
    notes.push({
      action: 'photos',
      detail: `${coverage.review.futureDates.toLocaleString()} accepted ${coverage.review.futureDates === 1 ? 'photo has' : 'photos have'} a capture date after today.`,
      kind: 'attention',
      title: 'Capture dates need review',
    });
  }
  if (coverage.review.candidateFaces > 0) {
    notes.push({
      action: 'identity',
      detail: `${coverage.review.candidateFaces.toLocaleString()} proposed ${coverage.review.candidateFaces === 1 ? 'Face is' : 'Faces are'} still waiting for an owner decision.`,
      kind: 'attention',
      title: 'Identity proposals are waiting',
    });
  }
  if (coverage.observations.body > 0 && coverage.review.bodyWithoutPose > 0) {
    notes.push({
      action: 'identity',
      detail: `${coverage.review.bodyWithoutPose.toLocaleString()} of ${coverage.observations.body.toLocaleString()} accepted Body observations do not yet have persisted pose geometry.`,
      kind: 'coverage',
      title: 'Pose coverage is partial',
    });
  }
  if (coverage.observations.head === 0) {
    notes.push({
      action: 'identity',
      detail:
        'No accepted standalone Head observation is recorded. Head reference buckets can still contain face observations.',
      kind: 'coverage',
      title: 'No standalone Head evidence',
    });
  }
  if (notes.length === 0) {
    notes.push({
      action: null,
      detail: 'Accepted evidence has no current date, proposal, pose, or Head coverage note.',
      kind: 'ready',
      title: 'No immediate coverage note',
    });
  }
  return notes;
};

export const evidenceSourceReason = (source: CimmichPersonEvidenceCoverage['sourceSuggestions'][number]) => {
  const bucket =
    source.bucketKind === 'prime'
      ? 'Core reference'
      : source.bucketKind === 'secondary'
        ? 'Supporting reference'
        : source.bucketKind === 'lq'
          ? 'Low-quality reference'
          : source.bucketKind === 'head'
            ? 'Head evidence'
            : 'Accepted Face';
  const year = source.captureTime ? new Date(source.captureTime).getUTCFullYear() : null;
  return year ? `${bucket} · ${year}` : bucket;
};
