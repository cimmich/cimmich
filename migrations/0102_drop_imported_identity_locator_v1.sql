BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_drop_imported_identity_locator_v1', 'system',
    'cimmich-drop-imported-identity-locator', 'v1', now(), now(),
    encode(digest('cimmich.drop-imported-identity-locator.v1', 'sha256'), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

-- imported_identity_locator never gained a producer: nothing in the service
-- ever inserted rows, so the table has been empty since 0081 introduced it.
-- The reader paths (asset dossier locator overlay, manual-subject-tag locator
-- resolution) were removed with the dead-code sweep; drop the backing table.

DROP TABLE IF EXISTS imported_identity_locator;

COMMIT;
