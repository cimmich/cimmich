import type { AssetResponseDto } from '@immich/sdk';
import type { CimmichContextEntity } from '$lib/services/cimmich.service';

const normalizeSlashes = (value: string) =>
  value
    .trim()
    .replaceAll('\\', '/')
    .replaceAll(/\/{2,}/g, '/');

export const eventAssetFolder = (asset: Pick<AssetResponseDto, 'originalPath'>) => {
  const path = normalizeSlashes(asset.originalPath || '').replaceAll(/\/$/g, '');
  const boundary = path.lastIndexOf('/');
  return boundary > 0 ? path.slice(0, boundary) : boundary === 0 ? '/' : '';
};

export const eventFolderLabel = (path: string) => {
  const normalized = normalizeSlashes(path).replaceAll(/\/$/g, '');
  return normalized.split('/').findLast(Boolean) || normalized || 'Folder';
};

export const eventAssetBelongsToFolder = (asset: Pick<AssetResponseDto, 'originalPath'>, folderPath: string) => {
  const assetFolder = eventAssetFolder(asset);
  const folder = normalizeSlashes(folderPath).replaceAll(/\/$/g, '');
  return assetFolder === folder || assetFolder.startsWith(`${folder}/`);
};

export type EventFolderCandidate = { assetCount: number; label: string; path: string };

// Immich-managed uploads use content-addressed storage paths such as
// /data/upload/<library UUID>/<hash>/<hash>. They are implementation details,
// not folders a person organised, so presenting them as Event sources creates
// a wall of meaningless hexadecimal names. External-library paths remain
// available unchanged.
export const isMeaningfulEventFolder = (path: string) => {
  const normalized = normalizeSlashes(path).toLowerCase();
  return !/(?:^|\/)upload\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\/|$)/.test(
    normalized,
  );
};

export const eventFolderCandidates = (assets: Array<Pick<AssetResponseDto, 'originalPath'>>) => {
  const counts = new Map<string, number>();
  for (const asset of assets) {
    const path = eventAssetFolder(asset);
    if (path && isMeaningfulEventFolder(path)) {
      counts.set(path, (counts.get(path) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([path, assetCount]) => ({ assetCount, label: eventFolderLabel(path), path }))
    .sort((left, right) => left.label.localeCompare(right.label) || left.path.localeCompare(right.path));
};

export const eventLineage = (entity: CimmichContextEntity, entities: CimmichContextEntity[]) => {
  const byId = new Map(entities.map((candidate) => [candidate.entityId, candidate]));
  const lineage = [entity];
  const visited = new Set([entity.entityId]);
  let parent = entity.parentEntityId ? byId.get(entity.parentEntityId) : undefined;
  while (parent && !visited.has(parent.entityId) && lineage.length < 12) {
    lineage.unshift(parent);
    visited.add(parent.entityId);
    parent = parent.parentEntityId ? byId.get(parent.parentEntityId) : undefined;
  }
  return lineage;
};

export const eventCopyName = (name: string) => `${name.trim()} — another`;
