import '@testing-library/jest-dom';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import IdentityAuditPanel from './IdentityAuditPanel.svelte';

const mocks = vi.hoisted(() => ({
  getAudit: vi.fn(),
  getItems: vi.fn(),
  reclassify: vi.fn(),
}));

vi.mock('$lib/components/cimmich/identity-audit-evidence-reclassification', () => ({
  reclassifyIdentityAuditEvidence: mocks.reclassify,
}));

vi.mock('$lib/services/cimmich.service', () => ({
  acceptCimmichMachineSuggestion: vi.fn(),
  dismissCimmichIdentityAuditItem: vi.fn(),
  getCimmichIdentityAudit: mocks.getAudit,
  getCimmichIdentityAuditItems: mocks.getItems,
  startCimmichIdentityAudit: vi.fn(),
}));

describe('IdentityAuditPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('makes bounded independent verification visible to the owner', async () => {
    mocks.getAudit.mockResolvedValue({
      acceptedComparableFaces: 20,
      acceptedEmbeddedFaces: 20,
      auditRunId: 'identity-audit.test',
      completedAt: '2026-08-11T00:00:00.000Z',
      contradictionCandidates: 40,
      contradictionQueriesEligible: 40,
      derivativeCandidatesSuppressed: 0,
      errorCode: null,
      independenceCandidatesEligible: 140,
      independenceCandidatesVerified: 100,
      independenceComparisonLimit: 100,
      independenceProviderConfigDigest: 'a'.repeat(64),
      independenceScoreFloor: 0.75,
      independenceVerificationTruncated: true,
      marginFloor: 0.2,
      packId: 'pack.test',
      policyVersion: 'cimmich-best-prime-v1',
      queryFrontierLimit: 5000,
      queryFrontierTruncated: false,
      schemaVersion: 'cimmich.identity-audit.v2',
      scoreFloor: 0.7,
      stale: false,
      startedAt: '2026-08-10T23:59:00.000Z',
      state: 'completed',
      truncationProjectionComplete: true,
      untaggedCandidates: 100,
      untaggedEmbeddedFaces: 120,
      untaggedQueriesEligible: 120,
    });
    mocks.getItems.mockResolvedValue({
      hasMore: false,
      items: [],
      kind: 'untagged_match',
      limit: 20,
      offset: 0,
      run: null,
      schemaVersion: 'cimmich.identity-audit.v2',
      total: 0,
    });

    const { getByRole } = render(IdentityAuditPanel);

    await waitFor(() => expect(getByRole('status')).toHaveTextContent('Audit coverage needs attention.'));
    expect(getByRole('status')).toHaveTextContent('100 of 140 eligible candidates');
    expect(getByRole('status')).toHaveTextContent('not independently verified');
  });

  it('keeps the assigned Person while offering Face, Head, and Body corrections', async () => {
    mocks.getAudit.mockResolvedValue({
      acceptedComparableFaces: 20,
      acceptedEmbeddedFaces: 20,
      auditRunId: 'identity-audit.corrections',
      completedAt: '2026-08-15T00:00:00.000Z',
      contradictionCandidates: 1,
      contradictionQueriesEligible: 1,
      derivativeCandidatesSuppressed: 0,
      errorCode: null,
      independenceCandidatesEligible: 0,
      independenceCandidatesVerified: 0,
      independenceComparisonLimit: 100,
      independenceProviderConfigDigest: 'b'.repeat(64),
      independenceScoreFloor: 0.75,
      independenceVerificationTruncated: false,
      marginFloor: 0.2,
      packId: 'pack.test',
      policyVersion: 'cimmich-best-prime-v1',
      queryFrontierLimit: 5000,
      queryFrontierTruncated: false,
      schemaVersion: 'cimmich.identity-audit.v2',
      scoreFloor: 0.7,
      stale: false,
      startedAt: '2026-08-14T23:59:00.000Z',
      state: 'completed',
      truncationProjectionComplete: true,
      untaggedCandidates: 0,
      untaggedEmbeddedFaces: 0,
      untaggedQueriesEligible: 0,
    });
    const contradiction = {
      assetId: 'asset-1',
      assignedPerson: {
        displayName: 'Spencer Gilbert',
        personId: 'person-spencer',
        reference: null,
        score: 0.36,
      },
      box: { h: 180, w: 140, x: 20, y: 30 },
      captureTime: null,
      currentDecisionId: 'decision-1',
      currentRevision: 3,
      detectionConfidence: 0.91,
      evidenceRoute: 'cross_person_match' as const,
      faceId: 'face-1',
      physicalFaceId: 'physical-face-1',
      filename: 'photo.jpg',
      height: 800,
      kind: 'accepted_contradiction' as const,
      margin: 0.54,
      mediaKind: 'image' as const,
      qualityMeasurements: {},
      sourceAssetId: 'asset-1',
      suggestedPerson: {
        displayName: '12 guide',
        personId: 'person-guide',
        reference: null,
        score: 0.9,
      },
      width: 1200,
    };
    mocks.getItems.mockImplementation((kind: string) => ({
      hasMore: false,
      items: kind === 'accepted_contradiction' ? [contradiction] : [],
      kind,
      limit: 20,
      offset: 0,
      run: null,
      schemaVersion: 'cimmich.identity-audit.v2',
      total: kind === 'accepted_contradiction' ? 1 : 0,
    }));
    mocks.reclassify.mockResolvedValue({
      evidenceKind: 'head',
      faceId: contradiction.faceId,
      personId: contradiction.assignedPerson.personId,
      reviewFinalized: true,
    });

    const { getByRole, getByText } = render(IdentityAuditPanel);
    await fireEvent.click(await waitFor(() => getByRole('tab', { name: /Tags to double-check 1/ })));

    expect(await waitFor(() => getByText('Keep Spencer Gilbert; this box is'))).toBeInTheDocument();
    expect(getByRole('button', { name: 'Keep Spencer Gilbert as Face' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Keep Spencer Gilbert as Body' })).toBeInTheDocument();

    await fireEvent.click(getByRole('button', { name: 'Keep Spencer Gilbert as Head' }));
    await waitFor(() => expect(mocks.reclassify).toHaveBeenCalledWith(contradiction, 'head'));
  });
});
