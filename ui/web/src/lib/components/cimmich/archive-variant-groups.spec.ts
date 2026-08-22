import type { AssetResponseDto, DuplicateResponseDto } from '@immich/sdk';
import { describe, expect, it } from 'vitest';
import type { CimmichArchiveSourceEvidence } from '$lib/services/cimmich-archive-integrity.service';
import {
  archiveVariantFolderContext,
  archiveVariantGroupsInFolder,
  buildArchiveVariantGroups,
} from './archive-variant-groups';

const asset = (id: string, overrides: Partial<AssetResponseDto> = {}): AssetResponseDto =>
  ({
    checksum: id,
    createdAt: '2025-01-01T00:00:00Z',
    duration: null,
    fileCreatedAt: '2025-01-01T00:00:00Z',
    fileModifiedAt: '2025-01-01T00:00:00Z',
    hasMetadata: true,
    height: 100,
    id,
    isArchived: false,
    isEdited: false,
    isFavorite: false,
    isOffline: false,
    isTrashed: false,
    localDateTime: '2025-01-01T00:00:00Z',
    originalFileName: `${id}.jpg`,
    originalPath: `/fixture/${id}.jpg`,
    ownerId: 'owner',
    thumbhash: null,
    type: 'IMAGE',
    updatedAt: '2025-01-01T00:00:00Z',
    visibility: 'timeline',
    width: 100,
    ...overrides,
  }) as AssetResponseDto;

const evidence = (sourceAssetId: string, contentDigest: string): CimmichArchiveSourceEvidence => ({
  assetId: `asset-${contentDigest}`,
  bodyAssignments: 0,
  contentDigest,
  faceAssignments: 0,
  headAssignments: 0,
  people: 0,
  presenceAssignments: 0,
  sourceAssetId,
});

describe('Archive variant grouping', () => {
  it('reports every other flagged photo in the folder across review groups', () => {
    const current = asset('current', { originalPath: '/library/Cedar/2009/current.jpg' });
    const groups: DuplicateResponseDto[] = [
      {
        assets: [current, asset('counterpart', { originalPath: '/archive/PV/copy.jpg' })],
        duplicateId: 'focused',
        suggestedKeepAssetIds: [],
      },
      {
        assets: [
          asset('other-flagged', { originalPath: '/library/Cedar/2009/other.jpg' }),
          asset('other-copy', { originalPath: '/archive/Phone/other.jpg' }),
        ],
        duplicateId: 'another-group',
        suggestedKeepAssetIds: [],
      },
    ];

    expect(archiveVariantFolderContext(groups, current)).toEqual({
      otherFlaggedHere: 1,
      path: '/library/Cedar/2009',
    });
  });

  it('omits folder context when Immich has no original path', () => {
    const current = asset('current', { originalPath: '' });

    expect(archiveVariantFolderContext([{ assets: [current] }], current)).toBeNull();
  });

  it('keeps an explicit zero when the likely-same group has no folder peer', () => {
    const current = asset('current', { originalPath: '/library/Cedar/2009/current.jpg' });

    expect(archiveVariantFolderContext([{ assets: [current] }], current)).toEqual({
      otherFlaggedHere: 0,
      path: '/library/Cedar/2009',
    });
  });

  it('filters the review to groups with at least one file in the requested folder', () => {
    const matching = { assets: [asset('one', { originalPath: '/library/Cedar/2009/one.jpg' })] };
    const elsewhere = { assets: [asset('two', { originalPath: '/library/Cedar/2010/two.jpg' })] };

    expect(archiveVariantGroupsInFolder([matching, elsewhere], '/library/Cedar/2009')).toEqual([matching]);
  });

  it('separates transformed variants from verified exact bytes and explains copy-local differences', () => {
    const groups: DuplicateResponseDto[] = [
      {
        assets: [
          asset('variant-a', { exifInfo: { fileSizeInByte: 10 }, people: [] }),
          asset('variant-b', {
            exifInfo: { fileSizeInByte: 20 },
            people: [{ id: 'person-one', name: 'Person one' } as never],
          }),
        ],
        duplicateId: 'variant',
        suggestedKeepAssetIds: ['variant-b'],
      },
      {
        assets: [asset('exact-a'), asset('exact-b')],
        duplicateId: 'exact',
        suggestedKeepAssetIds: [],
      },
    ];
    const result = buildArchiveVariantGroups(groups, [
      evidence('variant-a', 'a'.repeat(64)),
      evidence('variant-b', 'b'.repeat(64)),
      evidence('exact-a', 'c'.repeat(64)),
      evidence('exact-b', 'c'.repeat(64)),
    ]);

    expect(result.map((group) => group.classification)).toEqual(['verified_variant', 'verified_exact']);
    expect(result[0]?.differences).toContain('File sizes differ');
    expect(result[0]?.differences).toContain('Immich People differ');
    expect(result[0]?.suggestedKeepAssetIds).toEqual(['variant-b']);
    expect(result[0]?.canonicalPlan.status).toBe('candidate');
    expect(result[0]?.canonicalPlan.preferredAssetId).toBe('variant-b');
    expect(result[0]?.canonicalPlan.reasons).toEqual(['Larger complete file breaks the tie: 20 B versus 10 B.']);
    expect(result[1]?.canonicalPlan.status).toBe('hold_exact');
  });

  it('keeps incomplete byte evidence explicitly candidate-only', () => {
    const [group] = buildArchiveVariantGroups(
      [{ assets: [asset('one'), asset('two')], duplicateId: 'candidate', suggestedKeepAssetIds: [] }],
      [evidence('one', 'd'.repeat(64))],
    );

    expect(group?.classification).toBe('similarity_candidate');
    expect(group?.canonicalPlan.status).toBe('hold_incomplete');
    expect(group?.canonicalPlan.preferredAssetId).toBeNull();
  });

  it('prefers an original capture format before a rendered derivative and explains the caution', () => {
    const [group] = buildArchiveVariantGroups(
      [
        {
          assets: [
            asset('raw', {
              exifInfo: { fileSizeInByte: 26_000_000 },
              height: 160,
              originalFileName: 'DSC_8875.NEF',
              width: 120,
            }),
            asset('rendered', {
              exifInfo: { fileSizeInByte: 4_300_000 },
              height: 6016,
              originalFileName: 'DSC_8875.NEF.jpg',
              width: 4016,
            }),
          ],
          duplicateId: 'raw-rendered',
          suggestedKeepAssetIds: ['rendered'],
        },
      ],
      [evidence('raw', 'a'.repeat(64)), evidence('rendered', 'b'.repeat(64))],
    );

    expect(group?.canonicalPlan.status).toBe('candidate');
    expect(group?.canonicalPlan.preferredAssetId).toBe('raw');
    expect(group?.canonicalPlan.reasons).toEqual(['NEF is an original capture format, which ranks first.']);
    expect(group?.canonicalPlan.cautions).toContain(
      'A rendered companion may still be needed for viewing or intentional edits.',
    );
  });

  it('holds a byte-different tie instead of using filenames or Immich suggested keep IDs', () => {
    const [group] = buildArchiveVariantGroups(
      [
        {
          assets: [asset('same-a'), asset('same-b')],
          duplicateId: 'ambiguous',
          suggestedKeepAssetIds: ['same-b'],
        },
      ],
      [evidence('same-a', 'a'.repeat(64)), evidence('same-b', 'b'.repeat(64))],
    );

    expect(group?.canonicalPlan.status).toBe('hold_ambiguous');
    expect(group?.canonicalPlan.preferredAssetId).toBeNull();
  });
});
