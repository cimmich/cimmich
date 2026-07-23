BEGIN;

CREATE TABLE person_presentation_media (
  person_id text NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
  slot_kind text NOT NULL CHECK (slot_kind IN ('face', 'body', 'hero')),
  asset_id text NOT NULL REFERENCES asset(asset_id) ON DELETE CASCADE,
  observation_kind text NOT NULL CHECK (observation_kind IN ('face', 'body', 'presence')),
  observation_id text,
  crop jsonb CHECK (crop IS NULL OR jsonb_typeof(crop) = 'object'),
  actor_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, slot_kind)
);

CREATE INDEX person_presentation_media_asset_idx
  ON person_presentation_media (asset_id);

INSERT INTO producer_receipt (
  producer_receipt_id, producer_kind, producer_name, producer_version,
  started_at, completed_at, result_digest, privacy_class
) VALUES (
  'receipt_cimmich_person_presentation_media_v1', 'system',
  'cimmich-person-presentation-media', 'v1', now(), now(),
  encode(digest('cimmich.person-presentation-media.v1', 'sha256'), 'hex'),
  'sensitive-biometric'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
  completed_at = excluded.completed_at,
  result_digest = excluded.result_digest;

COMMIT;
