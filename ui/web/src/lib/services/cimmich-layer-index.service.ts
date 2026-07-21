import type {
  CimmichArchiveGraph,
  CimmichArchiveGraphDocument,
  CimmichArchiveGraphEntity,
  CimmichArchiveGraphTrip,
  CimmichEvidenceBundle,
  CimmichPhotoEvidence,
} from '$lib/services/cimmich-evidence.service';

export type CimmichCountMap = Record<string, number>;

export type CimmichCountRow = {
  count: number;
  label: string;
};

export type CimmichTripRow = {
  activities: CimmichCountMap;
  documentCandidateCount: number;
  filenames: string[];
  gpsCount: number;
  label: string;
  people: CimmichCountMap;
  photos: CimmichPhotoEvidence[];
  places: CimmichCountMap;
  visualCaptionCount: number;
  years: string[];
};

export type CimmichNamedEntityDefinition = {
  aliases: string[];
  description: string;
  id: string;
  locationHints: string[];
  name: string;
  patterns: RegExp[];
  relatedConcepts: string[];
  routeHints: string[];
};

export type CimmichActivityRow = {
  aliases: string[];
  description: string;
  documentCandidateCount: number;
  filenames: string[];
  heroFilename?: string;
  heroDescription: string;
  id: string;
  keywords: string[];
  label: string;
  locationHints: string[];
  matchCues: string[];
  matchSignals: CimmichCountMap;
  peopleRoles: Array<{ name: string; role: string }>;
  people: CimmichCountMap;
  photoMatches: NonNullable<CimmichArchiveGraphEntity['photoMatches']>;
  photos: CimmichPhotoEvidence[];
  places: CimmichCountMap;
  relatedConcepts: string[];
  routeHints: string[];
  trips: CimmichCountMap;
};

export type CimmichPetsObjectRow = CimmichActivityRow & {
  kind: 'object' | 'pet';
};

export type CimmichDocumentRow = {
  filename: string;
  mediaId: string;
  people: string[];
  score: number;
  signals: string[];
  summaryText: string;
  trip: string;
  visualScene?: string;
  visualSetting?: string;
};

const documentSignalPatterns: Array<{ label: string; pattern: RegExp }> = [
  { label: 'Signage', pattern: /\b(sign|signage|exit sign|neon|poster|flyer|banner)\b/i },
  { label: 'Printed text', pattern: /\b(text|writing|printed|letters|wording|slogan|logo)\b/i },
  { label: 'Screen', pattern: /\b(screen|television|monitor|display)\b/i },
  {
    label: 'Paper/card',
    pattern: /\b(paper|card|ticket|receipt|menu|brochure|passport|license|certificate|document)\b/i,
  },
  { label: 'Labeled object', pattern: /\b(label|labeled|labelled|sticker|tag)\b/i },
  { label: 'Register/bar proof', pattern: /\b(cash register|counter sign|price|beer helps)\b/i },
];

