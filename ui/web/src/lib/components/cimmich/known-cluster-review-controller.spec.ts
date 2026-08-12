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
      '24 grouped Faces were moved into Cedar Quinn’s New matches. Nothing was confirmed.',
    );
    expect(loadCandidates).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1200);
    expect(loadCandidates).toHaveBeenCalledOnce();
    expect(setCandidates).toHaveBeenCalledOnce();
    controller.dispose();
    vi.useRealTimers();
  });

  it('explains when a linked group is routed to same-photo review', () => {
    const setMessage = vi.fn();
    const controller = createKnownClusterReviewController({
      current: () => ({ generation: 1, personId: 'person-cedar', personName: 'Cedar Quinn' }),
      loadCandidates: vi.fn(() => Promise.resolve([])),
      removeCluster: vi.fn(),
      setCandidates: vi.fn(),
      setError: vi.fn(),
      setMessage,
    });

    controller.finish({
      candidateCount: 18,
      clusterId: 'cluster-collision',
      collisionAssetCount: 16,
      collisionFaceCount: 17,
      kind: 'review',
    });

    expect(setMessage).toHaveBeenCalledWith(
      '18 grouped Faces were moved into Cedar Quinn’s Checks. 17 appear in 16 photos that already contain Cedar Quinn, so they are under Multiple in one photo. Nothing was confirmed.',
    );
    controller.dispose();
  });
});
