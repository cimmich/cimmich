import '@testing-library/jest-dom';
import { render, waitFor } from '@testing-library/svelte';
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
});
