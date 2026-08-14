BEGIN;

INSERT INTO producer_receipt (
  producer_receipt_id, producer_kind, producer_name, producer_version,
  started_at, completed_at, result_digest, privacy_class
) VALUES (
  'receipt_cimmich_pet_match_ignored_review_v1', 'system',
  'cimmich-pet-match-ignored-review', 'v1', now(), now(),
  encode(digest('cimmich.pet-match-ignored-review.v1', 'sha256'), 'hex'),
  'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
  completed_at = excluded.completed_at,
  result_digest = excluded.result_digest;

ALTER TABLE pet_match_observation
  DROP CONSTRAINT pet_match_observation_state_check;
ALTER TABLE pet_match_observation
  ADD CONSTRAINT pet_match_observation_state_check CHECK (
    state IN ('pending', 'confirmed', 'rejected', 'unknown', 'ignored', 'superseded')
  );

CREATE INDEX pet_match_observation_ignored
  ON pet_match_observation(created_at DESC, observation_id)
  WHERE state = 'ignored';

COMMENT ON COLUMN pet_match_observation.state IS
  'Matcher lifecycle plus owner review state. ignored is reversible; rejected is a terminal False Match.';

COMMIT;
