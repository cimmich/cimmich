import { request } from './cimmich.service';

export type CimmichExactDuplicateCopy = {
  archived: boolean;
  assetId: string;
  captureTime: string | null;
  favorite: boolean;
  filename: string;
  height: number | null;
  mimeType: string | null;
  sourceAssetId: string;
  visibility: 'archive' | 'hidden' | 'locked' | 'timeline';
  width: number | null;
};

export type CimmichExactDuplicateGroup = {
  assetType: 'audio' | 'image' | 'other' | 'video';
  byteLength: number;
  contentDigest: string;
  contentId: string;
  copies: CimmichExactDuplicateCopy[];
  copyCount: number;
  reclaimableBytes: number;
  redundantCopies: number;
};

export type CimmichExactDuplicatePage = {
  groups: CimmichExactDuplicateGroup[];
  limit: number;
  nextOffset: number | null;
  offset: number;
  schemaVersion: 'cimmich.archive-integrity.v1';
  summary: {
    copiesInGroups: number;
    duplicateGroups: number;
    reclaimableBytes: number;
    redundantCopies: number;
  };
};

export type CimmichDuplicateStatus = {
  contentDigest: string;
  contentId: string;
  copyCount: number;
  kind: 'exact' | 'possible_version';
  relatedSourceAssetIds: string[];
  sourceAssetId: string;
};

export type CimmichDuplicateStatusPage = {
  items: CimmichDuplicateStatus[];
  schemaVersion: 'cimmich.archive-integrity.v1';
};

export type CimmichArchiveSourceEvidence = {
  assetId: string;
  bodyAssignments: number;
  contentDigest: string;
  faceAssignments: number;
  headAssignments: number;
  people: number;
  presenceAssignments: number;
  sourceAssetId: string;
};

export type CimmichArchiveSourceEvidencePage = {
  items: CimmichArchiveSourceEvidence[];
  schemaVersion: 'cimmich.archive-integrity.v1';
};

export type CimmichArchiveBackupProofItem = {
  byteLength: number;
  contentDigest: string;
  independentDestinationCount: number;
  proofState: 'storage_domain_evidence_required';
  sourceAssetId: string;
  sourceSystemCount: number;
};

export type CimmichArchiveBackupProofPage = {
  items: CimmichArchiveBackupProofItem[];
  schemaVersion: 'cimmich.archive-backup-proof.v1';
  summary: {
    byteVerifiedBytes: number;
    byteVerifiedItems: number;
    independentDestinationCount: number;
    independentlyProtectedItems: number;
    maximumSourceSystemsPerItem: number;
    multipleSourceSystemItems: number;
    proofState: 'storage_domain_evidence_required';
    sourceSystemCount: number;
    unprovenItems: number;
  };
};

export type CimmichArchiveMissingFile = {
  assetId: string;
  assetType: 'image' | 'video';
  assignments: number;
  captureTime: string | null;
  filename: string;
  lastSeenAt: string | null;
  lastSeenRunId: string;
  people: number;
  sourceAssetId: string;
  sourceId: string;
  state: 'missing' | 'trashed';
};

export type CimmichArchiveMissingFilesPage = {
  items: CimmichArchiveMissingFile[];
  limit: number;
  nextOffset: number | null;
  offset: number;
  schemaVersion: 'cimmich.archive-missing-files.v2';
  summary: {
    missing: number;
    total: number;
    trashed: number;
  };
};

export type CimmichArchiveMissingFileScan = {
  completedAt: string | null;
  error: { code: string; message: string } | null;
  result?: {
    activeAssets: number;
    missingAssets: number;
    runId: string | null;
    suspectedMissingAssets: number;
  };
  scanId: string | null;
  startedAt: string | null;
  state: 'complete' | 'failed' | 'idle' | 'running';
};

export type CimmichArchiveMissingFileScanStatus = {
  inventory: {
    coverage: { complete: boolean; runId: string | null; state: string };
    schemaVersion: 'cimmich.immich-inventory.v1';
    source: {
      activeAssets: number;
      lastCompletedRunId: string | null;
      missingAssets: number;
      processingRunId: string | null;
      sourceId: string;
      state: string;
      suspectedMissingAssets: number;
      unsupportedAssets: number;
    } | null;
  };
  scan: CimmichArchiveMissingFileScan;
  schemaVersion: 'cimmich.archive-missing-file-scan.v1';
};

