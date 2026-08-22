export type ArchiveHealthMode = 'exact' | 'variants' | 'folder' | 'rotation' | 'backup' | 'missing';

export const archiveHealthMode = (requestedMode: string | null, folder: string): ArchiveHealthMode => {
  if (requestedMode === 'folder' || (requestedMode === 'variants' && folder)) {
    return 'folder';
  }
  if (requestedMode === 'variants' || requestedMode === 'plan') {
    return 'variants';
  }
  if (requestedMode === 'rotation') {
    return 'rotation';
  }
  if (requestedMode === 'backup') {
    return 'backup';
  }
  if (requestedMode === 'missing') {
    return 'missing';
  }
  return 'exact';
};
