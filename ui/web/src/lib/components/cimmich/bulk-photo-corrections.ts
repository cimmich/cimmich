import {
  getCimmichVisibleMapAssetBindings,
  rotateCimmichAssets,
  undoCimmichAssetCorrections,
} from '$lib/services/cimmich.service';
import { BULK_PHOTO_SORTER_BATCH_SIZE, chunkBulkPhotoSorterItems } from './bulk-photo-sorter';

export const applyBulkPhotoRotation = async (
  sourceAssetIds: string[],
  direction: 'left' | 'right',
  onBatch: (assetIds: string[], decisionIds: string[]) => void,
  onProgress: (completed: number, total: number) => void,
) => {
  const bindings = await getCimmichVisibleMapAssetBindings(sourceAssetIds);
  const assetIds = sourceAssetIds.flatMap((id) => bindings.get(id) ?? []);
  let applied = 0;
  for (const batch of chunkBulkPhotoSorterItems(assetIds)) {
    const result = await rotateCimmichAssets(batch, direction);
    const decisionIds = result.decisionIds ?? [];
    onBatch(batch, decisionIds);
    applied += batch.length;
    onProgress(applied, assetIds.length);
  }
  return { applied, assetIds };
};

export const undoBulkPhotoRotation = async (decisionIds: string[], onBatch: (decisionIds: string[]) => void) => {
  for (const batch of chunkBulkPhotoSorterItems(decisionIds, BULK_PHOTO_SORTER_BATCH_SIZE)) {
    await undoCimmichAssetCorrections(batch);
    onBatch(batch);
  }
};
