import { describe, expect, it } from 'vitest';
import type { CimmichPersonEvidenceCoverage } from '$lib/services/cimmich.service';
import { evidenceCoverageNotes, evidenceCoveragePercent, evidenceSourceReason } from './person-evidence-coverage';

const coverage = (): CimmichPersonEvidenceCoverage => ({
  assets: { body: 8, bodyOnly: 2, dated: 9, face: 7, head: 1, presence: 1, total: 10 },
  authority: {
    automaticIdentityAuthority: 'none',
    inference: 'none',
    repositoryWrites: 'none',
    sourceMutation: 'none',
  },
  context: { events: [], places: [], things: [] },
  observations: { body: 8, face: 12, head: 1, pose: 6, presence: 1 },
  person: { displayName: 'Maya', personId: 'person-maya' },
  references: { head: 1, lowQuality: 2, prime: 3, secondary: 6 },
  review: { bodyWithoutPose: 2, candidateFaces: 3, futureDates: 1 },
  schemaVersion: 'cimmich.person-evidence-coverage.v1',
  sourceSuggestions: [
    {
      box: { h: 0.2, w: 0.2, x: 0.4, y: 0.3 },
      bucketKind: 'prime',
      captureTime: '2024-03-01T00:00:00.000Z',
      faceId: 'face-maya',
      filename: 'maya.jpg',
      height: 1200,
      qualityScore: 0.91,
      sourceAssetId: 'source-maya',
      width: 1600,
    },
  ],
  time: { firstCaptureTime: null, lastCaptureTime: null, years: [] },
});

describe('Person Evidence & coverage presentation', () => {
  it('describes observation ratios without inventing a completeness score', () => {
    expect(evidenceCoveragePercent(7, 10)).toBe(70);
    expect(evidenceCoveragePercent(2, 0)).toBe(0);
  });

  it('separates genuine review work from neutral coverage notes', () => {
    const notes = evidenceCoverageNotes(coverage());
    expect(notes.map(({ kind, title }) => [kind, title])).toEqual([
      ['attention', 'Capture dates need review'],
      ['attention', 'Identity proposals are waiting'],
      ['coverage', 'Pose coverage is partial'],
    ]);
  });

  it('does not confuse a Head reference bucket with standalone Head evidence', () => {
    const value = coverage();
    value.observations.head = 0;
    expect(evidenceCoverageNotes(value).at(-1)?.title).toBe('No standalone Head evidence');
  });

  it('labels diverse source suggestions by accepted reference role and year', () => {
    expect(evidenceSourceReason(coverage().sourceSuggestions[0])).toBe('Core reference · 2024');
  });
});
