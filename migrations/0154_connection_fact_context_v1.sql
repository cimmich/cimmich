BEGIN;

-- A relationship fact can be qualified by one or more existing contexts.
-- These are links to durable Places, Events/Life periods/Trips/Activities or
-- Things, not free-text modifiers and not inferred Person relationships.
CREATE TABLE connection_fact_context_event (
    recorded_sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
    context_event_id text PRIMARY KEY CHECK (
        context_event_id ~ '^connectioncontextevent_[0-9a-f]{32}$'
    ),
    link_id text NOT NULL CHECK (
        link_id ~ '^connectioncontextlink_[0-9a-f]{32}$'
    ),
    fact_id text NOT NULL CHECK (fact_id ~ '^connectionfact_[0-9a-f]{32}$'),
    context_entity_id text NOT NULL REFERENCES context_entity(entity_id),
    action text NOT NULL CHECK (action IN ('attach','detach')),
    command_id text NOT NULL CHECK (length(command_id) BETWEEN 8 AND 120),
    actor_id text NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 120),
    supersedes_event_id text REFERENCES connection_fact_context_event(context_event_id),
    privacy_class text NOT NULL DEFAULT 'private' CHECK (privacy_class = 'private'),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (command_id, context_entity_id)
);

CREATE INDEX connection_fact_context_event_fact_latest
    ON connection_fact_context_event(fact_id, recorded_sequence DESC);
CREATE INDEX connection_fact_context_event_context_latest
    ON connection_fact_context_event(context_entity_id, recorded_sequence DESC);

CREATE VIEW current_connection_fact_context AS
SELECT context_event_id, link_id, fact_id, context_entity_id, command_id,
       actor_id, created_at
FROM (
    SELECT event.*, row_number() OVER (
        PARTITION BY link_id ORDER BY recorded_sequence DESC
    ) AS current_position
    FROM connection_fact_context_event event
) current_event
WHERE current_position = 1 AND action = 'attach';

CREATE FUNCTION enforce_connection_fact_context_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_previous connection_fact_context_event%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM current_connection_fact
    WHERE fact_id = NEW.fact_id AND target_kind = 'person'
  ) THEN
    RAISE EXCEPTION 'Relationship context requires a current Person relationship fact'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.action = 'attach' AND NOT EXISTS (
    SELECT 1 FROM context_entity
    WHERE entity_id = NEW.context_entity_id AND status IN ('active','hidden')
  ) THEN
    RAISE EXCEPTION 'Relationship context requires a current context entity'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.supersedes_event_id IS NULL THEN
    IF NEW.action <> 'attach' OR EXISTS (
      SELECT 1 FROM connection_fact_context_event
      WHERE link_id = NEW.link_id
    ) THEN
      RAISE EXCEPTION 'A relationship context link must begin with one attachment'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT * INTO v_previous FROM connection_fact_context_event
      WHERE context_event_id = NEW.supersedes_event_id;
    IF v_previous.context_event_id IS NULL
       OR v_previous.link_id <> NEW.link_id
       OR v_previous.fact_id <> NEW.fact_id
       OR v_previous.context_entity_id <> NEW.context_entity_id
       OR v_previous.action <> 'attach'
       OR NEW.action <> 'detach'
       OR EXISTS (
         SELECT 1 FROM connection_fact_context_event newer
         WHERE newer.link_id = v_previous.link_id
           AND newer.recorded_sequence > v_previous.recorded_sequence
       ) THEN
      RAISE EXCEPTION 'Relationship context supersession crossed links'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER connection_fact_context_scope
BEFORE INSERT OR UPDATE OF link_id, fact_id, context_entity_id,
  supersedes_event_id
ON connection_fact_context_event FOR EACH ROW
EXECUTE FUNCTION enforce_connection_fact_context_scope();

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, privacy_class
) VALUES (
    'receipt_cimmich_connection_fact_context_v1', 'system',
    'cimmich-connection-fact-context', 'v1', now(), now(), 'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE
    SET completed_at = excluded.completed_at;

COMMIT;
