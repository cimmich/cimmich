BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, privacy_class
) VALUES (
    'receipt_cimmich_person_projection_performance_v1', 'system',
    'cimmich-person-projection-performance', 'v1', now(), now(), 'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET completed_at = excluded.completed_at;

-- Person detail and review are asset-led. These indexes keep request-local
-- projection CTEs from repeatedly scanning the append-only evidence ledgers.
CREATE INDEX IF NOT EXISTS body_observation_valid_asset_review
  ON body_observation (asset_id, body_id)
  INCLUDE (box_x, box_y, box_w, box_h, quality_measurements)
  WHERE state = 'valid';

CREATE INDEX IF NOT EXISTS bucket_membership_event_face_latest
  ON bucket_membership_event (
    face_id, bucket_id, created_at DESC, membership_event_id DESC
  );

CREATE INDEX IF NOT EXISTS body_tag_person_accepted_cover
  ON body_tag (person_id, body_id)
  INCLUDE (origin, supporting_face_id)
  WHERE state = 'accepted';

CREATE INDEX IF NOT EXISTS presence_tag_person_accepted_cover
  ON presence_tag (person_id, asset_id)
  INCLUDE (reason_code)
  WHERE state = 'accepted';

CREATE INDEX IF NOT EXISTS person_alias_person_active_created
  ON person_alias (person_id, created_at, alias_id)
  INCLUDE (label)
  WHERE state = 'active';

CREATE INDEX IF NOT EXISTS person_category_event_person_latest
  ON person_category_membership_event (
    person_id, category_id, created_at DESC, membership_event_id DESC
  );

COMMIT;
