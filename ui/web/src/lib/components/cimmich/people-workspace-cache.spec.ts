import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPeopleWorkspaceCache,
  peopleWorkspaceCacheMaximumEntries,
  readPeopleWorkspaceCache,
  writePeopleWorkspaceCache,
} from './people-workspace-cache';

const workspace = (personId: string) => ({
  candidateSummary: null,
  candidates: [],
  people: [{ person_id: personId } as never],
});

describe('people workspace cache', () => {
  beforeEach(() => {
    clearPeopleWorkspaceCache();
    vi.useRealTimers();
  });

  it('retains the People grid across a person route round trip', () => {
    writePeopleWorkspaceCache('standard', workspace('person-1'));
    expect(readPeopleWorkspaceCache('standard')).toEqual(workspace('person-1'));
  });

  it('keeps visibility projections isolated', () => {
    writePeopleWorkspaceCache('standard', workspace('public-person'));
    writePeopleWorkspaceCache('private', workspace('private-person'));

    expect(readPeopleWorkspaceCache('standard')).toEqual(workspace('public-person'));
    expect(readPeopleWorkspaceCache('private')).toEqual(workspace('private-person'));
  });

  it('expires stale projections', () => {
    vi.useFakeTimers();
    writePeopleWorkspaceCache('standard', workspace('person-1'), 1000);
    vi.advanceTimersByTime(1001);
    expect(readPeopleWorkspaceCache('standard')).toBeUndefined();
  });

  it('prunes least-recently-used visibility projections', () => {
    for (let index = 1; index <= peopleWorkspaceCacheMaximumEntries; index += 1) {
      writePeopleWorkspaceCache(`mode-${index}`, workspace(`person-${index}`));
    }
    expect(readPeopleWorkspaceCache('mode-1')).toEqual(workspace('person-1'));

    writePeopleWorkspaceCache('mode-new', workspace('person-new'));

    expect(readPeopleWorkspaceCache('mode-2')).toBeUndefined();
    expect(readPeopleWorkspaceCache('mode-1')).toEqual(workspace('person-1'));
  });
});
