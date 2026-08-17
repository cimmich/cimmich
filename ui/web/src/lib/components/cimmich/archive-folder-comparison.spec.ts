import type { AssetResponseDto } from '@immich/sdk';
import { describe, expect, it } from 'vitest';
import { buildArchiveFolderOverlap } from './archive-folder-comparison';
import type { ArchiveVariantGroup } from './archive-variant-groups';

const asset = (id: string, folder: string): AssetResponseDto =>
  ({ id, originalFileName: `${id}.jpg`, originalPath: `${folder}/${id}.jpg` }) as AssetResponseDto;

const group = (
  duplicateId: string,
  classification: ArchiveVariantGroup['classification'],
  assets: AssetResponseDto[],
): ArchiveVariantGroup =>
  ({
    assets,
    canonicalPlan: { cautions: [], preferredAssetId: null, rankings: new Map(), reasons: [], status: 'hold_ambiguous' },
    classification,
    differences: classification === 'verified_exact' ? [] : ['File size'],
    duplicateId,
    evidence: new Map(),
    suggestedKeepAssetIds: [],
  }) as ArchiveVariantGroup;

describe('buildArchiveFolderOverlap', () => {
  it('separates shared, unique, and same-folder-only photos and aggregates counterpart folders', () => {
    const folder = '/archive/Fbook Download';
    const one = asset('one', folder);
    const two = asset('two', folder);
    const three = asset('three', folder);
    const four = asset('four', folder);
    const fourCopy = asset('four-copy', folder);
    const result = buildArchiveFolderOverlap(
      folder,
      [one, two, three, four, fourCopy],
      [
        group('a', 'verified_variant', [one, asset('palace-one', '/archive/2001 - 15 palace times')]),
        group('b', 'verified_exact', [two, asset('palace-two', '/archive/2001 - 15 palace times')]),
        group('c', 'similarity_candidate', [three, asset('trip-three', '/archive/2002 - Trip')]),
        group('d', 'verified_variant', [four, fourCopy]),
      ],
    );

    expect(result.folderAssetCount).toBe(5);
    expect(result.sharedAssetCount).toBe(3);
    expect(result.matchedElsewhereAssetCount).toBe(3);
    expect(result.uniqueAssets).toEqual([]);
    expect(result.withinFolderOnlyAssets.map((candidate) => candidate.id)).toEqual(['four', 'four-copy']);
    expect(result.sharedFolders[0]).toMatchObject({
      exactGroups: 1,
      folderPath: '/archive/2001 - 15 palace times',
      groupCount: 2,
      outsideAssetCount: 2,
      possibleGroups: 1,
      sharedAssetCount: 2,
    });
  });

  it('does not treat a broad Immich path-search result from a child folder as a direct member', () => {
    const folder = '/archive/Fbook Download';
    const direct = asset('direct', folder);
    const nested = asset('nested', `${folder}/child`);
    const result = buildArchiveFolderOverlap(folder, [direct, nested], []);

    expect(result.folderAssetCount).toBe(1);
    expect(result.uniqueAssets.map((candidate) => candidate.id)).toEqual(['direct']);
  });
});
