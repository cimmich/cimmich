import type { AssetResponseDto, DuplicateResponseDto } from '@immich/sdk';
import type { CimmichArchiveSourceEvidence } from '$lib/services/cimmich-archive-integrity.service';
import { getParentPath } from '$lib/utils/tree-utils';

export type ArchiveVariantClassification = 'verified_exact' | 'verified_variant' | 'similarity_candidate';

export type ArchiveCanonicalPlanStatus = 'candidate' | 'hold_exact' | 'hold_incomplete' | 'hold_ambiguous';

export type ArchiveCanonicalSignal = {
  assetId: string;
  evidenceLinks: number;
  extension: string;
  fileSize: number;
  metadataFields: number;
  originalCapture: number;
  pixelCount: number;
};

export type ArchiveCanonicalPlan = {
  cautions: string[];
  preferredAssetId: string | null;
  rankings: Map<string, ArchiveCanonicalSignal & { position: number }>;
  reasons: string[];
  status: ArchiveCanonicalPlanStatus;
};

export type ArchiveVariantGroup = DuplicateResponseDto & {
  canonicalPlan: ArchiveCanonicalPlan;
  classification: ArchiveVariantClassification;
  differences: string[];
  evidence: Map<string, CimmichArchiveSourceEvidence>;
};

export type ArchiveVariantFolderContext = {
  otherFlaggedHere: number;
  path: string;
};

export const archiveVariantFolderContext = (
  groups: Pick<DuplicateResponseDto, 'assets'>[],
  asset: AssetResponseDto,
): ArchiveVariantFolderContext | null => {
  if (!asset.originalPath) {
    return null;
  }
  const path = getParentPath(asset.originalPath);
  const flaggedAssetIds = new Set(
    groups.flatMap((group) =>
      group.assets
        .filter((candidate) => Boolean(candidate.originalPath) && getParentPath(candidate.originalPath) === path)
        .map((candidate) => candidate.id),
    ),
  );
  flaggedAssetIds.delete(asset.id);
  return {
    otherFlaggedHere: flaggedAssetIds.size,
    path,
  };
};

export const archiveVariantGroupsInFolder = <T extends Pick<DuplicateResponseDto, 'assets'>>(
  groups: T[],
  path: string,
) => {
  if (!path) {
    return groups;
  }
  return groups.filter((group) =>
    group.assets.some((asset) => Boolean(asset.originalPath) && getParentPath(asset.originalPath) === path),
  );
};

export const createArchiveVisualDuplicateGroup = (
  duplicateId: string,
  assets: AssetResponseDto[],
): DuplicateResponseDto => ({ assets, duplicateId, suggestedKeepAssetIds: [] });
const originalCaptureExtensions = new Set([
  '3fr',
  'arw',
  'cr2',
  'cr3',
  'dcr',
  'dng',
  'erf',
  'iiq',
  'kdc',
  'mef',
  'mos',
  'mrw',
  'nef',
  'nrw',
  'orf',
  'pef',
  'raf',
  'raw',
  'rw2',
  'rwl',
  'sr2',
  'srf',
  'srw',
]);

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

const extensionFor = (asset: AssetResponseDto) => asset.originalFileName.split('.').at(-1)?.toLocaleLowerCase() ?? '';

const metadataFieldCount = (asset: AssetResponseDto) => {
  const exif = asset.exifInfo;
  return [
    exif?.dateTimeOriginal,
    exif?.latitude !== null &&
      exif?.latitude !== undefined &&
      exif?.longitude !== null &&
      exif?.longitude !== undefined,
    exif?.make,
    exif?.model,
    exif?.lensModel,
    exif?.orientation,
    exif?.description,
    exif?.rating,
  ].filter(Boolean).length;
};

const canonicalSignal = (
  asset: AssetResponseDto,
  evidence: CimmichArchiveSourceEvidence | undefined,
): ArchiveCanonicalSignal => {
  const extension = extensionFor(asset);
  return {
    assetId: asset.id,
    evidenceLinks:
      (asset.people?.length ?? 0) +
      (asset.tags?.length ?? 0) +
      (evidence
        ? evidence.people +
          evidence.faceAssignments +
          evidence.headAssignments +
          evidence.bodyAssignments +
          evidence.presenceAssignments
        : 0),
    extension,
    fileSize: Number(asset.exifInfo?.fileSizeInByte ?? 0),
    metadataFields: metadataFieldCount(asset),
    originalCapture: originalCaptureExtensions.has(extension) ? 1 : 0,
    pixelCount: Number(asset.width ?? 0) * Number(asset.height ?? 0),
  };
};