export const cimmichActivityDefinitions: CimmichNamedEntityDefinition[] = [
  {
    aliases: ['Group games', 'drinking cup'],
    description: 'A repeatable group activity around cups, bars, and recurring social photos.',
    id: 'group-games',
    locationHints: ['bar areas', 'social venues'],
    name: 'Group Games',
    patterns: [/\bplastic cups?\b/i, /\bbeverages?\b/i, /\bdrinks?\b/i, /\bshots?\b/i, /\bbar\b/i, /\bround table\b/i],
    relatedConcepts: ['cups', 'drinking games', 'bar nights', 'group photos'],
    routeHints: [],
  },
  {
    aliases: ['Boat trip', 'cruise day'],
    description: 'A repeatable boat or coastal day activity with route stops and water scenes.',
    id: 'boat-trip',
    locationHints: ['Boat route', 'Cliff Jump', 'coast'],
    name: 'Boat Trip',
    patterns: [/\bboat\b/i, /\bcruise\b/i, /\bsea\b/i, /\bwater\b/i, /\bcoast(al)?\b/i, /\bcliff\b/i, /\bswimm?ing\b/i],
    relatedConcepts: ['boat', 'sea route', 'cliff jump', 'swim stops'],
    routeHints: ['Boat route variants', 'Cliff Jump stop'],
  },
  {
    aliases: ['Quad Safari', 'ATV Safari', 'quad tour'],
    description:
      'Repeatable ATV/quad activity that should connect road photos, route paths, vehicles, helmets, stops, and known safari variants.',
    id: 'quad-safari',
    locationHints: ['ATV routes', 'roads', 'rocky hillside stops'],
    name: 'Quad Safari',
    patterns: [
      /\bquad\b/i,
      /\batv\b/i,
      /\ball-terrain\b/i,
      /\bhelmet\b/i,
      /\bsafari\b/i,
      /\broad\b/i,
      /\bvehicle\b/i,
      /\brocky hillside\b/i,
    ],
    relatedConcepts: ['ATVs', 'helmets', 'route stops', 'road photos'],
    routeHints: ['Quad Safari route variants'],
  },
  {
    aliases: ['Toga Party', 'toga night'],
    description:
      'Recurring party theme around toga/draped outfits and bar/social scenes, later tied to specific nights and people.',
    id: 'toga-party',
    locationHints: ['social venue', 'bar area'],
    name: 'Toga Party',
    patterns: [/\btoga\b/i, /\bdraped\b/i, /\bcostume\b/i, /\bparty\b/i, /\bpink headband\b/i, /\bbar\b/i],
    relatedConcepts: ['costumes', 'bar nights', 'group photos'],
    routeHints: [],
  },
  {
    aliases: ['Volleyball', 'Volleyball Court'],
    description:
      'Recurring volleyball court activity tied to Beach Buildings, resort days, spectators, and court-side group photos.',
    id: 'volleyball',
    locationHints: ['Beach / Volleyball Court'],
    name: 'Volleyball',
    patterns: [/\bvolleyball\b/i, /\bcourt\b/i, /\bfenced area\b/i, /\bswimwear\b/i, /\bbeach buildings\b/i],
    relatedConcepts: ['volleyball court', 'spectators', 'beach buildings'],
    routeHints: [],
  },
  {
    aliases: ['Cliff Jump', 'cliff jumping'],
    description:
      'Named coastal stop that can belong to boat routes while remaining separately searchable as a place/activity.',
    id: 'cliff-jump',
    locationHints: ['Cliff Jump', 'coast'],
    name: 'Cliff Jump',
    patterns: [
      /\bcliff\b/i,
      /\bjump(ing)?\b/i,
      /\brocky coastal\b/i,
      /\bbody of water\b/i,
      /\bcoastal area\b/i,
      /\bswimm?ing\b/i,
    ],
    relatedConcepts: ['Boat Trip', 'coast', 'water', 'rocks'],
    routeHints: ['Boat route stop'],
  },
];

export const cimmichPetsObjectDefinitions: Array<CimmichNamedEntityDefinition & { kind: 'object' | 'pet' }> = [
  {
    aliases: ['ATV', 'quad bike', 'quad'],
    description: 'The ATV/quad vehicles that recur in Quad Safari evidence and route photos.',
    id: 'atv-quad',
    kind: 'object',
    locationHints: ['Quad Safari routes'],
    name: 'ATV / Quad',
    patterns: [/\batv\b/i, /\bquad\b/i, /\ball-terrain\b/i, /\bvehicle\b/i, /\bhelmet\b/i],
    relatedConcepts: ['Quad Safari', 'route evidence', 'helmets'],
    routeHints: ['Quad Safari route variants'],
  },
  {
    aliases: ['Motorbike', 'motorcycle', 'scooter'],
    description: 'Motorbike/scooter evidence that should become an object identity when enough photos exist.',
    id: 'motorbike',
    kind: 'object',
    locationHints: ['road photos', 'travel routes'],
    name: 'Motorbike',
    patterns: [/\bmotorbike\b/i, /\bmotorcycle\b/i, /\bscooter\b/i, /\bhelmet\b/i, /\broad\b/i],
    relatedConcepts: ['vehicles', 'road photos'],
    routeHints: [],
  },
  {
    aliases: ['Bluewater boat', 'boat'],
    description: 'The boat used for Bluewater activity instances, routes, and coastal photo clusters.',
    id: 'booze-cruise-boat',
    kind: 'object',
    locationHints: ['Bluewater route', 'Bluewater coast'],
    name: 'Bluewater Boat',
    patterns: [/\bboat\b/i, /\bcruise\b/i, /\bsea\b/i, /\bwater\b/i, /\bcoast(al)?\b/i],
    relatedConcepts: ['Bluewater Weekend', 'sea route', 'coastal stops'],
    routeHints: ['Bluewater route variants'],
  },
  {
    aliases: ['Pets', 'dogs', 'cats'],
    description:
      'Pet appearances belong with durable objects because they need identity, names, owners, and repeat sightings.',
    id: 'pets',
    kind: 'pet',
    locationHints: ['home stays', 'hostels', 'travel stops'],
    name: 'Pets',
    patterns: [/\bpet\b/i, /\bdog\b/i, /\bcat\b/i, /\banimal\b/i],
    relatedConcepts: ['owners', 'repeat sightings', 'household context'],
    routeHints: [],
  },
];