export type CimmichArchiveBackupTarget = {
  available: boolean;
  distinctFailureDomain: boolean;
  id: string;
  label: string;
  readOnly: true;
  storageDomain: string;
};

export type CimmichArchiveBackupScanItem = {
  archive: null | {
    byteLength: number;
    contentDigest: string;
    fileModifiedAt: string | null;
    filenames: string[];
    sourceAssetIds: string[];
  };
  backup: null | {
    byteLength: number;
    contentDigest: string;
    filename: string;
    modifiedAt: string;
    relativePath: string;
  };
  changes: Array<'content_or_embedded_metadata' | 'filename_ambiguous' | 'modified_time' | 'size'>;
  kind: 'archive_only' | 'backup_only' | 'changed' | 'exact';
};

export type CimmichArchiveBackupScan = {
  completedAt: string | null;
  error: string;
  id: string;
  items: CimmichArchiveBackupScanItem[];
  limit?: number;
  nextOffset?: number | null;
  offset?: number;
  progress: {
    bytesHashed: number;
    filesDiscovered: number;
    filesHashed: number;
    phase: 'comparing' | 'complete' | 'failed' | 'hashing' | 'inventory' | 'queued';
  };
  schemaVersion: 'cimmich.archive-backup-scan.v1';
  startedAt: string;
  status: 'complete' | 'failed' | 'queued' | 'scanning';
  summary: null | {
    archiveItems: number;
    archiveOnlyItems: number;
    backupFiles: number;
    backupOnlyFiles: number;
    changedFiles: number;
    exactItems: number;
    notExactItems: number;
    sizeChangedFiles: number;
  };
  target: CimmichArchiveBackupTarget;
};

export type CimmichDatabaseBackupArtifact = {
  backupRunId: string;
  byteLength: number;
  contentSha256: string;
  createdAt: string;
  databaseSchemaVersion: number;
  destinationId: string;
  filename: string;
  lastError: string;
  storageDomain: string;
  verificationState: 'failed' | 'missing' | 'verified';
  verifiedAt: string;
};

export type CimmichDatabaseBackupDestination = {
  available: boolean;
  description: string;
  distinctFailureDomain: true;
  freeBytes: number | null;
  id: string;
  label: string;
  latest: CimmichDatabaseBackupArtifact | null;
  selected: boolean;
  storageDomain: string;
  writable: boolean;
};

export type CimmichDatabaseBackupOperation = {
  completedAt: string | null;
  destinationIds: string[];
  error?: string;
  items?: Array<{
    destinationId: string;
    error: string;
    state: 'failed' | 'queued' | 'running' | 'verified';
    verifiedAt?: string;
  }>;
  startedAt: string;
  state: 'complete' | 'failed' | 'partial' | 'queued' | 'running';
};

export type CimmichDatabaseBackupStatus = {
  activeCheck: CimmichDatabaseBackupOperation | null;
  activeRun: (CimmichDatabaseBackupOperation & { backupRunId: string; triggerKind: 'manual' | 'scheduled' }) | null;
  destinations: CimmichDatabaseBackupDestination[];
  latestCompletedRun: null | {
    backupRunId: string;
    completedAt: string;
    destinationIds: string[];
    error: string;
    startedAt: string;
    state: 'complete' | 'partial';
    triggerKind: 'manual' | 'scheduled';
  };
  nextDueAt: string | null;
  policy: {
    destinationIds: string[];
    frequency: 'daily' | 'manual' | 'weekly';
    retentionCount: number;
    updatedAt: string;
  };
  schemaVersion: 'cimmich.database-backup-health.v1';
};

export const getCimmichExactDuplicates = ({ limit = 24, offset = 0, sourceAssetId = '' } = {}) => {
  const search = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (sourceAssetId) {
    search.set('sourceAssetId', sourceAssetId);
  }
  return request<CimmichExactDuplicatePage>(`/v1/archive-integrity/exact-duplicates?${search.toString()}`);
};

export const getCimmichDuplicateStatus = (sourceAssetIds: string[]) => {
  const unique = [...new Set(sourceAssetIds.filter(Boolean))].slice(0, 100);
  const search = new URLSearchParams({ sourceAssetIds: unique.join(',') });
  return request<CimmichDuplicateStatusPage>(`/v1/archive-integrity/duplicate-status?${search.toString()}`);
};

