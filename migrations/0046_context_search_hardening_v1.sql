BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_context_search_hardening_v1', 'system',
    'cimmich-context-search-hardening', 'v1', now(), now(),
    encode(digest('cimmich-context-search-hardening-v1', 'sha256'), 'hex'),
    'release-safe'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
    completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX context_entity_active_name_trgm
    ON context_entity USING gin (lower(display_name) gin_trgm_ops)
    WHERE status = 'active';
CREATE INDEX context_entity_active_description_trgm
    ON context_entity USING gin (lower(description) gin_trgm_ops)
    WHERE status = 'active' AND description IS NOT NULL;
CREATE INDEX context_alias_active_label_trgm
    ON context_entity_alias USING gin (lower(label) gin_trgm_ops)
    WHERE state = 'active';
CREATE INDEX person_active_name_trgm
    ON person USING gin (lower(display_name) gin_trgm_ops)
    WHERE status = 'active';
CREATE INDEX person_active_description_trgm
    ON person USING gin (lower(description) gin_trgm_ops)
    WHERE status = 'active' AND description IS NOT NULL;
CREATE INDEX person_alias_active_label_trgm
    ON person_alias USING gin (lower(label) gin_trgm_ops)
    WHERE state = 'active';
CREATE INDEX asset_active_capture_time
    ON asset(capture_time DESC, asset_id)
    WHERE state = 'active' AND capture_time IS NOT NULL;

CREATE OR REPLACE FUNCTION enforce_context_entity_parent()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_parent_kind text;
  v_parent_status text;
  v_cursor text;
  v_depth integer := 0;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IN ('active','hidden')
     AND NEW.status = 'archived' AND EXISTS (
       SELECT 1 FROM context_entity child
       WHERE child.parent_entity_id = NEW.entity_id
         AND child.status IN ('active','hidden')
     ) THEN
    RAISE EXCEPTION 'Current child entities must be moved or archived first'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.parent_entity_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.parent_entity_id = NEW.entity_id THEN
    RAISE EXCEPTION 'Context entity cannot parent itself' USING ERRCODE = '23514';
  END IF;

  SELECT entity_kind, status INTO v_parent_kind, v_parent_status
  FROM context_entity WHERE entity_id = NEW.parent_entity_id;
  IF v_parent_kind IS DISTINCT FROM NEW.entity_kind
     OR NEW.entity_kind NOT IN ('place','event')
     OR v_parent_status NOT IN ('active','hidden') THEN
    RAISE EXCEPTION 'Context parent must be a current same-kind Place or Event'
      USING ERRCODE = '23514';
  END IF;

  v_cursor := NEW.parent_entity_id;
  WHILE v_cursor IS NOT NULL LOOP
    IF v_cursor = NEW.entity_id THEN
      RAISE EXCEPTION 'Context parent hierarchy cannot contain a cycle'
        USING ERRCODE = '23514';
    END IF;
    v_depth := v_depth + 1;
    IF v_depth > 1000 THEN
      RAISE EXCEPTION 'Context parent hierarchy exceeds the supported depth'
        USING ERRCODE = '54001';
    END IF;
    SELECT parent_entity_id INTO v_cursor
    FROM context_entity WHERE entity_id = v_cursor;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER context_entity_parent_guard ON context_entity;
CREATE TRIGGER context_entity_parent_guard
BEFORE INSERT OR UPDATE OF parent_entity_id, entity_kind, status ON context_entity
FOR EACH ROW EXECUTE FUNCTION enforce_context_entity_parent();

CREATE OR REPLACE FUNCTION enforce_context_relation_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_source_kind text;
  v_target_kind text;
BEGIN
  SELECT entity_kind INTO v_source_kind FROM context_entity
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

COMMIT;
