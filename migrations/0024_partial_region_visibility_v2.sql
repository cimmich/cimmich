BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, privacy_class
) VALUES (
    'receipt_cimmich_partial_region_visibility_v2', 'system',
    'cimmich-face-local-measurement', 'v2', now(), now(), 'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET completed_at = excluded.completed_at;

COMMENT ON COLUMN face_local_measurement.visibility IS
    'Versioned region evidence. V2 permits partially_measured subsets: one known blocked region proves incomplete; complete requires all five independently measured regions.';

COMMIT;