const increment = (counts: CimmichCountMap, label: string | undefined, by = 1) => {
  const key = (label || '').trim();
  if (!key) {
    return;
  }

  counts[key] = (counts[key] ?? 0) + by;
};

const filenameForPhoto = (photo: CimmichPhotoEvidence) => photo.filename || photo.mediaId;

const photosWithSummaries = (bundle: CimmichEvidenceBundle) =>
  Object.values(bundle.photos).filter((photo) => Boolean(photo.summary));

const peopleForPhoto = (photo: CimmichPhotoEvidence) =>
  [
    ...(photo.summary?.sourcePeople ?? []),
    ...(photo.summary?.candidatePeople ?? []),
    ...(photo.summary?.strongCandidatePeople ?? []),
    ...(photo.summary?.bodyContextPeople ?? []),
  ]
    .map((name) => name.trim())
    .filter(Boolean);

const yearForPhoto = (photo: CimmichPhotoEvidence) => {
  const exifDate = photo.summary?.exifDate ?? '';
  const match = exifDate.match(/\b(19|20)\d{2}\b/);
  return match?.[0];
};

const tripLabelForPhoto = (photo: CimmichPhotoEvidence) =>
  photo.summary?.eventContext || photo.summary?.eventAliases?.[0] || 'Unsorted trip';

const combinedDocumentText = (photo: CimmichPhotoEvidence) =>
  [
    photo.summary?.normalCaption,
    photo.summary?.visualCaption,
    photo.summary?.visualDetailedCaption,
    photo.summary?.visualShortCaption,
    photo.summary?.visualScene,
    photo.summary?.visualSetting,
    photo.summary?.queryText,
  ]
    .filter(Boolean)
    .join(' ');

const searchTextForPhoto = (photo: CimmichPhotoEvidence) =>
  [
    combinedDocumentText(photo),
    ...(photo.summary?.visibleActions ?? []),
    ...(photo.summary?.eventAliases ?? []),
    ...(photo.summary?.sourcePeople ?? []),
    ...(photo.summary?.candidatePeople ?? []),
    ...(photo.summary?.strongCandidatePeople ?? []),
    ...(photo.summary?.bodyContextPeople ?? []),
    photo.summary?.eventContext,
    photo.summary?.localDescription,
    photo.summary?.evidenceCaption,
    photo.summary?.enhancedCaption,
  ]
    .filter(Boolean)
    .join(' ');

const matchDefinitionSignals = (definition: CimmichNamedEntityDefinition, photo: CimmichPhotoEvidence) => {
  const text = searchTextForPhoto(photo);
  const signals = [
    ...definition.aliases.filter((alias) => text.toLowerCase().includes(alias.toLowerCase())),
    ...definition.patterns
      .filter((pattern) => pattern.test(text))
      .map((pattern) =>
        pattern.source
          .replaceAll(String.raw`\b`, '')
          .replaceAll('?', '')
          .replaceAll('(', '')
          .replaceAll(')', ''),
      ),
  ];
  return [...new Set(signals)];
};

export const documentSignalsForPhoto = (photo: CimmichPhotoEvidence) => {
  const text = combinedDocumentText(photo);
  return documentSignalPatterns.filter((signal) => signal.pattern.test(text)).map((signal) => signal.label);
};

