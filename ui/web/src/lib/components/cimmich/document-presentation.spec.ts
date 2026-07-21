import { describe, expect, it } from 'vitest';
import { documentSubjectHref, formatDocumentBytes, labelForDocumentKind } from './document-presentation';

describe('Document presentation', () => {
  it('uses the user label only for Other documents', () => {
    expect(labelForDocumentKind('other', 'School record')).toBe('School record');
    expect(labelForDocumentKind('certificate', 'Ignored')).toBe('Certificate');
  });

  it('formats bounded file sizes without implying source bytes for references', () => {
    expect(formatDocumentBytes(null)).toBe('');
    expect(formatDocumentBytes(1536)).toBe('2 KB');
    expect(formatDocumentBytes(2_621_440)).toBe('2.5 MB');
  });

  it('routes every linked subject to its canonical profile', () => {
    const link = (subjectKind: 'event' | 'object' | 'person' | 'pet' | 'place') => ({
      displayName: 'Maya & friends',
      relationKind: 'about' as const,
      subjectId: `${subjectKind}_1`,
      subjectKind,
    });

    expect(documentSubjectHref(link('person'))).toBe('/cimmich/people/Maya%20%26%20friends?personId=person_1');
    expect(documentSubjectHref(link('pet'))).toBe('/cimmich/pets?entityId=pet_1');
    expect(documentSubjectHref(link('place'))).toBe('/cimmich/places?family=places&entityId=place_1');
    expect(documentSubjectHref(link('object'))).toBe('/cimmich/places?family=objects&entityId=object_1');
    expect(documentSubjectHref(link('event'))).toBe('/cimmich/events?family=events&entityId=event_1');
  });
});
