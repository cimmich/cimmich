import { AssetTypeEnum, searchSmart } from '@immich/sdk';
import { getCimmichArchiveSourceEvidence } from '$lib/services/cimmich-archive-integrity.service';
import { getCimmichAssetCorrections } from '$lib/services/cimmich-asset-correction.service';

export const ROTATION_PAGE_SIZE = 24;
export const ROTATION_BACKLOG_LIMIT = 500;
export const ROTATION_MAX_PAGE = Math.ceil(ROTATION_BACKLOG_LIMIT / ROTATION_PAGE_SIZE);
export const ROTATION_VISUAL_QUERY = 'a photo that is sideways or rotated 90 degrees';
const EVIDENCE_BATCH_SIZE = 100;

export type ArchiveRotationBacklog = {
  backlogTotal: number;
  reviewedTotal: number;
  unresolvedAssetIds: string[];
};

const batches = <Value>(values: Value[], size: number) =>
  Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, index * size + size),
  );

export const countArchiveRotationBacklog = async (
  isCurrent: () => boolean = () => true,
): Promise<ArchiveRotationBacklog | null> => {
  const result = await searchSmart({
    smartSearchDto: {
      page: 1,
      query: ROTATION_VISUAL_QUERY,
      size: ROTATION_BACKLOG_LIMIT,
      type: AssetTypeEnum.Image,
    },
  });
  if (!isCurrent()) {
    return null;
  }

  const uniqueSourceIds = [...new Set(result.assets.items.slice(0, ROTATION_BACKLOG_LIMIT).map((asset) => asset.id))];
  const evidencePages = await Promise.all(
    batches(uniqueSourceIds, EVIDENCE_BATCH_SIZE).map((ids) => getCimmichArchiveSourceEvidence(ids)),
  );
  if (!isCurrent()) {
    return null;
  }
  const assetIdsBySource = new Map(
    evidencePages.flatMap((result) => result.items).map((item) => [item.sourceAssetId, item.assetId]),
  );
  const candidateAssetIds = uniqueSourceIds.map(
    (sourceAssetId) => assetIdsBySource.get(sourceAssetId) ?? sourceAssetId,
  );
  const correctionPages = await Promise.all(
    batches([...new Set(candidateAssetIds)], EVIDENCE_BATCH_SIZE).map((ids) => getCimmichAssetCorrections(ids)),
  );
  if (!isCurrent()) {
    return null;
  }
  const reviewedAssetIds = new Set(
    correctionPages
      .flatMap((result) => result.items)
      .filter((item) => item.rotationDecisionId)
      .map((item) => item.assetId),
  );
  const unresolvedAssetIds = candidateAssetIds.filter((assetId) => !reviewedAssetIds.has(assetId));
  return {
    backlogTotal: unresolvedAssetIds.length,
    reviewedTotal: candidateAssetIds.length - unresolvedAssetIds.length,
    unresolvedAssetIds,
  };
};
