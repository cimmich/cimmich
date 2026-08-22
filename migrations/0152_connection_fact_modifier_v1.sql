BEGIN;

-- Modifiers qualify one recorded relationship without multiplying the type
-- catalogue. Former is the one seeded modifier and carries temporal meaning;
-- owner-created modifiers are reusable descriptive qualifiers.
CREATE TABLE connection_modifier (
    modifier_id text PRIMARY KEY CHECK (modifier_id ~ '^connectionmodifier_[a-z0-9_]{2,80}$'),
    slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9_]{1,63}$'),
    label text NOT NULL CHECK (label = btrim(label) AND length(label) BETWEEN 1 AND 64),
    behavior text NOT NULL DEFAULT 'qualifier' CHECK (behavior IN ('qualifier','historical')),
    is_system_seed boolean NOT NULL DEFAULT false,
    state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','retired')),
    command_id text UNIQUE,
    actor_id text,
    privacy_class text NOT NULL DEFAULT 'private' CHECK (privacy_class = 'private'),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (behavior <> 'historical' OR is_system_seed)
);

INSERT INTO connection_modifier (
    modifier_id, slug, label, behavior, is_system_seed
) VALUES (
    'connectionmodifier_former', 'former', 'Former', 'historical', true
);

CREATE TABLE connection_fact_event_modifier (
    event_id text NOT NULL REFERENCES connection_fact_event(event_id) ON DELETE CASCADE,
    modifier_id text NOT NULL REFERENCES connection_modifier(modifier_id),
    privacy_class text NOT NULL DEFAULT 'private' CHECK (privacy_class = 'private'),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, modifier_id)
);

CREATE INDEX connection_fact_event_modifier_modifier
    ON connection_fact_event_modifier(modifier_id, event_id);

-- Existing historical Person facts already mean Former. Associate the seeded
-- modifier with every event version so current facts and audit history agree.
INSERT INTO connection_fact_event_modifier (event_id, modifier_id)
SELECT event_id, 'connectionmodifier_former'
FROM connection_fact_event
WHERE target_kind = 'person' AND validity = 'past';

CREATE FUNCTION enforce_connection_fact_event_modifier_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_behavior text;
  v_target_kind text;
  v_validity text;
BEGIN
  SELECT behavior INTO v_behavior
  FROM connection_modifier
  WHERE modifier_id = NEW.modifier_id AND state = 'active';
  IF v_behavior IS NULL THEN
    RAISE EXCEPTION 'Connection modifier must be active' USING ERRCODE = '23514';
  END IF;
  SELECT target_kind, validity INTO v_target_kind, v_validity
  FROM connection_fact_event WHERE event_id = NEW.event_id;
  IF v_behavior = 'historical'
     AND (v_target_kind IS DISTINCT FROM 'person' OR v_validity IS DISTINCT FROM 'past') THEN
    RAISE EXCEPTION 'Former applies only to historical Person relationships' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER connection_fact_event_modifier_scope
BEFORE INSERT OR UPDATE ON connection_fact_event_modifier
FOR EACH ROW EXECUTE FUNCTION enforce_connection_fact_event_modifier_scope();

-- Do not require the association from connection_fact_event itself. The
-- schema-151 service remains an availability rollback on schema 152 and may
-- write a past event without the new join row. The schema-152 read projection
-- treats that legacy shape as implied Former, while every schema-152 writer
-- persists the explicit modifier snapshot.

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, privacy_class
) VALUES (
    'receipt_cimmich_connection_fact_modifier_v1', 'system',
    'cimmich-connection-fact-modifier', 'v1', now(), now(), 'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE
    SET completed_at = excluded.completed_at;

COMMIT;
