import '@testing-library/jest-dom';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cimmichVisibilityManager } from '$lib/managers/cimmich-visibility-manager.svelte';
import CimmichAppearancesPanel from './CimmichAppearancesPanel.svelte';

const mocks = vi.hoisted(() => ({ getEvidence: vi.fn() }));

vi.mock('$lib/services/cimmich-evidence.service', () => ({
  getCimmichEvidenceForAsset: mocks.getEvidence,
}));

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => (resolve = next));
  return { promise, resolve };
};

describe('CimmichAppearancesPanel visibility projection', () => {
  beforeEach(() => {
    cimmichVisibilityManager.version = 0;
    mocks.getEvidence.mockReset();
  });

  it('clears immediately and ignores a stale higher-rank response after visibility changes', async () => {
    const higherRank = deferred<unknown>();
    mocks.getEvidence
      .mockReturnValueOnce(higherRank.promise)
      .mockResolvedValueOnce({ bundle: undefined, evidence: undefined, matchedFilename: 'visible.jpg' });

    const { findByText, queryByText } = render(CimmichAppearancesPanel, {
      asset: { id: 'asset-1', originalFileName: 'visible.jpg' } as never,
    });
    await waitFor(() => expect(mocks.getEvidence).toHaveBeenCalledTimes(1));

    cimmichVisibilityManager.notify();
    expect(await findByText('No Cimmich evidence found')).toBeInTheDocument();

    higherRank.resolve({
      bundle: undefined,
      evidence: {
        packetItems: [],
        stateRows: [],
        summary: {
          bodyContextPeople: [],
          candidatePeople: [],
          localDescription: 'Stale Personal-mode evidence',
          sourcePeople: ['Private Person'],
        },
      },
      matchedFilename: 'private.jpg',
    });
    await Promise.resolve();

    expect(queryByText('Private Person')).not.toBeInTheDocument();
    expect(queryByText('Stale Personal-mode evidence')).not.toBeInTheDocument();
  });

  it('uses the same Body label as the tagging and Identity surfaces', async () => {
    mocks.getEvidence.mockResolvedValue({
      bundle: undefined,
      evidence: {
        packetItems: [],
        stateRows: [],
        summary: {
          bodyContextPeople: ['Maya Chen'],
          candidatePeople: [],
          faceBucketCounts: {},
          sourcePeople: [],
          strongCandidatePeople: [],
        },
      },
      matchedFilename: 'visible.jpg',
    });

    const { findByText, queryByText } = render(CimmichAppearancesPanel, {
      asset: { id: 'asset-1', originalFileName: 'visible.jpg' } as never,
    });

    expect(await findByText('Body')).toBeInTheDocument();
    expect(queryByText('Body-linked')).not.toBeInTheDocument();
  });

  it('lets the owner retry a failed evidence request in place', async () => {
    mocks.getEvidence.mockRejectedValueOnce(new Error('Evidence is temporarily unavailable')).mockResolvedValueOnce({
      bundle: undefined,
      evidence: {
        packetItems: [],
        stateRows: [],
        summary: { bodyContextPeople: [], candidatePeople: [], localDescription: 'Recovered', sourcePeople: [] },
      },
      matchedFilename: 'visible.jpg',
    });

    const rendered = render(CimmichAppearancesPanel, {
      asset: { id: 'asset-1', originalFileName: 'visible.jpg' } as never,
    });

    expect(await rendered.findByRole('alert')).toHaveTextContent('Evidence is temporarily unavailable');
    await fireEvent.click(rendered.getByRole('button', { name: 'Try again' }));

    expect(await rendered.findByText('Recovered')).toBeInTheDocument();
    expect(mocks.getEvidence).toHaveBeenCalledTimes(2);
    expect(rendered.queryByRole('alert')).not.toBeInTheDocument();
  });
});
