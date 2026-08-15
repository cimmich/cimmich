import { getAssetDuplicates, type DuplicateResponseDto } from '@immich/sdk';
import { Route } from '$lib/route';
import {
  getCimmichArchiveSourceEvidence,
  getCimmichDuplicateStatus,
  type CimmichArchiveSourceEvidence,
  type CimmichDuplicateStatus,
} from '$lib/services/cimmich-archive-integrity.service';
import { buildArchiveVariantGroups, type ArchiveVariantClassification } from './archive-variant-groups';

export type CimmichDuplicateIndicator = {
  classification: 'verified_exact' | Extract<ArchiveVariantClassification, 'similarity_candidate' | 'verified_variant'>;
  count: number;
  href: string;
  kind: 'exact' | 'possible_version';
  label: string;
  reason: string;
  sourceAssetId: string;
};

const indicatorCache = new Map<string, CimmichDuplicateIndicator | null>();
const evidenceCache = new Map<string, CimmichArchiveSourceEvidence | null>();
const pending = new Map<
  string,
  Array<{ reject: (reason?: unknown) => void; resolve: (value: CimmichDuplicateIndicator | null) => void }>
>();
let nativeGroupsPromise: Promise<DuplicateResponseDto[]> | null = null;
let flushScheduled = false;

const nativeGroups = () => {
  nativeGroupsPromise ??= getAssetDuplicates().catch((error) => {
    nativeGroupsPromise = null;
    throw error;
  });
  return nativeGroupsPromise;
};

const chunks = <T>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

export const exactDuplicateIndicator = (
  sourceAssetId: string,
  status: Pick<CimmichDuplicateStatus, 'copyCount'>,
): CimmichDuplicateIndicator => ({
  classification: 'verified_exact',
  count: status.copyCount,
  href: Route.cimmichArchiveIntegrity({ assetId: sourceAssetId, mode: 'exact' }),
  kind: 'exact',
  label: `Exact copy · ${status.copyCount} files`,
  reason: 'Verified complete-file SHA-256 hashes match.',
  sourceAssetId,
});

export const possibleVersionIndicator = (
  sourceAssetId: string,
  classification: Extract<ArchiveVariantClassification, 'similarity_candidate' | 'verified_variant'>,
  count: number,
): CimmichDuplicateIndicator => ({
  classification,
  count,
  href: Route.cimmichArchiveIntegrity({ assetId: sourceAssetId, mode: 'variants' }),
  kind: 'possible_version',
  label: `${classification === 'verified_variant' ? 'Possible version' : 'Possible duplicate'} · ${count} files`,
  reason:
    classification === 'verified_variant'
      ? 'Immich grouped these images as locally similar; Cimmich verified that their complete-file hashes differ.'
      : 'Immich grouped these images as locally similar; complete byte evidence is not yet available for every file.',
  sourceAssetId,
});

const loadEvidence = async (sourceAssetIds: string[]) => {
  const missing = [...new Set(sourceAssetIds)].filter((sourceAssetId) => !evidenceCache.has(sourceAssetId));
  for (const batch of chunks(missing, 80)) {
    if (batch.length === 0) {
      continue;
    }
    const page = await getCimmichArchiveSourceEvidence(batch);
    const found = new Map(page.items.map((item) => [item.sourceAssetId, item]));
    for (const sourceAssetId of batch) {
      evidenceCache.set(sourceAssetId, found.get(sourceAssetId) ?? null);
    }
  }
};

export const loadCimmichDuplicateIndicators = async (sourceAssetIds: string[]) => {
  const requested = [...new Set(sourceAssetIds.filter(Boolean))];
  const exactItems: CimmichDuplicateStatus[] = [];
  for (const batch of chunks(requested, 100)) {
    if (batch.length === 0) {
      continue;
    }
    const page = await getCimmichDuplicateStatus(batch);
    exactItems.push(...page.items);
  }
  const exactByAsset = new Map(exactItems.map((item) => [item.sourceAssetId, item]));
  const result = new Map<string, CimmichDuplicateIndicator | null>();
  for (const sourceAssetId of requested) {
    const exact = exactByAsset.get(sourceAssetId);
    if (exact) {
      result.set(sourceAssetId, exactDuplicateIndicator(sourceAssetId, exact));
    }
  }

  let groups: DuplicateResponseDto[] = [];
  try {
    const allGroups = await nativeGroups();
    const requestedSet = new Set(requested);
    groups = allGroups.filter((group) => group.assets.some((asset) => requestedSet.has(asset.id)));
    await loadEvidence(groups.flatMap((group) => group.assets.map((asset) => asset.id)));
  } catch {
    // Exact byte-copy status remains useful when Immich similarity is unavailable.
  }

  const evidence = [...evidenceCache.values()].filter((item): item is CimmichArchiveSourceEvidence => item !== null);
  for (const group of buildArchiveVariantGroups(groups, evidence)) {
    for (const asset of group.assets) {
      if (!requested.includes(asset.id) || result.has(asset.id)) {
        continue;
      }
      if (group.classification === 'verified_exact') {
        result.set(asset.id, exactDuplicateIndicator(asset.id, { copyCount: group.assets.length }));
      } else {
        result.set(asset.id, possibleVersionIndicator(asset.id, group.classification, group.assets.length));
      }
    }
  }
  for (const sourceAssetId of requested) {
    result.set(sourceAssetId, result.get(sourceAssetId) ?? null);
  }
  return result;
};

const flushPending = async () => {
  flushScheduled = false;
  const current = new Map(pending);
  pending.clear();
  const sourceAssetIds = [...current.keys()];
  try {
    const indicators = await loadCimmichDuplicateIndicators(sourceAssetIds);
    for (const sourceAssetId of sourceAssetIds) {
      const indicator = indicators.get(sourceAssetId) ?? null;
      indicatorCache.set(sourceAssetId, indicator);
      for (const waiter of current.get(sourceAssetId) ?? []) {
        waiter.resolve(indicator);
      }
    }
  } catch (error) {
    for (const waiters of current.values()) {
      for (const waiter of waiters) {
        waiter.reject(error);
      }
    }
  }
};

export const getCimmichDuplicateIndicator = (sourceAssetId: string) => {
  if (indicatorCache.has(sourceAssetId)) {
    return Promise.resolve(indicatorCache.get(sourceAssetId) ?? null);
  }
  const promise = new Promise<CimmichDuplicateIndicator | null>((resolve, reject) => {
    pending.set(sourceAssetId, [...(pending.get(sourceAssetId) ?? []), { reject, resolve }]);
  });
  if (!flushScheduled) {
    flushScheduled = true;
    queueMicrotask(() => void flushPending());
  }
  return promise;
};

export const clearCimmichDuplicateIndicatorCache = () => {
  indicatorCache.clear();
  evidenceCache.clear();
  nativeGroupsPromise = null;
};
