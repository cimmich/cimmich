import { getAssetDuplicates } from '@immich/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCimmichArchiveSourceEvidence,
  getCimmichDuplicateStatus,
} from '$lib/services/cimmich-archive-integrity.service';
import {
  CIMMICH_DUPLICATE_CACHE_LIFETIME_MS,
  clearCimmichDuplicateIndicatorCache,
  exactDuplicateIndicator,
  getCimmichDuplicateIndicator,
  possibleVersionIndicator,
} from './duplicate-indicators';

vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal()),
  getAssetDuplicates: vi.fn(),
}));

vi.mock('$lib/services/cimmich-archive-integrity.service', () => ({
  getCimmichArchiveSourceEvidence: vi.fn(),
  getCimmichDuplicateStatus: vi.fn(),
}));

const asset = (id: string) => ({ exifInfo: {}, id, originalFileName: `${id}.jpg` }) as never;

describe('Cimmich duplicate indicators', () => {
  beforeEach(() => {
    clearCimmichDuplicateIndicatorCache();
    vi.mocked(getAssetDuplicates).mockReset();
    vi.mocked(getCimmichDuplicateStatus).mockResolvedValue({ items: [] } as never);
    vi.mocked(getCimmichArchiveSourceEvidence).mockResolvedValue({ items: [] } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('routes verified complete-file copies to exact evidence', () => {
    expect(exactDuplicateIndicator('asset-one', { copyCount: 3 })).toMatchObject({
      classification: 'verified_exact',
      count: 3,
      href: '/cimmich/archive-integrity?assetId=asset-one&mode=exact',
      kind: 'exact',
      label: 'Exact copy · 3 files',
    });
  });

  it('keeps digest-different local similarity honest', () => {
    expect(possibleVersionIndicator('asset-two', 'verified_variant', 2)).toMatchObject({
      classification: 'verified_variant',
      count: 2,
      href: '/cimmich/archive-integrity?assetId=asset-two&mode=variants',
      kind: 'possible_version',
      label: 'Possible version · 2 files',
    });
  });

  it('labels byte-incomplete similarity as possible rather than exact', () => {
    const indicator = possibleVersionIndicator('asset-three', 'similarity_candidate', 4);
    expect(indicator.kind).toBe('possible_version');
    expect(indicator.label).toBe('Possible duplicate · 4 files');
    expect(indicator.reason).toContain('byte evidence is not yet available');
  });

  it('refreshes native groups and cached null indicators after the bounded lifetime', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-17T00:00:00Z'));
    vi.mocked(getAssetDuplicates)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { assets: [asset('asset-one'), asset('asset-two')], duplicateId: 'group-one', suggestedKeepAssetIds: [] },
      ] as never);

    await expect(getCimmichDuplicateIndicator('asset-one')).resolves.toBeNull();
    await expect(getCimmichDuplicateIndicator('asset-one')).resolves.toBeNull();
    expect(getAssetDuplicates).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date(Date.now() + CIMMICH_DUPLICATE_CACHE_LIFETIME_MS + 1));
    await expect(getCimmichDuplicateIndicator('asset-one')).resolves.toMatchObject({
      count: 2,
      kind: 'possible_version',
    });
    expect(getAssetDuplicates).toHaveBeenCalledTimes(2);
  });
});
