BEGIN;

ALTER TABLE body_observation
  ADD COLUMN IF NOT EXISTS head_box_x numeric,
  ADD COLUMN IF NOT EXISTS head_box_y numeric,
  ADD COLUMN IF NOT EXISTS head_box_w numeric,
  ADD COLUMN IF NOT EXISTS head_box_h numeric;

ALTER TABLE body_observation
  DROP CONSTRAINT IF EXISTS body_observation_head_box_complete,
  ADD CONSTRAINT body_observation_head_box_complete CHECK (
    (head_box_x IS NULL AND head_box_y IS NULL AND head_box_w IS NULL AND head_box_h IS NULL)
    OR
    (
      head_box_x BETWEEN 0 AND 1 AND head_box_y BETWEEN 0 AND 1
      AND head_box_w > 0 AND head_box_w <= 1
      AND head_box_h > 0 AND head_box_h <= 1
      AND head_box_x + head_box_w <= 1.000001
      AND head_box_y + head_box_h <= 1.000001
    )
  );

COMMIT;

