export type CimmichPersonPhotoContext = {
  personId: string;
  personName: string;
};

export type NamedPhotoPresence = {
  kind: 'person' | 'pet';
  name: string;
};

export type PhotoTagType = 'Body' | 'Face' | 'Head' | 'Presence';

export const projectFaceReviewSimilarity = (score: number | null | undefined) =>
  typeof score === 'number' && Number.isFinite(score) ? score.toFixed(2) : 'No comparison';

export type FaceDetailsPanelPlacement = {
  left: number;
  maxHeight: number;
  top: number;
  width: number;
};

export type ManualTagPanelPlacement = {
  left: number;
  maxHeight: number;
  top: number;
  width: number;
};

type FaceDetailsPanelPlacementInput = {
  editing: boolean;
  face: { bottom: number; left: number; right: number };
  overlay: { height: number; width: number };
  preferredWidth?: number;
};

type ManualTagPanelPlacementInput = {
  marker: { right: number; top: number };
  overlay: { height: number; width: number };
};

type PhotoTagSubject = {
  id: string;
  name: string;
};

type PhotoTagSources = {
  bodies: Array<{ name?: string }>;
  faces: Array<{ name?: string; subjectId?: string }>;
  heads: Array<{ name?: string; subjectId?: string }>;
  presences: Array<{ subjectId: string }>;
};

type TypedManualTagSummaryInput = {
  subject: { displayName: string };
  tagType: 'body' | 'face' | 'head' | 'presence';
};

export type TypedManualTagSummary = {
  bodyCount: number;
  faceCount: number;
  headCount: number;
  presenceCount: number;
  presenceNames: string[];
};

type PhotoOverlayZoomState = {
  currentPositionX: number;
  currentPositionY: number;
  currentZoom: number;
};

type BodyOverlayPresentation = {
  bbox: { x1: number; x2: number; y1: number; y2: number };
  image?: { height: number; width: number } | null;
  name: string;
};

type AuthoredBodyTagPresentation = {
  geometry: { h: number; w: number; x: number; y: number };
  name: string;
};

const normalizePersonName = (value: string | undefined) =>
  (value ?? '').trim().replaceAll(/\s+/g, ' ').toLocaleLowerCase();

export const authoredBodyTagRepresentsOverlay = (body: BodyOverlayPresentation, tag: AuthoredBodyTagPresentation) => {
  if (!normalizePersonName(body.name) || normalizePersonName(body.name) !== normalizePersonName(tag.name)) {
    return false;
  }

  const bodyBox = body.image
    ? {
        x1: body.bbox.x1 / body.image.width,
        x2: body.bbox.x2 / body.image.width,
        y1: body.bbox.y1 / body.image.height,
        y2: body.bbox.y2 / body.image.height,
      }
    : body.bbox;
  const tagBox = {
    x1: tag.geometry.x,
    x2: tag.geometry.x + tag.geometry.w,
    y1: tag.geometry.y,
    y2: tag.geometry.y + tag.geometry.h,
  };
  const intersectionWidth = Math.max(0, Math.min(bodyBox.x2, tagBox.x2) - Math.max(bodyBox.x1, tagBox.x1));
  const intersectionHeight = Math.max(0, Math.min(bodyBox.y2, tagBox.y2) - Math.max(bodyBox.y1, tagBox.y1));
  const intersectionArea = intersectionWidth * intersectionHeight;
  const bodyArea = Math.max(0, bodyBox.x2 - bodyBox.x1) * Math.max(0, bodyBox.y2 - bodyBox.y1);
  const tagArea = Math.max(0, tag.geometry.w) * Math.max(0, tag.geometry.h);
  const smallerArea = Math.min(bodyArea, tagArea);

  return smallerArea > 0 && intersectionArea / smallerArea >= 0.5;
};

export const projectPhotoOverlayZoomStyle = ({
  currentPositionX,
  currentPositionY,
  currentZoom,
}: PhotoOverlayZoomState) =>
  `--cimmich-overlay-inverse-zoom: ${1 / currentZoom}; transform-origin: 0 0; transform: translate(${currentPositionX}px, ${currentPositionY}px) scale(${currentZoom});`;

export const projectTypedManualTagSummary = (tags: TypedManualTagSummaryInput[]): TypedManualTagSummary => {
  const presenceNames = new Map<string, string>();
  let bodyCount = 0;
  let faceCount = 0;
  let headCount = 0;
  let presenceCount = 0;

  for (const tag of tags) {
    switch (tag.tagType) {
      case 'body': {
        bodyCount += 1;
        break;
      }
      case 'face': {
        faceCount += 1;
        break;
      }
      case 'head': {
        headCount += 1;
        break;
      }
      case 'presence': {
        presenceCount += 1;
        const name = tag.subject.displayName.trim();
        const normalized = normalizePersonName(name);
        if (normalized && !presenceNames.has(normalized)) {
          presenceNames.set(normalized, name);
        }
      }
    }
  }

  return { bodyCount, faceCount, headCount, presenceCount, presenceNames: [...presenceNames.values()] };
};

export const projectFaceEditorPersonDraft = ({
  acceptedName,
  candidateName: _,
}: {
  acceptedName?: string | null;
  candidateName?: string | null;
}) => acceptedName?.trim() ?? '';

