import { describe, expect, it } from 'vitest';
import { cimmichSummaryQc, compileCimmichModelSummary, compileCimmichStandardSummary } from './cimmich-photo-summary';

const evidence = {
  bodies: [
    { display_name: 'Ted', person_id: 'person-ted' },
    { display_name: null, person_id: null },
  ],
  contexts: [
    {
      association_kind: 'manual',
      display_name: 'Harbour Boat',
      entity_id: 'boat-1',
      entity_kind: 'object',
      type_kind: 'vehicle',
    },
  ],
  faces: [
    { display_name: 'Ted', rejected_identity_claim_id: null, review_disposition: 'active' },
    { display_name: null, rejected_identity_claim_id: null, review_disposition: 'active' },
  ],
  presence: [],
} as never;

describe('photo summary compiler', () => {
  it('rebuilds Standard from current owner-approved facts and OCR', () => {
    const text = compileCimmichStandardSummary({
      asset: { exifInfo: { city: 'Sydney', dateTimeOriginal: '2024-03-12T10:00:00Z' } } as never,
      evidence,
      ocr: [{ text: 'JETTY' }] as never,
    });
    expect(text).toContain('Ted is in this photo.');
    expect(text).toContain('Known things: Harbour Boat.');
    expect(text).toContain('Location: Sydney.');
    expect(text).toContain('Visible text: “JETTY”.');
  });

  it('adds current names to stored visual facts without mutating the model record', () => {
    const analysis = {
      current: true,
      visualFacts: {
        activities: [],
        objects: ['boat'],
        peopleCountEstimate: 3,
        qualityFlags: [],
        scene: 'harbour',
        summary: 'A person in green shorts stands beside a boat',
        visibleText: [],
      },
    } as never;
    const text = compileCimmichModelSummary({
      analysis,
      asset: { exifInfo: { city: 'Sydney', dateTimeOriginal: '2024-03-12T10:00:00Z' } } as never,
      evidence,
      ocr: [{ text: 'JETTY' }] as never,
    });
    expect(text).toContain('Known people: Ted.');
    expect(text).toContain('Location: Sydney.');
    expect(text).toContain('Visible text: “JETTY”.');
    expect(cimmichSummaryQc(evidence, analysis)).toMatchObject({ missingBodies: 1, missingFaces: 1 });
  });
});
