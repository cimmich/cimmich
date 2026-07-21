BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, privacy_class
) VALUES (
    'receipt_cimmich_person_categories_sort_trust_v1', 'system',
    'cimmich-person-categories-sort-trust', 'v1', now(), now(), 'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET completed_at = excluded.completed_at;

CREATE TABLE person_category (
    category_id text PRIMARY KEY,
    slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9-]*$'),
    name text NOT NULL,
    category_kind text NOT NULL CHECK (category_kind IN ('relationship','workflow')),
    sort_order integer NOT NULL DEFAULT 0,
    state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','hidden','retired')),
    is_system_seed boolean NOT NULL DEFAULT false,
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private',
    created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO person_category (
    category_id, slug, name, category_kind, sort_order, is_system_seed, producer_receipt_id
) VALUES
    ('category_me', 'me', 'Me', 'relationship', 10, true, 'receipt_cimmich_person_categories_sort_trust_v1'),
    ('category_family', 'family', 'Family', 'relationship', 20, true, 'receipt_cimmich_person_categories_sort_trust_v1'),
    ('category_close_friends', 'close-friends', 'Close Friends', 'relationship', 30, true, 'receipt_cimmich_person_categories_sort_trust_v1'),
    ('category_friends', 'friends', 'Friends', 'relationship', 40, true, 'receipt_cimmich_person_categories_sort_trust_v1'),
    ('category_co_workers', 'co-workers', 'Co-workers', 'relationship', 50, true, 'receipt_cimmich_person_categories_sort_trust_v1'),
    ('category_sort', 'sort', 'Sort', 'workflow', 70, true, 'receipt_cimmich_person_categories_sort_trust_v1');

CREATE TABLE person_category_membership_event (
    membership_event_id text PRIMARY KEY,
    person_id text NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
    category_id text NOT NULL REFERENCES person_category(category_id),
    action text NOT NULL CHECK (action IN ('add','remove')),
    actor_kind text NOT NULL CHECK (actor_kind IN ('system','user')),
    actor_id text,
    decision_id text REFERENCES decision(decision_id),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX person_category_membership_projection
    ON person_category_membership_event(person_id, category_id, created_at DESC, membership_event_id DESC);

CREATE VIEW current_person_category AS
WITH ranked AS (
    SELECT event.*,
           row_number() OVER (
             PARTITION BY event.person_id, event.category_id
             ORDER BY event.created_at DESC, event.membership_event_id DESC
           ) AS rank
    FROM person_category_membership_event event
)
SELECT ranked.person_id, ranked.category_id, category.slug, category.name,
       category.category_kind, category.sort_order, ranked.actor_kind,
       ranked.actor_id, ranked.decision_id, ranked.created_at
FROM ranked
JOIN person_category category ON category.category_id = ranked.category_id
WHERE ranked.rank = 1 AND ranked.action = 'add' AND category.state = 'active';

CREATE VIEW current_person_review_state AS
SELECT person.person_id,
       EXISTS (
         SELECT 1 FROM current_person_category category
         WHERE category.person_id = person.person_id AND category.slug = 'sort'
       ) AS needs_sort,
       CASE WHEN EXISTS (
         SELECT 1 FROM current_person_category category
         WHERE category.person_id = person.person_id AND category.slug = 'sort'
       ) THEN 'review_only'::text ELSE 'trusted'::text END AS matching_authority
FROM current_person person;

CREATE FUNCTION enqueue_person_category_source_pack_rebuild()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_slug text;
BEGIN
  SELECT slug INTO v_slug FROM person_category WHERE category_id = NEW.category_id;
  IF v_slug = 'sort' THEN
    PERFORM enqueue_source_pack_rebuild(
      NEW.person_id, 'person_sort_state_changed', 'person_category_membership_event', NEW.membership_event_id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER person_category_source_pack_rebuild
AFTER INSERT ON person_category_membership_event
FOR EACH ROW EXECUTE FUNCTION enqueue_person_category_source_pack_rebuild();

COMMIT;
