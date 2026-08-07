import type { AssetResponseDto, DuplicateResponseDto } from '@immich/sdk';
import type { CimmichArchiveSourceEvidence } from '$lib/services/cimmich-archive-integrity.service';

export type ArchiveVariantClassification = 'verified_exact' | 'verified_variant' | 'similarity_candidate';

export type ArchiveVariantGroup = DuplicateResponseDto & {
  classification: ArchiveVariantClassification;
  differences: string[];
  evidence: Map<string, CimmichArchiveSourceEvidence>;
};

const normalized = (value: unknown) => {
  if (value === undefined) {
    return '__missing__';
  }
  if (value === null) {
    return '__null__';
  }
  if (Array.isArray(value)) {
    return JSON.stringify([...value].sort());
  }
  return String(value);
};

const differs = (assets: AssetResponseDto[], read: (asset: AssetResponseDto) => unknown) =>
  new Set(assets.map((asset) => normalized(read(asset)))).size > 1;

const evidenceSignature = (evidence: CimmichArchiveSourceEvidence | undefined) =>
  evidence
    ? [
        evidence.people,
        evidence.faceAssignments,
        evidence.headAssignments,
        evidence.bodyAssignments,
        evidence.presenceAssignments,
      ].join(':')
    : null;

const differencesFor = (assets: AssetResponseDto[], evidence: Map<string, CimmichArchiveSourceEvidence>): string[] => {
  const facts: Array<[string, (asset: AssetResponseDto) => unknown]> = [
    ['Filenames differ', (asset) => asset.originalFileName],
    ['File sizes differ', (asset) => asset.exifInfo?.fileSizeInByte],
    ['Resolution differs', (asset) => [asset.width, asset.height]],
    ['Capture dates differ', (asset) => asset.exifInfo?.dateTimeOriginal ?? asset.localDateTime],
    [
      'Location metadata differs',
      (asset) => [asset.exifInfo?.latitude, asset.exifInfo?.longitude, asset.exifInfo?.city, asset.exifInfo?.country],
    ],
    ['Camera metadata differs', (asset) => [asset.exifInfo?.make, asset.exifInfo?.model, asset.exifInfo?.lensModel]],
    ['Rotation metadata differs', (asset) => asset.exifInfo?.orientation],
    ['Descriptions differ', (asset) => asset.exifInfo?.description],
    ['Ratings differ', (asset) => asset.exifInfo?.rating],
    ['Immich People differ', (asset) => asset.people?.map((person) => person.id)],
    ['Immich Tags differ', (asset) => asset.tags?.map((tag) => tag.id)],
    ['Favourite status differs', (asset) => asset.isFavorite],
    ['Archive status differs', (asset) => asset.isArchived],
    ['Visibility differs', (asset) => asset.visibility],
    ['Cimmich evidence differs', (asset) => evidenceSignature(evidence.get(asset.id))],
  ];
  return facts.filter(([, read]) => differs(assets, read)).map(([label]) => label);
};

export const buildArchiveVariantGroups = (
  groups: DuplicateResponseDto[],
  evidenceItems: CimmichArchiveSourceEvidence[],
): ArchiveVariantGroup[] => {
  const allEvidence = new Map(evidenceItems.map((item) => [item.sourceAssetId, item]));
  const result = groups.map((group) => {
    const evidence = new Map(
      group.assets.flatMap((asset) => {
        const item = allEvidence.get(asset.id);
        return item ? [[asset.id, item] as const] : [];
      }),
    );
    const digests = new Set([...evidence.values()].map((item) => item.contentDigest));
    const classification: ArchiveVariantClassification =
      evidence.size === group.assets.length
        ? digests.size === 1
          ? 'verified_exact'
          : 'verified_variant'
        : 'similarity_candidate';
    return {
      ...group,
      classification,
      differences: differencesFor(group.assets, evidence),
      evidence,
    };
  });
  const rank: Record<ArchiveVariantClassification, number> = {
    verified_variant: 0,
    verified_exact: 1,
    similarity_candidate: 2,
  };
  return result.sort(
    (left, right) =>
      rank[left.classification] - rank[right.classification] ||
      right.differences.length - left.differences.length ||
      left.duplicateId.localeCompare(right.duplicateId),
  );
};
