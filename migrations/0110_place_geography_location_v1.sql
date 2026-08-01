BEGIN;

-- A Place can describe either geographic containment (country, city,
-- neighbourhood) or a human location (home, venue, room). Existing rows stay
-- reviewable instead of being guessed into either model.
ALTER TABLE context_entity
  ADD COLUMN place_role text;

UPDATE context_entity
SET place_role = 'unclassified'
WHERE entity_kind = 'place';

ALTER TABLE context_entity
  ADD CONSTRAINT context_entity_place_role_check CHECK (
    (entity_kind = 'place'
      AND place_role IN ('geography','location','unclassified'))
    OR (entity_kind <> 'place' AND place_role IS NULL)
  );

ALTER TABLE context_entity
  ADD COLUMN geography_entity_id text
    REFERENCES context_entity(entity_id) ON DELETE SET NULL;

ALTER TABLE context_entity
  ADD CONSTRAINT context_entity_geography_scope_check CHECK (
    geography_entity_id IS NULL
    OR (entity_kind = 'place' AND place_role = 'location')
  );

CREATE INDEX context_entity_place_role_directory
  ON context_entity (
    place_role, directory_visibility, lower(display_name), entity_id
  )
  WHERE entity_kind = 'place' AND status = 'active';

CREATE INDEX context_entity_location_geography
  ON context_entity (geography_entity_id, lower(display_name), entity_id)
  WHERE entity_kind = 'place' AND place_role = 'location'
    AND status = 'active';

-- Unclassified is a deliberate compatibility state. It may temporarily sit
-- beside a classified node while an existing tree is reviewed. Once both ends
-- are classified, only same-role containment is accepted.
CREATE OR REPLACE FUNCTION enforce_context_entity_parent()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_parent_kind text;
  v_parent_status text;
  v_parent_role text;
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

  IF TG_OP = 'UPDATE' AND NEW.entity_kind = 'place'
     AND NEW.place_role IS DISTINCT FROM OLD.place_role
     AND NEW.place_role <> 'unclassified'
     AND EXISTS (
       SELECT 1 FROM context_entity child
       WHERE child.parent_entity_id = NEW.entity_id
         AND child.status IN ('active','hidden')
         AND child.place_role <> 'unclassified'
         AND child.place_role IS DISTINCT FROM NEW.place_role
     ) THEN
    RAISE EXCEPTION 'Classified Place children must use the same hierarchy role'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.place_role = 'geography'
     AND (NEW.place_role IS DISTINCT FROM 'geography'
       OR NEW.status NOT IN ('active','hidden'))
     AND EXISTS (
       SELECT 1 FROM context_entity location
       WHERE location.geography_entity_id = NEW.entity_id
         AND location.status IN ('active','hidden')
     ) THEN
    RAISE EXCEPTION 'Move linked Locations before changing or removing this Geography'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.parent_entity_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.parent_entity_id = NEW.entity_id THEN
    RAISE EXCEPTION 'Context entity cannot parent itself' USING ERRCODE = '23514';
  END IF;
  SELECT entity_kind, status, place_role
    INTO v_parent_kind, v_parent_status, v_parent_role
  FROM context_entity WHERE entity_id = NEW.parent_entity_id;
  IF v_parent_kind IS DISTINCT FROM NEW.entity_kind
     OR NEW.entity_kind NOT IN ('place','event')
     OR v_parent_status NOT IN ('active','hidden') THEN
    RAISE EXCEPTION 'Context parent must be a current same-kind Place or Event'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.entity_kind = 'place'
     AND NEW.place_role <> 'unclassified'
     AND v_parent_role <> 'unclassified'
     AND NEW.place_role IS DISTINCT FROM v_parent_role THEN
    RAISE EXCEPTION 'Location and Geography use separate parent hierarchies'
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
BEFORE INSERT OR UPDATE OF parent_entity_id, entity_kind, status, place_role
ON context_entity
FOR EACH ROW EXECUTE FUNCTION enforce_context_entity_parent();

CREATE FUNCTION enforce_context_entity_geography()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_kind text;
  v_role text;
  v_status text;
BEGIN
  IF NEW.geography_entity_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.geography_entity_id = NEW.entity_id THEN
    RAISE EXCEPTION 'A Location cannot be its own Geography'
      USING ERRCODE = '23514';
  END IF;
  SELECT entity_kind, place_role, status INTO v_kind, v_role, v_status
  FROM context_entity WHERE entity_id = NEW.geography_entity_id;
  IF v_kind IS DISTINCT FROM 'place'
     OR v_role IS DISTINCT FROM 'geography'
     OR v_status NOT IN ('active','hidden') THEN
    RAISE EXCEPTION 'Location geography must be a current Geography Place'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER context_entity_geography_guard
BEFORE INSERT OR UPDATE OF geography_entity_id, place_role, entity_kind
ON context_entity
FOR EACH ROW EXECUTE FUNCTION enforce_context_entity_geography();

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_place_geography_location_v1', 'system',
    'cimmich-place-geography-location', 'v1', now(), now(),
    encode(digest('cimmich-place-geography-location-v1', 'sha256'), 'hex'),
    'release-safe'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
    completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

COMMIT;
