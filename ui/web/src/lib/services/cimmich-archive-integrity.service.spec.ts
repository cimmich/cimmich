import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkLatestCimmichDatabaseBackup,
  getCimmichArchiveBackupProof,
  getCimmichArchiveMissingFileScan,
  getCimmichArchiveMissingFiles,
  getCimmichArchiveSourceEvidence,
  getCimmichDatabaseBackupStatus,
  getCimmichExactDuplicates,
  removeAllCimmichArchiveTrashedFiles,
  removeCimmichArchiveMissingFiles,
  setCimmichDatabaseBackupPolicy,
  startCimmichDatabaseBackup,
  startCimmichArchiveMissingFileScan,
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

  it('keeps missing-file reads, catalogue scans and explicit removal on separate routes', async () => {
    const scanStatus = {
      inventory: { schemaVersion: 'cimmich.immich-inventory.v1', source: null },
      scan: { completedAt: null, error: null, scanId: null, startedAt: null, state: 'idle' },
      schemaVersion: 'cimmich.archive-missing-file-scan.v1',
    };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        Response.json({
          items: [],
          schemaVersion: 'cimmich.archive-missing-files.v2',
          summary: { missing: 1, total: 1, trashed: 0 },
        }),
      )
      .mockResolvedValueOnce(Response.json(scanStatus))
      .mockResolvedValueOnce(Response.json({ replayed: false, scan: scanStatus.scan }, { status: 202 }))
      .mockResolvedValueOnce(
        Response.json({
          removedSourceAssetIds: ['source-one'],
          replayed: false,
          schemaVersion: 'cimmich.archive-missing-files.v2',
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          removedSourceAssetIds: ['trash-one', 'trash-two'],
          replayed: false,
          schemaVersion: 'cimmich.archive-missing-files.v2',
        }),
      );

    await getCimmichArchiveMissingFiles({ limit: 25, offset: 50 });
    await getCimmichArchiveMissingFileScan();
    await startCimmichArchiveMissingFileScan();
    await removeCimmichArchiveMissingFiles('immich-primary', ['source-one'], 'archive-missing-command-1');
    await removeAllCimmichArchiveTrashedFiles('cedar-house-archive', 12, 'archive-trash-all-command-1');

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:3101/v1/archive-integrity/missing-files?limit=25&offset=50',
      'http://127.0.0.1:3101/v1/archive-integrity/missing-files/scan',
      'http://127.0.0.1:3101/v1/archive-integrity/missing-files/scan',
      'http://127.0.0.1:3101/v1/archive-integrity/missing-files:remove',
      'http://127.0.0.1:3101/v1/archive-integrity/missing-files:remove',
    ]);
    expect(fetchMock.mock.calls.map(([, options]) => options?.method)).toEqual([
      undefined,
      undefined,
      'POST',
      'POST',
      'POST',
    ]);
    expect(fetchMock.mock.calls.at(-1)?.[1]?.body).toBe(
      JSON.stringify({
        commandId: 'archive-trash-all-command-1',
        expectedCount: 12,
        selection: 'trashed',
        sourceId: 'cedar-house-archive',
      }),
    );
  });

  it('reads and updates database backup health through explicit bounded operations', async () => {
    const status = {
      activeCheck: null,
      activeRun: null,
      destinations: [],
      latestCompletedRun: null,
      nextDueAt: null,
      policy: { destinationIds: [], frequency: 'manual', retentionCount: 3 },
      schemaVersion: 'cimmich.database-backup-health.v1',
    };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(status))
      .mockResolvedValueOnce(Response.json(status))
      .mockResolvedValueOnce(Response.json({ state: 'queued' }, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ state: 'queued' }, { status: 202 }));

    await getCimmichDatabaseBackupStatus();
    await setCimmichDatabaseBackupPolicy({ destinationIds: ['mac'], frequency: 'daily', retentionCount: 3 });
    await startCimmichDatabaseBackup(['mac']);
    await checkLatestCimmichDatabaseBackup(['mac']);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:3101/v1/archive-integrity/database-backups',
      'http://127.0.0.1:3101/v1/archive-integrity/database-backups/policy',
      'http://127.0.0.1:3101/v1/archive-integrity/database-backups/runs',
      'http://127.0.0.1:3101/v1/archive-integrity/database-backups/checks',
    ]);
    expect(fetchMock.mock.calls.map(([, options]) => options?.method)).toEqual([undefined, 'PUT', 'POST', 'POST']);
  });
});
