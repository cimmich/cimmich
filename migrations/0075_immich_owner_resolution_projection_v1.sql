BEGIN;

ALTER TABLE immich_face_projection
  ADD COLUMN resolution_decision_id text REFERENCES decision(decision_id),
  ADD CONSTRAINT immich_face_projection_resolution_decision_check CHECK (
    (reconciliation_state IN ('owner_unknown','owner_noise'))
      = (resolution_decision_id IS NOT NULL)
  );

INSERT INTO producer_receipt (
  producer_receipt_id, producer_kind, producer_name, producer_version,
  started_at, completed_at, result_digest, privacy_class
) VALUES (
  'receipt_cimmich_immich_owner_resolution_projection_v1', 'system',
  'cimmich-immich-owner-resolution-projection', 'v1', now(), now(),
  encode(digest('cimmich.immich-owner-resolution-projection.v1', 'sha256'), 'hex'),
  'sensitive-biometric'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
  completed_at = excluded.completed_at,
  result_digest = excluded.result_digest;

COMMIT;