export const topCimmichCounts = (counts: CimmichCountMap, limit = 4): CimmichCountRow[] =>
  Object.entries(counts)
    .map(([label, count]) => ({ count, label }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);

const photosFromFilenames = (bundle: CimmichEvidenceBundle, filenames: string[]) =>
  filenames.map((filename) => bundle.photos[filename]).filter(Boolean);

const activityRowFromGraphEntity = (
  bundle: CimmichEvidenceBundle,
  entity: CimmichArchiveGraphEntity,
): CimmichActivityRow => ({
  aliases: entity.aliases ?? [],
  description: entity.description ?? '',
  documentCandidateCount: entity.documentCandidateCount ?? 0,
  filenames: entity.filenames ?? [],
  heroFilename: entity.heroFilename || entity.filenames?.[0],
  heroDescription: entity.heroDescription ?? '',
  id: entity.id,
  keywords: entity.keywords ?? [],
  label: entity.label,
  locationHints: entity.locationHints ?? [],
  matchCues: entity.matchCues ?? [],
  matchSignals: entity.matchSignals ?? {},
  peopleRoles: entity.peopleRoles ?? [],
  people: entity.people ?? {},
  photoMatches: entity.photoMatches ?? {},
  photos: photosFromFilenames(bundle, entity.filenames ?? []),
  places: entity.places ?? {},
  relatedConcepts: entity.relatedConcepts ?? [],
  routeHints: entity.routeHints ?? [],
  trips: entity.trips ?? {},
});

const petsObjectRowFromGraphEntity = (
  bundle: CimmichEvidenceBundle,
  entity: CimmichArchiveGraphEntity,
): CimmichPetsObjectRow => ({
  ...activityRowFromGraphEntity(bundle, entity),
  kind: entity.kind === 'pet' ? 'pet' : 'object',
});

const tripRowFromGraph = (bundle: CimmichEvidenceBundle, trip: CimmichArchiveGraphTrip): CimmichTripRow => ({
  activities: trip.activities ?? {},
  documentCandidateCount: trip.documentCandidateCount ?? 0,
  filenames: trip.filenames ?? [],
  gpsCount: trip.gpsCount ?? 0,
  label: trip.label,
  people: trip.people ?? {},
  photos: photosFromFilenames(bundle, trip.filenames ?? []),
  places: trip.places ?? {},
  visualCaptionCount: trip.visualCaptionCount ?? 0,
  years: trip.years ?? [],
});

const documentRowFromGraph = (document: CimmichArchiveGraphDocument): CimmichDocumentRow => ({
  filename: document.filename,
  mediaId: document.mediaId,
  people: document.people ?? [],
  score: document.score ?? 0,
  signals: document.signals ?? [],
  summaryText: document.summaryText ?? '',
  trip: document.trip ?? '',
  visualScene: document.visualScene,
  visualSetting: document.visualSetting,
});

export const buildCimmichTripsIndex = (bundle: CimmichEvidenceBundle, archiveGraph?: CimmichArchiveGraph) => {
  if (archiveGraph?.trips?.length) {
    return archiveGraph.trips.map((trip) => tripRowFromGraph(bundle, trip));
  }

  const trips = new Map<string, CimmichTripRow>();

  for (const photo of photosWithSummaries(bundle)) {
    const label = tripLabelForPhoto(photo);
    let trip = trips.get(label);
    if (!trip) {
      trip = {
        activities: {},
        documentCandidateCount: 0,
        filenames: [],
        gpsCount: 0,
        label,
        people: {},
        photos: [],
        places: {},
        visualCaptionCount: 0,
        years: [],
      };
      trips.set(label, trip);
    }

    trip.photos.push(photo);
    trip.filenames.push(filenameForPhoto(photo));
    trip.gpsCount += photo.summary?.exifStatus === 'gps_present' ? 1 : 0;
    trip.visualCaptionCount += photo.summary?.visualCaption ? 1 : 0;
    trip.documentCandidateCount += documentSignalsForPhoto(photo).length > 0 ? 1 : 0;

    const year = yearForPhoto(photo);
    if (year && !trip.years.includes(year)) {
      trip.years.push(year);
    }

    for (const person of peopleForPhoto(photo)) {
      increment(trip.people, person);
    }
    for (const activity of cimmichActivityDefinitions) {
      if (matchDefinitionSignals(activity, photo).length > 0) {
        increment(trip.activities, activity.name);
      }
    }
    increment(trip.places, photo.summary?.visualSetting || photo.summary?.visualScene);
  }

  return [...trips.values()].sort((a, b) => b.photos.length - a.photos.length || a.label.localeCompare(b.label));
};

const buildNamedEntityIndex = <T extends CimmichNamedEntityDefinition>(
  bundle: CimmichEvidenceBundle,
  definitions: T[],
) => {
  const rows = new Map<string, CimmichActivityRow & Partial<T>>();

  for (const definition of definitions) {
    rows.set(definition.id, {
      ...definition,
      documentCandidateCount: 0,
      filenames: [],
      heroDescription: '',
      keywords: [],
      label: definition.name,
      matchCues: definition.patterns.map((pattern) =>
        pattern.source
          .replaceAll(String.raw`\b`, '')
          .replaceAll('?', '')
          .replaceAll('(', '')
          .replaceAll(')', ''),
      ),
      matchSignals: {},
      peopleRoles: [],
      people: {},
      photoMatches: {},
      photos: [],
      places: {},
      trips: {},
    });
  }

  for (const photo of photosWithSummaries(bundle)) {
    for (const definition of definitions) {
      const signals = matchDefinitionSignals(definition, photo);
      if (signals.length === 0) {
        continue;
      }

      const row = rows.get(definition.id);
      if (!row) {
        continue;
      }

      row.photos.push(photo);
      row.filenames.push(filenameForPhoto(photo));
      row.documentCandidateCount += documentSignalsForPhoto(photo).length > 0 ? 1 : 0;
      row.heroFilename ??= filenameForPhoto(photo);
      increment(row.trips, tripLabelForPhoto(photo));
      increment(row.places, photo.summary?.visualSetting || photo.summary?.visualScene);
      for (const person of peopleForPhoto(photo)) {
        increment(row.people, person);
      }
      for (const signal of signals) {
        increment(row.matchSignals, signal);
      }
    }
  }

  return [...rows.values()].sort((a, b) => b.photos.length - a.photos.length || a.label.localeCompare(b.label));
};

export const buildCimmichActivitiesIndex = (bundle: CimmichEvidenceBundle, archiveGraph?: CimmichArchiveGraph) =>
  archiveGraph?.activities?.length
    ? archiveGraph.activities.map((activity) => activityRowFromGraphEntity(bundle, activity))
    : (buildNamedEntityIndex(bundle, cimmichActivityDefinitions) as CimmichActivityRow[]);

export const buildCimmichPetsObjectsIndex = (bundle: CimmichEvidenceBundle, archiveGraph?: CimmichArchiveGraph) =>
  archiveGraph?.petsObjects?.length
    ? archiveGraph.petsObjects.map((item) => petsObjectRowFromGraphEntity(bundle, item))
    : (buildNamedEntityIndex(bundle, cimmichPetsObjectDefinitions) as CimmichPetsObjectRow[]);

export const buildCimmichLegacyActionSignalsIndex = (
  bundle: CimmichEvidenceBundle,
  archiveGraph?: CimmichArchiveGraph,
) => {
  if (archiveGraph?.backendSignals?.length) {
    return archiveGraph.backendSignals.map((signal) => activityRowFromGraphEntity(bundle, signal));
  }

  const actions = new Map<string, CimmichActivityRow>();

  for (const photo of photosWithSummaries(bundle)) {
    for (const action of photo.summary?.visibleActions ?? []) {
      const key = action.trim().toLowerCase().replaceAll(/\s+/g, ' ');
      let row = actions.get(key);
      if (!row) {
        row = {
          aliases: [],
          description: 'Machine-visible action cue from the visual summary layer.',
          documentCandidateCount: 0,
          filenames: [],
          heroDescription: 'Machine-visible action cue from the visual summary layer.',
          id: key,
          keywords: [action.trim()],
          label: action.trim(),
          locationHints: [],
          matchCues: [action.trim()],
          matchSignals: {},
          peopleRoles: [],
          people: {},
          photoMatches: {},
          photos: [],
          places: {},
          relatedConcepts: [],
          routeHints: [],
          trips: {},
        };
        actions.set(key, row);
      }

      row.photos.push(photo);
      row.filenames.push(filenameForPhoto(photo));
      row.documentCandidateCount += documentSignalsForPhoto(photo).length > 0 ? 1 : 0;
      row.heroFilename ??= filenameForPhoto(photo);
      increment(row.trips, tripLabelForPhoto(photo));
      increment(row.places, photo.summary?.visualSetting || photo.summary?.visualScene);
      increment(row.matchSignals, action);
      for (const person of peopleForPhoto(photo)) {
        increment(row.people, person);
      }
    }
  }

  return [...actions.values()].sort((a, b) => b.photos.length - a.photos.length || a.label.localeCompare(b.label));
};

export const buildCimmichDocumentIndex = (bundle: CimmichEvidenceBundle, archiveGraph?: CimmichArchiveGraph) =>
  archiveGraph?.documents?.length
    ? archiveGraph.documents.map((document) => documentRowFromGraph(document))
    : photosWithSummaries(bundle)
        .map((photo): CimmichDocumentRow => {
          const signals = documentSignalsForPhoto(photo);
          return {
            filename: filenameForPhoto(photo),
            mediaId: photo.mediaId,
            people: [...new Set(peopleForPhoto(photo))],
            score: signals.length,
            signals,
            summaryText:
              photo.summary?.normalCaption || photo.summary?.visualCaption || photo.summary?.visualShortCaption || '',
            trip: tripLabelForPhoto(photo),
            visualScene: photo.summary?.visualScene,
            visualSetting: photo.summary?.visualSetting,
          };
        })
        .filter((row) => row.signals.length > 0)
        .sort((a, b) => b.score - a.score || a.filename.localeCompare(b.filename));
