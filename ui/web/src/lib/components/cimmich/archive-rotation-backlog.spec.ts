import { beforeEach, describe, expect, it, vi } from 'vitest';
import { countArchiveRotationBacklog, ROTATION_BACKLOG_LIMIT } from './archive-rotation-backlog';

const mocks = vi.hoisted(() => ({
  corrections: vi.fn(),
  searchSmart: vi.fn(),
  sourceEvidence: vi.fn(),
}));

vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/sdk')>()),
  searchSmart: mocks.searchSmart,
}));

vi.mock('$lib/services/cimmich-archive-integrity.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/services/cimmich-archive-integrity.service')>()),
  getCimmichArchiveSourceEvidence: mocks.sourceEvidence,
}));

vi.mock('$lib/services/cimmich-asset-correction.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/services/cimmich-asset-correction.service')>()),
  getCimmichAssetCorrections: mocks.corrections,
}));

const resultPage = (ids: string[], nextPage: number | null) => ({
  assets: { items: ids.map((id) => ({ id })), nextPage, total: 0 },
});

beforeEach(() => {
  mocks.corrections.mockReset();
  mocks.searchSmart.mockReset();
  mocks.sourceEvidence.mockReset();
});

describe('rotation backlog count', () => {
  it('counts the bounded ranked queue and removes reviewed rotation decisions', async () => {
    mocks.searchSmart.mockResolvedValueOnce(resultPage(['source-1', 'source-2', 'source-3'], 2));
    mocks.sourceEvidence.mockResolvedValue({
      items: [
        { assetId: 'asset-1', sourceAssetId: 'source-1' },
        { assetId: 'asset-2', sourceAssetId: 'source-2' },
        { assetId: 'asset-3', sourceAssetId: 'source-3' },
      ],
    });
    mocks.corrections.mockResolvedValue({
      items: [
        { assetId: 'asset-1', rotationDecisionId: null },
        { assetId: 'asset-2', rotationDecisionId: 'decision-2' },
        { assetId: 'asset-3', rotationDecisionId: null },
      ],
    });

    await expect(countArchiveRotationBacklog()).resolves.toEqual({
      backlogTotal: 2,
      reviewedTotal: 1,
      unresolvedAssetIds: ['asset-1', 'asset-3'],
    });
    expect(mocks.searchSmart).toHaveBeenCalledTimes(1);
    expect(mocks.searchSmart).toHaveBeenCalledWith({
      smartSearchDto: expect.objectContaining({ page: 1, size: ROTATION_BACKLOG_LIMIT }),
    });
    expect(mocks.sourceEvidence).toHaveBeenCalledWith(['source-1', 'source-2', 'source-3']);
    expect(mocks.corrections).toHaveBeenCalledWith(['asset-1', 'asset-2', 'asset-3']);
  });

  it('stops before archive evidence work when the count becomes stale', async () => {
    mocks.searchSmart.mockResolvedValueOnce(resultPage(['source-1'], 2));

    await expect(countArchiveRotationBacklog(() => false)).resolves.toBeNull();
    expect(mocks.searchSmart).toHaveBeenCalledTimes(1);
    expect(mocks.sourceEvidence).not.toHaveBeenCalled();
    expect(mocks.corrections).not.toHaveBeenCalled();
  });

  it('checks archive evidence and corrections in batches of 100', async () => {
    const sourceIds = Array.from({ length: 101 }, (_, index) => `source-${index}`);
    mocks.searchSmart.mockResolvedValueOnce(resultPage(sourceIds, null));
    mocks.sourceEvidence.mockImplementation((ids: string[]) => ({
      items: ids.map((sourceAssetId) => ({ assetId: sourceAssetId.replace('source-', 'asset-'), sourceAssetId })),
    }));
    mocks.corrections.mockImplementation((ids: string[]) => ({
      items: ids.map((assetId) => ({ assetId, rotationDecisionId: null })),
    }));

    await expect(countArchiveRotationBacklog()).resolves.toMatchObject({ backlogTotal: 101, reviewedTotal: 0 });
    expect(mocks.sourceEvidence).toHaveBeenCalledTimes(2);
    expect(mocks.corrections).toHaveBeenCalledTimes(2);
  });
});
