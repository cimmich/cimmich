import { describe, expect, it } from 'vitest';
import { cimmichImportedLocationLabel, cimmichPhotoReviewContextLabel } from './photo-review-context';

describe('photo review context', () => {
  it('uses a compact month/year and the confirmed Cimmich Place', () => {
    expect(
      cimmichPhotoReviewContextLabel({
        captureTime: '2023-05-14T12:00:00.000Z',
        location: { entityId: 'place_1', label: 'Agios Gordios', provenance: 'cimmich_place' },
      }),
    ).toMatch(/^May 2023 · Agios Gordios$/);
  });

  it('does not add noisy placeholders when only one fact is available', () => {
    expect(cimmichPhotoReviewContextLabel({ captureTime: null, importedLocationLabel: 'Corfu', location: null })).toBe(
      'Corfu',
    );
    expect(cimmichPhotoReviewContextLabel(undefined, null)).toBe('');
  });

  it('prefers the most local imported EXIF label', () => {
    expect(
      cimmichImportedLocationLabel({
        exifInfo: { city: 'Corfu', country: 'Greece', state: 'Ionian Islands' },
      } as never),
    ).toBe('Corfu');
  });
});
