import type {
  CimmichFaceOwnerReviewMatch,
  CimmichIdentityAuditItem,
  CimmichIdentityCandidate,
} from '$lib/services/cimmich.service';

export type CimmichPersonReviewItem = CimmichIdentityAuditItem & {
  candidateClaimId?: string;
  candidateEvidence?: {
    detectorConfidence: number;
    matchScore: number | null;
    margin: number | null;
    secondBestScore: number | null;
  };
  currentDecisionId?: string | null;
  currentRevision?: number;
  samePhotoAcceptedCount?: number;
};

export const physicalReviewKey = (item: CimmichPersonReviewItem) => item.physicalFaceId || item.faceId;

export type CimmichSamePhotoCollisionGroup = {
  assetId: string;
  items: CimmichPersonReviewItem[];
};

const comparisonScore = (match: CimmichFaceOwnerReviewMatch | undefined) =>
  match?.similarity ?? match?.prime_score ?? null;

export const currentIdentityComparison = (
  item: CimmichPersonReviewItem,
  matches: CimmichFaceOwnerReviewMatch[],
  disagreementMargin = 0.08,
) => {
  const leader = matches[0];
  const proposed = matches.find(({ person_id }) => person_id === item.suggestedPerson.personId);
  const leaderScore = comparisonScore(leader);
  const proposedScore = comparisonScore(proposed);
  const decisiveDisagreement = Boolean(
    leader &&
    leader.person_id !== item.suggestedPerson.personId &&
    leaderScore !== null &&
    proposedScore !== null &&
    leaderScore - proposedScore >= disagreementMargin,
  );
  return { decisiveDisagreement, leader, leaderScore, proposed, proposedScore };
};

export const retainedCollisionAssetIds = (
  current: string[],
  groups: CimmichSamePhotoCollisionGroup[],
  item: CimmichPersonReviewItem,
) =>
  groups.some(({ assetId, items }) => assetId === item.assetId && items.some(({ faceId }) => faceId === item.faceId)) &&
  !current.includes(item.assetId)
    ? [...current, item.assetId]
    : current;

export const personCandidateReviewItems = (candidates: CimmichIdentityCandidate[]): CimmichPersonReviewItem[] =>
  candidates.map((candidate) => {
    const matchScore = candidate.source_score ?? candidate.calibrated_confidence ?? candidate.match_score ?? null;
    const margin = candidate.source_margin;
    const currentPerson =
      candidate.current_person_id && candidate.current_person_name
        ? {
            displayName: candidate.current_person_name,
            personId: candidate.current_person_id,
            reference: null,
            score: 1,
          }
        : null;
    return {
      assetId: candidate.asset_id,
      assignedPerson: currentPerson,
      box: { h: candidate.box_h, w: candidate.box_w, x: candidate.box_x, y: candidate.box_y },
      candidateClaimId: candidate.identity_claim_id,
      candidateEvidence: {
        detectorConfidence: candidate.detection_confidence,
        margin,
        matchScore,
        // A sole-candidate lead carries margin = score + 1, so a real
        // second-best score exists only when margin does not exceed the winner.
        secondBestScore: matchScore !== null && margin !== null && margin <= matchScore ? matchScore - margin : null,
      },
      captureTime: candidate.capture_time,
      currentDecisionId: candidate.current_decision_id,
      currentRevision: candidate.current_revision,
      detectionConfidence: candidate.detection_confidence,
      faceId: candidate.face_id,
      physicalFaceId: candidate.physical_face_id,
      filename: candidate.filename,
      height: candidate.height,
      kind:
        currentPerson && currentPerson.personId !== candidate.person_id
          ? ('accepted_contradiction' as const)
          : ('untagged_match' as const),
      margin: margin ?? 0,
      mediaKind: candidate.media_kind,
      qualityMeasurements: candidate.quality_measurements,
      samePhotoAcceptedCount: candidate.same_photo_accepted_count ?? 0,
      sourceAssetId: candidate.sourceAssetId,
      suggestedPerson: {
        displayName: candidate.display_name,
        personId: candidate.person_id,
        reference: null,
        score: matchScore ?? 0,
      },
      width: candidate.width,
    };
  });

export const samePhotoCollisionReview = (
  items: CimmichPersonReviewItem[],
  retainedAssetIds: ReadonlySet<string> = new Set(),
) => {
  const byAsset = new Map<string, CimmichPersonReviewItem[]>();
  for (const item of items) {
    if ((byAsset.get(item.assetId) ?? []).some((current) => physicalReviewKey(current) === physicalReviewKey(item))) {
      continue;
    }
    byAsset.set(item.assetId, [...(byAsset.get(item.assetId) ?? []), item]);
  }
  const groups = [...byAsset.entries()]
    .filter(
      ([, assetItems]) =>
        assetItems.length > 1 ||
        retainedAssetIds.has(assetItems[0]?.assetId ?? '') ||
        assetItems.some(({ samePhotoAcceptedCount }) => (samePhotoAcceptedCount ?? 0) > 0),
    )
    .map(([assetId, assetItems]) => ({
      assetId,
      items: [...assetItems].sort((left, right) => right.suggestedPerson.score - left.suggestedPerson.score),
    }))
    .sort(
      (left, right) =>
        right.items.length - left.items.length ||
        (right.items[0]?.suggestedPerson.score ?? 0) - (left.items[0]?.suggestedPerson.score ?? 0),
    );
  return {
    faceIds: new Set(groups.flatMap(({ items: groupItems }) => groupItems.map(({ faceId }) => faceId))),
    groups,
  };
};

export const personIdentityAuditGroups = ({
  auditTotals,
  candidateOnlyItems,
  collisionFaceIds,
  personName,
  reviewItems,
}: {
  auditTotals: Record<'accepted_contradiction' | 'untagged_match', number>;
  candidateOnlyItems: CimmichPersonReviewItem[];
  collisionFaceIds: Set<string>;
  personName: string;
  reviewItems: CimmichPersonReviewItem[];
}) =>
  (['untagged_match', 'accepted_contradiction'] as const).map((kind) => {
    const isNewMatch = kind === 'untagged_match';
    const collisionCount = reviewItems.filter((item) => item.kind === kind && collisionFaceIds.has(item.faceId)).length;
    return {
      description: isNewMatch
        ? `Previously untagged faces the matcher thinks may be ${personName}.`
        : 'Existing identity tags the matcher disputes because it sees a stronger match to a different person.',
      id: isNewMatch ? 'new-matches' : 'possible-mistags',
      items: reviewItems.filter((item) => item.kind === kind && !collisionFaceIds.has(item.faceId)),
      kind,
      title: isNewMatch ? 'New matches' : 'Possible mistags',
      total: Math.max(
        0,
        auditTotals[kind] + candidateOnlyItems.filter((item) => item.kind === kind).length - collisionCount,
      ),
    };
  });

export const personAwaitingCounts = (
  auditTotals: Record<'accepted_contradiction' | 'untagged_match', number>,
  candidateOnlyItems: CimmichPersonReviewItem[],
  machineSuggestionCount: number,
) => {
  const candidates = (kind: CimmichPersonReviewItem['kind']) =>
    candidateOnlyItems.filter((item) => item.kind === kind).length;
  const newMatches = auditTotals.untagged_match + candidates('untagged_match') + machineSuggestionCount;
  const possibleMistags = auditTotals.accepted_contradiction + candidates('accepted_contradiction');
  return { newMatches, possibleMistags, total: newMatches + possibleMistags };
};
