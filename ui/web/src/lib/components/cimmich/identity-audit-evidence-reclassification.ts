import {
  attachCimmichManualSubjectTag,
  bulkAcceptCimmichPersonCandidates,
  bulkRejectCimmichPersonCandidates,
  createCimmichManualSubjectTagCommandId,
  createCimmichObservationCorrectionCommandId,
  decideCimmichIdentityCandidate,
  dismissCimmichIdentityAuditItem,
  dismissCimmichIdentityAuditItemsBatch,
  markCimmichFaceNotFace,
  setCimmichFaceBucket,
  setCimmichFaceIdentitiesBatch,
  undoCimmichManualSubjectTag,
  type CimmichIdentityFace,
  type CimmichIdentityFaceSummary,
} from '$lib/services/cimmich.service';
import type { CimmichPersonReviewItem } from './same-photo-collision-review';

export type CimmichAuditEvidenceKind = 'body' | 'head';
export type CimmichAuditDecisionPresentation = {
  evidenceKind?: CimmichAuditEvidenceKind | 'face';
  refresh?: boolean;
};

export const reconcileCimmichAuditEvidence = (
  faces: CimmichIdentityFace[],
  summary: CimmichIdentityFaceSummary,
  faceId: string,
  evidenceKind?: CimmichAuditDecisionPresentation['evidenceKind'],
): { faces: CimmichIdentityFace[]; summary: CimmichIdentityFaceSummary } => {
  const loadedFace = faces.find(({ face_id }) => face_id === faceId);
  if (evidenceKind === 'face') {
    return { faces, summary };
  }
  if (evidenceKind !== 'head' || !loadedFace) {
    const nextFaces = faces.filter(({ face_id }) => face_id !== faceId);
    if (evidenceKind !== 'body' || !loadedFace) {
      return { faces: nextFaces, summary };
    }
    const previousKey = loadedFace.main_evidence_tier === 'lq' ? 'lowQuality' : loadedFace.main_evidence_tier;
    return {
      faces: nextFaces,
      summary: {
        ...summary,
        all: Math.max(0, summary.all - 1),
        [previousKey]: Math.max(0, summary[previousKey] - 1),
      },
    };
  }
  const previousKey = loadedFace.main_evidence_tier === 'lq' ? 'lowQuality' : loadedFace.main_evidence_tier;
  return {
    faces: faces.map((face) =>
      face.face_id === faceId ? { ...face, main_evidence_tier: 'head', matching_reference_tier: 'head' } : face,
    ),
    summary:
      previousKey === 'head'
        ? summary
        : { ...summary, [previousKey]: Math.max(0, summary[previousKey] - 1), head: summary.head + 1 },
  };
};

export type ReclassificationDependencies = {
  attachManualTag: typeof attachCimmichManualSubjectTag;
  createManualTagCommandId: typeof createCimmichManualSubjectTagCommandId;
  createObservationCommandId: typeof createCimmichObservationCorrectionCommandId;
  decideCandidate: typeof decideCimmichIdentityCandidate;
  dismissAuditItem: typeof dismissCimmichIdentityAuditItem;
  markFaceNotFace: typeof markCimmichFaceNotFace;
  setFaceBucket: typeof setCimmichFaceBucket;
  undoManualTag: typeof undoCimmichManualSubjectTag;
};

const defaultDependencies: ReclassificationDependencies = {
  attachManualTag: attachCimmichManualSubjectTag,
  createManualTagCommandId: createCimmichManualSubjectTagCommandId,
  createObservationCommandId: createCimmichObservationCorrectionCommandId,
  decideCandidate: decideCimmichIdentityCandidate,
  dismissAuditItem: dismissCimmichIdentityAuditItem,
  markFaceNotFace: markCimmichFaceNotFace,
  setFaceBucket: setCimmichFaceBucket,
  undoManualTag: undoCimmichManualSubjectTag,
};

