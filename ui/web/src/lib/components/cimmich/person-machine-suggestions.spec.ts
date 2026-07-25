import { describe, expect, it } from 'vitest';
import type { CimmichMachineSuggestion } from '$lib/services/cimmich.service';
import { machineSuggestionCountsByLead, machineSuggestionsForPerson } from './person-machine-suggestions';

const suggestion = (
  faceId: string,
  ...people: Array<{ displayName: string; personId: string; score: number }>
): CimmichMachineSuggestion => ({
  asset_id: `asset-${faceId}`,
  box_h: 0.2,
  box_w: 0.2,
  box_x: 0.1,
  box_y: 0.1,
  candidates: people.map((person, index) => ({
    display_name: person.displayName,
    person_id: person.personId,
    prime_score: person.score,
    prime_top3_score: person.score,
    prototype_score: null,
    rank: index + 1,
    raw_prime_score: person.score,
    secondary_score: null,
  })),
  capture_time: null,
  detection_confidence: 0.9,
  face_id: faceId,
  filename: `${faceId}.jpg`,
  height: 1000,
  margin: 0.3,
  media_kind: 'image',
  quality_measurements: {},
  quality_score: 0.9,
  review_reason: 'strong_lead',
  sourceAssetId: `source-${faceId}`,
  width: 1000,
});

describe('person machine suggestions', () => {
  const suggestions = [
    suggestion('face-1', { displayName: 'Maya', personId: 'person-maya', score: 0.7 }),
    suggestion(
      'face-2',
      { displayName: 'Alex', personId: 'person-alex', score: 0.8 },
      { displayName: 'Maya', personId: 'person-maya', score: 0.2 },
    ),
    suggestion('face-3', { displayName: 'Maya', personId: 'person-maya', score: 0.6 }),
  ];

  it('counts only the leading suggested Person', () => {
    expect([...machineSuggestionCountsByLead(suggestions)]).toEqual([
      ['person-maya', 2],
      ['person-alex', 1],
    ]);
  });

  it('shows only lead matches for this Person and removes persisted duplicates', () => {
    expect(
      machineSuggestionsForPerson(suggestions, 'person-maya', [{ face_id: 'face-3' }]).map((item) => item.face_id),
    ).toEqual(['face-1']);
  });
});
