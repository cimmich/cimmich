import type { AssetResponseDto } from '@immich/sdk';
import { getParentPath } from '$lib/utils/tree-utils';
import type { ArchiveVariantClassification, ArchiveVariantGroup } from './archive-variant-groups';

export type ArchiveFolderComparisonGroup = {
  classification: ArchiveVariantClassification;
  differences: string[];
  duplicateId: string;
  elsewhere: AssetResponseDto[];
  here: AssetResponseDto[];
};

export type ArchiveFolderOverlap = {
  exactGroups: number;
  folderAssetCount: number;
  groups: ArchiveFolderComparisonGroup[];
  matchedElsewhereAssetCount: number;
  possibleGroups: number;
  sharedAssetCount: number;
  sharedFolders: Array<{
    exactGroups: number;
    folderPath: string;
    groupCount: number;
    outsideAssetCount: number;
    possibleGroups: number;
    sharedAssetCount: number;
  }>;
  uniqueAssets: AssetResponseDto[];
  withinFolderOnlyAssets: AssetResponseDto[];
};

const folderOf = (asset: Pick<AssetResponseDto, 'originalPath'>) =>
  asset.originalPath ? getParentPath(asset.originalPath) : '';

export const buildArchiveFolderOverlap = (
  folderPath: string,
  folderAssets: AssetResponseDto[],
  variantGroups: ArchiveVariantGroup[],
): ArchiveFolderOverlap => {
  const exactFolderAssets = folderAssets.filter((asset) => folderOf(asset) === folderPath);
  const sharedAssetIds = new Set<string>();
  const matchedElsewhereAssetIds = new Set<string>();
  const withinFolderOnlyAssetIds = new Set<string>();
  const sharedFolders = new Map<
    string,
    {
      exactGroups: Set<string>;
      groupIds: Set<string>;
      outsideAssetIds: Set<string>;
      possibleGroups: Set<string>;
      sharedAssetIds: Set<string>;
    }
  >();

  const groups = variantGroups.flatMap((group): ArchiveFolderComparisonGroup[] => {
    const here = group.assets.filter((asset) => folderOf(asset) === folderPath);
    if (here.length === 0) {
      return [];
    }
    const elsewhere = group.assets.filter((asset) => folderOf(asset) !== folderPath);
    if (elsewhere.length === 0) {
      for (const asset of here) {
        withinFolderOnlyAssetIds.add(asset.id);
      }
      return [];
    }
    for (const asset of here) {
      sharedAssetIds.add(asset.id);
    }
    for (const asset of elsewhere) {
      matchedElsewhereAssetIds.add(asset.id);
      const outsideFolder = folderOf(asset) || 'Path unavailable';
      const aggregate = sharedFolders.get(outsideFolder) ?? {
        exactGroups: new Set<string>(),
        groupIds: new Set<string>(),
        outsideAssetIds: new Set<string>(),
        possibleGroups: new Set<string>(),
        sharedAssetIds: new Set<string>(),
      };
      aggregate.groupIds.add(group.duplicateId);
      aggregate.outsideAssetIds.add(asset.id);
      for (const shared of here) {
        aggregate.sharedAssetIds.add(shared.id);
      }
      if (group.classification === 'verified_exact') {
        aggregate.exactGroups.add(group.duplicateId);
      } else {
        aggregate.possibleGroups.add(group.duplicateId);
      }
      sharedFolders.set(outsideFolder, aggregate);
    }
    return [
      {
        classification: group.classification,
        differences: group.differences,
        duplicateId: group.duplicateId,
        elsewhere,
        here,
      },
    ];
  });

  return {
    exactGroups: groups.filter((group) => group.classification === 'verified_exact').length,
    folderAssetCount: exactFolderAssets.length,
    groups,
    matchedElsewhereAssetCount: matchedElsewhereAssetIds.size,
    possibleGroups: groups.filter((group) => group.classification !== 'verified_exact').length,
    sharedAssetCount: sharedAssetIds.size,
    sharedFolders: [...sharedFolders.entries()]
      .map(([folderPath, aggregate]) => ({
        exactGroups: aggregate.exactGroups.size,
        folderPath,
        groupCount: aggregate.groupIds.size,
        outsideAssetCount: aggregate.outsideAssetIds.size,
        possibleGroups: aggregate.possibleGroups.size,
        sharedAssetCount: aggregate.sharedAssetIds.size,
      }))
      .sort(
        (left, right) =>
          right.sharedAssetCount - left.sharedAssetCount ||
          right.outsideAssetCount - left.outsideAssetCount ||
          left.folderPath.localeCompare(right.folderPath),
      ),
    uniqueAssets: exactFolderAssets.filter(
      (asset) => !sharedAssetIds.has(asset.id) && !withinFolderOnlyAssetIds.has(asset.id),
    ),
    withinFolderOnlyAssets: exactFolderAssets.filter((asset) => withinFolderOnlyAssetIds.has(asset.id)),
  };
};