const invalidReclassification = (message: string) => new Error(message);

export const identityAuditBodyRegion = (item: CimmichPersonReviewItem) => {
  if (!(item.width > 0) || !(item.height > 0) || !(item.box.w > 0) || !(item.box.h > 0)) {
    throw invalidReclassification('The photo dimensions are unavailable, so this box cannot be saved as Body.');
  }
  return {
    h: item.box.h / item.height,
    w: item.box.w / item.width,
    x: item.box.x / item.width,
    y: item.box.y / item.height,
  };
};

const finishReviewItem = async (item: CimmichPersonReviewItem, dependencies: ReclassificationDependencies) => {
  try {
    await (item.candidateClaimId
      ? dependencies.decideCandidate(item.candidateClaimId, 'reject')
      : dependencies.dismissAuditItem(item.kind, item.faceId));
    return true;
  } catch {
    // The evidence conversion is authoritative. A refreshed projection drops
    // a retired Face, while a later audit can safely re-offer a Head if its
    // review-row dismissal was interrupted.
    return false;
  }
};

export const reclassifyIdentityAuditEvidence = async (
  item: CimmichPersonReviewItem,
  evidenceKind: CimmichAuditEvidenceKind,
  dependencies: ReclassificationDependencies = defaultDependencies,
) => {
  const assigned = item.assignedPerson;
  if (item.kind !== 'accepted_contradiction' || !assigned?.personId) {
    throw invalidReclassification('Only an accepted Person tag can be kept and reclassified as Head or Body.');
  }

  if (evidenceKind === 'head') {
    await dependencies.setFaceBucket(assigned.personId, item.faceId, 'head');
    return {
      evidenceKind,
      faceId: item.faceId,
      personId: assigned.personId,
      reviewFinalized: await finishReviewItem(item, dependencies),
    };
  }

  if (!Number.isInteger(item.currentRevision) || (item.currentRevision ?? 0) < 1) {
    throw invalidReclassification('Reload this review before saving the region as Body.');
  }

  const attached = await dependencies.attachManualTag(item.assetId, {
    commandId: dependencies.createManualTagCommandId('mistag-face-body'),
    region: identityAuditBodyRegion(item),
    subjectId: assigned.personId,
    subjectKind: 'person',
    tagType: 'body',
  });
  try {
    await dependencies.markFaceNotFace(item.faceId, {
      commandId: dependencies.createObservationCommandId('mistag-face-body'),
      expectedDecisionId: item.currentDecisionId ?? null,
      expectedRevision: item.currentRevision!,
    });
  } catch (error) {
    if (attached.changed && attached.tag.undo.eligible && attached.tag.undo.decisionId) {
      try {
        await dependencies.undoManualTag(
          attached.tag.undo.decisionId,
          dependencies.createManualTagCommandId('mistag-face-body-rollback'),
        );
      } catch {
        // Preserve the original failure. The append-only tag operation remains
        // visible for manual recovery if its compensating undo also fails.
      }
    }
    throw error;
  }

  return {
    evidenceKind,
    faceId: item.faceId,
    personId: assigned.personId,
    reviewFinalized: await finishReviewItem(item, dependencies),
  };
};

export const reclassifyIdentityAuditEvidenceBatch = async (
  items: CimmichPersonReviewItem[],
  evidenceKind: CimmichAuditEvidenceKind,
  onProgress: (completed: number, total: number) => void = () => {},
  concurrency = 4,
) => {
  const queue = [...items];
  const completed: Awaited<ReturnType<typeof reclassifyIdentityAuditEvidence>>[] = [];
  const failures: Array<{ error: string; faceId: string }> = [];
  const total = queue.length;
  const worker = async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) {
        return;
      }
      try {
        completed.push(await reclassifyIdentityAuditEvidence(item, evidenceKind));
      } catch (error) {
        failures.push({
          error: error instanceof Error ? error.message : `Unable to save this region as ${evidenceKind}`,
          faceId: item.faceId,
        });
      }
      onProgress(completed.length + failures.length, total);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, total || 1)) }, worker));
  return { completed, failures };
};

