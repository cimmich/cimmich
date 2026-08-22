BEGIN;

ALTER TABLE person_profile_command
    DROP CONSTRAINT person_profile_command_command_kind_check;

ALTER TABLE person_profile_command
    ADD CONSTRAINT person_profile_command_command_kind_check CHECK (
        command_kind IN (
            'profile_patch',
            'display_defaults_patch',
            'person_display_patch',
            'relationship_category_create'
        )
    );

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, privacy_class
) VALUES (
    'receipt_cimmich_person_relationship_catalog_v1', 'system',
    'cimmich-person-relationship-catalog', 'v1', now(), now(), 'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE
    SET completed_at = excluded.completed_at;

COMMIT;
