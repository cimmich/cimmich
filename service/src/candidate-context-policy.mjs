export const samePhotoAcceptedCandidateFloor = 0.8;

export const candidateSurvivesSamePhotoPrior = ({ score, samePhotoAccepted }) =>
  !samePhotoAccepted ||
  (Number.isFinite(score) && score >= samePhotoAcceptedCandidateFloor);
