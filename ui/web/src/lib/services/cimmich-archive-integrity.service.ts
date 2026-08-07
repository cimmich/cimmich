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

export const getCimmichExactDuplicates = ({ limit = 24, offset = 0 } = {}) => {
  const search = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return request<CimmichExactDuplicatePage>(`/v1/archive-integrity/exact-duplicates?${search.toString()}`);
};
