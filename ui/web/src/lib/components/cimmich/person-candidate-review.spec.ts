import { describe, expect, it } from 'vitest';
import type { CimmichIdentityCandidate } from '$lib/services/cimmich.service';
import { hasUsefulCandidateSeparation, preparePersonCandidates } from './person-candidate-review';

const candidate = (
  id: string,
  score: number | null,
  margin: number | null,
  detectionConfidence = 0.9,
): CimmichIdentityCandidate =>
  ({
    asset_id: `asset-${id}`,
    box_h: 0.2,
    box_w: 0.2,
    box_x: 0.1,
    box_y: 0.1,
    current_person_id: null,
    current_person_name: null,
    detection_confidence: detectionConfidence,
    face_id: `face-${id}`,
    filename: `${id}.jpg`,
    identity_claim_id: id,
    match_score: score,
    source_margin: margin,
    sourceAssetId: `source-${id}`,
  }) as CimmichIdentityCandidate;

describe('Person candidate review presentation', () => {
  it('keeps separated candidates ordered by margin then score', () => {
    const candidates = [
      candidate('zero-margin', 1.2, 0),
      candidate('strong', 0.83, 0.2),
      candidate('close', 0.9, 0.04),
    ];

    expect(preparePersonCandidates(candidates).map(({ identity_claim_id }) => identity_claim_id)).toEqual([
      'strong',
      'close',
    ]);
    expect(hasUsefulCandidateSeparation(candidates[0])).toBe(false);
  });
});
