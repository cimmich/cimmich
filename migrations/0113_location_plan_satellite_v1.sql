BEGIN;

-- Satellite is a durable Plan background mode, not an imported Asset. The
-- Location's existing latitude/longitude geometry remains the source of the
-- viewport; Plan items continue to use private normalized canvas coordinates.
ALTER TABLE place_plan
  DROP CONSTRAINT place_plan_background_kind_check;

ALTER TABLE place_plan
  ADD CONSTRAINT place_plan_background_kind_check
  CHECK (background_kind IN ('blank','asset','satellite'));

COMMIT;
