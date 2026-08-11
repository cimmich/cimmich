import '@testing-library/jest-dom';
import { render, waitFor } from '@testing-library/svelte';
import IdentityAuditPanel from './IdentityAuditPanel.svelte';

const mocks = vi.hoisted(() => ({
  getAudit: vi.fn(),
  getItems: vi.fn(),
}));

vi.mock('$lib/services/cimmich.service', () => ({
  acceptCimmichMachineSuggestion: vi.fn(),
  dismissCimmichIdentityAuditItem: vi.fn(),
  getCimmichIdentityAudit: mocks.getAudit,
  getCimmichIdentityAuditItems: mocks.getItems,
  startCimmichIdentityAudit: vi.fn(),
}));

describe('IdentityAuditPanel', () => {
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
});
