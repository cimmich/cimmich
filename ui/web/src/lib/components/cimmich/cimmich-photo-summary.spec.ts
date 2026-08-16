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

  it('weaves current names into count-based Smart prose', () => {
    const analysis = {
      current: true,
      visualFacts: {
        activities: [],
        objects: ['atv'],
        peopleCountEstimate: 2,
        qualityFlags: [],
        scene: 'outdoors',
        summary: '2 people are visible outdoors. Visible details include atv and helmet.',
        visibleText: [],
      },
    } as never;
    const text = compileCimmichModelSummary({
      analysis,
      asset: { exifInfo: {} } as never,
      evidence,
      ocr: [],
    });
    expect(text).toContain('Ted and another person are visible outdoors.');
    expect(text).not.toContain('Known people:');
  });

  it('resolves stable Enhanced identity tokens to the current display name', () => {
    const analysis = {
      current: true,
      visualFacts: {
        activities: ['riding'],
        objects: ['atv'],
        peopleCountEstimate: 2,
        qualityFlags: [],
        scene: 'outdoors',
        summary: '{{person:person-ted}} and another person ride an ATV.',
        visibleText: [],
      },
    } as never;
    const text = compileCimmichModelSummary({
      analysis,
      asset: { exifInfo: {} } as never,
      evidence,
      ocr: [],
    });
    expect(text).toContain('Ted and another person ride an ATV.');
    expect(text).not.toContain('{{person:');
  });
});
