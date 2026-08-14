import {
  attachCimmichManualSubjectTag,
  createCimmichManualSubjectTagCommandId,
  createCimmichObservationCorrectionCommandId,
  decideCimmichIdentityCandidate,
  dismissCimmichIdentityAuditItem,
  markCimmichFaceNotFace,
  setCimmichFaceBucket,
  undoCimmichManualSubjectTag,
} from '$lib/services/cimmich.service';
import type { CimmichPersonReviewItem } from './same-photo-collision-review';

export type CimmichAuditEvidenceKind = 'body' | 'head';

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
