import type { CimmichContextEntity, CimmichPlaceRollupAsset } from '$lib/services/cimmich.service';

export const cimmichPlaceChildCoverAssetId = (
  child: Pick<CimmichContextEntity, 'coverAssetId' | 'entityId'>,
  subtreeAssets: CimmichPlaceRollupAsset[],
) =>
  child.coverAssetId ??
  subtreeAssets.find((asset) => asset.branchEntityIds.includes(child.entityId))?.sourceAssetId ??
  null;
