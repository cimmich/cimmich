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

const withIndefiniteArticle = (value: string) => {
  if (/^[A-Z][a-zÀ-ž'-]+(?:\s+[A-Z][a-zÀ-ž'-]+)+$/.test(value)) {
    return value;
  }
  if (/^[A-Z0-9-]{2,}$/.test(value)) {
    return `${/^[AEFHILMNORSX]/.test(value) ? 'an' : 'a'} ${value}`;
  }
  return `${/^[aeiou]/i.test(value) ? 'an' : 'a'} ${value}`;
};

export const cimmichSummaryKnownPeople = (evidence: CimmichAssetEvidence) =>
  unique([
    ...evidence.faces.map((face) => face.display_name),
    ...evidence.bodies.map((body) => body.display_name),
    ...evidence.presence.map((item) => item.display_name),
  ]);

const currentPeople = (evidence: CimmichAssetEvidence) =>
  [
    ...evidence.faces.map((item) => ({ displayName: item.display_name, personId: item.person_id })),
    ...evidence.bodies.map((item) => ({ displayName: item.display_name, personId: item.person_id })),
    ...evidence.presence.map((item) => ({ displayName: item.display_name, personId: item.person_id })),
  ].filter(
    (item, index, values): item is { displayName: string; personId: string } =>
      Boolean(item.displayName && item.personId) &&
      values.findIndex((candidate) => candidate.personId === item.personId) === index,
  );

const modelPeopleSummary = (
  summary: string,
  people: Array<{ displayName: string; personId: string }>,
  estimate: number,
) => {
  const byId = new Map(people.map((item) => [item.personId, item.displayName]));
  let usedIdentity = false;
  let text = summary.replaceAll(/\{\{person:([^}]+)\}\}/g, (_token, personId: string) => {
    usedIdentity = true;
    return byId.get(personId) || 'a confirmed person';
  });
  if (!usedIdentity && people.length > 0 && estimate > 0) {
    const unknownCount = Math.max(0, estimate - people.length);
    const subjects = [
      ...people.map((item) => item.displayName),
      ...(unknownCount === 1 ? ['another person'] : unknownCount > 1 ? [`${unknownCount} other people`] : []),
    ];
    const subject = joinNatural(subjects);
    text = text.replace(
      /^(?:one|\d+) (person|people) (is|are) visible\b/i,
      `${subject} ${subjects.length === 1 ? 'is' : 'are'} visible`,
    );
    usedIdentity = text !== summary;
  }
  return { text, usedIdentity };
};

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

const contextNames = (evidence: CimmichAssetEvidence, kind: 'event' | 'object' | 'place') =>
  unique((evidence.contexts || []).filter((item) => item.entity_kind === kind).map((item) => item.display_name));

const formattedDate = (asset: AssetResponseDto) => {
  const value = asset.exifInfo?.dateTimeOriginal || asset.fileCreatedAt;
  if (!value) {
    return '';
  }
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '' : new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(date);
};

const locationName = (asset: AssetResponseDto, evidence: CimmichAssetEvidence) => {
  const metadataLocation = unique([asset.exifInfo?.city, asset.exifInfo?.state, asset.exifInfo?.country]);
  return metadataLocation.length > 0 ? metadataLocation.join(', ') : joinNatural(contextNames(evidence, 'place'));
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
  return text.length > 0 ? `Visible text includes ${text.map((item) => `“${item}”`).join(', ')}.` : '';
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
  const objects = contextNames(evidence, 'object');
  const events = contextNames(evidence, 'event');
  const place = locationName(asset, evidence);
  const date = formattedDate(asset);
  const describedObjects = objects.map(withIndefiniteArticle);
  const subjectText = people.length > 0 ? joinNatural(people) : joinNatural(describedObjects);
  const subjectCount = people.length > 0 ? people.length : describedObjects.length;
  const main = subjectText
    ? `${subjectText} ${subjectCount === 1 ? 'is' : 'are'} pictured${people.length > 0 && describedObjects.length > 0 ? ` with ${joinNatural(describedObjects)}` : ''}${place ? ` in ${place}` : ''}${events.length > 0 ? ` during ${joinNatural(events)}` : ''}${date ? ` on ${date}` : ''}.`
    : '';
  const sentences = [main, ocrSentence(ocr)].filter(Boolean);
  return sentences.length > 0
    ? sentences.join(' ')
    : 'No confirmed descriptive information has been recorded for this photo yet.';
};

export const compileCimmichModelSummary = ({
  analysis,
  asset,
  evidence,
  ocr,
}: {
  analysis: CimmichGeneratedSummaryAnalysis;
  asset: AssetResponseDto;
  evidence: CimmichAssetEvidence;
  ocr: OcrBoundingBox[];
}) => {
  const facts = analysis.visualFacts;
  const people = currentPeople(evidence);
  const modelSummary = modelPeopleSummary(facts.summary, people, facts.peopleCountEstimate);
  const liveDetails = [
    !modelSummary.usedIdentity && people.length > 0
      ? cleanSentence(`Known people: ${joinNatural(people.map((item) => item.displayName))}`)
      : '',
    contextSentence(evidence),
    dateSentence(asset),
    locationSentence(asset),
    ocrSentence(ocr),
  ].filter(Boolean);
  return [cleanSentence(modelSummary.text), ...liveDetails].filter(Boolean).join(' ');
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
