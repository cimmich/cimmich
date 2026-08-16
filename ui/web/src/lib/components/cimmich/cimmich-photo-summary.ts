import type { AssetResponseDto } from '@immich/sdk';
import type { CimmichAssetEvidence, CimmichGeneratedSummaryAnalysis } from '$lib/services/cimmich.service';
import type { OcrBoundingBox } from '$lib/stores/ocr.svelte';

const unique = (values: Array<string | null | undefined>) => [
  ...new Set(
    values
      .map((value) =>
        String(value || '')
          .replaceAll(/\s+/g, ' ')
          .trim(),
      )
      .filter(Boolean),
  ),
];

const joinNatural = (values: string[]) => {
  if (values.length < 2) {
    return values[0] || '';
  }
  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;
};

const cleanSentence = (value: string) => {
  const text = value.trim();
  if (!text) {
    return '';
  }
  return /[.!?]$/.test(text) ? text : `${text}.`;
};

export const cimmichSummaryKnownPeople = (evidence: CimmichAssetEvidence) =>
  unique([
    ...evidence.faces.map((face) => face.display_name),
    ...evidence.bodies.map((body) => body.display_name),
    ...evidence.presence.map((item) => item.display_name),
  ]);

const contextSentence = (evidence: CimmichAssetEvidence) => {
  const contexts = evidence.contexts || [];
  const parts = (['place', 'event', 'object'] as const).flatMap((kind) => {
    const names = unique(contexts.filter((item) => item.entity_kind === kind).map((item) => item.display_name));
    if (names.length === 0) {
      return [];
    }
    const label = kind === 'object' ? 'Known things' : kind === 'event' ? 'Event' : 'Place';
    return [`${label}: ${joinNatural(names)}`];
  });
  return parts.length > 0 ? cleanSentence(parts.join(' · ')) : '';
};

const dateSentence = (asset: AssetResponseDto) => {
  const value = asset.exifInfo?.dateTimeOriginal || asset.fileCreatedAt;
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return '';
  }
  return `Taken ${new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(date)}.`;
};

const locationSentence = (asset: AssetResponseDto) => {
  const location = unique([asset.exifInfo?.city, asset.exifInfo?.state, asset.exifInfo?.country]);
  return location.length > 0 ? `Location: ${location.join(', ')}.` : '';
};

const ocrSentence = (ocr: OcrBoundingBox[]) => {
  const text = unique(ocr.map((item) => item.text)).slice(0, 5);
  return text.length > 0 ? `Visible text: ${text.map((item) => `“${item}”`).join(' · ')}.` : '';
};

const reviewSentence = (evidence: CimmichAssetEvidence) => {
  const unresolvedFaces = evidence.faces.filter(
    (face) => !face.display_name && !face.rejected_identity_claim_id && face.review_disposition === 'active',
  ).length;
  const unlinkedBodies = evidence.bodies.filter((body) => !body.person_id).length;
  const parts = [
    unresolvedFaces > 0 ? `${unresolvedFaces} ${unresolvedFaces === 1 ? 'Face needs' : 'Faces need'} review` : '',
    unlinkedBodies > 0 ? `${unlinkedBodies} ${unlinkedBodies === 1 ? 'Body needs' : 'Bodies need'} review` : '',
  ].filter(Boolean);
  return parts.length > 0 ? cleanSentence(parts.join(' · ')) : '';
};

export const compileCimmichStandardSummary = ({
  asset,
  evidence,
  ocr,
}: {
  asset: AssetResponseDto;
  evidence: CimmichAssetEvidence;
  ocr: OcrBoundingBox[];
}) => {
  const people = cimmichSummaryKnownPeople(evidence);
  const sentences = [
    people.length > 0
      ? cleanSentence(`${joinNatural(people)} ${people.length === 1 ? 'is' : 'are'} in this photo`)
      : '',
    contextSentence(evidence),
    dateSentence(asset),
    locationSentence(asset),
    ocrSentence(ocr),
    reviewSentence(evidence),
  ].filter(Boolean);
  return sentences.length > 0
    ? sentences.join(' ')
    : 'No confirmed people, place, text or other Context has been recorded for this photo yet.';
};

export const compileCimmichModelSummary = ({
  analysis,
  evidence,
}: {
  analysis: CimmichGeneratedSummaryAnalysis;
  evidence: CimmichAssetEvidence;
}) => {
  const facts = analysis.visualFacts;
  const people = cimmichSummaryKnownPeople(evidence);
  const liveDetails = [
    people.length > 0 ? cleanSentence(`Known people: ${joinNatural(people)}`) : '',
    contextSentence(evidence),
  ].filter(Boolean);
  return [cleanSentence(facts.summary), ...liveDetails].filter(Boolean).join(' ');
};

export const cimmichSummaryQc = (evidence: CimmichAssetEvidence, analysis?: CimmichGeneratedSummaryAnalysis | null) => {
  const savedFaceCount = evidence.faces.filter((face) => face.review_disposition !== 'later').length;
  const savedBodyCount = evidence.bodies.length;
  const estimatedPeople = analysis?.visualFacts.peopleCountEstimate ?? null;
  return {
    flags: unique(analysis?.visualFacts.qualityFlags || []),
    missingBodies: estimatedPeople == null ? null : Math.max(0, estimatedPeople - savedBodyCount),
    missingFaces: estimatedPeople == null ? null : Math.max(0, estimatedPeople - savedFaceCount),
  };
};
