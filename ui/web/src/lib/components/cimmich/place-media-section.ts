import type { CimmichContextEntity } from '$lib/services/cimmich.service';

export const cimmichPlaceAssetSectionNames = (
  asset: { branchEntityIds?: unknown },
  children: Array<Pick<CimmichContextEntity, 'displayName' | 'entityId'>>,
) => {
  const branchEntityIds = Array.isArray(asset.branchEntityIds)
    ? asset.branchEntityIds.filter((entityId): entityId is string => typeof entityId === 'string')
    : [];
  return children.filter((child) => branchEntityIds.includes(child.entityId)).map((child) => child.displayName);
};
