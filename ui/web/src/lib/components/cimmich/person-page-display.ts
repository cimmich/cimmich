import type { CimmichPersonPhoto } from '$lib/services/cimmich-evidence.service';
import type { CimmichIdentityFace } from '$lib/services/cimmich.service';

export type CountRow = { count: number; label: string };

export const clampPercent = (value: number) => Math.max(0, Math.min(100, value));

export const cimmichQcLabel = (face: CimmichIdentityFace, flag: CimmichIdentityFace['qc_flags'][number]) => {
  if (flag === 'tiny_face') {
    return `${Math.min(face.face_pixel_width, face.face_pixel_height)}px`;
  }
  if (flag === 'low_detection_confidence') {
    return 'Low confidence';
  }
  if (flag === 'low_quality') {
    return 'Low quality';
  }
  if (flag === 'nearby_face') {
    return face.nearby_face_count > 1 ? `${face.nearby_face_count} nearby faces` : 'Nearby face';
  }
  return `Imported #${face.source_instance_suffix}`;
};

export const countRows = (counts: Record<string, number>, limit = 8): CountRow[] =>
  Object.entries(counts)
    .map(([label, count]) => ({ count, label }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);

export const bucketLabel = (bucket: string) =>
  bucket
    .replace(/^face_/, '')
    .replace(/^reject_/, '')
    .replaceAll('_', ' ');

export const normalizeName = (value: string | undefined) => (value ?? '').trim().replaceAll(/\s+/g, ' ');

export const sameName = (left: string | undefined, right: string | undefined) =>
  normalizeName(left).toLowerCase() === normalizeName(right).toLowerCase();

export const nameInList = (names: string[] | undefined, name: string | undefined) =>
  (names ?? []).some((row) => sameName(row, name));

export const personNamesForPhoto = (photo: CimmichPersonPhoto, personName?: string) => {
  const names = new Set<string>([
    ...(photo.evidence.summary?.sourcePeople ?? []),
    ...(photo.evidence.summary?.candidatePeople ?? []),
  ]);
  for (const face of photo.evidence.faceOverlays ?? []) {
    if (face.status === 'named') {
      names.add(face.name);
    }
  }
  for (const body of photo.evidence.bodyOverlays ?? []) {
    if (body.status === 'linked') {
      names.add(body.linkedName);
    }
  }
  return [...names].filter((name) => name && name !== personName);
};

export const unresolvedFaceCount = (photo: CimmichPersonPhoto) =>
  photo.evidence.faceOverlays?.filter((face) => face.status === 'sidecar_only' || face.status === 'untagged').length ??
  0;

export const photoEvidenceLabels = (photo: CimmichPersonPhoto, personName?: string) => {
  const labels: string[] = [];
  const isSource = photo.evidence.summary?.sourcePeople?.includes(personName ?? '');
  const isCandidate = photo.evidence.summary?.candidatePeople?.includes(personName ?? '');
  const bodyObservationCount = photo.evidence.bodyOverlays?.length ?? 0;
  if (photo.faceOverlays.length > 0) {
    labels.push(`${photo.faceOverlays.length} face`);
  }
  if (photo.bodyLinks.length > 0) {
    labels.push(`${photo.bodyLinks.length} body`);
  } else if (bodyObservationCount > 0) {
    labels.push(`${bodyObservationCount} body obs`);
  }
  if (isSource) {
    labels.push('source');
  } else if (isCandidate) {
    labels.push('candidate');
  }
  if (photo.qcStatus && photo.qcStatus !== 'ready_for_cimmich') {
    labels.push(photo.qcStatus.replaceAll('_', ' '));
  }
  const unresolved = unresolvedFaceCount(photo);
  if (unresolved > 0) {
    labels.push(`${unresolved} unresolved`);
  }
  return labels;
};
