BEGIN;

INSERT INTO person (
  person_id, display_name, status, created_by_receipt_id, privacy_class
) VALUES (
  'person_projection_perf_fixture', 'Projection Performance Fixture', 'active',
  'receipt_service_fixture', 'release-safe'
);

INSERT INTO person (
  person_id, display_name, status, created_by_receipt_id, privacy_class
) VALUES (
  'person_photo_history_fixture', 'Photo History Fixture', 'active',
  'receipt_service_fixture', 'release-safe'
);

INSERT INTO asset (
  asset_id, locator_token, media_kind, mime_type, width, height, capture_time,
  source_snapshot_id, state, privacy_class
) VALUES (
  'asset_projection_perf_fixture', 'synthetic://person-projection-performance',
  'image', 'image/jpeg', 4000, 3000, '2025-01-01T00:00:00Z',
  'snapshot_service_acceptance', 'active', 'release-safe'
);

INSERT INTO asset (
  asset_id, locator_token, media_kind, mime_type, width, height, capture_time,
  source_snapshot_id, state, privacy_class
) VALUES
  (
    'asset_photo_history_past', 'synthetic://photo-history-past',
    'image', 'image/jpeg', 2000, 1500, '2020-05-06T07:08:09Z',
    'snapshot_service_acceptance', 'active', 'release-safe'
  ),
  (
    'asset_photo_history_future', 'synthetic://photo-history-future',
    'image', 'image/jpeg', 2000, 1500, '2100-01-01T00:00:00Z',
    'snapshot_service_acceptance', 'active', 'release-safe'
  ),
  (
    'asset_photo_history_old_video', 'synthetic://photo-history-old-video',
    'video', 'video/mp4', 2000, 1500, '1900-01-01T00:00:00Z',
    'snapshot_service_acceptance', 'active', 'release-safe'
  );

INSERT INTO presence_tag (
  presence_tag_id, person_id, asset_id, origin, reason_code, note, state,
  producer_receipt_id, privacy_class
) VALUES
  (
    'presence_photo_history_past', 'person_photo_history_fixture',
    'asset_photo_history_past', 'trusted_import', 'synthetic_photo_history', '',
    'accepted', 'receipt_service_fixture', 'release-safe'
  ),
  (
    'presence_photo_history_future', 'person_photo_history_fixture',
    'asset_photo_history_future', 'trusted_import', 'synthetic_photo_history', '',
    'accepted', 'receipt_service_fixture', 'release-safe'
  ),
  (
    'presence_photo_history_old_video', 'person_photo_history_fixture',
    'asset_photo_history_old_video', 'trusted_import', 'synthetic_photo_history', '',
    'accepted', 'receipt_service_fixture', 'release-safe'
  );

INSERT INTO face_observation (
  face_id, asset_id, box_x, box_y, box_w, box_h, detection_confidence,
  quality_measurements, state, producer_receipt_id, privacy_class
)
SELECT
  'face_projection_perf_' || lpad(series::text, 5, '0'),
  'asset_projection_perf_fixture', 0.1, 0.1, 0.2, 0.3, 0.99,
  jsonb_build_object('quality_score', 1 - series::numeric / 100000),
  'valid', 'receipt_service_fixture', 'release-safe'
FROM generate_series(1, 2500) series;

INSERT INTO decision (
  decision_id, subject_type, subject_id, action, actor_kind, actor_id,
  reason_code, producer_receipt_id, privacy_class
)
SELECT
  'decision_projection_perf_' || lpad(series::text, 5, '0'),
  'face_identity',
  'face_projection_perf_' || lpad(series::text, 5, '0'),
  'accept', 'user', 'synthetic-performance',
  'synthetic_performance_fixture', 'receipt_service_fixture', 'release-safe'
FROM generate_series(1, 2500) series;

INSERT INTO identity_claim (
  identity_claim_id, face_id, person_id, origin, state,
  calibrated_confidence, evidence_refs, decision_id, producer_receipt_id,
  privacy_class
)
SELECT
  'claim_projection_perf_' || lpad(series::text, 5, '0'),
  'face_projection_perf_' || lpad(series::text, 5, '0'),
  'person_projection_perf_fixture', 'user', 'accepted', 1,
  '["synthetic-performance-fixture"]'::jsonb,
  'decision_projection_perf_' || lpad(series::text, 5, '0'),
  'receipt_service_fixture', 'release-safe'
FROM generate_series(1, 2500) series;

INSERT INTO reference_bucket (
  bucket_id, person_id, bucket_kind, name, created_by, policy_version,
  state, producer_receipt_id, privacy_class
) VALUES (
  'bucket_projection_perf_prime', 'person_projection_perf_fixture', 'prime',
  NULL, 'system', 'synthetic-performance-v1', 'active',
  'receipt_service_fixture', 'release-safe'
);

INSERT INTO bucket_membership_event (
  membership_event_id, bucket_id, face_id, action, actor_kind, reason_code,
  reason_text, policy_version, producer_receipt_id, privacy_class
)
SELECT
  'membership_projection_perf_' || lpad(series::text, 5, '0'),
  'bucket_projection_perf_prime',
  'face_projection_perf_' || lpad(series::text, 5, '0'),
  'activate', 'policy', 'synthetic_performance_fixture',
  'Representative skew performance fixture',
  'synthetic-performance-v1',
  'receipt_service_fixture', 'release-safe'
FROM generate_series(1, 2500) series;

DO $$
BEGIN
  IF (SELECT count(*) FROM current_face_identity
      WHERE person_id = 'person_projection_perf_fixture' AND state = 'accepted') <> 2500 THEN
    RAISE EXCEPTION 'Person projection performance fixture identity count failed';
  END IF;
  IF (SELECT count(*) FROM current_reference_gallery
      WHERE person_id = 'person_projection_perf_fixture'
        AND bucket_kind = 'prime' AND membership_state = 'active') <> 2500 THEN
    RAISE EXCEPTION 'Person projection performance fixture gallery count failed';
  END IF;
END $$;

COMMIT;