export const placeFaceDetailsPanel = ({
  editing,
  face,
  overlay,
  preferredWidth = 260,
}: FaceDetailsPanelPlacementInput): FaceDetailsPanelPlacement => {
  const margin = 12;
  const gap = 10;
  const toolbarClearance = 96;
  const width = Math.min(Math.max(260, preferredWidth), Math.max(0, overlay.width - margin * 2));
  const leftCandidate = face.left - gap - width;
  const rightCandidate = face.right + gap;
  const canFitLeft = leftCandidate >= margin;
  const canFitRight = rightCandidate + width <= overlay.width - margin;
  const roomLeft = face.left - margin;
  const roomRight = overlay.width - margin - face.right;

  const preferredLeft =
    canFitLeft && canFitRight
      ? roomRight >= roomLeft
        ? rightCandidate
        : leftCandidate
      : canFitRight
        ? rightCandidate
        : canFitLeft
          ? leftCandidate
          : (face.left + face.right - width) / 2;
  const left = Math.min(Math.max(margin, preferredLeft), Math.max(margin, overlay.width - width - margin));

  const availableHeight = Math.max(0, overlay.height - toolbarClearance - margin);
  const targetHeight = Math.min(editing ? 600 : 260, availableHeight);
  const latestTop = Math.max(toolbarClearance, overlay.height - targetHeight - margin);
  const top = Math.min(Math.max(toolbarClearance, face.bottom + gap), latestTop);

  return {
    left,
    maxHeight: Math.max(0, overlay.height - top - margin),
    top,
    width,
  };
};

export const placeManualTagPanel = ({ marker, overlay }: ManualTagPanelPlacementInput): ManualTagPanelPlacement => {
  const margin = 12;
  const toolbarClearance = 72;
  const gap = 12;
  const editingHeight = 520;
  const width = Math.min(320, Math.max(0, overlay.width - margin * 2));
  const left = Math.min(Math.max(margin, marker.right + gap), Math.max(margin, overlay.width - width - margin));
  const top = Math.min(
    Math.max(toolbarClearance, marker.top),
    Math.max(toolbarClearance, overlay.height - editingHeight),
  );

  return {
    left,
    maxHeight: Math.max(0, overlay.height - top - margin),
    top,
    width,
  };
};

export const stopPhotoViewerShortcutPropagation = (event: Pick<KeyboardEvent, 'stopPropagation'>) => {
  event.stopPropagation();
};

export const getCimmichPersonPhotoContext = (url: URL): CimmichPersonPhotoContext | undefined => {
  const personId = url.searchParams.get('cimmichPersonId')?.trim();
  const personName = url.searchParams.get('cimmichPersonName')?.trim();
  return personId && personName ? { personId, personName } : undefined;
};

export const getCimmichPetPhotoContext = (url: URL) => {
  const petId = url.searchParams.get('cimmichPetId')?.trim();
  const petName = url.searchParams.get('cimmichPetName')?.trim();
  return petId && petName ? { petId, petName } : undefined;
};

export const isCimmichViewingSurface = (url: URL) =>
  url.pathname.startsWith('/cimmich') ||
  Boolean(getCimmichPersonPhotoContext(url)) ||
  Boolean(getCimmichPetPhotoContext(url));

export const matchesCimmichPersonPhotoContext = (
  context: CimmichPersonPhotoContext | undefined,
  personName: string | undefined,
) => Boolean(context && normalizePersonName(context.personName) === normalizePersonName(personName));

export const isNamedFace = (face: { name?: string; status: string }) =>
  face.status === 'named' && Boolean(normalizePersonName(face.name));

export const isNamedBody = (body: { linkedName?: string; status: string }) =>
  body.status === 'linked' && Boolean(normalizePersonName(body.linkedName));

export const projectPhotoTagTypes = (
  subject: PhotoTagSubject,
  { bodies, faces, heads, presences }: PhotoTagSources,
): PhotoTagType[] => {
  const name = normalizePersonName(subject.name);
  const types: PhotoTagType[] = [];
  if (faces.some((face) => face.subjectId === subject.id || (name && normalizePersonName(face.name) === name))) {
    types.push('Face');
  }
  if (name && bodies.some((body) => normalizePersonName(body.name) === name)) {
    types.push('Body');
  }
  if (heads.some((head) => head.subjectId === subject.id || (name && normalizePersonName(head.name) === name))) {
    types.push('Head');
  }
  if (presences.some((presence) => presence.subjectId === subject.id)) {
    types.push('Presence');
  }
  return types;
};

export const projectNamedPhotoPresence = (
  rows: Array<{ kind: string; personName?: string; reason?: string }>,
  representedNames: Iterable<string>,
): NamedPhotoPresence[] => {
  const represented = new Set([...representedNames].map((name) => normalizePersonName(name)));
  const projected = new Map<string, NamedPhotoPresence>();

  for (const row of rows) {
    const normalized = normalizePersonName(row.personName);
    if (row.kind !== 'accepted_presence' || !normalized || represented.has(normalized)) {
      continue;
    }
    const kind = row.reason === 'manual_pet' ? 'pet' : 'person';
    const existing = projected.get(normalized);
    if (!existing || kind === 'pet') {
      projected.set(normalized, { kind, name: (row.personName ?? '').trim() });
    }
  }

  return [...projected.values()];
};

const errorCode = (value: unknown) =>
  typeof value === 'object' && value !== null && 'code' in value && typeof value.code === 'string'
    ? value.code
    : undefined;

export const photoEvidenceLoadErrorMessage = (error: unknown) => {
  const cause = error instanceof Error ? error.cause : undefined;
  if (errorCode(error) === 'ASSET_DISPLAY_NOT_FOUND' || errorCode(cause) === 'ASSET_DISPLAY_NOT_FOUND') {
    return 'Cimmich details are not available in this viewing mode.';
  }
  return error instanceof Error ? error.message : 'Cimmich details could not be loaded.';
};
