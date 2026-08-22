BEGIN;

CREATE TABLE connection_type (
    type_id text PRIMARY KEY CHECK (type_id ~ '^connectiontype_[a-z0-9_]{2,80}$'),
    slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9_]{1,63}$'),
    label text NOT NULL CHECK (label = btrim(label) AND length(label) BETWEEN 1 AND 80),
    past_label text CHECK (
        past_label IS NULL OR (past_label = btrim(past_label) AND length(past_label) BETWEEN 1 AND 80)
    ),
    inverse_label text NOT NULL CHECK (
        inverse_label = btrim(inverse_label) AND length(inverse_label) BETWEEN 1 AND 80
    ),
    inverse_past_label text CHECK (
        inverse_past_label IS NULL OR (
            inverse_past_label = btrim(inverse_past_label) AND length(inverse_past_label) BETWEEN 1 AND 80
        )
    ),
    source_kind text NOT NULL CHECK (source_kind = 'person'),
    target_kind text NOT NULL CHECK (target_kind IN ('person','place')),
    is_symmetric boolean NOT NULL DEFAULT false,
    temporal_mode text NOT NULL CHECK (temporal_mode IN ('none','current_or_past')),
    semantic_kind text NOT NULL CHECK (semantic_kind ~ '^[a-z][a-z0-9_]{1,63}$'),
    is_system_seed boolean NOT NULL DEFAULT false,
    state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','retired')),
    command_id text UNIQUE,
    actor_id text,
    privacy_class text NOT NULL DEFAULT 'private' CHECK (privacy_class = 'private'),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (NOT is_symmetric OR (target_kind = source_kind AND label = inverse_label
        AND past_label IS NOT DISTINCT FROM inverse_past_label)),
    CHECK ((temporal_mode = 'none' AND past_label IS NULL AND inverse_past_label IS NULL)
        OR (temporal_mode = 'current_or_past' AND past_label IS NOT NULL AND inverse_past_label IS NOT NULL))
);

INSERT INTO connection_type (
    type_id, slug, label, past_label, inverse_label, inverse_past_label,
    source_kind, target_kind, is_symmetric, temporal_mode, semantic_kind, is_system_seed
) VALUES
    ('connectiontype_partner', 'partner', 'Partner', NULL, 'Partner', NULL,
      'person', 'person', true, 'none', 'partner', true),
    ('connectiontype_boyfriend', 'boyfriend', 'Boyfriend', NULL, 'Partner', NULL,
      'person', 'person', false, 'none', 'partner', true),
    ('connectiontype_girlfriend', 'girlfriend', 'Girlfriend', NULL, 'Partner', NULL,
      'person', 'person', false, 'none', 'partner', true),
    ('connectiontype_ex', 'ex', 'Ex', NULL, 'Ex', NULL,
      'person', 'person', true, 'none', 'ex_partner', true),
    ('connectiontype_best_friend', 'best_friend', 'Best friend', NULL, 'Best friend', NULL,
      'person', 'person', true, 'none', 'best_friend', true),
    ('connectiontype_friend', 'friend', 'Friend', NULL, 'Friend', NULL,
      'person', 'person', true, 'none', 'friend', true),
    ('connectiontype_enemy', 'enemy', 'Enemy', NULL, 'Enemy', NULL,
      'person', 'person', true, 'none', 'enemy', true),
    ('connectiontype_coworker', 'coworker', 'Co-worker', NULL, 'Co-worker', NULL,
      'person', 'person', true, 'none', 'coworker', true),
    ('connectiontype_family', 'family', 'Family', NULL, 'Family', NULL,
      'person', 'person', true, 'none', 'family', true),
    ('connectiontype_works_at', 'works_at', 'Works here', 'Worked here',
      'Works here', 'Worked here', 'person', 'place', false,
      'current_or_past', 'works_at', true),
    ('connectiontype_lives_at', 'lives_at', 'Lives here', 'Lived here',
      'Lives here', 'Lived here', 'person', 'place', false,
      'current_or_past', 'lives_at', true),
    ('connectiontype_studied_at', 'studied_at', 'Studies here', 'Studied here',
      'Studies here', 'Studied here', 'person', 'place', false,
      'current_or_past', 'studied_at', true),
    ('connectiontype_born_at', 'born_at', 'Born here', NULL, 'Born here', NULL,
      'person', 'place', false, 'none', 'born_at', true),
    ('connectiontype_visited', 'visited', 'Visited', NULL, 'Visited', NULL,
      'person', 'place', false, 'none', 'visited', true);

