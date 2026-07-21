BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, privacy_class
) VALUES (
    'receipt_cimmich_scoped_region_contamination_v3', 'system',
    'cimmich-face-local-measurement', 'v3', now(), now(), 'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET completed_at = excluded.completed_at;

COMMENT ON COLUMN face_local_measurement.target_selection IS
    'V3 target provenance. A provided Cimmich FaceObservation box locates the region independently of optional landmark success; it never proves visibility.';

COMMENT ON COLUMN face_local_measurement.contamination IS
    'V3 crop-scoped contamination. Exact visibility regions may carry independent contamination evidence; absent regional evidence falls back to the wider target crop guard.';

COMMIT;
