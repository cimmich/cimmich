import { getAssetInfo, type AssetResponseDto } from '@immich/sdk';
import {
  getCimmichAssetCorrections,
  rotateCimmichAssets,
  undoCimmichAssetCorrections,
  type CimmichAssetCorrectionDetails,
} from '$lib/services/cimmich-asset-correction.service';

export type CimmichPhotoReviewContext = CimmichAssetCorrectionDetails & {
  importedLocationLabel?: string;
};

const dateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' });

export const cimmichImportedLocationLabel = (asset?: AssetResponseDto | null) => {
  const exif = asset?.exifInfo;
  return (
    [exif?.city, exif?.state, exif?.country].find((value) => typeof value === 'string' && value.trim())?.trim() ?? ''
  );
};

export const cimmichPhotoReviewContextLabel = (
  context: Pick<CimmichPhotoReviewContext, 'captureTime' | 'importedLocationLabel' | 'location'> | undefined,
  fallbackCaptureTime?: string | null,
) => {
  const rawDate = context?.captureTime || fallbackCaptureTime;
  const date = rawDate ? new Date(rawDate) : null;
  const dateLabel = date && !Number.isNaN(date.getTime()) ? dateFormatter.format(date) : '';
  const locationLabel = context?.location?.label || context?.importedLocationLabel || '';
  return [dateLabel, locationLabel].filter(Boolean).join(' · ');
};

export const loadImportedLocations = async (
  items: CimmichPhotoReviewContext[],
  getAsset: (sourceAssetId: string) => Promise<AssetResponseDto>,
  concurrency = 6,
) => {
  const pending = items.filter((item) => !item.location && item.sourceAssetId);
  const results = new Map<string, string>();
  let next = 0;
  const worker = async () => {
    while (next < pending.length) {
      const item = pending[next++];
      try {
        const label = cimmichImportedLocationLabel(await getAsset(item.sourceAssetId));
        if (label) {
          results.set(item.assetId, label);
        }
      } catch {
        // A missing Immich read must not hide Cimmich review evidence.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
  return results;
};

const mergeContexts = (current: Record<string, CimmichPhotoReviewContext>, items: CimmichAssetCorrectionDetails[]) => ({
  ...current,
  ...Object.fromEntries(items.map((item) => [item.assetId, { ...current[item.assetId], ...item }])),
});

export const loadCimmichPhotoReviewContexts = async (
  assetIds: string[],
  current: Record<string, CimmichPhotoReviewContext>,
) => {
  const uniqueIds = [...new Set(assetIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return current;
  }
  const response = await getCimmichAssetCorrections(uniqueIds.slice(0, 100));
  let next = mergeContexts(current, response.items);
  const imported = await loadImportedLocations(response.items, (sourceAssetId) => getAssetInfo({ id: sourceAssetId }));
  if (imported.size > 0) {
    next = {
      ...next,
      ...Object.fromEntries(
        [...imported].map(([assetId, importedLocationLabel]) => [assetId, { ...next[assetId], importedLocationLabel }]),
      ),
    };
  }
  return next;
};

export const rotateCimmichPhotoReviewContext = async (
  assetId: string,
  direction: 'left' | 'right',
  current: Record<string, CimmichPhotoReviewContext>,
) => {
  const result = await rotateCimmichAssets([assetId], direction);
  return mergeContexts(current, result.items ?? []);
};

export const undoCimmichPhotoReviewRotation = async (
  decisionId: string,
  current: Record<string, CimmichPhotoReviewContext>,
) => {
  const result = await undoCimmichAssetCorrections([decisionId]);
  return mergeContexts(current, result.items ?? []);
};
