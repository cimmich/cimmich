import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPersonWorkspaceCache,
  readPersonWorkspaceCache,
  writePersonWorkspaceCache,
} from './person-workspace-cache';

describe('person workspace cache', () => {
  beforeEach(() => {
    clearPersonWorkspaceCache();
    vi.useRealTimers();
  });

  it('retains a loaded workspace across a viewer route round trip', () => {
    writePersonWorkspaceCache('person-1:standard', { filter: 'candidates', items: ['face-1'] });
    expect(readPersonWorkspaceCache('person-1:standard')).toEqual({ filter: 'candidates', items: ['face-1'] });
  });

  it('expires stale workspace projections', () => {
    vi.useFakeTimers();
    writePersonWorkspaceCache('person-1:standard', { items: ['face-1'] }, 1000);
    vi.advanceTimersByTime(1001);
    expect(readPersonWorkspaceCache('person-1:standard')).toBeUndefined();
  });
});
