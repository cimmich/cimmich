import '@testing-library/jest-dom';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import CimmichKnownPersonClusters from './CimmichKnownPersonClusters.svelte';

const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));

vi.mock('$lib/services/possible-people.service', () => ({
  resolveCimmichPossiblePerson: mocks.resolve,
}));

vi.mock('$lib/utils', () => ({
  getAssetMediaUrl: ({ id }: { id: string }) => `/asset/${id}`,
}));

const previews = Array.from({ length: 7 }, (_, index) => ({
  box: { h: 0.2, w: 0.2, x: 0.1 + index * 0.01, y: 0.1 },
  faceId: `face-${index + 1}`,
  height: 1000,
  membershipScore: 0.9 - index * 0.01,
  sourceAssetId: `asset-${index + 1}`,
  width: 1200,
}));

const item = {
  clusterId: 'cluster-one',
  evidence: { photoCount: 1927 },
  faceCount: 3166,
  match: {
    classificationVersion: 'known-v1',
    leadScore: 0.83,
    margin: null,
    referenceFaceId: 'reference-face',
    runnerPersonId: null,
    runnerScore: null,
  },
  previews,
  representative: previews[0],
  snapshotDigest: 'a'.repeat(64),
  sourceRevision: 'a'.repeat(64),
};

describe('Known Person grouped proposals', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the clustered Face and moves through seven distinct evidence photos', async () => {
    const { getByLabelText, getByTestId, getByText } = render(CimmichKnownPersonClusters, {
      items: [item],
      personId: 'person-cedar',
      personName: 'Cedar Quinn',
    });

    expect(getByTestId('known-cluster-face-marker')).toHaveClass('border-dotted', 'rounded-full');
    expect(getByText('1 of 7')).toBeInTheDocument();
    expect(getByTestId('known-cluster-preview')).toHaveAttribute(
      'href',
      '/photos/asset-1?cimmichFaceId=face-1&cimmichOverlay=machinery',
    );

    await fireEvent.click(getByLabelText('Next evidence photo for Cedar Quinn'));
    expect(getByText('2 of 7')).toBeInTheDocument();
    expect(getByTestId('known-cluster-preview')).toHaveAttribute(
      'href',
      '/photos/asset-2?cimmichFaceId=face-2&cimmichOverlay=machinery',
    );
  });

  it('requires inline confirmation and records ungroup without identity assignment', async () => {
    mocks.resolve.mockResolvedValue({ changed: true, state: 'ungrouped' });
    const onChanged = vi.fn();
    const { getByRole, getByText } = render(CimmichKnownPersonClusters, {
      items: [item],
      onChanged,
      personId: 'person-cedar',
      personName: 'Cedar Quinn',
    });

    await fireEvent.click(getByRole('button', { name: 'Ungroup…' }));
    expect(getByText(/Reject this exact grouping/)).toBeInTheDocument();
    await fireEvent.click(getByRole('button', { name: 'Ungroup these photos' }));

    await waitFor(() =>
      expect(mocks.resolve).toHaveBeenCalledWith(
        'cluster-one',
        expect.objectContaining({ action: 'ungroup', snapshotDigest: 'a'.repeat(64) }),
      ),
    );
    expect(onChanged).toHaveBeenCalledWith({
      candidateCount: 0,
      clusterId: 'cluster-one',
      collisionAssetCount: 0,
      collisionFaceCount: 0,
      kind: 'ungroup',
    });
  });
});
