import { describe, expect, it, vi } from 'vitest';
import { createKnownClusterReviewController } from './known-cluster-review-controller';

describe('known cluster review controller', () => {
  it('acknowledges a committed move immediately and coalesces its queue reload', async () => {
    vi.useFakeTimers();
    const context = { generation: 4, personId: 'person-cedar', personName: 'Cedar Quinn' };
    const loadCandidates = vi.fn(() => Promise.resolve([]));
    const removeCluster = vi.fn();
    const setCandidates = vi.fn();
    const setError = vi.fn();
    const setMessage = vi.fn();
    const controller = createKnownClusterReviewController({
      current: () => context,
      loadCandidates,
      removeCluster,
      setCandidates,
      setError,
      setMessage,
    });

    controller.finish({ candidateCount: 3166, clusterId: 'cluster-large', kind: 'review' });
    controller.finish({ candidateCount: 24, clusterId: 'cluster-next', kind: 'review' });
    expect(removeCluster).toHaveBeenCalledTimes(2);
    expect(setMessage).toHaveBeenLastCalledWith(
      '24 grouped Faces were moved into Cedar Quinn’s Checks. Nothing was confirmed.',
    );
    expect(loadCandidates).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1200);
    expect(loadCandidates).toHaveBeenCalledOnce();
    expect(setCandidates).toHaveBeenCalledOnce();
    controller.dispose();
    vi.useRealTimers();
  });
});