export type CimmichAuditBatchAction = 'accept' | 'body' | 'dismiss' | 'head';

export const decideCimmichIdentityAuditEvidenceBatch = async (
  personId: string,
  items: CimmichPersonReviewItem[],
  action: CimmichAuditBatchAction,
  onProgress: (completed: number, total: number) => void,
) => {
  const completedFaceIds: string[] = [];
  let message = '';
  try {
    if (action === 'head' || action === 'body') {
      const batch = await reclassifyIdentityAuditEvidenceBatch(items, action, onProgress);
      completedFaceIds.push(...batch.completed.map((result) => result.faceId));
      message = `${completedFaceIds.length} selected ${completedFaceIds.length === 1 ? 'region' : 'regions'} kept with the current ${completedFaceIds.length === 1 ? 'Person' : 'People'} and saved as ${action === 'head' ? 'Head' : 'Body'} evidence.`;
      if (batch.failures.length > 0) {
        throw new Error(
          `${batch.failures.length} ${batch.failures.length === 1 ? 'region' : 'regions'} could not be saved: ${batch.failures[0].error}`,
        );
      }
    } else {
      const candidateItems = items.filter((item): item is CimmichPersonReviewItem & { candidateClaimId: string } =>
        Boolean(item.candidateClaimId),
      );
      const auditItems = items.filter((item) => !item.candidateClaimId);
      if (action === 'accept' && candidateItems.length > 0) {
        await bulkAcceptCimmichPersonCandidates(
          personId,
          candidateItems.map((item) => item.candidateClaimId),
        );
        completedFaceIds.push(...candidateItems.map((item) => item.faceId));
        onProgress(completedFaceIds.length, items.length);
      }
      const remainingItems = action === 'accept' ? auditItems : items;
      if (action === 'accept' && remainingItems.length > 0) {
        const batch = await setCimmichFaceIdentitiesBatch(
          remainingItems.map((item) => ({ faceId: item.faceId, personId: item.suggestedPerson.personId })),
        );
        completedFaceIds.push(...batch.assigned.map((result) => result.faceId));
        onProgress(completedFaceIds.length, items.length);
        if (batch.failureCount > 0) {
          throw new Error(
            `${batch.failureCount} ${batch.failureCount === 1 ? 'match' : 'matches'} could not be confirmed: ${batch.failures[0].error}`,
          );
        }
      } else if (action === 'dismiss') {
        const candidates = remainingItems.filter(
          (item): item is CimmichPersonReviewItem & { candidateClaimId: string } => Boolean(item.candidateClaimId),
        );
        const audits = remainingItems.filter((item) => !item.candidateClaimId);
        if (candidates.length > 0) {
          await bulkRejectCimmichPersonCandidates(
            personId,
            candidates.map((item) => item.candidateClaimId),
          );
          completedFaceIds.push(...candidates.map((item) => item.faceId));
          onProgress(completedFaceIds.length, items.length);
        }
        if (audits.length > 0) {
          await dismissCimmichIdentityAuditItemsBatch(audits.map((item) => ({ faceId: item.faceId, kind: item.kind })));
          completedFaceIds.push(...audits.map((item) => item.faceId));
          onProgress(completedFaceIds.length, items.length);
        }
      }
      message =
        action === 'accept'
          ? `${completedFaceIds.length} selected ${completedFaceIds.length === 1 ? 'match' : 'matches'} confirmed.`
          : `${completedFaceIds.length} selected ${completedFaceIds.length === 1 ? 'suggestion' : 'suggestions'} dismissed.`;
    }
    return { completedFaceIds, message };
  } catch (error) {
    return {
      completedFaceIds,
      error: error instanceof Error ? error.message : 'Unable to finish the selected identity decisions',
      message,
    };
  }
};
