import type {
  CimmichIdentityAuditItem,
  CimmichIdentityCandidate,
  CimmichIdentityCorrectionDiscovery,
  CimmichIdentityFace,
  CimmichIdentityFaceSummary,
  CimmichExploreFacetResult,
  CimmichMachineSuggestion,
  CimmichPerson,
  CimmichPersonAsset,
  CimmichPersonEvidenceCoverage,
  CimmichPersonPresentation,
} from '$lib/services/cimmich.service';
import type { CimmichKnownPersonClusterSuggestion } from '$lib/services/possible-people.service';
import type { CimmichPersonAppearanceAssets } from './person-identity-workspace';

export type CachedPersonWorkspace = {
  assets: CimmichPersonAsset[];
  assetsNextCursor: string | null;
  appearanceAssets: CimmichPersonAppearanceAssets;
  appearanceLoaded: boolean;
  candidates: CimmichIdentityCandidate[];
  corrections: CimmichIdentityCorrectionDiscovery['items'];
  evidenceCoverage?: CimmichPersonEvidenceCoverage;
  exploreFilterKey: string;
  exploreResult: CimmichExploreFacetResult | null;
  identityAuditItems: CimmichIdentityAuditItem[];
  identityAuditTotals: Record<CimmichIdentityAuditItem['kind'], number>;
  identityFaces: CimmichIdentityFace[];
  identityFaceSummary: CimmichIdentityFaceSummary;
  identityNextCursor: string | null;
  identityLoaded: boolean;
  knownClusterSuggestions: CimmichKnownPersonClusterSuggestion[];
  machineSuggestions: CimmichMachineSuggestion[];
  person: CimmichPerson;
  presentation?: CimmichPersonPresentation;
  setupPeople: CimmichPerson[];
};

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

const personWorkspaceCache = new Map<string, CacheEntry>();
export const personWorkspaceCacheMaximumEntries = 6;
export const personWorkspaceCacheTtlMs = 10 * 60_000;

const prunePersonWorkspaceCache = (now: number) => {
  for (const [key, entry] of personWorkspaceCache) {
    if (entry.expiresAt <= now) {
      personWorkspaceCache.delete(key);
    }
  }
  while (personWorkspaceCache.size > personWorkspaceCacheMaximumEntries) {
    personWorkspaceCache.delete(personWorkspaceCache.keys().next().value!);
  }
};

export const readPersonWorkspaceCache = <T>(key: string): T | undefined => {
  const entry = personWorkspaceCache.get(key);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAt <= Date.now()) {
    personWorkspaceCache.delete(key);
    return undefined;
  }
  personWorkspaceCache.delete(key);
  personWorkspaceCache.set(key, entry);
  return entry.value as T;
};

export const writePersonWorkspaceCache = <T>(key: string, value: T, ttlMs = personWorkspaceCacheTtlMs) => {
  const now = Date.now();
  personWorkspaceCache.delete(key);
  personWorkspaceCache.set(key, {
    expiresAt: now + Math.max(1, ttlMs),
    value,
  });
  prunePersonWorkspaceCache(now);
};

export const clearPersonWorkspaceCache = (key?: string) => {
  if (key) {
    personWorkspaceCache.delete(key);
  } else {
    personWorkspaceCache.clear();
  }
};
