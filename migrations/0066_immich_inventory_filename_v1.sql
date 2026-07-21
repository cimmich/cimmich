\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE immich_asset_projection
    ADD COLUMN original_file_name text;

ALTER TABLE immich_asset_projection
    ADD CONSTRAINT immich_asset_projection_original_file_name_check CHECK (
        original_file_name IS NULL OR (
            length(original_file_name) BETWEEN 1 AND 500
            AND original_file_name !~ '[[:cntrl:]]'
        )
    );

COMMIT;
