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
