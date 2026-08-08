BEGIN;

INSERT INTO source_snapshot (
  snapshot_id, input_schema_version, source_digest, locator_root_token,
  started_at, completed_at, observed_asset_count, state, privacy_class
) VALUES (
  'snapshot_physical_face_fixture', 'physical-face-fixture.v1',
  repeat('1', 64), 'fixture-physical-face-root', now(), now(), 2,
  'complete', 'private'
);

INSERT INTO producer_receipt (
  producer_receipt_id, producer_kind, producer_name, producer_version,
  source_snapshot_id, started_at, completed_at, result_digest, privacy_class
) VALUES
  ('receipt_physical_face_local', 'model',
    'cimmich-face-detector:insightface-user-supplied-cpu', 'fixture-v1',
    'snapshot_physical_face_fixture', now(), now(), repeat('2', 64),
    'sensitive-biometric'),
  ('receipt_physical_face_neutral', 'trusted_import',
    'neutral-source-person-evidence', 'fixture-v1',
    'snapshot_physical_face_fixture', now(), now(), repeat('3', 64),
    'sensitive-biometric'),
  ('receipt_physical_face_xmp', 'trusted_import',
    'cimmich-xmp-sidecar-face-import', 'fixture-v1',
    'snapshot_physical_face_fixture', now(), now(), repeat('4', 64),
    'sensitive-biometric'),
  ('receipt_physical_face_legacy', 'model',
    'private-machine-observation-import', 'fixture-v1',
    'snapshot_physical_face_fixture', now(), now(), repeat('5', 64),
    'sensitive-biometric');

INSERT INTO asset (
  asset_id, locator_token, media_kind, mime_type, width, height,
  source_snapshot_id, state, privacy_class
) VALUES
  ('asset_physical_face_active', 'fixture-active.jpg', 'image', 'image/jpeg',
    1000, 800, 'snapshot_physical_face_fixture', 'active', 'private'),
  ('asset_physical_face_conflict', 'fixture-conflict.jpg', 'image', 'image/jpeg',
    1000, 800, 'snapshot_physical_face_fixture', 'active', 'private');

INSERT INTO person (
  person_id, display_name, status, subject_kind, created_by_receipt_id,
  privacy_class
) VALUES
  ('person_physical_face_one', 'Physical Face One', 'active', 'person',
    'receipt_physical_face_neutral', 'sensitive-biometric'),
  ('person_physical_face_two', 'Physical Face Two', 'active', 'person',
    'receipt_physical_face_xmp', 'sensitive-biometric');

INSERT INTO face_observation (
  face_id, asset_id, box_x, box_y, box_w, box_h, detection_confidence,
  quality_measurements, state, producer_receipt_id, privacy_class
) VALUES
  ('face_physical_active_local', 'asset_physical_face_active',
    0.10, 0.10, 0.20, 0.20, 0.95, '{}'::jsonb, 'valid',
    'receipt_physical_face_local', 'sensitive-biometric'),
  ('face_physical_active_neutral', 'asset_physical_face_active',
    0.11, 0.11, 0.20, 0.20, 0.90, '{}'::jsonb, 'valid',
    'receipt_physical_face_neutral', 'sensitive-biometric'),
  ('face_physical_active_legacy', 'asset_physical_face_active',
    0.105, 0.105, 0.20, 0.20, 0.88, '{}'::jsonb, 'valid',
    'receipt_physical_face_legacy', 'sensitive-biometric'),
  ('face_physical_conflict_local', 'asset_physical_face_conflict',
    0.40, 0.20, 0.20, 0.20, 0.95, '{}'::jsonb, 'valid',
    'receipt_physical_face_local', 'sensitive-biometric'),
  ('face_physical_conflict_neutral', 'asset_physical_face_conflict',
    0.41, 0.21, 0.20, 0.20, 0.90, '{}'::jsonb, 'valid',
    'receipt_physical_face_neutral', 'sensitive-biometric'),
  ('face_physical_conflict_xmp', 'asset_physical_face_conflict',
    0.405, 0.205, 0.20, 0.20, 0.90, '{}'::jsonb, 'valid',
    'receipt_physical_face_xmp', 'sensitive-biometric');

INSERT INTO decision (
  decision_id, subject_type, subject_id, action, actor_kind, actor_id,
  reason_code, note, producer_receipt_id, privacy_class
) VALUES
  ('decision_physical_active_accept', 'identity_claim',
    'claim_physical_active_accept', 'accept', 'trusted_import',
    'physical-face-fixture', 'fixture_accepted', '',
    'receipt_physical_face_neutral', 'sensitive-biometric'),
  ('decision_physical_conflict_one', 'identity_claim',
    'claim_physical_conflict_one', 'accept', 'trusted_import',
    'physical-face-fixture', 'fixture_accepted', '',
    'receipt_physical_face_neutral', 'sensitive-biometric'),
  ('decision_physical_conflict_two', 'identity_claim',
    'claim_physical_conflict_two', 'accept', 'trusted_import',
    'physical-face-fixture', 'fixture_accepted', '',
    'receipt_physical_face_xmp', 'sensitive-biometric');

INSERT INTO identity_claim (
  identity_claim_id, face_id, person_id, origin, state,
  calibrated_confidence, evidence_refs, decision_id,
  producer_receipt_id, privacy_class
) VALUES
  ('claim_physical_active_accept', 'face_physical_active_neutral',
    'person_physical_face_one', 'trusted_import', 'accepted', 1,
    '{}'::jsonb, 'decision_physical_active_accept',
    'receipt_physical_face_neutral', 'sensitive-biometric'),
  ('claim_physical_active_candidate', 'face_physical_active_legacy',
    'person_physical_face_one', 'cluster_propagation', 'candidate', 0.96,
    jsonb_build_object(
      'assignment_decision', 'cluster_propagation_candidate',
      'automatic_acceptance', 'false',
      'policy_version', 'cimmich-possible-people-graph-v1'
    ), NULL, 'receipt_physical_face_legacy', 'sensitive-biometric'),
  ('claim_physical_conflict_one', 'face_physical_conflict_neutral',
    'person_physical_face_one', 'trusted_import', 'accepted', 1,
    '{}'::jsonb, 'decision_physical_conflict_one',
    'receipt_physical_face_neutral', 'sensitive-biometric'),
  ('claim_physical_conflict_two', 'face_physical_conflict_xmp',
    'person_physical_face_two', 'trusted_import', 'accepted', 1,
    '{}'::jsonb, 'decision_physical_conflict_two',
    'receipt_physical_face_xmp', 'sensitive-biometric');

COMMIT;
