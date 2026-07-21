type MachineCandidateNames = {
  candidateName?: string;
  reviewCandidateName?: string;
};

export const projectPrimaryMachineCandidateNames = (
  face: MachineCandidateNames | undefined,
  projectedPrimaryReviewCandidate?: string,
): MachineCandidateNames => ({
  candidateName: face?.candidateName,
  reviewCandidateName: face?.reviewCandidateName || projectedPrimaryReviewCandidate,
});

export const projectBodyIdentityStatus = ({
  displayName,
  linkedFaceId,
}: {
  displayName?: null | string;
  linkedFaceId?: null | string;
}): 'linked' | 'unlinked' => (displayName?.trim() || linkedFaceId?.trim() ? 'linked' : 'unlinked');

export const projectBodyLinkStatus = ({
  displayName,
  geometryLinked,
  linkedFaceId,
}: {
  displayName?: null | string;
  geometryLinked: boolean;
  linkedFaceId?: null | string;
}): 'linked_to_face' | 'linked_to_named_face' | 'linked_to_person' | 'unlinked' => {
  if (linkedFaceId?.trim()) {
    return displayName?.trim() ? 'linked_to_named_face' : 'linked_to_face';
  }
  if (displayName?.trim()) {
    return 'linked_to_person';
  }
  return geometryLinked ? 'linked_to_face' : 'unlinked';
};
