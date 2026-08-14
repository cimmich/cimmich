import { describe, expect, it } from 'vitest';
import {
  isUncertainSplitBatchFailure,
  replaceSplitSelectionWithShown,
  splitSelectionAfterBatch,
} from './person-split-selection';

describe('Person Split selection safety', () => {
  it('replaces a previous hidden group when Select shown is used', () => {
    expect(replaceSplitSelectionWithShown(['face-b', 'face-c', 'face-c'], 100)).toEqual(['face-b', 'face-c']);
    expect(
      replaceSplitSelectionWithShown(
        Array.from({ length: 103 }, (_, index) => `face-${index}`),
        100,
      ),
    ).toHaveLength(100);
  });

  it('retains only explicit failures that are still in the source Person', () => {
    expect(splitSelectionAfterBatch(['face-b', 'face-c'], ['face-a', 'face-c', 'face-c'])).toEqual(['face-c']);
  });

  it('treats transport failures as unknown outcomes instead of safe retries', () => {
    expect(isUncertainSplitBatchFailure('Cimmich service did not respond in time')).toBe(true);
    expect(isUncertainSplitBatchFailure('Failed to fetch')).toBe(true);
    expect(isUncertainSplitBatchFailure('A Cimmich Person already uses this display name')).toBe(false);
  });
});
