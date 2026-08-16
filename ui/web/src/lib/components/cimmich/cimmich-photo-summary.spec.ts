import { describe, expect, it } from 'vitest';
import {
  cimmichSummaryQc,
  compileCimmichModelSummary,
  compileCimmichOcrReadings,
  compileCimmichStandardSummary,
} from './cimmich-photo-summary';

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
  it('exposes cleaned OCR readings in visual reading order for the Summary panel', () => {
    expect(
      compileCimmichOcrReadings([
        { text: 'Palace', x1: 80, x2: 90, x3: 90, x4: 80, y1: 60, y2: 60, y3: 70, y4: 70 },
        { text: 'ThePinkPalace.com', x1: 10, x2: 70, x3: 70, x4: 10, y1: 60, y2: 60, y3: 70, y4: 70 },
        { text: '.', x1: 0, x2: 1, x3: 1, x4: 0, y1: 0, y2: 0, y3: 1, y4: 1 },
        { text: 'WELCOME', x1: 20, x2: 60, x3: 60, x4: 20, y1: 20, y2: 20, y3: 30, y4: 30 },
        { text: 'welcome', x1: 20, x2: 60, x3: 60, x4: 20, y1: 40, y2: 40, y3: 50, y4: 50 },
      ] as never),
    ).toEqual(['WELCOME', 'ThePinkPalace.com']);
  });

  it('rebuilds Standard from current owner-approved facts and OCR', () => {
    const text = compileCimmichStandardSummary({
      asset: { exifInfo: { city: 'Sydney', dateTimeOriginal: '2024-03-12T10:00:00Z' } } as never,
      evidence,
      ocr: [{ text: 'JETTY' }] as never,
    });
    expect(text).toBe('Ted is pictured with Harbour Boat in Sydney on March 12, 2024. Visible text includes “JETTY”.');
    expect(text).not.toMatch(/Face needs|Faces need|Body needs|Bodies need|review/i);
  });

  it('uses natural articles and never mixes review workload into Standard', () => {
    const text = compileCimmichStandardSummary({
      asset: {
        exifInfo: {
          city: 'Káto Garoúna',
          country: 'Greece',
          dateTimeOriginal: '2025-12-24T12:35:23Z',
          state: 'Ionian Islands',
        },
      } as never,
      evidence: {
        bodies: [{ display_name: null, person_id: null }],
        contexts: [{ display_name: 'ATV', entity_kind: 'object' }],
        faces: [
          { display_name: 'Benji Hart', rejected_identity_claim_id: null, review_disposition: 'active' },
          { display_name: null, rejected_identity_claim_id: null, review_disposition: 'active' },
        ],
        presence: [],
      } as never,
      ocr: [],
    });
    expect(text).toBe(
      'Benji Hart is pictured with an ATV in Káto Garoúna, Ionian Islands, Greece on December 24, 2025.',
    );
    expect(text).not.toMatch(/review|missing|needs/i);
  });

  it('orders useful OCR text and drops punctuation and one-character noise', () => {
    const text = compileCimmichStandardSummary({
      asset: { exifInfo: {} } as never,
      evidence: { bodies: [], contexts: [], faces: [], presence: [] } as never,
      ocr: [
        { text: 'JETTY', x1: 0.6, x2: 0.8, x3: 0.8, x4: 0.6, y1: 0.2, y2: 0.2, y3: 0.3, y4: 0.3 },
        { text: '•', x1: 0.1, x2: 0.2, x3: 0.2, x4: 0.1, y1: 0.1, y2: 0.1, y3: 0.2, y4: 0.2 },
        { text: 'WELCOME', x1: 0.1, x2: 0.4, x3: 0.4, x4: 0.1, y1: 0.2, y2: 0.2, y3: 0.3, y4: 0.3 },
        { text: 'R', x1: 0.1, x2: 0.2, x3: 0.2, x4: 0.1, y1: 0.4, y2: 0.4, y3: 0.5, y4: 0.5 },
      ] as never,
    });
    expect(text).toBe('Visible text includes “WELCOME”, “JETTY”.');
  });

  it('keeps a complete OCR reading instead of repeating its component boxes', () => {
    const text = compileCimmichStandardSummary({
      asset: { exifInfo: {} } as never,
      evidence: { bodies: [], contexts: [], faces: [], presence: [] } as never,
      ocr: [
        { text: 'The' },
        { text: 'pink' },
        { text: 'Palace' },
        { text: 'CORFU GREECE' },
        { text: 'ThePinkPalace.com' },
      ] as never,
    });
    expect(text).toBe('Visible text includes “CORFU GREECE”, “ThePinkPalace.com”.');
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
    expect(text).toContain('Visible text includes “JETTY”.');
    expect(cimmichSummaryQc(evidence, analysis)).toMatchObject({ missingBodies: 1, missingFaces: 1 });
  });

  it('merges stored and Immich OCR without repeating text already used in model prose', () => {
    const analysis = {
      current: true,
      visualFacts: {
        activities: [],
        objects: [],
        peopleCountEstimate: 0,
        qualityFlags: [],
        scene: 'sign',
        summary: 'A sign reads JETTY.',
        visibleText: ['JETTY', 'WELCOME'],
      },
    } as never;
    const text = compileCimmichModelSummary({
      analysis,
      asset: { exifInfo: {} } as never,
      evidence: { bodies: [], contexts: [], faces: [], presence: [] } as never,
      ocr: [{ text: 'welcome' }, { text: '-' }] as never,
    });
    expect(text).toBe('A sign reads JETTY. Visible text includes “welcome”.');
  });

  it('composes Smart facts and current owner truth into natural conservative prose', () => {
    const analysis = {
      current: true,
      tier: 'smart',
      visualFacts: {
        activities: [],
        objects: ['blue sky', 'crowd', 'headgear', 'helmet', 'atv'],
        peopleCountEstimate: 2,
        qualityFlags: [],
        scene: 'outdoors',
        summary: '2 people are visible outdoors. Visible details include atv and helmet.',
        visibleText: [],
      },
    } as never;
    const text = compileCimmichModelSummary({
      analysis,
      asset: {
        exifInfo: {
          city: 'Káto Garoúna',
          country: 'Greece',
          dateTimeOriginal: '2025-12-24T12:35:23Z',
          state: 'Ionian Islands',
        },
      } as never,
      evidence: {
        bodies: [
          { display_name: 'Benji Hart', person_id: 'person-benji' },
          { display_name: 'Jani - Hup', person_id: 'person-jani' },
        ],
        contexts: [{ display_name: 'ATV', entity_kind: 'object' }],
        faces: [],
        presence: [],
      } as never,
      ocr: [],
    });
    expect(text).toBe(
      'Benji Hart and Jani - Hup are outdoors with an ATV under a blue sky in Káto Garoúna, Ionian Islands, Greece on December 24, 2025. A helmet is also visible.',
    );
    expect(text).not.toMatch(/Visible details|Known things|Taken|Location:/);
    expect(text.match(/ATV/g)).toHaveLength(1);
  });

  it('lets a specific owner object supersede its generic visual label', () => {
    const text = compileCimmichModelSummary({
      analysis: {
        current: true,
        tier: 'smart',
        visualFacts: {
          activities: [],
          objects: ['boat'],
          peopleCountEstimate: 0,
          qualityFlags: [],
          scene: 'outdoors',
          summary: 'No person is clearly detected outdoors. Visible details include boat.',
          visibleText: [],
        },
      } as never,
      asset: { exifInfo: {} } as never,
      evidence: {
        bodies: [],
        contexts: [{ display_name: 'Harbour Boat', entity_kind: 'object' }],
        faces: [],
        presence: [],
      } as never,
      ocr: [],
    });
    expect(text).toBe('Harbour Boat is pictured outdoors.');
  });

  it('uses a Smart activity only when it exists in structured evidence', () => {
    const text = compileCimmichModelSummary({
      analysis: {
        current: true,
        tier: 'smart',
        visualFacts: {
          activities: ['walking'],
          objects: ['backpack'],
          peopleCountEstimate: 1,
          qualityFlags: [],
          scene: 'dirt road',
          summary: 'One person is visible on a dirt road.',
          visibleText: [],
        },
      } as never,
      asset: { exifInfo: { city: 'Sydney' } } as never,
      evidence: {
        bodies: [],
        contexts: [],
        faces: [{ display_name: 'Ted', person_id: 'person-ted', review_disposition: 'active' }],
        presence: [],
      } as never,
      ocr: [],
    });
    expect(text).toBe('Ted is walking on a dirt road in Sydney. A backpack is also visible.');
  });

  it('describes non-person Smart scenes without inventing relationships', () => {
    const text = compileCimmichModelSummary({
      analysis: {
        current: true,
        tier: 'smart',
        visualFacts: {
          activities: [],
          objects: ['dog', 'tennis ball', 'grass', 'frame', 'light'],
          peopleCountEstimate: 0,
          qualityFlags: [],
          scene: 'outdoors',
          summary: 'No person is clearly detected outdoors. Visible details include dog, tennis ball, grass.',
          visibleText: [],
        },
      } as never,
      asset: { exifInfo: {} } as never,
      evidence: { bodies: [], contexts: [], faces: [], presence: [] } as never,
      ocr: [],
    });
    expect(text).toBe('A dog and a tennis ball are pictured outdoors. Grass is also visible.');
  });

  it('preserves richer relational prose from a custom Smart provider', () => {
    const text = compileCimmichModelSummary({
      analysis: {
        current: true,
        model: { providerId: 'owner-fast-vlm' },
        tier: 'smart',
        visualFacts: {
          activities: ['riding an ATV'],
          objects: ['ATV'],
          peopleCountEstimate: 2,
          qualityFlags: [],
          scene: 'outdoors',
          summary: '{{person:person-ted}} rides an ATV with another person behind him.',
          visibleText: [],
        },
      } as never,
      asset: { exifInfo: {} } as never,
      evidence,
      ocr: [],
    });
    expect(text).toBe('Ted rides an ATV with another person behind him. Known things: Harbour Boat.');
  });

  it('keeps named group Smart summaries bounded', () => {
    const text = compileCimmichModelSummary({
      analysis: {
        current: true,
        tier: 'smart',
        visualFacts: {
          activities: [],
          objects: ['bottle', 'crowd'],
          peopleCountEstimate: 6,
          qualityFlags: [],
          scene: 'indoor room',
          summary: '6 people are visible in an indoor room. Visible details include bottle, crowd.',
          visibleText: [],
        },
      } as never,
      asset: { exifInfo: {} } as never,
      evidence: {
        bodies: [],
        contexts: [],
        faces: ['Aaron', 'Benji', 'Deedee', 'Mike', 'Sophie', 'Tom'].map((display_name, index) => ({
          display_name,
          person_id: `person-${index}`,
          review_disposition: 'active',
        })),
        presence: [],
      } as never,
      ocr: [],
    });
    expect(text).toBe('Aaron, Benji, Deedee, and 3 others are in an indoor room. A bottle is also visible.');
  });

  it('resolves stable Enhanced identity tokens to the current display name', () => {
    const analysis = {
      current: true,
      tier: 'enhanced',
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

  it('fills a bounded anonymous Enhanced subject after that Person is named', () => {
    const analysis = {
      current: true,
      tier: 'enhanced',
      visualFacts: {
        activities: ['riding'],
        objects: ['atv'],
        peopleCountEstimate: 2,
        qualityFlags: [],
        scene: 'outdoors',
        summary: '{{person:person-ted}} rides an ATV with another person behind him.',
        visibleText: [],
      },
    } as never;
    const text = compileCimmichModelSummary({
      analysis,
      asset: { exifInfo: {} } as never,
      evidence: {
        ...(evidence as unknown as Record<string, unknown>),
        faces: [
          { display_name: 'Ted', person_id: 'person-ted' },
          { display_name: 'Jani - Hup', person_id: 'person-jani' },
        ],
      } as never,
      ocr: [],
    });
    expect(text).toContain('Ted rides an ATV with Jani - Hup behind him.');
    expect(text).not.toContain('another person');
  });

  it('preserves Enhanced relationships while weaving current owner metadata naturally', () => {
    const text = compileCimmichModelSummary({
      analysis: {
        current: true,
        tier: 'enhanced',
        visualFacts: {
          activities: ['riding an ATV', 'smiling'],
          objects: ['green ATV', 'helmets', 'sunglasses', 'wristwatch', 'sneakers'],
          peopleCountEstimate: 2,
          qualityFlags: ['water droplets on lens'],
          scene: 'outdoors',
          summary:
            '{{person:person-benji}} rides a green ATV with another person behind him under a clear blue sky. Both wear helmets and sunglasses, and water droplets are visible on the camera lens.',
          visibleText: [],
        },
      } as never,
      asset: {
        exifInfo: {
          city: 'Káto Garoúna',
          country: 'Greece',
          dateTimeOriginal: '2025-12-24T12:35:23Z',
          state: 'Ionian Islands',
        },
      } as never,
      evidence: {
        bodies: [],
        contexts: [{ display_name: 'ATV', entity_kind: 'object' }],
        faces: [
          { display_name: 'Benji Hart', person_id: 'person-benji', review_disposition: 'active' },
          { display_name: 'Jani - Hup', person_id: 'person-jani', review_disposition: 'active' },
        ],
        presence: [],
      } as never,
      ocr: [],
    });
    expect(text).toBe(
      'Benji Hart rides a green ATV with Jani - Hup behind him under a clear blue sky in Káto Garoúna, Ionian Islands, Greece on December 24, 2025. Both wear helmets and sunglasses, and water droplets are visible on the camera lens.',
    );
    expect(text).not.toMatch(/Known things|Known people|Taken|Location:/);
    expect(text.match(/ATV/g)).toHaveLength(1);
  });

  it('replaces a generic Enhanced object with its current owner-recorded name', () => {
    const text = compileCimmichModelSummary({
      analysis: {
        current: true,
        tier: 'enhanced',
        visualFacts: {
          activities: ['standing'],
          objects: ['boat'],
          peopleCountEstimate: 1,
          qualityFlags: [],
          scene: 'marina',
          summary: '{{person:person-ted}} stands beside a boat.',
          visibleText: [],
        },
      } as never,
      asset: { exifInfo: { city: 'Sydney', dateTimeOriginal: '2024-03-12T10:00:00Z' } } as never,
      evidence: {
        bodies: [],
        contexts: [{ display_name: 'Harbour Boat', entity_kind: 'object' }],
        faces: [{ display_name: 'Ted', person_id: 'person-ted', review_disposition: 'active' }],
        presence: [],
      } as never,
      ocr: [],
    });
    expect(text).toBe('Ted stands beside Harbour Boat in Sydney on March 12, 2024.');
  });
});
