BEGIN;

-- The provider supplies real tiles through zoom 18. Location Plans may enlarge
-- that final tile further because an honestly soft property image is still
-- useful for positioning internal Locations. This changes only the saved Plan
-- camera; map source truth and geographic Place geometry remain unchanged.
ALTER TABLE place_plan
  DROP CONSTRAINT place_plan_background_viewport_check;

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
      AND (background_viewport->>'zoom')::numeric BETWEEN 0 AND 22
    )
  );

COMMIT;
