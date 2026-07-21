BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, privacy_class
) VALUES (
    'receipt_cimmich_holding_workflow_v1', 'system',
    'cimmich-holding-workflow', 'v1', now(), now(), 'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET completed_at = excluded.completed_at;

INSERT INTO person_category (
    category_id, slug, name, category_kind, sort_order, is_system_seed, producer_receipt_id
) VALUES (
    'category_holding', 'holding', 'Holding', 'workflow', 71, true,
    'receipt_cimmich_holding_workflow_v1'
) ON CONFLICT (category_id) DO UPDATE SET
    name = excluded.name,
    category_kind = excluded.category_kind,
    sort_order = excluded.sort_order,
    state = 'active';

CREATE TABLE person_holding_matching_snapshot (
    snapshot_event_id text NOT NULL REFERENCES person_category_membership_event(membership_event_id) ON DELETE CASCADE,
    person_id text NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
    record_kind text NOT NULL CHECK (record_kind IN ('bucket','prototype')),
    record_id text NOT NULL,
    prior_state text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (snapshot_event_id, record_kind, record_id)
);

CREATE OR REPLACE VIEW current_person_review_state AS
SELECT person.person_id,
       EXISTS (
         SELECT 1 FROM current_person_category category
         WHERE category.person_id = person.person_id AND category.slug = 'sort'
       ) AS needs_sort,
       CASE
         WHEN EXISTS (
           SELECT 1 FROM current_person_category category
           WHERE category.person_id = person.person_id AND category.slug = 'holding'
         ) THEN 'holding'::text
         WHEN EXISTS (
           SELECT 1 FROM current_person_category category
           WHERE category.person_id = person.person_id AND category.slug = 'sort'
         ) THEN 'review_only'::text
         ELSE 'trusted'::text
       END AS matching_authority,
       EXISTS (
         SELECT 1 FROM current_person_category category
         WHERE category.person_id = person.person_id AND category.slug = 'holding'
       ) AS needs_holding
FROM current_person person;

CREATE OR REPLACE FUNCTION ensure_holding_sort_parent()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_slug text;
  v_sort_category_id text;
BEGIN
  SELECT slug INTO v_slug FROM person_category WHERE category_id = NEW.category_id;
  IF v_slug = 'holding' AND NEW.action = 'add' AND NOT EXISTS (
    SELECT 1 FROM current_person_category
    WHERE person_id = NEW.person_id AND slug = 'sort'
  ) THEN
    SELECT category_id INTO v_sort_category_id
    FROM person_category WHERE slug = 'sort' AND state = 'active' LIMIT 1;
    IF v_sort_category_id IS NULL THEN
      RAISE EXCEPTION 'Holding requires the active Sort category' USING ERRCODE = '23514';
    END IF;
    INSERT INTO person_category_membership_event (
      membership_event_id, person_id, category_id, action, actor_kind, actor_id,
      decision_id, producer_receipt_id, privacy_class, created_at
    ) VALUES (
      'categoryevent_holding_parent_' || md5(NEW.membership_event_id),
      NEW.person_id, v_sort_category_id, 'add', NEW.actor_kind, NEW.actor_id,
      NEW.decision_id, NEW.producer_receipt_id, NEW.privacy_class, NEW.created_at
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS person_category_holding_sort_parent ON person_category_membership_event;
CREATE TRIGGER person_category_holding_sort_parent
BEFORE INSERT ON person_category_membership_event
FOR EACH ROW EXECUTE FUNCTION ensure_holding_sort_parent();

CREATE OR REPLACE FUNCTION guard_sort_removal_with_holding()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_slug text;
BEGIN
  SELECT slug INTO v_slug FROM person_category WHERE category_id = NEW.category_id;
  IF v_slug = 'sort' AND NEW.action = 'remove' AND EXISTS (
    SELECT 1 FROM current_person_category
    WHERE person_id = NEW.person_id AND slug = 'holding'
  ) THEN
    RAISE EXCEPTION 'Remove Holding before removing Sort' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS person_category_holding_sort_guard ON person_category_membership_event;
CREATE TRIGGER person_category_holding_sort_guard
BEFORE INSERT ON person_category_membership_event
FOR EACH ROW EXECUTE FUNCTION guard_sort_removal_with_holding();

CREATE OR REPLACE FUNCTION enqueue_person_category_source_pack_rebuild()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_slug text;
BEGIN
  SELECT slug INTO v_slug FROM person_category WHERE category_id = NEW.category_id;
  IF v_slug IN ('sort', 'holding') THEN
    PERFORM enqueue_source_pack_rebuild(
      NEW.person_id,
      CASE WHEN v_slug = 'holding' THEN 'person_holding_state_changed' ELSE 'person_sort_state_changed' END,
      'person_category_membership_event', NEW.membership_event_id
    );
  END IF;
  IF v_slug = 'holding' AND NEW.action = 'add' THEN
    INSERT INTO person_holding_matching_snapshot (
      snapshot_event_id, person_id, record_kind, record_id, prior_state
    )
    SELECT NEW.membership_event_id, NEW.person_id, 'bucket', bucket_id, state
    FROM reference_bucket
    WHERE person_id = NEW.person_id AND state IN ('active', 'candidate')
    ON CONFLICT DO NOTHING;
    INSERT INTO person_holding_matching_snapshot (
      snapshot_event_id, person_id, record_kind, record_id, prior_state
    )
    SELECT NEW.membership_event_id, NEW.person_id, 'prototype', prototype_id, state
    FROM reference_prototype
    WHERE person_id = NEW.person_id AND state = 'active'
    ON CONFLICT DO NOTHING;
    UPDATE reference_bucket
       SET state = 'retired'
     WHERE person_id = NEW.person_id AND state IN ('active', 'candidate');
    UPDATE reference_prototype
       SET state = 'retired'
     WHERE person_id = NEW.person_id AND state = 'active';
    UPDATE source_pack pack
       SET state = 'retired'
     WHERE pack.state = 'active'
       AND EXISTS (
         SELECT 1 FROM source_pack_reference ref
         WHERE ref.pack_id = pack.pack_id AND ref.person_id = NEW.person_id
       );
  ELSIF v_slug = 'holding' AND NEW.action = 'remove' THEN
    UPDATE reference_bucket bucket
       SET state = snapshot.prior_state
      FROM person_holding_matching_snapshot snapshot
     WHERE snapshot.snapshot_event_id = (
             SELECT event.membership_event_id
             FROM person_category_membership_event event
             JOIN person_category category ON category.category_id = event.category_id
             WHERE event.person_id = NEW.person_id AND category.slug = 'holding' AND event.action = 'add'
               AND event.created_at <= NEW.created_at
             ORDER BY event.created_at DESC, event.membership_event_id DESC
             LIMIT 1
           )
       AND snapshot.record_kind = 'bucket'
       AND snapshot.record_id = bucket.bucket_id;
    UPDATE reference_prototype prototype
       SET state = snapshot.prior_state
      FROM person_holding_matching_snapshot snapshot
     WHERE snapshot.snapshot_event_id = (
             SELECT event.membership_event_id
             FROM person_category_membership_event event
             JOIN person_category category ON category.category_id = event.category_id
             WHERE event.person_id = NEW.person_id AND category.slug = 'holding' AND event.action = 'add'
               AND event.created_at <= NEW.created_at
             ORDER BY event.created_at DESC, event.membership_event_id DESC
             LIMIT 1
           )
       AND snapshot.record_kind = 'prototype'
       AND snapshot.record_id = prototype.prototype_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_source_pack_holding_exclusion()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state = 'active' AND EXISTS (
    SELECT 1
    FROM source_pack_reference ref
    JOIN current_person_category category ON category.person_id = ref.person_id
    WHERE ref.pack_id = NEW.pack_id AND category.slug = 'holding'
  ) THEN
    RAISE EXCEPTION 'active SourcePack cannot reference a Holding container' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS source_pack_holding_activation_guard ON source_pack;
CREATE TRIGGER source_pack_holding_activation_guard
BEFORE INSERT OR UPDATE OF state ON source_pack
FOR EACH ROW EXECUTE FUNCTION enforce_source_pack_holding_exclusion();

COMMIT;
