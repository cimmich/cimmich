import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCimmichAssetCorrectionForSource } from './cimmich-asset-correction.service';

describe('Cimmich asset correction source bridge', () => {
  afterEach(() => vi.restoreAllMocks());

  it('resolves an Immich source asset before reading its saved presentation rotation', async () => {
    const correction = {
      assetId: 'asset-content-1',
      captureTime: null,
      captureTimeProvenance: 'source_metadata' as const,
      correctionDecisionIds: ['decision-1'],
      filename: 'sideways.jpg',
      location: null,
      originalCaptureTime: null,
      rotationDecisionId: 'decision-1',
      rotationQuarterTurns: 3,
      schemaVersion: 'cimmich.asset-correction.v1' as const,
      sourceAssetId: 'source/asset-1',
    };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ assetId: 'asset-content-1', sourceAssetId: 'source/asset-1' }))
      .mockResolvedValueOnce(Response.json({ items: [correction], schemaVersion: 'cimmich.asset-correction.v1' }));

    await expect(getCimmichAssetCorrectionForSource('source/asset-1')).resolves.toEqual(correction);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/v1/assets/display?sourceAssetId=source%2Fasset-1');
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      body: JSON.stringify({ assetIds: ['asset-content-1'] }),
      method: 'POST',
    });
  });
});
