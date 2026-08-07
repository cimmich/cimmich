import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getCimmichArchiveBackupProof,
  getCimmichArchiveSourceEvidence,
  getCimmichExactDuplicates,
} from './cimmich-archive-integrity.service';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Cimmich Archive integrity client', () => {
  it('reads one bounded exact-duplicate page without a mutation method', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({
        groups: [],
        limit: 24,
        nextOffset: null,
        offset: 48,
        schemaVersion: 'cimmich.archive-integrity.v1',
        summary: {
          copiesInGroups: 131,
          duplicateGroups: 65,
          reclaimableBytes: 4096,
          redundantCopies: 66,
        },
      }),
    );

    const result = await getCimmichExactDuplicates({ limit: 24, offset: 48 });

    expect(result.summary.duplicateGroups).toBe(65);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3101/v1/archive-integrity/exact-duplicates?limit=24&offset=48',
      expect.objectContaining({
        headers: expect.objectContaining({ 'content-type': 'application/json' }),
      }),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBeUndefined();
  });

  it('reads bounded per-copy content and Cimmich evidence', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({
        items: [
          {
            assetId: 'asset-one',
            bodyAssignments: 0,
            contentDigest: 'a'.repeat(64),
            faceAssignments: 2,
            headAssignments: 1,
            people: 2,
            presenceAssignments: 1,
            sourceAssetId: 'source-one',
          },
        ],
        schemaVersion: 'cimmich.archive-integrity.v1',
      }),
    );

    const result = await getCimmichArchiveSourceEvidence(['source-one', 'source-two']);

    expect(result.items[0]?.faceAssignments).toBe(2);
    expect(result.items[0]?.headAssignments).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3101/v1/archive-integrity/source-evidence?sourceAssetIds=source-one%2Csource-two',
      expect.any(Object),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBeUndefined();
  });

  it('reads backup readiness without creating a destination claim', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({
        items: [],
        schemaVersion: 'cimmich.archive-backup-proof.v1',
        summary: {
          byteVerifiedBytes: 647_067_285_586,
          byteVerifiedItems: 119_860,
          independentDestinationCount: 0,
          independentlyProtectedItems: 0,
          maximumSourceSystemsPerItem: 1,
          multipleSourceSystemItems: 0,
          proofState: 'storage_domain_evidence_required',
          sourceSystemCount: 1,
          unprovenItems: 119_860,
        },
      }),
    );

    const result = await getCimmichArchiveBackupProof();

    expect(result.summary.independentlyProtectedItems).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3101/v1/archive-integrity/backup-proof',
      expect.any(Object),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBeUndefined();
  });
});
