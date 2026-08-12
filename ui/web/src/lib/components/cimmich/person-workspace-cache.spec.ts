import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPersonWorkspaceCache,
  personWorkspaceCacheMaximumEntries,
  personWorkspaceCacheTtlMs,
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

  it('keeps the default workspace warm for a realistic viewer round trip', () => {
    vi.useFakeTimers();
    writePersonWorkspaceCache('person-1:standard', { items: ['face-1'] });

    vi.advanceTimersByTime(5 * 60_000);
    expect(readPersonWorkspaceCache('person-1:standard')).toEqual({ items: ['face-1'] });

    vi.advanceTimersByTime(personWorkspaceCacheTtlMs - 5 * 60_000 + 1);
    expect(readPersonWorkspaceCache('person-1:standard')).toBeUndefined();
  });

  it('expires stale workspace projections', () => {
    vi.useFakeTimers();
    writePersonWorkspaceCache('person-1:standard', { items: ['face-1'] }, 1000);
    vi.advanceTimersByTime(1001);
    expect(readPersonWorkspaceCache('person-1:standard')).toBeUndefined();
  });

  it('prunes least-recently-used workspaces as new People are cached', () => {
    for (let index = 1; index <= personWorkspaceCacheMaximumEntries; index += 1) {
      writePersonWorkspaceCache(`person-${index}:standard`, { index });
    }
    expect(readPersonWorkspaceCache('person-1:standard')).toEqual({ index: 1 });

    writePersonWorkspaceCache('person-new:standard', { index: 99 });

    expect(readPersonWorkspaceCache('person-2:standard')).toBeUndefined();
    expect(readPersonWorkspaceCache('person-1:standard')).toEqual({ index: 1 });
    expect(readPersonWorkspaceCache('person-new:standard')).toEqual({ index: 99 });
  });
});
