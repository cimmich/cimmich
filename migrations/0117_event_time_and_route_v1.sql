BEGIN;

-- Activities carry one normalized recurrence rule. The Event's existing
-- date_start/date_end fields remain the honest bounded or open-ended window;
-- recurrence only describes how the activity repeats inside that window.
CREATE FUNCTION cimmich_event_recurrence_valid(value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  frequency text;
  interval_value numeric;
  day_value jsonb;
  day_number numeric;
BEGIN
  IF value IS NULL THEN
    RETURN true;
  END IF;
  IF jsonb_typeof(value) <> 'object'
     OR NOT value ?& ARRAY['frequency','interval']
     OR EXISTS (
       SELECT 1 FROM jsonb_object_keys(value) key
       WHERE key NOT IN ('frequency','interval','weekdays')
     ) THEN
    RETURN false;
  END IF;
  frequency := value->>'frequency';
  IF frequency NOT IN ('daily','weekly','monthly','yearly')
     OR jsonb_typeof(value->'interval') <> 'number' THEN
    RETURN false;
  END IF;
  interval_value := (value->>'interval')::numeric;
  IF interval_value <> trunc(interval_value) OR interval_value NOT BETWEEN 1 AND 99 THEN
    RETURN false;
  END IF;
  IF frequency <> 'weekly' THEN
    RETURN NOT value ? 'weekdays';
  END IF;
  IF jsonb_typeof(value->'weekdays') <> 'array'
     OR jsonb_array_length(value->'weekdays') NOT BETWEEN 1 AND 7 THEN
    RETURN false;
  END IF;
  FOR day_value IN SELECT * FROM jsonb_array_elements(value->'weekdays') LOOP
    IF jsonb_typeof(day_value) <> 'number' THEN
      RETURN false;
    END IF;
    day_number := (day_value #>> '{}')::numeric;
    IF day_number <> trunc(day_number) OR day_number NOT BETWEEN 0 AND 6 THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN jsonb_array_length(value->'weekdays') = (
    SELECT count(DISTINCT day #>> '{}')
    FROM jsonb_array_elements(value->'weekdays') day
  );
END;
$$;

ALTER TABLE context_entity
  ADD COLUMN recurrence jsonb;

ALTER TABLE context_entity
  ADD CONSTRAINT context_entity_event_recurrence_check CHECK (
    recurrence IS NULL OR (
      entity_kind = 'event'
      AND event_kind = 'activity'
      AND cimmich_event_recurrence_valid(recurrence)
    )
  );

-- Ordered Trip stops are the existing Event -> Place location relations with
-- a position. This keeps one relationship truth and the existing correction /
-- Undo lifecycle instead of maintaining a second route membership table.
ALTER TABLE context_relation_link
  ADD COLUMN sort_order integer;

ALTER TABLE context_relation_link
  ADD CONSTRAINT context_relation_link_sort_order_check
  CHECK (sort_order IS NULL OR sort_order BETWEEN 0 AND 99);

CREATE UNIQUE INDEX context_relation_link_current_stop_order
  ON context_relation_link(entity_id, sort_order)
  WHERE state = 'accepted' AND sort_order IS NOT NULL;

CREATE OR REPLACE FUNCTION enforce_context_relation_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_source_kind text;
  v_source_event_kind text;
  v_target_kind text;
BEGIN
  SELECT entity_kind, event_kind INTO v_source_kind, v_source_event_kind
  FROM context_entity
  WHERE entity_id = NEW.entity_id AND status IN ('active','hidden');
  IF v_source_kind IS NULL THEN
    RAISE EXCEPTION 'Context relation requires a current source entity'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.target_kind IN ('person','pet') THEN
    SELECT subject_kind INTO v_target_kind FROM person
    WHERE person_id = NEW.target_id AND status = 'active';
  ELSE
    SELECT entity_kind INTO v_target_kind FROM context_entity
    WHERE entity_id = NEW.target_id AND status = 'active';
  END IF;
  IF v_target_kind IS DISTINCT FROM NEW.target_kind THEN
    RAISE EXCEPTION 'Context relation target kind does not match a current target'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.entity_id = NEW.target_id THEN
    RAISE EXCEPTION 'Context relation cannot target itself' USING ERRCODE = '23514';
  END IF;
  IF (NEW.relation_kind = 'participant' AND NEW.target_kind <> 'person')
     OR (NEW.relation_kind = 'companion' AND NEW.target_kind <> 'pet')
     OR (NEW.relation_kind = 'location' AND NEW.target_kind <> 'place')
     OR (NEW.relation_kind = 'object' AND NEW.target_kind <> 'object')
     OR (NEW.relation_kind = 'parent' AND (
       NEW.target_kind <> v_source_kind OR v_source_kind NOT IN ('place','event')
     )) THEN
    RAISE EXCEPTION 'Context relation role does not match its target kind'
      USING ERRCODE = '23514';
  END IF;
  IF v_source_kind <> 'event' AND NEW.relation_kind IN
      ('participant','companion','location','object') THEN
    RAISE EXCEPTION 'Participant/location/object roles belong to Events'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.sort_order IS NOT NULL AND NOT (
    v_source_kind = 'event'
    AND v_source_event_kind = 'trip'
    AND NEW.relation_kind = 'location'
    AND NEW.target_kind = 'place'
    AND NEW.state = 'accepted'
  ) THEN
    RAISE EXCEPTION 'Ordered stops must be accepted Place locations on a Trip'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.supersedes_link_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM context_relation_link previous
    WHERE previous.link_id = NEW.supersedes_link_id
      AND previous.entity_id = NEW.entity_id
      AND previous.target_kind = NEW.target_kind
      AND previous.target_id = NEW.target_id
      AND previous.relation_kind = NEW.relation_kind
  ) THEN
    RAISE EXCEPTION 'Context relation supersession crossed scope'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER context_relation_link_scope ON context_relation_link;
CREATE TRIGGER context_relation_link_scope
BEFORE INSERT OR UPDATE OF entity_id, target_kind, target_id, relation_kind,
  state, sort_order, supersedes_link_id ON context_relation_link
FOR EACH ROW EXECUTE FUNCTION enforce_context_relation_scope();

CREATE OR REPLACE VIEW current_context_relation AS
SELECT link_id, entity_id, target_kind, target_id, relation_kind, decision_id,
       created_at, sort_order
FROM context_relation_link WHERE state = 'accepted';

COMMIT;
