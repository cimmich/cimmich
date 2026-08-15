BEGIN;

ALTER TABLE immich_asset_projection
  ADD COLUMN visual_thumbhash text;

ALTER TABLE immich_asset_projection
  ADD CONSTRAINT immich_asset_projection_visual_thumbhash_valid
  CHECK (
    visual_thumbhash IS NULL
    OR length(btrim(visual_thumbhash)) BETWEEN 1 AND 500
  );

CREATE INDEX immich_asset_projection_visual_thumbhash_active_idx
  ON immich_asset_projection (visual_thumbhash)
  WHERE state = 'active' AND visual_thumbhash IS NOT NULL;

CREATE INDEX immich_asset_projection_filename_dimensions_active_idx
  ON immich_asset_projection (source_id, original_file_name, width, height)
  WHERE state = 'active' AND asset_type = 'image';

COMMENT ON COLUMN immich_asset_projection.visual_thumbhash IS
  'Read-only Immich visual signature used to surface probable same-image versions. It is discovery evidence, never deletion authority.';

COMMIT;