const signalValues = (signal: ArchiveCanonicalSignal) => [
  signal.originalCapture,
  signal.pixelCount,
  signal.fileSize,
  signal.metadataFields,
  signal.evidenceLinks,
];

const compareSignals = (left: ArchiveCanonicalSignal, right: ArchiveCanonicalSignal) => {
  const leftValues = signalValues(left);
  const rightValues = signalValues(right);
  for (let index = 0; index < leftValues.length; index += 1) {
    const difference = (rightValues[index] ?? 0) - (leftValues[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return left.assetId.localeCompare(right.assetId);
};

const sameSignals = (left: ArchiveCanonicalSignal, right: ArchiveCanonicalSignal) =>
  signalValues(left).every((value, index) => value === signalValues(right)[index]);

const megapixels = (value: number) => `${(value / 1_000_000).toFixed(1)} MP`;

const sizeLabel = (value: number) => {
  const units = ['B', 'KB', 'MB', 'GB'];
  const power = value > 0 ? Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1) : 0;
  const amount = value / 1024 ** power;
  return `${amount >= 10 || power === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[power]}`;
};

const candidateReasons = (preferred: ArchiveCanonicalSignal, runnerUp: ArchiveCanonicalSignal) => {
  if (preferred.originalCapture !== runnerUp.originalCapture) {
    return [`${preferred.extension.toLocaleUpperCase()} is an original capture format, which ranks first.`];
  }
  if (preferred.pixelCount !== runnerUp.pixelCount) {
    return [
      `Higher pixel dimensions rank first: ${megapixels(preferred.pixelCount)} versus ${megapixels(runnerUp.pixelCount)}.`,
    ];
  }
  if (preferred.fileSize !== runnerUp.fileSize) {
    return [
      `Larger complete file breaks the tie: ${sizeLabel(preferred.fileSize)} versus ${sizeLabel(runnerUp.fileSize)}.`,
    ];
  }
  if (preferred.metadataFields !== runnerUp.metadataFields) {
    return [
      `More capture metadata breaks the tie: ${preferred.metadataFields} fields versus ${runnerUp.metadataFields}.`,
    ];
  }
  return [
    `Richer organisation and identity evidence breaks the tie: ${preferred.evidenceLinks} links versus ${runnerUp.evidenceLinks}.`,
  ];
};

const canonicalPlanFor = (
  assets: AssetResponseDto[],
  evidence: Map<string, CimmichArchiveSourceEvidence>,
  classification: ArchiveVariantClassification,
  differences: string[],
): ArchiveCanonicalPlan => {
  const ranked = assets.map((asset) => canonicalSignal(asset, evidence.get(asset.id))).sort(compareSignals);
  const rankings = new Map(ranked.map((signal, index) => [signal.assetId, { ...signal, position: index + 1 }]));
  const shared = { preferredAssetId: null, rankings };
  if (classification === 'verified_exact') {
    return {
      ...shared,
      cautions: ['Choose copy retention only after backup and copy-local organisation review.'],
      reasons: ['Complete-file digests are identical; a media-quality winner would be false precision.'],
      status: 'hold_exact',
    };
  }
  if (classification === 'similarity_candidate') {
    return {
      ...shared,
      cautions: ['Complete byte evidence is required before preservation planning.'],
      reasons: ['At least one file lacks Cimmich byte verification.'],
      status: 'hold_incomplete',
    };
  }
  const preferred = ranked[0];
  const runnerUp = ranked[1];
  if (!preferred || !runnerUp || sameSignals(preferred, runnerUp)) {
    return {
      ...shared,
      cautions: ['Visual crop, focus and edit intent require owner review.'],
      reasons: ['Available preservation signals do not establish a unique preferred version.'],
      status: 'hold_ambiguous',
    };
  }
  const cautions = ['Visual crop, focus and edit intent still require owner review.'];
  if (differences.some((difference) => /People|Tags|Cimmich evidence/.test(difference))) {
    cautions.push('Identity or organisation evidence differs; merge or export it before any retirement.');
  }
  if (preferred.originalCapture === 1) {
    cautions.push('A rendered companion may still be needed for viewing or intentional edits.');
  }
  if (differences.some((difference) => /Capture dates|Location/.test(difference))) {
    cautions.push('Conflicting date or location metadata needs owner confirmation.');
  }
  return {
    cautions,
    preferredAssetId: preferred.assetId,
    rankings,
    reasons: candidateReasons(preferred, runnerUp),
    status: 'candidate',
  };
};

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
    const differences = differencesFor(group.assets, evidence);
    return {
      ...group,
      canonicalPlan: canonicalPlanFor(group.assets, evidence, classification, differences),
      classification,
      differences,
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
