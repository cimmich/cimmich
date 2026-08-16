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

const displayFact = (value: string) => {
  const trimmed = value.trim();
  const acronym = new Map([
    ['atv', 'ATV'],
    ['automobile', 'car'],
    ['cloudy', 'cloudy sky'],
    ['gps', 'GPS'],
    ['qr code', 'QR code'],
    ['suv', 'SUV'],
    ['tv', 'TV'],
    ['water body', 'body of water'],
  ]).get(trimmed.toLocaleLowerCase());
  return acronym || trimmed;
};

const factKey = (value: string) =>
  displayFact(value)
    .toLocaleLowerCase()
    .replaceAll(/[^\p{L}\p{N}]/gu, '');

const uniqueFacts = (values: Array<string | null | undefined>) => {
  const seen = new Set<string>();
  return unique(values)
    .map((value) => displayFact(value))
    .filter((value) => {
      const key = factKey(value);
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
};

const isPluralOrMassFact = (value: string) => {
  const normalized = value.toLocaleLowerCase();
  return (
    /(?:people|children|men|women)$/.test(normalized) ||
    (normalized.endsWith('s') && !/(?:ss|us|is)$/.test(normalized)) ||
    ['equipment', 'food', 'fog', 'grass', 'rain', 'snow', 'sunlight', 'sunshine', 'water'].includes(normalized)
  );
};

const naturalFactPhrase = (value: string) => {
  const displayed = displayFact(value);
  return isPluralOrMassFact(displayed) ? displayed : withIndefiniteArticle(displayed);
};

const capitalizeFirst = (value: string) => (value ? `${value[0].toLocaleUpperCase()}${value.slice(1)}` : '');

const numberWord = (value: number) =>
  ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'][value] || String(value);

const smartSubject = (people: Array<{ displayName: string; personId: string }>, peopleCountEstimate: number) => {
  const unknownCount = Math.max(0, peopleCountEstimate - people.length);
  const subjects = [
    ...people.map((item) => item.displayName),
    ...(unknownCount === 1 ? ['another person'] : unknownCount > 1 ? [`${unknownCount} other people`] : []),
  ];
  if (subjects.length > 0) {
    const displayedSubjects =
      subjects.length > 4 ? [...subjects.slice(0, 3), `${subjects.length - 3} others`] : subjects;
    return { count: subjects.length, text: joinNatural(displayedSubjects) };
  }
  if (peopleCountEstimate > 0) {
    return {
      count: peopleCountEstimate,
      text: peopleCountEstimate === 1 ? 'One person' : `${numberWord(peopleCountEstimate)} people`,
    };
  }
  return { count: 0, text: '' };
};

const usefulScene = (value: string) => {
  const scene = value.trim().toLocaleLowerCase();
  return scene && !['general scene', 'image', 'photo', 'scene', 'unknown'].includes(scene) ? scene : '';
};

const smartScenePhrase = (value: string) => {
  const scene = usefulScene(value);
  if (!scene) {
    return '';
  }
  if (scene === 'outdoors' || scene === 'indoors') {
    return scene;
  }
  if (scene === 'road' || scene === 'dirt road') {
    return `on ${naturalFactPhrase(scene)}`;
  }
  if (scene === 'shopfront') {
    return 'near a shopfront';
  }
  if (scene === 'beach') {
    return 'at a beach';
  }
  return `in ${naturalFactPhrase(scene)}`;
};

const lowValueSmartFactKeys = new Set([
  'consumerelectronics',
  'daytime',
  'frame',
  'light',
  'liquid',
  'opticalequipment',
  'portal',
  'sport',
  'textile',
  'watersport',
  'woodnatural',
  'woodprocessed',
]);

const isUsefulObservedSmartFact = (value: string, peopleCountEstimate: number) => {
  const key = factKey(value);
  return (
    !lowValueSmartFactKeys.has(key) &&
    !(peopleCountEstimate > 0 && ['crowd', 'face', 'group', 'human', 'people', 'person'].includes(key))
  );
};

const collapseObservedSmartParents = (values: string[]) => {
  const keys = new Set(values.map((value) => factKey(value)));
  return values.filter((value) => {
    const key = factKey(value);
    if (key === 'headgear' && [...keys].some((candidate) => ['baseballhat', 'hat', 'helmet'].includes(candidate))) {
      return false;
    }
    if (key === 'footwear' && [...keys].some((candidate) => ['shoes', 'sneakers'].includes(candidate))) {
      return false;
    }
    if (
      ['bodyofwater', 'water'].includes(key) &&
      [...keys].some((candidate) => ['lake', 'ocean', 'pool'].includes(candidate))
    ) {
      return false;
    }
    return true;
  });
};

const isEnvironmentFact = (value: string) => /(?:^|\s)(?:sky|sunrise|sunset)(?:\s|$)/i.test(value);

const smartEnvironmentPhrase = (value: string) => {
  const displayed = displayFact(value);
  if (/sky/i.test(displayed)) {
    return `under ${naturalFactPhrase(displayed)}`;
  }
  if (/sunrise|sunset/i.test(displayed)) {
    return `at ${displayed}`;
  }
  if (/rain/i.test(displayed)) {
    return 'in the rain';
  }
  return `in ${displayed}`;
};

const factsNotCoveredBy = (facts: string[], strongerFacts: string[]) => {
  const strongerKeys = strongerFacts.map((value) => factKey(value));
  return facts.filter((fact) => {
    const key = factKey(fact);
    return !strongerKeys.some((strongerKey) => strongerKey === key || (key.length >= 3 && strongerKey.includes(key)));
  });
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
  const mentionedPersonIds = new Set<string>();
  let usedIdentity = false;
  let text = summary.replaceAll(/\{\{person:([^}]+)\}\}/g, (_token, personId: string) => {
    usedIdentity = true;
    const displayName = byId.get(personId);
    if (displayName) {
      mentionedPersonIds.add(personId);
    }
    return displayName || 'a confirmed person';
  });
  if (mentionedPersonIds.size > 0 && estimate > 0 && people.length === estimate) {
    const remainingPeople = people.filter((item) => !mentionedPersonIds.has(item.personId));
    if (remainingPeople.length === 1) {
      const nextText = text.replace(
        /\b(?:another person|a second person|one other person)\b/i,
        remainingPeople[0].displayName,
      );
      if (nextText !== text) {
        mentionedPersonIds.add(remainingPeople[0].personId);
        text = nextText;
      }
    } else if (remainingPeople.length > 1) {
      const nextText = text.replace(
        /\b(?:\d+|two|three|four|five|six|seven|eight|nine|ten) other people\b/i,
        joinNatural(remainingPeople.map((item) => item.displayName)),
      );
      if (nextText !== text) {
        for (const item of remainingPeople) {
          mentionedPersonIds.add(item.personId);
        }
        text = nextText;
      }
    }
  }
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
    if (usedIdentity) {
      for (const item of people) {
        mentionedPersonIds.add(item.personId);
      }
    }
  }
  return { text, unmentionedPeople: people.filter((item) => !mentionedPersonIds.has(item.personId)), usedIdentity };
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

const meaningfulVisibleText = (values: string[], existingSummary = '') => {
  const seen = new Set<string>();
  const summary = existingSummary.toLocaleLowerCase();
  const candidates = unique(values).filter((value) => {
    const normalized = value.toLocaleLowerCase();
    const meaningfulCharacters = value.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
    if (meaningfulCharacters < 2 || seen.has(normalized) || summary.includes(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
  const compact = (value: string) => value.toLocaleLowerCase().replaceAll(/[^\p{L}\p{N}]/gu, '');
  return candidates.filter((value, index) => {
    const fragment = compact(value);
    return !candidates.some((candidate, candidateIndex) => {
      const complete = compact(candidate);
      return candidateIndex !== index && complete.length > fragment.length && complete.includes(fragment);
    });
  });
};

export const compileCimmichOcrReadings = (ocr: OcrBoundingBox[]) => {
  const orderedOcr = [...ocr].sort((left, right) => {
    const top = (item: OcrBoundingBox) => Math.min(item.y1 ?? 0, item.y2 ?? 0, item.y3 ?? 0, item.y4 ?? 0);
    const leftEdge = (item: OcrBoundingBox) => Math.min(item.x1 ?? 0, item.x2 ?? 0, item.x3 ?? 0, item.x4 ?? 0);
    return top(left) - top(right) || leftEdge(left) - leftEdge(right);
  });
  return meaningfulVisibleText(orderedOcr.map((item) => item.text));
};

const ocrSentence = (ocr: OcrBoundingBox[], additionalText: string[] = [], existingSummary = '') => {
  const text = meaningfulVisibleText([...compileCimmichOcrReadings(ocr), ...additionalText], existingSummary).slice(
    0,
    5,
  );
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
  const describedObjects = objects.map((object) => withIndefiniteArticle(object));
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

const usesPluralVerb = (value: string) => {
  const normalized = value.toLocaleLowerCase();
  return (
    /(?:people|children|men|women)$/.test(normalized) || (normalized.endsWith('s') && !/(?:ss|us|is)$/.test(normalized))
  );
};

const compileCimmichSmartSummary = ({
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
  const subject = smartSubject(people, facts.peopleCountEstimate);
  const activities = uniqueFacts(facts.activities);
  const ownerObjects = uniqueFacts(contextNames(evidence, 'object'));
  const observedObjects = collapseObservedSmartParents(
    uniqueFacts(facts.objects).filter((value) => isUsefulObservedSmartFact(value, facts.peopleCountEstimate)),
  );
  const environment = observedObjects.filter((value) => isEnvironmentFact(value));
  const observedDetails = factsNotCoveredBy(
    observedObjects.filter((value) => !isEnvironmentFact(value)),
    ownerObjects,
  ).filter((value) => !activities.some((activity) => factKey(activity).includes(factKey(value))));
  const activityText = activities.join(' and ');
  const scene = smartScenePhrase(facts.scene);
  const environmentText = environment.map((value) => smartEnvironmentPhrase(value)).join(' and ');
  const place = locationName(asset, evidence);
  const date = formattedDate(asset);
  const events = uniqueFacts(contextNames(evidence, 'event'));
  const ownerObjectsOutsideActivity = ownerObjects.filter(
    (value) => !activities.some((activity) => factKey(activity).includes(factKey(value))),
  );
  const usedObservedObjects: string[] = [];
  let main = '';

  if (subject.text) {
    const be = subject.count === 1 ? 'is' : 'are';
    if (activityText) {
      main = `${subject.text} ${be} ${activityText}`;
      if (scene) {
        main += ` ${scene}`;
      }
    } else if (scene) {
      main = `${subject.text} ${be} ${scene}`;
    } else {
      main = `${subject.text} ${be} pictured`;
    }
    if (ownerObjectsOutsideActivity.length > 0) {
      main += ` with ${joinNatural(ownerObjectsOutsideActivity.map((value) => naturalFactPhrase(value)))}`;
    }
  } else {
    const primaryObjects = ownerObjects.length > 0 ? ownerObjects : observedDetails.slice(0, 2);
    usedObservedObjects.push(...primaryObjects);
    if (primaryObjects.length > 0) {
      const objectText = joinNatural(primaryObjects.map((value) => naturalFactPhrase(value)));
      const be = primaryObjects.length > 1 || usesPluralVerb(primaryObjects[0]) ? 'are' : 'is';
      main = `${capitalizeFirst(objectText)} ${be} pictured`;
      if (scene) {
        main += ` ${scene}`;
      }
    } else if (scene) {
      main = `The photo was taken ${scene}`;
    }
  }

  if (environmentText) {
    main += main ? ` ${environmentText}` : `The photo was taken ${environmentText}`;
  }
  if (place) {
    main += main ? ` in ${place}` : `The photo was taken in ${place}`;
  }
  if (events.length > 0) {
    main += main ? ` during ${joinNatural(events)}` : `The photo was taken during ${joinNatural(events)}`;
  }
  if (date) {
    main += main ? ` on ${date}` : `The photo was taken on ${date}`;
  }

  const remainingDetails = observedDetails.filter(
    (value) => !usedObservedObjects.some((used) => factKey(used) === factKey(value)),
  );
  const detailSentence =
    remainingDetails.length > 0
      ? `${capitalizeFirst(joinNatural(remainingDetails.map((value) => naturalFactPhrase(value))))} ${remainingDetails.length > 1 || usesPluralVerb(remainingDetails[0]) ? 'are' : 'is'} also visible.`
      : '';
  const base = [cleanSentence(main), detailSentence].filter(Boolean).join(' ');
  const fallback = cleanSentence(modelPeopleSummary(facts.summary, people, facts.peopleCountEstimate).text);
  return [base || fallback, ocrSentence(ocr, facts.visibleText, base || fallback)].filter(Boolean).join(' ');
};

const prefersStructuredSmartComposition = (analysis: CimmichGeneratedSummaryAnalysis) =>
  analysis.model?.providerId === 'apple-vision-native-summary' ||
  /^(?:No person|One person|\d+ people) (?:is|are) (?:clearly detected|visible)\b/i.test(
    analysis.visualFacts.summary.trim(),
  );

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
  if (analysis.tier === 'smart' && prefersStructuredSmartComposition(analysis)) {
    return compileCimmichSmartSummary({ analysis, asset, evidence, ocr });
  }
  const facts = analysis.visualFacts;
  const people = currentPeople(evidence);
  const modelSummary = modelPeopleSummary(facts.summary, people, facts.peopleCountEstimate);
  const liveDetails = [
    modelSummary.unmentionedPeople.length > 0
      ? cleanSentence(`Known people: ${joinNatural(modelSummary.unmentionedPeople.map((item) => item.displayName))}`)
      : '',
    contextSentence(evidence),
    dateSentence(asset),
    locationSentence(asset),
    ocrSentence(ocr, facts.visibleText, modelSummary.text),
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
