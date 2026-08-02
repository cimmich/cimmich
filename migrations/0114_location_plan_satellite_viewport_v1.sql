BEGIN;

-- Satellite Plans are authoring surfaces, not static locator snapshots. Keep
-- the owner's chosen centre and zoom with the Plan so the editor, profile hero
-- and Undo all render the same aligned background. Existing satellite Plans
-- remain valid and fall back to their Location geometry until first saved.
ALTER TABLE place_plan
  ADD COLUMN background_viewport jsonb;

ALTER TABLE place_plan
  ADD CONSTRAINT place_plan_background_viewport_check CHECK (
    background_viewport IS NULL OR (
      background_kind = 'satellite'
      AND jsonb_typeof(background_viewport) = 'object'
      AND background_viewport ?& ARRAY['latitude','longitude','zoom']
      AND jsonb_typeof(background_viewport->'latitude') = 'number'
      AND jsonb_typeof(background_viewport->'longitude') = 'number'
      AND jsonb_typeof(background_viewport->'zoom') = 'number'
      AND (background_viewport->>'latitude')::numeric BETWEEN -85.051129 AND 85.051129
      AND (background_viewport->>'longitude')::numeric BETWEEN -180 AND 180
      AND (background_viewport->>'zoom')::numeric BETWEEN 0 AND 18
    )
  );

COMMIT;
