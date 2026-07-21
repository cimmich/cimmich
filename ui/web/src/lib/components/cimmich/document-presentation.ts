import type {
  CimmichDocumentLink,
  CimmichDocumentKind,
  CimmichDocumentRelationKind,
  CimmichDocumentSubjectKind,
} from '$lib/services/cimmich.service';

export const documentKindOptions: Array<{ label: string; value: CimmichDocumentKind }> = [
  { label: 'Veterinary', value: 'veterinary' },
  { label: 'Vaccination', value: 'vaccination' },
  { label: 'Registration', value: 'registration' },
  { label: 'Insurance', value: 'insurance' },
  { label: 'Adoption', value: 'adoption' },
  { label: 'Receipt', value: 'receipt' },
  { label: 'Care', value: 'care' },
  { label: 'Identity', value: 'identity' },
  { label: 'Lease', value: 'lease' },
  { label: 'Contract', value: 'contract' },
  { label: 'Certificate', value: 'certificate' },
  { label: 'Correspondence', value: 'correspondence' },
  { label: 'Financial', value: 'financial' },
  { label: 'Booking', value: 'booking' },
  { label: 'Manual', value: 'manual' },
  { label: 'Other', value: 'other' },
];

export const documentRelationOptions: Array<{ label: string; value: CimmichDocumentRelationKind }> = [
  { label: 'About', value: 'about' },
  { label: 'Belongs to', value: 'belongs_to' },
  { label: 'Issued to', value: 'issued_to' },
  { label: 'Applies to', value: 'applies_to' },
  { label: 'Related', value: 'related' },
];

export const documentSubjectLabels: Record<CimmichDocumentSubjectKind, string> = {
  event: 'event',
  object: 'object',
  person: 'person',
  pet: 'pet',
  place: 'place',
};

export const labelForDocumentKind = (kind: CimmichDocumentKind, customLabel?: string | null) =>
  kind === 'other' && customLabel
    ? customLabel
    : (documentKindOptions.find((option) => option.value === kind)?.label ?? 'Document');

export const formatDocumentDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(
        new Date(`${value}T00:00:00`),
      )
    : '';

export const formatDocumentBytes = (bytes: number | null) => {
  if (bytes === null) {
    return '';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
};

export const documentSubjectHref = (link: CimmichDocumentLink) => {
  if (link.subjectKind === 'person') {
    return `/cimmich/people/${encodeURIComponent(link.displayName)}?personId=${encodeURIComponent(link.subjectId)}`;
  }
  if (link.subjectKind === 'pet') {
    return `/cimmich/pets?entityId=${encodeURIComponent(link.subjectId)}`;
  }
  if (link.subjectKind === 'event') {
    return `/cimmich/events?family=events&entityId=${encodeURIComponent(link.subjectId)}`;
  }
  const family = link.subjectKind === 'object' ? 'objects' : 'places';
  return `/cimmich/places?family=${family}&entityId=${encodeURIComponent(link.subjectId)}`;
};