CREATE TABLE connection_fact_event (
    recorded_sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
    event_id text PRIMARY KEY CHECK (event_id ~ '^connectionevent_[0-9a-f]{32}$'),
    fact_id text NOT NULL CHECK (fact_id ~ '^connectionfact_[0-9a-f]{32}$'),
    action text NOT NULL CHECK (action IN ('record','retract')),
    source_kind text NOT NULL CHECK (source_kind = 'person'),
    source_id text NOT NULL REFERENCES person(person_id),
    target_kind text NOT NULL CHECK (target_kind IN ('person','place')),
    target_id text NOT NULL,
    type_id text NOT NULL REFERENCES connection_type(type_id),
    validity text NOT NULL CHECK (validity IN ('current','past','timeless')),
    date_start date,
    date_end date,
    note text CHECK (note IS NULL OR (note = btrim(note) AND length(note) BETWEEN 1 AND 500)),
    command_id text NOT NULL UNIQUE CHECK (length(command_id) BETWEEN 8 AND 120),
    actor_id text NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 120),
    suggestion_key text,
    supersedes_event_id text REFERENCES connection_fact_event(event_id),
    privacy_class text NOT NULL DEFAULT 'private' CHECK (privacy_class = 'private'),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (source_id <> target_id),
    CHECK (date_start IS NULL OR date_end IS NULL OR date_end >= date_start)
);

CREATE INDEX connection_fact_event_fact_latest
    ON connection_fact_event(fact_id, recorded_sequence DESC);
CREATE INDEX connection_fact_event_source
    ON connection_fact_event(source_id, target_kind, target_id, type_id);
CREATE INDEX connection_fact_event_person_target
    ON connection_fact_event(target_id, source_id, type_id) WHERE target_kind = 'person';

CREATE VIEW current_connection_fact AS
SELECT event_id, fact_id, source_kind, source_id, target_kind, target_id,
       type_id, validity, date_start, date_end, note, command_id, actor_id,
       suggestion_key, created_at
FROM (
    SELECT event.*, row_number() OVER (
        PARTITION BY fact_id ORDER BY recorded_sequence DESC
    ) AS current_position
    FROM connection_fact_event event
) current_event
WHERE current_position = 1 AND action = 'record';

CREATE TABLE connection_suggestion_decision (
    suggestion_key text PRIMARY KEY CHECK (length(suggestion_key) BETWEEN 16 AND 160),
    person_id text NOT NULL REFERENCES person(person_id),
    state text NOT NULL CHECK (state IN ('dismissed','confirmed')),
    command_id text NOT NULL UNIQUE CHECK (length(command_id) BETWEEN 8 AND 120),
    actor_id text NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 120),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION enforce_connection_fact_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_type connection_type%ROWTYPE;
  v_target_kind text;
BEGIN
  SELECT * INTO v_type FROM connection_type WHERE type_id = NEW.type_id AND state = 'active';
  IF v_type.type_id IS NULL OR v_type.source_kind <> NEW.source_kind OR v_type.target_kind <> NEW.target_kind THEN
    RAISE EXCEPTION 'Connection type does not match its endpoints' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM person WHERE person_id = NEW.source_id
      AND subject_kind = 'person' AND status IN ('active','hidden')) THEN
    RAISE EXCEPTION 'Connection fact requires a current Person source' USING ERRCODE = '23514';
  END IF;
  IF NEW.target_kind = 'person' THEN
    SELECT subject_kind INTO v_target_kind FROM person WHERE person_id = NEW.target_id
      AND subject_kind = 'person' AND status IN ('active','hidden');
  ELSE
    SELECT entity_kind INTO v_target_kind FROM context_entity WHERE entity_id = NEW.target_id
      AND entity_kind = 'place' AND status IN ('active','hidden');
  END IF;
  IF v_target_kind IS DISTINCT FROM NEW.target_kind THEN
    RAISE EXCEPTION 'Connection fact target does not match its declared kind' USING ERRCODE = '23514';
  END IF;
  IF (v_type.temporal_mode = 'none' AND NEW.validity <> 'timeless')
     OR (v_type.temporal_mode = 'current_or_past' AND NEW.validity = 'timeless') THEN
    RAISE EXCEPTION 'Connection validity does not match its type' USING ERRCODE = '23514';
  END IF;
  IF NEW.supersedes_event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM connection_fact_event previous
    WHERE previous.event_id = NEW.supersedes_event_id AND previous.fact_id = NEW.fact_id
  ) THEN
    RAISE EXCEPTION 'Connection fact supersession crossed facts' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER connection_fact_scope
BEFORE INSERT OR UPDATE OF fact_id, source_kind, source_id, target_kind,
  target_id, type_id, validity, supersedes_event_id
ON connection_fact_event FOR EACH ROW EXECUTE FUNCTION enforce_connection_fact_scope();

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, privacy_class
) VALUES (
    'receipt_cimmich_typed_connection_fact_v1', 'system',
    'cimmich-typed-connection-fact', 'v1', now(), now(), 'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET completed_at = excluded.completed_at;

COMMIT;
