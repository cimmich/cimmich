BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, privacy_class
) VALUES (
    'receipt_cimmich_holding_attention_only_v1', 'system',
    'cimmich-holding-attention-only', 'v1', now(), now(), 'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET completed_at = excluded.completed_at;

-- Holding is an attention flag, not a separate identity authority. Restore the
-- exact bucket/prototype states snapshotted by schema 16 for people who remain
-- in Holding, then remove the category-driven quarantine machinery.
WITH latest_holding_add AS (
  SELECT DISTINCT ON (event.person_id)
         event.person_id, event.membership_event_id
  FROM person_category_membership_event event
  JOIN person_category category ON category.category_id = event.category_id
  JOIN current_person_category current_category
    ON current_category.person_id = event.person_id
   AND current_category.slug = 'holding'
  WHERE category.slug = 'holding' AND event.action = 'add'
  ORDER BY event.person_id, event.created_at DESC, event.membership_event_id DESC
)
UPDATE reference_bucket bucket
   SET state = snapshot.prior_state
  FROM person_holding_matching_snapshot snapshot
  JOIN latest_holding_add latest
    ON latest.membership_event_id = snapshot.snapshot_event_id
 WHERE snapshot.record_kind = 'bucket'
   AND snapshot.record_id = bucket.bucket_id
   AND bucket.person_id = latest.person_id
   AND bucket.state = 'retired';

WITH latest_holding_add AS (
  SELECT DISTINCT ON (event.person_id)
         event.person_id, event.membership_event_id
  FROM person_category_membership_event event
  JOIN person_category category ON category.category_id = event.category_id
  JOIN current_person_category current_category
    ON current_category.person_id = event.person_id
   AND current_category.slug = 'holding'
  WHERE category.slug = 'holding' AND event.action = 'add'
  ORDER BY event.person_id, event.created_at DESC, event.membership_event_id DESC
)
UPDATE reference_prototype prototype
   SET state = snapshot.prior_state
  FROM person_holding_matching_snapshot snapshot
  JOIN latest_holding_add latest
    ON latest.membership_event_id = snapshot.snapshot_event_id
 WHERE snapshot.record_kind = 'prototype'
   AND snapshot.record_id = prototype.prototype_id
   AND prototype.person_id = latest.person_id
   AND prototype.state = 'retired';

DROP TRIGGER IF EXISTS person_category_holding_sort_parent ON person_category_membership_event;
DROP TRIGGER IF EXISTS person_category_holding_sort_guard ON person_category_membership_event;
DROP TRIGGER IF EXISTS source_pack_holding_activation_guard ON source_pack;
DROP FUNCTION IF EXISTS ensure_holding_sort_parent();
DROP FUNCTION IF EXISTS guard_sort_removal_with_holding();
DROP FUNCTION IF EXISTS enforce_source_pack_holding_exclusion();

CREATE OR REPLACE VIEW current_person_review_state AS
SELECT person.person_id,
       EXISTS (
         SELECT 1 FROM current_person_category category
         WHERE category.person_id = person.person_id AND category.slug = 'sort'
       ) AS needs_sort,
       CASE
         WHEN EXISTS (
           SELECT 1 FROM current_person_category category
           WHERE category.person_id = person.person_id AND category.slug IN ('sort', 'holding')
         ) THEN 'review_only'::text
         ELSE 'trusted'::text
       END AS matching_authority,
       EXISTS (
         SELECT 1 FROM current_person_category category
         WHERE category.person_id = person.person_id AND category.slug = 'holding'
       ) AS needs_holding
FROM current_person person;

CREATE OR REPLACE FUNCTION enqueue_person_category_source_pack_rebuild()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_slug text;
BEGIN
  SELECT slug INTO v_slug FROM person_category WHERE category_id = NEW.category_id;
  IF v_slug IN ('sort', 'holding') THEN
    PERFORM enqueue_source_pack_rebuild(
      NEW.person_id,
      CASE WHEN v_slug = 'holding' THEN 'person_holding_attention_changed' ELSE 'person_sort_state_changed' END,
      'person_category_membership_event', NEW.membership_event_id
    );
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
