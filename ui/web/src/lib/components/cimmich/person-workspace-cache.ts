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
  CimmichPersonPresentation,
} from '$lib/services/cimmich.service';
import type { CimmichKnownPersonClusterSuggestion } from '$lib/services/possible-people.service';

export type CachedPersonWorkspace = {
  assets: CimmichPersonAsset[];
  assetsNextCursor: string | null;
  candidates: CimmichIdentityCandidate[];
  corrections: CimmichIdentityCorrectionDiscovery['items'];
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

export const readPersonWorkspaceCache = <T>(key: string): T | undefined => {
  const entry = personWorkspaceCache.get(key);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAt <= Date.now()) {
    personWorkspaceCache.delete(key);
    return undefined;
  }
  return entry.value as T;
};

export const writePersonWorkspaceCache = <T>(key: string, value: T, ttlMs = 60_000) => {
  personWorkspaceCache.set(key, {
    expiresAt: Date.now() + Math.max(1, ttlMs),
    value,
  });
};

export const clearPersonWorkspaceCache = (key?: string) => {
  if (key) {
    personWorkspaceCache.delete(key);
  } else {
    personWorkspaceCache.clear();
  }
};
