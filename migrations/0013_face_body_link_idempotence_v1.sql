BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS body_tag_one_accepted_body_per_supporting_face
  ON body_tag(supporting_face_id)
  WHERE state = 'accepted' AND supporting_face_id IS NOT NULL;

COMMIT;

