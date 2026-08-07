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

export const getCimmichExactDuplicates = ({ limit = 24, offset = 0 } = {}) => {
  const search = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return request<CimmichExactDuplicatePage>(`/v1/archive-integrity/exact-duplicates?${search.toString()}`);
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
