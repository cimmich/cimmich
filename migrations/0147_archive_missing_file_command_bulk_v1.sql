BEGIN;

ALTER TABLE archive_missing_file_command
    DROP CONSTRAINT archive_missing_file_command_source_asset_ids_check;

ALTER TABLE archive_missing_file_command
    ADD CONSTRAINT archive_missing_file_command_source_asset_ids_check
    CHECK (cardinality(source_asset_ids) >= 1);

COMMIT;
