BEGIN;

-- Outline polygons describe one closed boundary. Paint geometry records the
-- owner's bounded brush strokes so one child Location can cover several
-- disconnected parts of the same Plan without inventing connecting areas.
ALTER TABLE place_plan_item
  DROP CONSTRAINT place_plan_item_shape_kind_check;

ALTER TABLE place_plan_item
  ADD CONSTRAINT place_plan_item_shape_kind_check
  CHECK (shape_kind IN ('point','rect','polygon','paint'));

COMMIT;
