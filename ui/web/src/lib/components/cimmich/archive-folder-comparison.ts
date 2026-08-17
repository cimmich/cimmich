import type { AssetResponseDto, DuplicateResponseDto } from '@immich/sdk';
import { getParentPath } from '$lib/utils/tree-utils';
import type { ArchiveCanonicalPlan, ArchiveVariantClassification, ArchiveVariantGroup } from './archive-variant-groups';

export type ArchiveFolderComparisonGroup = {
  canonicalPlan: ArchiveCanonicalPlan;
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

export type ArchiveFolderImpact = {
  affectedAssetCount: number;
  counterpartFolderCount: number;
  duplicateGroupCount: number;
  folderPath: string;
};

const folderOf = (asset: Pick<AssetResponseDto, 'originalPath'>) =>
  asset.originalPath ? getParentPath(asset.originalPath) : '';

export const rankArchiveFoldersByImpact = (
  variantGroups: Pick<DuplicateResponseDto, 'assets'>[],
): ArchiveFolderImpact[] => {
  const folders = new Map<
    string,
    {
      affectedAssetIds: Set<string>;
      counterpartFolders: Set<string>;
      duplicateGroupCount: number;
    }
  >();

  for (const group of variantGroups) {
    const assetsByFolder = new Map<string, AssetResponseDto[]>();
    for (const asset of group.assets) {
      const folderPath = folderOf(asset);
      if (!folderPath) {
        continue;
      }
      assetsByFolder.set(folderPath, [...(assetsByFolder.get(folderPath) ?? []), asset]);
    }
    if (assetsByFolder.size < 2) {
      continue;
    }
    for (const [folderPath, assets] of assetsByFolder) {
      const aggregate = folders.get(folderPath) ?? {
        affectedAssetIds: new Set<string>(),
        counterpartFolders: new Set<string>(),
        duplicateGroupCount: 0,
      };
      for (const asset of assets) {
        aggregate.affectedAssetIds.add(asset.id);
      }
      for (const counterpartFolder of assetsByFolder.keys()) {
        if (counterpartFolder !== folderPath) {
          aggregate.counterpartFolders.add(counterpartFolder);
        }
      }
      aggregate.duplicateGroupCount += 1;
      folders.set(folderPath, aggregate);
    }
  }

  return [...folders.entries()]
    .map(([folderPath, aggregate]) => ({
      affectedAssetCount: aggregate.affectedAssetIds.size,
      counterpartFolderCount: aggregate.counterpartFolders.size,
      duplicateGroupCount: aggregate.duplicateGroupCount,
      folderPath,
    }))
    .sort(
      (left, right) =>
        right.affectedAssetCount - left.affectedAssetCount ||
        right.counterpartFolderCount - left.counterpartFolderCount ||
        right.duplicateGroupCount - left.duplicateGroupCount ||
        left.folderPath.localeCompare(right.folderPath),
    );
};

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
        canonicalPlan: group.canonicalPlan,
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
