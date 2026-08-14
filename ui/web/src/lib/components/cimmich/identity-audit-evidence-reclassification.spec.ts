import { describe, expect, it } from 'vitest';
import {
  identityAuditBodyRegion,
  reclassifyIdentityAuditEvidence,
  type ReclassificationDependencies,
} from './identity-audit-evidence-reclassification';
import type { CimmichPersonReviewItem } from './same-photo-collision-review';

const item = (overrides: Partial<CimmichPersonReviewItem> = {}): CimmichPersonReviewItem => ({
  assetId: 'asset_1',
  assignedPerson: { displayName: 'Maya', personId: 'person_maya', reference: null, score: 0.1 },
  box: { h: 200, w: 100, x: 50, y: 100 },
  captureTime: null,
  currentDecisionId: 'decision_face',
  currentRevision: 3,
  detectionConfidence: 0.9,
  evidenceRoute: 'own_cluster_outlier',
  faceId: 'face_1',
  filename: 'photo.jpg',
  height: 800,
  kind: 'accepted_contradiction',
  margin: 0.1,
  mediaKind: 'image',
  physicalFaceId: 'physical_1',
  qualityMeasurements: {},
  sourceAssetId: 'immich_1',
  suggestedPerson: { displayName: 'Closest support', personId: 'person_maya', reference: null, score: 0.1 },
  width: 400,
  ...overrides,
});

const dependencies = (events: string[], overrides: Partial<ReclassificationDependencies> = {}) =>
  ({
    attachManualTag: () => {
      events.push('attach-body');
      return Promise.resolve({
        assetId: 'asset_1',
        changed: true,
        replayed: false,
        schemaVersion: 'cimmich.typed-manual-subject-tag.v2',
        status: 'applied',
        tag: {
          decision: { decisionId: 'decision_body', state: 'active' },
          geometry: { h: 0.25, w: 0.25, x: 0.125, y: 0.125 },
          observationId: 'body_1',
          provenance: 'manual_user',
          subject: { displayName: 'Maya', subjectId: 'person_maya', subjectKind: 'person' },
          tagId: 'tag_1',
          tagType: 'body',
          undo: { decisionId: 'decision_body', eligible: true },
        },
      });
    },
    createManualTagCommandId: (kind: string) => `manual-tag.${kind}.12345678`,
    createObservationCommandId: (kind: string) => `observation.${kind}.12345678`,
    decideCandidate: () => {
      events.push('reject-candidate');
      return Promise.resolve({} as never);
    },
    dismissAuditItem: () => {
      events.push('dismiss-audit');
      return Promise.resolve({} as never);
    },
    markFaceNotFace: () => {
      events.push('retire-face');
      return Promise.resolve({} as never);
    },
    setFaceBucket: () => {
      events.push('mark-head');
      return Promise.resolve({} as never);
    },
    undoManualTag: () => {
      events.push('undo-body');
      return Promise.resolve({} as never);
    },
    ...overrides,
  }) as ReclassificationDependencies;

describe('identity audit evidence reclassification', () => {
  it('keeps the accepted Person and moves a mistaken Face into Head evidence', async () => {
    const events: string[] = [];

    const result = await reclassifyIdentityAuditEvidence(item(), 'head', dependencies(events));

    expect(events).toEqual(['mark-head', 'dismiss-audit']);
    expect(result).toMatchObject({ evidenceKind: 'head', personId: 'person_maya', reviewFinalized: true });
  });

  it('creates Body evidence from the same box before retiring the mistaken Face', async () => {
    const events: string[] = [];

    const result = await reclassifyIdentityAuditEvidence(item(), 'body', dependencies(events));

    expect(identityAuditBodyRegion(item())).toEqual({ h: 0.25, w: 0.25, x: 0.125, y: 0.125 });
    expect(events).toEqual(['attach-body', 'retire-face', 'dismiss-audit']);
    expect(result).toMatchObject({ evidenceKind: 'body', personId: 'person_maya', reviewFinalized: true });
  });

  it('rejects a stale candidate after preserving the current Person as Head', async () => {
    const events: string[] = [];

    await reclassifyIdentityAuditEvidence(item({ candidateClaimId: 'claim_candidate' }), 'head', dependencies(events));

    expect(events).toEqual(['mark-head', 'reject-candidate']);
  });

  it('undoes the provisional Body tag if retiring the Face fails', async () => {
    const events: string[] = [];
    const failure = new Error('stale Face revision');
    const deps = dependencies(events, {
      markFaceNotFace: () => {
        events.push('retire-face');
        return Promise.reject(failure);
      },
    });

    await expect(reclassifyIdentityAuditEvidence(item(), 'body', deps)).rejects.toBe(failure);
    expect(events).toEqual(['attach-body', 'retire-face', 'undo-body']);
  });
});
