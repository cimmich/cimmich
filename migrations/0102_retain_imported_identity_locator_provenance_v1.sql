BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_retain_imported_identity_locator_provenance_v1', 'system',
    'cimmich-retain-imported-identity-locator-provenance', 'v1', now(), now(),
    encode(
        digest(
            'cimmich.retain-imported-identity-locator-provenance.v1',
            'sha256'
        ),
        'hex'
    ),
    'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

-- The schema-102 source cleanup removed all runtime readers and writers for
-- imported_identity_locator. The service tree itself never produced rows, but
-- private archive import operators legitimately may have populated the table:
-- X1 retained 1,459 source rectangles, including 371 unresolved owner-placement
-- records. Removing an unused runtime path must not erase that provenance.
--
-- Keep the exact schema-81/82 table and rows dormant. A future product decision
-- may restore a bounded owner-review projection or migrate this evidence into a
-- replacement contract, but must do so explicitly and losslessly.

COMMENT ON TABLE imported_identity_locator
IS 'Dormant imported spatial provenance retained losslessly after runtime reader/writer retirement. It grants no Face, Head, Body, Presence, matching, or identity authority.';

COMMIT;