export const getCimmichArchiveSourceEvidence = (sourceAssetIds: string[]) => {
  const search = new URLSearchParams({ sourceAssetIds: sourceAssetIds.join(',') });
  return request<CimmichArchiveSourceEvidencePage>(`/v1/archive-integrity/source-evidence?${search.toString()}`);
};

export const getCimmichArchiveBackupProof = (sourceAssetIds: string[] = []) => {
  const search = new URLSearchParams();
  if (sourceAssetIds.length > 0) {
    search.set('sourceAssetIds', sourceAssetIds.join(','));
  }
  const suffix = sourceAssetIds.length > 0 ? `?${search.toString()}` : '';
  return request<CimmichArchiveBackupProofPage>(`/v1/archive-integrity/backup-proof${suffix}`);
};

export const getCimmichArchiveMissingFiles = ({ limit = 50, offset = 0 } = {}) => {
  const search = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return request<CimmichArchiveMissingFilesPage>(`/v1/archive-integrity/missing-files?${search.toString()}`);
};

export const getCimmichArchiveMissingFileScan = () =>
  request<CimmichArchiveMissingFileScanStatus>('/v1/archive-integrity/missing-files/scan');

export const startCimmichArchiveMissingFileScan = () =>
  request<{
    replayed: boolean;
    scan: CimmichArchiveMissingFileScan;
    schemaVersion: 'cimmich.archive-missing-file-scan.v1';
  }>('/v1/archive-integrity/missing-files/scan', { method: 'POST' });

export const removeCimmichArchiveMissingFiles = (sourceId: string, sourceAssetIds: string[], commandId: string) =>
  request<{
    removedSourceAssetIds: string[];
    replayed: boolean;
    schemaVersion: 'cimmich.archive-missing-files.v1';
    sourceId: string;
    tombstonedAssets: number;
  }>('/v1/archive-integrity/missing-files:remove', {
    body: JSON.stringify({ commandId, sourceAssetIds, sourceId }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const removeAllCimmichArchiveTrashedFiles = (sourceId: string, expectedCount: number, commandId: string) =>
  request<{
    removedSourceAssetIds: string[];
    replayed: boolean;
    schemaVersion: 'cimmich.archive-missing-files.v2';
    sourceId: string;
    tombstonedAssets: number;
  }>('/v1/archive-integrity/missing-files:remove', {
    body: JSON.stringify({ commandId, expectedCount, selection: 'trashed', sourceId }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const getCimmichArchiveBackupTargets = () =>
  request<{ items: CimmichArchiveBackupTarget[]; schemaVersion: 'cimmich.archive-backup-scan.v1' }>(
    '/v1/archive-integrity/backup-targets',
  );

export const startCimmichArchiveBackupScan = (targetId: string) =>
  request<CimmichArchiveBackupScan>('/v1/archive-integrity/backup-scans', {
    body: JSON.stringify({ targetId }),
    method: 'POST',
  });

export const getCimmichArchiveBackupScan = (
  id: string,
  { kind = 'all', limit = 100, offset = 0 }: { kind?: string; limit?: number; offset?: number } = {},
) => {
  const search = new URLSearchParams({ kind, limit: String(limit), offset: String(offset) });
  return request<CimmichArchiveBackupScan>(
    `/v1/archive-integrity/backup-scans/${encodeURIComponent(id)}?${search.toString()}`,
  );
};

export const getCimmichDatabaseBackupStatus = () =>
  request<CimmichDatabaseBackupStatus>('/v1/archive-integrity/database-backups');

export const setCimmichDatabaseBackupPolicy = (policy: {
  destinationIds: string[];
  frequency: 'daily' | 'manual' | 'weekly';
  retentionCount: number;
}) =>
  request<CimmichDatabaseBackupStatus>('/v1/archive-integrity/database-backups/policy', {
    body: JSON.stringify(policy),
    method: 'PUT',
  });

export const startCimmichDatabaseBackup = (destinationIds: string[]) =>
  request<CimmichDatabaseBackupOperation>('/v1/archive-integrity/database-backups/runs', {
    body: JSON.stringify({ destinationIds }),
    method: 'POST',
  });

export const checkLatestCimmichDatabaseBackup = (destinationIds: string[]) =>
  request<CimmichDatabaseBackupOperation>('/v1/archive-integrity/database-backups/checks', {
    body: JSON.stringify({ destinationIds }),
    method: 'POST',
  });
