import type { AssetResponseDto, DuplicateResponseDto } from '@immich/sdk';
import { describe, expect, it } from 'vitest';
import type { CimmichArchiveSourceEvidence } from '$lib/services/cimmich-archive-integrity.service';
import { buildArchiveVariantGroups } from './archive-variant-groups';

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
  });

  it('keeps incomplete byte evidence explicitly candidate-only', () => {
    const [group] = buildArchiveVariantGroups(
      [{ assets: [asset('one'), asset('two')], duplicateId: 'candidate', suggestedKeepAssetIds: [] }],
      [evidence('one', 'd'.repeat(64))],
    );

    expect(group?.classification).toBe('similarity_candidate');
  });
});
