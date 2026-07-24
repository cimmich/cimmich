BEGIN;

ALTER TABLE immich_onboarding_review_item
  DROP CONSTRAINT immich_onboarding_review_item_reason_check,
  ADD CONSTRAINT immich_onboarding_review_item_reason_check CHECK (reason IN (
    'duplicate_person_name','ambiguous_provider_geometry','missing_provider_face',
    'stale_asset_revision','source_face_unassigned','extra_provider_face',
    'provider_identity_conflict','person_revision_changed',
    'source_person_unlabelled','source_person_resolution_required'
  ));

INSERT INTO producer_receipt (
  producer_receipt_id, producer_kind, producer_name, producer_version,
  started_at, completed_at, result_digest, privacy_class
) VALUES (
  'receipt_cimmich_immich_onboarding_resolution_review_reasons_v1', 'system',
  'cimmich-immich-onboarding-resolution-review-reasons', 'v1', now(), now(),
  encode(digest(
    'cimmich.immich-onboarding-resolution-review-reasons.v1',
    'sha256'
  ), 'hex'),
  'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
  completed_at = excluded.completed_at,
  result_digest = excluded.result_digest;

COMMIT;
