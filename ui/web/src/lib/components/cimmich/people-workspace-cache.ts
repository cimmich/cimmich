import type {
  CimmichIdentityCandidate,
  CimmichPerson,
  CimmichPersonCandidateSummary,
} from '$lib/services/cimmich.service';

export type CachedPeopleWorkspace = {
  candidateSummary: CimmichPersonCandidateSummary | null;
  candidates: CimmichIdentityCandidate[];
  people: CimmichPerson[];
};

type CacheEntry = {
  expiresAt: number;
  value: CachedPeopleWorkspace;
};

const peopleWorkspaceCache = new Map<string, CacheEntry>();
export const peopleWorkspaceCacheMaximumEntries = 3;
export const peopleWorkspaceCacheTtlMs = 5 * 60_000;

const prunePeopleWorkspaceCache = (now: number) => {
  for (const [key, entry] of peopleWorkspaceCache) {
    if (entry.expiresAt <= now) {
      peopleWorkspaceCache.delete(key);
    }
  }
  while (peopleWorkspaceCache.size > peopleWorkspaceCacheMaximumEntries) {
    peopleWorkspaceCache.delete(peopleWorkspaceCache.keys().next().value!);
  }
};

export const readPeopleWorkspaceCache = (key: string) => {
  const entry = peopleWorkspaceCache.get(key);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAt <= Date.now()) {
    peopleWorkspaceCache.delete(key);
    return undefined;
  }
  peopleWorkspaceCache.delete(key);
  peopleWorkspaceCache.set(key, entry);
  return entry.value;
};

export const writePeopleWorkspaceCache = (
  key: string,
  value: CachedPeopleWorkspace,
  ttlMs = peopleWorkspaceCacheTtlMs,
) => {
  const now = Date.now();
  peopleWorkspaceCache.delete(key);
  peopleWorkspaceCache.set(key, {
    expiresAt: now + Math.max(1, ttlMs),
    value,
  });
  prunePeopleWorkspaceCache(now);
};

export const clearPeopleWorkspaceCache = (key?: string) => {
  if (key) {
    peopleWorkspaceCache.delete(key);
  } else {
    peopleWorkspaceCache.clear();
  }
};
